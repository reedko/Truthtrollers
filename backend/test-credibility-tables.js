// Test script to check if credibility tables exist
import mysql from "mysql";
import dotenv from "dotenv";

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

async function testTables() {
  console.log("🔍 Checking credibility tables...\n");

  try {
    // Check for credibility tables
    const tables = await query("SHOW TABLES LIKE '%credibility%'");
    console.log("📊 Credibility tables found:", tables.length);
    tables.forEach((row) => {
      const tableName = Object.values(row)[0];
      console.log("  ✓", tableName);
    });

    if (tables.length === 0) {
      console.log("\n❌ No credibility tables found!");
      console.log("👉 Run: node migrations/add-credibility-checks.js");
    } else {
      // Check table structure
      console.log("\n📋 Checking author_credibility_checks structure...");
      const authCols = await query("DESCRIBE author_credibility_checks");
      console.log(`  ✓ ${authCols.length} columns found`);

      console.log("\n📋 Checking publisher_credibility_checks structure...");
      const pubCols = await query("DESCRIBE publisher_credibility_checks");
      console.log(`  ✓ ${pubCols.length} columns found`);

      // Check if tables are empty
      const authCount = await query("SELECT COUNT(*) as count FROM author_credibility_checks");
      const pubCount = await query("SELECT COUNT(*) as count FROM publisher_credibility_checks");

      console.log("\n📈 Record counts:");
      console.log(`  Author checks: ${authCount[0].count}`);
      console.log(`  Publisher checks: ${pubCount[0].count}`);
    }

    console.log("\n✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\n👉 You may need to run the migration:");
    console.log("   node migrations/add-credibility-checks.js");
  } finally {
    pool.end();
    process.exit(0);
  }
}

testTables();
