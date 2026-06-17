-- add-source-identity.sql
-- Creates publisher_domains (multi-domain aliases per publisher) and
-- source_identity_cache (resolved identity per URL) tables.
-- Run once against the database.

-- ─────────────────────────────────────────────────────────────────────────────
-- publisher_domains: maps one or more domains/root_domains to a publisher.
-- Lets the resolver match "nytimes.com", "nyt.com", "nytco.com" → same publisher.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publisher_domains (
  publisher_domain_id   INT           AUTO_INCREMENT PRIMARY KEY,
  publisher_id          INT           NOT NULL,
  domain                VARCHAR(255)  NOT NULL,
  root_domain           VARCHAR(255)  NOT NULL,
  match_type            ENUM('exact','root','subdomain','alias') NOT NULL DEFAULT 'exact',
  confidence            ENUM('high','medium','low')              NOT NULL DEFAULT 'high',
  is_platform_host      TINYINT(1)    NOT NULL DEFAULT 0,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pd_publisher FOREIGN KEY (publisher_id)
    REFERENCES publishers(publisher_id) ON DELETE CASCADE,
  UNIQUE KEY uq_pd_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index on root_domain for resolver lookups
DROP PROCEDURE IF EXISTS _add_pd_root_domain_idx;
DELIMITER //
CREATE PROCEDURE _add_pd_root_domain_idx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'publisher_domains'
      AND index_name   = 'idx_pd_root_domain'
  ) THEN
    CREATE INDEX idx_pd_root_domain ON publisher_domains (root_domain);
  END IF;
END //
DELIMITER ;
CALL _add_pd_root_domain_idx();
DROP PROCEDURE IF EXISTS _add_pd_root_domain_idx;

-- ─────────────────────────────────────────────────────────────────────────────
-- source_identity_cache: caches the resolved SourceIdentity per normalized URL.
-- Updated on re-resolution; resolution_level only increases (never decreases).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_identity_cache (
  source_identity_cache_id INT           AUTO_INCREMENT PRIMARY KEY,
  source_url               VARCHAR(2048) NOT NULL,
  normalized_url           VARCHAR(2048),
  root_domain              VARCHAR(255),
  publisher_id             INT,
  publisher_name           VARCHAR(500),
  source_identity_kind     ENUM(
    'publisher_domain','platform_hosted','primary_document',
    'government_source','academic_source','archive_snapshot',
    'domain_fallback','unresolved'
  ) NOT NULL DEFAULT 'unresolved',
  resolution_level         TINYINT  NOT NULL DEFAULT 0,
  resolution_status        ENUM(
    'matched_existing_publisher','matched_publisher_domain',
    'matched_platform_host','matched_metadata',
    'matched_archive','domain_only','unresolved'
  ) NOT NULL DEFAULT 'unresolved',
  source_type              ENUM(
    'primary','government','academic','journalism','reference',
    'advocacy','corporate','opinion','social','platform','unknown'
  ) NOT NULL DEFAULT 'unknown',
  reliability              ENUM('high','medium','mixed','low','flagged','unchecked')
                           NOT NULL DEFAULT 'unchecked',
  needs_human_review       TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json            JSON,
  last_checked_at          DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sic_publisher FOREIGN KEY (publisher_id)
    REFERENCES publishers(publisher_id) ON DELETE SET NULL,
  UNIQUE KEY uq_sic_normalized_url (normalized_url(512))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for resolver lookups
DROP PROCEDURE IF EXISTS _add_sic_indexes;
DELIMITER //
CREATE PROCEDURE _add_sic_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'source_identity_cache'
      AND index_name   = 'idx_sic_root_domain'
  ) THEN
    CREATE INDEX idx_sic_root_domain ON source_identity_cache (root_domain);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'source_identity_cache'
      AND index_name   = 'idx_sic_publisher_id'
  ) THEN
    CREATE INDEX idx_sic_publisher_id ON source_identity_cache (publisher_id);
  END IF;
END //
DELIMITER ;
CALL _add_sic_indexes();
DROP PROCEDURE IF EXISTS _add_sic_indexes;
