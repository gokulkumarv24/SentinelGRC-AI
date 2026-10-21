import { emailDecision } from '../notifications/email-delivery.service.js';
import { demoIdentityAdapter } from '../integrations/demo-identity.adapter.js';
import { IntegrationError } from '../integrations/adapter.js';
import { backoffMs, nextSlot } from './workflow-runner.service.js';

const HOUR = 3_600_000;

describe('workflow scheduling', () => {
  it('backs off exponentially and caps the delay', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it('moves to the next slot and skips missed slots instead of replaying a backlog', () => {
    const start = new Date('2026-10-21T00:00:00Z');
    expect(nextSlot(start, 24, new Date('2026-10-21T00:00:01Z')).toISOString()).toBe('2026-10-22T00:00:00.000Z');
    // Worker was down for three days: the next run is the first slot after now, not three catch-up runs.
    expect(nextSlot(start, 24, new Date('2026-10-24T05:00:00Z')).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(nextSlot(start, 1, new Date(start.getTime() + HOUR)).getTime()).toBe(start.getTime() + 2 * HOUR);
  });
});

describe('email delivery policy', () => {
  const base = { EMAIL_PROVIDER: 'smtp' as const, DEMO_MODE: false, EMAIL_ALLOWED_RECIPIENT_DOMAINS: [] as string[] };

  it('never sends without a configured provider', () => {
    expect(emailDecision({ ...base, EMAIL_PROVIDER: 'none' }, 'a@example.com')).toEqual({ send: false, reason: 'email_not_configured' });
  });

  it('does not email real people in demo mode unless their domain is allowlisted', () => {
    expect(emailDecision({ ...base, DEMO_MODE: true }, 'a@example.com')).toEqual({ send: false, reason: 'demo_mode_without_allowlist' });
    expect(emailDecision({ ...base, DEMO_MODE: true, EMAIL_ALLOWED_RECIPIENT_DOMAINS: ['example.test'] }, 'a@example.test')).toEqual({ send: true });
    expect(emailDecision({ ...base, EMAIL_ALLOWED_RECIPIENT_DOMAINS: ['example.test'] }, 'a@other.com')).toEqual({ send: false, reason: 'recipient_domain_not_allowed' });
  });

  it('rejects addresses that could slip past the domain allowlist', () => {
    const allow = { ...base, EMAIL_ALLOWED_RECIPIENT_DOMAINS: ['example.test'] };
    for (const tricky of ['a@evil.com(@example.test)', '"a@example.test"@evil.com', 'a@exämple.test', 'a@example.test, b@evil.com', 'a@example.test\r\nBcc: b@evil.com']) {
      expect(emailDecision(allow, tricky).send).toBe(false);
    }
  });
});

describe('demo identity adapter', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const ctx = (scenario: string) => ({ configuration: { scenario }, now, signal: new AbortController().signal });

  async function collectAll(scenario: string) {
    const records = [];
    let cursor: string | null = null;
    do {
      const page = await demoIdentityAdapter.collect(ctx(scenario), cursor);
      records.push(...page.records);
      cursor = page.nextCursor;
    } while (cursor);
    return records;
  }

  it('pages deterministically and labels every record as demo data', async () => {
    const first = await collectAll('healthy');
    expect(first).toHaveLength(6);
    expect(await collectAll('healthy')).toEqual(first);
    expect(first.every((r) => r.data.isDemo === true && r.recordType === 'privileged_account')).toBe(true);
  });

  it('produces the documented gaps per scenario', async () => {
    expect((await collectAll('missing_mfa')).filter((r) => !r.data.mfaEnabled).map((r) => r.externalId)).toEqual(['demo-ci-deployer']);
    const stale = (await collectAll('stale_reviews')).filter((r) => !r.data.lastAccessReviewAt || now.getTime() - new Date(r.data.lastAccessReviewAt as string).getTime() > 90 * 24 * HOUR);
    expect(stale.map((r) => r.externalId)).toEqual(['demo-db-owner', 'demo-ci-deployer']);
  });

  it('normalizes failures and rejects bad configuration', async () => {
    await expect(demoIdentityAdapter.collect(ctx('failure'), null)).rejects.toMatchObject({ code: 'unavailable', retryable: true });
    await expect(demoIdentityAdapter.collect(ctx('nope'), null)).rejects.toBeInstanceOf(IntegrationError);
    await expect(demoIdentityAdapter.collect(ctx('healthy'), 'abc')).rejects.toMatchObject({ code: 'invalid_response', retryable: false });
  });
});
