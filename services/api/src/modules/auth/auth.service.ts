import { Injectable } from '@nestjs/common';
import { sha256Hex } from '../../common/crypto.js';
import { AppError, badRequest, notFound } from '../../common/errors.js';
import { currentContext, requireUserId } from '../../common/request-context.js';
import { ALL_PERMISSIONS } from '../../permissions/catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Generic failure message for every reason, so accounts cannot be enumerated (spec §15). */
  async login(emailInput: string, password: string) {
    const ctx = currentContext();
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordOk = await this.passwords.verify(user?.passwordHash, password);
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();

    if (!user || !passwordOk || locked || user.status !== 'active') {
      if (user && !locked) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
          },
        });
      }
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        organizationId: null,
        actorUserId: user?.id ?? null,
        after: { reason: !user ? 'unknown_user' : locked ? 'locked' : user.status !== 'active' ? 'inactive' : 'bad_password' },
        outcome: 'failure',
      });
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    if (this.passwords.needsRehash(user.passwordHash!)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(password) } });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const created = await this.sessions.create(user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
    await this.audit.record({
      action: 'auth.login_succeeded',
      entityType: 'session',
      entityId: created.session.id,
      organizationId: created.session.activeOrganizationId,
      actorUserId: user.id,
    });
    return created;
  }

  async logout(): Promise<void> {
    const ctx = currentContext();
    if (!ctx.sessionId) return;
    await this.sessions.revoke(ctx.sessionId, 'logout');
    await this.audit.record({ action: 'auth.logout', entityType: 'session', entityId: ctx.sessionId });
  }

  async me() {
    const ctx = currentContext();
    const userId = requireUserId();
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'active', organization: { status: 'active' } },
      include: { organization: { select: { id: true, name: true, slug: true, isDemo: true, timezone: true } }, roles: { include: { role: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
      },
      activeOrganizationId: ctx.membership?.organizationId ?? null,
      // The UI uses this only to hide navigation; the API enforces every permission itself.
      permissions: ctx.membership ? ALL_PERMISSIONS.filter((p) => ctx.membership!.permissions.has(p)) : [],
      roles: ctx.membership?.roleKeys ?? [],
      organizations: memberships.map((m) => ({ ...m.organization, roles: m.roles.map((r) => r.role.key) })),
    };
  }

  async switchOrganization(organizationId: string): Promise<void> {
    const ctx = currentContext();
    const membership = await this.sessions.loadMembership(requireUserId(), organizationId);
    if (!membership) throw notFound('Organization');
    await this.sessions.switchOrganization(ctx.sessionId!, organizationId);
    await this.audit.record({ action: 'auth.organization_switched', entityType: 'organization', entityId: organizationId, organizationId });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const ctx = currentContext();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: requireUserId() } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError(400, 'invalid_current_password', 'Current password is incorrect.');
    }
    if (currentPassword === newPassword) throw badRequest('password_reuse', 'Choose a password different from the current one.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    const revoked = await this.sessions.revokeAllForUser(user.id, 'password_changed', ctx.sessionId);
    await this.audit.record({ action: 'auth.password_changed', entityType: 'user', entityId: user.id, after: { otherSessionsRevoked: revoked } });
  }

  async invitationPreview(token: string) {
    const invitation = await this.findUsableInvitation(token);
    return { organizationName: invitation.organization.name, email: invitation.normalizedEmail, roles: invitation.roleKeys };
  }

  /** Accepts an invitation: creates the user if needed and an active membership with the invited roles. */
  async acceptInvitation(token: string, displayName: string, password: string) {
    const invitation = await this.findUsableInvitation(token);
    const result = await this.prisma.tx(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError(410, 'invitation_used', 'This invitation has already been used.');

      let user = await tx.user.findUnique({ where: { email: invitation.normalizedEmail } });
      if (!user) {
        user = await tx.user.create({
          data: { email: invitation.normalizedEmail, displayName, passwordHash: await this.passwords.hash(password) },
        });
      } else if (!(await this.passwords.verify(user.passwordHash, password))) {
        // Existing account: the person must prove they own it before joining.
        throw new AppError(401, 'invalid_credentials', 'Use your existing password to accept this invitation.');
      }
      const membership = await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
        create: { organizationId: invitation.organizationId, userId: user.id, status: 'active' },
        update: { status: 'active' },
      });
      const roles = await tx.role.findMany({ where: { key: { in: invitation.roleKeys } } });
      for (const role of roles) {
        await tx.membershipRole.upsert({
          where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
          create: { membershipId: membership.id, roleId: role.id, grantedBy: invitation.inviterId },
          update: {},
        });
      }
      await this.audit.record(
        {
          action: 'member.invitation_accepted',
          entityType: 'membership',
          entityId: membership.id,
          organizationId: invitation.organizationId,
          actorUserId: user.id,
          after: { roles: invitation.roleKeys },
        },
        tx,
      );
      return user;
    });
    return { email: result.email };
  }

  private async findUsableInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { organization: true },
    });
    if (!invitation || invitation.revokedAt || invitation.usedAt || invitation.expiresAt < new Date()) {
      throw new AppError(410, 'invitation_invalid', 'This invitation link is invalid or has expired.');
    }
    return invitation;
  }
}
