import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../../common/errors.js';
import type { Severity } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ComplianceService, METRIC_DEFINITIONS } from '../compliance/compliance.service.js';
import { MAX_ROWS, type Cell, type ReportFilters, type ReportModel, type ReportSection, type ReportTypeDef } from './report-model.js';

const DAY = 86_400_000;
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export const REPORT_TYPES: ReportTypeDef[] = [
  { key: 'executive_risk_summary', title: 'Executive risk summary', description: 'Active risks by rating, top risks, open findings and overdue remediation.', requires: ['risk.read', 'finding.read'], filters: [] },
  { key: 'compliance_posture', title: 'Compliance posture by framework', description: 'Implementation coverage, latest test results and evidence currency per framework and version.', requires: ['framework.read', 'control.read'], filters: ['frameworkId'] },
  { key: 'control_status', title: 'Control implementation and test status', description: 'Every active control with implementation status, latest test result, evidence currency and open findings.', requires: ['control.read'], filters: [] },
  { key: 'evidence_gaps', title: 'Evidence gaps and expiry', description: 'Expired and expiring evidence, and controls without current evidence.', requires: ['evidence.read', 'control.read'], filters: [] },
  { key: 'findings_aging', title: 'Open findings and remediation aging', description: 'Open findings by age and severity, and open remediation tasks with due dates.', requires: ['finding.read', 'remediation.read'], filters: [] },
  { key: 'risk_register', title: 'Risk register export', description: 'All non-archived risks with inherent and residual scoring, owner, treatment and status.', requires: ['risk.read'], filters: [] },
  { key: 'vendor_assessment', title: 'Vendor assessment report', description: 'One vendor assessment: profile, score breakdown, reviewed responses, findings and decision.', requires: ['vendor.read', 'vendor_assessment.read'], filters: ['assessmentId'], requiredFilters: ['assessmentId'] },
  { key: 'vendor_portfolio', title: 'Vendor portfolio risk', description: 'All vendors with criticality, inherent and residual scores, tier and reassessment dates.', requires: ['vendor.read'], filters: [] },
  { key: 'ai_inventory', title: 'AI inventory and risk assessments', description: 'AI systems with lifecycle, risk tier, owners, latest assessment and next review.', requires: ['ai_system.read'], filters: ['aiSystemId'] },
  { key: 'ai_incidents_evaluations', title: 'AI incident and evaluation summary', description: 'AI incidents and evaluations in the reporting period.', requires: ['ai_system.read'], filters: ['from', 'to', 'aiSystemId'], periodic: true },
  { key: 'workflow_integration_health', title: 'Workflow and integration health', description: 'Workflow run outcomes in the period and the current state of each integration.', requires: ['workflow.read', 'integration.read'], filters: ['from', 'to'], periodic: true },
  { key: 'audit_activity', title: 'Audit activity', description: 'Audit events in the period, summarized by action, with the event list.', requires: ['audit.read'], filters: ['from', 'to'], periodic: true },
];

export const REPORT_TYPES_BY_KEY = new Map(REPORT_TYPES.map((t) => [t.key, t]));

