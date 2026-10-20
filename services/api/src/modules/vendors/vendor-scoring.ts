import { z } from 'zod';

/**
 * Transparent vendor scoring (spec §9.3). Scores are 0–100 (higher = riskier).
 *
 * Inherent risk = weighted average of normalized profile factors × 100.
 * Control effectiveness E (0–1) = Σ(weight × credit) / Σ(weight) over applicable questions, where
 *   credit 1.0  answer meets the criterion, reviewer accepted, required evidence attached
 *   credit 0.5  meets the criterion but evidence missing or reviewer marked insufficient
 *   credit 0    does not meet the criterion, unanswered, or rejected
 *   excluded    "not applicable" with rationale (important questions also need reviewer acceptance)
 * Residual risk = inherent × (1 − maxReduction × E). maxReduction is a documented policy value,
 * so a perfect questionnaire can never reduce risk to zero.
 * Missing answers are never treated as positive evidence.
 */
export const vendorPolicySchema = z.object({
  weights: z.object({
    criticality: z.number().min(0),
    dataSensitivity: z.number().min(0),
    accessLevel: z.number().min(0),
    businessDependency: z.number().min(0),
    serviceImpact: z.number().min(0),
  }),
  maxReduction: z.number().min(0).max(0.9),
  partialCredit: z.number().min(0).max(1),
  tiers: z.object({ low: z.number(), medium: z.number(), high: z.number() }), // exclusive upper bounds
  conditionsRequiredFrom: z.enum(['medium', 'high', 'critical']),
});
export type VendorPolicy = z.infer<typeof vendorPolicySchema>;

export const DEFAULT_VENDOR_POLICY: VendorPolicy = {
  weights: { criticality: 0.25, dataSensitivity: 0.25, accessLevel: 0.2, businessDependency: 0.15, serviceImpact: 0.15 },
  maxReduction: 0.6,
  partialCredit: 0.5,
  tiers: { low: 25, medium: 50, high: 75 },
  conditionsRequiredFrom: 'high',
};

const LEVEL4 = { low: 1, medium: 2, high: 3, critical: 4 } as const;
const CLASSIFICATION = { public: 1, internal: 2, confidential: 3, restricted: 4 } as const;
const ACCESS = { none: 1, limited: 2, privileged: 3, administrative: 4 } as const;

export interface VendorProfile {
  criticality: keyof typeof LEVEL4;
  dataClassification: keyof typeof CLASSIFICATION;
  personalDataAccess: boolean;
  accessLevel: keyof typeof ACCESS;
  businessDependency: number; // 1-5
  serviceImpact: number; // 1-5
}

export interface FactorBreakdown {
  factor: string;
  value: string | number;
  normalized: number;
  weight: number;
  contribution: number;
}

export function inherentVendorRisk(profile: VendorProfile, policy: VendorPolicy = DEFAULT_VENDOR_POLICY) {
  // Personal data raises sensitivity by one step (capped).
  const sensitivity = Math.min(4, CLASSIFICATION[profile.dataClassification] + (profile.personalDataAccess ? 1 : 0));
  const factors: Array<[string, string | number, number, number]> = [
    ['criticality', profile.criticality, (LEVEL4[profile.criticality] - 1) / 3, policy.weights.criticality],
    ['dataSensitivity', `${profile.dataClassification}${profile.personalDataAccess ? ' + personal data' : ''}`, (sensitivity - 1) / 3, policy.weights.dataSensitivity],
    ['accessLevel', profile.accessLevel, (ACCESS[profile.accessLevel] - 1) / 3, policy.weights.accessLevel],
    ['businessDependency', profile.businessDependency, (profile.businessDependency - 1) / 4, policy.weights.businessDependency],
    ['serviceImpact', profile.serviceImpact, (profile.serviceImpact - 1) / 4, policy.weights.serviceImpact],
  ];
  const totalWeight = factors.reduce((s, f) => s + f[3], 0) || 1;
  const breakdown: FactorBreakdown[] = factors.map(([factor, value, normalized, weight]) => ({
    factor,
    value,
    normalized: round(normalized, 3),
    weight,
    contribution: round((normalized * weight * 100) / totalWeight, 1),
  }));
  const score = Math.round(breakdown.reduce((s, f) => s + f.contribution, 0));
  return { score, breakdown };
}

// ── Questionnaire evaluation ──

export type Criterion =
  | { equals: unknown }
  | { in: unknown[] }
  | { includesAll: unknown[] }
  | { min: number }
  | { max: number }
  | { notEmpty: true }
  | { withinDays: number };

