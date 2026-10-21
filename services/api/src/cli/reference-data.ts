import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { manifestSchema } from '../modules/frameworks/manifest.js';
import { templateFileSchema } from '../modules/vendors/questionnaire.js';
import { PERMISSIONS, ROLES, type Permission } from '../permissions/catalog.js';

/** <repo>/framework-data (same relative depth from src/cli and dist/cli). */
export const FRAMEWORK_DATA_DIR = fileURLToPath(new URL('../../../../framework-data/', import.meta.url));

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

interface TemplateFile {
  templates: Array<{ controlCode: string; title: string; category: string; description: string; reviewFrequencyDays: number; requirements: string[]; rules: Array<{ ruleKey: string; parameters: Record<string, unknown> }> }>;
}
interface MappingFile {
  createdAt: string;
  mappings: Array<{ source: [string, string, string]; target: [string, string, string]; type: 'supports' | 'partially_supports' | 'related' | 'requires_separate_evidence'; confidence: number; rationale: string }>;
}

/**
 * Loads platform reference data: framework manifests, illustrative cross-framework mappings and
 * illustrative control templates. Idempotent — existing framework versions are left untouched
 * (versions are immutable), and mappings/templates are only added if missing.
 */
export async function loadReferenceData(prisma: PrismaClient, dir = FRAMEWORK_DATA_DIR, log: (m: string) => void = () => {}) {
  if (!existsSync(dir)) throw new Error(`framework-data directory not found at ${dir}`);
  const stats = { frameworksAdded: 0, frameworksPresent: 0, mappingsAdded: 0, templatesAdded: 0, questionnairesAdded: 0 };

  for (const file of readdirSync(`${dir}/manifests`).filter((f) => f.endsWith('.json')).sort()) {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(`${dir}/manifests/${file}`, 'utf8')));
    const existing = await prisma.framework.findFirst({ where: { organizationId: null, key: manifest.key, version: manifest.version } });
    if (existing) {
      stats.frameworksPresent++;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const fw = await tx.framework.create({
        data: {
          organizationId: null,
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
          importProvenance: { via: 'reference-data', file, provenance: manifest.provenance ?? null, verification: manifest.verification ?? null, obligationSchedule: manifest.obligationSchedule ?? null } as Prisma.InputJsonValue,
        },
      });
      await tx.frameworkRequirement.createMany({
        data: manifest.requirements.map((r, i) => ({
          frameworkId: fw.id,
          requirementCode: r.code,
          parentCode: r.parent ?? null,
          groupName: r.group ?? null,
          title: r.title,
          summary: r.summary ?? null,
          officialReference: r.official ? 'official text' : null,
          sourceVersion: manifest.version,
          sortOrder: r.sortOrder ?? i,
        })),
      });
    }, { timeout: 60_000 });
    stats.frameworksAdded++;
    log(`framework ${manifest.key} ${manifest.version}: ${manifest.requirements.length} requirements`);
  }

  // Requirement lookup by framework key + code (latest platform version).
  const reqs = await prisma.frameworkRequirement.findMany({ where: { framework: { organizationId: null } }, select: { id: true, requirementCode: true, sourceVersion: true, framework: { select: { key: true, version: true } } } });
  const byKeyVersion = new Map(reqs.map((r) => [`${r.framework.key}|${r.framework.version}|${r.requirementCode}`, r]));
  const byKey = new Map(reqs.map((r) => [`${r.framework.key}|${r.requirementCode}`, r]));

  const mappingFile = `${dir}/mappings/illustrative-mappings.json`;
  if (existsSync(mappingFile)) {
    const data = JSON.parse(readFileSync(mappingFile, 'utf8')) as MappingFile;
    for (const m of data.mappings) {
      const source = byKeyVersion.get(m.source.join('|'));
      const target = byKeyVersion.get(m.target.join('|'));
      if (!source || !target) throw new Error(`Illustrative mapping references unknown requirement: ${m.source.join(' ')} -> ${m.target.join(' ')}`);
      const exists = await prisma.controlMapping.findFirst({ where: { organizationId: null, sourceRequirementId: source.id, targetRequirementId: target.id } });
      if (exists) continue;
      await prisma.controlMapping.create({
        data: { organizationId: null, sourceRequirementId: source.id, targetRequirementId: target.id, mappingType: m.type, rationale: m.rationale, confidence: m.confidence, reviewStatus: 'unreviewed', isIllustrative: true, frameworkVersion: source.sourceVersion, sourceReference: `framework-data/mappings/illustrative-mappings.json (${data.createdAt})` },
      });
      stats.mappingsAdded++;
    }
  }

  const templateFile = `${dir}/control-templates.json`;
  if (existsSync(templateFile)) {
    const data = JSON.parse(readFileSync(templateFile, 'utf8')) as TemplateFile;
    for (const t of data.templates) {
      const exists = await prisma.control.findFirst({ where: { organizationId: null, controlCode: t.controlCode } });
      if (exists) continue;
      await prisma.$transaction(async (tx) => {
        const control = await tx.control.create({
          data: { organizationId: null, controlCode: t.controlCode, title: t.title, description: t.description, category: t.category, reviewFrequencyDays: t.reviewFrequencyDays, isIllustrative: true, templateConfig: { rules: t.rules, requirements: t.requirements } as Prisma.InputJsonValue },
        });
        for (const ref of t.requirements) {
          const [key, code] = ref.split(/:(.*)/s);
          const r = byKey.get(`${key}|${code}`);
          if (!r) throw new Error(`Template ${t.controlCode} references unknown requirement ${ref}`);
          await tx.controlMapping.create({
            data: { organizationId: null, sourceRequirementId: r.id, controlId: control.id, mappingType: 'supports', rationale: `Illustrative template mapping for ${t.controlCode}.`, confidence: 50, reviewStatus: 'unreviewed', isIllustrative: true, frameworkVersion: r.sourceVersion },
          });
        }
      });
      stats.templatesAdded++;
    }
  }
  // Questionnaire templates (vendor security, AI system assessment). Versions are immutable.
  const qDir = `${dir}/questionnaires`;
  if (existsSync(qDir)) {
    for (const file of readdirSync(qDir).filter((f) => f.endsWith('.json')).sort()) {
      const t = templateFileSchema.parse(JSON.parse(readFileSync(`${qDir}/${file}`, 'utf8')));
      const exists = await prisma.assessmentTemplate.findFirst({ where: { organizationId: null, key: t.key, version: t.version } });
      if (exists) continue;
      await prisma.assessmentTemplate.create({
        data: {
          organizationId: null,
          key: t.key,
          name: t.name,
          version: t.version,
          purpose: t.purpose,
          description: t.description,
          frozen: true,
          questions: {
            create: t.questions.map((q, i) => ({
              questionKey: q.questionKey,
              questionText: q.questionText,
              category: q.category,
              responseType: q.responseType,
              options: q.options,
              required: q.required,
              weight: q.weight,
              important: q.important,
              guidance: q.guidance,
              evidenceRequired: q.evidenceRequired,
              expectedAnswer: (q.expectedAnswer ?? undefined) as Prisma.InputJsonValue | undefined,
              dependsOnQuestionKey: q.dependsOnQuestionKey,
              dependsOnAnswer: (q.dependsOnAnswer ?? undefined) as Prisma.InputJsonValue | undefined,
              sortOrder: i,
            })),
          },
        },
      });
      stats.questionnairesAdded++;
      log(`questionnaire ${t.key} v${t.version}: ${t.questions.length} questions`);
    }
  }
  return stats;
}
