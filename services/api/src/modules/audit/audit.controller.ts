import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { notFound } from '../../common/errors.js';
import { listQuery, multi, pageArgs, toPage } from '../../common/pagination.js';
import { requireOrgId } from '../../common/request-context.js';
import { ApiZodQuery, isoDate, zod } from '../../common/validation.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const auditQuery = listQuery(['timestamp'], {
  action: z.string().max(100).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  actorUserId: z.uuid().optional(),
  outcome: multi(['success', 'denied', 'failure']),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Read-only, organization-scoped audit log (spec §16). There is no update or delete endpoint. */
@ApiTags('audit')
@Controller('audit-events')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiZodQuery(auditQuery)
  async list(@Query(zod(auditQuery)) query: z.infer<typeof auditQuery>) {
    const where: Prisma.AuditEventWhereInput = {
      organizationId: requireOrgId(),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.outcome ? { outcome: { in: query.outcome } } : {}),
      ...(query.from || query.to ? { timestamp: { gte: query.from, lte: query.to } } : {}),
      ...(query.q ? { OR: [{ action: { contains: query.q, mode: 'insensitive' } }, { entityType: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        ...pageArgs(query),
        include: { actorUserRef: { select: { displayName: true, email: true } } },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return toPage(
      items.map(({ actorUserRef, ...e }) => ({ ...e, actor: actorUserRef })),
      total,
      query,
    );
  }

  @Get(':id')
  @RequirePermission('audit.read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const event = await this.prisma.auditEvent.findFirst({
      where: { id, organizationId: requireOrgId() },
      include: { actorUserRef: { select: { displayName: true, email: true } } },
    });
    if (!event) throw notFound('Audit event');
    const { actorUserRef, ...rest } = event;
    return { ...rest, actor: actorUserRef };
  }
}
