// 📁 backend/routes/scrape/fetchPageContent.ts
import express from "express";
import { fetchPageContentHandler } from "../../controllers/scrape/fetchPageContentController";

const router = express.Router();

router.post("/api/fetch-page-content", fetchPageContentHandler);

export default router;
