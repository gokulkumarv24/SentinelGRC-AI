// Response shapes of the SentinelGRC API used by the UI.

export type Severity = "low" | "medium" | "high" | "critical";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRef {
  id: string;
  displayName: string;
  email?: string;
}

export interface Me {
  user: { id: string; email: string; displayName: string; isPlatformAdmin: boolean; mustChangePassword: boolean; lastLoginAt: string | null };
  activeOrganizationId: string | null;
  permissions: string[];
  roles: string[];
  organizations: Array<{ id: string; name: string; slug: string; isDemo: boolean; timezone: string; roles: string[] }>;
}

export interface Risk {
  id: string;
  riskKey: string;
  title: string;
  description: string;
  category: string;
  sourceType: string;
  sourceId: string | null;
  likelihood: number;
  impact: number;
  inherentScore: number;
  inherentRating: Severity;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  residualRating: Severity | null;
  residualRationale: string | null;
  scoringPolicyVersion: number;
  riskOwnerId: string | null;
  owner: UserRef | null;
  status: string;
  treatment: string;
  treatmentPlan: string | null;
  acceptanceRationale: string | null;
  acceptedAt: string | null;
  acceptanceExpiresAt: string | null;
  reviewDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RiskDetail extends Risk {
  controls: Array<{ id: string; relationship: string; effectivenessRating: string; rationale: string | null; control: { id: string; controlCode: string; title: string } }>;
  history: Array<{ id: string; previousValues: Record<string, unknown>; newValues: Record<string, unknown>; changedBy: string | null; changedAt: string; rationale: string | null }>;
  acceptances: RiskAcceptance[];
  links: Array<{ id: string; entityType: string; entityId: string; label: string }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string }>;
  evidence: Array<{ linkId: string; id: string; title: string; expiresAt: string | null; reviewStatus: string }>;
}

export interface RiskAcceptance {
  id: string;
  riskId: string;
  requestedBy: string;
  requestedAt: string;
  rationale: string;
  scope: string | null;
  expiryDate: string;
  riskScoreAtRequest: number;
  decision: "pending" | "approved" | "rejected" | "expired" | "withdrawn";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionRationale: string | null;
  requestedByRef?: { displayName: string } | null;
  decidedByRef?: { displayName: string } | null;
  risk?: { id: string; riskKey: string; title: string; inherentRating: Severity; residualRating: Severity | null; riskOwnerId: string | null };
}

export interface Finding {
  id: string;
  findingKey: string;
  title: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  category: string | null;
  severity: Severity;
  severityRationale: string | null;
  status: string;
  controlId: string | null;
  riskId: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  detectionCount: number;
  assignedTo: string | null;
  assignee: UserRef | null;
  dueDate: string | null;
  noDueDateReason: string | null;
  closedAt: string | null;
  closureRationale: string | null;
  version: number;
  createdAt: string;
  _count?: { tasks: number };
}

export interface FindingDetail extends Finding {
  control: { id: string; controlCode: string; title: string } | null;
  risk: { id: string; riskKey: string; title: string; status: string } | null;
  events: Array<{ id: string; eventType: string; fromStatus: string | null; toStatus: string | null; actorId: string | null; rationale: string | null; sourceReference: string | null; createdAt: string }>;
  tasks: RemediationTask[];
  evidence: Array<{ linkId: string; id: string; title: string; reviewStatus: string }>;
  recentTests: Array<{ id: string; result: string; summary: string; startedAt: string }>;
}

export interface RemediationTask {
  id: string;
  findingId: string | null;
  title: string;
  description: string | null;
  ownerId: string | null;
  owner: UserRef | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "blocked" | "completed" | "cancelled";
  dueDate: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  completionEvidenceId: string | null;
  vendorResponse: string | null;
  internalReviewStatus: string;
  version: number;
  createdAt: string;
  finding?: { id: string; findingKey: string; title: string; severity: Severity; status?: string } | null;
}

export type EvidenceState = "missing" | "expired" | "expiring" | "current" | "no_expiry";

