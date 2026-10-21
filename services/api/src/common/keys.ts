import type { Tx } from '../prisma/prisma.service.js';

const TABLES = {
  RSK: { table: 'risks', column: 'risk_key' },
  FND: { table: 'findings', column: 'finding_key' },
} as const;

/**
 * Next human-readable key (RSK-0001, FND-0042) for an organization.
 * A transaction-scoped advisory lock serializes concurrent creators in the same org,
 * so two requests cannot compute the same key.
 */
export async function nextKey(tx: Tx, organizationId: string, prefix: keyof typeof TABLES): Promise<string> {
  const { table, column } = TABLES[prefix];
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${organizationId}:${prefix}`);
  const rows = await tx.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX(CAST(SUBSTRING(${column} FROM '[0-9]+$') AS INTEGER)) AS max FROM ${table} WHERE organization_id = $1::uuid`,
    organizationId,
  );
  return `${prefix}-${String((rows[0]?.max ?? 0) + 1).padStart(4, '0')}`;
}
