// Loaded before every API test file: test-safe configuration only.
import { existsSync } from 'node:fs';

const rootEnv = new URL('../../../.env', import.meta.url);
if (!process.env.TEST_DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ENV = 'test';
process.env.AUTH_SECRET ??= 'test-only-secret-not-used-anywhere-else-0123456789';
process.env.PUBLIC_APP_URL = 'http://localhost:3000';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '10000';
process.env.RATE_LIMIT_DEFAULT_PER_MINUTE = '100000';
process.env.RATE_LIMIT_EXPENSIVE_PER_MINUTE = '10000';
process.env.AI_ENABLED = 'true';
process.env.AI_PROVIDER = 'mock';
process.env.AI_DATA_SHARING_APPROVED = 'false';
process.env.EMAIL_PROVIDER = 'none';
process.env.STORAGE_BACKEND = 'local';
process.env.LOCAL_STORAGE_PATH = './var/test-storage';
process.env.WORKER_ENABLED = 'false';
process.env.DEMO_MODE = 'true';
