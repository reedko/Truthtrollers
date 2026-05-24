-- =====================================================
-- TruthTrollers Staged Argument System - Database Migration
-- =====================================================
-- Purpose: Transform reactive commenting into structured, evidence-backed argument construction
-- Created: 2026-04-26
-- Version: 1.0
-- =====================================================

-- Drop existing tables if they exist (for clean re-runs during development)
DROP TABLE IF EXISTS ttlive_argument_signoffs;
DROP TABLE IF EXISTS ttlive_argument_citations;
DROP TABLE IF EXISTS ttlive_argument_fallacies;
DROP TABLE IF EXISTS ttlive_staged_arguments;

-- =====================================================
-- Table 1: ttlive_staged_arguments
-- Purpose: Core staged argument entities with validation pipeline
-- =====================================================
CREATE TABLE ttlive_staged_arguments (
  argument_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  thread_id CHAR(36) NOT NULL,
  author_user_id INT NOT NULL,

  -- Core Argument Structure
  claim TEXT NOT NULL COMMENT 'Primary claim/thesis statement',
  stance ENUM('support', 'refute', 'nuance', 'question') NOT NULL,
  reasoning TEXT NOT NULL COMMENT 'Detailed logical reasoning',

  -- Validation Pipeline Status
  status ENUM('draft', 'needs_revision', 'approved', 'signed_off') NOT NULL DEFAULT 'draft',

  -- Civility Filter Results
  civility_passed BOOLEAN DEFAULT FALSE,
  flagged_terms JSON NULL COMMENT 'Array of flagged abusive/uncivil terms',

  -- Fallacy Detection Results
  fallacy_check_passed BOOLEAN DEFAULT FALSE,
  detected_fallacies JSON NULL COMMENT 'Array of detected logical fallacies with descriptions',

  -- AI Quality Scores (0-100)
  clarity_score DECIMAL(5,2) NULL COMMENT 'How clear and understandable the argument is',
  logical_strength_score DECIMAL(5,2) NULL COMMENT 'Logical coherence and validity',
  evidence_support_score DECIMAL(5,2) NULL COMMENT 'Quality and relevance of citations',

  -- Overall Quality Assessment
  overall_quality_score DECIMAL(5,2) NULL COMMENT 'Weighted combination of all scores',

  -- Citation Requirements
  min_citations_met BOOLEAN DEFAULT FALSE COMMENT 'At least 1 citation with relevance > 55%',
  citation_count INT DEFAULT 0,

  -- Debate Context
  reply_to_argument_id CHAR(36) NULL COMMENT 'If this is a counter-argument',
  reply_to_post_id CHAR(36) NULL COMMENT 'TT post being responded to',
  reply_to_imported_post_id CHAR(36) NULL COMMENT 'Imported post being responded to',

  -- Signoff Tracking
  signoff_count INT DEFAULT 0,
  signoff_threshold INT DEFAULT 2 COMMENT 'Number of signoffs needed for approval',

  -- Export Tracking
  is_exported BOOLEAN DEFAULT FALSE,
  exported_to_platform ENUM('x', 'twitter', 'instagram', 'facebook', 'reddit') NULL,
  exported_post_id VARCHAR(255) NULL,
  exported_at DATETIME NULL,
  export_format TEXT NULL COMMENT 'Condensed version for social media',

  -- Moderation
  is_flagged BOOLEAN DEFAULT FALSE,
  moderation_notes TEXT NULL,
  moderated_by INT NULL,

  -- Version Control
  original_argument_id CHAR(36) NULL COMMENT 'If this is a revision of another argument',
  revision_number INT DEFAULT 1,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  signed_off_at DATETIME NULL,

  -- Indexes
  INDEX idx_thread_id (thread_id, created_at DESC),
  INDEX idx_author (author_user_id),
  INDEX idx_status (status),
  INDEX idx_reply_to_argument (reply_to_argument_id),
  INDEX idx_reply_to_post (reply_to_post_id),
  INDEX idx_reply_to_imported (reply_to_imported_post_id),
  INDEX idx_quality_score (overall_quality_score DESC),
  INDEX idx_original (original_argument_id),

  -- Foreign Keys
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL,
  FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL,
  FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL,
  FOREIGN KEY (moderated_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (original_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Staged arguments with validation pipeline - pre-public debate system';

-- =====================================================
-- Table 2: ttlive_argument_citations
-- Purpose: Citations/evidence supporting arguments
-- =====================================================
CREATE TABLE ttlive_argument_citations (
  citation_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  argument_id CHAR(36) NOT NULL,

  -- Citation Details
  url TEXT NOT NULL,
  title VARCHAR(500) NULL COMMENT 'Page/article title',

  -- Relevance Assessment
  relevance_score DECIMAL(5,2) NOT NULL COMMENT '0-100, how relevant to argument',
  auto_scored BOOLEAN DEFAULT TRUE COMMENT 'Whether AI scored or manually entered',

  -- Content Analysis
  quote_text TEXT NULL COMMENT 'Specific quote from source',
  context_summary TEXT NULL COMMENT 'How this citation supports the argument',

  -- Quality Signals
  source_credibility_score DECIMAL(5,2) NULL COMMENT 'Credibility of source domain',
  is_primary_source BOOLEAN DEFAULT FALSE,
  is_peer_reviewed BOOLEAN DEFAULT FALSE,

  -- Metadata
  added_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_argument_id (argument_id),
  INDEX idx_relevance (relevance_score DESC),
  INDEX idx_added_by (added_by),

  -- Foreign Keys
  FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Citations and evidence supporting staged arguments';

-- =====================================================
-- Table 3: ttlive_argument_fallacies
-- Purpose: Detected logical fallacies in arguments
-- =====================================================
CREATE TABLE ttlive_argument_fallacies (
  fallacy_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  argument_id CHAR(36) NOT NULL,

  -- Fallacy Details
  fallacy_type ENUM(
    'ad_hominem',
    'strawman',
    'false_dichotomy',
    'appeal_to_emotion',
    'appeal_to_authority',
    'hasty_generalization',
    'slippery_slope',
    'circular_reasoning',
    'red_herring',
    'unsupported_claim',
    'other'
  ) NOT NULL,

  fallacy_name VARCHAR(200) NOT NULL COMMENT 'Human-readable name',
  description TEXT NOT NULL COMMENT 'Explanation of why this is a fallacy',

  -- Location in Argument
  text_excerpt TEXT NULL COMMENT 'Specific text where fallacy occurs',
  excerpt_offset_start INT NULL COMMENT 'Character position in reasoning text',
  excerpt_offset_end INT NULL,

  -- Detection Details
  confidence_score DECIMAL(5,2) NOT NULL COMMENT '0-100, confidence in detection',
  detected_by_ai BOOLEAN DEFAULT TRUE,
  detected_by_user_id INT NULL COMMENT 'If manually flagged',

  -- Resolution
  is_dismissed BOOLEAN DEFAULT FALSE COMMENT 'User can dismiss false positives',
  dismissed_by INT NULL,
  dismissal_reason TEXT NULL,

  -- Timestamps
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  dismissed_at DATETIME NULL,

  -- Indexes
  INDEX idx_argument_id (argument_id),
  INDEX idx_fallacy_type (fallacy_type),
  INDEX idx_detected_by_user (detected_by_user_id),
  INDEX idx_dismissed (is_dismissed),

  -- Foreign Keys
  FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE,
  FOREIGN KEY (detected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (dismissed_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Logical fallacy detection for argument validation';

-- =====================================================
-- Table 4: ttlive_argument_signoffs
-- Purpose: Participant consensus/approval tracking
-- =====================================================
CREATE TABLE ttlive_argument_signoffs (
  signoff_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  argument_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,

  -- Signoff Type
  signoff_type ENUM('approve', 'endorse', 'challenge') NOT NULL DEFAULT 'approve',

  -- Optional Feedback
  feedback_text TEXT NULL COMMENT 'Optional comment with signoff',
  suggested_improvements TEXT NULL,

  -- Quality Assessment (optional)
  personal_quality_rating DECIMAL(5,2) NULL COMMENT 'User own quality score 0-100',

  -- Timestamps
  signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_argument_id (argument_id),
  INDEX idx_user_id (user_id),
  INDEX idx_signoff_type (signoff_type),
  UNIQUE KEY uk_argument_user (argument_id, user_id),

  -- Foreign Keys
  FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User signoffs and consensus tracking for arguments';

-- =====================================================
-- Stored Procedures
-- =====================================================

DROP PROCEDURE IF EXISTS update_argument_validation_status;
DROP PROCEDURE IF EXISTS update_argument_signoff_count;

DELIMITER //

-- Update argument validation status based on all checks
CREATE PROCEDURE update_argument_validation_status(IN p_argument_id CHAR(36))
BEGIN
  DECLARE v_civility_passed BOOLEAN;
  DECLARE v_fallacy_passed BOOLEAN;
  DECLARE v_citations_met BOOLEAN;
  DECLARE v_new_status VARCHAR(20);

  -- Get current validation state
  SELECT
    civility_passed,
    fallacy_check_passed,
    min_citations_met
  INTO
    v_civility_passed,
    v_fallacy_passed,
    v_citations_met
  FROM ttlive_staged_arguments
  WHERE argument_id = p_argument_id;

  -- Determine new status
  IF v_civility_passed = TRUE AND v_fallacy_passed = TRUE AND v_citations_met = TRUE THEN
    SET v_new_status = 'approved';
  ELSEIF v_civility_passed = FALSE OR v_fallacy_passed = FALSE OR v_citations_met = FALSE THEN
    SET v_new_status = 'needs_revision';
  ELSE
    SET v_new_status = 'draft';
  END IF;

  -- Update status
  UPDATE ttlive_staged_arguments
  SET
    status = v_new_status,
    approved_at = CASE WHEN v_new_status = 'approved' THEN NOW() ELSE approved_at END
  WHERE argument_id = p_argument_id;
END //

-- Update signoff count and check for sign-off threshold
CREATE PROCEDURE update_argument_signoff_count(IN p_argument_id CHAR(36))
BEGIN
  DECLARE v_signoff_count INT;
  DECLARE v_threshold INT;

  -- Count approve/endorse signoffs
  SELECT COUNT(*)
  INTO v_signoff_count
  FROM ttlive_argument_signoffs
  WHERE argument_id = p_argument_id
    AND signoff_type IN ('approve', 'endorse');

  -- Get threshold
  SELECT signoff_threshold
  INTO v_threshold
  FROM ttlive_staged_arguments
  WHERE argument_id = p_argument_id;

  -- Update count
  UPDATE ttlive_staged_arguments
  SET signoff_count = v_signoff_count
  WHERE argument_id = p_argument_id;

  -- If threshold met and argument is approved, mark as signed_off
  UPDATE ttlive_staged_arguments
  SET
    status = 'signed_off',
    signed_off_at = NOW()
  WHERE argument_id = p_argument_id
    AND status = 'approved'
    AND v_signoff_count >= v_threshold;
END //

DELIMITER ;

-- =====================================================
-- Triggers
-- =====================================================

DROP TRIGGER IF EXISTS after_argument_citation_insert;
DROP TRIGGER IF EXISTS after_argument_citation_delete;
DROP TRIGGER IF EXISTS after_argument_fallacy_insert;
DROP TRIGGER IF EXISTS after_argument_fallacy_delete;
DROP TRIGGER IF EXISTS after_argument_signoff_insert;
DROP TRIGGER IF EXISTS after_argument_signoff_delete;

-- Update citation count and validation when citation added
DELIMITER //
CREATE TRIGGER after_argument_citation_insert
AFTER INSERT ON ttlive_argument_citations
FOR EACH ROW
BEGIN
  DECLARE v_citation_count INT;
  DECLARE v_min_citations_met BOOLEAN;

  -- Count citations with relevance > 55%
  SELECT COUNT(*)
  INTO v_citation_count
  FROM ttlive_argument_citations
  WHERE argument_id = NEW.argument_id
    AND relevance_score > 55;

  SET v_min_citations_met = (v_citation_count >= 1);

  -- Update argument
  UPDATE ttlive_staged_arguments
  SET
    citation_count = v_citation_count,
    min_citations_met = v_min_citations_met
  WHERE argument_id = NEW.argument_id;

  -- Re-evaluate validation status
  CALL update_argument_validation_status(NEW.argument_id);
END //
DELIMITER ;

-- Update citation count when citation deleted
DELIMITER //
CREATE TRIGGER after_argument_citation_delete
AFTER DELETE ON ttlive_argument_citations
FOR EACH ROW
BEGIN
  DECLARE v_citation_count INT;
  DECLARE v_min_citations_met BOOLEAN;

  SELECT COUNT(*)
  INTO v_citation_count
  FROM ttlive_argument_citations
  WHERE argument_id = OLD.argument_id
    AND relevance_score > 55;

  SET v_min_citations_met = (v_citation_count >= 1);

  UPDATE ttlive_staged_arguments
  SET
    citation_count = v_citation_count,
    min_citations_met = v_min_citations_met
  WHERE argument_id = OLD.argument_id;

  CALL update_argument_validation_status(OLD.argument_id);
END //
DELIMITER ;

-- Update fallacy check when fallacy detected
DELIMITER //
CREATE TRIGGER after_argument_fallacy_insert
AFTER INSERT ON ttlive_argument_fallacies
FOR EACH ROW
BEGIN
  -- If any non-dismissed fallacy exists, mark check as failed
  UPDATE ttlive_staged_arguments
  SET fallacy_check_passed = FALSE
  WHERE argument_id = NEW.argument_id;

  CALL update_argument_validation_status(NEW.argument_id);
END //
DELIMITER ;

-- Update fallacy check when fallacy dismissed/deleted
DELIMITER //
CREATE TRIGGER after_argument_fallacy_delete
AFTER DELETE ON ttlive_argument_fallacies
FOR EACH ROW
BEGIN
  DECLARE v_remaining_fallacies INT;

  -- Check if any non-dismissed fallacies remain
  SELECT COUNT(*)
  INTO v_remaining_fallacies
  FROM ttlive_argument_fallacies
  WHERE argument_id = OLD.argument_id
    AND is_dismissed = FALSE;

  -- If no fallacies remain, mark check as passed
  UPDATE ttlive_staged_arguments
  SET fallacy_check_passed = (v_remaining_fallacies = 0)
  WHERE argument_id = OLD.argument_id;

  CALL update_argument_validation_status(OLD.argument_id);
END //
DELIMITER ;

-- Update signoff count when signoff added
DELIMITER //
CREATE TRIGGER after_argument_signoff_insert
AFTER INSERT ON ttlive_argument_signoffs
FOR EACH ROW
BEGIN
  CALL update_argument_signoff_count(NEW.argument_id);
END //
DELIMITER ;

-- Update signoff count when signoff removed
DELIMITER //
CREATE TRIGGER after_argument_signoff_delete
AFTER DELETE ON ttlive_argument_signoffs
FOR EACH ROW
BEGIN
  CALL update_argument_signoff_count(OLD.argument_id);
END //
DELIMITER ;

-- =====================================================
-- Views
-- =====================================================

DROP VIEW IF EXISTS v_staged_arguments_with_details;

-- Comprehensive view of arguments with validation details
CREATE VIEW v_staged_arguments_with_details AS
SELECT
  sa.argument_id,
  sa.thread_id,
  sa.author_user_id,
  u.username AS author_username,
  u.user_profile_image AS author_avatar,
  sa.claim,
  sa.stance,
  sa.reasoning,
  sa.status,

  -- Validation Status
  sa.civility_passed,
  sa.fallacy_check_passed,
  sa.min_citations_met,
  sa.flagged_terms,

  -- Quality Scores
  sa.clarity_score,
  sa.logical_strength_score,
  sa.evidence_support_score,
  sa.overall_quality_score,

  -- Citation Stats
  sa.citation_count,
  (
    SELECT COUNT(*)
    FROM ttlive_argument_citations
    WHERE argument_id = sa.argument_id
  ) AS total_citations,

  -- Fallacy Stats
  (
    SELECT COUNT(*)
    FROM ttlive_argument_fallacies
    WHERE argument_id = sa.argument_id
      AND is_dismissed = FALSE
  ) AS active_fallacy_count,

  -- Signoff Stats
  sa.signoff_count,
  sa.signoff_threshold,

  -- Export Status
  sa.is_exported,
  sa.exported_to_platform,
  sa.exported_at,

  -- Timestamps
  sa.created_at,
  sa.updated_at,
  sa.approved_at,
  sa.signed_off_at

FROM ttlive_staged_arguments sa
JOIN users u ON sa.author_user_id = u.user_id;

-- =====================================================
-- Migration Complete
-- =====================================================

SELECT '✅ TruthTrollers Staged Argument System migration complete!' AS status;
SELECT 'Tables created: ttlive_staged_arguments, ttlive_argument_citations, ttlive_argument_fallacies, ttlive_argument_signoffs' AS details;
SELECT 'Run migration and restart backend to enable staged argument mode' AS next_step;
