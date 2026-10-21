/**
 * Loads platform reference data (roles, permissions, framework manifests, illustrative mappings,
 * control templates). Idempotent; run after every migration deploy.
 *   npm run reference:sync -w services/api
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadReferenceData, syncRolesAndPermissions } from './reference-data.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: loadEnv().DATABASE_URL }) });
try {
  await syncRolesAndPermissions(prisma);
  const stats = await loadReferenceData(prisma, undefined, (m) => console.log(`  + ${m}`));
  console.log('Reference data synchronized:', stats);
} finally {
  await prisma.$disconnect();
}
