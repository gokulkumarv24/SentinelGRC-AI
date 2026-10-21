import { z } from 'zod';
import type { Severity, TestResult } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';

/**
 * Deterministic control-test rules (spec §8.5): `evaluate(context) -> TestResult`.
 * Rules only read data the organization has authorized (its own records and configured integrations).
 * Missing or stale data yields `unknown`, never `fail` (spec §6.2).
 */
export interface RuleContext {
  tx: Tx;
  organizationId: string;
  control: { id: string; controlCode: string; title: string; reviewFrequencyDays: number };
  parameters: Record<string, unknown>;
  now: Date;
}

export interface RuleOutcome {
  result: TestResult;
  summary: string;
  details: Record<string, unknown>;
  evidenceIds?: string[];
  /** Severity for the finding created on failure. */
  severity?: Severity;
  /** Short title for the finding created on failure. */
  findingTitle?: string;
}

export interface ControlRule {
  key: string;
  version: string;
  name: string;
  description: string;
  parameters: z.ZodObject;
  evaluate(ctx: RuleContext): Promise<RuleOutcome>;
}

const DAY = 86_400_000;

/** Evidence linked to the control is present, approved (optional) and not expired. */
const evidenceCurrency: ControlRule = {
  key: 'evidence_currency',
  version: '1.0.0',
  name: 'Evidence is current',
  description: 'Passes when at least one linked, non-rejected evidence item is within its validity period. Expired evidence fails; no evidence or evidence awaiting review is unknown.',
  parameters: z.object({ requireApproved: z.boolean().default(true), maxAgeDays: z.number().int().positive().optional() }),
  async evaluate({ tx, organizationId, control, parameters, now }) {
    const p = this.parameters.parse(parameters) as { requireApproved: boolean; maxAgeDays?: number };
    const links = await tx.evidenceLink.findMany({
      where: { organizationId, entityType: 'control', entityId: control.id, evidence: { archivedAt: null } },
      select: { evidence: { select: { id: true, title: true, expiresAt: true, reviewStatus: true, collectedAt: true, createdAt: true, sha256Checksum: true } } },
    });
    const evidence = links.map((l) => l.evidence).filter((e) => e.reviewStatus !== 'rejected');
    const snapshot = evidence.map((e) => ({ id: e.id, title: e.title, expiresAt: e.expiresAt, reviewStatus: e.reviewStatus, sha256: e.sha256Checksum }));
    if (evidence.length === 0) return { result: 'unknown', summary: 'No evidence is linked to this control. Evidence requested from the control owner.', details: { evidence: [] } };

    const tooOld = (e: (typeof evidence)[number]) => !!p.maxAgeDays && now.getTime() - (e.collectedAt ?? e.createdAt).getTime() > p.maxAgeDays * DAY;
    const valid = evidence.filter((e) => (!e.expiresAt || e.expiresAt > now) && !tooOld(e));
    const usable = p.requireApproved ? valid.filter((e) => e.reviewStatus === 'approved') : valid;
    if (usable.length) return { result: 'pass', summary: `${usable.length} current evidence item(s) support this control.`, details: { evidence: snapshot }, evidenceIds: usable.map((e) => e.id) };
    if (valid.length) return { result: 'unknown', summary: 'Evidence is current but has not been approved by a reviewer.', details: { evidence: snapshot } };
    const expired = evidence.filter((e) => e.expiresAt && e.expiresAt <= now);
    return {
      result: 'fail',
      summary: `All linked evidence has expired (${expired.map((e) => e.title).join(', ') || 'older than the allowed age'}).`,
      details: { evidence: snapshot },
      evidenceIds: evidence.map((e) => e.id),
      severity: 'medium',
      findingTitle: `Expired evidence for ${control.controlCode}`,
    };
  },
};

/** The control's periodic review is not overdue. */
const reviewCurrency: ControlRule = {
  key: 'control_review_current',
  version: '1.0.0',
  name: 'Control review is current',
  description: 'Fails when the scheduled control review date has passed; unknown when no review is scheduled.',
  parameters: z.object({ graceDays: z.number().int().min(0).default(0) }),
  async evaluate({ tx, organizationId, control, parameters, now }) {
    const { graceDays } = this.parameters.parse(parameters) as { graceDays: number };
    const impl = await tx.controlImplementation.findUnique({ where: { organizationId_controlId: { organizationId, controlId: control.id } } });
    if (!impl?.nextReviewAt) return { result: 'unknown', summary: 'No review is scheduled for this control.', details: {} };
    const due = new Date(impl.nextReviewAt.getTime() + graceDays * DAY);
    if (due > now) return { result: 'pass', summary: `Next review due ${impl.nextReviewAt.toISOString().slice(0, 10)}.`, details: { nextReviewAt: impl.nextReviewAt, lastReviewedAt: impl.lastReviewedAt } };
    return { result: 'fail', summary: `Control review overdue since ${impl.nextReviewAt.toISOString().slice(0, 10)}.`, details: { nextReviewAt: impl.nextReviewAt, lastReviewedAt: impl.lastReviewedAt }, severity: 'low', findingTitle: `Overdue review for ${control.controlCode}` };
  },
};

