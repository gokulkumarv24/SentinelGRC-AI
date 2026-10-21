import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const systemBody = {
  name: 'Support reply assistant (fictional)',
  description: 'Drafts replies to customer support tickets',
  businessPurpose: 'Reduce first-response time',
  deploymentType: 'third_party_api',
  modelName: 'example-llm',
  modelVersion: '2026-01',
  inputDataCategories: ['support tickets'],
  outputDataCategories: ['draft replies'],
  personalDataProcessed: true,
};

describe('AI governance: inventory, assessments, approvals, incidents, changes, EU AI Act', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  async function setup() {
    const org = await createOrg(ctx.prisma);
    const a = await loginAs(ctx, org.id, ['ai_governance_officer']);
    const b = await loginAs(ctx, org.id, ['ai_governance_officer']);
    const system = await a.client.post('/ai-systems', systemBody);
    const templates = await a.client.get('/questionnaires?purpose=ai_system');
    const template = templates.body.find((t: { key: string }) => t.key === 'ai-system-assessment');
    return { org, a, b, system: system.body, template };
  }

  async function completeAssessment(client: Awaited<ReturnType<typeof loginAs>>['client'], assessmentId: string, unsatisfactoryKeys: string[]) {
    const detail = await client.get(`/ai-assessments/${assessmentId}`);
    const items = detail.body.items.map((i: { id: string; questionKey: string }) =>
      unsatisfactoryKeys.includes(i.questionKey)
        ? { itemId: i.id, response: 'Not yet in place', result: 'unsatisfactory', rationale: 'No documented testing' }
        : { itemId: i.id, response: 'Documented and reviewed', result: 'satisfactory' },
    );
    expect((await client.post(`/ai-assessments/${assessmentId}/items`, { items })).status).toBe(200);
    return detail.body.items as Array<{ id: string; questionKey: string }>;
  }

  it('assesses an AI system, links a shared risk and requires an independent approver', async () => {
    const { org, a, b, system, template } = await setup();
    expect(system.lifecycleStatus).toBe('proposed');
    expect((await a.client.post(`/ai-systems/${system.id}/transition`, { to: 'approved_for_pilot', rationale: 'skip' })).body.error.code).toBe('use_deployment_approval');

    const assessment = await a.client.post(`/ai-systems/${system.id}/assessments`, { templateId: template.id });
    expect(assessment.status).toBe(201);
    expect((await a.client.get(`/ai-systems/${system.id}`)).body.lifecycleStatus).toBe('under_assessment');
    const detail = await a.client.get(`/ai-assessments/${assessment.body.id}`);
    expect(detail.body.items.length).toBe(19);
    expect(new Set(detail.body.items.map((i: { rmfFunction: string }) => i.rmfFunction))).toEqual(new Set(['Govern', 'Map', 'Measure', 'Manage']));

    const firstItem = detail.body.items[0];
    expect((await a.client.post(`/ai-assessments/${assessment.body.id}/items`, { items: [{ itemId: firstItem.id, response: 'x', result: 'unsatisfactory' }] })).status).toBe(422);
    expect((await a.client.post(`/ai-assessments/${assessment.body.id}/submit`, { riskTier: 'limited', rationale: 'x' })).body.error.code).toBe('incomplete');

    await completeAssessment(a.client, assessment.body.id, ['sec.prompt_injection', 'fair.evaluation']);
    expect((await a.client.post(`/ai-assessments/${assessment.body.id}/submit`, { riskTier: 'limited', rationale: 'Customer-facing drafts' })).body.error.code).toBe('residual_risk_required');
    const submitted = await a.client.post(`/ai-assessments/${assessment.body.id}/submit`, { riskTier: 'limited', rationale: 'Customer-facing drafts', residualRiskNotes: 'Prompt-injection testing scheduled; human review of every draft meanwhile' });
    expect(submitted.body).toMatchObject({ status: 'submitted', unsatisfactory: 2 });
    expect(submitted.body.riskId).toBeTruthy();

    const risk = await a.client.get(`/risks/${submitted.body.riskId}`);
    expect(risk.body.links.map((l: { entityType: string }) => l.entityType).sort()).toEqual(['ai_assessment', 'ai_system']);
    expect(await ctx.prisma.finding.count({ where: { organizationId: org.id, sourceType: 'ai_assessment' } })).toBe(2);

    expect((await a.client.post(`/ai-assessments/${assessment.body.id}/decision`, { decision: 'approved', rationale: 'self' })).status).toBe(403);
    const { client: contributor } = await loginAs(ctx, org.id, ['contributor']);
    expect((await contributor.post(`/ai-assessments/${assessment.body.id}/decision`, { decision: 'approved', rationale: 'x' })).status).toBe(403);
    expect((await b.client.post(`/ai-assessments/${assessment.body.id}/decision`, { decision: 'approved', rationale: 'Mitigations adequate for pilot' })).body.decision).toBe('approved');
    expect((await a.client.get(`/ai-systems/${system.id}`)).body.riskTier).toBe('limited');
  });

  it('reuses the provider vendor’s open risk instead of duplicating it', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: vm } = await loginAs(ctx, org.id, ['vendor_manager']);
    const { client: officer } = await loginAs(ctx, org.id, ['ai_governance_officer']);
    const vendor = await vm.post('/vendors', { name: 'Model Provider (fictional)', serviceDescription: 'LLM API', criticality: 'high', dataClassification: 'confidential', accessLevel: 'limited' });
    const vendorRisk = await vm.post('/risks', { title: 'Model provider data exposure', description: 'd', category: 'Third Party', likelihood: 3, impact: 4 });
    await vm.post(`/risks/${vendorRisk.body.id}/links`, { entityType: 'vendor', entityId: vendor.body.id });
    const system = await officer.post('/ai-systems', { ...systemBody, providerVendorId: vendor.body.id });
    const template = (await officer.get('/questionnaires?purpose=ai_system')).body.find((t: { key: string }) => t.key === 'ai-system-assessment');
    const assessment = await officer.post(`/ai-systems/${system.body.id}/assessments`, { templateId: template.id });
    await completeAssessment(officer, assessment.body.id, ['sec.supply_chain']);
    const submitted = await officer.post(`/ai-assessments/${assessment.body.id}/submit`, { riskTier: 'limited', rationale: 'r', residualRiskNotes: 'Provider DPA pending' });
    expect(submitted.body.riskId).toBe(vendorRisk.body.id);
    const risk = await officer.get(`/risks/${vendorRisk.body.id}`);
    expect(risk.body.links.map((l: { entityType: string }) => l.entityType).sort()).toEqual(['ai_assessment', 'ai_system', 'vendor']);
  });

  it('approves deployment only when every §10.5 precondition holds, by someone other than the requester', async () => {
    const { a, b, system, template } = await setup();
    const assessment = await a.client.post(`/ai-systems/${system.id}/assessments`, { templateId: template.id });
    await completeAssessment(a.client, assessment.body.id, []);
    await a.client.post(`/ai-assessments/${assessment.body.id}/submit`, { riskTier: 'minimal', rationale: 'Internal tool' });
    await b.client.post(`/ai-assessments/${assessment.body.id}/decision`, { decision: 'approved', rationale: 'ok' });

    const notReady = await b.client.post(`/ai-systems/${system.id}/approve-deployment`, { target: 'pilot', rationale: 'go', nextReviewAt: future(90) });
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.details.failing).toEqual(expect.arrayContaining(['evidence_reviewed', 'owners', 'human_oversight', 'rollback_plan']));

    const current = (await a.client.get(`/ai-systems/${system.id}`)).body;
    await a.client.patch(`/ai-systems/${system.id}`, { version: current.version, businessOwnerId: a.user.id, riskOwnerId: b.user.id, humanOversight: 'Agents approve every draft', rollbackPlan: 'Feature flag off; revert to manual replies' });
    const ev = await a.client.upload('/evidence', { title: 'Red-team summary', linkEntityType: 'ai_system', linkEntityId: system.id }, { name: 'redteam.pdf', content: PDF });
    await b.client.post(`/evidence/${ev.body.id}/review`, { decision: 'approved', notes: 'Reviewed' });
    const readiness = await a.client.get(`/ai-systems/${system.id}/readiness`);
    expect(readiness.body.ready).toBe(true);

    expect((await a.client.post(`/ai-systems/${system.id}/approve-deployment`, { target: 'pilot', rationale: 'mine', nextReviewAt: future(90) })).status).toBe(403);
    const approved = await b.client.post(`/ai-systems/${system.id}/approve-deployment`, { target: 'pilot', rationale: 'All checks met', nextReviewAt: future(90) });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ lifecycleStatus: 'approved_for_pilot' });
    expect(approved.body.approvedBy).toBe(b.user.id);
  });

  it('records incidents (high → finding) and enforces root cause before resolution', async () => {
    const { org, a, system } = await setup();
    const incident = await a.client.post(`/ai-systems/${system.id}/incidents`, { title: 'Draft leaked internal note', severity: 'high', description: 'A draft quoted an internal comment', detectedAt: new Date().toISOString() });
    expect(incident.status).toBe(201);
    expect(incident.body.findingId).toBeTruthy();
    expect(await ctx.prisma.finding.count({ where: { organizationId: org.id, sourceType: 'ai_incident' } })).toBe(1);
    expect((await a.client.patch(`/ai-incidents/${incident.body.id}`, { status: 'resolved' })).body.error.code).toBe('root_cause_required');
    expect((await a.client.patch(`/ai-incidents/${incident.body.id}`, { status: 'resolved', rootCause: 'Context window included internal notes' })).status).toBe(200);
    expect((await a.client.patch(`/ai-incidents/${incident.body.id}`, { status: 'closed' })).body.error.code).toBe('lessons_required');
  });

  it('flags model changes for reassessment, queues the change workflow and separates review', async () => {
    const { org, a, b, system } = await setup();
    const change = await a.client.post(`/ai-systems/${system.id}/changes`, { changeType: 'model_version', changeDescription: 'Upgrade to 2026-06 model', newVersion: '2026-06', changeRisk: 'medium' });
    expect(change.status).toBe(201);
    expect(change.body.previousVersion).toBe('2026-01');
    const after = await a.client.get(`/ai-systems/${system.id}`);
    expect(new Date(after.body.nextReviewAt).getTime()).toBeLessThanOrEqual(Date.now());
    const queued = await ctx.prisma.workflowRun.count({ where: { organizationId: org.id, status: 'queued', definition: { key: 'ai_model_change' } } });
    expect(queued).toBe(1);
    expect((await a.client.post(`/ai-model-changes/${change.body.id}/review`, { decision: 'approved', notes: 'self' })).status).toBe(403);
    expect((await b.client.post(`/ai-model-changes/${change.body.id}/review`, { decision: 'approved', notes: 'Evaluated on regression suite' })).status).toBe(200);
    expect((await a.client.get(`/ai-systems/${system.id}`)).body.modelVersion).toBe('2026-06');
  });

  it('stores EU AI Act applicability as preliminary, with a dated obligation schedule', async () => {
    const { a, system } = await setup();
    const res = await a.client.agent.put(`/api/v1/ai-systems/${system.id}/eu-ai-act`).set('X-CSRF-Token', a.client.csrf).send({ organizationRole: 'deployer', preliminaryClassification: 'limited', transparencyObligations: true, legalReviewStatus: 'preliminary', checklist: { interactsWithPeople: true }, rationale: 'Chat-style drafts shown to agents' });
    expect(res.status).toBe(200);
    expect(res.body.notice).toMatch(/Not a legal determination/);
    const schedule = await a.client.get('/ai-systems/eu-ai-act-schedule');
    expect(schedule.body.schedule.checkedAt).toBe('2026-10-21');
    expect(schedule.body.schedule.items.find((i: { key: string }) => i.key === 'high_risk_annex_iii').appliesFrom).toBe('2027-12-02');
  });

  it('requires documented limitations for evaluations and an independent approver', async () => {
    const { a, b, system } = await setup();
    const base = { evaluationType: 'security', methodology: 'Prompt-injection test suite v3', datasetOrMethodDescription: '120 adversarial prompts', version: '3', result: 'pass', metrics: { blocked: 118, total: 120 }, executedAt: new Date().toISOString() };
    expect((await a.client.post(`/ai-systems/${system.id}/evaluations`, base)).status).toBe(422);
    const ev = await a.client.post(`/ai-systems/${system.id}/evaluations`, { ...base, limitations: 'English prompts only' });
    expect(ev.status).toBe(201);
    expect((await a.client.post(`/ai-evaluations/${ev.body.id}/review`, { decision: 'approved', notes: 'self' })).status).toBe(403);
    expect((await b.client.post(`/ai-evaluations/${ev.body.id}/review`, { decision: 'approved', notes: 'Method sound' })).body.approvalStatus).toBe('approved');
  });

  it('isolates AI governance records between organizations', async () => {
    const { a, system, template } = await setup();
    const assessment = await a.client.post(`/ai-systems/${system.id}/assessments`, { templateId: template.id });
    const other = await createOrg(ctx.prisma);
    const { client: outsider } = await loginAs(ctx, other.id, ['ai_governance_officer']);
    const attempts = [
      outsider.get(`/ai-systems/${system.id}`),
      outsider.patch(`/ai-systems/${system.id}`, { version: 1, name: 'pwned' }),
      outsider.post(`/ai-systems/${system.id}/incidents`, { title: 't', severity: 'low', description: 'd', detectedAt: new Date().toISOString() }),
      outsider.get(`/ai-assessments/${assessment.body.id}`),
      outsider.post(`/ai-assessments/${assessment.body.id}/decision`, { decision: 'approved', rationale: 'x' }),
      outsider.post(`/ai-systems/${system.id}/approve-deployment`, { target: 'pilot', rationale: 'x', nextReviewAt: future(30) }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await outsider.get('/ai-systems')).body.total).toBe(0);
  });
});
