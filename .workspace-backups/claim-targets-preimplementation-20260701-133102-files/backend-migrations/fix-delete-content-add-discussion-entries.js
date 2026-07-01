// Fix delete_content_cascade stored procedure to handle discussion_entries table
import mysql from 'mysql';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

function query(sql, params) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

async function main() {
  try {
    console.log('🔧 Updating delete_content_cascade stored procedure...');

    // First drop the old procedure
    await query('DROP PROCEDURE IF EXISTS delete_content_cascade');
    console.log('  Dropped old procedure');

    // Then create the new one (without DELIMITER commands)
    const createProcedure = `
CREATE PROCEDURE delete_content_cascade(IN content_id_to_delete INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    CREATE TEMPORARY TABLE IF NOT EXISTS temp_claims_to_check (claim_id INT);
    DELETE FROM temp_claims_to_check;
    INSERT INTO temp_claims_to_check (claim_id)
    SELECT DISTINCT claim_id FROM content_claims WHERE content_id = content_id_to_delete;

    DELETE FROM reference_claim_task_links
    WHERE task_claim_id IN (SELECT claim_id FROM temp_claims_to_check);

    DELETE FROM reference_claim_task_links
    WHERE reference_claim_id IN (SELECT claim_id FROM temp_claims_to_check);

    DELETE FROM claim_links
    WHERE source_claim_id IN (SELECT claim_id FROM temp_claims_to_check)
       OR target_claim_id IN (SELECT claim_id FROM temp_claims_to_check);

    DELETE FROM user_claim_ratings
    WHERE claim_id IN (SELECT claim_id FROM temp_claims_to_check);

    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    DELETE FROM claims
    WHERE claim_id IN (SELECT claim_id FROM temp_claims_to_check)
      AND claim_id NOT IN (SELECT DISTINCT claim_id FROM content_claims);

    DROP TEMPORARY TABLE IF EXISTS temp_claims_to_check;

    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    DELETE FROM user_reference_visibility
    WHERE task_content_id = content_id_to_delete
       OR reference_content_id = content_id_to_delete;

    DELETE FROM content_authors WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;
    DELETE FROM task_completions WHERE content_id = content_id_to_delete;
    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Successfully deleted content_id ', content_id_to_delete, ' and all related records') AS message;
END
    `;

    await query(createProcedure);
    console.log('  Created new procedure');

    console.log('✅ Stored procedure updated successfully!');
    console.log('✅ delete_content_cascade now handles discussion_entries table');

    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    pool.end();
    process.exit(1);
  }
}

main();
