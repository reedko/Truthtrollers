// Run this to create canonical_claims and claim_variants tables
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'truthtrollers',
  port: parseInt(process.env.DB_PORT || '3306', 10),
};

async function runMigration() {
  let connection;

  try {
    console.log('📊 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);

    console.log('📄 Reading SQL file...');
    const sqlPath = join(dirname(fileURLToPath(import.meta.url)), 'create_canonical_claims.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        console.log('⚙️  Executing statement...');
        await connection.query(statement);
      }
    }

    console.log('✅ Migration complete! canonical_claims and claim_variants tables created.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
