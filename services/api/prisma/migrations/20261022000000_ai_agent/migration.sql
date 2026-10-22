-- AlterTable
ALTER TABLE "ai_artifacts" ADD COLUMN     "agent_job" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "target_id" UUID,
ADD COLUMN     "target_type" TEXT,
ALTER COLUMN "requested_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "trust_questionnaires" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "due_date" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trust_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_questionnaire_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "questionnaire_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "section" TEXT,
    "question_text" TEXT NOT NULL,
    "answer_status" TEXT NOT NULL DEFAULT 'pending',
    "short_answer" TEXT,
    "draft_answer" TEXT,
    "final_answer" TEXT,
    "confidence" TEXT,
    "sources" JSONB,
    "answer_source" TEXT,
    "library_answer_id" UUID,
    "ai_artifact_id" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trust_questionnaire_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_answers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "short_answer" TEXT,
    "answer" TEXT NOT NULL,
    "sources" JSONB,
    "approved_by" UUID,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trust_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trust_questionnaires_organization_id_status_idx" ON "trust_questionnaires"("organization_id", "status");

-- CreateIndex
CREATE INDEX "trust_questionnaire_items_organization_id_answer_status_idx" ON "trust_questionnaire_items"("organization_id", "answer_status");

-- CreateIndex
CREATE UNIQUE INDEX "trust_questionnaire_items_questionnaire_id_sort_order_key" ON "trust_questionnaire_items"("questionnaire_id", "sort_order");

-- CreateIndex
CREATE INDEX "trust_answers_organization_id_active_idx" ON "trust_answers"("organization_id", "active");

-- CreateIndex
CREATE INDEX "ai_artifacts_organization_id_target_id_artifact_type_idx" ON "ai_artifacts"("organization_id", "target_id", "artifact_type");

-- CreateIndex
CREATE INDEX "ai_artifacts_origin_created_at_idx" ON "ai_artifacts"("origin", "created_at");

-- AddForeignKey
ALTER TABLE "trust_questionnaires" ADD CONSTRAINT "trust_questionnaires_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_questionnaire_items" ADD CONSTRAINT "trust_questionnaire_items_questionnaire_id_fkey" FOREIGN KEY ("questionnaire_id") REFERENCES "trust_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_questionnaire_items" ADD CONSTRAINT "trust_questionnaire_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_answers" ADD CONSTRAINT "trust_answers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity constraints (same style as 20261021000100_integrity_constraints)
ALTER TABLE "ai_artifacts"
  ADD CONSTRAINT "ai_artifacts_origin_values" CHECK ("origin" IN ('user', 'agent')),
  ADD CONSTRAINT "ai_artifacts_requester_or_agent" CHECK ("origin" = 'agent' OR "requested_by" IS NOT NULL);

ALTER TABLE "trust_questionnaires"
  ADD CONSTRAINT "trust_questionnaires_status_values" CHECK ("status" IN ('draft', 'answering', 'in_review', 'completed'));

ALTER TABLE "trust_questionnaire_items"
  ADD CONSTRAINT "trust_items_status_values" CHECK ("answer_status" IN ('pending', 'drafted', 'needs_input', 'approved')),
  ADD CONSTRAINT "trust_items_approved_has_answer" CHECK ("answer_status" <> 'approved' OR ("final_answer" IS NOT NULL AND "reviewed_by" IS NOT NULL));
