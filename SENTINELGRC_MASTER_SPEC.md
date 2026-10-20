# SentinelGRC AI --- Complete Product Requirements, Architecture & Build Specification

> **Purpose:** This is the single source of truth for building
> SentinelGRC AI with Claude Code. Give Claude Code this file as the
> primary project specification and instruct it to follow it end-to-end.
> It defines product scope, architecture, data model, security,
> workflows, APIs, UI, testing, deployment, documentation, and
> acceptance criteria.
>
> **Important:** This specification describes a deployable software
> product, not a claim of certification or legal compliance. A
> functioning GRC application does not itself make an organization ISO
> 27001 certified, SOC 2 attested, GDPR compliant, or compliant with the
> EU AI Act. Framework content, legal applicability, and control
> mappings must be verified and reviewed.

------------------------------------------------------------------------

## 0. Instructions to the coding agent

You are the lead software architect, senior full-stack engineer,
application security engineer, test engineer, and DevOps engineer for
this repository. Build the product described here completely and
carefully.

### 0.1 Non-negotiable working rules

1.  **Inspect before changing.** Start by inspecting the repository,
    existing files, package versions, runtime environment, Git state,
    and current implementation. Do not overwrite working code or
    configuration blindly.
2.  **Implement, don't merely describe.** Create real application code,
    database migrations, UI screens, tests, seed data, Docker
    configuration, deployment configuration, and documentation. Avoid
    TODO-only stubs and fake buttons.
3.  **Work in verified milestones.** Keep a
    `docs/IMPLEMENTATION_STATUS.md` updated. After each milestone run
    relevant tests, lint, type checking, migrations, and build. Fix
    failures before moving forward.
4.  **Do not claim success without evidence.** Never report that tests,
    builds, migrations, deployment, or security checks passed unless you
    actually ran them and observed the result. If a command cannot run,
    explain why and provide the exact command for the developer.
5.  **No destructive actions without approval.** Do not delete user
    files, reset Git history, overwrite an existing database, run
    production migrations, rotate secrets, deploy, or incur paid
    cloud/API costs without explicit approval.
6.  **Do not expose secrets.** Never commit `.env`, API keys, access
    tokens, passwords, private certificates, real customer data, or
    production evidence. Provide `.env.example` with placeholders only.
7.  **Secure by default.** Enforce authentication, authorization,
    organization/tenant isolation, validation, safe file handling, rate
    limiting where appropriate, auditability, and secure error responses
    on the server side.
8.  **No fake integrations.** An integration must be labelled as a
    demo/mock until it is connected, configured, tested, and its
    behavior verified. Never invent vendor data, compliance evidence,
    framework mappings, test results, or deployment URLs.
9.  **AI is advisory.** LLM output must never independently approve
    compliance, accept a risk, close a finding, authorize a vendor, or
    approve an AI system. Require a human with permission for
    consequential decisions.
10. **Prefer simple architecture.** Build a modular monolith with clear
    module boundaries. Do not introduce microservices, Kubernetes,
    Kafka, or a complex vector database unless a demonstrated
    requirement justifies them.
11. **Make decisions explicit.** If a detail is unspecified, choose a
    secure, maintainable default, document it in `docs/DECISIONS.md`,
    and proceed. Ask the user only when a decision is irreversible,
    expensive, security-critical, or genuinely blocks progress.
12. **Finish the whole path.** Every implemented feature must connect
    database → service → API → UI → tests → documentation. Do not create
    decorative screens that are not backed by working functionality.

### 0.2 Initial response and execution sequence

First inspect the repository and report: - Current directory and
repository state. - Existing frameworks, runtime versions, files, tests,
and deployment setup. - Risks to existing work. - A short implementation
plan mapped to the milestones in this file.

Then create or update the documentation and begin implementation. Do not
stop after writing a plan. Continue milestone by milestone until the
product is implemented and verified, unless blocked by credentials,
external service access, or an approval gate. Do not ask for approval
after every ordinary coding step.

### 0.3 Definition of done

A feature is done only when: - It has a usable UI and backend
behavior. - Inputs are validated and permissions are enforced. -
Database changes use migrations. - Success, empty, loading, and error
states are implemented. - Automated tests cover the important behavior
and security boundaries. - Documentation and demo data are updated. -
The relevant lint, type-check, test, and build commands have been run
where possible. - Any limitations are clearly recorded.

------------------------------------------------------------------------

## 1. Product vision

**Product name:** SentinelGRC AI\
**Category:** Enterprise Governance, Risk, Compliance, Third-Party Risk,
and AI Governance platform.\
**Primary portfolio target:** Demonstrate practical skills relevant to
IT GRC Risk and Automation Analyst roles: enterprise integrations,
automated control monitoring, evidence pipelines, risk assessments,
vendor security assessments, AI governance, reporting, and translating
technical risks into business-readable findings.

### 1.1 Core product promise

Provide one coherent application in which an organization can: -
Maintain a versioned security and AI governance framework registry. -
Map controls across frameworks with documented rationale and review
status. - Track control owners, implementation, evidence, testing, gaps,
and remediation. - Assess third-party vendors using questionnaires,
evidence, risk scoring, and approval workflows. - Inventory AI systems
and assess their lifecycle, security, privacy, fairness, transparency,
reliability, and oversight risks. - Reuse shared risks, findings,
evidence, owners, and remediation tasks across modules. - Run scheduled
control checks and integration workflows. - Use AI to summarize evidence
and draft recommendations with source references and human approval. -
Generate traceable management reports and maintain an audit trail. -
Support multiple organizations with strict tenant isolation.

### 1.2 Product principles

-   Security and traceability over flashy AI features.
-   Evidence-backed results over unsupported claims.
-   Human accountability for risk acceptance and compliance decisions.
-   Reusable shared entities rather than duplicated module-specific
    records.
-   Explainable, configurable scoring.
-   Framework versioning and explicit mapping uncertainty.
-   Accessible, responsive interface.
-   Reproducible development and deployment.
-   Demo data clearly distinguished from verified organizational
    evidence.

### 1.3 Out of scope for initial release

Do not claim or implement as if automatically guaranteed: - Automatic
certification, attestation, legal advice, or regulatory approval. -
Universal integrations with every cloud provider or GRC product. -
Autonomous production remediation or automatic risk acceptance. -
Unverified framework mappings represented as official equivalence. -
Collection of real company secrets or production evidence in the demo. -
A production-grade multi-region, high-availability deployment by
default. - A custom-trained foundational LLM. - Real external
integrations that lack authorized credentials and test access.

------------------------------------------------------------------------

## 2. Users, roles, and authorization

Implement organization-scoped role-based access control (RBAC). A user
may have different roles in different organizations if the data model
supports memberships. Every request must be authorized on the server.

### 2.1 Roles

1.  **Platform Super Admin** --- manages platform-level settings and
    organizations. Access should be tightly restricted and audited.
2.  **Organization Admin** --- manages organization profile, members,
    roles, settings, framework configuration, and integrations.
3.  **GRC Manager** --- manages framework mappings, controls,
    assessments, reports, and risk workflows.
4.  **Security Analyst** --- runs control tests, reviews evidence,
    creates findings, and recommends remediation.
5.  **Risk Owner** --- views and manages assigned risks and remediation
    tasks; may propose acceptance but cannot approve their own risk
    acceptance unless policy explicitly allows it.
6.  **Vendor Manager** --- manages vendors, questionnaires, assessments,
    and vendor remediation.
7.  **AI Governance Officer** --- manages AI inventory, AI assessments,
    and lifecycle approvals.
8.  **Auditor / Read-only Reviewer** --- reads authorized records,
    evidence metadata, reports, and audit history without editing
    records.
9.  **Vendor Respondent** --- optionally, in a later milestone, may
    access only the specific vendor questionnaire assigned to them. They
    must not see internal risk scores, other vendors, internal notes, or
    other organizations.
10. **Contributor** --- creates or updates specifically permitted
    records but cannot change roles, organization settings, or approve
    consequential decisions.

Create a centralized permission matrix in `docs/SECURITY.md`. Do not
rely on hiding buttons in the frontend; enforce permissions in API
dependencies and service methods.

### 2.2 Minimum authorization rules

-   Deny by default.
-   Verify active membership and organization scope on every request
    involving tenant data.
-   Never trust an `organization_id`, owner ID, role, status, risk
    score, or approval field supplied by the browser without server-side
    validation.
-   Do not permit cross-tenant object lookup, exports, search,
    attachments, or background jobs.
-   Users cannot grant themselves roles.
-   Privileged role changes require an authorized administrator and an
    audit event.
-   Risk acceptance, control approval, vendor approval, AI deployment
    approval, and finding closure require appropriate permissions and
    recorded rationale.
-   A person must not approve their own consequential action when
    separation of duties applies.
-   Read-only roles cannot create, modify, upload, delete, approve, or
    trigger privileged workflows.
-   Background tasks must preserve the organization and initiating actor
    context.
-   Audit events must be organization-scoped and access-controlled.

------------------------------------------------------------------------

## 3. Technology stack and engineering standards

Use stable, mutually compatible versions available at implementation
time. Pin dependencies using the chosen package manager and commit
lockfiles. Do not guess version numbers; inspect current installed tools
and official package compatibility.

### 3.1 Frontend

-   Next.js with App Router.
-   TypeScript in strict mode.
-   Tailwind CSS.
-   An accessible component library such as shadcn/ui, if compatible.
-   React Hook Form and Zod (or a comparable validated form stack).
-   A maintained charting library for dashboard charts.
-   A table solution with server-side pagination, sorting, filtering,
    and empty states.
-   Use a consistent icon library and design tokens.
-   Avoid excessive client-side state; keep server data fetching and
    mutations explicit.

### 3.2 Backend

-   Python and FastAPI.
-   Pydantic request/response schemas.
-   SQLAlchemy 2.x.
-   Alembic migrations.
-   PostgreSQL.
-   `pytest` and HTTPX for API tests.
-   A maintained password hashing library using Argon2id or an
    equivalent current recommendation.
-   Structured logging and correlation/request IDs.
-   A supported PDF-generation library and CSV export implementation.
-   Background jobs: begin with a lightweight scheduler or explicit
    worker process. If durable queue semantics become necessary, add a
    queue such as Redis-backed RQ/Celery with documented operational
    requirements. Do not hide jobs inside long-running HTTP requests.

### 3.3 Storage and deployment

-   Local filesystem storage only for development, outside the public
    web root.
-   Production-compatible object storage behind an abstraction; use an
    S3-compatible API if selected.
-   Docker Compose for local development and a single-host deployment
    option.
-   Reverse proxy with TLS termination in deployment documentation.
-   PostgreSQL backups and restore instructions.
-   Health and readiness endpoints.
-   Environment-driven configuration.
-   CI workflow for lint, type checking, tests, migration checks,
    dependency/security checks, and production builds.

### 3.4 Quality standards

-   Python type hints and clear module boundaries.
-   Formatting/linting with Ruff or equivalent.
-   TypeScript strict mode and ESLint.
-   No hardcoded credentials.
-   No broad exception swallowing.
-   No secrets in logs.
-   No direct SQL string interpolation from user input.
-   No database schema mutation at application startup in production.
-   Use migrations for all schema changes.
-   Use UTC timestamps in storage and display local time appropriately.
-   Add indexes for frequently queried organization IDs, statuses,
    owners, dates, and foreign keys.
-   Use transactions for multi-step business operations.
-   Use optimistic concurrency or version checks for sensitive edits
    where practical.

------------------------------------------------------------------------

## 4. Repository structure

Use a monorepo unless the inspected repository already has a strong,
working alternative. Adapt the structure without deleting useful
existing work.

