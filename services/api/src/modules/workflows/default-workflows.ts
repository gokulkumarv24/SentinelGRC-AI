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
    key: 'ai_model_change',
    name: 'AI model or purpose change',
    description: 'Requests reassessment and notifies the AI governance officer when a model, provider or purpose changes.',
    triggerType: 'event',
    configuration: { handler: 'notify_ai_change', event: 'ai_model_change.created' },
  },
];