/** Privileged accounts from the identity integration have a recent access review. */
const privilegedAccessReview: ControlRule = {
  key: 'privileged_access_review',
  version: '1.0.0',
  name: 'Privileged accounts reviewed',
  description: 'Uses privileged-account records synced from an identity integration. Fails when any account lacks a review within the allowed window; unknown when no synced data exists or the last sync failed.',
  parameters: z.object({ maxReviewAgeDays: z.number().int().positive().default(90), integrationProvider: z.string().default('demo_identity') }),
  async evaluate({ tx, organizationId, parameters, now }) {
    const p = this.parameters.parse(parameters) as { maxReviewAgeDays: number; integrationProvider: string };
    const integration = await tx.integration.findFirst({ where: { organizationId, provider: p.integrationProvider } });
    if (!integration || integration.status === 'not_configured' || integration.status === 'disabled') return { result: 'unknown', summary: 'The identity integration is not configured, so privileged accounts cannot be checked.', details: {} };
    if (!integration.lastSuccessAt) return { result: 'unknown', summary: 'The identity integration has never synced successfully.', details: { lastErrorCode: integration.lastErrorCode } };
    if (integration.lastFailureAt && integration.lastFailureAt > integration.lastSuccessAt) {
      return { result: 'unknown', summary: 'The latest identity sync failed; results would be stale.', details: { lastFailureAt: integration.lastFailureAt, lastErrorCode: integration.lastErrorCode } };
    }
    const records = await tx.integrationRecord.findMany({ where: { organizationId, integrationId: integration.id, recordType: 'privileged_account' } });
    if (!records.length) return { result: 'unknown', summary: 'No privileged accounts were reported by the identity integration.', details: { syncedAt: integration.lastSuccessAt } };
    const stale = records.filter((r) => {
      const reviewed = (r.data as { lastAccessReviewAt?: string | null }).lastAccessReviewAt;
      return !reviewed || now.getTime() - new Date(reviewed).getTime() > p.maxReviewAgeDays * DAY;
    });
    const details = { syncedAt: integration.lastSuccessAt, accounts: records.length, stale: stale.map((r) => ({ account: r.externalId, lastAccessReviewAt: (r.data as { lastAccessReviewAt?: string }).lastAccessReviewAt ?? null })) };
    if (!stale.length) return { result: 'pass', summary: `All ${records.length} privileged accounts were reviewed within ${p.maxReviewAgeDays} days.`, details };
    return { result: 'fail', summary: `${stale.length} of ${records.length} privileged accounts lack an access review within ${p.maxReviewAgeDays} days.`, details, severity: 'high', findingTitle: 'Privileged accounts without a recent access review' };
  },
};

/** MFA is enforced for every account reported by the identity integration. */
const mfaEnforced: ControlRule = {
  key: 'mfa_enforced',
  version: '1.0.0',
  name: 'MFA enforced for privileged accounts',
  description: 'Fails when any privileged account from the identity integration does not have MFA enabled; unknown without synced data.',
  parameters: z.object({ integrationProvider: z.string().default('demo_identity') }),
  async evaluate({ tx, organizationId, parameters }) {
    const p = this.parameters.parse(parameters) as { integrationProvider: string };
    const integration = await tx.integration.findFirst({ where: { organizationId, provider: p.integrationProvider } });
    if (!integration?.lastSuccessAt) return { result: 'unknown', summary: 'No successful identity sync is available.', details: {} };
    const records = await tx.integrationRecord.findMany({ where: { organizationId, integrationId: integration.id, recordType: 'privileged_account' } });
    if (!records.length) return { result: 'unknown', summary: 'No accounts reported by the identity integration.', details: {} };
    const without = records.filter((r) => !(r.data as { mfaEnabled?: boolean }).mfaEnabled);
    const details = { accounts: records.length, withoutMfa: without.map((r) => r.externalId) };
    if (!without.length) return { result: 'pass', summary: `MFA is enabled for all ${records.length} privileged accounts.`, details };
    return { result: 'fail', summary: `${without.length} privileged account(s) do not have MFA enabled.`, details, severity: 'critical', findingTitle: 'Privileged accounts without MFA' };
  },
};

