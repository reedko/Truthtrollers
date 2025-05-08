// 📁 backend/controllers/scrape/fetchPdfTextController.ts
import { Request, Response } from "express";
import fetch from "node-fetch";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const fetchPdfTextHandler = async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const parsed = await pdfParse(Buffer.from(buffer));
    const author = parsed.info?.Author || "";
    const title = parsed.info?.Title || "";
    console.log("📄 PDF parsed OK:", { title, author });

    res.send({
      success: true,
      text: parsed.text,
      author,
      title,
    });
  } catch (err) {
    console.error("❌ PDF parse failed:", err);
    res.status(500).send({ success: false });
  }
};
