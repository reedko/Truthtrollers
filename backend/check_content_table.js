import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql";
import { promisify } from "util";

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const query = promisify(db.query).bind(db);

async function run() {
  try {
    console.log("Checking content table schema...");
    const schema = await query("DESCRIBE content");
    console.table(schema);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    db.end();
  }
}

run();
