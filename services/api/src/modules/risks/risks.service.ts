import { Injectable } from '@nestjs/common';
import { badRequest, conflict, notFound, separationOfDuties, versionConflict } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { nextKey } from '../../common/keys.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { Prisma, RiskStatus, RiskTreatment, Severity } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DEFAULT_SETTINGS, type OrganizationSettings } from '../organizations/organizations.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';
import { computeRiskScores, ratingAtLeast, type Rating } from './risk-scoring.js';
import { ScoringPolicyService } from './scoring-policy.service.js';

export interface RiskInput {
  title: string;
  description: string;
  category: string;
  likelihood: number;
  impact: number;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  residualRationale?: string | null;
  riskOwnerId?: string | null;
  treatment?: RiskTreatment;
  treatmentPlan?: string | null;
  reviewDate?: Date | null;
  sourceType?: string;
  sourceId?: string | null;
}

export interface RiskListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  status?: RiskStatus[];
  rating?: Severity[];
  category?: string;
  ownerId?: string;
  sourceType?: string;
  linkedType?: string;
  linkedId?: string;
  likelihood?: number;
  impact?: number;
  residualLikelihood?: number;
  residualImpact?: number;
}

/** Fields whose changes are recorded in risk_history. */
const TRACKED = ['title', 'description', 'category', 'likelihood', 'impact', 'inherentScore', 'residualLikelihood', 'residualImpact', 'residualScore', 'riskOwnerId', 'status', 'treatment', 'treatmentPlan', 'reviewDate'] as const;

const STATUS_FLOW: Record<RiskStatus, RiskStatus[]> = {
  identified: ['assessed', 'treatment_planned', 'closed'],
  assessed: ['treatment_planned', 'in_treatment', 'monitoring', 'closed'],
  treatment_planned: ['in_treatment', 'assessed', 'closed'],
  in_treatment: ['monitoring', 'treatment_planned', 'closed'],
  monitoring: ['in_treatment', 'assessed', 'closed'],
  accepted: ['monitoring', 'in_treatment', 'assessed'], // acceptance is set only via an approved decision
  closed: ['assessed'],
};

