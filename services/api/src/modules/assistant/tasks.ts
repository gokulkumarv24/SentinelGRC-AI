import { z } from 'zod';
import { notFound } from '../../common/errors.js';
import type { Permission } from '../../permissions/catalog.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { RULES_BY_KEY } from '../control-tests/rules.js';
import type { StorageService } from '../evidence/storage.js';
import type { ReportsService } from '../reports/reports.service.js';
import { meetsCriterion } from '../vendors/vendor-scoring.js';
import { extractEvidenceText, sentences } from './source-text.js';

export const ARTIFACT_TYPES = [
  'evidence_summary',
  'evidence_statements',
  'vendor_observations',
  'finding_draft',
  'remediation_options',
  'risk_summary',
  'report_draft',
  'mapping_suggestions',
  'control_failure_explanation',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const sourceRef = z.object({ sourceId: z.string().max(20), locator: z.string().max(200).optional() });
/** Strict output schema shared by every task (spec §11.2 "strict request/response schemas"). */
export const draftOutput = z.object({
  summary: z.string().max(4000),
  points: z.array(z.object({ text: z.string().max(2000), sourceRefs: z.array(sourceRef).max(10) })).max(30),
  suggestions: z.array(z.object({ label: z.string().max(200), value: z.string().max(500), rationale: z.string().max(2000), sourceRefs: z.array(sourceRef).max(10).default([]) })).max(20).default([]),
  limitations: z.array(z.string().max(1000)).max(20).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type DraftOutput = z.infer<typeof draftOutput>;

export interface Source {
  /** Short reference the model must cite, e.g. "S1". */
  ref: string;
  type: string;
  recordId: string;
  label: string;
  /** Checksum or version of the record used, for traceability. */
  version: string;
  /** Evidence classification, when the source is a file. */
  classification?: string;
  segments: Array<{ locator: string; text: string }>;
}

export interface Prepared {
  target: { type: string; id: string; label: string };
  sources: Source[];
  limitations: string[];
  /** Allowed suggestion values (e.g. candidate control ids); output outside this set is rejected. */
  candidates?: Array<{ id: string; label: string }>;
  allowedValues?: Record<string, string[]>;
}

export interface TaskDeps {
  prisma: PrismaService;
  storage: StorageService;
  reports: ReportsService;
  organizationId: string;
}

export interface TaskDef {
  type: ArtifactType;
  title: string;
  targetType: string;
  permissions: Permission[];
  instructions: string;
  load(deps: TaskDeps, targetId: string, options: { controlId?: string }): Promise<Prepared>;
  /** Deterministic, extractive output used by the mock provider and as the non-AI fallback. */
  mock(p: Prepared): DraftOutput;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const KEYWORDS = /\b(shall|must|required|enforced|enabled|encrypt\w*|review\w*|approv\w*|policy|backup\w*|access|mfa|multi-factor|log(ged|ging)?|monitor\w*|retain\w*|test(ed|ing)?|annual\w*|quarterl\w*)\b/i;

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

async function evidenceSource(deps: TaskDeps, evidenceId: string): Promise<{ source: Source; limitations: string[]; title: string }> {
  const e = await deps.prisma.evidence.findFirst({ where: { id: evidenceId, organizationId: deps.organizationId } });
  if (!e) throw notFound('Evidence');
  const limitations: string[] = [];
  let segments: Source['segments'] = [];
  if (!e.storageKey) limitations.push('This evidence record has no file; only its metadata was used.');
  else {
    const obj = await deps.storage.adapter.get(e.storageKey);
    const chunks: Buffer[] = [];
    for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
    const extracted = await extractEvidenceText(Buffer.concat(chunks), e.mediaType);
    segments = extracted.segments;
    if (extracted.limitation) limitations.push(extracted.limitation);
  }
  segments.unshift({ locator: 'metadata', text: `Title: ${e.title}. ${e.description ?? ''}`.trim() });
  return { source: { ref: 'S1', type: 'evidence', recordId: e.id, label: e.title, version: e.sha256Checksum ?? e.updatedAt.toISOString(), classification: e.classification, segments }, limitations, title: e.title };
}

const empty = (summary: string, limitations: string[]): DraftOutput => ({ summary, points: [], suggestions: [], limitations, confidence: 'low' });

export const TASKS: TaskDef[] = [
  {
    type: 'evidence_summary',
    title: 'Evidence summary',
    targetType: 'evidence',
    permissions: ['evidence.read'],
    instructions: 'Summarize what the evidence document shows. Cite the page or section locator for every point. Do not infer facts the document does not state.',
    async load(deps, id) {
      const { source, limitations, title } = await evidenceSource(deps, id);
      return { target: { type: 'evidence', id, label: title }, sources: [source], limitations };
    },
    mock(p) {
      const s = p.sources[0];
      const body = s.segments.filter((x) => x.locator !== 'metadata');
      if (!body.length) return empty(`No document text was available for "${s.label}".`, p.limitations);
      const points = body.flatMap((seg) => sentences(seg.text).slice(0, 1).map((t) => ({ text: t, sourceRefs: [{ sourceId: s.ref, locator: seg.locator }] }))).slice(0, 8);
      const first = sentences(body[0].text).slice(0, 2).join(' ') || body[0].text.slice(0, 300);
      return { summary: `Extractive summary of "${s.label}" (${body.length} section(s)): ${first}`, points, suggestions: [], limitations: [...p.limitations, 'Extractive summary produced without a language model; it repeats document sentences and does not interpret them.'], confidence: 'low' };
    },
  },
  {
    type: 'evidence_statements',
    title: 'Candidate evidence statements',
    targetType: 'evidence',
    permissions: ['evidence.read'],
    instructions: 'Extract candidate statements from the document that could support control effectiveness (policies, configurations, review records). Quote or closely paraphrase, and give the page/section locator for each. Flag statements that only describe intent rather than operation.',
    async load(deps, id, { controlId }) {
      const { source, limitations, title } = await evidenceSource(deps, id);
      const sources = [source];
      if (controlId) {
        const c = await deps.prisma.control.findFirst({ where: { id: controlId, organizationId: deps.organizationId } });
        if (!c) throw notFound('Control');
        sources.push({ ref: 'S2', type: 'control', recordId: c.id, label: `${c.controlCode} ${c.title}`, version: String(c.version), segments: [{ locator: 'control', text: `${c.title}. ${c.description}` }] });
      }
      return { target: { type: 'evidence', id, label: title }, sources, limitations };
    },
    mock(p) {
      const s = p.sources[0];
      const control = p.sources.find((x) => x.type === 'control');
      const focus = control ? words(control.segments[0].text) : null;
      const points = s.segments
        .filter((seg) => seg.locator !== 'metadata')
        .flatMap((seg) => sentences(seg.text).map((t) => ({ t, seg })))
        .filter(({ t }) => KEYWORDS.test(t) && (!focus || [...words(t)].some((w) => focus.has(w))))
        .slice(0, 12)
        .map(({ t, seg }) => ({ text: `"${t}"`, sourceRefs: [{ sourceId: s.ref, locator: seg.locator }] }));
      return {
        summary: points.length ? `${points.length} candidate statement(s) found by keyword matching${control ? ` related to ${control.label}` : ''}.` : 'No candidate statements were found.',
        points,
        suggestions: [],
        limitations: [...p.limitations, 'Statements were selected by keyword matching without a language model; a reviewer must confirm each one actually evidences the control operating.'],
        confidence: 'low',
      };
    },
  },
  {
    type: 'vendor_observations',
    title: 'Vendor answer observations',
    targetType: 'vendor_assessment',
    permissions: ['vendor_assessment.read'],
    instructions: 'Compare each vendor answer with the question’s expected criterion and draft observations for answers that do not meet it, lack required evidence, or are unanswered. Do not change scores; the deterministic scoring is authoritative.',
    async load(deps, id) {
      const a = await deps.prisma.vendorAssessment.findFirst({ where: { id, organizationId: deps.organizationId }, include: { vendor: { select: { name: true } } } });
      if (!a) throw notFound('Vendor assessment');
      const responses = await deps.prisma.questionResponse.findMany({ where: { organizationId: deps.organizationId, assessmentId: id }, include: { questionRef: true } });
      responses.sort((x, y) => x.questionRef.sortOrder - y.questionRef.sortOrder);
      const sources: Source[] = responses.map((r, i) => ({
        ref: `S${i + 1}`,
        type: 'question_response',
        recordId: r.id,
        label: r.questionRef.questionKey,
        version: r.answeredAt?.toISOString() ?? 'unanswered',
        segments: [{
          locator: r.questionRef.questionKey,
          text: JSON.stringify({
            question: r.questionRef.questionText,
            category: r.questionRef.category,
            expected: r.questionRef.expectedAnswer,
            evidenceRequired: r.questionRef.evidenceRequired,
            answer: r.notApplicable ? 'N/A' : r.answer,
            naRationale: r.naRationale,
            evidenceAttached: !!r.evidenceId,
            reviewerStatus: r.reviewerStatus,
          }),
        }],
      }));
      return { target: { type: 'vendor_assessment', id, label: `${a.vendor.name} v${a.assessmentVersion}` }, sources, limitations: responses.length ? [] : ['The assessment has no responses yet.'] };
    },
    mock(p) {
      const points = p.sources.flatMap((s) => {
        const d = JSON.parse(s.segments[0].text) as { question: string; expected: unknown; evidenceRequired: boolean; answer: unknown; naRationale: string | null; evidenceAttached: boolean };
        const ref = [{ sourceId: s.ref, locator: s.label }];
        if (d.answer === 'N/A') return d.naRationale ? [] : [{ text: `${s.label}: marked not applicable without a rationale.`, sourceRefs: ref }];
        if (d.answer === null || d.answer === undefined || d.answer === '') return [{ text: `${s.label}: unanswered — "${d.question}"`, sourceRefs: ref }];
        const met = meetsCriterion(d.answer, d.expected as Parameters<typeof meetsCriterion>[1]);
        const out = [];
        if (met === false) out.push({ text: `${s.label}: the answer ${JSON.stringify(d.answer)} does not meet the expected criterion for "${d.question}".`, sourceRefs: ref });
        if (d.evidenceRequired && !d.evidenceAttached) out.push({ text: `${s.label}: supporting evidence is required but none is attached.`, sourceRefs: ref });
        return out;
      });
      return {
        summary: points.length ? `${points.length} observation(s) on ${p.target.label}.` : `No gaps were detected against the expected criteria for ${p.target.label}.`,
        points,
        suggestions: [],
        limitations: ['Observations restate the deterministic criteria checks; they do not assess answer quality or evidence content.'],
        confidence: 'medium',
      };
    },
  },
  {
    type: 'finding_draft',
    title: 'Finding category and severity rationale',
    targetType: 'finding',
    permissions: ['finding.read'],
    instructions: 'Suggest a finding category and draft a severity rationale based only on the finding and its source records. Suggestions are advisory; a person decides.',
    async load(deps, id) {
      return findingSources(deps, id);
    },
    mock(p) {
      const f = JSON.parse(p.sources[0].segments[0].text) as { title: string; description: string; severity: string; sourceType: string };
      const text = `${f.title} ${f.description}`.toLowerCase();
      const category = Object.entries(CATEGORY_HINTS).find(([, re]) => re.test(text))?.[0] ?? 'general';
      return {
        summary: `Suggested category "${category}"; current severity ${f.severity} kept pending review.`,
        points: [{ text: `Finding source: ${f.sourceType.replace(/_/g, ' ')}.`, sourceRefs: [{ sourceId: 'S1' }] }],
        suggestions: [
          { label: 'category', value: category, rationale: 'Matched keywords in the finding title and description.', sourceRefs: [{ sourceId: 'S1' }] },
          { label: 'severity', value: f.severity, rationale: `The current severity (${f.severity}) was set by ${f.sourceType === 'control_test' ? 'the deterministic control rule' : 'the finding creator'}; no new facts justify changing it.`, sourceRefs: [{ sourceId: 'S1' }] },
        ],
        limitations: ['Keyword-based suggestion produced without a language model.'],
        confidence: 'low',
      };
    },
  },
  {
    type: 'remediation_options',
    title: 'Remediation options',
    targetType: 'finding',
    permissions: ['finding.read'],
    instructions: 'Draft 2–4 practical remediation options for the finding, each with trade-offs. Do not claim any option has been completed.',
    async load(deps, id) {
      return findingSources(deps, id);
    },
    mock(p) {
      const f = JSON.parse(p.sources[0].segments[0].text) as { title: string; description: string };
      const text = `${f.title} ${f.description}`.toLowerCase();
      const category = Object.entries(CATEGORY_HINTS).find(([, re]) => re.test(text))?.[0] ?? 'general';
      const options = REMEDIATION_LIBRARY[category] ?? REMEDIATION_LIBRARY.general;
      return {
        summary: `${options.length} generic option(s) for a ${category} finding.`,
        points: [],
        suggestions: options.map((o, i) => ({ label: `Option ${i + 1}`, value: o[0], rationale: o[1], sourceRefs: [{ sourceId: 'S1' }] })),
        limitations: ['Options come from a generic library matched by keywords, not tailored analysis.'],
        confidence: 'low',
      };
    },
  },
  {
    type: 'risk_summary',
    title: 'Risk history summary',
    targetType: 'risk',
    permissions: ['risk.read'],
    instructions: 'Summarize the risk’s current state and how it changed over time, citing history entries.',
    async load(deps, id) {
      const r = await deps.prisma.risk.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!r) throw notFound('Risk');
      const history = await deps.prisma.riskHistory.findMany({ where: { organizationId: deps.organizationId, riskId: id }, orderBy: { changedAt: 'asc' }, take: 50 });
      return {
        target: { type: 'risk', id, label: r.riskKey },
        sources: [
          { ref: 'S1', type: 'risk', recordId: r.id, label: r.riskKey, version: String(r.version), segments: [{ locator: 'current', text: JSON.stringify({ title: r.title, status: r.status, inherent: `${r.inherentScore} ${r.inherentRating}`, residual: r.residualScore ? `${r.residualScore} ${r.residualRating}` : null, treatment: r.treatment, residualRationale: r.residualRationale }) }] },
          { ref: 'S2', type: 'risk_history', recordId: r.id, label: `${r.riskKey} history`, version: String(history.length), segments: history.map((h) => ({ locator: h.changedAt.toISOString().slice(0, 10), text: JSON.stringify({ before: h.previousValues, after: h.newValues, rationale: h.rationale }) })) },
        ],
        limitations: history.length >= 50 ? ['Only the first 50 history entries were used.'] : [],
      };
    },
    mock(p) {
      const cur = JSON.parse(p.sources[0].segments[0].text) as { title: string; status: string; inherent: string; residual: string | null; treatment: string };
      const hist = p.sources[1].segments;
      return {
        summary: `${p.target.label} "${cur.title}" is ${cur.status}, inherent ${cur.inherent}, residual ${cur.residual ?? 'not assessed'}, treatment ${cur.treatment}. ${hist.length} recorded change(s).`,
        points: hist.slice(-10).map((h) => {
          const d = JSON.parse(h.text) as { after: Record<string, unknown>; rationale: string | null };
          return { text: `${h.locator}: changed ${Object.keys(d.after ?? {}).join(', ') || 'record'}${d.rationale ? ` — ${d.rationale}` : ''}.`, sourceRefs: [{ sourceId: 'S2', locator: h.locator }] };
        }),
        suggestions: [],
        limitations: ['Chronological listing produced without a language model.'],
        confidence: 'medium',
      };
    },
  },
  {
    type: 'report_draft',
    title: 'Management report narrative',
    targetType: 'report_run',
    permissions: ['report.read'],
    instructions: 'Draft a short management narrative for the report using only the verified metrics and section summaries provided. Every number you state must appear in the sources.',
    async load(deps, id) {
      const { run, model } = await deps.reports.buildModel(id);
      return {
        target: { type: 'report_run', id, label: run.title },
        sources: [
          { ref: 'S1', type: 'report_metrics', recordId: run.id, label: `${run.title} metrics`, version: (run.generatedAt ?? run.createdAt).toISOString(), segments: model.metrics.map((m) => ({ locator: m.label, text: `${m.label}: ${String(m.value)} (${m.definition})` })) },
          { ref: 'S2', type: 'report_sections', recordId: run.id, label: `${run.title} sections`, version: (run.generatedAt ?? run.createdAt).toISOString(), segments: model.sections.map((s) => ({ locator: s.heading, text: `${s.heading}: ${s.rows.length} row(s)${s.description ? `. ${s.description}` : ''}` })) },
        ],
        limitations: ['The narrative is based on data regenerated now, which may differ from the stored report file if records changed since it was generated.'],
      };
    },
    mock(p) {
      const metrics = p.sources[0].segments;
      return {
        summary: `${p.target.label}: ${metrics.map((m) => m.text.split(' (')[0]).join('; ')}.`,
        points: metrics.map((m) => ({ text: m.text, sourceRefs: [{ sourceId: 'S1', locator: m.locator }] })),
        suggestions: [],
        limitations: [...p.limitations, 'Narrative assembled from the report metrics without a language model.'],
        confidence: 'high',
      };
    },
  },
  {
    type: 'mapping_suggestions',
    title: 'Candidate control mappings',
    targetType: 'framework_requirement',
    permissions: ['mapping.read', 'control.read'],
    instructions: 'Suggest up to 5 existing controls (by id from the candidate list only) that may support the requirement, each with a rationale and a proposed mapping type. Mapping is a reviewable assertion, never equivalence.',
    async load(deps, id) {
      const req = await deps.prisma.frameworkRequirement.findFirst({ where: { id, framework: { OR: [{ organizationId: null }, { organizationId: deps.organizationId }] } }, include: { framework: { select: { name: true, version: true } } } });
      if (!req) throw notFound('Requirement');
      const controls = await deps.prisma.control.findMany({ where: { organizationId: deps.organizationId, active: true }, orderBy: { controlCode: 'asc' }, take: 200 });
      return {
        target: { type: 'framework_requirement', id, label: `${req.framework.name} ${req.requirementCode}` },
        sources: [
          { ref: 'S1', type: 'framework_requirement', recordId: req.id, label: `${req.framework.name} ${req.framework.version} ${req.requirementCode}`, version: req.sourceVersion, segments: [{ locator: req.requirementCode, text: `${req.title}. ${req.summary ?? ''}` }] },
          { ref: 'S2', type: 'controls', recordId: deps.organizationId, label: 'Organization controls', version: String(controls.length), segments: controls.map((c) => ({ locator: c.id, text: `${c.controlCode} ${c.title}: ${c.description}` })) },
        ],
        candidates: controls.map((c) => ({ id: c.id, label: `${c.controlCode} ${c.title}` })),
        limitations: controls.length >= 200 ? ['Only the first 200 controls were considered.'] : [],
      };
    },
    mock(p) {
      const req = words(p.sources[0].segments[0].text);
      const scored = p.sources[1].segments
        .map((s) => ({ id: s.locator, text: s.text, score: [...words(s.text)].filter((w) => req.has(w)).length }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return {
        summary: scored.length ? `${scored.length} candidate control(s) share terms with the requirement.` : 'No existing control shares terms with this requirement.',
        points: [],
        suggestions: scored.map((s) => ({ label: s.text.split(':')[0], value: s.id, rationale: `Shares ${s.score} term(s) with the requirement text. Proposed type: related (requires review).`, sourceRefs: [{ sourceId: 'S1' }, { sourceId: 'S2', locator: s.id }] })),
        limitations: [...p.limitations, 'Term-overlap matching only; every suggestion must be reviewed and mapped through the normal review queue.'],
        confidence: 'low',
      };
    },
  },
  {
    type: 'control_failure_explanation',
    title: 'Control check explanation',
    targetType: 'control_test',
    permissions: ['control_test.read'],
    instructions: 'Explain in plain language why the control check produced its result, using only the recorded rule description, summary and details.',
    async load(deps, id) {
      const t = await deps.prisma.controlTest.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!t) throw notFound('Control test');
      const c = await deps.prisma.control.findFirst({ where: { id: t.controlId, organizationId: deps.organizationId }, select: { controlCode: true, title: true } });
      const rule = t.ruleKey ? RULES_BY_KEY.get(t.ruleKey) : undefined;
      return {
        target: { type: 'control_test', id, label: `${c?.controlCode ?? 'Control'} test ${t.startedAt.toISOString().slice(0, 10)}` },
        sources: [{
          ref: 'S1', type: 'control_test', recordId: t.id, label: `${c?.controlCode} ${t.ruleKey ?? 'manual'} ${t.result}`, version: t.testRuleVersion ?? 'manual',
          segments: [
            { locator: 'rule', text: rule ? `${rule.name}: ${rule.description}` : t.testType === 'manual' ? `Manual test. Rationale: ${t.manualRationale ?? ''}` : `Rule ${t.ruleKey} (no description available)` },
            { locator: 'result', text: `Result: ${t.result}. ${t.summary}` },
            { locator: 'details', text: JSON.stringify(t.details) },
          ],
        }],
        limitations: [],
      };
    },
    mock(p) {
      const seg = (l: string) => p.sources[0].segments.find((s) => s.locator === l)?.text ?? '';
      return {
        summary: `${seg('result')} The check works as follows — ${seg('rule')}`,
        points: [
          { text: seg('result'), sourceRefs: [{ sourceId: 'S1', locator: 'result' }] },
          { text: `Recorded details: ${seg('details').slice(0, 600)}`, sourceRefs: [{ sourceId: 'S1', locator: 'details' }] },
        ],
        suggestions: [],
        limitations: ['Restates the recorded rule output without a language model.'],
        confidence: 'high',
      };
    },
  },
];

export const TASKS_BY_TYPE = new Map(TASKS.map((t) => [t.type, t]));

/** Rejects citations to sources that were not supplied and suggestions outside the allowed values (no invented references). */
export function checkGrounding(out: DraftOutput, p: Prepared): string[] {
  const refs = new Set(p.sources.map((s) => s.ref));
  const errors: string[] = [];
  for (const r of [...out.points.flatMap((x) => x.sourceRefs), ...out.suggestions.flatMap((x) => x.sourceRefs)]) {
    if (!refs.has(r.sourceId)) errors.push(`Cites unknown source "${r.sourceId}"`);
  }
  if (p.candidates) {
    const ids = new Set(p.candidates.map((c) => c.id));
    for (const s of out.suggestions) if (!ids.has(s.value)) errors.push(`Suggests "${s.value}", which is not an existing control`);
  }
  for (const [label, values] of Object.entries(p.allowedValues ?? {})) {
    for (const s of out.suggestions.filter((x) => x.label === label)) if (!values.includes(s.value)) errors.push(`Invalid ${label} "${s.value}"`);
  }
  return [...new Set(errors)].slice(0, 20);
}

const CATEGORY_HINTS: Record<string, RegExp> = {
  access_control: /\b(access|privileged|mfa|multi-factor|password|account|permission)/,
  encryption: /\b(encrypt|tls|cipher|key management)/,
  vulnerability_management: /\b(vulnerab|patch|cve|scan)/,
  evidence: /\b(evidence|expired|document)/,
  third_party: /\b(vendor|supplier|third[- ]party|questionnaire)/,
  ai_governance: /\b(ai |model|llm|machine learning)/,
  logging_monitoring: /\b(log|monitor|alert|siem)/,
  business_continuity: /\b(backup|recovery|continuity|disaster)/,
};

const REMEDIATION_LIBRARY: Record<string, Array<[string, string]>> = {
  access_control: [['Enforce MFA and remove standing privileged access', 'Strongest reduction; may need break-glass procedures and user communication.'], ['Run an immediate access review and revoke unneeded accounts', 'Fast; needs owners to attest and repeat on a schedule.'], ['Introduce just-in-time elevation', 'Durable; requires tooling and process change.']],
  encryption: [['Enable encryption at rest and in transit for the affected systems', 'Direct fix; check performance and key management.'], ['Document a compensating control with an expiry', 'Quick; residual risk must be accepted formally.']],
  vulnerability_management: [['Patch or upgrade the affected components', 'Removes the issue; schedule a maintenance window.'], ['Apply a configuration mitigation until patching', 'Temporary; track as an exception with a due date.']],
  evidence: [['Collect and upload current evidence, then request review', 'Restores the check; assign an evidence owner and expiry reminder.'], ['Automate evidence collection through an integration', 'Prevents recurrence; requires a configured connector.']],
  third_party: [['Request a remediation plan and evidence from the vendor', 'Keeps the relationship; track vendor response separately from internal review.'], ['Add contractual requirements at renewal', 'Durable; depends on renewal timing.'], ['Limit the data or access shared with the vendor', 'Reduces exposure; may affect the service.']],
  ai_governance: [['Complete the outstanding AI assessment items with evidence', 'Required before approval; involve the risk owner.'], ['Add human review of outputs until evaluations are complete', 'Reduces impact; adds operational effort.']],
  logging_monitoring: [['Enable centralized logging and alerting for the system', 'Improves detection; consider log volume and retention.'], ['Define an alert response runbook', 'Low cost; complements technical logging.']],
  business_continuity: [['Run and document a restore test', 'Proves recoverability; schedule periodically.'], ['Set backup monitoring and alerts for failures', 'Catches silent failures early.']],
  general: [['Assign an owner and agree a remediation plan with a due date', 'Establishes accountability.'], ['Assess whether a compensating control reduces the risk', 'May allow temporary acceptance with rationale.']],
};

async function findingSources(deps: TaskDeps, id: string): Promise<Prepared> {
  const f = await deps.prisma.finding.findFirst({ where: { id, organizationId: deps.organizationId } });
  if (!f) throw notFound('Finding');
  const sources: Source[] = [{ ref: 'S1', type: 'finding', recordId: f.id, label: f.findingKey, version: String(f.version), segments: [{ locator: 'finding', text: JSON.stringify({ title: f.title, description: f.description, severity: f.severity, severityRationale: f.severityRationale, sourceType: f.sourceType, category: f.category }) }] }];
  if (f.controlId) {
    const test = await deps.prisma.controlTest.findFirst({ where: { organizationId: deps.organizationId, controlId: f.controlId, findingId: f.id }, orderBy: { startedAt: 'desc' } });
    if (test) sources.push({ ref: 'S2', type: 'control_test', recordId: test.id, label: `latest test ${test.result}`, version: test.testRuleVersion ?? 'manual', segments: [{ locator: 'result', text: `${test.result}: ${test.summary}` }] });
  }
  return { target: { type: 'finding', id, label: f.findingKey }, sources, limitations: [], allowedValues: { severity: SEVERITIES } };
}
