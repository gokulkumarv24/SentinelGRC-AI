/**
 * Workflow definitions created for every organization (spec §12.1 triggers).
 * `handler` names map to implementations in workflow-handlers.ts.
 */
export interface DefaultWorkflow {
  key: string;
  name: string;
  description: string;
  triggerType: 'schedule' | 'event' | 'manual';
  intervalHours?: number;
  configuration: Record<string, unknown>;
}

export const DEFAULT_WORKFLOWS: DefaultWorkflow[] = [
  {
    key: 'scheduled_control_tests',
    name: 'Scheduled control tests',
    description: 'Runs every enabled automated control test that is due, records results and creates or updates findings.',
    triggerType: 'schedule',
    intervalHours: 1,
    configuration: { handler: 'run_due_control_tests' },
  },
  {
    key: 'evidence_expiry_reminders',
    name: 'Evidence expiry reminders',
    description: 'Notifies evidence owners about evidence expiring within 30 days or already expired.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'evidence_expiry', warnDays: 30 },
  },
  {
    key: 'vendor_assessment_due',
    name: 'Vendor reassessment due',
    description: 'Flags vendors whose reassessment date has passed or is within 30 days.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'vendor_assessment_due', warnDays: 30 },
  },
  {
    key: 'remediation_due',
    name: 'Remediation due and overdue',
    description: 'Reminds owners about remediation tasks due within 7 days or overdue.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'remediation_due', warnDays: 7 },
  },
  {
    key: 'risk_acceptance_expiry',
    name: 'Risk acceptance expiry',
    description: 'Expires lapsed risk acceptances (requiring re-review) and warns 30 days ahead.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'risk_acceptance_expiry', warnDays: 30 },
  },
  {
    key: 'ai_review_due',
    name: 'AI assessment review due',
    description: 'Flags AI systems whose scheduled review is due or overdue.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'ai_review_due', warnDays: 30 },
  },
  {
    key: 'control_review_due',
    name: 'Control review reminders',
    description: 'Reminds control owners when a control review is due.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'control_review_due', warnDays: 14 },
  },
  {
    key: 'integration_sync',
    name: 'Integration sync',
    description: 'Synchronizes configured integrations and records failures visibly.',
    triggerType: 'schedule',
    intervalHours: 6,
    configuration: { handler: 'integration_sync' },
  },
  {
    key: 'scheduled_reports',
    name: 'Scheduled reports',
    description: 'Generates reports for due report schedules and notifies recipients.',
    triggerType: 'schedule',
    intervalHours: 1,
    configuration: { handler: 'scheduled_reports' },
  },
  {
    key: 'evidence_retention_review',
    name: 'Evidence retention review',
    description: 'Lists archived evidence past the retention period for an administrator to review. Never deletes anything automatically.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'evidence_retention_review' },
  },
  {
    key: 'high_finding_alert',
    name: 'High/critical finding alert',
    description: 'Notifies the assignee and GRC managers when a high or critical finding is created.',
    triggerType: 'event',
    configuration: { handler: 'notify_high_finding', event: 'finding.created' },
  },
  {
    key: 'questionnaire_submitted',
    name: 'Questionnaire submitted',
    description: 'Notifies the assessor when a vendor questionnaire is submitted.',
    triggerType: 'event',
    configuration: { handler: 'notify_questionnaire_submitted', event: 'vendor_assessment.submitted' },
  },
  {
    key: 'report_generation',
    name: 'Report generation',
    description: 'Generates a requested report in the background, stores it privately and notifies the requester.',
    triggerType: 'event',
    configuration: { handler: 'generate_report', event: 'report.requested' },
  },
  {
    key: 'ai_model_change',
    name: 'AI model or purpose change',
    description: 'Requests reassessment and notifies the AI governance officer when a model, provider or purpose changes.',
    triggerType: 'event',
    configuration: { handler: 'notify_ai_change', event: 'ai_model_change.created' },
  },

  // ── AI agent jobs (modules/agent). They only prepare drafts and records for people to review; they skip
  //    quietly when AI is off, data sharing is not approved or the daily token budget is used up. ──
  {
    key: 'agent_evidence_review',
    name: 'AI agent: evidence pre-review',
    description: 'Pre-reviews every uploaded evidence file (relevance, currency, gaps) and analyses vendor documents such as SOC 2 reports and contracts, so the reviewer only confirms.',
    triggerType: 'event',
    configuration: { handler: 'agent_evidence_review', event: 'evidence.uploaded' },
  },
  {
    key: 'agent_vendor_review',
    name: 'AI agent: vendor questionnaire pre-review',
    description: 'When a vendor submits a questionnaire, suggests a review status and note for every answer and drafts follow-up questions for the vendor.',
    triggerType: 'event',
    configuration: { handler: 'agent_vendor_review', event: 'vendor_assessment.submitted' },
  },
  {
    key: 'agent_vendor_decision_memo',
    name: 'AI agent: vendor decision memo',
    description: 'When every answer is reviewed, drafts the decision, conditions and rationale for the approver from the deterministic score.',
    triggerType: 'event',
    configuration: { handler: 'agent_vendor_decision_memo', event: 'vendor_assessment.review_completed' },
  },
  {
    key: 'agent_vendor_intake',
    name: 'AI agent: vendor profile check',
    description: 'Checks each new vendor profile for inconsistent criticality, data classification or access level, missing information and questionnaire focus areas.',
    triggerType: 'event',
    configuration: { handler: 'agent_vendor_intake', event: 'vendor.created' },
  },
  {
    key: 'agent_vendor_reassessment',
    name: 'AI agent: prepare vendor reassessments',
    description: 'Creates the next assessment (same questionnaire and assessor as last time) for vendors whose reassessment is due within 14 days, and tells the vendor managers.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'agent_vendor_reassessment', warnDays: 14 },
  },
  {
    key: 'agent_vendor_monitoring',
    name: 'AI agent: weekly vendor digest',
    description: 'Ranks the vendors that need attention (overdue reassessments, findings, expired documents, high tiers) and sends the digest to vendor managers.',
    triggerType: 'schedule',
    intervalHours: 168,
    configuration: { handler: 'agent_vendor_monitoring' },
  },
  {
    key: 'agent_finding_triage',
    name: 'AI agent: finding triage',
    description: 'Suggests category, severity, owner, priority, due date, related risk and a remediation plan for every new finding.',
    triggerType: 'event',
    configuration: { handler: 'agent_finding_triage', event: 'finding.created' },
  },
  {
    key: 'agent_evidence_chaser',
    name: 'AI agent: evidence chaser',
    description: 'For evidence expiring within 14 days (or recently expired), drafts what to collect and a request to the owner, and notifies them.',
    triggerType: 'schedule',
    intervalHours: 24,
    configuration: { handler: 'agent_evidence_chaser', warnDays: 14 },
  },
  {
    key: 'agent_report_narrative',
    name: 'AI agent: report narrative',
    description: 'Writes the management summary for every generated report, using only the report’s verified numbers.',
    triggerType: 'event',
    configuration: { handler: 'agent_report_narrative', event: 'report.generated' },
  },
  {
    key: 'agent_risk_spotting',
    name: 'AI agent: risk spotting',
    description: 'Weekly, proposes new risks or re-scores from recent findings, AI incidents and high-risk vendor assessments.',
    triggerType: 'schedule',
    intervalHours: 168,
    configuration: { handler: 'agent_risk_spotting' },
  },
  {
    key: 'agent_ai_system_intake',
    name: 'AI agent: AI system intake and change impact',
    description: 'Suggests a risk tier, registration gaps and assessment focus for new AI systems, and the impact of model changes.',
    triggerType: 'event',
    configuration: { handler: 'agent_ai_system_intake', event: 'ai_system.created' },
  },
  {
    key: 'agent_ai_change_impact',
    name: 'AI agent: AI change impact',
    description: 'Assesses each recorded AI model change: what to re-test and whether a reassessment is needed.',
    triggerType: 'event',
    configuration: { handler: 'agent_ai_change_impact', event: 'ai_model_change.created' },
  },
  {
    key: 'agent_trust_questionnaire',
    name: 'AI agent: answer customer questionnaires',
    description: 'Answers customer security questionnaires from the approved answer library first, then from controls and evidence, for a person to approve.',
    triggerType: 'event',
    configuration: { handler: 'agent_trust_questionnaire', event: 'trust_questionnaire.submitted' },
  },
  {
    key: 'agent_mapping_onboarding',
    name: 'AI agent: framework mapping suggestions',
    description: 'For a framework you start using, proposes control mappings for every unmapped requirement into the review queue (run it from the framework page).',
    triggerType: 'manual',
    configuration: { handler: 'agent_mapping_onboarding' },
  },
];
