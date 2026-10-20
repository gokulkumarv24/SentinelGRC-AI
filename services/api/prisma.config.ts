import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The single .env lives at the repository root (see .env.example).
const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// A placeholder URL keeps `prisma generate` / `prisma validate` working without a database;
// commands that need a real database fail clearly when DATABASE_URL is unset.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@127.0.0.1:1/unset',
  },
});
