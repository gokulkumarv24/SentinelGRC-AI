import { Injectable } from '@nestjs/common';
import { newToken, sha256Hex } from '../../common/crypto.js';
import { conflict } from '../../common/errors.js';
import { requireOrgId, requireUserId } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeEmail } from '../auth/auth.service.js';
import { OrganizationBootstrapService } from './organization-bootstrap.service.js';

export interface OrganizationSettings {
  evidenceRetentionDays?: number;
  auditRetentionDays?: number;
  requireSeparationOfDutiesForHighRisk?: boolean;
  allowSelfApprovalForLowRisk?: boolean;
  aiFeaturesEnabled?: boolean;
  reportRetentionDays?: number;
}

export const DEFAULT_SETTINGS: Required<OrganizationSettings> = {
  evidenceRetentionDays: 2555,
  auditRetentionDays: 2555,
  requireSeparationOfDutiesForHighRisk: true,
  allowSelfApprovalForLowRisk: false,
  aiFeaturesEnabled: true,
  reportRetentionDays: 90,
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bootstrap: OrganizationBootstrapService,
  ) {}

  /** Platform super-admin: create an organization and invite its first administrator. */
  async create(input: { name: string; slug: string; industry?: string; timezone: string; adminEmail: string }) {
    const exists = await this.prisma.organization.findUnique({ where: { slug: input.slug } });
    if (exists) throw conflict('An organization with this slug already exists.');
    const token = newToken();
    const org = await this.prisma.tx(async (tx) => {
      const created = await tx.organization.create({
        data: { name: input.name, slug: input.slug, industry: input.industry, timezone: input.timezone, settings: DEFAULT_SETTINGS },
      });
      await this.bootstrap.initialize(tx, created.id);
      await tx.invitation.create({
        data: {
          organizationId: created.id,
          normalizedEmail: normalizeEmail(input.adminEmail),
          roleKeys: ['org_admin'],
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + 72 * 3_600_000),
          inviterId: requireUserId(),
        },
      });
      await this.audit.record(
        { action: 'organization.created', entityType: 'organization', entityId: created.id, organizationId: null, after: { name: input.name, slug: input.slug } },
        tx,
      );
      return created;
    });
    return { organization: org, adminInviteUrl: `${loadEnv().PUBLIC_APP_URL}/invite/${token}` };
  }

  listAll() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, slug: true, status: true, isDemo: true, createdAt: true, _count: { select: { memberships: true } } },
    });
  }

  async current() {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: requireOrgId() } });
    return { ...org, settings: { ...DEFAULT_SETTINGS, ...(org.settings as OrganizationSettings) } };
  }

  async updateCurrent(input: { name?: string; industry?: string | null; timezone?: string; settings?: OrganizationSettings }) {
    const before = await this.current();
    const settings = { ...before.settings, ...(input.settings ?? {}) };
    const updated = await this.prisma.tx(async (tx) => {
      const org = await tx.organization.update({
        where: { id: before.id },
        data: { name: input.name, industry: input.industry, timezone: input.timezone, settings: settings as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          action: 'organization.updated',
          entityType: 'organization',
          entityId: org.id,
          before: { name: before.name, industry: before.industry, timezone: before.timezone, settings: before.settings },
          after: { name: org.name, industry: org.industry, timezone: org.timezone, settings },
        },
        tx,
      );
      return org;
    });
    return { ...updated, settings };
  }
}
