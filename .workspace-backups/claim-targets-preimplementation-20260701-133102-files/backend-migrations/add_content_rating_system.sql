-- Migration: Content Rating & Approval Voting System
-- Purpose: Multi-evaluator approval system for user-assembled evidence chains

-- ══════════════════════════════════════════════════════════════════
-- LEVEL 1: Content Ratings
-- A user's assembled evidence chain for a piece of content
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content_ratings (
  content_rating_id INT PRIMARY KEY AUTO_INCREMENT,

  -- What content and who created it
  content_id INT NOT NULL,
  user_id INT NOT NULL,  -- who assembled this evidence chain

  -- Status tracking
  completed BOOLEAN DEFAULT FALSE,  -- has user marked their work complete?
  approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',

  -- Vote tracking (for approval workflow)
  votes_approve INT DEFAULT 0,    -- count of positive evaluations
  votes_reject INT DEFAULT 0,     -- count of negative evaluations
  total_votes INT DEFAULT 0,

  -- Scoring (calculated from evaluations)
  avg_evaluation_score DECIMAL(5,2) NULL,  -- average of all evaluation scores
  total_points DECIMAL(10,2) DEFAULT 0,     -- points earned for this work

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP NULL,    -- when user marked it complete
  finalized_at TIMESTAMP NULL,    -- when approved/rejected

  -- Constraints
  UNIQUE KEY unique_user_content (user_id, content_id),
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,

  -- Indexes
  INDEX idx_approval_status (approval_status),
  INDEX idx_completed (completed),
  INDEX idx_user (user_id),
  INDEX idx_content (content_id),
  INDEX idx_submitted (submitted_at),
  INDEX idx_votes (votes_approve, votes_reject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User-assembled evidence chains for content - the work being evaluated';

-- ══════════════════════════════════════════════════════════════════
-- LEVEL 2: Content Rating Evaluations (Approval Voting)
-- Individual votes on content ratings - need 2+ approvals to pass
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content_rating_evaluations (
  evaluation_id INT PRIMARY KEY AUTO_INCREMENT,

  -- What is being evaluated
  content_rating_id INT NOT NULL,

  -- Who is evaluating
  evaluator_user_id INT NOT NULL,

  -- The evaluation
  score INT NOT NULL,  -- -99 to +99 (-99=terrible, 0=neutral, +99=excellent)
  vote ENUM('approve', 'reject') NOT NULL,  -- derived from score (>=0 = approve, <0 = reject)
  notes TEXT NULL,     -- "Good sources", "Missing key evidence", etc.

  -- Points awarded
  evaluator_points DECIMAL(5,2) DEFAULT 15.0,  -- points evaluator earns for doing this
  subject_points DECIMAL(5,2) DEFAULT 0,       -- points subject earns (if approved)

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (content_rating_id) REFERENCES content_ratings(content_rating_id) ON DELETE CASCADE,
  FOREIGN KEY (evaluator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,

  -- Each user can only evaluate a content rating once
  UNIQUE KEY unique_evaluator_content (evaluator_user_id, content_rating_id),

  -- Indexes
  INDEX idx_content_rating (content_rating_id),
  INDEX idx_evaluator (evaluator_user_id),
  INDEX idx_vote (vote),
  INDEX idx_score (score),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Individual votes on content ratings - 2+ approvals needed for approval';

-- ══════════════════════════════════════════════════════════════════
-- LEVEL 3: User Reputation (Aggregate Track Record)
-- Overall reputation calculated from all content ratings & evaluations
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_reputation (
  user_id INT PRIMARY KEY,

  -- Content creation track record
  content_ratings_submitted INT DEFAULT 0,      -- total submitted
  content_ratings_approved INT DEFAULT 0,       -- approved count
  content_ratings_rejected INT DEFAULT 0,       -- rejected count
  content_ratings_pending INT DEFAULT 0,        -- still pending
  approval_rate DECIMAL(5,2) DEFAULT 0,         -- % approved
  avg_content_score DECIMAL(5,2) DEFAULT 0,     -- avg score across all content ratings

  -- Evaluation activity (how many times they've evaluated others)
  evaluations_given INT DEFAULT 0,              -- times they evaluated someone else
  avg_evaluation_score_given DECIMAL(5,2) DEFAULT 0,  -- avg score they give

  -- Overall reputation scores
  total_points DECIMAL(10,2) DEFAULT 0,         -- lifetime points earned
  veracity_rating DECIMAL(5,2) DEFAULT 50.0,    -- 0-100 overall trustworthiness
  reputation_level INT DEFAULT 1,               -- gamification level (1-10+)

  -- Quality metrics
  consistency_score DECIMAL(5,2) DEFAULT 50.0,  -- how consistent are they
  evidence_quality DECIMAL(5,2) DEFAULT 50.0,   -- quality of sources used
  bias_score DECIMAL(5,2) DEFAULT 50.0,         -- political/source bias detection

  -- Penalties
  total_penalties INT DEFAULT 0,
  penalty_points DECIMAL(10,2) DEFAULT 0,
  last_penalty_at TIMESTAMP NULL,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP NULL,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,

  INDEX idx_veracity (veracity_rating),
  INDEX idx_points (total_points),
  INDEX idx_level (reputation_level),
  INDEX idx_approval_rate (approval_rate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Aggregate user reputation - track record across all content ratings';

-- ══════════════════════════════════════════════════════════════════
-- VIEWS FOR EASIER QUERYING
-- ══════════════════════════════════════════════════════════════════

-- View: Pending content ratings needing evaluation
CREATE OR REPLACE VIEW v_content_ratings_pending AS
SELECT
  cr.content_rating_id,
  cr.content_id,
  cr.user_id,
  u.username,
  u.email,
  c.title as content_title,
  c.url as content_url,
  cr.completed,
  cr.approval_status,
  cr.votes_approve,
  cr.votes_reject,
  cr.total_votes,
  cr.avg_evaluation_score,
  cr.submitted_at,
  cr.created_at,
  COUNT(DISTINCT cl.claim_link_id) as claim_link_count,
  COALESCE(r.name, 'user') as user_role,
  COALESCE(ur_rep.veracity_rating, 50) as user_veracity
FROM content_ratings cr
JOIN users u ON cr.user_id = u.user_id
JOIN content c ON cr.content_id = c.content_id
LEFT JOIN claim_links cl ON cl.user_id = cr.user_id
  AND EXISTS (
    SELECT 1 FROM content_claims cc
    JOIN claims source ON cc.claim_id = source.claim_id
    WHERE cc.content_id = cr.content_id
      AND source.claim_id = cl.source_claim_id
  )
LEFT JOIN user_roles ur ON u.user_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.role_id
LEFT JOIN user_reputation ur_rep ON u.user_id = ur_rep.user_id
WHERE cr.completed = TRUE
  AND cr.approval_status = 'pending'
GROUP BY cr.content_rating_id
ORDER BY cr.submitted_at ASC;

-- View: Evaluation details with context
CREATE OR REPLACE VIEW v_evaluations_detail AS
SELECT
  e.evaluation_id,
  e.content_rating_id,
  e.evaluator_user_id,
  eval_user.username as evaluator_username,
  COALESCE(eval_role.name, 'user') as evaluator_role,
  e.score,
  e.vote,
  e.notes,
  e.evaluator_points,
  e.subject_points,
  e.created_at,
  -- Content rating being evaluated
  cr.user_id as subject_user_id,
  subject_user.username as subject_username,
  cr.content_id,
  c.title as content_title,
  cr.approval_status,
  cr.votes_approve,
  cr.votes_reject,
  cr.total_votes
FROM content_rating_evaluations e
JOIN users eval_user ON e.evaluator_user_id = eval_user.user_id
LEFT JOIN user_roles eval_ur ON eval_user.user_id = eval_ur.user_id
LEFT JOIN roles eval_role ON eval_ur.role_id = eval_role.role_id
JOIN content_ratings cr ON e.content_rating_id = cr.content_rating_id
JOIN users subject_user ON cr.user_id = subject_user.user_id
JOIN content c ON cr.content_id = c.content_id;

-- View: User reputation leaderboard
CREATE OR REPLACE VIEW v_reputation_leaderboard AS
SELECT
  u.user_id,
  u.username,
  u.email,
  COALESCE(r.name, 'user') as role,
  ur.veracity_rating,
  ur.total_points,
  ur.reputation_level,
  ur.approval_rate,
  ur.content_ratings_submitted,
  ur.content_ratings_approved,
  ur.evaluations_given,
  ur.avg_content_score,
  ur.last_activity_at
FROM users u
LEFT JOIN user_reputation ur ON u.user_id = ur.user_id
LEFT JOIN user_roles u_roles ON u.user_id = u_roles.user_id
LEFT JOIN roles r ON u_roles.role_id = r.role_id
ORDER BY ur.veracity_rating DESC, ur.total_points DESC;

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS FOR AUTO-UPDATING AGGREGATES
-- ══════════════════════════════════════════════════════════════════

DELIMITER $$

-- Trigger: Update content_rating when evaluation is added
CREATE TRIGGER after_content_evaluation_insert
AFTER INSERT ON content_rating_evaluations
FOR EACH ROW
BEGIN
  DECLARE approve_count INT;
  DECLARE reject_count INT;
  DECLARE avg_score DECIMAL(5,2);

  -- Count votes
  SELECT
    SUM(CASE WHEN vote = 'approve' THEN 1 ELSE 0 END),
    SUM(CASE WHEN vote = 'reject' THEN 1 ELSE 0 END),
    AVG(score)
  INTO approve_count, reject_count, avg_score
  FROM content_rating_evaluations
  WHERE content_rating_id = NEW.content_rating_id;

  -- Update content_rating
  UPDATE content_ratings
  SET
    votes_approve = approve_count,
    votes_reject = reject_count,
    total_votes = approve_count + reject_count,
    avg_evaluation_score = avg_score,
    -- Auto-approve if 2+ approvals
    approval_status = CASE
      WHEN approve_count >= 2 THEN 'approved'
      WHEN reject_count >= 2 THEN 'rejected'
      ELSE approval_status
    END,
    -- Set finalized_at when approved/rejected
    finalized_at = CASE
      WHEN (approve_count >= 2 OR reject_count >= 2) AND finalized_at IS NULL
      THEN NOW()
      ELSE finalized_at
    END,
    -- Award points if approved (based on avg score)
    total_points = CASE
      WHEN approve_count >= 2
      THEN GREATEST(0, avg_score)  -- positive scores only
      ELSE 0
    END
  WHERE content_rating_id = NEW.content_rating_id;

  -- Update user_reputation for the evaluator
  INSERT INTO user_reputation (user_id, evaluations_given, avg_evaluation_score_given)
  VALUES (NEW.evaluator_user_id, 1, NEW.score)
  ON DUPLICATE KEY UPDATE
    evaluations_given = evaluations_given + 1,
    avg_evaluation_score_given = (
      (avg_evaluation_score_given * evaluations_given + NEW.score) / (evaluations_given + 1)
    ),
    last_activity_at = NOW();
END$$

-- Trigger: Update user_reputation when content_rating status changes
CREATE TRIGGER after_content_rating_update
AFTER UPDATE ON content_ratings
FOR EACH ROW
BEGIN
  IF OLD.approval_status != NEW.approval_status THEN
    -- Update the user's reputation stats
    INSERT INTO user_reputation (
      user_id,
      content_ratings_submitted,
      content_ratings_approved,
      content_ratings_rejected,
      content_ratings_pending,
      avg_content_score,
      total_points
    )
    SELECT
      NEW.user_id,
      COUNT(*),
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END),
      AVG(COALESCE(avg_evaluation_score, 0)),
      SUM(COALESCE(total_points, 0))
    FROM content_ratings
    WHERE user_id = NEW.user_id
    ON DUPLICATE KEY UPDATE
      content_ratings_submitted = VALUES(content_ratings_submitted),
      content_ratings_approved = VALUES(content_ratings_approved),
      content_ratings_rejected = VALUES(content_ratings_rejected),
      content_ratings_pending = VALUES(content_ratings_pending),
      approval_rate = (VALUES(content_ratings_approved) / GREATEST(VALUES(content_ratings_submitted), 1)) * 100,
      avg_content_score = VALUES(avg_content_score),
      total_points = VALUES(total_points),
      -- Calculate veracity rating (0-100 based on approval rate and avg score)
      veracity_rating = GREATEST(0, LEAST(100,
        (VALUES(content_ratings_approved) / GREATEST(VALUES(content_ratings_submitted), 1)) * 100 * 0.6 +
        (VALUES(avg_content_score) + 99) / 198 * 100 * 0.4
      )),
      last_activity_at = NOW();
  END IF;
END$$

DELIMITER ;

-- ══════════════════════════════════════════════════════════════════
-- INITIAL DATA - Create reputation records for existing users
-- ══════════════════════════════════════════════════════════════════

INSERT INTO user_reputation (user_id)
SELECT user_id FROM users
WHERE user_id NOT IN (SELECT user_id FROM user_reputation);

-- ══════════════════════════════════════════════════════════════════
-- SYSTEM DOCUMENTATION
-- ══════════════════════════════════════════════════════════════════

/*
WORKFLOW:

1. User creates claim_links for a piece of content (evidence chain)
2. User marks content as "completed" → creates content_rating record
3. Content rating goes to "pending" status → needs evaluation
4. Other users (same/higher role) evaluate:
   - Give score -99 to +99
   - Vote auto-determined: score >= 0 = approve, < 0 = reject
5. Auto-approval: 2+ approve votes → status = 'approved', user gets points
6. Auto-rejection: 2+ reject votes → status = 'rejected', user gets 0 points
7. User reputation aggregates all their ratings into veracity score (0-100)

VERACITY CALCULATION:
- 60% weight: approval rate (approved / total submitted)
- 40% weight: average evaluation score (normalized to 0-100)
- Range: 0 (terrible) to 100 (perfect)

EXAMPLE:
- User A: 10 ratings, 8 approved, avg score 75
  - Approval rate: 80%
  - Score normalized: (75+99)/198 = 87.8%
  - Veracity: 80 * 0.6 + 87.8 * 0.4 = 83.1
*/
