import mysql from 'mysql';
import { promisify } from 'util';

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers',
});

const query = promisify(db.query).bind(db);

async function checkEvidenceLinks() {
  console.log('🔍 Checking reference_claim_links table...');

  const links = await query(`
    SELECT
      rcl.ref_claim_link_id,
      rcl.claim_id as task_claim_id,
      rcl.reference_content_id,
      rcl.support_level,
      rcl.stance,
      rcl.rationale,
      rcl.evidence_text as quote,
      tc.claim_text as task_claim,
      ref.content_name as reference_name
    FROM reference_claim_links rcl
    LEFT JOIN claims tc ON rcl.claim_id = tc.claim_id
    LEFT JOIN content ref ON rcl.reference_content_id = ref.content_id
    LIMIT 10
  `);

  console.log('\n📊 AI Evidence Links:', JSON.stringify(links, null, 2));

  console.log('\n🔍 Calculating ratings by reference...');
  const ratings = await query(`
    SELECT
      rcl.reference_content_id,
      ref.content_name,
      COUNT(*) as link_count,
      AVG(CASE
        WHEN rcl.stance = 'support' THEN rcl.support_level
        WHEN rcl.stance = 'refute' THEN -rcl.support_level
        ELSE 0
      END) as avg_score,
      SUM(CASE WHEN rcl.stance = 'support' THEN 1 ELSE 0 END) as support_count,
      SUM(CASE WHEN rcl.stance = 'refute' THEN 1 ELSE 0 END) as refute_count,
      SUM(CASE WHEN rcl.stance = 'nuance' THEN 1 ELSE 0 END) as nuance_count
    FROM reference_claim_links rcl
    LEFT JOIN content ref ON rcl.reference_content_id = ref.content_id
    GROUP BY rcl.reference_content_id
    LIMIT 10
  `);

  console.log('\n📊 Reference Ratings:', JSON.stringify(ratings, null, 2));

  db.end();
}

checkEvidenceLinks().catch(console.error);
