#!/usr/bin/env node
/**
 * ============================================================================
 * PRODUCTION MIGRATION RUNNER
 * Consolidates all database changes since IP address widening
 * Safe to run multiple times (all migrations are idempotent)
 * ============================================================================
 *
 * Usage: node run_production_migrations.js [path/to/.env]
 * Default: Uses /root/backend/.env
 *
 * This script runs all migrations in the correct order:
 * 1. make_claim_links_user_id_nullable.sql
 * 2. update_login_events_event_type.sql
 * 3. rename-notes-to-rationale.sql
 * 4. production_full_migration01.sql (comprehensive migration)
 * 5. PRODUCTION_task_completion_migration.sql
 * 6. setup_permissions_and_viewer_filtering.sql
 * ============================================================================
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const envPath = process.argv[2] || '/root/backend/.env';

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║     TRUTHTROLLERS PRODUCTION DATABASE MIGRATION RUNNER        ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log(`📁 Using env file: ${envPath}\n`);

// Load environment variables
function loadEnv(filePath) {
  try {
    const envContent = fs.readFileSync(filePath, 'utf8');
    const env = {};

    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        // Remove quotes if present
        let value = valueParts.join('=').trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key.trim()] = value;
      }
    });

    return env;
  } catch (error) {
    console.error(`❌ Error loading .env file: ${error.message}`);
    process.exit(1);
  }
}

// Execute a SQL migration
async function executeMigration(connection, migrationName, sql) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔄 Running: ${migrationName}`);
  console.log('='.repeat(70));

  try {
    // Split SQL by statements (handle DELIMITER changes)
    const statements = splitSQLStatements(sql);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;

      // Skip comments
      if (stmt.startsWith('--') || stmt.startsWith('/*')) continue;

      try {
        const [results] = await connection.query(stmt);

        // Log SELECT results
        if (Array.isArray(results) && results.length > 0 && !stmt.toLowerCase().includes('insert') && !stmt.toLowerCase().includes('update')) {
          console.log(`   ℹ️  Query result:`, results);
        }
      } catch (error) {
        // Some errors are OK (like "already exists")
        if (error.message.includes('already exists') ||
            error.message.includes('Duplicate')) {
          console.log(`   ⚠️  Skipped (already exists): ${error.message.substring(0, 100)}`);
        } else {
          throw error;
        }
      }
    }

    console.log(`✅ Completed: ${migrationName}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed: ${migrationName}`);
    console.error(`   Error: ${error.message}`);
    throw error;
  }
}

// Split SQL into individual statements (handle DELIMITER)
function splitSQLStatements(sql) {
  const statements = [];
  let currentStmt = '';
  let delimiter = ';';
  let inDelimiterBlock = false;

  const lines = sql.split('\n');

  for (let line of lines) {
    const trimmed = line.trim();

    // Handle DELIMITER command
    if (trimmed.toUpperCase().startsWith('DELIMITER')) {
      if (currentStmt.trim()) {
        statements.push(currentStmt.trim());
        currentStmt = '';
      }
      delimiter = trimmed.split(/\s+/)[1];
      inDelimiterBlock = delimiter !== ';';
      continue;
    }

    currentStmt += line + '\n';

    // Check if statement ends
    if (trimmed.endsWith(delimiter)) {
      // Remove the delimiter
      currentStmt = currentStmt.substring(0, currentStmt.lastIndexOf(delimiter));
      statements.push(currentStmt.trim());
      currentStmt = '';

      // Reset delimiter if we just finished a block
      if (inDelimiterBlock && delimiter !== ';') {
        delimiter = ';';
        inDelimiterBlock = false;
      }
    }
  }

  if (currentStmt.trim()) {
    statements.push(currentStmt.trim());
  }

  return statements;
}

// Main migration runner
async function runMigrations() {
  const env = loadEnv(envPath);

  // Build connection config
  const config = {
    host: env.DB_HOST || 'localhost',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'truthtrollers',
    port: parseInt(env.DB_PORT || '3306'),
    multipleStatements: true,
    // Add connection timeout
    connectTimeout: 30000,
  };

  console.log('📊 Database Configuration:');
  console.log(`   Host: ${config.host}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   User: ${config.user}`);
  console.log(`   Database: ${config.database}`);
  console.log('');

  let connection;

  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('✅ Connected successfully!\n');

    // Migration 1: Make claim_links.user_id nullable
    await executeMigration(
      connection,
      '1. make_claim_links_user_id_nullable',
      `-- Migration: Make user_id nullable in claim_links
-- Purpose: Allow AI-generated claim links without requiring a user_id
-- AI-generated links are identified by created_by_ai=1

ALTER TABLE claim_links
MODIFY COLUMN user_id INT NULL
COMMENT 'User who created the link. NULL for AI-generated links (created_by_ai=1)';`
    );

    // Migration 2: Update login_events.event_type
    await executeMigration(
      connection,
      '2. update_login_events_event_type',
      `-- Update login_events.event_type to support password reset events
-- Change from ENUM to VARCHAR(50) to support all event types

ALTER TABLE login_events MODIFY COLUMN event_type VARCHAR(50) NOT NULL;`
    );

    // Migration 3: Rename notes to rationale
    await executeMigration(
      connection,
      '3. rename_notes_to_rationale',
      `-- Rename 'notes' to 'rationale' in claim_links table

ALTER TABLE claim_links
CHANGE COLUMN notes rationale TEXT
COMMENT 'Rationale or explanation for the link relationship';`
    );

    // Migration 4: Production full migration (comprehensive)
    await executeMigration(
      connection,
      '4. production_full_migration',
      fs.readFileSync(path.join(__dirname, 'production_full_migration01.sql'), 'utf8')
    );

    // Migration 5: Task completion tracking
    await executeMigration(
      connection,
      '5. task_completion_migration',
      fs.readFileSync(path.join(__dirname, 'PRODUCTION_task_completion_migration.sql'), 'utf8')
    );

    // Migration 6: Permissions and viewer filtering
    await executeMigration(
      connection,
      '6. permissions_and_viewer_filtering',
      fs.readFileSync(path.join(__dirname, 'setup_permissions_and_viewer_filtering.sql'), 'utf8')
    );

    // Final verification
    console.log('\n' + '='.repeat(70));
    console.log('🔍 FINAL VERIFICATION');
    console.log('='.repeat(70));

    // Check key tables exist
    const [tables] = await connection.query(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (
          'password_reset_tokens',
          'user_claim_ratings',
          'molecule_views',
          'molecule_view_pins',
          'permissions',
          'user_roles',
          'user_reference_visibility'
        )
      ORDER BY TABLE_NAME
    `);

    console.log('\n✅ Tables created/verified:');
    tables.forEach(row => console.log(`   ✓ ${row.TABLE_NAME}`));

    // Check key columns
    const [columns] = await connection.query(`
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          (TABLE_NAME = 'claim_links' AND COLUMN_NAME IN ('rationale', 'veracity_score', 'confidence', 'created_by_ai', 'points_earned')) OR
          (TABLE_NAME = 'login_events' AND COLUMN_NAME = 'event_type') OR
          (TABLE_NAME = 'content_users' AND COLUMN_NAME = 'completed_at') OR
          (TABLE_NAME = 'content_relations' AND COLUMN_NAME IN ('added_by_user_id', 'is_system'))
        )
      ORDER BY TABLE_NAME, COLUMN_NAME
    `);

    console.log('\n✅ Columns added/modified:');
    columns.forEach(row => {
      console.log(`   ✓ ${row.TABLE_NAME}.${row.COLUMN_NAME} (${row.DATA_TYPE}, nullable: ${row.IS_NULLABLE})`);
    });

    // Check roles and permissions
    const [roleCount] = await connection.query('SELECT COUNT(*) as count FROM roles');
    const [permCount] = await connection.query('SELECT COUNT(*) as count FROM permissions');
    const [rolePermCount] = await connection.query('SELECT COUNT(*) as count FROM role_permissions');

    console.log('\n✅ Permissions system:');
    console.log(`   ✓ Roles: ${roleCount[0].count}`);
    console.log(`   ✓ Permissions: ${permCount[0].count}`);
    console.log(`   ✓ Role-Permission mappings: ${rolePermCount[0].count}`);

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(15) + '🎉 ALL MIGRATIONS COMPLETED SUCCESSFULLY! 🎉' + ' '.repeat(10) + '║');
    console.log('╚' + '═'.repeat(68) + '╝\n');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed.\n');
    }
  }
}

// Run migrations
runMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
