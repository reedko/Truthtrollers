// Check claim links for task claim 43588
import mysql from 'mysql2/promise';

async function checkLinks() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'd1Mm0v3g!',
    database: 'truthtrollers'
  });

  const taskClaimId = 43588;

  console.log(`\n🔍 Checking links for task claim ${taskClaimId}...\n`);

  // Check reference_claim_links (dotted lines - document level)
  const [dottedLines] = await connection.query(
    `SELECT * FROM reference_claim_links WHERE claim_id = ?`,
    [taskClaimId]
  );
  console.log(`📍 Dotted lines (reference_claim_links): ${dottedLines.length}`);
  dottedLines.forEach((link, i) => {
    console.log(`   ${i+1}. ref_content_id=${link.reference_content_id}, stance=${link.stance}, score=${link.score}`);
  });

  // Check reference_claim_task_links (claim-to-claim AI assessments)
  const [aiLinks] = await connection.query(
    `SELECT * FROM reference_claim_task_links WHERE task_claim_id = ?`,
    [taskClaimId]
  );
  console.log(`\n🤖 AI assessments (reference_claim_task_links): ${aiLinks.length}`);
  aiLinks.forEach((link, i) => {
    console.log(`   ${i+1}. ref_claim_id=${link.reference_claim_id}, stance=${link.stance}, score=${link.score}`);
  });

  // Check claim_links (manual user links)
  const [manualLinks] = await connection.query(
    `SELECT * FROM claim_links WHERE (source_claim_id = ? OR target_claim_id = ?) AND disabled = 0`,
    [taskClaimId, taskClaimId]
  );
  console.log(`\n👤 Manual links (claim_links): ${manualLinks.length}`);
  manualLinks.forEach((link, i) => {
    console.log(`   ${i+1}. source=${link.source_claim_id}, target=${link.target_claim_id}, support_level=${link.support_level}`);
  });

  // If dotted lines exist, check what claims exist in those references
  if (dottedLines.length > 0) {
    const refIds = dottedLines.map(l => l.reference_content_id);
    console.log(`\n📦 Checking claims in connected references: [${refIds.join(', ')}]`);

    const [refClaims] = await connection.query(
      `SELECT cc.content_id, cc.claim_id, c.claim_text
       FROM content_claims cc
       JOIN claims c ON cc.claim_id = c.claim_id
       WHERE cc.content_id IN (?)`,
      [refIds]
    );

    console.log(`\n   Found ${refClaims.length} claims total in ${refIds.length} references:`);
    const byRef = {};
    refClaims.forEach(claim => {
      if (!byRef[claim.content_id]) byRef[claim.content_id] = 0;
      byRef[claim.content_id]++;
    });
    Object.entries(byRef).forEach(([refId, count]) => {
      console.log(`      Reference ${refId}: ${count} claims`);
    });
  }

  await connection.end();
}

checkLinks().catch(console.error);
