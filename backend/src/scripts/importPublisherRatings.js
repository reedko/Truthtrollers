// backend/importPublisherRatings.js
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
};

const CSV_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "data",
  "publisher_ratings_mockup_extended 2.csv" // make sure this matches your file
);

async function importRatings() {
  const connection = await mysql.createConnection(DB_CONFIG);
  const results = [];

  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on("data", (row) => {
      results.push(row);
    })
    .on("end", async () => {
      for (const row of results) {
        const {
          publisher_name,
          source,
          bias_score,
          veracity_score,
          topic_id,
          rating_url,
          notes,
        } = row;

        try {
          const [publisherRows] = await connection.execute(
            "SELECT publisher_id FROM publishers WHERE publisher_name = ?",
            [publisher_name]
          );

          if (publisherRows.length === 0) {
            console.warn(`❌ No match found for publisher: ${publisher_name}`);
            continue;
          }

          const publisher_id = publisherRows[0].publisher_id;

          await connection.execute(
            `INSERT INTO publisher_ratings
             (publisher_id, source, bias_score, veracity_score, topic_id, url, notes, last_checked)
             VALUES (?, ?, ?, ?, ?, ?, ?,NOW())`,
            [
              publisher_id,
              source,
              bias_score || null,
              veracity_score || null,
              topic_id || null,
              rating_url || null,
              notes || null,
            ]
          );

          console.log(
            `✅ Inserted ${source} rating for ${publisher_name} (topic_id: ${topic_id})`
          );
        } catch (err) {
          console.error(
            `❌ Error inserting rating for ${publisher_name}:`,
            err.message
          );
        }
      }

      await connection.end();
      console.log("🎉 All publisher ratings imported successfully.");
    });
}

importRatings();