export interface BuildContext {
  organizationId: string;
  filters: ReportFilters;
  now: Date;
  timezone: string;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v}%`);

function section(heading: string, columns: ReportSection['columns'], rows: Array<Record<string, Cell>>, description?: string): ReportSection {
  return rows.length > MAX_ROWS ? { heading, description, columns, rows: rows.slice(0, MAX_ROWS), truncatedAt: MAX_ROWS } : { heading, description, columns, rows };
}

/** Builds report content from tenant-scoped queries. Called only inside a request or job context for that organization. */
@Injectable()
export class ReportBuilders {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
  ) {}

  period(def: ReportTypeDef, filters: ReportFilters, now: Date) {
    if (!def.periodic) return null;
    const to = filters.to ? new Date(filters.to) : now;
    const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * DAY);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw badRequest('invalid_period', 'The reporting period is invalid');
    return { from, to };
  }

  async build(def: ReportTypeDef, ctx: BuildContext): Promise<ReportModel> {
    switch (def.key) {
      case 'executive_risk_summary': return this.executiveRiskSummary(ctx);
      case 'compliance_posture': return this.compliancePosture(ctx);
      case 'control_status': return this.controlStatus(ctx);
      case 'evidence_gaps': return this.evidenceGaps(ctx);
      case 'findings_aging': return this.findingsAging(ctx);
      case 'risk_register': return this.riskRegister(ctx);
      case 'vendor_assessment': return this.vendorAssessment(ctx);
      case 'vendor_portfolio': return this.vendorPortfolio(ctx);
      case 'ai_inventory': return this.aiInventory(ctx);
      case 'ai_incidents_evaluations': return this.aiIncidentsEvaluations(def, ctx);
      case 'workflow_integration_health': return this.workflowHealth(def, ctx);
      case 'audit_activity': return this.auditActivity(def, ctx);
      default: throw badRequest('unknown_report_type', 'Unknown report type');
    }
  }

  private async names(organizationId: string, ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unique.length) return new Map<string, string>();
    // Only members of this organization are resolved; other ids show as "(unknown user)".
    const rows = await this.prisma.membership.findMany({ where: { organizationId, userId: { in: unique } }, select: { userId: true, user: { select: { displayName: true } } } });
    return new Map(rows.map((r) => [r.userId, r.user.displayName]));
  }

  private name(map: Map<string, string>, id: string | null | undefined) {
    return id ? (map.get(id) ?? '(unknown user)') : 'Unassigned';
  }

  private fmt(d: Date | null | undefined, tz: string) {
    if (!d) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  private async executiveRiskSummary({ organizationId, now, timezone }: BuildContext): Promise<ReportModel> {
    const risks = await this.prisma.risk.findMany({ where: { organizationId, archivedAt: null, status: { not: 'closed' } } });
    const findings = await this.prisma.finding.findMany({ where: { organizationId, status: { notIn: ['closed', 'accepted'] } }, select: { id: true, severity: true } });
    const overdue = await this.prisma.remediationTask.count({ where: { organizationId, status: { in: ['open', 'in_progress', 'blocked'] }, dueDate: { lt: now } } });
    const owners = await this.names(organizationId, risks.map((r) => r.riskOwnerId));
    const effective = (r: (typeof risks)[number]) => r.residualRating ?? r.inherentRating;
    const top = [...risks].sort((a, b) => (b.residualScore ?? b.inherentScore) - (a.residualScore ?? a.inherentScore)).slice(0, 15);
    return {
      scope: 'All active (non-closed, non-archived) risks and open findings at generation time.',
      metrics: [
        { label: 'Active risks', value: risks.length, definition: 'Risks not closed or archived.' },
        { label: 'Critical or high risks', value: risks.filter((r) => ['critical', 'high'].includes(effective(r))).length, definition: 'Using residual rating where assessed, otherwise inherent rating.' },
        { label: 'Accepted risks', value: risks.filter((r) => r.status === 'accepted').length, definition: 'Risks with an approved, unexpired acceptance.' },
        { label: 'Open critical/high findings', value: findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length, definition: 'Findings not closed or accepted.' },
        { label: 'Overdue remediation tasks', value: overdue, definition: 'Open, in-progress or blocked tasks past their due date.' },
      ],
      sections: [
        section('Risks by rating', [{ key: 'rating', label: 'Rating' }, { key: 'inherent', label: 'Inherent' }, { key: 'residual', label: 'Residual' }], [
          ...SEVERITIES.map((s) => ({ rating: s, inherent: risks.filter((r) => r.inherentRating === s).length, residual: risks.filter((r) => r.residualRating === s).length })),
          { rating: 'residual not assessed', inherent: null, residual: risks.filter((r) => !r.residualRating).length },
        ]),
        section('Top risks', [
          { key: 'key', label: 'Key', width: 1 }, { key: 'title', label: 'Title', width: 3 }, { key: 'inherent', label: 'Inherent', width: 1.2 }, { key: 'residual', label: 'Residual', width: 1.2 },
          { key: 'owner', label: 'Owner', width: 1.5 }, { key: 'status', label: 'Status', width: 1.2 }, { key: 'review', label: 'Review date', width: 1.2 },
        ], top.map((r) => ({ key: r.riskKey, title: r.title, inherent: `${r.inherentScore} ${r.inherentRating}`, residual: r.residualScore ? `${r.residualScore} ${r.residualRating}` : 'not assessed', owner: this.name(owners, r.riskOwnerId), status: r.status, review: this.fmt(r.reviewDate, timezone) })), 'Up to 15 risks with the highest residual score (inherent where residual is not assessed).'),
        section('Open findings by severity', [{ key: 'severity', label: 'Severity' }, { key: 'count', label: 'Open findings' }], SEVERITIES.map((s) => ({ severity: s, count: findings.filter((f) => f.severity === s).length }))),
      ],
      definitions: ['Inherent score = likelihood × impact (1–25). Residual score uses separately assessed residual likelihood and impact after verified mitigations.', 'Rating tiers follow the organization’s versioned risk scoring policy.'],
      exclusions: ['Closed and archived risks.', 'Closed and accepted findings.'],
      sources: top.map((r) => ({ type: 'risk', id: r.id, label: r.riskKey })),
    };
  }

  private async compliancePosture({ filters }: BuildContext): Promise<ReportModel> {
    const summary = await this.compliance.summary();
    const blocks = filters.frameworkId ? summary.frameworks.filter((f) => f.framework.id === filters.frameworkId) : summary.frameworks;
    if (filters.frameworkId && !blocks.length) throw notFound('Framework');
    const m = summary.overall;
    return {
      scope: filters.frameworkId ? `Framework ${blocks[0].framework.name} ${blocks[0].framework.version}.` : 'All frameworks in the organization’s scope.',
      metrics: [
        { label: METRIC_DEFINITIONS.implementationCoverage.label, value: pct(m.implementationCoverage), definition: METRIC_DEFINITIONS.implementationCoverage.formula },
        { label: METRIC_DEFINITIONS.testPassRate.label, value: pct(m.testPassRate), definition: METRIC_DEFINITIONS.testPassRate.formula },
        { label: METRIC_DEFINITIONS.evidenceCurrency.label, value: pct(m.evidenceCurrency), definition: METRIC_DEFINITIONS.evidenceCurrency.formula },
        { label: 'Applicable controls', value: m.applicable, definition: 'Active controls not marked not applicable or retired.' },
      ],
      sections: [
        section('Results per framework and version', [
          { key: 'framework', label: 'Framework', width: 2.5 }, { key: 'controls', label: 'Mapped controls' }, { key: 'impl', label: 'Implementation' }, { key: 'pass', label: 'Pass rate' },
          { key: 'results', label: 'Pass / fail / error / unknown / not tested', width: 2 }, { key: 'evidence', label: 'Evidence currency' }, { key: 'reqs', label: 'Requirement coverage' }, { key: 'pending', label: 'Mappings pending review' },
        ], blocks.map((b) => ({
          framework: `${b.framework.name} ${b.framework.version}${b.framework.isIllustrative ? ' (illustrative)' : ''}`,
          controls: b.metrics.controls,
          impl: pct(b.metrics.implementationCoverage),
          pass: pct(b.metrics.testPassRate),
          results: `${b.metrics.tests.pass} / ${b.metrics.tests.fail} / ${b.metrics.tests.error} / ${b.metrics.tests.unknown} / ${b.metrics.tests.notTested}`,
          evidence: pct(b.metrics.evidenceCurrency),
          reqs: pct(b.requirementCoverage),
          pending: b.requirements.pendingReviewMappings,
        }))),
      ],
      definitions: Object.values(METRIC_DEFINITIONS).map((d) => `${d.label}: ${d.formula}.`),
      exclusions: [...Object.values(METRIC_DEFINITIONS).map((d) => `${d.label}: ${d.excludes}`), 'This is readiness tracking, not a certification, attestation or audit opinion.'],
      sources: blocks.map((b) => ({ type: 'framework', id: b.framework.id, label: `${b.framework.name} ${b.framework.version}` })),
    };
  }

  private async controlStatus({ organizationId, timezone }: BuildContext): Promise<ReportModel> {
    const snapshots = await this.compliance.snapshots(organizationId);
    const controls = await this.prisma.control.findMany({ where: { organizationId, active: true }, orderBy: { controlCode: 'asc' }, include: { implementations: { where: { organizationId } } } });
    const lastTests = await this.prisma.controlTest.findMany({ where: { organizationId }, orderBy: { startedAt: 'desc' }, distinct: ['controlId'], select: { controlId: true, startedAt: true } });
    const testedAt = new Map(lastTests.map((t) => [t.controlId, t.startedAt]));
    const bySnap = new Map(snapshots.map((s) => [s.id, s]));
    const owners = await this.names(organizationId, controls.map((c) => c.implementations[0]?.ownerId));
    const rows = controls.map((c) => {
      const s = bySnap.get(c.id);
      const impl = c.implementations[0];
      const open = s ? Object.values(s.openFindings).reduce((a, b) => a + (b ?? 0), 0) : 0;
      return { code: c.controlCode, title: c.title, owner: this.name(owners, impl?.ownerId), status: s?.status ?? 'not_assessed', result: s?.latestResult ?? 'not tested', tested: this.fmt(testedAt.get(c.id), timezone), evidence: s?.evidence ?? 'missing', findings: open, review: this.fmt(impl?.nextReviewAt, timezone) };
    });
    const count = (k: 'result' | 'status', v: string) => rows.filter((r) => r[k] === v).length;
    return {
      scope: 'All active controls of the organization at generation time.',
      metrics: [
        { label: 'Active controls', value: rows.length, definition: 'Controls not retired from the register.' },
        { label: 'Implemented', value: count('status', 'implemented'), definition: 'Implementation status "implemented".' },
        { label: 'Latest test failed', value: count('result', 'fail'), definition: 'Most recent automated or manual test result is fail.' },
        { label: 'Latest test unknown', value: count('result', 'unknown'), definition: 'Missing or unreviewed evidence; not counted as passing or failing.' },
      ],
      sections: [section('Controls', [
        { key: 'code', label: 'Code', width: 1 }, { key: 'title', label: 'Title', width: 3 }, { key: 'owner', label: 'Owner', width: 1.5 }, { key: 'status', label: 'Implementation', width: 1.5 },
        { key: 'result', label: 'Latest test', width: 1 }, { key: 'tested', label: 'Tested', width: 1.1 }, { key: 'evidence', label: 'Evidence', width: 1 }, { key: 'findings', label: 'Open findings', width: 0.8 }, { key: 'review', label: 'Next review', width: 1.1 },
      ], rows)],
      definitions: ['Implementation status, latest test outcome and evidence currency are tracked separately (a control can be implemented yet fail its latest test).', 'Evidence currency: current, expiring (within 30 days), expired or missing, ignoring rejected and archived evidence.'],
      exclusions: ['Retired (inactive) controls.'],
      sources: controls.map((c) => ({ type: 'control', id: c.id, label: c.controlCode })),
    };
  }

  private async evidenceGaps({ organizationId, now, timezone }: BuildContext): Promise<ReportModel> {
    const soon = new Date(now.getTime() + 30 * DAY);
    const items = await this.prisma.evidence.findMany({ where: { organizationId, archivedAt: null, expiresAt: { not: null, lte: soon } }, orderBy: { expiresAt: 'asc' } });
    const owners = await this.names(organizationId, items.map((e) => e.ownerId));
    const snapshots = await this.compliance.snapshots(organizationId);
    const gaps = snapshots.filter((s) => s.status !== 'not_applicable' && (s.evidence === 'missing' || s.evidence === 'expired'));
    const controls = await this.prisma.control.findMany({ where: { organizationId, id: { in: gaps.map((g) => g.id) } }, select: { id: true, controlCode: true, title: true } });
    const ev = new Map(gaps.map((g) => [g.id, g.evidence]));
    return {
      scope: 'Non-archived evidence expiring within 30 days or already expired, and applicable controls without current evidence.',
      metrics: [
        { label: 'Expired evidence', value: items.filter((e) => e.expiresAt! <= now).length, definition: 'Evidence whose expiry date has passed.' },
        { label: 'Expiring within 30 days', value: items.filter((e) => e.expiresAt! > now).length, definition: 'Evidence expiring in the next 30 days.' },
        { label: 'Controls missing current evidence', value: controls.length, definition: 'Applicable controls whose linked evidence is missing or expired.' },
      ],
      sections: [
        section('Expired and expiring evidence', [{ key: 'title', label: 'Evidence', width: 3 }, { key: 'classification', label: 'Classification' }, { key: 'owner', label: 'Owner', width: 1.5 }, { key: 'expires', label: 'Expires' }, { key: 'state', label: 'State' }, { key: 'review', label: 'Review status' }],
          items.map((e) => ({ title: e.title, classification: e.classification, owner: this.name(owners, e.ownerId), expires: this.fmt(e.expiresAt, timezone), state: e.expiresAt! <= now ? 'expired' : 'expiring', review: e.reviewStatus }))),
        section('Controls without current evidence', [{ key: 'code', label: 'Code' }, { key: 'title', label: 'Control', width: 3 }, { key: 'evidence', label: 'Evidence state' }],
          controls.map((c) => ({ code: c.controlCode, title: c.title, evidence: ev.get(c.id) ?? null }))),
      ],
      definitions: ['Expiring means an expiry date within 30 days of generation.'],
      exclusions: ['Archived evidence.', 'Controls marked not applicable.', 'Evidence file contents are never included in reports.'],
      sources: [...items.map((e) => ({ type: 'evidence', id: e.id, label: e.title })), ...controls.map((c) => ({ type: 'control', id: c.id, label: c.controlCode }))],
    };
  }

  private async findingsAging({ organizationId, now, timezone }: BuildContext): Promise<ReportModel> {
    const findings = await this.prisma.finding.findMany({ where: { organizationId, status: { notIn: ['closed', 'accepted'] } }, orderBy: { firstDetectedAt: 'asc' } });
    const tasks = await this.prisma.remediationTask.findMany({ where: { organizationId, status: { in: ['open', 'in_progress', 'blocked'] } }, orderBy: { dueDate: 'asc' } });
    const owners = await this.names(organizationId, [...findings.map((f) => f.assignedTo), ...tasks.map((t) => t.ownerId)]);
    const keys = new Map(findings.map((f) => [f.id, f.findingKey]));
    const age = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);
    const buckets = [['0–30 days', 0, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['Over 90 days', 91, Infinity]] as const;
    return {
      scope: 'Findings not closed or accepted, and open, in-progress or blocked remediation tasks, at generation time.',
      metrics: [
        { label: 'Open findings', value: findings.length, definition: 'Findings not closed or accepted.' },
        { label: 'Overdue findings', value: findings.filter((f) => f.dueDate && f.dueDate < now).length, definition: 'Open findings past their due date.' },
        { label: 'Open remediation tasks', value: tasks.length, definition: 'Open, in-progress or blocked tasks.' },
        { label: 'Overdue remediation tasks', value: tasks.filter((t) => t.dueDate && t.dueDate < now).length, definition: 'Open tasks past their due date.' },
      ],
      sections: [
        section('Aging by severity', [{ key: 'bucket', label: 'Age since first detection' }, ...SEVERITIES.map((s) => ({ key: s, label: s }))],
          buckets.map(([label, lo, hi]) => ({ bucket: label, ...Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s && age(f.firstDetectedAt) >= lo && age(f.firstDetectedAt) <= hi).length])) }))),
        section('Open findings', [{ key: 'key', label: 'Key' }, { key: 'title', label: 'Title', width: 3 }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' }, { key: 'age', label: 'Age (days)' }, { key: 'due', label: 'Due' }, { key: 'owner', label: 'Owner', width: 1.5 }],
          findings.map((f) => ({ key: f.findingKey, title: f.title, severity: f.severity, status: f.status, source: f.sourceType, age: age(f.firstDetectedAt), due: this.fmt(f.dueDate, timezone) ?? `none (${f.noDueDateReason ?? 'no reason recorded'})`, owner: this.name(owners, f.assignedTo) }))),
        section('Open remediation tasks', [{ key: 'title', label: 'Task', width: 3 }, { key: 'finding', label: 'Finding' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }, { key: 'due', label: 'Due' }, { key: 'overdue', label: 'Days overdue' }, { key: 'owner', label: 'Owner', width: 1.5 }],
          tasks.map((t) => ({ title: t.title, finding: t.findingId ? (keys.get(t.findingId) ?? 'closed finding') : null, priority: t.priority, status: t.status, due: this.fmt(t.dueDate, timezone), overdue: t.dueDate && t.dueDate < now ? age(t.dueDate) : null, owner: this.name(owners, t.ownerId) }))),
      ],
      definitions: ['Age is measured from the first detection of the finding, in whole days.'],
      exclusions: ['Closed and accepted findings; completed and cancelled tasks.'],
      sources: findings.map((f) => ({ type: 'finding', id: f.id, label: f.findingKey })),
    };
  }

  private async riskRegister({ organizationId, timezone }: BuildContext): Promise<ReportModel> {
    const risks = await this.prisma.risk.findMany({ where: { organizationId, archivedAt: null }, orderBy: { riskKey: 'asc' } });
    const owners = await this.names(organizationId, risks.map((r) => r.riskOwnerId));
    return {
      scope: 'All non-archived risks at generation time.',
      metrics: [{ label: 'Risks', value: risks.length, definition: 'Non-archived risks, any status.' }],
      sections: [section('Risk register', [
        { key: 'key', label: 'Key' }, { key: 'title', label: 'Title', width: 3 }, { key: 'category', label: 'Category', width: 1.3 }, { key: 'inherent', label: 'Inherent (L×I)', width: 1.3 }, { key: 'residual', label: 'Residual (L×I)', width: 1.3 },
        { key: 'policy', label: 'Policy v' , width: 0.6 }, { key: 'treatment', label: 'Treatment' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner', width: 1.4 }, { key: 'review', label: 'Review date' }, { key: 'acceptanceExpires', label: 'Acceptance expires' },
      ], risks.map((r) => ({
        key: r.riskKey, title: r.title, category: r.category,
        inherent: `${r.inherentScore} ${r.inherentRating} (${r.likelihood}×${r.impact})`,
        residual: r.residualScore ? `${r.residualScore} ${r.residualRating} (${r.residualLikelihood}×${r.residualImpact})` : 'not assessed',
        policy: r.scoringPolicyVersion, treatment: r.treatment, status: r.status, owner: this.name(owners, r.riskOwnerId), review: this.fmt(r.reviewDate, timezone), acceptanceExpires: this.fmt(r.acceptanceExpiresAt, timezone),
      })))],
      definitions: ['Inherent and residual scores = likelihood × impact under the scoring policy version shown.'],
      exclusions: ['Archived risks.'],
      sources: risks.map((r) => ({ type: 'risk', id: r.id, label: r.riskKey })),
    };
  }

  private async vendorAssessment({ organizationId, filters, timezone }: BuildContext): Promise<ReportModel> {
    const a = await this.prisma.vendorAssessment.findFirst({ where: { id: filters.assessmentId, organizationId }, include: { vendor: true, templateRef: { select: { name: true, version: true } } } });
    if (!a) throw notFound('Vendor assessment');
    const responses = await this.prisma.questionResponse.findMany({ where: { organizationId, assessmentId: a.id }, include: { questionRef: { select: { questionKey: true, questionText: true, category: true, sortOrder: true } } } });
    responses.sort((x, y) => x.questionRef.sortOrder - y.questionRef.sortOrder);
    const findings = await this.prisma.finding.findMany({ where: { organizationId, sourceType: 'vendor_assessment', sourceId: a.id }, orderBy: { findingKey: 'asc' } });
    const breakdown = (a.scoreBreakdown ?? null) as { inherentFactors?: Array<{ factor: string; value: string | number; weight: number; contribution: number }>; categories?: Array<{ category: string; effectiveness: number; weight: number }>; questions?: Array<{ questionKey: string; outcome: string }>; assumptions?: string[] } | null;
    const outcome = new Map((breakdown?.questions ?? []).map((q) => [q.questionKey, q.outcome]));
    const answer = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean));
    const decided = a.status === 'approved' || a.status === 'closed';
    return {
      scope: `Vendor ${a.vendor.name}, assessment version ${a.assessmentVersion} using template "${a.templateRef.name}" v${a.templateRef.version}.`,
      draftOnlyReason: decided ? undefined : `The assessment is ${a.status.replace(/_/g, ' ')}; a final report requires a recorded decision.`,
      metrics: [
        // Values recorded on this assessment (not the vendor's current profile, which may have changed since).
        { label: 'Inherent risk score', value: a.inherentRisk ?? a.vendor.inherentRiskScore, definition: 'Weighted inherent factors (0–100).' },
        { label: 'Control effectiveness', value: a.score === null ? 'not scored' : `${a.score}%`, definition: 'Weighted credit from reviewed answers; unanswered questions earn none.' },
        { label: 'Residual risk score', value: a.residualRisk ?? 'not scored', definition: 'Inherent × (1 − max reduction × control effectiveness).' },
        { label: 'Risk tier', value: a.riskTier ?? 'not scored', definition: 'Tier thresholds from the vendor scoring policy.' },
        { label: 'Scoring policy version', value: a.scoringPolicyVersion, definition: 'Versioned, audited scoring configuration used.' },
        { label: 'Decision', value: a.decision ? `${a.decision}${a.decisionRationale ? ` — ${a.decisionRationale}` : ''}` : 'pending', definition: 'Recorded by an authorized approver.' },
      ],
      sections: [
        section('Vendor profile', [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Value', width: 3 }], [
          { field: 'Service', value: a.vendor.serviceDescription }, { field: 'Criticality', value: a.vendor.criticality }, { field: 'Data classification', value: a.vendor.dataClassification },
          { field: 'Personal data access', value: a.vendor.personalDataAccess ? 'yes' : 'no' }, { field: 'Access level', value: a.vendor.accessLevel }, { field: 'Regions', value: a.vendor.regions.join(', ') || null },
          { field: 'Last assessed', value: this.fmt(a.vendor.lastAssessedAt, timezone) }, { field: 'Next assessment', value: this.fmt(a.vendor.nextAssessmentAt, timezone) },
        ]),
        section('Inherent risk factors', [{ key: 'factor', label: 'Factor' }, { key: 'value', label: 'Value' }, { key: 'weight', label: 'Weight' }, { key: 'contribution', label: 'Contribution' }],
          (breakdown?.inherentFactors ?? []).map((f) => ({ factor: f.factor, value: String(f.value), weight: f.weight, contribution: f.contribution }))),
        section('Control effectiveness by category', [{ key: 'category', label: 'Category' }, { key: 'effectiveness', label: 'Effectiveness' }, { key: 'weight', label: 'Weight' }],
          (breakdown?.categories ?? []).map((c) => ({ category: c.category, effectiveness: `${Math.round(c.effectiveness * 100)}%`, weight: c.weight }))),
        section('Responses', [{ key: 'key', label: 'Question', width: 1 }, { key: 'question', label: 'Text', width: 3 }, { key: 'answer', label: 'Answer', width: 2 }, { key: 'evidence', label: 'Evidence', width: 0.8 }, { key: 'review', label: 'Review', width: 1 }, { key: 'outcome', label: 'Scoring outcome', width: 1.3 }],
          responses.map((r) => ({ key: r.questionRef.questionKey, question: r.questionRef.questionText, answer: r.notApplicable ? `N/A — ${r.naRationale ?? 'no rationale'}` : answer(r.answer), evidence: r.evidenceId ? 'attached' : null, review: r.reviewerStatus, outcome: outcome.get(r.questionRef.questionKey) ?? null }))),
        section('Findings from this assessment', [{ key: 'key', label: 'Key' }, { key: 'title', label: 'Title', width: 3 }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' }, { key: 'due', label: 'Due' }],
          findings.map((f) => ({ key: f.findingKey, title: f.title, severity: f.severity, status: f.status, due: this.fmt(f.dueDate, timezone) }))),
      ],
      definitions: breakdown?.assumptions ?? [],
      exclusions: ['Internal reviewer notes and internal assessment notes.', 'Vendor contact details.', 'Evidence file contents.'],
      sources: [{ type: 'vendor_assessment', id: a.id, label: `${a.vendor.name} v${a.assessmentVersion}` }, ...findings.map((f) => ({ type: 'finding', id: f.id, label: f.findingKey }))],
    };
  }

  private async vendorPortfolio({ organizationId, now, timezone }: BuildContext): Promise<ReportModel> {
    const vendors = await this.prisma.vendor.findMany({ where: { organizationId, status: { not: 'archived' } }, orderBy: [{ residualRiskScore: 'desc' }, { name: 'asc' }] });
    const owners = await this.names(organizationId, vendors.map((v) => v.businessOwnerId));
    const links = await this.prisma.riskLink.groupBy({ by: ['entityId'], where: { organizationId, entityType: 'vendor', entityId: { in: vendors.map((v) => v.id) }, risk: { archivedAt: null, status: { not: 'closed' } } }, _count: true });
    const risksBy = new Map(links.map((l) => [l.entityId, l._count]));
    return {
      scope: 'All vendors not archived, at generation time.',
      metrics: [
        { label: 'Vendors', value: vendors.length, definition: 'Vendors not archived.' },
        ...SEVERITIES.map((s) => ({ label: `${s[0].toUpperCase()}${s.slice(1)} tier`, value: vendors.filter((v) => v.riskTier === s).length, definition: 'Residual risk tier from the latest decided assessment.' })),
        { label: 'Reassessment overdue', value: vendors.filter((v) => v.nextAssessmentAt && v.nextAssessmentAt < now).length, definition: 'Next assessment date has passed.' },
      ],
      sections: [section('Vendors', [
        { key: 'name', label: 'Vendor', width: 2 }, { key: 'criticality', label: 'Criticality' }, { key: 'status', label: 'Status', width: 1.3 }, { key: 'inherent', label: 'Inherent' }, { key: 'residual', label: 'Residual' },
        { key: 'tier', label: 'Tier' }, { key: 'risks', label: 'Open linked risks' }, { key: 'last', label: 'Last assessed' }, { key: 'next', label: 'Next due' }, { key: 'owner', label: 'Business owner', width: 1.4 },
      ], vendors.map((v) => ({ name: v.name, criticality: v.criticality, status: v.status, inherent: v.inherentRiskScore, residual: v.residualRiskScore ?? 'not assessed', tier: v.riskTier ?? 'not assessed', risks: risksBy.get(v.id) ?? 0, last: this.fmt(v.lastAssessedAt, timezone), next: this.fmt(v.nextAssessmentAt, timezone), owner: this.name(owners, v.businessOwnerId) })))],
      definitions: ['Scores are 0–100; higher means more risk. Residual = inherent × (1 − max reduction × control effectiveness).'],
      exclusions: ['Archived vendors.', 'Vendor contacts and internal notes.'],
      sources: vendors.map((v) => ({ type: 'vendor', id: v.id, label: v.name })),
    };
  }

  private async aiInventory({ organizationId, filters, now, timezone }: BuildContext): Promise<ReportModel> {
    const systems = await this.prisma.aiSystem.findMany({ where: { organizationId, ...(filters.aiSystemId ? { id: filters.aiSystemId } : {}) }, orderBy: { name: 'asc' } });
    if (filters.aiSystemId && !systems.length) throw notFound('AI system');
    const latest = await this.prisma.aiAssessment.findMany({ where: { organizationId, aiSystemId: { in: systems.map((s) => s.id) } }, orderBy: { assessmentVersion: 'desc' }, distinct: ['aiSystemId'] });
    const latestBy = new Map(latest.map((a) => [a.aiSystemId, a]));
    const owners = await this.names(organizationId, systems.flatMap((s) => [s.businessOwnerId, s.riskOwnerId]));
    return {
      scope: filters.aiSystemId ? `AI system ${systems[0].name}.` : 'All AI systems in the inventory.',
      metrics: [
        { label: 'AI systems', value: systems.length, definition: 'Systems in the AI inventory, any lifecycle stage.' },
        { label: 'In production', value: systems.filter((s) => s.lifecycleStatus === 'production').length, definition: 'Lifecycle stage "production".' },
        { label: 'High or unacceptable tier', value: systems.filter((s) => s.riskTier === 'high' || s.riskTier === 'unacceptable').length, definition: 'Organization-assigned AI risk tier; not a legal classification.' },
        { label: 'Review overdue', value: systems.filter((s) => s.nextReviewAt && s.nextReviewAt < now && s.lifecycleStatus !== 'retired').length, definition: 'Next review date has passed.' },
      ],
      sections: [section('AI systems', [
        { key: 'name', label: 'System', width: 2 }, { key: 'lifecycle', label: 'Lifecycle', width: 1.3 }, { key: 'tier', label: 'Risk tier' }, { key: 'model', label: 'Model / version', width: 1.5 },
        { key: 'people', label: 'Decisions about people' }, { key: 'personal', label: 'Personal data' }, { key: 'assessment', label: 'Latest assessment', width: 1.5 }, { key: 'review', label: 'Next review' }, { key: 'owner', label: 'Business / risk owner', width: 1.8 },
      ], systems.map((s) => {
        const a = latestBy.get(s.id);
        return {
          name: s.name, lifecycle: s.lifecycleStatus, tier: s.riskTier, model: [s.modelName, s.modelVersion].filter(Boolean).join(' ') || null,
          people: s.influencesDecisionsAboutPeople ? 'yes' : 'no', personal: s.personalDataProcessed ? 'yes' : 'no',
          assessment: a ? `v${a.assessmentVersion} ${a.status}${a.approvedAt ? ` ${this.fmt(a.approvedAt, timezone)}` : ''}` : 'none',
          review: this.fmt(s.nextReviewAt, timezone), owner: `${this.name(owners, s.businessOwnerId)} / ${this.name(owners, s.riskOwnerId)}`,
        };
      }))],
      definitions: ['AI risk tiers are internal classifications. EU AI Act applicability records are preliminary until reviewed by a qualified professional.'],
      exclusions: ['Assessment item responses (see each assessment).'],
      sources: systems.map((s) => ({ type: 'ai_system', id: s.id, label: s.name })),
    };
  }

  private async aiIncidentsEvaluations(def: ReportTypeDef, { organizationId, filters, now, timezone }: BuildContext): Promise<ReportModel> {
    const { from, to } = this.period(def, filters, now)!;
    const sys = filters.aiSystemId ? { aiSystemId: filters.aiSystemId } : {};
    const [incidents, evaluations] = await Promise.all([
      this.prisma.aiIncident.findMany({ where: { organizationId, ...sys, detectedAt: { gte: from, lte: to } }, orderBy: { detectedAt: 'desc' }, include: { aiSystem: { select: { name: true } } } }),
      this.prisma.aiEvaluation.findMany({ where: { organizationId, ...sys, executedAt: { gte: from, lte: to } }, orderBy: { executedAt: 'desc' }, include: { aiSystem: { select: { name: true } } } }),
    ]);
    return {
      scope: `AI incidents detected and evaluations executed between ${this.fmt(from, timezone)} and ${this.fmt(to, timezone)}${filters.aiSystemId ? ' for one AI system' : ''}.`,
      metrics: [
        { label: 'Incidents', value: incidents.length, definition: 'Incidents detected in the period.' },
        { label: 'High/critical incidents', value: incidents.filter((i) => i.severity === 'high' || i.severity === 'critical').length, definition: 'Severity high or critical.' },
        { label: 'Unresolved incidents', value: incidents.filter((i) => !['resolved', 'closed'].includes(i.status)).length, definition: 'Status not resolved or closed.' },
        { label: 'Evaluations', value: evaluations.length, definition: 'Evaluations executed in the period.' },
        { label: 'Failed evaluations', value: evaluations.filter((e) => e.result === 'fail').length, definition: 'Evaluation result "fail".' },
      ],
      sections: [
        section('Incidents', [{ key: 'system', label: 'AI system', width: 1.5 }, { key: 'title', label: 'Incident', width: 2.5 }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' }, { key: 'detected', label: 'Detected' }, { key: 'rootCause', label: 'Root cause', width: 2 }, { key: 'lessons', label: 'Lessons learned', width: 2 }],
          incidents.map((i) => ({ system: i.aiSystem.name, title: i.title, severity: i.severity, status: i.status, detected: this.fmt(i.detectedAt, timezone), rootCause: i.rootCause, lessons: i.lessonsLearned }))),
        section('Evaluations', [{ key: 'system', label: 'AI system', width: 1.5 }, { key: 'type', label: 'Type', width: 1.3 }, { key: 'version', label: 'Version' }, { key: 'result', label: 'Result' }, { key: 'executed', label: 'Executed' }, { key: 'approval', label: 'Approval' }, { key: 'limitations', label: 'Limitations', width: 2.5 }],
          evaluations.map((e) => ({ system: e.aiSystem.name, type: e.evaluationType, version: e.version, result: e.result, executed: this.fmt(e.executedAt, timezone), approval: e.approvalStatus, limitations: e.limitations }))),
      ],
      definitions: ['Evaluation results are only as meaningful as their documented methodology and limitations, which are listed for each evaluation.'],
      exclusions: ['Records outside the reporting period.'],
      sources: [...incidents.map((i) => ({ type: 'ai_incident', id: i.id, label: i.title })), ...evaluations.map((e) => ({ type: 'ai_evaluation', id: e.id, label: `${e.aiSystem.name} ${e.evaluationType}` }))],
    };
  }

  private async workflowHealth(def: ReportTypeDef, { organizationId, filters, now, timezone }: BuildContext): Promise<ReportModel> {
    const { from, to } = this.period(def, filters, now)!;
    const [defs, runs, integrations] = await Promise.all([
      this.prisma.workflowDefinition.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.prisma.workflowRun.findMany({ where: { organizationId, createdAt: { gte: from, lte: to } }, select: { id: true, workflowDefinitionId: true, status: true, createdAt: true, errorCode: true } }),
      this.prisma.integration.findMany({ where: { organizationId }, orderBy: { displayName: 'asc' } }),
    ]);
    const failed = runs.filter((r) => r.status === 'failed');
    return {
      scope: `Workflow runs queued between ${this.fmt(from, timezone)} and ${this.fmt(to, timezone)}; integration state at generation time.`,
      metrics: [
        { label: 'Workflow runs', value: runs.length, definition: 'Runs queued in the period (scheduled, event, manual and retries).' },
        { label: 'Failed runs', value: failed.length, definition: 'Runs that exhausted their attempts or failed permanently.' },
        { label: 'Integrations failing', value: integrations.filter((i) => i.status === 'failing').length, definition: 'Integrations whose latest sync failed.' },
      ],
      sections: [
        section('Workflows', [{ key: 'name', label: 'Workflow', width: 2.5 }, { key: 'enabled', label: 'Enabled' }, { key: 'total', label: 'Runs' }, { key: 'ok', label: 'Succeeded' }, { key: 'partial', label: 'Partial' }, { key: 'failed', label: 'Failed' }, { key: 'lastError', label: 'Last error', width: 1.5 }],
          defs.map((d) => {
            const mine = runs.filter((r) => r.workflowDefinitionId === d.id);
            const lastFail = mine.filter((r) => r.status === 'failed').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
            return { name: d.name, enabled: d.enabled ? 'yes' : 'no', total: mine.length, ok: mine.filter((r) => r.status === 'succeeded').length, partial: mine.filter((r) => r.status === 'partially_succeeded').length, failed: mine.filter((r) => r.status === 'failed').length, lastError: lastFail ? `${lastFail.errorCode} (${this.fmt(lastFail.createdAt, timezone)})` : null };
          })),
        section('Integrations', [{ key: 'name', label: 'Integration', width: 2 }, { key: 'provider', label: 'Provider' }, { key: 'demo', label: 'Demo data' }, { key: 'status', label: 'Status' }, { key: 'success', label: 'Last success' }, { key: 'failure', label: 'Last failure' }, { key: 'error', label: 'Last error' }],
          integrations.map((i) => ({ name: i.displayName, provider: i.provider, demo: i.isDemo ? 'yes' : 'no', status: i.status, success: this.fmt(i.lastSuccessAt, timezone), failure: this.fmt(i.lastFailureAt, timezone), error: i.lastErrorCode }))),
      ],
      definitions: ['A failed integration is reported as failing; checks depending on it report unknown rather than using stale data.'],
      exclusions: ['Runs queued outside the period.'],
      sources: failed.map((r) => ({ type: 'workflow_run', id: r.id, label: r.errorCode ?? 'failed' })),
    };
  }

  private async auditActivity(def: ReportTypeDef, { organizationId, filters, now, timezone }: BuildContext): Promise<ReportModel> {
    const { from, to } = this.period(def, filters, now)!;
    const where = { organizationId, timestamp: { gte: from, lte: to } };
    const [byAction, events, total] = await Promise.all([
      this.prisma.auditEvent.groupBy({ by: ['action', 'outcome'], where, _count: true, orderBy: { action: 'asc' } }),
      this.prisma.auditEvent.findMany({ where, orderBy: { timestamp: 'desc' }, take: MAX_ROWS + 1 }),
      this.prisma.auditEvent.count({ where }),
    ]);
    const actors = await this.names(organizationId, events.map((e) => e.actorUserId));
    const tsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short', timeStyle: 'medium', hour12: false });
    return {
      scope: `Audit events recorded between ${this.fmt(from, timezone)} and ${this.fmt(to, timezone)}.`,
      metrics: [
        { label: 'Audit events', value: total, definition: 'All organization-scoped audit events in the period.' },
        { label: 'Denied or failed', value: byAction.filter((a) => a.outcome !== 'success').reduce((s, a) => s + a._count, 0), definition: 'Events with outcome denied or failure.' },
      ],
      sections: [
        section('Events by action', [{ key: 'action', label: 'Action', width: 3 }, { key: 'outcome', label: 'Outcome' }, { key: 'count', label: 'Count' }], byAction.map((a) => ({ action: a.action, outcome: a.outcome, count: a._count }))),
        section('Events', [{ key: 'time', label: 'Time', width: 1.6 }, { key: 'actor', label: 'Actor', width: 1.5 }, { key: 'action', label: 'Action', width: 2 }, { key: 'entity', label: 'Entity', width: 1.5 }, { key: 'outcome', label: 'Outcome' }, { key: 'requestId', label: 'Request ID', width: 1.5 }],
          events.map((e) => ({ time: tsFmt.format(e.timestamp), actor: e.actorUserId ? this.name(actors, e.actorUserId) : e.actorType, action: e.action, entity: e.entityType, outcome: e.outcome, requestId: e.requestId }))),
      ],
      definitions: ['Audit events record summaries and identifiers, never passwords, tokens or evidence contents.'],
      exclusions: ['Platform-level events without an organization.', 'Source IP and user agent are omitted from reports.'],
      sources: [],
    };
  }
}
