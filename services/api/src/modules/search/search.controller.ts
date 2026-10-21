import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { hasPermission, requireOrgId } from '../../common/request-context.js';
import { ApiZodQuery, zod } from '../../common/validation.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });
const PER_TYPE = 5;

/**
 * Global search (spec §14.5): only entity types the member may read, only within the
 * active organization, metadata only (never file contents). Types without permission are
 * skipped entirely, so results never reveal that a forbidden record exists.
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('dashboard.read')
  @ApiZodQuery(searchQuery)
  async search(@Query(zod(searchQuery)) { q }: z.infer<typeof searchQuery>) {
    const organizationId = requireOrgId();
    const contains = { contains: q, mode: 'insensitive' as const };
    const tasks: Array<Promise<Array<{ type: string; id: string; title: string; subtitle?: string; href: string }>>> = [];

    if (hasPermission('control.read')) {
      tasks.push(
        this.prisma.control
          .findMany({ where: { organizationId, active: true, OR: [{ controlCode: contains }, { title: contains }] }, take: PER_TYPE, select: { id: true, controlCode: true, title: true, category: true } })
          .then((rows) => rows.map((r) => ({ type: 'control', id: r.id, title: `${r.controlCode} · ${r.title}`, subtitle: r.category, href: `/controls/${r.id}` }))),
      );
    }
    if (hasPermission('risk.read')) {
      tasks.push(
        this.prisma.risk
          .findMany({ where: { organizationId, archivedAt: null, OR: [{ riskKey: contains }, { title: contains }] }, take: PER_TYPE, select: { id: true, riskKey: true, title: true, status: true } })
          .then((rows) => rows.map((r) => ({ type: 'risk', id: r.id, title: `${r.riskKey} · ${r.title}`, subtitle: r.status.replace(/_/g, ' '), href: `/risks/${r.id}` }))),
      );
    }
    if (hasPermission('finding.read')) {
      tasks.push(
        this.prisma.finding
          .findMany({ where: { organizationId, OR: [{ findingKey: contains }, { title: contains }] }, take: PER_TYPE, select: { id: true, findingKey: true, title: true, severity: true, status: true } })
          .then((rows) => rows.map((r) => ({ type: 'finding', id: r.id, title: `${r.findingKey} · ${r.title}`, subtitle: `${r.severity} · ${r.status.replace(/_/g, ' ')}`, href: `/findings/${r.id}` }))),
      );
    }
    if (hasPermission('remediation.read')) {
      tasks.push(
        this.prisma.remediationTask
          .findMany({ where: { organizationId, title: contains }, take: PER_TYPE, select: { id: true, title: true, status: true } })
          .then((rows) => rows.map((r) => ({ type: 'remediation_task', id: r.id, title: r.title, subtitle: r.status.replace(/_/g, ' '), href: `/remediation/${r.id}` }))),
      );
    }
    if (hasPermission('vendor.read')) {
      tasks.push(
        this.prisma.vendor
          .findMany({ where: { organizationId, OR: [{ name: contains }, { legalName: contains }, { serviceDescription: contains }] }, take: PER_TYPE, select: { id: true, name: true, status: true } })
          .then((rows) => rows.map((r) => ({ type: 'vendor', id: r.id, title: r.name, subtitle: r.status.replace(/_/g, ' '), href: `/vendors/${r.id}` }))),
      );
    }
    if (hasPermission('ai_system.read')) {
      tasks.push(
        this.prisma.aiSystem
          .findMany({ where: { organizationId, OR: [{ name: contains }, { modelName: contains }] }, take: PER_TYPE, select: { id: true, name: true, lifecycleStatus: true } })
          .then((rows) => rows.map((r) => ({ type: 'ai_system', id: r.id, title: r.name, subtitle: r.lifecycleStatus.replace(/_/g, ' '), href: `/ai-governance/${r.id}` }))),
      );
    }
    if (hasPermission('evidence.read')) {
      tasks.push(
        this.prisma.evidence
          .findMany({ where: { organizationId, archivedAt: null, OR: [{ title: contains }, { originalFilename: contains }] }, take: PER_TYPE, select: { id: true, title: true, classification: true } })
          .then((rows) => rows.map((r) => ({ type: 'evidence', id: r.id, title: r.title, subtitle: r.classification, href: `/evidence/${r.id}` }))),
      );
    }
    return { results: (await Promise.all(tasks)).flat() };
  }
}
