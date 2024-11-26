// backend/src/service/dataBase.ts
import * as mysql from "mysql";

import { promisify } from "util";
import * as dotenv from "dotenv";

dotenv.config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

// Augment `db.query` with the correct type
const executeQuery = promisify(db.query).bind(db) as <T>(
  sql: string,
  params?: any[]
) => Promise<T>;

export const query = <T = any>(sql: string, params?: any[]): Promise<T[]> => {
  return executeQuery<T[]>(sql, params);
};

// Optional: Automatically handle connection errors
db.on("error", (err) => {
  console.error("Database error:", err);
  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    console.error("Reconnecting...");
    // Optionally add logic to reconnect
  }
});

export default db;
