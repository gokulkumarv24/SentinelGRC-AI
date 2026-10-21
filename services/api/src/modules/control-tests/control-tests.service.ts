import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import { actorId, maybeContext, requireOrgId } from '../../common/request-context.js';
import type { Prisma, TestResult } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FindingsService } from '../findings/findings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RemediationService } from '../remediation/remediation.service.js';
import { RULES, RULES_BY_KEY, type RuleOutcome } from './rules.js';

const HOUR = 3_600_000;

export interface TestRunResult {
  testId: string;
  ruleKey: string | null;
  result: TestResult;
  summary: string;
  findingId: string | null;
  findingCreated: boolean;
}

/**
 * Executes control tests and applies the outcome (spec diagram "continuous control check"):
 *  pass → record; fail → create/update finding idempotently, assign and notify owner;
 *  unknown → flag missing evidence and request it from the owner; error → recorded, never a pass.
 */
@Injectable()
export class ControlTestsService {
  private readonly logger = new Logger(ControlTestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly findings: FindingsService,
    private readonly notifications: NotificationsService,
    private readonly remediation: RemediationService,
  ) {}

  ruleCatalog() {
    return RULES.map((r) => ({ key: r.key, version: r.version, name: r.name, description: r.description, parameters: Object.keys(r.parameters.shape) }));
  }

