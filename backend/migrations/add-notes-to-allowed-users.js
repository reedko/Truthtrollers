// Migration: Add notes column to allowed_users table
// This allows storing name and reason for whitelist requests

import mysql from "mysql2/promise";

const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "d1Mm0v3g!",
  database: "truthtrollers",
};

async function addNotesToAllowedUsers() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log("✅ Connected to database");

    // Check if notes column already exists
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'truthtrollers'
        AND TABLE_NAME = 'allowed_users'
        AND COLUMN_NAME = 'notes'
    `);

    if (columns.length > 0) {
      console.log("⚠️  notes column already exists in allowed_users table");
      return;
    }

    // Add notes column
    await connection.execute(`
      ALTER TABLE allowed_users
      ADD COLUMN notes TEXT NULL
      AFTER updated_at
    `);

    console.log("✅ Successfully added notes column to allowed_users table");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log("🔌 Database connection closed");
    }
  }
}

// Run migration
addNotesToAllowedUsers()
  .then(() => {
    console.log("🎉 Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Migration failed:", error);
    process.exit(1);
  });
