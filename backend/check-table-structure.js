import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function checkStructure() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log('\n=== Checking table structures ===\n');

    const tables = ['user_claim_ratings', 'content_claims', 'reference_claim_task_links', 'claim_links'];

    for (const table of tables) {
      try {
        const [desc] = await conn.query(`DESCRIBE ${table}`);
        console.log(`\n${table}:`);
        console.table(desc.map(d => ({ Field: d.Field, Type: d.Type, Key: d.Key })));
      } catch (err) {
        console.log(`\n${table}: Table does not exist`);
      }
    }

  } finally {
    await conn.end();
  }
}

checkStructure();
