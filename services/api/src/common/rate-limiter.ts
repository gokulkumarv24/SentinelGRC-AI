import { loadEnv } from '../config/env.js';

/**
 * Fixed-window in-memory rate limiter. Sufficient for the single-host deployment target;
 * running several API replicas requires a shared store (documented in docs/OPERATIONS.md).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly windowMs = 60_000) {}

  /** Returns seconds until retry when the limit is exceeded, otherwise null. */
  hit(key: string, limit: number): number | null {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.windows.size > 50_000) this.sweep(now);
      return null;
    }
    current.count += 1;
    return current.count > limit ? Math.ceil((current.resetAt - now) / 1000) : null;
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [key, value] of this.windows) if (value.resetAt <= now) this.windows.delete(key);
  }
}

export const rateLimiter = new RateLimiter();

export function limitFor(bucket: 'login' | 'expensive' | 'default'): number {
  const env = loadEnv();
  return bucket === 'login'
    ? env.RATE_LIMIT_LOGIN_PER_MINUTE
    : bucket === 'expensive'
      ? env.RATE_LIMIT_EXPENSIVE_PER_MINUTE
      : env.RATE_LIMIT_DEFAULT_PER_MINUTE;
}
