// backend/src/storage/persistContentAndEvidence.js
// ─────────────────────────────────────────────
// High-level persistence functions that combine
// content creation with related data (authors, publishers)
// ─────────────────────────────────────────────

import logger from "../utils/logger.js";
import { createContentInternal } from "./createContentInternal.js";
import { persistAuthors } from "./persistAuthors.js";
import { persistPublishers } from "./persistPublishers.js";

/**
 * persistTaskContent(query, { url, title, rawText, publisher, authors, thumbnail })
 *
 * Creates a task content row and persists associated authors and publisher.
 *
 * Steps:
 * 1. Create content row via createContentInternal
 * 2. Persist authors and link to content
 * 3. Persist publisher and link to content
 *
 * Returns: taskContentId
 */
export async function persistTaskContent(
  query,
  { url, title, rawText, publisher, authors = [], thumbnail = "" }
) {
  try {
    // 1. Create task content row
    const taskContentId = await createContentInternal(query, {
      content_name: title,
      url,
      media_source: publisher || "Unknown",
      topic: "Research", // Default topic for tasks
      subtopics: [],
      content_type: "task",
      thumbnail,
      details: rawText?.slice(0, 500) || "",
    });

    logger.log(`✅ Created task content_id=${taskContentId}`);

    // 2. Persist authors
    if (authors && authors.length > 0) {
      await persistAuthors(query, taskContentId, authors);
      logger.log(`✅ Persisted ${authors.length} authors for task ${taskContentId}`);
    }

    // 3. Persist publisher
    if (publisher) {
      await persistPublishers(query, taskContentId, {
        publisher_name: publisher,
      });
      logger.log(`✅ Persisted publisher "${publisher}" for task ${taskContentId}`);
    }

    return taskContentId;
  } catch (err) {
    logger.error("❌ persistTaskContent failed:", err);
    throw err;
  }
}
