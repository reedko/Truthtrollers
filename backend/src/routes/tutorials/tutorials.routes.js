// backend/src/routes/tutorials/tutorials.routes.js
// ──────────────────────────────────────────────────────────────────
// Tutorial Videos API Routes
// Handles CRUD operations for tutorial videos
// ──────────────────────────────────────────────────────────────────

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import logger from "../../utils/logger.js";
import { authenticateToken } from "../../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function createTutorialsRouter({ query }) {
  const router = express.Router();

  // Configure multer for video uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, "../../../assets/videos/tutorials");

      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, "tutorial-" + uniqueSuffix + ext);
    },
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        let uploadDir;
        if (file.fieldname === "video") {
          uploadDir = path.join(__dirname, "../../../assets/videos/tutorials");
        } else if (file.fieldname === "thumbnail") {
          uploadDir = path.join(__dirname, "../../../assets/images/tutorials");
        }
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const prefix = file.fieldname === "video" ? "tutorial-" : "thumbnail-";
        cb(null, prefix + uniqueSuffix + ext);
      },
    }),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (req, file, cb) => {
      if (file.fieldname === "video") {
        const allowedTypes = /mp4|mov|avi|webm|mkv/;
        const ext = path.extname(file.originalname).toLowerCase();
        const mimetype = file.mimetype.startsWith("video/");
        if (allowedTypes.test(ext) && mimetype) {
          cb(null, true);
        } else {
          cb(new Error("Only video files are allowed"));
        }
      } else if (file.fieldname === "thumbnail") {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const ext = path.extname(file.originalname).toLowerCase();
        const mimetype = file.mimetype.startsWith("image/");
        if (allowedTypes.test(ext) && mimetype) {
          cb(null, true);
        } else {
          cb(new Error("Only image files are allowed for thumbnails"));
        }
      } else {
        cb(new Error("Unexpected field"));
      }
    },
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /api/tutorials
  // Get all active tutorial videos (public - no auth required)
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/tutorials", async (req, res) => {
  const { category } = req.query;

  try {
    let sql = `
      SELECT
        tv.tutorial_video_id,
        tv.title,
        tv.description,
        tv.video_url,
        tv.thumbnail_url,
        tv.duration_seconds,
        tv.category,
        tv.created_at,
        u.username as uploaded_by
      FROM tutorial_videos tv
      LEFT JOIN users u ON tv.uploaded_by_user_id = u.user_id
      WHERE tv.is_active = TRUE
    `;

    const params = [];
    if (category) {
      sql += " AND tv.category = ?";
      params.push(category);
    }

    sql += " ORDER BY tv.order_index ASC, tv.created_at DESC";

    const videos = await query(sql, params);

    logger.log(`✅ Retrieved ${videos.length} tutorial videos`);
    res.json({ success: true, videos });
  } catch (err) {
    logger.error("❌ Error fetching tutorial videos:", err);
    res.status(500).json({ error: "Failed to fetch tutorial videos" });
  }
});

