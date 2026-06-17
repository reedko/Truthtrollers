-- Add distribution-layer provenance columns to the content table.
--
-- Layer model (lowest number = outermost wrapper):
--   platform             → "facebook" (the distribution platform)
--   distribution_channel → "EMF Truth" group (specific channel/group/page/subreddit)
--   url                  → the social post URL (the content row's unique identifier)
--   linked_url           → the external article being shared
--   linked_publisher     → publisher of that article (e.g. "emfacts.com")
--   media_source         → existing field: effective publisher of the claims
--
-- This is distinct from source_lineage_cache, which tracks article-to-article
-- excerpt/repost/syndication chains (a different axis of provenance).
--
-- Generic by design — works for Twitter, Reddit, YouTube, etc., not just Facebook.
--
-- IMPORTANT: MySQL does not support ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- The server startup code runs each statement individually with try/catch
-- so duplicate-column errors are silently ignored on subsequent startups.

ALTER TABLE content ADD COLUMN platform VARCHAR(50) NULL DEFAULT NULL COMMENT 'Distribution platform: facebook, twitter, reddit, youtube, web, etc.';
ALTER TABLE content ADD COLUMN distribution_channel VARCHAR(255) NULL DEFAULT NULL COMMENT 'Specific group, page, subreddit, or channel within the platform';
ALTER TABLE content ADD COLUMN linked_url TEXT NULL DEFAULT NULL COMMENT 'External article or resource URL shared or embedded inside this content';
ALTER TABLE content ADD COLUMN linked_publisher VARCHAR(255) NULL DEFAULT NULL COMMENT 'Publisher name or domain of the linked article';
