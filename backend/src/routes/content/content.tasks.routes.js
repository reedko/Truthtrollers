// /backend/src/routes/content/content.tasks.routes.js
import { Router } from "express";
import logger from "../../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function({ query, pool }) {
  const router = Router();

/**
 * GET /api/tasks/:id
 * Get single task by ID
 */
router.get("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const SQL = "SELECT * FROM content WHERE content_id = ?";
    const result = await query(SQL, [id]);
    res.json(result[0] || {});
  } catch (err) {
    logger.error("Error fetching task by ID:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/**
 * GET /api/user-tasks/:user_id
 * Get tasks for a specific user
 */
router.get("/api/user-tasks/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT
      t.*,
      (
        SELECT topic_name
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,
   (
    SELECT JSON_ARRAYAGG(
             JSON_OBJECT(
               'author_id', a.author_id,
               'author_first_name', IFNULL(a.author_first_name, ''),
               'author_last_name', IFNULL(a.author_last_name, ''),
               'author_title', IFNULL(a.author_title, ''),
               'author_profile_pic', a.author_profile_pic,
               'description', a.description
             )
           )
    FROM content_authors ca
    JOIN authors a ON ca.author_id = a.author_id
    WHERE ca.content_id = t.content_id
  ) AS authors,

 (
    SELECT JSON_ARRAYAGG(
             JSON_OBJECT(
               'publisher_id', p.publisher_id,
               'publisher_name', p.publisher_name,
               'publisher_icon', p.publisher_icon,
               'description', p.description
             )
           )
    FROM content_publishers cp
    JOIN publishers p ON cp.publisher_id = p.publisher_id
    WHERE cp.content_id = t.content_id
  ) AS publishers

    FROM content t
    JOIN content_users cu ON t.content_id = cu.content_id
    WHERE cu.user_id = ? AND t.content_type = 'task'
    GROUP BY t.content_id
  `;
  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      logger.error("❌ Error fetching user tasks:", err);
      return res.status(500).json({ error: "Query failed" });
    }
    res.json(results);
  });
});

/**
 * GET /api/unified-tasks/:pivotType/:pivotId
 * Get tasks by pivot (task, author, publisher, reference)
 */
router.get("/api/unified-tasks/:pivotType/:pivotId", (req, res) => {
  const { pivotType, pivotId } = req.params;

  let sql = "";
  let params = [pivotId];

  if (pivotType === "task") {
    sql = `SELECT ... FROM content t WHERE t.content_id = ?`;
  } else if (pivotType === "author") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_authors ca ON t.content_id = ca.content_id
      WHERE ca.author_id = ?`;
  } else if (pivotType === "publisher") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_publishers cp ON t.content_id = cp.content_id
      WHERE cp.publisher_id = ?`;
  } else if (pivotType === "reference") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_relations cr ON cr.task_content_id = t.content_id
      WHERE cr.reference_content_id = ?`;
  } else {
    return res.status(400).json({ error: "Invalid pivot type" });
  }

  // Append your JSON subqueries for authors, publishers, users, topic here 👇
  sql = sql.replace(
    "SELECT ...",
    `
    SELECT DISTINCT
      t.*,
      (
        SELECT topic_name
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                               'author_id', a.author_id,
              'author_first_name', IFNULL(a.author_first_name, ''),
              'author_last_name', IFNULL(a.author_last_name, ''),
              'author_title', IFNULL(a.author_title, ''),
              'author_profile_pic', a.author_profile_pic,
              'description', a.description
                 )
               )
        FROM content_authors ca
        JOIN authors a ON ca.author_id = a.author_id
        WHERE ca.content_id = t.content_id
      ) AS authors,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'publisher_id', p.publisher_id,
                   'publisher_name', p.publisher_name,
                   'publisher_icon', p.publisher_icon,
                   'description', p.description
                 )
               )
        FROM content_publishers cp
        JOIN publishers p ON cp.publisher_id = p.publisher_id
        WHERE cp.content_id = t.content_id
      ) AS publishers,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'user_id', u.user_id,
                   'username', u.username,
                   'email', u.email
                 )
               )
        FROM content_users cu
        JOIN users u ON cu.user_id = u.user_id
        WHERE cu.content_id = t.content_id
      ) AS users
  `
  );

  pool.query(sql, params, (err, results) => {
    if (err) {
      logger.error("Pivot query failed:", err);
      // Return empty array instead of error to prevent dashboard crashes
      // This handles cases where content was deleted but dashboard still references it
      return res.json([]);
    }
    res.json(results);
  });
});

/**
 * POST /api/submit-text
 * Submit arbitrary text for evidence engine processing
 * Creates a task from user-provided text instead of a URL
 */
