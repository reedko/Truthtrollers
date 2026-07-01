-- ============================================================================
-- Publisher/source identity normalization — PROPOSED ADDITIVE MIGRATION
-- Matching plan: docs/publisher-source-normalization-plan.md
--
-- DO NOT RUN until SHOW CREATE TABLE has been captured for content, publishers,
-- content_publishers, publisher_relationships, and all publisher-related tables.
-- This migration intentionally does not drop legacy content columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Content-level publishing and distribution context
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_publishing_context (
  context_id                  INT NOT NULL AUTO_INCREMENT,
  content_id                  INT NOT NULL,
  context_type                ENUM('scholarly','social','broadcast','web','archive') NOT NULL,
  platform                    VARCHAR(50) NULL,

  publisher_name_observed     VARCHAR(500) NULL,
  venue_name                  VARCHAR(500) NULL,
  venue_type                  ENUM('journal','conference','book','report_series','repository','other') NULL,
  article_type                VARCHAR(100) NULL,
  volume                      VARCHAR(50) NULL,
  issue                       VARCHAR(50) NULL,
  publication_date            DATE NULL,
  publication_year            YEAR NULL,

  distribution_channel        VARCHAR(255) NULL,
  linked_url                  TEXT NULL,
  linked_publisher_observed   VARCHAR(500) NULL,
  social_provenance           JSON NULL,

  extraction_method           VARCHAR(80) NULL,
  extraction_confidence       ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
  extractor_version           VARCHAR(40) NULL,
  extraction_evidence         JSON NULL,
  raw_metadata                JSON NULL,

  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (context_id),
  UNIQUE KEY uq_cpc_content_type (content_id, context_type),
  KEY idx_cpc_content (content_id),
  KEY idx_cpc_venue (venue_name),
  CONSTRAINT fk_cpc_content
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Repeatable typed identifiers
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_publishing_identifiers (
  content_publishing_identifier_id BIGINT NOT NULL AUTO_INCREMENT,
  context_id                       INT NOT NULL,
  identifier_type                 ENUM('doi','issn','eissn','isbn','pmid','pmcid','arxiv','other') NOT NULL,
  identifier_scope                ENUM('work','venue','edition','unknown') NOT NULL DEFAULT 'unknown',
  normalized_value                VARCHAR(255) NOT NULL,
  raw_value                       VARCHAR(255) NULL,
  extraction_method               VARCHAR(80) NULL,
  extraction_confidence           ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
  evidence_quote                  VARCHAR(500) NULL,
  created_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (content_publishing_identifier_id),
  UNIQUE KEY uq_cpi_context_identifier (context_id, identifier_type, normalized_value),
  KEY idx_cpi_type_value (identifier_type, normalized_value),
  CONSTRAINT fk_cpi_context
    FOREIGN KEY (context_id) REFERENCES content_publishing_context(context_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2b. Manual confirmation and identity-change audit trail
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS source_identity_confirmations (
  source_identity_confirmation_id BIGINT NOT NULL AUTO_INCREMENT,
  content_id                       INT NOT NULL,
  context_id                       INT NULL,
  user_id                          INT NULL,
  prior_identity_json              JSON NULL,
  confirmed_identity_json          JSON NOT NULL,
  method                           VARCHAR(40) NOT NULL DEFAULT 'manual',
  evidence_json                    JSON NULL,
  created_at                       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (source_identity_confirmation_id),
  KEY idx_sicf_content_created (content_id, created_at),
  KEY idx_sicf_context (context_id),
  CONSTRAINT fk_sicf_content
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  CONSTRAINT fk_sicf_context
    FOREIGN KEY (context_id) REFERENCES content_publishing_context(context_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Conditionally extend existing tables.
-- MariaDB/MySQL-compatible information_schema checks avoid relying on
-- ADD COLUMN IF NOT EXISTS behavior.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _tt_publisher_normalization_columns;
DELIMITER $$
CREATE PROCEDURE _tt_publisher_normalization_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishing_context'
      AND COLUMN_NAME = 'publication_date'
  ) THEN
    ALTER TABLE content_publishing_context
      ADD COLUMN publication_date DATE NULL AFTER issue;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publishers'
      AND COLUMN_NAME = 'entity_type'
  ) THEN
    ALTER TABLE publishers
      ADD COLUMN entity_type VARCHAR(40) NULL AFTER publisher_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'publisher_role'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN publisher_role VARCHAR(40) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'is_primary'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'context_id'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN context_id INT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'identity_confidence'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN identity_confidence DECIMAL(5,4) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'extraction_method'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN extraction_method VARCHAR(80) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND COLUMN_NAME = 'evidence_json'
  ) THEN
    ALTER TABLE content_publishers
      ADD COLUMN evidence_json JSON NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
      AND COLUMN_NAME = 'related_publisher_id'
  ) THEN
    ALTER TABLE publisher_relationships
      ADD COLUMN related_publisher_id INT NULL AFTER publisher_id;
  END IF;
END$$
DELIMITER ;

CALL _tt_publisher_normalization_columns();
DROP PROCEDURE IF EXISTS _tt_publisher_normalization_columns;

-- ----------------------------------------------------------------------------
-- 4. Conditionally add indexes and foreign keys.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _tt_publisher_normalization_keys;
DELIMITER $$
CREATE PROCEDURE _tt_publisher_normalization_keys()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publishers'
      AND INDEX_NAME = 'idx_publishers_entity_type'
  ) THEN
    ALTER TABLE publishers
      ADD INDEX idx_publishers_entity_type (entity_type);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND INDEX_NAME = 'idx_cp_content_role'
  ) THEN
    ALTER TABLE content_publishers
      ADD INDEX idx_cp_content_role (content_id, publisher_role, is_primary);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND INDEX_NAME = 'idx_cp_context'
  ) THEN
    ALTER TABLE content_publishers
      ADD INDEX idx_cp_context (context_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_publishers'
      AND CONSTRAINT_NAME = 'fk_cp_publishing_context'
  ) THEN
    ALTER TABLE content_publishers
      ADD CONSTRAINT fk_cp_publishing_context
      FOREIGN KEY (context_id)
      REFERENCES content_publishing_context(context_id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
      AND COLUMN_NAME = 'related_publisher_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
      AND INDEX_NAME = 'idx_pr_related_publisher'
  ) THEN
    ALTER TABLE publisher_relationships
      ADD INDEX idx_pr_related_publisher (related_publisher_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
      AND COLUMN_NAME = 'related_publisher_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'publisher_relationships'
      AND CONSTRAINT_NAME = 'fk_pr_related_publisher'
  ) THEN
    ALTER TABLE publisher_relationships
      ADD CONSTRAINT fk_pr_related_publisher
      FOREIGN KEY (related_publisher_id)
      REFERENCES publishers(publisher_id)
      ON DELETE SET NULL;
  END IF;
