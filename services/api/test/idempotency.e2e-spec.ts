import type { Client } from './helpers.js';
import { createOrg, loginAs, startApp, type TestContext } from './helpers.js';

const API = '/api/v1';
const post = (c: Client, path: string, body: object, key?: string) => {
  const req = c.agent.post(`${API}${path}`).set('X-CSRF-Token', c.csrf);
  return (key ? req.set('Idempotency-Key', key) : req).send(body);
};

describe('Idempotency-Key on create/trigger routes', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  const risk = { title: 'Payment gateway outage', description: 'd', category: 'Ops', likelihood: 3, impact: 4 };

  it('replays the first response for a retried request instead of acting twice', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const first = await post(client, '/risks', risk, 'retry-key-0001');
    const retry = await post(client, '/risks', risk, 'retry-key-0001');
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect(await ctx.prisma.risk.count({ where: { organizationId: org.id } })).toBe(1);

    // Without a key, each request acts (the header is optional).
    await post(client, '/risks', risk);
    expect(await ctx.prisma.risk.count({ where: { organizationId: org.id } })).toBe(2);

    // Non-201 routes replay their own status code.
    const report = await post(client, '/reports', { reportType: 'risk_register', format: 'csv' }, 'report-key-0001');
    const again = await post(client, '/reports', { reportType: 'risk_register', format: 'csv' }, 'report-key-0001');
    expect([report.status, again.status]).toEqual([202, 202]);
    expect(again.body.id).toBe(report.body.id);
    expect(await ctx.prisma.reportRun.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('rejects a key reused for a different request and malformed keys', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    expect((await post(client, '/risks', risk, 'reuse-key-0001')).status).toBe(201);
    const other = await post(client, '/risks', { ...risk, title: 'Something else' }, 'reuse-key-0001');
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_key_reused');
    expect((await post(client, '/risks', risk, 'bad key!')).body.error.code).toBe('invalid_idempotency_key');
  });

  it('releases the key when the request fails, so a corrected retry can succeed', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const invalid = await post(client, '/reports', { reportType: 'no_such_report', format: 'csv' }, 'fail-key-0001');
    expect(invalid.status).toBe(400);
    expect(await ctx.prisma.idempotencyKey.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('never shares stored responses between users or organizations', async () => {
    const orgA = await createOrg(ctx.prisma);
    const orgB = await createOrg(ctx.prisma);
    const a1 = await loginAs(ctx, orgA.id, ['grc_manager']);
    const a2 = await loginAs(ctx, orgA.id, ['grc_manager']);
    const b = await loginAs(ctx, orgB.id, ['grc_manager']);
    const first = await post(a1.client, '/risks', risk, 'shared-key-0001');
    const sameOrgOtherUser = await post(a2.client, '/risks', risk, 'shared-key-0001');
    const otherOrg = await post(b.client, '/risks', risk, 'shared-key-0001');
    expect(sameOrgOtherUser.status).toBe(201);
    expect(otherOrg.status).toBe(201);
    expect(new Set([first.body.id, sameOrgOtherUser.body.id, otherOrg.body.id]).size).toBe(3);
    expect(sameOrgOtherUser.headers['idempotent-replayed']).toBeUndefined();
  });
});
