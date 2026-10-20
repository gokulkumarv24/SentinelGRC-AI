import { computeRiskScores, DEFAULT_RISK_POLICY, rate, ratingAtLeast, riskPolicySchema, score } from './risk-scoring.js';

describe('risk scoring policy', () => {
  it('computes inherent score as likelihood × impact', () => {
    expect(score(1, 1)).toBe(1);
    expect(score(5, 5)).toBe(25);
    expect(score(3, 4)).toBe(12);
  });

  it.each([
    [1, 'low'],
    [4, 'low'],
    [5, 'medium'],
    [9, 'medium'],
    [10, 'high'],
    [16, 'high'],
    [17, 'critical'],
    [25, 'critical'],
  ])('rates score %i as %s at the tier boundaries', (value, expected) => {
    expect(rate(value)).toBe(expected);
  });

  it('rejects factors outside 1–5 and non-integers', () => {
    expect(() => score(0, 3)).toThrow(RangeError);
    expect(() => score(6, 3)).toThrow(RangeError);
    expect(() => score(2.5, 3)).toThrow(RangeError);
  });

  it('computes residual from separately assessed residual factors, never a discount', () => {
    const scores = computeRiskScores({ likelihood: 5, impact: 4, residualLikelihood: 2, residualImpact: 4 });
    expect(scores).toEqual({ inherentScore: 20, inherentRating: 'critical', residualScore: 8, residualRating: 'medium' });
    expect(computeRiskScores({ likelihood: 2, impact: 2 }).residualScore).toBeNull();
  });

  it('requires residual likelihood and impact together', () => {
    expect(() => computeRiskScores({ likelihood: 3, impact: 3, residualLikelihood: 2 })).toThrow(RangeError);
  });

  it('respects a configured policy version', () => {
    const strict = { ...DEFAULT_RISK_POLICY, tiers: { low: 2, medium: 6, high: 12 } };
    expect(rate(5, strict)).toBe('medium');
    expect(rate(13, strict)).toBe('critical');
  });

  it('validates tier ordering in policies', () => {
    expect(riskPolicySchema.safeParse(DEFAULT_RISK_POLICY).success).toBe(true);
    expect(riskPolicySchema.safeParse({ ...DEFAULT_RISK_POLICY, tiers: { low: 10, medium: 5, high: 16 } }).success).toBe(false);
  });

  it('compares ratings', () => {
    expect(ratingAtLeast('critical', 'high')).toBe(true);
    expect(ratingAtLeast('medium', 'high')).toBe(false);
  });
});
