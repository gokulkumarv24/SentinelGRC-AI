import { Injectable } from '@nestjs/common';
import { AppError, badRequest, conflict, notFound, separationOfDuties } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { AiAssessmentStatus, AiItemResult, AiRiskTier, Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FindingsService } from '../findings/findings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RisksService } from '../risks/risks.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';

const OPEN: AiAssessmentStatus[] = ['draft', 'in_progress', 'submitted'];
const TIER_IMPACT: Record<AiRiskTier, number> = { minimal: 2, limited: 3, high: 4, unacceptable: 5, undetermined: 3 };

/**
 * AI risk assessments (spec §10.2): versioned template items organized by NIST AI RMF function.
 * Unsatisfactory items create or link a shared enterprise risk; approval needs a different person.
 */
@Injectable()
export class AiAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly risks: RisksService,
    private readonly findings: FindingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; status?: AiAssessmentStatus[]; aiSystemId?: string; q?: string }) {
    const where: Prisma.AiAssessmentWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.aiSystemId ? { aiSystemId: query.aiSystemId } : {}),
      ...(query.q ? { aiSystem: { name: { contains: query.q, mode: 'insensitive' } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.aiAssessment.findMany({ where, ...pageArgs(query), include: { aiSystem: { select: { id: true, name: true, lifecycleStatus: true } }, items: { select: { result: true, required: true } } } }),
      this.prisma.aiAssessment.count({ where }),
    ]);
    return toPage(
      items.map(({ items: its, ...a }) => ({ ...a, progress: { answered: its.filter((i) => i.result !== 'not_answered').length, total: its.length, unsatisfactory: its.filter((i) => i.result === 'unsatisfactory').length } })),
      total,
      query,
    );
  }

  async create(aiSystemId: string, input: { templateId: string; frameworkId?: string | null; assessorId?: string | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const system = await tx.aiSystem.findFirst({ where: { id: aiSystemId, organizationId } });
      if (!system) throw notFound('AI system');
      if (system.lifecycleStatus === 'retired') throw conflict('This AI system is retired.');
      if (await tx.aiAssessment.findFirst({ where: { organizationId, aiSystemId, status: { in: OPEN } } })) throw conflict('This AI system already has an open assessment.');
      const template = await tx.assessmentTemplate.findFirst({ where: { id: input.templateId, purpose: 'ai_system', active: true, OR: [{ organizationId: null }, { organizationId }] }, include: { questions: { orderBy: { sortOrder: 'asc' } } } });
      if (!template) throw notFound('AI assessment template');
      let frameworkId = input.frameworkId ?? null;
      if (!frameworkId) frameworkId = (await tx.framework.findFirst({ where: { key: 'nist-ai-rmf', organizationId: null }, orderBy: { importedAt: 'desc' } }))?.id ?? null;
      await this.entities.assertMember(input.assessorId, tx);
      const previous = await tx.aiAssessment.count({ where: { organizationId, aiSystemId } });
      const assessment = await tx.aiAssessment.create({
        data: {
          organizationId,
          aiSystemId,
          frameworkId,
          templateId: template.id,
          assessmentVersion: previous + 1,
          status: 'draft',
          assessorId: input.assessorId ?? actorId(),
          createdBy: actorId(),
          items: {
            create: template.questions.map((q, i) => ({ organizationId, category: q.category, rmfFunction: q.rmfFunction, questionKey: q.questionKey, prompt: q.questionText, required: q.required, sortOrder: i })),
          },
        },
      });
      await tx.assessmentTemplate.update({ where: { id: template.id }, data: { frozen: true } });
      if (system.lifecycleStatus === 'proposed') await tx.aiSystem.update({ where: { id: aiSystemId }, data: { lifecycleStatus: 'under_assessment', version: { increment: 1 } } });
      await this.audit.record({ action: 'ai_assessment.created', entityType: 'ai_assessment', entityId: assessment.id, after: { aiSystemId, template: `${template.key} v${template.version}`, items: template.questions.length } }, tx);
      return assessment;
    });
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const a = await this.prisma.aiAssessment.findFirst({
      where: { id, organizationId },
      include: { aiSystem: { select: { id: true, name: true, lifecycleStatus: true, riskTier: true, createdBy: true } }, items: { orderBy: { sortOrder: 'asc' } }, approvedByRef: { select: { displayName: true } } },
    });
    if (!a) throw notFound('AI assessment');
    const [risks, findings, history] = await Promise.all([
      this.prisma.riskLink.findMany({ where: { organizationId, entityType: 'ai_assessment', entityId: id }, include: { risk: { select: { id: true, riskKey: true, title: true, inherentRating: true, residualRating: true, status: true } } } }),
      this.prisma.finding.findMany({ where: { organizationId, sourceType: 'ai_assessment', sourceId: id }, select: { id: true, findingKey: true, title: true, severity: true, status: true } }),
      this.prisma.auditEvent.findMany({ where: { organizationId, entityType: 'ai_assessment', entityId: id }, orderBy: { timestamp: 'desc' }, take: 50, include: { actorUserRef: { select: { displayName: true } } } }),
    ]);
    const { approvedByRef, ...rest } = a;
    return { ...rest, approvedByName: approvedByRef?.displayName ?? null, risks: risks.map((r) => r.risk), findings, history: history.map(({ actorUserRef, ...h }) => ({ ...h, actor: actorUserRef })) };
  }

  async saveItems(id: string, items: Array<{ itemId: string; response?: unknown; result: AiItemResult; rationale?: string | null; evidenceId?: string | null }>) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await tx.aiAssessment.findFirst({ where: { id, organizationId }, include: { items: true } });
      if (!a) throw notFound('AI assessment');
      if (!['draft', 'in_progress'].includes(a.status)) throw conflict('Items can only be edited before submission.');
      const errors: Array<{ itemId: string; message: string }> = [];
      for (const i of items) {
        if (!a.items.some((x) => x.id === i.itemId)) errors.push({ itemId: i.itemId, message: 'Unknown item' });
        if (i.result !== 'not_answered' && i.result !== 'not_applicable' && (i.response === undefined || i.response === null || i.response === '')) errors.push({ itemId: i.itemId, message: 'Describe the current state before rating it' });
        if ((i.result === 'unsatisfactory' || i.result === 'needs_improvement' || i.result === 'not_applicable') && !i.rationale?.trim()) errors.push({ itemId: i.itemId, message: 'A rationale is required for this result' });
        if (i.evidenceId) await this.entities.assertEvidence(i.evidenceId, tx).catch(() => errors.push({ itemId: i.itemId, message: 'Evidence not found' }));
      }
      if (errors.length) throw new AppError(422, 'validation_error', 'Some items are invalid', { items: errors });
      for (const i of items) {
        await tx.aiAssessmentItem.update({
          where: { id: i.itemId },
          data: { response: (i.response ?? undefined) as Prisma.InputJsonValue | undefined, result: i.result, rationale: i.rationale ?? null, evidenceId: i.evidenceId ?? null, reviewerId: actorId(), reviewedAt: new Date() },
        });
        if (i.evidenceId) {
          await tx.evidenceLink.upsert({
            where: { evidenceId_entityType_entityId: { evidenceId: i.evidenceId, entityType: 'ai_assessment_item', entityId: i.itemId } },
            create: { organizationId, evidenceId: i.evidenceId, entityType: 'ai_assessment_item', entityId: i.itemId, purpose: 'ai_assessment', linkedBy: actorId() },
            update: {},
          });
        }
      }
      if (a.status === 'draft') await tx.aiAssessment.update({ where: { id }, data: { status: 'in_progress', version: { increment: 1 } } });
      await this.audit.record({ action: 'ai_assessment.items_saved', entityType: 'ai_assessment', entityId: id, after: { items: items.length } }, tx);
      return { saved: items.length };
    });
  }

  /** Submission requires every required item to be rated; sets the proposed risk tier and residual-risk notes. */
  async submit(id: string, input: { riskTier: AiRiskTier; rationale: string; residualRiskNotes?: string | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await tx.aiAssessment.findFirst({ where: { id, organizationId }, include: { items: true, aiSystem: true } });
      if (!a) throw notFound('AI assessment');
      if (!['draft', 'in_progress'].includes(a.status)) throw conflict('Assessment already submitted.');
      const missing = a.items.filter((i) => i.required && i.result === 'not_answered');
      if (missing.length) throw new AppError(422, 'incomplete', `${missing.length} required item(s) are not rated.`, { items: missing.map((i) => i.questionKey) });
      const unsatisfactory = a.items.filter((i) => i.result === 'unsatisfactory');
      if (unsatisfactory.length && !input.residualRiskNotes?.trim()) throw badRequest('residual_risk_required', 'Document the residual risk for the unsatisfactory items.');
      await tx.aiAssessment.update({
        where: { id },
        data: { status: 'submitted', riskTier: input.riskTier, rationale: input.rationale, residualRiskNotes: input.residualRiskNotes ?? null, submittedBy: requireUserId(), submittedAt: new Date(), assessedAt: new Date(), overallResult: unsatisfactory.length ? 'issues_identified' : 'satisfactory', version: { increment: 1 } },
      });
      // Demo step 6: an AI assessment creates or links a shared enterprise risk.
      const riskId = unsatisfactory.length ? await this.linkSharedRisk(tx, a, input.riskTier, unsatisfactory.map((i) => i.questionKey), input.residualRiskNotes ?? '') : null;
      for (const item of unsatisfactory) {
        await this.findings.upsertFromDetection(tx, {
          organizationId,
          deduplicationKey: `ai:${a.aiSystemId}:${item.questionKey}`,
          title: `${a.aiSystem.name}: ${item.category} gap`,
          description: `${item.prompt}\n\nAssessment rationale: ${item.rationale ?? '—'}`,
          sourceType: 'ai_assessment',
          sourceId: a.id,
          severity: input.riskTier === 'high' || input.riskTier === 'unacceptable' ? 'high' : 'medium',
          severityRationale: `Unsatisfactory AI assessment item; system tier ${input.riskTier}.`,
          category: 'AI governance',
          riskId,
          assignedTo: a.aiSystem.riskOwnerId ?? a.aiSystem.businessOwnerId,
          sourceReference: `ai_assessment:${a.id}:${item.questionKey}`,
        });
      }
      const approvers = await this.notifications.usersWithRoles(organizationId, ['ai_governance_officer'], tx);
      await this.notifications.notify({ organizationId, recipientUserIds: approvers.filter((u) => u !== requireUserId()), eventType: 'approval.requested', title: `AI assessment submitted: ${a.aiSystem.name}`, message: `Proposed tier ${input.riskTier}. ${unsatisfactory.length} unsatisfactory item(s).`, entityType: 'ai_assessment', entityId: id }, tx);
      await this.audit.record({ action: 'ai_assessment.submitted', entityType: 'ai_assessment', entityId: id, after: { riskTier: input.riskTier, unsatisfactory: unsatisfactory.length, riskId }, rationale: input.rationale }, tx);
      return { status: 'submitted', riskId, unsatisfactory: unsatisfactory.length };
    });
  }

  async decide(id: string, input: { decision: 'approved' | 'rejected'; rationale: string; nextReviewAt?: Date | null }) {
    const organizationId = requireOrgId();
    const userId = requireUserId();
    return this.prisma.tx(async (tx) => {
      const a = await tx.aiAssessment.findFirst({ where: { id, organizationId }, include: { aiSystem: true } });
      if (!a) throw notFound('AI assessment');
      if (a.status !== 'submitted') throw conflict('Only submitted assessments can be decided.');
      if (a.submittedBy === userId || a.assessorId === userId) throw separationOfDuties('An AI assessment must be approved by someone other than its assessor or submitter.');
      const next = input.nextReviewAt ?? new Date(Date.now() + 180 * 86_400_000);
      const claimed = await tx.aiAssessment.updateMany({
        where: { id, status: 'submitted' },
        data: { status: input.decision, approvedBy: input.decision === 'approved' ? userId : null, approvedAt: input.decision === 'approved' ? new Date() : null, decisionRationale: input.rationale, nextReviewAt: next, version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw conflict('This assessment was decided by someone else.');
      if (input.decision === 'approved') {
        await tx.aiAssessment.updateMany({ where: { organizationId, aiSystemId: a.aiSystemId, status: 'approved', id: { not: id } }, data: { status: 'superseded' } });
        await tx.aiSystem.update({ where: { id: a.aiSystemId }, data: { riskTier: a.riskTier, nextReviewAt: next, version: { increment: 1 } } });
      }
      await this.audit.record({ action: 'ai_assessment.decided', entityType: 'ai_assessment', entityId: id, after: { decision: input.decision, riskTier: a.riskTier, aiSystemId: a.aiSystemId }, rationale: input.rationale }, tx);
      return { decision: input.decision };
    });
  }

  private async linkSharedRisk(tx: Tx, a: { id: string; organizationId: string; aiSystemId: string; aiSystem: { name: string; riskOwnerId: string | null; businessOwnerId: string | null; providerVendorId: string | null } }, tier: AiRiskTier, keys: string[], residualNotes: string) {
    // Reuse an open risk already linked to this AI system (or to its provider vendor) rather than duplicating it.
    const existing = await tx.riskLink.findFirst({
      where: { organizationId: a.organizationId, risk: { status: { not: 'closed' }, archivedAt: null }, OR: [{ entityType: 'ai_system', entityId: a.aiSystemId }, ...(a.aiSystem.providerVendorId ? [{ entityType: 'vendor', entityId: a.aiSystem.providerVendorId }] : [])] },
      include: { risk: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.risks.linkEntity(existing.riskId, 'ai_system', a.aiSystemId, tx).catch(() => undefined);
      await this.risks.linkEntity(existing.riskId, 'ai_assessment', a.id, tx).catch(() => undefined);
      return existing.riskId;
    }
    const likelihood = Math.min(5, 2 + Math.ceil(keys.length / 2));
    const risk = await this.risks.create(
      {
        title: `AI risk: ${a.aiSystem.name}`,
        description: `AI assessment identified unsatisfactory areas: ${keys.join(', ')}. ${residualNotes}`.trim(),
        category: 'AI',
        likelihood,
        impact: TIER_IMPACT[tier],
        riskOwnerId: a.aiSystem.riskOwnerId ?? a.aiSystem.businessOwnerId,
        sourceType: 'ai_assessment',
        sourceId: a.id,
      },
      tx,
    );
    await this.risks.linkEntity(risk.id, 'ai_system', a.aiSystemId, tx);
    await this.risks.linkEntity(risk.id, 'ai_assessment', a.id, tx);
    return risk.id;
  }
}
