import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, maybeContext, requireOrgId } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { IntegrationError, normalizeError, SECRET_REFERENCE, type CollectedRecord, type IntegrationAdapter } from './adapter.js';
import { ADAPTERS } from './demo-identity.adapter.js';

export interface IntegrationInput {
  provider: string;
  displayName?: string;
  configuration?: Record<string, string>;
  configurationReference?: string | null;
}

export interface SyncOutcome {
  integrationId: string;
  syncRunId: string;
  status: 'succeeded' | 'failed';
  recordsProcessed: number;
  recordsFailed: number;
  errorCode?: string;
  retryable?: boolean;
}

const ALERT_ROLES = ['org_admin', 'grc_manager'];

function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    run(controller.signal),
    new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })))),
  ]).finally(() => clearTimeout(timer));
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventQueue,
  ) {}

  providers() {
    return [...ADAPTERS.values()].map(({ provider, version, displayName, description, isDemo, requiredScopes, recordTypes, configurationOptions }) => ({
      provider, version, displayName, description, isDemo, requiredScopes, recordTypes, configurationOptions,
    }));
  }

  async list() {
    const organizationId = requireOrgId();
    const items = await this.prisma.integration.findMany({
      where: { organizationId },
      orderBy: { displayName: 'asc' },
      include: { syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return items.map(({ syncRuns, ...i }) => ({ ...i, lastRun: syncRuns[0] ?? null, stale: this.isStale(i) }));
  }

  async get(id: string) {
    const integration = await this.mustGet(id);
    const adapter = ADAPTERS.get(integration.provider);
    const recordCounts = await this.prisma.integrationRecord.groupBy({ by: ['recordType'], where: { organizationId: integration.organizationId, integrationId: id }, _count: true });
    return {
      ...integration,
      stale: this.isStale(integration),
      adapter: adapter ? { version: adapter.version, description: adapter.description, requiredScopes: adapter.requiredScopes, configurationOptions: adapter.configurationOptions, isDemo: adapter.isDemo } : null,
      recordCounts: recordCounts.map((r) => ({ recordType: r.recordType, count: r._count })),
    };
  }

  async create(input: IntegrationInput) {
    const organizationId = requireOrgId();
    const adapter = this.adapter(input.provider);
    const configuration = this.validateConfiguration(adapter, input.configuration ?? {});
    const reference = this.validateReference(input.configurationReference);
    const existing = await this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: adapter.provider } } });
    if (existing) throw conflict('This integration is already configured for the organization');
    return this.prisma.tx(async (tx) => {
      const integration = await tx.integration.create({
        data: {
          organizationId,
          provider: adapter.provider,
          displayName: input.displayName?.trim() || adapter.displayName,
          isDemo: adapter.isDemo,
          status: 'configured',
          configuration,
          configurationReference: reference,
          createdBy: actorId(),
        },
      });
      await this.audit.record({ action: 'integration.created', entityType: 'integration', entityId: integration.id, after: { provider: integration.provider, configuration, configurationReference: reference } }, tx);
      return integration;
    });
  }

  async update(id: string, input: { displayName?: string; configuration?: Record<string, string>; configurationReference?: string | null; enabled?: boolean }) {
    const before = await this.mustGet(id);
    const adapter = this.adapter(before.provider);
    const data: Prisma.IntegrationUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName.trim() || adapter.displayName;
    if (input.configuration !== undefined) data.configuration = this.validateConfiguration(adapter, input.configuration);
    if (input.configurationReference !== undefined) data.configurationReference = this.validateReference(input.configurationReference);
    if (input.enabled === false) data.status = 'disabled';
    if (input.enabled === true && before.status === 'disabled') data.status = 'configured';
    return this.prisma.tx(async (tx) => {
      const after = await tx.integration.update({ where: { id }, data });
      await this.audit.record({
        action: input.enabled === false ? 'integration.disabled' : 'integration.updated',
        entityType: 'integration',
        entityId: id,
        before: { displayName: before.displayName, status: before.status, configuration: before.configuration, configurationReference: before.configurationReference },
        after: { displayName: after.displayName, status: after.status, configuration: after.configuration, configurationReference: after.configurationReference },
      }, tx);
      return after;
    });
  }

  /** Health check only; reads nothing into the database. */
  async testConnection(id: string) {
    const integration = await this.mustGet(id);
    if (integration.status === 'disabled') throw conflict('Enable the integration before testing it');
    const adapter = this.adapter(integration.provider);
    let result: { ok: boolean; message: string };
    try {
      result = await withTimeout(adapter.timeoutMs, (signal) => adapter.healthCheck({ configuration: integration.configuration as Record<string, unknown>, secret: this.secret(integration.configurationReference), now: new Date(), signal }));
    } catch (error) {
      const e = normalizeError(error);
      result = { ok: false, message: e.message };
    }
    await this.audit.record({ action: 'integration.tested', entityType: 'integration', entityId: id, outcome: result.ok ? 'success' : 'failure', after: { ok: result.ok } });
    return result;
  }

  /** Sync runs in the worker (spec §3.2): this queues an integration_sync run scoped to one integration. */
  async requestSync(id: string) {
    const integration = await this.mustGet(id);
    if (integration.status === 'disabled') throw conflict('Enable the integration before syncing it');
    const runId = await this.prisma.tx((tx) => this.events.enqueueManual(tx, integration.organizationId, { key: 'integration_sync' }, { integrationId: id }));
    await this.audit.record({ action: 'integration.sync_requested', entityType: 'integration', entityId: id, after: { workflowRunId: runId } });
    return { workflowRunId: runId };
  }

  async syncRuns(id: string, query: { page: number; pageSize: number }) {
    const integration = await this.mustGet(id);
    const where = { organizationId: integration.organizationId, integrationId: id };
    const [items, total] = await Promise.all([
      this.prisma.integrationSyncRun.findMany({ where, ...pageArgs({ ...query, sort: 'startedAt', order: 'desc' }) }),
      this.prisma.integrationSyncRun.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  async records(id: string, query: { page: number; pageSize: number; recordType?: string }) {
    const integration = await this.mustGet(id);
    const where = { organizationId: integration.organizationId, integrationId: id, ...(query.recordType ? { recordType: query.recordType } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.integrationRecord.findMany({ where, ...pageArgs({ ...query, sort: 'externalId', order: 'asc' }) }),
      this.prisma.integrationRecord.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Worker entry point: integrations due for a scheduled sync. */
  async syncable(organizationId: string) {
    return this.prisma.integration.findMany({ where: { organizationId, status: { notIn: ['not_configured', 'disabled'] } }, select: { id: true } });
  }

  /**
   * Full-refresh sync (worker only). Pages through the provider with a per-page timeout, then replaces the
   * stored records in one transaction. A failure leaves previous records untouched but marks the integration
   * failing, so rules report "unknown" rather than treating stale data as current (spec §12.3).
   */
  async sync(organizationId: string, integrationId: string, workflowRunId?: string, now = new Date()): Promise<SyncOutcome> {
    const integration = await this.prisma.integration.findFirst({ where: { id: integrationId, organizationId } });
    if (!integration) throw notFound('Integration');
    if (integration.status === 'disabled' || integration.status === 'not_configured') throw conflict('Integration is not enabled');
    const adapter = this.adapter(integration.provider);
    const ctx = maybeContext();
    const run = await this.prisma.integrationSyncRun.create({
      data: { organizationId, integrationId, status: 'running', correlationId: ctx?.requestId ?? randomUUID(), initiatedBy: ctx?.user?.id ?? null },
    });
    const collected: CollectedRecord[] = [];
    let failed = 0;
    try {
      let cursor: string | null = null;
      let pages = 0;
      do {
        if (++pages > adapter.maxPages) throw new IntegrationError('invalid_response', `The provider returned more than ${adapter.maxPages} pages`, false);
        const page = await withTimeout(adapter.timeoutMs, (signal) =>
          adapter.collect({ configuration: integration.configuration as Record<string, unknown>, secret: this.secret(integration.configurationReference), now, signal }, cursor),
        );
        for (const r of page.records) {
          if (!r.externalId || !adapter.recordTypes.includes(r.recordType)) failed++;
          else collected.push(r);
        }
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) {
      const e = normalizeError(error);
      await this.prisma.tx(async (tx) => {
        await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: 'failed', completedAt: new Date(), recordsProcessed: collected.length, recordsFailed: failed, errorSummary: `${e.code}: ${e.message}` } });
        await tx.integration.update({ where: { id: integrationId }, data: { status: 'failing', lastSyncAt: now, lastFailureAt: now, lastErrorCode: e.code } });
        await this.audit.record({ action: 'integration.sync_failed', entityType: 'integration', entityId: integrationId, organizationId, outcome: 'failure', after: { syncRunId: run.id, errorCode: e.code } }, tx);
        const recipients = await this.notifications.usersWithRoles(organizationId, ALERT_ROLES, tx);
        await this.notifications.notify({
          organizationId,
          recipientUserIds: recipients,
          eventType: 'integration.failed',
          title: `${integration.displayName} sync failed`,
          message: `The sync failed (${e.code}). Rules that depend on this integration will report "unknown" until it succeeds.`,
          entityType: 'integration',
          entityId: integrationId,
          dedupeKey: `integration-failed:${integrationId}:${workflowRunId ?? run.id}`,
        }, tx);
      });
      this.logger.warn({ integrationId, code: e.code }, 'Integration sync failed');
      return { integrationId, syncRunId: run.id, status: 'failed', recordsProcessed: collected.length, recordsFailed: failed, errorCode: e.code, retryable: e.retryable };
    }

    await this.prisma.tx(async (tx) => {
      const seen = new Map<string, Set<string>>();
      for (const r of collected) {
        if (!seen.has(r.recordType)) seen.set(r.recordType, new Set());
        seen.get(r.recordType)!.add(r.externalId);
        await tx.integrationRecord.upsert({
          where: { organizationId_integrationId_recordType_externalId: { organizationId, integrationId, recordType: r.recordType, externalId: r.externalId } },
          create: { organizationId, integrationId, recordType: r.recordType, externalId: r.externalId, data: r.data as Prisma.InputJsonValue, collectedAt: now, syncRunId: run.id },
          update: { data: r.data as Prisma.InputJsonValue, collectedAt: now, syncRunId: run.id },
        });
      }
      for (const recordType of adapter.recordTypes) {
        await tx.integrationRecord.deleteMany({ where: { organizationId, integrationId, recordType, externalId: { notIn: [...(seen.get(recordType) ?? [])] } } });
      }
      await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: failed ? 'partially_succeeded' : 'succeeded', completedAt: new Date(), recordsProcessed: collected.length, recordsFailed: failed } });
      await tx.integration.update({ where: { id: integrationId }, data: { status: failed ? 'degraded' : 'healthy', lastSyncAt: now, lastSuccessAt: now, lastErrorCode: null, syncCursor: null } });
      await this.audit.record({ action: 'integration.synced', entityType: 'integration', entityId: integrationId, organizationId, after: { syncRunId: run.id, recordsProcessed: collected.length, recordsFailed: failed } }, tx);
    });
    return { integrationId, syncRunId: run.id, status: 'succeeded', recordsProcessed: collected.length, recordsFailed: failed };
  }

  private isStale(i: { status: string; lastSuccessAt: Date | null; lastFailureAt: Date | null }) {
    return i.status === 'failing' || (!!i.lastFailureAt && (!i.lastSuccessAt || i.lastFailureAt > i.lastSuccessAt));
  }

  private adapter(provider: string): IntegrationAdapter {
    const adapter = ADAPTERS.get(provider);
    if (!adapter) throw badRequest('unknown_provider', `Integration provider "${provider}" is not available`);
    return adapter;
  }

  private validateConfiguration(adapter: IntegrationAdapter, configuration: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const option of adapter.configurationOptions) {
      const value = configuration[option.key] ?? option.default;
      if (!option.options.includes(value)) throw badRequest('invalid_configuration', `${option.label} must be one of: ${option.options.join(', ')}`);
      out[option.key] = value;
    }
    const unknown = Object.keys(configuration).filter((k) => !adapter.configurationOptions.some((o) => o.key === k));
    if (unknown.length) throw badRequest('invalid_configuration', `Unknown configuration keys: ${unknown.join(', ')}`);
    return out;
  }

  private validateReference(reference: string | null | undefined) {
    if (!reference) return null;
    if (!SECRET_REFERENCE.test(reference)) throw badRequest('invalid_secret_reference', 'Secret references must name an INTEGRATION_* environment variable, never the secret itself');
    return reference;
  }

  private secret(reference: string | null) {
    return reference && SECRET_REFERENCE.test(reference) ? process.env[reference] : undefined;
  }

  private async mustGet(id: string) {
    const integration = await this.prisma.integration.findFirst({ where: { id, organizationId: requireOrgId() } });
    if (!integration) throw notFound('Integration');
    return integration;
  }
}
