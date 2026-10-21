import { calculateMetrics, type ControlSnapshot } from './compliance.service.js';

const c = (overrides: Partial<ControlSnapshot>): ControlSnapshot => ({ id: Math.random().toString(), status: 'implemented', latestResult: 'pass', evidence: 'current', openFindings: {}, ...overrides });

describe('compliance calculations', () => {
  it('excludes unknown, not-applicable and untested results from the pass rate denominator', () => {
    const m = calculateMetrics([
      c({ latestResult: 'pass' }),
      c({ latestResult: 'fail' }),
      c({ latestResult: 'unknown' }),
      c({ latestResult: 'unknown' }),
      c({ latestResult: 'not_applicable' }),
      c({ latestResult: null }),
    ]);
    expect(m.tests).toEqual({ pass: 1, fail: 1, error: 0, unknown: 2, notApplicable: 1, notTested: 1 });
    expect(m.testPassRate).toBe(50); // 1 / (1 pass + 1 fail)
  });

  it('never counts unknown as passing', () => {
    const m = calculateMetrics([c({ latestResult: 'unknown' }), c({ latestResult: 'unknown' })]);
    expect(m.testPassRate).toBeNull();
    expect(m.tests.pass).toBe(0);
  });

  it('counts errors as non-passing results in the denominator', () => {
    expect(calculateMetrics([c({ latestResult: 'pass' }), c({ latestResult: 'error' })]).testPassRate).toBe(50);
  });

  it('removes not-applicable and retired controls from coverage denominators', () => {
    const m = calculateMetrics([
      c({ status: 'implemented' }),
      c({ status: 'partially_implemented' }),
      c({ status: 'not_applicable', evidence: 'missing', latestResult: null }),
      c({ status: 'retired', evidence: 'missing', latestResult: null }),
    ]);
    expect(m.applicable).toBe(2);
    expect(m.notApplicable).toBe(2);
    expect(m.implementationCoverage).toBe(50); // partial does not count as implemented
  });

  it('counts current and expiring evidence as current, but not expired or missing', () => {
    const m = calculateMetrics([c({ evidence: 'current' }), c({ evidence: 'expiring' }), c({ evidence: 'expired' }), c({ evidence: 'missing' })]);
    expect(m.evidence).toEqual({ current: 1, expiring: 1, expired: 1, missing: 1 });
    expect(m.evidenceCurrency).toBe(50);
  });

  it('sums open findings by severity across all controls', () => {
    const m = calculateMetrics([c({ openFindings: { high: 2 } }), c({ openFindings: { high: 1, low: 3 } })]);
    expect(m.openFindings).toEqual({ low: 3, medium: 0, high: 3, critical: 0 });
  });

  it('returns null rates for an empty scope rather than 0% or 100%', () => {
    const m = calculateMetrics([]);
    expect(m.implementationCoverage).toBeNull();
    expect(m.testPassRate).toBeNull();
    expect(m.evidenceCurrency).toBeNull();
  });
});