/** High-criticality vendors are not past their reassessment date. */
const vendorReassessment: ControlRule = {
  key: 'vendor_assessment_current',
  version: '1.0.0',
  name: 'Vendor assessments current',
  description: 'Fails when an active vendor at or above the criticality threshold is past its reassessment date; unknown when such vendors have never been assessed.',
  parameters: z.object({ minCriticality: z.enum(['low', 'medium', 'high', 'critical']).default('high') }),
  async evaluate({ tx, organizationId, parameters, now }) {
    const { minCriticality } = this.parameters.parse(parameters) as { minCriticality: 'low' | 'medium' | 'high' | 'critical' };
    const levels = ['low', 'medium', 'high', 'critical'];
    const inScope = levels.slice(levels.indexOf(minCriticality)) as Array<'low' | 'medium' | 'high' | 'critical'>;
    const vendors = await tx.vendor.findMany({
      where: { organizationId, criticality: { in: inScope }, status: { in: ['active', 'approved', 'approved_with_conditions'] } },
      select: { id: true, name: true, nextAssessmentAt: true, lastAssessedAt: true },
    });
    if (!vendors.length) return { result: 'not_applicable', summary: `No active vendors at ${minCriticality} criticality or above.`, details: {} };
    const neverAssessed = vendors.filter((v) => !v.lastAssessedAt);
    const overdue = vendors.filter((v) => v.nextAssessmentAt && v.nextAssessmentAt < now);
    const details = { vendors: vendors.length, overdue: overdue.map((v) => ({ id: v.id, name: v.name, due: v.nextAssessmentAt })), neverAssessed: neverAssessed.map((v) => v.name) };
    if (overdue.length) return { result: 'fail', summary: `${overdue.length} vendor reassessment(s) overdue: ${overdue.map((v) => v.name).join(', ')}.`, details, severity: 'medium', findingTitle: 'Vendor reassessments overdue' };
    if (neverAssessed.length) return { result: 'unknown', summary: `${neverAssessed.length} vendor(s) have never been assessed.`, details };
    return { result: 'pass', summary: `All ${vendors.length} in-scope vendors have current assessments.`, details };
  },
};

/** AI systems beyond the proposal stage have an owner and an approved assessment. */
const aiGovernance: ControlRule = {
  key: 'ai_system_governance',
  version: '1.0.0',
  name: 'AI systems owned and assessed',
  description: 'Fails when an AI system in pilot or production lacks a business owner or an approved risk assessment.',
  parameters: z.object({}),
  async evaluate({ tx, organizationId }) {
    const systems = await tx.aiSystem.findMany({
      where: { organizationId, lifecycleStatus: { in: ['approved_for_pilot', 'pilot', 'approved_for_production', 'production'] } },
      select: { id: true, name: true, businessOwnerId: true, assessments: { where: { status: 'approved' }, select: { id: true }, take: 1 } },
    });
    if (!systems.length) return { result: 'not_applicable', summary: 'No AI systems are in pilot or production.', details: {} };
    const gaps = systems.filter((s) => !s.businessOwnerId || s.assessments.length === 0).map((s) => ({ id: s.id, name: s.name, missingOwner: !s.businessOwnerId, missingApprovedAssessment: s.assessments.length === 0 }));
    if (!gaps.length) return { result: 'pass', summary: `All ${systems.length} deployed AI systems have an owner and an approved assessment.`, details: { systems: systems.length } };
    return { result: 'fail', summary: `${gaps.length} deployed AI system(s) lack an owner or an approved assessment.`, details: { gaps }, severity: 'high', findingTitle: 'AI systems deployed without ownership or approved assessment' };
  },
};

/** No remediation task is overdue. */
const remediationTimeliness: ControlRule = {
  key: 'remediation_overdue',
  version: '1.0.0',
  name: 'Remediation on schedule',
  description: 'Fails when any open remediation task is past its due date.',
  parameters: z.object({ graceDays: z.number().int().min(0).default(0) }),
  async evaluate({ tx, organizationId, parameters, now }) {
    const { graceDays } = this.parameters.parse(parameters) as { graceDays: number };
    const cutoff = new Date(now.getTime() - graceDays * DAY);
    const overdue = await tx.remediationTask.findMany({ where: { organizationId, status: { in: ['open', 'in_progress', 'blocked'] }, dueDate: { lt: cutoff } }, select: { id: true, title: true, dueDate: true } });
    if (!overdue.length) return { result: 'pass', summary: 'No remediation tasks are overdue.', details: {} };
    return { result: 'fail', summary: `${overdue.length} remediation task(s) overdue.`, details: { overdue }, severity: 'medium', findingTitle: 'Overdue remediation tasks' };
  },
};

export const RULES: ControlRule[] = [evidenceCurrency, reviewCurrency, privilegedAccessReview, mfaEnforced, vendorReassessment, aiGovernance, remediationTimeliness];
export const RULES_BY_KEY = new Map(RULES.map((r) => [r.key, r]));
