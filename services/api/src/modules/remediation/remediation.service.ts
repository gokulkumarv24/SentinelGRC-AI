import { Injectable } from '@nestjs/common';
import { conflict, invalidTransition, notFound, versionConflict } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId } from '../../common/request-context.js';
import type { Prisma, Priority, TaskStatus } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'open', 'cancelled'],
  blocked: ['in_progress', 'open', 'cancelled'],
  completed: ['in_progress'], // reopen if validation fails
  cancelled: ['open'],
};

export interface TaskInput {
  findingId?: string | null;
  title: string;
  description?: string | null;
  ownerId?: string | null;
  priority?: Priority;
  dueDate?: Date | null;
}

@Injectable()
export class RemediationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string; status?: TaskStatus[]; ownerId?: string; findingId?: string; overdue?: boolean; priority?: Priority[] }) {
    const where: Prisma.RemediationTaskWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.priority ? { priority: { in: query.priority } } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.findingId ? { findingId: query.findingId } : {}),
      ...(query.overdue ? { dueDate: { lt: new Date() }, status: { in: ['open', 'in_progress', 'blocked'] } } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.remediationTask.findMany({
        where,
        ...pageArgs(query),
        include: { ownerRef: { select: { id: true, displayName: true } }, finding: { select: { id: true, findingKey: true, title: true, severity: true } } },
      }),
      this.prisma.remediationTask.count({ where }),
    ]);
    return toPage(items.map(({ ownerRef, ...t }) => ({ ...t, owner: ownerRef })), total, query);
  }

  async get(id: string) {
    const task = await this.prisma.remediationTask.findFirst({
      where: { id, organizationId: requireOrgId() },
      include: { ownerRef: { select: { id: true, displayName: true, email: true } }, finding: { select: { id: true, findingKey: true, title: true, severity: true, status: true } } },
    });
    if (!task) throw notFound('Remediation task');
    const history = await this.prisma.auditEvent.findMany({
      where: { organizationId: task.organizationId, entityType: 'remediation_task', entityId: id },
      orderBy: { timestamp: 'desc' },
      take: 50,
      include: { actorUserRef: { select: { displayName: true } } },
    });
    const { ownerRef, ...rest } = task;
    return { ...rest, owner: ownerRef, history };
  }

  async create(input: TaskInput, tx?: Tx) {
    const run = async (db: Tx) => {
      const organizationId = requireOrgId();
      if (input.findingId) await this.entities.resolve('finding', input.findingId, db);
      await this.entities.assertMember(input.ownerId, db);
      const task = await db.remediationTask.create({
        data: { organizationId, ...input, findingId: input.findingId ?? null, createdBy: actorId() },
      });
      if (input.findingId) {
        const finding = await db.finding.findUniqueOrThrow({ where: { id: input.findingId } });
        if (['open', 'triaged', 'reopened'].includes(finding.status)) {
          await db.finding.update({ where: { id: finding.id }, data: { status: 'in_remediation', version: { increment: 1 } } });
          await db.findingEvent.create({
            data: { organizationId, findingId: finding.id, eventType: 'transition', fromStatus: finding.status, toStatus: 'in_remediation', actorId: actorId(), rationale: `Remediation task created: ${input.title}` },
          });
        }
      }
      await this.audit.record({ action: 'remediation.created', entityType: 'remediation_task', entityId: task.id, after: { title: task.title, findingId: task.findingId, ownerId: task.ownerId, dueDate: task.dueDate } }, db);
      if (input.ownerId) {
        await this.notifications.notify(
          { organizationId, recipientUserIds: [input.ownerId], eventType: 'finding.assigned', title: 'Remediation task assigned to you', message: input.title, entityType: 'remediation_task', entityId: task.id, dedupeKey: `task-assigned:${task.id}:${input.ownerId}` },
          db,
        );
      }
      return task;
    };
    return tx ? run(tx) : this.prisma.tx(run);
  }

  async update(id: string, version: number, input: Partial<TaskInput> & { status?: TaskStatus; vendorResponse?: string | null; internalReviewStatus?: 'unreviewed' | 'pending_review' | 'approved' | 'rejected' }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const task = await tx.remediationTask.findFirst({ where: { id, organizationId } });
      if (!task) throw notFound('Remediation task');
      if (task.version !== version) throw versionConflict();
      if (input.status && input.status !== task.status) {
        if (input.status === 'completed') throw conflict('Use the complete action to finish a task.');
        if (!TASK_TRANSITIONS[task.status].includes(input.status)) throw invalidTransition(task.status, input.status);
      }
      await this.entities.assertMember(input.ownerId, tx);
      const { findingId: _ignored, ...changes } = input;
      const updated = await tx.remediationTask.update({ where: { id }, data: { ...changes, version: { increment: 1 }, ...(input.status === 'in_progress' && task.status === 'completed' ? { completedAt: null } : {}) } });
      await this.audit.record({ action: 'remediation.updated', entityType: 'remediation_task', entityId: id, before: Object.fromEntries(Object.keys(changes).map((k) => [k, (task as Record<string, unknown>)[k] ?? null])), after: changes }, tx);
      if (input.ownerId && input.ownerId !== task.ownerId) {
        await this.notifications.notify(
          { organizationId, recipientUserIds: [input.ownerId], eventType: 'finding.assigned', title: 'Remediation task assigned to you', message: updated.title, entityType: 'remediation_task', entityId: id, dedupeKey: `task-assigned:${id}:${input.ownerId}` },
          tx,
        );
      }
      return updated;
    });
  }

  /** Completing the last open task moves the finding to pending validation — never straight to closed. */
  async complete(id: string, input: { completionNotes: string; completionEvidenceId?: string | null; version: number }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const task = await tx.remediationTask.findFirst({ where: { id, organizationId } });
      if (!task) throw notFound('Remediation task');
      if (task.version !== input.version) throw versionConflict();
      if (task.status === 'completed' || task.status === 'cancelled') throw conflict(`Task is already ${task.status}.`);
      await this.entities.assertEvidence(input.completionEvidenceId, tx);
      const updated = await tx.remediationTask.update({
        where: { id },
        data: { status: 'completed', completedAt: new Date(), completionNotes: input.completionNotes, completionEvidenceId: input.completionEvidenceId ?? null, internalReviewStatus: 'pending_review', version: { increment: 1 } },
      });
      if (input.completionEvidenceId) {
        await tx.evidenceLink.upsert({
          where: { evidenceId_entityType_entityId: { evidenceId: input.completionEvidenceId, entityType: 'remediation_task', entityId: id } },
          create: { organizationId, evidenceId: input.completionEvidenceId, entityType: 'remediation_task', entityId: id, purpose: 'completion', linkedBy: actorId() },
          update: {},
        });
      }
      await this.audit.record({ action: 'remediation.completed', entityType: 'remediation_task', entityId: id, after: { completionEvidenceId: input.completionEvidenceId ?? null }, rationale: input.completionNotes }, tx);

      if (task.findingId) {
        const remaining = await tx.remediationTask.count({ where: { findingId: task.findingId, status: { in: ['open', 'in_progress', 'blocked'] } } });
        const finding = await tx.finding.findUniqueOrThrow({ where: { id: task.findingId } });
        if (remaining === 0 && finding.status === 'in_remediation') {
          await tx.finding.update({ where: { id: finding.id }, data: { status: 'pending_validation', version: { increment: 1 } } });
          await tx.findingEvent.create({
            data: { organizationId, findingId: finding.id, eventType: 'transition', fromStatus: 'in_remediation', toStatus: 'pending_validation', actorId: actorId(), rationale: 'All remediation tasks completed; awaiting validation' },
          });
        }
      }
      return updated;
    });
  }
}
