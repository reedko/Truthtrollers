// /backend/src/db/pool.js
// ────────────────────────────────────────────────────────────
// Database connection setup matching temp/server.js
// Uses `mysql` package (works with your MySQL auth setup)
// ────────────────────────────────────────────────────────────
import mysql from "mysql";
import { promisify } from "util";

// ────────────────────────────────────────────────────────────
// Connection (for single queries)
// ────────────────────────────────────────────────────────────
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

// ────────────────────────────────────────────────────────────
// Promisified query function (EXACTLY like original server.js)
// Returns rows directly (NOT [rows, fields])
// Connection happens lazily on first query - no explicit connect()
// ────────────────────────────────────────────────────────────
export const query = promisify(db.query).bind(db);

// ────────────────────────────────────────────────────────────
// Connection Pool (for callbacks & concurrent queries)
// ────────────────────────────────────────────────────────────
export const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});
