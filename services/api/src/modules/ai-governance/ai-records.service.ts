import { Injectable } from '@nestjs/common';
import { badRequest, conflict, invalidTransition, notFound, separationOfDuties } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { IncidentStatus, Prisma, Severity } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FindingsService } from '../findings/findings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';

const INCIDENT_FLOW: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['investigating', 'mitigated', 'resolved'],
  investigating: ['mitigated', 'resolved'],
  mitigated: ['resolved', 'investigating'],
  resolved: ['closed', 'investigating'],
  closed: [],
};

/** Evaluations, incidents and model/purpose changes for AI systems (spec §10.4). */
@Injectable()
export class AiRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly findings: FindingsService,
    private readonly notifications: NotificationsService,
    private readonly events: EventQueue,
  ) {}

  private async system(id: string) {
    const s = await this.prisma.aiSystem.findFirst({ where: { id, organizationId: requireOrgId() } });
    if (!s) throw notFound('AI system');
    return s;
  }

  // ── Evaluations ──
  async listEvaluations(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; aiSystemId?: string; evaluationType?: string }) {
    const where: Prisma.AiEvaluationWhereInput = { organizationId: requireOrgId(), ...(query.aiSystemId ? { aiSystemId: query.aiSystemId } : {}), ...(query.evaluationType ? { evaluationType: query.evaluationType } : {}) };
    const [items, total] = await Promise.all([this.prisma.aiEvaluation.findMany({ where, ...pageArgs(query), include: { aiSystem: { select: { id: true, name: true } } } }), this.prisma.aiEvaluation.count({ where })]);
    return toPage(items, total, query);
  }

  async createEvaluation(aiSystemId: string, input: { evaluationType: string; methodology: string; datasetOrMethodDescription: string; version: string; result: string; metrics: Record<string, unknown>; limitations: string; executedAt: Date; evidenceId?: string | null }) {
    const organizationId = requireOrgId();
    await this.system(aiSystemId);
    if (input.executedAt.getTime() > Date.now() + 86_400_000) throw badRequest('invalid_date', 'Execution date cannot be in the future.');
    return this.prisma.tx(async (tx) => {
      await this.entities.assertEvidence(input.evidenceId, tx);
      const evaluation = await tx.aiEvaluation.create({ data: { organizationId, aiSystemId, ...input, metrics: input.metrics as Prisma.InputJsonValue, executedBy: actorId(), approvalStatus: 'pending_review' } });
      if (input.evidenceId) {
        await tx.evidenceLink.upsert({
          where: { evidenceId_entityType_entityId: { evidenceId: input.evidenceId, entityType: 'ai_evaluation', entityId: evaluation.id } },
          create: { organizationId, evidenceId: input.evidenceId, entityType: 'ai_evaluation', entityId: evaluation.id, purpose: 'evaluation_result', linkedBy: actorId() },
          update: {},
        });
      }
      await this.audit.record({ action: 'ai_evaluation.recorded', entityType: 'ai_system', entityId: aiSystemId, after: { evaluationId: evaluation.id, type: input.evaluationType, result: input.result, version: input.version } }, tx);
      return evaluation;
    });
  }

  async reviewEvaluation(id: string, decision: 'approved' | 'rejected', notes: string) {
    const organizationId = requireOrgId();
    const evaluation = await this.prisma.aiEvaluation.findFirst({ where: { id, organizationId } });
    if (!evaluation) throw notFound('Evaluation');
    if (evaluation.executedBy === requireUserId()) throw separationOfDuties('Evaluations must be approved by someone other than the evaluator.');
    const updated = await this.prisma.aiEvaluation.update({ where: { id }, data: { approvalStatus: decision, approvedBy: requireUserId(), approvedAt: new Date() } });
    await this.audit.record({ action: `ai_evaluation.${decision}`, entityType: 'ai_system', entityId: evaluation.aiSystemId, after: { evaluationId: id }, rationale: notes });
    return updated;
  }

  // ── Incidents ──
  async listIncidents(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; aiSystemId?: string; status?: IncidentStatus[]; severity?: Severity[] }) {
    const where: Prisma.AiIncidentWhereInput = { organizationId: requireOrgId(), ...(query.aiSystemId ? { aiSystemId: query.aiSystemId } : {}), ...(query.status ? { status: { in: query.status } } : {}), ...(query.severity ? { severity: { in: query.severity } } : {}) };
    const [items, total] = await Promise.all([this.prisma.aiIncident.findMany({ where, ...pageArgs(query), include: { aiSystem: { select: { id: true, name: true } } } }), this.prisma.aiIncident.count({ where })]);
    return toPage(items, total, query);
  }

  async createIncident(aiSystemId: string, input: { title: string; severity: Severity; description: string; detectedAt: Date; impact?: string | null }) {
    const organizationId = requireOrgId();
    const system = await this.system(aiSystemId);
    return this.prisma.tx(async (tx) => {
      const incident = await tx.aiIncident.create({ data: { organizationId, aiSystemId, ...input, reportedBy: actorId() } });
      let findingId: string | null = null;
      if (input.severity === 'high' || input.severity === 'critical') {
        const { finding } = await this.findings.upsertFromDetection(tx, {
          organizationId,
          deduplicationKey: `ai-incident:${incident.id}`,
          title: `AI incident: ${input.title}`,
          description: `${input.description}\n\nImpact: ${input.impact ?? 'not yet assessed'}`,
          sourceType: 'ai_incident',
          sourceId: incident.id,
          severity: input.severity,
          severityRationale: 'Severity recorded on the AI incident.',
          category: 'AI incident',
          assignedTo: system.riskOwnerId ?? system.technicalOwnerId ?? system.businessOwnerId,
          sourceReference: `ai_incident:${incident.id}`,
        });
        findingId = finding.id;
        await tx.aiIncident.update({ where: { id: incident.id }, data: { findingId } });
      }
      await this.notifications.notify({ organizationId, recipientUserIds: [system.businessOwnerId, system.technicalOwnerId, system.riskOwnerId], eventType: 'finding.high_created', title: `AI incident (${input.severity}): ${system.name}`, message: input.title, entityType: 'ai_system', entityId: aiSystemId }, tx);
      await this.audit.record({ action: 'ai_incident.reported', entityType: 'ai_system', entityId: aiSystemId, after: { incidentId: incident.id, severity: input.severity, findingId } }, tx);
      return { ...incident, findingId };
    });
  }

  async updateIncident(id: string, input: { status?: IncidentStatus; impact?: string | null; rootCause?: string | null; responseActions?: string | null; lessonsLearned?: string | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const incident = await tx.aiIncident.findFirst({ where: { id, organizationId } });
      if (!incident) throw notFound('Incident');
      if (input.status && input.status !== incident.status && !INCIDENT_FLOW[incident.status].includes(input.status)) throw invalidTransition(incident.status, input.status);
      const resolving = input.status === 'resolved' || input.status === 'closed';
      if (resolving && !(input.rootCause ?? incident.rootCause)?.trim()) throw badRequest('root_cause_required', 'Record the root cause before resolving.');
      if (input.status === 'closed' && !(input.lessonsLearned ?? incident.lessonsLearned)?.trim()) throw badRequest('lessons_required', 'Record lessons learned before closing.');
      const updated = await tx.aiIncident.update({ where: { id }, data: { ...input, ...(input.status === 'resolved' ? { resolvedAt: new Date() } : {}) } });
      await this.audit.record({ action: 'ai_incident.updated', entityType: 'ai_system', entityId: incident.aiSystemId, before: { status: incident.status }, after: { incidentId: id, ...input } }, tx);
      return updated;
    });
  }

  // ── Model / provider / purpose changes ──
  async listChanges(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; aiSystemId?: string; reviewStatus?: string[] }) {
    const where: Prisma.AiModelChangeWhereInput = { organizationId: requireOrgId(), ...(query.aiSystemId ? { aiSystemId: query.aiSystemId } : {}), ...(query.reviewStatus ? { reviewStatus: { in: query.reviewStatus as never[] } } : {}) };
    const [items, total] = await Promise.all([this.prisma.aiModelChange.findMany({ where, ...pageArgs(query), include: { aiSystem: { select: { id: true, name: true, modelVersion: true } } } }), this.prisma.aiModelChange.count({ where })]);
    return toPage(items, total, query);
  }

  async createChange(aiSystemId: string, input: { changeType: string; changeDescription: string; previousVersion?: string | null; newVersion?: string | null; changeRisk: Severity; requiresReassessment: boolean }) {
    const organizationId = requireOrgId();
    const system = await this.system(aiSystemId);
    return this.prisma.tx(async (tx) => {
      const change = await tx.aiModelChange.create({ data: { organizationId, aiSystemId, ...input, previousVersion: input.previousVersion ?? system.modelVersion, requestedBy: actorId() } });
      if (input.requiresReassessment) await tx.aiSystem.update({ where: { id: aiSystemId }, data: { nextReviewAt: new Date(), version: { increment: 1 } } });
      await this.events.emit(tx, organizationId, 'ai_model_change.created', { changeId: change.id, aiSystemId, changeType: input.changeType, requiresReassessment: input.requiresReassessment }, `ai-change:${change.id}`);
      await this.audit.record({ action: 'ai_model_change.recorded', entityType: 'ai_system', entityId: aiSystemId, after: { changeId: change.id, changeType: input.changeType, newVersion: input.newVersion ?? null, changeRisk: input.changeRisk, requiresReassessment: input.requiresReassessment } }, tx);
      return change;
    });
  }

  async reviewChange(id: string, decision: 'approved' | 'rejected', notes: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const change = await tx.aiModelChange.findFirst({ where: { id, organizationId } });
      if (!change) throw notFound('Change');
      if (change.reviewStatus === 'approved' || change.reviewStatus === 'rejected') throw conflict('This change has already been reviewed.');
      if (change.requestedBy === requireUserId()) throw separationOfDuties('A change must be reviewed by someone other than the requester.');
      const updated = await tx.aiModelChange.update({ where: { id }, data: { reviewStatus: decision, reviewedBy: requireUserId(), reviewedAt: new Date(), reviewNotes: notes } });
      if (decision === 'approved' && change.changeType === 'model_version' && change.newVersion) {
        await tx.aiSystem.update({ where: { id: change.aiSystemId }, data: { modelVersion: change.newVersion, version: { increment: 1 } } });
      }
      await this.audit.record({ action: `ai_model_change.${decision}`, entityType: 'ai_system', entityId: change.aiSystemId, after: { changeId: id }, rationale: notes }, tx);
      return updated;
    });
  }
}
