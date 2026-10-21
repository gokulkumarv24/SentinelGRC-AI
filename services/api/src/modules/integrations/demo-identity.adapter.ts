import { IntegrationError, type IntegrationAdapter } from './adapter.js';

const DAY = 86_400_000;

interface DemoAccount {
  id: string;
  displayName: string;
  role: string;
  mfaEnabled: boolean;
  reviewAgeDays: number | null;
}

/** Synthetic privileged accounts. Ages are relative to the sync time, so results are deterministic per day. */
const BASE: DemoAccount[] = [
  { id: 'demo-admin-01', displayName: 'Demo Admin 01', role: 'Global administrator', mfaEnabled: true, reviewAgeDays: 20 },
  { id: 'demo-admin-02', displayName: 'Demo Admin 02', role: 'Global administrator', mfaEnabled: true, reviewAgeDays: 45 },
  { id: 'demo-db-owner', displayName: 'Demo Database Owner', role: 'Database owner', mfaEnabled: true, reviewAgeDays: 60 },
  { id: 'demo-break-glass', displayName: 'Demo Break-glass Account', role: 'Emergency access', mfaEnabled: true, reviewAgeDays: 10 },
  { id: 'demo-ci-deployer', displayName: 'Demo CI Deployer', role: 'Deployment service principal', mfaEnabled: true, reviewAgeDays: 75 },
  { id: 'demo-sec-analyst', displayName: 'Demo Security Analyst', role: 'Security administrator', mfaEnabled: true, reviewAgeDays: 30 },
];

const SCENARIOS: Record<string, (a: DemoAccount[]) => DemoAccount[]> = {
  healthy: (a) => a,
  stale_reviews: (a) => a.map((x, i) => (i === 2 ? { ...x, reviewAgeDays: 200 } : i === 4 ? { ...x, reviewAgeDays: null } : x)),
  missing_mfa: (a) => a.map((x, i) => (i === 4 ? { ...x, mfaEnabled: false } : x)),
};

const PAGE_SIZE = 4;

/**
 * Deterministic local identity provider (spec §13.1: at least one working demo integration).
 * It reports synthetic privileged accounts with MFA and access-review facts; every record is
 * labelled demo data. The `failure` scenario simulates an unavailable provider.
 */
export const demoIdentityAdapter: IntegrationAdapter = {
  provider: 'demo_identity',
  version: '1.0.0',
  displayName: 'Demo identity provider',
  description: 'Synthetic privileged accounts with MFA status and last access review. For demonstrations and tests only; not connected to any real directory.',
  isDemo: true,
  requiredScopes: ['directory.privileged_accounts.read (simulated)'],
  recordTypes: ['privileged_account'],
  configurationOptions: [{ key: 'scenario', label: 'Scenario', options: ['healthy', 'stale_reviews', 'missing_mfa', 'failure'], default: 'healthy' }],
  timeoutMs: 5_000,
  maxPages: 10,

  async healthCheck({ configuration }) {
    if (configuration.scenario === 'failure') return { ok: false, message: 'Simulated outage: the demo provider is unavailable.' };
    return { ok: true, message: 'Demo provider reachable (synthetic data).' };
  },

  async collect({ configuration, now }, cursor) {
    const scenario = typeof configuration.scenario === 'string' ? configuration.scenario : 'healthy';
    if (scenario === 'failure') throw new IntegrationError('unavailable', 'Simulated outage: the demo provider is unavailable.', true);
    const transform = SCENARIOS[scenario];
    if (!transform) throw new IntegrationError('misconfigured', `Unknown demo scenario "${scenario}"`, false);
    const accounts = transform(BASE);
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isInteger(start) || start < 0 || start > accounts.length) throw new IntegrationError('invalid_response', 'Invalid sync cursor', false);
    const slice = accounts.slice(start, start + PAGE_SIZE);
    return {
      records: slice.map((a) => ({
        recordType: 'privileged_account',
        externalId: a.id,
        data: {
          displayName: a.displayName,
          role: a.role,
          mfaEnabled: a.mfaEnabled,
          lastAccessReviewAt: a.reviewAgeDays === null ? null : new Date(now.getTime() - a.reviewAgeDays * DAY).toISOString(),
          isDemo: true,
        },
      })),
      nextCursor: start + PAGE_SIZE < accounts.length ? String(start + PAGE_SIZE) : null,
    };
  },
};

export const ADAPTERS = new Map<string, IntegrationAdapter>([[demoIdentityAdapter.provider, demoIdentityAdapter]]);
