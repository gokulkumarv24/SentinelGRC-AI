import { Injectable } from '@nestjs/common';
import { badRequest, forbidden, invalidTransition, notFound, separationOfDuties, versionConflict } from '../../common/errors.js';
import { nextKey } from '../../common/keys.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, hasPermission, requireOrgId } from '../../common/request-context.js';
import type { FindingStatus, Prisma, Severity } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DEFAULT_SETTINGS, type OrganizationSettings } from '../organizations/organizations.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';

/** Allowed lifecycle transitions (spec §6.3). */
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  open: ['triaged', 'in_remediation', 'closed', 'accepted'],
  triaged: ['in_remediation', 'pending_validation', 'closed', 'accepted'],
  in_remediation: ['pending_validation', 'triaged', 'accepted'],
  pending_validation: ['closed', 'in_remediation'],
  closed: ['reopened'],
  accepted: ['reopened'],
  reopened: ['triaged', 'in_remediation', 'pending_validation', 'closed', 'accepted'],
};

const DEFAULT_DUE_DAYS: Record<Severity, number> = { critical: 7, high: 30, medium: 60, low: 90 };
const OPEN_STATES: FindingStatus[] = ['open', 'triaged', 'in_remediation', 'pending_validation', 'reopened'];

export interface DetectionInput {
  organizationId: string;
  deduplicationKey: string;
  title: string;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  severity: Severity;
  severityRationale?: string;
  category?: string;
  controlId?: string | null;
  riskId?: string | null;
  assignedTo?: string | null;
  sourceReference?: string;
}

export interface FindingListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  status?: FindingStatus[];
  severity?: Severity[];
  sourceType?: string;
  assignedTo?: string;
  controlId?: string;
  overdue?: boolean;
  openOnly?: boolean;
}

