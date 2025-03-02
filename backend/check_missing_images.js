import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Get the current directory of the script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure database connection
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "your_database",
  multipleStatements: true,
};

// Set the path to the folder where images are stored
const IMAGE_DIR = path.join(__dirname, "../backend/assets/images/content");

// Function to check for missing images
async function checkMissingImages() {
  let connection;

  try {
    console.log("📡 Connecting to database...");

    // Await the connection
    connection = await mysql.createConnection(dbConfig);

    // Query for all content thumbnails
    const [rows] = await connection.execute(
      "SELECT content_id, thumbnail FROM content WHERE thumbnail IS NOT NULL"
    );

    console.log(`🔍 Checking ${rows.length} images...`);

    let missingCount = 0;

    // Check if each image exists
    for (const { id, thumbnail } of rows) {
      const imagePath = path.join(IMAGE_DIR, path.basename(thumbnail));

      try {
        await fs.access(imagePath);
      } catch {
        console.log(`${thumbnail}`);
        missingCount++;
      }
    }

    console.log(`✅ Check complete. ${missingCount} missing images found.`);
  } catch (error) {
    console.error("❌ Error checking missing images:", error);
  } finally {
    if (connection) await connection.end();
  }
}

// Run the function
checkMissingImages();