  async list(controlId: string, query: { page: number; pageSize: number }) {
    const organizationId = requireOrgId();
    await this.mustGetControl(this.prisma, organizationId, controlId);
    const where = { organizationId, controlId };
    const [items, total] = await Promise.all([
      this.prisma.controlTest.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.controlTest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** All tests across the organization (Control Tests page). */
  async listAll(query: { page: number; pageSize: number; result?: TestResult[]; testType?: 'automated' | 'manual' }) {
    const where: Prisma.ControlTestWhereInput = { organizationId: requireOrgId(), ...(query.result ? { result: { in: query.result } } : {}), ...(query.testType ? { testType: query.testType } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.controlTest.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { control: { select: { id: true, controlCode: true, title: true } } } }),
      this.prisma.controlTest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  configs(controlId: string) {
    return this.prisma.controlTestConfig.findMany({ where: { organizationId: requireOrgId(), controlId } });
  }

  async upsertConfig(controlId: string, input: { ruleKey: string; parameters: Record<string, unknown>; frequencyHours: number; enabled: boolean }) {
    const organizationId = requireOrgId();
    const rule = RULES_BY_KEY.get(input.ruleKey);
    if (!rule) throw badRequest('unknown_rule', `Unknown rule ${input.ruleKey}`);
    const params = rule.parameters.safeParse(input.parameters);
    if (!params.success) throw badRequest('invalid_parameters', 'Rule parameters are invalid', { issues: params.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return this.prisma.tx(async (tx) => {
      await this.mustGetControl(tx, organizationId, controlId);
      const config = await tx.controlTestConfig.upsert({
        where: { organizationId_controlId_ruleKey: { organizationId, controlId, ruleKey: input.ruleKey } },
        create: { organizationId, controlId, ruleKey: input.ruleKey, parameters: params.data as Prisma.InputJsonValue, frequencyHours: input.frequencyHours, enabled: input.enabled, nextRunAt: new Date(), createdBy: actorId() },
        update: { parameters: params.data as Prisma.InputJsonValue, frequencyHours: input.frequencyHours, enabled: input.enabled },
      });
      await this.audit.record({ action: 'control_test.config_saved', entityType: 'control', entityId: controlId, after: { ruleKey: input.ruleKey, parameters: params.data, frequencyHours: input.frequencyHours, enabled: input.enabled } }, tx);
      return config;
    });
  }

  /** Runs every enabled rule configured for one control now (manual trigger). */
  async runForControl(controlId: string, options: { workflowRunId?: string } = {}): Promise<TestRunResult[]> {
    const organizationId = requireOrgId();
    const configs = await this.prisma.controlTestConfig.findMany({ where: { organizationId, controlId, enabled: true } });
    if (!configs.length) {
      await this.mustGetControl(this.prisma, organizationId, controlId);
      return [];
    }
    const results: TestRunResult[] = [];
    for (const config of configs) results.push(await this.runConfig(config.id, organizationId, options.workflowRunId));
    return results;
  }

  /** Scheduler entry point: runs every due config in the organization. */
  async runDue(organizationId: string, workflowRunId?: string, now = new Date()) {
    const due = await this.prisma.controlTestConfig.findMany({
      where: { organizationId, enabled: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }], control: { active: true } },
      select: { id: true },
    });
    const results: TestRunResult[] = [];
    for (const c of due) results.push(await this.runConfig(c.id, organizationId, workflowRunId));
    return results;
  }

  /** Evaluates one configured rule and applies the outcome in a single transaction. */
  async runConfig(configId: string, organizationId: string, workflowRunId?: string): Promise<TestRunResult> {
    const correlationId = maybeContext()?.requestId ?? randomUUID();
    const startedAt = new Date();
    return this.prisma.tx(async (tx) => {
      // Lock the config row: concurrent runs of the same rule are serialized (idempotent scheduling).
      await tx.$executeRawUnsafe('SELECT 1 FROM control_test_configs WHERE id = $1::uuid FOR UPDATE', configId);
      const config = await tx.controlTestConfig.findFirst({ where: { id: configId, organizationId }, include: { control: true } });
      if (!config) throw notFound('Control test configuration');
      const rule = RULES_BY_KEY.get(config.ruleKey);
      let outcome: RuleOutcome;
      if (!rule) {
        outcome = { result: 'error', summary: `Rule ${config.ruleKey} is not available in this version.`, details: { code: 'unknown_rule' } };
      } else {
        try {
          outcome = await rule.evaluate({ tx, organizationId, control: config.control, parameters: config.parameters as Record<string, unknown>, now: startedAt });
        } catch (error) {
          this.logger.error({ err: error, configId }, 'Control rule failed');
          outcome = { result: 'error', summary: 'The rule could not be evaluated. See the workflow run for details.', details: { code: 'rule_exception' } };
        }
      }
      const applied = await this.applyOutcome(tx, {
        organizationId,
        control: config.control,
        ruleKey: config.ruleKey,
        ruleVersion: rule?.version ?? 'unknown',
        outcome,
        testType: 'automated',
        startedAt,
        configId,
        workflowRunId,
        correlationId,
      });
      await tx.controlTestConfig.update({ where: { id: configId }, data: { lastRunAt: startedAt, nextRunAt: new Date(startedAt.getTime() + config.frequencyHours * HOUR) } });
      return applied;
    });
  }

  /** Assessor-recorded result with rationale (spec §8.5 manual test mode). */
  async recordManual(controlId: string, input: { result: TestResult; summary: string; rationale: string; evidenceIds?: string[] }) {
    const organizationId = requireOrgId();
    if (input.result === 'error') throw badRequest('invalid_result', 'Manual tests cannot record an error result.');
    return this.prisma.tx(async (tx) => {
      const control = await this.mustGetControl(tx, organizationId, controlId);
      if (input.evidenceIds?.length) {
        const count = await tx.evidence.count({ where: { id: { in: input.evidenceIds }, organizationId } });
        if (count !== input.evidenceIds.length) throw notFound('Evidence');
      }
      return this.applyOutcome(tx, {
        organizationId,
        control,
        ruleKey: 'manual',
        ruleVersion: 'manual',
        outcome: { result: input.result, summary: input.summary, details: {}, evidenceIds: input.evidenceIds, severity: 'medium', findingTitle: `Manual test failed for ${control.controlCode}` },
        testType: 'manual',
        startedAt: new Date(),
        manualRationale: input.rationale,
        correlationId: maybeContext()?.requestId ?? randomUUID(),
      });
    });
  }

  private async applyOutcome(
    tx: Tx,
    p: {
      organizationId: string;
      control: { id: string; controlCode: string; title: string };
      ruleKey: string;
      ruleVersion: string;
      outcome: RuleOutcome;
      testType: 'automated' | 'manual';
      startedAt: Date;
      configId?: string;
      workflowRunId?: string;
      manualRationale?: string;
      correlationId: string;
    },
  ): Promise<TestRunResult> {
    const dedupKey = `control-test:${p.control.id}:${p.ruleKey}`;
    const impl = await tx.controlImplementation.findUnique({ where: { organizationId_controlId: { organizationId: p.organizationId, controlId: p.control.id } } });
    let findingId: string | null = null;
    let findingCreated = false;

    const test = await tx.controlTest.create({
      data: {
        organizationId: p.organizationId,
        controlId: p.control.id,
        configId: p.configId,
        testType: p.testType,
        ruleKey: p.ruleKey,
        testRuleVersion: p.ruleVersion,
        result: p.outcome.result,
        summary: p.outcome.summary,
        details: p.outcome.details as Prisma.InputJsonValue,
        evidenceIds: p.outcome.evidenceIds ?? [],
        manualRationale: p.manualRationale,
        startedAt: p.startedAt,
        completedAt: new Date(),
        initiatedBy: actorId(),
        evidenceSnapshot: { evidence: (p.outcome.details as { evidence?: unknown }).evidence ?? null } as Prisma.InputJsonValue,
        workflowRunId: p.workflowRunId,
        correlationId: p.correlationId,
      },
    });

    if (p.outcome.result === 'fail') {
      const { finding, created } = await this.findings.upsertFromDetection(tx, {
        organizationId: p.organizationId,
        deduplicationKey: dedupKey,
        title: p.outcome.findingTitle ?? `Control test failed: ${p.control.controlCode}`,
        description: `${p.outcome.summary}\n\nRule: ${p.ruleKey}@${p.ruleVersion}. Control: ${p.control.controlCode} ${p.control.title}.`,
        sourceType: 'control_test',
        sourceId: test.id,
        severity: p.outcome.severity ?? 'medium',
        severityRationale: `Default severity of rule ${p.ruleKey}.`,
        category: 'Control failure',
        controlId: p.control.id,
        assignedTo: impl?.ownerId ?? null,
        sourceReference: `control_test:${test.id}`,
      });
      findingId = finding.id;
      findingCreated = created;
      await tx.controlTest.update({ where: { id: test.id }, data: { findingId } });
      if (created) {
        // Diagram step "assign remediation and notify owner": the control owner gets a task.
        const saved = await tx.finding.findUniqueOrThrow({ where: { id: finding.id } });
        await this.remediation.create(
          { findingId: finding.id, title: `Remediate: ${saved.title}`, description: p.outcome.summary, ownerId: impl?.ownerId ?? null, priority: saved.severity === 'critical' ? 'urgent' : saved.severity === 'high' ? 'high' : 'medium', dueDate: saved.dueDate },
          tx,
        );
      }
    } else if (p.outcome.result === 'pass') {
      const open = await this.findings.recordPassingCheck(tx, p.organizationId, dedupKey, `control_test:${test.id}`);
      findingId = open?.id ?? null;
    } else if (p.outcome.result === 'unknown' && impl?.ownerId) {
      // Flag missing/insufficient evidence and request it (once per control per day).
      await this.notifications.notify(
        {
          organizationId: p.organizationId,
          recipientUserIds: [impl.ownerId],
          eventType: 'evidence.expiring',
          title: `Evidence requested for ${p.control.controlCode}`,
          message: p.outcome.summary,
          entityType: 'control',
          entityId: p.control.id,
          dedupeKey: `evidence-request:${p.control.id}:${p.ruleKey}:${p.startedAt.toISOString().slice(0, 10)}`,
        },
        tx,
      );
    }

    await this.audit.record(
      {
        action: 'control_test.executed',
        entityType: 'control',
        entityId: p.control.id,
        organizationId: p.organizationId,
        after: { testId: test.id, ruleKey: p.ruleKey, result: p.outcome.result, findingId, findingCreated, testType: p.testType },
        rationale: p.manualRationale,
      },
      tx,
    );
    return { testId: test.id, ruleKey: p.ruleKey, result: p.outcome.result, summary: p.outcome.summary, findingId, findingCreated };
  }

  private async mustGetControl(db: Tx | PrismaService, organizationId: string, controlId: string) {
    const control = await db.control.findFirst({ where: { id: controlId, organizationId } });
    if (!control) throw notFound('Control');
    if (!control.active) throw conflict('This control is retired.');
    return control;
  }
}
