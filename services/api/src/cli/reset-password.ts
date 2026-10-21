/**
 * Operator password reset (account recovery or compromise; docs/INCIDENT_RESPONSE.md).
 *
 *   npm run users:reset-password -w services/api -- --email someone@company.com --reason "locked out"
 *
 * Sets a random one-time password (printed once) that must be changed at the next sign-in,
 * clears any lockout and revokes all of the user's sessions. Audited. Deliver the password
 * out of band; there is no self-service reset in 1.0 because email is optional.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, reason: { type: 'string' } } });
if (!values.email || !values.reason?.trim()) {
  console.error('Usage: reset-password --email <email> --reason "<why>"');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: loadEnv().DATABASE_URL }) });
try {
  const email = values.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}`);
  const oneTimePassword = randomBytes(18).toString('base64url');
  const passwordHash = await argon2.hash(oneTimePassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    const sessions = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'password_reset' } });
    await tx.auditEvent.create({
      data: { organizationId: null, actorType: 'system', action: 'auth.password_reset_by_operator', entityType: 'user', entityId: user.id, rationale: values.reason!.trim(), afterSummary: { sessionsRevoked: sessions.count } },
    });
    return sessions.count;
  });
  console.log(`\nPassword reset for ${email}; ${revoked} session(s) revoked.`);
  console.log(`  One-time password:  ${oneTimePassword}`);
  console.log('  Shown only now. Deliver it out of band; it must be changed at the next sign-in.\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
