import { z } from 'zod';

/**
 * Versioned, explainable risk scoring (spec §6.1).
 *  inherent = likelihood × impact (each 1–5 → 1–25)
 *  residual = residual likelihood × residual impact, assessed separately after verified mitigations.
 * There is deliberately no percentage "discount" for controls.
 * Thresholds are demo defaults, configurable per organization and audited — not a universal standard.
 */
export const riskPolicySchema = z
  .object({
    method: z.literal('likelihood_x_impact'),
    scale: z.object({ min: z.literal(1), max: z.literal(5) }),
    tiers: z.object({
      // inclusive upper bounds
      low: z.number().int().min(1).max(25),
      medium: z.number().int().min(1).max(25),
      high: z.number().int().min(1).max(25),
    }),
    acceptanceMaxDays: z.number().int().min(1).max(730),
    sodRequiredFrom: z.enum(['low', 'medium', 'high', 'critical']),
  })
  .refine((p) => p.tiers.low < p.tiers.medium && p.tiers.medium < p.tiers.high && p.tiers.high < 25, {
    message: 'Tier bounds must increase: low < medium < high < 25',
  });

export type RiskPolicy = z.infer<typeof riskPolicySchema>;
export type Rating = 'low' | 'medium' | 'high' | 'critical';

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  method: 'likelihood_x_impact',
  scale: { min: 1, max: 5 },
  tiers: { low: 4, medium: 9, high: 16 }, // 1–4 Low, 5–9 Medium, 10–16 High, 17–25 Critical
  acceptanceMaxDays: 365,
  sodRequiredFrom: 'high',
};

const RANK: Record<Rating, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const ratingAtLeast = (rating: Rating, threshold: Rating) => RANK[rating] >= RANK[threshold];

export function assertFactor(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new RangeError(`${name} must be an integer from 1 to 5`);
}

export function score(likelihood: number, impact: number): number {
  assertFactor('likelihood', likelihood);
  assertFactor('impact', impact);
  return likelihood * impact;
}

export function rate(scoreValue: number, policy: RiskPolicy = DEFAULT_RISK_POLICY): Rating {
  if (!Number.isInteger(scoreValue) || scoreValue < 1 || scoreValue > 25) throw new RangeError('score must be 1–25');
  if (scoreValue <= policy.tiers.low) return 'low';
  if (scoreValue <= policy.tiers.medium) return 'medium';
  if (scoreValue <= policy.tiers.high) return 'high';
  return 'critical';
}

export interface RiskScores {
  inherentScore: number;
  inherentRating: Rating;
  residualScore: number | null;
  residualRating: Rating | null;
}

export function computeRiskScores(
  input: { likelihood: number; impact: number; residualLikelihood?: number | null; residualImpact?: number | null },
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): RiskScores {
  const inherentScore = score(input.likelihood, input.impact);
  const hasResidual = input.residualLikelihood != null && input.residualImpact != null;
  if ((input.residualLikelihood == null) !== (input.residualImpact == null)) {
    throw new RangeError('Residual likelihood and residual impact must be provided together');
  }
  const residualScore = hasResidual ? score(input.residualLikelihood!, input.residualImpact!) : null;
  return {
    inherentScore,
    inherentRating: rate(inherentScore, policy),
    residualScore,
    residualRating: residualScore === null ? null : rate(residualScore, policy),
  };
}
