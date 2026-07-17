-- Optional audited backfill. Run only after 2026-07-16-02 is verified.
-- Do not also run the backfill in add-publisher-source-normalization.sql.
-- Existing production audit: 600 links become legacy_unspecified; zero context
-- candidates were present on 2026-07-16. No primary publisher is guessed.

UPDATE content_publishers
SET publisher_role = 'legacy_unspecified'
WHERE publisher_role IS NULL OR publisher_role = '';

INSERT INTO content_publishing_context (
  content_id, context_type, platform, distribution_channel, linked_url,
  linked_publisher_observed, social_provenance, extraction_method,
  extraction_confidence, extractor_version, extraction_evidence
)
SELECT
  c.content_id,
  CASE
    WHEN c.social_provenance IS NOT NULL
      OR LOWER(COALESCE(c.platform, '')) IN
        ('facebook','twitter','x','instagram','reddit','tiktok','linkedin')
      THEN 'social'
    WHEN LOWER(COALESCE(c.platform, '')) IN ('youtube','podcast','tv','radio')
      THEN 'broadcast'
    WHEN LOWER(COALESCE(c.platform, '')) IN ('pdf','scholarly')
      THEN 'scholarly'
    WHEN LOWER(COALESCE(c.platform, '')) IN ('archive','wayback')
      THEN 'archive'
    ELSE 'web'
  END,
  c.platform,
  c.distribution_channel,
  c.linked_url,
  c.linked_publisher,
  c.social_provenance,
  CASE WHEN c.social_provenance IS NOT NULL
    THEN 'legacy_extension_dom' ELSE 'legacy_content_columns' END,
  'low',
  'legacy-backfill-v1',
  JSON_OBJECT('backfilled_from', 'content', 'requires_review', TRUE)
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
  SELECT content_id FROM content_publishers
  GROUP BY content_id HAVING COUNT(*) > 1
) AS ambiguous_content;
