import { Injectable } from '@nestjs/common';
import { badRequest } from '../../common/errors.js';
import { requireOrgId } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DEFAULT_VENDOR_POLICY, vendorPolicySchema, type VendorPolicy } from '../vendors/vendor-scoring.js';
import { DEFAULT_RISK_POLICY, riskPolicySchema, type RiskPolicy } from './risk-scoring.js';

type Kind = 'risk' | 'vendor';

/** Versioned scoring policies; every change creates a new version and an audit event (spec §6.1). */
@Injectable()
export class ScoringPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async activeRisk(tx?: Tx, organizationId = requireOrgId()): Promise<{ version: number; policy: RiskPolicy }> {
    const row = await this.active('risk', organizationId, tx);
    return row ? { version: row.version, policy: riskPolicySchema.parse(row.config) } : { version: 0, policy: DEFAULT_RISK_POLICY };
  }

  async activeVendor(tx?: Tx, organizationId = requireOrgId()): Promise<{ version: number; policy: VendorPolicy }> {
    const row = await this.active('vendor', organizationId, tx);
    return row ? { version: row.version, policy: vendorPolicySchema.parse(row.config) } : { version: 0, policy: DEFAULT_VENDOR_POLICY };
  }

  list() {
    return this.prisma.scoringPolicy.findMany({ where: { organizationId: requireOrgId() }, orderBy: [{ kind: 'asc' }, { version: 'desc' }] });
  }

  async update(kind: Kind, config: unknown, rationale: string) {
    const organizationId = requireOrgId();
    const parsed = kind === 'risk' ? riskPolicySchema.safeParse(config) : vendorPolicySchema.safeParse(config);
    if (!parsed.success) throw badRequest('invalid_policy', 'Policy is invalid', { issues: parsed.error.issues.map((i) => i.message) });
    return this.prisma.tx(async (tx) => {
      const current = await this.active(kind, organizationId, tx);
      const version = (current?.version ?? 0) + 1;
      await tx.scoringPolicy.updateMany({ where: { organizationId, kind, active: true }, data: { active: false } });
      const created = await tx.scoringPolicy.create({
        data: { organizationId, kind, version, config: parsed.data as Prisma.InputJsonValue, rationale, active: true },
      });
      await this.audit.record(
        { action: 'scoring_policy.updated', entityType: 'scoring_policy', entityId: created.id, before: { version: current?.version, config: current?.config }, after: { version, config: parsed.data }, rationale },
        tx,
      );
      return created;
    });
  }

  private active(kind: Kind, organizationId: string, tx?: Tx) {
    return (tx ?? this.prisma).scoringPolicy.findFirst({ where: { organizationId, kind, active: true }, orderBy: { version: 'desc' } });
  }
}
