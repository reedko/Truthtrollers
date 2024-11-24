const mysql = require("mysql");
const util = require("util");
const fetchIconForTopic = require("../src/services/fetchIconForTopic.js"); // Assuming you have this service implemented
const fs = require("fs");
const sharp = require("sharp");
const path = require("path");
require("dotenv").config();

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});
const query = util.promisify(db.query).bind(db);

async function fetchMissingThumbnails() {
  try {
    // Step 1: Find topics with no thumbnail
    const topicsWithoutThumbnails = await query(
      "SELECT topic_id, topic_name FROM topics WHERE thumbnail IS NULL"
    );

    console.log(
      `Found ${topicsWithoutThumbnails.length} topics missing thumbnails.`
    );

    for (const topic of topicsWithoutThumbnails) {
      const { topic_id, topic_name } = topic;
      console.log(`Fetching icon for topic: ${topic_name}`);

      // Step 2: Fetch icon for the topic
      const iconUrl = await fetchIconForTopic(topic_name);

      if (iconUrl) {
        console.log(`Icon found for ${topic_name}: ${iconUrl}`);

        // Step 3: Save the icon locally
        const iconFilename = `${topic_name
          .replace(/ /g, "_")
          .toLowerCase()}.png`;
        const iconPath = path.join(
          __dirname,
          "..",
          "public",
          "assets",
          "images",
          "topics",
          iconFilename
        );

        const response = await fetch(iconUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Convert to PNG and save
        await sharp(buffer).png().toFile(iconPath);

        // Step 4: Update the database with the local URL
        const localUrl = `assets/images/topics/${iconFilename}`;
        await query("UPDATE topics SET thumbnail = ? WHERE topic_id = ?", [
          localUrl,
          topic_id,
        ]);

        console.log(`Thumbnail saved for ${topic_name} at ${localUrl}`);
      } else {
        console.log(`No icon found for ${topic_name}`);
      }
    }

    console.log("All missing thumbnails processed.");
  } catch (err) {
    console.error("Error fetching missing thumbnails:", err);
  } finally {
    db.end();
  }
}

fetchMissingThumbnails();
