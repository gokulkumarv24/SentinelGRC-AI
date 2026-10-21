import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors.js';
import { requireOrgId } from '../../common/request-context.js';
import type { ImplementationStatus, Severity, TestResult } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { evidenceState } from '../controls/controls.service.js';
import { FrameworksService } from '../frameworks/frameworks.service.js';

/** Metric definitions shown next to every number (spec §8.6: what was measured and what was excluded). */
export const METRIC_DEFINITIONS = {
  implementationCoverage: {
    label: 'Implementation coverage',
    formula: 'implemented ÷ applicable controls',
    excludes: 'Controls marked not applicable or retired. Partially implemented controls are reported separately and are not counted as implemented.',
  },
  testPassRate: {
    label: 'Latest test pass rate',
    formula: 'controls whose latest test passed ÷ controls whose latest test was pass, fail or error',
    excludes: 'Unknown results (missing or unreviewed evidence), not-applicable results and never-tested controls. They are shown separately, never counted as passing.',
  },
  evidenceCurrency: {
    label: 'Evidence currency rate',
    formula: 'applicable controls with current (or expiring) non-rejected evidence ÷ applicable controls',
    excludes: 'Not-applicable and retired controls. Rejected and archived evidence never counts as current.',
  },
  requirementCoverage: {
    label: 'Requirement coverage',
    formula: 'leaf requirements with at least one mapped, non-rejected control ÷ leaf requirements',
    excludes: 'Group headings (functions, categories, themes). Mappings still pending review are included but flagged.',
  },
} as const;

export interface ControlSnapshot {
  id: string;
  status: ImplementationStatus;
  latestResult: TestResult | null;
  evidence: 'missing' | 'expired' | 'expiring' | 'current';
  openFindings: Partial<Record<Severity, number>>;
}

