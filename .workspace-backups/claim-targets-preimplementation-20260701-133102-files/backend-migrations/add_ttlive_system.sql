-- =====================================================
-- TruthTrollers Live Feed System - Database Migration
-- =====================================================
-- Purpose: Create schema for X-inspired feed/thread viewer with native TT discussion
-- Created: 2026-04-17
-- Version: 1.0
-- =====================================================

-- Drop existing tables if they exist (for clean re-runs during development)
DROP TABLE IF EXISTS ttlive_export_log;
DROP TABLE IF EXISTS ttlive_thread_subscriptions;
DROP TABLE IF EXISTS ttlive_post_evidence;
DROP TABLE IF EXISTS ttlive_posts;
DROP TABLE IF EXISTS ttlive_imported_posts;
DROP TABLE IF EXISTS ttlive_threads;

-- =====================================================
-- Table 1: ttlive_threads
-- Purpose: Container for imported/native discussion threads
-- =====================================================
CREATE TABLE ttlive_threads (
  thread_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),

  -- Thread Metadata
  thread_title VARCHAR(500) NULL COMMENT 'Optional title for thread',
  thread_type ENUM('imported_x', 'native_tt', 'hybrid') NOT NULL DEFAULT 'native_tt',

  -- Source Tracking
  source_platform ENUM('x', 'twitter', 'instagram', 'facebook', 'reddit', 'native') DEFAULT 'native',
  source_thread_id VARCHAR(255) NULL COMMENT 'Original platform thread ID',
  source_url TEXT NULL COMMENT 'Original thread URL',

  -- Content Association
  content_id INT NULL COMMENT 'FK to content table if thread is about specific content',
  task_id INT NULL COMMENT 'FK to tasks table if thread is about specific task',

  -- Thread Properties
  root_post_id CHAR(36) NULL COMMENT 'First post in thread (set after first post created)',
  is_pinned BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE COMMENT 'Prevent new replies',

  -- Moderation
  curated_by INT NULL COMMENT 'User who curated this thread',
  curated_at DATETIME NULL,
  curation_notes TEXT NULL,

  -- Engagement Stats (denormalized for performance)
  total_posts INT DEFAULT 0,
  total_tt_posts INT DEFAULT 0 COMMENT 'Native TT discussion posts',
  total_imported_posts INT DEFAULT 0,
  total_exported_posts INT DEFAULT 0,
  total_participants INT DEFAULT 0,

  -- Quality Metrics
  avg_verimeter_score DECIMAL(5,2) NULL COMMENT 'Average verimeter of TT posts in thread',
  controversy_score DECIMAL(5,2) DEFAULT 0.0 COMMENT '0-100, higher = more disagreement',

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  imported_at DATETIME NULL COMMENT 'When thread was imported from external platform',

  -- Indexes
  INDEX idx_content_id (content_id),
  INDEX idx_task_id (task_id),
  INDEX idx_source_platform (source_platform),
  INDEX idx_thread_type (thread_type),
  INDEX idx_created_at (created_at DESC),
  INDEX idx_last_activity (last_activity_at DESC),
  INDEX idx_pinned (is_pinned, last_activity_at DESC),

  -- Foreign Keys
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE SET NULL,
  FOREIGN KEY (curated_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='TruthTrollers Live Feed threads - containers for imported/native discussions';

-- =====================================================
-- Table 2: ttlive_imported_posts
-- Purpose: Original posts imported from external platforms (read-only)
-- =====================================================
CREATE TABLE ttlive_imported_posts (
  imported_post_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  thread_id CHAR(36) NOT NULL,

  -- Source Tracking
  source_platform ENUM('x', 'twitter', 'instagram', 'facebook', 'reddit') NOT NULL,
  source_post_id VARCHAR(255) NOT NULL COMMENT 'Original platform post ID',
  source_url TEXT NOT NULL,

  -- Author Info (from external platform)
  source_author_username VARCHAR(255) NULL,
  source_author_display_name VARCHAR(255) NULL,
  source_author_avatar_url TEXT NULL,
  source_author_verified BOOLEAN DEFAULT FALSE,

  -- Post Content
  post_text TEXT NOT NULL,
  post_media_urls JSON NULL COMMENT 'Array of image/video URLs',
  post_language VARCHAR(10) DEFAULT 'en',

  -- Threading
  reply_to_imported_post_id CHAR(36) NULL COMMENT 'If this is a reply to another imported post',
  is_thread_root BOOLEAN DEFAULT FALSE,

  -- External Engagement (from source platform)
  source_likes_count INT DEFAULT 0,
  source_retweets_count INT DEFAULT 0,
  source_replies_count INT DEFAULT 0,

  -- TT Analysis
  has_extracted_claims BOOLEAN DEFAULT FALSE,
  has_linked_evidence BOOLEAN DEFAULT FALSE,
  veracity_assessment ENUM('true', 'false', 'mixed', 'unverified', 'pending') DEFAULT 'pending',
  verimeter_score DECIMAL(5,2) NULL COMMENT 'TT-assigned veracity score',

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'When imported into TT',
  source_created_at DATETIME NULL COMMENT 'Original post timestamp on source platform',
  last_synced_at DATETIME NULL COMMENT 'Last time engagement metrics were updated',

  -- Indexes
  INDEX idx_thread_id (thread_id),
  INDEX idx_source_platform_post (source_platform, source_post_id),
  INDEX idx_reply_to (reply_to_imported_post_id),
  INDEX idx_thread_root (is_thread_root),
  UNIQUE KEY uk_source_post (source_platform, source_post_id),

  -- Foreign Keys
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Imported posts from external platforms - read-only representations';

-- =====================================================
-- Table 3: ttlive_posts
-- Purpose: Native TruthTrollers discussion posts (read/write)
-- =====================================================
CREATE TABLE ttlive_posts (
  post_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  thread_id CHAR(36) NOT NULL,

  -- Author Info (TT user)
  author_user_id INT NOT NULL,
  author_role ENUM('contributor', 'expert', 'moderator', 'admin') DEFAULT 'contributor',

  -- Post Content
  post_text TEXT NOT NULL,
  post_media_urls JSON NULL COMMENT 'Array of uploaded media URLs',
  post_language VARCHAR(10) DEFAULT 'en',

  -- Stance & Analysis
  stance ENUM('support', 'refute', 'nuance', 'question', 'neutral') DEFAULT 'neutral',
  confidence_level DECIMAL(5,2) NULL COMMENT '0-100, how confident author is',
  tone ENUM('neutral', 'assertive', 'questioning', 'educational') DEFAULT 'neutral',

  -- Threading & Context
  reply_to_post_id CHAR(36) NULL COMMENT 'TT post this is replying to',
  reply_to_imported_post_id CHAR(36) NULL COMMENT 'Imported post this is replying to',
  context_claim_id INT NULL COMMENT 'FK to claims table if discussing specific claim',

  -- Export Tracking
  is_exported BOOLEAN DEFAULT FALSE,
  exported_to_platform ENUM('x', 'twitter', 'instagram', 'facebook', 'reddit') NULL,
  exported_post_id VARCHAR(255) NULL COMMENT 'Post ID on exported platform',
  exported_at DATETIME NULL,
  export_status ENUM('pending', 'success', 'failed', 'revoked') NULL,

  -- Moderation
  is_approved BOOLEAN DEFAULT TRUE COMMENT 'For pre-moderated threads',
  is_flagged BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  moderated_by INT NULL,
  moderation_reason TEXT NULL,

  -- Evidence & Quality
  has_linked_evidence BOOLEAN DEFAULT FALSE,
  evidence_count INT DEFAULT 0,
  verimeter_score DECIMAL(5,2) NULL COMMENT 'Quality score of this post',

  -- Engagement (TT-internal)
  upvotes_count INT DEFAULT 0,
  downvotes_count INT DEFAULT 0,
  replies_count INT DEFAULT 0,
  bookmarks_count INT DEFAULT 0,

  -- External Engagement (if exported)
  external_likes_count INT DEFAULT 0,
  external_retweets_count INT DEFAULT 0,
  external_replies_count INT DEFAULT 0,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  edited_at DATETIME NULL,

  -- Indexes
  INDEX idx_thread_id (thread_id, created_at DESC),
  INDEX idx_author (author_user_id),
  INDEX idx_reply_to_post (reply_to_post_id),
  INDEX idx_reply_to_imported (reply_to_imported_post_id),
  INDEX idx_stance (stance),
  INDEX idx_exported (is_exported, exported_to_platform),
  INDEX idx_context_claim (context_claim_id),
  INDEX idx_verimeter (verimeter_score DESC),

  -- Foreign Keys
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL,
  FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL,
  FOREIGN KEY (moderated_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Native TruthTrollers discussion posts - primary discussion system';

-- =====================================================
-- Table 4: ttlive_post_evidence
-- Purpose: Link TT posts to supporting evidence/sources
-- =====================================================
CREATE TABLE ttlive_post_evidence (
  evidence_link_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  post_id CHAR(36) NOT NULL,

  -- Evidence Source
  evidence_type ENUM('reference', 'claim', 'content', 'external_url') NOT NULL,
  reference_id INT NULL COMMENT 'FK to reference table',
  claim_id INT NULL COMMENT 'FK to claims table',
  content_id INT NULL COMMENT 'FK to content table',
  external_url TEXT NULL COMMENT 'External source URL',

  -- Evidence Properties
  support_level TINYINT NULL COMMENT '-100 to +100 (refutes to supports)',
  relevance_score DECIMAL(5,2) NULL COMMENT '0-100, how relevant to post',
  quote_text TEXT NULL COMMENT 'Specific quote from evidence',

  -- Metadata
  added_by INT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_post_id (post_id),
  INDEX idx_reference (reference_id),
  INDEX idx_claim (claim_id),
  INDEX idx_content (content_id),

  -- Foreign Keys
  FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Evidence links for TT posts - connects posts to sources/claims';

-- =====================================================
-- Table 5: ttlive_thread_subscriptions
-- Purpose: User subscriptions/monitoring for threads
-- =====================================================
CREATE TABLE ttlive_thread_subscriptions (
  subscription_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  thread_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,

  -- Subscription Settings
  notification_level ENUM('all', 'mentions', 'replies', 'none') DEFAULT 'all',
  mute_until DATETIME NULL COMMENT 'Temporary mute',

  -- Monitoring (for moderators/curators)
  is_monitoring BOOLEAN DEFAULT FALSE COMMENT 'Actively curating/moderating this thread',
  monitoring_notes TEXT NULL,

  -- Timestamps
  subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_read_at DATETIME NULL,

  -- Indexes
  INDEX idx_thread_user (thread_id, user_id),
  INDEX idx_user_threads (user_id, subscribed_at DESC),
  INDEX idx_monitoring (is_monitoring, user_id),
  UNIQUE KEY uk_thread_user (thread_id, user_id),

  -- Foreign Keys
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User subscriptions and monitoring for TT Live threads';

-- =====================================================
-- Table 6: ttlive_export_log
-- Purpose: Audit log for posts exported to external platforms
-- =====================================================
CREATE TABLE ttlive_export_log (
  export_log_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  post_id CHAR(36) NOT NULL,

  -- Export Details
  exported_by INT NOT NULL,
  export_platform ENUM('x', 'twitter', 'instagram', 'facebook', 'reddit') NOT NULL,
  export_status ENUM('pending', 'success', 'failed', 'revoked') NOT NULL DEFAULT 'pending',

  -- Platform Response
  platform_post_id VARCHAR(255) NULL,
  platform_post_url TEXT NULL,
  error_message TEXT NULL,

  -- Engagement Tracking
  last_synced_at DATETIME NULL,
  external_likes_count INT DEFAULT 0,
  external_retweets_count INT DEFAULT 0,
  external_replies_count INT DEFAULT 0,

  -- Timestamps
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  revoked_at DATETIME NULL,

  -- Indexes
  INDEX idx_post_id (post_id),
  INDEX idx_exported_by (exported_by),
  INDEX idx_platform (export_platform, export_status),
  INDEX idx_attempted (attempted_at DESC),

  -- Foreign Keys
  FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (exported_by) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Audit log for exports to external platforms';

-- =====================================================
-- Stored Procedures
-- =====================================================

-- Drop procedures if they exist
DROP PROCEDURE IF EXISTS update_thread_stats;
DROP PROCEDURE IF EXISTS update_post_replies_count;

DELIMITER //

-- Update thread statistics after post insert/delete
CREATE PROCEDURE update_thread_stats(IN p_thread_id CHAR(36))
BEGIN
  UPDATE ttlive_threads t
  SET
    total_posts = (
      SELECT COUNT(*)
      FROM ttlive_posts
      WHERE thread_id = p_thread_id AND is_hidden = FALSE
    ) + (
      SELECT COUNT(*)
      FROM ttlive_imported_posts
      WHERE thread_id = p_thread_id
    ),
    total_tt_posts = (
      SELECT COUNT(*)
      FROM ttlive_posts
      WHERE thread_id = p_thread_id AND is_hidden = FALSE
    ),
    total_imported_posts = (
      SELECT COUNT(*)
      FROM ttlive_imported_posts
      WHERE thread_id = p_thread_id
    ),
    total_exported_posts = (
      SELECT COUNT(*)
      FROM ttlive_posts
      WHERE thread_id = p_thread_id AND is_exported = TRUE
    ),
    total_participants = (
      SELECT COUNT(DISTINCT author_user_id)
      FROM ttlive_posts
      WHERE thread_id = p_thread_id AND is_hidden = FALSE
    ),
    avg_verimeter_score = (
      SELECT AVG(verimeter_score)
      FROM ttlive_posts
      WHERE thread_id = p_thread_id AND verimeter_score IS NOT NULL AND is_hidden = FALSE
    ),
    last_activity_at = NOW()
  WHERE thread_id = p_thread_id;
END //

-- Update post replies count
CREATE PROCEDURE update_post_replies_count(IN p_post_id CHAR(36))
BEGIN
  UPDATE ttlive_posts
  SET replies_count = (
    SELECT COUNT(*)
    FROM ttlive_posts
    WHERE reply_to_post_id = p_post_id AND is_hidden = FALSE
  )
  WHERE post_id = p_post_id;
END //

DELIMITER ;

-- =====================================================
-- Triggers
-- =====================================================

-- Drop triggers if they exist
DROP TRIGGER IF EXISTS after_ttlive_post_insert;
DROP TRIGGER IF EXISTS after_ttlive_post_delete;
DROP TRIGGER IF EXISTS after_imported_post_insert;
DROP TRIGGER IF EXISTS after_post_evidence_insert;
DROP TRIGGER IF EXISTS after_post_evidence_delete;

-- Update thread stats when TT post is inserted
DELIMITER //
CREATE TRIGGER after_ttlive_post_insert
AFTER INSERT ON ttlive_posts
FOR EACH ROW
BEGIN
  CALL update_thread_stats(NEW.thread_id);
  IF NEW.reply_to_post_id IS NOT NULL THEN
    CALL update_post_replies_count(NEW.reply_to_post_id);
  END IF;
END //
DELIMITER ;

-- Update thread stats when TT post is deleted
DELIMITER //
CREATE TRIGGER after_ttlive_post_delete
AFTER DELETE ON ttlive_posts
FOR EACH ROW
BEGIN
  CALL update_thread_stats(OLD.thread_id);
  IF OLD.reply_to_post_id IS NOT NULL THEN
    CALL update_post_replies_count(OLD.reply_to_post_id);
  END IF;
END //
DELIMITER ;

-- Update thread stats when imported post is inserted
DELIMITER //
CREATE TRIGGER after_imported_post_insert
AFTER INSERT ON ttlive_imported_posts
FOR EACH ROW
BEGIN
  CALL update_thread_stats(NEW.thread_id);
END //
DELIMITER ;

-- Update evidence count on ttlive_posts when evidence is added
DELIMITER //
CREATE TRIGGER after_post_evidence_insert
AFTER INSERT ON ttlive_post_evidence
FOR EACH ROW
BEGIN
  UPDATE ttlive_posts
  SET
    evidence_count = evidence_count + 1,
    has_linked_evidence = TRUE
  WHERE post_id = NEW.post_id;
END //
DELIMITER ;

-- Update evidence count on ttlive_posts when evidence is deleted
DELIMITER //
CREATE TRIGGER after_post_evidence_delete
AFTER DELETE ON ttlive_post_evidence
FOR EACH ROW
BEGIN
  UPDATE ttlive_posts
  SET
    evidence_count = GREATEST(0, evidence_count - 1),
    has_linked_evidence = (evidence_count - 1) > 0
  WHERE post_id = OLD.post_id;
END //
DELIMITER ;

-- =====================================================
-- Views
-- =====================================================

-- Drop view if exists
DROP VIEW IF EXISTS v_ttlive_thread_timeline;

-- Unified thread timeline view (combines imported + TT posts)
CREATE VIEW v_ttlive_thread_timeline AS
SELECT
  'imported' AS post_source,
  ip.imported_post_id AS post_id,
  ip.thread_id,
  NULL AS author_user_id,
  CONVERT(ip.source_author_username USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_username,
  CONVERT(ip.source_author_display_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_display_name,
  CONVERT(ip.source_author_avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_avatar_url,
  CONVERT(ip.post_text USING utf8mb4) COLLATE utf8mb4_unicode_ci AS post_text,
  ip.post_media_urls,
  CAST(NULL AS CHAR(20)) AS stance,
  ip.verimeter_score,
  ip.source_likes_count AS likes_count,
  ip.source_retweets_count AS retweets_count,
  ip.source_replies_count AS replies_count,
  ip.is_thread_root,
  ip.reply_to_imported_post_id AS reply_to_post_id,
  CAST(ip.source_platform AS CHAR(20)) AS source_platform,
  CONVERT(ip.source_url USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_url,
  ip.source_created_at AS created_at
FROM ttlive_imported_posts ip
WHERE 1=1

UNION ALL

SELECT
  'ttpost' AS post_source,
  p.post_id,
  p.thread_id,
  p.author_user_id,
  CONVERT(u.username USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_username,
  CONVERT(u.username USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_display_name,
  CONVERT(u.user_profile_image USING utf8mb4) COLLATE utf8mb4_unicode_ci AS author_avatar_url,
  CONVERT(p.post_text USING utf8mb4) COLLATE utf8mb4_unicode_ci AS post_text,
  p.post_media_urls,
  CAST(p.stance AS CHAR(20)) AS stance,
  p.verimeter_score,
  p.upvotes_count AS likes_count,
  p.external_retweets_count AS retweets_count,
  p.replies_count,
  FALSE AS is_thread_root,
  COALESCE(p.reply_to_post_id, p.reply_to_imported_post_id) AS reply_to_post_id,
  CAST(p.exported_to_platform AS CHAR(20)) AS source_platform,
  CAST(NULL AS CHAR(255)) AS source_url,
  p.created_at
FROM ttlive_posts p
LEFT JOIN users u ON p.author_user_id = u.user_id
WHERE p.is_hidden = FALSE

ORDER BY created_at ASC;

-- =====================================================
-- Initial Data / Default Values
-- =====================================================

-- (Optional) Create a "Welcome to TT Live" thread
INSERT INTO ttlive_threads (
  thread_id,
  thread_title,
  thread_type,
  source_platform,
  is_pinned,
  created_at,
  last_activity_at
) VALUES (
  UUID(),
  'Welcome to TruthTrollers Live Feed!',
  'native_tt',
  'native',
  TRUE,
  NOW(),
  NOW()
);

-- =====================================================
-- Migration Complete
-- =====================================================

SELECT '✅ TruthTrollers Live Feed system migration complete!' AS status;
SELECT 'Tables created: ttlive_threads, ttlive_imported_posts, ttlive_posts, ttlive_post_evidence, ttlive_thread_subscriptions, ttlive_export_log' AS details;
SELECT 'Run "npm restart" in backend to load new routes' AS next_step;
