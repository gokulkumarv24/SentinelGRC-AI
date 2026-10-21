-- Corrects the column name created by 20261021030000 (schema mapper ran before formatting).
ALTER TABLE "assessment_questions" RENAME COLUMN "rmfFunction" TO "rmf_function";