@Injectable()
export class FindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly notifications: NotificationsService,
    private readonly events: EventQueue,
  ) {}

  async list(query: FindingListQuery) {
    const where: Prisma.FindingWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : query.openOnly ? { status: { in: OPEN_STATES } } : {}),
      ...(query.severity ? { severity: { in: query.severity } } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
      ...(query.controlId ? { controlId: query.controlId } : {}),
      ...(query.overdue ? { dueDate: { lt: new Date() }, status: { in: OPEN_STATES } } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { findingKey: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.finding.findMany({
        where,
        ...pageArgs(query),
        include: { assignedToRef: { select: { id: true, displayName: true } }, _count: { select: { tasks: true } } },
      }),
      this.prisma.finding.count({ where }),
    ]);
    return toPage(items.map(({ assignedToRef, ...f }) => ({ ...f, assignee: assignedToRef })), total, query);
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const finding = await this.prisma.finding.findFirst({
      where: { id, organizationId },
      include: {
        assignedToRef: { select: { id: true, displayName: true, email: true } },
        controlRef: { select: { id: true, controlCode: true, title: true } },
        riskRef: { select: { id: true, riskKey: true, title: true, status: true, residualRating: true, inherentRating: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 200 },
        tasks: { orderBy: { createdAt: 'asc' }, include: { ownerRef: { select: { id: true, displayName: true } } } },
      },
    });
    if (!finding) throw notFound('Finding');
    const evidence = await this.prisma.evidenceLink.findMany({
      where: { organizationId, entityType: 'finding', entityId: id },
      include: { evidence: { select: { id: true, title: true, reviewStatus: true, expiresAt: true } } },
    });
    const tests = finding.sourceType === 'control_test' && finding.controlId
      ? await this.prisma.controlTest.findMany({ where: { organizationId, controlId: finding.controlId }, orderBy: { startedAt: 'desc' }, take: 10 })
      : [];
    const { assignedToRef, controlRef, riskRef, ...rest } = finding;
    return {
      ...rest,
      assignee: assignedToRef,
      control: controlRef,
      risk: riskRef,
      tasks: finding.tasks.map(({ ownerRef, ...t }) => ({ ...t, owner: ownerRef })),
      evidence: evidence.map((e) => ({ linkId: e.id, ...e.evidence })),
      recentTests: tests,
    };
  }

  async create(input: {
    title: string;
    description: string;
    severity: Severity;
    severityRationale?: string;
    category?: string;
    sourceType?: string;
    sourceId?: string | null;
    controlId?: string | null;
    riskId?: string | null;
    assignedTo?: string | null;
    dueDate?: Date | null;
    noDueDateReason?: string | null;
  }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      if (input.controlId) await this.entities.resolve('control', input.controlId, tx);
      if (input.riskId) await this.entities.resolve('risk', input.riskId, tx);
      await this.entities.assertMember(input.assignedTo, tx);
      const dueDate = input.dueDate ?? (input.noDueDateReason ? null : defaultDue(input.severity));
      const finding = await tx.finding.create({
        data: {
          organizationId,
          findingKey: await nextKey(tx, organizationId, 'FND'),
          title: input.title,
          description: input.description,
          severity: input.severity,
          severityRationale: input.severityRationale,
          category: input.category,
          sourceType: input.sourceType ?? 'manual',
          sourceId: input.sourceId ?? null,
          controlId: input.controlId ?? null,
          riskId: input.riskId ?? null,
          assignedTo: input.assignedTo ?? null,
          dueDate,
          noDueDateReason: input.noDueDateReason ?? null,
          createdBy: actorId(),
        },
      });
      await this.afterCreate(tx, finding, 'Finding created manually');
      return finding;
    });
  }

  /**
   * Idempotent create-or-update for automated detections (spec §6.2):
   * one open finding per deduplication key; re-detection updates it instead of duplicating.
   * A new detection after closure creates a new finding, preserving the closed one's history.
   */
  async upsertFromDetection(tx: Tx, input: DetectionInput): Promise<{ finding: { id: string; findingKey: string }; created: boolean }> {
    // Serialize concurrent detections for the same key (two workers, same control).
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${input.organizationId}:finding:${input.deduplicationKey}`);
    const existing = await tx.finding.findFirst({
      where: { organizationId: input.organizationId, deduplicationKey: input.deduplicationKey, status: { in: OPEN_STATES } },
    });
    if (existing) {
      const escalate = severityRank(input.severity) > severityRank(existing.severity);
      await tx.finding.update({
        where: { id: existing.id },
        data: {
          lastDetectedAt: new Date(),
          detectionCount: { increment: 1 },
          ...(escalate ? { severity: input.severity, severityRationale: input.severityRationale } : {}),
        },
      });
      await tx.findingEvent.create({
        data: { organizationId: input.organizationId, findingId: existing.id, eventType: 'redetected', rationale: input.description.slice(0, 1000), sourceReference: input.sourceReference },
      });
      return { finding: existing, created: false };
    }
    const finding = await tx.finding.create({
      data: {
        organizationId: input.organizationId,
        findingKey: await nextKey(tx, input.organizationId, 'FND'),
        title: input.title,
        description: input.description,
        severity: input.severity,
        severityRationale: input.severityRationale,
        category: input.category,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        controlId: input.controlId ?? null,
        riskId: input.riskId ?? null,
        assignedTo: input.assignedTo ?? null,
        dueDate: defaultDue(input.severity),
        deduplicationKey: input.deduplicationKey,
      },
    });
    await this.afterCreate(tx, finding, `Detected by ${input.sourceType}`, input.sourceReference);
    return { finding, created: true };
  }

  /** A later passing check is recorded on the open finding, but never silently closes it (spec §6.2). */
  async recordPassingCheck(tx: Tx, organizationId: string, deduplicationKey: string, reference: string) {
    const open = await tx.finding.findFirst({ where: { organizationId, deduplicationKey, status: { in: OPEN_STATES } } });
    if (!open) return null;
    await tx.findingEvent.create({
      data: { organizationId, findingId: open.id, eventType: 'passed_check', rationale: 'A later automated check passed. Validate and close with rationale.', sourceReference: reference },
    });
    if (open.status === 'in_remediation') {
      await tx.finding.update({ where: { id: open.id }, data: { status: 'pending_validation', version: { increment: 1 } } });
      await tx.findingEvent.create({ data: { organizationId, findingId: open.id, eventType: 'transition', fromStatus: 'in_remediation', toStatus: 'pending_validation', rationale: 'Automated check passed' } });
    }
    return open;
  }

  async update(id: string, version: number, input: { title?: string; description?: string; severity?: Severity; severityRationale?: string; category?: string; assignedTo?: string | null; dueDate?: Date | null; noDueDateReason?: string | null; controlId?: string | null; riskId?: string | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const finding = await tx.finding.findFirst({ where: { id, organizationId } });
      if (!finding) throw notFound('Finding');
      if (finding.version !== version) throw versionConflict();
      if (input.controlId) await this.entities.resolve('control', input.controlId, tx);
      if (input.riskId) await this.entities.resolve('risk', input.riskId, tx);
      await this.entities.assertMember(input.assignedTo, tx);
      const dueDate = input.dueDate !== undefined ? input.dueDate : finding.dueDate;
      const reason = input.noDueDateReason !== undefined ? input.noDueDateReason : finding.noDueDateReason;
      if (!dueDate && !reason && OPEN_STATES.includes(finding.status)) throw badRequest('due_date_required', 'Set a due date or document why there is none.');
      const updated = await tx.finding.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
      if (input.assignedTo !== undefined && input.assignedTo !== finding.assignedTo) {
        await tx.findingEvent.create({ data: { organizationId, findingId: id, eventType: 'assigned', actorId: actorId(), rationale: input.assignedTo ? 'Assignee changed' : 'Unassigned' } });
        if (input.assignedTo) {
          await this.notifications.notify(
            { organizationId, recipientUserIds: [input.assignedTo], eventType: 'finding.assigned', title: `Finding ${finding.findingKey} assigned to you`, message: updated.title, entityType: 'finding', entityId: id },
            tx,
          );
        }
      }
      await this.audit.record({ action: 'finding.updated', entityType: 'finding', entityId: id, before: diffBefore(finding, input), after: input }, tx);
      return updated;
    });
  }

  async transition(id: string, input: { toStatus: FindingStatus; rationale: string; closureEvidenceId?: string | null; version?: number }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const finding = await tx.finding.findFirst({ where: { id, organizationId } });
      if (!finding) throw notFound('Finding');
      if (input.version !== undefined && finding.version !== input.version) throw versionConflict();
      if (!FINDING_TRANSITIONS[finding.status].includes(input.toStatus)) throw invalidTransition(finding.status, input.toStatus);
      if (!input.rationale?.trim()) throw badRequest('rationale_required', 'A rationale is required for every transition.');

      const closing = input.toStatus === 'closed' || input.toStatus === 'accepted';
      if (closing) await this.assertCanClose(tx, finding, input);

      const updated = await tx.finding.updateMany({
        where: { id, version: finding.version },
        data: {
          status: input.toStatus,
          version: { increment: 1 },
          ...(closing
            ? { closedAt: new Date(), closedBy: actorId(), closureRationale: input.rationale, closureEvidenceId: input.closureEvidenceId ?? null }
            : input.toStatus === 'reopened'
              ? { closedAt: null, closedBy: null, closureRationale: null, closureEvidenceId: null, dueDate: finding.dueDate && finding.dueDate > new Date() ? finding.dueDate : defaultDue(finding.severity) }
              : {}),
        },
      });
      if (updated.count !== 1) throw versionConflict();
      await tx.findingEvent.create({
        data: { organizationId, findingId: id, eventType: 'transition', fromStatus: finding.status, toStatus: input.toStatus, actorId: actorId(), rationale: input.rationale },
      });
      if (input.closureEvidenceId) {
        await tx.evidenceLink.upsert({
          where: { evidenceId_entityType_entityId: { evidenceId: input.closureEvidenceId, entityType: 'finding', entityId: id } },
          create: { organizationId, evidenceId: input.closureEvidenceId, entityType: 'finding', entityId: id, purpose: 'closure', linkedBy: actorId() },
          update: {},
        });
      }
      await this.audit.record({ action: 'finding.transitioned', entityType: 'finding', entityId: id, before: { status: finding.status }, after: { status: input.toStatus }, rationale: input.rationale }, tx);
      return tx.finding.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Closure needs permission, rationale, evidence where appropriate and separation of duties (spec §6.2–6.3). */
  private async assertCanClose(tx: Tx, finding: { id: string; organizationId: string; severity: Severity; assignedTo: string | null; sourceType: string; riskId: string | null; deduplicationKey: string | null; lastDetectedAt: Date }, input: { toStatus: FindingStatus; closureEvidenceId?: string | null }) {
    if (!hasPermission('finding.close')) throw forbidden('You do not have permission to close or accept findings.');
    const settings = await this.settings(tx, finding.organizationId);
    const highImpact = finding.severity === 'high' || finding.severity === 'critical';
    if (highImpact && settings.requireSeparationOfDutiesForHighRisk && finding.assignedTo === actorId()) {
      throw separationOfDuties('High and critical findings must be closed by someone other than the assignee.');
    }
    if (input.toStatus === 'accepted') {
      if (!finding.riskId) throw badRequest('risk_required', 'Link this finding to a risk with an approved acceptance before accepting it.');
      const acceptance = await tx.riskAcceptance.findFirst({ where: { riskId: finding.riskId, decision: 'approved', expiryDate: { gt: new Date() } } });
      if (!acceptance) throw badRequest('acceptance_required', 'The linked risk has no approved, unexpired acceptance.');
      return;
    }
    if (input.closureEvidenceId) {
      await this.entities.assertEvidence(input.closureEvidenceId, tx);
      return;
    }
    if (finding.sourceType === 'control_test') {
      // Automated findings close on evidence of a fix: a passing check after the last failure.
      const passed = await tx.findingEvent.findFirst({ where: { findingId: finding.id, eventType: 'passed_check', createdAt: { gt: finding.lastDetectedAt } } });
      if (!passed) throw badRequest('closure_evidence_required', 'Attach closure evidence or re-run the control test until it passes.');
      return;
    }
    if (highImpact) throw badRequest('closure_evidence_required', 'High and critical findings need closure evidence.');
  }

  private async afterCreate(tx: Tx, finding: { id: string; organizationId: string; findingKey: string; title: string; severity: Severity; assignedTo: string | null }, rationale: string, reference?: string) {
    await tx.findingEvent.create({
      data: { organizationId: finding.organizationId, findingId: finding.id, eventType: 'created', toStatus: 'open', actorId: actorId(), rationale, sourceReference: reference },
    });
    await this.audit.record({ action: 'finding.created', entityType: 'finding', entityId: finding.id, organizationId: finding.organizationId, after: { findingKey: finding.findingKey, severity: finding.severity, title: finding.title } }, tx);
    if (finding.assignedTo) {
      await this.notifications.notify(
        { organizationId: finding.organizationId, recipientUserIds: [finding.assignedTo], eventType: 'finding.assigned', title: `Finding ${finding.findingKey} assigned to you`, message: finding.title, entityType: 'finding', entityId: finding.id, dedupeKey: `finding-assigned:${finding.id}` },
        tx,
      );
    }
    if (finding.severity === 'high' || finding.severity === 'critical') {
      await this.events.emit(tx, finding.organizationId, 'finding.created', { findingId: finding.id, severity: finding.severity }, `finding:${finding.id}`);
    }
  }

  private async settings(tx: Tx, organizationId: string): Promise<Required<OrganizationSettings>> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return { ...DEFAULT_SETTINGS, ...(org.settings as OrganizationSettings) };
  }
}

export function defaultDue(severity: Severity, from = new Date()): Date {
  return new Date(from.getTime() + DEFAULT_DUE_DAYS[severity] * 86_400_000);
}

export function severityRank(severity: Severity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity];
}

function diffBefore(finding: Record<string, unknown>, input: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(input).map((k) => [k, finding[k] ?? null]));
}

