import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { requireOrgId, requireUserId } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';

export interface NotifyInput {
  organizationId: string;
  recipientUserIds: Array<string | null | undefined>;
  eventType: string;
  title: string;
  message: string; // never include evidence contents (spec §18)
  entityType?: string;
  entityId?: string;
  /** Same key + recipient ⇒ delivered once (spec §12.3, §18). */
  dedupeKey?: string;
}

export const NOTIFICATION_EVENT_TYPES = [
  'evidence.expiring',
  'control.review_due',
  'assessment.assigned',
  'assessment.due',
  'questionnaire.submitted',
  'questionnaire.clarification',
  'finding.high_created',
  'finding.assigned',
  'remediation.due',
  'remediation.overdue',
  'risk_acceptance.expiring',
  'risk_acceptance.requested',
  'risk_acceptance.decided',
  'ai.review_due',
  'ai.model_change',
  'workflow.failed',
  'integration.failed',
  'report.ready',
  'approval.requested',
] as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** In-app first; queues an email in the outbox only if the user opted in and email is configured. */
  async notify(input: NotifyInput, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma;
    const recipients = [...new Set(input.recipientUserIds.filter((id): id is string => !!id))];
    let created = 0;
    for (const recipientUserId of recipients) {
      const pref = await db.notificationPreference.findUnique({
        where: { organizationId_userId_eventType: { organizationId: input.organizationId, userId: recipientUserId, eventType: input.eventType } },
      });
      if (pref && !pref.inApp && !pref.email) continue;
      const wantsEmail = !!pref?.email && loadEnv().EMAIL_PROVIDER !== 'none';
      try {
        const notification = await db.notification.create({
          data: {
            organizationId: input.organizationId,
            recipientUserId,
            eventType: input.eventType,
            title: input.title,
            message: input.message,
            entityType: input.entityType,
            entityId: input.entityId,
            dedupeKey: input.dedupeKey ?? null,
            emailStatus: wantsEmail ? 'pending' : 'suppressed',
          },
        });
        created++;
        if (wantsEmail) {
          const user = await db.user.findUniqueOrThrow({ where: { id: recipientUserId }, select: { email: true } });
          await db.outboxEvent.create({
            data: {
              organizationId: input.organizationId,
              channel: 'email',
              recipient: user.email,
              subject: input.title,
              body: `${input.message}\n\nOpen SentinelGRC to view details.`,
              dedupeKey: `notification:${notification.id}`,
            },
          });
        }
      } catch (error) {
        // Unique (org, recipient, dedupeKey): this notification was already delivered.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    return created;
  }

  async listMine(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; unreadOnly?: boolean }) {
    const where = {
      organizationId: requireOrgId(),
      recipientUserId: requireUserId(),
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, ...pageArgs(query) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { organizationId: where.organizationId, recipientUserId: where.recipientUserId, readAt: null } }),
    ]);
    return { ...toPage(items, total, query), unread };
  }

  async markRead(id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, organizationId: requireOrgId(), recipientUserId: requireUserId(), readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, organizationId: requireOrgId(), recipientUserId: requireUserId() } });
      if (!exists) throw notFound('Notification');
    }
  }

  async markAllRead() {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId: requireOrgId(), recipientUserId: requireUserId(), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async preferences() {
    const saved = await this.prisma.notificationPreference.findMany({ where: { organizationId: requireOrgId(), userId: requireUserId() } });
    const byType = new Map(saved.map((p) => [p.eventType, p]));
    return NOTIFICATION_EVENT_TYPES.map((eventType) => ({
      eventType,
      inApp: byType.get(eventType)?.inApp ?? true,
      email: byType.get(eventType)?.email ?? false,
    }));
  }

  async setPreference(eventType: string, inApp: boolean, email: boolean) {
    const organizationId = requireOrgId();
    const userId = requireUserId();
    return this.prisma.notificationPreference.upsert({
      where: { organizationId_userId_eventType: { organizationId, userId, eventType } },
      create: { organizationId, userId, eventType, inApp, email },
      update: { inApp, email },
    });
  }

  /** Users in the organization holding any of the given roles (for routing alerts). */
  async usersWithRoles(organizationId: string, roleKeys: string[], tx?: Tx): Promise<string[]> {
    const rows = await (tx ?? this.prisma).membership.findMany({
      where: { organizationId, status: 'active', roles: { some: { role: { key: { in: roleKeys } } } } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
