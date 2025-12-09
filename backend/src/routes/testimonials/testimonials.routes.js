import { Router } from "express";

export default function createTestimonialsRoutes({ query, pool }) {
  const router = Router();

  // POST /api/testimonials/add
  router.post("/api/testimonials/add", async (req, res) => {
    try {
      const { content_id, testimonials, user_id } = req.body;

      if (
        !content_id ||
        !Array.isArray(testimonials) ||
        testimonials.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "content_id and testimonials are required" });
      }

      let insertedCount = 0;

      for (const t of testimonials) {
        const text = (t.text || "").trim();
        if (!text) continue;

        let testimonialId;

        // 1️⃣ Check for existing identical testimonial
        const existing = await query(
          "SELECT testimonial_id FROM testimonials WHERE testimonial_text = ? AND (name IS NULL OR name = ?) AND (image_url IS NULL OR image_url = ?)",
          [text, t.name || null, t.imageUrl || null]
        );
        if (existing.length > 0) {
          testimonialId = existing[0].testimonial_id;
        } else {
          // 2️⃣ Insert new testimonial
          const insertResult = await query(
            "INSERT INTO testimonials (testimonial_text, name, image_url) VALUES (?, ?, ?)",
            [text, t.name || null, t.imageUrl || null]
          );
          testimonialId = insertResult?.insertId || null;
        }
        if (!testimonialId) continue;

        // 3️⃣ Link to content (avoid duplicate link)
        const link = await query(
          "SELECT ct_id FROM content_testimonials WHERE content_id = ? AND testimonial_id = ?",
          [content_id, testimonialId]
        );
        if (link.length === 0) {
          await query(
            "INSERT INTO content_testimonials (content_id, testimonial_id, user_id) VALUES (?, ?, ?)",
            [content_id, testimonialId, user_id || null]
          );
          insertedCount++;
        }
      }
      res.json({ success: true, insertedCount });
    } catch (error) {
      console.error("❌ Error in /api/testimonials/add:", error);
      res.status(500).json({ error: "Server error storing testimonials" });
    }
  });

  return router;
}