/** Deterministic check of an answer against a question's expected-answer criterion. */
export function meetsCriterion(answer: unknown, criterion: Criterion | null | undefined, now = new Date()): boolean | null {
  if (!criterion) return null; // informational question; not scored
  if (answer === null || answer === undefined || answer === '') return false;
  if ('equals' in criterion) return answer === criterion.equals;
  if ('in' in criterion) return criterion.in.includes(answer);
  if ('includesAll' in criterion) return Array.isArray(answer) && criterion.includesAll.every((v) => answer.includes(v));
  if ('min' in criterion) return typeof answer === 'number' && answer >= criterion.min;
  if ('max' in criterion) return typeof answer === 'number' && answer <= criterion.max;
  if ('notEmpty' in criterion) return typeof answer === 'string' ? answer.trim().length > 0 : Array.isArray(answer) && answer.length > 0;
  if ('withinDays' in criterion) {
    const date = new Date(String(answer));
    if (Number.isNaN(date.getTime())) return false;
    return (now.getTime() - date.getTime()) / 86_400_000 <= criterion.withinDays && date <= now;
  }
  return false;
}

export interface ScoredQuestion {
  questionKey: string;
  category: string;
  weight: number;
  important: boolean;
  evidenceRequired: boolean;
  criterion: Criterion | null;
  answer: unknown;
  notApplicable: boolean;
  naRationale: string | null;
  reviewerStatus: 'pending' | 'accepted' | 'insufficient' | 'rejected';
  hasEvidence: boolean;
}

export type QuestionOutcome =
  | 'met'
  | 'met_evidence_missing'
  | 'met_insufficient'
  | 'not_met'
  | 'unanswered'
  | 'rejected'
  | 'not_applicable'
  | 'na_needs_review'
  | 'informational';

export function evaluateQuestion(q: ScoredQuestion, policy: VendorPolicy = DEFAULT_VENDOR_POLICY): { outcome: QuestionOutcome; credit: number | null } {
  if (q.notApplicable) {
    if (!q.naRationale?.trim()) return { outcome: 'na_needs_review', credit: 0 };
    if (q.important && q.reviewerStatus !== 'accepted') return { outcome: 'na_needs_review', credit: 0 };
    return { outcome: 'not_applicable', credit: null };
  }
  if (!q.criterion) return { outcome: 'informational', credit: null };
  if (q.answer === null || q.answer === undefined || q.answer === '') return { outcome: 'unanswered', credit: 0 };
  if (q.reviewerStatus === 'rejected') return { outcome: 'rejected', credit: 0 };
  if (!meetsCriterion(q.answer, q.criterion)) return { outcome: 'not_met', credit: 0 };
  if (q.evidenceRequired && !q.hasEvidence) return { outcome: 'met_evidence_missing', credit: policy.partialCredit };
  if (q.reviewerStatus === 'insufficient') return { outcome: 'met_insufficient', credit: policy.partialCredit };
  if (q.reviewerStatus === 'pending') return { outcome: 'met_insufficient', credit: policy.partialCredit };
  return { outcome: 'met', credit: 1 };
}

export function vendorTier(score: number, policy: VendorPolicy = DEFAULT_VENDOR_POLICY): 'low' | 'medium' | 'high' | 'critical' {
  if (score < policy.tiers.low) return 'low';
  if (score < policy.tiers.medium) return 'medium';
  if (score < policy.tiers.high) return 'high';
  return 'critical';
}

export function scoreAssessment(profile: VendorProfile, questions: ScoredQuestion[], policy: VendorPolicy = DEFAULT_VENDOR_POLICY) {
  const inherent = inherentVendorRisk(profile, policy);
  const evaluated = questions.map((q) => ({ ...q, ...evaluateQuestion(q, policy) }));
  const scored = evaluated.filter((q) => q.credit !== null);
  const totalWeight = scored.reduce((s, q) => s + q.weight, 0);
  const effectiveness = totalWeight === 0 ? 0 : scored.reduce((s, q) => s + q.weight * (q.credit ?? 0), 0) / totalWeight;
  const residual = Math.round(inherent.score * (1 - policy.maxReduction * effectiveness));

  const byCategory = new Map<string, { weight: number; earned: number }>();
  for (const q of scored) {
    const c = byCategory.get(q.category) ?? { weight: 0, earned: 0 };
    c.weight += q.weight;
    c.earned += q.weight * (q.credit ?? 0);
    byCategory.set(q.category, c);
  }

  return {
    inherentScore: inherent.score,
    residualScore: residual,
    tier: vendorTier(residual, policy),
    controlEffectiveness: round(effectiveness, 3),
    breakdown: {
      inherentFactors: inherent.breakdown,
      categories: [...byCategory].map(([category, c]) => ({ category, effectiveness: round(c.earned / c.weight, 3), weight: c.weight })),
      questions: evaluated.map((q) => ({ questionKey: q.questionKey, category: q.category, weight: q.weight, outcome: q.outcome, credit: q.credit })),
      assumptions: [
        'Unanswered questions receive no credit.',
        'Answers awaiting review receive partial credit until accepted.',
        `Residual = inherent × (1 − ${policy.maxReduction} × control effectiveness).`,
        '"Not applicable" answers are excluded only with a rationale; important questions also need reviewer acceptance.',
      ],
    },
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
