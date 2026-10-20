/**
 * Secure first-administrator bootstrap (spec §15: no default production admin password).
 *
 *   npm run admin:create -w services/api -- --email admin@company.example --name "Jane Admin" \
 *       [--org-name "Acme Corp" --org-slug acme] [--platform-admin]
 *
 * Generates a random one-time password, prints it once, and forces a change at first login.
 * Refuses to run if the email already exists.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { loadEnv } from '../config/env.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { OrganizationBootstrapService } from '../modules/organizations/organization-bootstrap.service.js';
import { DEFAULT_SETTINGS } from '../modules/organizations/organizations.service.js';
import { syncRolesAndPermissions } from './reference-data.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'org-name': { type: 'string' },
    'org-slug': { type: 'string' },
    'platform-admin': { type: 'boolean', default: false },
  },
});

if (!values.email || !values.name) {
  console.error('Usage: create-admin --email <email> --name <display name> [--org-name <name> --org-slug <slug>] [--platform-admin]');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: loadEnv().DATABASE_URL }) });
try {
  await syncRolesAndPermissions(prisma);
  const email = values.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`A user with email ${email} already exists. No changes made.`);
    process.exit(1);
  }
  const oneTimePassword = randomBytes(18).toString('base64url');
  const passwordHash = await argon2.hash(oneTimePassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, displayName: values.name!, passwordHash, mustChangePassword: true, isPlatformAdmin: values['platform-admin'] },
    });
    let organizationId: string | null = null;
    if (values['org-name'] && values['org-slug']) {
      const org = await tx.organization.create({
        data: { name: values['org-name'], slug: values['org-slug'], settings: DEFAULT_SETTINGS as Prisma.InputJsonValue },
      });
      organizationId = org.id;
      await new OrganizationBootstrapService().initialize(tx, org.id);
      const membership = await tx.membership.create({ data: { organizationId: org.id, userId: user.id } });
      const role = await tx.role.findUniqueOrThrow({ where: { key: 'org_admin' } });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    }
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorType: 'system',
        action: 'admin.bootstrapped',
        entityType: 'user',
        entityId: user.id,
        afterSummary: { email, platformAdmin: values['platform-admin'], organizationCreated: !!organizationId },
      },
    });
  });

  console.log('\nAdministrator created.');
  console.log(`  Email:              ${email}`);
  console.log(`  One-time password:  ${oneTimePassword}`);
  console.log('  This password is shown only once and must be changed at first sign-in.\n');
} finally {
  await prisma.$disconnect();
}
