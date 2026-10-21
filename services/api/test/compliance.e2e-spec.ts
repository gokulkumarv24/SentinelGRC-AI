import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const manifest = (version: string, extra: object = {}) => ({
  key: 'acme-policy',
  name: 'Acme Internal Security Standard',
  publisher: 'Acme',
  version,
  sourceUrl: 'https://example.com/standard',
  licenseNotes: 'Internal document',
  isIllustrative: false,
  requirements: [
    { code: 'A', title: 'Access' },
    { code: 'A.1', title: 'Accounts are reviewed', parent: 'A' },
    { code: 'A.2', title: 'MFA is enforced', parent: 'A' },
  ],
  ...extra,
});

describe('Compliance module: frameworks, mappings, control tests, calculations, dashboard', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  it('lists platform reference frameworks with provenance', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['auditor']);
    const res = await client.get('/frameworks');
    const csf = res.body.find((f: { key: string }) => f.key === 'nist-csf');
    expect(csf).toMatchObject({ version: '2.0', scope: 'platform', isIllustrative: false, requirementCount: 134 });
    expect(csf.sourceUrl).toContain('nist.gov');
    const detail = await client.get(`/frameworks/${csf.id}`);
    expect(detail.body.requirements.find((r: { requirementCode: string }) => r.requirementCode === 'PR.AA-05').title).toMatch(/least privilege/);
  });

  it('previews, imports and protects immutable organization framework versions', async () => {
    const org = await createOrg(ctx.prisma);
    const other = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const { client: otherClient } = await loginAs(ctx, other.id, ['grc_manager']);

    const bad = await client.post('/frameworks/import-preview', manifest('1', { requirements: [{ code: 'X', title: 'x', parent: 'missing' }, { code: 'X', title: 'dup' }] }));
    expect(bad.body.valid).toBe(false);
    expect(bad.body.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['duplicate_code', 'unknown_parent']));
    expect((await client.post('/frameworks/import', manifest('1', { requirements: [{ code: 'X', title: 'x', parent: 'missing' }] }))).status).toBe(400);

    const ok = await client.post('/frameworks/import-preview', manifest('1'));
    expect(ok.body).toMatchObject({ valid: true, requirements: 3 });
    const imported = await client.post('/frameworks/import', manifest('1'));
    expect(imported.status).toBe(201);
    const again = await client.post('/frameworks/import-preview', manifest('1'));
    expect(again.body.issues.map((i: { code: string }) => i.code)).toContain('version_exists');

    // Other tenants never see an organization's private framework.
    const otherList = await otherClient.get('/frameworks');
    expect(otherList.body.some((f: { id: string }) => f.id === imported.body.id)).toBe(false);
    expect((await otherClient.get(`/frameworks/${imported.body.id}`)).status).toBe(404);
  });

  it('requires mapping review by someone other than the proposer and flags mappings on version change', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: proposer } = await loginAs(ctx, org.id, ['grc_manager']);
    const { client: reviewer } = await loginAs(ctx, org.id, ['grc_manager']);
    const fw = await proposer.post('/frameworks/import', manifest('2024'));
    const reqA1 = (await proposer.get(`/frameworks/${fw.body.id}`)).body.requirements.find((r: { requirementCode: string }) => r.requirementCode === 'A.1');
    const control = await proposer.post('/controls', { controlCode: 'IAM-1', title: 'Access reviews', description: 'Quarterly', category: 'Access' });

    const mapping = await proposer.post('/control-mappings', { sourceRequirementId: reqA1.id, controlId: control.body.id, mappingType: 'supports', rationale: 'Quarterly reviews satisfy A.1', confidence: 80 });
    expect(mapping.status).toBe(201);
    expect(mapping.body.reviewStatus).toBe('pending_review');
    const self = await proposer.post(`/control-mappings/${mapping.body.id}/review`, { decision: 'approved', notes: 'ok' });
    expect(self.status).toBe(403);
    expect((await reviewer.post(`/control-mappings/${mapping.body.id}/review`, { decision: 'approved', notes: 'Verified against policy text' })).body.reviewStatus).toBe('approved');
    const detail = await reviewer.get(`/control-mappings/${mapping.body.id}`);
    expect(detail.body.history.length).toBe(2);

    await proposer.post('/frameworks/import', manifest('2025'));
    const flagged = await reviewer.get(`/control-mappings/${mapping.body.id}`);
    expect(flagged.body.reviewStatus).toBe('pending_review');
  });

  it('runs the control-check flow: expired evidence fails → one finding + remediation; re-runs deduplicate', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['grc_manager']);
    const control = await client.post('/controls', { controlCode: 'POL-1', title: 'Security policy', description: 'Annual policy', category: 'Governance', ownerId: user.id });
    const cfg = await client.agent.put(`/api/v1/controls/${control.body.id}/test-configs`).set('X-CSRF-Token', client.csrf).send({ ruleKey: 'evidence_currency', parameters: { requireApproved: false } });
    expect(cfg.status).toBe(200);

    // 1. No evidence → unknown (not fail), evidence requested from the owner
    let run = await client.post(`/controls/${control.body.id}/tests`, { mode: 'automated' });
    expect(run.body.results[0]).toMatchObject({ result: 'unknown', findingId: null });
    expect(await ctx.prisma.notification.count({ where: { organizationId: org.id, recipientUserId: user.id, title: { contains: 'Evidence requested' } } })).toBe(1);

    // 2. Expired evidence → fail → finding + remediation task
    const ev = await client.upload('/evidence', { title: 'Policy 2025', linkEntityType: 'control', linkEntityId: control.body.id }, { name: 'policy.pdf', content: PDF });
    await ctx.prisma.evidence.update({ where: { id: ev.body.id }, data: { validFrom: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) } });
    run = await client.post(`/controls/${control.body.id}/tests`, { mode: 'automated' });
    expect(run.body.results[0]).toMatchObject({ result: 'fail', findingCreated: true });
    const findingId = run.body.results[0].findingId;
    const tasks = await ctx.prisma.remediationTask.findMany({ where: { findingId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].ownerId).toBe(user.id);

    // 3. Re-running the failing test updates the same finding (no duplicates)
    for (let i = 0; i < 3; i++) await client.post(`/controls/${control.body.id}/tests`, { mode: 'automated' });
    expect(await ctx.prisma.finding.count({ where: { organizationId: org.id } })).toBe(1);
    expect((await ctx.prisma.finding.findUniqueOrThrow({ where: { id: findingId } })).detectionCount).toBe(4);
    expect(await ctx.prisma.remediationTask.count({ where: { findingId } })).toBe(1);

    // 4. Fresh evidence → pass is recorded on the finding but never silently closes it
    await ctx.prisma.evidence.update({ where: { id: ev.body.id }, data: { validFrom: null, expiresAt: new Date(Date.now() + 200 * 86_400_000) } });
    run = await client.post(`/controls/${control.body.id}/tests`, { mode: 'automated' });
    expect(run.body.results[0].result).toBe('pass');
    const finding = await ctx.prisma.finding.findUniqueOrThrow({ where: { id: findingId }, include: { events: true } });
    expect(finding.status).not.toBe('closed');
    expect(finding.events.some((e) => e.eventType === 'passed_check')).toBe(true);
    // The passing check now satisfies the closure requirement for automated findings
    const { client: closer } = await loginAs(ctx, org.id, ['grc_manager']);
    const closed = await closer.post(`/findings/${findingId}/transition`, { toStatus: 'closed', rationale: 'Policy renewed; automated check passing' });
    expect(closed.status).toBe(200);

    // Evidence of the test run is preserved
    const tests = await client.get(`/controls/${control.body.id}/tests`);
    expect(tests.body.items.map((t: { result: string }) => t.result)).toEqual(['pass', 'fail', 'fail', 'fail', 'fail', 'unknown']);
  });

  it('records manual tests only for holders of control_test.manual, with rationale', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: analyst } = await loginAs(ctx, org.id, ['security_analyst']);
    const { client: contributor } = await loginAs(ctx, org.id, ['contributor']);
    const control = await analyst.agent.post('/api/v1/controls').set('X-CSRF-Token', analyst.csrf).send({ controlCode: 'MAN-1', title: 't', description: 'd', category: 'c' });
    // analysts cannot create controls, so create it directly
    expect(control.status).toBe(403);
    const created = await ctx.prisma.control.create({ data: { organizationId: org.id, controlCode: 'MAN-1', title: 'Manual', description: 'd', category: 'c', implementations: { create: { organizationId: org.id } } } });
    expect((await contributor.post(`/controls/${created.id}/tests`, { mode: 'manual', result: 'pass', summary: 'ok', rationale: 'looked' })).status).toBe(403);
    const res = await analyst.post(`/controls/${created.id}/tests`, { mode: 'manual', result: 'fail', summary: 'Walkthrough failed', rationale: 'Two admins without tickets' });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ result: 'fail', findingCreated: true });
  });

  it('calculates compliance per framework with documented definitions', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager', 'org_admin']);
    const csf = (await client.get('/frameworks')).body.find((f: { key: string }) => f.key === 'nist-csf');
    expect((await client.agent.put('/api/v1/frameworks/scope').set('X-CSRF-Token', client.csrf).send({ frameworkIds: [csf.id] })).status).toBe(200);
    const req = (await client.get(`/frameworks/requirements?frameworkId=${csf.id}&q=PR.AA-05`)).body.items[0];

    const mk = async (code: string, status: string) => {
      const c = await client.post('/controls', { controlCode: code, title: code, description: 'd', category: 'c' });
      await client.patch(`/controls/${c.body.id}/implementation`, { version: 1, status, ...(status === 'not_applicable' ? { applicabilityRationale: 'n/a' } : {}) });
      await client.post('/control-mappings', { sourceRequirementId: req.id, controlId: c.body.id, mappingType: 'supports', rationale: 'r', confidence: 50 });
      return c.body.id as string;
    };
    const a = await mk('C-A', 'implemented');
    const b = await mk('C-B', 'implemented');
    await mk('C-C', 'not_applicable');
    await client.post(`/controls/${a}/tests`, { mode: 'manual', result: 'pass', summary: 'ok', rationale: 'r' });
    await client.post(`/controls/${b}/tests`, { mode: 'manual', result: 'unknown', summary: 'no evidence', rationale: 'r' });

    const summary = await client.get('/compliance/summary');
    expect(summary.body.definitions.testPassRate.excludes).toMatch(/Unknown/);
    const block = summary.body.frameworks[0];
    expect(block.framework.key).toBe('nist-csf');
    expect(block.metrics).toMatchObject({ controls: 3, applicable: 2, notApplicable: 1, implementationCoverage: 100, testPassRate: 100 });
    expect(block.metrics.tests).toMatchObject({ pass: 1, unknown: 1 });
    expect(block.requirements.covered).toBe(1);
    expect(block.requirements.pendingReviewMappings).toBe(3);
  });

  it('bulk-imports controls with a validation preview and exports formula-safe CSV', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['grc_manager']);
    const header = 'controlCode,title,description,category,reviewFrequencyDays,ownerEmail,requirements';
    const bad = `${header}\nX-1,Title,Desc,Cat,90,,\nX-1,Dup,Desc,Cat,90,,\n,,,,,,\nX-2,"=HYPERLINK(""http://evil"")",Desc,Cat,abc,nobody@example.test,nist-csf:NOPE`;
    const preview = await client.post('/controls/import-preview', { csv: bad });
    expect(preview.body.summary).toMatchObject({ rows: 3, errors: 1 });
    expect(preview.body.rows.find((r: { row: number }) => r.row === 3).errors[0]).toMatch(/Duplicate/);
    expect((await client.post('/controls/import', { csv: bad })).status).toBe(400);

    const good = `${header}\nX-1,Title one,Desc,Cat,90,${user.email},nist-csf:PR.AA-05; iso-27001:A.5.15\nX-2,"=HYPERLINK(""http://evil"")",Desc,Cat,30,,`;
    const result = await client.post('/controls/import', { csv: good });
    expect(result.body).toMatchObject({ created: 2, mappings: 2 });
    const csv = await client.get('/controls/export.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain('nist-csf:PR.AA-05');
  });

  it('adopts a template with its rules and pending-review mappings', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const templates = await client.get('/controls/templates');
    const iam2 = templates.body.find((t: { controlCode: string }) => t.controlCode === 'IAM-02');
    const adopted = await client.post(`/controls/templates/${iam2.id}/adopt`);
    expect(adopted.status).toBe(201);
    const detail = await client.get(`/controls/${adopted.body.id}`);
    expect(detail.body.testConfigs.map((t: { ruleKey: string }) => t.ruleKey)).toEqual(['privileged_access_review']);
    expect(detail.body.frameworkReferences.length).toBe(3);
    expect(detail.body.frameworkReferences.every((m: { reviewStatus: string }) => m.reviewStatus === 'pending_review')).toBe(true);
    // No identity integration configured → unknown, never fail
    const run = await client.post(`/controls/${adopted.body.id}/tests`, { mode: 'automated' });
    expect(run.body.results[0].result).toBe('unknown');
  });

  it('serves a dashboard computed from real data and isolated per tenant', async () => {
    const org = await createOrg(ctx.prisma);
    const other = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const { client: otherClient } = await loginAs(ctx, other.id, ['grc_manager']);
    await client.post('/risks', { title: 'r1', description: 'd', category: 'c', likelihood: 5, impact: 5 });
    await client.post('/risks', { title: 'r2', description: 'd', category: 'c', likelihood: 1, impact: 2, reviewDate: days(5) });
    await client.post('/findings', { title: 'f', description: 'd', severity: 'high', dueDate: days(-2) });
    const summary = await client.get('/dashboard/summary');
    expect(summary.body.risks).toMatchObject({ active: 2, bySeverity: { critical: 1, low: 1, medium: 0, high: 0 } });
    expect(summary.body.findings).toMatchObject({ open: 1, overdue: 1 });
    expect(summary.body.upcoming.some((u: { type: string }) => u.type === 'risk_review')).toBe(true);
    const trends = await client.get('/dashboard/risk-trends');
    expect(trends.body.points.at(-1)).toMatchObject({ openRisks: 2, inherentTotal: 27 });
    const otherSummary = await otherClient.get('/dashboard/summary');
    expect(otherSummary.body.risks.active).toBe(0);
    expect(otherSummary.body.findings.open).toBe(0);
  });
});
