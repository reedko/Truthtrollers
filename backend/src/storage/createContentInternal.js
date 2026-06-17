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
    // Distribution-layer provenance fields (optional — never break existing callers)
    platform = null,
    distribution_channel = null,
    linked_url = null,
    linked_publisher = null,
  } = payload || {};

  if (!content_name || !url) {
    throw new Error("createContentInternal: content_name and url are required");
  }

  // Clamp to DB column limit (stored procedure param is VARCHAR(512))
  const safeName = content_name.length > 500 ? content_name.substring(0, 497) + "…" : content_name;

  // 1) Insert via stored procedure InsertContentAndTopics
  const callQuery = `
    CALL InsertContentAndTopics(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, @contentId);
  `;

  const params = [
    safeName, // Task name
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
      err,
    );
    throw err;
  }

  // 2) Fetch content_id — SP handles dedup so this always returns a row
  let contentId = null;
  let isExisting = false;
  try {
    const fetchContentIdQuery =
      "SELECT content_id, thumbnail FROM content WHERE url = ? LIMIT 1";
    const results = await query(fetchContentIdQuery, [url]);
    if (!results || results.length === 0) {
      throw new Error(
        "createContentInternal: Content ID not found after insert",
      );
    }

    contentId = results[0].content_id;
    isExisting = !!results[0].thumbnail; // already has a thumbnail → was a pre-existing row
    logger.log("🧩 createContentInternal: contentId =", contentId, isExisting ? "(existing)" : "(new)");
  } catch (err) {
    logger.error("❌ createContentInternal: error fetching content_id", err);
    throw err;
  }

  // 3a) Persist distribution-layer provenance fields when provided.
  //     Done as a separate UPDATE so the stored procedure signature never changes.
  if (platform || distribution_channel || linked_url || linked_publisher) {
    try {
      await query(
        `UPDATE content
            SET platform             = COALESCE(?, platform),
                distribution_channel = COALESCE(?, distribution_channel),
                linked_url           = COALESCE(?, linked_url),
                linked_publisher     = COALESCE(?, linked_publisher)
          WHERE content_id = ?`,
        [platform, distribution_channel, linked_url, linked_publisher, contentId]
      );
      logger.log("🧩 createContentInternal: provenance fields updated for content_id =", contentId);
    } catch (err) {
      // Non-fatal — columns may not exist yet if migration hasn't run
      logger.warn("⚠️ createContentInternal: could not write provenance fields (migration pending?):", err.message);
    }
  }

  // 3b) If no thumbnail URL provided, or content already existed with one, skip image fetch
  if (!thumbnail || isExisting) {
    if (isExisting) {
      logger.log("⏭ createContentInternal: content already exists, skipping thumbnail re-download.");
    }
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
      axiosError.message,
    );
    try {
      const puppeteerBuffer = await fetchImageWithPuppeteer(thumbnail);
      buffer = puppeteerBuffer;
      usedPuppeteer = true;
    } catch (puppeteerError) {
      logger.error(
        "❌ createContentInternal: Puppeteer also failed:",
        puppeteerError.message || puppeteerError,
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
      err,
    );
    // Still return contentId – content exists, just no thumbnail
  }

  return contentId;
}
