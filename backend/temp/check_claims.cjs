const mysql = require('mysql2/promise');

async function checkClaims() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'd1Mm0v3g!',
    database: 'truthtrollers'
  });

  // Get task claims
  const [taskClaims] = await connection.execute(
    'SELECT c.claim_id, LEFT(c.claim_text, 60) as claim_text FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = 11254'
  );

  console.log('\n=== TASK CLAIMS (content_id 11254) ===');
  console.table(taskClaims);

  if (taskClaims.length > 0) {
    const taskClaimIds = taskClaims.map(c => c.claim_id).join(',');

    // Get claim links
    const [claimLinks] = await connection.execute(
      `SELECT
        cl.claim_link_id,
        cl.source_claim_id,
        cl.target_claim_id,
        cl.relationship,
        cl.support_level,
        cc_source.content_id as source_content_id,
        LEFT(c_source.claim_text, 40) as source_text,
        LEFT(c_target.claim_text, 40) as target_text
      FROM claim_links cl
      LEFT JOIN claims c_source ON cl.source_claim_id = c_source.claim_id
      LEFT JOIN claims c_target ON cl.target_claim_id = c_target.claim_id
      LEFT JOIN content_claims cc_source ON c_source.claim_id = cc_source.claim_id
      WHERE cl.target_claim_id IN (${taskClaimIds})
      LIMIT 30`
    );

    console.log('\n=== CLAIM LINKS TO TASK CLAIMS ===');
    console.table(claimLinks);

    // Count by relationship
    const supportCount = claimLinks.filter(l => l.relationship === 'supports').length;
    const refuteCount = claimLinks.filter(l => l.relationship === 'refutes').length;
    const relatedCount = claimLinks.filter(l => l.relationship === 'related').length;

    console.log(`\n📊 Summary: ${supportCount} supports, ${refuteCount} refutes, ${relatedCount} related`);

    // Group by source content_id
    const byContent = {};
    claimLinks.forEach(link => {
      const cid = link.source_content_id;
      if (!byContent[cid]) {
        byContent[cid] = { supports: 0, refutes: 0, related: 0, supportLevel: 0, count: 0 };
      }
      if (link.relationship === 'supports') byContent[cid].supports++;
      else if (link.relationship === 'refutes') byContent[cid].refutes++;
      else if (link.relationship === 'related') byContent[cid].related++;
      byContent[cid].supportLevel += (link.support_level || 0);
      byContent[cid].count++;
    });

    console.log('\n📋 By Source Content (Reference):');
    Object.entries(byContent).forEach(([contentId, stats]) => {
      const preponderance = stats.supports + stats.refutes > 0
        ? (stats.supports / (stats.supports + stats.refutes)).toFixed(2)
        : 0.5;
      console.log(`Content ${contentId}: supports=${stats.supports}, refutes=${stats.refutes}, related=${stats.related}, preponderance=${preponderance}`);
    });

    // Get reference names
    console.log('\n📚 Reference Names:');
    const contentIds = Object.keys(byContent).join(',');
    if (contentIds) {
      const [refs] = await connection.execute(
        `SELECT content_id, content_name FROM content WHERE content_id IN (${contentIds})`
      );
      console.table(refs);
    }
  }

  await connection.end();
}

checkClaims().catch(console.error);
