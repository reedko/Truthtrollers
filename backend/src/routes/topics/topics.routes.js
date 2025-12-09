import { Router } from "express";
import { fetchIconForTopic } from "../../utils/fetchIconForTopic.js";

const BASE_URL = process.env.REACT_APP_BASE_URL;

export default function createTopicsRoutes({ query, pool, db }) {
  const router = Router();

  // GET /api/content_topics
  router.get("/api/content_topics", (req, res) => {
    const sql = "SELECT * FROM content_topics";
    pool.query(sql, (err, results) => {
      if (err) {
        console.error("Error fetching content_topics:", err);
        return res.status(500).json({ error: "Database query failed" });
      }
      res.json(results);
    });
  });

  // GET /api/topics
  router.get("/api/topics", async (req, res) => {
    const sql = `SELECT t.* FROM topics t WHERE topic_id IN
    (SELECT DISTINCT(topic_id)
  FROM content_topics ct join content c
  on ct.content_id=c.content_id
  WHERE topic_order=1 and content_type='task')ORDER by topic_name`;

    pool.query(sql, async (err, results) => {
      if (err) {
        console.error("❌ Error fetching topics:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      // ✅ Ensure results is iterable
      if (!Array.isArray(results) || results.length === 0) {
        console.warn("⚠️ No topics found.");
        return res.json([]);
      }

      // ✅ Process topics & fill missing thumbnails
      for (let topic of results) {
        if (!topic.thumbnail || topic.thumbnail.trim() === "") {
          console.log(`🔎 No thumbnail for: ${topic.topic_name}, fetching...`);

          try {
            const result = await fetchIconForTopic(topic.topic_name, query);

            if (result.thumbnail_url) {
              console.log(`✅ Found icon: ${result.thumbnail_url}`);

              // 🔥 Strip BASE_URL before storing
              const cleanThumbnail = result.thumbnail_url.replace(
                `${BASE_URL}/`,
                ""
              );

              const callQuery =
                "UPDATE topics SET thumbnail = ? WHERE topic_id = ?";
              const params = [cleanThumbnail, topic.topic_id];
              console.log(callQuery, ":", cleanThumbnail, ":", topic.topic_id);
              try {
                // Execute the procedure
                db.query(callQuery, params);
              } catch (err) {
                console.error("Error inserting task:", err);
                return res
                  .status(500)
                  .send("Database error during task insertion");
              }
              // ✅ Assign fetched & cleaned thumbnail
              topic.thumbnail = `${cleanThumbnail}`;
            } else {
              console.log(
                `⚠️ No match found for ${topic.topic_name}, using default.`
              );
              topic.thumbnail = `assets/images/topics/general.png`;
            }
          } catch (fetchError) {
            console.error(
              `❌ Error fetching icon for ${topic.topic_name}:`,
              fetchError
            );
            topic.thumbnail = `assets/images/topics/general.png`;
          }
        }
      }

      res.json(results);
    });
  });

  // POST /api/checkAndDownloadTopicIcon
  router.post("/api/checkAndDownloadTopicIcon", async (req, res) => {
    const { generalTopic } = req.body;

    if (!generalTopic || !generalTopic.trim()) {
      return res.status(400).send({ error: "generalTopic is required" });
    }

    try {
      // ✅ 1. check topics + aliases
      const topicQuery = `
        SELECT t.topic_id
        FROM topics t
        LEFT JOIN topic_aliases ta ON t.topic_id = ta.topic_id
        WHERE t.topic_name = ? OR ta.alias_name = ?
      `;

      // our query() returns an array of rows
      const rows = await query(topicQuery, [generalTopic, generalTopic]);
      console.log(rows, generalTopic, ": results for topic check");

      // ✅ topic already exists → tell FE "you're good, no need to download"
      if (Array.isArray(rows) && rows.length > 0) {
        return res.status(200).send({
          exists: true,
          thumbnail_url: null,
        });
      }

      // ✅ 2. otherwise try to fetch/create local icon
      const { exists, thumbnail_url } = await fetchIconForTopic(
        generalTopic,
        query
      );

      // we store relative paths, not absolute URLs
      let cleanThumb = thumbnail_url || "";
      if (cleanThumb.startsWith(BASE_URL)) {
        cleanThumb = cleanThumb.replace(BASE_URL, "");
      }
      // drop leading slashes so FE can do `${BASE_URL}/${cleanThumb}`
      cleanThumb = cleanThumb.replace(/^\/+/, "");

      return res.status(200).send({
        exists,
        thumbnail_url: cleanThumb,
      });
    } catch (error) {
      console.error("❌ Error in checkAndDownloadTopicIcon:", error);
      return res.status(500).send({ error: "Failed to process topic icon." });
    }
  });

  return router;
}
