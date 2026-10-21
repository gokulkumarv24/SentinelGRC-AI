import { Injectable } from '@nestjs/common';
import { assertPermission, actorId, requireOrgId } from '../../common/request-context.js';
import { badRequest, conflict, notFound, versionConflict } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import type { ImplementationStatus, Prisma, TestResult } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';

export const EXPIRING_SOON_DAYS = 30;

export interface ControlListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  category?: string;
  status?: ImplementationStatus[];
  ownerId?: string;
  frameworkId?: string;
  requirementId?: string;
  testResult?: TestResult[];
  evidence?: 'missing' | 'expired' | 'expiring' | 'current';
  reviewDue?: boolean;
}

export type EvidenceState = 'missing' | 'expired' | 'expiring' | 'current';

@Injectable()
export class ControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
  ) {}

  async list(query: ControlListQuery) {
    const organizationId = requireOrgId();
    const now = new Date();
    const where: Prisma.ControlWhereInput = {
      organizationId,
      active: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.q ? { OR: [{ controlCode: { contains: query.q, mode: 'insensitive' } }, { title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.status || query.ownerId || query.reviewDue
        ? {
            implementations: {
              some: {
                organizationId,
                ...(query.status ? { status: { in: query.status } } : {}),
                ...(query.ownerId ? { ownerId: query.ownerId } : {}),
                ...(query.reviewDue ? { nextReviewAt: { lte: now } } : {}),
              },
            },
          }
        : {}),
      ...(query.frameworkId || query.requirementId
        ? {
            mappings: {
              some: {
                ...(query.requirementId ? { sourceRequirementId: query.requirementId } : {}),
                ...(query.frameworkId ? { sourceRequirementRef: { frameworkId: query.frameworkId } } : {}),
                reviewStatus: { not: 'rejected' },
              },
            },
          }
        : {}),
    };

    // Filters on derived state (latest test, evidence currency) are computed, then paged in memory over ids.
    const derivedFilter = !!(query.testResult || query.evidence);
    const sortable = query.sort === 'controlCode' || query.sort === 'title' || query.sort === 'category' || query.sort === 'updatedAt';
    const orderBy = sortable ? { [query.sort]: query.order } : { controlCode: 'asc' as const };
    const baseRows = await this.prisma.control.findMany({
      where,
      orderBy,
      ...(derivedFilter ? {} : pageArgs({ ...query, sort: 'controlCode' })),
      include: { implementations: { where: { organizationId }, include: { ownerRef: { select: { id: true, displayName: true } } } } },
    });
    const total = derivedFilter ? undefined : await this.prisma.control.count({ where });
    const ids = baseRows.map((c) => c.id);
    const [latestTests, evidenceStates, openFindings] = await Promise.all([
      this.latestTests(organizationId, ids),
      this.evidenceStates(organizationId, ids, now),
      this.prisma.finding.groupBy({ by: ['controlId'], where: { organizationId, controlId: { in: ids }, status: { notIn: ['closed', 'accepted'] } }, _count: true }),
    ]);
    const findingsByControl = new Map(openFindings.map((f) => [f.controlId, f._count]));
    let rows = baseRows.map(({ implementations, ...c }) => {
      const impl = implementations[0];
      return {
        ...c,
        implementation: impl ? { ...impl, owner: impl.ownerRef, ownerRef: undefined } : null,
        latestTest: latestTests.get(c.id) ?? null,
        evidenceState: evidenceStates.get(c.id) ?? 'missing',
        openFindings: findingsByControl.get(c.id) ?? 0,
      };
    });
    if (query.testResult) rows = rows.filter((r) => r.latestTest && query.testResult!.includes(r.latestTest.result));
    if (query.evidence) rows = rows.filter((r) => r.evidenceState === query.evidence);
    if (derivedFilter) {
      const start = (query.page - 1) * query.pageSize;
      return toPage(rows.slice(start, start + query.pageSize), rows.length, query);
    }
    return toPage(rows, total!, query);
  }

  categories() {
    return this.prisma.control
      .findMany({ where: { organizationId: requireOrgId(), active: true }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } })
      .then((rows) => rows.map((r) => r.category));
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const control = await this.prisma.control.findFirst({
      where: { id, organizationId },
      include: {
        implementations: { where: { organizationId }, include: { ownerRef: { select: { id: true, displayName: true, email: true } } } },
        mappings: {
          where: { OR: [{ organizationId }, { organizationId: null }] },
          include: { sourceRequirementRef: { include: { framework: { select: { id: true, name: true, version: true, key: true } } } } },
        },
        tests: { orderBy: { startedAt: 'desc' }, take: 25, include: { initiatedByRef: { select: { displayName: true } } } },
        testConfigs: true,
      },
    });
    if (!control) throw notFound('Control');
    const [evidence, risks, findings, history] = await Promise.all([
      this.prisma.evidenceLink.findMany({
        where: { organizationId, entityType: 'control', entityId: id },
        include: { evidence: { select: { id: true, title: true, expiresAt: true, reviewStatus: true, classification: true, collectedAt: true, archivedAt: true, storageKey: true } } },
      }),
      this.prisma.riskControl.findMany({ where: { organizationId, controlId: id }, include: { risk: { select: { id: true, riskKey: true, title: true, inherentRating: true, residualRating: true, status: true } } } }),
      this.prisma.finding.findMany({ where: { organizationId, controlId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, findingKey: true, title: true, severity: true, status: true, lastDetectedAt: true } }),
      this.prisma.auditEvent.findMany({
        where: { organizationId, entityId: { in: [id, ...control.implementations.map((i) => i.id)] } },
        orderBy: { timestamp: 'desc' },
        take: 50,
        include: { actorUserRef: { select: { displayName: true } } },
      }),
    ]);
    const { implementations, mappings, tests, ...rest } = control;
    const impl = implementations[0];
    return {
      ...rest,
      implementation: impl ? { ...impl, owner: impl.ownerRef, ownerRef: undefined } : null,
      frameworkReferences: mappings.map((m) => ({
        mappingId: m.id,
        mappingType: m.mappingType,
        reviewStatus: m.reviewStatus,
        isIllustrative: m.isIllustrative,
        confidence: m.confidence,
        rationale: m.rationale,
        requirement: { id: m.sourceRequirementRef.id, code: m.sourceRequirementRef.requirementCode, title: m.sourceRequirementRef.title, groupName: m.sourceRequirementRef.groupName },
        framework: m.sourceRequirementRef.framework,
      })),
      tests: tests.map(({ initiatedByRef, ...t }) => ({ ...t, initiatedByName: initiatedByRef?.displayName ?? (t.testType === 'automated' ? 'Scheduler' : null) })),
      evidence: evidence.map((e) => ({ linkId: e.id, linkReviewStatus: e.reviewStatus, purpose: e.purpose, ...e.evidence, hasFile: !!e.evidence.storageKey, storageKey: undefined, state: evidenceState(e.evidence.expiresAt, e.evidence.reviewStatus, new Date()) })),
      risks: risks.map((r) => ({ relationship: r.relationship, effectivenessRating: r.effectivenessRating, ...r.risk })),
      findings,
      history,
    };
  }

  async create(input: { controlCode: string; title: string; description: string; category: string; reviewFrequencyDays: number; ownerId?: string | null; isIllustrative?: boolean }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const exists = await tx.control.findFirst({ where: { organizationId, controlCode: input.controlCode } });
      if (exists) throw conflict(`Control code ${input.controlCode} already exists.`);
      await this.entities.assertMember(input.ownerId, tx);
      const control = await tx.control.create({
        data: {
          organizationId,
          controlCode: input.controlCode,
          title: input.title,
          description: input.description,
          category: input.category,
          reviewFrequencyDays: input.reviewFrequencyDays,
          isIllustrative: input.isIllustrative ?? false,
          createdBy: actorId(),
        },
      });
      await tx.controlImplementation.create({
        data: { organizationId, controlId: control.id, ownerId: input.ownerId ?? null, status: 'not_assessed', nextReviewAt: addDays(new Date(), input.reviewFrequencyDays) },
      });
      await this.audit.record({ action: 'control.created', entityType: 'control', entityId: control.id, after: input }, tx);
      return control;
    });
  }

  async update(id: string, version: number, input: { title?: string; description?: string; category?: string; reviewFrequencyDays?: number; active?: boolean }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const control = await tx.control.findFirst({ where: { id, organizationId } });
      if (!control) throw notFound('Control');
      if (control.version !== version) throw versionConflict();
      const updated = await tx.control.update({ where: { id }, data: { ...input, version: { increment: 1 }, updatedBy: actorId() } });
      await this.audit.record({ action: input.active === false ? 'control.retired' : 'control.updated', entityType: 'control', entityId: id, before: Object.fromEntries(Object.keys(input).map((k) => [k, (control as Record<string, unknown>)[k]])), after: input }, tx);
      return updated;
    });
  }

  /**
   * Implementation status, applicability (SoA), owner and review schedule.
   * Owner/schedule changes need control.assign; status changes need control.update (checked by the route).
   */
  async updateImplementation(
    controlId: string,
    input: {
      version: number;
      status?: ImplementationStatus;
      ownerId?: string | null;
      applicabilityRationale?: string | null;
      soaIncluded?: boolean;
      soaJustification?: string | null;
      implementationNotes?: string | null;
      nextReviewAt?: Date | null;
      markReviewed?: boolean;
      rationale?: string;
    },
  ) {
    const organizationId = requireOrgId();
    if (input.ownerId !== undefined || input.nextReviewAt !== undefined) assertPermission('control.assign');
    return this.prisma.tx(async (tx) => {
      const control = await tx.control.findFirst({ where: { id: controlId, organizationId } });
      if (!control) throw notFound('Control');
      const impl = await tx.controlImplementation.findUnique({ where: { organizationId_controlId: { organizationId, controlId } } });
      if (!impl) throw notFound('Control implementation');
      if (impl.version !== input.version) throw versionConflict();
      const status = input.status ?? impl.status;
      const applicability = input.applicabilityRationale !== undefined ? input.applicabilityRationale : impl.applicabilityRationale;
      if (status === 'not_applicable' && !applicability?.trim()) throw badRequest('rationale_required', 'Explain why this control is not applicable.');
      const soaIncluded = input.soaIncluded ?? impl.soaIncluded;
      const soaJustification = input.soaJustification !== undefined ? input.soaJustification : impl.soaJustification;
      if (!soaIncluded && !soaJustification?.trim()) throw badRequest('soa_justification_required', 'Statement of Applicability exclusions need a justification.');
      await this.entities.assertMember(input.ownerId, tx);
      const now = new Date();
      const updated = await tx.controlImplementation.update({
        where: { id: impl.id },
        data: {
          status: input.status,
          ownerId: input.ownerId,
          applicabilityRationale: input.applicabilityRationale,
          soaIncluded: input.soaIncluded,
          soaJustification: input.soaJustification,
          implementationNotes: input.implementationNotes,
          nextReviewAt: input.markReviewed ? addDays(now, control.reviewFrequencyDays) : input.nextReviewAt,
          lastReviewedAt: input.markReviewed ? now : undefined,
          version: { increment: 1 },
          updatedBy: actorId(),
        },
      });
      const changed = (['status', 'ownerId', 'applicabilityRationale', 'soaIncluded', 'soaJustification', 'implementationNotes', 'nextReviewAt', 'lastReviewedAt'] as const).filter(
        (k) => JSON.stringify(impl[k]) !== JSON.stringify(updated[k]),
      );
      await this.audit.record(
        {
          action: input.markReviewed ? 'control.reviewed' : changed.includes('ownerId') ? 'control.owner_changed' : changed.includes('status') ? 'control.status_changed' : 'control.implementation_updated',
          entityType: 'control',
          entityId: controlId,
          before: Object.fromEntries(changed.map((k) => [k, impl[k]])),
          after: Object.fromEntries(changed.map((k) => [k, updated[k]])),
          rationale: input.rationale,
        },
        tx,
      );
      return updated;
    });
  }

  /** Statement of Applicability (ISO/IEC 27001) view: every control with inclusion and justification. */
  async statementOfApplicability() {
    const organizationId = requireOrgId();
    const rows = await this.prisma.control.findMany({
      where: { organizationId, active: true },
      orderBy: { controlCode: 'asc' },
      include: {
        implementations: { where: { organizationId } },
        mappings: { where: { reviewStatus: { not: 'rejected' } }, include: { sourceRequirementRef: { include: { framework: { select: { key: true, name: true, version: true } } } } } },
      },
    });
    return rows.map((c) => ({
      controlId: c.id,
      controlCode: c.controlCode,
      title: c.title,
      included: c.implementations[0]?.soaIncluded ?? true,
      justification: c.implementations[0]?.soaJustification ?? null,
      implementationStatus: c.implementations[0]?.status ?? 'not_assessed',
      isoReferences: c.mappings.filter((m) => m.sourceRequirementRef.framework.key === 'iso-27001').map((m) => ({ code: m.sourceRequirementRef.requirementCode, reviewStatus: m.reviewStatus })),
    }));
  }

  templates() {
    return this.prisma.control.findMany({ where: { organizationId: null, active: true }, orderBy: { controlCode: 'asc' } });
  }

  /**
   * Copies a platform template into the organization's register, together with its requirement
   * mappings (as proposals pending review) and its suggested automated test rules.
   */
  async adoptTemplate(templateId: string) {
    const organizationId = requireOrgId();
    const template = await this.prisma.control.findFirst({ where: { id: templateId, organizationId: null }, include: { mappings: { where: { organizationId: null } } } });
    if (!template) throw notFound('Control template');
    const control = await this.create({
      controlCode: template.controlCode,
      title: template.title,
      description: template.description,
      category: template.category,
      reviewFrequencyDays: template.reviewFrequencyDays,
      isIllustrative: template.isIllustrative,
    });
    const config = (template.templateConfig ?? {}) as { rules?: Array<{ ruleKey: string; parameters: Record<string, unknown> }> };
    await this.prisma.tx(async (tx) => {
      for (const m of template.mappings) {
        await tx.controlMapping.create({
          data: {
            organizationId,
            sourceRequirementId: m.sourceRequirementId,
            controlId: control.id,
            mappingType: m.mappingType,
            rationale: m.rationale,
            confidence: m.confidence,
            reviewStatus: 'pending_review',
            isIllustrative: true,
            frameworkVersion: m.frameworkVersion,
            sourceReference: `Adopted from template ${template.controlCode}`,
            createdBy: actorId(),
          },
        });
      }
      for (const rule of config.rules ?? []) {
        await tx.controlTestConfig.create({
          data: { organizationId, controlId: control.id, ruleKey: rule.ruleKey, parameters: rule.parameters as Prisma.InputJsonValue, frequencyHours: 24, enabled: true, nextRunAt: new Date(), createdBy: actorId() },
        });
      }
      await this.audit.record({ action: 'control.template_adopted', entityType: 'control', entityId: control.id, after: { template: template.controlCode, mappings: template.mappings.length, rules: (config.rules ?? []).map((r) => r.ruleKey) } }, tx);
    });
    return control;
  }

  async latestTests(organizationId: string, controlIds: string[]) {
    const tests = await this.prisma.controlTest.findMany({
      where: { organizationId, controlId: { in: controlIds } },
      orderBy: [{ controlId: 'asc' }, { startedAt: 'desc' }],
      distinct: ['controlId'],
      select: { controlId: true, result: true, startedAt: true, completedAt: true, summary: true, testType: true },
    });
    return new Map(tests.map((t) => [t.controlId, t]));
  }

  async evidenceStates(organizationId: string, controlIds: string[], now: Date, tx?: Tx): Promise<Map<string, EvidenceState>> {
    const links = await (tx ?? this.prisma).evidenceLink.findMany({
      where: { organizationId, entityType: 'control', entityId: { in: controlIds }, evidence: { archivedAt: null } },
      select: { entityId: true, evidence: { select: { expiresAt: true, reviewStatus: true } } },
    });
    const result = new Map<string, EvidenceState>();
    const rank: Record<EvidenceState, number> = { missing: 0, expired: 1, expiring: 2, current: 3 };
    for (const link of links) {
      const state = evidenceState(link.evidence.expiresAt, link.evidence.reviewStatus, now);
      const prev = result.get(link.entityId);
      if (!prev || rank[state] > rank[prev]) result.set(link.entityId, state);
    }
    return result;
  }
}

/** Rejected evidence never counts as current. */
export function evidenceState(expiresAt: Date | null, reviewStatus: string, now: Date): EvidenceState {
  if (reviewStatus === 'rejected') return 'missing';
  if (expiresAt && expiresAt <= now) return 'expired';
  if (expiresAt && expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 86_400_000) return 'expiring';
  return 'current';
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
