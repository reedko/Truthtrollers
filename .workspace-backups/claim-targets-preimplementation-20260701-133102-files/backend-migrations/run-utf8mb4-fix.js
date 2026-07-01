import mysql from 'mysql';
import { promisify } from 'util';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
  charset: 'utf8mb4'
});

const query = promisify(connection.query).bind(connection);

async function runMigration() {
  try {
    console.log('🔧 Connecting to database...');
    await promisify(connection.connect).bind(connection)();

    console.log('⚙️  Dropping existing procedure...');
    await query('DROP PROCEDURE IF EXISTS InsertContentAndTopics');

    console.log('⚙️  Creating procedure with utf8mb4 support...');
    const createProcedure = `
CREATE DEFINER=\`root\`@\`localhost\` PROCEDURE \`InsertContentAndTopics\`(
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

END`;

    await query(createProcedure);

    console.log('✅ Stored procedure updated with utf8mb4 support!');
    console.log('✅ Migration complete!');

    connection.end();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    connection.end();
    process.exit(1);
  }
}

runMigration();
