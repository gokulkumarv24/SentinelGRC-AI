// Shared configuration for the end-to-end suite: a dedicated database, ports and test-safe settings.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/** Repository root: the nearest directory whose package.json declares workspaces (works from CJS and ESM). */
function findRoot() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return pathToFileURL(`${dir}/`);
    if (dirname(dir) === dir) throw new Error('Run the E2E suite from inside the repository.');
  }
}

export const ROOT = findRoot();
export const WEB_PORT = 3100;
export const API_PORT = 4100;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const CREDENTIALS_FILE = new URL('var/e2e-credentials.txt', ROOT);

/** Environment for every E2E process (API, worker, web, seed). Never points at the development database. */
export function e2eEnv() {
  const envFile = new URL('.env', ROOT);
  const base = { ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}), ...process.env };
  let databaseUrl = base.E2E_DATABASE_URL;
  if (!databaseUrl) {
    if (!base.TEST_DATABASE_URL) throw new Error('Set E2E_DATABASE_URL (or TEST_DATABASE_URL) for the end-to-end suite.');
    const url = new URL(base.TEST_DATABASE_URL);
    url.pathname = '/sentinelgrc_e2e';
    databaseUrl = url.toString();
  }
  if (databaseUrl === base.DATABASE_URL) throw new Error('Refusing to run: the E2E database must not be the development database.');
  return {
    ...base,
    APP_ENV: 'development',
    DATABASE_URL: databaseUrl,
    API_PORT: String(API_PORT),
    API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    PUBLIC_APP_URL: BASE_URL,
    CORS_ORIGINS: BASE_URL,
    RATE_LIMIT_LOGIN_PER_MINUTE: '10000',
    RATE_LIMIT_DEFAULT_PER_MINUTE: '100000',
    RATE_LIMIT_EXPENSIVE_PER_MINUTE: '10000',
    AI_ENABLED: 'true',
    AI_PROVIDER: 'mock',
    AI_DATA_SHARING_APPROVED: 'false',
    EMAIL_PROVIDER: 'none',
    STORAGE_BACKEND: 'local',
    LOCAL_STORAGE_PATH: './var/e2e-storage',
    DEMO_MODE: 'true',
    WORKER_ENABLED: 'false',
    WORKER_POLL_SECONDS: '2',
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}
