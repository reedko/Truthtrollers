-- ============================================================================
-- FINAL FIX: Update InsertContentAndTopics to make references visible to all
-- ============================================================================
-- Only changes the content_relations INSERT line - everything else stays the same
-- ============================================================================

USE truthtrollers;

DROP PROCEDURE IF EXISTS InsertContentAndTopics;

DELIMITER $
CREATE DEFINER=`root`@`localhost` PROCEDURE `InsertContentAndTopics`(
    IN contentName VARCHAR(255),
    IN contentUrl TEXT,
    IN mediaSource VARCHAR(255),
    IN mainTopic VARCHAR(255),
    IN subTopics JSON,
    IN contentUsers VARCHAR(255),
    IN contentDetails TEXT,
    IN contentAssigned VARCHAR(255),
    IN contentProgress VARCHAR(255),
    IN thumbnail VARCHAR(255),
    IN contentType VARCHAR(50),
    IN taskContentId INT,
    IN isRetracted BOOLEAN,
    OUT contentId INT
)
BEGIN
    DECLARE existingContentId INT;
    DECLARE topicId INT;
    DECLARE subtopicId INT;
    DECLARE subtopicName VARCHAR(255);
    DECLARE topicOrder INT;


    SELECT content_id INTO existingContentId FROM content WHERE url = contentUrl LIMIT 1;

    IF existingContentId IS NOT NULL THEN
        SET contentId = existingContentId;
    ELSE

        INSERT INTO content (
            content_name, url, media_source, users, details, assigned, progress, content_type, is_retracted
        ) VALUES (
            contentName, contentUrl, mediaSource, contentUsers, contentDetails, contentAssigned, contentProgress, contentType, isRetracted
        );

        SET contentId = LAST_INSERT_ID();
    END IF;


    IF mainTopic IS NOT NULL AND mainTopic != '' THEN
        INSERT INTO topics (topic_name, thumbnail)
        SELECT mainTopic, thumbnail
        WHERE NOT EXISTS (
            SELECT 1 FROM topics WHERE topic_name = mainTopic
        );



        SELECT topic_id INTO topicId FROM topics WHERE topic_name = mainTopic LIMIT 1;


        INSERT IGNORE INTO content_topics (content_id, topic_id, topic_order)
        VALUES (contentId, topicId, 1);
    END IF;


    SET topicOrder = 2;
    WHILE JSON_LENGTH(subTopics) >= topicOrder - 1 DO

        SET subtopicName = JSON_UNQUOTE(JSON_EXTRACT(subTopics, CONCAT('$[', topicOrder - 2, ']')));


        INSERT INTO topics (topic_name)
        SELECT subtopicName
        WHERE NOT EXISTS (
            SELECT 1 FROM topics WHERE topic_name = subtopicName
        );


        SELECT topic_id INTO subtopicId FROM topics WHERE topic_name = subtopicName;


        INSERT IGNORE INTO content_topics (content_id, topic_id, topic_order)
        VALUES (contentId, subtopicId, topicOrder);


        SET topicOrder = topicOrder + 1;
    END WHILE;

    -- ✅ ONLY CHANGE: Add added_by_user_id=NULL and is_system=1 to make references visible to all
    IF contentType = "reference" AND taskContentId IS NOT NULL THEN
        INSERT IGNORE INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system)
        VALUES (taskContentId, contentId, NULL, 1);
    END IF;


    SELECT contentId;
END$
DELIMITER ;

SELECT '✅ Stored procedure updated - references now visible to all users' AS Status;

-- ============================================================================
-- Now fix existing records
-- ============================================================================

-- Preview what will be updated
SELECT
    COUNT(*) as records_that_need_fixing
FROM content_relations
WHERE is_system = 0
  AND added_by_user_id IS NOT NULL;

-- Fix them (uncomment to run)
-- UPDATE content_relations
-- SET
--     is_system = 1,
--     added_by_user_id = NULL
-- WHERE is_system = 0
--   AND added_by_user_id IS NOT NULL;

-- SELECT '✅ Existing records fixed' AS Status;
