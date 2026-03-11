// Test the credibility check endpoint
import mysql from "mysql";
import dotenv from "dotenv";
import { credibilityService } from "./src/services/external/index.js";

dotenv.config();

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

async function testCheck() {
  console.log("🔍 Testing credibility check...\n");

  try {
    // Get a test publisher
    const publishers = await query("SELECT * FROM publishers LIMIT 1");

    if (publishers.length === 0) {
      console.log("❌ No publishers found in database");
      pool.end();
      process.exit(1);
    }

    const publisher = publishers[0];
    console.log("📰 Testing with publisher:", publisher.publisher_name);
    console.log("   Publisher ID:", publisher.publisher_id);

    // Check OpenSanctions API key
    console.log("\n🔑 API Configuration:");
    console.log("   OpenSanctions URL:", process.env.OPENSANCTIONS_API_URL || "https://api.opensanctions.org/match/default");
    console.log("   OpenSanctions Key:", process.env.OPENSANCTIONS_API_KEY ? "✓ Configured" : "❌ Missing");
    console.log("   GDI Key:", process.env.GDI_API_KEY ? "✓ Configured" : "⚠️  Not configured (optional)");

    // Run the check
    console.log("\n🚀 Running credibility check...");
    const result = await credibilityService.checkPublisher(publisher, publisher.publisher_id);

    console.log("\n📊 Result:");
    console.log(JSON.stringify(result, null, 2));

    // Store in database
    if (result.services.opensanctions && !result.services.opensanctions.error) {
      console.log("\n💾 Storing OpenSanctions result in database...");
      const osData = result.services.opensanctions;
      await query(`
        INSERT INTO publisher_credibility_checks
        (publisher_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        publisher.publisher_id,
        'opensanctions',
        osData.risk_level || 'unknown',
        osData.has_matches || false,
        osData.match_count || 0,
        osData.highest_score || null,
        JSON.stringify(osData.risk_reasons || []),
        JSON.stringify(osData.matches || []),
        JSON.stringify(osData.raw_data || {})
      ]);
      console.log("✓ Stored successfully");
    }

    console.log("\n✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  } finally {
    pool.end();
    process.exit(0);
  }
}

testCheck();
