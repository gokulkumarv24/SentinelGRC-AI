// Idempotent schema post-processor (run after editing prisma/schema.prisma):
//  1. adds @map("snake_case") to camelCase scalar columns,
//  2. adds organization foreign keys to every tenant-scoped model,
//  3. adds the user / entity foreign keys listed in FOREIGN_KEYS,
//  4. writes the matching back-relation fields.
// Usage: node scripts/add-column-maps.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMA = new URL('../prisma/schema.prisma', import.meta.url);

// [model, field, targetModel] — relations that must exist as real foreign keys (spec §5.2).
const FOREIGN_KEYS = [
  ['ControlImplementation', 'ownerId', 'User'],
  ['ControlMapping', 'sourceRequirementId', 'FrameworkRequirement'],
  ['ControlMapping', 'targetRequirementId', 'FrameworkRequirement'],
  ['ControlTest', 'initiatedBy', 'User'],
  ['Evidence', 'ownerId', 'User'],
  ['Evidence', 'uploadedBy', 'User'],
  ['Risk', 'riskOwnerId', 'User'],
  ['RiskControl', 'controlId', 'Control'],
  ['RiskAcceptance', 'requestedBy', 'User'],
  ['RiskAcceptance', 'decidedBy', 'User'],
  ['Finding', 'assignedTo', 'User'],
  ['Finding', 'controlId', 'Control'],
  ['Finding', 'riskId', 'Risk'],
  ['RemediationTask', 'ownerId', 'User'],
  ['Vendor', 'businessOwnerId', 'User'],
  ['VendorAssessment', 'templateId', 'AssessmentTemplate'],
  ['VendorAssessment', 'assessorId', 'User'],
  ['QuestionResponse', 'questionId', 'AssessmentQuestion'],
  ['VendorPortalInvitation', 'assessmentId', 'VendorAssessment'],
  ['AiSystem', 'businessOwnerId', 'User'],
  ['AiSystem', 'technicalOwnerId', 'User'],
  ['AiSystem', 'riskOwnerId', 'User'],
  ['AiSystem', 'providerVendorId', 'Vendor'],
  ['AiAssessment', 'frameworkId', 'Framework'],
  ['AiAssessment', 'approvedBy', 'User'],
  ['Notification', 'recipientUserId', 'User'],
  ['AuditEvent', 'actorUserId', 'User'],
  ['Invitation', 'inviterId', 'User'],
  ['IntegrationRecord', 'integrationId', 'Integration'],
];

const SCALARS = new Set(['String', 'Int', 'BigInt', 'Boolean', 'DateTime', 'Json', 'Float', 'Decimal', 'Bytes']);
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1);

let text = readFileSync(SCHEMA, 'utf8');
const enums = new Set([...text.matchAll(/^enum (\w+)/gm)].map((m) => m[1]));
const modelRe = /^model (\w+) \{\n([\s\S]*?)^\}/gm;
const models = new Map([...text.matchAll(modelRe)].map((m) => [m[1], m[2]]));
const backRelations = new Map(); // targetModel -> lines to add

function hasField(body, name) {
  return new RegExp(`^\\s+${name}\\s`, 'm').test(body);
}

const out = text.replace(modelRe, (_all, name, body) => {
  let lines = body.split('\n');

  // 1. column maps
  lines = lines.map((line) => {
    const m = line.match(/^(\s+)(\w+)(\s+)(\w+)(\[\]|\?)?(.*)$/);
    if (!m || line.trim().startsWith('//') || line.trim().startsWith('@@')) return line;
    const [, , field, , type] = m;
    if (!(SCALARS.has(type) || enums.has(type))) return line;
    if (line.includes('@map(') || snake(field) === field) return line;
    const commentIdx = line.indexOf(' //');
    const code = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    const comment = commentIdx >= 0 ? line.slice(commentIdx) : '';
    return `${code.trimEnd()} @map("${snake(field)}")${comment}`;
  });

  const extra = [];
  // 2. organization FK
  const orgField = lines.find((l) => /^\s+organizationId\s+String(\?)?\s/.test(l));
  if (name !== 'Membership' && name !== 'Invitation' && orgField && !hasField(body, 'organization')) {
    const optional = /String\?/.test(orgField) ? '?' : '';
    extra.push(`  organization Organization${optional} @relation(fields: [organizationId], references: [id], onDelete: Restrict)`);
    const back = backRelations.get('Organization') ?? [];
    back.push(`  ${lowerFirst(name)}Rows ${name}[]`);
    backRelations.set('Organization', back);
  }

  // 3. listed FKs
  for (const [model, field, target] of FOREIGN_KEYS) {
    if (model !== name) continue;
    const relField = field.replace(/Id$/, '') + 'Ref';
    if (hasField(body, relField)) continue;
    const fieldLine = lines.find((l) => new RegExp(`^\\s+${field}\\s`).test(l));
    if (!fieldLine) throw new Error(`${model}.${field} not found`);
    const optional = /String\?/.test(fieldLine) ? '?' : '';
    const relName = `${model}_${field}`;
    extra.push(`  ${relField} ${target}${optional} @relation("${relName}", fields: [${field}], references: [id], onDelete: Restrict)`);
    const back = backRelations.get(target) ?? [];
    back.push(`  ${lowerFirst(model)}_${field} ${model}[] @relation("${relName}")`);
    backRelations.set(target, back);
  }

  if (extra.length) {
    const attrIdx = lines.findIndex((l) => l.trim().startsWith('@@'));
    const insertAt = attrIdx >= 0 ? attrIdx : lines.length - 1;
    lines.splice(insertAt, 0, '  // generated relations (scripts/add-column-maps.mjs)', ...extra, '');
  }
  return `model ${name} {\n${lines.join('\n')}}`;
});

// 4. back relations
const final = out.replace(modelRe, (all, name, body) => {
  const back = (backRelations.get(name) ?? []).filter((l) => !hasField(body, l.trim().split(/\s+/)[0]));
  if (!back.length) return all;
  const lines = body.split('\n');
  const attrIdx = lines.findIndex((l) => l.trim().startsWith('@@'));
  const insertAt = attrIdx >= 0 ? attrIdx : lines.length - 1;
  lines.splice(insertAt, 0, '  // generated back-relations', ...back, '');
  return `model ${name} {\n${lines.join('\n')}}`;
});

writeFileSync(SCHEMA, final);
console.log(`processed ${models.size} models`);
