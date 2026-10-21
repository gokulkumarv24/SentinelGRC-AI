import request from 'supertest';
import { Client, createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const vendorBody = {
  name: 'Acme Cloud (fictional)',
  serviceDescription: 'Hosted CRM',
  criticality: 'high',
  dataClassification: 'confidential',
  personalDataAccess: true,
  accessLevel: 'privileged',
  businessDependency: 4,
  serviceImpact: 4,
  dataTypes: ['customer contact data'],
  regions: ['EU/EEA'],
};

interface Question {
  id: string;
  questionKey: string;
  responseType: string;
  visible: boolean;
}

/** Answers that pass most criteria but fail MFA and breach notification, with AI follow-ups. */
function answersFor(questions: Question[], evidenceId?: string) {
  const by = (k: string) => questions.find((q) => q.questionKey === k)!.id;
  const today = new Date().toISOString().slice(0, 10);
  return [
    { questionId: by('gov.policy'), answer: true, evidenceId },
    { questionId: by('gov.certification'), answer: ['ISO/IEC 27001'] },
    { questionId: by('gov.certification_report'), answer: 'see attached', evidenceId },
    { questionId: by('iam.mfa'), answer: false },
    { questionId: by('iam.reviews'), answer: 'Quarterly' },
    { questionId: by('enc.at_rest'), answer: true },
    { questionId: by('enc.in_transit'), answer: true },
    { questionId: by('vuln.pentest_date'), answer: today },
    { questionId: by('vuln.critical_sla'), answer: 14 },
    { questionId: by('ir.plan'), answer: true },
    { questionId: by('ir.notify_hours'), answer: 96 },
    { questionId: by('bc.backup_test'), answer: true },
    { questionId: by('priv.dpa'), answer: true },
    { questionId: by('sub.list'), answer: false },
    { questionId: by('loc.regions'), answer: ['EU/EEA'] },
    { questionId: by('dev.sdlc'), answer: 'Peer review, SCA and DAST in CI' },
    { questionId: by('ai.usage'), answer: true },
    { questionId: by('ai.training'), answer: true },
  ];
}

describe('Third-party risk: vendors, questionnaires, scoring, decisions and portal', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  async function setup(profile: Partial<typeof vendorBody> = {}) {
    const org = await createOrg(ctx.prisma);
    const { client: vm, user: vmUser } = await loginAs(ctx, org.id, ['vendor_manager']);
    const { client: approver } = await loginAs(ctx, org.id, ['vendor_manager']);
    const vendor = await vm.post('/vendors', { ...vendorBody, ...profile, businessOwnerId: vmUser.id });
    const templates = await vm.get('/questionnaires');
    const template = templates.body.find((t: { key: string }) => t.key === 'vendor-security');
    const assessment = await vm.post(`/vendors/${vendor.body.id}/assessments`, { templateId: template.id });
    const detail = await vm.get(`/assessments/${assessment.body.id}`);
    return { org, vm, vmUser, approver, vendor: vendor.body, assessment: assessment.body, questions: detail.body.questions as Question[] };
  }

  it('creates vendors with an explainable inherent score and restricts contacts', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: vm } = await loginAs(ctx, org.id, ['vendor_manager']);
    const { client: auditor } = await loginAs(ctx, org.id, ['auditor']);
    const vendor = await vm.post('/vendors', vendorBody);
    expect(vendor.status).toBe(201);
    expect(vendor.body.inherentRiskScore).toBeGreaterThan(60);
    await vm.post(`/vendors/${vendor.body.id}/contacts`, { name: 'Pat Example', email: 'pat@acme.example', contactType: 'security' });
    const full = await vm.get(`/vendors/${vendor.body.id}`);
    expect(full.body.contacts).toHaveLength(1);
    expect(full.body.inherent.breakdown).toHaveLength(5);
    const restricted = await auditor.get(`/vendors/${vendor.body.id}`);
    expect(restricted.body.contacts).toBeNull();
    expect((await vm.post('/vendors', vendorBody)).status).toBe(409);
    const approve = await vm.post(`/vendors/${vendor.body.id}/transition`, { to: 'approved', rationale: 'skip' });
    expect(approve.body.error.code).toBe('use_assessment_decision');
  });

  it('validates answers, requires completion, then scores, decides and creates traceable findings and risk', async () => {
    // Critical vendor with administrative access: inherent 93; with these answers residual lands in the high tier.
    const { org, vm, approver, vendor, assessment, questions } = await setup({ criticality: 'critical', accessLevel: 'administrative' });
    const by = (k: string) => questions.find((q) => q.questionKey === k)!.id;
    expect(questions.find((q) => q.questionKey === 'sub.flowdown')!.visible).toBe(false);

    const invalid = await vm.post(`/assessments/${assessment.id}/responses`, { responses: [{ questionId: by('iam.mfa'), answer: 'yes' }, { questionId: by('bc.rto'), notApplicable: true }] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.answers).toHaveLength(2);
    expect((await vm.post(`/assessments/${assessment.id}/submit`)).body.error.code).toBe('incomplete');

    const ev = await vm.upload('/evidence', { title: 'Acme ISO certificate' }, { name: 'cert.pdf', content: PDF });
    expect((await vm.post(`/assessments/${assessment.id}/responses`, { responses: answersFor(questions, ev.body.id) })).status).toBe(200);
    const submitted = await vm.post(`/assessments/${assessment.id}/submit`);
    expect(submitted.body.status).toBe('submitted');
    expect((await vm.get(`/vendors/${vendor.id}`)).body.status).toBe('under_review');
    expect((await vm.post(`/assessments/${assessment.id}/responses`, { responses: [{ questionId: by('iam.mfa'), answer: true }] })).status).toBe(409);

    expect((await approver.post(`/assessments/${assessment.id}/decision`, { decision: 'approved', rationale: 'x' })).body.error.code).toBe('review_incomplete');
    const visible = (await vm.get(`/assessments/${assessment.id}`)).body.questions.filter((q: Question & { response: unknown }) => q.visible && q.response);
    const reviews = visible.map((q: Question) => ({ questionId: q.id, reviewerStatus: 'accepted', reviewerNotes: q.questionKey === 'iam.mfa' ? 'Internal: confirmed with vendor CISO' : null }));
    expect((await approver.post(`/assessments/${assessment.id}/review`, { reviews })).status).toBe(200);

    const preview = await vm.get(`/assessments/${assessment.id}`);
    expect(['high', 'critical']).toContain(preview.body.scorePreview.tier);
    expect((await approver.post(`/assessments/${assessment.id}/decision`, { decision: 'approved', rationale: 'ok' })).body.error.code).toBe('conditions_required');
    expect((await vm.post(`/assessments/${assessment.id}/decision`, { decision: 'approved_with_conditions', rationale: 'self' })).status).toBe(403);

    const decision = await approver.post(`/assessments/${assessment.id}/decision`, { decision: 'approved_with_conditions', rationale: 'Approved on condition MFA is enforced within 30 days' });
    expect(decision.status).toBe(200);
    // iam.mfa + ir.notify_hours not met (important → high); vuln.pentest_date + ir.plan lack required evidence (low).
    // Optional unanswered questions earn no credit but raise no findings.
    expect(decision.body.findingsCreated).toBe(4);
    expect(decision.body.tier).toBe('high');
    expect(decision.body.riskId).toBeTruthy();

    const v = (await vm.get(`/vendors/${vendor.id}`)).body;
    expect(v).toMatchObject({ status: 'approved_with_conditions', riskTier: decision.body.tier, residualRiskScore: decision.body.residualScore });
    expect(v.riskHistory.length).toBe(2);
    expect(v.findings.map((f: { severity: string }) => f.severity).sort()).toEqual(['high', 'high', 'low', 'low']);
    expect(v.risks[0].id).toBe(decision.body.riskId);

    // Traceability: finding → risk → vendor + assessment; risk can be linked to a control (demo step 5)
    const finding = await ctx.prisma.finding.findFirstOrThrow({ where: { organizationId: org.id, deduplicationKey: `vendor:${vendor.id}:iam.mfa` } });
    expect(finding.riskId).toBe(decision.body.riskId);
    const risk = await vm.get(`/risks/${decision.body.riskId}`);
    expect(risk.body.links.map((l: { entityType: string }) => l.entityType).sort()).toEqual(['vendor', 'vendor_assessment']);
    expect(risk.body.findings.length).toBe(4);
    const a = (await vm.get(`/assessments/${assessment.id}`)).body;
    expect(a.scoreBreakdown.assumptions.length).toBeGreaterThan(0);
    expect(a.reportStatus).toBe('final');
  });

  it('triggers reassessment on material changes after approval and blocks parallel assessments', async () => {
    const { vm, approver, vendor, assessment, questions } = await setup();
    expect((await vm.post(`/vendors/${vendor.id}/assessments`, { templateId: assessment.templateId })).status).toBe(409);
    await vm.post(`/assessments/${assessment.id}/responses`, { responses: answersFor(questions).map((r) => (r.questionId === questions.find((q) => q.questionKey === 'iam.mfa')!.id ? { ...r, answer: true } : r)) });
    await vm.post(`/assessments/${assessment.id}/submit`);
    const visible = (await vm.get(`/assessments/${assessment.id}`)).body.questions.filter((q: Question & { response: unknown }) => q.visible && q.response);
    await approver.post(`/assessments/${assessment.id}/review`, { reviews: visible.map((q: Question) => ({ questionId: q.id, reviewerStatus: 'accepted' })) });
    await approver.post(`/assessments/${assessment.id}/decision`, { decision: 'approved_with_conditions', rationale: 'ok' });
    const current = (await vm.get(`/vendors/${vendor.id}`)).body;
    const changed = await vm.patch(`/vendors/${vendor.id}`, { version: current.version, accessLevel: 'administrative', rationale: 'Now has admin access' });
    expect(changed.body.status).toBe('assessment_required');
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { action: 'vendor.material_change', entityId: vendor.id } });
    expect(audit).toBeTruthy();
  });

  it('lets a respondent answer only their assessment through the portal, without internal data', async () => {
    const { org, vm, approver, assessment, questions } = await setup();
    const invite = await vm.post(`/assessments/${assessment.id}/invitations`, { contactEmail: 'Security@Acme.example' });
    expect(invite.status).toBe(201);
    const token = String(invite.body.portalUrl).split('/vendor-portal/')[1];
    const portal = request(ctx.app.getHttpServer());

    await approver.post(`/assessments/${assessment.id}/responses`, { responses: [{ questionId: questions[0].id, answer: true }] });
    await approver.agent.put(`/api/v1/assessments/${assessment.id}/internal-notes`).set('X-CSRF-Token', approver.csrf).send({ internalNotes: 'SECRET internal concern' });

    const view = await portal.get(`/api/v1/vendor-portal/${token}`);
    expect(view.status).toBe(200);
    const body = JSON.stringify(view.body);
    for (const forbidden of ['reviewerNotes', 'reviewerStatus', 'internalNotes', 'SECRET', 'residual', 'scoreBreakdown', 'riskTier', 'expectedAnswer', 'weight']) expect(body).not.toContain(forbidden);
    expect(view.body.questions.length).toBe(questions.length);

    const upload = await portal.post(`/api/v1/vendor-portal/${token}/evidence`).field('title', 'Pentest summary').attach('file', PDF, { filename: 'pentest.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const save = await portal.put(`/api/v1/vendor-portal/${token}/responses`).send({ responses: answersFor(questions, upload.body.id) });
    expect(save.status).toBe(200);

    // A respondent cannot attach internal evidence by guessing its id
    const internal = await vm.upload('/evidence', { title: 'internal doc' }, { name: 'i.pdf', content: PDF });
    const sneaky = await portal.put(`/api/v1/vendor-portal/${token}/responses`).send({ responses: [{ questionId: questions[0].id, answer: true, evidenceId: internal.body.id }] });
    expect(sneaky.status).toBe(404);

    expect((await portal.post(`/api/v1/vendor-portal/${token}/submit`)).body.status).toBe('submitted');
    const resp = await ctx.prisma.questionResponse.findFirstOrThrow({ where: { assessmentId: assessment.id, questionId: questions.find((q) => q.questionKey === 'iam.mfa')!.id } });
    expect(resp.answeredBy).toBe(`vendor:${invite.body.invitationId}`);
    const auditEvent = await ctx.prisma.auditEvent.findFirst({ where: { organizationId: org.id, action: 'vendor_portal.answers_saved' } });
    expect(auditEvent?.actorType).toBe('vendor_respondent');

    // Once submitted the respondent can no longer change answers
    expect((await portal.put(`/api/v1/vendor-portal/${token}/responses`).send({ responses: [{ questionId: questions[0].id, answer: false }] })).status).toBe(409);
  });

  it('rejects revoked, expired and unknown portal links', async () => {
    const { vm, assessment } = await setup();
    const portal = request(ctx.app.getHttpServer());
    const a = await vm.post(`/assessments/${assessment.id}/invitations`, { contactEmail: 'a@acme.example' });
    const tokenA = String(a.body.portalUrl).split('/vendor-portal/')[1];
    await vm.delete(`/assessments/${assessment.id}/invitations/${a.body.invitationId}`);
    expect((await portal.get(`/api/v1/vendor-portal/${tokenA}`)).status).toBe(401);

    const b = await vm.post(`/assessments/${assessment.id}/invitations`, { contactEmail: 'b@acme.example' });
    await ctx.prisma.vendorPortalInvitation.update({ where: { id: b.body.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await portal.get(`/api/v1/vendor-portal/${String(b.body.portalUrl).split('/vendor-portal/')[1]}`)).status).toBe(401);
    expect((await portal.get('/api/v1/vendor-portal/not-a-real-token')).status).toBe(401);
  });

  it('isolates vendors and assessments between organizations', async () => {
    const { vm, vendor, assessment } = await setup();
    const other = await createOrg(ctx.prisma);
    const { client: outsider } = await loginAs(ctx, other.id, ['vendor_manager']);
    const attempts = [
      outsider.get(`/vendors/${vendor.id}`),
      outsider.patch(`/vendors/${vendor.id}`, { version: 1, name: 'pwned' }),
      outsider.get(`/assessments/${assessment.id}`),
      outsider.post(`/assessments/${assessment.id}/responses`, { responses: [{ questionId: assessment.templateId, answer: true }] }),
      outsider.post(`/assessments/${assessment.id}/invitations`, { contactEmail: 'x@y.example' }),
      outsider.post(`/vendors/${vendor.id}/assessments`, { templateId: assessment.templateId }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await outsider.get('/vendors')).body.total).toBe(0);
    expect((await outsider.get('/assessments')).body.total).toBe(0);
    expect((await vm.get('/vendors')).body.total).toBe(1);
    void Client;
  });
});