``` text
sentinelgrc-ai/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── (auth)/
│       │   ├── (workspace)/
│       │   │   ├── dashboard/
│       │   │   ├── compliance/
│       │   │   ├── controls/
│       │   │   ├── evidence/
│       │   │   ├── risks/
│       │   │   ├── findings/
│       │   │   ├── remediation/
│       │   │   ├── vendors/
│       │   │   ├── ai-governance/
│       │   │   ├── workflows/
│       │   │   ├── reports/
│       │   │   ├── audit-log/
│       │   │   └── settings/
│       │   ├── api/                 # only if a Next.js BFF is actually needed
│       │   ├── layout.tsx
│       │   └── globals.css
│       ├── components/
│       ├── features/
│       ├── lib/
│       ├── hooks/
│       ├── tests/
│       ├── package.json
│       └── ...
├── services/
│   └── api/
│       ├── app/
│       │   ├── main.py
│       │   ├── api/v1/
│       │   ├── core/
│       │   ├── db/
│       │   ├── models/
│       │   ├── schemas/
│       │   ├── repositories/
│       │   ├── services/
│       │   ├── permissions/
│       │   ├── integrations/
│       │   ├── workflows/
│       │   ├── ai/
│       │   ├── reporting/
│       │   └── observability/
│       ├── migrations/
│       ├── tests/
│       ├── pyproject.toml
│       └── ...
├── framework-data/
│   ├── manifests/
│   ├── mappings/
│   └── README.md
├── infra/
│   ├── docker/
│   ├── compose/
│   └── deployment/
├── scripts/
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── THREAT_MODEL.md
│   ├── FRAMEWORK_GOVERNANCE.md
│   ├── OPERATIONS.md
│   ├── BACKUP_RESTORE.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   ├── DECISIONS.md
│   ├── IMPLEMENTATION_STATUS.md
│   └── DEMO_SCENARIO.md
├── .github/workflows/
├── .env.example
├── .gitignore
├── Makefile or equivalent task runner
├── README.md
└── docker-compose.yml
```

Keep feature code cohesive. Avoid circular imports. Do not create
folders without meaningful use.

------------------------------------------------------------------------

## 5. Core domain model and data rules

Use UUID primary keys unless an existing codebase has a justified
convention. Use created/updated timestamps and `created_by`/`updated_by`
where appropriate. Use explicit enums or constrained values for
statuses. Apply organization scoping consistently. Prefer soft archival
for business records where historical traceability matters; do not
hard-delete audit history.

### 5.1 Required entities

#### Organizations and identity

-   `organizations`: name, slug, industry, timezone, status, settings
    JSON, created_at.
-   `users`: email (normalized and unique according to the identity
    design), display_name, password_hash or external identity reference,
    status, last_login_at.
-   `memberships`: organization_id, user_id, status, joined_at.
-   `roles`, `permissions`, `role_permissions`, `membership_roles`.
-   `sessions` or refresh-token records if the chosen auth model
    requires them; store token hashes, expiration, revocation, and
    rotation metadata, never raw refresh tokens.
-   `invitations`: organization_id, normalized_email, role assignment,
    token hash, expiry, used_at, inviter_id.

#### Frameworks and controls

-   `frameworks`: name, publisher, version, release_date if known,
    source_url, license_notes, status, imported_at.
-   `framework_requirements`: framework_id, requirement_code, title,
    summary, official_reference, source_version.
-   `controls`: organization_id nullable for platform templates,
    control_code, title, description, category, owner_id,
    implementation_status, review_frequency_days, active.
-   `control_mappings`: source_requirement_id, target_requirement_id or
    control_id, mapping_type, rationale, confidence, review_status,
    reviewed_by, reviewed_at, source_reference.
-   `control_implementations`: organization_id, control_id, owner_id,
    status, applicability_rationale, implementation_notes,
    last_reviewed_at, next_review_at, version.
-   `control_tests`: organization_id, control_id, test_type,
    test_rule_version, result (`pass`, `fail`, `unknown`, `error`,
    `not_applicable`), summary, started_at, completed_at, initiated_by,
    source_integration_id, evidence_snapshot, correlation_id.

#### Evidence

-   `evidence`: organization_id, title, description, storage_key,
    original_filename, media_type, size_bytes, sha256_checksum,
    source_type, source_uri if safe, collected_at, valid_from,
    expires_at, classification, uploaded_by, review_status, reviewed_by,
    reviewed_at, archived_at.
-   `evidence_links`: organization_id, evidence_id, entity_type,
    entity_id, purpose, relevance_notes, review_status, linked_by,
    created_at.
-   Validate that referenced entities belong to the same organization.
    Since polymorphic links are difficult to enforce with foreign keys,
    add explicit service-level validation and tests; consider separate
    link tables if stronger relational guarantees are needed.

#### Risk and remediation

-   `risks`: organization_id, risk_key, title, description, category,
    source_type, source_id, likelihood (1--5), impact (1--5),
    inherent_score, residual_likelihood, residual_impact,
    residual_score, risk_owner_id, status, treatment,
    acceptance_rationale, accepted_by, accepted_at, review_date,
    version.
-   `risk_controls`: organization_id, risk_id, control_id, relationship,
    effectiveness_rating, rationale.
-   `findings`: organization_id, finding_key, title, description,
    source_type, source_id, severity, status, first_detected_at,
    last_detected_at, assigned_to, due_date, closed_at,
    closure_rationale, deduplication_key.
-   `remediation_tasks`: organization_id, finding_id, title,
    description, owner_id, priority, status, due_date, completed_at,
    completion_evidence_id, created_by.
-   `risk_history`: organization_id, risk_id, previous_values,
    new_values, changed_by, changed_at, rationale.
-   `risk_acceptances`: organization_id, risk_id, requested_by,
    requested_at, rationale, expiry_date, decision, decided_by,
    decided_at.

#### Vendors and assessments

-   `vendors`: organization_id, name, legal_name if applicable,
    service_description, website, business_owner_id, criticality,
    data_classification, data_types, access_level, region, status,
    last_assessed_at, next_assessment_at.
-   `vendor_contacts`: organization_id, vendor_id, name, email, role,
    contact_type; access must be restricted.
-   `assessment_templates`: organization_id nullable for templates,
    name, version, purpose, active.
-   `assessment_questions`: template_id, question_key, question_text,
    category, response_type, required, weight, guidance,
    evidence_required.
-   `vendor_assessments`: organization_id, vendor_id, template_id,
    assessment_version, status, assessor_id, submitted_at, reviewed_at,
    score, inherent_risk, residual_risk, decision, decision_rationale,
    next_review_at.
-   `question_responses`: organization_id, assessment_id, question_id,
    answer_json, comments, evidence_id, reviewer_status, reviewer_notes,
    answered_at, reviewed_by, reviewed_at.
-   `vendor_risk_history`: organization_id, vendor_id, assessment_id,
    score, tier, recorded_at.
-   Vendor questionnaire access must be isolated from internal risk
    scores and notes.

#### AI governance

-   `ai_systems`: organization_id, name, description, business_purpose,
    business_owner_id, technical_owner_id, provider_vendor_id nullable,
    model_name, model_version, deployment_type, lifecycle_status,
    intended_users, affected_people, data_categories,
    personal_data_processed, automated_decision_making, human_oversight,
    deployment_date, retirement_date, documentation_uri.
-   `ai_assessments`: organization_id, ai_system_id, framework_id,
    assessment_version, status, assessor_id, risk_tier, overall_result,
    rationale, assessed_at, approved_by, approved_at, next_review_at.
-   `ai_assessment_items`: organization_id, assessment_id, category,
    question_key, prompt, response_json, evidence_id, result, rationale,
    reviewer_id, reviewed_at.
-   `ai_evaluations`: organization_id, ai_system_id, evaluation_type,
    dataset_or_method_description, version, result, metrics_json,
    limitations, executed_at, executed_by, evidence_id.
-   `ai_incidents`: organization_id, ai_system_id, severity,
    description, detected_at, reported_by, impact, status,
    response_actions, resolved_at.
-   `ai_model_changes`: organization_id, ai_system_id,
    change_description, previous_version, new_version, change_risk,
    review_status, reviewed_by, reviewed_at.

#### Workflows, integrations, audit and notifications

-   `integrations`: organization_id, provider, display_name, status,
    configuration_reference, last_sync_at, last_error_code; never store
    raw credentials in ordinary rows.
-   `integration_sync_runs`: organization_id, integration_id,
    started_at, completed_at, status, records_processed, records_failed,
    error_summary, correlation_id.
-   `workflow_definitions`: organization_id, name, trigger_type,
    configuration_json, enabled, version.
-   `workflow_runs`: organization_id, workflow_definition_id, status,
    trigger_source, started_at, completed_at, result_summary,
    error_code, correlation_id, initiated_by.
-   `workflow_steps`: workflow_run_id, step_key, status,
    input_reference, output_summary, started_at, completed_at,
    retry_count.
-   `notifications`: organization_id, recipient_user_id, event_type,
    title, message, read_at, created_at, delivery_status.
-   `audit_events`: organization_id nullable only for explicitly
    platform-level events, actor_user_id nullable for system events,
    action, entity_type, entity_id, timestamp, request_id, source_ip
    subject to privacy policy, user_agent subject to privacy policy,
    before_summary, after_summary, rationale, outcome.
-   `report_runs`: organization_id, report_type, filters_json,
    generated_by, generated_at, status, storage_key, checksum,
    expires_at.
-   `idempotency_keys` for operations that must not be duplicated.
-   `outbox_events` if reliable event delivery is implemented.

### 5.2 Database integrity requirements

-   Foreign keys and indexes for organization_id, status, owner,
    timestamps, and high-volume lookup columns.
-   Unique constraints scoped to organization where appropriate (for
    example, risk_key, vendor external reference, and control code).
-   Check constraints for 1--5 scores and valid date relationships.
-   Store JSON only for genuinely flexible payloads; use relational
    columns for core queryable fields.
-   Use transactions for multi-record state changes.
-   Add optimistic concurrency/version fields to sensitive records.
-   Keep a migration history and test upgrades from an empty database.
-   Define deletion and archival behavior for each entity.
-   Never use user-provided arbitrary table names, SQL, filesystem
    paths, or object keys directly.

------------------------------------------------------------------------

## 6. Shared risk, finding, control, and evidence semantics

### 6.1 Risk calculation

Implement an explicit, versioned scoring policy. The initial default can
be: - Likelihood: integer 1--5. - Impact: integer 1--5. - Inherent score
= likelihood × impact (1--25). - Example configurable tiers: 1--4 Low,
5--9 Medium, 10--16 High, 17--25 Critical.

These thresholds are defaults for the demo, not universal standards.
Store the scoring-policy version and make threshold configuration
auditable.

Residual risk must be based on a documented method. For the first
release, calculate residual risk from separately assessed residual
likelihood and residual impact (each 1--5) after considering verified
mitigations. Do not apply an unexplained arbitrary percentage discount.
Show inherent and residual risk separately, with rationale and links to
mitigating controls.

### 6.2 Control status and test outcomes

Keep implementation status separate from test outcome and evidence
sufficiency. Example implementation statuses: - `not_assessed` -
`planned` - `in_progress` - `implemented` - `partially_implemented` -
`not_applicable` - `retired`

Test outcomes: - `pass` - `fail` - `unknown` - `error` -
`not_applicable`

Rules: - Missing evidence should generally result in `unknown` or
`evidence_required`, not an automatic assertion that the control is
ineffective. - A failed test should create or update a finding with a
stable deduplication key. - Re-running the same failing test must not
create unlimited duplicate findings. - Passing a later test must not
silently erase the history of a previous finding. - Closing a finding
requires authorized review, rationale, and appropriate evidence. -
Framework compliance summaries must document their calculation and
distinguish passing, failing, unknown, not assessed, and not applicable.

### 6.3 Finding lifecycle

Suggested states: `open`, `triaged`, `in_remediation`,
`pending_validation`, `closed`, `accepted`, `reopened`.

Require: - Severity and source. - Assigned owner. - Due date or
documented reason for no due date. - Evidence and affected controls
where relevant. - Closure rationale and reviewer for closure. - Audit
events for all meaningful transitions.

### 6.4 Risk acceptance

-   A request is not an approval.
-   Record request rationale, scope, expiration, requester, decision
    maker, and decision.
-   Require re-review when acceptance expires or risk materially
    changes.
-   Apply separation of duties for high or critical risks.
-   Do not allow the LLM or scheduled job to approve acceptance.

------------------------------------------------------------------------

## 7. Module A --- Executive dashboard

Create a responsive, useful landing dashboard with: - Total active risks
and severity distribution. - Inherent versus residual risk trend. -
Compliance control counts by result and framework. - Controls with
missing/expired evidence. - Open and overdue findings. - Vendors by risk
tier and assessment status. - AI systems by lifecycle and risk tier. -
Upcoming assessments and reviews. - Recent important audit events. -
Recent workflow failures. - Quick actions controlled by permissions.

Dashboard numbers must come from API/database queries, not hardcoded
arrays. Every chart needs an empty state, loading state, accessible
labels, meaningful date range, and a way to drill into the underlying
records. Include a visible indication of the last data refresh where
relevant. Avoid implying that a sample dataset represents a real
organization.

------------------------------------------------------------------------

## 8. Module B --- Framework registry and compliance

### 8.1 Framework registry

Support framework metadata, versions, official source references, import
status, license notes, and review status. Begin with a small sample
catalog. Do not claim to include full copyrighted framework text unless
licensing permits it.

