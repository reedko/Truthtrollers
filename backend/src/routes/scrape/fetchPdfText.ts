// 📁 backend/routes/scrape/fetchPdfText.ts
import express from "express";
import { fetchPdfTextHandler } from "../../controllers/scrape/fetchPdfTextController";

const router = express.Router();
router.post("/api/fetch-pdf-text", fetchPdfTextHandler);

export default router;
