import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'truthtrollers'
});

const [users] = await conn.query('SELECT user_id, username, email FROM users LIMIT 10');
console.log('\n👥 Users:');
console.table(users);
await conn.end();
