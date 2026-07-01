// Migration to create delete_content_cascade stored procedure
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function createProcedure() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
    multipleStatements: true
  });

  try {
    console.log('Dropping existing procedure if exists...');
    await connection.query('DROP PROCEDURE IF EXISTS delete_content_cascade');

    console.log('Creating delete_content_cascade procedure...');

    const procedureSQL = `
CREATE PROCEDURE delete_content_cascade(IN content_id_to_delete INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Delete user_claim_ratings (both task and reference claims)
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Delete reference_claim_task_links (both directions)
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Delete claim_links (both directions)
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Delete content_claims junction
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- Note: We deliberately do NOT delete from claims table
    -- because claims may be shared across multiple content items

    -- Step 8: Delete content_relations where this is a reference
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;

    -- Step 9: Delete content_relations where this is the main content
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- Step 10: Delete content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- Step 11: Delete user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id = content_id_to_delete
    OR reference_content_id = content_id_to_delete;

    -- Step 12: Delete author/publisher relations (ignore if tables don't exist)
    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '42S02' BEGIN END;
        DELETE FROM content_authors WHERE content_id = content_id_to_delete;
    END;

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '42S02' BEGIN END;
        DELETE FROM content_publishers WHERE content_id = content_id_to_delete;
    END;

    -- Step 13: Delete task completion records (ignore if table doesn't exist)
    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '42S02' BEGIN END;
        DELETE FROM task_completions WHERE content_id = content_id_to_delete;
    END;

    -- Step 14: Delete molecule view records (ignore if table doesn't exist)
    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '42S02' BEGIN END;
        DELETE FROM molecule_views WHERE content_id = content_id_to_delete;
    END;

    -- Step 15: Delete content_users (user-content relationships)
    DELETE FROM content_users WHERE content_id = content_id_to_delete;

    -- Step 16: Finally delete the content itself
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Successfully deleted content_id ', content_id_to_delete, ' and all related records') AS message;
END`;

    await connection.query(procedureSQL);

    console.log('✅ Stored procedure created successfully!');
    console.log('');
    console.log('Usage example:');
    console.log('  CALL delete_content_cascade(11399);');
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

createProcedure();
