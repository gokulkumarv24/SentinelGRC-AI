/**
 * Synthetic demo data (spec §19).
 *
 *   npm run seed:demo -w services/api [-- --no-force-change]
 *
 * Boots the API in-process and creates every record through the real HTTP API as fictional demo
 * users, so scores, findings, notifications, workflow runs and audit events come from production
 * code paths. Idempotent: records are found by natural keys (control codes, titles, names) and
 * state-changing steps are skipped once done. Refuses to run unless DEMO_MODE=true, which the
 * configuration already forbids in production.
 *
 * New demo users get random local-only passwords written to var/demo-credentials.txt (gitignored)
 * and must change them at first sign-in unless --no-force-change is given (local automated tests).
 */
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import PDFDocument from 'pdfkit';

const { values: args } = parseArgs({ options: { 'no-force-change': { type: 'boolean', default: false } } });

// The seed makes a few hundred requests from one address; lift the in-memory limits for this process only.
process.env.RATE_LIMIT_DEFAULT_PER_MINUTE = '100000';
process.env.RATE_LIMIT_EXPENSIVE_PER_MINUTE = '100000';
process.env.WORKER_ENABLED = 'false';

const { loadEnv } = await import('../config/env.js');
const env = loadEnv();
if (!env.DEMO_MODE || env.APP_ENV === 'production') {
  console.error('Refusing to seed demo data: set DEMO_MODE=true in a non-production environment.');
  process.exit(1);
}

const { createApp } = await import('../bootstrap-app.js');
const { csrfCookieName, sessionCookieName } = await import('../common/cookies.js');
const { SessionService } = await import('../modules/auth/session.service.js');
const { OrganizationBootstrapService } = await import('../modules/organizations/organization-bootstrap.service.js');
const { DEFAULT_SETTINGS } = await import('../modules/organizations/organizations.service.js');
const { WorkflowRunner } = await import('../modules/workflows/workflow-runner.service.js');
const { PrismaService } = await import('../prisma/prisma.service.js');
const { loadReferenceData, syncRolesAndPermissions } = await import('./reference-data.js');

type RoleKey = 'org_admin' | 'grc_manager' | 'security_analyst' | 'risk_owner' | 'vendor_manager' | 'ai_governance_officer' | 'auditor' | 'contributor';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DAY = 86_400_000;
const HOUR = 3_600_000;
const days = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const NORTHSTAR = { slug: 'northstar-demo', name: 'Northstar Digital Services (DEMO)' };
const HARBOR = { slug: 'harbor-logistics-demo', name: 'Harbor Logistics (DEMO)' };

const PEOPLE: Array<{ key: string; email: string; name: string; roles: RoleKey[]; org: 'northstar' | 'harbor' }> = [
  { key: 'admin', email: 'admin@northstar-demo.example', name: 'Demo Admin', roles: ['org_admin'], org: 'northstar' },
  { key: 'grc', email: 'grc.manager@northstar-demo.example', name: 'Priya Raman (demo GRC manager)', roles: ['grc_manager'], org: 'northstar' },
  { key: 'ciso', email: 'ciso@northstar-demo.example', name: 'Elena Duarte (demo CISO, approver)', roles: ['grc_manager', 'vendor_manager', 'ai_governance_officer'], org: 'northstar' },
  { key: 'analyst', email: 'analyst@northstar-demo.example', name: 'Marco Silva (demo security analyst)', roles: ['security_analyst'], org: 'northstar' },
  { key: 'owner', email: 'risk.owner@northstar-demo.example', name: 'Hannah Okafor (demo risk owner)', roles: ['risk_owner'], org: 'northstar' },
  { key: 'vm', email: 'vendor.manager@northstar-demo.example', name: 'Liam Novak (demo vendor manager)', roles: ['vendor_manager'], org: 'northstar' },
  { key: 'ai', email: 'ai.officer@northstar-demo.example', name: 'Sofia Lindqvist (demo AI governance officer)', roles: ['ai_governance_officer'], org: 'northstar' },
  { key: 'auditor', email: 'auditor@northstar-demo.example', name: 'Daniel Kim (demo auditor)', roles: ['auditor'], org: 'northstar' },
  { key: 'contributor', email: 'contributor@northstar-demo.example', name: 'Aisha Bello (demo contributor)', roles: ['contributor'], org: 'northstar' },
  { key: 'harbor', email: 'ops.lead@harbor-logistics-demo.example', name: 'Tom Reyes (demo, other organization)', roles: ['grc_manager'], org: 'harbor' },
];

class ApiError extends Error {}

/** Cookie + CSRF client that calls the in-process API like the web app does. */
class DemoClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly csrf: string,
    readonly label: string,
  ) {}

  private headers(json: boolean): Record<string, string> {
    return {
      Cookie: `${sessionCookieName()}=${this.token}; ${csrfCookieName()}=${this.csrf}`,
      'X-CSRF-Token': this.csrf,
      Origin: env.PUBLIC_APP_URL,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async raw(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers: this.headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
  }

  async call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (res.status >= 300) throw new ApiError(`${this.label} ${method} ${path} → ${res.status} ${JSON.stringify(res.body.error ?? res.body)}`);
    return res.body as T;
  }

  get = <T = Json>(path: string) => this.call<T>('GET', path);
  post = <T = Json>(path: string, body: unknown = {}) => this.call<T>('POST', path, body);
  patch = <T = Json>(path: string, body: unknown) => this.call<T>('PATCH', path, body);
  put = <T = Json>(path: string, body: unknown) => this.call<T>('PUT', path, body);

  async upload(fields: Record<string, string>, file: { name: string; content: Buffer; type: string }): Promise<Json> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file.content)], { type: file.type }), file.name);
    const res = await fetch(`${this.base}/api/v1/evidence`, { method: 'POST', headers: this.headers(false), body: form });
    const body = (await res.json()) as Json;
    if (res.status >= 300) throw new ApiError(`${this.label} upload ${file.name} → ${res.status} ${JSON.stringify(body.error ?? body)}`);
    return body;
  }
}

