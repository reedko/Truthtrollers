import express, { Router } from "express";
import multer from "multer";
import path from "path";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { spawn } from "child_process";
import sharp from "sharp";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getYoutubeTranscriptWithPuppeteer } from "../../utils/getYoutubeTranscriptWithPuppeteer.js";
import * as cheerio from "cheerio";
import { DEFAULT_HEADERS } from "../../utils/helpers.js";
import { fetchImageWithPuppeteer } from "../../utils/fetchImageWithPuppeteer.js";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE_URL = process.env.REACT_APP_BASE_URL;
const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;

// ───────────────────────────────────────────────────────────
// Multer Configuration
// ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { type } = req.query;
    // Navigate up to backend directory from routes/misc
    const backendDir = path.resolve(__dirname, "../../../");
    cb(null, path.join(backendDir, `assets/images/${type}`));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const { type, id } = req.query;
    if (!type || !id) return cb(new Error("Missing type or id"));
    // Handle singular form correctly - 'content' stays as 'content', others remove trailing 's'
    const singularType = type === 'content' ? 'content' : type.slice(0, -1);
    cb(null, `${singularType}_id_${id}${ext}`);
  },
});
const upload = multer({ storage });

// ───────────────────────────────────────────────────────────
// Helper Functions
// ───────────────────────────────────────────────────────────
function getRelativePath(absolutePath) {
  // Assuming 'public/' is the part of the path that precedes the relative path
  const index = absolutePath.indexOf("public/");
  if (index !== -1) {
    // Return the path after 'public/'
    return absolutePath.slice(index + "public/".length);
  }
  // If 'public/' is not found, return the original path (or handle as needed)
  return absolutePath;
}

function chooseTitle(metaTitle, lines, url) {
  const saneMeta = sanitizeTitle(metaTitle);
  if (saneMeta) return saneMeta;

  // Find the first plausible title within the first ~25 lines
  const idx = lines.findIndex((l, i) => i < 25 && looksLikeTitleLine(l));
  if (idx >= 0) {
    let t = lines[idx];
    // If line ends with ":" or "-" (subtitle likely on next line), join it
    if (/[–—:\-]\s*$/.test(t) && lines[idx + 1]) {
      t = `${t} ${lines[idx + 1]}`.replace(/\s+/g, " ").trim();
    }

    const sane = sanitizeTitle(t);
    if (sane) return sane;
  }

  // Fallback to URL slug
  const slug = titleFromUrl(url);
  return sanitizeTitle(slug);
}

function looksLikeTitleLine(s) {
  if (!s) return false;
  if (s.length < 10 || s.length > 180) return false;
  const low = s.toLowerCase();

  // Skip boilerplate/admin text common in hearings/papers
  if (
    low.startsWith("entered into the hearing record") ||
    low.startsWith("running head") ||
    low.includes("united states senate") ||
    low.includes("committee on") ||
    /^figure\s+\d+/i.test(s) ||
    /^table\s+\d+/i.test(s) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)
  ) {
    return false;
  }

  // Prefer mixed case words; filter scream-caps short lines
  if (/^[A-Z \-:]+$/.test(s) && s.split(" ").length < 6) return false;
  if (!/[a-z]/.test(s)) return false;

  return true;
}

function sanitizeTitle(t) {
  if (!t) return null;
  t = t.replace(/\s+/g, " ").trim();
  if (t.length < 10) return null;
  // Avoid obvious mid-sentence fragments that start lowercase
  if (/^[a-z]/.test(t) && !/[.!?:]$/.test(t) && t.split(" ").length > 10)
    return null;
  return t.slice(0, 200);
}

function titleFromUrl(u) {
  try {
    const file = new URL(u).pathname.split("/").pop() || "";
    const base = file.replace(/\.pdf$/i, "");
    const parts = base.split(/[_\-]+/).filter(Boolean);
    const filtered = parts.filter((p) => !/^\d+$/.test(p) && p.length >= 3);
    const t = filtered.join(" ").replace(/\s+/g, " ").trim();
    return t ? toTitleCase(t) : null;
  } catch {
    return null;
  }
}

