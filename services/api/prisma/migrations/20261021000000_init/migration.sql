-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "FrameworkStatus" AS ENUM ('draft', 'active', 'deprecated', 'archived');

-- CreateEnum
CREATE TYPE "ImplementationStatus" AS ENUM ('not_assessed', 'planned', 'in_progress', 'implemented', 'partially_implemented', 'not_applicable', 'retired');

-- CreateEnum
CREATE TYPE "TestResult" AS ENUM ('pass', 'fail', 'unknown', 'error', 'not_applicable');

-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('automated', 'manual');

-- CreateEnum
CREATE TYPE "MappingType" AS ENUM ('supports', 'partially_supports', 'related', 'requires_separate_evidence');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('unreviewed', 'pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "EvidenceClassification" AS ENUM ('public', 'internal', 'confidential', 'restricted');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('upload', 'integration', 'manual_record', 'generated_report');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('identified', 'assessed', 'treatment_planned', 'in_treatment', 'monitoring', 'accepted', 'closed');

-- CreateEnum
CREATE TYPE "RiskTreatment" AS ENUM ('undecided', 'mitigate', 'transfer', 'avoid', 'accept');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'triaged', 'in_remediation', 'pending_validation', 'closed', 'accepted', 'reopened');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'blocked', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "AcceptanceDecision" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'withdrawn');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('draft', 'onboarding', 'assessment_required', 'under_review', 'approved', 'approved_with_conditions', 'rejected', 'active', 'offboarding', 'archived');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('none', 'limited', 'privileged', 'administrative');

-- CreateEnum
CREATE TYPE "ResponseType" AS ENUM ('yes_no', 'single_choice', 'multiple_choice', 'text', 'number', 'date', 'file');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'submitted', 'under_review', 'returned_for_clarification', 'approved', 'closed');

-- CreateEnum
CREATE TYPE "ResponseReviewStatus" AS ENUM ('pending', 'accepted', 'insufficient', 'rejected');