Frameworks to support conceptually: - NIST Cybersecurity Framework
2.0. - ISO/IEC 27001:2022. - SOC 2 Trust Services Criteria. - GDPR
obligations relevant to the organization's processing. - NIST AI Risk
Management Framework. - ISO/IEC 42001. - EU AI Act applicability and
obligation tracking.

### 8.2 Control mapping

Mapping records must include: - Source and target identifiers. - Mapping
type (for example, supports, partially supports, related, or requires
separate evidence). - Rationale. - Source references. - Confidence or
review status. - Reviewer and review date. - Framework version. - Change
history.

Never imply that two framework requirements are identical merely because
they are mapped. Mapping is a reviewable assertion.

### 8.3 Control management UI

Build: - Searchable/filterable control register. - Control detail page
with framework references, owner, status, applicability rationale,
tests, evidence, linked risks, findings, and history. - Control
assignment and review scheduling. - Bulk import/export with validation
preview and error report. - Framework mapping review queue. -
Version-aware import process with duplicate detection.

### 8.4 Evidence management

Support: - Upload with size and file-type limits. - Safe storage keys
generated by the server. - SHA-256 checksum. - Title, description,
classification, collection date, validity dates, expiry, owner, source,
review status. - Link/unlink evidence to controls, assessments,
findings, vendors, AI systems, and reports where permitted. - Evidence
preview only for safe supported types; force download for risky types. -
Evidence expiry reminders. - Review and rejection rationale. - Access
logs for sensitive evidence. - Retention and deletion policy
configuration. - Virus scanning integration point, documented as not
enabled until configured. - Signed short-lived object URLs for
production storage, never permanent public links.

Do not execute uploaded files. Do not trust MIME type supplied by the
browser. Prevent path traversal, filename injection, oversized uploads,
and unsafe preview rendering.

### 8.5 Control tests

Implement a rule interface, for example: -
`evaluate(context) -> TestResult` - Test result includes status,
summary, evidence references, rule version, execution time, and
structured details. - Use deterministic checks for known facts, such as
evidence expiry and review dates. - Integration-based checks run only
when the integration is configured and authorized. - Distinguish
`unknown` from `fail`. - Add a manual test mode for assessors with
recorded rationale. - Make execution idempotent where appropriate and
persist results.

### 8.6 Compliance calculations

Document the denominator and treatment of `unknown`, `not_assessed`, and
`not_applicable`. Provide at least: - Implementation coverage. - Latest
test pass rate. - Evidence currency rate. - Open findings by severity. -
Results per framework and version.

Never show a single "compliant" badge without showing what was measured,
when it was measured, what was excluded, and the underlying controls.

------------------------------------------------------------------------

## 9. Module C --- Third-party risk management

### 9.1 Vendor register

Vendor fields include service, business owner, criticality, data
categories, personal data access, system access, hosting/data regions,
dependencies, status, assessment dates, and notes. Restrict vendor
contacts and sensitive data.

Vendor lifecycle: `draft` → `onboarding` → `assessment_required` →
`under_review` → `approved` / `approved_with_conditions` / `rejected` →
`active` → `offboarding` → `archived`.

Transitions must be permission-checked and audited. Make the lifecycle
configurable if needed.

### 9.2 Questionnaire system

-   Versioned assessment templates.
-   Question categories: governance, access control, encryption,
    vulnerability management, incident response, business continuity,
    privacy, subcontractors, data location, secure development, AI
    usage, and other configurable categories.
-   Response types: yes/no, single choice, multiple choice, text,
    number, date, file/evidence, and not applicable with rationale.
-   Required questions and conditional follow-up.
-   Evidence requirements per question.
-   Draft, submitted, under review, returned for clarification,
    approved, and closed states.
-   Review notes separated from vendor-visible responses.
-   Questionnaire version is frozen once assessment is submitted;
    changes create a new version or reassessment.

### 9.3 Vendor scoring

Build configurable, transparent scoring: - Inherent risk uses
criticality, data sensitivity, access level, business dependency, and
service impact. - Questionnaire-based residual risk uses reviewed
answers, evidence quality, and control effectiveness. - Missing answers
must not be treated as positive evidence. - "Not applicable" requires a
rationale and reviewer decision for important questions. - Show score
breakdown, weighting, assumptions, and policy version. - Risk tiers and
approval thresholds are configurable and audited. - AI may summarize
responses but cannot change the official score without validated
deterministic rules and authorized review.

### 9.4 Vendor remediation and reassessment

-   Create findings from failed or unsupported answers.
-   Assign owner, severity, due date, remediation plan, and evidence
    request.
-   Track vendor response and internal reviewer status separately.
-   Send reminders through configured email or in-app notification
    channels.
-   Reassess on a configurable schedule or material service/data change.
-   Preserve assessment history and score trend.
-   Link vendor risks to shared risks and controls.
-   Support export of a vendor assessment report with an explicit
    draft/final status.

### 9.5 External vendor portal

Optional later feature. If implemented: - Use invitation tokens stored
as hashes, short expiry, revocation, and rate limits. - Restrict each
vendor respondent to their assigned questionnaires and uploads. - Never
expose internal scores, notes, risk acceptance, unrelated vendor
records, or organization-wide reports. - Test cross-vendor and
cross-tenant access denial explicitly.

------------------------------------------------------------------------

## 10. Module D --- AI governance and risk management

### 10.1 AI system inventory

Capture: - Name, purpose, business justification, owner, technical
owner, provider/vendor, model and version. - Deployment environment and
lifecycle stage. - Intended users and potentially affected people. -
Input/output data categories, personal data, sensitive data, retention
and data location. - Whether outputs influence decisions about people. -
Human oversight, override, appeal, and escalation paths. - External
dependencies, integrations, model change history, and known
limitations. - Security, privacy, reliability, fairness, transparency
and misuse considerations. - Deployment approval, review date,
retirement date, and supporting evidence.

Lifecycle states may include `proposed`, `under_assessment`,
`approved_for_pilot`, `pilot`, `approved_for_production`, `suspended`,
`retired`. Every transition requires permission and audit history.

### 10.2 AI risk assessment

Create versioned assessment templates mapped to the selected framework.
Assessment areas should include: - Governance, accountability and
ownership. - Intended purpose and foreseeable misuse. - Context,
affected stakeholders, and impact. - Data provenance, quality, privacy,
and consent/legal basis where applicable. - Security, access, supply
chain, and prompt-injection risks. - Reliability, robustness, monitoring
and failure handling. - Bias/fairness evaluation where relevant. -
Explainability, transparency, documentation and user notice. - Human
oversight and ability to intervene. - Incident response, rollback,
change management and retirement. - Legal/regulatory applicability
review.

Use the NIST AI RMF function model---Govern, Map, Measure, Manage---as a
navigation/mapping aid. Treat ISO/IEC 42001 as a management-system
framework. Do not fabricate official clauses or legal conclusions.

### 10.3 EU AI Act applicability

Implement an applicability checklist and tracking record, not an
automatic legal verdict. Capture: - Organization role and system role
where known. - Intended purpose and context. - Geographic and market
scope. - Potentially applicable prohibited practices, high-risk
categories, transparency obligations, and other relevant provisions. -
Reviewer, rationale, evidence, review date, and legal-review status. -
Source URL and date checked for changing legal references.

Clearly label the result as preliminary until reviewed by a qualified
legal/compliance professional. Make dates and obligations configurable
because laws, guidance, and implementation schedules can change.

### 10.4 AI evaluations and monitoring

Record evaluation method, version, dataset/method description, test
date, metrics, limitations, result, evaluator, evidence, and approval.
Do not imply that an evaluation is meaningful without documented
methodology.

Support: - Security testing results. - Output quality/reliability
measurements. - Fairness metrics where relevant and lawful. -
Human-review findings. - Model drift or performance monitoring records
when real data sources exist. - Incidents, impact, root-cause analysis,
response, and lessons learned. - Model/provider/version changes and
re-assessment triggers. - Scheduled reviews and overdue alerts.

### 10.5 AI deployment approval

Approval should require: - Completed required assessment items. -
Reviewed evidence. - Risk owner and accountable business owner. - Open
critical findings handled according to policy. - Documented residual
risk and acceptance where needed. - Human oversight and rollback plan. -
Authorized approver distinct from the requester where policy requires. -
Audit event and next review date.

AI-generated content must remain a draft until a human approves it.

------------------------------------------------------------------------

## 11. Module E --- AI assistant

### 11.1 Use cases

-   Summarize a document or evidence artifact.
-   Extract candidate evidence statements with page/section references
    where technically possible.
-   Compare vendor answers to a question's criteria and draft
    observations.
-   Suggest a finding category and draft severity rationale.
-   Draft remediation options.
-   Summarize risk history and changes.
-   Draft management reports using verified data.
-   Suggest candidate framework mappings for human review.
-   Explain why a control check failed using its recorded rule and
    output.

### 11.2 Architecture

Create a provider-independent adapter: - `LLMProvider` interface. -
Configured provider and model name. - Strict request/response schemas. -
Timeouts, bounded retries, token/size limits, and cost visibility. - No
provider key in frontend bundles. - Model and prompt version recorded
for each generated artifact. - Redaction/minimization policy before
sending content externally. - Explicit organization and record
authorization before retrieving any context. - Source references and
confidence/limitations in the output. - Non-AI fallback for essential
workflows.

Do not add a vector database by default. Start with permission-filtered
database retrieval and bounded document chunks. Add embeddings only if
search needs justify them and access control can be enforced at
retrieval time.

### 11.3 Prompt injection and data protection

Treat evidence files, questionnaire answers, web pages, and vendor
content as untrusted data, never as system instructions. The model must
not: - Follow instructions found inside evidence to reveal secrets or
other tenants' data. - Invoke arbitrary tools, execute code, or run
SQL. - Change permissions or workflow states. - Approve assessments or
risk acceptance. - Send email, publish content, or modify records
without explicit, permission-checked user action. - Invent evidence,
control mappings, citations, or framework requirements.

Store AI output as a draft artifact with: - Requester and
organization. - Source record IDs and source checksums/version. -
Model/provider and prompt version. - Generated timestamp. - Output
schema validation result. - Human reviewer, decision, and edits. -
Whether the content was used in a final record.

### 11.4 AI feature acceptance criteria

-   Missing or irrelevant evidence produces a clear limitation rather
    than invented facts.
-   Every factual claim that purports to derive from evidence has a
    usable source reference where supported.
-   Malicious prompt text in a vendor document does not change
    permissions or invoke actions.
-   AI errors do not break ordinary control testing or reporting.
-   User can disable AI features without disabling the rest of the
    product.

------------------------------------------------------------------------

## 12. Module F --- Workflow and notification engine

### 12.1 Triggers

-   Scheduled control test.
-   Evidence approaching expiry or expired.
-   Vendor assessment due or overdue.
-   Questionnaire submitted.
-   High/critical finding created.
-   Remediation due soon or overdue.
-   AI assessment review due.
-   AI model version or intended-purpose change.
-   Integration sync completed or failed.
-   Risk acceptance approaching expiry.

### 12.2 Actions

-   Create/update finding idempotently.
-   Assign owner or reviewer according to configured rules.
-   Create remediation task.
-   Create in-app notification.
-   Send email through configured provider.
-   Request evidence or review.
-   Generate a report.
-   Record workflow execution and failures.

### 12.3 Reliability

-   Jobs must be idempotent and retry safely.
-   Store job status, attempt count, timestamps, error code, correlation
    ID and outcome.
-   Use bounded retries and backoff.
-   Avoid duplicate emails and findings through idempotency keys.
-   Use a durable queue if workloads justify it.
-   Never retry an irreversible action blindly.
-   Expose a privileged workflow-run page with retry permissions and
    clear history.
-   Keep scheduling configuration in UTC and display local timezone.
-   Make a failed integration visible instead of presenting stale data
    as current.

------------------------------------------------------------------------

## 13. Integrations and API design

### 13.1 Integration framework

Define a consistent adapter interface with: - Provider name and
version. - Required permissions/scopes. - Health check. - Data
collection methods. - Pagination and rate-limit handling. -
Timeout/retry behavior. - Sync cursor/watermark where supported. -
Mapping to internal evidence/control records. - Error normalization. -
Secret reference rather than raw secret. - Audit and sync-run record.

Implement at least one working, deterministic local/demo integration
that provides synthetic test facts, plus the integration framework. Do
not claim cloud-provider or ticketing integration is live unless
configured and verified.

Potential future connectors: identity providers, cloud
configuration/security APIs, Git hosting, ticketing systems, asset
inventories, vulnerability-management tools, and email. Add only those
with authorized credentials and a real use case.

### 13.2 REST API conventions

