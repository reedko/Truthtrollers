// backend/src/storage/persistAuthors.js
// Fully rewritten to mirror legacy server.js behavior EXACTLY.

import logger from "../utils/logger.js";
import axios from "axios";
import https from "https";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { fetchImageWithPuppeteer } from "../utils/fetchImageWithPuppeteer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const surnameParticles = new Set([
  "de",
  "del",
  "de la",
  "da",
  "di",
  "van",
  "von",
  "bin",
  "ibn",
  "al",
  "le",
  "du",
  "des",
  "la",
  "mc",
  "mac",
  "st.",
  "st",
  "o’",
  "o'",
]);

const knownTitles = [
  "Dr.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "Prof.",
  "Rev.",
  "Hon.",
  "Sir",
];

const knownSuffixes = [
  "PhD",
  "Ph.D.",
  "MD",
  "M.D.",
  "DO",
  "D.O.",
  "MS",
  "M.S.",
  "MBA",
  "BSc",
  "B.Sc.",
  "JD",
  "J.D.",
  "DDS",
  "D.D.S.",
  "RN",
  "R.N.",
  "Esq.",
  "Jr.",
  "Sr.",
  "III",
  "IV",
];

function parseAuthorName(raw) {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  const displayName = cleaned;

  let name = cleaned;
  let title = null;
  let suffix = null;

  // suffix after comma
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    name = parts[0];
    const possible = parts[1].trim();
    if (knownSuffixes.includes(possible)) {
      suffix = possible;
    }
  }

  // extract title
  for (const t of knownTitles) {
    if (name.startsWith(t + " ")) {
      title = t;
      name = name.slice(t.length).trim();
      break;
    }
  }

  const parts = name.split(" ");
  if (parts.length < 2) {
    return {
      display_name: displayName,
      title,
      first_name: parts[0],
      middle_name: null,
      last_name: "",
      suffix,
    };
  }

  // suffix without comma
  const lastWord = parts[parts.length - 1];
  if (knownSuffixes.includes(lastWord)) {
    suffix = lastWord;
    parts.pop();
  }

  const firstName = parts.shift();
  const lastNameParts = [];

  // build last name
  while (parts.length) {
    const part = parts[parts.length - 1];
    if (
      surnameParticles.has(part.toLowerCase()) ||
      lastNameParts.length === 0
    ) {
      lastNameParts.unshift(parts.pop());
    } else break;
  }

  return {
    display_name: displayName,
    title,
    first_name: firstName,
    middle_name: parts.length ? parts.join(" ") : null,
    last_name: lastNameParts.join(" "),
    suffix,
  };
}

/**
 * downloadAndSaveAuthorImage(query, authorId, imageUrl)
 *
 * Downloads the remote author image, resizes to width 300,
 * saves to assets/images/authors/author_id_{authorId}.jpg,
 * and updates authors.author_profile_pic in the DB.
 * Skips if author_profile_pic is already set.
 */
