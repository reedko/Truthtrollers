// test-db-connection.js
// Run this to test database connection resilience
import mysql from "mysql";

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "truthtrollers",
});

console.log("🔧 Testing database connection resilience...\n");

// Test 1: Normal query
console.log("Test 1: Normal query");
db.query("SELECT 1 + 1 AS result", (err, results) => {
  if (err) {
    console.log("❌ Normal query failed:", err.message);
  } else {
    console.log("✅ Normal query succeeded:", results);
  }

  // Test 2: Force a fatal error
  console.log("\nTest 2: Forcing fatal error by destroying connection...");
  db.destroy();

  // Test 3: Try to query after connection destroyed
  console.log("Test 3: Attempting query on dead connection");
  db.query("SELECT 1 + 1 AS result", (err, results) => {
    if (err) {
      console.log("❌ Query on dead connection failed (EXPECTED):", err.message);
      console.log("   Error code:", err.code);
      console.log("   This is the error users were seeing!");
    } else {
      console.log("✅ Query succeeded (unexpected)");
    }
  });
});

// Test with pool (the fix)
console.log("\n\n🔧 Testing with connection pool (the fix)...\n");

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "truthtrollers",
});

console.log("Test 1: Normal pool query");
pool.query("SELECT 1 + 1 AS result", (err, results) => {
  if (err) {
    console.log("❌ Pool query failed:", err.message);
  } else {
    console.log("✅ Pool query succeeded:", results);
  }

  console.log("\nTest 2: Multiple queries in succession (pool handles this well)");
  for (let i = 1; i <= 5; i++) {
    pool.query(`SELECT ${i} AS query_number`, (err, results) => {
      if (err) {
        console.log(`❌ Query ${i} failed:`, err.message);
      } else {
        console.log(`✅ Query ${i} succeeded:`, results);
      }

      if (i === 5) {
        console.log("\n✨ Pool handles concurrent queries gracefully!");
        pool.end();
      }
    });
  }
});
