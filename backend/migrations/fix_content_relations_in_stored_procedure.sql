-- ============================================================================
-- FIX: Ensure InsertContentAndTopics creates system-wide visible references
-- ============================================================================
-- This stored procedure is used by textpad, extension, and evidence engine
-- It needs to set is_system=1 and added_by_user_id=NULL for all references
-- ============================================================================

USE truthtrollers;

-- First, check the current procedure definition
SHOW CREATE PROCEDURE InsertContentAndTopics;

-- Drop and recreate with correct is_system=1 and added_by_user_id=NULL
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

    -- ✅ Insert the content
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

    -- ✅ CRITICAL FIX: Create content_relation with is_system=1 and added_by_user_id=NULL
    -- This makes references visible to ALL users, not just the user who scraped them
    IF contentType = 'reference' AND taskContentId IS NOT NULL THEN
        -- Check if relation already exists before inserting
        IF NOT EXISTS (
            SELECT 1 FROM content_relations
            WHERE content_id = taskContentId
            AND reference_content_id = contentId
        ) THEN
            INSERT INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system)
            VALUES (taskContentId, contentId, NULL, 1);
        END IF;
    END IF;

    -- ✅ Return the contentId
    SELECT contentId;
END$$

DELIMITER ;

-- Verify the procedure was created
SELECT 'InsertContentAndTopics procedure updated successfully' AS Status;

-- Show the updated procedure to confirm
SHOW CREATE PROCEDURE InsertContentAndTopics;