router.post("/api/submit-text", async (req, res) => {
  try {
    const { text, title, userId } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    logger.log(`📝 [/api/submit-text] Received text submission (${text.length} chars) from user ${userId}`);

    // Generate a unique document ID
    const timestamp = Date.now();
    const docId = `text_${timestamp}`;
    const filename = `${docId}.txt`;

    // Create file path
    const docsDir = path.join(__dirname, "../../../assets/documents/tasks");
    const filePath = path.join(docsDir, filename);

    // Ensure directory exists
    await fs.mkdir(docsDir, { recursive: true });

    // Save text to file
    await fs.writeFile(filePath, text, "utf-8");
    logger.log(`✅ [/api/submit-text] Saved text to ${filename}`);

    // Create a local URL reference
    const localUrl = `local://documents/tasks/${filename}`;

    // Import necessary functions
    const { createContentInternal } = await import("../../storage/createContentInternal.js");

    // Create task content row
    const taskContentId = await createContentInternal(query, {
      content_name: title || "Text Submission",
      url: localUrl,
      media_source: "TextPad",
      topic: "user-submitted",
      subtopics: [],
      content_type: "task",
      thumbnail: null,
      details: text.slice(0, 500),
    });

    logger.log(`✅ [/api/submit-text] Created task content_id=${taskContentId}`);

    // Associate with user
    await query(
      `INSERT INTO content_users (content_id, user_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [taskContentId, userId]
    );

    // Now process it through the evidence engine using the existing scrape-task logic
    // Import the necessary processing functions
    const { processTaskClaims } = await import("../../core/processTaskClaims.js");
    const { runEvidenceEngine } = await import("../../core/runEvidenceEngine.js");
    const { matchClaimsToTaskClaims } = await import("../../core/matchClaims.js");
    const { persistAIResults } = await import("../../storage/persistAIResults.js");
    const { openAiLLM } = await import("../../core/openAiLLM.js");
    const { persistClaims } = await import("../../storage/persistClaims.js");

    // Extract and process claims
    logger.log(`🔍 [/api/submit-text] Extracting claims from text for content_id=${taskContentId}`);
    const taskClaims = await processTaskClaims({
      query,
      taskContentId,
      text
    });

    if (taskClaims && taskClaims.length > 0) {
      logger.log(`✅ [/api/submit-text] Extracted ${taskClaims.length} claims`);

      const claimIds = taskClaims.map((c) => c.id);

      // Run evidence engine to find supporting/contradicting evidence
      logger.log(`🔬 [/api/submit-text] Running evidence engine for content_id=${taskContentId}`);
      const { aiReferences, failedCandidates, claimConfidenceMap } = await runEvidenceEngine({
        taskContentId,
        claimIds,
        readableText: text,
      });

      if (aiReferences && aiReferences.length > 0) {
        logger.log(`✅ [/api/submit-text] Evidence engine found ${aiReferences.length} references`);

        // Persist AI results (creates reference content and links)
        await persistAIResults(query, {
          contentId: taskContentId,
          evidenceRefs: aiReferences,
          claimIds,
          claimConfidenceMap,
        });

        // Extract claims from each reference and match them to task claims
        const claimExtractionPromises = aiReferences
          .filter((ref) => ref.referenceContentId)
          .map(async (ref) => {
            try {
              // Create snippet claim from search engine snippet
              if (ref.quote) {
                await persistClaims(
                  query,
                  ref.referenceContentId,
                  [ref.quote],
                  "snippet",
                  "snippet"
                );
              }

              // Extract reference claims from full text
              if (ref.cleanText) {
                const extractedClaims = await processTaskClaims({
                  query,
                  taskContentId: ref.referenceContentId,
                  text: ref.cleanText,
                  claimType: "reference",
                  taskClaimsContext: taskClaims.map((c) => c.text),
                });

                if (extractedClaims.length > 0) {
                  // Auto-generate claim_links with veracity scores
                  const claimMatches = await matchClaimsToTaskClaims({
                    referenceClaims: extractedClaims,
                    taskClaims: taskClaims,
                    llm: openAiLLM
                  });

                  // Insert into claim_links
                  for (const match of claimMatches) {
                    await query(
                      `INSERT INTO claim_links
                       (source_claim_id, target_claim_id, relationship, support_level, confidence, veracity_score, created_by_ai, notes, user_id)
                       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                      [
                        match.referenceClaimId,
                        match.taskClaimId,
                        match.stance,
                        match.supportLevel,
                        match.confidence,
                        match.veracityScore,
                        match.rationale,
                        userId
                      ]
                    );
                  }

                  logger.log(`✅ [/api/submit-text] Created ${claimMatches.length} claim_links for reference ${ref.referenceContentId}`);
                }
              }
            } catch (err) {
              logger.warn(`⚠️ [/api/submit-text] Failed to extract claims from reference:`, err.message);
            }
          });

        await Promise.all(claimExtractionPromises);
      }
    } else {
      logger.log(`⚠️ [/api/submit-text] No claims extracted from text`);
    }

    res.json({
      success: true,
      content_id: taskContentId,
      document_path: localUrl,
      message: "Text submitted and processing started"
    });

  } catch (error) {
    logger.error("❌ [/api/submit-text] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process text submission"
    });
  }
});

  return router;
}
