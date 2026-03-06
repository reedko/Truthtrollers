// /backend/src/db/pool.js
// ────────────────────────────────────────────────────────────
// Database connection setup using connection pool
// Uses `mysql` package with proper connection pooling
// ────────────────────────────────────────────────────────────
import mysql from "mysql";
import { promisify } from "util";

// ────────────────────────────────────────────────────────────
// Connection Pool (for all queries - handles reconnects automatically)
// ────────────────────────────────────────────────────────────
export const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
  // Add reconnect logic
  acquireTimeout: 10000,
  waitForConnections: true,
  queueLimit: 0,
});

// ────────────────────────────────────────────────────────────
// Promisified query function using pool (handles errors better)
// Returns rows directly (NOT [rows, fields])
// Pool automatically handles connection errors and reconnects
// ────────────────────────────────────────────────────────────
const poolQuery = promisify(pool.query).bind(pool);

export const query = async (...args) => {
  try {
    return await poolQuery(...args);
  } catch (error) {
    console.error('❌ [Database] Query failed:', error.message);
    // If connection error, the pool will automatically try to reconnect on next query
    throw error;
  }
};

// ────────────────────────────────────────────────────────────
// Legacy single connection (DEPRECATED - use pool instead)
// Kept for backwards compatibility but should not be used
// ────────────────────────────────────────────────────────────
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});
