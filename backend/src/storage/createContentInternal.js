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
import {
  runWithThumbnailDownloadSlot,
  THUMBNAIL_DOWNLOAD_TIMEOUT_MS,
} from "../utils/thumbnailDownloadLimiter.js";

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
 *   thumbnailFallback, // optional page-derived image URL
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
    thumbnailFallback,
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

  // InsertContentAndTopics declares contentName as VARCHAR(255).
  const safeName =
    content_name.length > 255
      ? `${content_name.substring(0, 254)}…`
      : content_name;

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
  if ((!thumbnail && !thumbnailFallback) || isExisting) {
    if (isExisting) {
      logger.log("⏭ createContentInternal: content already exists, skipping thumbnail re-download.");
    }
    return contentId;
  }

  // 4) Download and resize the thumbnail image
  const imageFilename = `content_id_${contentId}.png`;
  const imagePath = `assets/images/content/${imageFilename}`;
  logger.log("🖼 createContentInternal: imagePath =", imagePath);

  const thumbnailUrls = [];
  for (const rawCandidate of [thumbnail, thumbnailFallback]) {
    if (!rawCandidate) continue;
    try {
      const rawThumbnail = String(rawCandidate).trim();
      if ((rawThumbnail.match(/https?:\/\//gi) || []).length > 1) {
        throw new Error("multiple URLs supplied");
      }
      const candidateUrl = new URL(rawThumbnail);
      if (!["http:", "https:"].includes(candidateUrl.protocol)) {
        throw new Error(`unsupported protocol ${candidateUrl.protocol}`);
      }
      if (!thumbnailUrls.some((entry) => entry.href === candidateUrl.href)) {
        thumbnailUrls.push(candidateUrl);
      }
    } catch (err) {
      logger.warn(
        `⚠️ createContentInternal: rejecting invalid thumbnail candidate contentId=${contentId} thumbnail=${JSON.stringify(rawCandidate)} reason=${err.message}`,
      );
    }
  }

  if (thumbnailUrls.length === 0) return contentId;

  let buffer;
  let thumbnailUrl = null;
  const queuedAt = Date.now();
  let downloadStartedAt = null;
  let downloadFinishedAt = null;

  try {
    buffer = await runWithThumbnailDownloadSlot(async () => {
      downloadStartedAt = Date.now();

      // Axios instance that allows self-signed certs (same as your route)
      const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
      let lastError;
      for (let index = 0; index < thumbnailUrls.length; index += 1) {
        const candidateUrl = thumbnailUrls[index];
        const hardDeadlineSignal = AbortSignal.timeout(
          THUMBNAIL_DOWNLOAD_TIMEOUT_MS,
        );

        try {
          const response = await axiosInstance.get(candidateUrl.href, {
            responseType: "arraybuffer",
            timeout: THUMBNAIL_DOWNLOAD_TIMEOUT_MS,
            signal: hardDeadlineSignal,
            maxContentLength: 20 * 1024 * 1024,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Referer: url,
              Accept:
                "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
            validateStatus: (status) => status >= 200 && status < 300,
          });

          const contentType = String(response.headers?.["content-type"] || "")
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
          if (!contentType.startsWith("image/")) {
            throw new Error(
              `response was not an image (${contentType || "missing content-type"})`,
            );
          }

          const candidateBuffer = Buffer.from(response.data, "binary");
          const metadata = await sharp(candidateBuffer).metadata();
          const width = Number(metadata.width || 0);
          const height = Number(metadata.height || 0);
          const aspectRatio = width && height
            ? Math.max(width / height, height / width)
            : Infinity;
          if (width < 120 || height < 120 || aspectRatio > 4) {
            throw new Error(
              `implausible thumbnail dimensions ${width || "?"}x${height || "?"}`,
            );
          }

          thumbnailUrl = candidateUrl;
          return candidateBuffer;
        } catch (error) {
          lastError = hardDeadlineSignal.aborted
            ? new Error(
                `thumbnail exceeded ${THUMBNAIL_DOWNLOAD_TIMEOUT_MS}ms hard deadline`,
                { cause: error },
              )
            : error;
          if (index + 1 < thumbnailUrls.length) {
            logger.warn(
              `⚠️ createContentInternal: thumbnail candidate rejected; trying page fallback contentId=${contentId} thumbnail=${candidateUrl.href} reason=${lastError.message}`,
            );
          }
        }
      }

      throw lastError || new Error("no usable thumbnail candidate");
    });
    downloadFinishedAt = Date.now();
  } catch (axiosError) {
    const failedAt = Date.now();
    const queueWaitMs =
      downloadStartedAt === null ? failedAt - queuedAt : downloadStartedAt - queuedAt;
    const downloadMs =
      downloadStartedAt === null ? 0 : failedAt - downloadStartedAt;
    logger.warn(
      `⚠️ createContentInternal: thumbnail download failed; continuing without thumbnail contentId=${contentId} candidates=${thumbnailUrls.map((entry) => entry.href).join(",")} queueWaitMs=${queueWaitMs} downloadMs=${downloadMs} reason=${axiosError.message}`,
    );
    return contentId;
  }

  try {
    const resizedBuffer = await sharp(buffer)
      .resize({ width: 200, height: 200, fit: "cover" })
      .toBuffer();

    const fullImagePath = path.join(__dirname, "../..", imagePath);

    await sharp(resizedBuffer).toFile(fullImagePath);

    const updateQuery = "UPDATE content SET thumbnail = ? WHERE content_id = ?";
    await query(updateQuery, [imagePath, contentId]);

    logger.log(
      `✅ createContentInternal: thumbnail saved contentId=${contentId} imagePath=${imagePath} method=axios queueWaitMs=${downloadStartedAt - queuedAt} downloadMs=${downloadFinishedAt - downloadStartedAt} source=${thumbnailUrl.href}`,
    );
  } catch (err) {
    logger.error(
      `❌ createContentInternal: error processing thumbnail contentId=${contentId} thumbnail=${thumbnailUrl.href} reason=${err.message}`,
    );
    // Still return contentId – content exists, just no thumbnail
  }

  return contentId;
}
