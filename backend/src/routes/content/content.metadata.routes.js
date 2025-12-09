// /backend/src/routes/content/content.metadata.routes.js
import { Router } from "express";

export default function({ query, pool }) {
  const router = Router();

// TODO: Import or define extractMetadataFromWebPage
// This function is used but not defined in original server.js
async function extractMetadataFromWebPage(url) {
  // Placeholder implementation
  return {
    publisherName: "Unknown Publisher",
    authorName: "Unknown Author",
  };
}

/**
 * POST /api/extract-metadata
 * Extract publisher and author metadata from URL
 */
router.post("/api/extract-metadata", async (req, res) => {
  const { url } = req.body;

  try {
    const metadata = await extractMetadataFromWebPage(url);

    // Save publisher and author
    const [publisherId] = await query(
      "CALL InsertOrGetPublisher(?, ?, ?, @publisherId)",
      [metadata.publisherName, null, null]
    );

    const [authorId] = await query(
      "CALL InsertOrGetAuthor(?, ?, ?, ?, @authorId)",
      [
        metadata.authorName.split(" ")[0],
        metadata.authorName.split(" ")[1],
        null,
        null,
        null,
      ]
    );

    res.status(200).send({ publisherId, authorId });
  } catch (err) {
    res.status(500).send({ error: "Failed to extract metadata" });
  }
});

  return router;
}
