// /backend/migrations/populate-publisher-domains.js
/**
 * Optional migration to populate publisher domains from publisher names
 * This is a helper to extract domains from publisher names like "nytimes.com" or "The New York Times"
 */
import mysql from "mysql";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true
});

const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

/**
 * Simple domain extraction from publisher name
 * Examples:
 *   "nytimes.com" -> "nytimes.com"
 *   "The New York Times" -> null (can't extract)
 *   "BBC News (bbc.com)" -> "bbc.com"
 */
function extractDomain(publisherName) {
  if (!publisherName) return null;

  // Check if it already looks like a domain
  const domainPattern = /([a-z0-9-]+\.[a-z]{2,})/i;
  const match = publisherName.match(domainPattern);

  if (match) {
    return match[1].toLowerCase();
  }

  return null;
}

async function populateDomains() {
  console.log("Starting publisher domain population...");

  try {
    // Get all publishers without domains
    const publishers = await query(
      `SELECT publisher_id, publisher_name, domain
       FROM publishers
       WHERE domain IS NULL OR domain = ''`
    );

    console.log(`Found ${publishers.length} publishers without domains`);

    let updated = 0;
    let skipped = 0;

    for (const publisher of publishers) {
      const domain = extractDomain(publisher.publisher_name);

      if (domain) {
        await query(
          `UPDATE publishers SET domain = ? WHERE publisher_id = ?`,
          [domain, publisher.publisher_id]
        );
        console.log(`✓ ${publisher.publisher_name} -> ${domain}`);
        updated++;
      } else {
        console.log(`⊘ ${publisher.publisher_name} -> (no domain found)`);
        skipped++;
      }
    }

    console.log(`\nPopulation complete!`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`\nNote: Publishers without domains can still be checked via OpenSanctions (by name)`);
    console.log(`      but won't be checked via GDI (which requires domains).`);

  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    pool.end();
  }
}

populateDomains()
  .then(() => {
    console.log("\nAll done!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
