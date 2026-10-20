import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

/**
 * Runs once per API test run:
 *  - points DATABASE_URL at TEST_DATABASE_URL (never the dev database),
 *  - drops and recreates the schema, then applies the real migrations from an empty database.
 */
export default async function setup(): Promise<void> {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (!process.env.TEST_DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for API tests (see .env.example)');
  if (url === process.env.DATABASE_URL && !/test/i.test(url)) {
    throw new Error('Refusing to run: TEST_DATABASE_URL equals DATABASE_URL. Use a dedicated test database.');
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
