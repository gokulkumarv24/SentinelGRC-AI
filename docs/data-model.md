# Data model

PostgreSQL 18 via Prisma 7 (`services/api/prisma/schema.prisma`, migrations in `services/api/prisma/migrations`). Tables use `snake_case` names, UUID keys and `timestamptz` times stored in UTC.

## Tenant boundary

- **Every tenant table has `organization_id`.** Services take the organization only from the authenticated request context (or the job's recorded context in the worker), never from the request body.
- Every query filters by it, so a record from another organization behaves exactly like a missing record (404), never like a forbidden one.
- **Platform reference data** has `organization_id = NULL`: framework versions, requirements, illustrative control templates and their mappings. An organization adopts it by copying it; it never edits the shared rows.
- Foreign keys to the organization use `ON DELETE RESTRICT`. Organizations are suspended or archived, never cascaded away.

## Entities by domain

| Domain | Tables | Notes |
|---|---|---|
| Identity and access | `organizations`, `users`, `memberships`, `membership_roles`, `roles`, `permissions`, `role_permissions`, `sessions`, `invitations` | A user can belong to several organizations, with roles per membership. Sessions store only a SHA-256 hash of the token, plus idle and absolute expiry. Invitations store a hash of a single-use token. |
| Frameworks and controls | `frameworks`, `framework_requirements`, `controls`, `control_implementations`, `control_mappings`, `control_mapping_history`, `control_test_configs`, `control_tests` | Framework versions keep their provenance (publisher, URL, retrieval date, licence notes). Mappings are reviewable assertions with a type (`supports`, `partially_supports`, `related`, `requires_separate_evidence`) and a review status, never claims of equivalence. |
| Evidence | `evidence`, `evidence_links`, `evidence_access_logs` | Files sit in private storage under server-generated keys with SHA-256 checksums. Links attach evidence to any supported record. Every download link issued and file downloaded is logged. |
| Risk | `scoring_policies`, `risks`, `risk_links`, `risk_controls`, `risk_history`, `risk_acceptances` | Inherent and residual scores are assessed separately under a versioned policy. Acceptance is a request-and-decide workflow with an expiry date. |
| Findings and remediation | `findings`, `finding_events`, `remediation_tasks` | Findings from automated sources are deduplicated by source, so a re-detection updates the existing finding. |
| Third-party risk | `vendors`, `vendor_contacts`, `assessment_templates`, `assessment_questions`, `vendor_assessments`, `question_responses`, `vendor_risk_history`, `vendor_portal_invitations` | Template versions are frozen once an assessment is submitted. Scoring stores its breakdown and policy version. |
| AI governance | `ai_systems`, `ai_assessments`, `ai_assessment_items`, `ai_evaluations`, `ai_incidents`, `ai_model_changes`, `eu_ai_act_applicability` | EU AI Act records are preliminary until legal review. |
| Automation | `integrations`, `integration_sync_runs`, `integration_records`, `workflow_definitions`, `workflow_runs`, `workflow_steps`, `outbox_events` | A database-backed job queue (D-012). Runs carry the organization, the initiating actor and a correlation ID. |
| Communication | `notifications`, `notification_preferences` | In-app notifications always work; email is optional. |
| Reporting and AI | `report_runs`, `report_schedules`, `ai_artifacts` | Reports record their source record IDs and checksum. AI artifacts record the provider, model, prompt version, sources and review decision. |
| Integrity | `audit_events`, `idempotency_keys` | Audit history is append-only. Idempotency keys expire after 24 hours. |

## Integrity rules in the database

- `audit_events`, `risk_history` and `finding_events` are **append-only**. Triggers reject `UPDATE` and `DELETE` (migration `20261021000100_integrity_constraints`). `npm run restore:verify` checks the triggers still exist after a restore.
- Unique constraints back business keys, for example `(organization_id, control_code)`, `(organization_id, scope, key)` for idempotency keys, and finding keys and risk keys per organization.
- Optimistic concurrency: records that are edited concurrently (risks, findings, controls, AI systems, tasks) carry a `version`. Updates must send the version they read and get 409 if it changed.

## Lifecycles

| Record | States |
|---|---|
| Risk | identified → assessed → treatment_planned → in_treatment → monitoring; accepted (approved acceptance with an expiry date); closed |
| Finding | open → triaged → in_remediation → pending_validation → closed; accepted (needs an accepted risk); reopened |
| Remediation task | open, in_progress, blocked → completed, or cancelled |
| Evidence review | unreviewed → pending_review → approved or rejected; currency (current, expiring, expired) is computed from `expires_at` |
| Control implementation | not_assessed, planned, in_progress, implemented, partially_implemented, not_applicable (needs a rationale), retired |
| Control test result | pass, fail, unknown (for example missing evidence or a stale integration; never counted as a pass), error, not_applicable |
| Vendor | draft → onboarding → assessment_required → under_review → approved, approved_with_conditions or rejected → active → offboarding → archived |
| Vendor assessment | draft → submitted → under_review → returned_for_clarification or approved → closed |
| AI system | proposed → under_assessment → approved_for_pilot → pilot → approved_for_production → production; suspended; retired. Deployment approval requires a separate approver. |
| AI assessment | draft → in_progress → submitted → approved or rejected; superseded |
| Workflow run | queued → running → succeeded, partially_succeeded or failed; cancelled |
| Report run | queued → generating → ready, failed, or expired (file deleted after retention) |
| AI draft | pending → accepted, edited_and_accepted, or rejected. A draft never changes another record by itself. |

## Retention

Evidence, audit and report retention periods are organization settings (`evidenceRetentionDays`, `auditRetentionDays`, `reportRetentionDays`). Retention reviews **flag** records; they never delete evidence or audit history automatically (D-013). Generated report files are derived data and are deleted when they expire.
