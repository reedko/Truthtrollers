-- Migration: Add reasoning-stack hierarchy metadata to content_claims.
-- Purpose: Store thesis/pillar/evidence hierarchy per content-to-claim link.

USE truthtrollers;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_claim_hierarchy_columns$$

CREATE PROCEDURE add_claim_hierarchy_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'claim_role'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN claim_role ENUM('thesis', 'pillar', 'pillar_support', 'evidence', 'background') DEFAULT NULL AFTER relationship_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'parent_claim_id'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN parent_claim_id INT DEFAULT NULL AFTER claim_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'claim_depth'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN claim_depth TINYINT DEFAULT NULL AFTER parent_claim_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'centrality_score'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN centrality_score DECIMAL(5,2) DEFAULT NULL AFTER claim_depth;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'verifiability_score'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN verifiability_score DECIMAL(5,2) DEFAULT NULL AFTER centrality_score;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'claim_order'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN claim_order INT DEFAULT NULL AFTER verifiability_score;
  END IF;
END$$

CALL add_claim_hierarchy_columns()$$
DROP PROCEDURE IF EXISTS add_claim_hierarchy_columns$$

DELIMITER ;

SELECT 'Claim hierarchy columns are ready' AS status;
