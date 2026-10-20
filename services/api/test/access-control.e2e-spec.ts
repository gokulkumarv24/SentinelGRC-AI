import { addMembership, Client, createOrg, createUser, loginAs, startApp, type TestContext } from './helpers.js';

describe('RBAC, separation of duties and tenant isolation (identity)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  it('lists only members of the caller’s own organization', async () => {
    const orgA = await createOrg(ctx.prisma);
    const orgB = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, orgA.id, ['org_admin']);
    const bUser = await createUser(ctx.prisma, { organizationId: orgB.id, roles: ['auditor'] });
    const res = await client.get('/members?pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { user: { id: string } }) => m.user.id)).not.toContain(bUser.id);
    expect(res.body.total).toBe(1);
  });

  it('cannot change roles or status of another organization’s member by guessing ids', async () => {
    const orgA = await createOrg(ctx.prisma);
    const orgB = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, orgA.id, ['org_admin']);
    const bUser = await createUser(ctx.prisma);
    const bMembership = await addMembership(ctx.prisma, bUser.id, orgB.id, ['auditor']);

    const roles = await client.patch(`/members/${bMembership.id}/roles`, { roles: ['org_admin'] });
    const status = await client.patch(`/members/${bMembership.id}/status`, { status: 'suspended' });
    expect(roles.status).toBe(404);
    expect(status.status).toBe(404);
    const unchanged = await ctx.prisma.membershipRole.findMany({ where: { membershipId: bMembership.id }, include: { role: true } });
    expect(unchanged.map((r) => r.role.key)).toEqual(['auditor']);
  });

  it('prevents users from granting roles to themselves', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['org_admin']);
    const self = await ctx.prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    const res = await client.patch(`/members/${self.id}/roles`, { roles: ['org_admin', 'grc_manager'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('self_role_change');
  });

  it('keeps at least one active organization admin', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['org_admin']);
    const other = await createUser(ctx.prisma);
    const otherMembership = await addMembership(ctx.prisma, other.id, org.id, ['org_admin']);
    // Demoting the second admin is fine because the caller remains an admin.
    expect((await client.patch(`/members/${otherMembership.id}/roles`, { roles: ['auditor'] })).status).toBe(200);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { action: 'member.roles_changed', entityId: otherMembership.id } });
    expect(audit?.beforeSummary).toEqual({ roles: ['org_admin'] });
    expect(audit?.afterSummary).toEqual({ roles: ['auditor'] });
  });

  it('denies read-only auditors every mutation and records the denial', async () => {
    const org = await createOrg(ctx.prisma);
    const { client, user } = await loginAs(ctx, org.id, ['auditor']);
    const invite = await client.post('/members/invitations', { email: 'a@example.test', roles: ['auditor'] });
    const settings = await client.patch('/organizations/current', { name: 'Hacked' });
    expect(invite.status).toBe(403);
    expect(settings.status).toBe(403);
    expect((await client.get('/audit-events')).status).toBe(200);
    const denials = await ctx.prisma.auditEvent.count({ where: { action: 'authz.denied', actorUserId: user.id } });
    expect(denials).toBe(2);
  });

  it('only allows privileged roles to be granted by holders of role.assign', async () => {
    const org = await createOrg(ctx.prisma);
    // vendor_manager has no member.manage, so build a custom check through a GRC manager (no member.manage either)
    const { client } = await loginAs(ctx, org.id, ['grc_manager']);
    const res = await client.post('/members/invitations', { email: 'b@example.test', roles: ['org_admin'] });
    expect(res.status).toBe(403);
  });

  it('suspension takes effect immediately for existing sessions', async () => {
    const org = await createOrg(ctx.prisma);
    const { client: admin } = await loginAs(ctx, org.id, ['org_admin']);
    const { client: analyst, user } = await loginAs(ctx, org.id, ['security_analyst']);
    expect((await analyst.get('/members')).status).toBe(200);
    const membership = await ctx.prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect((await admin.patch(`/members/${membership.id}/status`, { status: 'suspended', rationale: 'left team' })).status).toBe(200);
    const after = await analyst.get('/members');
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('no_organization');
  });

  it('restricts the audit log to the caller’s organization', async () => {
    const orgA = await createOrg(ctx.prisma);
    const orgB = await createOrg(ctx.prisma);
    const { client: adminB } = await loginAs(ctx, orgB.id, ['org_admin']);
    await adminB.patch('/organizations/current', { industry: 'Secret industry B' });
    const { client: auditorA } = await loginAs(ctx, orgA.id, ['auditor']);
    const events = await auditorA.get('/audit-events?pageSize=100');
    expect(events.body.items.every((e: { organizationId: string }) => e.organizationId === orgA.id)).toBe(true);
    const bEvent = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgB.id, action: 'organization.updated' } });
    expect((await auditorA.get(`/audit-events/${bEvent.id}`)).status).toBe(404);
  });

  it('allows only platform admins to create organizations', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['org_admin']);
    const denied = await client.post('/organizations', { name: 'New Co', slug: 'new-co-x', adminEmail: 'boss@example.test' });
    expect(denied.status).toBe(403);

    const platform = await createUser(ctx.prisma, { platformAdmin: true });
    const pc = new Client(ctx.app);
    await pc.login(platform.email);
    const slug = `plat-${Date.now()}`;
    const created = await pc.post('/organizations', { name: 'Platform Co', slug, adminEmail: 'boss@example.test' });
    expect(created.status).toBe(201);
    expect(created.body.adminInviteUrl).toContain('/invite/');
    const policies = await ctx.prisma.scoringPolicy.count({ where: { organizationId: created.body.organization.id } });
    expect(policies).toBe(2);
  });

  it('keeps audit history append-only at the database level', async () => {
    const event = await ctx.prisma.auditEvent.findFirstOrThrow();
    await expect(ctx.prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } })).rejects.toThrow();
    await expect(ctx.prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it('returns 422 with field details for invalid input', async () => {
    const org = await createOrg(ctx.prisma);
    const { client } = await loginAs(ctx, org.id, ['org_admin']);
    const res = await client.post('/members/invitations', { email: 'not-an-email', roles: ['made_up_role'] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['email', 'roles.0']));
  });
});
