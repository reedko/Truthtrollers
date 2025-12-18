// backend/src/core/createContentInternal.js
// Single internal helper that does what /api/addContent used to do:

import logger from "../utils/logger.js";
//  - CALL InsertContentAndTopics(...)
//  - fetch content_id
//  - download & resize thumbnail
//  - update content.content_thumbnail
//
// Used by:
//   - legacy /api/addContent route (for compatibility)
//   - new /api/scrape-task and /api/scrape-reference routes

import axios from "axios";
import https from "https";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { fetchImageWithPuppeteer } from "../utils/fetchImageWithPuppeteer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * createContentInternal(query, payload)
 *
 * payload roughly matches what /api/addContent expects:
 * {
 *   content_name,
 *   url,
 *   media_source,
 *   topic,
 *   subtopics,
 *   users,
 *   details,
 *   thumbnail,         // remote image URL
 *   assigned,
 *   progress,
 *   iconThumbnailUrl,
 *   content_type,      // 'task' | 'reference'
 *   taskContentId,     // parent content_id for references
 *   is_retracted
 * }
 *
 * Returns: contentId (number)
 */
export async function createContentInternal(query, payload) {
  const {
    content_name,
    url,
    media_source,
    topic,
    subtopics = [],
    users = "",
    details = "",
    thumbnail,
    assigned = "unassigned",
    progress = "Unassigned",
    iconThumbnailUrl = "",
    content_type = "task",
    taskContentId = null,
    is_retracted = false,
  } = payload || {};

  if (!content_name || !url) {
    throw new Error("createContentInternal: content_name and url are required");
  }

  // 1) Insert via stored procedure InsertContentAndTopics
  const callQuery = `
    CALL InsertContentAndTopics(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, @contentId);
  `;

  const params = [
    content_name, // Task name
    url, // URL
    media_source, // Media source
    topic, // Main topic
    JSON.stringify(subtopics), // Subtopics as JSON string
    users, // Users (string)
    details || url, // Task details (fallback to url)
    assigned, // Assigned status
    progress, // Progress status
    iconThumbnailUrl || "", // Icon thumbnail URL (topic icon)
    content_type, // 'task' or 'reference'
    taskContentId, // parent task content_id for refs
    is_retracted ? 1 : 0, // tinyint(1)
  ];

  try {
    await query(callQuery, params);
  } catch (err) {
    logger.error(
      "❌ createContentInternal: error calling InsertContentAndTopics",
      err
    );
    throw err;
  }

  // 2) Fetch the new content_id (same pattern as /api/addContent)
  let contentId = null;
  try {
    const fetchContentIdQuery =
      "SELECT content_id FROM content WHERE url = ? LIMIT 1";
    const results = await query(fetchContentIdQuery, [url]);

    if (!results || results.length === 0) {
      throw new Error(
        "createContentInternal: Content ID not found after insert"
      );
    }

    contentId = results[0].content_id;
    logger.log("🧩 createContentInternal: contentId =", contentId);
  } catch (err) {
    logger.error("❌ createContentInternal: error fetching content_id", err);
    throw err;
  }

  // 3) If we don't have a thumbnail URL, just return contentId
  if (!thumbnail) {
    logger.warn(
      "⚠️ createContentInternal: No thumbnail URL provided; skipping image fetch."
    );
    return contentId;
  }

  // 4) Download and resize the thumbnail image
  const imageFilename = `content_id_${contentId}.png`;
  const imagePath = `assets/images/content/${imageFilename}`;
  logger.log("🖼 createContentInternal: imagePath =", imagePath);

  let buffer;
  let usedPuppeteer = false;

  try {
    // Axios instance that allows self-signed certs (same as your route)
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const response = await axiosInstance.get(thumbnail, {
      responseType: "arraybuffer",
      timeout: 10000, // 10 second timeout to prevent hangs
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Referer: url,
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    buffer = Buffer.from(response.data, "binary");
  } catch (axiosError) {
    logger.warn(
      "⚠️ createContentInternal: Axios failed, trying Puppeteer...",
      axiosError.message
    );
    try {
      const puppeteerBuffer = await fetchImageWithPuppeteer(thumbnail);
      buffer = puppeteerBuffer;
      usedPuppeteer = true;
    } catch (puppeteerError) {
      logger.error(
        "❌ createContentInternal: Puppeteer also failed:",
        puppeteerError.message || puppeteerError
      );
      // At this point, we keep the content row but skip the thumbnail
      return contentId;
    }
  }

  try {
    const resizedBuffer = await sharp(buffer)
      .resize({ width: 200, height: 200, fit: "cover" })
      .toBuffer();

    const fullImagePath = path.join(__dirname, "../..", imagePath);

    await sharp(resizedBuffer).toFile(fullImagePath);

    const updateQuery = "UPDATE content SET thumbnail = ? WHERE content_id = ?";
    await query(updateQuery, [imagePath, contentId]);

    logger.log("✅ createContentInternal: thumbnail saved", {
      contentId,
      imagePath,
      usedPuppeteer,
    });
  } catch (err) {
    logger.error(
      "❌ createContentInternal: Error processing image or updating DB:",
      err
    );
    // Still return contentId – content exists, just no thumbnail
  }

  return contentId;
}
