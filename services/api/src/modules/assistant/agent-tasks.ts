import { notFound } from '../../common/errors.js';
import { visibleQuestions } from '../vendors/questionnaire.js';
import { inherentVendorRisk, meetsCriterion, scoreAssessment, type Criterion, type ScoredQuestion } from '../vendors/vendor-scoring.js';
import {
  CATEGORY_HINTS,
  empty,
  evidenceSource,
  KEYWORDS,
  REMEDIATION_LIBRARY,
  SEVERITIES,
  TASKS,
  words,
  type ArtifactType,
  type DraftOutput,
  type Source,
  type TaskDef,
  type TaskDeps,
} from './tasks.js';
import { sentences } from './source-text.js';

/**
 * Tasks used by the AI agent (and on demand from the UI). Like the core tasks they only produce drafts:
 * every structured suggestion is validated against allowed values, and a person applies it.
 * The `mock` implementations are deterministic rules, so the agent still does useful work without a model.
 */

const DAY = 86_400_000;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const daysUntil = (d: Date, now = new Date()) => Math.ceil((d.getTime() - now.getTime()) / DAY);
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
const parse = <T>(s: Source, locator?: string) => JSON.parse((locator ? s.segments.find((x) => x.locator === locator) : s.segments[0])?.text ?? '{}') as T;
const ref = (sourceId: string, locator?: string) => [{ sourceId, ...(locator ? { locator } : {}) }];
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'your', 'does', 'what', 'which', 'when', 'there', 'their', 'shall', 'will', 'been', 'into', 'about', 'they', 'were', 'only', 'also', 'such', 'than', 'then', 'them', 'each', 'other', 'more', 'most', 'some', 'these', 'those', 'should', 'would', 'could', 'company', 'organization', 'please', 'describe', 'provide']);
const terms = (s: string) => new Set([...words(s)].filter((w) => !STOP.has(w)));

/** Validates the JSON-encoded suggestion values some tasks use for multi-field proposals. */
function jsonValues(out: DraftOutput, label: string, check: (v: Record<string, unknown>) => string | null): string[] {
  const errors: string[] = [];
  for (const s of out.suggestions.filter((x) => x.label === label)) {
    try {
      const err = check(JSON.parse(s.value) as Record<string, unknown>);
      if (err) errors.push(`${label}: ${err}`);
    } catch {
      errors.push(`${label}: value is not valid JSON`);
    }
  }
  return errors;
}
const score15 = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;

async function activeMembers(deps: TaskDeps) {
  const rows = await deps.prisma.membership.findMany({
    where: { organizationId: deps.organizationId, status: 'active' },
    include: { user: { select: { id: true, displayName: true } }, roles: { include: { role: { select: { key: true } } } } },
    take: 200,
  });
  return rows.map((m) => ({ id: m.user.id, name: m.user.displayName, roles: m.roles.map((r) => r.role.key) }));
}

async function linkedControls(deps: TaskDeps, evidenceId: string) {
  const links = await deps.prisma.evidenceLink.findMany({ where: { organizationId: deps.organizationId, evidenceId, entityType: 'control' } });
  if (!links.length) return [];
  return deps.prisma.control.findMany({ where: { id: { in: links.map((l) => l.entityId) }, organizationId: deps.organizationId }, include: { implementations: { where: { organizationId: deps.organizationId }, take: 1 } } });
}

function evidenceFacts(e: { title: string; validFrom: Date | null; expiresAt: Date | null; collectedAt: Date | null; classification: string; reviewStatus: string; mediaType: string | null; scanStatus: string; sourceUri: string | null; description: string | null }) {
  return { title: e.title, description: e.description, validFrom: day(e.validFrom), expiresAt: day(e.expiresAt), collectedAt: day(e.collectedAt), classification: e.classification, reviewStatus: e.reviewStatus, mediaType: e.mediaType, scanStatus: e.scanStatus, fromVendorPortal: !!e.sourceUri?.startsWith('vendor-portal:') };
}

async function vendorAssessmentState(deps: TaskDeps, id: string) {
  const a = await deps.prisma.vendorAssessment.findFirst({
    where: { id, organizationId: deps.organizationId },
    include: { vendor: true, templateRef: { include: { questions: { orderBy: { sortOrder: 'asc' } } } }, responses: true },
  });
  if (!a) throw notFound('Vendor assessment');
  const answers = new Map(a.responses.map((r) => [r.questionId, r.notApplicable ? undefined : r.answer]));
  const visible = visibleQuestions(a.templateRef.questions, answers);
  const evidenceIds = a.responses.map((r) => r.evidenceId).filter((x): x is string => !!x);
  const evidence = evidenceIds.length ? await deps.prisma.evidence.findMany({ where: { id: { in: evidenceIds }, organizationId: deps.organizationId }, select: { id: true, title: true, expiresAt: true, reviewStatus: true } }) : [];
  return { a, visible, evidence: new Map(evidence.map((e) => [e.id, e])) };
}

