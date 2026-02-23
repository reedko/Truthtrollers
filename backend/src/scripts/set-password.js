// Admin script: set a user's password by user_id
// Usage: node --env-file=.env src/scripts/set-password.js <user_id> <new_password>
//    or: node src/scripts/set-password.js <user_id> <new_password>   (if .env is loaded)

import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const [, , userId, newPassword] = process.argv;

if (!userId || !newPassword) {
  console.error(
    "Usage: node src/scripts/set-password.js <user_id> <new_password>",
  );
  process.exit(1);
}
console.log(`🔌 Connecting to database: ${process.env.DB_HOST}/${process.env.DB_DATABASE} as ${process.env.DB_USER}`);

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

console.log(`✅ Connected to database successfully`);

// Verify user exists first
const [rows] = await db.execute(
  "SELECT user_id, username, email FROM users WHERE user_id = ?",
  [userId],
);

if (rows.length === 0) {
  console.error(`No user found with user_id = ${userId}`);
  await db.end();
  process.exit(1);
}

const user = rows[0];
const hashed = await bcrypt.hash(newPassword, 10);

await db.execute("UPDATE users SET password = ? WHERE user_id = ?", [
  hashed,
  userId,
]);

console.log(
  `Password updated for user_id=${user.user_id} (${user.username} / ${user.email})`,
);
await db.end();
