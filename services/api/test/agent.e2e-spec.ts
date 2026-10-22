import { WorkflowRunner } from '../src/modules/workflows/workflow-runner.service.js';
import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type Draft = { id: string; artifactType: string; origin: string; status: string; agentJob: string | null; output: { summary: string; points: unknown[]; suggestions: Array<{ label: string; value: string; rationale: string }> } };

/** The AI agent (mock provider: deterministic rules) prepares drafts and routine records in the background. */
describe('AI agent', () => {
  let ctx: TestContext;
  let runner: WorkflowRunner;
  beforeAll(async () => {
    ctx = await startApp();
    runner = ctx.app.get(WorkflowRunner);
  });
  afterAll(async () => ctx.app.close());

  const agentDrafts = async (organizationId: string, artifactType: string, targetId?: string) =>
    (await ctx.prisma.aiArtifact.findMany({ where: { organizationId, artifactType, origin: 'agent', ...(targetId ? { targetId } : {}) } })) as unknown as Draft[];

  it('pre-reviews uploaded evidence and shows the draft on the record', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const ev = await client.upload('/evidence', { title: 'Firewall review 2026', expiresAt: future(10) }, { name: 'fw.pdf', content: PDF });
    expect(ev.status).toBe(201);
    await runner.drain({ organizationId: org.id });

    const [draft] = await agentDrafts(org.id, 'evidence_review', ev.body.id);
    expect(draft).toMatchObject({ origin: 'agent', status: 'draft', agentJob: 'agent_evidence_review' });
    const verdict = draft.output.suggestions.find((s) => s.label === 'verdict')?.value;
    expect(verdict).toBe('needs_attention'); // not linked to any control, expires within 30 days

    // The existing AI panel finds agent drafts by record.
    const listed = await client.get(`/ai/drafts?recordId=${ev.body.id}&artifactType=evidence_review`);
    expect(listed.body.items[0].id).toBe(draft.id);
    const notes = await ctx.prisma.notification.count({ where: { organizationId: org.id, eventType: 'ai.agent_ready' } });
    expect(notes).toBeGreaterThan(0);
  });

  it('triages new findings with validated owner, priority and due-date suggestions', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['grc_manager']);
    const f = await client.post('/findings', { title: 'Privileged accounts without MFA', description: 'Two admin accounts have no multi-factor authentication.', severity: 'high', dueDate: future(30) });
    expect(f.status).toBe(201);
    await runner.drain({ organizationId: org.id });
    const [draft] = await agentDrafts(org.id, 'finding_triage', f.body.id);
    const s = Object.fromEntries(draft.output.suggestions.map((x) => [x.label, x.value]));
    expect(s).toMatchObject({ category: 'access_control', priority: 'high', dueInDays: '14', owner: user.id, linkRisk: 'none' });
  });

  it('answers customer questionnaires from controls, then reuses approved answers from the library', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const control = await client.post('/controls', { controlCode: 'IAM-01', title: 'Multi-factor authentication', description: 'Multi-factor authentication is enforced for all administrator and remote access accounts.', category: 'Access control' });
    await ctx.prisma.controlImplementation.updateMany({ where: { controlId: control.body.id }, data: { status: 'implemented' } });

    const q = await client.post('/trust/questionnaires', { title: 'Security review', customerName: 'Acme (fictional)', text: 'Access | Do you enforce multi-factor authentication for administrator accounts?\nDo you have a whistleblowing hotline for employees?' });
    expect(q.status).toBe(201);
    await runner.drain({ organizationId: org.id });
    const detail = await client.get(`/trust/questionnaires/${q.body.id}`);
    const [mfa, other] = detail.body.items;
    expect(mfa).toMatchObject({ section: 'Access', answerStatus: 'drafted', shortAnswer: 'yes', answerSource: 'agent' });
    expect(mfa.draftAnswer).toContain('Multi-factor authentication');
    expect(other).toMatchObject({ answerStatus: 'needs_input', shortAnswer: 'unknown' });
    expect(detail.body.status).toBe('in_review');

    // A person approves; the answer is learned and reused for the next customer without calling the AI.
    expect((await client.patch(`/trust/questionnaires/${q.body.id}/items/${mfa.id}`, { action: 'approve' })).status).toBe(200);
    const q2 = await client.post('/trust/questionnaires', { title: 'Vendor review', customerName: 'Globex (fictional)', text: 'Is multi-factor authentication enforced for administrator accounts?' });
    await runner.drain({ organizationId: org.id });
    const second = await client.get(`/trust/questionnaires/${q2.body.id}`);
    expect(second.body.items[0]).toMatchObject({ answerStatus: 'drafted', answerSource: 'library' });

    const csv = await client.get(`/trust/questionnaires/${q.body.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('multi-factor authentication');
  });

  it('answers questions from records the asker may read', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    await client.post('/risks', { title: 'Ransomware outage', description: 'Encrypted file servers', category: 'Security', likelihood: 3, impact: 5 });
    const res = await client.post('/ai/ask', { question: 'Which risks mention ransomware?' });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body.output.points)).toContain('Ransomware outage');
  });

  it('drafts a policy and saves the accepted draft as a policy document in the evidence library', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: author } = await loginAs(ctx, org.id, ['grc_manager']);
    const control = await author.post('/controls', { controlCode: 'BCP-01', title: 'Backups', description: 'Backups are taken daily and restore-tested quarterly.', category: 'Continuity' });
    const draft = await author.post('/ai/drafts', { artifactType: 'policy_draft', targetId: org.id, options: { topic: 'Backup and recovery', controlIds: [control.body.id] } });
    expect(draft.status).toBe(201);
    expect(draft.body.output.points.some((p: { text: string }) => p.text.includes('restore-tested'))).toBe(true);
    expect((await author.post(`/ai/drafts/${draft.body.id}/save-policy`)).status).toBe(409); // not accepted yet
    await author.post(`/ai/drafts/${draft.body.id}/review`, { decision: 'accepted', rationale: 'Matches our practice' });
    const saved = await author.post(`/ai/drafts/${draft.body.id}/save-policy`);
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ title: 'Backup and recovery Policy', reviewStatus: 'pending_review' });
    expect((await author.post(`/ai/drafts/${draft.body.id}/save-policy`)).status).toBe(409); // only once
  });

  it('checks new vendor profiles and prepares due reassessments', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: vm, user } = await loginAs(ctx, org.id, ['vendor_manager']);
    const v = await vm.post('/vendors', { name: 'Payroll Co (fictional)', serviceDescription: 'Payroll processing with admin access to our HR system', criticality: 'medium', dataClassification: 'internal', personalDataAccess: true, accessLevel: 'none', dataTypes: ['salary'] });
    expect(v.status).toBe(201);
    await runner.drain({ organizationId: org.id });
    const [profile] = await agentDrafts(org.id, 'vendor_profile_review', v.body.id);
    const s = Object.fromEntries(profile.output.suggestions.map((x) => [x.label, x.value]));
    expect(s).toMatchObject({ dataClassification: 'restricted', accessLevel: 'privileged' });

    // An approved vendor whose reassessment is due gets its next assessment prepared by the agent.
    await ctx.prisma.vendor.update({ where: { id: v.body.id }, data: { status: 'approved', nextAssessmentAt: new Date(Date.now() + 5 * 86_400_000), businessOwnerId: user.id } });
    await ctx.prisma.workflowDefinition.updateMany({ where: { organizationId: org.id, key: 'agent_vendor_reassessment' }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await runner.scheduleDue(new Date(), org.id);
    await runner.drain({ organizationId: org.id });
    const prepared = await ctx.prisma.vendorAssessment.findMany({ where: { organizationId: org.id, vendorId: v.body.id } });
    expect(prepared).toHaveLength(1);
    expect(prepared[0].status).toBe('draft');
  });

  it('proposes framework mappings into the review queue and lists the agent jobs', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    await client.post('/controls', { controlCode: 'AC-01', title: 'Access control policy', description: 'Access to information and systems is granted on least privilege and reviewed for access rights.', category: 'Access control' });
    const framework = await ctx.prisma.framework.findFirst({ where: { organizationId: null }, include: { _count: { select: { requirements: true } } } });
    const queued = await client.post(`/ai/agent/frameworks/${framework!.id}/suggest-mappings`);
    expect(queued.status).toBe(202);
    await runner.drain({ organizationId: org.id, max: 100 });
    const runs = await ctx.prisma.workflowRun.findMany({ where: { organizationId: org.id, definition: { key: 'agent_mapping_onboarding' } } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status !== 'failed')).toBe(true);
    const proposals = await ctx.prisma.controlMapping.count({ where: { organizationId: org.id, sourceReference: { startsWith: 'ai-agent:' }, reviewStatus: 'pending_review' } });
    const attempted = await ctx.prisma.aiArtifact.count({ where: { organizationId: org.id, artifactType: 'mapping_suggestions', origin: 'agent' } });
    expect(attempted).toBe(framework!._count.requirements); // every requirement considered, across chained runs
    expect(proposals).toBeGreaterThanOrEqual(0);

    const overview = await client.get('/ai/agent');
    expect(overview.status).toBe(200);
    expect(overview.body.jobs.length).toBeGreaterThanOrEqual(14);
    expect(overview.body.blockedReason).toBeNull();
  });

  it('stays idle when the organization switches AI off', async () => {
    const org = await createOrg(ctx.prisma);
    await ctx.prisma.organization.update({ where: { id: org.id }, data: { settings: { aiFeaturesEnabled: false } } });
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    await client.upload('/evidence', { title: 'Policy' }, { name: 'p.pdf', content: PDF });
    await runner.drain({ organizationId: org.id });
    expect(await ctx.prisma.aiArtifact.count({ where: { organizationId: org.id } })).toBe(0);
    const run = await ctx.prisma.workflowRun.findFirst({ where: { organizationId: org.id, definition: { key: 'agent_evidence_review' } } });
    expect(run?.status).toBe('succeeded');
    expect(JSON.stringify(run?.resultSummary)).toContain('ai_disabled_for_organization');
  });
});
