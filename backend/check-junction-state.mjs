import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'truthtrollers'
});

const tables = ['user_roles', 'role_permissions', 'user_permissions'];

for (const table of tables) {
  console.log(`\n${table}:`);
  const [desc] = await conn.query(`DESCRIBE ${table}`);
  console.table(desc.map(d => ({ Field: d.Field, Type: d.Type, Key: d.Key })));
}

await conn.end();
