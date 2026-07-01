// backend/migrations/cleanup_duplicate_content_claims.js
// Cleans up duplicate content_claims links created by re-scraping references

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: '.env.dev' });

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "truthtrollers",
};

async function cleanupDuplicates() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🧹 Cleaning up duplicate content_claims links...\n");

    // Find content items with duplicate claims using a simpler query
    // First, get content_ids that have duplicates
    const contentIdsQuery = `
      SELECT DISTINCT cc1.content_id
      FROM content_claims cc1
      JOIN content_claims cc2 ON cc1.content_id = cc2.content_id
        AND cc1.relationship_type = cc2.relationship_type
        AND cc1.claim_id != cc2.claim_id
      JOIN claims c1 ON cc1.claim_id = c1.claim_id
      JOIN claims c2 ON cc2.claim_id = c2.claim_id
      WHERE c1.claim_text = c2.claim_text
      LIMIT 100
    `;

    const [contentIdsResult] = await connection.execute(contentIdsQuery);
    const contentIds = contentIdsResult.map(row => row.content_id);

    if (contentIds.length === 0) {
      console.log("✅ No duplicate content_claims links found!");
      return;
    }

    console.log(`Found ${contentIds.length} content items with duplicate claim links\n`);

    // Process each content_id individually
    const duplicates = [];
    for (const contentId of contentIds) {
      const [contentDups] = await connection.execute(
        `SELECT
          cc.content_id,
          c.claim_text,
          COUNT(*) as link_count,
          GROUP_CONCAT(cc.claim_id ORDER BY cc.claim_id) as claim_ids,
          cc.relationship_type
        FROM content_claims cc
        JOIN claims c ON cc.claim_id = c.claim_id
        WHERE cc.content_id = ?
        GROUP BY cc.content_id, c.claim_text, cc.relationship_type
        HAVING COUNT(*) > 1`,
        [contentId]
      );
      duplicates.push(...contentDups);
    }

    if (duplicates.length === 0) {
      console.log("✅ No duplicate content_claims links found!");
      return;
    }

    console.log(`Found ${duplicates.length} cases of duplicate claim links:\n`);

    let totalLinksRemoved = 0;
    let totalClaimsDeleted = 0;

    for (const dup of duplicates) {
      const claimIds = dup.claim_ids.split(',').map(id => parseInt(id));
      const keepClaimId = claimIds[0];  // Keep the first (oldest) claim
      const deleteClaimIds = claimIds.slice(1);  // Delete the rest

      console.log(`📦 content_id ${dup.content_id} (${dup.relationship_type}):`);
      console.log(`   Claim: "${dup.claim_text.substring(0, 80)}${dup.claim_text.length > 80 ? '...' : ''}"`);
      console.log(`   Linked ${dup.link_count} times with claim_ids: [${claimIds.join(', ')}]`);
      console.log(`   ✅ Keeping claim_id ${keepClaimId}`);
      console.log(`   🗑️  Removing duplicate links: [${deleteClaimIds.join(', ')}]`);

      // Update any evidence links to point to the kept claim
      // Both 'reference' and 'snippet' claims can be in reference_claim_task_links
      if (deleteClaimIds.length > 0) {
        const placeholders = deleteClaimIds.map(() => '?').join(',');
        const [updateResult] = await connection.execute(
          `UPDATE reference_claim_task_links
           SET reference_claim_id = ?
           WHERE reference_claim_id IN (${placeholders})`,
          [keepClaimId, ...deleteClaimIds]
        );
        if (updateResult.affectedRows > 0) {
          console.log(`   🔄 Updated ${updateResult.affectedRows} evidence links to use claim_id ${keepClaimId}`);
        }
      }

      // Delete duplicate content_claims links
      if (deleteClaimIds.length > 0) {
        const placeholders = deleteClaimIds.map(() => '?').join(',');
        const [deleteLinkResult] = await connection.execute(
          `DELETE FROM content_claims
           WHERE content_id = ?
           AND claim_id IN (${placeholders})
           AND relationship_type = ?`,
          [dup.content_id, ...deleteClaimIds, dup.relationship_type]
        );
        totalLinksRemoved += deleteLinkResult.affectedRows;
      }

      // Delete orphaned duplicate claims (not linked anywhere else)
      for (const claimId of deleteClaimIds) {
        const [[usageCount]] = await connection.execute(
          `SELECT COUNT(*) as count FROM content_claims WHERE claim_id = ?`,
          [claimId]
        );

        if (usageCount.count === 0) {
          await connection.execute(`DELETE FROM claims WHERE claim_id = ?`, [claimId]);
          totalClaimsDeleted++;
          console.log(`   🗑️  Deleted orphaned claim_id ${claimId}`);
        }
      }

      console.log();
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Cleanup complete!");
    console.log(`   Removed ${totalLinksRemoved} duplicate content_claims links`);
    console.log(`   Deleted ${totalClaimsDeleted} orphaned claims`);
    console.log("=".repeat(60) + "\n");

  } catch (err) {
    console.error("❌ Error during cleanup:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

// Run the cleanup
cleanupDuplicates()
  .then(() => {
    console.log("🎉 Cleanup script finished!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Cleanup failed:", err);
    process.exit(1);
  });
