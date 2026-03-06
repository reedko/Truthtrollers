import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function testIPLength() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'truthtrollers'
  });

  try {
    // Check current column definition
    console.log('📊 Checking current ip_address column definition:\n');

    const [columns] = await connection.execute(`
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME = 'ip_address'
        AND TABLE_NAME IN ('login_attempts', 'registration_attempts', 'user_sessions')
      ORDER BY TABLE_NAME
    `);

    console.table(columns);

    // Test inserting different IP lengths
    console.log('\n🧪 Testing IP address insertions:\n');

    const testCases = [
      { length: 45, ip: 'x'.repeat(45), label: '45 chars (old limit)' },
      { length: 50, ip: 'x'.repeat(50), label: '50 chars' },
      { length: 100, ip: 'x'.repeat(100), label: '100 chars (new limit)' },
      { length: 150, ip: 'x'.repeat(150), label: '150 chars (over limit)' },
    ];

    for (const test of testCases) {
      try {
        await connection.execute(
          `INSERT INTO login_attempts (username, success, ip_address, reason) VALUES (?, FALSE, ?, ?)`,
          ['test_user', test.ip, 'test']
        );
        console.log(`✅ ${test.label}: SUCCESS`);

        // Clean up
        await connection.execute(
          `DELETE FROM login_attempts WHERE username = 'test_user' AND reason = 'test'`
        );
      } catch (error) {
        console.log(`❌ ${test.label}: FAILED`);
        console.log(`   Error: ${error.code} - ${error.message}`);
      }
    }

    console.log('\n✅ Test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await connection.end();
  }
}

testIPLength();
