import { Injectable } from '@nestjs/common';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import { actorId, requireOrgId } from '../../common/request-context.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DEFAULT_SETTINGS, type OrganizationSettings } from '../organizations/organizations.service.js';
import { checkManifest, manifestSchema, type FrameworkManifest, type ManifestIssue } from './manifest.js';

export interface ImportPreview {
  valid: boolean;
  issues: ManifestIssue[];
  framework: { key: string; name: string; version: string; publisher: string; isIllustrative: boolean };
  requirements: number;
  existing: { sameVersion: boolean; otherVersions: string[] };
  affectedMappings: number;
}

type Db = Tx | PrismaClient;

/**
 * Framework registry (spec §8.1, §23). Versions are immutable: a changed framework is imported
 * as a new version, and mappings on older versions are flagged for review.
 * Platform reference frameworks have organizationId = null; organizations may import their own.
 */
@Injectable()
export class FrameworksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Platform frameworks plus the organization's own, with in-scope flags. */
  async list() {
    const organizationId = requireOrgId();
    const [frameworks, inScope] = await Promise.all([
      this.prisma.framework.findMany({
        where: { OR: [{ organizationId: null }, { organizationId }], status: { not: 'archived' } },
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
        include: { _count: { select: { requirements: true } } },
      }),
      this.scope(),
    ]);
    return frameworks.map(({ importProvenance, ...f }) => ({ ...f, scope: f.organizationId ? 'organization' : 'platform', inScope: inScope.includes(f.id), requirementCount: f._count.requirements, provenance: importProvenance }));
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const framework = await this.prisma.framework.findFirst({
      where: { id, OR: [{ organizationId: null }, { organizationId }] },
      include: { requirements: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!framework) throw notFound('Framework');
    const reqIds = framework.requirements.map((r) => r.id);
    const mappings = await this.prisma.controlMapping.findMany({
      where: { organizationId, sourceRequirementId: { in: reqIds }, controlId: { not: null }, reviewStatus: { not: 'rejected' } },
      select: { sourceRequirementId: true, reviewStatus: true, control: { select: { id: true, controlCode: true, title: true } } },
    });
    const byReq = new Map<string, Array<{ id: string; controlCode: string; title: string; reviewStatus: string }>>();
    for (const m of mappings) {
      if (!m.control) continue;
      byReq.set(m.sourceRequirementId, [...(byReq.get(m.sourceRequirementId) ?? []), { ...m.control, reviewStatus: m.reviewStatus }]);
    }
    return {
      ...framework,
      scope: framework.organizationId ? 'organization' : 'platform',
      inScope: (await this.scope()).includes(framework.id),
      requirements: framework.requirements.map((r) => ({ ...r, controls: byReq.get(r.id) ?? [] })),
    };
  }

  /** Validates a manifest without writing anything (spec §8.3 "validation preview and error report"). */
  async preview(input: unknown, organizationId: string | null = requireOrgId()): Promise<ImportPreview> {
    const parsed = manifestSchema.safeParse(input);
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.slice(0, 50).map((i) => ({ level: 'error', code: 'schema', message: `${i.path.join('.') || 'manifest'}: ${i.message}` })),
        framework: { key: '', name: '', version: '', publisher: '', isIllustrative: true },
        requirements: 0,
        existing: { sameVersion: false, otherVersions: [] },
        affectedMappings: 0,
      };
    }
    const manifest = parsed.data;
    const issues = checkManifest(manifest);
    const existing = await this.prisma.framework.findMany({ where: { organizationId, key: manifest.key }, select: { id: true, version: true } });
    const sameVersion = existing.some((e) => e.version === manifest.version);
    if (sameVersion) issues.push({ level: 'error', code: 'version_exists', message: `Version ${manifest.version} of ${manifest.key} is already imported. Framework versions are immutable; import a new version instead.` });
    const older = existing.filter((e) => e.version !== manifest.version);
    const affectedMappings = older.length
      ? await this.prisma.controlMapping.count({ where: { ...(organizationId ? { organizationId } : {}), sourceRequirementRef: { frameworkId: { in: older.map((o) => o.id) } } } })
      : 0;
    if (affectedMappings) issues.push({ level: 'warning', code: 'mappings_need_review', message: `${affectedMappings} mapping(s) on earlier versions will be flagged for review.` });
    return {
      valid: !issues.some((i) => i.level === 'error'),
      issues,
      framework: { key: manifest.key, name: manifest.name, version: manifest.version, publisher: manifest.publisher, isIllustrative: manifest.isIllustrative },
      requirements: manifest.requirements.length,
      existing: { sameVersion, otherVersions: older.map((o) => o.version) },
      affectedMappings,
    };
  }

  /** Imports a validated manifest into the organization's registry. */
  async importForOrganization(input: unknown) {
    const organizationId = requireOrgId();
    const preview = await this.preview(input, organizationId);
    if (!preview.valid) throw badRequest('invalid_manifest', 'The framework manifest has errors', { issues: preview.issues });
    const manifest = manifestSchema.parse(input);
    const framework = await this.prisma.tx((tx) => this.importManifest(tx, manifest, organizationId, 'api'));
    await this.audit.record({ action: 'framework.imported', entityType: 'framework', entityId: framework.id, after: { key: manifest.key, version: manifest.version, requirements: manifest.requirements.length, flaggedMappings: preview.affectedMappings } });
    return framework;
  }

  /** Shared by the API and the reference-data CLI. Caller provides the transaction. */
  async importManifest(tx: Db, manifest: FrameworkManifest, organizationId: string | null, via: 'api' | 'cli') {
    const exists = await tx.framework.findFirst({ where: { organizationId, key: manifest.key, version: manifest.version } });
    if (exists) throw conflict(`Version ${manifest.version} of ${manifest.key} already exists`);
    const framework = await tx.framework.create({
      data: {
        organizationId,
        key: manifest.key,
        name: manifest.name,
        publisher: manifest.publisher,
        version: manifest.version,
        releaseDate: manifest.releaseDate ? new Date(manifest.releaseDate) : null,
        sourceUrl: manifest.sourceUrl ?? null,
        retrievedAt: manifest.retrievedAt ? new Date(manifest.retrievedAt) : null,
        licenseNotes: manifest.licenseNotes ?? null,
        description: manifest.description ?? null,
        isIllustrative: manifest.isIllustrative,
        importProvenance: { via, provenance: manifest.provenance ?? null, verification: manifest.verification ?? null, obligationSchedule: manifest.obligationSchedule ?? null } as Prisma.InputJsonValue,
        importedBy: via === 'api' ? actorId() : null,
      },
    });
    await tx.frameworkRequirement.createMany({
      data: manifest.requirements.map((r, i) => ({
        frameworkId: framework.id,
        requirementCode: r.code,
        parentCode: r.parent ?? null,
        groupName: r.group ?? null,
        title: r.title,
        summary: r.summary ?? null,
        officialReference: r.officialReference ?? (r.official ? 'official text' : null),
        sourceVersion: manifest.version,
        sortOrder: r.sortOrder ?? i,
      })),
    });
    // Track version changes: mappings on older versions need review (spec §23).
    const older = await tx.framework.findMany({ where: { organizationId, key: manifest.key, id: { not: framework.id } }, select: { id: true } });
    if (older.length) {
      await tx.controlMapping.updateMany({
        where: { ...(organizationId ? { organizationId } : {}), sourceRequirementRef: { frameworkId: { in: older.map((o) => o.id) } }, reviewStatus: 'approved' },
        data: { reviewStatus: 'pending_review', reviewNotes: `Framework ${manifest.key} ${manifest.version} imported; re-review against the new version.` },
      });
    }
    return framework;
  }

  async scope(organizationId = requireOrgId()): Promise<string[]> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const settings = { ...DEFAULT_SETTINGS, ...(org.settings as OrganizationSettings & { frameworksInScope?: string[] }) };
    return settings.frameworksInScope ?? [];
  }

  /** Which frameworks the organization tracks compliance against (Framework Settings page). */
  async setScope(frameworkIds: string[]) {
    const organizationId = requireOrgId();
    const valid = await this.prisma.framework.findMany({ where: { id: { in: frameworkIds }, OR: [{ organizationId: null }, { organizationId }] }, select: { id: true } });
    if (valid.length !== new Set(frameworkIds).size) throw notFound('Framework');
    return this.prisma.tx(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const before = ((org.settings as Record<string, unknown>).frameworksInScope as string[] | undefined) ?? [];
      await tx.organization.update({ where: { id: organizationId }, data: { settings: { ...(org.settings as object), frameworksInScope: frameworkIds } } });
      await this.audit.record({ action: 'framework.scope_changed', entityType: 'organization', entityId: organizationId, before: { frameworksInScope: before }, after: { frameworksInScope: frameworkIds } }, tx);
      return { frameworksInScope: frameworkIds };
    });
  }

  async archive(id: string) {
    const organizationId = requireOrgId();
    const framework = await this.prisma.framework.findFirst({ where: { id, organizationId } });
    if (!framework) throw notFound('Framework'); // platform frameworks cannot be archived by a tenant
    await this.prisma.framework.update({ where: { id }, data: { status: 'archived' } });
    await this.audit.record({ action: 'framework.archived', entityType: 'framework', entityId: id });
  }

  /** Requirement search for mapping pickers (platform + own frameworks). */
  async requirements(query: { q?: string; frameworkId?: string; page: number; pageSize: number }) {
    const organizationId = requireOrgId();
    const where: Prisma.FrameworkRequirementWhereInput = {
      framework: { OR: [{ organizationId: null }, { organizationId }], status: { not: 'archived' } },
      ...(query.frameworkId ? { frameworkId: query.frameworkId } : {}),
      ...(query.q ? { OR: [{ requirementCode: { contains: query.q, mode: 'insensitive' } }, { title: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.frameworkRequirement.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ frameworkId: 'asc' }, { sortOrder: 'asc' }], include: { framework: { select: { id: true, key: true, name: true, version: true } } } }),
      this.prisma.frameworkRequirement.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