export interface ComplianceMetrics {
  controls: number;
  applicable: number;
  notApplicable: number;
  implementation: Record<string, number>;
  implementationCoverage: number | null;
  tests: { pass: number; fail: number; error: number; unknown: number; notApplicable: number; notTested: number };
  testPassRate: number | null;
  evidence: { current: number; expiring: number; expired: number; missing: number };
  evidenceCurrency: number | null;
  openFindings: Record<Severity, number>;
}

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/** Pure calculation over control snapshots, unit-tested independently of the database. */
export function calculateMetrics(controls: ControlSnapshot[]): ComplianceMetrics {
  const implementation: Record<string, number> = {};
  const tests = { pass: 0, fail: 0, error: 0, unknown: 0, notApplicable: 0, notTested: 0 };
  const evidence = { current: 0, expiring: 0, expired: 0, missing: 0 };
  const openFindings: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let applicable = 0;
  let implemented = 0;
  for (const c of controls) {
    implementation[c.status] = (implementation[c.status] ?? 0) + 1;
    for (const [sev, n] of Object.entries(c.openFindings)) openFindings[sev as Severity] += n ?? 0;
    const isApplicable = c.status !== 'not_applicable' && c.status !== 'retired';
    if (!isApplicable) continue;
    applicable++;
    if (c.status === 'implemented') implemented++;
    evidence[c.evidence]++;
    if (c.latestResult === null) tests.notTested++;
    else if (c.latestResult === 'not_applicable') tests.notApplicable++;
    else tests[c.latestResult]++;
  }
  return {
    controls: controls.length,
    applicable,
    notApplicable: controls.length - applicable,
    implementation,
    implementationCoverage: ratio(implemented, applicable),
    tests,
    testPassRate: ratio(tests.pass, tests.pass + tests.fail + tests.error),
    evidence,
    evidenceCurrency: ratio(evidence.current + evidence.expiring, applicable),
    openFindings,
  };
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly frameworks: FrameworksService,
  ) {}

  /** Snapshot of every active control's state, as of now. */
  async snapshots(organizationId: string, controlIds?: string[]): Promise<ControlSnapshot[]> {
    const now = new Date();
    const controls = await this.prisma.control.findMany({
      where: { organizationId, active: true, ...(controlIds ? { id: { in: controlIds } } : {}) },
      select: { id: true, implementations: { where: { organizationId }, select: { status: true } } },
    });
    const ids = controls.map((c) => c.id);
    const [tests, links, findings] = await Promise.all([
      this.prisma.controlTest.findMany({ where: { organizationId, controlId: { in: ids } }, orderBy: [{ controlId: 'asc' }, { startedAt: 'desc' }], distinct: ['controlId'], select: { controlId: true, result: true } }),
      this.prisma.evidenceLink.findMany({ where: { organizationId, entityType: 'control', entityId: { in: ids }, evidence: { archivedAt: null } }, select: { entityId: true, evidence: { select: { expiresAt: true, reviewStatus: true } } } }),
      this.prisma.finding.groupBy({ by: ['controlId', 'severity'], where: { organizationId, controlId: { in: ids }, status: { notIn: ['closed', 'accepted'] } }, _count: true }),
    ]);
    const testBy = new Map(tests.map((t) => [t.controlId, t.result]));
    const rank = { missing: 0, expired: 1, expiring: 2, current: 3 } as const;
    const evidenceBy = new Map<string, ControlSnapshot['evidence']>();
    for (const l of links) {
      const s = evidenceState(l.evidence.expiresAt, l.evidence.reviewStatus, now);
      const prev = evidenceBy.get(l.entityId);
      if (!prev || rank[s] > rank[prev]) evidenceBy.set(l.entityId, s);
    }
    const findingsBy = new Map<string, Partial<Record<Severity, number>>>();
    for (const f of findings) {
      if (!f.controlId) continue;
      findingsBy.set(f.controlId, { ...findingsBy.get(f.controlId), [f.severity]: f._count });
    }
    return controls.map((c) => ({
      id: c.id,
      status: c.implementations[0]?.status ?? 'not_assessed',
      latestResult: testBy.get(c.id) ?? null,
      evidence: evidenceBy.get(c.id) ?? 'missing',
      openFindings: findingsBy.get(c.id) ?? {},
    }));
  }

  /** Organization-wide summary plus one block per in-scope framework version. */
  async summary() {
    const organizationId = requireOrgId();
    const measuredAt = new Date();
    const [all, scope] = await Promise.all([this.snapshots(organizationId), this.frameworks.scope(organizationId)]);
    const frameworks = await this.prisma.framework.findMany({ where: { id: { in: scope }, OR: [{ organizationId: null }, { organizationId }] }, orderBy: { name: 'asc' } });
    const perFramework = [];
    for (const fw of frameworks) perFramework.push(await this.frameworkBlock(organizationId, fw.id, all));
    return { measuredAt, definitions: METRIC_DEFINITIONS, overall: calculateMetrics(all), frameworks: perFramework };
  }

  async framework(frameworkId: string) {
    const organizationId = requireOrgId();
    const all = await this.snapshots(organizationId);
    return { measuredAt: new Date(), definitions: METRIC_DEFINITIONS, ...(await this.frameworkBlock(organizationId, frameworkId, all, true)) };
  }

  private async frameworkBlock(organizationId: string, frameworkId: string, all: ControlSnapshot[], detail = false) {
    const framework = await this.prisma.framework.findFirst({
      where: { id: frameworkId, OR: [{ organizationId: null }, { organizationId }] },
      include: { requirements: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!framework) throw notFound('Framework');
    const parents = new Set(framework.requirements.map((r) => r.parentCode).filter(Boolean));
    const leaves = framework.requirements.filter((r) => !parents.has(r.requirementCode) && r.parentCode);
    const mappings = await this.prisma.controlMapping.findMany({
      where: { organizationId, sourceRequirementId: { in: framework.requirements.map((r) => r.id) }, controlId: { not: null }, reviewStatus: { not: 'rejected' } },
      select: { sourceRequirementId: true, controlId: true, reviewStatus: true },
    });
    const controlIds = new Set(mappings.map((m) => m.controlId!));
    const covered = new Set(mappings.map((m) => m.sourceRequirementId));
    const snapshots = all.filter((s) => controlIds.has(s.id));
    const metrics = calculateMetrics(snapshots);
    const bySnapshot = new Map(snapshots.map((s) => [s.id, s]));
    return {
      framework: { id: framework.id, key: framework.key, name: framework.name, version: framework.version, isIllustrative: framework.isIllustrative },
      metrics,
      requirementCoverage: ratio(leaves.filter((l) => covered.has(l.id)).length, leaves.length),
      requirements: { leaves: leaves.length, covered: leaves.filter((l) => covered.has(l.id)).length, pendingReviewMappings: mappings.filter((m) => m.reviewStatus !== 'approved').length },
      ...(detail
        ? {
            requirementStatus: leaves.map((r) => {
              const mapped = mappings.filter((m) => m.sourceRequirementId === r.id).map((m) => bySnapshot.get(m.controlId!)).filter(Boolean) as ControlSnapshot[];
              return { id: r.id, code: r.requirementCode, title: r.title, group: r.groupName, controls: mapped.length, metrics: mapped.length ? calculateMetrics(mapped) : null };
            }),
          }
        : {}),
    };
  }
}
