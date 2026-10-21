import { Injectable } from '@nestjs/common';
import type { WorkflowDefinition, WorkflowRun } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ControlTestsService } from '../control-tests/control-tests.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RisksService } from '../risks/risks.service.js';

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Event payload ids are re-validated: a malformed payload is permanent, not worth retrying. */
function payloadId(c: HandlerContext, key: string): string {
  const v = c.payload[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw new PermanentError('invalid_payload', `Event payload is missing a valid ${key}`);
  return v;
}

export interface HandlerContext {
  organizationId: string;
  run: WorkflowRun;
  definition: WorkflowDefinition;
  config: Record<string, unknown>;
  payload: Record<string, unknown>;
  now: Date;
  /** Records a step; a step that already succeeded in an earlier attempt of this run is skipped (spec §12.3). */
  step<T extends Record<string, unknown>>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface HandlerResult {
  status?: 'succeeded' | 'partially_succeeded';
  summary: Record<string, unknown>;
}

/** A failure the worker may retry with backoff (transient provider or database errors). */
export class RetryableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** A failure that retrying cannot fix (bad configuration, missing record). */
export class PermanentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

/**
 * Implementations of the default workflows (spec §12.1–12.2). Every handler is idempotent:
 * findings dedupe on their open key, notifications on a per-recipient dedupe key, and state
 * changes are guarded by their current state, so a retry never duplicates an outcome.
 */
@Injectable()
export class WorkflowHandlers {
  readonly handlers: Record<string, Handler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly controlTests: ControlTestsService,
    private readonly risks: RisksService,
    private readonly integrations: IntegrationsService,
  ) {
    this.handlers = {
      run_due_control_tests: (c) => this.runDueControlTests(c),
      evidence_expiry: (c) => this.evidenceExpiry(c),
      vendor_assessment_due: (c) => this.vendorAssessmentDue(c),
      remediation_due: (c) => this.remediationDue(c),
      risk_acceptance_expiry: (c) => this.riskAcceptanceExpiry(c),
      ai_review_due: (c) => this.aiReviewDue(c),
      control_review_due: (c) => this.controlReviewDue(c),
      integration_sync: (c) => this.integrationSync(c),
      scheduled_reports: (c) => this.scheduledReports(c),
      evidence_retention_review: (c) => this.evidenceRetentionReview(c),
      notify_high_finding: (c) => this.notifyHighFinding(c),
      notify_questionnaire_submitted: (c) => this.notifyQuestionnaireSubmitted(c),
      notify_ai_change: (c) => this.notifyAiChange(c),
    };
  }

  /** Optional hook for handlers provided by later modules (reports). */
  register(name: string, handler: Handler) {
    this.handlers[name] = handler;
  }

  private warnDays(c: HandlerContext, fallback: number) {
    const v = Number(c.config.warnDays);
    return Number.isInteger(v) && v >= 0 && v <= 365 ? v : fallback;
  }

  private async runDueControlTests(c: HandlerContext): Promise<HandlerResult> {
    const results = await this.controlTests.runDue(c.organizationId, c.run.id, c.now);
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1;
    const errors = counts.error ?? 0;
    return { status: errors && errors < results.length ? 'partially_succeeded' : 'succeeded', summary: { tested: results.length, ...counts } };
  }

  private async evidenceExpiry(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 30) * DAY);
    const items = await this.prisma.evidence.findMany({
      where: { organizationId: c.organizationId, archivedAt: null, expiresAt: { not: null, lte: horizon } },
      select: { id: true, title: true, expiresAt: true, ownerId: true },
    });
    const managers = await this.notifications.usersWithRoles(c.organizationId, ['grc_manager']);
    let sent = 0;
    for (const e of items) {
      const expired = e.expiresAt! <= c.now;
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: e.ownerId ? [e.ownerId] : managers,
        eventType: 'evidence.expiring',
        title: expired ? `Evidence expired: ${e.title}` : `Evidence expires ${day(e.expiresAt!)}: ${e.title}`,
        message: expired ? 'This evidence has expired. Controls relying on it may now fail their checks.' : 'Upload refreshed evidence before it expires.',
        entityType: 'evidence',
        entityId: e.id,
        dedupeKey: `evidence-expiry:${e.id}:${day(e.expiresAt!)}:${expired ? 'expired' : 'soon'}`,
      });
    }
    return { summary: { evidence: items.length, expired: items.filter((e) => e.expiresAt! <= c.now).length, notificationsSent: sent } };
  }

  private async vendorAssessmentDue(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 30) * DAY);
    const vendors = await this.prisma.vendor.findMany({
      where: { organizationId: c.organizationId, nextAssessmentAt: { not: null, lte: horizon }, status: { notIn: ['rejected', 'offboarding', 'archived', 'draft'] } },
      select: { id: true, name: true, nextAssessmentAt: true, businessOwnerId: true },
    });
    const managers = await this.notifications.usersWithRoles(c.organizationId, ['vendor_manager']);
    let sent = 0;
    for (const v of vendors) {
      const overdue = v.nextAssessmentAt! <= c.now;
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: [v.businessOwnerId, ...managers],
        eventType: 'assessment.due',
        title: overdue ? `Vendor reassessment overdue: ${v.name}` : `Vendor reassessment due ${day(v.nextAssessmentAt!)}: ${v.name}`,
        message: 'Start a new assessment for this vendor from its profile.',
        entityType: 'vendor',
        entityId: v.id,
        dedupeKey: `vendor-due:${v.id}:${day(v.nextAssessmentAt!)}:${overdue ? 'overdue' : 'soon'}`,
      });
    }
    return { summary: { vendors: vendors.length, overdue: vendors.filter((v) => v.nextAssessmentAt! <= c.now).length, notificationsSent: sent } };
  }

  private async remediationDue(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 7) * DAY);
    const tasks = await this.prisma.remediationTask.findMany({
      where: { organizationId: c.organizationId, status: { in: ['open', 'in_progress', 'blocked'] }, dueDate: { not: null, lte: horizon } },
      select: { id: true, title: true, dueDate: true, ownerId: true },
    });
    const managers = await this.notifications.usersWithRoles(c.organizationId, ['grc_manager']);
    let sent = 0;
    for (const t of tasks) {
      const overdue = t.dueDate! <= c.now;
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: t.ownerId ? [t.ownerId] : managers,
        eventType: overdue ? 'remediation.overdue' : 'remediation.due',
        title: overdue ? `Remediation overdue: ${t.title}` : `Remediation due ${day(t.dueDate!)}: ${t.title}`,
        message: overdue ? 'This remediation task is past its due date.' : 'This remediation task is due soon.',
        entityType: 'remediation_task',
        entityId: t.id,
        dedupeKey: `remediation:${t.id}:${day(t.dueDate!)}:${overdue ? 'overdue' : 'soon'}`,
      });
    }
    return { summary: { tasks: tasks.length, overdue: tasks.filter((t) => t.dueDate! <= c.now).length, notificationsSent: sent } };
  }

  private async riskAcceptanceExpiry(c: HandlerContext): Promise<HandlerResult> {
    const expired = await c.step('expire_lapsed', async () => {
      const lapsed = await this.prisma.tx((tx) => this.risks.expireAcceptances(tx, c.organizationId, c.now));
      for (const r of lapsed) {
        await this.notifications.notify({
          organizationId: c.organizationId,
          recipientUserIds: [r.riskOwnerId],
          eventType: 'risk_acceptance.expiring',
          title: `Risk acceptance expired: ${r.riskKey} ${r.title}`,
          message: 'The acceptance lapsed and the risk is back in review.',
          entityType: 'risk',
          entityId: r.id,
          dedupeKey: `risk-acceptance-expired:${r.id}:${day(r.acceptanceExpiresAt!)}`,
        });
      }
      return { expired: lapsed.length };
    });
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 30) * DAY);
    const soon = await this.prisma.risk.findMany({
      where: { organizationId: c.organizationId, status: 'accepted', acceptanceExpiresAt: { gt: c.now, lte: horizon } },
      select: { id: true, riskKey: true, title: true, riskOwnerId: true, acceptanceExpiresAt: true },
    });
    let sent = 0;
    for (const r of soon) {
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: [r.riskOwnerId],
        eventType: 'risk_acceptance.expiring',
        title: `Risk acceptance expires ${day(r.acceptanceExpiresAt!)}: ${r.riskKey}`,
        message: 'Re-review the risk or request a renewed acceptance before it expires.',
        entityType: 'risk',
        entityId: r.id,
        dedupeKey: `risk-acceptance-soon:${r.id}:${day(r.acceptanceExpiresAt!)}`,
      });
    }
    return { summary: { ...expired, expiringSoon: soon.length, notificationsSent: sent } };
  }

  private async aiReviewDue(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 30) * DAY);
    const systems = await this.prisma.aiSystem.findMany({
      where: { organizationId: c.organizationId, lifecycleStatus: { not: 'retired' }, nextReviewAt: { not: null, lte: horizon } },
      select: { id: true, name: true, nextReviewAt: true, businessOwnerId: true, riskOwnerId: true },
    });
    const officers = await this.notifications.usersWithRoles(c.organizationId, ['ai_governance_officer']);
    let sent = 0;
    for (const s of systems) {
      const overdue = s.nextReviewAt! <= c.now;
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: [s.businessOwnerId, s.riskOwnerId, ...officers],
        eventType: 'ai.review_due',
        title: overdue ? `AI review overdue: ${s.name}` : `AI review due ${day(s.nextReviewAt!)}: ${s.name}`,
        message: 'Start a new AI risk assessment for this system.',
        entityType: 'ai_system',
        entityId: s.id,
        dedupeKey: `ai-review:${s.id}:${day(s.nextReviewAt!)}:${overdue ? 'overdue' : 'soon'}`,
      });
    }
    return { summary: { aiSystems: systems.length, overdue: systems.filter((s) => s.nextReviewAt! <= c.now).length, notificationsSent: sent } };
  }

  private async controlReviewDue(c: HandlerContext): Promise<HandlerResult> {
    const horizon = new Date(c.now.getTime() + this.warnDays(c, 14) * DAY);
    const impls = await this.prisma.controlImplementation.findMany({
      where: { organizationId: c.organizationId, nextReviewAt: { not: null, lte: horizon }, control: { active: true } },
      select: { id: true, controlId: true, ownerId: true, nextReviewAt: true, control: { select: { controlCode: true, title: true } } },
    });
    const managers = await this.notifications.usersWithRoles(c.organizationId, ['grc_manager']);
    let sent = 0;
    for (const i of impls) {
      sent += await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: i.ownerId ? [i.ownerId] : managers,
        eventType: 'control.review_due',
        title: `Control review due ${day(i.nextReviewAt!)}: ${i.control.controlCode} ${i.control.title}`,
        message: 'Review the implementation statement, evidence and test results for this control.',
        entityType: 'control',
        entityId: i.controlId,
        dedupeKey: `control-review:${i.id}:${day(i.nextReviewAt!)}`,
      });
    }
    return { summary: { controls: impls.length, notificationsSent: sent } };
  }

  private async integrationSync(c: HandlerContext): Promise<HandlerResult> {
    const targets = typeof c.payload.integrationId === 'string' ? [{ id: c.payload.integrationId }] : await this.integrations.syncable(c.organizationId);
    const outcomes = [];
    for (const t of targets) {
      // Each integration is its own step: one that already synced in an earlier attempt is not re-run.
      outcomes.push(await c.step(`sync:${t.id}`, async () => {
        const o = await this.integrations.sync(c.organizationId, t.id, c.run.id, c.now);
        if (o.status === 'failed' && o.retryable) throw new RetryableError(o.errorCode ?? 'sync_failed', `Integration sync failed (${o.errorCode})`);
        return { ...o };
      }));
    }
    const failed = outcomes.filter((o) => o.status === 'failed').length;
    if (failed && failed === outcomes.length) throw new PermanentError('sync_failed', 'Every integration sync failed with a non-retryable error');
    return { status: failed ? 'partially_succeeded' : 'succeeded', summary: { integrations: outcomes.length, failed, outcomes } };
  }

  /** Report generation is provided by the reports module; until then due schedules are only counted. */
  private async scheduledReports(c: HandlerContext): Promise<HandlerResult> {
    const due = await this.prisma.reportSchedule.count({ where: { organizationId: c.organizationId, enabled: true, nextRunAt: { lte: c.now } } });
    return { summary: { dueSchedules: due, generated: 0 } };
  }

  /**
   * Retention never deletes automatically: deletion is irreversible and legal holds need human
   * judgement (spec §12.3, §16.3). The workflow lists archived evidence past retention for review.
   */
  private async evidenceRetentionReview(c: HandlerContext): Promise<HandlerResult> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: c.organizationId }, select: { settings: true } });
    const days = Number((org.settings as { evidenceRetentionDays?: number }).evidenceRetentionDays ?? 2555);
    const cutoff = new Date(c.now.getTime() - days * DAY);
    const count = await this.prisma.evidence.count({ where: { organizationId: c.organizationId, archivedAt: { not: null, lte: cutoff } } });
    let sent = 0;
    if (count) {
      sent = await this.notifications.notify({
        organizationId: c.organizationId,
        recipientUserIds: await this.notifications.usersWithRoles(c.organizationId, ['org_admin']),
        eventType: 'approval.requested',
        title: `${count} archived evidence item(s) are past the ${days}-day retention period`,
        message: 'Review them for deletion. Nothing is deleted automatically; check legal holds first.',
        entityType: 'organization',
        entityId: c.organizationId,
        dedupeKey: `retention-review:${day(c.now)}`,
      });
    }
    return { summary: { retentionDays: days, pastRetention: count, notificationsSent: sent } };
  }

  private async notifyHighFinding(c: HandlerContext): Promise<HandlerResult> {
    const id = payloadId(c, 'findingId');
    const finding = await this.prisma.finding.findFirst({ where: { id, organizationId: c.organizationId }, select: { id: true, findingKey: true, title: true, severity: true, assignedTo: true } });
    if (!finding) throw new PermanentError('not_found', 'Finding not found');
    if (finding.severity !== 'high' && finding.severity !== 'critical') return { summary: { skipped: 'severity below high', severity: finding.severity } };
    const managers = await this.notifications.usersWithRoles(c.organizationId, ['grc_manager']);
    const sent = await this.notifications.notify({
      organizationId: c.organizationId,
      recipientUserIds: [finding.assignedTo, ...managers],
      eventType: 'finding.high_created',
      title: `${finding.severity === 'critical' ? 'Critical' : 'High'} finding ${finding.findingKey}: ${finding.title}`,
      message: 'Triage the finding and confirm its owner and due date.',
      entityType: 'finding',
      entityId: finding.id,
      dedupeKey: `finding-high:${finding.id}`,
    });
    return { summary: { findingId: finding.id, notificationsSent: sent } };
  }

  private async notifyQuestionnaireSubmitted(c: HandlerContext): Promise<HandlerResult> {
    const id = payloadId(c, 'assessmentId');
    const a = await this.prisma.vendorAssessment.findFirst({ where: { id, organizationId: c.organizationId }, select: { id: true, assessorId: true, version: true, vendor: { select: { name: true } } } });
    if (!a) throw new PermanentError('not_found', 'Vendor assessment not found');
    const recipients = a.assessorId ? [a.assessorId] : await this.notifications.usersWithRoles(c.organizationId, ['vendor_manager']);
    const sent = await this.notifications.notify({
      organizationId: c.organizationId,
      recipientUserIds: recipients,
      eventType: 'questionnaire.submitted',
      title: `${a.vendor.name} submitted its questionnaire`,
      message: 'Review the responses and supporting evidence.',
      entityType: 'vendor_assessment',
      entityId: a.id,
      dedupeKey: `questionnaire-submitted:${a.id}:${a.version}`,
    });
    return { summary: { assessmentId: a.id, notificationsSent: sent } };
  }

  private async notifyAiChange(c: HandlerContext): Promise<HandlerResult> {
    const id = payloadId(c, 'changeId');
    const change = await this.prisma.aiModelChange.findFirst({
      where: { id, organizationId: c.organizationId },
      select: { id: true, changeType: true, requiresReassessment: true, aiSystem: { select: { id: true, name: true, businessOwnerId: true, riskOwnerId: true } } },
    });
    if (!change) throw new PermanentError('not_found', 'AI model change not found');
    const officers = await this.notifications.usersWithRoles(c.organizationId, ['ai_governance_officer']);
    const sent = await this.notifications.notify({
      organizationId: c.organizationId,
      recipientUserIds: [change.aiSystem.riskOwnerId, change.aiSystem.businessOwnerId, ...officers],
      eventType: 'ai.model_change',
      title: `AI change recorded for ${change.aiSystem.name}: ${change.changeType.replace(/_/g, ' ')}`,
      message: change.requiresReassessment ? 'The change needs an independent review and the system needs reassessment.' : 'The change needs an independent review.',
      entityType: 'ai_system',
      entityId: change.aiSystem.id,
      dedupeKey: `ai-change:${change.id}`,
    });
    return { summary: { changeId: change.id, notificationsSent: sent } };
  }
}
