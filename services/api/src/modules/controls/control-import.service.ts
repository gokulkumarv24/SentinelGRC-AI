import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { parseCsvObjects, toCsv } from '../../common/csv.js';
import { badRequest } from '../../common/errors.js';
import { actorId, requireOrgId } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { addDays } from './controls.service.js';

export const IMPORT_COLUMNS = ['controlCode', 'title', 'description', 'category', 'reviewFrequencyDays', 'ownerEmail', 'requirements'] as const;

const rowSchema = z.object({
  controlCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, 'Invalid control code'),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(5000),
  category: z.string().trim().min(1, 'Category is required').max(80),
  reviewFrequencyDays: z.coerce.number().int().min(1).max(1095).catch(90),
  ownerEmail: z.string().trim().max(320).optional(),
  // "nist-csf:PR.AA-05; iso-27001:A.5.15" — framework key + requirement code
  requirements: z.string().trim().max(2000).optional(),
});

export interface ImportRowResult {
  row: number;
  controlCode: string;
  action: 'create' | 'update' | 'skip';
  errors: string[];
  warnings: string[];
  mappings: number;
}

/** Bulk control import with validation preview, error report and duplicate detection (spec §8.3). */
@Injectable()
export class ControlImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(csv: string, mode: 'create_only' | 'upsert') {
    const organizationId = requireOrgId();
    let raw: Array<Record<string, string>>;
    try {
      raw = parseCsvObjects(csv, 2000);
    } catch (e) {
      throw badRequest('invalid_csv', (e as Error).message);
    }
    if (!raw.length) throw badRequest('empty_csv', 'The file has no data rows.');
    const missing = IMPORT_COLUMNS.slice(0, 4).filter((c) => !(c in raw[0]));
    if (missing.length) throw badRequest('missing_columns', `Missing required columns: ${missing.join(', ')}`, { expected: IMPORT_COLUMNS });

    const existing = new Map((await this.prisma.control.findMany({ where: { organizationId }, select: { id: true, controlCode: true } })).map((c) => [c.controlCode.toLowerCase(), c.id]));
    const members = new Map((await this.prisma.membership.findMany({ where: { organizationId, status: 'active' }, select: { user: { select: { id: true, email: true } } } })).map((m) => [m.user.email, m.user.id]));
    const requirements = await this.prisma.frameworkRequirement.findMany({
      where: { framework: { OR: [{ organizationId: null }, { organizationId }], status: 'active' } },
      select: { id: true, requirementCode: true, framework: { select: { key: true, importedAt: true } } },
      orderBy: { framework: { importedAt: 'desc' } },
    });
    const reqIndex = new Map<string, string>();
    for (const r of requirements) {
      const k = `${r.framework.key}:${r.requirementCode}`.toLowerCase();
      if (!reqIndex.has(k)) reqIndex.set(k, r.id); // latest version wins
    }

