import { Injectable } from '@nestjs/common';
import { AppError, badRequest, conflict, invalidTransition, notFound, separationOfDuties, versionConflict } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { AiLifecycleStatus, AiRiskTier, LegalReviewStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';

export interface AiSystemInput {
  name: string;
  description: string;
  businessPurpose: string;
  businessJustification?: string | null;
  businessOwnerId?: string | null;
  technicalOwnerId?: string | null;
  riskOwnerId?: string | null;
  providerVendorId?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  deploymentType: string;
  deploymentEnvironment?: string | null;
  intendedUsers?: string | null;
  affectedPeople?: string | null;
  inputDataCategories: string[];
  outputDataCategories: string[];
  personalDataProcessed: boolean;
  sensitiveDataProcessed: boolean;
  dataRetention?: string | null;
  dataLocation?: string | null;
  automatedDecisionMaking: boolean;
  influencesDecisionsAboutPeople: boolean;
  humanOversight?: string | null;
  overrideAndAppeal?: string | null;
  escalationPath?: string | null;
  externalDependencies?: string | null;
  knownLimitations?: string | null;
  foreseeableMisuse?: string | null;
  rollbackPlan?: string | null;
  deploymentDate?: Date | null;
  retirementDate?: Date | null;
  nextReviewAt?: Date | null;
  documentationUri?: string | null;
}

/**
 * Manual lifecycle moves (spec §10.1). Approvals for pilot and production go only through
 * `approveDeployment`, which enforces the §10.5 preconditions.
 */
const LIFECYCLE: Record<AiLifecycleStatus, AiLifecycleStatus[]> = {
  proposed: ['under_assessment', 'retired'],
  under_assessment: ['proposed', 'retired'],
  approved_for_pilot: ['pilot', 'under_assessment', 'retired'],
  pilot: ['under_assessment', 'suspended', 'retired'],
  approved_for_production: ['production', 'under_assessment', 'retired'],
  production: ['suspended', 'under_assessment', 'retired'],
  suspended: ['under_assessment', 'retired'],
  retired: [],
};

/** Material changes to a deployed system require reassessment (spec §10.4). */
const MATERIAL = ['modelName', 'modelVersion', 'providerVendorId', 'businessPurpose', 'influencesDecisionsAboutPeople', 'personalDataProcessed', 'sensitiveDataProcessed', 'automatedDecisionMaking'] as const;
const DEPLOYED: AiLifecycleStatus[] = ['approved_for_pilot', 'pilot', 'approved_for_production', 'production'];

@Injectable()
export class AiSystemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly events: EventQueue,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string; lifecycleStatus?: AiLifecycleStatus[]; riskTier?: AiRiskTier[]; reviewDue?: boolean }) {
    const where: Prisma.AiSystemWhereInput = {
      organizationId: requireOrgId(),
      ...(query.lifecycleStatus ? { lifecycleStatus: { in: query.lifecycleStatus } } : {}),
      ...(query.riskTier ? { riskTier: { in: query.riskTier } } : {}),
      ...(query.reviewDue ? { nextReviewAt: { lte: new Date(Date.now() + 30 * 86_400_000) } } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { modelName: { contains: query.q, mode: 'insensitive' } }, { businessPurpose: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.aiSystem.findMany({
        where,
        ...pageArgs(query),
        include: { businessOwnerRef: { select: { displayName: true } }, providerVendorRef: { select: { id: true, name: true } }, _count: { select: { assessments: true, incidents: true } } },
      }),
      this.prisma.aiSystem.count({ where }),
    ]);
    return toPage(items.map(({ businessOwnerRef, providerVendorRef, ...s }) => ({ ...s, businessOwner: businessOwnerRef, providerVendor: providerVendorRef })), total, query);
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const system = await this.prisma.aiSystem.findFirst({
      where: { id, organizationId },
      include: {
        businessOwnerRef: { select: { id: true, displayName: true } },
        technicalOwnerRef: { select: { id: true, displayName: true } },
        riskOwnerRef: { select: { id: true, displayName: true } },
        providerVendorRef: { select: { id: true, name: true, riskTier: true, status: true } },
        assessments: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, assessmentVersion: true, riskTier: true, submittedAt: true, approvedAt: true, createdAt: true } },
        evaluations: { orderBy: { executedAt: 'desc' }, take: 20 },
        incidents: { orderBy: { detectedAt: 'desc' }, take: 20 },
        changes: { orderBy: { createdAt: 'desc' }, take: 20 },
        euAiAct: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });
    if (!system) throw notFound('AI system');
    const [risks, findings, evidence, history] = await Promise.all([
      this.prisma.riskLink.findMany({ where: { organizationId, entityType: 'ai_system', entityId: id }, include: { risk: { select: { id: true, riskKey: true, title: true, inherentRating: true, residualRating: true, status: true } } } }),
      this.prisma.finding.findMany({ where: { organizationId, OR: [{ sourceType: 'ai_assessment', sourceId: { in: system.assessments.map((a) => a.id) } }, { sourceType: 'ai_incident', sourceId: { in: system.incidents.map((i) => i.id) } }] }, select: { id: true, findingKey: true, title: true, severity: true, status: true } }),
      this.prisma.evidenceLink.findMany({ where: { organizationId, entityType: 'ai_system', entityId: id }, include: { evidence: { select: { id: true, title: true, reviewStatus: true, expiresAt: true } } } }),
      this.prisma.auditEvent.findMany({ where: { organizationId, entityType: 'ai_system', entityId: id }, orderBy: { timestamp: 'desc' }, take: 50, include: { actorUserRef: { select: { displayName: true } } } }),
    ]);
    const { businessOwnerRef, technicalOwnerRef, riskOwnerRef, providerVendorRef, euAiAct, ...rest } = system;
    return {
      ...rest,
      businessOwner: businessOwnerRef,
      technicalOwner: technicalOwnerRef,
      riskOwner: riskOwnerRef,
      providerVendor: providerVendorRef,
      euAiAct: euAiAct[0] ?? null,
      risks: risks.map((r) => r.risk),
      findings,
      evidence: evidence.map((e) => ({ linkId: e.id, ...e.evidence })),
      history: history.map(({ actorUserRef, ...h }) => ({ ...h, actor: actorUserRef })),
      allowedTransitions: LIFECYCLE[system.lifecycleStatus],
      deploymentReadiness: await this.readiness(system.id, organizationId),
    };
  }

  async create(input: AiSystemInput) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      for (const u of [input.businessOwnerId, input.technicalOwnerId, input.riskOwnerId]) await this.entities.assertMember(u, tx);
      if (input.providerVendorId) await this.entities.resolve('vendor', input.providerVendorId, tx);
      if (await tx.aiSystem.findFirst({ where: { organizationId, name: { equals: input.name, mode: 'insensitive' } } })) throw conflict('An AI system with this name already exists.');
      const system = await tx.aiSystem.create({ data: { organizationId, ...input, lifecycleStatus: 'proposed', createdBy: actorId() } });
      await this.audit.record({ action: 'ai_system.created', entityType: 'ai_system', entityId: system.id, after: { name: system.name, deploymentType: system.deploymentType, providerVendorId: system.providerVendorId } }, tx);
      await this.events.emit(tx, organizationId, 'ai_system.created', { aiSystemId: system.id }, `ai-system-created:${system.id}`);
      return system;
    });
  }

  async update(id: string, version: number, input: Partial<AiSystemInput>, rationale?: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const system = await tx.aiSystem.findFirst({ where: { id, organizationId } });
      if (!system) throw notFound('AI system');
      if (system.version !== version) throw versionConflict();
      for (const u of [input.businessOwnerId, input.technicalOwnerId, input.riskOwnerId]) await this.entities.assertMember(u, tx);
      if (input.providerVendorId) await this.entities.resolve('vendor', input.providerVendorId, tx);
      const material = MATERIAL.filter((k) => k in input && JSON.stringify((input as Record<string, unknown>)[k]) !== JSON.stringify(system[k]));
      const reassess = material.length > 0 && DEPLOYED.includes(system.lifecycleStatus);
      const updated = await tx.aiSystem.update({ where: { id }, data: { ...input, version: { increment: 1 }, ...(reassess ? { nextReviewAt: new Date() } : {}) } });
      const changed = Object.keys(input).filter((k) => JSON.stringify((input as Record<string, unknown>)[k]) !== JSON.stringify((system as Record<string, unknown>)[k]));
      await this.audit.record(
        { action: reassess ? 'ai_system.material_change' : 'ai_system.updated', entityType: 'ai_system', entityId: id, before: Object.fromEntries(changed.map((k) => [k, (system as Record<string, unknown>)[k]])), after: { ...Object.fromEntries(changed.map((k) => [k, (input as Record<string, unknown>)[k]])), ...(reassess ? { reassessmentRequired: material } : {}) }, rationale },
        tx,
      );
      return updated;
    });
  }

  async transition(id: string, to: AiLifecycleStatus, rationale: string) {
    const organizationId = requireOrgId();
    if (to === 'approved_for_pilot' || to === 'approved_for_production') throw badRequest('use_deployment_approval', 'Use deployment approval to approve for pilot or production.');
    return this.prisma.tx(async (tx) => {
      const system = await tx.aiSystem.findFirst({ where: { id, organizationId } });
      if (!system) throw notFound('AI system');
      if (!LIFECYCLE[system.lifecycleStatus].includes(to)) throw invalidTransition(system.lifecycleStatus, to);
      const updated = await tx.aiSystem.update({ where: { id }, data: { lifecycleStatus: to, version: { increment: 1 }, ...(to === 'retired' ? { retirementDate: system.retirementDate ?? new Date() } : {}), ...(to === 'production' && !system.deploymentDate ? { deploymentDate: new Date() } : {}) } });
      await this.audit.record({ action: 'ai_system.lifecycle_changed', entityType: 'ai_system', entityId: id, before: { lifecycleStatus: system.lifecycleStatus }, after: { lifecycleStatus: to }, rationale }, tx);
      return updated;
    });
  }

  /** Every §10.5 precondition, evaluated without side effects (also shown in the UI). */
  async readiness(id: string, organizationId = requireOrgId()) {
    const system = await this.prisma.aiSystem.findFirstOrThrow({ where: { id, organizationId } });
    const latest = await this.prisma.aiAssessment.findFirst({ where: { organizationId, aiSystemId: id }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const requiredOpen = latest ? latest.items.filter((i) => i.required && i.result === 'not_answered').length : null;
    const evidence = await this.prisma.evidenceLink.findMany({
      where: { organizationId, OR: [{ entityType: 'ai_system', entityId: id }, ...(latest ? [{ entityType: 'ai_assessment_item', entityId: { in: latest.items.map((i) => i.id) } }] : [])] },
      select: { evidence: { select: { reviewStatus: true, archivedAt: true } } },
    });
    const criticalOpen = await this.prisma.finding.count({
      where: { organizationId, severity: 'critical', status: { notIn: ['closed', 'accepted'] }, OR: [{ sourceType: 'ai_assessment', sourceId: latest?.id ?? '00000000-0000-0000-0000-000000000000' }, { sourceType: 'ai_incident', sourceId: { in: (await this.prisma.aiIncident.findMany({ where: { organizationId, aiSystemId: id }, select: { id: true } })).map((i) => i.id) } }] },
    });
    const unsatisfactory = latest?.items.filter((i) => i.result === 'unsatisfactory').length ?? 0;
    const linkedRisks = await this.prisma.riskLink.findMany({ where: { organizationId, entityType: 'ai_system', entityId: id }, include: { risk: { select: { residualScore: true, residualRating: true, status: true } } } });
    const checks = [
      { key: 'assessment_approved', label: 'Latest risk assessment approved', ok: latest?.status === 'approved' },
      { key: 'assessment_complete', label: 'All required assessment items completed', ok: requiredOpen === 0 },
      { key: 'evidence_reviewed', label: 'At least one supporting evidence item reviewed and approved', ok: evidence.some((e) => e.evidence.reviewStatus === 'approved' && !e.evidence.archivedAt) },
      { key: 'owners', label: 'Business owner and risk owner assigned', ok: !!system.businessOwnerId && !!system.riskOwnerId },
      { key: 'no_open_critical_findings', label: 'No open critical findings', ok: criticalOpen === 0 },
      { key: 'residual_risk_documented', label: 'Residual risk documented for unsatisfactory items (linked, assessed risk)', ok: unsatisfactory === 0 || linkedRisks.some((r) => r.risk.residualScore !== null) },
      { key: 'human_oversight', label: 'Human oversight and override documented', ok: !!system.humanOversight?.trim() },
      { key: 'rollback_plan', label: 'Rollback plan documented', ok: !!system.rollbackPlan?.trim() },
    ];
    return { ready: checks.every((c) => c.ok), checks, latestAssessmentId: latest?.id ?? null, latestAssessmentApprovedBy: latest?.approvedBy ?? null, latestAssessmentSubmittedBy: latest?.submittedBy ?? null };
  }

  /** Deployment approval (spec §10.5). The approver must differ from whoever requested/submitted the assessment. */
  async approveDeployment(id: string, input: { target: 'pilot' | 'production'; rationale: string; nextReviewAt: Date }) {
    const organizationId = requireOrgId();
    const userId = requireUserId();
    const system = await this.prisma.aiSystem.findFirst({ where: { id, organizationId } });
    if (!system) throw notFound('AI system');
    const allowedFrom: AiLifecycleStatus[] = input.target === 'pilot' ? ['under_assessment', 'proposed', 'suspended'] : ['under_assessment', 'pilot', 'approved_for_pilot', 'suspended'];
    if (!allowedFrom.includes(system.lifecycleStatus)) throw invalidTransition(system.lifecycleStatus, `approved_for_${input.target}`);
    const readiness = await this.readiness(id, organizationId);
    if (!readiness.ready) throw new AppError(409, 'not_ready', 'Deployment preconditions are not met.', { failing: readiness.checks.filter((c) => !c.ok).map((c) => c.key) });
    if (readiness.latestAssessmentSubmittedBy === userId || system.createdBy === userId) throw separationOfDuties('Deployment must be approved by someone other than the requester.');
    if (input.nextReviewAt <= new Date()) throw badRequest('invalid_review_date', 'Set a future review date.');
    const status: AiLifecycleStatus = input.target === 'pilot' ? 'approved_for_pilot' : 'approved_for_production';
    return this.prisma.tx(async (tx) => {
      const updated = await tx.aiSystem.updateMany({ where: { id, version: system.version }, data: { lifecycleStatus: status, approvedBy: userId, approvedAt: new Date(), nextReviewAt: input.nextReviewAt, version: { increment: 1 } } });
      if (updated.count !== 1) throw versionConflict();
      await this.audit.record({ action: 'ai_system.deployment_approved', entityType: 'ai_system', entityId: id, before: { lifecycleStatus: system.lifecycleStatus }, after: { lifecycleStatus: status, nextReviewAt: input.nextReviewAt, checks: readiness.checks.map((c) => c.key) }, rationale: input.rationale }, tx);
      return tx.aiSystem.findUniqueOrThrow({ where: { id } });
    });
  }

  /** EU AI Act applicability record — preliminary until legal review (spec §10.3). */
  async saveEuAiAct(
    id: string,
    input: {
      organizationRole?: string | null;
      systemRole?: string | null;
      intendedPurpose?: string | null;
      geographicScope?: string | null;
      placedOnEuMarket?: boolean | null;
      checklist: Record<string, unknown>;
      potentialProhibitedPractice?: boolean | null;
      potentialHighRisk?: boolean | null;
      transparencyObligations?: boolean | null;
      preliminaryClassification: AiRiskTier;
      rationale?: string | null;
      evidenceIds?: string[];
      legalReviewStatus: LegalReviewStatus;
      sourceUrl?: string | null;
      sourceCheckedAt?: Date | null;
    },
  ) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const system = await tx.aiSystem.findFirst({ where: { id, organizationId } });
      if (!system) throw notFound('AI system');
      for (const e of input.evidenceIds ?? []) await this.entities.assertEvidence(e, tx);
      const existing = await tx.euAiActApplicability.findFirst({ where: { organizationId, aiSystemId: id }, orderBy: { updatedAt: 'desc' } });
      const data = { ...input, checklist: input.checklist as Prisma.InputJsonValue, evidenceIds: input.evidenceIds ?? [], reviewerId: actorId(), reviewDate: new Date() };
      const record = existing
        ? await tx.euAiActApplicability.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.euAiActApplicability.create({ data: { organizationId, aiSystemId: id, ...data, createdBy: actorId() } });
      if (input.preliminaryClassification !== 'undetermined' && system.riskTier !== input.preliminaryClassification) {
        await tx.aiSystem.update({ where: { id }, data: { riskTier: input.preliminaryClassification, version: { increment: 1 } } });
      }
      await this.audit.record({ action: 'ai_system.eu_ai_act_assessed', entityType: 'ai_system', entityId: id, after: { preliminaryClassification: input.preliminaryClassification, legalReviewStatus: input.legalReviewStatus, potentialHighRisk: input.potentialHighRisk ?? null, potentialProhibitedPractice: input.potentialProhibitedPractice ?? null }, rationale: input.rationale }, tx);
      return { ...record, notice: 'Preliminary applicability assessment. Not a legal determination; requires review by a qualified legal or compliance professional.' };
    });
  }

  /** Configurable EU AI Act obligation schedule from the imported framework (dated and sourced). */
  async euAiActSchedule() {
    const fw = await this.prisma.framework.findFirst({ where: { key: 'eu-ai-act', organizationId: null }, orderBy: { importedAt: 'desc' } });
    const provenance = (fw?.importProvenance ?? {}) as { obligationSchedule?: unknown };
    return { framework: fw ? { id: fw.id, version: fw.version, sourceUrl: fw.sourceUrl } : null, schedule: provenance.obligationSchedule ?? null };
  }
}

