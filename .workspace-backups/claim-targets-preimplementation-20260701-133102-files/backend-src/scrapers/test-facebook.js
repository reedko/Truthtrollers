// Test script for Facebook scraper
// Usage: node src/scrapers/test-facebook.js <facebook-post-url>

import { scrapeFacebookPost } from "./facebookScraper.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testScraper() {
  // Get URL from command line argument
  const postUrl = process.argv[2];

  if (!postUrl) {
    console.error("❌ Please provide a Facebook post URL");
    console.log("Usage: node src/scrapers/test-facebook.js <facebook-post-url>");
    console.log("Example: node src/scrapers/test-facebook.js https://www.facebook.com/username/posts/123456789");
    process.exit(1);
  }

  console.log(`🔵 Testing Facebook scraper with URL: ${postUrl}`);
  console.log("");

  const cookiesPath = path.join(__dirname, "../../config/facebook-cookies.json");

  try {
    const result = await scrapeFacebookPost(postUrl, {
      cookiesPath,
      screenshot: true, // Enable screenshots for debugging
    });

    if (result.success) {
      console.log("✅ Scraping successful!");
      console.log("");
      console.log("Post Data:");
      console.log("─".repeat(50));
      console.log(`Text: ${result.postText || "(no text)"}`);
      console.log(`Author: ${result.authorName || "(unknown)"}`);
      console.log(`Timestamp: ${result.timestamp || "(unknown)"}`);
      console.log(`Images: ${result.images?.length || 0}`);
      console.log(`Reactions: ${result.reactionsCount || 0}`);
      console.log(`Comments: ${result.commentsCount || 0}`);
      console.log(`Shares: ${result.sharesCount || 0}`);
      console.log("─".repeat(50));

      if (result.images && result.images.length > 0) {
        console.log("");
        console.log("Image URLs:");
        result.images.forEach((img, i) => {
          console.log(`  ${i + 1}. ${img}`);
        });
      }
    } else {
      console.error("❌ Scraping failed:");
      console.error(result.error);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

testScraper();
