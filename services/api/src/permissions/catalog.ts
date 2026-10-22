// Central permission matrix (spec §2). This file is the single source of truth:
// guards enforce it, the seed writes it to the database, and docs/SECURITY.md is
// generated from it by `npm run docs:permissions`.

export const PERMISSIONS = {
  // Organization & administration
  'org.read': 'View organization profile',
  'org.manage': 'Edit organization profile and settings',
  'member.read': 'View members and their roles',
  'member.manage': 'Invite, suspend and remove members',
  'role.assign': 'Grant or revoke member roles',
  'risk_policy.manage': 'Change risk and vendor scoring policies',
  'notification_settings.manage': 'Change organization notification settings',
  // Frameworks, controls, mappings
  'framework.read': 'View frameworks and requirements',
  'framework.manage': 'Import and configure frameworks',
  'mapping.read': 'View control mappings',
  'mapping.manage': 'Create and edit control mappings',
  'mapping.review': 'Approve or reject control mappings',
  'control.read': 'View controls and implementations',
  'control.create': 'Create controls',
  'control.update': 'Edit controls, implementation status and applicability',
  'control.assign': 'Assign control owners and review schedules',
  'control_test.read': 'View control test results',
  'control_test.run': 'Run automated control tests',
  'control_test.manual': 'Record manual control test results',
  // Evidence
  'evidence.read': 'View evidence metadata',
  'evidence.upload': 'Upload evidence',
  'evidence.update': 'Edit evidence metadata',
  'evidence.link': 'Link and unlink evidence',
  'evidence.review': 'Approve or reject evidence',
  'evidence.download': 'Download evidence files',
  'evidence.archive': 'Archive evidence',
  // Risks, findings, remediation
  'risk.read': 'View risks',
  'risk.create': 'Create risks',
  'risk.update': 'Edit risks and scoring',
  'risk.acceptance.request': 'Request risk acceptance',
  'risk.acceptance.decide': 'Approve or reject risk acceptance',
  'finding.read': 'View findings',
  'finding.create': 'Create findings',
  'finding.update': 'Triage and update findings',
  'finding.close': 'Close or accept findings',
  'remediation.read': 'View remediation tasks',
  'remediation.create': 'Create remediation tasks',
  'remediation.update': 'Update and complete remediation tasks',
  // Third-party risk
  'vendor.read': 'View vendors',
  'vendor.create': 'Create vendors',
  'vendor.update': 'Edit vendors',
  'vendor.lifecycle': 'Move vendors through lifecycle states',
  'vendor.contacts.read': 'View vendor contact details',
  'vendor_assessment.read': 'View vendor assessments',
  'vendor_assessment.manage': 'Create assessments and record responses',
  'vendor_assessment.review': 'Review assessment responses',
  'vendor_assessment.decide': 'Approve or reject vendors after assessment',
  'vendor_portal.manage': 'Issue and revoke vendor portal invitations',
  'questionnaire.manage': 'Manage questionnaire templates',
  // AI governance
  'ai_system.read': 'View AI systems',
  'ai_system.create': 'Register AI systems',
  'ai_system.update': 'Edit AI systems',
  'ai_system.lifecycle': 'Move AI systems through lifecycle states',
  'ai_assessment.manage': 'Create and complete AI assessments',
  'ai_assessment.decide': 'Approve or reject AI assessments and deployments',
  'ai_evaluation.manage': 'Record AI evaluations',
  'ai_incident.manage': 'Record and manage AI incidents',
  'ai_change.manage': 'Record AI model changes',
  'ai_change.review': 'Review AI model changes',
  // Automation
  'workflow.read': 'View workflows and runs',
  'workflow.manage': 'Configure workflows',
  'workflow.run': 'Trigger workflows manually',
  'workflow.retry': 'Retry failed workflow runs',
  'integration.read': 'View integrations and sync history',
  'integration.manage': 'Configure integrations',
  'integration.sync': 'Test and sync integrations',
  // AI assistant
  'assistant.use': 'Request AI drafts',
  'assistant.review': 'Accept or reject AI drafts',
  // Trust desk (customer security questionnaires)
  'trust.read': 'View customer security questionnaires and the answer library',
  'trust.manage': 'Create customer questionnaires and approve their answers',
  // Reports & audit
  'report.read': 'View report history',
  'report.generate': 'Generate reports',
  'report.download': 'Download reports',
  'report.schedule': 'Schedule recurring reports',
  'audit.read': 'View the audit log',
  'dashboard.read': 'View dashboards',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const READ_ALL: Permission[] = ALL_PERMISSIONS.filter(
  (p) => (p.endsWith('.read') && p !== 'vendor.contacts.read') || p === 'dashboard.read',
);

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: Permission[];
}

