// backend/migrations/add-allowed-users-table.js
// Creates allowed_users table for beta access control

import mysql from "mysql2/promise";

const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "d1Mm0v3g!",
  database: "truthtrollers",
  multipleStatements: true,
};

async function migrate() {
  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    console.log("🔵 Creating allowed_users table...");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS allowed_users (
        allowed_users_id INT AUTO_INCREMENT PRIMARY KEY,
        email_address VARCHAR(255) NOT NULL UNIQUE,
        allowed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email_address),
        INDEX idx_allowed (allowed)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ allowed_users table created successfully");

    // Add some example beta testers (you can modify these)
    console.log("🔵 Adding example beta testers...");

    await connection.query(`
      INSERT IGNORE INTO allowed_users (email_address, allowed) VALUES
      ('beta@truthtrollers.com', TRUE),
      ('admin@truthtrollers.com', TRUE)
      ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);
    `);

    console.log("✅ Example beta testers added");
    console.log("✅ Migration complete!");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default migrate;
