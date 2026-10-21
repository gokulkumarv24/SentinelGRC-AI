import { Injectable } from '@nestjs/common';
import { requireOrgId } from '../../common/request-context.js';
import type { Severity } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ComplianceService, calculateMetrics } from '../compliance/compliance.service.js';
import { rate } from '../risks/risk-scoring.js';

const DAY = 86_400_000;
const OPEN_FINDINGS = ['open', 'triaged', 'in_remediation', 'pending_validation', 'reopened'] as const;
const IMPORTANT_ACTIONS = ['risk.acceptance_approved', 'risk.acceptance_rejected', 'finding.created', 'finding.transitioned', 'member.roles_changed', 'framework.imported', 'evidence.rejected', 'vendor.decision', 'ai_assessment.decided', 'ai_system.lifecycle_changed', 'auth.login_failed', 'authz.denied', 'scoring_policy.updated'];

/** Executive dashboard (spec §7). Every figure comes from a query; nothing is hard-coded. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
  ) {}

  async summary() {
    const organizationId = requireOrgId();
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * DAY);
    const [risks, findingsBySeverity, overdueFindings, controlSnapshots, vendors, vendorAssessments, aiSystems, overdueTasks] = await Promise.all([
      this.prisma.risk.findMany({ where: { organizationId, archivedAt: null, status: { not: 'closed' } }, select: { inherentRating: true, residualRating: true, status: true } }),
      this.prisma.finding.groupBy({ by: ['severity'], where: { organizationId, status: { in: [...OPEN_FINDINGS] } }, _count: true }),
      this.prisma.finding.count({ where: { organizationId, status: { in: [...OPEN_FINDINGS] }, dueDate: { lt: now } } }),
      this.compliance.snapshots(organizationId),
      this.prisma.vendor.groupBy({ by: ['riskTier', 'status'], where: { organizationId, status: { not: 'archived' } }, _count: true }),
      this.prisma.vendorAssessment.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.prisma.aiSystem.groupBy({ by: ['lifecycleStatus', 'riskTier'], where: { organizationId }, _count: true }),
      this.prisma.remediationTask.count({ where: { organizationId, status: { in: ['open', 'in_progress', 'blocked'] }, dueDate: { lt: now } } }),
    ]);

    const riskBySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of risks) riskBySeverity[(r.residualRating ?? r.inherentRating) as Severity]++;
    const findings: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const f of findingsBySeverity) findings[f.severity] = f._count;
    const controls = calculateMetrics(controlSnapshots);

    const vendorTiers: Record<string, number> = {};
    const vendorStatus: Record<string, number> = {};
    for (const v of vendors) {
      vendorTiers[v.riskTier ?? 'not_assessed'] = (vendorTiers[v.riskTier ?? 'not_assessed'] ?? 0) + v._count;
      vendorStatus[v.status] = (vendorStatus[v.status] ?? 0) + v._count;
    }
    const aiLifecycle: Record<string, number> = {};
    const aiTiers: Record<string, number> = {};
    for (const a of aiSystems) {
      aiLifecycle[a.lifecycleStatus] = (aiLifecycle[a.lifecycleStatus] ?? 0) + a._count;
      aiTiers[a.riskTier] = (aiTiers[a.riskTier] ?? 0) + a._count;
    }

    return {
      refreshedAt: now,
      risks: { active: risks.length, bySeverity: riskBySeverity, basis: 'residual rating where assessed, otherwise inherent' },
      findings: { open: Object.values(findings).reduce((a, b) => a + b, 0), overdue: overdueFindings, bySeverity: findings },
      remediation: { overdue: overdueTasks },
      controls: {
        total: controls.controls,
        missingEvidence: controls.evidence.missing,
        expiredEvidence: controls.evidence.expired,
        expiringEvidence: controls.evidence.expiring,
        tests: controls.tests,
        testPassRate: controls.testPassRate,
        implementationCoverage: controls.implementationCoverage,
      },
      vendors: { byTier: vendorTiers, byStatus: vendorStatus, assessmentsByStatus: Object.fromEntries(vendorAssessments.map((a) => [a.status, a._count])) },
      aiSystems: { byLifecycle: aiLifecycle, byTier: aiTiers },
      upcoming: await this.upcoming(organizationId, now, soon),
    };
  }

  /** Compliance per in-scope framework (delegates to the documented calculation). */
  compliancePosture() {
    return this.compliance.summary();
  }

  /**
   * Monthly inherent vs residual trend, reconstructed from risk history (end-of-month state).
   * Values are sums of scores of open risks, plus counts by rating.
   */
  async riskTrends(months = 12) {
    const organizationId = requireOrgId();
    const now = new Date();
    const risks = await this.prisma.risk.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, createdAt: true, history: { orderBy: { changedAt: 'asc' }, select: { changedAt: true, newValues: true } } },
    });
    const policy = await this.prisma.scoringPolicy.findFirst({ where: { organizationId, kind: 'risk', active: true } });
    const tiers = (policy?.config as { tiers?: { low: number; medium: number; high: number } } | undefined)?.tiers;
    const points = [];
    for (let i = months - 1; i >= 0; i--) {
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1) - 1);
      const asOf = end > now ? now : end;
      let inherent = 0;
      let residual = 0;
      let count = 0;
      const ratings: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const r of risks) {
        if (r.createdAt > asOf) continue;
        const state: Record<string, unknown> = {};
        for (const h of r.history) {
          if (h.changedAt > asOf) break;
          Object.assign(state, h.newValues as Record<string, unknown>);
        }
        if (state.status === 'closed') continue;
        const inh = Number(state.inherentScore ?? 0);
        const res = state.residualScore == null ? inh : Number(state.residualScore);
        if (!inh) continue;
        count++;
        inherent += inh;
        residual += res;
        ratings[rate(res, tiers ? { method: 'likelihood_x_impact', scale: { min: 1, max: 5 }, tiers, acceptanceMaxDays: 365, sodRequiredFrom: 'high' } : undefined)]++;
      }
      points.push({ month: asOf.toISOString().slice(0, 7), openRisks: count, inherentTotal: inherent, residualTotal: residual, byResidualRating: ratings });
    }
    return { refreshedAt: now, method: 'End-of-month state reconstructed from risk history. Residual falls back to inherent when not yet assessed.', points };
  }

  async recentEvents() {
    const organizationId = requireOrgId();
    const [events, failures] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: { organizationId, OR: [{ action: { in: IMPORTANT_ACTIONS } }, { outcome: { not: 'success' } }] },
        orderBy: { timestamp: 'desc' },
        take: 15,
        include: { actorUserRef: { select: { displayName: true } } },
      }),
      this.prisma.workflowRun.findMany({
        where: { organizationId, status: { in: ['failed', 'partially_succeeded'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { definition: { select: { name: true, key: true } } },
      }),
    ]);
    return {
      events: events.map(({ actorUserRef, ...e }) => ({ ...e, actor: actorUserRef })),
      workflowFailures: failures.map((f) => ({ id: f.id, workflow: f.definition.name, status: f.status, errorCode: f.errorCode, errorMessage: f.errorMessage, attemptCount: f.attemptCount, createdAt: f.createdAt })),
    };
  }

  private async upcoming(organizationId: string, now: Date, soon: Date) {
    const [controls, vendors, aiSystems, risks, acceptances, assessments] = await Promise.all([
      this.prisma.controlImplementation.findMany({ where: { organizationId, nextReviewAt: { lte: soon }, control: { active: true } }, orderBy: { nextReviewAt: 'asc' }, take: 10, select: { nextReviewAt: true, control: { select: { id: true, controlCode: true, title: true } } } }),
      this.prisma.vendor.findMany({ where: { organizationId, nextAssessmentAt: { lte: soon }, status: { not: 'archived' } }, orderBy: { nextAssessmentAt: 'asc' }, take: 10, select: { id: true, name: true, nextAssessmentAt: true } }),
      this.prisma.aiSystem.findMany({ where: { organizationId, nextReviewAt: { lte: soon }, lifecycleStatus: { not: 'retired' } }, orderBy: { nextReviewAt: 'asc' }, take: 10, select: { id: true, name: true, nextReviewAt: true } }),
      this.prisma.risk.findMany({ where: { organizationId, archivedAt: null, reviewDate: { lte: soon }, status: { not: 'closed' } }, orderBy: { reviewDate: 'asc' }, take: 10, select: { id: true, riskKey: true, title: true, reviewDate: true } }),
      this.prisma.riskAcceptance.findMany({ where: { organizationId, decision: 'approved', expiryDate: { lte: soon } }, orderBy: { expiryDate: 'asc' }, take: 10, select: { id: true, expiryDate: true, risk: { select: { id: true, riskKey: true, title: true } } } }),
      this.prisma.vendorAssessment.findMany({ where: { organizationId, dueDate: { lte: soon }, status: { in: ['draft', 'submitted', 'under_review', 'returned_for_clarification'] } }, orderBy: { dueDate: 'asc' }, take: 10, select: { id: true, dueDate: true, vendor: { select: { name: true } } } }),
    ]);
    const items = [
      ...controls.map((c) => ({ type: 'control_review', id: c.control.id, label: `${c.control.controlCode} review`, due: c.nextReviewAt!, href: `/controls/${c.control.id}` })),
      ...vendors.map((v) => ({ type: 'vendor_reassessment', id: v.id, label: `${v.name} reassessment`, due: v.nextAssessmentAt!, href: `/vendors/${v.id}` })),
      ...aiSystems.map((a) => ({ type: 'ai_review', id: a.id, label: `${a.name} AI review`, due: a.nextReviewAt!, href: `/ai-governance/${a.id}` })),
      ...risks.map((r) => ({ type: 'risk_review', id: r.id, label: `${r.riskKey} review`, due: r.reviewDate!, href: `/risks/${r.id}` })),
      ...acceptances.map((a) => ({ type: 'acceptance_expiry', id: a.risk.id, label: `${a.risk.riskKey} acceptance expires`, due: a.expiryDate, href: `/risks/${a.risk.id}` })),
      ...assessments.map((a) => ({ type: 'assessment_due', id: a.id, label: `${a.vendor.name} questionnaire due`, due: a.dueDate!, href: `/vendors/assessments/${a.id}` })),
    ];
    return items.sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 20).map((i) => ({ ...i, overdue: i.due < now }));
  }
}
