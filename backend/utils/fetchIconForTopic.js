// backend/utils/fetchIconForTopic.js (ESM)
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer BASE_URL; fall back to REACT_APP_BASE_URL for your existing envs
const BASE_URL =
  process.env.BASE_URL ||
  process.env.REACT_APP_BASE_URL ||
  "http://localhost:3000";

// Public URL where the server serves icons
const ICONS_URL = `${BASE_URL}/assets/images/topics`;

// Filesystem path to the icons directory (relative to backend/)
const ICONS_PATH = path.join(__dirname, "..", "assets", "images", "topics");

export async function fetchIconForTopic(generalTopic, query) {
  try {
    const fsPromises = fs.promises;

    // normalize topic -> use underscores for exact filename checks
    const normalizedGeneralTopic = generalTopic
      .toLowerCase()
      .replace(/\s+/g, "_");

    // 1) See if DB already has a thumbnail
    const topicQuery = `SELECT topic_name, thumbnail FROM topics WHERE thumbnail IS NOT NULL`;
    const rows = await query(topicQuery);
    const topicsWithIcons = rows || [];

    const normalizedTopicsWithIcons = topicsWithIcons.map((t) => ({
      topic_name: (t.topic_name || "").toLowerCase().replace(/\s+/g, "_"),
      // store-only name (without .png); for fuzzy compare we strip underscores
      stored: (t.thumbnail || "")
        .toLowerCase()
        .replace(/\.png$/, "")
        .replace(/_/g, " "),
    }));

    // exact DB match
    const exactDb = normalizedTopicsWithIcons.find(
      (t) => t.topic_name === normalizedGeneralTopic
    );
    if (exactDb) {
      const corrected = exactDb.stored.replace(/\s+/g, "_");
      return { exists: true, thumbnail_url: `${ICONS_URL}/${corrected}.png` };
    }

    // fuzzy DB match (topic contains stored)
    const fuzzyDb = normalizedTopicsWithIcons.find((t) =>
      normalizedGeneralTopic.includes(t.stored)
    );
    if (fuzzyDb) {
      const corrected = fuzzyDb.stored.replace(/\s+/g, "_");
      return { exists: true, thumbnail_url: `${ICONS_URL}/${corrected}.png` };
    }

    // 2) Check filesystem
    let files = [];
    try {
      files = await fsPromises.readdir(ICONS_PATH);
    } catch (err) {
      console.error("Error reading topic icons dir:", ICONS_PATH, err);
      return { exists: false, thumbnail_url: `${ICONS_URL}/general.png` };
    }

    const normalizeFilename = (f) =>
      f
        .toLowerCase()
        .replace(/\.png$/, "")
        .replace(/_/g, " ");

    // exact filename match (keep underscores)
    const exactFile = files.find(
      (f) => f.toLowerCase().replace(/\.png$/, "") === normalizedGeneralTopic
    );
    if (exactFile) {
      return { exists: true, thumbnail_url: `${ICONS_URL}/${exactFile}` };
    }

    // fuzzy filename match
    const fuzzyFile = files.find((f) =>
      normalizedGeneralTopic.includes(normalizeFilename(f))
    );
    if (fuzzyFile) {
      return { exists: true, thumbnail_url: `${ICONS_URL}/${fuzzyFile}` };
    }

    // fallback
    return { exists: false, thumbnail_url: `${ICONS_URL}/general.png` };
  } catch (error) {
    console.error("fetchIconForTopic error:", error);
    throw new Error("Failed to process topic icon.");
  }
}
