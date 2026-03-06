// Scan for tables without single-column primary keys
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function scanTables() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers'
  });

  try {
    console.log('\n🔍 Scanning for tables without single-column primary keys...\n');

    // Get all tables
    const [tables] = await conn.query(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    const tablesNeedingPK = [];
    const tablesWithCompositePK = [];
    const tablesOK = [];

    for (const { TABLE_NAME } of tables) {
      // Get primary key columns
      const [pkCols] = await conn.query(`
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION
      `, [TABLE_NAME]);

      if (pkCols.length === 0) {
        // No primary key at all
        tablesNeedingPK.push({ table: TABLE_NAME, reason: 'No primary key' });
      } else if (pkCols.length > 1) {
        // Composite primary key
        const cols = pkCols.map(c => c.COLUMN_NAME).join(', ');
        tablesWithCompositePK.push({ table: TABLE_NAME, columns: cols });
      } else {
        // Single column PK - check if it follows naming convention
        const pkCol = pkCols[0].COLUMN_NAME;
        const expectedName = `${TABLE_NAME}_id`;

        if (pkCol === expectedName) {
          tablesOK.push({ table: TABLE_NAME, pk: pkCol });
        } else {
          tablesWithCompositePK.push({
            table: TABLE_NAME,
            columns: pkCol,
            note: `Expected ${expectedName}, found ${pkCol}`
          });
        }
      }
    }

    console.log('✅ Tables with proper single-column PKs:', tablesOK.length);
    tablesOK.forEach(t => console.log(`   ${t.table} (${t.pk})`));

    console.log('\n⚠️  Tables with composite PKs:', tablesWithCompositePK.length);
    tablesWithCompositePK.forEach(t => {
      console.log(`   ${t.table} - PK: (${t.columns})`);
      if (t.note) console.log(`     ${t.note}`);
    });

    console.log('\n❌ Tables with NO primary key:', tablesNeedingPK.length);
    tablesNeedingPK.forEach(t => console.log(`   ${t.table} - ${t.reason}`));

    // Generate SQL migration
    if (tablesWithCompositePK.length > 0 || tablesNeedingPK.length > 0) {
      console.log('\n📝 Generating migration SQL...\n');
      await generateMigrationSQL(conn, [...tablesWithCompositePK, ...tablesNeedingPK]);
    }

  } finally {
    await conn.end();
  }
}

async function generateMigrationSQL(conn, tables) {
  let sql = `-- ============================================================================
-- Add single-column primary keys to tables
-- Generated: ${new Date().toISOString()}
-- ============================================================================

`;

  for (const tableInfo of tables) {
    const tableName = tableInfo.table;
    const newPKName = `${tableName}_id`;

    sql += `\n-- ────────────────────────────────────────────────────────────────────────────\n`;
    sql += `-- ${tableName}\n`;
    sql += `-- ────────────────────────────────────────────────────────────────────────────\n\n`;

    // Check if table already has a column with the expected name
    const [existingCol] = await conn.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `, [tableName, newPKName]);

    if (existingCol.length > 0) {
      sql += `-- Column ${newPKName} already exists\n`;
      sql += `-- If it's not the PK, you may need to manually fix this table\n\n`;
      continue;
    }

    // Get foreign keys referencing this table (we may need to drop/recreate them)
    const [fks] = await conn.query(`
      SELECT
        CONSTRAINT_NAME,
        TABLE_NAME AS referencing_table,
        COLUMN_NAME AS referencing_column,
        REFERENCED_COLUMN_NAME AS referenced_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = ?
        AND REFERENCED_COLUMN_NAME != ?
    `, [tableName, newPKName]);

    // Get current PK info
    const [currentPK] = await conn.query(`
      SELECT COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `, [tableName]);

    sql += `-- Step 1: Add new auto-increment primary key column\n`;
    sql += `ALTER TABLE ${tableName}\n`;
    sql += `  ADD COLUMN ${newPKName} INT AUTO_INCREMENT UNIQUE FIRST;\n\n`;

    if (currentPK.length > 0) {
      sql += `-- Step 2: Drop old composite primary key\n`;
      sql += `ALTER TABLE ${tableName}\n`;
      sql += `  DROP PRIMARY KEY;\n\n`;
    }

    sql += `-- Step 3: Set new column as primary key\n`;
    sql += `ALTER TABLE ${tableName}\n`;
    sql += `  ADD PRIMARY KEY (${newPKName});\n\n`;

    // Keep old columns as unique key if they were a composite PK
    if (currentPK.length > 1) {
      const oldCols = currentPK.map(c => c.COLUMN_NAME).join(', ');
      sql += `-- Step 4: Add unique constraint on old PK columns to maintain uniqueness\n`;
      sql += `ALTER TABLE ${tableName}\n`;
      sql += `  ADD UNIQUE KEY idx_${tableName}_unique (${oldCols});\n\n`;
    }

    sql += `SELECT 'Completed: ${tableName}' AS status;\n\n`;
  }

  sql += `\n-- ============================================================================\n`;
  sql += `-- DONE\n`;
  sql += `-- ============================================================================\n`;

  const filename = 'migrations/add-missing-primary-keys.sql';
  fs.writeFileSync(filename, sql);
  console.log(`✅ Migration SQL written to: ${filename}\n`);
  console.log('To apply, run:');
  console.log(`  node migrations/run-single-migration.js add-missing-primary-keys.sql\n`);
}

scanTables();