// ──────────────────────────────────────────────────────────────────
// GET /api/tutorials/categories
// Get all unique categories (public - no auth required)
// ──────────────────────────────────────────────────────────────────
router.get("/api/tutorials/categories", async (req, res) => {

  try {
    const categories = await query(`
      SELECT DISTINCT category
      FROM tutorial_videos
      WHERE is_active = TRUE AND category IS NOT NULL
      ORDER BY category ASC
    `);

    res.json({
      success: true,
      categories: categories.map(c => c.category)
    });
  } catch (err) {
    logger.error("❌ Error fetching tutorial categories:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// ──────────────────────────────────────────────────────────────────
// POST /api/tutorials/upload
// Upload a new tutorial video (super_admin only)
// ──────────────────────────────────────────────────────────────────
router.post(
  "/api/tutorials/upload",
  authenticateToken,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    // Keep socket alive during long upload
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0); // Disable timeout

    const userId = req.user?.user_id;
    const userRole = req.user?.role;

    // Check if user is super_admin
    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Only super_admin users can upload tutorial videos"
      });
    }

    const videoFile = req.files?.video?.[0];
    if (!videoFile) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const { title, description, category, duration_seconds, order_index } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    try {
      // Generate relative URL for the video
      const videoUrl = `/assets/videos/tutorials/${videoFile.filename}`;

      // Generate thumbnail URL if thumbnail was uploaded
      let thumbnailUrl = null;
      const thumbnailFile = req.files?.thumbnail?.[0];
      if (thumbnailFile) {
        thumbnailUrl = `/assets/images/tutorials/${thumbnailFile.filename}`;
      }

      const result = await query(
        `INSERT INTO tutorial_videos
         (title, description, video_url, thumbnail_url, category, duration_seconds, order_index, uploaded_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          description || null,
          videoUrl,
          thumbnailUrl,
          category || null,
          duration_seconds ? parseInt(duration_seconds) : null,
          order_index ? parseInt(order_index) : 0,
          userId,
        ]
      );

      const tutorialVideoId = result.insertId;

      logger.log(`✅ Tutorial video uploaded: ${title} (ID: ${tutorialVideoId}) by user ${userId}${thumbnailUrl ? " with thumbnail" : ""}`);

      res.json({
        success: true,
        tutorial_video_id: tutorialVideoId,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
        message: "Tutorial video uploaded successfully",
      });
    } catch (err) {
      logger.error("❌ Error uploading tutorial video:", err);

      // Clean up uploaded files on error
      if (videoFile?.path) fs.unlinkSync(videoFile.path);
      if (req.files?.thumbnail?.[0]?.path) fs.unlinkSync(req.files.thumbnail[0].path);

      res.status(500).json({ error: "Failed to upload tutorial video" });
    }
  }
);

// ──────────────────────────────────────────────────────────────────
// PUT /api/tutorials/:id
// Update tutorial video metadata (super_admin only)
// ──────────────────────────────────────────────────────────────────
router.put("/api/tutorials/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userRole = req.user?.role;

  if (userRole !== "super_admin") {
    return res.status(403).json({
      error: "Only super_admin users can update tutorial videos"
    });
  }

  const { title, description, category, duration_seconds, order_index, is_active } = req.body;

  try {
    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (category !== undefined) {
      updates.push("category = ?");
      params.push(category);
    }
    if (duration_seconds !== undefined) {
      updates.push("duration_seconds = ?");
      params.push(duration_seconds ? parseInt(duration_seconds) : null);
    }
    if (order_index !== undefined) {
      updates.push("order_index = ?");
      params.push(parseInt(order_index));
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(id);

    const result = await query(
      `UPDATE tutorial_videos SET ${updates.join(", ")} WHERE tutorial_video_id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Tutorial video not found" });
    }

    logger.log(`✅ Tutorial video ${id} updated`);
    res.json({ success: true, message: "Tutorial video updated successfully" });
  } catch (err) {
    logger.error("❌ Error updating tutorial video:", err);
    res.status(500).json({ error: "Failed to update tutorial video" });
  }
});

// ──────────────────────────────────────────────────────────────────
// DELETE /api/tutorials/:id
// Soft delete tutorial video (super_admin only)
// ──────────────────────────────────────────────────────────────────
router.delete("/api/tutorials/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userRole = req.user?.role;

  if (userRole !== "super_admin") {
    return res.status(403).json({
      error: "Only super_admin users can delete tutorial videos"
    });
  }

  try {
    const result = await query(
      "UPDATE tutorial_videos SET is_active = FALSE WHERE tutorial_video_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Tutorial video not found" });
    }

    logger.log(`✅ Tutorial video ${id} deactivated`);
    res.json({ success: true, message: "Tutorial video deleted successfully" });
  } catch (err) {
    logger.error("❌ Error deleting tutorial video:", err);
    res.status(500).json({ error: "Failed to delete tutorial video" });
  }
});

  return router;
}