export const ROLES = {
  org_admin: {
    name: 'Organization Admin',
    description: 'Manages organization profile, members, roles, settings, frameworks and integrations.',
    permissions: [
      ...READ_ALL,
      'org.manage', 'member.manage', 'role.assign', 'risk_policy.manage', 'notification_settings.manage',
      'framework.manage', 'integration.manage', 'integration.sync', 'workflow.manage', 'workflow.run',
      'workflow.retry', 'vendor.contacts.read', 'report.generate', 'report.download', 'report.schedule',
      'evidence.download', 'questionnaire.manage',
    ],
  },
  grc_manager: {
    name: 'GRC Manager',
    description: 'Manages framework mappings, controls, assessments, reports and risk workflows.',
    permissions: [
      ...READ_ALL,
      'framework.manage', 'mapping.manage', 'mapping.review', 'control.create', 'control.update',
      'control.assign', 'control_test.run', 'control_test.manual', 'evidence.upload', 'evidence.update',
      'evidence.link', 'evidence.review', 'evidence.download', 'evidence.archive', 'risk.create',
      'risk.update', 'risk.acceptance.request', 'risk.acceptance.decide', 'finding.create',
      'finding.update', 'finding.close', 'remediation.create', 'remediation.update',
      'vendor_assessment.review', 'ai_assessment.manage', 'workflow.run', 'workflow.retry',
      'assistant.use', 'assistant.review', 'report.generate', 'report.download', 'report.schedule',
      'questionnaire.manage', 'risk_policy.manage', 'trust.manage',
    ],
  },
  security_analyst: {
    name: 'Security Analyst',
    description: 'Runs control tests, reviews evidence, creates findings and recommends remediation.',
    permissions: [
      ...READ_ALL,
      'control.update', 'control_test.run', 'control_test.manual', 'evidence.upload', 'evidence.update',
      'evidence.link', 'evidence.review', 'evidence.download', 'risk.create', 'risk.update',
      'risk.acceptance.request', 'finding.create', 'finding.update', 'remediation.create',
      'remediation.update', 'vendor_assessment.review', 'assistant.use', 'assistant.review',
      'workflow.run', 'integration.sync', 'report.generate', 'report.download', 'trust.manage',
    ],
  },
  risk_owner: {
    name: 'Risk Owner',
    description: 'Manages assigned risks and remediation; may request but not self-approve acceptance.',
    permissions: [
      'dashboard.read', 'org.read', 'member.read', 'risk.read', 'risk.update', 'risk.acceptance.request',
      'finding.read', 'finding.update', 'remediation.read', 'remediation.update', 'control.read',
      'control_test.read', 'evidence.read', 'evidence.upload', 'evidence.link', 'evidence.download',
      'framework.read', 'mapping.read', 'report.read', 'report.download',
    ],
  },
  vendor_manager: {
    name: 'Vendor Manager',
    description: 'Manages vendors, questionnaires, assessments and vendor remediation.',
    permissions: [
      ...READ_ALL,
      'vendor.create', 'vendor.update', 'vendor.lifecycle', 'vendor.contacts.read',
      'vendor_assessment.manage', 'vendor_assessment.review', 'vendor_assessment.decide',
      'vendor_portal.manage', 'questionnaire.manage', 'evidence.upload', 'evidence.link',
      'evidence.review', 'evidence.download', 'finding.create', 'finding.update', 'remediation.create',
      'remediation.update', 'risk.create', 'risk.update', 'risk.acceptance.request', 'assistant.use',
      'assistant.review', 'report.generate', 'report.download',
    ],
  },
  ai_governance_officer: {
    name: 'AI Governance Officer',
    description: 'Manages AI inventory, AI assessments and lifecycle approvals.',
    permissions: [
      ...READ_ALL,
      'ai_system.create', 'ai_system.update', 'ai_system.lifecycle', 'ai_assessment.manage',
      'ai_assessment.decide', 'ai_evaluation.manage', 'ai_incident.manage', 'ai_change.manage',
      'ai_change.review', 'evidence.upload', 'evidence.link', 'evidence.review', 'evidence.download',
      'risk.create', 'risk.update', 'risk.acceptance.request', 'finding.create', 'finding.update',
      'remediation.create', 'remediation.update', 'assistant.use', 'assistant.review',
      'report.generate', 'report.download',
    ],
  },
  auditor: {
    name: 'Auditor / Read-only Reviewer',
    description: 'Reads authorized records, evidence metadata, reports and audit history; cannot change anything.',
    permissions: [...READ_ALL, 'report.download'],
  },
  contributor: {
    name: 'Contributor',
    description: 'Creates or updates permitted records; cannot change roles, settings or approve decisions.',
    permissions: [
      'dashboard.read', 'org.read', 'member.read', 'framework.read', 'mapping.read', 'control.read',
      'control_test.read', 'evidence.read', 'evidence.upload', 'evidence.update', 'evidence.link',
      'risk.read', 'risk.create', 'risk.update', 'finding.read', 'finding.create', 'remediation.read',
      'remediation.update', 'vendor.read', 'vendor_assessment.read', 'vendor_assessment.manage',
      'ai_system.read', 'ai_system.update', 'assistant.use', 'report.read',
    ],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/** Roles only an org admin may grant; nobody may grant roles to themselves (spec §2.2). */
export const PRIVILEGED_ROLES: RoleKey[] = ['org_admin', 'grc_manager'];

export function permissionsForRoles(roleKeys: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const key of roleKeys) {
    const role = (ROLES as Record<string, RoleDefinition>)[key];
    role?.permissions.forEach((p) => result.add(p));
  }
  return result;
}
