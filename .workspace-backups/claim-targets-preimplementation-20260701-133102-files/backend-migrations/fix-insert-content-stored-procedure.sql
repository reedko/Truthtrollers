-- ============================================================================
-- FIX InsertContentAndTopics STORED PROCEDURE
-- Add missing columns (added_by_user_id, is_system) to content_relations INSERT
-- ============================================================================

DROP PROCEDURE IF EXISTS InsertContentAndTopics;

DELIMITER $$

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

    -- ✅ Step 1: Check for duplicate content before inserting
    SELECT content_id INTO existingContentId FROM content WHERE url = contentUrl LIMIT 1;

    IF existingContentId IS NOT NULL THEN
        SET contentId = existingContentId;
    ELSE
        -- ✅ Step 2: Insert new content if no duplicate found
        INSERT INTO content (
            content_name, url, media_source, users, details, assigned, progress, content_type, is_retracted
        ) VALUES (
            contentName, contentUrl, mediaSource, contentUsers, contentDetails, contentAssigned, contentProgress, contentType, isRetracted
        );

        SET contentId = LAST_INSERT_ID();
    END IF;

    -- ✅ Step 3: Insert the main topic if it doesn't exist
    IF mainTopic IS NOT NULL AND mainTopic != '' THEN
        INSERT INTO topics (topic_name, thumbnail)
        SELECT mainTopic, thumbnail
        WHERE NOT EXISTS (
            SELECT 1 FROM topics WHERE topic_name = mainTopic
        );

        -- ✅ Get the topic ID for the main topic
        SELECT topic_id INTO topicId FROM topics WHERE topic_name = mainTopic LIMIT 1;

        -- ✅ Insert into content_topics
        INSERT IGNORE INTO content_topics (content_id, topic_id, topic_order)
        VALUES (contentId, topicId, 1);
    END IF;

    -- ✅ Step 4: Insert subtopics (if any)
    SET topicOrder = 2;
    WHILE JSON_LENGTH(subTopics) >= topicOrder - 1 DO
        -- Get the subtopic name from JSON
        SET subtopicName = JSON_UNQUOTE(JSON_EXTRACT(subTopics, CONCAT('$[', topicOrder - 2, ']')));

        -- Insert the subtopic into the topics table if it doesn't exist
        INSERT INTO topics (topic_name)
        SELECT subtopicName
        WHERE NOT EXISTS (
            SELECT 1 FROM topics WHERE topic_name = subtopicName
        );

        -- Get the topic ID for the subtopic
        SELECT topic_id INTO subtopicId FROM topics WHERE topic_name = subtopicName;

        -- Insert into content_topics with the current topic_order
        INSERT IGNORE INTO content_topics (content_id, topic_id, topic_order)
        VALUES (contentId, subtopicId, topicOrder);

        -- Increment the topic_order
        SET topicOrder = topicOrder + 1;
    END WHILE;

    -- ✅ Step 5: If it's a reference, create content relation
    -- FIXED: Add missing columns (added_by_user_id, is_system) to match schema
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
