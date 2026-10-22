import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, hasPermission, requireOrgId } from '../../common/request-context.js';
import type { Prisma, ReportFormat } from '../../generated/prisma/client.js';
import { permissionsForRoles, type Permission } from '../../permissions/catalog.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService } from '../evidence/storage.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { PermanentError, WorkflowHandlers } from '../workflows/workflow-handlers.js';
import { REPORT_TYPES, REPORT_TYPES_BY_KEY, ReportBuilders } from './report-builders.js';
import type { ReportFilters, ReportModel, ReportTypeDef } from './report-model.js';
import { renderCsv, renderPdf, renderXlsx, type ReportHeader } from './renderers.js';

const DAY = 86_400_000;
const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const FREQUENCY_DAYS = { daily: 1, weekly: 7, monthly: 30 } as const;
export type Frequency = keyof typeof FREQUENCY_DAYS;

export interface ReportRequest {
  reportType: string;
  format: ReportFormat;
  reportStatus: 'draft' | 'final';
  filters: ReportFilters;
  title?: string;
}

export function nextScheduleRun(from: Date, frequency: Frequency): Date {
  const next = new Date(from);
  if (frequency === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + FREQUENCY_DAYS[frequency]);
  return next;
}

/** Report generation, storage, download and schedules (spec §17). Generation runs in the worker. */
@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builders: ReportBuilders,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventQueue,
    private readonly handlers: WorkflowHandlers,
  ) {}

  onModuleInit() {
    this.handlers.register('generate_report', async (c) => {
      const id = c.payload.reportRunId;
      if (typeof id !== 'string') throw new PermanentError('invalid_payload', 'Missing reportRunId');
      const run = await this.generate(c.organizationId, id, c.now);
      return { summary: { reportRunId: id, reportRunStatus: run.status, reportStatus: run.reportStatus } };
    });
    this.handlers.register('scheduled_reports', async (c) => {
      const expired = await this.expireOld(c.organizationId, c.now);
      const generated = await this.runDueSchedules(c.organizationId, c.now, (key, fn) => c.step(key, fn));
      return { summary: { generated, expired } };
    });
  }

  types() {
    return REPORT_TYPES.map((t) => ({ ...t, allowed: t.requires.every((p) => hasPermission(p)) }));
  }

  async request(input: ReportRequest) {
    const organizationId = requireOrgId();
    const def = this.def(input.reportType);
    for (const p of def.requires) if (!hasPermission(p)) throw forbidden(`This report needs the ${p} permission`);
    const filters = await this.validateFilters(organizationId, def, input.filters);
    let title = input.title;
    if (def.key === 'vendor_assessment') {
      const a = await this.prisma.vendorAssessment.findFirst({ where: { id: filters.assessmentId, organizationId }, select: { status: true, assessmentVersion: true, vendor: { select: { name: true } } } });
      if (input.reportStatus === 'final' && a && a.status !== 'approved' && a.status !== 'closed') throw conflict('A final vendor assessment report requires a decided assessment; generate a draft instead');
      if (a && !title?.trim()) title = `Vendor assessment: ${a.vendor.name} v${a.assessmentVersion}`;
    }
    return this.prisma.tx(async (tx) => {
      const run = await this.createRun(tx, organizationId, def, input.format, input.reportStatus, filters, actorId(), title);
      await this.events.emit(tx, organizationId, 'report.requested', { reportRunId: run.id }, `report:${run.id}`);
      await this.audit.record({ action: 'report.requested', entityType: 'report_run', entityId: run.id, after: { reportType: def.key, format: input.format, reportStatus: input.reportStatus, filters } }, tx);
      return run;
    });
  }

  async list(query: { page: number; pageSize: number; sort: 'createdAt'; order: 'asc' | 'desc'; reportType?: string; status?: string }) {
    const organizationId = requireOrgId();
    const where: Prisma.ReportRunWhereInput = {
      organizationId,
      ...(query.reportType ? { reportType: query.reportType } : {}),
      ...(query.status ? { status: query.status as Prisma.ReportRunWhereInput['status'] } : {}),
    };
    const [items, total] = await Promise.all([this.prisma.reportRun.findMany({ where, ...pageArgs(query) }), this.prisma.reportRun.count({ where })]);
    const names = await this.userNames(organizationId, items.map((i) => i.generatedBy));
    return toPage(
      items.map((r) => ({ ...r, generatedByName: r.generatedBy ? (names.get(r.generatedBy) ?? null) : null, canDownload: this.canDownload(r.reportType) && r.status === 'ready' })),
      total,
      query,
    );
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const run = await this.prisma.reportRun.findFirst({ where: { id, organizationId } });
    if (!run) throw notFound('Report');
    const names = await this.userNames(organizationId, [run.generatedBy]);
    return { ...run, generatedByName: run.generatedBy ? (names.get(run.generatedBy) ?? null) : null, canDownload: this.canDownload(run.reportType) && run.status === 'ready' };
  }

  /** Authenticated streaming download: permission-checked, checksum-verified and audited. */
  async download(id: string) {
    const organizationId = requireOrgId();
    const run = await this.prisma.reportRun.findFirst({ where: { id, organizationId } });
    if (!run) throw notFound('Report');
    if (!this.canDownload(run.reportType)) throw forbidden('You do not have permission to download this report');
    if (run.status === 'expired' || (run.expiresAt && run.expiresAt < new Date())) throw new AppError(410, 'report_expired', 'This report has expired. Generate it again.');
    if (run.status !== 'ready' || !run.storageKey) throw conflict(`The report is ${run.status}`);
    const object = await this.storage.adapter.get(run.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Buffer));
    const body = Buffer.concat(chunks);
    if (createHash('sha256').update(body).digest('hex') !== run.checksum) throw new AppError(500, 'integrity_error', 'The stored report failed its integrity check');
    await this.audit.record({ action: 'report.downloaded', entityType: 'report_run', entityId: id, after: { reportType: run.reportType, format: run.format } });
    const safeTitle = run.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'report';
    return { body, contentType: CONTENT_TYPES[run.format], filename: `${safeTitle}-${run.reportStatus}-${run.createdAt.toISOString().slice(0, 10)}.${run.format}` };
  }

  /** Builds the report model without storing anything (used by the AI report-draft feature). */
  async buildModel(reportRunId: string) {
    const organizationId = requireOrgId();
    const run = await this.prisma.reportRun.findFirst({ where: { id: reportRunId, organizationId } });
    if (!run) throw notFound('Report');
    const def = this.def(run.reportType);
    for (const p of def.requires) if (!hasPermission(p)) throw forbidden(`This report needs the ${p} permission`);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    return { run, def, model: await this.builders.build(def, { organizationId, filters: run.filters as ReportFilters, now: run.generatedAt ?? new Date(), timezone: org.timezone }) };
  }

  /** Worker: renders and stores one report. Re-runnable; the requester's permissions are re-checked. */
  async generate(organizationId: string, id: string, now = new Date()) {
    const run = await this.prisma.reportRun.findFirst({ where: { id, organizationId } });
    if (!run) throw new PermanentError('not_found', 'Report run not found');
    if (run.status === 'ready') return run;
    const def = this.def(run.reportType);
    await this.prisma.reportRun.update({ where: { id }, data: { status: 'generating', errorCode: null } });
    try {
      // Background jobs keep the initiating actor's authority (spec §2.2): a revoked requester gets nothing.
      const perms = run.generatedBy ? await this.memberPermissions(organizationId, run.generatedBy) : null;
      if (!perms || !perms.has('report.generate') || def.requires.some((p) => !perms.has(p))) throw new PermanentError('requester_not_authorized', 'The requester no longer has permission to generate this report');
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, timezone: true, settings: true } });
      const filters = run.filters as ReportFilters;
      const model = await this.builders.build(def, { organizationId, filters, now, timezone: org.timezone });
      const reportStatus = run.reportStatus === 'final' && !model.draftOnlyReason ? 'final' : 'draft';
      const creator = (await this.userNames(organizationId, [run.generatedBy])).get(run.generatedBy!) ?? 'Unknown';
      const period = this.builders.period(def, filters, now);
      const header: ReportHeader = {
        organization: org.name,
        title: run.title,
        status: reportStatus,
        generatedAt: now,
        timezone: org.timezone,
        creator: run.scheduleId ? `${creator} (scheduled)` : creator,
        filters: this.describeFilters(filters),
        period: period ? `${period.from.toISOString().slice(0, 10)} to ${period.to.toISOString().slice(0, 10)}` : null,
        reportId: run.id,
      };
      const body = await this.render(run.format, header, model);
      const key = `${organizationId}/reports/${run.id}`;
      await this.storage.adapter.put(key, body, CONTENT_TYPES[run.format]);
      const retentionDays = Number((org.settings as { reportRetentionDays?: number }).reportRetentionDays ?? 90);
      const updated = await this.prisma.tx(async (tx) => {
        const r = await tx.reportRun.update({
          where: { id },
          data: {
            status: 'ready',
            reportStatus,
            generatedAt: now,
            storageKey: key,
            checksum: createHash('sha256').update(body).digest('hex'),
            sizeBytes: body.length,
            sourceRecordIds: model.sources as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(now.getTime() + retentionDays * DAY),
            errorCode: null,
          },
        });
        await this.audit.record({ action: 'report.generated', entityType: 'report_run', entityId: id, organizationId, actorUserId: run.generatedBy, after: { reportType: run.reportType, format: run.format, reportStatus, sources: model.sources.length } }, tx);
        await this.events.emit(tx, organizationId, 'report.generated', { reportRunId: id }, `report-generated:${id}`);
        await this.notifications.notify({
          organizationId,
          recipientUserIds: [run.generatedBy],
          eventType: 'report.ready',
          title: `Report ready: ${run.title}`,
          message: `Your ${run.format.toUpperCase()} report is ready to download.`,
          entityType: 'report_run',
          entityId: id,
          dedupeKey: `report-ready:${id}`,
        }, tx);
        return r;
      });
      return updated;
    } catch (error) {
      const code = error instanceof PermanentError ? error.code : error instanceof AppError ? error.code : 'generation_failed';
      await this.prisma.reportRun.update({ where: { id }, data: { status: 'failed', errorCode: code } });
      if (error instanceof AppError) throw new PermanentError(code, error.message);
      throw error;
    }
  }

  async listSchedules() {
    const organizationId = requireOrgId();
    return this.prisma.reportSchedule.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async createSchedule(input: { reportType: string; format: ReportFormat; filters: ReportFilters; frequency: Frequency; recipientUserIds: string[] }) {
    const organizationId = requireOrgId();
    const def = this.def(input.reportType);
    for (const p of def.requires) if (!hasPermission(p)) throw forbidden(`This report needs the ${p} permission`);
    if (def.periodic && (input.filters.from || input.filters.to)) throw badRequest('invalid_filters', 'Scheduled periodic reports always cover the period since the previous run');
    const filters = await this.validateFilters(organizationId, def, input.filters);
    await this.validateRecipients(organizationId, def, input.recipientUserIds);
    return this.prisma.tx(async (tx) => {
      const s = await tx.reportSchedule.create({
        data: { organizationId, reportType: def.key, format: input.format, filters: filters as Prisma.InputJsonValue, frequency: input.frequency, recipientUserIds: input.recipientUserIds, nextRunAt: nextScheduleRun(new Date(), input.frequency), createdBy: actorId()! },
      });
      await this.audit.record({ action: 'report_schedule.created', entityType: 'report_schedule', entityId: s.id, after: { reportType: def.key, format: input.format, frequency: input.frequency, recipients: input.recipientUserIds.length } }, tx);
      return s;
    });
  }

  async updateSchedule(id: string, input: { enabled?: boolean; frequency?: Frequency; recipientUserIds?: string[] }) {
    const organizationId = requireOrgId();
    const before = await this.prisma.reportSchedule.findFirst({ where: { id, organizationId } });
    if (!before) throw notFound('Report schedule');
    if (input.recipientUserIds) await this.validateRecipients(organizationId, this.def(before.reportType), input.recipientUserIds);
    return this.prisma.tx(async (tx) => {
      const after = await tx.reportSchedule.update({
        where: { id },
        data: { enabled: input.enabled, frequency: input.frequency, recipientUserIds: input.recipientUserIds, ...(input.frequency ? { nextRunAt: nextScheduleRun(new Date(), input.frequency) } : {}) },
      });
      await this.audit.record({ action: 'report_schedule.updated', entityType: 'report_schedule', entityId: id, before: { enabled: before.enabled, frequency: before.frequency, recipients: before.recipientUserIds.length }, after: { enabled: after.enabled, frequency: after.frequency, recipients: after.recipientUserIds.length } }, tx);
      return after;
    });
  }

  async deleteSchedule(id: string) {
    const organizationId = requireOrgId();
    const before = await this.prisma.reportSchedule.findFirst({ where: { id, organizationId } });
    if (!before) throw notFound('Report schedule');
    await this.prisma.tx(async (tx) => {
      await tx.reportSchedule.delete({ where: { id } });
      await this.audit.record({ action: 'report_schedule.deleted', entityType: 'report_schedule', entityId: id, before: { reportType: before.reportType, frequency: before.frequency } }, tx);
    });
  }

  /** Worker: generates each due schedule once per slot, then notifies its recipients. */
  async runDueSchedules(organizationId: string, now: Date, step: <T extends Record<string, unknown>>(key: string, fn: () => Promise<T>) => Promise<T>) {
    const due = await this.prisma.reportSchedule.findMany({ where: { organizationId, enabled: true, nextRunAt: { lte: now } } });
    let generated = 0;
    for (const s of due) {
      const def = REPORT_TYPES_BY_KEY.get(s.reportType);
      if (!def) continue;
      const out = await step(`schedule:${s.id}:${s.nextRunAt.toISOString()}`, async () => {
        const days = FREQUENCY_DAYS[s.frequency as Frequency] ?? 7;
        const filters: ReportFilters = { ...(s.filters as ReportFilters), ...(def.periodic ? { from: new Date(now.getTime() - days * DAY).toISOString(), to: now.toISOString() } : {}) };
        const run = await this.prisma.tx((tx) => this.createRun(tx, organizationId, def, s.format, 'draft', filters, s.createdBy, undefined, s.id));
        const result = await this.generate(organizationId, run.id, now);
        await this.notifications.notify({
          organizationId,
          recipientUserIds: s.recipientUserIds,
          eventType: 'report.ready',
          title: `Scheduled report ready: ${run.title}`,
          message: 'A scheduled report is ready to download from the Reports page.',
          entityType: 'report_run',
          entityId: run.id,
          dedupeKey: `report-ready:${run.id}`,
        });
        let next = nextScheduleRun(s.nextRunAt, s.frequency as Frequency);
        while (next <= now) next = nextScheduleRun(next, s.frequency as Frequency);
        await this.prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, nextRunAt: next } });
        return { reportRunId: run.id, status: result.status };
      });
      if (out.status === 'ready') generated++;
    }
    return generated;
  }

  /** Generated files are derived data: past retention they are deleted and the run is marked expired. */
  async expireOld(organizationId: string, now: Date) {
    const old = await this.prisma.reportRun.findMany({ where: { organizationId, status: 'ready', expiresAt: { lt: now } } });
    for (const r of old) {
      if (r.storageKey) await this.storage.adapter.delete(r.storageKey).catch((err: unknown) => this.logger.warn({ err, reportRunId: r.id }, 'Could not delete expired report file'));
      await this.prisma.reportRun.update({ where: { id: r.id }, data: { status: 'expired', storageKey: null } });
      await this.audit.record({ action: 'report.expired', entityType: 'report_run', entityId: r.id, organizationId, actorUserId: null });
    }
    return old.length;
  }

  private async createRun(tx: Tx, organizationId: string, def: ReportTypeDef, format: ReportFormat, reportStatus: 'draft' | 'final', filters: ReportFilters, generatedBy: string | null, title?: string, scheduleId?: string) {
    return tx.reportRun.create({
      data: { organizationId, reportType: def.key, format, title: title?.trim() || def.title, filters: filters as Prisma.InputJsonValue, reportStatus, generatedBy, scheduleId, status: 'queued' },
    });
  }

  private render(format: ReportFormat, header: ReportHeader, model: ReportModel): Promise<Buffer> {
    if (format === 'pdf') return renderPdf(header, model);
    if (format === 'xlsx') return renderXlsx(header, model);
    return Promise.resolve(renderCsv(header, model));
  }

  private def(key: string) {
    const def = REPORT_TYPES_BY_KEY.get(key);
    if (!def) throw badRequest('unknown_report_type', 'Unknown report type');
    return def;
  }

  private canDownload(reportType: string) {
    const def = REPORT_TYPES_BY_KEY.get(reportType);
    return hasPermission('report.download') && !!def && def.requires.every((p) => hasPermission(p));
  }

  /** Only declared filters are accepted, and referenced records must belong to this organization. */
  private async validateFilters(organizationId: string, def: ReportTypeDef, filters: ReportFilters): Promise<ReportFilters> {
    const out: ReportFilters = {};
    for (const [k, v] of Object.entries(filters) as Array<[keyof ReportFilters, string | undefined]>) {
      if (v === undefined || v === '') continue;
      if (!def.filters.includes(k)) throw badRequest('invalid_filters', `The ${def.title} report does not accept the "${k}" filter`);
      out[k] = v;
    }
    for (const k of def.requiredFilters ?? []) if (!out[k]) throw badRequest('invalid_filters', `The ${def.title} report requires "${k}"`);
    if (def.periodic) this.builders.period(def, out, new Date());
    const checks: Array<[string | undefined, () => Promise<unknown>, string]> = [
      [out.frameworkId, () => this.prisma.framework.findFirst({ where: { id: out.frameworkId, OR: [{ organizationId: null }, { organizationId }] } }), 'Framework'],
      [out.vendorId, () => this.prisma.vendor.findFirst({ where: { id: out.vendorId, organizationId } }), 'Vendor'],
      [out.assessmentId, () => this.prisma.vendorAssessment.findFirst({ where: { id: out.assessmentId, organizationId } }), 'Vendor assessment'],
      [out.aiSystemId, () => this.prisma.aiSystem.findFirst({ where: { id: out.aiSystemId, organizationId } }), 'AI system'],
    ];
    for (const [value, find, label] of checks) if (value && !(await find())) throw notFound(label);
    return out;
  }

  private async validateRecipients(organizationId: string, def: ReportTypeDef, userIds: string[]) {
    for (const userId of userIds) {
      const perms = await this.memberPermissions(organizationId, userId);
      if (!perms || !perms.has('report.download') || def.requires.some((p) => !perms.has(p))) throw badRequest('invalid_recipient', 'Every recipient must be an active member allowed to download this report');
    }
  }

  private async memberPermissions(organizationId: string, userId: string): Promise<Set<Permission> | null> {
    const m = await this.prisma.membership.findFirst({ where: { organizationId, userId, status: 'active' }, include: { roles: { include: { role: { select: { key: true } } } } } });
    return m ? permissionsForRoles(m.roles.map((r) => r.role.key)) : null;
  }

  private async userNames(organizationId: string, ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const rows = await this.prisma.membership.findMany({ where: { organizationId, userId: { in: unique } }, select: { userId: true, user: { select: { displayName: true } } } });
    return new Map(rows.map((r) => [r.userId, r.user.displayName]));
  }

  private describeFilters(f: ReportFilters) {
    return Object.entries(f)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('; ');
  }
}
