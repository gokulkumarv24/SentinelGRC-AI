import { Injectable } from '@nestjs/common';
import { newToken, sha256Hex } from '../../common/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { hasPermission, requireOrgId, requireUserId } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import { PRIVILEGED_ROLES, ROLE_KEYS, ROLES, type RoleKey } from '../../permissions/catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeEmail } from '../auth/auth.service.js';

const INVITATION_TTL_HOURS = 72;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string; status?: string[] }) {
    const organizationId = requireOrgId();
    const where = {
      organizationId,
      ...(query.status ? { status: { in: query.status as never[] } } : {}),
      ...(query.q
        ? { user: { OR: [{ email: { contains: query.q, mode: 'insensitive' as const } }, { displayName: { contains: query.q, mode: 'insensitive' as const } }] } }
        : {}),
    };
    const { skip, take } = pageArgs(query);
    const orderBy = query.sort === 'displayName' ? { user: { displayName: query.order } } : { joinedAt: query.order };
    const [rows, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { user: { select: { id: true, email: true, displayName: true, lastLoginAt: true, status: true } }, roles: { include: { role: true } } },
      }),
      this.prisma.membership.count({ where }),
    ]);
    return toPage(
      rows.map((m) => ({
        id: m.id,
        status: m.status,
        joinedAt: m.joinedAt,
        user: m.user,
        roles: m.roles.map((r) => r.role.key),
      })),
      total,
      query,
    );
  }

  /** Lightweight list for owner/assignee pickers. */
  async directory() {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: requireOrgId(), status: 'active' },
      include: { user: { select: { id: true, displayName: true, email: true } }, roles: { include: { role: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return rows.map((m) => ({ ...m.user, roles: m.roles.map((r) => r.role.key) }));
  }

  async invite(emailInput: string, roleKeys: RoleKey[]) {
    const organizationId = requireOrgId();
    const email = normalizeEmail(emailInput);
    this.assertCanGrant(roleKeys);
    const existing = await this.prisma.membership.findFirst({ where: { organizationId, status: 'active', user: { email } } });
    if (existing) throw conflict('This person is already a member.');

    const token = newToken();
    const invitation = await this.prisma.tx(async (tx) => {
      await tx.invitation.updateMany({
        where: { organizationId, normalizedEmail: email, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId,
          normalizedEmail: email,
          roleKeys,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000),
          inviterId: requireUserId(),
        },
      });
      await this.audit.record({ action: 'member.invited', entityType: 'invitation', entityId: created.id, after: { email, roles: roleKeys } }, tx);
      return created;
    });
    // Email delivery is optional; the link is shown once to the inviting admin.
    return {
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt,
      acceptUrl: `${loadEnv().PUBLIC_APP_URL}/invite/${token}`,
    };
  }

  async listInvitations() {
    return this.prisma.invitation.findMany({
      where: { organizationId: requireOrgId(), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, normalizedEmail: true, roleKeys: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(id: string) {
    const organizationId = requireOrgId();
    const result = await this.prisma.invitation.updateMany({
      where: { id, organizationId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw notFound('Invitation');
    await this.audit.record({ action: 'member.invitation_revoked', entityType: 'invitation', entityId: id });
  }

  /** Replaces a member's roles. Users can never change their own roles (spec §2.2). */
  async setRoles(membershipId: string, roleKeys: RoleKey[], rationale?: string) {
    const organizationId = requireOrgId();
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
      include: { roles: { include: { role: true } } },
    });
    if (!membership) throw notFound('Member');
    if (membership.userId === requireUserId()) throw forbidden('You cannot change your own roles.', 'self_role_change');
    const before = membership.roles.map((r) => r.role.key as RoleKey);
    this.assertCanGrant([...roleKeys, ...before.filter((r) => !roleKeys.includes(r))]);
    if (before.includes('org_admin') && !roleKeys.includes('org_admin')) await this.assertNotLastAdmin(organizationId, membership.id);

    await this.prisma.tx(async (tx) => {
      const roles = await tx.role.findMany({ where: { key: { in: roleKeys } } });
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipRole.createMany({
        data: roles.map((r) => ({ membershipId, roleId: r.id, grantedBy: requireUserId() })),
      });
      await this.audit.record(
        { action: 'member.roles_changed', entityType: 'membership', entityId: membershipId, before: { roles: before }, after: { roles: roleKeys }, rationale },
        tx,
      );
    });
    return { id: membershipId, roles: roleKeys };
  }

  async setStatus(membershipId: string, status: 'active' | 'suspended' | 'removed', rationale?: string) {
    const organizationId = requireOrgId();
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, organizationId }, include: { roles: { include: { role: true } } } });
    if (!membership) throw notFound('Member');
    if (membership.userId === requireUserId()) throw forbidden('You cannot change your own membership status.', 'self_status_change');
    if (status !== 'active' && membership.roles.some((r) => r.role.key === 'org_admin')) {
      await this.assertNotLastAdmin(organizationId, membership.id);
    }
    await this.prisma.tx(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(
        { action: 'member.status_changed', entityType: 'membership', entityId: membershipId, before: { status: membership.status }, after: { status }, rationale },
        tx,
      );
    });
    return { id: membershipId, status };
  }

  roleCatalog() {
    return ROLE_KEYS.map((key) => ({ key, name: ROLES[key].name, description: ROLES[key].description, permissions: ROLES[key].permissions }));
  }

  private assertCanGrant(roleKeys: string[]) {
    const unknown = roleKeys.filter((k) => !ROLE_KEYS.includes(k as RoleKey));
    if (unknown.length) throw badRequest('unknown_role', 'Unknown role', { roles: unknown });
    const privileged = roleKeys.some((k) => PRIVILEGED_ROLES.includes(k as RoleKey));
    if (privileged && !hasPermission('role.assign')) {
      throw new AppError(403, 'forbidden', 'Only an organization administrator can grant privileged roles.');
    }
  }

  private async assertNotLastAdmin(organizationId: string, excludingMembershipId: string) {
    const admins = await this.prisma.membership.count({
      where: { organizationId, status: 'active', id: { not: excludingMembershipId }, roles: { some: { role: { key: 'org_admin' } } } },
    });
    if (admins === 0) throw conflict('An organization must keep at least one active administrator.');
  }
}
