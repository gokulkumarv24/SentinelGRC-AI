/**
 * Incident response: revoke active sessions immediately (docs/INCIDENT_RESPONSE.md).
 *
 *   npm run sessions:revoke -w services/api -- --all --reason "suspected credential theft"
 *   npm run sessions:revoke -w services/api -- --user someone@example.com --reason "..."
 *   npm run sessions:revoke -w services/api -- --org <organization-slug> --reason "..."
 *
 * Revoked users must sign in again. Rotating AUTH_SECRET does NOT revoke sessions (it only
 * invalidates outstanding download links); use this command for that. Every run is audited.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

const { values } = parseArgs({ options: { all: { type: 'boolean', default: false }, user: { type: 'string' }, org: { type: 'string' }, reason: { type: 'string' } } });
const targets = [values.all, !!values.user, !!values.org].filter(Boolean).length;
if (targets !== 1 || !values.reason?.trim()) {
  console.error('Usage: revoke-sessions (--all | --user <email> | --org <slug>) --reason "<why>"');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: loadEnv().DATABASE_URL }) });
try {
  let where: Prisma.SessionWhereInput = { revokedAt: null };
  let organizationId: string | null = null;
  if (values.user) {
    const user = await prisma.user.findUnique({ where: { email: values.user.trim().toLowerCase() } });
    if (!user) throw new Error(`No user with email ${values.user}`);
    where = { ...where, userId: user.id };
  } else if (values.org) {
    const org = await prisma.organization.findUnique({ where: { slug: values.org } });
    if (!org) throw new Error(`No organization with slug ${values.org}`);
    organizationId = org.id;
    where = { ...where, user: { memberships: { some: { organizationId: org.id } } } };
  }
  const result = await prisma.$transaction(async (tx) => {
    const revoked = await tx.session.updateMany({ where, data: { revokedAt: new Date(), revokedReason: 'incident_revocation' } });
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorType: 'system',
        action: 'auth.sessions_revoked',
        entityType: 'session',
        rationale: values.reason!.trim(),
        afterSummary: { scope: values.all ? 'all' : values.user ? 'user' : 'organization', target: values.user ?? values.org ?? null, revoked: revoked.count },
      },
    });
    return revoked;
  });
  console.log(`Revoked ${result.count} active session(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