-   Prefix: `/api/v1`.
-   JSON requests/responses.
-   OpenAPI documentation generated by FastAPI.
-   Consistent pagination (`limit`, `cursor` or page/offset, chosen
    once).
-   Validated sorting and filtering allowlists.
-   Consistent error structure with stable error code and request ID.
-   Correct HTTP status codes.
-   Idempotency for sensitive create/trigger operations where
    appropriate.
-   No stack traces, SQL errors, secrets, or internal file paths in
    production errors.
-   Enforce permission and organization scope for every route.
-   Use request size limits and rate limiting on authentication,
    uploads, AI, exports and expensive operations.

### 13.3 Required endpoint groups

Implement equivalent routes following the established naming convention:

**Auth and identity** - `POST /auth/login` - `POST /auth/logout` -
`POST /auth/refresh` if refresh tokens are used - `GET /users/me` -
`GET/POST /organizations` - `GET/POST /organizations/{id}/members` -
`PATCH /members/{id}/roles`

**Dashboard** - `GET /dashboard/summary` -
`GET /dashboard/risk-trends` - `GET /dashboard/compliance` -
`GET /dashboard/recent-events`

**Frameworks and controls** - `GET/POST /frameworks` -
`GET /frameworks/{id}` - `GET/POST /controls` -
`GET/PATCH /controls/{id}` - `GET/POST /controls/{id}/tests` -
`GET/POST /control-mappings` - `POST /frameworks/import-preview` -
`POST /frameworks/import`

**Evidence** - `POST /evidence` - `GET /evidence` -
`GET /evidence/{id}` - `POST /evidence/{id}/links` -
`DELETE /evidence/{id}/links/{link_id}` when policy permits unlinking -
`POST /evidence/{id}/review` - `POST /evidence/{id}/download-url` for
short-lived authorized download access

**Risks, findings, remediation** - `GET/POST /risks` -
`GET/PATCH /risks/{id}` - `POST /risks/{id}/acceptance-requests` -
`POST /risk-acceptances/{id}/decision` - `GET/POST /findings` -
`POST /findings/{id}/transition` - `GET/POST /remediation-tasks` -
`POST /remediation-tasks/{id}/complete`

**Vendors** - `GET/POST /vendors` - `GET/PATCH /vendors/{id}` -
`POST /vendors/{id}/assessments` - `GET /vendors/{id}/assessments` -
`POST /assessments/{id}/responses` - `POST /assessments/{id}/submit` -
`POST /assessments/{id}/review` - `POST /assessments/{id}/decision`

**AI governance** - `GET/POST /ai-systems` -
`GET/PATCH /ai-systems/{id}` - `POST /ai-systems/{id}/assessments` -
`POST /ai-assessments/{id}/items` - `POST /ai-assessments/{id}/submit` -
`POST /ai-assessments/{id}/decision` -
`POST /ai-systems/{id}/evaluations` -
`POST /ai-systems/{id}/incidents` - `POST /ai-systems/{id}/changes`

**Workflows, AI, reports and audit** -
`GET/POST /workflow-definitions` -
`POST /workflow-definitions/{id}/run` - `GET /workflow-runs` -
`POST /workflow-runs/{id}/retry` - `POST /ai/summarize-evidence` -
`POST /ai/draft-finding` - `POST /ai/draft-report` -
`GET/POST /reports` - `GET /reports/{id}/download` -
`GET /audit-events` - `GET /integrations` -
`POST /integrations/{id}/test` - `POST /integrations/{id}/sync`

These are a target API contract, not a reason to expose unnecessary
routes. Implement only routes with real behavior and test them.

------------------------------------------------------------------------

## 14. Frontend UX and design specification

### 14.1 Overall design

Create a professional enterprise SaaS interface: clean, restrained,
accessible, readable, consistent. Use a neutral base, one primary
accent, clear severity indicators, spacing tokens, consistent
typography, and reusable form/table/dialog patterns. Avoid visual
clutter, oversized decorative cards, excessive gradients, and animations
that obscure status.

Layout: - Collapsible left navigation. - Top bar with organization
switcher (if multiple memberships), global search, notification center,
help, and profile. - Main content with breadcrumb, page title,
contextual description, primary action, filters, and content. -
Responsive behavior for laptop, tablet, and mobile. - Dark/light mode
only if it can be implemented consistently. - WCAG-oriented keyboard
navigation, visible focus, semantic headings, accessible labels, and
sufficient contrast.

### 14.2 Navigation

-   Overview
-   Compliance
    -   Frameworks
    -   Controls
    -   Control Tests
    -   Evidence
    -   Mappings
-   Risk Management
    -   Risk Register
    -   Findings
    -   Remediation
    -   Risk Acceptance
-   Third-Party Risk
    -   Vendors
    -   Assessments
    -   Questionnaires
-   AI Governance
    -   AI Inventory
    -   Assessments
    -   Evaluations
    -   Incidents
    -   Change Reviews
-   Automation
    -   Workflows
    -   Runs and Failures
    -   Integrations
-   Reports
-   Audit Log
-   Administration
    -   Members and Roles
    -   Organization Settings
    -   Risk Policies
    -   Framework Settings
    -   Notifications

Only display navigation and actions that the current role is allowed to
use, while still enforcing authorization on the backend.

### 14.3 Required page states

Every list/detail/form page must include: - Loading state. - Empty state
with helpful next action. - Error state with retry where safe. -
Permission-denied state. - Validation messages. - Success feedback. -
Confirmation dialog for consequential actions. - Unsaved-changes
handling for complex forms. - Pagination and filters where applicable. -
Accessible table semantics and mobile fallback. - Clear distinction
between draft, pending review, approved, rejected, and stale
information.

### 14.4 Required pages

1.  Login, logout, invitation acceptance, session-expired handling.
2.  Organization setup and onboarding.
3.  Executive dashboard.
4.  Framework registry and framework detail.
5.  Control register, control detail, test history, mapping review.
6.  Evidence library, upload flow, evidence detail, link management.
7.  Risk register, risk detail, history, acceptance workflow.
8.  Findings register and detail.
9.  Remediation board/list and task detail.
10. Vendor register, vendor detail, assessment wizard, questionnaire
    review, vendor report.
11. AI inventory, AI-system detail, assessment wizard, evaluation
    history, incident page, change review.
12. Workflow definitions, run history, failed-run detail.
13. Integration registry and sync history.
14. Report builder/history/download.
15. Audit log with filters and detail.
16. User/role administration, organization settings, risk policy
    settings, notification settings.

### 14.5 Global search

Search only within records the user is authorized to access. Support
relevant entities (controls, risks, findings, vendors, AI systems,
evidence metadata, remediation tasks). Do not search raw confidential
file contents by default. Avoid leaking whether a forbidden record
exists.

------------------------------------------------------------------------

## 15. Authentication and application security

Choose one coherent auth approach. For a same-site web application,
prefer secure, HttpOnly, SameSite cookies with CSRF protection for
state-changing requests. If bearer tokens are required for API clients,
document token storage and rotation. Avoid storing long-lived
credentials in localStorage.

Minimum security controls: - Password hashing with a current recommended
algorithm. - Login rate limiting and generic failure messages. - Email
verification/invitation flows if email is configured. - Session
expiration, logout invalidation, and refresh rotation if applicable. -
Secure cookie flags in production. - CSRF protection for
cookie-authenticated mutations. - CORS allowlist, not wildcard in
production with credentials. - Security headers and a Content Security
Policy appropriate to the app. - Strict input validation and output
encoding. - SQL injection prevention through ORM/parameterized
queries. - SSRF protection for any URL-fetching integration. - Safe file
upload and download handling. - Request body and file size limits. -
Rate limits on costly or sensitive endpoints. - Secret
manager/environment-based secret loading. - Dependency scanning and
lockfiles. - Audit logging for authorization failures and privileged
actions without logging secrets. - PII minimization and documented
retention. - Production `DEBUG=false`. - No default production admin
password. - Secure bootstrap flow for first administrator. - Password
reset tokens, if implemented, stored hashed, single-use and
short-lived. - Backup encryption and access restrictions. - No public
object storage for private evidence.

Create a threat model covering: - Cross-tenant access. - Privilege
escalation. - Malicious evidence and prompt injection. - Credential
theft. - Unauthorized report export. - SSRF and unsafe integration
URLs. - Broken access control on downloads. - Background-job
tenant-context confusion. - Race conditions in approvals. - Audit-log
tampering. - Sensitive data sent to LLM providers. - Malicious or
compromised third-party integration responses.

------------------------------------------------------------------------

## 16. Auditability, privacy, and governance

### 16.1 Audit events

Log security-relevant and business-significant events: - Login
success/failure and session revocation. - Member, role, permission, and
organization changes. - Framework imports and mapping changes. - Control
status, applicability, and owner changes. - Evidence upload, download,
review, expiry, link, archive and deletion events. - Risk creation,
scoring, treatment, acceptance and review. - Finding transitions and
closure. - Vendor assessment submissions, review decisions, and score
changes. - AI-system changes, assessments, approvals, evaluations and
incidents. - Integration credential-reference changes, tests, and
syncs. - Workflow configuration changes and execution. - Report
generation and download. - AI generation and human approval/use.

Do not store raw passwords, access tokens, API keys, full evidence
contents, or unnecessary sensitive payloads in audit events. Record
summaries, IDs, hashes, and safe metadata.

### 16.2 Audit integrity

Application-level audit logs are not automatically immutable. Restrict
update/delete access, separate ordinary business permissions from audit
administration, and document stronger tamper-evident or append-only
storage as a production hardening option. Do not claim immutability
unless it is technically enforced and independently validated.

### 16.3 Privacy

-   Minimize personal data.
-   Document purposes, retention, access, deletion, export, and
    processor boundaries.
-   Make data export and deletion policy-aware.
-   Avoid logging personal or sensitive questionnaire content
    unnecessarily.
-   Do not send confidential evidence to an LLM without explicit
    configuration and authorization.
-   Document regional storage and cross-border transfer considerations
    for production.
-   Provide a retention policy configuration, while making clear that
    legal requirements need organization-specific review.

------------------------------------------------------------------------

## 17. Reports and exports

Implement usable, traceable reports: 1. Executive risk summary. 2.
Compliance posture by framework/version. 3. Control implementation and
test status. 4. Evidence gaps and expiry report. 5. Open findings and
remediation aging. 6. Risk register export. 7. Vendor assessment report.
8. Vendor portfolio risk report. 9. AI inventory and risk assessment
report. 10. AI incident and evaluation summary. 11. Workflow/integration
health report. 12. Audit activity report.

Each report should include: - Organization and report title. -
Generation timestamp and timezone. - Filters and reporting period. -
Status such as Draft or Final. - Data source scope. - Definitions of
metrics and exclusions. - Report creator. - Page numbers for PDF where
appropriate. - Source record IDs or a traceability appendix for material
findings. - Permission checks before generation and download. - Expiring
private download URLs or authenticated streaming. - Audit event on
generation/download. - Safe CSV generation (prevent spreadsheet formula
injection for untrusted cells).

Never state that a report is an audit opinion, certificate, legal
determination, or formal attestation unless an appropriately authorized
process actually produced it.

------------------------------------------------------------------------

## 18. Notifications and email

Implement in-app notifications first. Add email through a configurable
provider only when credentials are supplied.

Notifications: - Evidence expiry reminders. - Control review
reminders. - Assessment assignments and due dates. - Questionnaire
submission and clarification. - High/critical findings. - Remediation
due dates and overdue tasks. - Risk acceptance expiry. - AI assessment
review and model change. - Workflow/integration failures. - Report
readiness.

Requirements: - Templates with organization branding only where
configured. - No sensitive evidence content in email by default. -
Unsubscribe or preference handling where applicable. - Retry and
delivery status. - Prevent duplicate notification delivery. - Use
verified sender configuration and document SPF/DKIM/DMARC for production
email. - Demo mode must not silently send email to real people.

------------------------------------------------------------------------

## 19. Demo and seed data

Create a clearly labelled synthetic demo organization, for example
**Northstar Digital Services (DEMO)**. All seeded records must be
fictional and clearly marked. Do not use real customer, vendor, or
employee information.

Seed: - Demo users for roles needed to demonstrate permissions, with
safe local-only bootstrap credentials generated or documented for
development and forced to be changed; never reuse them in production. -
A small, source-verified framework subset and illustrative custom
controls. - Explicitly illustrative mappings marked `unreviewed` until
validated. - 8--12 fictional controls. - 5--8 fictional evidence
records, including missing/expired examples represented as metadata and
safe sample files. - 5 fictional risks of varying severity. - 4--6
findings with remediation tasks. - 3 fictional vendors with different
criticality and assessment status. - 1--2 vendor assessments with mixed
answers and evidence gaps. - 2--3 fictional AI systems in different
lifecycle stages. - AI assessment examples with unresolved and approved
states. - Workflow runs showing success and failure. - Notifications and
audit events. - A report example.

