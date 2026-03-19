// Test Fox News author extraction
import * as cheerio from "cheerio";
import { extractAuthors } from "./src/utils/extractAuthors.js";

const sampleHtml = `
<header organizationurl="https://www.foxnews.com" class="article-header">
  <div class="article-meta article-meta-upper">
    <span class="eyebrow"><a href="https://www.foxnews.com/health">Health</a></span>
    <h1 class="headline speakable">Ancient herb known as 'nature's Valium' touted for improving sleep and anxiety</h1>
    <h2 class="sub-headline speakable">Valerian shows some benefits in trials, but doctors disagree on comparisons to prescription drug</h2>
  </div>
  <div class="author-byline">
    <span class="author-headshot">
      <img src="https://a57.foxnews.com/static.foxnews.com/foxnews.com/content/uploads/2024/12/340/340/angelica-stabile_12-scaled.jpg?ve=1&amp;tl=1" alt="Angelica Stabile">
    </span>
    <span>
      By
      <span><a href="//www.foxnews.com/person/s/angelica-stabile">Angelica Stabile</a></span>
    </span>
    <span class="article-source"><a href="https://www.foxnews.com/" target="_blank">Fox News</a></span>
  </div>
  <div>
    <span class="article-date">
      Published
      <a href="https://www.foxnews.com/html-sitemap/2026/march/8"><time datetime="2026-03-08T09:00:39-04:00">March 8, 2026 9:00am EDT</time></a>
    </span>
  </div>
</header>
`;

(async () => {
  try {
    const $ = cheerio.load(sampleHtml);
    const authors = await extractAuthors($);

    console.log("\n📋 Fox News Author Extraction Test");
    console.log("=" .repeat(60));

    if (authors.length === 0) {
      console.log("❌ FAILED: No authors found!");
    } else {
      console.log(`✅ SUCCESS: Found ${authors.length} author(s):`);
      authors.forEach((author, i) => {
        console.log(`\n${i + 1}. ${author.name}`);
        if (author.image) {
          console.log(`   📸 Image: ${author.image}`);
        } else {
          console.log(`   ⚠️  No image found`);
        }
        if (author.description) {
          console.log(`   📝 Description: ${author.description}`);
        }
      });
    }

    console.log("\n" + "=".repeat(60));

    // Expected result
    console.log("\n📌 Expected Result:");
    console.log("   Name: Angelica Stabile");
    console.log("   Image: https://a57.foxnews.com/static.foxnews.com/foxnews.com/content/uploads/2024/12/340/340/angelica-stabile_12-scaled.jpg?ve=1&tl=1");

    // Verify
    const hasCorrectName = authors.some(a => a.name === "Angelica Stabile");
    const hasCorrectImage = authors.some(a => a.image && a.image.includes("angelica-stabile"));

    console.log("\n✅ Verification:");
    console.log(`   Name match: ${hasCorrectName ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`   Image match: ${hasCorrectImage ? "✅ PASS" : "❌ FAIL"}`);

    process.exit(hasCorrectName && hasCorrectImage ? 0 : 1);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
