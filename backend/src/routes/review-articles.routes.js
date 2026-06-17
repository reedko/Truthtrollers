import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import {
  assembleMarkdownFromModules,
  ensureReviewArticlesTable,
  generateReviewArticleDraft,
  generateReviewArticleEssay,
  attachWorkspaceSnapshotToReviewArticle,
  ensureVisualAssetsForModules,
  rebuildReviewArticleModules,
  getReviewClaimLinksData,
  getReviewArticleById,
  getReviewArticleBySlug,
  buildReviewArticleDocx,
  makeSlug,
  normalizeArticlePayload,
} from "../services/reviewArticleService.js";

function canEditArticle(req, article) {
  return article && (article.author_user_id === req.user?.user_id || req.user?.role === "super_admin");
}

export default function createReviewArticlesRouter({ query }) {
  const router = Router();

  router.get("/api/reviews/:contentId/claim-links", authenticateToken, async (req, res) => {
    try {
      const contentId = Number(req.params.contentId);
      if (!Number.isInteger(contentId) || contentId <= 0) {
        return res.status(400).json({ error: "valid contentId is required" });
      }

      const data = await getReviewClaimLinksData(query, contentId, req.user.user_id);
      res.json(data);
    } catch (error) {
      console.error("Error fetching review claim links:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to fetch review claim links" });
    }
  });

  router.post("/api/review-articles/generate", authenticateToken, async (req, res) => {
    try {
      const contentId = Number(req.body?.content_id);
      if (!Number.isInteger(contentId) || contentId <= 0) {
        return res.status(400).json({ error: "content_id is required" });
      }

      const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
      const article = await generateReviewArticleDraft(query, contentId, req.user.user_id, {
        reviewId: req.body?.review_id || null,
        publicBaseUrl,
      });

      res.status(201).json({ success: true, article });
    } catch (error) {
      console.error("Error generating review article:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to generate review article" });
    }
  });

  router.post("/api/review-articles/workspace-snapshot", authenticateToken, async (req, res) => {
    try {
      const contentId = Number(req.body?.content_id);
      const articleId = req.body?.article_id ? Number(req.body.article_id) : null;
      const dataUrl = req.body?.data_url;
      const moduleId = req.body?.module_id || req.body?.moduleId;
      if (!Number.isInteger(contentId) || contentId <= 0) {
        return res.status(400).json({ error: "content_id is required" });
      }
      if (!dataUrl) {
        return res.status(400).json({ error: "data_url is required" });
      }

      const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await attachWorkspaceSnapshotToReviewArticle(query, {
        contentId,
        userId: req.user.user_id,
        articleId,
        dataUrl,
        moduleId,
        publicBaseUrl,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error attaching workspace snapshot:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to attach workspace snapshot" });
    }
  });

  router.get("/api/review-articles/:id", authenticateToken, async (req, res) => {
    try {
      const article = await getReviewArticleById(query, Number(req.params.id));
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (article.status !== "published" && !canEditArticle(req, article)) {
        return res.status(403).json({ error: "Not authorized to view this draft" });
      }
      res.json({ success: true, article });
    } catch (error) {
      console.error("Error fetching review article:", error);
      res.status(500).json({ error: "Failed to fetch review article" });
    }
  });

  router.put("/api/review-articles/:id", authenticateToken, async (req, res) => {
    try {
      await ensureReviewArticlesTable(query);
      const id = Number(req.params.id);
      const article = await getReviewArticleById(query, id);
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (!canEditArticle(req, article)) return res.status(403).json({ error: "Not authorized to edit this article" });

      const payload = normalizeArticlePayload(req.body || {});
      const nextModules = payload.modules_json ?? article.modules_json;
      const nextBody = payload.body_markdown ?? assembleMarkdownFromModules(nextModules);
      const nextStatus = payload.status && ["draft", "published"].includes(payload.status) ? payload.status : article.status;

      await query(
        `
          UPDATE review_articles
          SET title = ?,
              summary = ?,
              verdict = ?,
              confidence = ?,
              body_markdown = ?,
              modules_json = ?,
              status = ?
          WHERE id = ?
        `,
        [
          payload.title ?? article.title,
          payload.summary ?? article.summary,
          payload.verdict ?? article.verdict,
          payload.confidence ?? article.confidence,
          nextBody,
          JSON.stringify(nextModules),
          nextStatus,
          id,
        ],
      );

      res.json({ success: true, article: await getReviewArticleById(query, id) });
    } catch (error) {
      console.error("Error updating review article:", error);
      res.status(500).json({ error: "Failed to update review article" });
    }
  });

  router.post("/api/review-articles/:id/publish", authenticateToken, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const article = await getReviewArticleById(query, id);
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (!canEditArticle(req, article)) return res.status(403).json({ error: "Not authorized to publish this article" });

      const slug = article.slug || makeSlug(article.title, id);
      await query(
        `
          UPDATE review_articles
          SET status = 'published',
              slug = ?,
              published_at = COALESCE(published_at, NOW())
          WHERE id = ?
        `,
        [slug, id],
      );

      res.json({ success: true, article: await getReviewArticleById(query, id) });
    } catch (error) {
      console.error("Error publishing review article:", error);
      res.status(500).json({ error: "Failed to publish review article" });
    }
  });

  router.post("/api/review-articles/:id/generate-essay", authenticateToken, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const article = await getReviewArticleById(query, id);
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (!canEditArticle(req, article)) return res.status(403).json({ error: "Not authorized to draft this article" });

      const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await generateReviewArticleEssay(query, id, article.author_user_id, {
        ...(req.body || {}),
        publicBaseUrl,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error generating review article essay:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to generate article essay" });
    }
  });

  router.post("/api/review-articles/:id/ensure-assets", authenticateToken, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const article = await getReviewArticleById(query, id);
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (!canEditArticle(req, article)) return res.status(403).json({ error: "Not authorized to update this article" });

      const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
      const modules = await rebuildReviewArticleModules(query, article, publicBaseUrl);
      const nextBody = article.body_markdown || assembleMarkdownFromModules(modules);
      await query(
        "UPDATE review_articles SET modules_json = ?, body_markdown = ? WHERE id = ?",
        [JSON.stringify(modules), nextBody, id],
      );
      res.json({ success: true, article: await getReviewArticleById(query, id) });
    } catch (error) {
      console.error("Error ensuring review article assets:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to ensure article assets" });
    }
  });

  router.get("/api/public/review-articles/:slug", async (req, res) => {
    try {
      const article = await getReviewArticleBySlug(query, req.params.slug);
      if (!article) return res.status(404).json({ error: "Published review article not found" });
      res.json({ success: true, article });
    } catch (error) {
      console.error("Error fetching public review article:", error);
      res.status(500).json({ error: "Failed to fetch public review article" });
    }
  });

  router.get("/api/review-articles/:id/export/markdown", authenticateToken, async (req, res) => {
    try {
      const article = await getReviewArticleById(query, Number(req.params.id));
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (article.status !== "published" && !canEditArticle(req, article)) {
        return res.status(403).json({ error: "Not authorized to export this draft" });
      }

      const markdown = [
        `# ${article.title}`,
        "",
        article.body_markdown || assembleMarkdownFromModules(article.modules_json) || "",
      ].join("\n");

      res.type("text/markdown").send(markdown);
    } catch (error) {
      console.error("Error exporting markdown:", error);
      res.status(500).json({ error: "Failed to export markdown" });
    }
  });

  router.get("/api/review-articles/:id/export/docx", authenticateToken, async (req, res) => {
    try {
      const article = await getReviewArticleById(query, Number(req.params.id));
      if (!article) return res.status(404).json({ error: "Review article not found" });
      if (article.status !== "published" && !canEditArticle(req, article)) {
        return res.status(403).json({ error: "Not authorized to export this draft" });
      }

      const docx = await buildReviewArticleDocx(article);
      const filename = `${makeSlug(article.title, article.id)}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(docx);
    } catch (error) {
      console.error("Error exporting DOCX:", error);
      res.status(500).json({ error: error.message || "Failed to export DOCX" });
    }
  });

  return router;
}
