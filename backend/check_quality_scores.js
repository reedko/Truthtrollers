// Check quality scores and content_text for two specific content IDs
import { query } from "./src/db/pool.js";

async function check() {
  try {
    console.log("\n=== Checking content_id 14045 and 14079 ===\n");

    // Check if they have content_text
    const contentRows = await query(
      `SELECT content_id, content_name,
              LENGTH(content_text) as text_length,
              LENGTH(details) as details_length
       FROM content
       WHERE content_id IN (14045, 14079)
       ORDER BY content_id`
    );

    console.log("Content data:");
    console.table(contentRows);

    // Check if they have quality scores
    const scoresRows = await query(
      `SELECT content_id, quality_score, risk_score, quality_tier, scored_at
       FROM source_quality_scores
       WHERE content_id IN (14045, 14079)
       ORDER BY content_id`
    );

    console.log("\nQuality scores:");
    if (scoresRows.length === 0) {
      console.log("❌ No quality scores found for either content!");
    } else {
      console.table(scoresRows);
    }

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

check();
