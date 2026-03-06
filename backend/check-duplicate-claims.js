// Check for duplicate claims in the database
import { query, pool } from './src/db/pool.js';

async function checkDuplicateClaims() {
  try {
    console.log('🔍 Checking for duplicate claims...\n');

    // Find duplicate claims by content_id + claim_text
    const duplicates = await query(`
      SELECT
        content_id,
        claim_text,
        COUNT(*) as count,
        GROUP_CONCAT(claim_id) as claim_ids
      FROM claims
      GROUP BY content_id, claim_text
      HAVING COUNT(*) > 1
      ORDER BY count DESC, content_id
      LIMIT 50
    `);

    if (duplicates.length === 0) {
      console.log('✅ No duplicate claims found');
    } else {
      console.log(`❌ Found ${duplicates.length} sets of duplicate claims:\n`);
      duplicates.forEach((dup, i) => {
        console.log(`${i + 1}. Content ${dup.content_id} (${dup.count} duplicates)`);
        console.log(`   Claim: ${dup.claim_text.substring(0, 80)}...`);
        console.log(`   Claim IDs: ${dup.claim_ids}`);
        console.log('');
      });
    }

    // Check content 13212 specifically
    console.log('\n🔍 Checking content 13212 specifically...\n');
    const content13212Claims = await query(`
      SELECT claim_id, claim_text, created_at
      FROM claims
      WHERE content_id = 13212
      ORDER BY created_at, claim_id
    `);

    console.log(`Found ${content13212Claims.length} claims for content 13212:`);
    content13212Claims.forEach((claim, i) => {
      console.log(`${i + 1}. [${claim.claim_id}] ${claim.claim_text.substring(0, 100)}... (${claim.created_at})`);
    });

    // Check for duplicate reference_claim_links
    console.log('\n\n🔍 Checking for duplicate reference_claim_links...\n');
    const dupLinks = await query(`
      SELECT
        reference_content_id,
        claim_id,
        COUNT(*) as count,
        GROUP_CONCAT(link_id) as link_ids
      FROM reference_claim_links
      WHERE reference_content_id IN (
        SELECT reference_content_id
        FROM reference_claim_links
        GROUP BY reference_content_id, claim_id
        HAVING COUNT(*) > 1
      )
      GROUP BY reference_content_id, claim_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);

    if (dupLinks.length === 0) {
      console.log('✅ No duplicate reference_claim_links found');
    } else {
      console.log(`❌ Found ${dupLinks.length} duplicate reference_claim_links:\n`);
      dupLinks.forEach((dup, i) => {
        console.log(`${i + 1}. Reference ${dup.reference_content_id}, Claim ${dup.claim_id} (${dup.count} duplicates)`);
        console.log(`   Link IDs: ${dup.link_ids}\n`);
      });
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    pool.end();
  }
}

checkDuplicateClaims()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
