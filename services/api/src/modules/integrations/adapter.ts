/**
 * Integration adapter contract (spec §13.1). Every connector declares its provider, version and
 * scopes, offers a health check and a paginated, cursor-aware collector, and normalizes its errors.
 * Secrets are never stored in rows: `configurationReference` names an environment variable.
 */
export interface CollectedRecord {
  recordType: string;
  externalId: string;
  data: Record<string, unknown>;
}

export interface CollectPage {
  records: CollectedRecord[];
  /** Opaque cursor for the next page; null when the collection is complete. */
  nextCursor: string | null;
}

export interface AdapterContext {
  configuration: Record<string, unknown>;
  /** Resolved from the referenced environment variable; undefined when none is referenced. */
  secret?: string;
  now: Date;
  signal: AbortSignal;
}

export interface IntegrationAdapter {
  provider: string;
  version: string;
  displayName: string;
  description: string;
  /** True for synthetic connectors; their data must never be presented as real (spec §0.1). */
  isDemo: boolean;
  requiredScopes: string[];
  recordTypes: string[];
  /** Non-secret configuration options the UI may offer. */
  configurationOptions: Array<{ key: string; label: string; options: string[]; default: string }>;
  healthCheck(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;
  collect(ctx: AdapterContext, cursor: string | null): Promise<CollectPage>;
  timeoutMs: number;
  maxPages: number;
}

/** Normalized connector failure; `retryable` drives the worker's backoff decision. */
export class IntegrationError extends Error {
  constructor(
    readonly code: 'auth_failed' | 'rate_limited' | 'timeout' | 'unavailable' | 'invalid_response' | 'misconfigured',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function normalizeError(error: unknown): IntegrationError {
  if (error instanceof IntegrationError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new IntegrationError('timeout', 'The provider did not respond in time', true);
  return new IntegrationError('unavailable', 'The provider request failed', true);
}

/** Only INTEGRATION_* variables can be referenced, so a reference can never expose other secrets. */
export const SECRET_REFERENCE = /^INTEGRATION_[A-Z0-9_]{1,60}$/;
