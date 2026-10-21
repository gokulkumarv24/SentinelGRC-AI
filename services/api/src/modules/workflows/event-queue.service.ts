import { Injectable } from '@nestjs/common';
import { conflict, notFound } from '../../common/errors.js';
import { randomUUID } from 'node:crypto';
import { maybeContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';

/**
 * Durable domain events: an event enqueues a WorkflowRun for every enabled workflow
 * subscribed to it, inside the same transaction as the change (transactional outbox).
 * The worker executes the runs; nothing runs inside the HTTP request (spec §3.2).
 */
@Injectable()
export class EventQueue {
  async emit(tx: Tx, organizationId: string, event: string, payload: Record<string, unknown>, idempotencyKey?: string): Promise<number> {
    const definitions = await tx.workflowDefinition.findMany({
      where: { organizationId, enabled: true, triggerType: 'event', eventType: event },
    });
    const ctx = maybeContext();
    const eventKey = idempotencyKey ?? randomUUID();
    for (const def of definitions) {
      const key = `${def.key}:${eventKey}`;
      await tx.workflowRun.upsert({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } },
        create: {
          organizationId,
          workflowDefinitionId: def.id,
          status: 'queued',
          triggerSource: 'event',
          idempotencyKey: key,
          nextAttemptAt: null, // runnable immediately
          resultSummary: { event, payload } as Prisma.InputJsonValue,
          correlationId: ctx?.requestId ?? randomUUID(),
          initiatedBy: ctx?.user?.id ?? null,
        },
        update: {},
      });
    }
    return definitions.length;
  }

  /** Queues a manual run of one workflow (optionally with a payload); the worker executes it. */
  async enqueueManual(tx: Tx, organizationId: string, definitionKeyOrId: { key: string } | { id: string }, payload: Record<string, unknown> = {}): Promise<string> {
    const def = await tx.workflowDefinition.findFirst({ where: { organizationId, ...definitionKeyOrId } });
    if (!def) throw notFound('Workflow');
    if (!def.enabled) throw conflict('This workflow is disabled');
    const ctx = maybeContext();
    const run = await tx.workflowRun.create({
      data: {
        organizationId,
        workflowDefinitionId: def.id,
        status: 'queued',
        triggerSource: 'manual',
        idempotencyKey: `${def.key}:manual:${randomUUID()}`,
        nextAttemptAt: null, // runnable immediately
        resultSummary: { payload } as Prisma.InputJsonValue,
        correlationId: ctx?.requestId ?? randomUUID(),
        initiatedBy: ctx?.user?.id ?? null,
      },
    });
    return run.id;
  }
}
