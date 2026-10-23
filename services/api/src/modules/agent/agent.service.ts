import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { notFound } from '../../common/errors.js';
import { requireOrgId } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AssistantService, type GenerateInput } from '../assistant/assistant.service.js';
import type { DraftOutput } from '../assistant/tasks.js';
import { MappingsService } from '../frameworks/mappings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TrustService } from '../trust/trust.service.js';
import { AssessmentsService } from '../vendors/assessments.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { PermanentError, WorkflowHandlers, type HandlerContext, type HandlerResult } from '../workflows/workflow-handlers.js';

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_ASSESSMENT = ['draft', 'submitted', 'under_review', 'returned_for_clarification'] as const;
/** Bounded work per run keeps the agent inside free-tier limits; the rest continues on the next run. */
const MAX_PER_RUN = 15;
const TRUST_BATCH = 10;
const TRUST_BATCHES_PER_RUN = 5;
const MAPPING_REQUIREMENTS_PER_RUN = 10;

function payloadId(c: HandlerContext, key: string): string {
  const v = c.payload[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw new PermanentError('invalid_payload', `Event payload is missing a valid ${key}`);
  return v;
}

const output = (a: { output: unknown; status: string } | null) => (a && a.status === 'draft' ? (a.output as DraftOutput) : null);
const suggestion = (o: DraftOutput | null, label: string) => o?.suggestions.find((s) => s.label === label)?.value;

/**
 * The AI agent: background jobs (workflow handlers) that prepare drafts and routine records so people only
 * review and decide. It never approves, closes, decides or sends anything outside the platform. Every job is a
 * workflow definition, so administrators switch each one on or off and see every run on the Workflows page.
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: AssistantService,
    private readonly notifications: NotificationsService,
    private readonly assessments: AssessmentsService,
    private readonly mappings: MappingsService,
    private readonly trust: TrustService,
    private readonly events: EventQueue,
    handlers: WorkflowHandlers,
  ) {
    const jobs: Record<string, (c: HandlerContext) => Promise<HandlerResult>> = {
      agent_evidence_review: (c) => this.evidenceReview(c),
      agent_vendor_review: (c) => this.vendorReview(c),
      agent_vendor_decision_memo: (c) => this.single(c, 'vendor_decision_memo', payloadId(c, 'assessmentId'), { notify: ['vendor_manager'], title: 'Decision memo drafted', entityType: 'vendor_assessment' }),
      agent_vendor_intake: (c) => this.single(c, 'vendor_profile_review', payloadId(c, 'vendorId'), { entityType: 'vendor' }),
      agent_vendor_reassessment: (c) => this.vendorReassessment(c),
      agent_vendor_monitoring: (c) => this.vendorMonitoring(c),
      agent_finding_triage: (c) => this.single(c, 'finding_triage', payloadId(c, 'findingId'), { entityType: 'finding' }),
      agent_evidence_chaser: (c) => this.evidenceChaser(c),
      agent_report_narrative: (c) => this.single(c, 'report_draft', payloadId(c, 'reportRunId'), { entityType: 'report_run' }),
      agent_risk_spotting: (c) => this.riskSpotting(c),
      agent_ai_system_intake: (c) => this.single(c, 'ai_system_prefill', payloadId(c, 'aiSystemId'), { notify: ['ai_governance_officer'], title: 'AI system intake review ready', entityType: 'ai_system' }),
      agent_ai_change_impact: (c) => this.aiChange(c),
      agent_trust_questionnaire: (c) => this.trustQuestionnaire(c),
      agent_mapping_onboarding: (c) => this.mappingOnboarding(c),
    };
    for (const [name, fn] of Object.entries(jobs)) handlers.register(name, fn);
  }

  /** Agent overview for the AI Agent page: usage, whether it can run, its jobs and the drafts waiting for review. */
  async overview() {
    const organizationId = requireOrgId();
    const [usage, blocked, jobs, pending] = await Promise.all([
      this.assistant.agentUsage(),
      this.assistant.agentBlocked(),
      this.prisma.workflowDefinition.findMany({ where: { organizationId, key: { startsWith: 'agent_' } }, orderBy: { name: 'asc' }, include: { runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, createdAt: true, completedAt: true, resultSummary: true } } } }),
      this.prisma.aiArtifact.groupBy({ by: ['artifactType'], where: { organizationId, origin: 'agent', status: 'draft', decision: 'pending' }, _count: true }),
    ]);
    return {
      ...usage,
      blockedReason: blocked,
      jobs: jobs.map(({ runs, configuration, ...j }) => ({ id: j.id, version: j.version, key: j.key, name: j.name, description: j.description, enabled: j.enabled, triggerType: j.triggerType, eventType: j.eventType, intervalHours: (configuration as { intervalHours?: number | null }).intervalHours ?? null, lastRunAt: j.lastRunAt, nextRunAt: j.nextRunAt, lastRun: runs[0] ?? null })),
      pendingReview: Object.fromEntries(pending.map((p) => [p.artifactType, p._count])),
    };
  }

  /** Queues framework mapping suggestions (the job continues in further runs until every requirement is covered). */
  async suggestMappings(frameworkId: string) {
    const organizationId = requireOrgId();
    const framework = await this.prisma.framework.findFirst({ where: { id: frameworkId, OR: [{ organizationId: null }, { organizationId }] } });
    if (!framework) throw notFound('Framework');
    const runId = await this.prisma.tx((tx) => this.events.enqueueManual(tx, organizationId, { key: 'agent_mapping_onboarding' }, { frameworkId }));
    return { queued: true, runId };
  }

  // ── job implementations ──

  /** One draft for one record, with an optional notification to the people who act on it. */
  private async single(c: HandlerContext, artifactType: GenerateInput['artifactType'], targetId: string, opts: { notify?: string[]; title?: string; entityType: string }): Promise<HandlerResult> {
    const { artifact, skipped } = await this.assistant.generateForAgent({ artifactType, targetId, job: c.definition.key });
    if (!artifact) return { summary: { skipped } };
    let sent = 0;
    if (opts.notify && artifact.status === 'draft') sent = await this.notify(c, opts.notify, opts.title ?? 'AI draft ready', output(artifact)?.summary ?? '', opts.entityType, targetId, `${artifact.artifactType}:${targetId}`);
    return { summary: { draftId: artifact.id, status: artifact.status, notificationsSent: sent } };
  }

  private async evidenceReview(c: HandlerContext): Promise<HandlerResult> {
    const evidenceId = payloadId(c, 'evidenceId');
    const e = await this.prisma.evidence.findFirst({ where: { id: evidenceId, organizationId: c.organizationId }, select: { id: true, title: true, ownerId: true, sourceUri: true } });
    if (!e) throw new PermanentError('not_found', 'Evidence not found');
    const review = await c.step('evidence_review', async () => {
      const r = await this.assistant.generateForAgent({ artifactType: 'evidence_review', targetId: e.id, job: c.definition.key });
      return { draftId: r.artifact?.id ?? null, skipped: r.skipped ?? null, verdict: suggestion(output(r.artifact), 'verdict') ?? null };
    });
    // Vendor documents (portal uploads or evidence linked to a vendor) also get a document analysis.
    const vendorDoc = e.sourceUri?.startsWith('vendor-portal:') || (await this.prisma.evidenceLink.count({ where: { organizationId: c.organizationId, evidenceId: e.id, entityType: { in: ['vendor', 'assessment_response'] } } })) > 0;
    const analysis = vendorDoc
      ? await c.step('vendor_document_analysis', async () => {
          const r = await this.assistant.generateForAgent({ artifactType: 'vendor_document_analysis', targetId: e.id, job: c.definition.key });
          return { draftId: r.artifact?.id ?? null, skipped: r.skipped ?? null };
        })
      : null;
    let sent = 0;
    if (review.verdict && review.verdict !== 'sufficient') {
      const roles = vendorDoc ? ['vendor_manager'] : ['grc_manager'];
      sent = await this.notify(c, roles, `AI pre-review flagged evidence: ${e.title}`, `Verdict: ${String(review.verdict).replace('_', ' ')}. Open the evidence to see the observations before approving it.`, 'evidence', e.id, `evidence-review:${e.id}`, [e.ownerId]);
    }
    return { summary: { review, analysis, notificationsSent: sent } };
  }

  private async vendorReview(c: HandlerContext): Promise<HandlerResult> {
    const assessmentId = payloadId(c, 'assessmentId');
    const a = await this.prisma.vendorAssessment.findFirst({ where: { id: assessmentId, organizationId: c.organizationId }, select: { id: true, assessorId: true, vendor: { select: { name: true } } } });
    if (!a) throw new PermanentError('not_found', 'Vendor assessment not found');
    const review = await c.step('vendor_response_review', async () => {
      const r = await this.assistant.generateForAgent({ artifactType: 'vendor_response_review', targetId: a.id, job: c.definition.key, reuseWithinHours: 0 });
      return { draftId: r.artifact?.id ?? null, skipped: r.skipped ?? null, summary: output(r.artifact)?.summary ?? null };
    });
    const observations = await c.step('vendor_observations', async () => {
      const r = await this.assistant.generateForAgent({ artifactType: 'vendor_observations', targetId: a.id, job: c.definition.key, reuseWithinHours: 0 });
      return { draftId: r.artifact?.id ?? null, skipped: r.skipped ?? null };
    });
    let sent = 0;
    if (review.draftId) sent = await this.notify(c, a.assessorId ? [] : ['vendor_manager'], `AI pre-review ready: ${a.vendor.name}`, String(review.summary ?? 'Suggested review statuses and follow-up questions are ready.'), 'vendor_assessment', a.id, `vendor-review:${a.id}:${review.draftId}`, [a.assessorId]);
    return { summary: { review, observations, notificationsSent: sent } };
  }

  /** Prepares the next assessment for vendors due soon: same questionnaire family and assessor as last time. */
  private async vendorReassessment(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 14) * DAY);
    const vendors = await this.prisma.vendor.findMany({
      where: { organizationId: c.organizationId, status: { in: ['approved', 'approved_with_conditions', 'active'] }, nextAssessmentAt: { not: null, lte: horizon }, assessments: { none: { status: { in: [...OPEN_ASSESSMENT] } } } },
      select: { id: true, name: true, nextAssessmentAt: true, businessOwnerId: true, assessments: { orderBy: { createdAt: 'desc' }, take: 1, select: { assessorId: true, templateRef: { select: { key: true } } } } },
      take: MAX_PER_RUN,
    });
    const created: string[] = [];
    const skipped: Array<{ vendor: string; reason: string }> = [];
    for (const v of vendors) {
      const last = v.assessments[0];
      const template = await this.prisma.assessmentTemplate.findFirst({
        where: { purpose: 'vendor_security', active: true, OR: [{ organizationId: c.organizationId }, { organizationId: null }], ...(last ? { key: last.templateRef.key } : {}) },
        orderBy: [{ organizationId: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
      });
      if (!template) {
        skipped.push({ vendor: v.name, reason: 'no active questionnaire' });
        continue;
      }
      const result = await c.step(`reassess:${v.id}`, async () => {
        try {
          const a = await this.assessments.create(v.id, { templateId: template.id, dueDate: v.nextAssessmentAt, assessorId: last?.assessorId ?? null });
          return { assessmentId: a.id };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'failed' };
        }
      });
      if (typeof result.assessmentId === 'string') {
        created.push(v.name);
        await this.notify(c, ['vendor_manager'], `Reassessment prepared: ${v.name}`, `The AI agent created the next assessment (due ${v.nextAssessmentAt!.toISOString().slice(0, 10)}). Review it and send the questionnaire to the vendor.`, 'vendor_assessment', result.assessmentId, `reassessment:${result.assessmentId}`, [last?.assessorId, v.businessOwnerId]);
      } else skipped.push({ vendor: v.name, reason: String(result.error) });
    }
    return { status: skipped.length && created.length ? 'partially_succeeded' : 'succeeded', summary: { prepared: created.length, vendors: created, skipped } };
  }

  private async vendorMonitoring(c: HandlerContext): Promise<HandlerResult> {
    const { artifact, skipped } = await this.assistant.generateForAgent({ artifactType: 'vendor_portfolio_digest', targetId: c.organizationId, job: c.definition.key, reuseWithinHours: 24 });
    const out = output(artifact);
    if (!artifact || !out) return { summary: { skipped: skipped ?? 'draft_failed' } };
    const sent = out.points.length ? await this.notify(c, ['vendor_manager'], 'Weekly vendor digest', out.summary, 'ai_artifact', artifact.id, `vendor-digest:${c.now.toISOString().slice(0, 10)}`) : 0;
    return { summary: { draftId: artifact.id, vendorsNeedingAttention: out.points.length, notificationsSent: sent } };
  }

  private async evidenceChaser(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 14) * DAY);
    const items = await this.prisma.evidence.findMany({
      where: { organizationId: c.organizationId, archivedAt: null, expiresAt: { not: null, lte: horizon, gte: new Date(c.now.getTime() - 30 * DAY) } },
      select: { id: true, title: true, ownerId: true, expiresAt: true },
      orderBy: { expiresAt: 'asc' },
      take: MAX_PER_RUN,
    });
    let drafted = 0;
    let sent = 0;
    const skipped: Record<string, number> = {};
    for (const e of items) {
      const r = await c.step(`request:${e.id}`, async () => {
        const g = await this.assistant.generateForAgent({ artifactType: 'evidence_request', targetId: e.id, job: c.definition.key, reuseWithinHours: 24 * 7 });
        return { draftId: g.artifact?.id ?? null, skipped: g.skipped ?? null, message: output(g.artifact)?.summary ?? null };
      });
      if (r.skipped) skipped[String(r.skipped)] = (skipped[String(r.skipped)] ?? 0) + 1;
      if (!r.draftId) continue;
      drafted++;
      sent += await this.notify(c, e.ownerId ? [] : ['grc_manager'], `Evidence refresh needed: ${e.title}`, String(r.message ?? 'Upload a refreshed version of this evidence.').slice(0, 1000), 'evidence', e.id, `evidence-chaser:${e.id}:${e.expiresAt!.toISOString().slice(0, 10)}`, [e.ownerId]);
      if (skipped.budget_exhausted) break;
    }
    return { summary: { evidence: items.length, drafted, notificationsSent: sent, skipped } };
  }

  private async riskSpotting(c: HandlerContext): Promise<HandlerResult> {
    const { artifact, skipped } = await this.assistant.generateForAgent({ artifactType: 'risk_proposals', targetId: c.organizationId, job: c.definition.key, reuseWithinHours: 24 });
    const out = output(artifact);
    if (!artifact || !out) return { summary: { skipped: skipped ?? 'draft_failed' } };
    const proposals = out.suggestions.length;
    const sent = proposals ? await this.notify(c, ['grc_manager'], `${proposals} risk proposal(s) from the AI agent`, out.summary, 'ai_artifact', artifact.id, `risk-proposals:${artifact.id}`) : 0;
    return { summary: { draftId: artifact.id, proposals, notificationsSent: sent } };
  }

  private async aiChange(c: HandlerContext): Promise<HandlerResult> {
    const changeId = payloadId(c, 'changeId');
    const change = await this.prisma.aiModelChange.findFirst({ where: { id: changeId, organizationId: c.organizationId }, select: { aiSystemId: true } });
    if (!change) throw new PermanentError('not_found', 'AI model change not found');
    return this.single(c, 'ai_change_impact', changeId, { entityType: 'ai_system' });
  }

  /** Library answers first (free and consistent), then the AI in small batches; nothing is approved automatically. */
  private async trustQuestionnaire(c: HandlerContext): Promise<HandlerResult> {
    const questionnaireId = payloadId(c, 'questionnaireId');
    const q = await this.prisma.trustQuestionnaire.findFirst({ where: { id: questionnaireId, organizationId: c.organizationId }, select: { id: true, title: true, customerName: true, createdBy: true } });
    if (!q) throw new PermanentError('not_found', 'Questionnaire not found');
    const library = await c.step('library', async () => {
      const r = await this.trust.applyLibrary(q.id, c.organizationId);
      return { reused: r.reused, pending: r.pendingIds.length };
    });
    let answered = 0;
    let needsInput = 0;
    let stopped: string | null = null;
    for (let batch = 0; batch < TRUST_BATCHES_PER_RUN; batch++) {
      const pending = await this.prisma.trustQuestionnaireItem.findMany({ where: { questionnaireId: q.id, organizationId: c.organizationId, answerStatus: 'pending' }, orderBy: { sortOrder: 'asc' }, take: TRUST_BATCH, select: { id: true } });
      if (!pending.length) break;
      const ids = pending.map((p) => p.id);
      const { artifact, skipped } = await this.assistant.generateForAgent({ artifactType: 'questionnaire_answers', targetId: q.id, job: c.definition.key, reuseWithinHours: 0, options: { itemIds: ids } });
      if (!artifact) {
        stopped = skipped;
        break;
      }
      const out = output(artifact);
      if (!out) {
        stopped = 'draft_failed';
        break;
      }
      const sourceLabels = new Map((artifact.sourceRecords as Array<{ ref: string; type: string; label: string }>).map((s) => [s.ref, s]));
      const drafts = out.suggestions
        .filter((s) => ids.includes(s.label))
        .map((s) => ({ itemId: s.label, shortAnswer: s.value, answer: s.rationale, confidence: out.confidence, sources: s.sourceRefs.map((r) => ({ type: sourceLabels.get(r.sourceId)?.type ?? 'source', label: r.locator ?? sourceLabels.get(r.sourceId)?.label ?? r.sourceId })) }));
      await this.trust.applyDrafts(c.organizationId, artifact.id, drafts);
      answered += drafts.filter((d) => d.shortAnswer !== 'unknown').length;
      needsInput += drafts.filter((d) => d.shortAnswer === 'unknown').length;
      // Items the model skipped stay pending; mark them so the loop cannot spin on them.
      const missed = ids.filter((id) => !drafts.some((d) => d.itemId === id));
      if (missed.length) await this.prisma.trustQuestionnaireItem.updateMany({ where: { id: { in: missed }, answerStatus: 'pending' }, data: { answerStatus: 'needs_input' } });
      needsInput += missed.length;
    }
    await this.trust.finishAnswering(q.id);
    const remaining = await this.prisma.trustQuestionnaireItem.count({ where: { questionnaireId: q.id, answerStatus: 'pending' } });
    // Continue in another run only when this one made progress and nothing blocks the agent.
    if (remaining && !stopped && answered + needsInput > 0) {
      await this.prisma.tx((tx) => this.events.emit(tx, c.organizationId, 'trust_questionnaire.submitted', { questionnaireId: q.id }, `trust-questionnaire:${q.id}:${randomUUID()}`));
    }
    let sent = 0;
    if (!remaining) sent = await this.notify(c, [], `Questionnaire drafted: ${q.customerName}`, `${q.title}: answers are ready for review.`, 'trust_questionnaire', q.id, `trust-drafted:${q.id}:${c.run.id}`, [q.createdBy]);
    return { status: stopped && stopped !== 'recent_draft_exists' ? 'partially_succeeded' : 'succeeded', summary: { library, answered, needsInput, remaining, stopped, notificationsSent: sent } };
  }

  /** Proposes control mappings for unmapped requirements of one framework into the normal review queue. */
  private async mappingOnboarding(c: HandlerContext): Promise<HandlerResult> {
    const frameworkId = payloadId(c, 'frameworkId');
    const requirements = await this.prisma.frameworkRequirement.findMany({ where: { frameworkId, framework: { OR: [{ organizationId: null }, { organizationId: c.organizationId }] } }, select: { id: true, requirementCode: true }, orderBy: { requirementCode: 'asc' } });
    if (!requirements.length) throw new PermanentError('not_found', 'Framework has no requirements');
    const mapped = new Set((await this.prisma.controlMapping.findMany({ where: { organizationId: c.organizationId, sourceRequirementId: { in: requirements.map((r) => r.id) }, controlId: { not: null }, reviewStatus: { not: 'rejected' } }, select: { sourceRequirementId: true } })).map((m) => m.sourceRequirementId));
    const attempted = new Set((await this.prisma.aiArtifact.findMany({ where: { organizationId: c.organizationId, artifactType: 'mapping_suggestions', origin: 'agent', targetId: { in: requirements.map((r) => r.id) } }, select: { targetId: true } })).map((a) => a.targetId));
    const todo = requirements.filter((r) => !mapped.has(r.id) && !attempted.has(r.id));
    let proposed = 0;
    let stopped: string | null = null;
    for (const r of todo.slice(0, MAPPING_REQUIREMENTS_PER_RUN)) {
      const result = await c.step(`map:${r.id}`, async () => {
        const g = await this.assistant.generateForAgent({ artifactType: 'mapping_suggestions', targetId: r.id, job: c.definition.key, reuseWithinHours: 0 });
        const out = output(g.artifact);
        if (!g.artifact || !out) return { skipped: g.skipped ?? 'draft_failed', created: 0 };
        let created = 0;
        for (const s of out.suggestions.slice(0, 3)) {
          try {
            await this.mappings.create({ sourceRequirementId: r.id, controlId: s.value, mappingType: 'related', rationale: `${s.rationale} (Suggested by the AI agent; review before relying on it.)`.slice(0, 4000), confidence: out.confidence === 'high' ? 70 : out.confidence === 'medium' ? 50 : 30, sourceReference: `ai-agent:${g.artifact.id}` });
            created++;
          } catch {
            // Duplicate or retired control: the existing mapping stands.
          }
        }
        return { skipped: null, created };
      });
      if (result.skipped && result.skipped !== 'draft_failed') {
        stopped = String(result.skipped);
        break;
      }
      proposed += Number(result.created);
    }
    const remaining = todo.length - Math.min(todo.length, MAPPING_REQUIREMENTS_PER_RUN);
    if (remaining > 0 && !stopped) await this.prisma.tx((tx) => this.events.enqueueManual(tx, c.organizationId, { key: 'agent_mapping_onboarding' }, { frameworkId }));
    let sent = 0;
    if (proposed && (!remaining || stopped)) sent = await this.notify(c, ['grc_manager'], `${proposed} mapping suggestion(s) ready for review`, 'Review them on the Mappings page; you can approve several at once.', 'framework', frameworkId, `mapping-onboarding:${frameworkId}:${c.run.id}`);
    return { status: stopped ? 'partially_succeeded' : 'succeeded', summary: { requirements: requirements.length, alreadyMapped: mapped.size, proposed, remaining, stopped, notificationsSent: sent } };
  }

  // ── helpers ──

  private warnDays(c: HandlerContext, fallback: number) {
    const v = Number(c.config.warnDays);
    return Number.isInteger(v) && v >= 0 && v <= 365 ? v : fallback;
  }

  private async notify(c: HandlerContext, roles: string[], title: string, message: string, entityType: string, entityId: string, dedupeKey: string, users: Array<string | null | undefined> = []) {
    const byRole = roles.length ? await this.notifications.usersWithRoles(c.organizationId, roles) : [];
    const recipients = [...users, ...byRole].filter((u): u is string => !!u);
    if (!recipients.length) return 0;
    return this.notifications.notify({ organizationId: c.organizationId, recipientUserIds: recipients, eventType: 'ai.agent_ready', title: title.slice(0, 200), message: message.slice(0, 1000), entityType, entityId, dedupeKey: `agent:${dedupeKey}` });
  }
}