function toTitleCase(s) {
  return s
    .split(" ")
    .map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function choosePdfAuthors(infoAuthor, lines) {
  const out = [];

  const pushClean = (raw) => {
    if (!raw) return;
    let name = raw.trim();
    if (!name) return;

    // 🧹 NEW: strip weird numeric superscripts like MD2,3 or ,1,2
    name = name.replace(/(MD|PhD|MS|MPH|DO|RN|DDS|DVM)\s*\d+(?:,\d+)*/i, "$1");
    name = name.replace(/,\s*\d+(?:,\d+)*/g, "");
    name = name.replace(/\s+\d+(?:,\d+)*/g, "");

    // 🧹 NEW: skip lines that are departments, institutions, etc.
    if (/^henry ford health system/i.test(name)) return;
    if (/^department of/i.test(name)) return;
    if (/^division of/i.test(name)) return;

    if (!out.includes(name)) {
      out.push(name);
    }
  };

  // 1️⃣ First, use Author metadata if present
  if (infoAuthor && infoAuthor.trim()) {
    infoAuthor
      .split(/(?:,|and)\s+/)
      .map((s) => s.trim())
      .forEach(pushClean);
  }

  // 2️⃣ Then, scan first ~15 lines of text for author-style lines
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    if (!line || line.length < 3) continue;

    // detect "PhD", "MD" lines with commas
    if (/(PhD|MD|MS|MPH|RN|DO|DDS|DVM)/.test(line) && /,/.test(line)) {
      line.split(/(?:,| and )+/).forEach(pushClean);
      continue;
    }

    // detect one-per-line author entries
    if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(line) && /(PhD|MD|MS)/.test(line)) {
      pushClean(line);
    }
  }

  return out;
}

function isSubtitleLine(s) {
  if (!s) return false;
  const low = s.toLowerCase();
  // classic subtitle telltales; many lowercase words, no credentials
  if (
    /\b(study|report|review|analysis|cohort|trial|outcome|outcomes|systematic|meta-?analysis)\b/i.test(
      s
    )
  ) {
    if (!/\b(PhD|MD|MS|MPH|DO|RN|DDS|DVM)\b/.test(s) && !looksLikePerson(s))
      return true;
  }
  // if it's Title Case-ish but contains stopwords like "of/in/on/for" and no credentials/names
  if (
    looksLikeSubtitlePhrase(s) &&
    !/\b(PhD|MD|MS|MPH|DO|RN|DDS|DVM)\b/.test(s)
  )
    return true;
  return false;
}

function looksLikeAffiliation(s) {
  return /(university|department|division|school|institute|center|centre|health system|hospital|detroit|michigan|wayne state)/i.test(
    s
  );
}

function looksLikeParagraph(s) {
  var words = s.split(/\s+/).length;
  var commas = (s.match(/,/g) || []).length;
  return (
    words > 14 && commas < 2 && !/\b(PhD|MD|MS|MPH|DO|RN|DDS|DVM)\b/.test(s)
  );
}