The demo scenario must show: 1. A scheduled control test detects missing
or expired evidence. 2. A finding is created or updated idempotently. 3.
A remediation task is assigned. 4. A vendor assessment produces a
documented risk score and evidence-backed finding. 5. A vendor risk is
linked to a relevant control. 6. An AI system assessment creates or
links a shared risk. 7. A reviewer approves or rejects a proposed
action. 8. A report includes the source records and correct
calculations. 9. A restricted user is denied access to another
organization's data.

Seed scripts must be idempotent, safe to rerun, and unavailable in
production by default.

------------------------------------------------------------------------

## 20. Testing strategy

### 20.1 Backend unit tests

Test: - Risk scoring boundaries and policy versions. - Status
transitions and invalid transitions. - Control result handling (`pass`,
`fail`, `unknown`, `error`). - Finding deduplication. - Evidence expiry
logic and timezone handling. - Questionnaire validation and scoring. -
AI assessment completion and approval rules. - Risk acceptance expiry
and separation of duties. - Report metric calculations. - Workflow
retries and idempotency.

### 20.2 API integration tests

Test: - Authentication and session expiration. - CRUD operations and
validation errors. - Pagination, filters and sorting allowlists. -
Role-based permissions. - Organization/tenant isolation. - Evidence
upload/download authorization. - Assessment submission and review. -
Risk acceptance approval. - AI actions remaining advisory. - Report
access controls. - Audit event creation. - Integration failures and
retry behavior.

### 20.3 Mandatory tenant-isolation tests

For every major entity: - Organization A cannot list Organization B's
records. - Organization A cannot read, update, delete, export, attach
evidence to, or trigger workflows for Organization B's records by
guessing UUIDs. - A background task cannot cross organization
boundaries. - A generated download URL cannot be reused outside its
intended authorization/expiry. - Search and counts do not reveal
inaccessible records. - Vendor respondents cannot access internal or
unrelated vendor data.

### 20.4 Frontend tests

Use component tests for critical forms and Playwright end-to-end tests
for: - Login and logout. - Dashboard load. - Create/edit a control. -
Upload and link evidence. - Run a control test and review a finding. -
Create a vendor and submit an assessment. - Create an AI system and
complete an assessment. - Approve/reject with authorized role. - Export
a report. - Unauthorized action denied. - Empty, loading, and error
states.

### 20.5 Security and quality checks

Configure CI to run: - Format and lint. - Static typing. - Unit and
integration tests. - Frontend production build. - Backend import/startup
smoke test. - Migration upgrade test against a clean database. -
Dependency vulnerability scan. - Secret scan. - Container/image scan
where practical. - Basic API security checks. - Test coverage reporting.

Do not chase a coverage percentage by writing meaningless tests. Cover
business logic and security boundaries first. Record any skipped test
and why.

------------------------------------------------------------------------

## 21. Local development setup

Provide a clean, reproducible developer experience.

### 21.1 Required files

-   `.env.example` with documented placeholders.
-   `docker-compose.yml` or an equivalent Compose file.
-   Dockerfiles for frontend and backend.
-   Database health checks and persistent local volume.
-   Alembic migration commands.
-   Idempotent demo seed command.
-   Root task runner (`Makefile`, scripts, or documented package
    scripts).
-   README quickstart.
-   Troubleshooting guide.
-   No secrets committed.

### 21.2 Environment variables

Use validated settings and fail safely on missing required production
values. Document names and purpose, such as: - `APP_ENV` - `APP_NAME` -
`PUBLIC_APP_URL` - `API_BASE_URL` - `DATABASE_URL` - `AUTH_SECRET` or
equivalent secure session configuration - `ACCESS_TOKEN_TTL_MINUTES` if
applicable - `CORS_ORIGINS` - `STORAGE_BACKEND` - `LOCAL_STORAGE_PATH` -
Object storage endpoint/bucket/region and credential references where
applicable - `MAX_UPLOAD_SIZE_MB` - `ALLOWED_UPLOAD_MIME_TYPES` -
`AI_PROVIDER` - `AI_MODEL` - `AI_API_KEY` - `AI_ENABLED` -
`AI_DATA_SHARING_APPROVED` - Email provider configuration -
`LOG_LEVEL` - `SENTRY_DSN` or equivalent optional observability
endpoint - Rate-limit settings - Seed/demo-mode toggle

Do not use insecure example secrets as production fallbacks. Validate
URL formats, allowed origins, and configuration consistency. The
frontend must never receive server-only secrets.

### 21.3 Developer commands

Provide working commands equivalent to: - install dependencies - start
development services - apply migrations - create first admin securely -
seed demo data - run backend tests - run frontend tests - run lint/type
checks - run production build - generate API schema - create backup -
restore backup into a separate/test database - stop services

Use actual commands matching the selected package managers and files.
Verify each documented command where possible.

------------------------------------------------------------------------

## 22. Production deployment requirements

The target is a small, production-oriented deployment that can be hosted
on a suitable VPS or managed platform. Do not deploy automatically
without explicit approval, valid credentials, and confirmation of the
target environment.

### 22.1 Production topology

Recommended baseline: - HTTPS reverse proxy/load balancer. - Frontend
application. - FastAPI backend. - PostgreSQL on a private network or
managed database. - Private object storage for evidence. - Background
worker/scheduler separated from web requests. - Email provider only if
configured. - Optional error monitoring with sensitive-data filtering. -
Backup destination separate from the application host.

### 22.2 Deployment checklist

-   Use a production database with a dedicated least-privilege user.
-   Keep the database and object store off the public internet.
-   Configure TLS and automatic certificate renewal.
-   Configure allowed origins, secure cookies, and trusted proxy
    settings.
-   Set strong unique secrets via the deployment platform's secret
    manager.
-   Disable demo seeding and debug mode.
-   Use non-root container users where practical.
-   Pin dependencies and build reproducibly.
-   Run migrations as a controlled release step, not independently in
    every app replica.
-   Add health/readiness checks.
-   Configure resource limits and restart policy.
-   Configure log rotation and alerting.
-   Enable encrypted backups and test restore.
-   Define retention and incident-response procedures.
-   Configure email sender authentication if email is used.
-   Configure private evidence storage, lifecycle rules, and access
    policies.
-   Ensure uploaded evidence is not served from a public static
    directory.
-   Configure monitoring for failed jobs, stale integrations, storage
    exhaustion, database capacity, and repeated authentication failures.
-   Document rollback steps and migration compatibility.
-   Run a pre-release smoke test and a post-deployment verification.
-   Record deployment version, time, migration revision, and operator.
-   Do not put real production secrets into the repository or
    screenshots.

### 22.3 Deployment artifacts

Create: - `Dockerfile` for each application component. -
`docker-compose.yml` for local development. - A separate production
Compose/deployment template if suitable. - Reverse proxy/TLS example
configuration. - `.dockerignore`. - Health checks. - CI workflow. -
Example deployment environment file without secrets. -
`docs/DEPLOYMENT.md`. - `docs/OPERATIONS.md`. -
`docs/BACKUP_RESTORE.md`. - `docs/INCIDENT_RESPONSE.md`. -
`docs/SECURITY.md`. - A pre-deployment and post-deployment checklist.

Production configuration must not automatically run demo seeds, expose
database ports publicly, use development credentials, or publish private
evidence.

### 22.4 Backup and recovery

Document: - Database backup schedule and retention. - Object storage
backup/versioning policy. - Encryption and access restrictions. -
Recovery point and recovery time objectives as configurable targets, not
guarantees. - Restore procedure into a separate environment. - Integrity
checks after restore. - How to recover from a failed migration. - How to
rotate credentials and revoke sessions. - How to test recovery
periodically.

------------------------------------------------------------------------

## 23. Framework and legal content governance

This product can support framework workflows, but content accuracy is
essential.

-   Store publisher, version, official URL, source retrieval date,
    license notes, and import provenance.
-   Use official public materials where permitted.
-   Do not scrape or redistribute copyrighted standards without rights.
-   Never fabricate clause IDs, control text, mapping equivalence, or
    regulatory dates.
-   Mark sample/custom controls as illustrative.
-   Distinguish official source text from internal summaries and
    organizational interpretations.
-   Track framework version changes and require review of affected
    mappings.
-   For GDPR and EU AI Act, record applicability assumptions, evidence,
    review date, and qualified reviewer; do not present generated output
    as legal advice.
-   For SOC 2, describe readiness tracking and evidence collection, not
    automatic attestation.
-   For ISO standards, describe management-system support, not
    certification.
-   Publish a `framework-data/README.md` explaining provenance,
    licenses, import procedure, and review workflow.

------------------------------------------------------------------------

## 24. Observability and operations

Implement: - Structured JSON logs in production. - Request/correlation
IDs propagated into workflows. - Health endpoint and readiness
endpoint. - Database connectivity health check without leaking
connection details. - Background job status and failure visibility. -
Integration last-success and last-failure timestamps. - Metrics or a
simple internal operational dashboard for job counts, latency, error
rate, and queue backlog if applicable. - Redaction of credentials,
session tokens, sensitive document contents, and unnecessary personal
data. - Configurable retention and access to logs. - Runbooks for common
failures.

Do not expose detailed internal health information publicly. Health
endpoints must not disclose secrets, environment variables, stack
traces, or internal network topology.

------------------------------------------------------------------------

## 25. Documentation required for release

Create and maintain: - `README.md`: overview, screenshots, demo
disclaimer, features, architecture, setup, test commands, deployment
pointer, limitations. - `docs/architecture.md`: components, data flow,
trust boundaries, architecture decisions. - `docs/data-model.md`:
entities, relationships, tenant boundaries, lifecycle semantics. -
`docs/API.md`: endpoint groups, auth, error conventions, pagination,
OpenAPI instructions. - `docs/SECURITY.md`: roles, permissions, threat
model summary, secure configuration. - `docs/THREAT_MODEL.md`: assets,
actors, trust boundaries, threats, mitigations, residual risks. -
`docs/FRAMEWORK_GOVERNANCE.md`: content sources, licensing, versioning,
mappings and review. - `docs/DEPLOYMENT.md`: deployment prerequisites
and steps. - `docs/OPERATIONS.md`: health, logs, upgrades, secrets,
troubleshooting. - `docs/BACKUP_RESTORE.md`: backup, restore and
recovery tests. - `docs/TESTING.md`: test strategy and commands. -
`docs/DECISIONS.md`: material technical decisions and tradeoffs. -
`docs/DEMO_SCENARIO.md`: walkthrough and seeded demo credentials
policy. - `docs/IMPLEMENTATION_STATUS.md`: completed, tested,
incomplete, blocked, and next steps. - `CHANGELOG.md`: meaningful
changes by release. - `LICENSE`: choose an appropriate license only
after confirming the user's intended distribution rights; do not invent
ownership terms.

------------------------------------------------------------------------

## 26. Milestone execution plan

Execute the following in order. Keep commits focused when Git is
available; never rewrite user history.

### Milestone 0 --- Repository audit and plan

-   Inspect current repo and environment.
-   Record decisions and risks.
-   Create architecture, data model, threat model, and implementation
    checklist.
-   Confirm the stack and repository structure.
-   Acceptance: architecture and execution plan are consistent; no
    existing work was destroyed.

### Milestone 1 --- Application skeleton

-   Create frontend and backend apps.
-   Add configuration, health checks, logging, database connection,
    migrations, Docker Compose, lint and test tooling.
-   Acceptance: both apps start; database connects; clean migration
    succeeds; health endpoints work.

### Milestone 2 --- Identity and tenant security

-   Implement organizations, users, memberships, roles, permissions,
    login/logout/session design, secure bootstrap admin, and
    tenant-aware request context.
-   Add permission dependencies and audit events.
-   Acceptance: role and cross-tenant tests pass before business modules
    are added.

### Milestone 3 --- Shared GRC core

-   Implement controls, evidence, risks, findings, remediation, risk
    history, audit events, scoring policy, and shared UI components.
-   Acceptance: records are linked, validated, audited, tenant-isolated,
    and covered by tests.

### Milestone 4 --- Compliance module

-   Framework registry, versioning, control mappings, evidence
    lifecycle, test rules, scheduled checks, and compliance dashboard.
-   Acceptance: a deterministic check can produce pass/fail/unknown,
    update a finding idempotently, and update correct dashboard metrics.

