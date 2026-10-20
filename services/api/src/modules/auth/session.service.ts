import { Injectable } from '@nestjs/common';
import { newToken, sha256Hex } from '../../common/crypto.js';
import type { ContextMembership, ContextUser } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import { permissionsForRoles } from '../../permissions/catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ResolvedSession {
  sessionId: string;
  user: ContextUser & { mustChangePassword: boolean };
  membership?: ContextMembership;
}

const TOUCH_INTERVAL_MS = 60_000;

/**
 * Opaque server-side sessions: the cookie holds a random token, the database only its SHA-256 hash.
 * Sessions have an idle timeout (sliding) and an absolute lifetime, and can be revoked (spec §15).
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, meta: { ip?: string; userAgent?: string }) {
    const env = loadEnv();
    const token = newToken();
    const csrfToken = newToken();
    const now = Date.now();
    const firstMembership = await this.prisma.membership.findFirst({
      where: { userId, status: 'active', organization: { status: 'active' } },
      orderBy: { joinedAt: 'asc' },
    });
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        csrfTokenHash: sha256Hex(csrfToken),
        activeOrganizationId: firstMembership?.organizationId ?? null,
        idleExpiresAt: new Date(now + env.SESSION_IDLE_MINUTES * 60_000),
        absoluteExpiresAt: new Date(now + env.SESSION_ABSOLUTE_HOURS * 3_600_000),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { session, token, csrfToken, maxAgeMs: env.SESSION_ABSOLUTE_HOURS * 3_600_000 };
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.idleExpiresAt < now || session.absoluteExpiresAt < now) return null;
    if (session.user.status !== 'active') return null;

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idle = new Date(now.getTime() + loadEnv().SESSION_IDLE_MINUTES * 60_000);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt: idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt },
      });
    }

    const membership = session.activeOrganizationId
      ? await this.loadMembership(session.userId, session.activeOrganizationId)
      : undefined;

    return {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        isPlatformAdmin: session.user.isPlatformAdmin,
        mustChangePassword: session.user.mustChangePassword,
      },
      membership,
    };
  }

  /** Re-checks membership on every request, so suspension or role changes take effect immediately. */
  async loadMembership(userId: string, organizationId: string): Promise<ContextMembership | undefined> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { roles: { include: { role: true } }, organization: true },
    });
    if (!membership || membership.status !== 'active' || membership.organization.status !== 'active') return undefined;
    const roleKeys = membership.roles.map((r) => r.role.key);
    return {
      id: membership.id,
      organizationId,
      organizationName: membership.organization.name,
      roleKeys,
      permissions: permissionsForRoles(roleKeys),
    };
  }

  async verifyCsrf(sessionId: string, csrfToken: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { csrfTokenHash: true } });
    return !!session && session.csrfTokenHash === sha256Hex(csrfToken);
  }

  async switchOrganization(sessionId: string, organizationId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { activeOrganizationId: organizationId } });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }
}
