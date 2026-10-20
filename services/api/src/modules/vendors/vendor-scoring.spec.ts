import { evaluateQuestion, inherentVendorRisk, meetsCriterion, scoreAssessment, vendorTier, type ScoredQuestion, type VendorProfile } from './vendor-scoring.js';

const profile: VendorProfile = {
  criticality: 'high',
  dataClassification: 'confidential',
  personalDataAccess: true,
  accessLevel: 'privileged',
  businessDependency: 4,
  serviceImpact: 4,
};

const q = (overrides: Partial<ScoredQuestion>): ScoredQuestion => ({
  questionKey: 'q',
  category: 'access_control',
  weight: 1,
  important: false,
  evidenceRequired: false,
  criterion: { equals: true },
  answer: true,
  notApplicable: false,
  naRationale: null,
  reviewerStatus: 'accepted',
  hasEvidence: false,
  ...overrides,
});

describe('vendor scoring', () => {
  it('produces an explainable inherent score with factor contributions', () => {
    const result = inherentVendorRisk(profile);
    expect(result.score).toBeGreaterThan(60);
    expect(result.breakdown.map((f) => f.factor)).toEqual(['criticality', 'dataSensitivity', 'accessLevel', 'businessDependency', 'serviceImpact']);
    const sum = result.breakdown.reduce((s, f) => s + f.contribution, 0);
    expect(Math.round(sum)).toBe(result.score);
  });

  it('gives minimal profiles a zero inherent score and maximal profiles 100', () => {
    expect(inherentVendorRisk({ criticality: 'low', dataClassification: 'public', personalDataAccess: false, accessLevel: 'none', businessDependency: 1, serviceImpact: 1 }).score).toBe(0);
    expect(inherentVendorRisk({ criticality: 'critical', dataClassification: 'restricted', personalDataAccess: true, accessLevel: 'administrative', businessDependency: 5, serviceImpact: 5 }).score).toBe(100);
  });

  it('never treats missing answers as positive evidence', () => {
    expect(evaluateQuestion(q({ answer: null })).credit).toBe(0);
    expect(evaluateQuestion(q({ answer: '' })).outcome).toBe('unanswered');
  });

  it('gives partial credit when required evidence is missing or the reviewer has not accepted', () => {
    expect(evaluateQuestion(q({ evidenceRequired: true, hasEvidence: false }))).toEqual({ outcome: 'met_evidence_missing', credit: 0.5 });
    expect(evaluateQuestion(q({ reviewerStatus: 'pending' })).credit).toBe(0.5);
    expect(evaluateQuestion(q({ reviewerStatus: 'rejected' })).credit).toBe(0);
  });

  it('requires a rationale for N/A, and reviewer acceptance for important questions', () => {
    expect(evaluateQuestion(q({ notApplicable: true, naRationale: '' })).outcome).toBe('na_needs_review');
    expect(evaluateQuestion(q({ notApplicable: true, naRationale: 'No data stored', important: true, reviewerStatus: 'pending' })).credit).toBe(0);
    expect(evaluateQuestion(q({ notApplicable: true, naRationale: 'No data stored', important: true, reviewerStatus: 'accepted' })).credit).toBeNull();
  });

  it('evaluates deterministic criteria', () => {
    expect(meetsCriterion('SOC2', { in: ['SOC2', 'ISO27001'] })).toBe(true);
    expect(meetsCriterion(['mfa', 'sso'], { includesAll: ['mfa'] })).toBe(true);
    expect(meetsCriterion(2, { min: 3 })).toBe(false);
    const now = new Date('2026-10-21T00:00:00Z');
    expect(meetsCriterion('2026-06-01', { withinDays: 365 }, now)).toBe(true);
    expect(meetsCriterion('2024-01-01', { withinDays: 365 }, now)).toBe(false);
    expect(meetsCriterion('2027-01-01', { withinDays: 365 }, now)).toBe(false);
  });

  it('reduces residual risk by measured control effectiveness, bounded by maxReduction', () => {
    const perfect = scoreAssessment(profile, [q({ questionKey: 'a' }), q({ questionKey: 'b' })]);
    expect(perfect.controlEffectiveness).toBe(1);
    expect(perfect.residualScore).toBe(Math.round(perfect.inherentScore * 0.4));
    const empty = scoreAssessment(profile, [q({ questionKey: 'a', answer: null }), q({ questionKey: 'b', answer: null })]);
    expect(empty.residualScore).toBe(empty.inherentScore);
    expect(empty.breakdown.assumptions.length).toBeGreaterThan(0);
  });

  it('maps residual scores to tiers', () => {
    expect(vendorTier(10)).toBe('low');
    expect(vendorTier(25)).toBe('medium');
    expect(vendorTier(60)).toBe('high');
    expect(vendorTier(75)).toBe('critical');
  });
});
