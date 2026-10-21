import { LEASE_MS, WorkflowRunner } from '../src/modules/workflows/workflow-runner.service.js';
import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('Workflow engine and integrations', () => {
  let ctx: TestContext;
  let runner: WorkflowRunner;
  beforeAll(async () => {
    ctx = await startApp();
    runner = ctx.app.get(WorkflowRunner);
  });
  afterAll(async () => ctx.app.close());

  async function setup() {
    const org = await createOrg(ctx.prisma);
    const admin = await loginAs(ctx, org.id, ['org_admin', 'grc_manager']);
    return { org, admin };
  }

  async function addIdentity(client: Awaited<ReturnType<typeof loginAs>>['client'], scenario: string) {
    const res = await client.post('/integrations', { provider: 'demo_identity', configuration: { scenario } });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('syncs the demo identity integration in the worker and runs scheduled control tests without duplicating findings', async () => {
    const { org, admin } = await setup();
    const integration = await addIdentity(admin.client, 'missing_mfa');
    const requested = await admin.client.post(`/integrations/${integration.id}/sync`);
    expect(requested.status).toBe(202);
    // Nothing runs inside the HTTP request.
    expect(await ctx.prisma.integrationRecord.count({ where: { integrationId: integration.id } })).toBe(0);
    await runner.drain({ organizationId: org.id });
    const run = await admin.client.get(`/workflow-runs/${requested.body.workflowRunId}`);
    expect(run.body.status).toBe('succeeded');
    expect(run.body.steps.map((s: { stepKey: string }) => s.stepKey)).toEqual(['handler:integration_sync', `sync:${integration.id}`]);
    const detail = await admin.client.get(`/integrations/${integration.id}`);
    expect(detail.body).toMatchObject({ status: 'healthy', stale: false, isDemo: true, recordCounts: [{ recordType: 'privileged_account', count: 6 }] });
    expect((await admin.client.get(`/integrations/${integration.id}/sync-runs`)).body.items[0]).toMatchObject({ status: 'succeeded', recordsProcessed: 6, recordsFailed: 0 });

    const control = await admin.client.post('/controls', { controlCode: 'IAM-MFA', title: 'MFA for admins', description: 'MFA on privileged accounts', category: 'Access', ownerId: admin.user.id });
    const cfg = await admin.client.agent.put(`/api/v1/controls/${control.body.id}/test-configs`).set('X-CSRF-Token', admin.client.csrf).send({ ruleKey: 'mfa_enforced', parameters: {} });
    expect(cfg.status).toBe(200);

    const now = new Date();
    expect(await runner.scheduleDue(now, org.id)).toBeGreaterThan(5);
    expect(await runner.scheduleDue(now, org.id)).toBe(0); // the slot already has its run
    await runner.drain({ organizationId: org.id, now });
    const findings = await ctx.prisma.finding.findMany({ where: { organizationId: org.id, controlId: control.body.id } });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].status).not.toBe('closed');
    // The critical finding event ran its alert workflow once.
    const alerts = await ctx.prisma.notification.count({ where: { organizationId: org.id, dedupeKey: `finding-high:${findings[0].id}` } });
    expect(alerts).toBe(1);

    // A later slot re-tests: still one open finding and no repeated alert.
    const later = new Date(now.getTime() + 2 * HOUR);
    await ctx.prisma.controlTestConfig.updateMany({ where: { controlId: control.body.id }, data: { nextRunAt: now } });
    await runner.scheduleDue(later, org.id);
    await runner.drain({ organizationId: org.id, now: later });
    expect(await ctx.prisma.finding.count({ where: { organizationId: org.id, controlId: control.body.id } })).toBe(1);
    expect(await ctx.prisma.notification.count({ where: { organizationId: org.id, dedupeKey: `finding-high:${findings[0].id}` } })).toBe(1);
    expect(await ctx.prisma.controlTest.count({ where: { organizationId: org.id, controlId: control.body.id } })).toBe(2);

    const runs = await admin.client.get('/workflow-runs?status=failed');
    expect(runs.body.total).toBe(0);
  });

  it('retries a failing sync with bounded backoff, fails visibly, and supports a linked manual retry', async () => {
    const { org, admin } = await setup();
    const auditor = await loginAs(ctx, org.id, ['auditor']);
    const integration = await addIdentity(admin.client, 'failure');
    const { workflowRunId } = (await admin.client.post(`/integrations/${integration.id}/sync`)).body;
    const t0 = new Date();

    await runner.drain({ organizationId: org.id, now: t0 });
    let run = await ctx.prisma.workflowRun.findUniqueOrThrow({ where: { id: workflowRunId } });
    expect(run).toMatchObject({ status: 'queued', attemptCount: 1, errorCode: 'unavailable' });
    expect(run.nextAttemptAt!.getTime()).toBeGreaterThan(t0.getTime());
    expect((await admin.client.get(`/integrations/${integration.id}`)).body).toMatchObject({ status: 'failing', stale: true, lastErrorCode: 'unavailable' });

    expect(await runner.drain({ organizationId: org.id, now: t0 })).toBe(0); // backoff not elapsed
    await runner.drain({ organizationId: org.id, now: new Date(t0.getTime() + HOUR) });
    await runner.drain({ organizationId: org.id, now: new Date(t0.getTime() + 2 * HOUR) });
    run = await ctx.prisma.workflowRun.findUniqueOrThrow({ where: { id: workflowRunId } });
    expect(run).toMatchObject({ status: 'failed', attemptCount: 3, errorCode: 'unavailable' });
    expect(await ctx.prisma.integrationSyncRun.count({ where: { integrationId: integration.id, status: 'failed' } })).toBe(3);
    // One failure alert per workflow run (not per attempt), plus the workflow failure alert.
    expect(await ctx.prisma.notification.count({ where: { recipientUserId: admin.user.id, eventType: 'integration.failed' } })).toBe(1);
    expect(await ctx.prisma.notification.count({ where: { recipientUserId: admin.user.id, eventType: 'workflow.failed' } })).toBe(1);
    expect(await ctx.prisma.auditEvent.count({ where: { organizationId: org.id, action: 'workflow.run_failed', entityId: workflowRunId } })).toBe(1);

    expect((await auditor.client.get(`/workflow-runs/${workflowRunId}`)).status).toBe(200);
    expect((await auditor.client.post(`/workflow-runs/${workflowRunId}/retry`)).status).toBe(403);
    const retry = await admin.client.post(`/workflow-runs/${workflowRunId}/retry`);
    expect(retry.status).toBe(202);
    expect(retry.body).toMatchObject({ retryOfRunId: workflowRunId, triggerSource: 'retry', status: 'queued' });
    expect((await admin.client.post(`/workflow-runs/${workflowRunId}/retry`)).status).toBe(409);

    await admin.client.patch(`/integrations/${integration.id}`, { configuration: { scenario: 'healthy' } });
    await runner.drain({ organizationId: org.id, now: new Date(t0.getTime() + 3 * HOUR) });
    const retried = await admin.client.get(`/workflow-runs/${retry.body.id}`);
    expect(retried.body.status).toBe('succeeded');
    expect(retried.body.resultSummary.payload).toEqual({ integrationId: integration.id });
    expect((await admin.client.get(`/workflow-runs/${workflowRunId}`)).body.retries).toEqual([expect.objectContaining({ id: retry.body.id, status: 'succeeded' })]);
    expect((await admin.client.get(`/integrations/${integration.id}`)).body).toMatchObject({ status: 'healthy', stale: false });
    expect((await admin.client.post(`/workflow-runs/${retry.body.id}/retry`)).status).toBe(409);
  });

  it('sends reminders once per state and expires lapsed risk acceptances', async () => {
    const { org, admin } = await setup();
    const evidence = await admin.client.upload('/evidence', { title: 'Firewall review' }, { name: 'fw.pdf', content: PDF });
    await ctx.prisma.evidence.update({ where: { id: evidence.body.id }, data: { expiresAt: new Date(Date.now() + 5 * DAY), ownerId: admin.user.id } });
    const risk = await admin.client.post('/risks', { title: 'Legacy VPN', description: 'd', category: 'Infrastructure', likelihood: 3, impact: 3, riskOwnerId: admin.user.id });
    await ctx.prisma.risk.update({ where: { id: risk.body.id }, data: { status: 'accepted', acceptedBy: admin.user.id, acceptedAt: new Date(Date.now() - 30 * DAY), acceptanceExpiresAt: new Date(Date.now() - DAY) } });

    const defs = (await admin.client.get('/workflows')).body as Array<{ id: string; key: string; version: number }>;
    const byKey = (k: string) => defs.find((d) => d.key === k)!;
    for (let i = 0; i < 2; i++) {
      for (const key of ['evidence_expiry_reminders', 'risk_acceptance_expiry']) expect((await admin.client.post(`/workflows/${byKey(key).id}/run`)).status).toBe(202);
      await runner.drain({ organizationId: org.id });
    }
    expect(await ctx.prisma.notification.count({ where: { recipientUserId: admin.user.id, eventType: 'evidence.expiring' } })).toBe(1);
    expect(await ctx.prisma.notification.count({ where: { recipientUserId: admin.user.id, eventType: 'risk_acceptance.expiring' } })).toBe(1);
    expect((await ctx.prisma.risk.findUniqueOrThrow({ where: { id: risk.body.id } })).status).toBe('assessed');
    expect(await ctx.prisma.auditEvent.count({ where: { organizationId: org.id, action: 'risk.acceptance_expired', entityId: risk.body.id } })).toBe(1);

    // Configuration changes are versioned and audited; disabled workflows cannot be run.
    const def = byKey('evidence_expiry_reminders');
    expect((await admin.client.patch(`/workflows/${def.id}`, { warnDays: 3, version: def.version + 5 })).status).toBe(409);
    const updated = await admin.client.patch(`/workflows/${def.id}`, { warnDays: 3, enabled: false, version: def.version });
    expect(updated.status).toBe(200);
    expect(updated.body.configuration.warnDays).toBe(3);
    expect((await admin.client.post(`/workflows/${def.id}/run`)).status).toBe(409);
    expect((await admin.client.post(`/workflows/${byKey('high_finding_alert').id}/run`)).status).toBe(400);
  });

  it('re-queues runs whose worker died and keeps succeeded steps from re-running', async () => {
    const { org, admin } = await setup();
    const defs = (await admin.client.get('/workflows')).body as Array<{ id: string; key: string }>;
    const def = defs.find((d) => d.key === 'ai_review_due')!;
    const { workflowRunId } = (await admin.client.post(`/workflows/${def.id}/run`)).body;
    const t0 = new Date();
    expect(await runner.claim(t0, org.id)).toBe(workflowRunId);
    // The worker "crashes" here. Before the lease ends nothing happens; after it, the run is re-queued.
    expect(await runner.recoverExpiredLeases(new Date(t0.getTime() + 1000))).toBe(0);
    await runner.drain({ organizationId: org.id, now: new Date(t0.getTime() + LEASE_MS + 1000) });
    const run = await ctx.prisma.workflowRun.findUniqueOrThrow({ where: { id: workflowRunId }, include: { steps: true } });
    expect(run).toMatchObject({ status: 'succeeded', attemptCount: 2 });
    expect(run.steps).toHaveLength(1);
  });

  it('isolates workflows and integrations between organizations and enforces permissions', async () => {
    const a = await setup();
    const b = await setup();
    const contributor = await loginAs(ctx, a.org.id, ['contributor']);
    const integration = await addIdentity(a.admin.client, 'healthy');
    const { workflowRunId } = (await a.admin.client.post(`/integrations/${integration.id}/sync`)).body;
    await runner.drain({ organizationId: a.org.id });

    expect((await contributor.client.get('/workflows')).status).toBe(403);
    expect((await contributor.client.get('/integrations')).status).toBe(403);
    expect((await b.admin.client.get(`/workflow-runs/${workflowRunId}`)).status).toBe(404);
    expect((await b.admin.client.post(`/workflow-runs/${workflowRunId}/retry`)).status).toBe(404);
    expect((await b.admin.client.get(`/integrations/${integration.id}`)).status).toBe(404);
    expect((await b.admin.client.post(`/integrations/${integration.id}/sync`)).status).toBe(404);
    expect((await b.admin.client.get(`/integrations/${integration.id}/records`)).status).toBe(404);
    expect((await b.admin.client.get('/workflow-runs')).body.items.some((r: { id: string }) => r.id === workflowRunId)).toBe(false);

    // Secrets are referenced, never stored; only INTEGRATION_* variables may be referenced.
    expect((await a.admin.client.patch(`/integrations/${integration.id}`, { configurationReference: 'DATABASE_URL' })).status).toBe(400);
    expect((await a.admin.client.patch(`/integrations/${integration.id}`, { configurationReference: 'INTEGRATION_DEMO_TOKEN' })).status).toBe(200);
    expect((await a.admin.client.post('/integrations', { provider: 'demo_identity' })).status).toBe(409);
    expect((await a.admin.client.post('/integrations', { provider: 'unknown_cloud' })).status).toBe(400);
    expect((await b.admin.client.post('/integrations', { provider: 'demo_identity', configuration: { scenario: 'nope' } })).status).toBe(400);
  });
});