const VERDICTS = ['sufficient', 'needs_attention', 'insufficient'];
const DOC_TYPES = ['soc2_type2', 'soc2_type1', 'iso27001_certificate', 'penetration_test', 'contract_or_dpa', 'policy', 'other'];
const CLAUSES: Record<string, RegExp> = {
  breach_notification: /\b(notif\w*)\b[^.]{0,120}\b(breach|incident)|\b(breach|incident)\b[^.]{0,120}\bnotif\w*/i,
  audit_rights: /\b(right to audit|audit rights?|may audit|permit\w* .{0,40}audit)/i,
  subprocessors: /\bsub-?processors?\b/i,
  data_return_deletion: /\b(return|delet\w*|destroy\w*)\b[^.]{0,80}\b(data|personal data|customer data)/i,
  security_measures: /\b(technical and organi[sz]ational measures|security measures|encrypt\w*)/i,
  confidentiality: /\bconfidential\w*/i,
};
const REVIEW_STATUSES = ['accepted', 'insufficient', 'rejected'];
const DECISIONS = ['approved', 'approved_with_conditions', 'rejected'];
const LEVELS = ['low', 'medium', 'high', 'critical'];
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const ACCESS = ['none', 'limited', 'privileged', 'administrative'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const DUE_DAYS = ['7', '14', '30', '60', '90'];
const AI_TIERS = ['minimal', 'limited', 'high', 'unacceptable'];
const SHORT_ANSWERS = ['yes', 'no', 'partial', 'not_applicable', 'unknown'];
const CATEGORIES = [...Object.keys(CATEGORY_HINTS), 'general'];
const PRIORITY_BY_SEVERITY: Record<string, string> = { critical: 'urgent', high: 'high', medium: 'medium', low: 'low' };
const DUE_BY_SEVERITY: Record<string, string> = { critical: '7', high: '14', medium: '30', low: '90' };
const SENSITIVE_DATA = /\b(payment|card|health|medical|biometric|genetic|criminal|bank|financial|salary|passport|ssn|social security)\b/i;
const PRIVILEGED_HINT = /\b(admin\w*|privileged|root|superuser|production access|domain access|full access)\b/i;
const HIGH_RISK_AI = /\b(hiring|recruit\w*|cv|resume|candidate|credit|loan|insurance|medical|diagnos\w*|biometric|face|emotion|exam|grading|law enforcement|welfare|benefit)\b/i;

export const AGENT_TASKS: TaskDef[] = [
  // ── F1 Evidence pre-review ──
  {
    type: 'evidence_review',
    title: 'Evidence pre-review',
    targetType: 'evidence',
    permissions: ['evidence.read'],
    instructions:
      'Pre-review this evidence for the human reviewer. Check: is it the kind of document the linked controls need, does its content actually show the control operating (not just intent), is it current (dates, validity), and is anything missing. Give one suggestion with label "verdict" and value sufficient | needs_attention | insufficient. List each concern as a point with its source. You do not approve anything.',
    async load(deps, id) {
      const e = await deps.prisma.evidence.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!e) throw notFound('Evidence');
      const { source, limitations, title } = await evidenceSource(deps, id);
      const controls = await linkedControls(deps, id);
      const sources: Source[] = [
        source,
        { ref: 'S2', type: 'evidence_record', recordId: e.id, label: `${title} (record)`, version: e.updatedAt.toISOString(), segments: [{ locator: 'record', text: JSON.stringify(evidenceFacts(e)) }] },
        ...controls.map((c, i) => ({ ref: `S${i + 3}`, type: 'control', recordId: c.id, label: `${c.controlCode} ${c.title}`, version: String(c.version), segments: [{ locator: 'control', text: `${c.title}. ${c.description}` }] })),
      ];
      return { target: { type: 'evidence', id, label: title }, sources, limitations, allowedValues: { verdict: VERDICTS } };
    },
    mock(p) {
      const doc = p.sources[0];
      const facts = parse<ReturnType<typeof evidenceFacts>>(p.sources[1]);
      const controls = p.sources.filter((s) => s.type === 'control');
      const text = doc.segments.filter((s) => s.locator !== 'metadata').map((s) => s.text).join(' ');
      const docTerms = terms(`${facts.title} ${facts.description ?? ''} ${text}`);
      const points: DraftOutput['points'] = [];
      let verdict = 'sufficient';
      const raise = (v: string) => (verdict = VERDICTS.indexOf(v) > VERDICTS.indexOf(verdict) ? v : verdict);
      if (facts.expiresAt && new Date(facts.expiresAt) <= new Date()) {
        points.push({ text: `The evidence expired on ${facts.expiresAt}; controls relying on it will fail their checks.`, sourceRefs: ref('S2', 'record') });
        raise('insufficient');
      } else if (facts.expiresAt && daysUntil(new Date(facts.expiresAt)) <= 30) {
        points.push({ text: `The evidence expires on ${facts.expiresAt}, within 30 days; plan its replacement.`, sourceRefs: ref('S2', 'record') });
        raise('needs_attention');
      }
      if (!facts.expiresAt) points.push({ text: 'No expiry date is set, so the platform cannot warn when this evidence becomes stale.', sourceRefs: ref('S2', 'record') });
      if (!text.trim()) {
        points.push({ text: 'No readable document text was found; the reviewer must open the file to confirm its content.', sourceRefs: ref('S1') });
        raise('needs_attention');
      } else if (!KEYWORDS.test(text)) {
        points.push({ text: 'The document contains no operational language (e.g. reviewed, enabled, tested, approved); it may describe intent rather than a control operating.', sourceRefs: ref('S1') });
        raise('needs_attention');
      }
      if (!controls.length) {
        points.push({ text: 'The evidence is not linked to any control, so it does not support any control yet.', sourceRefs: ref('S2', 'record') });
        raise('needs_attention');
      }
      for (const c of controls) {
        const overlap = shared(terms(c.segments[0].text), docTerms);
        if (overlap < 2) {
          points.push({ text: `Little in common with ${c.label} (${overlap} shared term(s)); check it is the right evidence for this control.`, sourceRefs: [{ sourceId: c.ref, locator: 'control' }, { sourceId: 'S1' }] });
          raise('needs_attention');
        } else points.push({ text: `Relevant to ${c.label}: ${overlap} shared key terms.`, sourceRefs: [{ sourceId: c.ref, locator: 'control' }, { sourceId: 'S1' }] });
      }
      if (facts.scanStatus === 'infected') raise('insufficient');
      return {
        summary: `Pre-review: ${verdict.replace('_', ' ')}. ${points.length} observation(s) for the reviewer.`,
        points,
        suggestions: [{ label: 'verdict', value: verdict, rationale: verdict === 'sufficient' ? 'Current, readable and related to its linked controls.' : 'See the observations; a reviewer must decide.', sourceRefs: ref('S2', 'record') }],
        limitations: [...p.limitations, 'Rule-based pre-review (dates, links, term overlap); it does not judge whether the document is genuine.'],
        confidence: 'medium',
      };
    },
  },

  // ── T3/T7 Vendor document analysis (SOC 2, ISO certificate, pentest, contract/DPA) ──
  {
    type: 'vendor_document_analysis',
    title: 'Vendor document analysis',
    targetType: 'evidence',
    permissions: ['evidence.read'],
    instructions:
      'Analyse this third-party document. Suggest "documentType" (soc2_type2 | soc2_type1 | iso27001_certificate | penetration_test | contract_or_dpa | policy | other). Report the audit or certificate period, the issuer/auditor, scope, and every exception, deviation, qualified opinion or open finding as a point with its locator. For contracts or DPAs, add one suggestion per clause with label "clause:<name>" and value present | missing for: breach_notification (and the stated time limit), audit_rights, subprocessors, data_return_deletion, security_measures, confidentiality. Suggest "validUntil" (YYYY-MM-DD) only if the document states it.',
    async load(deps, id) {
      const { source, limitations, title } = await evidenceSource(deps, id);
      return { target: { type: 'evidence', id, label: title }, sources: [source], limitations, allowedValues: { documentType: DOC_TYPES, ...Object.fromEntries(Object.keys(CLAUSES).map((k) => [`clause:${k}`, ['present', 'missing']])) } };
    },
    validate: (out) => out.suggestions.filter((s) => s.label === 'validUntil' && !/^\d{4}-\d{2}-\d{2}$/.test(s.value)).map(() => 'validUntil must be YYYY-MM-DD'),
    mock(p) {
      const s = p.sources[0];
      const body = s.segments.filter((x) => x.locator !== 'metadata');
      const text = body.map((x) => x.text).join(' ');
      if (!text.trim()) return empty(`No document text was available for "${s.label}".`, p.limitations);
      const docType =
        /soc\s*2/i.test(text) && /type\s*(ii|2)\b/i.test(text) ? 'soc2_type2'
        : /soc\s*2/i.test(text) ? 'soc2_type1'
        : /iso\/?(iec)?\s*27001/i.test(text) && /certif/i.test(text) ? 'iso27001_certificate'
        : /penetration test|pentest|pen test/i.test(text) ? 'penetration_test'
        : /agreement|processor|controller|hereby|party|parties/i.test(text) ? 'contract_or_dpa'
        : /\bpolicy\b/i.test(text) ? 'policy'
        : 'other';
      const points: DraftOutput['points'] = [];
      for (const seg of body) {
        for (const t of sentences(seg.text)) {
          if (/\b(exception|deviation|qualified opinion|not operating effectively|finding|non-?conformit\w*|remediat\w*)\b/i.test(t)) points.push({ text: `Possible exception: "${t}"`, sourceRefs: ref(s.ref, seg.locator) });
          else if (/\b(period|valid until|expir\w*|issued|from .{0,20} to )\b/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) points.push({ text: `Dates: "${t}"`, sourceRefs: ref(s.ref, seg.locator) });
        }
      }
      const suggestions: DraftOutput['suggestions'] = [{ label: 'documentType', value: docType, rationale: 'Detected from keywords in the document.', sourceRefs: ref(s.ref) }];
      if (docType === 'contract_or_dpa') {
        for (const [name, re] of Object.entries(CLAUSES)) {
          const hit = body.find((seg) => re.test(seg.text));
          suggestions.push({ label: `clause:${name}`, value: hit ? 'present' : 'missing', rationale: hit ? `Matching wording found (${hit.locator}).` : 'No matching wording found; confirm with legal before relying on it.', sourceRefs: ref(s.ref, hit?.locator) });
        }
      }
      return {
        summary: `Looks like a ${docType.replace(/_/g, ' ')} document. ${points.filter((x) => x.text.startsWith('Possible exception')).length} possible exception(s) flagged.`,
        points: points.slice(0, 40),
        suggestions,
        limitations: [...p.limitations, 'Keyword-based analysis; read the flagged passages before relying on the document.'],
        confidence: 'low',
      };
    },
  },

  // ── F2 Vendor questionnaire pre-review ──
  {
    type: 'vendor_response_review',
    title: 'Vendor answer pre-review',
    targetType: 'vendor_assessment',
    permissions: ['vendor_assessment.read'],
    instructions:
      'Pre-review every vendor answer for the assessor. For each question give one suggestion with label = the questionKey and value accepted | insufficient | rejected: accepted when the answer is clear and credible (an honest "no" is still accepted; scoring handles it), insufficient when it is vague, unanswered, lacks the required evidence or an N/A lacks a reason, rejected only when the answer contradicts its own evidence or is not credible. Put a reviewer note in the rationale. Add a point for each follow-up question to send the vendor. Never change scores.',
    async load(deps, id) {
      const { a, visible, evidence } = await vendorAssessmentState(deps, id);
      const sources: Source[] = visible.map((q, i) => {
        const r = a.responses.find((x) => x.questionId === q.id);
        const ev = r?.evidenceId ? evidence.get(r.evidenceId) : undefined;
        return {
          ref: `S${i + 1}`,
          type: 'question_response',
          recordId: r?.id ?? q.id,
          label: q.questionKey,
          version: r?.answeredAt?.toISOString() ?? 'unanswered',
          segments: [{ locator: q.questionKey, text: JSON.stringify({ question: q.questionText, category: q.category, required: q.required, important: q.important, expected: q.expectedAnswer, evidenceRequired: q.evidenceRequired, answer: r?.notApplicable ? 'N/A' : (r?.answer ?? null), naRationale: r?.naRationale ?? null, comments: r?.comments ?? null, evidence: ev ? { title: ev.title, expires: day(ev.expiresAt) } : null }) }],
        };
      });
      return { target: { type: 'vendor_assessment', id, label: `${a.vendor.name} v${a.assessmentVersion}` }, sources, limitations: sources.length ? [] : ['No visible questions.'], allowedValues: Object.fromEntries(visible.map((q) => [q.questionKey, REVIEW_STATUSES])) };
    },
    mock(p) {
      const suggestions: DraftOutput['suggestions'] = [];
      const points: DraftOutput['points'] = [];
      for (const s of p.sources) {
        const d = parse<{ question: string; required: boolean; important: boolean; expected: Criterion | null; evidenceRequired: boolean; answer: unknown; naRationale: string | null; evidence: { title: string; expires: string | null } | null }>(s);
        const r = ref(s.ref, s.label);
        let value = 'accepted';
        let note = '';
        if (d.answer === 'N/A') {
          if (!d.naRationale) [value, note] = ['insufficient', 'Marked not applicable without a reason.'];
          else if (d.important) [value, note] = ['insufficient', 'Important question marked not applicable; confirm the reason before accepting.'];
          else note = `Not applicable: ${d.naRationale}`;
        } else if (d.answer === null || d.answer === '') {
          [value, note] = ['insufficient', d.required ? 'Required question left unanswered.' : 'Optional question left unanswered.'];
        } else if (d.evidenceRequired && !d.evidence) {
          [value, note] = ['insufficient', 'Supporting evidence is required but none is attached.'];
        } else if (d.evidence?.expires && new Date(d.evidence.expires) <= new Date()) {
          [value, note] = ['insufficient', `The attached evidence "${d.evidence.title}" expired on ${d.evidence.expires}.`];
        } else {
          const met = meetsCriterion(d.answer, d.expected);
          note = met === false ? 'Answer recorded; it does not meet the expected criterion, so scoring gives no credit and a finding will be raised.' : met ? 'Meets the expected criterion.' : 'Informational answer.';
        }
        suggestions.push({ label: s.label, value, rationale: note, sourceRefs: r });
        if (value === 'insufficient') points.push({ text: `${s.label}: ${d.answer === null || d.answer === '' ? `Please answer: "${d.question}"` : d.evidenceRequired && !d.evidence ? `Please attach evidence supporting your answer to "${d.question}".` : `Please clarify your answer to "${d.question}". ${note}`}`, sourceRefs: r });
      }
      const counts = REVIEW_STATUSES.map((v) => `${suggestions.filter((x) => x.value === v).length} ${v}`).join(', ');
      return {
        summary: `Suggested review: ${counts}. ${points.length} follow-up question(s) for the vendor.`,
        points,
        suggestions,
        limitations: ['Rule-based pre-review from the questionnaire criteria and attachments; evidence content was not read.'],
        confidence: 'medium',
      };
    },
  },

  // ── T5 Vendor decision memo ──
  {
    type: 'vendor_decision_memo',
    title: 'Vendor decision memo',
    targetType: 'vendor_assessment',
    permissions: ['vendor_assessment.read'],
    instructions:
      'Draft a decision memo for the approver. Suggest "decision" (approved | approved_with_conditions | rejected) consistent with the deterministic scores and the policy rule that residual tiers at or above conditionsRequiredFrom cannot be approved without conditions. Add one suggestion per condition with label "condition" (a concrete, time-bound requirement). Suggest "nextReviewMonths" (3, 6, 12 or 24). Use the summary for the rationale paragraph. The scores are authoritative; do not recompute them.',
    async load(deps, id) {
      const { a, visible } = await vendorAssessmentState(deps, id);
      const { policy } = await deps.policies.activeVendor(undefined, deps.organizationId);
      const visibleIds = new Set(visible.map((q) => q.id));
      const scored: ScoredQuestion[] = a.templateRef.questions.filter((q) => visibleIds.has(q.id)).map((q) => {
        const r = a.responses.find((x) => x.questionId === q.id);
        return { questionKey: q.questionKey, category: q.category, weight: q.weight, important: q.important, evidenceRequired: q.evidenceRequired, criterion: (q.expectedAnswer as Criterion | null) ?? null, answer: r?.notApplicable ? null : (r?.answer ?? null), notApplicable: !!r?.notApplicable, naRationale: r?.naRationale ?? null, reviewerStatus: r?.reviewerStatus ?? 'pending', hasEvidence: !!r?.evidenceId };
      });
      const result = scoreAssessment(a.vendor, scored, policy);
      const gaps = result.breakdown.questions.filter((q) => q.outcome !== 'met' && q.outcome !== 'not_applicable' && q.outcome !== 'informational');
      const byKey = new Map(a.templateRef.questions.map((q) => [q.questionKey, q]));
      return {
        target: { type: 'vendor_assessment', id, label: `${a.vendor.name} v${a.assessmentVersion}` },
        sources: [
          { ref: 'S1', type: 'vendor_score', recordId: a.id, label: 'Deterministic score', version: String(a.version), segments: [{ locator: 'score', text: JSON.stringify({ vendor: a.vendor.name, criticality: a.vendor.criticality, dataClassification: a.vendor.dataClassification, accessLevel: a.vendor.accessLevel, inherent: result.inherentScore, residual: result.residualScore, tier: result.tier, controlEffectiveness: Math.round(result.controlEffectiveness * 100), conditionsRequiredFrom: policy.conditionsRequiredFrom, reviewIntervalDays: a.vendor.reassessmentFrequencyDays }) }] },
          { ref: 'S2', type: 'question_gaps', recordId: a.id, label: 'Answers without full credit', version: String(gaps.length), segments: gaps.map((g) => ({ locator: g.questionKey, text: JSON.stringify({ question: byKey.get(g.questionKey)?.questionText, outcome: g.outcome, important: byKey.get(g.questionKey)?.important }) })) },
        ],
        limitations: scored.some((q) => q.reviewerStatus === 'pending') ? ['Some answers are not reviewed yet; the score will change after review.'] : [],
        allowedValues: { decision: DECISIONS, nextReviewMonths: ['3', '6', '12', '24'] },
      };
    },
    mock(p) {
      const sc = parse<{ vendor: string; tier: string; residual: number; inherent: number; controlEffectiveness: number; conditionsRequiredFrom: string }>(p.sources[0]);
      const gaps = p.sources[1].segments.map((s) => ({ key: s.locator, ...(JSON.parse(s.text) as { question: string; outcome: string; important: boolean }) }));
      const rank = LEVELS.indexOf(sc.tier);
      const needsConditions = rank >= LEVELS.indexOf(sc.conditionsRequiredFrom);
      const decision = sc.tier === 'critical' && sc.controlEffectiveness < 30 ? 'rejected' : needsConditions || gaps.some((g) => g.important) ? 'approved_with_conditions' : 'approved';
      const conditions = gaps
        .filter((g) => g.important || ['not_met', 'met_evidence_missing'].includes(g.outcome))
        .slice(0, 8)
        .map((g) => ({ label: 'condition', value: `${g.outcome === 'met_evidence_missing' ? 'Provide evidence for' : 'Remediate'} "${(g.question ?? g.key).slice(0, 160)}" within ${g.important ? 60 : 90} days`, rationale: `Outcome ${g.outcome}${g.important ? ' on an important question' : ''}.`, sourceRefs: ref('S2', g.key) }));
      const months = rank >= 3 ? '3' : rank === 2 ? '6' : rank === 1 ? '12' : '24';
      return {
        summary: `${sc.vendor}: residual risk ${sc.residual}/100 (${sc.tier}), inherent ${sc.inherent}, control effectiveness ${sc.controlEffectiveness}%. Recommended: ${decision.replace(/_/g, ' ')}${conditions.length ? ` with ${conditions.length} condition(s)` : ''}. ${gaps.length} answer(s) did not earn full credit.`,
        points: gaps.slice(0, 15).map((g) => ({ text: `${g.key}: ${g.outcome.replace(/_/g, ' ')}${g.important ? ' (important)' : ''}`, sourceRefs: ref('S2', g.key) })),
        suggestions: [{ label: 'decision', value: decision, rationale: needsConditions ? `Residual tier ${sc.tier} is at or above the policy threshold (${sc.conditionsRequiredFrom}); plain approval is not allowed.` : 'Residual tier is below the conditions threshold.', sourceRefs: ref('S1', 'score') }, ...conditions, { label: 'nextReviewMonths', value: months, rationale: `Review interval for a ${sc.tier} residual tier.`, sourceRefs: ref('S1', 'score') }],
        limitations: [...p.limitations, 'Recommendation follows the scoring policy mechanically; the approver decides.'],
        confidence: 'medium',
      };
    },
  },

  // ── T1 Vendor onboarding / profile review ──
  {
    type: 'vendor_profile_review',
    title: 'Vendor profile check',
    targetType: 'vendor',
    permissions: ['vendor.read'],
    instructions:
      'Check the vendor profile for inconsistencies and gaps before assessment. Where a profile value looks wrong given the description and data, suggest a corrected value with label criticality, dataClassification or accessLevel. List missing information and the questionnaire areas to focus on as points.',
    async load(deps, id) {
      const v = await deps.prisma.vendor.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!v) throw notFound('Vendor');
      const contacts = await deps.prisma.vendorContact.count({ where: { organizationId: deps.organizationId, vendorId: id } });
      const { policy } = await deps.policies.activeVendor(undefined, deps.organizationId);
      const inherent = inherentVendorRisk(v, policy);
      return {
        target: { type: 'vendor', id, label: v.name },
        sources: [{ ref: 'S1', type: 'vendor', recordId: v.id, label: v.name, version: String(v.version), segments: [{ locator: 'profile', text: JSON.stringify({ name: v.name, serviceDescription: v.serviceDescription, criticality: v.criticality, dataClassification: v.dataClassification, dataTypes: v.dataTypes, personalDataAccess: v.personalDataAccess, accessLevel: v.accessLevel, businessDependency: v.businessDependency, serviceImpact: v.serviceImpact, regions: v.regions, dependencies: v.dependencies, website: v.website, hasBusinessOwner: !!v.businessOwnerId, contacts, inherentScore: inherent.score }) }] }],
        limitations: [],
        allowedValues: { criticality: LEVELS, dataClassification: CLASSIFICATIONS, accessLevel: ACCESS },
      };
    },
    mock(p) {
      const v = parse<{ name: string; serviceDescription: string; criticality: string; dataClassification: string; dataTypes: string[]; personalDataAccess: boolean; accessLevel: string; businessDependency: number; serviceImpact: number; regions: string[]; dependencies: string | null; website: string | null; hasBusinessOwner: boolean; contacts: number; inherentScore: number }>(p.sources[0]);
      const r = ref('S1', 'profile');
      const suggestions: DraftOutput['suggestions'] = [];
      const text = `${v.serviceDescription} ${v.dataTypes.join(' ')}`;
      if (SENSITIVE_DATA.test(text) && v.dataClassification !== 'restricted') suggestions.push({ label: 'dataClassification', value: 'restricted', rationale: `The service handles sensitive data (${text.match(SENSITIVE_DATA)?.[0]}).`, sourceRefs: r });
      else if (v.personalDataAccess && CLASSIFICATIONS.indexOf(v.dataClassification) < 2) suggestions.push({ label: 'dataClassification', value: 'confidential', rationale: 'The vendor accesses personal data, which is at least confidential.', sourceRefs: r });
      if (PRIVILEGED_HINT.test(v.serviceDescription) && ACCESS.indexOf(v.accessLevel) < 2) suggestions.push({ label: 'accessLevel', value: 'privileged', rationale: `The description mentions "${v.serviceDescription.match(PRIVILEGED_HINT)?.[0]}".`, sourceRefs: r });
      const maxFactor = Math.max(v.businessDependency, v.serviceImpact);
      const expected = maxFactor >= 5 ? 'critical' : maxFactor >= 4 ? 'high' : maxFactor >= 3 ? 'medium' : 'low';
      if (LEVELS.indexOf(expected) - LEVELS.indexOf(v.criticality) >= 2) suggestions.push({ label: 'criticality', value: expected, rationale: `Business dependency ${v.businessDependency}/5 and service impact ${v.serviceImpact}/5 suggest ${expected} criticality.`, sourceRefs: r });
      const missing = [!v.hasBusinessOwner && 'a business owner', !v.contacts && 'a security contact', !v.website && 'a website', !v.regions.length && 'data-processing regions', !v.dependencies && 'fourth-party dependencies (sub-processors)'].filter(Boolean);
      const focus = [v.personalDataAccess && 'privacy and data protection (DPA, sub-processors, deletion)', ACCESS.indexOf(v.accessLevel) >= 2 && 'privileged access, MFA and access reviews', v.serviceImpact >= 4 && 'business continuity and incident response', SENSITIVE_DATA.test(text) && 'encryption and regulatory certifications'].filter(Boolean);
      const points: DraftOutput['points'] = [];
      if (missing.length) points.push({ text: `Missing: ${missing.join(', ')}.`, sourceRefs: r });
      if (focus.length) points.push({ text: `Focus the questionnaire on ${focus.join('; ')}.`, sourceRefs: r });
      return {
        summary: `${v.name}: inherent risk ${v.inherentScore}/100. ${suggestions.length} profile correction(s) suggested, ${missing.length} missing item(s).`,
        points,
        suggestions,
        limitations: ['Rule-based check of the profile fields and description.'],
        confidence: 'medium',
      };
    },
  },

  // ── T8 Vendor follow-up message ──
  {
    type: 'vendor_followup',
    title: 'Vendor follow-up message',
    targetType: 'vendor',
    permissions: ['vendor.read', 'finding.read'],
    instructions:
      'Draft a polite, specific follow-up message to the vendor security contact in the summary (plain text, no greeting placeholders other than the vendor name). List each open item the vendor must address as a point: open findings, overdue remediation, expired documents. Do not include internal reviewer notes, scores or risk tiers.',
    async load(deps, id) {
      const v = await deps.prisma.vendor.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!v) throw notFound('Vendor');
      const findings = await deps.prisma.finding.findMany({ where: { organizationId: deps.organizationId, deduplicationKey: { startsWith: `vendor:${id}:` }, status: { notIn: ['closed', 'accepted'] } }, include: { tasks: { where: { status: { in: ['open', 'in_progress', 'blocked'] } } } }, take: 30 });
      const links = await deps.prisma.evidenceLink.findMany({ where: { organizationId: deps.organizationId, entityType: 'vendor', entityId: id }, include: { evidence: { select: { title: true, expiresAt: true } } } });
      const expired = links.filter((l) => l.evidence.expiresAt && l.evidence.expiresAt <= new Date());
      return {
        target: { type: 'vendor', id, label: v.name },
        sources: [
          { ref: 'S1', type: 'vendor_findings', recordId: id, label: `${v.name} open findings`, version: String(findings.length), segments: findings.map((f) => ({ locator: f.findingKey, text: JSON.stringify({ title: f.title, description: f.description.split('\n\n')[0], dueDate: day(f.dueDate), overdueTasks: f.tasks.filter((t) => t.dueDate && t.dueDate < new Date()).map((t) => t.title) }) })) },
          { ref: 'S2', type: 'vendor_documents', recordId: id, label: `${v.name} expired documents`, version: String(expired.length), segments: expired.map((l) => ({ locator: l.evidence.title, text: `${l.evidence.title} expired ${day(l.evidence.expiresAt)}` })) },
        ],
        limitations: [],
      };
    },
    mock(p) {
      const findings = p.sources[0].segments.map((s) => ({ key: s.locator, ...(JSON.parse(s.text) as { title: string; dueDate: string | null; overdueTasks: string[] }) }));
      const docs = p.sources[1].segments;
      const name = p.target.label;
      if (!findings.length && !docs.length) return { ...empty(`No open items for ${name}; no follow-up needed.`, []), confidence: 'high' };
      const points: DraftOutput['points'] = [
        ...findings.map((f) => ({ text: `${f.title.replace(`${name}: `, '')}${f.dueDate ? ` (due ${f.dueDate})` : ''}${f.overdueTasks.length ? ' (overdue)' : ''}`, sourceRefs: ref('S1', f.key) })),
        ...docs.map((d) => ({ text: `Please send an updated ${d.locator} (${d.text.split(' expired ')[1] ? `expired ${d.text.split(' expired ')[1]}` : 'expired'}).`, sourceRefs: ref('S2', d.locator) })),
      ];
      const list = points.map((x, i) => `${i + 1}. ${x.text}`).join('\n');
      return {
        summary: `Hello ${name} security team,\n\nThank you for completing our security review. We still need the following items:\n${list}\n\nPlease reply with your remediation plan and the supporting documents, or let us know if any item no longer applies.\n\nKind regards`,
        points,
        suggestions: [],
        limitations: ['Template message built from open findings and documents; edit before sending. Nothing is sent automatically.'],
        confidence: 'high',
      };
    },
  },

  // ── T6 Vendor portfolio digest ──
  {
    type: 'vendor_portfolio_digest',
    title: 'Vendor portfolio digest',
    targetType: 'organization',
    permissions: ['vendor.read'],
    instructions: 'Summarise which vendors need attention this week and why, most urgent first, citing each vendor. Mention reassessments due, overdue remediation, expired documents and high or critical tiers. Do not invent vendors.',
    async load(deps, id) {
      if (id !== deps.organizationId) throw notFound('Organization');
      const now = new Date();
      const vendors = await deps.prisma.vendor.findMany({ where: { organizationId: id, status: { notIn: ['archived', 'rejected'] } }, take: 150, orderBy: { name: 'asc' } });
      const findings = await deps.prisma.finding.findMany({ where: { organizationId: id, deduplicationKey: { startsWith: 'vendor:' }, status: { notIn: ['closed', 'accepted'] } }, select: { deduplicationKey: true, severity: true, dueDate: true } });
      const docLinks = await deps.prisma.evidenceLink.findMany({ where: { organizationId: id, entityType: 'vendor' }, include: { evidence: { select: { expiresAt: true } } } });
      const segments = vendors.map((v) => {
        const vf = findings.filter((f) => f.deduplicationKey?.startsWith(`vendor:${v.id}:`));
        return {
          locator: v.name,
          text: JSON.stringify({
            status: v.status,
            tier: v.riskTier,
            criticality: v.criticality,
            reassessmentDays: v.nextAssessmentAt ? daysUntil(v.nextAssessmentAt, now) : null,
            openFindings: vf.length,
            highFindings: vf.filter((f) => f.severity === 'high' || f.severity === 'critical').length,
            overdueFindings: vf.filter((f) => f.dueDate && f.dueDate < now).length,
            expiredDocuments: docLinks.filter((l) => l.entityId === v.id && l.evidence.expiresAt && l.evidence.expiresAt <= now).length,
          }),
        };
      });
      return { target: { type: 'organization', id, label: 'Vendor portfolio' }, sources: [{ ref: 'S1', type: 'vendors', recordId: id, label: 'Vendor portfolio', version: now.toISOString().slice(0, 10), segments }], limitations: vendors.length >= 150 ? ['Only the first 150 vendors were considered.'] : [] };
    },
    mock(p) {
      const rows = p.sources[0].segments.map((s) => ({ name: s.locator, ...(JSON.parse(s.text) as { status: string; tier: string | null; criticality: string; reassessmentDays: number | null; openFindings: number; highFindings: number; overdueFindings: number; expiredDocuments: number }) }));
      const scored = rows
        .map((v) => {
          const reasons = [
            v.reassessmentDays !== null && v.reassessmentDays <= 0 && `reassessment overdue by ${-v.reassessmentDays} day(s)`,
            v.reassessmentDays !== null && v.reassessmentDays > 0 && v.reassessmentDays <= 30 && `reassessment due in ${v.reassessmentDays} day(s)`,
            v.overdueFindings && `${v.overdueFindings} overdue finding(s)`,
            v.highFindings && `${v.highFindings} high/critical finding(s)`,
            v.expiredDocuments && `${v.expiredDocuments} expired document(s)`,
            (v.tier === 'high' || v.tier === 'critical') && `${v.tier} residual risk`,
          ].filter(Boolean) as string[];
          const urgency = (v.reassessmentDays !== null && v.reassessmentDays <= 0 ? 3 : 0) + v.overdueFindings * 2 + v.highFindings * 2 + v.expiredDocuments + (v.tier === 'critical' ? 3 : v.tier === 'high' ? 2 : 0);
          return { ...v, reasons, urgency };
        })
        .filter((v) => v.reasons.length)
        .sort((a, b) => b.urgency - a.urgency);
      return {
        summary: scored.length ? `${scored.length} of ${rows.length} vendor(s) need attention. Most urgent: ${scored.slice(0, 3).map((v) => v.name).join(', ')}.` : `All ${rows.length} vendor(s) are on track.`,
        points: scored.slice(0, 40).map((v) => ({ text: `${v.name}: ${v.reasons.join('; ')}.`, sourceRefs: ref('S1', v.name) })),
        suggestions: [],
        limitations: p.limitations,
        confidence: 'high',
      };
    },
  },

  // ── F4 Finding triage ──
  {
    type: 'finding_triage',
    title: 'Finding triage',
    targetType: 'finding',
    permissions: ['finding.read'],
    instructions:
      'Triage the finding. Suggest: "category" (from the allowed list), "severity", "owner" (a member id from the candidates who should fix it), "priority" (low|medium|high|urgent), "dueInDays" (7|14|30|60|90), "linkRisk" (an existing risk id from the candidates or "none"), "remediationTitle" and "remediationPlan" (concrete steps). Explain each choice in its rationale.',
    async load(deps, id) {
      const f = await deps.prisma.finding.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!f) throw notFound('Finding');
      const [members, risks, control] = await Promise.all([
        activeMembers(deps),
        deps.prisma.risk.findMany({ where: { organizationId: deps.organizationId, archivedAt: null, status: { not: 'closed' } }, select: { id: true, riskKey: true, title: true, category: true }, take: 60, orderBy: { inherentScore: 'desc' } }),
        f.controlId ? deps.prisma.control.findFirst({ where: { id: f.controlId, organizationId: deps.organizationId }, include: { implementations: { where: { organizationId: deps.organizationId }, take: 1 } } }) : null,
      ]);
      let vendorOwner: string | null = null;
      const vendorId = f.deduplicationKey?.match(/^vendor:([0-9a-f-]{36}):/)?.[1];
      if (vendorId) vendorOwner = (await deps.prisma.vendor.findFirst({ where: { id: vendorId, organizationId: deps.organizationId }, select: { businessOwnerId: true } }))?.businessOwnerId ?? null;
      return {
        target: { type: 'finding', id, label: f.findingKey },
        sources: [
          { ref: 'S1', type: 'finding', recordId: f.id, label: f.findingKey, version: String(f.version), segments: [{ locator: 'finding', text: JSON.stringify({ title: f.title, description: f.description, severity: f.severity, sourceType: f.sourceType, category: f.category, assignedTo: f.assignedTo, riskId: f.riskId, control: control ? `${control.controlCode} ${control.title}` : null, controlOwner: control?.implementations[0]?.ownerId ?? null, vendorOwner }) }] },
          { ref: 'S2', type: 'members', recordId: deps.organizationId, label: 'Members', version: String(members.length), segments: members.map((m) => ({ locator: m.id, text: `${m.name} (${m.roles.join(', ')})` })) },
          { ref: 'S3', type: 'risks', recordId: deps.organizationId, label: 'Open risks', version: String(risks.length), segments: risks.map((r) => ({ locator: r.id, text: `${r.riskKey} ${r.title} [${r.category}]` })) },
        ],
        limitations: [],
        allowedValues: { category: CATEGORIES, severity: SEVERITIES, owner: members.map((m) => m.id), priority: PRIORITIES, dueInDays: DUE_DAYS, linkRisk: ['none', ...risks.map((r) => r.id)] },
      };
    },
    mock(p) {
      const f = parse<{ title: string; description: string; severity: string; sourceType: string; assignedTo: string | null; riskId: string | null; controlOwner: string | null; vendorOwner: string | null }>(p.sources[0]);
      const text = `${f.title} ${f.description}`.toLowerCase();
      const category = Object.entries(CATEGORY_HINTS).find(([, re]) => re.test(text))?.[0] ?? 'general';
      const members = p.sources[1].segments;
      const owner = f.assignedTo ?? f.controlOwner ?? f.vendorOwner ?? members.find((m) => /grc_manager/.test(m.text))?.locator ?? members[0]?.locator;
      const ft = terms(text);
      const risk = f.riskId ? null : p.sources[2].segments.map((s) => ({ id: s.locator, text: s.text, score: shared(terms(s.text), ft) })).sort((a, b) => b.score - a.score)[0];
      const option = (REMEDIATION_LIBRARY[category] ?? REMEDIATION_LIBRARY.general)[0];
      const s1 = ref('S1', 'finding');
      const suggestions: DraftOutput['suggestions'] = [
        { label: 'category', value: category, rationale: 'Matched keywords in the title and description.', sourceRefs: s1 },
        { label: 'severity', value: f.severity, rationale: 'Kept: no new facts justify a change.', sourceRefs: s1 },
        { label: 'priority', value: PRIORITY_BY_SEVERITY[f.severity] ?? 'medium', rationale: `Matches a ${f.severity} finding.`, sourceRefs: s1 },
        { label: 'dueInDays', value: DUE_BY_SEVERITY[f.severity] ?? '30', rationale: `Default remediation window for ${f.severity} severity.`, sourceRefs: s1 },
        { label: 'remediationTitle', value: option[0], rationale: option[1], sourceRefs: s1 },
        { label: 'remediationPlan', value: `1. Confirm the scope of "${f.title.slice(0, 120)}". 2. ${option[0]}. 3. Attach evidence of the fix. 4. Ask a reviewer to validate and close the finding.`, rationale: 'Generic plan from the remediation library.', sourceRefs: s1 },
      ];
      if (owner) suggestions.push({ label: 'owner', value: owner, rationale: f.assignedTo ? 'Already assigned.' : f.controlOwner === owner ? 'Owns the related control.' : f.vendorOwner === owner ? 'Business owner of the vendor.' : 'GRC manager by default.', sourceRefs: ref('S2', owner) });
      suggestions.push(risk && risk.score >= 2 ? { label: 'linkRisk', value: risk.id, rationale: `Shares ${risk.score} key terms with ${risk.text}.`, sourceRefs: ref('S3', risk.id) } : { label: 'linkRisk', value: 'none', rationale: f.riskId ? 'Already linked to a risk.' : 'No existing risk is clearly related.', sourceRefs: ref('S3') });
      return { summary: `Triage: ${category.replace(/_/g, ' ')}, ${PRIORITY_BY_SEVERITY[f.severity] ?? 'medium'} priority, due in ${DUE_BY_SEVERITY[f.severity] ?? '30'} days.`, points: [], suggestions, limitations: ['Rule-based triage from keywords, ownership and severity.'], confidence: 'medium' };
    },
  },

  // ── F5 Evidence chaser ──
  {
    type: 'evidence_request',
    title: 'Evidence refresh request',
    targetType: 'evidence',
    permissions: ['evidence.read'],
    instructions: 'Draft a short request to the evidence owner in the summary: what to collect to replace this evidence, why it matters (the controls it supports) and by when. List the concrete items to collect as points.',
    async load(deps, id) {
      const e = await deps.prisma.evidence.findFirst({ where: { id, organizationId: deps.organizationId }, include: { ownerRef: { select: { displayName: true } } } });
      if (!e) throw notFound('Evidence');
      const controls = await linkedControls(deps, id);
      return {
        target: { type: 'evidence', id, label: e.title },
        sources: [
          { ref: 'S1', type: 'evidence_record', recordId: e.id, label: e.title, version: e.updatedAt.toISOString(), segments: [{ locator: 'record', text: JSON.stringify({ ...evidenceFacts(e), owner: e.ownerRef?.displayName ?? null, originalFilename: e.originalFilename }) }] },
          ...controls.map((c, i) => ({ ref: `S${i + 2}`, type: 'control', recordId: c.id, label: `${c.controlCode} ${c.title}`, version: String(c.version), segments: [{ locator: 'control', text: `${c.title}. ${c.description}` }] })),
        ],
        limitations: [],
      };
    },
    mock(p) {
      const e = parse<ReturnType<typeof evidenceFacts> & { owner: string | null; originalFilename: string | null }>(p.sources[0]);
      const controls = p.sources.filter((s) => s.type === 'control');
      const expired = !!e.expiresAt && new Date(e.expiresAt) <= new Date();
      const points = [
        { text: `A current version of "${e.title}"${e.originalFilename ? ` (last file: ${e.originalFilename})` : ''}, dated within the review period.`, sourceRefs: ref('S1', 'record') },
        ...controls.map((c) => ({ text: `Shows that ${c.label} is operating: ${c.segments[0].text.slice(0, 200)}`, sourceRefs: ref(c.ref, 'control') })),
        { text: 'Set the new validity dates when uploading, then request review.', sourceRefs: ref('S1', 'record') },
      ];
      return {
        summary: `Hi ${e.owner ?? 'there'}, "${e.title}" ${expired ? `expired on ${e.expiresAt}` : `expires on ${e.expiresAt}`}. ${controls.length ? `It supports ${controls.map((c) => c.label).join(', ')}, which ${expired ? 'now fail' : 'will fail'} their checks without it. ` : ''}Please upload a refreshed version${expired ? ' as soon as possible' : ` before ${e.expiresAt}`}.`,
        points,
        suggestions: [],
        limitations: ['Template request; edit as needed.'],
        confidence: 'high',
      };
    },
  },

  // ── F9 Risk spotting ──
  {
    type: 'risk_proposals',
    title: 'Proposed risks',
    targetType: 'organization',
    permissions: ['risk.read', 'finding.read'],
    instructions:
      'Propose new risks or re-scores from the recent signals. For a new risk add a suggestion with label "new_risk" whose value is JSON {"title","category","likelihood":1-5,"impact":1-5,"description"} (description under 300 characters). For a re-score add label "rescore" with JSON {"riskId","likelihood","impact"} using only risk ids from the existing risks. Do not propose risks that duplicate existing ones. Explain each in the rationale and cite the signals.',
    async load(deps, id) {
      if (id !== deps.organizationId) throw notFound('Organization');
      const since = new Date(Date.now() - 30 * DAY);
      const [findings, incidents, vendors, risks] = await Promise.all([
        deps.prisma.finding.findMany({ where: { organizationId: id, riskId: null, status: { notIn: ['closed', 'accepted'] }, lastDetectedAt: { gte: since } }, select: { id: true, findingKey: true, title: true, severity: true, category: true, sourceType: true, detectionCount: true }, take: 60 }),
        deps.prisma.aiIncident.findMany({ where: { organizationId: id, detectedAt: { gte: since } }, select: { id: true, title: true, severity: true, aiSystem: { select: { name: true } } }, take: 20 }),
        deps.prisma.vendorRiskHistory.findMany({ where: { organizationId: id, recordedAt: { gte: since }, tier: { in: ['high', 'critical'] } }, include: { vendor: { select: { name: true } } }, take: 20 }),
        deps.prisma.risk.findMany({ where: { organizationId: id, archivedAt: null, status: { not: 'closed' } }, select: { id: true, riskKey: true, title: true, category: true, likelihood: true, impact: true }, take: 100 }),
      ]);
      return {
        target: { type: 'organization', id, label: 'Recent signals (30 days)' },
        sources: [
          { ref: 'S1', type: 'findings', recordId: id, label: 'Findings without a risk', version: String(findings.length), segments: findings.map((f) => ({ locator: f.findingKey, text: JSON.stringify({ title: f.title, severity: f.severity, category: f.category, source: f.sourceType, detections: f.detectionCount }) })) },
          { ref: 'S2', type: 'ai_incidents', recordId: id, label: 'AI incidents', version: String(incidents.length), segments: incidents.map((i) => ({ locator: i.id, text: `${i.aiSystem.name}: ${i.title} (${i.severity})` })) },
          { ref: 'S3', type: 'vendor_tiers', recordId: id, label: 'High-risk vendor assessments', version: String(vendors.length), segments: vendors.map((v) => ({ locator: v.vendor.name, text: `${v.vendor.name} residual ${v.residualScore ?? '?'} (${v.tier})` })) },
          { ref: 'S4', type: 'risks', recordId: id, label: 'Existing risks', version: String(risks.length), segments: risks.map((r) => ({ locator: r.id, text: `${r.riskKey} ${r.title} [${r.category}] L${r.likelihood} I${r.impact}` })) },
        ],
        limitations: [],
      };
    },
    validate(out, p) {
      const riskIds = new Set(p.sources.find((s) => s.type === 'risks')?.segments.map((s) => s.locator));
      return [
        ...jsonValues(out, 'new_risk', (v) => (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 200 ? 'title required (max 200)' : typeof v.category !== 'string' ? 'category required' : !score15(v.likelihood) || !score15(v.impact) ? 'likelihood and impact must be 1-5' : null)),
        ...jsonValues(out, 'rescore', (v) => (!riskIds.has(String(v.riskId)) ? 'unknown riskId' : !score15(v.likelihood) || !score15(v.impact) ? 'likelihood and impact must be 1-5' : null)),
      ];
    },
    mock(p) {
      const findings = p.sources[0].segments.map((s) => ({ key: s.locator, ...(JSON.parse(s.text) as { title: string; severity: string; category: string | null; detections: number }) }));
      const existing = p.sources[3].segments.map((s) => s.text.toLowerCase());
      const groups = new Map<string, typeof findings>();
      for (const f of findings) {
        const cat = f.category ?? Object.entries(CATEGORY_HINTS).find(([, re]) => re.test(f.title.toLowerCase()))?.[0] ?? 'general';
        groups.set(cat, [...(groups.get(cat) ?? []), f]);
      }
      const suggestions: DraftOutput['suggestions'] = [];
      for (const [cat, list] of groups) {
        const worst = Math.max(...list.map((f) => SEVERITIES.indexOf(f.severity)));
        if (list.length < 2 && worst < 2) continue;
        const label = cat.replace(/_/g, ' ');
        if (existing.some((r) => r.includes(label.toLowerCase()))) continue;
        const likelihood = Math.min(5, 2 + list.length + Math.max(0, ...list.map((f) => f.detections - 1)));
        suggestions.push({ label: 'new_risk', value: JSON.stringify({ title: `Recurring ${label} weaknesses`, category: label.replace(/^\w/, (c) => c.toUpperCase()), likelihood: Math.min(5, likelihood), impact: worst + 2, description: `${list.length} open finding(s) without a linked risk, worst severity ${SEVERITIES[worst]}.`.slice(0, 300) }), rationale: `Findings ${list.map((f) => f.key).join(', ')} share this theme and are not linked to any risk.`, sourceRefs: list.slice(0, 10).map((f) => ({ sourceId: 'S1', locator: f.key })) });
      }
      for (const inc of p.sources[1].segments.filter((s) => /\((high|critical)\)$/.test(s.text))) {
        const sys = inc.text.split(':')[0];
        if (existing.some((r) => r.includes(sys.toLowerCase()))) continue;
        suggestions.push({ label: 'new_risk', value: JSON.stringify({ title: `AI system failure: ${sys}`.slice(0, 200), category: 'AI', likelihood: 3, impact: /critical/.test(inc.text) ? 5 : 4, description: `Serious AI incident recorded: ${inc.text}`.slice(0, 300) }), rationale: 'A high or critical AI incident has no matching risk.', sourceRefs: ref('S2', inc.locator) });
      }
      for (const v of p.sources[2].segments) {
        if (existing.some((r) => r.includes(v.locator.toLowerCase()))) continue;
        suggestions.push({ label: 'new_risk', value: JSON.stringify({ title: `Third-party risk: ${v.locator}`.slice(0, 200), category: 'Third Party', likelihood: 3, impact: /critical/.test(v.text) ? 5 : 4, description: `Recent assessment: ${v.text}`.slice(0, 300) }), rationale: 'High residual vendor risk without a matching register entry.', sourceRefs: ref('S3', v.locator) });
      }
      return { summary: suggestions.length ? `${suggestions.length} risk proposal(s) from the last 30 days of signals.` : 'No new risks are suggested by the recent signals.', points: [], suggestions: suggestions.slice(0, 20), limitations: ['Rule-based grouping of recent signals; check scores before creating risks.'], confidence: 'low' };
    },
  },

  // ── F12 AI system intake ──
  {
    type: 'ai_system_prefill',
    title: 'AI system intake review',
    targetType: 'ai_system',
    permissions: ['ai_system.read'],
    instructions:
      'Review the AI system registration. Suggest "riskTier" (minimal | limited | high | unacceptable) with reasons (e.g. EU AI Act high-risk uses such as employment, credit, education, essential services, biometrics). List missing registration information and the assessment areas to focus on as points.',
    async load(deps, id) {
      const s = await deps.prisma.aiSystem.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!s) throw notFound('AI system');
      const { id: _i, organizationId: _o, createdBy: _c, approvedBy: _a, businessOwnerId, technicalOwnerId, riskOwnerId, ...fields } = s;
      return { target: { type: 'ai_system', id, label: s.name }, sources: [{ ref: 'S1', type: 'ai_system', recordId: s.id, label: s.name, version: String(s.version), segments: [{ locator: 'registration', text: JSON.stringify({ ...fields, hasBusinessOwner: !!businessOwnerId, hasTechnicalOwner: !!technicalOwnerId, hasRiskOwner: !!riskOwnerId }) }] }], limitations: [], allowedValues: { riskTier: AI_TIERS } };
    },
    mock(p) {
      const s = parse<Record<string, unknown> & { name: string; description: string; businessPurpose: string; affectedPeople: string | null; automatedDecisionMaking: boolean; influencesDecisionsAboutPeople: boolean; personalDataProcessed: boolean; sensitiveDataProcessed: boolean; deploymentType: string; intendedUsers: string | null }>(p.sources[0]);
      const text = `${s.description} ${s.businessPurpose} ${s.affectedPeople ?? ''} ${s.intendedUsers ?? ''}`;
      const r = ref('S1', 'registration');
      const tier = HIGH_RISK_AI.test(text) && s.influencesDecisionsAboutPeople ? 'high' : s.automatedDecisionMaking && s.influencesDecisionsAboutPeople ? 'high' : /\b(customer|public|user[- ]facing|chat|generat\w*|assistant)\b/i.test(text) ? 'limited' : 'minimal';
      const missing = (['humanOversight', 'overrideAndAppeal', 'escalationPath', 'knownLimitations', 'foreseeableMisuse', 'rollbackPlan', 'dataRetention', 'dataLocation'] as const).filter((k) => !s[k]).map((k) => k.replace(/([A-Z])/g, ' $1').toLowerCase());
      const owners = [!s.hasBusinessOwner && 'business owner', !s.hasTechnicalOwner && 'technical owner', !s.hasRiskOwner && 'risk owner'].filter(Boolean);
      const focus = [s.influencesDecisionsAboutPeople && 'fairness and bias testing', (s.personalDataProcessed || s.sensitiveDataProcessed) && 'privacy, data minimisation and lawful basis', /third_party_api|saas_feature/.test(s.deploymentType) && 'provider due diligence and data sharing terms', /\b(llm|gpt|generat\w*|chat|assistant)\b/i.test(text) && 'prompt injection, hallucination and output review', s.automatedDecisionMaking && 'human oversight and the right to contest decisions'].filter(Boolean);
      const points: DraftOutput['points'] = [];
      if (missing.length) points.push({ text: `Missing: ${missing.join(', ')}.`, sourceRefs: r });
      if (owners.length) points.push({ text: `No ${owners.join(', ')} assigned.`, sourceRefs: r });
      if (focus.length) points.push({ text: `Focus the assessment on ${focus.join('; ')}.`, sourceRefs: r });
      const match = text.match(HIGH_RISK_AI)?.[0];
      return {
        summary: `${s.name}: suggested ${tier} risk tier. ${missing.length + owners.length} gap(s) in the registration.`,
        points,
        suggestions: [{ label: 'riskTier', value: tier, rationale: tier === 'high' ? `Influences decisions about people${match ? ` in a sensitive use ("${match}")` : ''}.` : tier === 'limited' ? 'People interact with it directly; transparency obligations apply.' : 'No high-risk use or direct interaction detected.', sourceRefs: r }],
        limitations: ['Keyword-based classification; confirm against the EU AI Act annexes.'],
        confidence: 'low',
      };
    },
  },
  {
    type: 'ai_change_impact',
    title: 'AI change impact',
    targetType: 'ai_model_change',
    permissions: ['ai_system.read'],
    instructions: 'Assess the impact of this AI model change. Suggest "reassessment" (yes | no) and "changeRisk" (low | medium | high | critical). List what must be re-tested, re-evaluated or re-documented as points.',
    async load(deps, id) {
      const c = await deps.prisma.aiModelChange.findFirst({ where: { id, organizationId: deps.organizationId }, include: { aiSystem: true } });
      if (!c) throw notFound('AI model change');
      const evaluations = await deps.prisma.aiEvaluation.findMany({ where: { organizationId: deps.organizationId, aiSystemId: c.aiSystemId }, select: { id: true, evaluationType: true, result: true }, orderBy: { createdAt: 'desc' }, take: 10 });
      return {
        target: { type: 'ai_model_change', id, label: `${c.aiSystem.name}: ${c.changeType}` },
        sources: [
          { ref: 'S1', type: 'ai_model_change', recordId: c.id, label: `${c.aiSystem.name} change`, version: c.createdAt.toISOString(), segments: [{ locator: 'change', text: JSON.stringify({ system: c.aiSystem.name, lifecycle: c.aiSystem.lifecycleStatus, riskTier: c.aiSystem.riskTier, changeType: c.changeType, description: c.changeDescription, previous: c.previousVersion, next: c.newVersion, declaredRisk: c.changeRisk }) }] },
          { ref: 'S2', type: 'ai_evaluations', recordId: c.aiSystemId, label: 'Previous evaluations', version: String(evaluations.length), segments: evaluations.map((e) => ({ locator: e.id, text: `${e.evaluationType}: ${e.result}` })) },
        ],
        limitations: [],
        allowedValues: { reassessment: ['yes', 'no'], changeRisk: SEVERITIES },
      };
    },
    mock(p) {
      const c = parse<{ system: string; lifecycle: string; riskTier: string; changeType: string; description: string; declaredRisk: string }>(p.sources[0]);
      const r = ref('S1', 'change');
      const major = ['provider', 'intended_purpose', 'data'].includes(c.changeType) || c.riskTier === 'high';
      const risk = c.riskTier === 'high' || c.changeType === 'intended_purpose' ? 'high' : major ? 'medium' : c.declaredRisk;
      const evals = p.sources[1].segments;
      return {
        summary: `${c.system}: ${c.changeType.replace(/_/g, ' ')} change; ${major ? 'reassessment recommended' : 'targeted re-testing is enough'}.`,
        points: [
          ...evals.map((e) => ({ text: `Re-run evaluation "${e.text.split(':')[0]}" against the new version.`, sourceRefs: ref('S2', e.locator) })),
          { text: c.changeType === 'intended_purpose' ? 'Update the intended purpose, affected people and risk tier, then re-approve deployment.' : 'Update the model version and known limitations in the registration.', sourceRefs: r },
        ],
        suggestions: [
          { label: 'reassessment', value: major ? 'yes' : 'no', rationale: major ? 'Provider, purpose or data changes, or a high-risk system, need a new assessment.' : 'A version change on a lower-risk system can rely on re-evaluation.', sourceRefs: r },
          { label: 'changeRisk', value: risk, rationale: `Based on the change type (${c.changeType}) and the system tier (${c.riskTier}).`, sourceRefs: r },
        ],
        limitations: ['Rule-based impact assessment.'],
        confidence: 'medium',
      };
    },
  },

  // ── F11 Policy drafting ──
  {
    type: 'policy_draft',
    title: 'Policy draft',
    targetType: 'organization',
    permissions: ['control.read'],
    maxOutputTokens: 3500,
    instructions:
      'Draft a concise, auditable policy on the requested topic for this organization, based only on the selected controls and their implementation notes. Suggest the policy title with label "title". Write each section or policy statement as a point in the form "Section heading: statement", citing the control it comes from. Cover purpose, scope, roles, the policy statements, exceptions and review. Use "must" for requirements. Do not invent tools, numbers or commitments the controls do not state.',
    async load(deps, id, options) {
      if (id !== deps.organizationId) throw notFound('Organization');
      const org = await deps.prisma.organization.findUniqueOrThrow({ where: { id }, select: { name: true } });
      const controls = await deps.prisma.control.findMany({ where: { organizationId: id, active: true, ...(options.controlIds?.length ? { id: { in: options.controlIds } } : {}) }, include: { implementations: { where: { organizationId: id }, take: 1 } }, orderBy: { controlCode: 'asc' }, take: 40 });
      const topic = options.topic?.trim() || 'Information security';
      const topicTerms = terms(topic);
      const relevant = options.controlIds?.length ? controls : controls.filter((c) => shared(terms(`${c.title} ${c.description} ${c.category}`), topicTerms) > 0);
      return {
        target: { type: 'organization', id, label: `${topic} policy` },
        sources: [
          { ref: 'S1', type: 'policy_request', recordId: id, label: 'Request', version: '1', segments: [{ locator: 'request', text: JSON.stringify({ organization: org.name, topic }) }] },
          ...relevant.map((c, i) => ({ ref: `S${i + 2}`, type: 'control', recordId: c.id, label: `${c.controlCode} ${c.title}`, version: String(c.version), segments: [{ locator: c.controlCode, text: `${c.title}. ${c.description}${c.implementations[0]?.implementationNotes ? ` Implementation: ${c.implementations[0].implementationNotes}` : ''}` }] })),
        ],
        limitations: relevant.length ? [] : ['No controls match this topic; select controls explicitly for a useful draft.'],
      };
    },
    mock(p) {
      const req = parse<{ organization: string; topic: string }>(p.sources[0]);
      const controls = p.sources.filter((s) => s.type === 'control');
      const r = ref('S1', 'request');
      const points: DraftOutput['points'] = [
        { text: `Purpose: This policy sets out how ${req.organization} manages ${req.topic.toLowerCase()} to protect its information and meet its compliance obligations.`, sourceRefs: r },
        { text: `Scope: This policy applies to all employees, contractors and systems of ${req.organization} that are in scope of the controls below.`, sourceRefs: r },
        { text: 'Roles: Control owners must operate their controls and keep evidence current. The GRC manager must monitor compliance and report exceptions.', sourceRefs: r },
        ...controls.map((c) => ({ text: `Policy statement (${c.label.split(' ')[0]}): ${c.segments[0].text.split(' Implementation:')[0]}`, sourceRefs: ref(c.ref, c.segments[0].locator) })),
        { text: 'Exceptions: Exceptions must be requested in writing, risk-assessed and approved through the risk acceptance process with an expiry date.', sourceRefs: r },
        { text: 'Review: This policy must be reviewed at least annually and after significant changes.', sourceRefs: r },
      ];
      return { summary: `${req.topic} policy for ${req.organization}, built from ${controls.length} control(s).`, points: points.slice(0, 40), suggestions: [{ label: 'title', value: `${req.topic} Policy`, rationale: 'From the requested topic.', sourceRefs: r }], limitations: [...p.limitations, 'Template policy assembled from control descriptions; tailor the wording before approval.'], confidence: 'medium' };
    },
  },

  // ── F10 Ask the platform ──
  {
    type: 'platform_answer',
    title: 'Answer from your data',
    targetType: 'organization',
    permissions: ['dashboard.read'],
    instructions: 'Answer the question using only the records and metrics provided. Be direct and specific (names, keys, dates, counts). Cite every fact. If the records do not contain the answer, say so plainly.',
    async load(deps, id, options) {
      if (id !== deps.organizationId) throw notFound('Organization');
      const question = (options.question ?? '').trim().slice(0, 500);
      const q = terms(question);
      const now = new Date();
      const sources: Source[] = [{ ref: 'S1', type: 'question', recordId: id, label: 'Question', version: '1', segments: [{ locator: 'question', text: question }] }];
      const add = (type: string, label: string, rows: Array<{ id: string; key: string; text: string }>) => {
        const matched = rows.map((r) => ({ ...r, score: shared(terms(r.text), q) })).filter((r) => r.score > 0 || q.size === 0).sort((a, b) => b.score - a.score).slice(0, 15);
        if (matched.length) sources.push({ ref: `S${sources.length + 1}`, type, recordId: id, label, version: now.toISOString(), segments: matched.map((r) => ({ locator: r.key, text: r.text })) });
      };
      const metrics: string[] = [];
      const org = deps.organizationId;
      if (deps.can('risk.read')) {
        const risks = await deps.prisma.risk.findMany({ where: { organizationId: org, archivedAt: null }, select: { id: true, riskKey: true, title: true, status: true, inherentRating: true, residualRating: true, category: true }, take: 300 });
        metrics.push(`Active risks: ${risks.length} (${LEVELS.map((l) => `${risks.filter((r) => (r.residualRating ?? r.inherentRating) === l).length} ${l}`).join(', ')})`);
        add('risks', 'Risks', risks.map((r) => ({ id: r.id, key: r.riskKey, text: `${r.riskKey} ${r.title} | ${r.category} | ${r.status} | rating ${r.residualRating ?? r.inherentRating} risk` })));
      }
      if (deps.can('finding.read')) {
        const findings = await deps.prisma.finding.findMany({ where: { organizationId: org, status: { notIn: ['closed', 'accepted'] } }, select: { id: true, findingKey: true, title: true, severity: true, status: true, dueDate: true }, take: 300 });
        metrics.push(`Open findings: ${findings.length}, overdue: ${findings.filter((f) => f.dueDate && f.dueDate < now).length}`);
        add('findings', 'Open findings', findings.map((f) => ({ id: f.id, key: f.findingKey, text: `${f.findingKey} ${f.title} | ${f.severity} | ${f.status}${f.dueDate ? ` | due ${day(f.dueDate)}${f.dueDate < now ? ' overdue' : ''}` : ''} finding` })));
      }
      if (deps.can('remediation.read')) {
        const tasks = await deps.prisma.remediationTask.findMany({ where: { organizationId: org, status: { in: ['open', 'in_progress', 'blocked'] } }, select: { id: true, title: true, status: true, dueDate: true, priority: true }, take: 300 });
        metrics.push(`Open remediation tasks: ${tasks.length}, overdue: ${tasks.filter((t) => t.dueDate && t.dueDate < now).length}`);
        add('remediation', 'Remediation tasks', tasks.map((t) => ({ id: t.id, key: t.title.slice(0, 60), text: `${t.title} | ${t.status} | ${t.priority}${t.dueDate ? ` | due ${day(t.dueDate)}${t.dueDate < now ? ' overdue' : ''}` : ''} remediation task` })));
      }
      if (deps.can('control.read')) {
        const controls = await deps.prisma.control.findMany({ where: { organizationId: org, active: true }, select: { id: true, controlCode: true, title: true, category: true, implementations: { select: { status: true }, take: 1 }, tests: { select: { result: true }, orderBy: { startedAt: 'desc' }, take: 1 } }, take: 300 });
        metrics.push(`Controls: ${controls.length}, failing latest test: ${controls.filter((c) => c.tests[0]?.result === 'fail').length}`);
        add('controls', 'Controls', controls.map((c) => ({ id: c.id, key: c.controlCode, text: `${c.controlCode} ${c.title} | ${c.category} | ${c.implementations[0]?.status ?? 'not assessed'} | latest test ${c.tests[0]?.result ?? 'none'} control` })));
      }
      if (deps.can('evidence.read')) {
        const evidence = await deps.prisma.evidence.findMany({ where: { organizationId: org, archivedAt: null }, select: { id: true, title: true, expiresAt: true, reviewStatus: true }, take: 300 });
        metrics.push(`Evidence: ${evidence.length}, expired: ${evidence.filter((e) => e.expiresAt && e.expiresAt <= now).length}, awaiting review: ${evidence.filter((e) => e.reviewStatus === 'pending_review').length}`);
        add('evidence', 'Evidence', evidence.map((e) => ({ id: e.id, key: e.title.slice(0, 60), text: `${e.title} | ${e.reviewStatus}${e.expiresAt ? ` | expires ${day(e.expiresAt)}${e.expiresAt <= now ? ' expired' : ''}` : ''} evidence document` })));
      }
      if (deps.can('vendor.read')) {
        const vendors = await deps.prisma.vendor.findMany({ where: { organizationId: org }, select: { id: true, name: true, status: true, riskTier: true, nextAssessmentAt: true }, take: 300 });
        metrics.push(`Vendors: ${vendors.length}, reassessment overdue: ${vendors.filter((v) => v.nextAssessmentAt && v.nextAssessmentAt < now).length}`);
        add('vendors', 'Vendors', vendors.map((v) => ({ id: v.id, key: v.name, text: `${v.name} | ${v.status} | tier ${v.riskTier ?? 'not assessed'}${v.nextAssessmentAt ? ` | reassessment ${day(v.nextAssessmentAt)}${v.nextAssessmentAt < now ? ' overdue' : ''}` : ''} vendor supplier third party` })));
      }
      if (deps.can('ai_system.read')) {
        const systems = await deps.prisma.aiSystem.findMany({ where: { organizationId: org }, select: { id: true, name: true, lifecycleStatus: true, riskTier: true }, take: 200 });
        add('ai_systems', 'AI systems', systems.map((s) => ({ id: s.id, key: s.name, text: `${s.name} | ${s.lifecycleStatus} | tier ${s.riskTier} ai system model` })));
      }
      sources.push({ ref: `S${sources.length + 1}`, type: 'metrics', recordId: id, label: 'Current metrics', version: now.toISOString(), segments: metrics.map((m) => ({ locator: m.split(':')[0], text: m })) });
      return { target: { type: 'organization', id, label: 'Question' }, sources, limitations: question ? [] : ['No question was asked.'] };
    },
    mock(p) {
      const records = p.sources.filter((s) => !['question', 'metrics'].includes(s.type));
      const metrics = p.sources.find((s) => s.type === 'metrics');
      const points = records.flatMap((s) => s.segments.slice(0, 8).map((seg) => ({ text: seg.text.replace(/ (risk|finding|remediation task|control|evidence document|vendor supplier third party|ai system model)$/, ''), sourceRefs: ref(s.ref, seg.locator) })));
      return {
        summary: points.length ? `Found ${points.length} matching record(s) across ${records.map((s) => s.label.toLowerCase()).join(', ')}.` : 'No records matched the question. Try different words, such as a record key, vendor name or status.',
        points: [...(metrics ? metrics.segments.map((m) => ({ text: m.text, sourceRefs: ref(metrics.ref, m.locator) })) : []), ...points].slice(0, 40),
        suggestions: [],
        limitations: ['Keyword search over your records without a language model; it lists matches rather than reasoning about them.'],
        confidence: 'medium',
      };
    },
  },

  // ── F3 Customer security questionnaire answers ──
  {
    type: 'questionnaire_answers',
    title: 'Questionnaire answers',
    targetType: 'trust_questionnaire',
    permissions: ['control.read'],
    maxOutputTokens: 3500,
    instructions:
      'Answer each customer security question for this organization using only the controls, implementation notes and evidence provided. For each question add one suggestion with label = the item id and value yes | no | partial | not_applicable | unknown; put the answer text a customer would read (2–4 sentences, factual, no marketing) in the rationale and cite the controls/evidence used. Use "unknown" when the sources do not answer the question; never guess.',
    async load(deps, id, options) {
      const qn = await deps.prisma.trustQuestionnaire.findFirst({ where: { id, organizationId: deps.organizationId } });
      if (!qn) throw notFound('Questionnaire');
      const items = await deps.prisma.trustQuestionnaireItem.findMany({ where: { organizationId: deps.organizationId, questionnaireId: id, ...(options.itemIds?.length ? { id: { in: options.itemIds } } : {}) }, orderBy: { sortOrder: 'asc' }, take: 12 });
      const questionTerms = terms(items.map((i) => i.questionText).join(' '));
      const [controls, evidence] = await Promise.all([
        deps.prisma.control.findMany({ where: { organizationId: deps.organizationId, active: true }, include: { implementations: { where: { organizationId: deps.organizationId }, take: 1 } }, take: 300 }),
        deps.prisma.evidence.findMany({ where: { organizationId: deps.organizationId, archivedAt: null, reviewStatus: 'approved', classification: { not: 'restricted' } }, select: { id: true, title: true, description: true, expiresAt: true }, take: 300 }),
      ]);
      const rank = <T>(rows: T[], text: (r: T) => string, n: number) => rows.map((r) => ({ r, s: shared(terms(text(r)), questionTerms) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.r);
      const topControls = rank(controls, (c) => `${c.title} ${c.description} ${c.category}`, 25);
      const topEvidence = rank(evidence, (e) => `${e.title} ${e.description ?? ''}`, 15);
      return {
        target: { type: 'trust_questionnaire', id, label: `${qn.customerName}: ${qn.title}` },
        sources: [
          { ref: 'S1', type: 'questions', recordId: id, label: 'Questions', version: String(qn.version), segments: items.map((i) => ({ locator: i.id, text: `${i.section ? `[${i.section}] ` : ''}${i.questionText}` })) },
          { ref: 'S2', type: 'controls', recordId: deps.organizationId, label: 'Controls', version: String(topControls.length), segments: topControls.map((c) => ({ locator: c.controlCode, text: `${c.controlCode} ${c.title}: ${c.description} | status ${c.implementations[0]?.status ?? 'not_assessed'}${c.implementations[0]?.implementationNotes ? ` | ${c.implementations[0].implementationNotes}` : ''}` })) },
          { ref: 'S3', type: 'evidence', recordId: deps.organizationId, label: 'Approved evidence', version: String(topEvidence.length), segments: topEvidence.map((e) => ({ locator: e.title.slice(0, 80), text: `${e.title}${e.description ? `: ${e.description}` : ''}${e.expiresAt ? ` (valid until ${day(e.expiresAt)})` : ''}` })) },
        ],
        limitations: [],
        allowedValues: Object.fromEntries(items.map((i) => [i.id, SHORT_ANSWERS])),
      };
    },
    mock(p) {
      const questions = p.sources[0].segments;
      const controls = p.sources[1].segments;
      const evidence = p.sources[2].segments;
      const suggestions: DraftOutput['suggestions'] = questions.map((q) => {
        const qt = terms(q.text);
        const c = controls.map((x) => ({ x, s: shared(terms(x.text), qt) })).filter((m) => m.s >= 2).sort((a, b) => b.s - a.s).slice(0, 2).map((m) => m.x);
        const e = evidence.map((x) => ({ x, s: shared(terms(x.text), qt) })).filter((m) => m.s >= 2).sort((a, b) => b.s - a.s).slice(0, 2).map((m) => m.x);
        if (!c.length) return { label: q.locator, value: 'unknown', rationale: 'No control in the platform answers this question. Please answer it manually.', sourceRefs: ref('S1', q.locator) };
        const statuses = c.map((x) => x.text.match(/\| status (\w+)/)?.[1] ?? 'not_assessed');
        const value = statuses.includes('implemented') ? 'yes' : statuses.some((s) => ['partially_implemented', 'in_progress'].includes(s)) ? 'partial' : statuses.every((s) => s === 'not_applicable') ? 'not_applicable' : 'unknown';
        const desc = c.map((x) => x.text.split(' | ')[0].replace(/^\S+ /, '')).join(' ');
        const answer = value === 'unknown' ? `Related control(s) exist but are not yet assessed: ${desc}` : `${value === 'yes' ? 'Yes.' : value === 'partial' ? 'Partially.' : 'Not applicable.'} ${desc}${e.length ? ` Supporting evidence: ${e.map((x) => x.locator).join('; ')}.` : ''}`;
        return { label: q.locator, value, rationale: answer.slice(0, 2000), sourceRefs: [...c.map((x) => ({ sourceId: 'S2', locator: x.locator })), ...e.map((x) => ({ sourceId: 'S3', locator: x.locator }))] };
      });
      return { summary: `Drafted ${suggestions.filter((s) => s.value !== 'unknown').length} of ${questions.length} answer(s); ${suggestions.filter((s) => s.value === 'unknown').length} need manual input.`, points: [], suggestions, limitations: ['Answers matched by keywords to control descriptions; review every answer before sending it to the customer.'], confidence: 'low' };
    },
  },
];

/** Every task: the core drafting tasks plus the agent tasks. */
export const ALL_TASKS: TaskDef[] = [...TASKS, ...AGENT_TASKS];
export const ALL_TASKS_BY_TYPE = new Map<ArtifactType, TaskDef>(ALL_TASKS.map((t) => [t.type, t]));
