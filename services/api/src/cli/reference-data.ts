import type { PrismaClient } from '../generated/prisma/client.js';
import { PERMISSIONS, ROLES, type Permission } from '../permissions/catalog.js';

/**
 * Synchronizes roles and permissions from the code catalog into the database.
 * Idempotent; safe in every environment. Removes grants that are no longer in the catalog.
 */
export async function syncRolesAndPermissions(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
    }
    const permissions = await tx.permission.findMany();
    const byKey = new Map(permissions.map((p) => [p.key, p.id]));
    for (const [key, role] of Object.entries(ROLES)) {
      const saved = await tx.role.upsert({
        where: { key },
        create: { key, name: role.name, description: role.description },
        update: { name: role.name, description: role.description },
      });
      const wanted = [...new Set(role.permissions as readonly Permission[])].map((p) => byKey.get(p)!);
      await tx.rolePermission.deleteMany({ where: { roleId: saved.id, permissionId: { notIn: wanted } } });
      await tx.rolePermission.createMany({ data: wanted.map((permissionId) => ({ roleId: saved.id, permissionId })), skipDuplicates: true });
    }
  });
}