    const seen = new Set<string>();
    const rows = raw.map((input, i) => {
      const result: ImportRowResult & { data?: z.infer<typeof rowSchema>; ownerId?: string | null; requirementIds: string[] } = { row: i + 2, controlCode: input.controlCode ?? '', action: 'create', errors: [], warnings: [], mappings: 0, requirementIds: [] };
      const parsed = rowSchema.safeParse(input);
      if (!parsed.success) {
        result.errors.push(...parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
        return result;
      }
      const data = parsed.data;
      result.data = data;
      const key = data.controlCode.toLowerCase();
      if (seen.has(key)) result.errors.push('Duplicate control code within the file');
      seen.add(key);
      if (existing.has(key)) {
        if (mode === 'create_only') {
          result.action = 'skip';
          result.warnings.push('Control already exists; skipped (create-only mode)');
        } else result.action = 'update';
      }
      if (data.ownerEmail) {
        const ownerId = members.get(data.ownerEmail.toLowerCase());
        if (!ownerId) result.warnings.push(`Owner ${data.ownerEmail} is not an active member; owner left unassigned`);
        result.ownerId = ownerId ?? null;
      }
      for (const ref of (data.requirements ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
        const id = reqIndex.get(ref.toLowerCase());
        if (id) result.requirementIds.push(id);
        else result.warnings.push(`Unknown requirement reference "${ref}" (use framework-key:CODE)`);
      }
      result.mappings = result.requirementIds.length;
      return result;
    });
    return {
      summary: {
        rows: rows.length,
        create: rows.filter((r) => !r.errors.length && r.action === 'create').length,
        update: rows.filter((r) => !r.errors.length && r.action === 'update').length,
        skip: rows.filter((r) => r.action === 'skip').length,
        errors: rows.filter((r) => r.errors.length).length,
        warnings: rows.reduce((n, r) => n + r.warnings.length, 0),
      },
      rows: rows.map(({ data: _d, ownerId: _o, requirementIds: _r, ...r }) => r),
      internal: rows,
    };
  }

  /** Imports all valid rows atomically; refuses to run if any row has errors. */
  async import(csv: string, mode: 'create_only' | 'upsert') {
    const organizationId = requireOrgId();
    const preview = await this.preview(csv, mode);
    if (preview.summary.errors) throw badRequest('import_has_errors', 'Fix the rows with errors and try again.', { rows: preview.rows.filter((r) => r.errors.length) });
    const now = new Date();
    const result = await this.prisma.tx(async (tx) => {
      let created = 0;
      let updated = 0;
      let mappings = 0;
      for (const row of preview.internal) {
        if (row.action === 'skip' || !row.data) continue;
        const d = row.data;
        let controlId: string;
        if (row.action === 'update') {
          const control = await tx.control.findFirstOrThrow({ where: { organizationId, controlCode: { equals: d.controlCode, mode: 'insensitive' } } });
          await tx.control.update({ where: { id: control.id }, data: { title: d.title, description: d.description, category: d.category, reviewFrequencyDays: d.reviewFrequencyDays, version: { increment: 1 }, updatedBy: actorId() } });
          if (row.ownerId !== undefined) await tx.controlImplementation.updateMany({ where: { organizationId, controlId: control.id }, data: { ownerId: row.ownerId } });
          controlId = control.id;
          updated++;
        } else {
          const control = await tx.control.create({ data: { organizationId, controlCode: d.controlCode, title: d.title, description: d.description, category: d.category, reviewFrequencyDays: d.reviewFrequencyDays, isIllustrative: false, createdBy: actorId() } });
          await tx.controlImplementation.create({ data: { organizationId, controlId: control.id, ownerId: row.ownerId ?? null, nextReviewAt: addDays(now, d.reviewFrequencyDays) } });
          controlId = control.id;
          created++;
        }
        for (const requirementId of row.requirementIds) {
          const exists = await tx.controlMapping.findFirst({ where: { organizationId, sourceRequirementId: requirementId, controlId } });
          if (exists) continue;
          const req = await tx.frameworkRequirement.findUniqueOrThrow({ where: { id: requirementId }, select: { sourceVersion: true } });
          await tx.controlMapping.create({
            data: { organizationId, sourceRequirementId: requirementId, controlId, mappingType: 'supports', rationale: 'Imported from bulk control file; requires review.', confidence: 50, reviewStatus: 'pending_review', frameworkVersion: req.sourceVersion, isIllustrative: false, createdBy: actorId() },
          });
          mappings++;
        }
      }
      await this.audit.record({ action: 'control.bulk_imported', entityType: 'organization', entityId: organizationId, after: { created, updated, mappings, skipped: preview.summary.skip, mode } }, tx);
      return { created, updated, mappings, skipped: preview.summary.skip };
    });
    return result;
  }

  async export(): Promise<string> {
    const organizationId = requireOrgId();
    const controls = await this.prisma.control.findMany({
      where: { organizationId, active: true },
      orderBy: { controlCode: 'asc' },
      include: {
        implementations: { where: { organizationId }, include: { ownerRef: { select: { email: true } } } },
        mappings: { where: { organizationId, reviewStatus: { not: 'rejected' } }, include: { sourceRequirementRef: { select: { requirementCode: true, framework: { select: { key: true } } } } } },
      },
    });
    const rows = controls.map((c) => [
      c.controlCode,
      c.title,
      c.description,
      c.category,
      c.reviewFrequencyDays,
      c.implementations[0]?.ownerRef?.email ?? '',
      c.mappings.map((m) => `${m.sourceRequirementRef.framework.key}:${m.sourceRequirementRef.requirementCode}`).join('; '),
      c.implementations[0]?.status ?? 'not_assessed',
    ]);
    await this.audit.record({ action: 'control.exported', entityType: 'organization', entityId: organizationId, after: { rows: rows.length } });
    return toCsv([...IMPORT_COLUMNS, 'implementationStatus'], rows);
  }
}
