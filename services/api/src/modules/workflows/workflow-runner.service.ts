import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runWithContext, type RequestContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PERMISSIONS, type Permission } from '../../permissions/catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganizationBootstrapService } from '../organizations/organization-bootstrap.service.js';
import { PermanentError, RetryableError, WorkflowHandlers, type HandlerContext } from './workflow-handlers.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A claimed run that is not finished within the lease is considered crashed and re-queued. */
export const LEASE_MS = 10 * MINUTE;

/** Bounded exponential backoff: 30 s, 60 s, 120 s … capped at 30 minutes (spec §12.3). */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * MINUTE);
}

/** Next schedule slot strictly after `now`; missed slots are skipped rather than replayed as a backlog. */
export function nextSlot(previous: Date, intervalHours: number, now: Date): Date {
  const step = intervalHours * HOUR;
  let next = previous.getTime() + step;
  if (next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step;
  return new Date(next);
}

interface TriggerSummary {
  event?: string;
  payload?: Record<string, unknown>;
}

const ALL_PERMISSIONS = new Set(Object.keys(PERMISSIONS) as Permission[]);

/**
 * Durable scheduler and executor for workflow runs. Runs are rows in workflow_runs; any number of
 * workers can poll safely because claims use FOR UPDATE SKIP LOCKED and a lease.
 */
@Injectable()
export class WorkflowRunner {
  private readonly logger = new Logger(WorkflowRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlers: WorkflowHandlers,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly bootstrap: OrganizationBootstrapService,
  ) {}

  /** Adds default workflows introduced by newer releases to existing organizations. Idempotent. */
  async ensureDefaults() {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) await this.prisma.tx((tx) => this.bootstrap.initialize(tx, org.id));
    return orgs.length;
  }

  /** Queues one run per due schedule slot. The slot is the idempotency key, so a slot never runs twice. */
  async scheduleDue(now = new Date(), organizationId?: string): Promise<number> {
    return this.prisma.tx(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM workflow_definitions
        WHERE enabled AND trigger_type = 'schedule' AND next_run_at IS NOT NULL AND next_run_at <= ${now}
          AND (${organizationId ?? null}::uuid IS NULL OR organization_id = ${organizationId ?? null}::uuid)
        ORDER BY next_run_at
        FOR UPDATE SKIP LOCKED
        LIMIT 200`;
      for (const { id } of due) {
        const def = await tx.workflowDefinition.findUniqueOrThrow({ where: { id } });
        const intervalHours = Number((def.configuration as { intervalHours?: number }).intervalHours) || 24;
        const slot = def.nextRunAt!;
        await tx.workflowRun.upsert({
          where: { organizationId_idempotencyKey: { organizationId: def.organizationId, idempotencyKey: `${def.key}:schedule:${slot.toISOString()}` } },
          create: {
            organizationId: def.organizationId,
            workflowDefinitionId: def.id,
            status: 'queued',
            triggerSource: 'schedule',
            idempotencyKey: `${def.key}:schedule:${slot.toISOString()}`,
            nextAttemptAt: now,
            resultSummary: { scheduledFor: slot.toISOString() },
            correlationId: randomUUID(),
          },
          update: {},
        });
        await tx.workflowDefinition.update({ where: { id }, data: { lastRunAt: now, nextRunAt: nextSlot(slot, intervalHours, now) } });
      }
      return due.length;
    });
  }

  /** Re-queues runs whose worker died mid-run (lease expired); exhausted ones fail visibly. */
  async recoverExpiredLeases(now = new Date()) {
    const stuck = await this.prisma.workflowRun.findMany({ where: { status: 'running', lockedUntil: { lt: now } } });
    for (const run of stuck) {
      if (run.attemptCount >= run.maxAttempts) await this.fail(run.id, run.organizationId, 'lease_expired', 'The worker stopped before the run finished and no attempts remain.', now);
      else await this.prisma.workflowRun.updateMany({ where: { id: run.id, status: 'running' }, data: { status: 'queued', lockedUntil: null, nextAttemptAt: now, errorCode: 'lease_expired', errorMessage: 'The worker stopped before the run finished; it will be retried.' } });
    }
    return stuck.length;
  }

  /** Claims the next runnable run, or null. */
  async claim(now = new Date(), organizationId?: string): Promise<string | null> {
    const lease = new Date(now.getTime() + LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE workflow_runs SET status = 'running', attempt_count = attempt_count + 1, locked_until = ${lease}, started_at = COALESCE(started_at, ${now})
      WHERE id = (
        SELECT id FROM workflow_runs
        WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          AND (${organizationId ?? null}::uuid IS NULL OR organization_id = ${organizationId ?? null}::uuid)
        ORDER BY next_attempt_at NULLS FIRST, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  /** Executes one claimed run with a system security context scoped to its organization. */
  async execute(runId: string, now = new Date()): Promise<void> {
    const run = await this.prisma.workflowRun.findUniqueOrThrow({ where: { id: runId }, include: { definition: true, organization: { select: { name: true } } } });
    const { definition } = run;
    const config = definition.configuration as Record<string, unknown>;
    const trigger = (run.resultSummary ?? {}) as TriggerSummary & Record<string, unknown>;
    const context: RequestContext = {
      requestId: run.correlationId,
      actorType: 'system',
      membership: { id: 'system', organizationId: run.organizationId, organizationName: run.organization.name, roleKeys: ['system'], permissions: ALL_PERMISSIONS },
    };
    await runWithContext(context, async () => {
      const handlerName = typeof config.handler === 'string' ? config.handler : '';
      const handler = this.handlers.handlers[handlerName];
      const ctx: HandlerContext = {
        organizationId: run.organizationId,
        run,
        definition,
        config,
        payload: trigger.payload ?? {},
        now,
        step: (key, fn) => this.step(run.id, key, fn),
      };
      try {
        if (!handler) throw new PermanentError('unknown_handler', `No handler named "${handlerName}" is available`);
        const result = await this.step(run.id, `handler:${handlerName}`, async () => {
          const r = await handler(ctx);
          return { status: r.status ?? 'succeeded', ...r.summary };
        });
        const { status, ...summary } = result as { status: 'succeeded' | 'partially_succeeded' } & Record<string, unknown>;
        await this.prisma.workflowRun.update({
          where: { id: run.id },
          data: {
            status,
            completedAt: new Date(),
            lockedUntil: null,
            nextAttemptAt: null,
            errorCode: null,
            errorMessage: null,
            resultSummary: { ...this.triggerPart(trigger), result: summary } as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        const code = error instanceof RetryableError || error instanceof PermanentError ? error.code : 'handler_error';
        // Only messages written for users are stored; unexpected errors stay in the worker log.
        const message = error instanceof RetryableError || error instanceof PermanentError ? error.message : 'Unexpected error while running the workflow. See the worker log for this correlation ID.';
        if (!(error instanceof RetryableError || error instanceof PermanentError)) this.logger.error({ err: error, runId: run.id, correlationId: run.correlationId }, 'Workflow handler failed');
        const retry = !(error instanceof PermanentError) && run.attemptCount < run.maxAttempts;
        if (retry) {
          await this.prisma.workflowRun.update({
            where: { id: run.id },
            data: { status: 'queued', lockedUntil: null, nextAttemptAt: new Date(now.getTime() + backoffMs(run.attemptCount)), errorCode: code, errorMessage: message },
          });
        } else {
          await this.fail(run.id, run.organizationId, code, message, now);
        }
      }
    });
  }

  /** Processes runnable runs until none remain (or `max`). Used by the worker loop and tests. */
  async drain(options: { now?: Date; organizationId?: string; max?: number } = {}): Promise<number> {
    const now = options.now ?? new Date();
    await this.recoverExpiredLeases(now);
    let processed = 0;
    while (processed < (options.max ?? 50)) {
      const id = await this.claim(now, options.organizationId);
      if (!id) break;
      await this.execute(id, now);
      processed++;
    }
    return processed;
  }

  async tick(now = new Date()) {
    const scheduled = await this.scheduleDue(now);
    const processed = await this.drain({ now });
    return { scheduled, processed };
  }

  private triggerPart(t: TriggerSummary & Record<string, unknown>) {
    return { ...(t.event ? { event: t.event } : {}), ...(t.payload ? { payload: t.payload } : {}), ...(t.scheduledFor ? { scheduledFor: t.scheduledFor } : {}), ...(t.retryOf ? { retryOf: t.retryOf } : {}) };
  }

  private async step<T extends Record<string, unknown>>(runId: string, stepKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = await this.prisma.workflowStep.findFirst({ where: { workflowRunId: runId, stepKey } });
    if (existing?.status === 'succeeded') return (existing.outputSummary ?? {}) as T;
    const step = existing
      ? await this.prisma.workflowStep.update({ where: { id: existing.id }, data: { status: 'running', startedAt: new Date(), completedAt: null, errorCode: null, retryCount: { increment: 1 } } })
      : await this.prisma.workflowStep.create({ data: { workflowRunId: runId, stepKey, status: 'running', startedAt: new Date() } });
    try {
      const output = await fn();
      await this.prisma.workflowStep.update({ where: { id: step.id }, data: { status: 'succeeded', completedAt: new Date(), outputSummary: output as Prisma.InputJsonValue } });
      return output;
    } catch (error) {
      const code = error instanceof RetryableError || error instanceof PermanentError ? error.code : 'handler_error';
      await this.prisma.workflowStep.update({ where: { id: step.id }, data: { status: 'failed', completedAt: new Date(), errorCode: code } });
      throw error;
    }
  }

  private async fail(runId: string, organizationId: string, code: string, message: string, now: Date) {
    await this.prisma.tx(async (tx) => {
      const run = await tx.workflowRun.update({
        where: { id: runId },
        data: { status: 'failed', completedAt: now, lockedUntil: null, nextAttemptAt: null, errorCode: code, errorMessage: message },
        include: { definition: { select: { name: true } } },
      });
      await this.audit.record({ action: 'workflow.run_failed', entityType: 'workflow_run', entityId: runId, organizationId, actorUserId: null, outcome: 'failure', after: { errorCode: code, attempts: run.attemptCount } }, tx);
      await this.notifications.notify({
        organizationId,
        recipientUserIds: await this.notifications.usersWithRoles(organizationId, ['org_admin', 'grc_manager'], tx),
        eventType: 'workflow.failed',
        title: `Workflow failed: ${run.definition.name}`,
        message: `${message} (${code}). A user with retry permission can retry it from the workflow runs page.`,
        entityType: 'workflow_run',
        entityId: runId,
        dedupeKey: `workflow-failed:${runId}`,
      }, tx);
    });
  }
}
