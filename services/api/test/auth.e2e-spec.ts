import { Client, createOrg, createUser, loginAs, PASSWORD, startApp, type TestContext } from './helpers.js';

describe('Authentication and sessions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  it('logs in with valid credentials, sets HttpOnly session and CSRF cookies, and returns /users/me', async () => {
    const org = await createOrg(ctx.prisma);
    const user = await createUser(ctx.prisma, { organizationId: org.id, roles: ['grc_manager'] });
    const client = new Client(ctx.app);
    const res = await client.login(user.email);
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    const session = cookies.find((c) => c.startsWith('sg_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('sg_csrf='))).not.toMatch(/HttpOnly/i);

    const me = await client.get('/users/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
    expect(me.body.activeOrganizationId).toBe(org.id);
    expect(me.body.permissions).toContain('risk.acceptance.decide');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('stores only a hash of the session token', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['auditor']);
    const raw = client.agent.jar.getCookie('sg_session', { path: '/', domain: '127.0.0.1', secure: false, script: false } as never)?.value;
    const sessions = await ctx.prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    if (raw) expect(sessions[0].tokenHash).not.toBe(raw);
    expect(sessions[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the same generic error for unknown users and wrong passwords, and audits both', async () => {
    const user = await createUser(ctx.prisma);
    const a = await new Client(ctx.app).login(user.email, 'wrong-password-123');
    const b = await new Client(ctx.app).login('nobody-here@example.test', 'wrong-password-123');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
    const failures = await ctx.prisma.auditEvent.count({ where: { action: 'auth.login_failed', entityId: user.id } });
    expect(failures).toBe(1);
  });

  it('locks the account after 10 failed attempts', async () => {
    const user = await createUser(ctx.prisma);
    for (let i = 0; i < 10; i++) await new Client(ctx.app).login(user.email, 'bad-password-xyz');
    const res = await new Client(ctx.app).login(user.email, PASSWORD);
    expect(res.status).toBe(401);
    const saved = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects requests without a session', async () => {
    const res = await new Client(ctx.app).get('/members');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
    expect(res.body.requestId).toBeTruthy();
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['org_admin']);
    const res = await client.agent.post('/api/v1/members/invitations').send({ email: 'x@example.test', roles: ['auditor'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
    const forged = await client.agent
      .post('/api/v1/members/invitations')
      .set('X-CSRF-Token', 'forged-token-value')
      .send({ email: 'x@example.test', roles: ['auditor'] });
    expect(forged.status).toBe(403);
  });

  it('rejects state-changing requests from a foreign origin', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['org_admin']);
    const res = await client.agent
      .post('/api/v1/members/invitations')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', client.csrf)
      .send({ email: 'x@example.test', roles: ['auditor'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('origin_not_allowed');
  });

  it('invalidates the session on logout', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['auditor']);
    expect((await client.post('/auth/logout')).status).toBe(200);
    expect((await client.get('/users/me')).status).toBe(401);
  });

  it('expires sessions after the idle timeout and after the absolute lifetime', async () => {
    const org = await createOrg(ctx.prisma);
    const idle = await loginAs(ctx, org.id, ['auditor']);
    await ctx.prisma.session.updateMany({ where: { userId: idle.user.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await idle.client.get('/users/me');
    expect(expired.status).toBe(401);
    // The stale cookies are removed so the web app cannot loop between /login and the workspace.
    const cleared = ([] as string[]).concat(expired.headers['set-cookie'] ?? []);
    expect(cleared.some((c) => /^sg_session=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);
    expect(cleared.some((c) => /^sg_csrf=;/.test(c))).toBe(true);

    const absolute = await loginAs(ctx, org.id, ['auditor']);
    await ctx.prisma.session.updateMany({
      where: { userId: absolute.user.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 100_000) },
    });
    expect((await absolute.client.get('/users/me')).status).toBe(401);
  });

  it('forces a password change before granting organization permissions, then revokes other sessions', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['grc_manager']);
    await ctx.prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    const other = new Client(ctx.app);
    await other.login(user.email);

    const blocked = await client.get('/members');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('password_change_required');

    const weak = await client.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const changed = await client.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'A-much-better-passphrase-42' });
    expect(changed.status).toBe(200);
    expect((await client.get('/members')).status).toBe(200);
    expect((await other.get('/users/me')).status).toBe(401);
  });

  it('switches only to organizations the user belongs to', async () => {
    const orgA = await createOrg(ctx.prisma);
    const orgB = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, orgA.id, ['auditor']);
    const res = await client.post('/auth/switch-organization', { organizationId: orgB.id });
    expect(res.status).toBe(404);
  });

  it('accepts an invitation exactly once', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: admin } = await loginAs(ctx, org.id, ['org_admin']);
    const invite = await admin.post('/members/invitations', { email: 'New.Person@Example.test', roles: ['security_analyst'] });
    expect(invite.status).toBe(201);
    const token = String(invite.body.acceptUrl).split('/invite/')[1];

    const preview = await new Client(ctx.app).get(`/invitations/${token}`);
    expect(preview.body.email).toBe('new.person@example.test');
    const accept = await new Client(ctx.app).post(`/invitations/${token}/accept`, { displayName: 'New Person', password: 'Welcome-to-sentinel-7' });
    expect(accept.status).toBe(200);
    const again = await new Client(ctx.app).post(`/invitations/${token}/accept`, { displayName: 'New Person', password: 'Welcome-to-sentinel-7' });
    expect(again.status).toBe(410);

    const joined = new Client(ctx.app);
    expect((await joined.login('new.person@example.test', 'Welcome-to-sentinel-7')).status).toBe(200);
    const me = await joined.get('/users/me');
    expect(me.body.roles).toEqual(['security_analyst']);
  });

  it('exposes health and readiness without internal details', async () => {
    const health = await new Client(ctx.app).get('/health');
    const ready = await new Client(ctx.app).get('/ready');
    expect(health.body).toEqual({ status: 'ok' });
    expect(ready.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });
});
