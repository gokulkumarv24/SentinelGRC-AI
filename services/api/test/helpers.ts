import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../src/bootstrap-app.js';
import { loadReferenceData, syncRolesAndPermissions } from '../src/cli/reference-data.js';
import type { RoleKey } from '../src/permissions/catalog.js';
import { OrganizationBootstrapService } from '../src/modules/organizations/organization-bootstrap.service.js';
import { DEFAULT_SETTINGS } from '../src/modules/organizations/organizations.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PASSWORD = 'Correct-Horse-Battery-9';
const API = '/api/v1';
let passwordHash: string | undefined;

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function startApp(): Promise<TestContext> {
  const app = await createApp({ logger: false });
  await app.init();
  app.getHttpServer().setMaxListeners(0); // supertest attaches listeners per request
  const prisma = app.get(PrismaService);
  await syncRolesAndPermissions(prisma);
  await loadReferenceData(prisma);
  return { app, prisma };
}

export const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export async function createOrg(prisma: PrismaService, name = uniq('Org')) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), settings: DEFAULT_SETTINGS } });
    await new OrganizationBootstrapService().initialize(tx, org.id);
    return org;
  });
}

export async function createUser(
  prisma: PrismaService,
  options: { organizationId?: string; roles?: RoleKey[]; email?: string; platformAdmin?: boolean } = {},
) {
  passwordHash ??= await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const email = options.email ?? `${uniq('user')}@example.test`;
  const user = await prisma.user.create({
    data: { email, displayName: email.split('@')[0], passwordHash, isPlatformAdmin: options.platformAdmin ?? false },
  });
  if (options.organizationId) await addMembership(prisma, user.id, options.organizationId, options.roles ?? []);
  return user;
}

export async function addMembership(prisma: PrismaService, userId: string, organizationId: string, roles: RoleKey[]) {
  const membership = await prisma.membership.create({ data: { userId, organizationId } });
  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  await prisma.membershipRole.createMany({ data: roleRows.map((r) => ({ membershipId: membership.id, roleId: r.id })) });
  return membership;
}

/** Authenticated HTTP client that keeps cookies and sends the CSRF header like the web app does. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.agent.post(`${API}/auth/login`).send({ email, password });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    this.csrf = cookies.find((c) => c.startsWith('sg_csrf='))?.split(';')[0].split('=')[1] ?? '';
    return res;
  }

  get(path: string) {
    return this.agent.get(`${API}${path}`);
  }

  post(path: string, body?: object) {
    return this.agent.post(`${API}${path}`).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }

  patch(path: string, body?: object) {
    return this.agent.patch(`${API}${path}`).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }

  delete(path: string) {
    return this.agent.delete(`${API}${path}`).set('X-CSRF-Token', this.csrf);
  }

  upload(path: string, fields: Record<string, string>, file: { name: string; content: Buffer | string; type?: string }) {
    let req = this.agent.post(`${API}${path}`).set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', Buffer.from(file.content), { filename: file.name, contentType: file.type ?? 'application/octet-stream' });
  }
}

/** Creates an org member with roles and returns a logged-in client. */
export async function loginAs(ctx: TestContext, organizationId: string, roles: RoleKey[]) {
  const user = await createUser(ctx.prisma, { organizationId, roles });
  const client = new Client(ctx.app);
  const res = await client.login(user.email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, user };
}
