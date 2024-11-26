import mysql from "mysql";
import { promisify } from "util";
import dotenv from "dotenv";

dotenv.config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err.message);
    process.exit(1);
  } else {
    console.log("Connected to the database");
  }
});

// Promisify the query function for async/await support
const query = promisify(db.query).bind(db);

export default {
  query,
  closeConnection: () => db.end(),
};