export interface Evidence {
  id: string;
  title: string;
  description: string | null;
  originalFilename: string | null;
  mediaType: string | null;
  sizeBytes: number | null;
  sha256Checksum: string | null;
  sourceType: string;
  sourceUri: string | null;
  collectedAt: string | null;
  validFrom: string | null;
  expiresAt: string | null;
  classification: "public" | "internal" | "confidential" | "restricted";
  reviewStatus: "unreviewed" | "pending_review" | "approved" | "rejected";
  reviewNotes: string | null;
  reviewedAt: string | null;
  scanStatus: string;
  isDemo: boolean;
  archivedAt: string | null;
  createdAt: string;
  hasFile: boolean;
  owner: UserRef | null;
  state: EvidenceState;
  _count?: { links: number };
}

export interface EvidenceDetail extends Evidence {
  uploadedBy: UserRef | null;
  links: Array<{ id: string; entityType: string; entityId: string; purpose: string | null; reviewStatus: string; label: string; createdAt: string }>;
  history: AuditEvent[];
  accessLog: Array<{ id: string; action: string; userId: string | null; createdAt: string }>;
}

export interface Control {
  id: string;
  controlCode: string;
  title: string;
  description: string;
  category: string;
  isIllustrative: boolean;
  reviewFrequencyDays: number;
  active: boolean;
  version: number;
  updatedAt: string;
  implementation: {
    id: string;
    status: string;
    owner: UserRef | null;
    ownerId: string | null;
    applicabilityRationale: string | null;
    soaIncluded: boolean;
    soaJustification: string | null;
    implementationNotes: string | null;
    lastReviewedAt: string | null;
    nextReviewAt: string | null;
    version: number;
  } | null;
  latestTest: { result: string; startedAt: string; summary: string; testType: string } | null;
  evidenceState: EvidenceState;
  openFindings: number;
}

export interface ControlTestRow {
  id: string;
  testType: string;
  ruleKey: string | null;
  testRuleVersion: string | null;
  result: string;
  summary: string;
  details: Record<string, unknown>;
  manualRationale: string | null;
  startedAt: string;
  completedAt: string | null;
  initiatedByName: string | null;
  findingId: string | null;
  correlationId: string;
}

export interface ControlDetail extends Omit<Control, "latestTest" | "evidenceState" | "openFindings"> {
  frameworkReferences: Array<{ mappingId: string; mappingType: string; reviewStatus: string; isIllustrative: boolean; confidence: number; rationale: string; requirement: { id: string; code: string; title: string; groupName: string | null }; framework: { id: string; name: string; version: string; key: string } }>;
  tests: ControlTestRow[];
  testConfigs: Array<{ id: string; ruleKey: string; parameters: Record<string, unknown>; frequencyHours: number; enabled: boolean; lastRunAt: string | null; nextRunAt: string | null }>;
  evidence: Array<{ linkId: string; id: string; title: string; expiresAt: string | null; reviewStatus: string; classification: string; hasFile: boolean; state: EvidenceState }>;
  risks: Array<{ id: string; riskKey: string; title: string; inherentRating: Severity; residualRating: Severity | null; status: string; relationship: string; effectivenessRating: string }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string; lastDetectedAt: string }>;
  history: AuditEvent[];
}

export interface AuditEvent {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  timestamp: string;
  requestId: string | null;
  sourceIp?: string | null;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  rationale: string | null;
  outcome: string;
  actor?: { displayName: string; email?: string } | null;
  actorUserRef?: { displayName: string } | null;
}

export interface Notification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  status: string;
  joinedAt: string;
  user: { id: string; email: string; displayName: string; lastLoginAt: string | null; status: string };
  roles: string[];
}

export interface RoleInfo {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface FrameworkRow {
  id: string;
  key: string;
  name: string;
  publisher: string;
  version: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  licenseNotes: string | null;
  description: string | null;
  isIllustrative: boolean;
  status: string;
  scope: "platform" | "organization";
  inScope: boolean;
  requirementCount: number;
  importedAt: string;
}
