-- ============================================================================
-- FIX DUPLICATE AUTHORS - Run on Production
-- ============================================================================
-- This adds a unique constraint to prevent duplicate author-content links
-- and cleans up existing duplicates
-- ============================================================================

USE truthtrollers;

-- ============================================================================
-- STEP 1: Check for existing duplicates
-- ============================================================================

SELECT
    '============================================' AS '',
    'PREVIEW: Duplicate author-content links' AS '',
    '============================================' AS '';

SELECT
    content_id,
    author_id,
    COUNT(*) as duplicate_count
FROM content_authors
GROUP BY content_id, author_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

SELECT
    COUNT(*) as total_duplicate_pairs
FROM (
    SELECT content_id, author_id
    FROM content_authors
    GROUP BY content_id, author_id
    HAVING COUNT(*) > 1
) duplicates;

-- ============================================================================
-- STEP 2: Remove duplicates (keep only the first occurrence)
-- ============================================================================
-- UNCOMMENT TO RUN:

-- DELETE ca1 FROM content_authors ca1
-- INNER JOIN content_authors ca2
-- WHERE ca1.content_id = ca2.content_id
--   AND ca1.author_id = ca2.author_id
--   AND ca1.content_authors_id > ca2.content_authors_id;

-- SELECT '✅ Duplicates removed' AS Status;

-- ============================================================================
-- STEP 3: Add unique constraint
-- ============================================================================
-- UNCOMMENT TO RUN:

-- ALTER TABLE content_authors
-- ADD UNIQUE KEY unique_content_author (content_id, author_id);

-- SELECT '✅ Unique constraint added' AS Status;

-- ============================================================================
-- STEP 4: Verify no duplicates remain
-- ============================================================================
-- UNCOMMENT AFTER RUNNING THE ABOVE:

-- SELECT
--     COUNT(*) as remaining_duplicates
-- FROM (
--     SELECT content_id, author_id
--     FROM content_authors
--     GROUP BY content_id, author_id
--     HAVING COUNT(*) > 1
-- ) duplicates;

-- Should return 0 if successful
