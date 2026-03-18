-- ============================================================================
-- FIX: Set InsertContentAndTopics to use utf8mb4 character set
-- ============================================================================
-- This ensures emoji and other 4-byte UTF-8 characters work correctly
-- ============================================================================

USE truthtrollers;

DROP PROCEDURE IF EXISTS InsertContentAndTopics;

DELIMITER $$

CREATE DEFINER=`root`@`localhost` PROCEDURE `InsertContentAndTopics`(
    IN contentName VARCHAR(255) CHARACTER SET utf8mb4,
    IN contentUrl TEXT CHARACTER SET utf8mb4,
    IN mediaSource VARCHAR(255) CHARACTER SET utf8mb4,
    IN mainTopic VARCHAR(255) CHARACTER SET utf8mb4,
    IN subTopics JSON,
    IN contentUsers VARCHAR(255) CHARACTER SET utf8mb4,
    IN contentDetails TEXT CHARACTER SET utf8mb4,
    IN contentAssigned VARCHAR(255) CHARACTER SET utf8mb4,
    IN contentProgress VARCHAR(255) CHARACTER SET utf8mb4,
    IN thumbnail VARCHAR(255) CHARACTER SET utf8mb4,
    IN contentType VARCHAR(50) CHARACTER SET utf8mb4,
    IN taskContentId INT,
    IN isRetracted BOOLEAN,
    OUT contentId INT
)
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci
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

    -- Handle task references if linking a reference to a task
    IF taskContentId IS NOT NULL AND taskContentId > 0 THEN
        INSERT INTO content_relations (content_id, reference_content_id, user_id)
        VALUES (taskContentId, contentId, 0)
        ON DUPLICATE KEY UPDATE content_id = taskContentId;
    END IF;

    -- Insert thumbnail if provided
    IF thumbnail IS NOT NULL AND thumbnail != '' THEN
        UPDATE content SET content.thumbnail = thumbnail WHERE content.content_id = contentId;
    END IF;

    -- Topic handling
    SELECT topic_id INTO topicId FROM topics WHERE topic_name = mainTopic LIMIT 1;

    IF topicId IS NULL THEN
        INSERT INTO topics (topic_name, topic_order) VALUES (mainTopic, 0);
        SET topicId = LAST_INSERT_ID();
    END IF;

    UPDATE content SET topic = mainTopic WHERE content.content_id = contentId;

    -- Subtopics handling
    IF JSON_LENGTH(subTopics) > 0 THEN
        SET topicOrder = 0;
        WHILE topicOrder < JSON_LENGTH(subTopics) DO
            SET subtopicName = JSON_UNQUOTE(JSON_EXTRACT(subTopics, CONCAT('$[', topicOrder, ']')));

            SELECT subtopic_id INTO subtopicId FROM subtopics
            WHERE subtopic_name = subtopicName AND topic_id = topicId LIMIT 1;

            IF subtopicId IS NULL THEN
                INSERT INTO subtopics (subtopic_name, topic_id) VALUES (subtopicName, topicId);
                SET subtopicId = LAST_INSERT_ID();
            END IF;

            INSERT INTO content_subtopics (content_id, subtopic_id)
            VALUES (contentId, subtopicId)
            ON DUPLICATE KEY UPDATE content_id = contentId;

            SET topicOrder = topicOrder + 1;
        END WHILE;
    END IF;

END$$

DELIMITER ;

SELECT 'Stored procedure updated with utf8mb4 support' AS status;