END$$
DELIMITER ;

CALL _tt_publisher_normalization_keys();
DROP PROCEDURE IF EXISTS _tt_publisher_normalization_keys;

-- Phase 0 verified publishers.publisher_id and publisher_relationships.publisher_id
-- are both signed INT in the configured development schema.

-- ----------------------------------------------------------------------------
-- 5. Mark existing content-publisher links without guessing their semantics.
-- A later audited backfill selects exactly one primary link per content item.
-- ----------------------------------------------------------------------------

UPDATE content_publishers
SET publisher_role = 'legacy_unspecified'
WHERE publisher_role IS NULL OR publisher_role = '';

-- ----------------------------------------------------------------------------
-- 6. Backfill legacy content publishing/distribution columns.
-- This assumes the five legacy columns exist; Phase 0 must confirm them.
-- ----------------------------------------------------------------------------

INSERT INTO content_publishing_context (
  content_id,
  context_type,
  platform,
  distribution_channel,
  linked_url,
  linked_publisher_observed,
  social_provenance,
  extraction_method,
  extraction_confidence,
  extractor_version,
  extraction_evidence
)
SELECT
  c.content_id,
  CASE
    WHEN c.social_provenance IS NOT NULL
      OR LOWER(COALESCE(c.platform, '')) IN (
        'facebook','twitter','x','instagram','reddit','tiktok','linkedin'
      ) THEN 'social'
    WHEN LOWER(COALESCE(c.platform, '')) IN (
      'youtube','podcast','tv','radio'
    ) THEN 'broadcast'
    WHEN LOWER(COALESCE(c.platform, '')) IN (
      'pdf','scholarly'
    ) THEN 'scholarly'
    WHEN LOWER(COALESCE(c.platform, '')) IN (
      'archive','wayback'
    ) THEN 'archive'
    ELSE 'web'
  END,
  c.platform,
  c.distribution_channel,
  c.linked_url,
  c.linked_publisher,
  c.social_provenance,
  CASE
    WHEN c.social_provenance IS NOT NULL THEN 'legacy_extension_dom'
    ELSE 'legacy_content_columns'
  END,
  'low',
  'legacy-backfill-v1',
  JSON_OBJECT(
    'backfilled_from', 'content',
    'requires_review', TRUE
  )
FROM content c
WHERE c.platform IS NOT NULL
   OR c.distribution_channel IS NOT NULL
   OR c.linked_url IS NOT NULL
   OR c.linked_publisher IS NOT NULL
   OR c.social_provenance IS NOT NULL
ON DUPLICATE KEY UPDATE
  platform = VALUES(platform),
  distribution_channel = VALUES(distribution_channel),
  linked_url = VALUES(linked_url),
  linked_publisher_observed = VALUES(linked_publisher_observed),
  social_provenance = VALUES(social_provenance),
  updated_at = CURRENT_TIMESTAMP;

-- ----------------------------------------------------------------------------
-- 7. Verification queries. Review results before application dual writes begin.
-- ----------------------------------------------------------------------------

SELECT context_type, COUNT(*) AS context_count
FROM content_publishing_context
GROUP BY context_type
ORDER BY context_type;

SELECT publisher_role, is_primary, COUNT(*) AS link_count
FROM content_publishers
GROUP BY publisher_role, is_primary
ORDER BY publisher_role, is_primary;

SELECT COUNT(*) AS unresolved_multiple_publisher_contents
FROM (
  SELECT content_id
  FROM content_publishers
  GROUP BY content_id
  HAVING COUNT(*) > 1
) AS ambiguous_content;

-- ----------------------------------------------------------------------------
-- Deferred destructive cleanup — DO NOT add to the executable migration yet.
-- After dual-write/read parity, backup, and rollback validation:
--
-- ALTER TABLE content
--   DROP COLUMN media_source,
--   DROP COLUMN platform,
--   DROP COLUMN distribution_channel,
--   DROP COLUMN linked_url,
--   DROP COLUMN linked_publisher,
--   DROP COLUMN social_provenance;
-- ----------------------------------------------------------------------------
