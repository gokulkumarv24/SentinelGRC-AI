import { z } from 'zod';
import { httpUrl } from '../../common/validation.js';

/** Framework manifest format (framework-data/manifests/*.json and the import API). */
export const requirementSchema = z.object({
  code: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(1000),
  summary: z.string().max(2000).nullable().optional(),
  group: z.string().max(120).nullable().optional(),
  parent: z.string().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  official: z.boolean().optional(),
  officialReference: z.string().max(500).nullable().optional(),
});

export const manifestSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase letters, digits and hyphens'),
  name: z.string().trim().min(1).max(200),
  publisher: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(120),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceUrl: httpUrl().nullable().optional(),
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  licenseNotes: z.string().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  isIllustrative: z.boolean().default(true),
  provenance: z.record(z.string(), z.unknown()).optional(),
  verification: z.string().max(1000).optional(),
  obligationSchedule: z.record(z.string(), z.unknown()).optional(),
  requirements: z.array(requirementSchema).min(1).max(5000),
});
export type FrameworkManifest = z.infer<typeof manifestSchema>;

export interface ManifestIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  requirement?: string;
}

/** Structural checks beyond the schema: duplicate codes, dangling parents, cycles. */
export function checkManifest(manifest: FrameworkManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const codes = new Set<string>();
  for (const r of manifest.requirements) {
    if (codes.has(r.code)) issues.push({ level: 'error', code: 'duplicate_code', message: `Requirement code ${r.code} appears more than once`, requirement: r.code });
    codes.add(r.code);
  }
  for (const r of manifest.requirements) {
    if (r.parent && !codes.has(r.parent)) issues.push({ level: 'error', code: 'unknown_parent', message: `${r.code} references unknown parent ${r.parent}`, requirement: r.code });
    if (r.parent === r.code) issues.push({ level: 'error', code: 'self_parent', message: `${r.code} is its own parent`, requirement: r.code });
  }
  if (!manifest.sourceUrl) issues.push({ level: 'warning', code: 'no_source', message: 'No source URL recorded; provenance will be incomplete.' });
  if (!manifest.licenseNotes) issues.push({ level: 'warning', code: 'no_license_notes', message: 'No license notes; confirm you may store this content.' });
  if (manifest.isIllustrative) issues.push({ level: 'warning', code: 'illustrative', message: 'Framework is marked illustrative and will be labelled as such.' });
  return issues;
}