async function downloadAndSaveAuthorImage(query, authorId, imageUrl) {
  logger.log(`🚀 [authorImage] ENTERED — authorId=${authorId}, imageUrl=${imageUrl}`);
  if (!authorId || !imageUrl) {
    logger.warn(`⚠️  [authorImage] Early exit — authorId=${authorId}, imageUrl=${imageUrl}`);
    return;
  }

  // Skip if this author already has a profile pic
  const existing = await query(
    "SELECT author_profile_pic FROM authors WHERE author_id = ?",
    [authorId]
  );
  logger.log(`🔍 [authorImage] existing row: ${JSON.stringify(existing?.[0])}`);
  const currentPic = existing?.[0]?.author_profile_pic;
  if (currentPic && currentPic.startsWith("assets/")) {
    logger.log(`🖼️  [authorImage] author_id ${authorId} already has local profile pic="${currentPic}", skipping.`);
    return;
  }
  logger.log(`🔄 [authorImage] author_id ${authorId} current pic is external or null ("${currentPic}") — proceeding with download.`);

  const imagePath = `assets/images/authors/author_id_${authorId}.jpg`;
  const fullImagePath = path.join(__dirname, "../..", imagePath);
  logger.log(`📂 [authorImage] target path: fullImagePath=${fullImagePath}, imagePath=${imagePath}`);

  let buffer;
  try {
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    const response = await axiosInstance.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    buffer = Buffer.from(response.data, "binary");
    logger.log(`✅ [authorImage] Downloaded image for author_id ${authorId} via Axios.`);
  } catch (axiosErr) {
    logger.warn(`⚠️ [authorImage] Axios failed for author_id ${authorId}, trying Puppeteer...`, axiosErr.message);
    try {
      buffer = await fetchImageWithPuppeteer(imageUrl);
      logger.log(`✅ [authorImage] Downloaded image for author_id ${authorId} via Puppeteer.`);
    } catch (puppeteerErr) {
      logger.error(`❌ [authorImage] Both Axios and Puppeteer failed for author_id ${authorId}.`, puppeteerErr.message);
      return;
    }
  }

  try {
    await sharp(buffer)
      .resize({ width: 300 })
      .toFormat("jpeg")
      .toFile(fullImagePath);

    await query(
      "UPDATE authors SET author_profile_pic = ? WHERE author_id = ?",
      [imagePath, authorId]
    );
    logger.log(`✅ [authorImage] Saved and updated author_profile_pic: ${imagePath}`);
  } catch (err) {
    logger.error(`❌ [authorImage] Error resizing/saving image for author_id ${authorId}:`, err.message);
  }
}

/**
 * persistAuthors(pool, contentId, authors)
 *
 * authors must be an array of:
 *   { name: "John Smith", description: "...", image: "URL" }
 *
 * This function now EXACTLY matches the old working server.js route.
 */
export async function persistAuthors(query, contentId, authors = []) {
  logger.log(`📋 [persistAuthors] called — contentId=${contentId}, authors=${JSON.stringify(authors.map(a => ({ name: a?.name, image: a?.image })))}`);
  if (!contentId || !Array.isArray(authors) || authors.length === 0) return [];

  const authorIds = [];

  for (const author of authors) {
    if (
      !author ||
      (!author.name &&
        !author.displayName &&
        !author.firstName &&
        !author.lastName)
    ) {
      continue;
    }
    // 1. Build rawName string
    const rawName =
      author.name ||
      author.displayName ||
      [author.firstName, author.middleName, author.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

    if (!rawName) continue;

    // 2. Parse it
    const parsed = parseAuthorName(rawName);
    const sql = `
      CALL InsertOrGetAuthor(?, ?, ?, ?, ?, ?, ?, ?, @authorId);
    `;

    const params = [
      parsed.first_name,
      parsed.middle_name,
      parsed.last_name,
      parsed.title,
      parsed.suffix,
      parsed.display_name,
      author.description || null,
      author.image || null,
    ];

    // IMPORTANT: legacy behavior → result[0][0]
    const result = await query(sql, params);

    const callRows = result[0]; // CALL returns rows in result[0]
    const authorId = callRows?.[0]?.authorId;

    if (!authorId) {
      logger.error("❌ persistAuthors: SP did not return authorId");
      continue;
    }

    authorIds.push(authorId);

    // Download and save author image if we have a remote URL
    logger.log(`🖼️  [persistAuthors] authorId=${authorId}, author.image=${author.image || "NONE"}`);
    if (author.image) {
      await downloadAndSaveAuthorImage(query, authorId, author.image);
    } else {
      logger.warn(`⚠️  [persistAuthors] No image URL for authorId=${authorId}, skipping download.`);
    }

    // link to content
    await query(
      `INSERT IGNORE INTO content_authors (content_id, author_id)
       VALUES (?, ?)`,
      [contentId, authorId]
    );
  }

  return authorIds;
}
