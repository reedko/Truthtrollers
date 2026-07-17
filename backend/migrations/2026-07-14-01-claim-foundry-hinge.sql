-- CF1 Step 3b: queryable hinge/verification columns for the inactive (shadow) projection.
-- Additive, nullable, idempotent. Existing TM4/manual rows stay legacy-scoped (columns NULL).
-- Blob copies remain in evidence_need_card_json / argument_mapping_rationale; these columns
-- exist so the attribution-vs-substance decision is queryable on BOTH projected tables.

DROP PROCEDURE IF EXISTS cf1_add_projection_column;
DELIMITER $$
CREATE PROCEDURE cf1_add_projection_column(
  IN table_name_value VARCHAR(64), IN column_name_value VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_name_value
      AND COLUMN_NAME = column_name_value) THEN
    SET @cf1_ddl = ddl; PREPARE cf1_stmt FROM @cf1_ddl;
    EXECUTE cf1_stmt; DEALLOCATE PREPARE cf1_stmt;
  END IF;
END$$
DELIMITER ;

-- Target side: gradeTarget (Knob B) + verificationTarget (from disputedQuestion).
CALL cf1_add_projection_column('claim_evaluation_targets', 'cf1_grade_target',
  "ALTER TABLE claim_evaluation_targets ADD COLUMN cf1_grade_target ENUM('substance','attribution') NULL");
CALL cf1_add_projection_column('claim_evaluation_targets', 'cf1_verification_target',
  "ALTER TABLE claim_evaluation_targets ADD COLUMN cf1_verification_target ENUM('substantive','both_needed') NULL");

-- Claim side: gradeTarget + the article-level thesisHinge (previously absent entirely on claims).
CALL cf1_add_projection_column('content_claims', 'cf1_grade_target',
  "ALTER TABLE content_claims ADD COLUMN cf1_grade_target ENUM('substance','attribution') NULL");
CALL cf1_add_projection_column('content_claims', 'cf1_thesis_hinge',
  "ALTER TABLE content_claims ADD COLUMN cf1_thesis_hinge ENUM('substance','attribution','mixed') NULL");

DROP PROCEDURE IF EXISTS cf1_add_projection_column;
