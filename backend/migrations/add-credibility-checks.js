// /backend/migrations/add-credibility-checks.js
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

async function runMigration() {
  console.log("Starting credibility checks migration...");

  try {
    // Add domain column to publishers table if it doesn't exist
    console.log("Adding domain column to publishers table...");
    try {
      await query(`
        ALTER TABLE publishers
        ADD COLUMN domain VARCHAR(255) DEFAULT NULL;
      `);
      console.log("✓ Domain column added successfully");
    } catch (err) {
      if (err.message.includes('Duplicate column') || err.message.includes('duplicate column')) {
        console.log("✓ Domain column already exists, skipping...");
      } else {
        throw err;
      }
    }

    // Add index on domain column
    try {
      await query(`
        ALTER TABLE publishers
        ADD INDEX idx_domain (domain);
      `);
      console.log("✓ Domain index added successfully");
    } catch (err) {
      if (err.message.includes('Duplicate key') || err.message.includes('duplicate')) {
        console.log("✓ Domain index already exists, skipping...");
      } else {
        throw err;
      }
    }

    // Create author_credibility_checks table
    console.log("Creating author_credibility_checks table...");
    await query(`
      CREATE TABLE IF NOT EXISTS author_credibility_checks (
        check_id INT AUTO_INCREMENT PRIMARY KEY,
        author_id INT NOT NULL,
        source VARCHAR(50) NOT NULL,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        risk_level ENUM('none', 'low', 'medium', 'high', 'critical', 'unknown') DEFAULT 'unknown',
        has_matches BOOLEAN DEFAULT FALSE,
        match_count INT DEFAULT 0,
        highest_score DECIMAL(5,4) DEFAULT NULL,
        risk_reasons JSON DEFAULT NULL,
        matches JSON DEFAULT NULL,
        raw_response JSON DEFAULT NULL,
        error VARCHAR(500) DEFAULT NULL,
        INDEX idx_author_id (author_id),
        INDEX idx_source (source),
        INDEX idx_checked_at (checked_at),
        INDEX idx_risk_level (risk_level),
        FOREIGN KEY (author_id) REFERENCES authors(author_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create publisher_credibility_checks table
    console.log("Creating publisher_credibility_checks table...");
    await query(`
      CREATE TABLE IF NOT EXISTS publisher_credibility_checks (
        check_id INT AUTO_INCREMENT PRIMARY KEY,
        publisher_id INT NOT NULL,
        source VARCHAR(50) NOT NULL,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        risk_level ENUM('none', 'low', 'medium', 'high', 'critical', 'unknown') DEFAULT 'unknown',
        score DECIMAL(5,2) DEFAULT NULL,
        has_matches BOOLEAN DEFAULT FALSE,
        match_count INT DEFAULT 0,
        highest_score DECIMAL(5,4) DEFAULT NULL,
        categories JSON DEFAULT NULL,
        flags JSON DEFAULT NULL,
        risk_reasons JSON DEFAULT NULL,
        matches JSON DEFAULT NULL,
        raw_response JSON DEFAULT NULL,
        error VARCHAR(500) DEFAULT NULL,
        INDEX idx_publisher_id (publisher_id),
        INDEX idx_source (source),
        INDEX idx_checked_at (checked_at),
        INDEX idx_risk_level (risk_level),
        FOREIGN KEY (publisher_id) REFERENCES publishers(publisher_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create content_credibility_checks table
    console.log("Creating content_credibility_checks table...");
    await query(`
      CREATE TABLE IF NOT EXISTS content_credibility_checks (
        check_id INT AUTO_INCREMENT PRIMARY KEY,
        content_id INT NOT NULL,
        source VARCHAR(50) NOT NULL,
        url TEXT DEFAULT NULL,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        risk_level ENUM('none', 'low', 'medium', 'high', 'critical', 'unknown') DEFAULT 'unknown',
        score DECIMAL(5,2) DEFAULT NULL,
        categories JSON DEFAULT NULL,
        flags JSON DEFAULT NULL,
        risk_reasons JSON DEFAULT NULL,
        raw_response JSON DEFAULT NULL,
        error VARCHAR(500) DEFAULT NULL,
        INDEX idx_content_id (content_id),
        INDEX idx_source (source),
        INDEX idx_checked_at (checked_at),
        INDEX idx_risk_level (risk_level),
        FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create credibility_check_summary view for easy access to latest checks
    console.log("Creating credibility check summary views...");
    await query(`
      CREATE OR REPLACE VIEW author_credibility_summary AS
      SELECT
        a.author_id,
        CONCAT(IFNULL(a.author_first_name, ''), ' ', IFNULL(a.author_last_name, '')) as author_name,
        MAX(CASE WHEN acc.source = 'opensanctions' THEN acc.risk_level END) as opensanctions_risk,
        MAX(CASE WHEN acc.source = 'opensanctions' THEN acc.has_matches END) as opensanctions_matches,
        MAX(CASE WHEN acc.source = 'opensanctions' THEN acc.checked_at END) as opensanctions_checked_at,
        GREATEST(
          COALESCE(MAX(CASE WHEN acc.source = 'opensanctions' AND acc.risk_level = 'critical' THEN 4 END), 0),
          COALESCE(MAX(CASE WHEN acc.source = 'opensanctions' AND acc.risk_level = 'high' THEN 3 END), 0),
          COALESCE(MAX(CASE WHEN acc.source = 'opensanctions' AND acc.risk_level = 'medium' THEN 2 END), 0),
          COALESCE(MAX(CASE WHEN acc.source = 'opensanctions' AND acc.risk_level = 'low' THEN 1 END), 0)
        ) as overall_risk_score
      FROM authors a
      LEFT JOIN author_credibility_checks acc ON a.author_id = acc.author_id
      GROUP BY a.author_id, a.author_first_name, a.author_last_name;
    `);

    await query(`
      CREATE OR REPLACE VIEW publisher_credibility_summary AS
      SELECT
        p.publisher_id,
        p.publisher_name,
        p.domain,
        MAX(CASE WHEN pcc.source = 'gdi' THEN pcc.risk_level END) as gdi_risk,
        MAX(CASE WHEN pcc.source = 'gdi' THEN pcc.score END) as gdi_score,
        MAX(CASE WHEN pcc.source = 'gdi' THEN pcc.checked_at END) as gdi_checked_at,
        MAX(CASE WHEN pcc.source = 'opensanctions' THEN pcc.risk_level END) as opensanctions_risk,
        MAX(CASE WHEN pcc.source = 'opensanctions' THEN pcc.has_matches END) as opensanctions_matches,
        MAX(CASE WHEN pcc.source = 'opensanctions' THEN pcc.checked_at END) as opensanctions_checked_at,
        GREATEST(
          COALESCE(MAX(CASE WHEN pcc.risk_level = 'critical' THEN 4 END), 0),
          COALESCE(MAX(CASE WHEN pcc.risk_level = 'high' THEN 3 END), 0),
          COALESCE(MAX(CASE WHEN pcc.risk_level = 'medium' THEN 2 END), 0),
          COALESCE(MAX(CASE WHEN pcc.risk_level = 'low' THEN 1 END), 0)
        ) as overall_risk_score
      FROM publishers p
      LEFT JOIN publisher_credibility_checks pcc ON p.publisher_id = pcc.publisher_id
      GROUP BY p.publisher_id, p.publisher_name, p.domain;
    `);

    await query(`
      CREATE OR REPLACE VIEW content_credibility_summary AS
      SELECT
        c.content_id,
        c.content_name,
        c.url,
        MAX(CASE WHEN ccc.source = 'gdi' THEN ccc.risk_level END) as gdi_risk,
        MAX(CASE WHEN ccc.source = 'gdi' THEN ccc.score END) as gdi_score,
        MAX(CASE WHEN ccc.source = 'gdi' THEN ccc.checked_at END) as gdi_checked_at,
        GREATEST(
          COALESCE(MAX(CASE WHEN ccc.risk_level = 'critical' THEN 4 END), 0),
          COALESCE(MAX(CASE WHEN ccc.risk_level = 'high' THEN 3 END), 0),
          COALESCE(MAX(CASE WHEN ccc.risk_level = 'medium' THEN 2 END), 0),
          COALESCE(MAX(CASE WHEN ccc.risk_level = 'low' THEN 1 END), 0)
        ) as overall_risk_score
      FROM content c
      LEFT JOIN content_credibility_checks ccc ON c.content_id = ccc.content_id
      GROUP BY c.content_id, c.content_name, c.url;
    `);

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    pool.end();
  }
}

runMigration()
  .then(() => {
    console.log("All done!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
