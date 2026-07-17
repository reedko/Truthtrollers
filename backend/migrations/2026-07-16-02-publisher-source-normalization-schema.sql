-- Approved publisher/source identity schema. Schema only: no legacy backfill.
-- Production replacement for the older add-publisher-source-normalization.sql,
-- which combined schema creation and backfill and was already used in dev.
-- Additive and safe to re-run on MySQL 8 and MariaDB 10.5.

CREATE TABLE IF NOT EXISTS content_publishing_context (
  context_id INT NOT NULL AUTO_INCREMENT,
  content_id INT NOT NULL,
  context_type ENUM('scholarly','social','broadcast','web','archive') NOT NULL,
  platform VARCHAR(50) NULL,
  publisher_name_observed VARCHAR(500) NULL,
  venue_name VARCHAR(500) NULL,
  venue_type ENUM('journal','conference','book','report_series','repository','other') NULL,
  article_type VARCHAR(100) NULL,
  volume VARCHAR(50) NULL,
  issue VARCHAR(50) NULL,
  publication_date DATE NULL,
  publication_year YEAR NULL,
  distribution_channel VARCHAR(255) NULL,
  linked_url TEXT NULL,
  linked_publisher_observed VARCHAR(500) NULL,
  social_provenance JSON NULL,
  extraction_method VARCHAR(80) NULL,
  extraction_confidence ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
  extractor_version VARCHAR(40) NULL,
  extraction_evidence JSON NULL,
  raw_metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (context_id),
  UNIQUE KEY uq_cpc_content_type (content_id, context_type),
  KEY idx_cpc_content (content_id),
  KEY idx_cpc_venue (venue_name),
  CONSTRAINT fk_cpc_content FOREIGN KEY (content_id)
    REFERENCES content(content_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_publishing_identifiers (
  content_publishing_identifier_id BIGINT NOT NULL AUTO_INCREMENT,
  context_id INT NOT NULL,
  identifier_type ENUM('doi','issn','eissn','isbn','pmid','pmcid','arxiv','other') NOT NULL,
  identifier_scope ENUM('work','venue','edition','unknown') NOT NULL DEFAULT 'unknown',
  normalized_value VARCHAR(255) NOT NULL,
  raw_value VARCHAR(255) NULL,
  extraction_method VARCHAR(80) NULL,
  extraction_confidence ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
  evidence_quote VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (content_publishing_identifier_id),
  UNIQUE KEY uq_cpi_context_identifier (context_id, identifier_type, normalized_value),
  KEY idx_cpi_type_value (identifier_type, normalized_value),
  CONSTRAINT fk_cpi_context FOREIGN KEY (context_id)
    REFERENCES content_publishing_context(context_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_identity_confirmations (
  source_identity_confirmation_id BIGINT NOT NULL AUTO_INCREMENT,
  content_id INT NOT NULL,
  context_id INT NULL,
  user_id INT NULL,
  prior_identity_json JSON NULL,
  confirmed_identity_json JSON NOT NULL,
  method VARCHAR(40) NOT NULL DEFAULT 'manual',
  evidence_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_identity_confirmation_id),
  KEY idx_sicf_content_created (content_id, created_at),
  KEY idx_sicf_context (context_id),
  CONSTRAINT fk_sicf_content FOREIGN KEY (content_id)
    REFERENCES content(content_id) ON DELETE CASCADE,
  CONSTRAINT fk_sicf_context FOREIGN KEY (context_id)
    REFERENCES content_publishing_context(context_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS publisher_source_add_column;
DELIMITER $$
CREATE PROCEDURE publisher_source_add_column(
  IN table_value VARCHAR(64), IN column_value VARCHAR(64), IN ddl_value TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_value
      AND COLUMN_NAME = column_value
  ) THEN
    SET @publisher_ddl = ddl_value;
    PREPARE publisher_stmt FROM @publisher_ddl;
    EXECUTE publisher_stmt;
    DEALLOCATE PREPARE publisher_stmt;
  END IF;
END$$
DELIMITER ;

CALL publisher_source_add_column('publishers', 'entity_type',
  'ALTER TABLE publishers ADD COLUMN entity_type VARCHAR(40) NULL');
CALL publisher_source_add_column('content_publishers', 'publisher_role',
  'ALTER TABLE content_publishers ADD COLUMN publisher_role VARCHAR(40) NULL');
CALL publisher_source_add_column('content_publishers', 'is_primary',
  'ALTER TABLE content_publishers ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0');
CALL publisher_source_add_column('content_publishers', 'context_id',
  'ALTER TABLE content_publishers ADD COLUMN context_id INT NULL');
CALL publisher_source_add_column('content_publishers', 'identity_confidence',
  'ALTER TABLE content_publishers ADD COLUMN identity_confidence DECIMAL(5,4) NULL');
CALL publisher_source_add_column('content_publishers', 'extraction_method',
  'ALTER TABLE content_publishers ADD COLUMN extraction_method VARCHAR(80) NULL');
CALL publisher_source_add_column('content_publishers', 'evidence_json',
  'ALTER TABLE content_publishers ADD COLUMN evidence_json JSON NULL');
CALL publisher_source_add_column('publisher_relationships', 'related_publisher_id',
  'ALTER TABLE publisher_relationships ADD COLUMN related_publisher_id INT NULL');

DROP PROCEDURE IF EXISTS publisher_source_add_column;

DROP PROCEDURE IF EXISTS publisher_source_add_key;
DELIMITER $$
CREATE PROCEDURE publisher_source_add_key(
  IN table_value VARCHAR(64), IN key_value VARCHAR(64),
  IN constraint_kind VARCHAR(16), IN ddl_value TEXT)
BEGIN
  IF (constraint_kind = 'index' AND NOT EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_value
        AND INDEX_NAME = key_value
    )) OR (constraint_kind = 'foreign' AND NOT EXISTS (
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = table_value
        AND CONSTRAINT_NAME = key_value
    )) THEN
    SET @publisher_ddl = ddl_value;
    PREPARE publisher_stmt FROM @publisher_ddl;
    EXECUTE publisher_stmt;
    DEALLOCATE PREPARE publisher_stmt;
  END IF;
END$$
DELIMITER ;

CALL publisher_source_add_key('publishers', 'idx_publishers_entity_type', 'index',
  'ALTER TABLE publishers ADD INDEX idx_publishers_entity_type (entity_type)');
CALL publisher_source_add_key('content_publishers', 'idx_cp_content_role', 'index',
  'ALTER TABLE content_publishers ADD INDEX idx_cp_content_role (content_id, publisher_role, is_primary)');
CALL publisher_source_add_key('content_publishers', 'idx_cp_context', 'index',
  'ALTER TABLE content_publishers ADD INDEX idx_cp_context (context_id)');
CALL publisher_source_add_key('content_publishers', 'fk_cp_publishing_context', 'foreign',
  'ALTER TABLE content_publishers ADD CONSTRAINT fk_cp_publishing_context FOREIGN KEY (context_id) REFERENCES content_publishing_context(context_id) ON DELETE SET NULL');
CALL publisher_source_add_key('publisher_relationships', 'idx_pr_related_publisher', 'index',
  'ALTER TABLE publisher_relationships ADD INDEX idx_pr_related_publisher (related_publisher_id)');
CALL publisher_source_add_key('publisher_relationships', 'fk_pr_related_publisher', 'foreign',
  'ALTER TABLE publisher_relationships ADD CONSTRAINT fk_pr_related_publisher FOREIGN KEY (related_publisher_id) REFERENCES publishers(publisher_id) ON DELETE SET NULL');

DROP PROCEDURE IF EXISTS publisher_source_add_key;

SELECT 'Publisher/source normalization schema ready; no rows backfilled' AS status;
