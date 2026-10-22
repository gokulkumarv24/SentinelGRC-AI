import { runWithContext } from '../src/common/request-context.js';
import { FindingsService } from '../src/modules/findings/findings.service.js';
import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('Shared GRC core: risks, findings, remediation, controls, evidence', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  describe('risk register', () => {
    it('scores risks with the versioned policy and records history', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const res = await client.post('/risks', { title: 'Unpatched VPN', description: 'Edge VPN lacks patches', category: 'Vulnerability', likelihood: 4, impact: 5, residualLikelihood: 2, residualImpact: 5, residualRationale: 'VPN only reachable through the patched bastion' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ riskKey: 'RSK-0001', inherentScore: 20, inherentRating: 'critical', residualScore: 10, residualRating: 'high', scoringPolicyVersion: 1 });

      const upd = await client.patch(`/risks/${res.body.id}`, { version: 1, likelihood: 2, rationale: 'Compensating control added' });
      expect(upd.status).toBe(200);
      expect(upd.body.inherentScore).toBe(10);
      const stale = await client.patch(`/risks/${res.body.id}`, { version: 1, title: 'Overwrite' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('version_conflict');

      const detail = await client.get(`/risks/${res.body.id}`);
      expect(detail.body.history).toHaveLength(2);
      expect(detail.body.history[0].previousValues).toMatchObject({ likelihood: 4, inherentScore: 20 });
    });

    it('rejects out-of-range factors and direct acceptance', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      expect((await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 6, impact: 1 })).status).toBe(422);
      const risk = await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 2, impact: 2 });
      const direct = await client.patch(`/risks/${risk.body.id}`, { version: 1, status: 'accepted' });
      expect(direct.status).toBe(400);
      expect(direct.body.error.code).toBe('use_acceptance_workflow');
    });

    it('keeps residual scores consistent: never above inherent, always explained', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const above = await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 2, impact: 2, residualLikelihood: 4, residualImpact: 4, residualRationale: 'x' });
      expect(above.status).toBe(400);
      expect(above.body.error.code).toBe('residual_exceeds_inherent');
      const unexplained = await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 4, impact: 4, residualLikelihood: 2, residualImpact: 2 });
      expect(unexplained.body.error.code).toBe('residual_rationale_required');

      const risk = await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 4, impact: 4, residualLikelihood: 3, residualImpact: 3, residualRationale: 'MFA enforced' });
      expect(risk.status).toBe(201);
      // Lowering inherent below the existing residual is refused; editing other fields keeps working.
      expect((await client.patch(`/risks/${risk.body.id}`, { version: 1, likelihood: 2, impact: 2 })).body.error.code).toBe('residual_exceeds_inherent');
      expect((await client.patch(`/risks/${risk.body.id}`, { version: 1, title: 'Renamed' })).status).toBe(200);
    });

    it('rejects scores that are not real numbers', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      expect((await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: '3', impact: 2 })).status).toBe(422);
      expect((await client.post('/risks', { title: 't', description: 'd', category: 'c', likelihood: 3, impact: true })).status).toBe(422);
    });

    it('lets a risk owner change only the risks assigned to them', async () => {
      const org = await createOrg(ctx.prisma);
      const { client: manager } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: owner, user: ownerUser } = await loginAs(ctx, org.id, ['risk_owner']);
      const mine = await manager.post('/risks', { title: 'Mine', description: 'd', category: 'c', likelihood: 3, impact: 3, riskOwnerId: ownerUser.id });
      const other = await manager.post('/risks', { title: 'Other', description: 'd', category: 'c', likelihood: 3, impact: 3 });

      expect((await owner.patch(`/risks/${mine.body.id}`, { version: 1, treatmentPlan: 'Patch in Q3' })).status).toBe(200);
      const denied = await owner.patch(`/risks/${other.body.id}`, { version: 1, title: 'Hijacked' });
      expect(denied.status).toBe(403);
      expect((await owner.post(`/risks/${other.body.id}/acceptance-requests`, { rationale: 'r', expiryDate: future(30) })).status).toBe(403);
      // Broader roles still manage every risk.
      expect((await manager.patch(`/risks/${other.body.id}`, { version: 1, title: 'Renamed by manager' })).status).toBe(200);
    });

    it('enforces separation of duties and single decision for risk acceptance', async () => {
      const org = await createOrg(ctx.prisma);
      const { client: requester } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: approver } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: owner, user: ownerUser } = await loginAs(ctx, org.id, ['risk_owner']);
      const risk = await requester.post('/risks', { title: 'Legacy app', description: 'EOL framework', category: 'Technology', likelihood: 4, impact: 4, riskOwnerId: ownerUser.id });

      const tooLong = await requester.post(`/risks/${risk.body.id}/acceptance-requests`, { rationale: 'Business need', expiryDate: future(800) });
      expect(tooLong.status).toBe(400);
      const request = await requester.post(`/risks/${risk.body.id}/acceptance-requests`, { rationale: 'Replacement planned Q3', expiryDate: future(90) });
      expect(request.status).toBe(201);

      const self = await requester.post(`/risk-acceptances/${request.body.id}/decision`, { decision: 'approved', rationale: 'ok' });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('separation_of_duties');
      expect((await owner.post(`/risk-acceptances/${request.body.id}/decision`, { decision: 'approved', rationale: 'ok' })).status).toBe(403);

      const approved = await approver.post(`/risk-acceptances/${request.body.id}/decision`, { decision: 'approved', rationale: 'Documented compensating monitoring' });
      expect(approved.status).toBe(200);
      const twice = await approver.post(`/risk-acceptances/${request.body.id}/decision`, { decision: 'rejected', rationale: 'changed mind' });
      expect(twice.status).toBe(409);

      const accepted = await requester.get(`/risks/${risk.body.id}`);
      expect(accepted.body.status).toBe('accepted');
      // A material change invalidates the acceptance
      await requester.patch(`/risks/${risk.body.id}`, { version: accepted.body.version, impact: 5, rationale: 'Scope grew' });
      const after = await requester.get(`/risks/${risk.body.id}`);
      expect(after.body.status).toBe('assessed');
      expect(after.body.acceptances[0].decision).toBe('expired');
    });

    it('links controls and entities only within the organization', async () => {
      const orgA = await createOrg(ctx.prisma);
      const orgB = await createOrg(ctx.prisma);
      const { client: a } = await loginAs(ctx, orgA.id, ['grc_manager']);
      const { client: b } = await loginAs(ctx, orgB.id, ['grc_manager']);
      const risk = await a.post('/risks', { title: 'r', description: 'd', category: 'c', likelihood: 3, impact: 3 });
      const foreignControl = await b.post('/controls', { controlCode: 'B-1', title: 'B control', description: 'x', category: 'Access' });
      const res = await a.agent.put(`/api/v1/risks/${risk.body.id}/controls`).set('X-CSRF-Token', a.csrf).send({ controlId: foreignControl.body.id });
      expect(res.status).toBe(404);
      const ownControl = await a.post('/controls', { controlCode: 'A-1', title: 'A control', description: 'x', category: 'Access' });
      const ok = await a.agent.put(`/api/v1/risks/${risk.body.id}/controls`).set('X-CSRF-Token', a.csrf).send({ controlId: ownControl.body.id, effectivenessRating: 'partially_effective' });
      expect(ok.status).toBe(200);
    });
  });

  describe('findings and remediation', () => {
    it('requires a due date or reason and follows the lifecycle', async () => {
      const org = await createOrg(ctx.prisma);
      const { client: analyst, user: analystUser } = await loginAs(ctx, org.id, ['security_analyst']);
      const { client: manager } = await loginAs(ctx, org.id, ['grc_manager']);
      expect((await analyst.post('/findings', { title: 't', description: 'd', severity: 'low', dueDate: null })).status).toBe(422);

      const finding = await analyst.post('/findings', { title: 'MFA gap', description: 'Admins without MFA', severity: 'high', assignedTo: analystUser.id });
      expect(finding.status).toBe(201);
      expect(finding.body.dueDate).toBeTruthy();

      const invalid = await analyst.post(`/findings/${finding.body.id}/transition`, { toStatus: 'reopened', rationale: 'x' });
      expect(invalid.status).toBe(409);
      expect((await analyst.post(`/findings/${finding.body.id}/transition`, { toStatus: 'triaged', rationale: 'Confirmed' })).status).toBe(200);

      // Analysts cannot close; managers need evidence for high findings
      expect((await analyst.post(`/findings/${finding.body.id}/transition`, { toStatus: 'closed', rationale: 'fixed' })).status).toBe(403);
      const noEvidence = await manager.post(`/findings/${finding.body.id}/transition`, { toStatus: 'closed', rationale: 'fixed' });
      expect(noEvidence.status).toBe(400);
      expect(noEvidence.body.error.code).toBe('closure_evidence_required');

      const evidence = await manager.upload('/evidence', { title: 'MFA enforcement screenshot' }, { name: 'mfa.pdf', content: PDF });
      const closed = await manager.post(`/findings/${finding.body.id}/transition`, { toStatus: 'closed', rationale: 'MFA enforced for all admins', closureEvidenceId: evidence.body.id });
      expect(closed.status).toBe(200);
      expect(closed.body.closedAt).toBeTruthy();
      const detail = await manager.get(`/findings/${finding.body.id}`);
      expect(detail.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(['transition', 'transition', 'created']);
      expect(detail.body.evidence).toHaveLength(1);
    });

    it('prevents the assignee from closing their own high finding', async () => {
      const org = await createOrg(ctx.prisma);
      const { client: manager, user } = await loginAs(ctx, org.id, ['grc_manager']);
      const finding = await manager.post('/findings', { title: 'x', description: 'y', severity: 'critical', assignedTo: user.id });
      const evidence = await manager.upload('/evidence', { title: 'proof' }, { name: 'p.pdf', content: PDF });
      const res = await manager.post(`/findings/${finding.body.id}/transition`, { toStatus: 'closed', rationale: 'done', closureEvidenceId: evidence.body.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('separation_of_duties');
    });

    it('deduplicates automated detections and preserves closed history', async () => {
      const org = await createOrg(ctx.prisma);
      const { user } = await loginAs(ctx, org.id, ['grc_manager']);
      const membership = await ctx.prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
      const findings = ctx.app.get(FindingsService);
      const detect = () =>
        runWithContext({ requestId: 'test', actorType: 'system', membership: { id: membership.id, organizationId: org.id, organizationName: 'x', roleKeys: [], permissions: new Set() } }, () =>
          ctx.prisma.tx((tx) =>
            findings.upsertFromDetection(tx, { organizationId: org.id, deduplicationKey: 'control-test:ctl-1:evidence_expired', title: 'Evidence expired', description: 'Policy evidence expired', sourceType: 'control_test', severity: 'medium' }),
          ),
        );
      const first = await detect();
      const second = await detect();
      const third = await detect();
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(third.finding.id).toBe(first.finding.id);
      const saved = await ctx.prisma.finding.findUniqueOrThrow({ where: { id: first.finding.id } });
      expect(saved.detectionCount).toBe(3);
      expect(await ctx.prisma.finding.count({ where: { organizationId: org.id } })).toBe(1);

      await ctx.prisma.finding.update({ where: { id: first.finding.id }, data: { status: 'closed', closedBy: user.id, closureRationale: 'fixed', closedAt: new Date() } });
      const after = await detect();
      expect(after.created).toBe(true);
      expect(await ctx.prisma.finding.count({ where: { organizationId: org.id } })).toBe(2);
    });

    it('moves findings through remediation and into pending validation', async () => {
      const org = await createOrg(ctx.prisma);
      const { client, user } = await loginAs(ctx, org.id, ['grc_manager']);
      const finding = await client.post('/findings', { title: 'Old TLS', description: 'TLS 1.0 enabled', severity: 'medium' });
      const t1 = await client.post('/remediation-tasks', { findingId: finding.body.id, title: 'Disable TLS 1.0', ownerId: user.id, dueDate: future(14) });
      const t2 = await client.post('/remediation-tasks', { findingId: finding.body.id, title: 'Rescan', ownerId: user.id });
      expect((await client.get(`/findings/${finding.body.id}`)).body.status).toBe('in_remediation');
      expect((await client.post(`/remediation-tasks/${t1.body.id}/complete`, { version: 1, completionNotes: 'Config changed' })).status).toBe(200);
      expect((await client.get(`/findings/${finding.body.id}`)).body.status).toBe('in_remediation');
      await client.post(`/remediation-tasks/${t2.body.id}/complete`, { version: 1, completionNotes: 'Scan clean' });
      expect((await client.get(`/findings/${finding.body.id}`)).body.status).toBe('pending_validation');
      const again = await client.post(`/remediation-tasks/${t2.body.id}/complete`, { version: 2, completionNotes: 'again' });
      expect(again.status).toBe(409);
    });
  });

  describe('controls', () => {
    it('validates applicability, SoA exclusions and owner-assignment permission', async () => {
      const org = await createOrg(ctx.prisma);
      const { client: manager } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: contributor, user: contributorUser } = await loginAs(ctx, org.id, ['contributor']);
      const control = await manager.post('/controls', { controlCode: 'AC-01', title: 'Access reviews', description: 'Quarterly reviews', category: 'Access Control' });
      expect(control.status).toBe(201);
      expect((await manager.post('/controls', { controlCode: 'AC-01', title: 'dup', description: 'x', category: 'y' })).status).toBe(409);

      const na = await manager.patch(`/controls/${control.body.id}/implementation`, { version: 1, status: 'not_applicable' });
      expect(na.body.error.code).toBe('rationale_required');
      const soa = await manager.patch(`/controls/${control.body.id}/implementation`, { version: 1, soaIncluded: false });
      expect(soa.body.error.code).toBe('soa_justification_required');
      const ok = await manager.patch(`/controls/${control.body.id}/implementation`, { version: 1, status: 'implemented', implementationNotes: 'Quarterly via IdP' });
      expect(ok.status).toBe(200);

      expect((await contributor.patch(`/controls/${control.body.id}/implementation`, { version: 2, ownerId: contributorUser.id })).status).toBe(403);
      const detail = await manager.get(`/controls/${control.body.id}`);
      expect(detail.body.implementation.status).toBe('implemented');
      expect(detail.body.history.some((h: { action: string }) => h.action === 'control.status_changed')).toBe(true);
    });
  });

  describe('evidence', () => {
    it('stores files with verified type and checksum, and serves them only via short-lived user-bound links', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: colleague } = await loginAs(ctx, org.id, ['grc_manager']);
      const up = await client.upload('/evidence', { title: 'Access review Q3', classification: 'confidential', expiresAt: future(10) }, { name: '../../etc/passwd.pdf', content: PDF, type: 'text/html' });
      expect(up.status).toBe(201);
      expect(up.body.mediaType).toBe('application/pdf');
      expect(up.body.originalFilename).toBe('passwd.pdf');
      expect(up.body.sha256Checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(up.body.state).toBe('expiring');
      expect(up.body).not.toHaveProperty('storageKey');

      const link = await client.post(`/evidence/${up.body.id}/download-url`, {});
      expect(link.status).toBe(200);
      const file = await client.agent.get(link.body.url).buffer(true);
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toMatch(/^attachment/);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(file.body).equals(PDF)).toBe(true);

      const stolen = await colleague.agent.get(link.body.url);
      expect(stolen.status).toBe(403);
      const tampered = await client.agent.get(link.body.url.replace(/.$/, (c: string) => (c === 'a' ? 'b' : 'a')));
      expect(tampered.status).toBe(403);
      const logs = await ctx.prisma.evidenceAccessLog.count({ where: { evidenceId: up.body.id } });
      expect(logs).toBe(2);
    });

    it('rejects disguised and unsupported files', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
      expect((await client.upload('/evidence', { title: 'x' }, { name: 'report.pdf', content: exe, type: 'application/pdf' })).status).toBe(400);
      const binaryTxt = Buffer.from([0x68, 0x00, 0x69]);
      expect((await client.upload('/evidence', { title: 'x' }, { name: 'notes.txt', content: binaryTxt })).status).toBe(400);
      const html = await client.upload('/evidence', { title: 'x' }, { name: 'page.html', content: '<script>alert(1)</script>' });
      expect(html.status).toBe(400);
      const txt = await client.upload('/evidence', { title: 'Policy excerpt' }, { name: 'policy.txt', content: 'Passwords must be 12+ chars' });
      expect(txt.status).toBe(201);
      expect(txt.body.mediaType).toBe('text/plain');
    });

    it('rejects uploads over the size limit', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const big = Buffer.alloc(26 * 1024 * 1024, 0x41);
      const res = await client.upload('/evidence', { title: 'big' }, { name: 'big.txt', content: big });
      expect(res.status).toBe(413);
    });

    it('requires a reason to reject and validates link targets', async () => {
      const org = await createOrg(ctx.prisma);
      const other = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager']);
      const { client: otherClient } = await loginAs(ctx, other.id, ['grc_manager']);
      const ev = await client.post('/evidence/records', { title: 'Quarterly access review record' });
      expect((await client.post(`/evidence/${ev.body.id}/review`, { decision: 'rejected' })).status).toBe(400);
      expect((await client.post(`/evidence/${ev.body.id}/review`, { decision: 'rejected', notes: 'Wrong quarter' })).body.state).toBe('missing');
      const foreignRisk = await otherClient.post('/risks', { title: 'r', description: 'd', category: 'c', likelihood: 1, impact: 1 });
      const link = await client.post(`/evidence/${ev.body.id}/links`, { entityType: 'risk', entityId: foreignRisk.body.id });
      expect(link.status).toBe(404);
    });
  });

  describe('input hardening', () => {
    it('answers bad input with 4xx errors, never 500', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager', 'vendor_manager']);
      const nul = await client.post('/risks', { title: 'QA \u0000 nul', description: 'd', category: 'c', likelihood: 1, impact: 1 });
      expect(nul.status).toBe(422);
      expect(nul.body.error.details.fields[0].path).toBe('title');

      const huge = await client.post('/risks', { title: 't', description: 'x'.repeat(2_000_000), category: 'c', likelihood: 1, impact: 1 });
      expect(huge.status).toBe(413);
      expect(huge.body.error.code).toBe('payload_too_large');
      expect(huge.body.requestId).toEqual(expect.any(String));

      const vendor = { name: 'Script vendor', serviceDescription: 'd', criticality: 'low', dataClassification: 'internal', accessLevel: 'none' };
      const script = await client.post('/vendors', { ...vendor, website: 'javascript:alert(1)' });
      expect(script.status).toBe(422);
      expect(script.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(['website']);
      expect((await client.post('/vendors', { ...vendor, website: 'https://example.com' })).status).toBe(201);
    });

    it('returns 404, not an empty list, for sub-resources of unknown records', async () => {
      const org = await createOrg(ctx.prisma);
      const { client } = await loginAs(ctx, org.id, ['grc_manager', 'vendor_manager']);
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect((await client.get(`/controls/${unknown}/test-configs`)).status).toBe(404);
      expect((await client.get(`/vendors/${unknown}/assessments`)).status).toBe(404);
    });
  });

  describe('tenant isolation for every core entity', () => {
    it('blocks reading, updating and acting on another organization’s records by id', async () => {
      const orgA = await createOrg(ctx.prisma);
      const orgB = await createOrg(ctx.prisma);
      const { client: a, user: aUser } = await loginAs(ctx, orgA.id, ['grc_manager']);
      const { client: b } = await loginAs(ctx, orgB.id, ['org_admin', 'grc_manager']);

      const risk = await a.post('/risks', { title: 'A secret risk', description: 'd', category: 'c', likelihood: 3, impact: 3 });
      const finding = await a.post('/findings', { title: 'A finding', description: 'd', severity: 'low' });
      const task = await a.post('/remediation-tasks', { title: 'A task', ownerId: aUser.id });
      const control = await a.post('/controls', { controlCode: 'A-SECRET', title: 't', description: 'd', category: 'c' });
      const evidence = await a.upload('/evidence', { title: 'A evidence' }, { name: 'a.pdf', content: PDF });

      const attempts = [
        b.get(`/risks/${risk.body.id}`),
        b.patch(`/risks/${risk.body.id}`, { version: 1, title: 'pwned' }),
        b.post(`/risks/${risk.body.id}/acceptance-requests`, { rationale: 'x', expiryDate: future(30) }),
        b.get(`/findings/${finding.body.id}`),
        b.post(`/findings/${finding.body.id}/transition`, { toStatus: 'triaged', rationale: 'x' }),
        b.get(`/remediation-tasks/${task.body.id}`),
        b.post(`/remediation-tasks/${task.body.id}/complete`, { version: 1, completionNotes: 'x' }),
        b.get(`/controls/${control.body.id}`),
        b.patch(`/controls/${control.body.id}/implementation`, { version: 1, status: 'implemented' }),
        b.get(`/evidence/${evidence.body.id}`),
        b.post(`/evidence/${evidence.body.id}/download-url`, {}),
        b.post(`/evidence/${evidence.body.id}/review`, { decision: 'approved' }),
        b.post(`/evidence/${evidence.body.id}/links`, { entityType: 'risk', entityId: risk.body.id }),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

      for (const path of ['/risks', '/findings', '/remediation-tasks', '/controls', '/evidence']) {
        const list = await b.get(`${path}?pageSize=100`);
        expect(list.body.total).toBe(0);
      }
      const unchanged = await ctx.prisma.risk.findUniqueOrThrow({ where: { id: risk.body.id } });
      expect(unchanged.title).toBe('A secret risk');
    });
  });
});
