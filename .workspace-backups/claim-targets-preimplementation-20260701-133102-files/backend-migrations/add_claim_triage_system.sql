-- ============================================================================
-- CLAIM TRIAGE SYSTEM
-- Two-stage claim handling: extraction → triage/evaluation-worthiness
-- ============================================================================

-- Add triage status and metadata to claims table
ALTER TABLE claims
ADD COLUMN triage_status ENUM(
  'active_evaluation',           -- Has enough evidence, worth public evaluation
  'insufficient_relevant_sources', -- Not enough retrieved source claims
  'background_claim',            -- Low salience/consequence, uncontested
  'low_priority',                -- Deprioritized but not suppressed
  'needs_rewrite_for_retrieval', -- Poorly phrased for retrieval
  'novel_but_important'          -- Sparse evidence but high centrality/consequence
) DEFAULT 'active_evaluation' AFTER claim_text;

-- Triage scoring dimensions (0.0 to 1.0)
ALTER TABLE claims
ADD COLUMN claim_centrality DECIMAL(3,2) DEFAULT NULL COMMENT 'How central to source article/video (0.0-1.0)' AFTER triage_status,
ADD COLUMN claim_specificity DECIMAL(3,2) DEFAULT NULL COMMENT 'Specific vs vague (0.0-1.0)' AFTER claim_centrality,
ADD COLUMN claim_consequence DECIMAL(3,2) DEFAULT NULL COMMENT 'Low stakes vs high stakes (0.0-1.0)' AFTER claim_specificity,
ADD COLUMN claim_contestability DECIMAL(3,2) DEFAULT NULL COMMENT 'Could reasonable person dispute? (0.0-1.0)' AFTER claim_consequence,
ADD COLUMN claim_novelty DECIMAL(3,2) DEFAULT NULL COMMENT 'Obscure/novel assertion (0.0-1.0)' AFTER claim_contestability;

-- Evidence metrics from retrieval
ALTER TABLE claims
ADD COLUMN retrieval_count INT DEFAULT 0 COMMENT 'Number of retrieved source claims above threshold' AFTER claim_novelty,
ADD COLUMN distinct_source_count INT DEFAULT 0 COMMENT 'Number of unique source documents/domains' AFTER retrieval_count,
ADD COLUMN max_relevance DECIMAL(3,2) DEFAULT NULL COMMENT 'Highest relevance score from retrieval' AFTER distinct_source_count,
ADD COLUMN avg_top3_relevance DECIMAL(3,2) DEFAULT NULL COMMENT 'Average of top 3 relevance scores' AFTER max_relevance;

-- Triage metadata
ALTER TABLE claims
ADD COLUMN triaged_at TIMESTAMP NULL COMMENT 'When triage was performed' AFTER avg_top3_relevance,
ADD COLUMN triaged_by ENUM('ai', 'manual', 'rule') DEFAULT 'ai' AFTER triaged_at,
ADD COLUMN triage_reasoning TEXT NULL COMMENT 'Why this triage status was assigned' AFTER triaged_by;

-- Add indexes for filtering (these will fail silently if they already exist)
CREATE INDEX idx_triage_status ON claims(triage_status);
CREATE INDEX idx_retrieval_count ON claims(retrieval_count);
CREATE INDEX idx_claim_centrality ON claims(claim_centrality);


-- ============================================================================
-- SOURCE QUALITY SCORING SYSTEM
-- Quantitative 0-10 scoring across multiple dimensions (same scale as GameSpace)
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_quality_scores (
  score_id INT AUTO_INCREMENT PRIMARY KEY,
  content_id INT NOT NULL,

  -- Transparency dimensions (0.0-10.0, 1 decimal place)
  author_transparency DECIMAL(4,1) DEFAULT NULL COMMENT 'Named author, credentials, traceable identity (0-10)',
  publisher_transparency DECIMAL(4,1) DEFAULT NULL COMMENT 'About page, editorial standards, ownership (0-10)',

  -- Evidence quality (0.0-10.0, 1 decimal place)
  evidence_density DECIMAL(4,1) DEFAULT NULL COMMENT 'Citations, documents, data, primary source quotations (0-10)',
  claim_specificity DECIMAL(4,1) DEFAULT NULL COMMENT 'Concrete testable claims vs vague rhetoric (0-10)',

  -- Reliability indicators (0.0-10.0, 1 decimal place)
  correction_behavior DECIMAL(4,1) DEFAULT NULL COMMENT 'Corrections policy, updates, retractions (0-10)',
  domain_reputation DECIMAL(4,1) DEFAULT NULL COMMENT 'Historical reliability vs better-grounded sources (0-10)',

  -- Risk indicators (0.0-10.0, 1 decimal place, higher = riskier)
  sensationalism_score DECIMAL(4,1) DEFAULT NULL COMMENT 'Emotional framing, certainty inflation, outrage bait (0-10)',
  monetization_pressure DECIMAL(4,1) DEFAULT NULL COMMENT 'Popups, affiliate stuffing, clickbait structure (0-10)',

  -- Originality (0.0-10.0, 1 decimal place)
  original_reporting DECIMAL(4,1) DEFAULT NULL COMMENT 'Firsthand reporting higher, copied opinion chains lower (0-10)',

  -- Aggregate scores (0.0-10.0, 1 decimal place)
  quality_score DECIMAL(4,1) DEFAULT NULL COMMENT 'Weighted quality aggregate (0-10, matches GameSpace scale)',
  risk_score DECIMAL(4,1) DEFAULT NULL COMMENT 'Weighted risk aggregate (0-10, matches GameSpace scale)',

  -- Classification
  quality_tier ENUM('high', 'mid', 'low', 'unreliable') DEFAULT NULL,

  -- Metadata
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scored_by ENUM('ai', 'manual', 'auto') DEFAULT 'ai',
  scoring_model VARCHAR(100) DEFAULT NULL COMMENT 'Which model/version produced this',

  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  INDEX idx_content_id (content_id),
  INDEX idx_quality_score (quality_score),
  INDEX idx_quality_tier (quality_tier),
  UNIQUE KEY unique_content_score (content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- CLAIM-LEVEL RETRIEVAL EVIDENCE TRACKING
-- Track which source claims were retrieved for each case claim
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_retrieval_evidence (
  evidence_id INT AUTO_INCREMENT PRIMARY KEY,
  case_claim_id INT NOT NULL COMMENT 'Claim from the case being fact-checked',
  source_claim_id INT NOT NULL COMMENT 'Retrieved claim from corpus',

  -- Retrieval scores
  relevance_score DECIMAL(4,3) DEFAULT NULL COMMENT 'How relevant to case claim (0.000-1.000)',
  stance ENUM('support', 'refute', 'nuance', 'neutral', 'unclear') DEFAULT NULL,

  -- Source quality at time of retrieval
  source_quality_score DECIMAL(4,1) DEFAULT NULL COMMENT 'Quality score of source (0-10, matches GameSpace scale)',
  source_quality_tier ENUM('high', 'mid', 'low', 'unreliable') DEFAULT NULL,

  -- Metadata
  retrieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  retrieval_method VARCHAR(100) DEFAULT NULL COMMENT 'embedding, keyword, hybrid, etc.',

  FOREIGN KEY (case_claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,
  FOREIGN KEY (source_claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,
  INDEX idx_case_claim (case_claim_id),
  INDEX idx_source_claim (source_claim_id),
  INDEX idx_relevance (relevance_score),
  INDEX idx_stance (stance),
  UNIQUE KEY unique_retrieval_pair (case_claim_id, source_claim_id, retrieval_method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
