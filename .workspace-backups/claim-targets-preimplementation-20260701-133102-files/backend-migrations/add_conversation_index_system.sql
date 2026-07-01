-- =====================================================
-- TruthTrollers Conversation Index System
-- =====================================================
-- Purpose: Create conversation spaces for imported threads where users can
--          build point/counterpoint arguments before staging for export
-- =====================================================

-- =====================================================
-- Table 1: ttlive_conversations
-- Purpose: Conversation index for each imported thread
-- =====================================================
CREATE TABLE IF NOT EXISTS ttlive_conversations (
  conversation_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  thread_id CHAR(36) NOT NULL UNIQUE,

  -- Conversation metadata
  conversation_title VARCHAR(500),
  conversation_status ENUM('active', 'archived', 'locked') DEFAULT 'active',

  -- Participant tracking
  total_participants INT DEFAULT 0,
  active_participants INT DEFAULT 0,

  -- Argument statistics
  total_arguments INT DEFAULT 0,
  support_count INT DEFAULT 0,
  refute_count INT DEFAULT 0,
  nuance_count INT DEFAULT 0,
  question_count INT DEFAULT 0,

  -- Staging pipeline
  arguments_staged INT DEFAULT 0,
  arguments_approved INT DEFAULT 0,
  arguments_exported INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,

  -- Foreign keys
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE,

  INDEX idx_status (conversation_status),
  INDEX idx_last_activity (last_activity_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Table 2: ttlive_conversation_participants
-- Purpose: Track who has joined each conversation
-- =====================================================
CREATE TABLE IF NOT EXISTS ttlive_conversation_participants (
  participant_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  conversation_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,

  -- Participation metadata
  role ENUM('participant', 'moderator', 'observer') DEFAULT 'participant',
  join_reason TEXT NULL,

  -- Activity tracking
  arguments_contributed INT DEFAULT 0,
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,

  -- Foreign keys
  FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,

  UNIQUE KEY unique_participant (conversation_id, user_id),
  INDEX idx_user (user_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Table 3: ttlive_conversation_arguments
-- Purpose: Arguments made within a conversation (before staging)
-- =====================================================
CREATE TABLE IF NOT EXISTS ttlive_conversation_arguments (
  conv_argument_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  conversation_id CHAR(36) NOT NULL,
  author_user_id INT NOT NULL,

  -- Argument structure
  claim TEXT NOT NULL,
  stance ENUM('support', 'refute', 'nuance', 'question') NOT NULL,
  reasoning TEXT NOT NULL,

  -- Reply structure (point/counterpoint)
  reply_to_conv_argument_id CHAR(36) NULL,
  reply_to_imported_post_id CHAR(36) NULL,
  depth_level INT DEFAULT 0 COMMENT 'How deep in the thread tree',

  -- Engagement
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  reply_count INT DEFAULT 0,

  -- Staging status
  is_staged BOOLEAN DEFAULT FALSE,
  staged_argument_id CHAR(36) NULL COMMENT 'Links to ttlive_staged_arguments when moved to staging',
  staged_at TIMESTAMP NULL,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Foreign keys
  FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE SET NULL,
  FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL,
  FOREIGN KEY (staged_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL,

  INDEX idx_conversation (conversation_id),
  INDEX idx_author (author_user_id),
  INDEX idx_reply_to (reply_to_conv_argument_id),
  INDEX idx_stance (stance),
  INDEX idx_staged (is_staged),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Table 4: ttlive_conversation_argument_citations
-- Purpose: Citations for conversation arguments
-- =====================================================
CREATE TABLE IF NOT EXISTS ttlive_conversation_argument_citations (
  citation_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  conv_argument_id CHAR(36) NOT NULL,

  -- Citation data
  url TEXT NOT NULL,
  title VARCHAR(1000),
  quote_text TEXT,
  context_summary TEXT,

  -- Metadata
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign keys
  FOREIGN KEY (conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE CASCADE,

  INDEX idx_argument (conv_argument_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Views: Useful conversation queries
-- =====================================================

-- View: Conversation overview with participant details
CREATE OR REPLACE VIEW v_conversation_overview AS
SELECT
  c.conversation_id,
  c.thread_id,
  c.conversation_title,
  c.conversation_status,
  c.total_participants,
  c.active_participants,
  c.total_arguments,
  c.support_count,
  c.refute_count,
  c.nuance_count,
  c.question_count,
  c.arguments_staged,
  c.arguments_approved,
  c.created_at,
  c.last_activity_at,
  t.thread_title,
  t.source_url,
  t.source_platform
FROM ttlive_conversations c
JOIN ttlive_threads t ON c.thread_id = t.thread_id
ORDER BY c.last_activity_at DESC;

-- View: Conversation arguments with author info
CREATE OR REPLACE VIEW v_conversation_arguments AS
SELECT
  ca.conv_argument_id,
  ca.conversation_id,
  ca.author_user_id,
  ca.claim,
  ca.stance,
  ca.reasoning,
  ca.reply_to_conv_argument_id,
  ca.depth_level,
  ca.upvotes,
  ca.downvotes,
  ca.reply_count,
  ca.is_staged,
  ca.staged_argument_id,
  ca.created_at,
  u.username AS author_username,
  u.user_profile_image AS author_avatar
FROM ttlive_conversation_arguments ca
JOIN users u ON ca.author_user_id = u.user_id
ORDER BY ca.created_at ASC;

SELECT 'Conversation Index System created successfully!' AS status;
