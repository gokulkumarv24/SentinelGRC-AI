import { existsSync } from 'node:fs';
import { z } from 'zod';
import { CLOUDFLARE_RANGES, PRIVATE_HOPS } from './trusted-proxies.js';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('SentinelGRC AI'),
    PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    CORS_ORIGINS: csv,
    // false | true (one proxy hop) | number of trusted proxy hops in front of the API |
    // private: trust every loopback/private-network hop (internal routers and the web app's rewrite) |
    // cloudflare: private hops plus Cloudflare's edge ranges (Render and other hosts behind Cloudflare).
    // The client IP is then the first address, from the right, that is not a trusted hop.
    TRUST_PROXY: z
      .enum(['true', 'false', '1', '0', '2', '3', 'private', 'cloudflare'])
      .default('false')
      .transform((v): number | string[] => {
        if (v === 'private') return PRIVATE_HOPS;
        if (v === 'cloudflare') return [...PRIVATE_HOPS, ...CLOUDFLARE_RANGES];
        return v === 'true' ? 1 : v === 'false' ? 0 : Number(v);
      }),
    RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_EXPENSIVE_PER_MINUTE: z.coerce.number().int().positive().default(20),
    STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_PATH: z.string().default('./var/storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().max(200).default(25),
    ALLOWED_UPLOAD_MIME_TYPES: csv,
    DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    AI_ENABLED: bool,
    AI_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
    AI_BASE_URL: z.url().default('https://api.groq.com/openai/v1'),
    AI_MODEL: z.string().default('openai/gpt-oss-120b'),
    AI_API_KEY: z.string().optional(),
    AI_DATA_SHARING_APPROVED: bool,
    // Optional second OpenAI-compatible provider, used when the primary is rate limited or unavailable.
    AI_FALLBACK_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    AI_FALLBACK_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    AI_FALLBACK_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    // Platform-wide cap on tokens the background AI agent may use per rolling 24 hours (free-tier friendly).
    AI_AGENT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(150_000),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(200000).default(24000),
    EMAIL_PROVIDER: z.enum(['none', 'smtp']).default('none'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('SentinelGRC <no-reply@example.invalid>'),
    EMAIL_ALLOWED_RECIPIENT_DOMAINS: csv,
    SENTRY_DSN: z.string().optional(),
    DEMO_MODE: bool,
    WORKER_ENABLED: bool,
    RUN_WORKER_IN_API: bool,
    WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(3600).default(15),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (/CHANGE_ME|local-dev-only|placeholder/i.test(env.AUTH_SECRET)) fail('AUTH_SECRET', 'insecure placeholder secret');
    if (/local-dev-only|CHANGE_ME/.test(env.DATABASE_URL)) fail('DATABASE_URL', 'development credentials in production');
    if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes('*')) fail('CORS_ORIGINS', 'explicit allowlist required');
    if (!env.PUBLIC_APP_URL.startsWith('https://')) fail('PUBLIC_APP_URL', 'must be https in production');
    if (env.DEMO_MODE) fail('DEMO_MODE', 'must be false in production');
    if (env.STORAGE_BACKEND === 's3' && (!env.S3_BUCKET || !env.S3_ENDPOINT)) fail('S3_BUCKET', 'S3 settings required');
    if (env.AI_PROVIDER !== 'mock' && !env.AI_API_KEY) fail('AI_API_KEY', 'required for external AI provider');
    if (env.AI_FALLBACK_BASE_URL && (!env.AI_FALLBACK_MODEL || !env.AI_FALLBACK_API_KEY)) fail('AI_FALLBACK_API_KEY', 'fallback provider needs a model and key');
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Loads <repo>/.env (if present and not already loaded) and validates configuration once. */
export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const rootEnv = new URL('../../../../.env', import.meta.url);
  // Fills only variables that are not already set, so explicit overrides (e.g. DATABASE_URL for a restore) win.
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    // Report variable names and reasons only — never values (spec §0.1 rule 6).
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  if (parsed.data.ALLOWED_UPLOAD_MIME_TYPES.length === 0) {
    parsed.data.ALLOWED_UPLOAD_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv', 'application/json'];
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