-- CreateEnum
CREATE TYPE "AiLifecycleStatus" AS ENUM ('proposed', 'under_assessment', 'approved_for_pilot', 'pilot', 'approved_for_production', 'production', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "AiAssessmentStatus" AS ENUM ('draft', 'in_progress', 'submitted', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "AiItemResult" AS ENUM ('not_answered', 'satisfactory', 'needs_improvement', 'unsatisfactory', 'not_applicable');

-- CreateEnum
CREATE TYPE "AiRiskTier" AS ENUM ('minimal', 'limited', 'high', 'unacceptable', 'undetermined');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'investigating', 'mitigated', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "LegalReviewStatus" AS ENUM ('not_started', 'preliminary', 'under_legal_review', 'reviewed');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('not_configured', 'configured', 'healthy', 'degraded', 'failing', 'disabled');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'partially_succeeded', 'cancelled');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'delivered', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('queued', 'generating', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('pdf', 'csv', 'xlsx');

-- CreateEnum
CREATE TYPE "DraftDecision" AS ENUM ('pending', 'accepted', 'edited_and_accepted', 'rejected');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "external_identity" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token_hash" TEXT NOT NULL,
    "active_organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "role_keys" TEXT[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "inviter_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frameworks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "release_date" DATE,
    "source_url" TEXT,
    "retrieved_at" DATE,
    "license_notes" TEXT,
    "description" TEXT,
    "status" "FrameworkStatus" NOT NULL DEFAULT 'active',
    "is_illustrative" BOOLEAN NOT NULL DEFAULT true,
    "import_provenance" JSONB NOT NULL DEFAULT '{}',
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" UUID,

    CONSTRAINT "frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_requirements" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "requirement_code" TEXT NOT NULL,
    "parent_code" TEXT,
    "group_name" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "official_reference" TEXT,
    "source_version" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "framework_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controls" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "control_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_illustrative" BOOLEAN NOT NULL DEFAULT true,
    "review_frequency_days" INTEGER NOT NULL DEFAULT 90,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_mappings" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "source_requirement_id" UUID NOT NULL,
    "target_requirement_id" UUID,
    "control_id" UUID,
    "mapping_type" "MappingType" NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'unreviewed',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,
    "source_reference" TEXT,
    "framework_version" TEXT NOT NULL,
    "is_illustrative" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "control_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_mapping_history" (
    "id" UUID NOT NULL,
    "mapping_id" UUID NOT NULL,
    "organization_id" UUID,
    "previous_values" JSONB NOT NULL,
    "new_values" JSONB NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT,

    CONSTRAINT "control_mapping_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_implementations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "owner_id" UUID,
    "status" "ImplementationStatus" NOT NULL DEFAULT 'not_assessed',
    "applicability_rationale" TEXT,
    "soa_included" BOOLEAN NOT NULL DEFAULT true,
    "soa_justification" TEXT,
    "implementation_notes" TEXT,
    "last_reviewed_at" TIMESTAMPTZ(6),
    "next_review_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "control_implementations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_test_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "frequency_hours" INTEGER NOT NULL DEFAULT 24,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "integration_id" UUID,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "control_test_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_tests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "config_id" UUID,
    "test_type" "TestType" NOT NULL,
    "rule_key" TEXT,
    "test_rule_version" TEXT,
    "result" "TestResult" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "evidence_ids" UUID[],
    "manual_rationale" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "initiated_by" UUID,
    "source_integration_id" UUID,
    "evidence_snapshot" JSONB NOT NULL DEFAULT '{}',
    "finding_id" UUID,
    "workflow_run_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storage_key" TEXT,
    "original_filename" TEXT,
    "media_type" TEXT,
    "size_bytes" BIGINT,
    "sha256_checksum" TEXT,
    "source_type" "EvidenceSourceType" NOT NULL,
    "source_uri" TEXT,
    "collected_at" TIMESTAMPTZ(6),
    "valid_from" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "classification" "EvidenceClassification" NOT NULL DEFAULT 'internal',
    "owner_id" UUID,
    "uploaded_by" UUID,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending_review',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,
    "scan_status" TEXT NOT NULL DEFAULT 'not_scanned',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "purpose" TEXT,
    "relevance_notes" TEXT,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'unreviewed',
    "linked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_access_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rationale" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "inherent_score" INTEGER NOT NULL,
    "inherent_rating" "Severity" NOT NULL,
    "residual_likelihood" INTEGER,
    "residual_impact" INTEGER,
    "residual_score" INTEGER,
    "residual_rating" "Severity",
    "residual_rationale" TEXT,
    "scoring_policy_version" INTEGER NOT NULL,
    "risk_owner_id" UUID,
    "status" "RiskStatus" NOT NULL DEFAULT 'identified',
    "treatment" "RiskTreatment" NOT NULL DEFAULT 'undecided',
    "treatment_plan" TEXT,
    "acceptance_rationale" TEXT,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "acceptance_expires_at" TIMESTAMPTZ(6),
    "review_date" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_controls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'mitigates',
    "effectiveness_rating" TEXT NOT NULL DEFAULT 'not_assessed',
    "rationale" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_id" UUID NOT NULL,
    "previous_values" JSONB NOT NULL,
    "new_values" JSONB NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT,

    CONSTRAINT "risk_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_acceptances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT NOT NULL,
    "scope" TEXT,
    "expiry_date" TIMESTAMPTZ(6) NOT NULL,
    "risk_score_at_request" INTEGER NOT NULL,
    "decision" "AcceptanceDecision" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_rationale" TEXT,

    CONSTRAINT "risk_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "finding_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "category" TEXT,
    "severity" "Severity" NOT NULL,
    "severity_rationale" TEXT,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "control_id" UUID,
    "risk_id" UUID,
    "first_detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detection_count" INTEGER NOT NULL DEFAULT 1,
    "assigned_to" UUID,
    "due_date" TIMESTAMPTZ(6),
    "no_due_date_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "closure_rationale" TEXT,
    "closure_evidence_id" UUID,
    "deduplication_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "FindingStatus",
    "to_status" "FindingStatus",
    "actor_id" UUID,
    "rationale" TEXT,
    "source_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "finding_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "due_date" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "completion_notes" TEXT,
    "completion_evidence_id" UUID,
    "vendor_response" TEXT,
    "internal_review_status" "ReviewStatus" NOT NULL DEFAULT 'unreviewed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "remediation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "external_reference" TEXT,
    "service_description" TEXT NOT NULL,
    "website" TEXT,
    "business_owner_id" UUID,
    "criticality" "Criticality" NOT NULL DEFAULT 'medium',
    "data_classification" "EvidenceClassification" NOT NULL DEFAULT 'internal',
    "data_types" TEXT[],
    "personal_data_access" BOOLEAN NOT NULL DEFAULT false,
    "access_level" "AccessLevel" NOT NULL DEFAULT 'none',
    "business_dependency" INTEGER NOT NULL DEFAULT 3,
    "service_impact" INTEGER NOT NULL DEFAULT 3,
    "regions" TEXT[],
    "dependencies" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'draft',
    "inherent_risk_score" INTEGER,
    "residual_risk_score" INTEGER,
    "risk_tier" "Severity",
    "last_assessed_at" TIMESTAMPTZ(6),
    "next_assessment_at" TIMESTAMPTZ(6),
    "reassessment_frequency_days" INTEGER NOT NULL DEFAULT 365,
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "contact_type" TEXT NOT NULL DEFAULT 'security',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "response_type" "ResponseType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "guidance" TEXT,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "expected_answer" JSONB,
    "depends_on_question_key" TEXT,
    "depends_on_answer" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "assessment_version" INTEGER NOT NULL DEFAULT 1,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "assessor_id" UUID,
    "due_date" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "score" INTEGER,
    "inherent_risk" INTEGER,
    "residual_risk" INTEGER,
    "risk_tier" "Severity",
    "score_breakdown" JSONB,
    "scoring_policy_version" INTEGER,
    "decision" TEXT,
    "decision_rationale" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "report_status" TEXT NOT NULL DEFAULT 'draft',
    "next_review_at" TIMESTAMPTZ(6),
    "internal_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" JSONB,
    "not_applicable" BOOLEAN NOT NULL DEFAULT false,
    "na_rationale" TEXT,
    "comments" TEXT,
    "evidence_id" UUID,
    "reviewer_status" "ResponseReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewer_notes" TEXT,
    "answered_at" TIMESTAMPTZ(6),
    "answered_by" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "question_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_risk_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "assessment_id" UUID,
    "inherent_score" INTEGER,
    "residual_score" INTEGER,
    "tier" "Severity",
    "policy_version" INTEGER,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_risk_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_portal_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "contact_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_systems" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "business_purpose" TEXT NOT NULL,
    "business_justification" TEXT,
    "business_owner_id" UUID,
    "technical_owner_id" UUID,
    "risk_owner_id" UUID,
    "provider_vendor_id" UUID,
    "model_name" TEXT,
    "model_version" TEXT,
    "deployment_type" TEXT NOT NULL,
    "deployment_environment" TEXT,
    "lifecycle_status" "AiLifecycleStatus" NOT NULL DEFAULT 'proposed',
    "risk_tier" "AiRiskTier" NOT NULL DEFAULT 'undetermined',
    "intended_users" TEXT,
    "affected_people" TEXT,
    "input_data_categories" TEXT[],
    "output_data_categories" TEXT[],
    "personal_data_processed" BOOLEAN NOT NULL DEFAULT false,
    "sensitive_data_processed" BOOLEAN NOT NULL DEFAULT false,
    "data_retention" TEXT,
    "data_location" TEXT,
    "automated_decision_making" BOOLEAN NOT NULL DEFAULT false,
    "influences_decisions_about_people" BOOLEAN NOT NULL DEFAULT false,
    "human_oversight" TEXT,
    "override_and_appeal" TEXT,
    "escalation_path" TEXT,
    "external_dependencies" TEXT,
    "known_limitations" TEXT,
    "foreseeable_misuse" TEXT,
    "rollback_plan" TEXT,
    "deployment_date" TIMESTAMPTZ(6),
    "retirement_date" TIMESTAMPTZ(6),
    "next_review_at" TIMESTAMPTZ(6),
    "documentation_uri" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_system_id" UUID NOT NULL,
    "framework_id" UUID,
    "template_id" UUID,
    "assessment_version" INTEGER NOT NULL DEFAULT 1,
    "status" "AiAssessmentStatus" NOT NULL DEFAULT 'draft',
    "assessor_id" UUID,
    "risk_tier" "AiRiskTier" NOT NULL DEFAULT 'undetermined',
    "overall_result" TEXT,
    "rationale" TEXT,
    "residual_risk_notes" TEXT,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "assessed_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_rationale" TEXT,
    "next_review_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessment_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "rmf_function" TEXT,
    "question_key" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "response" JSONB,
    "evidence_id" UUID,
    "result" "AiItemResult" NOT NULL DEFAULT 'not_answered',
    "rationale" TEXT,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_assessment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_system_id" UUID NOT NULL,
    "evaluation_type" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "dataset_or_method_description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "limitations" TEXT NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL,
    "executed_by" UUID,
    "evidence_id" UUID,
    "approval_status" "ReviewStatus" NOT NULL DEFAULT 'pending_review',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incidents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_system_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "reported_by" UUID,
    "impact" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "root_cause" TEXT,
    "response_actions" TEXT,
    "lessons_learned" TEXT,
    "finding_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_system_id" UUID NOT NULL,
    "change_type" TEXT NOT NULL,
    "change_description" TEXT NOT NULL,
    "previous_version" TEXT,
    "new_version" TEXT,
    "change_risk" "Severity" NOT NULL,
    "requires_reassessment" BOOLEAN NOT NULL DEFAULT true,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending_review',
    "requested_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eu_ai_act_applicability" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ai_system_id" UUID NOT NULL,
    "organization_role" TEXT,
    "system_role" TEXT,
    "intended_purpose" TEXT,
    "geographic_scope" TEXT,
    "placed_on_eu_market" BOOLEAN,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "potential_prohibited_practice" BOOLEAN,
    "potential_high_risk" BOOLEAN,
    "transparency_obligations" BOOLEAN,
    "preliminary_classification" "AiRiskTier" NOT NULL DEFAULT 'undetermined',
    "rationale" TEXT,
    "evidence_ids" UUID[],
    "reviewer_id" UUID,
    "review_date" TIMESTAMPTZ(6),
    "legal_review_status" "LegalReviewStatus" NOT NULL DEFAULT 'not_started',
    "source_url" TEXT,
    "source_checked_at" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eu_ai_act_applicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'not_configured',
    "is_demo" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "configuration_reference" TEXT,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "last_failure_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "sync_cursor" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "correlation_id" TEXT NOT NULL,
    "initiated_by" UUID,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "sync_run_id" UUID NOT NULL,

    CONSTRAINT "integration_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT NOT NULL,
    "event_type" TEXT,
    "schedule_cron" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "trigger_source" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(6),
    "locked_until" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "result_summary" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "correlation_id" TEXT NOT NULL,
    "initiated_by" UUID,
    "retry_of_run_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "step_key" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "input_reference" TEXT,
    "output_summary" JSONB,
    "error_code" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "email_status" "DeliveryStatus" NOT NULL DEFAULT 'suppressed',
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'delivered',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "source_ip" TEXT,
    "user_agent" TEXT,
    "before_summary" JSONB,
    "after_summary" JSONB,
    "rationale" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "title" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "report_status" TEXT NOT NULL DEFAULT 'draft',
    "generated_by" UUID,
    "schedule_id" UUID,
    "generated_at" TIMESTAMPTZ(6),
    "status" "ReportStatus" NOT NULL DEFAULT 'queued',
    "storage_key" TEXT,
    "checksum" TEXT,
    "size_bytes" INTEGER,
    "source_record_ids" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "frequency" TEXT NOT NULL,
    "recipient_user_ids" UUID[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_artifacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "source_records" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "schema_valid" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "limitations" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "error_code" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reviewer_id" UUID,
    "decision" "DraftDecision" NOT NULL DEFAULT 'pending',
    "reviewer_edits" JSONB,
    "reviewed_at" TIMESTAMPTZ(6),
    "used_in_record_type" TEXT,
    "used_in_record_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_idx" ON "invitations"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_key_version_key" ON "frameworks"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "framework_requirements_framework_id_requirement_code_key" ON "framework_requirements"("framework_id", "requirement_code");

-- CreateIndex
CREATE INDEX "controls_organization_id_category_idx" ON "controls"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "controls_organization_id_control_code_key" ON "controls"("organization_id", "control_code");

-- CreateIndex
CREATE INDEX "control_mappings_organization_id_review_status_idx" ON "control_mappings"("organization_id", "review_status");

-- CreateIndex
CREATE INDEX "control_mappings_source_requirement_id_idx" ON "control_mappings"("source_requirement_id");

-- CreateIndex
CREATE INDEX "control_mappings_control_id_idx" ON "control_mappings"("control_id");

-- CreateIndex
CREATE INDEX "control_mapping_history_mapping_id_idx" ON "control_mapping_history"("mapping_id");

-- CreateIndex
CREATE INDEX "control_implementations_organization_id_status_idx" ON "control_implementations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "control_implementations_organization_id_owner_id_idx" ON "control_implementations"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "control_implementations_organization_id_next_review_at_idx" ON "control_implementations"("organization_id", "next_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_implementations_organization_id_control_id_key" ON "control_implementations"("organization_id", "control_id");

-- CreateIndex
CREATE INDEX "control_test_configs_organization_id_enabled_next_run_at_idx" ON "control_test_configs"("organization_id", "enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_test_configs_organization_id_control_id_rule_key_key" ON "control_test_configs"("organization_id", "control_id", "rule_key");

-- CreateIndex
CREATE INDEX "control_tests_organization_id_control_id_completed_at_idx" ON "control_tests"("organization_id", "control_id", "completed_at");

-- CreateIndex
CREATE INDEX "control_tests_organization_id_result_idx" ON "control_tests"("organization_id", "result");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_storage_key_key" ON "evidence"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_organization_id_expires_at_idx" ON "evidence"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "evidence_organization_id_review_status_idx" ON "evidence"("organization_id", "review_status");

-- CreateIndex
CREATE INDEX "evidence_organization_id_archived_at_idx" ON "evidence"("organization_id", "archived_at");

-- CreateIndex
CREATE INDEX "evidence_links_organization_id_entity_type_entity_id_idx" ON "evidence_links"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_links_evidence_id_entity_type_entity_id_key" ON "evidence_links"("evidence_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "evidence_access_logs_organization_id_evidence_id_idx" ON "evidence_access_logs"("organization_id", "evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_policies_organization_id_kind_version_key" ON "scoring_policies"("organization_id", "kind", "version");

-- CreateIndex
CREATE INDEX "risks_organization_id_status_idx" ON "risks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "risks_organization_id_inherent_rating_idx" ON "risks"("organization_id", "inherent_rating");

-- CreateIndex
CREATE INDEX "risks_organization_id_risk_owner_id_idx" ON "risks"("organization_id", "risk_owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "risks_organization_id_risk_key_key" ON "risks"("organization_id", "risk_key");

-- CreateIndex
CREATE INDEX "risk_links_organization_id_entity_type_entity_id_idx" ON "risk_links"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_links_risk_id_entity_type_entity_id_key" ON "risk_links"("risk_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "risk_controls_organization_id_control_id_idx" ON "risk_controls"("organization_id", "control_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_controls_risk_id_control_id_key" ON "risk_controls"("risk_id", "control_id");

-- CreateIndex
CREATE INDEX "risk_history_organization_id_risk_id_changed_at_idx" ON "risk_history"("organization_id", "risk_id", "changed_at");

-- CreateIndex
CREATE INDEX "risk_acceptances_organization_id_decision_idx" ON "risk_acceptances"("organization_id", "decision");

-- CreateIndex
CREATE INDEX "risk_acceptances_organization_id_expiry_date_idx" ON "risk_acceptances"("organization_id", "expiry_date");

-- CreateIndex
CREATE INDEX "findings_organization_id_status_severity_idx" ON "findings"("organization_id", "status", "severity");

-- CreateIndex
CREATE INDEX "findings_organization_id_assigned_to_idx" ON "findings"("organization_id", "assigned_to");

-- CreateIndex
CREATE INDEX "findings_organization_id_due_date_idx" ON "findings"("organization_id", "due_date");

-- CreateIndex
CREATE INDEX "findings_organization_id_deduplication_key_idx" ON "findings"("organization_id", "deduplication_key");

-- CreateIndex
CREATE UNIQUE INDEX "findings_organization_id_finding_key_key" ON "findings"("organization_id", "finding_key");

-- CreateIndex
CREATE INDEX "finding_events_organization_id_finding_id_created_at_idx" ON "finding_events"("organization_id", "finding_id", "created_at");

-- CreateIndex
CREATE INDEX "remediation_tasks_organization_id_status_idx" ON "remediation_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "remediation_tasks_organization_id_owner_id_idx" ON "remediation_tasks"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "remediation_tasks_organization_id_due_date_idx" ON "remediation_tasks"("organization_id", "due_date");

-- CreateIndex
CREATE INDEX "vendors_organization_id_status_idx" ON "vendors"("organization_id", "status");

-- CreateIndex
CREATE INDEX "vendors_organization_id_risk_tier_idx" ON "vendors"("organization_id", "risk_tier");

-- CreateIndex
CREATE INDEX "vendors_organization_id_next_assessment_at_idx" ON "vendors"("organization_id", "next_assessment_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organization_id_name_key" ON "vendors"("organization_id", "name");

-- CreateIndex
CREATE INDEX "vendor_contacts_organization_id_vendor_id_idx" ON "vendor_contacts"("organization_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_templates_organization_id_key_version_key" ON "assessment_templates"("organization_id", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_template_id_question_key_key" ON "assessment_questions"("template_id", "question_key");

-- CreateIndex
CREATE INDEX "vendor_assessments_organization_id_vendor_id_idx" ON "vendor_assessments"("organization_id", "vendor_id");

-- CreateIndex
CREATE INDEX "vendor_assessments_organization_id_status_idx" ON "vendor_assessments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "question_responses_organization_id_assessment_id_idx" ON "question_responses"("organization_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_responses_assessment_id_question_id_key" ON "question_responses"("assessment_id", "question_id");

-- CreateIndex
CREATE INDEX "vendor_risk_history_organization_id_vendor_id_recorded_at_idx" ON "vendor_risk_history"("organization_id", "vendor_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_portal_invitations_token_hash_key" ON "vendor_portal_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "vendor_portal_invitations_organization_id_assessment_id_idx" ON "vendor_portal_invitations"("organization_id", "assessment_id");

-- CreateIndex
CREATE INDEX "ai_systems_organization_id_lifecycle_status_idx" ON "ai_systems"("organization_id", "lifecycle_status");

-- CreateIndex
CREATE INDEX "ai_systems_organization_id_risk_tier_idx" ON "ai_systems"("organization_id", "risk_tier");

-- CreateIndex
CREATE UNIQUE INDEX "ai_systems_organization_id_name_key" ON "ai_systems"("organization_id", "name");

-- CreateIndex
CREATE INDEX "ai_assessments_organization_id_ai_system_id_idx" ON "ai_assessments"("organization_id", "ai_system_id");

-- CreateIndex
CREATE INDEX "ai_assessments_organization_id_status_idx" ON "ai_assessments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ai_assessment_items_organization_id_assessment_id_idx" ON "ai_assessment_items"("organization_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assessment_items_assessment_id_question_key_key" ON "ai_assessment_items"("assessment_id", "question_key");

-- CreateIndex
CREATE INDEX "ai_evaluations_organization_id_ai_system_id_executed_at_idx" ON "ai_evaluations"("organization_id", "ai_system_id", "executed_at");

-- CreateIndex
CREATE INDEX "ai_incidents_organization_id_ai_system_id_idx" ON "ai_incidents"("organization_id", "ai_system_id");

-- CreateIndex
CREATE INDEX "ai_incidents_organization_id_status_idx" ON "ai_incidents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ai_model_changes_organization_id_ai_system_id_idx" ON "ai_model_changes"("organization_id", "ai_system_id");

-- CreateIndex
CREATE INDEX "ai_model_changes_organization_id_review_status_idx" ON "ai_model_changes"("organization_id", "review_status");

-- CreateIndex
CREATE INDEX "eu_ai_act_applicability_organization_id_ai_system_id_idx" ON "eu_ai_act_applicability"("organization_id", "ai_system_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_organization_id_provider_key" ON "integrations"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "integration_sync_runs_organization_id_integration_id_starte_idx" ON "integration_sync_runs"("organization_id", "integration_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_records_organization_id_integration_id_record_t_key" ON "integration_records"("organization_id", "integration_id", "record_type", "external_id");

-- CreateIndex
CREATE INDEX "workflow_definitions_enabled_next_run_at_idx" ON "workflow_definitions"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_key_key" ON "workflow_definitions"("organization_id", "key");

-- CreateIndex
CREATE INDEX "workflow_runs_status_next_attempt_at_idx" ON "workflow_runs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "workflow_runs_organization_id_created_at_idx" ON "workflow_runs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_organization_id_idempotency_key_key" ON "workflow_runs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "workflow_steps_workflow_run_id_idx" ON "workflow_steps"("workflow_run_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_user_id_read_at_idx" ON "notifications"("organization_id", "recipient_user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_recipient_user_id_dedupe_key_key" ON "notifications"("organization_id", "recipient_user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_organization_id_user_id_event_type_key" ON "notification_preferences"("organization_id", "user_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_timestamp_idx" ON "audit_events"("organization_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_entity_type_entity_id_idx" ON "audit_events"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_action_idx" ON "audit_events"("organization_id", "action");

-- CreateIndex
CREATE INDEX "report_runs_organization_id_created_at_idx" ON "report_runs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "report_schedules_enabled_next_run_at_idx" ON "report_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "ai_artifacts_organization_id_created_at_idx" ON "ai_artifacts"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_artifacts_organization_id_artifact_type_idx" ON "ai_artifacts"("organization_id", "artifact_type");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organization_id_scope_key_key" ON "idempotency_keys"("organization_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_requirements" ADD CONSTRAINT "framework_requirements_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_source_requirement_id_fkey" FOREIGN KEY ("source_requirement_id") REFERENCES "framework_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_target_requirement_id_fkey" FOREIGN KEY ("target_requirement_id") REFERENCES "framework_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mapping_history" ADD CONSTRAINT "control_mapping_history_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "control_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mapping_history" ADD CONSTRAINT "control_mapping_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_implementations" ADD CONSTRAINT "control_implementations_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_implementations" ADD CONSTRAINT "control_implementations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_implementations" ADD CONSTRAINT "control_implementations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_test_configs" ADD CONSTRAINT "control_test_configs_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_test_configs" ADD CONSTRAINT "control_test_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_access_logs" ADD CONSTRAINT "evidence_access_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_policies" ADD CONSTRAINT "scoring_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_risk_owner_id_fkey" FOREIGN KEY ("risk_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_links" ADD CONSTRAINT "risk_links_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_links" ADD CONSTRAINT "risk_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_history" ADD CONSTRAINT "risk_history_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_history" ADD CONSTRAINT "risk_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_events" ADD CONSTRAINT "finding_events_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_events" ADD CONSTRAINT "finding_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_business_owner_id_fkey" FOREIGN KEY ("business_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assessments" ADD CONSTRAINT "vendor_assessments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assessments" ADD CONSTRAINT "vendor_assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assessments" ADD CONSTRAINT "vendor_assessments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assessments" ADD CONSTRAINT "vendor_assessments_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "vendor_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_risk_history" ADD CONSTRAINT "vendor_risk_history_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_risk_history" ADD CONSTRAINT "vendor_risk_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_portal_invitations" ADD CONSTRAINT "vendor_portal_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_portal_invitations" ADD CONSTRAINT "vendor_portal_invitations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "vendor_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_business_owner_id_fkey" FOREIGN KEY ("business_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_technical_owner_id_fkey" FOREIGN KEY ("technical_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_risk_owner_id_fkey" FOREIGN KEY ("risk_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_provider_vendor_id_fkey" FOREIGN KEY ("provider_vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessments" ADD CONSTRAINT "ai_assessments_ai_system_id_fkey" FOREIGN KEY ("ai_system_id") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessments" ADD CONSTRAINT "ai_assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessments" ADD CONSTRAINT "ai_assessments_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessments" ADD CONSTRAINT "ai_assessments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_items" ADD CONSTRAINT "ai_assessment_items_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_items" ADD CONSTRAINT "ai_assessment_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluations" ADD CONSTRAINT "ai_evaluations_ai_system_id_fkey" FOREIGN KEY ("ai_system_id") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluations" ADD CONSTRAINT "ai_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_ai_system_id_fkey" FOREIGN KEY ("ai_system_id") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_changes" ADD CONSTRAINT "ai_model_changes_ai_system_id_fkey" FOREIGN KEY ("ai_system_id") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_changes" ADD CONSTRAINT "ai_model_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eu_ai_act_applicability" ADD CONSTRAINT "eu_ai_act_applicability_ai_system_id_fkey" FOREIGN KEY ("ai_system_id") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eu_ai_act_applicability" ADD CONSTRAINT "eu_ai_act_applicability_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_records" ADD CONSTRAINT "integration_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_records" ADD CONSTRAINT "integration_records_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
