// /backend/src/routes/content/content.core.routes.js
import { Router } from "express";
import axios from "axios";
import https from "https";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default function({ query, pool }) {
  const router = Router();

// TODO: Import or define fetchImageWithPuppeteer
// This function is used in addContent route but not defined in original server.js
async function fetchImageWithPuppeteer(url) {
  throw new Error("fetchImageWithPuppeteer not implemented");
}

/**
 * GET /api/content
 * Get paginated list of content/tasks
 */
router.get("/api/content", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;

  const sql = `
   SELECT
  t.*,

  -- Topic
  (SELECT topic_name
   FROM topics tt
   JOIN content_topics ct ON tt.topic_id = ct.topic_id
   WHERE ct.content_id = t.content_id
   ORDER BY ct.topic_order ASC
   LIMIT 1) AS topic,

  -- Authors
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

  -- Publishers
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
WHERE t.content_type = 'task'
GROUP BY t.content_id
    LIMIT ? OFFSET ?;
  `;

  pool.query(sql, [limit, offset], (err, results) => {
    if (err) {
      console.error("Error fetching paginated content:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

/**
 * GET /api/content/:id
 * Get single content/task by ID
 */
router.get("/api/content/:id", (req, res) => {
  const taskId = req.params.id;

  const sql = `
  SELECT
  t.*,

  -- Topic
  (SELECT topic_name
   FROM topics tt
   JOIN content_topics ct ON tt.topic_id = ct.topic_id
   WHERE ct.content_id = t.content_id
   ORDER BY ct.topic_order ASC
   LIMIT 1) AS topic,

  -- Authors
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

  -- Publishers
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
WHERE t.content_type = 'task' AND t.content_id = ?
    GROUP BY t.content_id
  `;

  pool.query(sql, [taskId], (err, results) => {
    if (err) {
      console.error("Error fetching task:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    console.log(results[0], "contentbyid");
    res.json(results[0]);
  });
});

/**
 * POST /api/check-content
 * Check if content exists by URL
 */
router.post("/api/check-content", (req, res) => {
  const { url } = req.body;
  const sql = "SELECT * FROM content WHERE url = ?";
  pool.query(sql, [url], (err, results) => {
    if (err) return res.status(500).send({ error: err });
    if (results.length > 0) {
      res.send({ exists: true, task: results[0] });
    } else {
      res.send({ exists: false });
    }
  });
});

/**
 * POST /api/store-content
 * Store content in stored_content table
 */
router.post("/api/store-content", async (req, res) => {
  const {
    url,
    content_type,
    media_source,
    content_name,
    raw_text,
    video_id,
    thumbnail,
    topic,
    subtopics,
    authors,
    publisherName,
    is_retracted,
  } = req.body;

  try {
    const result = await query(
      `INSERT INTO stored_content
       (url, content_type, media_source, content_name, raw_text, video_id, thumbnail, topic, subtopics, authors, publisher_name, is_retracted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        url,
        content_type,
        media_source,
        content_name,
        raw_text,
        video_id,
        thumbnail,
        topic,
        JSON.stringify(subtopics || []),
        JSON.stringify(authors || []),
        publisherName,
        is_retracted || false,
      ]
    );

    res.status(200).json({ success: true, stored_content_id: result.insertId });
  } catch (err) {
    console.error("❌ Failed to store content:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/store-content
 * Store or retrieve stored content
 */
router.get("/api/store-content", async (req, res) => {
  try {
    const {
      url,
      content_type,
      media_source,
      content_name,
      raw_text,
      video_id,
      thumbnail,
      topic,
      subtopics,
      authors,
      publisherName,
      is_retracted,
    } = req.query;

    if (!url || !content_name || !raw_text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // First check if this URL already exists
    const existing = await query(
      "SELECT stored_content_id FROM stored_content WHERE url = ?",
      [url]
    );

    if (existing.length > 0) {
      return res.json({
        message: "Already exists",
        stored_content_id: existing[0].stored_content_id,
      });
    }

    // Otherwise, insert it
    const result = await query(
      `INSERT INTO stored_content (
        url, content_type, media_source, content_name, raw_text,
        video_id, thumbnail, topic, subtopics, authors,
        publisher_name, is_retracted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        url,
        content_type || null,
        media_source || null,
        content_name,
        raw_text,
        video_id || null,
        thumbnail || null,
        topic || null,
        subtopics || null,
        authors || null,
        publisherName || null,
        is_retracted === "true" ? 1 : 0,
      ]
    );
    res.json({
      message: "Stored new content",
      stored_content_id: result.insertId,
    });
  } catch (err) {
    console.error("🧨 Error storing content:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/addContent
 * Add new content with topics, thumbnail handling
 */
router.post("/api/addContent", async (req, res) => {
  const {
    content_name,
    url,
    media_source,
    topic,
    subtopics,
    users,
    details,
    thumbnail,
    assigned,
    progress,
    iconThumbnailUrl,
    content_type,
    taskContentId,
    is_retracted,
  } = req.body;

  // Step 1: Insert the task without the thumbnail path
  const callQuery = `CALL InsertContentAndTopics(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?, @contentId);`;

  const params = [
    content_name, // Task name
    url, // URL
    media_source, // Media source
    topic, // Main topic
    JSON.stringify(subtopics), // Subtopics as JSON string
    users, // Users
    details, // Task details
    assigned, // Assigned status
    progress, // Progress status
    iconThumbnailUrl ? iconThumbnailUrl : "",
    content_type,
    taskContentId,
    is_retracted,
  ];

  try {
    // Execute the procedure
    await query(callQuery, params);
  } catch (err) {
    console.error("Error inserting task:", err);
    return res.status(500).send("Database error during task insertion");
  }
  let contentId = null;
  try {
    const fetchContentIdQuery =
      "SELECT content_id FROM content WHERE url = ? LIMIT 1";
    const results = await query(fetchContentIdQuery, [url]);
    if (results.length === 0) {
      throw new Error("Content ID not found");
    }

    contentId = results[0].content_id;
    console.log("TASKID:", contentId);
  } catch (err) {
    //console.log("Detailed Catch Error:", JSON.stringify(err, null, 2));
    return res.status(500).send("Database error during task ID fetch.");
  }
  const imageFilename = `content_id_${contentId}.png`;

  const imagePath = `assets/images/content/${imageFilename}`;
  console.log("IMAGEFILENAME:", imagePath);

  let buffer;
  let usedPuppeteer = false;

  try {
    // Step 2: Download and resize the image
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // ✅ Allow self-signed certificates
    });

    const response = await axiosInstance.get(thumbnail, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Referer: url, // Optional: Helps if the server checks the origin
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      validateStatus: function (status) {
        // Accept only 2xx
        return status >= 200 && status < 300; // default
      },
    });

    buffer = Buffer.from(response.data, "binary");
  } catch (axiosError) {
    console.warn("⚠️ Axios failed, trying Puppeteer...", axiosError.message);
    try {
      const puppeteerBuffer = await fetchImageWithPuppeteer(thumbnail);
      buffer = puppeteerBuffer;
      usedPuppeteer = true;
    } catch (puppeteerError) {
      console.error(
        "❌ Puppeteer also failed:",
        puppeteerError.message || puppeteerError
      );
      return res.status(500).send("Failed to fetch image with both methods");
    }
  }

  try {
    const resizedBuffer = await sharp(buffer)
      .resize({ width: 200, height: 200, fit: "cover" })
      .toBuffer();

    // Save the image
    const fullImagePath = path.join(__dirname, "../../..", imagePath);
    await sharp(resizedBuffer).toFile(fullImagePath);

    // Update the database with the thumbnail path
    const updateQuery =
      "UPDATE content SET thumbnail = ? WHERE content_id = ?";
    await query(updateQuery, [imagePath, contentId]);

    res.status(200).send({
      message: "Task added successfully, and thumbnail saved",
      taskId: contentId,
      imagePath,
      usedPuppeteer,
    });
  } catch (err) {
    console.error("Error processing image or updating DB:", err);
    res.status(500).send("Error processing or saving image");
  }
});

  return router;
}
