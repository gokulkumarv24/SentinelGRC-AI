// Prepares the end-to-end environment: fresh migrated database, synthetic demo data, current builds.
//   node e2e/prepare.mjs [--skip-build]
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CREDENTIALS_FILE, ROOT, e2eEnv } from './e2e-env.mjs';

const env = e2eEnv();
const skipBuild = process.argv.includes('--skip-build');
const api = fileURLToPath(new URL('services/api/', ROOT));
const web = fileURLToPath(new URL('apps/web/', ROOT));
const run = (cmd, cwd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, env, stdio: 'inherit' });
};

// 1. Database: create if missing, then rebuild the schema from the real migrations.
const target = new URL(env.DATABASE_URL);
const name = target.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name) || !/e2e|test/.test(name)) throw new Error(`Refusing to reset database "${name}": its name must contain "e2e" or "test".`);
const admin = new URL(env.DATABASE_URL);
admin.pathname = '/postgres';
const server = new pg.Client({ connectionString: admin.toString() });
await server.connect();
if (!(await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) await server.query(`CREATE DATABASE ${name}`);
await server.end();
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await db.end();
rmSync(new URL('var/e2e-storage', ROOT), { recursive: true, force: true });
run('npx prisma migrate deploy', api);

// 2. Builds (the suite runs against production builds, never the dev server).
if (!skipBuild) {
  run('npm run build', api);
  run('npx next build', web);
}

// 3. Synthetic demo data with known local passwords (no forced change, for automation only).
run(`node dist/cli/seed-demo.js --no-force-change --credentials-file "${fileURLToPath(CREDENTIALS_FILE)}"`, api);
console.log('E2E environment ready.');
