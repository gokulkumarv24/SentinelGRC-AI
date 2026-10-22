import { Injectable } from '@nestjs/common';
import { badRequest, conflict, notFound, separationOfDuties } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { MappingType, Prisma, ReviewStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';

export interface MappingInput {
  sourceRequirementId: string;
  targetRequirementId?: string | null;
  controlId?: string | null;
  mappingType: MappingType;
  rationale: string;
  confidence: number;
  sourceReference?: string | null;
}

const TRACKED = ['mappingType', 'rationale', 'confidence', 'reviewStatus', 'sourceReference', 'reviewNotes'] as const;

/**
 * Control mappings are reviewable assertions, never equivalence (spec §8.2).
 * Organizations see platform illustrative mappings read-only and manage their own.
 * The person who proposes a mapping cannot approve it.
 */
@Injectable()
export class MappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string; reviewStatus?: ReviewStatus[]; frameworkId?: string; controlId?: string; scope?: 'organization' | 'platform'; queue?: boolean }) {
    const organizationId = requireOrgId();
    const where: Prisma.ControlMappingWhereInput = {
      AND: [
        query.scope === 'platform' ? { organizationId: null } : query.scope === 'organization' ? { organizationId } : { OR: [{ organizationId }, { organizationId: null }] },
        query.queue ? { reviewStatus: { in: ['unreviewed', 'pending_review'] }, organizationId } : {},
        query.reviewStatus ? { reviewStatus: { in: query.reviewStatus } } : {},
        query.controlId ? { controlId: query.controlId } : {},
        query.frameworkId ? { OR: [{ sourceRequirementRef: { frameworkId: query.frameworkId } }, { targetRequirementRef: { frameworkId: query.frameworkId } }] } : {},
        query.q
          ? { OR: [{ rationale: { contains: query.q, mode: 'insensitive' } }, { sourceRequirementRef: { requirementCode: { contains: query.q, mode: 'insensitive' } } }, { targetRequirementRef: { requirementCode: { contains: query.q, mode: 'insensitive' } } }, { control: { controlCode: { contains: query.q, mode: 'insensitive' } } }] }
          : {},
      ],
    };
    const include = {
      sourceRequirementRef: { select: { id: true, requirementCode: true, title: true, framework: { select: { id: true, key: true, name: true, version: true } } } },
      targetRequirementRef: { select: { id: true, requirementCode: true, title: true, framework: { select: { id: true, key: true, name: true, version: true } } } },
      control: { select: { id: true, controlCode: true, title: true } },
    } satisfies Prisma.ControlMappingInclude;
    const [items, total] = await Promise.all([this.prisma.controlMapping.findMany({ where, ...pageArgs(query), include }), this.prisma.controlMapping.count({ where })]);
    return toPage(
      items.map(({ sourceRequirementRef, targetRequirementRef, control, ...m }) => ({ ...m, scope: m.organizationId ? 'organization' : 'platform', source: sourceRequirementRef, target: targetRequirementRef, control: control })),
      total,
      query,
    );
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const mapping = await this.prisma.controlMapping.findFirst({
      where: { id, OR: [{ organizationId }, { organizationId: null }] },
      include: { history: { orderBy: { changedAt: 'desc' } }, sourceRequirementRef: { include: { framework: true } }, targetRequirementRef: { include: { framework: true } }, control: true },
    });
    if (!mapping) throw notFound('Mapping');
    return mapping;
  }

  async create(input: MappingInput) {
    const organizationId = requireOrgId();
    if (!!input.controlId === !!input.targetRequirementId) throw badRequest('invalid_target', 'Map to exactly one target: a control or another framework requirement.');
    return this.prisma.tx(async (tx) => {
      const source = await this.requirement(tx, input.sourceRequirementId);
      if (input.targetRequirementId) {
        const target = await this.requirement(tx, input.targetRequirementId);
        if (target.frameworkId === source.frameworkId) throw badRequest('same_framework', 'Cross-framework mappings must connect two different frameworks.');
      }
      if (input.controlId) await this.entities.resolve('control', input.controlId, tx);
      const duplicate = await tx.controlMapping.findFirst({
        where: { organizationId, sourceRequirementId: input.sourceRequirementId, controlId: input.controlId ?? null, targetRequirementId: input.targetRequirementId ?? null, reviewStatus: { not: 'rejected' } },
      });
      if (duplicate) throw conflict('This mapping already exists.');
      const mapping = await tx.controlMapping.create({
        data: {
          organizationId,
          sourceRequirementId: input.sourceRequirementId,
          targetRequirementId: input.targetRequirementId ?? null,
          controlId: input.controlId ?? null,
          mappingType: input.mappingType,
          rationale: input.rationale,
          confidence: input.confidence,
          sourceReference: input.sourceReference ?? null,
          frameworkVersion: source.framework.version,
          reviewStatus: 'pending_review',
          isIllustrative: false,
          createdBy: actorId(),
        },
      });
      await tx.controlMappingHistory.create({ data: { mappingId: mapping.id, organizationId, previousValues: {}, newValues: json(snapshot(mapping)), changedBy: actorId(), rationale: 'Mapping proposed' } });
      await this.audit.record({ action: 'mapping.created', entityType: 'control_mapping', entityId: mapping.id, after: snapshot(mapping) }, tx);
      return mapping;
    });
  }

  async update(id: string, version: number, input: Partial<Pick<MappingInput, 'mappingType' | 'rationale' | 'confidence' | 'sourceReference'>>, rationale?: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const mapping = await tx.controlMapping.findFirst({ where: { id, organizationId } });
      if (!mapping) throw notFound('Mapping');
      if (mapping.version !== version) throw conflict('This mapping was changed by someone else.');
      // Any substantive edit sends the mapping back for review.
      const updated = await tx.controlMapping.update({ where: { id }, data: { ...input, reviewStatus: 'pending_review', reviewedBy: null, reviewedAt: null, version: { increment: 1 } } });
      await tx.controlMappingHistory.create({ data: { mappingId: id, organizationId, previousValues: json(snapshot(mapping)), newValues: json(snapshot(updated)), changedBy: actorId(), rationale: rationale ?? null } });
      await this.audit.record({ action: 'mapping.updated', entityType: 'control_mapping', entityId: id, before: snapshot(mapping), after: snapshot(updated), rationale }, tx);
      return updated;
    });
  }

  async review(id: string, decision: 'approved' | 'rejected', notes: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const mapping = await tx.controlMapping.findFirst({ where: { id, organizationId } });
      if (!mapping) throw notFound('Mapping');
      if (mapping.createdBy && mapping.createdBy === requireUserId()) throw separationOfDuties('A mapping must be reviewed by someone other than the person who proposed it.');
      const updated = await tx.controlMapping.update({
        where: { id },
        data: { reviewStatus: decision, reviewedBy: requireUserId(), reviewedAt: new Date(), reviewNotes: notes, isIllustrative: decision === 'approved' ? false : mapping.isIllustrative, version: { increment: 1 } },
      });
      await tx.controlMappingHistory.create({ data: { mappingId: id, organizationId, previousValues: json(snapshot(mapping)), newValues: json(snapshot(updated)), changedBy: actorId(), rationale: notes } });
      await this.audit.record({ action: `mapping.${decision}`, entityType: 'control_mapping', entityId: id, before: { reviewStatus: mapping.reviewStatus }, after: { reviewStatus: decision }, rationale: notes }, tx);
      return updated;
    });
  }

  /**
   * Reviews several proposed mappings at once (e.g. the AI agent's suggestions for a new framework).
   * Each one goes through the normal review rules; ones the reviewer may not decide are reported, not skipped silently.
   */
  async bulkReview(ids: string[], decision: 'approved' | 'rejected', notes: string) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await this.review(id, decision, notes);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : 'failed' });
      }
    }
    return { reviewed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  }

  /** Copies a platform illustrative mapping into the organization as a proposal awaiting review. */
  async adopt(platformMappingId: string) {
    const platform = await this.prisma.controlMapping.findFirst({ where: { id: platformMappingId, organizationId: null } });
    if (!platform) throw notFound('Mapping');
    return this.create({
      sourceRequirementId: platform.sourceRequirementId,
      targetRequirementId: platform.targetRequirementId,
      controlId: null,
      mappingType: platform.mappingType,
      rationale: platform.rationale,
      confidence: platform.confidence,
      sourceReference: `Adopted from platform illustrative mapping ${platform.id}`,
    });
  }

  private async requirement(tx: Prisma.TransactionClient, id: string) {
    const requirement = await tx.frameworkRequirement.findFirst({
      where: { id, framework: { OR: [{ organizationId: null }, { organizationId: requireOrgId() }] } },
      include: { framework: true },
    });
    if (!requirement) throw notFound('Framework requirement');
    return requirement;
  }
}

function snapshot(m: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(TRACKED.map((k) => [k, m[k] ?? null]));
}

const json = (v: Record<string, unknown>) => v as Prisma.InputJsonValue;
