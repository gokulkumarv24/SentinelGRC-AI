-- Integrity rules Prisma cannot express in schema.prisma (spec §5.2, §6, §16.2).

-- ── Risk scores: 1–5 factors, 1–25 scores ──
ALTER TABLE "risks"
  ADD CONSTRAINT "risks_likelihood_range" CHECK ("likelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "risks_impact_range" CHECK ("impact" BETWEEN 1 AND 5),
  ADD CONSTRAINT "risks_inherent_score_range" CHECK ("inherent_score" BETWEEN 1 AND 25),
  ADD CONSTRAINT "risks_residual_likelihood_range" CHECK ("residual_likelihood" IS NULL OR "residual_likelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "risks_residual_impact_range" CHECK ("residual_impact" IS NULL OR "residual_impact" BETWEEN 1 AND 5),
  ADD CONSTRAINT "risks_residual_score_range" CHECK ("residual_score" IS NULL OR "residual_score" BETWEEN 1 AND 25),
  ADD CONSTRAINT "risks_residual_pair" CHECK (("residual_likelihood" IS NULL) = ("residual_impact" IS NULL)),
  ADD CONSTRAINT "risks_acceptance_requires_approver" CHECK ("status" <> 'accepted' OR ("accepted_by" IS NOT NULL AND "accepted_at" IS NOT NULL));

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_business_dependency_range" CHECK ("business_dependency" BETWEEN 1 AND 5),
  ADD CONSTRAINT "vendors_service_impact_range" CHECK ("service_impact" BETWEEN 1 AND 5),
  ADD CONSTRAINT "vendors_reassessment_positive" CHECK ("reassessment_frequency_days" > 0);

-- ── Valid date relationships ──
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_validity_order" CHECK ("valid_from" IS NULL OR "expires_at" IS NULL OR "expires_at" > "valid_from"),
  ADD CONSTRAINT "evidence_size_non_negative" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  ADD CONSTRAINT "evidence_checksum_format" CHECK ("sha256_checksum" IS NULL OR "sha256_checksum" ~ '^[0-9a-f]{64}$');

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_order" CHECK ("absolute_expires_at" > "created_at");

ALTER TABLE "control_tests"
  ADD CONSTRAINT "control_tests_time_order" CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "findings"
  ADD CONSTRAINT "findings_detection_order" CHECK ("last_detected_at" >= "first_detected_at"),
  ADD CONSTRAINT "findings_closure_requires_rationale" CHECK ("status" NOT IN ('closed', 'accepted') OR ("closure_rationale" IS NOT NULL AND "closed_by" IS NOT NULL)),
  ADD CONSTRAINT "findings_due_date_or_reason" CHECK ("due_date" IS NOT NULL OR "no_due_date_reason" IS NOT NULL OR "status" IN ('closed', 'accepted'));

ALTER TABLE "risk_acceptances"
  ADD CONSTRAINT "risk_acceptances_decision_complete" CHECK ("decision" IN ('pending', 'expired', 'withdrawn') OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL));

ALTER TABLE "ai_systems"
  ADD CONSTRAINT "ai_systems_retirement_order" CHECK ("deployment_date" IS NULL OR "retirement_date" IS NULL OR "retirement_date" >= "deployment_date");

ALTER TABLE "control_mappings"
  ADD CONSTRAINT "control_mappings_confidence_range" CHECK ("confidence" BETWEEN 0 AND 100),
  ADD CONSTRAINT "control_mappings_one_target" CHECK (("target_requirement_id" IS NULL) <> ("control_id" IS NULL));

ALTER TABLE "control_test_configs"
  ADD CONSTRAINT "control_test_configs_frequency_positive" CHECK ("frequency_hours" > 0);

ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_attempts" CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 10);

-- ── Finding de-duplication: at most one non-closed finding per dedup key (spec §6.2) ──
CREATE UNIQUE INDEX "findings_open_dedup_key"
  ON "findings" ("organization_id", "deduplication_key")
  WHERE "deduplication_key" IS NOT NULL AND "status" NOT IN ('closed', 'accepted');

-- ── Audit log is append-only at the database level (spec §16.2) ──
-- UPDATE/DELETE are rejected unless a maintenance session explicitly sets
-- `SET LOCAL sentinel.audit_maintenance = 'on'` (e.g. a documented retention job).
-- A database superuser can still bypass this; see docs/SECURITY.md.
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('sentinel.audit_maintenance', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();

-- Same protection for risk history (historical traceability).
CREATE TRIGGER "risk_history_no_update_delete"
  BEFORE UPDATE OR DELETE ON "risk_history"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();

CREATE TRIGGER "finding_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "finding_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
