// migrations/add-globally-removed-column.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function addGloballyRemovedColumn() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "truthtrollers",
  });

  try {
    console.log("Adding globally_removed column to content_relations...");

    // Check if column exists first
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'truthtrollers'
        AND TABLE_NAME = 'content_relations'
        AND COLUMN_NAME = 'globally_removed'
    `);

    if (columns.length === 0) {
      await connection.execute(`
        ALTER TABLE content_relations
        ADD COLUMN globally_removed BOOLEAN DEFAULT FALSE
          COMMENT 'TRUE = admin hard-deleted this reference (hidden from all scopes except admin)'
      `);
      console.log("✅ globally_removed column added");
    } else {
      console.log("ℹ️  globally_removed column already exists");
    }

    // Add index if it doesn't exist
    const [indexes] = await connection.execute(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = 'truthtrollers'
        AND TABLE_NAME = 'content_relations'
        AND INDEX_NAME = 'idx_globally_removed'
    `);

    if (indexes.length === 0) {
      await connection.execute(`
        ALTER TABLE content_relations
        ADD INDEX idx_globally_removed (globally_removed)
      `);
      console.log("✅ Index idx_globally_removed added");
    } else {
      console.log("ℹ️  Index idx_globally_removed already exists");
    }

    console.log("✅ Migration complete!");
  } catch (error) {
    console.error("❌ Error adding globally_removed column:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run migration
addGloballyRemovedColumn()
  .then(() => {
    console.log("✅ Migration successful");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  });

export default addGloballyRemovedColumn;
