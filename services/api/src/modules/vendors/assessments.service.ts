import { Injectable } from '@nestjs/common';
import { AppError, badRequest, conflict, notFound, separationOfDuties } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, currentContext, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { AssessmentStatus, Prisma, ResponseReviewStatus, Severity } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FindingsService } from '../findings/findings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RisksService } from '../risks/risks.service.js';
import { ScoringPolicyService } from '../risks/scoring-policy.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { validateAnswer, visibleQuestions } from './questionnaire.js';
import { scoreAssessment, type Criterion, type ScoredQuestion } from './vendor-scoring.js';

const OPEN: AssessmentStatus[] = ['draft', 'submitted', 'under_review', 'returned_for_clarification'];
const EDITABLE: AssessmentStatus[] = ['draft', 'returned_for_clarification'];
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const CRITICALITY_IMPACT: Record<string, number> = { low: 2, medium: 3, high: 4, critical: 5 };

export interface ResponseInput {
  questionId: string;
  answer?: unknown;
  notApplicable?: boolean;
  naRationale?: string | null;
  comments?: string | null;
  evidenceId?: string | null;
}

/** Vendor assessments: questionnaire, review, transparent scoring and decision (spec §9.2–9.4). */
@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly policies: ScoringPolicyService,
    private readonly findings: FindingsService,
    private readonly risks: RisksService,
    private readonly notifications: NotificationsService,
    private readonly events: EventQueue,
  ) {}

  // ── Templates ──
  templates(purpose = 'vendor_security') {
    const organizationId = requireOrgId();
    return this.prisma.assessmentTemplate.findMany({
      where: { purpose, active: true, OR: [{ organizationId: null }, { organizationId }] },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { questions: true } } },
    });
  }

  async template(id: string) {
    const organizationId = requireOrgId();
    const t = await this.prisma.assessmentTemplate.findFirst({ where: { id, OR: [{ organizationId: null }, { organizationId }] }, include: { questions: { orderBy: { sortOrder: 'asc' } } } });
    if (!t) throw notFound('Questionnaire template');
    return t;
  }

  /** New version of a template, owned by the organization. Existing versions are never edited once used. */
  async createTemplateVersion(input: { baseTemplateId?: string; key: string; name: string; description?: string; purpose: 'vendor_security' | 'ai_system'; questions: Array<Prisma.AssessmentQuestionCreateWithoutTemplateInput> }) {
    const organizationId = requireOrgId();
    const keys = input.questions.map((q) => q.questionKey);
    if (new Set(keys).size !== keys.length) throw badRequest('duplicate_question', 'Question keys must be unique.');
    for (const q of input.questions) {
      if (q.dependsOnQuestionKey && !keys.includes(q.dependsOnQuestionKey)) throw badRequest('invalid_dependency', `${q.questionKey} depends on unknown question ${q.dependsOnQuestionKey}`);
      if ((q.responseType === 'single_choice' || q.responseType === 'multiple_choice') && !(q.options as string[] | undefined)?.length) throw badRequest('options_required', `${q.questionKey} needs options`);
    }
    const latest = await this.prisma.assessmentTemplate.findFirst({ where: { organizationId, key: input.key }, orderBy: { version: 'desc' } });
    const template = await this.prisma.assessmentTemplate.create({
      data: { organizationId, key: input.key, name: input.name, description: input.description, purpose: input.purpose, version: (latest?.version ?? 0) + 1, questions: { create: input.questions.map((q, i) => ({ ...q, sortOrder: i })) } },
    });
    await this.audit.record({ action: 'questionnaire.version_created', entityType: 'assessment_template', entityId: template.id, after: { key: input.key, version: template.version, questions: input.questions.length, basedOn: input.baseTemplateId ?? null } });
    return template;
  }

  // ── Assessments ──
  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; status?: AssessmentStatus[]; vendorId?: string; q?: string }) {
    const where: Prisma.VendorAssessmentWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.q ? { vendor: { name: { contains: query.q, mode: 'insensitive' } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.vendorAssessment.findMany({ where, ...pageArgs(query), include: { vendor: { select: { id: true, name: true, criticality: true } }, assessorRef: { select: { displayName: true } }, templateRef: { select: { name: true, version: true } } } }),
      this.prisma.vendorAssessment.count({ where }),
    ]);
    return toPage(items.map(({ assessorRef, templateRef, internalNotes: _n, ...a }) => ({ ...a, assessor: assessorRef, template: templateRef })), total, query);
  }

  async create(vendorId: string, input: { templateId: string; dueDate?: Date | null; assessorId?: string | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const vendor = await tx.vendor.findFirst({ where: { id: vendorId, organizationId } });
      if (!vendor) throw notFound('Vendor');
      if (vendor.status === 'archived' || vendor.status === 'offboarding') throw conflict('Vendor is being offboarded or archived.');
      const open = await tx.vendorAssessment.findFirst({ where: { organizationId, vendorId, status: { in: OPEN } } });
      if (open) throw conflict('This vendor already has an open assessment.');
      const template = await tx.assessmentTemplate.findFirst({ where: { id: input.templateId, purpose: 'vendor_security', active: true, OR: [{ organizationId: null }, { organizationId }] } });
      if (!template) throw notFound('Questionnaire template');
      await this.entities.assertMember(input.assessorId, tx);
      const previous = await tx.vendorAssessment.count({ where: { organizationId, vendorId } });
      const assessment = await tx.vendorAssessment.create({
        data: { organizationId, vendorId, templateId: template.id, assessmentVersion: previous + 1, status: 'draft', assessorId: input.assessorId ?? actorId(), dueDate: input.dueDate ?? null, createdBy: actorId() },
      });
      if (['draft', 'onboarding'].includes(vendor.status)) await tx.vendor.update({ where: { id: vendorId }, data: { status: 'assessment_required', version: { increment: 1 } } });
      await this.audit.record({ action: 'vendor_assessment.created', entityType: 'vendor_assessment', entityId: assessment.id, after: { vendorId, template: `${template.key} v${template.version}`, dueDate: input.dueDate ?? null } }, tx);
      if (assessment.assessorId && assessment.assessorId !== actorId()) {
        await this.notifications.notify({ organizationId, recipientUserIds: [assessment.assessorId], eventType: 'assessment.assigned', title: `Vendor assessment assigned: ${vendor.name}`, message: 'You are the assessor for this questionnaire.', entityType: 'vendor_assessment', entityId: assessment.id }, tx);
      }
      return assessment;
    });
  }

  /** Internal view: includes reviewer notes, scores and decisions. */
  async get(id: string) {
    const organizationId = requireOrgId();
    const a = await this.load(this.prisma, id, organizationId);
    const answers = new Map(a.responses.map((r) => [r.questionId, r.notApplicable ? undefined : r.answer]));
    const visible = new Set(visibleQuestions(a.templateRef.questions, answers).map((q) => q.id));
    const { policy } = await this.policies.activeVendor(undefined, organizationId);
    const preview = scoreAssessment(a.vendor, this.scoredQuestions(a, visible), policy);
    const [invitations, findings, history] = await Promise.all([
      this.prisma.vendorPortalInvitation.findMany({ where: { organizationId, assessmentId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, contactEmail: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true } }),
      this.prisma.finding.findMany({ where: { organizationId, sourceType: 'vendor_assessment', sourceId: id }, select: { id: true, findingKey: true, title: true, severity: true, status: true } }),
      this.prisma.auditEvent.findMany({ where: { organizationId, entityType: 'vendor_assessment', entityId: id }, orderBy: { timestamp: 'desc' }, take: 50, include: { actorUserRef: { select: { displayName: true } } } }),
    ]);
    return {
      ...a,
      questions: a.templateRef.questions.map((q) => ({ ...q, visible: visible.has(q.id), response: a.responses.find((r) => r.questionId === q.id) ?? null })),
      scorePreview: a.status === 'approved' || a.status === 'closed' ? null : preview,
      invitations,
      findings,
      history: history.map(({ actorUserRef, ...h }) => ({ ...h, actor: actorUserRef })),
    };
  }

  async saveResponses(id: string, responses: ResponseInput[], answeredBy = actorId() ?? 'unknown') {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await this.load(tx, id, organizationId);
      if (!EDITABLE.includes(a.status)) throw conflict('Answers can only be changed while the assessment is in draft or returned for clarification.');
      const questions = new Map(a.templateRef.questions.map((q) => [q.id, q]));
      const errors: Array<{ questionId: string; message: string }> = [];
      for (const r of responses) {
        const q = questions.get(r.questionId);
        if (!q) {
          errors.push({ questionId: r.questionId, message: 'Unknown question' });
          continue;
        }
        if (r.notApplicable && !r.naRationale?.trim()) errors.push({ questionId: r.questionId, message: 'Explain why this question does not apply' });
        const err = r.notApplicable ? null : validateAnswer(q, r.answer);
        if (err) errors.push({ questionId: r.questionId, message: err });
        if (r.evidenceId) {
          const ev = await tx.evidence.findFirst({ where: { id: r.evidenceId, organizationId, archivedAt: null } });
          if (!ev) errors.push({ questionId: r.questionId, message: 'Evidence not found' });
        }
      }
      if (errors.length) throw new AppError(422, 'validation_error', 'Some answers are invalid', { answers: errors });
      for (const r of responses) {
        const data = {
          answer: r.notApplicable ? undefined : ((r.answer ?? undefined) as Prisma.InputJsonValue | undefined),
          notApplicable: !!r.notApplicable,
          naRationale: r.notApplicable ? r.naRationale : null,
          comments: r.comments,
          evidenceId: r.evidenceId,
          answeredAt: new Date(),
          answeredBy,
          reviewerStatus: 'pending' as ResponseReviewStatus, // any change needs (re-)review
        };
        await tx.questionResponse.upsert({
          where: { assessmentId_questionId: { assessmentId: id, questionId: r.questionId } },
          create: { organizationId, assessmentId: id, questionId: r.questionId, ...data },
          update: data,
        });
        if (r.evidenceId) {
          const response = await tx.questionResponse.findUniqueOrThrow({ where: { assessmentId_questionId: { assessmentId: id, questionId: r.questionId } } });
          await tx.evidenceLink.upsert({
            where: { evidenceId_entityType_entityId: { evidenceId: r.evidenceId, entityType: 'assessment_response', entityId: response.id } },
            create: { organizationId, evidenceId: r.evidenceId, entityType: 'assessment_response', entityId: response.id, purpose: 'questionnaire_answer' },
            update: {},
          });
        }
      }
      await this.audit.record({ action: 'vendor_assessment.answers_saved', entityType: 'vendor_assessment', entityId: id, after: { answers: responses.length } }, tx);
      return { saved: responses.length };
    });
  }

  async submit(id: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await this.load(tx, id, organizationId);
      if (!EDITABLE.includes(a.status)) throw conflict(`Cannot submit an assessment that is ${a.status.replace(/_/g, ' ')}.`);
      const answers = new Map(a.responses.map((r) => [r.questionId, r.notApplicable ? undefined : r.answer]));
      const visible = visibleQuestions(a.templateRef.questions, answers);
      const missing = visible.filter((q) => {
        if (!q.required) return false;
        const r = a.responses.find((x) => x.questionId === q.id);
        return !r || (!r.notApplicable && (r.answer === null || r.answer === undefined || r.answer === ''));
      });
      if (missing.length) throw new AppError(422, 'incomplete', `${missing.length} required question(s) are unanswered.`, { questions: missing.map((q) => q.questionKey) });
      const evidenceGaps = visible.filter((q) => q.evidenceRequired && !a.responses.find((r) => r.questionId === q.id)?.evidenceId).map((q) => q.questionKey);
      await tx.vendorAssessment.update({ where: { id }, data: { status: 'submitted', submittedAt: new Date(), submittedBy: currentContext().vendorPortal ? null : actorId(), version: { increment: 1 } } });
      // Freeze the questionnaire version once an assessment is submitted (spec §9.2).
      await tx.assessmentTemplate.update({ where: { id: a.templateId }, data: { frozen: true } });
      await tx.vendor.update({ where: { id: a.vendorId }, data: { status: 'under_review', version: { increment: 1 } } });
      await this.audit.record({ action: 'vendor_assessment.submitted', entityType: 'vendor_assessment', entityId: id, organizationId, after: { evidenceGaps } }, tx);
      await this.events.emit(tx, organizationId, 'vendor_assessment.submitted', { assessmentId: id, vendorId: a.vendorId }, `vendor-assessment-submitted:${id}:${a.version}`);
      if (a.assessorId) {
        await this.notifications.notify({ organizationId, recipientUserIds: [a.assessorId], eventType: 'questionnaire.submitted', title: `Questionnaire submitted: ${a.vendor.name}`, message: evidenceGaps.length ? `${evidenceGaps.length} answer(s) lack required evidence.` : 'Ready for review.', entityType: 'vendor_assessment', entityId: id, dedupeKey: `submitted:${id}:${a.version}` }, tx);
      }
      return { status: 'submitted', evidenceGaps };
    });
  }

  /** Per-answer review; notes are internal and never shown to vendor respondents. */
  async reviewResponses(id: string, reviews: Array<{ questionId: string; reviewerStatus: ResponseReviewStatus; reviewerNotes?: string | null }>) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await this.load(tx, id, organizationId);
      if (!['submitted', 'under_review'].includes(a.status)) throw conflict('Only submitted assessments can be reviewed.');
      for (const r of reviews) {
        const updated = await tx.questionResponse.updateMany({
          where: { assessmentId: id, questionId: r.questionId, organizationId },
          data: { reviewerStatus: r.reviewerStatus, reviewerNotes: r.reviewerNotes, reviewedBy: requireUserId(), reviewedAt: new Date() },
        });
        if (!updated.count) throw notFound('Response');
      }
      if (a.status === 'submitted') await tx.vendorAssessment.update({ where: { id }, data: { status: 'under_review', reviewedBy: requireUserId(), reviewedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ action: 'vendor_assessment.reviewed', entityType: 'vendor_assessment', entityId: id, after: { reviewed: reviews.length } }, tx);
      return { reviewed: reviews.length };
    });
  }

  async returnForClarification(id: string, message: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const a = await this.load(tx, id, organizationId);
      if (!['submitted', 'under_review'].includes(a.status)) throw conflict('Only submitted assessments can be returned.');
      await tx.vendorAssessment.update({ where: { id }, data: { status: 'returned_for_clarification', version: { increment: 1 } } });
      await tx.vendor.update({ where: { id: a.vendorId }, data: { status: 'assessment_required', version: { increment: 1 } } });
      await this.audit.record({ action: 'vendor_assessment.returned', entityType: 'vendor_assessment', entityId: id, rationale: message }, tx);
      return { status: 'returned_for_clarification' };
    });
  }

  async setInternalNotes(id: string, internalNotes: string) {
    const organizationId = requireOrgId();
    const result = await this.prisma.vendorAssessment.updateMany({ where: { id, organizationId }, data: { internalNotes } });
    if (!result.count) throw notFound('Assessment');
    await this.audit.record({ action: 'vendor_assessment.notes_updated', entityType: 'vendor_assessment', entityId: id });
  }

  /**
   * Final decision by an authorized human. The score is computed by deterministic rules from reviewed answers;
   * AI summaries never change it (spec §9.3).
   */
  async decide(id: string, input: { decision: 'approved' | 'approved_with_conditions' | 'rejected'; rationale: string; nextReviewAt?: Date | null }) {
    const organizationId = requireOrgId();
    const userId = requireUserId();
    return this.prisma.tx(async (tx) => {
      const a = await this.load(tx, id, organizationId);
      if (!['submitted', 'under_review'].includes(a.status)) throw conflict('Only submitted assessments can be decided.');
      const answers = new Map(a.responses.map((r) => [r.questionId, r.notApplicable ? undefined : r.answer]));
      const visible = new Set(visibleQuestions(a.templateRef.questions, answers).map((q) => q.id));
      const pendingReview = a.responses.filter((r) => visible.has(r.questionId) && r.reviewerStatus === 'pending');
      if (pendingReview.length) throw new AppError(409, 'review_incomplete', `${pendingReview.length} answer(s) still need reviewer assessment.`);
      const { policy, version } = await this.policies.activeVendor(tx, organizationId);
      const result = scoreAssessment(a.vendor, this.scoredQuestions(a, visible), policy);
      if (RANK[result.tier] >= RANK[policy.conditionsRequiredFrom] && input.decision === 'approved') {
        throw badRequest('conditions_required', `Residual risk is ${result.tier}; approve with conditions or reject.`);
      }
      if (RANK[result.tier] >= RANK.high && a.assessorId === userId) throw separationOfDuties('High-risk vendors must be decided by someone other than the assessor.');

      const now = new Date();
      const next = input.nextReviewAt ?? new Date(now.getTime() + a.vendor.reassessmentFrequencyDays * 86_400_000);
      const claimed = await tx.vendorAssessment.updateMany({
        where: { id, status: { in: ['submitted', 'under_review'] } },
        data: {
          status: input.decision === 'rejected' ? 'closed' : 'approved',
          decision: input.decision,
          decisionRationale: input.rationale,
          decidedBy: userId,
          decidedAt: now,
          score: Math.round(result.controlEffectiveness * 100),
          inherentRisk: result.inherentScore,
          residualRisk: result.residualScore,
          riskTier: result.tier,
          scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
          scoringPolicyVersion: version,
          reportStatus: 'final',
          nextReviewAt: next,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw conflict('This assessment was decided by someone else.');
      await tx.vendor.update({
        where: { id: a.vendorId },
        data: { status: input.decision, inherentRiskScore: result.inherentScore, residualRiskScore: result.residualScore, riskTier: result.tier, lastAssessedAt: now, nextAssessmentAt: next, version: { increment: 1 } },
      });
      await tx.vendorRiskHistory.create({ data: { organizationId, vendorId: a.vendorId, assessmentId: id, inherentScore: result.inherentScore, residualScore: result.residualScore, tier: result.tier, policyVersion: version } });

      // Shared risk for high/critical residual vendor risk (spec §9.4 "link vendor risks to shared risks").
      const riskId = RANK[result.tier] >= RANK.high ? await this.upsertVendorRisk(tx, a, result) : null;
      const created = await this.findingsFromGaps(tx, a, result, riskId);

      await this.audit.record(
        { action: 'vendor.decision', entityType: 'vendor_assessment', entityId: id, after: { decision: input.decision, tier: result.tier, inherent: result.inherentScore, residual: result.residualScore, policyVersion: version, findings: created, riskId }, rationale: input.rationale },
        tx,
      );
      return { decision: input.decision, tier: result.tier, inherentScore: result.inherentScore, residualScore: result.residualScore, controlEffectiveness: result.controlEffectiveness, findingsCreated: created, riskId };
    });
  }

  // ── internals ──
  private async load(db: Tx | PrismaService, id: string, organizationId: string) {
    const a = await db.vendorAssessment.findFirst({
      where: { id, organizationId },
      include: { vendor: true, templateRef: { include: { questions: { orderBy: { sortOrder: 'asc' } } } }, responses: true, assessorRef: { select: { id: true, displayName: true } } },
    });
    if (!a) throw notFound('Assessment');
    return a;
  }

  private scoredQuestions(a: Awaited<ReturnType<AssessmentsService['load']>>, visible: Set<string>): ScoredQuestion[] {
    return a.templateRef.questions
      .filter((q) => visible.has(q.id))
      .map((q) => {
        const r = a.responses.find((x) => x.questionId === q.id);
        return {
          questionKey: q.questionKey,
          category: q.category,
          weight: q.weight,
          important: q.important,
          evidenceRequired: q.evidenceRequired,
          criterion: (q.expectedAnswer as Criterion | null) ?? null,
          answer: r?.notApplicable ? null : (r?.answer ?? null),
          notApplicable: !!r?.notApplicable,
          naRationale: r?.naRationale ?? null,
          reviewerStatus: r?.reviewerStatus ?? 'pending',
          hasEvidence: !!r?.evidenceId,
        };
      });
  }

  private async upsertVendorRisk(tx: Tx, a: Awaited<ReturnType<AssessmentsService['load']>>, result: ReturnType<typeof scoreAssessment>): Promise<string> {
    const organizationId = a.organizationId;
    // Documented mapping: residual 0–100 → likelihood 1–5 (20-point bands); vendor criticality → impact.
    const likelihood = Math.min(5, Math.max(1, Math.ceil(result.residualScore / 20)));
    const impact = CRITICALITY_IMPACT[a.vendor.criticality];
    const existing = await tx.riskLink.findFirst({ where: { organizationId, entityType: 'vendor', entityId: a.vendorId, risk: { sourceType: 'vendor_assessment', status: { notIn: ['closed'] }, archivedAt: null } }, include: { risk: true } });
    const description = `Residual third-party risk for ${a.vendor.name} after assessment v${a.assessmentVersion}: residual score ${result.residualScore}/100 (${result.tier}), control effectiveness ${Math.round(result.controlEffectiveness * 100)}%. Likelihood derived from the residual score band; impact from vendor criticality (${a.vendor.criticality}).`;
    if (existing) {
      await this.risks.update(existing.risk.id, existing.risk.version, { likelihood, impact, description }, `Re-scored from vendor assessment v${a.assessmentVersion}`, tx);
      await this.risks.linkEntity(existing.risk.id, 'vendor_assessment', a.id, tx).catch(() => undefined);
      return existing.risk.id;
    }
    const risk = await this.risks.create({ title: `Third-party risk: ${a.vendor.name}`, description, category: 'Third Party', likelihood, impact, riskOwnerId: a.vendor.businessOwnerId, sourceType: 'vendor_assessment', sourceId: a.id }, tx);
    await this.risks.linkEntity(risk.id, 'vendor', a.vendorId, tx);
    await this.risks.linkEntity(risk.id, 'vendor_assessment', a.id, tx);
    return risk.id;
  }

  /** Findings from failed or unsupported answers, deduplicated per vendor + question. */
  private async findingsFromGaps(tx: Tx, a: Awaited<ReturnType<AssessmentsService['load']>>, result: ReturnType<typeof scoreAssessment>, riskId: string | null) {
    let created = 0;
    const byKey = new Map(a.templateRef.questions.map((q) => [q.questionKey, q]));
    for (const q of result.breakdown.questions) {
      const def = byKey.get(q.questionKey)!;
      let severity: Severity | null = null;
      let reason = '';
      if (q.outcome === 'not_met' || q.outcome === 'rejected') {
        severity = def.important ? 'high' : 'medium';
        reason = 'Answer does not meet the expected control criterion';
      } else if (q.outcome === 'unanswered' && def.required) {
        // Optional questions left blank earn no score credit but do not raise findings.
        severity = def.important ? 'medium' : 'low';
        reason = 'Question was not answered';
      } else if (q.outcome === 'met_evidence_missing') {
        severity = 'low';
        reason = 'Required supporting evidence was not provided';
      } else if (q.outcome === 'na_needs_review') {
        severity = 'low';
        reason = 'Marked not applicable without an accepted rationale';
      }
      if (!severity) continue;
      const { created: isNew } = await this.findings.upsertFromDetection(tx, {
        organizationId: a.organizationId,
        deduplicationKey: `vendor:${a.vendorId}:${q.questionKey}`,
        title: `${a.vendor.name}: ${def.questionText.slice(0, 120)}`,
        description: `${reason}.\n\nQuestion (${q.questionKey}, category ${q.category}): ${def.questionText}\nAssessment v${a.assessmentVersion}. Outcome: ${q.outcome}.`,
        sourceType: 'vendor_assessment',
        sourceId: a.id,
        severity,
        severityRationale: def.important ? 'Question is marked important in the questionnaire.' : `Default severity for outcome ${q.outcome}.`,
        category: 'Third-party security',
        riskId,
        assignedTo: a.vendor.businessOwnerId,
        sourceReference: `vendor_assessment:${a.id}:${q.questionKey}`,
      });
      if (isNew) created++;
    }
    return created;
  }
}