### Milestone 5 --- Third-party risk module

-   Vendor register, questionnaire templates, responses, evidence
    review, risk scoring, decisions, reassessment and reports.
-   Acceptance: vendor assessment creates traceable findings and risks;
    internal data is not exposed to respondents.

### Milestone 6 --- AI governance module

-   AI inventory, risk assessments, evaluations, incidents, changes,
    approvals, lifecycle and framework mapping.
-   Acceptance: an AI system can be assessed, reviewed, linked to shared
    risks, and approved only by an authorized reviewer.

### Milestone 7 --- Workflow engine and integrations

-   Scheduler/worker, notifications, integration adapter, sync history,
    retries, idempotency and workflow UI.
-   Acceptance: scheduled workflows are observable, safe to retry, and
    do not duplicate findings or notifications.

### Milestone 8 --- AI assistant and reporting

-   Provider adapter, source-grounded summaries, draft recommendations,
    AI governance safeguards, report builder, PDF/CSV.
-   Acceptance: AI failures degrade safely, outputs remain drafts,
    reports reconcile to source data, and export access is authorized.

### Milestone 9 --- UX completion and demo

-   Finish all loading/error/empty states, responsive layouts,
    accessibility, search, seed data and walkthrough.
-   Acceptance: complete demo path works with realistic synthetic data
    and role-specific permissions.

### Milestone 10 --- Release hardening

-   Run unit/integration/E2E tests, dependency/secret scans, production
    build, migration checks, threat-model review and deployment smoke
    test.
-   Create backup/restore procedure and operational runbooks.
-   Acceptance: no known critical security defect; all release blockers
    are fixed or explicitly documented; deployment steps are
    reproducible.

### Milestone 11 --- Deployment

-   Only after the user selects/authorizes a hosting target and provides
    credentials securely.
-   Build/push artifacts, provision services, configure secrets, run
    migrations, create first admin, verify TLS, test health, test
    backup, and run smoke tests.
-   Acceptance: a verified deployment URL and version are recorded only
    after successful confirmation. Never invent a URL or claim a
    deployment succeeded when it did not.

------------------------------------------------------------------------

## 27. Final acceptance checklist

The release is ready for a portfolio demo only when all applicable items
are verified:

### Product

-   [ ] All three modules are accessible in one application.
-   [ ] Shared risk, control, evidence, findings, and remediation
    entities work across modules.
-   [ ] Dashboard metrics are calculated from real application data.
-   [ ] List/detail/create/edit flows work.
-   [ ] Search, filtering, pagination, and exports work where specified.
-   [ ] Demo data is clearly fictional and seeded idempotently.

### Security

-   [ ] Authentication and logout work.
-   [ ] Permissions are enforced server-side.
-   [ ] Tenant-isolation tests pass for all major entities.
-   [ ] File uploads/downloads are protected.
-   [ ] Secrets are not committed or exposed in frontend bundles/logs.
-   [ ] Consequential decisions require authorized humans.
-   [ ] Audit events cover privileged and material changes.
-   [ ] AI prompt-injection and sensitive-data handling are tested.

### Engineering

-   [ ] Migrations apply from a clean database.
-   [ ] Backend tests pass.
-   [ ] Frontend tests and production build pass.
-   [ ] Lint and type checks pass.
-   [ ] CI is configured.
-   [ ] API errors and validation are consistent.
-   [ ] Background jobs are idempotent and observable.
-   [ ] No critical known dependency/security issue is ignored without
    documentation.

### Operations

-   [ ] `.env.example` is complete and contains placeholders only.
-   [ ] Docker development setup works.
-   [ ] Production configuration disables debug/demo mode.
-   [ ] Deployment instructions are reproducible.
-   [ ] Backup/restore instructions exist and restore has been tested in
    a non-production environment.
-   [ ] Health checks, logs, rollback and incident procedures are
    documented.

### GRC integrity

-   [ ] Framework versions and source provenance are recorded.
-   [ ] Mappings are reviewed or clearly marked illustrative/unreviewed.
-   [ ] Unknown is not misrepresented as pass or fail.
-   [ ] Compliance and risk formulas are documented.
-   [ ] Legal and certification limitations are stated.
-   [ ] Reports identify their scope, definitions, timestamp and source
    records.

------------------------------------------------------------------------

## 28. The exact starting instruction for Claude Code

After placing this file at the repository root as
`SENTINELGRC_MASTER_SPEC.md`, start Claude Code in the project directory
and give it the following instruction:

> Read `SENTINELGRC_MASTER_SPEC.md` completely before making changes.
> Inspect the repository and environment first. Follow the
> non-negotiable agent rules and milestone execution plan in the
> specification. Create/update the required planning and architecture
> documents, then immediately begin implementing Milestone 1 after the
> audit. Continue through milestones in order, running tests and fixing
> failures as you go. Do not stop after producing a plan or scaffolding.
> Do not fake integrations, test results, framework content, or
> deployment success. Preserve existing work. Use secure defaults, ask
> before destructive actions or paid services, and update
> `docs/IMPLEMENTATION_STATUS.md` with verified results after each
> milestone. Continue until the application is fully implemented and
> tested, or clearly identify the exact blocker and the remaining work.
> Do not deploy to a real hosting provider or incur paid costs without
> my explicit authorization.

## 29. Practical final note

A single specification gives Claude Code a coherent target, but no
prompt can guarantee a perfect production system in one pass. Context
limits, existing repository state, missing API credentials, hosting
access, package changes, and test failures can require iterative work.
This file is designed to make that work systematic and prevent
omissions. For an actual production deployment, complete the security
review, verify framework/legal content, configure real services, test
backup restoration, and obtain explicit authorization before deploying.


Yes — you can build all three projects as one integrated, enterprise-style GRC platform. This is actually a stronger portfolio project for the Logitech IT GRC Risk and Automation Analyst role because the job involves connecting GRC tools, automating evidence collection, assessing vendor risk, and governing AI systems.

Rather than building three separate applications, build one platform with shared authentication, a common risk register, a unified control library, centralized evidence storage, and a single reporting dashboard.

# Project blueprint: SentinelGRC AI

