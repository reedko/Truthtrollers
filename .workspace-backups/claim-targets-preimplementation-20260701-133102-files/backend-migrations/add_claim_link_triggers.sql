-- Migration: Add triggers to auto-update verimeter scores when claim_links change
-- Purpose: Automatically invalidate cached scores when claim links are modified
-- Date: 2026-02-10

-- Trigger: After INSERT on claim_links, delete cached scores
DROP TRIGGER IF EXISTS claim_links_after_insert;

CREATE TRIGGER claim_links_after_insert
AFTER INSERT ON claim_links
FOR EACH ROW
BEGIN
  -- Delete cached scores for the target claim's content
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = NEW.target_claim_id;

  -- Also delete cached claim scores
  DELETE FROM claim_scores
  WHERE claim_id = NEW.target_claim_id;
END;

-- Trigger: After UPDATE on claim_links, delete cached scores
DROP TRIGGER IF EXISTS claim_links_after_update;

CREATE TRIGGER claim_links_after_update
AFTER UPDATE ON claim_links
FOR EACH ROW
BEGIN
  -- Delete cached scores for the target claim's content
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = NEW.target_claim_id;

  -- Also delete cached claim scores
  DELETE FROM claim_scores
  WHERE claim_id = NEW.target_claim_id;
END;

-- Trigger: After DELETE on claim_links, delete cached scores
DROP TRIGGER IF EXISTS claim_links_after_delete;

CREATE TRIGGER claim_links_after_delete
AFTER DELETE ON claim_links
FOR EACH ROW
BEGIN
  -- Delete cached scores for the target claim's content
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = OLD.target_claim_id;

  -- Also delete cached claim scores
  DELETE FROM claim_scores
  WHERE claim_id = OLD.target_claim_id;
END;