/** A small, clearly fictional PDF with real text (so evidence previews and AI summaries have content). */
function samplePdf(title: string, paragraphs: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title, Author: 'SentinelGRC demo seed' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.font('Helvetica-Bold').fontSize(16).text(title);
  doc.moveDown(0.3).font('Helvetica-Oblique').fontSize(9).fillColor('#b45309').text('FICTIONAL DEMO DOCUMENT — Northstar Digital Services (DEMO). Not a real organization or record.');
  doc.moveDown().font('Helvetica').fontSize(11).fillColor('#000000');
  for (const p of paragraphs) doc.text(p).moveDown(0.6);
  doc.end();
  return done;
}

const log = (step: string, detail = '') => console.log(`  ✓ ${step}${detail ? ` — ${detail}` : ''}`);

let app: INestApplication | undefined;
const credentials: string[] = [];
const sessionIds: string[] = [];
const restoreMustChange = new Map<string, boolean>();

try {
  app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const runner = app.get(WorkflowRunner);

  console.log('Seeding synthetic demo data (all records are fictional)…');
  await syncRolesAndPermissions(prisma);
  await loadReferenceData(prisma);

  // ── Organizations, users and sessions ─────────────────────────────────────
  async function ensureOrg(def: { slug: string; name: string }) {
    let org = await prisma.organization.findUnique({ where: { slug: def.slug } });
    if (!org) {
      org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({ data: { name: def.name, slug: def.slug, isDemo: true, settings: DEFAULT_SETTINGS } });
        await new OrganizationBootstrapService().initialize(tx, created.id);
        return created;
      });
    } else if (!org.isDemo) {
      org = await prisma.organization.update({ where: { id: org.id }, data: { isDemo: true } });
    }
    return org;
  }
  const northstar = await ensureOrg(NORTHSTAR);
  const harbor = await ensureOrg(HARBOR);
  log('Organizations', `${northstar.name}, ${harbor.name}`);

  const credentialsFile = new URL('../../../../var/demo-credentials.txt', import.meta.url);
  const previousCredentials = new Map<string, string>();
  if (existsSync(credentialsFile)) {
    for (const line of readFileSync(credentialsFile, 'utf8').split('\n')) {
      const email = line.split(/\s+/)[0];
      if (email.includes('@') && !line.includes('(existing user')) previousCredentials.set(email, line);
    }
  }
  const roleRows = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const users: Record<string, { id: string; client: DemoClient }> = {};
  for (const p of PEOPLE) {
    const organizationId = p.org === 'northstar' ? northstar.id : harbor.id;
    let user = await prisma.user.findUnique({ where: { email: p.email } });
    if (!user) {
      const password = `Demo-${randomBytes(12).toString('base64url')}`;
      user = await prisma.user.create({
        data: { email: p.email, displayName: p.name, passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }) },
      });
      credentials.push(`${p.email.padEnd(42)} ${password}   (${p.roles.join(', ')})`);
      restoreMustChange.set(user.id, !args['no-force-change']);
    } else {
      // Keep the line from an earlier run so reruns don't lose the one-time passwords.
      credentials.push(previousCredentials.get(p.email) ?? `${p.email.padEnd(42)} (existing user — password unchanged)   (${p.roles.join(', ')})`);
      if (user.mustChangePassword) {
        restoreMustChange.set(user.id, true);
        await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
      }
    }
    let membership = await prisma.membership.findFirst({ where: { userId: user.id, organizationId } });
    membership ??= await prisma.membership.create({ data: { userId: user.id, organizationId } });
    for (const role of p.roles) {
      const roleId = roleRows.get(role)!;
      await prisma.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: membership.id, roleId } }, create: { membershipId: membership.id, roleId }, update: {} });
    }
    const s = await sessions.create(user.id, { userAgent: 'sentinelgrc-demo-seed' });
    await prisma.session.update({ where: { id: s.session.id }, data: { activeOrganizationId: organizationId } });
    sessionIds.push(s.session.id);
    users[p.key] = { id: user.id, client: new DemoClient(base, s.token, s.csrfToken, p.key) };
  }
  const as = (key: string) => users[key].client;
  const id = (key: string) => users[key].id;
  log('Demo users', `${PEOPLE.length} (one per role, plus an independent approver and a user in another organization)`);

  const org = northstar.id;
  const drain = (now?: Date) => runner.drain({ organizationId: org, now, max: 200 });

  // ── Frameworks in scope ──────────────────────────────────────────────────
  const frameworks = await as('grc').get<Array<{ id: string; key: string }>>('/frameworks');
  const inScope = frameworks.filter((f) => ['nist-csf', 'iso-27001', 'soc2-tsc', 'nist-ai-rmf', 'eu-ai-act'].includes(f.key)).map((f) => f.id);
  await as('grc').put('/frameworks/scope', { frameworkIds: inScope });
  log('Framework scope', `${inScope.length} frameworks`);

  // ── Controls (adopted from illustrative templates, with their unreviewed mappings) ──
  const CONTROLS: Array<[code: string, status: string, owner: string, notes: string]> = [
    ['GOV-01', 'implemented', 'grc', 'Policy approved by the (fictional) executive committee in January 2026.'],
    ['IAM-01', 'implemented', 'analyst', 'Quarterly reviews run by system owners and tracked in the demo IAM tool.'],
    ['IAM-02', 'partially_implemented', 'analyst', 'Privileged accounts inventoried; just-in-time elevation not yet rolled out.'],
    ['IAM-03', 'implemented', 'analyst', 'MFA enforced through the demo identity provider.'],
    ['VUL-01', 'implemented', 'analyst', 'Weekly authenticated scans; critical findings patched within 14 days.'],
    ['IR-01', 'in_progress', 'grc', 'Plan drafted; tabletop exercise scheduled.'],
    ['BCP-01', 'implemented', 'analyst', 'Nightly backups; restore test due annually.'],
    ['TPR-01', 'implemented', 'vm', 'Vendors tiered by criticality and assessed before onboarding.'],
    ['AI-01', 'partially_implemented', 'ai', 'AI inventory live; approval workflow piloting.'],
    ['REM-01', 'implemented', 'grc', 'Remediation tracked in SentinelGRC with due dates per severity.'],
  ];
  const control: Record<string, string> = {};
  for (const [code, status, owner, notes] of CONTROLS) {
    let c = await prisma.control.findFirst({ where: { organizationId: org, controlCode: code } });
    if (!c) {
      const template = await prisma.control.findFirstOrThrow({ where: { organizationId: null, controlCode: code } });
      await as('grc').post(`/controls/templates/${template.id}/adopt`);
      c = await prisma.control.findFirstOrThrow({ where: { organizationId: org, controlCode: code } });
    }
    control[code] = c.id;
    const impl = await prisma.controlImplementation.findFirstOrThrow({ where: { organizationId: org, controlId: c.id } });
    if (!impl.ownerId) {
      await as('grc').patch(`/controls/${c.id}/implementation`, { version: impl.version, status, ownerId: id(owner), implementationNotes: notes, nextReviewAt: days(code === 'GOV-01' ? 90 : 180) });
    }
  }
  log('Controls', `${CONTROLS.length} adopted from illustrative templates (their framework mappings stay "unreviewed")`);

  // ── Evidence (fictional PDFs; expired / expiring / missing examples) ─────
  const EVIDENCE: Array<{ title: string; control: string; by: string; expires: number | null; collected: number; classification: string; review?: 'approved'; text: string[] }> = [
    { title: 'Information Security Policy v4 (DEMO)', control: 'GOV-01', by: 'grc', expires: 300, collected: -65, classification: 'internal', review: 'approved', text: ['1. Purpose. This policy sets the security expectations for all staff of the fictional Northstar Digital Services.', '2. Access. Access to production systems must be approved by the system owner and reviewed quarterly. Multi-factor authentication must be enforced for all administrator accounts.', '3. Backups. Production data is backed up nightly and restore tests are performed at least annually.', '4. Review. This policy is reviewed annually by the security committee. Questions: security-team@northstar-demo.example.'] },
    { title: 'Q3 2026 user access review record (DEMO)', control: 'IAM-01', by: 'analyst', expires: 75, collected: -20, classification: 'confidential', review: 'approved', text: ['Scope: 14 fictional production applications. Reviewers: system owners.', 'Result: 212 accounts reviewed, 9 removed, 3 privilege reductions. All reviews were completed by 30 September 2026.'] },
    { title: 'Privileged account inventory (DEMO)', control: 'IAM-02', by: 'analyst', expires: -12, collected: -200, classification: 'confidential', review: 'approved', text: ['Inventory of privileged accounts as of March 2026. 27 privileged accounts across cloud, database and network tiers.', 'Note: this inventory has expired and must be refreshed.'] },
    { title: 'MFA enforcement configuration export (DEMO)', control: 'IAM-03', by: 'analyst', expires: 12, collected: -78, classification: 'confidential', text: ['Conditional access policy "Require MFA for admins" is enabled for all administrator roles.', 'Exception group: break-glass accounts (2), monitored and reviewed monthly.'] },
    { title: 'September 2026 vulnerability scan summary (DEMO)', control: 'VUL-01', by: 'analyst', expires: 25, collected: -21, classification: 'internal', review: 'approved', text: ['Authenticated scan of 340 fictional hosts. Critical: 0 open. High: 4 open, all within SLA.', 'Scanning is performed weekly; results are reviewed by the security analyst on duty.'] },
    { title: 'Backup restore test report 2025 (DEMO)', control: 'BCP-01', by: 'analyst', expires: -40, collected: -405, classification: 'internal', review: 'approved', text: ['Restore of the fictional customer database completed in 3h 10m against a 4h objective.', 'The next restore test is due by September 2026.'] },
  ];
  const evidence: Record<string, string> = {};
  for (const e of EVIDENCE) {
    let row = await prisma.evidence.findFirst({ where: { organizationId: org, title: e.title } });
    if (!row) {
      const created = await as(e.by).upload(
        { title: e.title, classification: e.classification, collectedAt: days(e.collected), ...(e.expires !== null ? { expiresAt: days(e.expires) } : {}), ownerId: id(e.by), linkEntityType: 'control', linkEntityId: control[e.control], linkPurpose: 'Operating effectiveness' },
        { name: `${e.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.pdf`, content: await samplePdf(e.title, e.text), type: 'application/pdf' },
      );
      row = await prisma.evidence.findUniqueOrThrow({ where: { id: created.id as string } });
    }
    evidence[e.title] = row.id;
    if (e.review && row.reviewStatus !== 'approved' && row.reviewStatus !== 'rejected') {
      await as(e.by === 'grc' ? 'ciso' : 'grc').post(`/evidence/${row.id}/review`, { decision: e.review, notes: 'Reviewed against the control description (demo).' });
    }
  }
  // IR-01 deliberately has no evidence: its automated check reports "unknown", not "fail".
  log('Evidence', `${EVIDENCE.length} fictional PDFs: 2 expired, 2 expiring within 30 days, 1 awaiting review; IR-01 has none`);

  // ── Integration: a visible failure, then recovery with a missing-MFA finding ──
  let integration = await prisma.integration.findFirst({ where: { organizationId: org, provider: 'demo_identity' } });
  integration ??= await prisma.integration.findUniqueOrThrow({ where: { id: (await as('admin').post('/integrations', { provider: 'demo_identity', displayName: 'Demo identity provider (synthetic)', configuration: { scenario: 'failure' } })).id as string } });
  const syncFailures = await prisma.workflowRun.count({ where: { organizationId: org, status: 'failed', definition: { key: 'integration_sync' } } });
  if (!syncFailures) {
    await as('admin').patch(`/integrations/${integration.id}`, { configuration: { scenario: 'failure' } });
    await as('admin').post(`/integrations/${integration.id}/sync`);
    const t0 = new Date();
    for (const offset of [0, HOUR, 2 * HOUR]) await drain(new Date(t0.getTime() + offset)); // bounded retries → failed run + alerts
  }
  if ((integration.configuration as { scenario?: string }).scenario !== 'missing_mfa' || !syncFailures) {
    await as('admin').patch(`/integrations/${integration.id}`, { configuration: { scenario: 'missing_mfa' } });
    await as('admin').post(`/integrations/${integration.id}/sync`);
    await drain(new Date(Date.now() + 3 * HOUR));
  }
  log('Integration', 'demo identity provider: one failed sync run (3 attempts), then a successful sync with one admin missing MFA');

  // ── Scheduled control tests: detect expired evidence and missing MFA; the second run re-detects without duplicating ──
  const testsDef = await prisma.workflowDefinition.findFirstOrThrow({ where: { organizationId: org, key: 'scheduled_control_tests' } });
  // Done once the MFA check has failed on two scheduled runs (one finding, detected twice).
  const mfaRedetected = await prisma.finding.count({ where: { organizationId: org, sourceType: 'control_test', controlId: control['IAM-03'], detectionCount: { gte: 2 } } });
  if (!mfaRedetected) {
    // Each config is due again `frequencyHours` after its last run; simulate the scheduler that far ahead.
    const maxFrequency = (await prisma.controlTestConfig.aggregate({ where: { organizationId: org }, _max: { frequencyHours: true } }))._max.frequencyHours ?? 24;
    for (let i = 1; i <= 2; i++) {
      await as('admin').post(`/workflows/${testsDef.id}/run`);
      await drain(new Date(Date.now() + i * (maxFrequency + 1) * HOUR));
    }
  }
  const auto = await prisma.finding.findMany({ where: { organizationId: org, sourceType: 'control_test' } });
  log('Scheduled control tests', `${auto.length} automated finding(s) from failing checks; re-detection updates them instead of duplicating`);

  // ── Manual findings and remediation ───────────────────────────────────────
  const MANUAL: Array<{ title: string; description: string; severity: string; control?: string; due: number }> = [
    { title: 'Security awareness training completion below target (DEMO)', description: 'Only 81% of fictional staff completed annual training against a 95% target.', severity: 'medium', due: 30 },
    { title: 'Incident response tabletop exercise not performed (DEMO)', description: 'No tabletop exercise has been recorded for the fictional incident response plan in the last 12 months.', severity: 'medium', control: 'IR-01', due: 45 },
  ];
  for (const f of MANUAL) {
    if (!(await prisma.finding.findFirst({ where: { organizationId: org, title: f.title } }))) {
      await as('analyst').post('/findings', { title: f.title, description: f.description, severity: f.severity, assignedTo: id('analyst'), dueDate: days(f.due), ...(f.control ? { controlId: control[f.control] } : {}) });
    }
  }
  const PRIORITY: Record<string, string> = { critical: 'urgent', high: 'high', medium: 'medium', low: 'low' };
  const open = await prisma.finding.findMany({ where: { organizationId: org, status: { notIn: ['closed', 'accepted'] } }, orderBy: { findingKey: 'asc' } });
  for (const f of open) {
    if (await prisma.remediationTask.count({ where: { organizationId: org, findingId: f.id } })) continue;
    await as('grc').post('/remediation-tasks', { findingId: f.id, title: `Remediate: ${f.title.replace(/ \(DEMO\)$/, '')}`, ownerId: id('analyst'), priority: PRIORITY[f.severity], dueDate: days(f.severity === 'high' || f.severity === 'critical' ? 14 : 30) });
  }
  // Close the training finding end to end: task completed by the analyst, closure validated by the GRC manager.
  const training = await prisma.finding.findFirstOrThrow({ where: { organizationId: org, title: MANUAL[0].title } });
  const trainingTask = await prisma.remediationTask.findFirstOrThrow({ where: { organizationId: org, findingId: training.id } });
  if (trainingTask.status !== 'completed') await as('analyst').post(`/remediation-tasks/${trainingTask.id}/complete`, { version: trainingTask.version, completionNotes: 'Reminder campaign sent; completion now 97% (fictional).' });
  if (training.status !== 'closed') await as('grc').post(`/findings/${training.id}/transition`, { toStatus: 'closed', rationale: 'Completion verified in the (fictional) LMS export.' });
  log('Findings and remediation', `${await prisma.finding.count({ where: { organizationId: org } })} findings, ${await prisma.remediationTask.count({ where: { organizationId: org } })} remediation tasks (one completed and closed)`);

  // ── Risks ─────────────────────────────────────────────────────────────────
  const RISKS: Array<{ title: string; description: string; category: string; l: number; i: number; residual?: [number, number, string]; controls: string[]; treatment: string }> = [
    { title: 'Compromise of privileged cloud accounts (DEMO)', description: 'An attacker gains administrator access to the fictional production cloud tenant through a stolen credential.', category: 'Information security', l: 4, i: 5, residual: [2, 5, 'MFA enforced for administrators; privileged inventory partially current.'], controls: ['IAM-02', 'IAM-03'], treatment: 'mitigate' },
    { title: 'Ransomware affecting customer data stores (DEMO)', description: 'Ransomware encrypts production databases and the most recent backups are not restorable.', category: 'Business continuity', l: 3, i: 5, controls: ['BCP-01', 'VUL-01'], treatment: 'mitigate' },
    { title: 'Unpatched internet-facing services (DEMO)', description: 'A known vulnerability in an internet-facing service is exploited before patching.', category: 'Information security', l: 3, i: 3, residual: [2, 3, 'Weekly scanning with a 14-day SLA for critical findings.'], controls: ['VUL-01'], treatment: 'mitigate' },
    { title: 'Ineffective incident response (DEMO)', description: 'A security incident is detected late or handled inconsistently because the plan has not been exercised.', category: 'Operational', l: 3, i: 4, controls: ['IR-01'], treatment: 'mitigate' },
    { title: 'Legacy file server reaches end of support (DEMO)', description: 'An internal file server with low-sensitivity archives will stop receiving vendor updates.', category: 'IT operations', l: 2, i: 2, controls: [], treatment: 'undecided' },
  ];
  const risk: Record<string, string> = {};
  for (const r of RISKS) {
    let row = await prisma.risk.findFirst({ where: { organizationId: org, title: r.title } });
    if (!row) {
      const created = await as('grc').post('/risks', { title: r.title, description: r.description, category: r.category, likelihood: r.l, impact: r.i, riskOwnerId: id('owner'), treatment: r.treatment, reviewDate: days(90) });
      row = await prisma.risk.findUniqueOrThrow({ where: { id: created.id as string } });
    }
    risk[r.title] = row.id;
    if (r.residual && row.residualScore === null) {
      await as('grc').patch(`/risks/${row.id}`, { version: row.version, residualLikelihood: r.residual[0], residualImpact: r.residual[1], residualRationale: r.residual[2], rationale: 'Residual assessed after verifying mitigating controls (demo).' });
    }
    for (const code of r.controls) {
      if (!(await prisma.riskControl.findFirst({ where: { organizationId: org, riskId: row.id, controlId: control[code] } }))) {
        await as('grc').put(`/risks/${row.id}/controls`, { controlId: control[code], relationship: 'mitigates', effectivenessRating: code === 'IAM-02' ? 'partially_effective' : 'effective', rationale: `${code} reduces likelihood (demo).` });
      }
    }
  }
  // A reviewer decision: the risk owner requests acceptance, the GRC manager (a different person) approves it.
  const legacy = risk[RISKS[4].title];
  if (!(await prisma.riskAcceptance.findFirst({ where: { organizationId: org, riskId: legacy } }))) {
    const req = await as('owner').post(`/risks/${legacy}/acceptance-requests`, { rationale: 'Archives are low sensitivity and the server is isolated; decommissioning is planned within 6 months.', scope: 'Legacy archive file server only', expiryDate: days(180) });
    await as('grc').post(`/risk-acceptances/${req.id}/decision`, { decision: 'approved', rationale: 'Low residual exposure; decommissioning tracked. Re-review at expiry.' });
  }
  log('Risks', `${RISKS.length} fictional risks across ratings, linked to controls; one acceptance approved by an independent reviewer`);

  // ── Vendors and assessments ──────────────────────────────────────────────
  const VENDORS = [
    { name: 'Cloudbase Hosting (fictional)', serviceDescription: 'Managed cloud hosting for the customer platform', criticality: 'critical', dataClassification: 'confidential', personalDataAccess: true, accessLevel: 'privileged', businessDependency: 5, serviceImpact: 5, dataTypes: ['customer records', 'application logs'], regions: ['EU/EEA'] },
    { name: 'Mailstream Ltd (fictional)', serviceDescription: 'Transactional email delivery', criticality: 'medium', dataClassification: 'internal', personalDataAccess: true, accessLevel: 'limited', businessDependency: 3, serviceImpact: 3, dataTypes: ['email addresses'], regions: ['EU/EEA', 'United States'] },
    { name: 'Payroll Partners (fictional)', serviceDescription: 'Outsourced payroll processing (onboarding)', criticality: 'high', dataClassification: 'restricted', personalDataAccess: true, accessLevel: 'none', businessDependency: 3, serviceImpact: 2, dataTypes: ['employee payroll data'], regions: ['United Kingdom'] },
  ];
  const vendor: Record<string, string> = {};
  for (const v of VENDORS) {
    const row = await prisma.vendor.findFirst({ where: { organizationId: org, name: v.name } });
    vendor[v.name] = row?.id ?? ((await as('vm').post('/vendors', { ...v, businessOwnerId: id('vm') })).id as string);
  }
  const template = (await as('vm').get<Array<{ id: string; key: string }>>('/questionnaires')).find((t) => t.key === 'vendor-security')!;
  type Question = { id: string; questionKey: string; visible: boolean; response: unknown };
  const answers = (qs: Question[], evidenceId: string) => {
    const by = (k: string) => qs.find((q) => q.questionKey === k)!.id;
    return [
      { questionId: by('gov.policy'), answer: true, evidenceId },
      { questionId: by('gov.certification'), answer: ['ISO/IEC 27001'] },
      { questionId: by('gov.certification_report'), answer: 'Certificate and statement of applicability attached', evidenceId },
      { questionId: by('iam.mfa'), answer: false }, // gap → high finding
      { questionId: by('iam.reviews'), answer: 'Quarterly' },
      { questionId: by('enc.at_rest'), answer: true },
      { questionId: by('enc.in_transit'), answer: true },
      { questionId: by('vuln.pentest_date'), answer: days(-120).slice(0, 10) }, // no report attached → evidence gap
      { questionId: by('vuln.critical_sla'), answer: 14 },
      { questionId: by('ir.plan'), answer: true },
      { questionId: by('ir.notify_hours'), answer: 72 },
      { questionId: by('bc.backup_test'), answer: true },
      { questionId: by('priv.dpa'), answer: true },
      { questionId: by('sub.list'), answer: false },
      { questionId: by('loc.regions'), answer: ['EU/EEA'] },
      { questionId: by('dev.sdlc'), answer: 'Peer review, dependency scanning and DAST in CI' },
      { questionId: by('ai.usage'), answer: false },
    ];
  };
  // Cloudbase: complete assessment → reviewed → decided by an independent approver → findings and a linked risk.
  const cloudbase = vendor[VENDORS[0].name];
  let cbAssessment = await prisma.vendorAssessment.findFirst({ where: { organizationId: org, vendorId: cloudbase } });
  if (!cbAssessment) cbAssessment = await prisma.vendorAssessment.findUniqueOrThrow({ where: { id: (await as('vm').post(`/vendors/${cloudbase}/assessments`, { templateId: template.id, dueDate: days(14) })).id as string } });
  if (cbAssessment.status === 'draft') {
    const soc = await as('vm').upload(
      { title: 'Cloudbase ISO 27001 certificate summary (DEMO)', classification: 'confidential', collectedAt: days(-30), expiresAt: days(330), linkEntityType: 'vendor', linkEntityId: cloudbase, linkPurpose: 'Vendor assurance' },
      { name: 'cloudbase-iso-summary.pdf', content: await samplePdf('Cloudbase Hosting — ISO/IEC 27001 certificate summary (fictional)', ['Certificate scope: managed hosting operations, EU region. Issued by a fictional certification body.', 'Valid until December 2027. Statement of applicability version 6.']), type: 'application/pdf' },
    );
    const detail = await as('vm').get<{ questions: Question[] }>(`/assessments/${cbAssessment.id}`);
    await as('vm').post(`/assessments/${cbAssessment.id}/responses`, { responses: answers(detail.questions, soc.id as string) });
    await as('vm').post(`/assessments/${cbAssessment.id}/submit`);
    cbAssessment = await prisma.vendorAssessment.findUniqueOrThrow({ where: { id: cbAssessment.id } });
  }
  if (cbAssessment.status === 'submitted' || cbAssessment.status === 'under_review') {
    const detail = await as('ciso').get<{ questions: Question[] }>(`/assessments/${cbAssessment.id}`);
    await as('ciso').post(`/assessments/${cbAssessment.id}/review`, { reviews: detail.questions.filter((q) => q.visible && q.response).map((q) => ({ questionId: q.id, reviewerStatus: 'accepted' })) });
    const decision = await as('ciso').post(`/assessments/${cbAssessment.id}/decision`, { decision: 'approved_with_conditions', rationale: 'Approved on condition that MFA is enforced for all Cloudbase administrators within 30 days and a current penetration test report is provided.' });
    // A vendor risk linked to the relevant control (scenario 5).
    if (decision.riskId) await as('grc').put(`/risks/${decision.riskId as string}/controls`, { controlId: control['TPR-01'], relationship: 'mitigates', effectivenessRating: 'partially_effective', rationale: 'Assessment and conditions tracked through TPR-01 (demo).' });
  }
  // Mailstream: an assessment in progress with answers still missing.
  const mailstream = vendor[VENDORS[1].name];
  if (!(await prisma.vendorAssessment.findFirst({ where: { organizationId: org, vendorId: mailstream } }))) {
    const a = await as('vm').post(`/vendors/${mailstream}/assessments`, { templateId: template.id, dueDate: days(21) });
    const detail = await as('vm').get<{ questions: Question[] }>(`/assessments/${a.id as string}`);
    const by = (k: string) => detail.questions.find((q) => q.questionKey === k)!.id;
    await as('vm').post(`/assessments/${a.id as string}/responses`, { responses: [{ questionId: by('gov.policy'), answer: true }, { questionId: by('iam.mfa'), answer: true }, { questionId: by('enc.in_transit'), answer: true }] });
  }
  log('Vendors', '3 fictional vendors: one assessed and decided with conditions, one assessment in progress, one onboarding');

  // ── AI systems ───────────────────────────────────────────────────────────
  const AI_BASE = { deploymentType: 'third_party_api', inputDataCategories: [] as string[], outputDataCategories: [] as string[] };
  const SYSTEMS = [
    { ...AI_BASE, name: 'Support reply assistant (fictional)', description: 'Drafts replies to customer support tickets for agent review.', businessPurpose: 'Reduce first-response time', modelName: 'example-llm', modelVersion: '2026-06', inputDataCategories: ['support tickets'], outputDataCategories: ['draft replies'], personalDataProcessed: true, providerVendorId: cloudbase },
    { ...AI_BASE, name: 'CV screening ranker (fictional)', description: 'Ranks job applications for recruiter review.', businessPurpose: 'Shortlist applicants faster', modelName: 'example-ranker', modelVersion: '0.9', inputDataCategories: ['CVs'], outputDataCategories: ['ranking scores'], personalDataProcessed: true, influencesDecisionsAboutPeople: true, affectedPeople: 'Job applicants' },
    { ...AI_BASE, name: 'Internal code assistant (fictional)', description: 'Code completion for engineers in the IDE.', businessPurpose: 'Developer productivity', deploymentType: 'saas_feature', inputDataCategories: ['source code'], outputDataCategories: ['code suggestions'] },
  ];
  const system: Record<string, string> = {};
  for (const s of SYSTEMS) {
    const row = await prisma.aiSystem.findFirst({ where: { organizationId: org, name: s.name } });
    system[s.name] = row?.id ?? ((await as('ai').post('/ai-systems', s)).id as string);
  }
  const aiTemplate = (await as('ai').get<Array<{ id: string; key: string }>>('/questionnaires?purpose=ai_system')).find((t) => t.key === 'ai-system-assessment')!;
  type Item = { id: string; questionKey: string };
  const fill = (items: Item[], unsatisfactory: string[], only?: number) =>
    items.slice(0, only ?? items.length).map((i) =>
      unsatisfactory.includes(i.questionKey)
        ? { itemId: i.id, response: 'Testing not yet performed', result: 'unsatisfactory', rationale: 'No documented prompt-injection testing before go-live.' }
        : { itemId: i.id, response: 'Documented and reviewed (demo)', result: 'satisfactory' },
    );

  // Support assistant: assessment with a gap → shared risk → independent approval → pilot.
  const support = system[SYSTEMS[0].name];
  let supportAssessment = await prisma.aiAssessment.findFirst({ where: { organizationId: org, aiSystemId: support } });
  if (!supportAssessment) {
    const a = await as('ai').post(`/ai-systems/${support}/assessments`, { templateId: aiTemplate.id });
    const detail = await as('ai').get<{ items: Item[] }>(`/ai-assessments/${a.id as string}`);
    await as('ai').post(`/ai-assessments/${a.id as string}/items`, { items: fill(detail.items, ['sec.prompt_injection']) });
    await as('ai').post(`/ai-assessments/${a.id as string}/submit`, { riskTier: 'limited', rationale: 'Customer-facing drafts reviewed by an agent before sending.', residualRiskNotes: 'Prompt-injection testing scheduled; every draft is reviewed by a human meanwhile.' });
    supportAssessment = await prisma.aiAssessment.findUniqueOrThrow({ where: { id: a.id as string } });
  }
  if (supportAssessment.status === 'submitted') {
    await as('ciso').post(`/ai-assessments/${supportAssessment.id}/decision`, { decision: 'approved', rationale: 'Mitigations adequate for a pilot with human review of every draft.' });
  }
  const supportSystem = await prisma.aiSystem.findUniqueOrThrow({ where: { id: support } });
  if (supportSystem.lifecycleStatus === 'under_assessment' || supportSystem.lifecycleStatus === 'proposed') {
    // Residual risk documented on the shared risk created by the assessment.
    const link = await prisma.riskLink.findFirst({ where: { organizationId: org, entityType: 'ai_system', entityId: support } });
    if (link) {
      const r = await prisma.risk.findUniqueOrThrow({ where: { id: link.riskId } });
      if (r.residualScore === null) await as('grc').patch(`/risks/${r.id}`, { version: r.version, residualLikelihood: 2, residualImpact: 3, residualRationale: 'Human review of every draft; testing scheduled.', rationale: 'Residual assessed (demo).' });
    }
    if (!(await prisma.evidenceLink.findFirst({ where: { organizationId: org, entityType: 'ai_system', entityId: support } }))) {
      const ev = await as('ai').upload(
        { title: 'Support assistant pilot evaluation report (DEMO)', classification: 'internal', collectedAt: days(-5), linkEntityType: 'ai_system', linkEntityId: support, linkPurpose: 'Pre-deployment evaluation' },
        { name: 'support-assistant-evaluation.pdf', content: await samplePdf('Support reply assistant — pilot evaluation (fictional)', ['500 historical tickets replayed. Agents rated 82% of drafts usable with minor edits.', 'Limitations: English tickets only; no adversarial prompts in this sample.']), type: 'application/pdf' },
      );
      await as('ciso').post(`/evidence/${ev.id as string}/review`, { decision: 'approved', notes: 'Evaluation method documented (demo).' });
    }
    const current = await prisma.aiSystem.findUniqueOrThrow({ where: { id: support } });
    await as('ai').patch(`/ai-systems/${support}`, { version: current.version, businessOwnerId: id('grc'), riskOwnerId: id('owner'), humanOversight: 'Every draft is reviewed and edited by a support agent before sending.', rollbackPlan: 'Disable the feature flag; agents continue manually.' });
    await as('ciso').post(`/ai-systems/${support}/approve-deployment`, { target: 'pilot', rationale: 'All deployment preconditions met; pilot limited to the EU support team.', nextReviewAt: days(90) });
    await as('ai').post(`/ai-systems/${support}/transition`, { to: 'pilot', rationale: 'Pilot started with the EU support team (demo).' });
  }
  if (!(await prisma.aiEvaluation.count({ where: { organizationId: org, aiSystemId: support } }))) {
    await as('ai').post(`/ai-systems/${support}/evaluations`, { evaluationType: 'security', methodology: 'Prompt-injection test suite (fictional) v1', datasetOrMethodDescription: '120 adversarial prompts', version: '1', result: 'fail', metrics: { blocked: 101, total: 120 }, limitations: 'English prompts only; no multi-turn attacks.', executedAt: days(-2) });
  }
  if (!(await prisma.aiIncident.count({ where: { organizationId: org, aiSystemId: support } }))) {
    const inc = await as('ai').post(`/ai-systems/${support}/incidents`, { title: 'Draft quoted an internal ticket note (DEMO)', severity: 'medium', description: 'A pilot draft included text from an internal note; the agent caught it before sending.', detectedAt: days(-1) });
    await as('ai').patch(`/ai-incidents/${inc.id as string}`, { status: 'resolved', rootCause: 'Internal notes were included in the model context.' });
  }
  // CV ranker: high-impact system with an unresolved, partly completed assessment.
  const ranker = system[SYSTEMS[1].name];
  if (!(await prisma.aiAssessment.findFirst({ where: { organizationId: org, aiSystemId: ranker } }))) {
    const a = await as('ai').post(`/ai-systems/${ranker}/assessments`, { templateId: aiTemplate.id });
    const detail = await as('ai').get<{ items: Item[] }>(`/ai-assessments/${a.id as string}`);
    await as('ai').post(`/ai-assessments/${a.id as string}/items`, { items: fill(detail.items, [], 6) });
  }
  log('AI systems', '3 fictional systems: one in pilot (approved assessment, shared risk, evaluation, incident), one under assessment, one proposed');

  // ── Reports ──────────────────────────────────────────────────────────────
  if (!(await prisma.reportRun.count({ where: { organizationId: org, title: 'Executive risk summary (DEMO)' } }))) {
    await as('grc').post('/reports', { reportType: 'executive_risk_summary', format: 'pdf', reportStatus: 'final', title: 'Executive risk summary (DEMO)' });
    await as('grc').post('/reports', { reportType: 'risk_register', format: 'csv' });
    await as('grc').post('/reports', { reportType: 'vendor_assessment', format: 'pdf', reportStatus: 'final', filters: { assessmentId: cbAssessment.id } });
  }
  await drain();
  log('Reports', `${await prisma.reportRun.count({ where: { organizationId: org, status: 'ready' } })} ready report(s) with source appendices`);

  // ── Optional AI draft (only when AI is enabled; never required for the demo) ──
  const ai = await as('grc').get<{ enabled: boolean }>('/ai/status');
  if (ai.enabled && !(await prisma.aiArtifact.count({ where: { organizationId: org } }))) {
    await as('grc').post('/ai/drafts', { artifactType: 'evidence_statements', targetId: evidence[EVIDENCE[0].title], controlId: control['GOV-01'] });
    log('AI draft', 'candidate evidence statements for the security policy (awaiting human review)');
  }

  // ── Second organization and the isolation check (scenario 9) ─────────────
  let harborRisk = await prisma.risk.findFirst({ where: { organizationId: harbor.id } });
  if (!harborRisk) harborRisk = await prisma.risk.findUniqueOrThrow({ where: { id: (await as('harbor').post('/risks', { title: 'Warehouse badge system outage (DEMO)', description: 'Badge readers fail closed during a network outage.', category: 'Physical security', likelihood: 2, impact: 3 })).id as string } });
  const crossA = await as('harbor').raw('GET', `/risks/${risk[RISKS[0].title]}`);
  const crossB = await as('auditor').raw('GET', `/risks/${harborRisk.id}`);
  if (crossA.status !== 404 || crossB.status !== 404) throw new Error(`Tenant isolation check failed (${crossA.status}, ${crossB.status})`);
  log('Tenant isolation', 'each organization gets 404 for the other’s records');

  // ── Wrap up ───────────────────────────────────────────────────────────────
  for (const [userId, mustChange] of restoreMustChange) await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: mustChange } });
  for (const s of sessionIds) await sessions.revoke(s, 'demo_seed_complete');
  sessionIds.length = 0;
  mkdirSync(new URL('.', credentialsFile), { recursive: true });
  writeFileSync(
    credentialsFile,
    [
      'SentinelGRC demo users — LOCAL DEVELOPMENT ONLY. Fictional accounts; never reuse these passwords.',
      args['no-force-change'] ? 'Password change at first sign-in: NOT forced (--no-force-change).' : 'Each new user must change the password at first sign-in.',
      '',
      ...credentials,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log(`\nDone. Demo sign-in details: var/demo-credentials.txt (gitignored). Walkthrough: docs/DEMO_SCENARIO.md`);
} catch (error) {
  console.error('\nDemo seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (app) {
    const prisma = app.get(PrismaService);
    for (const [userId, mustChange] of restoreMustChange) await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: mustChange } }).catch(() => undefined);
    const sessions = app.get(SessionService);
    for (const s of sessionIds) await sessions.revoke(s, 'demo_seed_aborted').catch(() => undefined);
    await app.close();
  }
}
