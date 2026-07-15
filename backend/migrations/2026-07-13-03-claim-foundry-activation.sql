-- CF1 controlled activation. Review and run manually after projection migration.

DROP PROCEDURE IF EXISTS cf1_add_activation_column;
DELIMITER $$
CREATE PROCEDURE cf1_add_activation_column(IN column_name_value VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'claim_foundry_package_bindings' AND COLUMN_NAME = column_name_value) THEN
    SET @cf1_ddl = ddl; PREPARE cf1_stmt FROM @cf1_ddl;
    EXECUTE cf1_stmt; DEALLOCATE PREPARE cf1_stmt;
  END IF;
END$$
DELIMITER ;

CALL cf1_add_activation_column('is_active_projection',
  'ALTER TABLE claim_foundry_package_bindings ADD COLUMN is_active_projection TINYINT(1) NOT NULL DEFAULT 0');
CALL cf1_add_activation_column('active_content_id',
  'ALTER TABLE claim_foundry_package_bindings ADD COLUMN active_content_id INT GENERATED ALWAYS AS (CASE WHEN is_active_projection = 1 THEN content_id ELSE NULL END) STORED');
DROP PROCEDURE IF EXISTS cf1_add_activation_column;

DROP PROCEDURE IF EXISTS cf1_add_activation_index;
DELIMITER $$
CREATE PROCEDURE cf1_add_activation_index()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'claim_foundry_package_bindings' AND INDEX_NAME = 'uq_cf1_active_content') THEN
    ALTER TABLE claim_foundry_package_bindings ADD UNIQUE KEY uq_cf1_active_content
      (consumer_key, active_content_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'claim_foundry_package_bindings' AND INDEX_NAME = 'idx_cf1_active_package') THEN
    ALTER TABLE claim_foundry_package_bindings ADD KEY idx_cf1_active_package
      (content_id, is_active_projection, package_id);
  END IF;
END$$
DELIMITER ;
CALL cf1_add_activation_index();
DROP PROCEDURE IF EXISTS cf1_add_activation_index;
