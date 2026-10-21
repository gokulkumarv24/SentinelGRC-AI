/**
 * Integrity checks for a restored environment (docs/BACKUP_RESTORE.md). Run against the RESTORED
 * database and storage, never production:
 *
 *   DATABASE_URL=<restored db> LOCAL_STORAGE_PATH=<restored storage> \
 *     npm run restore:verify -w services/api [-- --manifest <backup>/manifest.json] [--json]
 *
 * Checks: every repository migration is applied and none failed; append-only audit triggers exist;
 * table row counts match the backup manifest (when given); every stored evidence file and generated
 * report exists and matches its recorded SHA-256. Exits 1 on any failure.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../generated/prisma/client.js';

const { values: args } = parseArgs({ options: { manifest: { type: 'string' }, json: { type: 'boolean', default: false } } });

/** Tables whose counts are compared with the backup manifest (written by ops/backup.sh). */
export const COUNTED_TABLES = [
  'organizations', 'users', 'memberships', 'controls', 'control_tests', 'evidence', 'evidence_links', 'risks', 'risk_history',
  'findings', 'finding_events', 'remediation_tasks', 'vendors', 'vendor_assessments', 'question_responses', 'ai_systems',
  'ai_assessments', 'workflow_runs', 'notifications', 'audit_events', 'report_runs', 'ai_artifacts',
] as const;
const APPEND_ONLY_TRIGGERS = ['audit_events_no_update_delete', 'risk_history_no_update_delete', 'finding_events_no_update_delete'];

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const sha256File = (path: string) =>
  new Promise<string>((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (c) => hash.update(c)).on('end', () => done(hash.digest('hex'))).on('error', fail);
  });

// Only the database and storage settings are needed; the full app configuration (secrets etc.) is not.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
if (existsSync(`${repoRoot}.env`)) process.loadEnvFile(`${repoRoot}.env`); // never overrides variables already set
const env = { DATABASE_URL: process.env.DATABASE_URL ?? '', STORAGE_BACKEND: process.env.STORAGE_BACKEND ?? 'local', LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH ?? './var/storage' };
if (!env.DATABASE_URL) throw new Error('Set DATABASE_URL to the RESTORED database.');
const storageRoot = isAbsolute(env.LOCAL_STORAGE_PATH) ? env.LOCAL_STORAGE_PATH : resolve(repoRoot, env.LOCAL_STORAGE_PATH);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const checks: Check[] = [];

try {
  // 1. Migrations: everything in the repository is applied, nothing failed or was rolled back.
  const dir = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
  const expected = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  const done = new Set(applied.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
  const missing = expected.filter((m) => !done.has(m));
  const failed = applied.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name);
  checks.push({ name: 'migrations', ok: !missing.length && !failed.length, detail: `${done.size} applied${missing.length ? `; missing: ${missing.join(', ')}` : ''}${failed.length ? `; failed: ${failed.join(', ')}` : ''}` });

  // 2. Tamper protection on history tables survived the restore.
  const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
  const present = new Set(triggers.map((t) => t.tgname));
  const absent = APPEND_ONLY_TRIGGERS.filter((t) => !present.has(t));
  checks.push({ name: 'append-only triggers', ok: !absent.length, detail: absent.length ? `missing: ${absent.join(', ')}` : `${APPEND_ONLY_TRIGGERS.length} present` });

  // 3. Row counts against the manifest taken at backup time.
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${table}"`); // fixed allow-list above
    counts[table] = Number(row.n);
  }
  if (args.manifest) {
    const manifest = JSON.parse(readFileSync(args.manifest, 'utf8')) as { counts?: Record<string, number> };
    const diffs = Object.entries(manifest.counts ?? {}).filter(([t, n]) => counts[t] !== undefined && counts[t] !== n).map(([t, n]) => `${t}: backup ${n}, restored ${counts[t]}`);
    checks.push({ name: 'row counts', ok: !diffs.length, detail: diffs.length ? diffs.join('; ') : `${Object.keys(manifest.counts ?? {}).length} tables match the manifest` });
  } else {
    checks.push({ name: 'row counts', ok: true, detail: `recorded only (no --manifest given): ${COUNTED_TABLES.length} tables` });
  }

  // 4. Stored files exist and match their recorded checksums.
  if (env.STORAGE_BACKEND === 'local') {
    const files = [
      ...(await prisma.evidence.findMany({ where: { storageKey: { not: null } }, select: { id: true, storageKey: true, sha256Checksum: true } })).map((e) => ({ kind: 'evidence', id: e.id, key: e.storageKey!, sha: e.sha256Checksum })),
      ...(await prisma.reportRun.findMany({ where: { status: 'ready', storageKey: { not: null } }, select: { id: true, storageKey: true, checksum: true } })).map((r) => ({ kind: 'report', id: r.id, key: r.storageKey!, sha: r.checksum })),
    ];
    const problems: string[] = [];
    for (const f of files) {
      const path = resolve(storageRoot, f.key);
      if (!path.startsWith(storageRoot)) problems.push(`${f.kind} ${f.id}: unsafe key`);
      else if (!existsSync(path)) problems.push(`${f.kind} ${f.id}: file missing`);
      else if (f.sha && (await sha256File(path)) !== f.sha) problems.push(`${f.kind} ${f.id}: checksum mismatch`);
    }
    checks.push({ name: 'stored files', ok: !problems.length, detail: problems.length ? `${problems.length} problem(s): ${problems.slice(0, 10).join('; ')}` : `${files.length} files present with matching SHA-256` });
  } else {
    checks.push({ name: 'stored files', ok: true, detail: 'object storage: verify bucket versioning and spot-check downloads (see BACKUP_RESTORE.md)' });
  }
} catch (error) {
  checks.push({ name: 'connection', ok: false, detail: error instanceof Error ? error.message.split('\n')[0] : String(error) });
} finally {
  await prisma.$disconnect();
}

const ok = checks.every((c) => c.ok);
if (args.json) console.log(JSON.stringify({ ok, checks }, null, 2));
else {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(22)} ${c.detail}`);
  console.log(ok ? '\nRestore verified.' : '\nRestore verification FAILED.');
}
process.exitCode = ok ? 0 : 1;