// split a single long PDF author line into multiple names
function splitPdfAuthorLine(raw) {
  if (!raw) return [];

  // remove unicode superscripts
  var cleaned = raw.replace(/[\u00B2\u00B3\u00B9\u2070-\u2079]/g, "");
  // remove numeric footnotes attached to degrees: "MD2,3" -> "MD"
  cleaned = cleaned.replace(/\b(PhD|MD|MS|MPH|DO|RN|DDS|DVM)\s*[\d,]+/gi, "$1");
  // normalize " and "
  cleaned = cleaned.replace(/\sand\s/gi, ", ");

  var parts = cleaned.split(/,\s*/).filter(Boolean);
  var authors = [];

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();

    if (isDegree(part)) {
      var prev = authors.pop();
      if (prev) {
        authors.push(prev + ", " + part);
      }
    } else {
      authors.push(part);
    }
  }

  // cut off affiliations after degree
  var final = authors
    .map(function (a) {
      return stripAfterDegree(a);
    })
    .map(function (a) {
      return a.trim();
    });

  // dedupe
  var seen = {};
  return final.filter(function (a) {
    var key = a.toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function isDegree(s) {
  return /^(PhD|MD|MS|MPH|DO|RN|DDS|DVM)$/i.test(s);
}

function stripAfterDegree(s) {
  var m = s.match(/\b(PhD|MD|MS|MPH|DO|RN|DDS|DVM)\b/i);
  if (!m) return s;
  var end = m.index + m[0].length;
  return s.slice(0, end);
}

function looksLikeSubtitlePhrase(s) {
  const low = s.toLowerCase();
  return (
    /\b(of|and|in|on|for|with|by|to|from|the|a|an)\b/.test(low) &&
    !/\b[A-Z]{2,}\b/.test(s)
  );
}

function looksLikePerson(s) {
  // "Firstname M. Lastname" or "Firstname Lastname" (allow hyphen/apos)
  return /\b[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?\b/.test(
    s
  );
}

function spawnPdftocairo(inputPdf, outputBase) {
  return new Promise((resolve, reject) => {
    const proc = spawn("/usr/local/bin/pdftocairo", [
      "-png",
      "-f",
      "1", // from page 1
      "-l",
      "1", // to page 1 (only first page)
      "-singlefile",
      "-scale-to",
      "1024",
      inputPdf,
      outputBase,
    ]);

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftocairo exited with code ${code}`));
    });
  });
}

export default function createMiscRoutes({ query, pool, db }) {
  const router = Router();

  // ───────────────────────────────────────────────────────────
  // Image Upload Route
  // ───────────────────────────────────────────────────────────
  router.post("/api/upload-image", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");
    const { type, id } = req.query;
    const imagePath = `assets/images/${type}/${req.file.filename}`;

    console.log(`📤 Upload-image: type=${type}, id=${id}, file=${req.file.filename}`);
    console.log(`📁 Image path: ${imagePath}`);

    let updateSql = "";
    let column = "";

    switch (type) {
      case "authors":
        updateSql =
          "UPDATE authors SET author_profile_pic = ? WHERE author_id = ?";
        break;
      case "publishers":
        updateSql =
          "UPDATE publishers SET publisher_icon = ? WHERE publisher_id = ?";
        break;
      case "users":
        updateSql = "UPDATE users SET user_profile_image = ? WHERE user_id = ?";
        break;
      case "content":
        // For TextPad submissions, only update thumbnail and keep URL pointing to text file
        // For other content, update both thumbnail and url
        updateSql = "UPDATE content SET thumbnail = ?, url = CASE WHEN media_source = 'TextPad' THEN url ELSE ? END WHERE content_id = ?";
        break;
      default:
        return res.status(400).json({ error: "Invalid type" });
    }

    // For content, we need to update both thumbnail and url
    const params = type === "content"
      ? [imagePath, imagePath, id]  // thumbnail, url (conditional), content_id
      : [imagePath, id];              // single field, id

    console.log(`🔧 Executing SQL: ${updateSql} with`, params);

    pool.query(updateSql, params, (err, result) => {
      if (err) {
        console.error("❌ Image update error:", err);
        return res.status(500).json({ error: "Failed to update image path" });
      }

      console.log(`✅ Database updated:`, result);
      console.log(`✅ Rows affected: ${result.affectedRows}`);

      return res.status(200).json({
        message: "Upload successful",
        path: imagePath,
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // NOTE: /proxy route is defined in server.js as a top-level route
  // ───────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────
  // YouTube Transcript Routes
  // ───────────────────────────────────────────────────────────
  router.get("/api/youtube-transcript/:videoId", async (req, res) => {
    const { videoId } = req.params;

    try {
      const transcriptText = await getYoutubeTranscriptWithPuppeteer(videoId);
      res.json({ success: true, transcriptText });
    } catch (err) {
      console.error("❌ Server error fetching transcript:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch transcript." });
    }
  });

  router.post("/api/youtube-transcript/:videoId", async (req, res) => {
    const { videoId } = req.params;
    const { html, url } = req.body;

    try {
      const transcriptText = await getYoutubeTranscriptWithPuppeteer(
        videoId,
        html,
        url
      ); // optionally use html or url
      res.json({ success: true, transcriptText });
    } catch (err) {
      console.error("❌ Server error fetching transcript:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch transcript." });
    }
  });

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
      const [result] = await db.query(
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

  // ───────────────────────────────────────────────────────────
  // Readability Route
  // ───────────────────────────────────────────────────────────
  router.post("/api/extract-readable-text", (req, res) => {
    const { html, url } = req.body;

    if (!html) {
      return res
        .status(400)
        .json({ success: false, message: "Missing HTML content" });
    }
    try {
      const dom = new JSDOM(html, { url });
      const doc = dom.window.document;
      const article = new Readability(doc).parse();

      res.send({
        success: true,
        text: article?.textContent || null,
        title: article?.title || null,
        author: article?.byline || null, // 👈 here's the author
      });
    } catch (err) {
      console.warn("⚠️ Readability server-side failed:", err);
      res
        .status(500)
        .json({ success: false, message: "Readability parse failed" });
    }
  });

  // ───────────────────────────────────────────────────────────
  // PDF Routes
  // ───────────────────────────────────────────────────────────
  router.get("/api/check-pdf-head", async (req, res) => {
    const url = req.query.url;
    console.log(url, "incheck-pdf-head");
    try {
      const headRes = await fetch(url, {
        method: "HEAD",
        headers: DEFAULT_HEADERS,
        redirect: "follow"
      });
      const contentType = headRes.headers.get("content-type") || "";
      const isPdf = contentType.includes("application/pdf");
      console.log(`📋 Content-Type for ${url}: ${contentType} → isPdf: ${isPdf}`);
      res.json({ isPdf });
    } catch (e) {
      console.error(`❌ check-pdf-head error for ${url}:`, e.message);
      res.json({ isPdf: false, error: e.message });
    }
  });

  // New endpoint: parse PDF from blob (sent by extension after loading in browser)
  // Use express.raw() middleware to get raw binary data
  router.post("/api/parse-pdf-blob", express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
    console.log("📩 /api/parse-pdf-blob route hit, blob size:", req.body?.length || 0, "type:", typeof req.body);

    try {
      // Validate we received data
      if (!req.body) {
        return res.status(400).json({ success: false, error: "No PDF data received (body is null/undefined)" });
      }

      // req.body should be the raw PDF buffer
      let buffer;
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (req.body instanceof ArrayBuffer) {
        buffer = Buffer.from(req.body);
      } else if (typeof req.body === 'object' && req.body.type === 'Buffer') {
        buffer = Buffer.from(req.body.data);
      } else {
        console.error("❌ Unexpected req.body type:", typeof req.body, req.body.constructor?.name);
        return res.status(400).json({ success: false, error: `Invalid data type: ${typeof req.body}` });
      }

      if (!buffer || buffer.length < 100) {
        return res.status(400).json({ success: false, error: `PDF data too small: ${buffer?.length || 0} bytes` });
      }

      console.log(`📦 Processing PDF buffer: ${buffer.length} bytes`);

      const parsed = await pdfParse(buffer);

      let fullText = (parsed.text || "").replace(/\r/g, "");

      // Strip XMP metadata
      fullText = fullText.replace(/<\?xpacket[\s\S]*?<\?xpacket end.*?\?>/gi, '');
      fullText = fullText.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
      fullText = fullText.replace(/<rdf:RDF[\s\S]*?<\/rdf:RDF>/gi, '');
      fullText = fullText.replace(/\n{3,}/g, '\n\n').trim();

      const infoTitle = (parsed.info && parsed.info.Title ? parsed.info.Title : "").trim();
      const infoAuthor = (parsed.info && parsed.info.Author ? parsed.info.Author : "").trim();

      const head = fullText.slice(0, 4000);
      const lines = head.split(/\n+/).map((s) => s.trim()).filter(Boolean);

      const title = chooseTitle(infoTitle, lines, "PDF");
      const authors = choosePdfAuthors(infoAuthor, lines);

      console.log("📄 Parsed PDF from blob:", { title, authors, textLength: fullText.length });

      res.json({
        success: true,
        text: fullText,
        title: title || "",
        authors: authors,
        rawAuthor: infoAuthor,
      });
    } catch (err) {
      console.error("❌ PDF blob parse failed:", err);
      const errorMsg = err.message || String(err);
      const isInvalidPdf = errorMsg.includes('Invalid PDF') || errorMsg.includes('PDF structure');

      res.status(500).json({
        success: false,
        error: isInvalidPdf
          ? "This PDF has an invalid structure that cannot be parsed."
          : `PDF parsing error: ${errorMsg}`
      });
    }
  });

  router.post("/api/fetch-pdf-text", async (req, res) => {
    const { url } = req.body;
    console.log("📩 /api/fetch-pdf-text route hit:", url);

    try {
      // Use browser-like headers to avoid getting blocked
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS
      });

      // Check if we got HTML instead of PDF (access denied, etc)
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.error("❌ Server returned HTML instead of PDF - likely access denied or requires browser");
        return res.status(403).send({
          success: false,
          error: "PDF fetch blocked - server requires browser access. Use extension to load PDF in tab instead."
        });
      }

      const buffer = await response.arrayBuffer();
      const parsed = await pdfParse(Buffer.from(buffer));

      let fullText = (parsed.text || "").replace(/\r/g, "");

      console.log(`📄 Raw PDF text length: ${fullText.length} chars, ${parsed.numpages} pages`);
      console.log(`📄 First 500 chars of raw text:`, fullText.slice(0, 500));

      // Strip XMP metadata blocks that pdf-parse sometimes includes
      // These blocks start with <?xpacket and end with <?xpacket end
      const beforeMetadataStrip = fullText.length;
      fullText = fullText.replace(/<\?xpacket[\s\S]*?<\?xpacket end.*?\?>/gi, '');

      // Also strip other common metadata patterns
      fullText = fullText.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
      fullText = fullText.replace(/<rdf:RDF[\s\S]*?<\/rdf:RDF>/gi, '');

      // Clean up excessive whitespace
      fullText = fullText.replace(/\n{3,}/g, '\n\n').trim();

      console.log(`📄 After metadata strip: ${fullText.length} chars (removed ${beforeMetadataStrip - fullText.length} chars)`);
      console.log(`📄 First 500 chars after cleanup:`, fullText.slice(0, 500));

      const infoTitle = (
        parsed.info && parsed.info.Title ? parsed.info.Title : ""
      ).trim();
      const infoAuthor = (
        parsed.info && parsed.info.Author ? parsed.info.Author : ""
      ).trim();

      // take the first chunk of text to mine title/authors
      const head = fullText.slice(0, 4000);
      const lines = head
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const title = chooseTitle(infoTitle, lines, url);
      const authors = choosePdfAuthors(infoAuthor, lines);

      console.log("📄 Final inferred PDF metadata:", { title, authors, textLength: fullText.length });

      res.send({
        success: true,
        text: fullText,
        title: title || "",
        authors: authors, // 👈 array of strings
        rawAuthor: infoAuthor, // 👈 optional, for debugging
      });
    } catch (err) {
      console.error("❌ PDF parse failed:", err);
      const errorMsg = err.message || String(err);
      const isInvalidPdf = errorMsg.includes('Invalid PDF') || errorMsg.includes('PDF structure');

      res.status(500).send({
        success: false,
        error: isInvalidPdf
          ? "This PDF has an invalid structure that cannot be parsed. The PDF may be corrupted or use a non-standard format."
          : `PDF parsing error: ${errorMsg}`
      });
    }
  });

  router.post("/api/pdf-thumbnail", async (req, res) => {
    const { url } = req.body;
    console.log("TRYING PDF THUMBNAL");

    try {
      // Navigate up to backend directory from routes/misc
      const backendDir = path.resolve(__dirname, "../../../");

      // 2) Download the PDF into a temp folder
      const tempDir = path.join(backendDir, "temp");
      fs.mkdirSync(tempDir, { recursive: true });

      const pdfFilename = `pdf-${Date.now()}.pdf`;
      const pdfPath = path.join(tempDir, pdfFilename);

      const writer = fs.createWriteStream(pdfPath);
      const response = await axios.get(url, { responseType: "stream" });
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // 3) Use pdftocairo (via child_process.spawn) to convert the first PDF page to PNG
      const outputBase = path.join(tempDir, `thumb-${Date.now()}`);
      await spawnPdftocairo(pdfPath, outputBase);

      // pdftocairo produces `outputBase-1.png` for the first page
      const firstPagePath = `${outputBase}.png`;

      // 4) Resize that PNG to 600×800 with sharp
      const finalImagePath = path.join(
        backendDir,
        "assets/pdf-thumbnails",
        `thumb-${Date.now()}.png`
      );
      fs.mkdirSync(path.dirname(finalImagePath), { recursive: true });

      await sharp(firstPagePath).resize(600, 800).toFile(finalImagePath);

      // 5) Clean up temporary files
      fs.removeSync(pdfPath);
      fs.removeSync(firstPagePath);

      // 6) Return a public URL to the generated thumbnail
      const publicUrl = `${BASE_URL}/assets/pdf-thumbnails/${path.basename(
        finalImagePath
      )}`;
      console.log(publicUrl, "PDF IMAGE URL");
      res.send({ success: true, imageUrl: publicUrl });
    } catch (err) {
      console.error("❌ Failed to generate PDF thumbnail:", err);
      res.status(500).send({ success: false });
    }
  });

  router.get("/api/proxy-pdf", async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).send("missing url");
    const r = await fetch(url, {
      redirect: "follow",
      headers: DEFAULT_HEADERS
    });
    if (!r.ok) return res.status(r.status).send("upstream error");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/pdf");
    const buffer = await r.arrayBuffer();
    res.send(Buffer.from(buffer));
  });

  // ───────────────────────────────────────────────────────────
  // Test Connection Route
  // ───────────────────────────────────────────────────────────
  router.get("/api/test-connection", (req, res) => {
    pool.query("SELECT 1 + 1 AS solution", (err, results) => {
      if (err) {
        console.error("Error testing connection:", err);
        return res.status(500).json({ error: "Connection test failed" });
      }
      res.json({
        message: "Connection is working",
        solution: results[0].solution,
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Scrape Content Route
  // ───────────────────────────────────────────────────────────
  router.get("/api/scrapecontent", async (req, res) => {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send("No URL provided");
    }

    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      // Extract specific elements, e.g., article text
      const articleContent = $("article").html(); // Adjust selector as needed

      res.send(articleContent); // Return the extracted HTML
    } catch (error) {
      console.error("Error fetching the URL:", error);
      res.status(500).send("Error fetching the URL");
    }
  });

  // ───────────────────────────────────────────────────────────
  // Extract Text Route (Readability)
  // ───────────────────────────────────────────────────────────
  router.post("/api/extractText", async (req, res) => {
    try {
      let { url, html } = req.body;

      if (!url) {
        return res
          .status(400)
          .json({ success: false, error: "No URL provided" });
      }

      // ✅ If HTML is provided, use it instead of fetching
      if (html) {
        console.log("✅ Received HTML from the browser, skipping axios.get");
      } else {
        console.log("🌍 Fetching page via axios.get:", url);
        const { data } = await axios.get(url, {
          timeout: 5000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          },
        });
        html = data;
      }

      // ✅ Process the HTML using Readability
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        return res
          .status(500)
          .json({ success: false, error: "Failed to parse article" });
      }

      res.json({
        success: true,
        title: article.title,
        content: article.content,
        textContent: article.textContent,
        excerpt: article.excerpt,
      });
    } catch (error) {
      console.error("❌ Error in /api/extractText:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ───────────────────────────────────────────────────────────
  // Fetch Image with Puppeteer
  // ───────────────────────────────────────────────────────────
  router.post("/api/fetch-image-with-puppeteer", async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({ error: "Missing or invalid imageUrl" });
    }

    try {
      const buffer = await fetchImageWithPuppeteer(imageUrl);

      // Send as image/binary for backend processing
      res.set("Content-Type", "image/jpeg");
      res.send(buffer);
    } catch (err) {
      console.error("🧨 Puppeteer image error:", err.message);
      res
        .status(500)
        .json({ error: "Puppeteer image fetch error", details: err.message });
    }
  });

  // ───────────────────────────────────────────────────────────
  // Fetch with Puppeteer (Extension compatibility route)
  // ───────────────────────────────────────────────────────────
  router.post("/api/fetch-with-puppeteer", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing or invalid URL" });
    }

    try {
      console.log(`🧠 Puppeteer fetching: ${url}`);

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
      await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      const html = await page.content();
      await browser.close();

      console.log(`✅ Puppeteer fetched ${html.length} chars`);
      return res.json({ success: true, html });
    } catch (err) {
      console.error("🧨 Puppeteer error:", err.message);
      return res.status(500).json({ success: false, error: "Puppeteer error" });
    }
  });

  // ───────────────────────────────────────────────────────────
  // Fetch Page Content (Axios fallback to Puppeteer)
  // ───────────────────────────────────────────────────────────
  router.post("/api/fetch-page-content", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Invalid or missing URL" });
    }

    try {
      console.log(`🌍 Axios fetching: ${url}`);

      const response = await axios.get(url, {
        headers: {
          ...DEFAULT_HEADERS,
          Referer: url,
        },
        timeout: 10000,
      });

      console.log(`✅ Axios fetched ${response.data.length} chars`);
      return res.json({ html: response.data, source: "axios" });
    } catch (axiosError) {
      console.warn(
        "⚠️ Axios failed, falling back to Puppeteer...",
        axiosError.message
      );
    }

    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
      await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      const html = await page.content();
      await browser.close();

      console.log(`✅ Puppeteer fetched ${html.length} chars`);
      return res.json({ html, source: "puppeteer" });
    } catch (puppeteerError) {
      console.error("❌ Puppeteer failed:", puppeteerError.message);
      return res
        .status(500)
        .json({ error: "Both Axios and Puppeteer failed to fetch content" });
    }
  });

  // ───────────────────────────────────────────────────────────
  // Pre-scrape Route (Diffbot)
  // ───────────────────────────────────────────────────────────
  router.post("/api/pre-scrape", async (req, res) => {
    const { articleUrl } = req.body;

    if (!articleUrl) {
      return res.status(400).json({ error: "articleUrl is required" });
    }

    try {
      const diffbotResponse = await axios.get(`${DIFFBOT_BASE_URL}/article`, {
        params: {
          token: DIFFBOT_TOKEN,
          url: articleUrl,
          fields:
            "publisher,categories,title,author,images,meta,articleType,robots",
        },
      });

      // Ensure 'objects' exists and contains at least one item
      if (
        !diffbotResponse.data.objects ||
        !Array.isArray(diffbotResponse.data.objects) ||
        diffbotResponse.data.objects.length === 0
      ) {
        console.warn("Diffbot returned no objects, sending empty data.");
        return res.status(200).json({
          success: true,
          publisher: "",
          title: "",
          author: "",
          categories: [],
          images: [],
        });
      }

      const diffbotData = diffbotResponse.data.objects[0];

      const {
        title = "",
        author = "",
        categories = [],
        images = [],
        siteName, // Backup publisher name
        meta = {}, // Default empty object
      } = diffbotData;

      const publisher =
        meta.microdata?.publisher?.name || siteName || "Unknown Publisher";

      res.status(200).json({
        success: true,
        publisher,
        title,
        author,
        categories,
        images,
      });
    } catch (error) {
      console.warn("Diffbot request failed. Returning empty data.");

      // Return a 200 response even if Diffbot fails
      res.status(200).json({
        success: false,
        publisher: "",
        title: "",
        author: "",
        categories: [],
        images: [],
      });
    }
  });

  // ───────────────────────────────────────────────────────────
  // Image Serving with Auto Extension Detection (Async)
  // ───────────────────────────────────────────────────────────
  router.get("/api/image/:type/:id", async (req, res) => {
    const { type, id } = req.params;

    // Validate type
    const validTypes = ['authors', 'publishers', 'content'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Must be authors, publishers, or content' });
    }

    // Navigate up to backend directory from routes/misc
    const backendDir = path.resolve(__dirname, "../../../");
    const imageDir = path.join(backendDir, `assets/images/${type}`);

    // Build base filename without extension
    // Handle the singular form correctly
    const singularType = type === 'content' ? 'content' : type.slice(0, -1);
    const baseFilename = `${singularType}_id_${id}`;

    // Try different extensions in order of preference
    const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    // Use async file checking to avoid blocking the event loop
    for (const ext of extensions) {
      const fullPath = path.join(imageDir, baseFilename + ext);

      try {
        // Check if file exists asynchronously
        await fs.promises.access(fullPath, fs.constants.F_OK);
        // File exists, serve it
        return res.sendFile(fullPath);
      } catch (err) {
        // File doesn't exist, continue to next extension
        continue;
      }
    }

    // No image found with any extension
    console.log(`❌ No image found for ${type}/${id} (tried ${extensions.join(', ')})`);
    return res.status(404).json({ error: 'Image not found' });
  });

  return router;
}
