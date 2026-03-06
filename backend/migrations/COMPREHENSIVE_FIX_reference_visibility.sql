-- ============================================================================
-- COMPREHENSIVE FIX: Make ALL scraped references visible to ALL users
-- ============================================================================
-- Run this on your production database via MySQL Workbench
-- ============================================================================

USE truthtrollers;

-- ============================================================================
-- STEP 1: Fix the stored procedure (used by textpad, extension, evidence engine)
-- ============================================================================

DROP PROCEDURE IF EXISTS InsertContentAndTopics;

DELIMITER $$

CREATE DEFINER=`root`@`localhost` PROCEDURE `InsertContentAndTopics`(
    IN contentName VARCHAR(512),
    IN url TEXT,
    IN thumbnailPath VARCHAR(512),
    IN publisherId INT,
    IN rawText TEXT,
    IN contentType VARCHAR(50),
    IN mediaSource VARCHAR(255),
    IN videoId VARCHAR(255),
    IN topic VARCHAR(255),
    IN subtopics TEXT,
    IN taskContentId INT,
    IN contentDescription TEXT,
    IN isRetracted TINYINT
)
BEGIN
    DECLARE contentId INT;

    INSERT INTO content (
        content_name,
        url,
        thumbnail,
        publisher_id,
        raw_text,
        content_type,
        media_source,
        video_id,
        topic,
        subtopics,
        content_description,
        is_retracted
    )
    VALUES (
        contentName,
        url,
        thumbnailPath,
        publisherId,
        rawText,
        contentType,
        mediaSource,
        videoId,
        topic,
        subtopics,
        contentDescription,
        isRetracted
    );

    SET contentId = LAST_INSERT_ID();

    -- ✅ FIXED: is_system=1, added_by_user_id=NULL
    IF contentType = 'reference' AND taskContentId IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM content_relations
            WHERE content_id = taskContentId
            AND reference_content_id = contentId
        ) THEN
            INSERT INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system)
            VALUES (taskContentId, contentId, NULL, 1);
        END IF;
    END IF;

    SELECT contentId;
END$$

DELIMITER ;

SELECT '✅ Stored procedure updated' AS Status;

-- ============================================================================
-- STEP 2: Preview existing records that need fixing
-- ============================================================================

SELECT
    '============================================' AS '',
    'PREVIEW: Records that will be updated' AS '',
    '============================================' AS '';

SELECT
    content_relation_id,
    content_id,
    reference_content_id,
    added_by_user_id,
    is_system,
    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
FROM content_relations
WHERE is_system = 0
  AND added_by_user_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 100;

SELECT
    COUNT(*) as total_records_to_update
FROM content_relations
WHERE is_system = 0
  AND added_by_user_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Fix existing records (UNCOMMENT TO RUN)
-- ============================================================================

-- UPDATE content_relations
-- SET
--     is_system = 1,
--     added_by_user_id = NULL
-- WHERE is_system = 0
--   AND added_by_user_id IS NOT NULL;

-- ============================================================================
-- STEP 4: Verify the fix (UNCOMMENT AFTER RUNNING UPDATE)
-- ============================================================================

-- SELECT
--     '============================================' AS '',
--     'VERIFICATION: All system references' AS '',
--     '============================================' AS '';

-- SELECT
--     COUNT(*) as total_system_references,
--     COUNT(CASE WHEN added_by_user_id IS NULL THEN 1 END) as references_with_null_user,
--     COUNT(CASE WHEN added_by_user_id IS NOT NULL THEN 1 END) as references_with_user_SHOULD_BE_ZERO
-- FROM content_relations
-- WHERE is_system = 1;

-- SELECT
--     '============================================' AS '',
--     'Any remaining user-specific references (should be empty)' AS '',
--     '============================================' AS '';

-- SELECT
--     content_relation_id,
--     content_id,
--     reference_content_id,
--     added_by_user_id,
--     is_system
-- FROM content_relations
-- WHERE is_system = 0
-- LIMIT 10;
