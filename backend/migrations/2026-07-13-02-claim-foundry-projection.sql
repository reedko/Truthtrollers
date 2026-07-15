-- CF1 inactive projection provenance. Review and run manually.
-- Existing TM4/manual rows remain legacy-scoped and are never deleted here.

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

CALL cf1_add_projection_column('content_claims', 'claim_foundry_package_id',
  'ALTER TABLE content_claims ADD COLUMN claim_foundry_package_id VARCHAR(48) NULL');
CALL cf1_add_projection_column('content_claims', 'claim_foundry_selected_claim_id',
  'ALTER TABLE content_claims ADD COLUMN claim_foundry_selected_claim_id VARCHAR(16) NULL');
CALL cf1_add_projection_column('content_claims', 'claim_foundry_binding_id',
  'ALTER TABLE content_claims ADD COLUMN claim_foundry_binding_id BIGINT UNSIGNED NULL');

CALL cf1_add_projection_column('claim_evaluation_targets', 'claim_foundry_package_id',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN claim_foundry_package_id VARCHAR(48) NULL');
CALL cf1_add_projection_column('claim_evaluation_targets', 'claim_foundry_target_id',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN claim_foundry_target_id VARCHAR(16) NULL');
CALL cf1_add_projection_column('claim_evaluation_targets', 'claim_foundry_card_id',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN claim_foundry_card_id VARCHAR(24) NULL');
CALL cf1_add_projection_column('claim_evaluation_targets', 'evidence_need_card_json',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN evidence_need_card_json JSON NULL');
CALL cf1_add_projection_column('claim_evaluation_targets', 'projection_scope_key',
  "ALTER TABLE claim_evaluation_targets ADD COLUMN projection_scope_key VARCHAR(48) GENERATED ALWAYS AS (COALESCE(claim_foundry_package_id, 'legacy')) STORED");

DROP PROCEDURE IF EXISTS cf1_add_projection_column;
DROP PROCEDURE IF EXISTS cf1_add_projection_index;
DELIMITER $$
CREATE PROCEDURE cf1_add_projection_index(
  IN table_name_value VARCHAR(64), IN index_name_value VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_name_value
      AND INDEX_NAME = index_name_value) THEN
    SET @cf1_ddl = ddl; PREPARE cf1_stmt FROM @cf1_ddl;
    EXECUTE cf1_stmt; DEALLOCATE PREPARE cf1_stmt;
  END IF;
END$$
DELIMITER ;

CALL cf1_add_projection_index('content_claims', 'uq_cc_cf1_package_selected',
  'ALTER TABLE content_claims ADD UNIQUE KEY uq_cc_cf1_package_selected (claim_foundry_package_id, claim_foundry_selected_claim_id)');
CALL cf1_add_projection_index('content_claims', 'idx_cc_cf1_content_package',
  'ALTER TABLE content_claims ADD KEY idx_cc_cf1_content_package (content_id, claim_foundry_package_id, selected_for_evaluation)');
CALL cf1_add_projection_index('claim_evaluation_targets', 'uq_cet_cf1_package_target',
  'ALTER TABLE claim_evaluation_targets ADD UNIQUE KEY uq_cet_cf1_package_target (claim_foundry_package_id, claim_foundry_target_id)');
CALL cf1_add_projection_index('claim_evaluation_targets', 'idx_cet_cf1_package_eligible',
  'ALTER TABLE claim_evaluation_targets ADD KEY idx_cet_cf1_package_eligible (claim_foundry_package_id, search_eligible, verdict_eligible)');

-- The legacy key cannot coexist with independent package target-order scopes.
DROP PROCEDURE IF EXISTS cf1_replace_target_scope_key;
DELIMITER $$
CREATE PROCEDURE cf1_replace_target_scope_key()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'claim_evaluation_targets' AND INDEX_NAME = 'uq_cet_projection_scope_order') THEN
    ALTER TABLE claim_evaluation_targets ADD UNIQUE KEY uq_cet_projection_scope_order
      (content_id, claim_id, projection_scope_key, target_order);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'claim_evaluation_targets' AND INDEX_NAME = 'uq_claim_evaluation_target_order') THEN
    ALTER TABLE claim_evaluation_targets DROP INDEX uq_claim_evaluation_target_order;
  END IF;
END$$
DELIMITER ;
CALL cf1_replace_target_scope_key();
DROP PROCEDURE IF EXISTS cf1_replace_target_scope_key;
DROP PROCEDURE IF EXISTS cf1_add_projection_index;
