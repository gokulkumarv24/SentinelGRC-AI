import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, maybeContext, requireOrgId } from '../../common/request-context.js';
import type { Prisma, RunStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventQueue } from './event-queue.service.js';

const DAY = 86_400_000;

export interface RunListQuery {
  page: number;
  pageSize: number;
  sort: 'createdAt' | 'completedAt';
  order: 'asc' | 'desc';
  status?: RunStatus[];
  workflowDefinitionId?: string;
  triggerSource?: string;
  q?: string;
}

/** Workflow definitions and run history for the privileged workflow pages (spec §12.3). */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventQueue,
  ) {}

  async listDefinitions() {
    const organizationId = requireOrgId();
    const defs = await this.prisma.workflowDefinition.findMany({ where: { organizationId }, orderBy: [{ triggerType: 'asc' }, { name: 'asc' }] });
    const since = new Date(Date.now() - 7 * DAY);
    const [latest, failures] = await Promise.all([
      this.prisma.workflowRun.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, distinct: ['workflowDefinitionId'], select: { id: true, workflowDefinitionId: true, status: true, createdAt: true, completedAt: true, errorCode: true } }),
      this.prisma.workflowRun.groupBy({ by: ['workflowDefinitionId'], where: { organizationId, status: 'failed', createdAt: { gte: since } }, _count: true }),
    ]);
    const latestBy = new Map(latest.map((r) => [r.workflowDefinitionId, r]));
    const failuresBy = new Map(failures.map((f) => [f.workflowDefinitionId, f._count]));
    return defs.map((d) => ({ ...d, lastRun: latestBy.get(d.id) ?? null, failuresLast7Days: failuresBy.get(d.id) ?? 0 }));
  }

  async updateDefinition(id: string, input: { enabled?: boolean; intervalHours?: number; warnDays?: number; version: number }) {
    const before = await this.mustGetDefinition(id);
    if (before.version !== input.version) throw conflict('This workflow was changed by someone else. Reload and try again.');
    const config = { ...(before.configuration as Record<string, unknown>) };
    if (input.intervalHours !== undefined) {
      if (before.triggerType !== 'schedule') throw badRequest('not_scheduled', 'Only scheduled workflows have an interval');
      config.intervalHours = input.intervalHours;
    }
    if (input.warnDays !== undefined) {
      if (!('warnDays' in config)) throw badRequest('no_warn_days', 'This workflow has no reminder window');
      config.warnDays = input.warnDays;
    }
    const data: Prisma.WorkflowDefinitionUpdateInput = { configuration: config as Prisma.InputJsonValue, version: { increment: 1 } };
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.intervalHours !== undefined) data.scheduleCron = `every ${input.intervalHours}h`;
    if (input.enabled && before.triggerType === 'schedule' && !before.nextRunAt) data.nextRunAt = new Date();
    return this.prisma.tx(async (tx) => {
      const after = await tx.workflowDefinition.update({ where: { id }, data });
      await this.audit.record({
        action: 'workflow.updated',
        entityType: 'workflow_definition',
        entityId: id,
        before: { enabled: before.enabled, configuration: before.configuration },
        after: { enabled: after.enabled, configuration: after.configuration },
      }, tx);
      return after;
    });
  }

  async runNow(id: string) {
    const def = await this.mustGetDefinition(id);
    if (def.triggerType === 'event') throw badRequest('event_workflow', 'Event-triggered workflows run when their event happens');
    const runId = await this.prisma.tx(async (tx) => {
      const created = await this.events.enqueueManual(tx, def.organizationId, { id });
      await this.audit.record({ action: 'workflow.run_requested', entityType: 'workflow_definition', entityId: id, after: { workflowRunId: created } }, tx);
      return created;
    });
    return { workflowRunId: runId };
  }

  async listRuns(query: RunListQuery) {
    const where: Prisma.WorkflowRunWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.workflowDefinitionId ? { workflowDefinitionId: query.workflowDefinitionId } : {}),
      ...(query.triggerSource ? { triggerSource: query.triggerSource } : {}),
      ...(query.q ? { definition: { name: { contains: query.q, mode: 'insensitive' as const } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.workflowRun.findMany({ where, ...pageArgs(query), include: { definition: { select: { id: true, key: true, name: true } } } }),
      this.prisma.workflowRun.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  async getRun(id: string) {
    const organizationId = requireOrgId();
    const run = await this.prisma.workflowRun.findFirst({
      where: { id, organizationId },
      include: { definition: { select: { id: true, key: true, name: true, triggerType: true } }, steps: { orderBy: { startedAt: 'asc' } } },
    });
    if (!run) throw notFound('Workflow run');
    const [retries, initiatedBy] = await Promise.all([
      this.prisma.workflowRun.findMany({ where: { organizationId, retryOfRunId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, createdAt: true } }),
      run.initiatedBy ? this.prisma.user.findUnique({ where: { id: run.initiatedBy }, select: { displayName: true } }) : null,
    ]);
    return { ...run, retries, initiatedByName: initiatedBy?.displayName ?? null };
  }

  /** Creates a new linked run; the original keeps its history. Only finished, unsuccessful runs qualify. */
  async retry(id: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM workflow_runs WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.workflowRun.findFirst({ where: { id, organizationId }, include: { definition: true } });
      if (!run) throw notFound('Workflow run');
      if (run.status !== 'failed' && run.status !== 'partially_succeeded') throw conflict(`Only failed or partially successful runs can be retried (this run is ${run.status})`);
      const pending = await tx.workflowRun.count({ where: { organizationId, retryOfRunId: id, status: { in: ['queued', 'running'] } } });
      if (pending) throw conflict('A retry of this run is already queued');
      if (!run.definition.enabled) throw conflict('Enable the workflow before retrying its runs');
      const previous = (run.resultSummary ?? {}) as { event?: string; payload?: Record<string, unknown> };
      const retries = await tx.workflowRun.count({ where: { organizationId, retryOfRunId: id } });
      const created = await tx.workflowRun.create({
        data: {
          organizationId,
          workflowDefinitionId: run.workflowDefinitionId,
          status: 'queued',
          triggerSource: 'retry',
          idempotencyKey: `${run.definition.key}:retry:${id}:${retries + 1}`,
          nextAttemptAt: null, // runnable immediately
          resultSummary: { ...(previous.event ? { event: previous.event } : {}), ...(previous.payload ? { payload: previous.payload } : {}), retryOf: id } as Prisma.InputJsonValue,
          correlationId: maybeContext()?.requestId ?? randomUUID(),
          initiatedBy: actorId(),
          retryOfRunId: id,
        },
      });
      await this.audit.record({ action: 'workflow.run_retried', entityType: 'workflow_run', entityId: id, after: { retryRunId: created.id } }, tx);
      return created;
    });
  }

  private async mustGetDefinition(id: string) {
    const def = await this.prisma.workflowDefinition.findFirst({ where: { id, organizationId: requireOrgId() } });
    if (!def) throw notFound('Workflow');
    return def;
  }
}