@Injectable()
export class RisksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: ScoringPolicyService,
    private readonly entities: EntityResolver,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: RiskListQuery) {
    const organizationId = requireOrgId();
    const where: Prisma.RiskWhereInput = {
      organizationId,
      archivedAt: null,
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.rating ? { OR: [{ residualRating: { in: query.rating } }, { residualRating: null, inherentRating: { in: query.rating } }] } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.ownerId ? { riskOwnerId: query.ownerId } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.likelihood ? { likelihood: query.likelihood } : {}),
      ...(query.impact ? { impact: query.impact } : {}),
      ...(query.residualLikelihood ? { residualLikelihood: query.residualLikelihood } : {}),
      ...(query.residualImpact ? { residualImpact: query.residualImpact } : {}),
      ...(query.linkedType && query.linkedId ? { links: { some: { entityType: query.linkedType, entityId: query.linkedId } } } : {}),
      ...(query.q
        ? { AND: [{ OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { riskKey: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.risk.findMany({ where, ...pageArgs(query), include: { riskOwnerRef: { select: { id: true, displayName: true } } } }),
      this.prisma.risk.count({ where }),
    ]);
    return toPage(items.map(({ riskOwnerRef, ...r }) => ({ ...r, owner: riskOwnerRef })), total, query);
  }

  /** 5×5 likelihood × impact counts for the heatmap (inherent or residual factors). */
  async heatmap(basis: 'inherent' | 'residual') {
    const organizationId = requireOrgId();
    const rows = await this.prisma.risk.groupBy({
      by: basis === 'inherent' ? ['likelihood', 'impact'] : ['residualLikelihood', 'residualImpact'],
      where: { organizationId, archivedAt: null, status: { not: 'closed' }, ...(basis === 'residual' ? { residualLikelihood: { not: null } } : {}) },
      _count: true,
    });
    const { policy, version } = await this.policies.activeRisk();
    return {
      basis,
      policyVersion: version,
      tiers: policy.tiers,
      cells: rows.map((r) => ({
        likelihood: (basis === 'inherent' ? r.likelihood : r.residualLikelihood) as number,
        impact: (basis === 'inherent' ? r.impact : r.residualImpact) as number,
        count: r._count,
      })),
    };
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const risk = await this.prisma.risk.findFirst({
      where: { id, organizationId },
      include: {
        riskOwnerRef: { select: { id: true, displayName: true, email: true } },
        controls: { include: { controlRef: { select: { id: true, controlCode: true, title: true } } } },
        history: { orderBy: { changedAt: 'desc' }, take: 100, include: { risk: false } },
        acceptances: { orderBy: { requestedAt: 'desc' }, include: { requestedByRef: { select: { displayName: true } }, decidedByRef: { select: { displayName: true } } } },
        links: true,
      },
    });
    if (!risk) throw notFound('Risk');
    const [findings, linkLabels, evidence] = await Promise.all([
      this.prisma.finding.findMany({ where: { organizationId, riskId: id }, select: { id: true, findingKey: true, title: true, severity: true, status: true } }),
      Promise.all(risk.links.map(async (l) => ({ ...l, label: await this.entities.resolve(l.entityType, l.entityId).then((e) => e.label).catch(() => '(unavailable)') }))),
      this.prisma.evidenceLink.findMany({ where: { organizationId, entityType: 'risk', entityId: id }, include: { evidence: { select: { id: true, title: true, expiresAt: true, reviewStatus: true } } } }),
    ]);
    const { riskOwnerRef, ...rest } = risk;
    return {
      ...rest,
      owner: riskOwnerRef,
      controls: risk.controls.map(({ controlRef, ...c }) => ({ ...c, control: controlRef })),
      links: linkLabels,
      findings,
      evidence: evidence.map((e) => ({ linkId: e.id, ...e.evidence })),
    };
  }

  async create(input: RiskInput, tx?: Tx) {
    const run = async (db: Tx) => {
      const organizationId = requireOrgId();
      await this.entities.assertMember(input.riskOwnerId, db);
      const { version, policy } = await this.policies.activeRisk(db, organizationId);
      const scores = this.scores(input, policy);
      const riskKey = await nextKey(db, organizationId, 'RSK');
      const risk = await db.risk.create({
        data: {
          organizationId,
          riskKey,
          title: input.title,
          description: input.description,
          category: input.category,
          sourceType: input.sourceType ?? 'manual',
          sourceId: input.sourceId ?? null,
          likelihood: input.likelihood,
          impact: input.impact,
          residualLikelihood: input.residualLikelihood ?? null,
          residualImpact: input.residualImpact ?? null,
          residualRationale: input.residualRationale ?? null,
          ...scores,
          scoringPolicyVersion: version,
          riskOwnerId: input.riskOwnerId ?? null,
          treatment: input.treatment ?? 'undecided',
          treatmentPlan: input.treatmentPlan ?? null,
          reviewDate: input.reviewDate ?? null,
          status: 'identified',
          createdBy: actorId(),
        },
      });
      await db.riskHistory.create({
        data: { organizationId, riskId: risk.id, previousValues: {}, newValues: pick(risk) as Prisma.InputJsonValue, changedBy: actorId(), rationale: 'Risk created' },
      });
      await this.audit.record({ action: 'risk.created', entityType: 'risk', entityId: risk.id, after: pick(risk) }, db);
      if (input.riskOwnerId && input.riskOwnerId !== actorId()) {
        await this.notifications.notify(
          { organizationId, recipientUserIds: [input.riskOwnerId], eventType: 'finding.assigned', title: `You own risk ${riskKey}`, message: input.title, entityType: 'risk', entityId: risk.id },
          db,
        );
      }
      return risk;
    };
    return tx ? run(tx) : this.prisma.tx(run);
  }

  /** Optimistic concurrency: the caller sends the version it edited (spec §3.4). */
  async update(id: string, version: number, input: Partial<RiskInput> & { status?: RiskStatus }, rationale?: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const risk = await tx.risk.findFirst({ where: { id, organizationId } });
      if (!risk) throw notFound('Risk');
      if (risk.version !== version) throw versionConflict();
      if (input.status && input.status !== risk.status) {
        if (input.status === 'accepted') throw badRequest('use_acceptance_workflow', 'Risks are accepted only through an approved acceptance request.');
        if (!STATUS_FLOW[risk.status].includes(input.status)) throw conflict(`Cannot move a risk from "${risk.status}" to "${input.status}"`);
      }
      await this.entities.assertMember(input.riskOwnerId, tx);
      const { version: policyVersion, policy } = await this.policies.activeRisk(tx, organizationId);
      const merged = {
        likelihood: input.likelihood ?? risk.likelihood,
        impact: input.impact ?? risk.impact,
        residualLikelihood: input.residualLikelihood !== undefined ? input.residualLikelihood : risk.residualLikelihood,
        residualImpact: input.residualImpact !== undefined ? input.residualImpact : risk.residualImpact,
      };
      const scores = this.scores(merged, policy);
      const scoreChanged = scores.inherentScore !== risk.inherentScore || scores.residualScore !== risk.residualScore;
      const updated = await tx.risk.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          category: input.category,
          ...merged,
          ...scores,
          residualRationale: input.residualRationale,
          scoringPolicyVersion: policyVersion,
          riskOwnerId: input.riskOwnerId,
          treatment: input.treatment,
          treatmentPlan: input.treatmentPlan,
          reviewDate: input.reviewDate,
          status: input.status,
          version: { increment: 1 },
          updatedBy: actorId(),
        },
      });
      const before = pick(risk);
      const after = pick(updated);
      const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length) {
        await tx.riskHistory.create({
          data: {
            organizationId,
            riskId: id,
            previousValues: Object.fromEntries(changed.map((k) => [k, before[k]])) as Prisma.InputJsonValue,
            newValues: Object.fromEntries(changed.map((k) => [k, after[k]])) as Prisma.InputJsonValue,
            changedBy: actorId(),
            rationale: rationale ?? null,
          },
        });
        await this.audit.record({ action: scoreChanged ? 'risk.rescored' : 'risk.updated', entityType: 'risk', entityId: id, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])), rationale }, tx);
      }
      // A material change invalidates an existing acceptance (spec §6.4): require re-review.
      if (risk.status === 'accepted' && scoreChanged) {
        await tx.risk.update({ where: { id }, data: { status: 'assessed', acceptedAt: null, acceptedBy: null, acceptanceExpiresAt: null } });
        await tx.riskAcceptance.updateMany({ where: { riskId: id, decision: 'approved' }, data: { decision: 'expired' } });
        await this.audit.record({ action: 'risk.acceptance_invalidated', entityType: 'risk', entityId: id, rationale: 'Risk score changed materially; acceptance requires re-review' }, tx);
      }
      return tx.risk.findUniqueOrThrow({ where: { id } });
    });
  }

  async archive(id: string, rationale: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const risk = await tx.risk.findFirst({ where: { id, organizationId, archivedAt: null } });
      if (!risk) throw notFound('Risk');
      await tx.risk.update({ where: { id }, data: { archivedAt: new Date(), status: 'closed', version: { increment: 1 } } });
      await this.audit.record({ action: 'risk.archived', entityType: 'risk', entityId: id, rationale }, tx);
    });
  }

  async linkControl(riskId: string, input: { controlId: string; relationship: string; effectivenessRating: string; rationale?: string }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      await this.mustGet(tx, riskId);
      await this.entities.resolve('control', input.controlId, tx);
      const link = await tx.riskControl.upsert({
        where: { riskId_controlId: { riskId, controlId: input.controlId } },
        create: { organizationId, riskId, ...input, createdBy: actorId() },
        update: { relationship: input.relationship, effectivenessRating: input.effectivenessRating, rationale: input.rationale },
      });
      await this.audit.record({ action: 'risk.control_linked', entityType: 'risk', entityId: riskId, after: input }, tx);
      return link;
    });
  }

  async unlinkControl(riskId: string, controlId: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const result = await tx.riskControl.deleteMany({ where: { organizationId, riskId, controlId } });
      if (!result.count) throw notFound('Risk control link');
      await this.audit.record({ action: 'risk.control_unlinked', entityType: 'risk', entityId: riskId, before: { controlId } }, tx);
    });
  }

  async linkEntity(riskId: string, entityType: string, entityId: string, tx?: Tx) {
    const run = async (db: Tx) => {
      const organizationId = requireOrgId();
      await this.mustGet(db, riskId);
      await this.entities.resolve(entityType, entityId, db);
      const link = await db.riskLink.upsert({
        where: { riskId_entityType_entityId: { riskId, entityType, entityId } },
        create: { organizationId, riskId, entityType, entityId, createdBy: actorId() },
        update: {},
      });
      await this.audit.record({ action: 'risk.entity_linked', entityType: 'risk', entityId: riskId, after: { entityType, entityId } }, db);
      return link;
    };
    return tx ? run(tx) : this.prisma.tx(run);
  }

  // ── Risk acceptance (spec §6.4): a request is not an approval ──

  async requestAcceptance(riskId: string, input: { rationale: string; scope?: string; expiryDate: Date }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const risk = await this.mustGet(tx, riskId);
      const { policy } = await this.policies.activeRisk(tx, organizationId);
      const maxExpiry = Date.now() + policy.acceptanceMaxDays * 86_400_000;
      if (input.expiryDate.getTime() <= Date.now()) throw badRequest('invalid_expiry', 'Expiry must be in the future');
      if (input.expiryDate.getTime() > maxExpiry) throw badRequest('expiry_too_long', `Acceptance may last at most ${policy.acceptanceMaxDays} days`);
      const pending = await tx.riskAcceptance.count({ where: { riskId, decision: 'pending' } });
      if (pending) throw conflict('An acceptance request is already pending for this risk.');
      const request = await tx.riskAcceptance.create({
        data: {
          organizationId,
          riskId,
          requestedBy: requireUserId(),
          rationale: input.rationale,
          scope: input.scope,
          expiryDate: input.expiryDate,
          riskScoreAtRequest: risk.residualScore ?? risk.inherentScore,
        },
      });
      await this.audit.record({ action: 'risk.acceptance_requested', entityType: 'risk_acceptance', entityId: request.id, after: { riskId, expiryDate: input.expiryDate }, rationale: input.rationale }, tx);
      const approvers = await this.notifications.usersWithRoles(organizationId, ['grc_manager'], tx);
      await this.notifications.notify(
        { organizationId, recipientUserIds: approvers.filter((u) => u !== requireUserId()), eventType: 'risk_acceptance.requested', title: `Acceptance requested for ${risk.riskKey}`, message: risk.title, entityType: 'risk', entityId: riskId },
        tx,
      );
      return request;
    });
  }

  async decideAcceptance(acceptanceId: string, decision: 'approved' | 'rejected', rationale: string) {
    const organizationId = requireOrgId();
    const userId = requireUserId();
    return this.prisma.tx(async (tx) => {
      const request = await tx.riskAcceptance.findFirst({ where: { id: acceptanceId, organizationId }, include: { risk: true } });
      if (!request) throw notFound('Acceptance request');
      if (request.decision !== 'pending') throw conflict('This request has already been decided.');
      const risk = request.risk;
      const rating = (risk.residualRating ?? risk.inherentRating) as Rating;
      const { policy } = await this.policies.activeRisk(tx, organizationId);
      const settings = await this.settings(tx, organizationId);
      const sodApplies = settings.requireSeparationOfDutiesForHighRisk && ratingAtLeast(rating, policy.sodRequiredFrom);
      const selfInvolved = request.requestedBy === userId || risk.riskOwnerId === userId;
      if (selfInvolved && (sodApplies || !settings.allowSelfApprovalForLowRisk)) {
        throw separationOfDuties('You cannot decide an acceptance you requested or for a risk you own.');
      }
      // Conditional update guards against two approvers racing (spec §15 threat: race conditions in approvals).
      const updated = await tx.riskAcceptance.updateMany({
        where: { id: acceptanceId, decision: 'pending' },
        data: { decision, decidedBy: userId, decidedAt: new Date(), decisionRationale: rationale },
      });
      if (updated.count !== 1) throw conflict('This request has already been decided.');
      if (decision === 'approved') {
        await tx.risk.update({
          where: { id: risk.id },
          data: {
            status: 'accepted',
            treatment: 'accept',
            acceptanceRationale: request.rationale,
            acceptedBy: userId,
            acceptedAt: new Date(),
            acceptanceExpiresAt: request.expiryDate,
            reviewDate: request.expiryDate,
            version: { increment: 1 },
          },
        });
        await tx.riskHistory.create({
          data: { organizationId, riskId: risk.id, previousValues: { status: risk.status }, newValues: { status: 'accepted', acceptanceExpiresAt: request.expiryDate }, changedBy: userId, rationale },
        });
      }
      await this.audit.record({ action: `risk.acceptance_${decision}`, entityType: 'risk_acceptance', entityId: acceptanceId, after: { riskId: risk.id, decision, rating }, rationale }, tx);
      await this.notifications.notify(
        { organizationId, recipientUserIds: [request.requestedBy, risk.riskOwnerId], eventType: 'risk_acceptance.decided', title: `Acceptance ${decision} for ${risk.riskKey}`, message: rationale, entityType: 'risk', entityId: risk.id },
        tx,
      );
      return tx.riskAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
    });
  }

  async withdrawAcceptance(acceptanceId: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const result = await tx.riskAcceptance.updateMany({ where: { id: acceptanceId, organizationId, decision: 'pending', requestedBy: requireUserId() }, data: { decision: 'withdrawn' } });
      if (!result.count) throw notFound('Pending acceptance request');
      await this.audit.record({ action: 'risk.acceptance_withdrawn', entityType: 'risk_acceptance', entityId: acceptanceId }, tx);
    });
  }

  listAcceptances(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; decision?: string[] }) {
    const where: Prisma.RiskAcceptanceWhereInput = { organizationId: requireOrgId(), ...(query.decision ? { decision: { in: query.decision as never[] } } : {}) };
    return Promise.all([
      this.prisma.riskAcceptance.findMany({
        where,
        ...pageArgs(query),
        include: { risk: { select: { id: true, riskKey: true, title: true, inherentRating: true, residualRating: true, riskOwnerId: true } }, requestedByRef: { select: { displayName: true } }, decidedByRef: { select: { displayName: true } } },
      }),
      this.prisma.riskAcceptance.count({ where }),
    ]).then(([items, total]) => toPage(items, total, query));
  }

  /** Called by the worker: lapsed acceptances expire and the risk returns to review. */
  async expireAcceptances(tx: Tx, organizationId: string, now = new Date()) {
    const lapsed = await tx.risk.findMany({ where: { organizationId, status: 'accepted', acceptanceExpiresAt: { lt: now } } });
    for (const risk of lapsed) {
      await tx.risk.update({ where: { id: risk.id }, data: { status: 'assessed', version: { increment: 1 } } });
      await tx.riskAcceptance.updateMany({ where: { riskId: risk.id, decision: 'approved' }, data: { decision: 'expired' } });
      await tx.riskHistory.create({ data: { organizationId, riskId: risk.id, previousValues: { status: 'accepted' }, newValues: { status: 'assessed' }, rationale: 'Risk acceptance expired; re-review required' } });
      await this.audit.record({ action: 'risk.acceptance_expired', entityType: 'risk', entityId: risk.id, organizationId, actorUserId: null }, tx);
    }
    return lapsed;
  }

  private scores(input: { likelihood: number; impact: number; residualLikelihood?: number | null; residualImpact?: number | null }, policy: Parameters<typeof computeRiskScores>[1]) {
    try {
      return computeRiskScores(input, policy);
    } catch (error) {
      throw badRequest('invalid_score', (error as Error).message);
    }
  }

  private async mustGet(tx: Tx, id: string) {
    const risk = await tx.risk.findFirst({ where: { id, organizationId: requireOrgId(), archivedAt: null } });
    if (!risk) throw notFound('Risk');
    return risk;
  }


  private async settings(tx: Tx, organizationId: string): Promise<Required<OrganizationSettings>> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return { ...DEFAULT_SETTINGS, ...(org.settings as OrganizationSettings) };
  }
}

function pick(risk: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(TRACKED.map((k) => [k, risk[k] instanceof Date ? (risk[k] as Date).toISOString() : (risk[k] ?? null)]));
}

