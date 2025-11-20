import mysql from "mysql2/promise";
import axios from "axios";
import sharp from "sharp";
import puppeteer from "puppeteer";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure database connection
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "your_database",
};

// Set the directory for storing images
const IMAGE_DIR = path.join("assets/images/content");

// **Core function to extract the largest image, mimicking background.js**
async function fetchLargestImage(url) {
  let browser;
  try {
    console.log(`🌐 Launching Puppeteer for: ${url}`);
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Execute the same image selection logic from background.js
    const imageUrl = await page.evaluate((url) => {
      let maxArea = 0;
      let chosenImage = null;

      if (!url) return null;

      // YouTube-specific thumbnail extraction
      if (url.includes("youtube.com") && url.includes("/watch")) {
        const urlObj = new URL(url);
        const videoId = urlObj.searchParams.get("v");
        if (videoId)
          return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }

      // Function to parse `srcset` values
      const parseSrcset = (srcset) => {
        if (!srcset) return null;
        const validExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;

        return srcset
          .split(",")
          .map((entry) => entry.trim().split(" ")[0])
          .find((src) => validExtensions.test(src));
      };

      // Scan all images on the page
      document.querySelectorAll("img").forEach((img) => {
        const area = img.offsetHeight * img.offsetWidth;
        let candidateSrc = img.src || parseSrcset(img.srcset);

        if (candidateSrc && area > maxArea) {
          maxArea = area;
          chosenImage = candidateSrc.startsWith("http")
            ? candidateSrc
            : new URL(candidateSrc, url).href;
        }
      });

      return chosenImage;
    }, url);

    return imageUrl || null;
  } catch (error) {
    console.error(`❌ Error fetching images from ${url}:`, error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// **Process missing thumbnails**
async function processMissingThumbnails() {
  let connection;

  try {
    console.log("📡 Connecting to database...");
    connection = await mysql.createConnection(dbConfig);

    // Fetch all content where `thumbnail IS NULL`
    const [rows] = await connection.execute(
      "SELECT content_id, url FROM content WHERE thumbnail IS NULL and content_id>6291"
    );

    console.log(`🔍 Found ${rows.length} missing thumbnails...`);

    for (const { content_id, url } of rows) {
      console.log(`🔄 Processing content_id ${content_id}: ${url}`);

      // Step 1: Fetch the largest image from the URL
      const imageUrl = await fetchLargestImage(url);
      if (!imageUrl) {
        console.warn(`⚠️ No valid image found for ${url}`);
        continue;
      }

      // Step 2: Download the image
      const imageFilename = `content_id_${content_id}.png`;
      const imagePath = path.join(IMAGE_DIR, imageFilename);

      try {
        const response = await axios.get(imageUrl, {
          responseType: "arraybuffer",
        });

        const buffer = Buffer.from(response.data, "binary");

        // Step 3: Resize and save the image
        await sharp(buffer).resize({ width: 300 }).toFile(imagePath);
        console.log(`✅ Saved image: ${imagePath}`);

        // Step 4: Update the database with the new thumbnail path
        const relativeImagePath = `assets/images/content/${imageFilename}`;
        await connection.execute(
          "UPDATE content SET thumbnail = ? WHERE content_id = ?",
          [relativeImagePath, content_id]
        );

        console.log(`📌 Updated database for content_id ${content_id}`);
      } catch (imageError) {
        console.error(`❌ Error processing image for ${url}:`, imageError);
      }
    }

    console.log("🎉 Done processing all missing thumbnails!");
  } catch (error) {
    console.error("❌ Database error:", error);
  } finally {
    if (connection) await connection.end();
  }
}

// Run the script
processMissingThumbnails();
