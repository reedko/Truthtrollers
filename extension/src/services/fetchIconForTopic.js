const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;

// ✅ Define base URL for serving icons
const BASE_URL = process.env.BASE_URL || "https://localhost:5001";
const ICONS_URL = `${BASE_URL}/assets/images/topics`; // ✅ Public URL for icons
const ICONS_PATH = path.join(path.resolve(), "/assets/images/topics"); // ✅ Server filesystem path

async function fetchIconForTopic(generalTopic, query) {
  try {
    // ✅ **Normalize topic name for matching (Keep `_` for exact match)**
    const normalizedGeneralTopic = generalTopic
      .toLowerCase()
      .replace(/\s+/g, "_");

    // ✅ **Step 1: Check database for a stored icon**
    const topicQuery = `SELECT topic_name, thumbnail FROM topics WHERE thumbnail IS NOT NULL`;
    const rows = await query(topicQuery);
    const topicsWithIcons = rows || [];

    console.log(
      `🔎 Loaded ${topicsWithIcons.length} topics with thumbnails from DB.`
    );

    // ✅ **Normalize stored topic names**
    const normalizedTopicsWithIcons = topicsWithIcons.map((topic) => ({
      topic_name: topic.topic_name.toLowerCase().replace(/\s+/g, "_"), // KEEP `_` for exact match
      thumbnail: topic.thumbnail
        .toLowerCase()
        .replace(".png", "")
        .replace(/_/g, " "), // REMOVE `_` for fuzzy match
    }));

    // ✅ **Exact match check in DB**
    const exactMatch = normalizedTopicsWithIcons.find(
      (topic) => topic.topic_name === normalizedGeneralTopic
    );
    if (exactMatch) {
      const correctedThumbnail = exactMatch.thumbnail.replace(/\s+/g, "_"); // ✅ FIX: Replace spaces with `_`
      console.log(
        `✅ Exact DB match: ${exactMatch.topic_name} -> ${correctedThumbnail}.png`
      );
      return {
        exists: true,
        thumbnail_url: `${ICONS_URL}/${correctedThumbnail}.png`,
      };
    }

    // ✅ **Fuzzy match check in DB (Check if `generalTopic` includes DB topic)**
    const fuzzyMatch = normalizedTopicsWithIcons.find((topic) =>
      normalizedGeneralTopic.includes(topic.thumbnail)
    );
    if (fuzzyMatch) {
      const correctedThumbnail = fuzzyMatch.thumbnail.replace(/\s+/g, "_"); // ✅ FIX: Replace spaces with `_`
      console.log(
        `✅ Fuzzy DB match: ${fuzzyMatch.topic_name} -> ${correctedThumbnail}.png`
      );
      return {
        exists: true,
        thumbnail_url: `${ICONS_URL}/${correctedThumbnail}.png`,
      };
    }

    // ✅ **Step 2: Check the Server File System for Available Icons**
    console.log(`🗂️ Searching for topic icons in: ${ICONS_PATH}`);

    // ✅ List all available files in the directory
    let availableIcons;
    try {
      availableIcons = await fsPromises.readdir(ICONS_PATH);
      /* console.log(
        "📂 Available icons on server:",
        availableIcons.map((file) => `${ICONS_URL}/${file}`).join("\n")
      ); */
    } catch (err) {
      console.error("❌ Error reading topic icons from server:", err);
      return { exists: false, thumbnail_url: `${ICONS_URL}/general.png` };
    }

    // ✅ **Normalize filenames for matching**
    const normalizeFilename = (filename) =>
      filename.toLowerCase().replace(".png", "").replace(/_/g, " ");

    // ✅ **Exact match in file system (KEEP `_` in generalTopic)**
    const exactFileMatch = availableIcons.find(
      (file) =>
        file.toLowerCase().replace(".png", "") === normalizedGeneralTopic
    );
    if (exactFileMatch) {
      console.log(`✅ Exact file match found: ${ICONS_URL}/${exactFileMatch}`);
      return { exists: true, thumbnail_url: `${ICONS_URL}/${exactFileMatch}` };
    }

    // ✅ **Fuzzy match in file system**
    const fuzzyFileMatch = availableIcons.find((file) =>
      normalizedGeneralTopic.includes(normalizeFilename(file))
    );
    if (fuzzyFileMatch) {
      console.log(`✅ Fuzzy file match found: ${ICONS_URL}/${fuzzyFileMatch}`);
      return { exists: true, thumbnail_url: `${ICONS_URL}/${fuzzyFileMatch}` };
    }

    // ✅ **Final fallback to "general.png"**
    console.log(`⚠️ No match found for "${generalTopic}". Using default.`);
    return { exists: false, thumbnail_url: `${ICONS_URL}/general.png` };
  } catch (error) {
    console.error("❌ Error in fetchIconForTopic:", error);
    throw new Error("Failed to process topic icon.");
  }
}

module.exports = { fetchIconForTopic };