[daVera | Governance Engineering](https://images.openai.com/static-rsc-4/J08d8Z88OtgzBoyn-VHFgRdOLghQbnJyKA6vtp1zwucwt4VRNusRBk9DXwl9HuLv_qZXChuxtuNzZalV-dLE1XxlstDA65_TCTRz4yua8AFdJSMXI1qeWDP_HxK1Psfya72kbKvmDYfCIlHivRlDF7JAAr_MSoXLDIpT2fRaoF0?purpose=inline)

[davera.ai](https://davera.ai/?utm_source=chatgpt.com)

# SentinelGRC AI

Unified Governance, Risk, Compliance & AI Governance Platform

An integrated platform for continuous compliance, third-party security risk management, and AI governance — built around a shared evidence, controls, and risk-management engine.

Python + FastAPI

Next.js + TypeScript

PostgreSQL

AI-assisted workflows

Docker

## 1. How the three projects fit into one platform

Unified GRC Dashboard

Organization risk · Compliance posture · Vendor risk · AI risk · Audit status

Continuous Compliance

Controls, evidence, gaps and reports

Vendor Risk

Questionnaires, scoring and remediation

AI Governance

AI inventory, assessments and monitoring

Shared GRC Core

Identity & permissions · Risk register · Control library · Evidence repository · Workflow engine · Audit log · Reporting API

The important design decision is that the modules share the same underlying data.

For example, a cloud vendor might fail an access-control assessment. The vendor module creates a risk, the compliance module links it to the relevant access-control requirements, and the reporting module displays the issue in the organization's risk dashboard. If that vendor also provides an AI service, the AI governance module can link the same vendor to the AI system's risk assessment.

You should be able to navigate between all these records without entering the same information three times.

## 2. Complete feature list

Build the platform in modules so you can develop and test it incrementally.

Module 1 — Executive dashboard

- Overall compliance percentage and open control gaps.
- Critical, high, medium and low risks.
- Vendors awaiting assessment.
- AI systems by risk tier and lifecycle status.
- Overdue remediation tasks and upcoming review dates.
- Trend charts and downloadable management reports.

Module 2 — Continuous compliance

- Framework library and control mapping.
- Control owners, testing schedules and implementation status.
- Evidence uploads and evidence expiry tracking.
- Automated checks through APIs and scheduled jobs.
- Failed-check alerts and corrective-action workflows.
- Audit-ready reports for NIST CSF 2.0, ISO 27001:2022 and SOC 2.
- Privacy-related controls mapped to GDPR requirements.

Module 3 — Third-party risk management

- Vendor register and business criticality.
- Security questionnaires and supporting documents.
- Inherent risk and residual risk calculations.
- Vendor risk tiers and approval decisions.
- Findings, mitigation plans, owners and due dates.
- Reassessment schedules and vendor risk history.
- Reports showing the highest-risk suppliers.

Module 4 — AI governance

- AI system inventory: purpose, owner, provider, model and data types.
- Risk assessments aligned with the NIST AI RMF.
- AI lifecycle approvals and deployment status.
- Fairness, privacy, security, explainability and reliability evaluations.
- Human oversight and incident tracking.
- Monitoring results, review dates and remediation.
- ISO/IEC 42001 management-system mapping and EU AI Act applicability tracking.

Module 5 — AI assistant and automation engine

- Summarize evidence and questionnaire responses.
- Draft risk descriptions and remediation recommendations.
- Detect missing or expired evidence.
- Generate assessment and audit-report drafts.
- Trigger scheduled checks, notifications and approvals.
- Maintain a record of the source evidence and rule behind every finding.

Module 6 — Audit, reporting and administration

- Immutable-style audit history with restricted modification.
- Role-based access and separation of duties.
- PDF/CSV/Excel exports.
- Evidence and control traceability.
- Report templates, scheduled reporting and notification history.
- Configuration for assessment thresholds and review policies.

## 3. Technology stack

Use a conventional, maintainable stack rather than adding too many AI frameworks or microservices at the beginning.

| Layer                 | Recommended technology                                                     | Purpose                                            |
| --------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Frontend              | Next.js, TypeScript, Tailwind CSS                                          | Dashboard and management UI                        |
| UI components         | shadcn/ui or an equivalent accessible component library                    | Tables, forms, dialogs and charts                  |
| Backend               | Python, FastAPI, Pydantic                                                  | REST API and business logic                        |
| Database              | PostgreSQL                                                                 | Controls, risks, vendors, AI systems and workflows |
| ORM & migrations      | SQLAlchemy 2.x, Alembic                                                    | Data models and schema changes                     |
| Background processing | APScheduler initially; a task queue later                                  | Scheduled checks and reminders                     |
| Evidence storage      | Local storage for development; S3-compatible object storage for deployment | Files and evidence artifacts                       |
| AI integration        | Provider-independent LLM adapter                                           | Summaries, classification and draft reports        |
| Testing               | pytest, HTTPX, Playwright                                                  | Backend, API and UI testing                        |
| Deployment            | Docker Compose initially                                                   | Reproducible local development                     |
| Observability         | Python logging, structured events and OpenTelemetry later                  | Diagnostics and operational monitoring             |

Keep it as a modular monolith first. One backend and one database are sufficient for a portfolio version. You can split services later if there is a real operational need.

For your development computer, which has 8 GB RAM, start with Next.js, FastAPI and PostgreSQL, and run only the services you need. Avoid running a local large language model or several heavy containers simultaneously.

## 4. System architecture

\#chatgpt-mermaid-\_r_j0\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_j0\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_j0\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_j0\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_j0\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_j0\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_j0\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_j0\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_j0\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_j0\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j0\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j0\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_j0\_ p{margin:0;}#chatgpt-mermaid-\_r_j0\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_j0\_ .label text,#chatgpt-mermaid-\_r_j0\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .node rect,#chatgpt-mermaid-\_r_j0\_ .node circle,#chatgpt-mermaid-\_r_j0\_ .node ellipse,#chatgpt-mermaid-\_r_j0\_ .node polygon,#chatgpt-mermaid-\_r_j0\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .rough-node .label text,#chatgpt-mermaid-\_r_j0\_ .node .label text,#chatgpt-mermaid-\_r_j0\_ .image-shape .label,#chatgpt-mermaid-\_r_j0\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_j0\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .rough-node .label,#chatgpt-mermaid-\_r_j0\_ .node .label,#chatgpt-mermaid-\_r_j0\_ .image-shape .label,#chatgpt-mermaid-\_r_j0\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_j0\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_j0\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j0\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j0\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_j0\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_j0\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j0\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j0\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_j0\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_j0\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j0\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_j0\_ .icon-shape,#chatgpt-mermaid-\_r_j0\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_j0\_ .icon-shape p,#chatgpt-mermaid-\_r_j0\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_j0\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_j0\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j0\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_j0\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_j0\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_j0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_j0\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_j0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_j0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j0\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_j0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j0\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_j0\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_j0\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_j0\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_j0\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .node rect,#chatgpt-mermaid-\_r_j0\_ .node circle,#chatgpt-mermaid-\_r_j0\_ .node ellipse,#chatgpt-mermaid-\_r_j0\_ .node polygon,#chatgpt-mermaid-\_r_j0\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_j0\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_j0\_ .node.mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_j0\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_j0\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j0\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Users: GRC, Security, Audit,VendorsNext.js Web ApplicationFastAPI REST APIAuthentication and RBACShared GRC Business LogicPostgreSQLEvidence Object StorageScheduled Jobs and WorkflowEngineControl Tests and IntegrationsCloud APIs, Git, Identity,TicketingAI Provider AdapterHuman Review and ApprovalPDF / CSV / ManagementReports

Important operating principle: the AI model can recommend a control status or draft a finding, but deterministic rules and authorized human approvals decide official risk and compliance status. An LLM should not independently declare an organization compliant.

## 5. Database design — the foundation of the entire platform

Design the database around shared records. Here is the initial schema you should implement.

| Table                     | Important fields                                                 |
| ------------------------- | ---------------------------------------------------------------- |
| `organizations`           | id, name, industry, settings                                     |
| `users`                   | id, organization_id, email, password_hash, status                |
| `roles` / `user_roles`    | user_id, role_id, permissions                                    |
| `frameworks`              | id, name, version, source                                        |
| `controls`                | id, framework_id, control_code, title, description               |
| `control_mappings`        | source_control_id, target_control_id, mapping_type               |
| `control_implementations` | control_id, owner_id, status, review_date                        |
| `evidence`                | id, control_id, file_key, checksum, expiry_date, uploaded_by     |
| `control_tests`           | id, control_id, test_type, result, tested_at                     |
| `risks`                   | id, title, category, likelihood, impact, score, owner_id, status |
| `risk_controls`           | risk_id, control_id, relationship                                |
| `vendors`                 | id, name, service, criticality, status                           |
| `vendor_assessments`      | id, vendor_id, assessor_id, score, status, reviewed_at           |
| `questionnaires`          | id, vendor_id, template_id, status, due_date                     |
| `question_responses`      | questionnaire_id, question_id, answer, evidence_id               |
| `ai_systems`              | id, name, purpose, owner_id, provider_id, lifecycle_status       |
| `ai_assessments`          | id, ai_system_id, framework_id, risk_tier, status                |
| `findings`                | id, source_type, source_id, severity, description, status        |
| `remediation_tasks`       | id, finding_id, owner_id, due_date, status                       |
| `workflow_runs`           | id, workflow_type, status, started_at, completed_at              |
| `notifications`           | id, user_id, event_type, status, created_at                      |
| `audit_events`            | id, actor_id, action, entity_type, entity_id, timestamp          |

Add organization-scoped foreign keys where appropriate. Every business record should belong to the right organization, and every API request should enforce that boundary.

### Three design rules that matter

1. Frameworks are versioned. A control mapping to one framework does not automatically prove compliance with another. Store mappings as reviewed relationships, not unquestionable equivalences.
2. Evidence is reusable but traceable. One evidence artifact may support multiple controls, but each association needs its own review status, scope and assessment history.
3. Risks have provenance. Record why a risk exists, which assessment or test generated it, which controls mitigate it, who owns it and what changed over time.

For ISO standards and other copyrighted frameworks, store identifiers, your own descriptions and properly licensed material. Don't copy entire standards into a public repository.

## 6. Risk scoring and continuous monitoring

### A. Start with transparent risk scoring

Use a simple, explainable risk model first:

\\[ \text{Inherent Risk}=\text{Likelihood}\times\text{Impact} \\]

For a five-point scale, each factor ranges from 1 to 5, giving a score from 1 to 25.

| Score | Illustrative severity |
| ----- | --------------------- |
| 1–4   | Low                   |
| 5–9   | Medium                |
| 10–16 | High                  |
| 17–25 | Critical              |

These thresholds are example project settings, not a universal industry standard. Allow administrators to configure them and record changes.

Residual risk should account for the effectiveness of applicable mitigations. Do not simply subtract a control score without a defensible model. For the first version, use a documented reduction factor or a reviewed risk matrix.

### B. Implement continuous compliance

A scheduled control check should follow this flow:

\#chatgpt-mermaid-\_r_j9\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_j9\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_j9\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_j9\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_j9\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_j9\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_j9\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_j9\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_j9\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_j9\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j9\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j9\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_j9\_ p{margin:0;}#chatgpt-mermaid-\_r_j9\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_j9\_ .label text,#chatgpt-mermaid-\_r_j9\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .node rect,#chatgpt-mermaid-\_r_j9\_ .node circle,#chatgpt-mermaid-\_r_j9\_ .node ellipse,#chatgpt-mermaid-\_r_j9\_ .node polygon,#chatgpt-mermaid-\_r_j9\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .rough-node .label text,#chatgpt-mermaid-\_r_j9\_ .node .label text,#chatgpt-mermaid-\_r_j9\_ .image-shape .label,#chatgpt-mermaid-\_r_j9\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_j9\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .rough-node .label,#chatgpt-mermaid-\_r_j9\_ .node .label,#chatgpt-mermaid-\_r_j9\_ .image-shape .label,#chatgpt-mermaid-\_r_j9\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_j9\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_j9\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j9\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j9\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_j9\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_j9\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j9\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j9\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_j9\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_j9\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_j9\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_j9\_ .icon-shape,#chatgpt-mermaid-\_r_j9\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_j9\_ .icon-shape p,#chatgpt-mermaid-\_r_j9\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_j9\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_j9\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_j9\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_j9\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_j9\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_j9\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_j9\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_j9\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_j9\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j9\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_j9\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_j9\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_j9\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_j9\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_j9\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_j9\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .node rect,#chatgpt-mermaid-\_r_j9\_ .node circle,#chatgpt-mermaid-\_r_j9\_ .node ellipse,#chatgpt-mermaid-\_r_j9\_ .node polygon,#chatgpt-mermaid-\_r_j9\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_j9\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_j9\_ .node.mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_j9\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_j9\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_j9\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Scheduled trigger orintegration eventCollect authorized evidenceValidate data and timestampExecute deterministic controlruleTest outcomeRecord passing testCreate or update findingFlag missing or insufficientevidenceUpdate dashboardAssign remediation and notifyownerRequest evidence or manualreviewPassFailUnknown

Examples of initial control checks:

- Evidence has expired or is missing.
- A privileged account lacks a recorded review.
- A vendor assessment has passed its review deadline.
- An AI system has no assigned owner or completed risk assessment.
- A remediation task is overdue.

Only automate checks for which you have a defined rule and reliable data source. A missing document should usually mean unknown or evidence required, not automatically that the underlying security control has failed.

## 7. Where AI should be used

Use AI where language understanding is useful, not as a replacement for the rule engine.

| AI capability                 | Input                                 | Output                         | Required safeguard                        |
| ----------------------------- | ------------------------------------- | ------------------------------ | ----------------------------------------- |
| Evidence summarization        | Approved documents                    | Summary with source references | Human verifies citations                  |
| Vendor questionnaire analysis | Vendor answers and evidence           | Draft risk observations        | Assessor approves                         |
| Finding classification        | Control test results and context      | Suggested category/severity    | Rules and reviewer determine final status |
| Remediation drafting          | Finding and applicable policy         | Proposed corrective actions    | Owner approves                            |
| AI-system assessment          | System details and evaluation results | Draft risk assessment          | Risk owner approves                       |
| Management reporting          | Verified database records             | Narrative report               | Reconcile all figures to source data      |

Use structured outputs, schema validation, prompt-version tracking and model/version logging. Treat uploaded documents and vendor responses as untrusted inputs: they must never be allowed to instruct the model to bypass security rules or access unrelated records.

A sensible first release can use an optional hosted LLM API, with a non-AI fallback for core workflows. Keep secrets in environment variables and never send confidential evidence to an external model without appropriate authorization and data-handling controls.

## 8. API endpoints you should build

Organize the FastAPI backend by business domain. Start with these endpoint groups.

Authentication and users

`POST /api/v1/auth/login` · `GET /api/v1/users/me` · `GET /api/v1/users`

Frameworks and controls

`GET /api/v1/frameworks` · `GET /api/v1/controls` · `POST /api/v1/control-tests`

Evidence and compliance

`POST /api/v1/evidence` · `GET /api/v1/evidence` · `GET /api/v1/compliance/summary`

Risk and remediation

`POST /api/v1/risks` · `GET /api/v1/risks` · `POST /api/v1/findings` · `POST /api/v1/remediation-tasks`

Vendor risk

`POST /api/v1/vendors` · `POST /api/v1/vendors/{id}/assessments` · `GET /api/v1/vendors/{id}/risk`

AI governance

`POST /api/v1/ai-systems` · `POST /api/v1/ai-assessments` · `GET /api/v1/ai-systems/{id}/risks`

Automation and reporting

`POST /api/v1/workflows/{id}/run` · `GET /api/v1/reports/compliance` · `GET /api/v1/audit-events`

These are proposed API contracts, not existing endpoints. Implement pagination, validation, permissions, tenant scoping, consistent error responses and audit logging for every relevant endpoint.

## 9. Frameworks you need to support

Create a framework registry and a control-mapping engine instead of hardcoding compliance logic in the frontend.

[A Comprehensive Guide to NIST CSF 2.0: Elevating Your Cybersecurity Strategy for the Modern Era | by Hrithik Chorwar | Medium](https://images.openai.com/static-rsc-4/5DkbeWDLJW4NlC1drBFo-DJkxOJC8yxohsZ3p8lsUDHRyTSf0B4rwlrT03n3cF2N967_BqGLnY19G9K1Bbomee1N5wf7ecjB_U8UQMUL4yVf2pNCnTa3jkMexmfKo1R-iNKtQuiSXgQOYyN6kVLGt1JTO4mAbvdY9gA1lfBqzRA?purpose=inline)

NIST CSF 2.0

Organize cybersecurity outcomes around Govern, Identify, Protect, Detect, Respond and Recover. Use these as a primary navigation and mapping structure.

[ISO 27001 Security Standards: A Practical Guide](https://images.openai.com/static-rsc-4/wC28HULD1yRfz1-2gGo3OJRezu2_C8tfbWCGhY9a7Os9j-WUCm6B023HNpQLSl05Y03W9sbMCBgxBNucSUd4Pi4rj5OXvHM-0TObiIO3hsaM5jmumz-yvKNgEJmH26YSnA2vbNmzBkwgCnnq1ICn9bGWlfN9a-mBB5xPc6435Gk?purpose=inline)

ISO/IEC 27001:2022

Track the ISMS scope, risk treatment, control applicability, evidence, internal audits and corrective actions. Maintain an explicit Statement of Applicability workflow.

[How to pass your SOC 2 Compliance Audit?](https://images.openai.com/static-rsc-4/cxlR9SSRIqBkYBspywXlATqIHRhR6OmyIbNXjZyVHppVko_TAruKqvyFBJE3CcbS-rP5GLkldQ-nhF-nQM62TXm4DjHDCfR7wjVc_7M73xdZChf7XiB-KPjOErd6Ahq3sCpMDK-IxMPTNBm89mf1X4zxhAIyRcNXjb0RflWImTU?purpose=inline)

SOC 2

Model the applicable Trust Services Criteria and link them to controls, evidence and testing. Make it clear that software tracking does not itself establish SOC 2 attestation.

[Celebrating Data Protection Day - Trilateral Research](https://images.openai.com/static-rsc-4/bc-TuLHmLPrRhPlg9_O4f1FrDhKWAiv15ry3Wmz1-FYG2fkwAIpSHNYjxH8KUnQNMN09nVTS9Kj_Cqwo8oGj4svovPQJ12d5sqe_KV4YJx9x2t86IN37WDlskeM8IYUPV1UDyestaCAySRXdq8taG6FISnFsHJXD0iuStxmQSVU?purpose=inline)

GDPR

Track applicability, personal-data processing, privacy risks, data-protection assessments and related obligations. Add legal review for interpretation.

[NIST’s AI Risk Management Framework Helps Businesses Address AI Risk | Foley & Lardner LLP - JDSupra](https://images.openai.com/static-rsc-4/2fLAZaRvG1fZnr5VpWfQAcVYcP3GGa4JxG35nRuk8zNaEOSkIW0fsmrctAu1KPMgaDtIsl3YnnubfwmoRiLxJz_EnifuCM_0D1xN6p5IFz-g2kL42ul_1oYAEL7_aDnUkHOSjUcNm7aBH4Nu21HcR7CwU8xoPJwWjDc0uLoNW8o?purpose=inline)

NIST AI RMF

Organize AI risk activities around Govern, Map, Measure and Manage.

[AI Risk Management & Lifecycle Governance Guide | ISO 42001 Implementa  – Compliance Toolkits](https://images.openai.com/static-rsc-4/zpG1CbafXEruKCIyLDmDqqPVM_TMZfy1GBx-aIszX-uJ3BoQklXNezOgChfn8ObWNUqPKJIuJs2LFzntGgGiD430zP-9tIPbWZ4gtmW74kg-ZIvaTtD236fjdY79MlSAbQlQuUEb5AEf1Gm-5GpTi3_e1yck8n2aLoy_6vWq1vY?purpose=inline)

ISO/IEC 42001 and EU AI Act

Add AI management-system requirements, system inventories, applicability assessments and lifecycle governance. Keep EU AI Act obligations configurable and reviewable as rules and implementation dates evolve.

For your portfolio, begin with a small, accurately sourced set of control identifiers and mappings. Expand the library only after you have verified the source material, framework version and mapping rationale.

## 10. Recommended repository structure

Use one Git repository with clearly separated frontend, backend and infrastructure code.

```

sentinelgrc-ai/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── dashboard/
│       │   ├── compliance/
│       │   ├── risks/
│       │   ├── vendors/
│       │   ├── ai-governance/
│       │   ├── evidence/
│       │   ├── reports/
│       │   └── settings/
│       ├── components/
│       └── lib/
├── services/
│   └── api/
│       ├── app/
│       │   ├── api/v1/
│       │   ├── core/
│       │   ├── models/
│       │   ├── schemas/
│       │   ├── repositories/
│       │   ├── services/
│       │   ├── integrations/
│       │   ├── workflows/
│       │   ├── ai/
│       │   └── reporting/
│       ├── migrations/
│       └── tests/
├── framework-data/
│   ├── nist-csf/
│   ├── iso-27001/
│   ├── soc2/
│   ├── gdpr/
│   ├── nist-ai-rmf/
│   └── iso-42001/
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── threat-model.md
│   ├── framework-mappings.md
│   └── demo-scenario.md
├── infra/
│   └── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md

```

Keep framework content separate from business logic. This makes updates, versioning, and validation much easier.

## 11. Step-by-step development roadmap

Do not try to build all six modules in one giant coding prompt. Build a working vertical slice first, then expand it.

## 01

Week 1

Foundation and architecture

Set up Git, Next.js, FastAPI, PostgreSQL and Alembic. Define entities, database relationships, authentication, tenant boundaries and roles.

Deliverable: a running application with login, role-based navigation and database migrations.

## 02

Week 2

Core risk and evidence engine

Implement risks, controls, evidence, findings, remediation tasks and audit events. Add validation and permissions to the API.

Deliverable: a risk can be traced to a control, supporting evidence, a finding and a remediation owner.

## 03

Week 3

Continuous compliance module

Implement framework imports, control mappings, evidence expiry, test execution, findings and compliance summaries.

Deliverable: an administrator can run a control check and see the result reflected in the dashboard.

## 04

Week 4

Third-party risk module

Build vendors, questionnaires, responses, scoring, approvals, reassessments and vendor-specific remediation.

Deliverable: a vendor assessment creates a traceable risk record and management report.

## 05

Week 5

AI governance module

Implement AI inventory, assessments, lifecycle approvals, evaluation records, risk ownership and monitoring.

Deliverable: an AI system can be assessed, reviewed and linked to enterprise risks and controls.

## 06

Week 6

AI assistance, reporting and automation

Add the LLM adapter, evidence summaries, report drafts, scheduled checks, email notifications and PDF/CSV exports.

Deliverable: a scheduled workflow produces a reviewed finding and an auditable report.

## 07

Weeks 7–8

Hardening and portfolio release

Add integration tests, tenant-isolation tests, security review, demo data, documentation, deployment configuration and screenshots.

Deliverable: a reproducible, tested demo with an end-to-end scenario and a clear README.

This is a planning estimate for a focused prototype, not a guarantee. With a full-time job and limited development hours, allow 10–12 weeks or longer if needed. Prioritize a secure working core over a large number of incomplete features.

## 12. Testing and security requirements

Treat this as a security product, not just a dashboard.

- Authentication: secure session or token handling, password hashing, and appropriate account controls.
- Authorization: enforce least privilege and organization-level data isolation on the backend.
- Evidence: validate file types and sizes, use safe filenames, store files outside the public web root, and verify checksums.
- API integrations: use scoped credentials, timeouts, retries, rate limits and secret rotation.
- AI: protect against prompt injection, sensitive-data leakage, fabricated citations and unapproved actions.
- Auditability: log relevant changes to controls, assessments, evidence, permissions and risk decisions.
- Resilience: use database migrations, backups, error handling and idempotent background jobs.

Your test suite should include at least these scenarios:

1. A user from Organization A cannot retrieve Organization B's vendors or evidence by changing an ID.
2. An expired evidence item creates a review finding without silently changing unrelated controls.
3. Re-running a failed check does not create unlimited duplicate findings.
4. A vendor's critical finding appears in the shared risk register.
5. An AI-generated recommendation cannot approve its own assessment.
6. A user without permission cannot close a critical risk or modify audit history.
7. A failed external API call is logged and retried safely.
8. Compliance percentages match the documented calculation and exclude unknown results from the passing count.

For production, have a qualified security reviewer assess the design and implementation before using real corporate evidence.

## 13. How to build it using Claude Code or another coding agent

Since you want a complete platform, use a specification-first workflow. Have the coding agent inspect the existing repository, implement one milestone, run tests and report failures before proceeding.

Create `docs/BUILD_PLAN.md` and use this master prompt:

# SentinelGRC AI — Master Engineering Specification

## Objective

Build a secure, full-stack, modular Governance, Risk and Compliance platform that integrates:

1. Continuous compliance and control monitoring.
2. Third-party cybersecurity risk management.
3. AI governance and AI risk management.
4. Shared risk, evidence, findings and remediation workflows.
5. AI-assisted analysis, reporting and workflow automation.

## Technology

- Frontend: Next.js, TypeScript, Tailwind CSS.
- Backend: Python, FastAPI, Pydantic.
- Database: PostgreSQL, SQLAlchemy 2.x, Alembic.
- Testing: pytest, HTTPX, Playwright.
- Deployment: Docker Compose.
- Reporting: PDF and CSV exports.
- AI: provider-independent adapter with validated structured outputs.

## Architecture requirements

Use a modular monolith with explicit separation between API routes, business services, repositories, data models, integration adapters and background workflows.

Implement organization-scoped data access, role-based permissions, centralized error handling, audit events, migrations and structured logging.

## Functional modules

### Compliance

- Framework and version registry.
- Control library and reviewed framework mappings.
- Control owners and implementation status.
- Evidence upload, metadata, expiry and checksum tracking.
- Scheduled and manually triggered control tests.
- Findings, corrective actions and compliance reports.

### Third-party risk

- Vendor register and criticality.
- Assessment templates and questionnaires.
- Evidence-backed responses.
- Configurable inherent and residual risk scoring.
- Approval, reassessment and remediation workflows.

### AI governance

- AI-system inventory and lifecycle.
- AI risk assessments and ownership.
- Evaluation records for security, privacy, reliability, fairness and explainability.
- Human approval and monitoring history.
- Configurable mappings to NIST AI RMF, ISO/IEC 42001 and applicable EU AI Act obligations.

### Shared platform

- Executive dashboard.
- Risk register and remediation management.
- Evidence repository.
- Notification and workflow engine.
- Search, filtering and pagination.
- Audit history.
- PDF and CSV reporting.
- AI-assisted evidence summarization and draft recommendations.

## Engineering and security rules

1. Never fabricate framework requirements, control mappings or compliance results.
2. Keep framework versions and mappings traceable to sources.
3. Do not let an LLM independently determine official compliance status or approve risk acceptance.
4. Enforce organization isolation and permissions in the backend.
5. Validate all external input and uploaded files.
6. Protect secrets and sensitive evidence.
7. Make scheduled jobs idempotent and record failures.
8. Use migrations rather than ad hoc database changes.
9. Include unit, integration, authorization and tenant-isolation tests.
10. Never claim a feature or test is complete unless its implementation and results have been verified.

## Development procedure

Work in milestones:

1. Repository inspection and architecture documents.
2. Application skeleton, database and authentication.
3. Shared risks, controls, evidence and audit engine.
4. Continuous compliance.
5. Third-party risk.
6. AI governance.
7. AI assistant, integrations and reporting.
8. Security hardening, end-to-end testing and deployment.

At the start of each milestone:

- Review the current repository and existing implementation.
- List files to create or change.
- Identify dependencies and security implications.
- Implement only the current milestone.

At the end of each milestone:

- Run relevant tests and static checks.
- Fix failures caused by the implementation.
- Document setup instructions and environment variables.
- Report completed features, test results, known limitations and the next milestone.
- Do not proceed automatically if a critical security or architecture decision remains unresolved.

## Initial task

Do not implement the entire platform in one pass. Begin by inspecting the repository and producing:

- docs/architecture.md
- docs/data-model.md
- docs/threat-model.md
- docs/BUILD_PLAN.md
- An ordered implementation checklist.

Wait for review before implementing the first milestone.

Use this as your master specification, then give the coding agent a separate task for each milestone. That will make it much easier to find errors and keep the database design consistent.

## 14. What your final portfolio demonstration should show

Build one realistic end-to-end scenario using fictional data.

Step 1 — Register a vendor

Add a fictional cloud service provider, define its business criticality and request a security assessment.

Step 2 — Assess the vendor

Record questionnaire answers and evidence. Calculate an explainable risk score and flag missing security evidence.

Step 3 — Link the control gap

Connect the finding to a relevant control, assign a risk owner and open a remediation task.

Step 4 — Assess an AI system

Register an AI service provided by that vendor, assess its risks and connect its relevant findings to the same enterprise risk register.

Step 5 — Generate an executive report

Display compliance gaps, vendor exposure, AI governance status, overdue remediation and the evidence supporting each conclusion.

This single demonstration communicates all three project areas and shows that you understand how enterprise GRC processes connect.

## 15. Your launch checklist

## Implementation tracker

### 0/10

Foundation

Create Git repository and project specification

Set up Next.js, FastAPI and PostgreSQL

Implement authentication, RBAC and organization isolation

Core engine

Create controls, risks, evidence and audit data models

Module 1

Build compliance monitoring and reporting

Module 2

Build vendor assessments and remediation

Module 3

Build AI inventory and governance assessments

Automation

Add AI-assisted summaries with human approval

Release

Add automated tests, security checks and demo data

Portfolio

Publish README, architecture diagrams and demo walkthrough

Copy checklist

My recommendation: Start with the shared risk, control and evidence engine. Then finish the compliance module before building vendor risk and AI governance on top of it. The shared core is what turns three portfolio projects into one credible enterprise platform.

The goal is not merely to make a dashboard look impressive. It is to demonstrate a working, tested and auditable system that connects security controls, evidence, risk assessments, vendor reviews and AI governance — the technical capabilities this Logitech position emphasizes.


9. Frameworks you need to support
Create a framework registry and a control-mapping engine instead of hardcoding compliance logic in the frontend.









NIST CSF 2.0

Organize cybersecurity outcomes around Govern, Identify, Protect, Detect, Respond and Recover. Use these as a primary navigation and mapping structure.











ISO/IEC 27001:2022

Track the ISMS scope, risk treatment, control applicability, evidence, internal audits and corrective actions. Maintain an explicit Statement of Applicability workflow.











SOC 2

Model the applicable Trust Services Criteria and link them to controls, evidence and testing. Make it clear that software tracking does not itself establish SOC 2 attestation.











GDPR

Track applicability, personal-data processing, privacy risks, data-protection assessments and related obligations. Add legal review for interpretation.











NIST AI RMF

Organize AI risk activities around Govern, Map, Measure and Manage.











ISO/IEC 42001 and EU AI Act

Add AI management-system requirements, system inventories, applicability assessments and lifecycle governance. Keep EU AI Act obligations configurable and reviewable as rules and implementation dates evolve.



For your portfolio, begin with a small, accurately sourced set of control identifiers and mappings. Expand the library only after you have verified the source material, framework version and mapping rationale.