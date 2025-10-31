// Import dependencies
import { fetchIconForTopic } from "./utils/fetchIconForTopic.js";
import express from "express";
import mysql from "mysql";
import bodyParser from "body-parser";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  getNodesForEntity,
  getLinksForEntity,
  getLinkedClaimsAndLinksForTask,
} from "./database/graphQueries.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import fs from "fs-extra";
import http from "http";
import https from "https";
import fetchWithPuppeteer from "./routes/fetchWithPuppeteer.js"; //
import { DEFAULT_HEADERS } from "./routes/fetchWithPuppeteer.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { spawn } from "child_process";
import registerDiscussionRoutes from "./routes/discussionRoutes.js";
import registerBeaconRoutes from "./routes/beaconRoutes.js";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { decodeJwt } from "./utils/jwt.js";

import { parseOrRepairJSON } from "./utils/repairJson.js";
import { createSessionLogger } from "./utils/sessionLogger.js";
import { getYoutubeTranscriptWithPuppeteer } from "./utils/getYoutubeTranscriptWithPuppeteer.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendResetEmail = async (to, link) => {
  await transporter.sendMail({
    from: `"TruthTrollers" <${process.env.SMTP_USER}>`,
    to,
    subject: "Reset your password",
    html: `<p>Click to reset: <a href="${link}">${link}</a></p>`,
  });
};

//const pdfParse = pkg.default || pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

app.listen(3000, () => {
  console.log("✅ Node backend running on http://localhost:3000");
});
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// Configure environment variables
dotenv.config();
// ✅ Puppeteer route
app.use(fetchWithPuppeteer);
app.use(cors());
const allowedOrigins = [
  "http://localhost:5173", // for dev dashboard
  "https://truthtrollers.com", // for deployed dashboard
  "chrome-extension://phacjklngoihnlhcadefaiokbacnagbf", // allow Chrome extension
  "safari-web-extension://<your-safari-id>", // allow Safari extension
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
// Serve static files from the assets directory

const assetsPath = path.join(__dirname, "assets");
const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;
const BASE_URL = process.env.REACT_APP_BASE_URL;
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

app.use("/assets", express.static(assetsPath));

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

const query = promisify(db.query).bind(db);

const { logSuccessfulLogin, logFailedLogin, logRegistrationAttempt } =
  createSessionLogger(query);

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

db.connect((err) => {
  if (err) throw err;
  //console.log("MySQL connected!");
});
//image uploading

// Define storage location and filename strategy

registerDiscussionRoutes(app, query, pool);
registerBeaconRoutes(app, query, pool);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { type, id } = req.query;
    //const type = req.params.type; // "authors" or "publishers"
    cb(null, path.join(__dirname, `assets/images/${type}`));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const { type, id } = req.query;
    if (!type || !id) {
      return cb(new Error("Missing type or id"));
    }
    cb(null, `${type.slice(0, -1)}_id_${id}${ext}`);
  },
});

//upload image
const upload = multer({ storage });

// Unified image upload endpoint
app.post("/api/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");
  const { type, id } = req.query;
  const imagePath = `assets/images/${type}/${req.file.filename}`;

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
    default:
      return res.status(400).json({ error: "Invalid type" });
  }

  pool.query(updateSql, [imagePath, id], (err) => {
    if (err) {
      console.error("Image update error:", err);
      return res.status(500).json({ error: "Failed to update image path" });
    }

    return res.status(200).json({
      message: "Upload successful",
      path: imagePath,
    });
  });
});

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

app.get("/proxy", async (req, res) => {
  const { url } = req.query; // Pass the target URL as a query parameter
  if (!url) return res.status(400).send("URL is required");

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9", // Optional: Set additional headers
      },
    });
    ////console.log("respose:", response);
    res.send(response.data);
  } catch (error) {
    console.error("Error fetching the URL:");
    res.status(500).send("Failed to fetch data");
  }
});

//youtubetranscripts:
// backend/routes/youtubeTranscript.ts
app.get("/api/youtube-transcript/:videoId", async (req, res) => {
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

app.post("/store-content", async (req, res) => {
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

app.post("/api/youtube-transcript/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const { html, url } = req.body;

  try {
    const transcriptText = await (videoId, html, url); // optionally use html or url
    res.json({ success: true, transcriptText });
  } catch (err) {
    console.error("❌ Server error fetching transcript:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch transcript." });
  }
});

//readability
app.post("/api/extract-readable-text", (req, res) => {
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
      author: article?.byline || null, // 👈 here’s the author
    });
  } catch (err) {
    console.warn("⚠️ Readability server-side failed:", err);
    res
      .status(500)
      .json({ success: false, message: "Readability parse failed" });
  }
});

//prse pdfs:
app.get("/api/check-pdf-head", async (req, res) => {
  const url = req.query.url;
  console.log(url, "incheck-pdf-head");
  try {
    const headRes = await fetch(url, { method: "HEAD" });
    const contentType = headRes.headers.get("content-type") || "";
    res.json({ isPdf: contentType.includes("application/pdf") });
  } catch (e) {
    res.json({ isPdf: false, error: e.message });
  }
});

// server.js (or wherever your Express app lives)
app.post("/api/fetch-pdf-text", async (req, res) => {
  const { url } = req.body;
  console.log("📩 /api/fetch-pdf-text route hit:", url);

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const parsed = await pdfParse(Buffer.from(buffer));

    const fullText = (parsed.text || "").replace(/\r/g, "");
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

    console.log("📄 Final inferred PDF metadata:", { title, authors });

    res.send({
      success: true,
      text: fullText,
      title: title || "",
      authors: authors, // 👈 array of strings
      rawAuthor: infoAuthor, // 👈 optional, for debugging
    });
  } catch (err) {
    console.error("❌ PDF parse failed:", err);
    res.status(500).send({ success: false });
  }
});

// ---------- helpers ----------

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

// --- Authors ---

// --- replace only this function in your server (above /api/fetch-pdf-text) ---

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
  // if it’s Title Case-ish but contains stopwords like "of/in/on/for" and no credentials/names
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
//get thumbnail of pdf

app.post("/api/pdf-thumbnail", async (req, res) => {
  const { url } = req.body;
  console.log("TRYING PDF THUMBNAL");

  try {
    // 2) Download the PDF into a temp folder
    const tempDir = path.join(__dirname, "temp");
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
      __dirname,
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
//get a single task
// server.js

app.get("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const SQL = "SELECT * FROM content WHERE content_id = ?";
    const result = await query(SQL, [id]);
    res.json(result[0] || {});
  } catch (err) {
    console.error("Error fetching task by ID:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//last URL visited INFO
app.post("/api/store-last-visited-url", async (req, res) => {
  const { url } = req.body;
  try {
    await db.query(
      "INSERT INTO last_visited (id, url) VALUES (1, ?) ON DUPLICATE KEY UPDATE url = ?",
      [url, url]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/get-last-visited-url", async (req, res) => {
  try {
    const sql = "SELECT url FROM last_visited ORDER BY id DESC LIMIT 1";
    const [rows] = await query(sql);
    console.log(rows.url, ":", Date.now());
    if (!rows || rows.length === 0) {
      return res.status(200).json({ url: null }); // Reference not found
    }
    res.json({ url: rows.url || "" });
  } catch (err) {
    console.error("DB Fetch Error:", err);
    res.status(500).json({ url: "" });
  }
});

//publisher and author info
app.post("/api/extract-metadata", async (req, res) => {
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

//publisher and author images
app.use(
  "/images/authors",
  express.static(path.join(__dirname, "assets/images/authors"))
);

app.use(
  "/images/publishers",
  express.static(path.join(__dirname, "assets/images/publishers"))
);

//claim evaluation

// Small helper
const okVerdict = new Set(["true", "false", "uncertain"]);
function badReq(res, msg) {
  return res.status(400).json({ error: msg });
}

// -------------------- CLAIM VERIFICATIONS API -------------------- //
// Upsert a verification (create or update the same (claim_id, user_id))
app.post("/api/claim-verifications", async (req, res) => {
  try {
    const {
      claim_id,
      user_id,
      verdict,
      confidence,
      notes = "",
    } = req.body || {};

    if (!Number.isInteger(claim_id))
      return badReq(res, "claim_id required (int)");
    if (user_id != null && !Number.isInteger(user_id))
      return badReq(res, "user_id must be int or null");
    if (!okVerdict.has(verdict))
      return badReq(res, "verdict must be 'true' | 'false' | 'uncertain'");

    const confNum = Number(confidence);
    if (!Number.isFinite(confNum) || confNum < 0 || confNum > 1)
      return badReq(res, "confidence must be between 0 and 1");

    // If your users table requires a user_id, you can enforce here:
    // if (user_id == null) return badReq(res, "user_id required");

    const sql = `
      INSERT INTO claim_verifications
        (claim_id, user_id, verdict, confidence, notes, created_at, updated_at)
      VALUES
        (:claim_id, :user_id, :verdict, :confidence, :notes, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        verdict = VALUES(verdict),
        confidence = VALUES(confidence),
        notes = VALUES(notes),
        updated_at = NOW()
    `;

    const [result] = await pool.execute(sql, {
      claim_id,
      user_id, // can be null if FK allows it
      verdict,
      confidence: confNum,
      notes,
    });

    // Fetch the current record to return a clean object
    const [rows] = await pool.execute(
      `SELECT claim_verifications_id, claim_id, user_id, verdict, confidence, notes, created_at, updated_at
       FROM claim_verifications
       WHERE claim_id = :claim_id AND <%= user_id_cond %>`,
      user_id == null
        ? { claim_id } // if you allowed null user_id and there's only one per claim
        : { claim_id, user_id }
    );

    // If you allow NULL user_id for multiple rows per claim, adjust the SELECT accordingly.
    return res.json({ ok: true, verification: rows?.[0] ?? null });
  } catch (err) {
    console.error("POST /api/claim-verifications error:", err);
    // Common FK issues:
    // - claim_id not in claims
    // - user_id not in users (if NOT NULL FK)
    if (String(err?.message || "").includes("foreign key")) {
      return res.status(409).json({
        error: "Foreign key violation (claim_id or user_id not found)",
      });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

// backend
app.get("/api/proxy-pdf", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).send("missing url");
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) return res.status(r.status).send("upstream error");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/pdf");
  r.body.pipe(res);
});

// Get one verification for (claim_id, user_id)
app.get("/api/claim-verifications", async (req, res) => {
  try {
    const claim_id = Number(req.query.claim_id);
    const user_id =
      req.query.user_id == null ? null : Number(req.query.user_id);

    if (!Number.isInteger(claim_id))
      return badReq(res, "claim_id required (int)");

    let rows;
    if (user_id == null) {
      // If you don’t support null user_id, you can 400 here instead
      [rows] = await pool.execute(
        `SELECT * FROM claim_verifications WHERE claim_id = :claim_id`,
        { claim_id }
      );
    } else {
      [rows] = await pool.execute(
        `SELECT * FROM claim_verifications WHERE claim_id = :claim_id AND user_id = :user_id`,
        { claim_id, user_id }
      );
    }
    res.json({ ok: true, verifications: rows });
  } catch (err) {
    console.error("GET /api/claim-verifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// All verifications for a claim (for admin/aggregation views)
app.get("/api/claims/:claimId/verifications", async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    if (!Number.isInteger(claimId)) return badReq(res, "claimId must be int");
    const [rows] = await pool.execute(
      `SELECT * FROM claim_verifications WHERE claim_id = :claimId ORDER BY updated_at DESC`,
      { claimId }
    );
    res.json({ ok: true, verifications: rows });
  } catch (err) {
    console.error("GET /api/claims/:claimId/verifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// (Optional) delete a verification
app.delete("/api/claim-verifications", async (req, res) => {
  try {
    const claim_id = Number(req.query.claim_id);
    const user_id = Number(req.query.user_id);
    if (!Number.isInteger(claim_id) || !Number.isInteger(user_id))
      return badReq(res, "claim_id and user_id required (int)");

    const [result] = await pool.execute(
      `DELETE FROM claim_verifications WHERE claim_id = :claim_id AND user_id = :user_id`,
      { claim_id, user_id }
    );
    res.json({ ok: true, deleted: result.affectedRows });
  } catch (err) {
    console.error("DELETE /api/claim-verifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- don’t forget your existing app.listen(...)

//Get Authors
app.get("/api/content/:taskId/authors", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM authors a join content_authors ta 
  on a.author_id = ta.author_id WHERE content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Get a single author by authorId
app.get("/api/content/:authorId/author", async (req, res) => {
  const { authorId } = req.params;
  const sql = `SELECT * FROM  authors
  WHERE author_id = ?`;
  pool.query(sql, authorId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Get a single publisher by publisherId
app.get("/api/content/:publisherId/publisher", async (req, res) => {
  const { publisherId } = req.params;
  const sql = `SELECT * FROM  publishers
  WHERE publisher_id = ?`;
  pool.query(sql, publisherId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Get content_authors
app.get("/api/content/:taskId/content_authors", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM  content_authors
  WHERE content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Add Authors
const surnameParticles = new Set([
  "de",
  "del",
  "de la",
  "da",
  "di",
  "van",
  "von",
  "bin",
  "ibn",
  "al",
  "le",
  "du",
  "des",
  "la",
  "mc",
  "mac",
  "st.",
  "st",
  "o’",
  "o'",
]);
const knownTitles = [
  "Dr.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "Prof.",
  "Rev.",
  "Hon.",
  "Sir",
];
const knownSuffixes = [
  "PhD",
  "Ph.D.",
  "MD",
  "M.D.",
  "DO",
  "D.O.",
  "MS",
  "M.S.",
  "MBA",
  "BSc",
  "B.Sc.",
  "JD",
  "J.D.",
  "DDS",
  "D.D.S.",
  "RN",
  "R.N.",
  "Esq.",
  "Jr.",
  "Sr.",
  "III",
  "IV",
];

function parseAuthorName(raw) {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  const displayName = cleaned; // Preserve full name as-is

  let name = cleaned;
  let title = null;
  let suffix = null;

  // Handle suffix after comma
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    name = parts[0];
    const possibleSuffix = parts[1].trim();
    if (knownSuffixes.includes(possibleSuffix)) {
      suffix = possibleSuffix;
    }
  }

  // Extract title
  for (const t of knownTitles) {
    if (name.startsWith(t + " ")) {
      title = t;
      name = name.slice(t.length).trim();
      break;
    }
  }

  const nameParts = name.split(" ");
  if (nameParts.length < 2) {
    return {
      display_name: displayName,
      title,
      first_name: nameParts[0],
      middle_name: null,
      last_name: "",
      suffix,
    };
  }

  // Suffix again if no comma
  const lastWord = nameParts[nameParts.length - 1];
  if (knownSuffixes.includes(lastWord)) {
    suffix = lastWord;
    nameParts.pop();
  }

  const firstName = nameParts.shift();
  const lastNameParts = [];

  // Grab last name and particles
  while (nameParts.length) {
    const part = nameParts[nameParts.length - 1];
    if (
      surnameParticles.has(part.toLowerCase()) ||
      lastNameParts.length === 0
    ) {
      lastNameParts.unshift(nameParts.pop());
    } else {
      break;
    }
  }

  const lastName = lastNameParts.join(" ");
  const middleName = nameParts.length ? nameParts.join(" ") : null;

  return {
    display_name: displayName,
    title,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    suffix,
  };
}

app.post("/api/content/:contentId/authors", async (req, res) => {
  const contentId = req.body.contentId;
  const authors = req.body.authors; // Expect an array of authors

  const sql = `CALL InsertOrGetAuthor(?, ?, ?, ?, ?,?,?,?, @authorId)`;

  try {
    for (const author of authors) {
      const parsed = parseAuthorName(author.name);

      const result = await query(sql, [
        parsed.first_name,
        parsed.middle_name,
        parsed.last_name,
        parsed.suffix,
        parsed.title,
        parsed.display_name,
        author.description,
        author.image,
      ]);
      const authorId = result[0][0].authorId;

      if (authorId) {
        const insertTaskAuthor = `INSERT INTO content_authors (content_id, author_id) VALUES (?, ?)`;
        await pool.query(insertTaskAuthor, [contentId, authorId]);
      }
    }
    res.status(200).send("Authors added successfully");
  } catch (error) {
    console.error("Error inserting authors:", error);
    res.status(500).send("Error adding authors");
  }
});

//update author bio
app.put("/api/authors/:authorId/bio", async (req, res) => {
  const { authorId } = req.params;
  const { description } = req.body;

  try {
    await query(`UPDATE authors SET description = ? WHERE author_id = ?`, [
      description,
      authorId,
    ]);
    res.send({ success: true });
  } catch (err) {
    console.error("Failed to update author bio:", err);
    res.status(500).send({ success: false });
  }
});

// update publisher bio
app.put("/api/publishers/:publisherId/bio", async (req, res) => {
  const { publisherId } = req.params;
  const { description } = req.body;

  try {
    await query(
      `UPDATE publishers SET description = ? WHERE publisher_id = ?`,
      [description, publisherId]
    );
    res.send({ success: true });
  } catch (err) {
    console.error("Failed to update publisher bio:", err);
    res.status(500).send({ success: false });
  }
});
// Make sure this line is already declared at the top of your server file

// fetching author ratings
app.get("/api/authors/:authorId/ratings", async (req, res) => {
  const { authorId } = req.params;
  try {
    const rows = await query(
      `SELECT ar.*, t.topic_name 
       FROM author_ratings ar 
       JOIN topics t ON ar.topic_id = t.topic_id 
       WHERE ar.author_id = ?`,
      [authorId]
    );
    res.send(rows); // rows is already an iterable array
  } catch (err) {
    console.error("Failed to fetch author ratings:", err);
    res.status(500).send({ success: false });
  }
});

//update author ratings
app.put("/api/authors/:authorId/ratings", async (req, res) => {
  const { authorId } = req.params;
  const { ratings } = req.body;
  try {
    await db.query("DELETE FROM author_ratings WHERE author_id = ?", [
      authorId,
    ]);
    for (const r of ratings) {
      await db.query(
        `INSERT INTO author_ratings (author_id, topic_id, bias_score, veracity_score) VALUES (?, ?, ?, ?)`,
        [authorId, r.topic_id, r.bias_score, r.veracity_score]
      );
    }
    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false });
  }
});
// Update a single author rating
app.put("/api/authors/:authorRatingId/rating", async (req, res) => {
  const { authorRatingId } = req.params;
  const { topic_id, source, url, bias_score, veracity_score, notes } =
    req.body.rating;

  try {
    await query(
      `UPDATE author_ratings 
       SET topic_id = ?, source = ?, url = ?, bias_score = ?, veracity_score = ?, notes = ?, last_checked = NOW() 
       WHERE author_rating_id = ?`,
      [
        topic_id,
        source,
        url,
        bias_score,
        veracity_score,
        notes || null,
        authorRatingId,
      ]
    );

    res.send({ success: true });
  } catch (err) {
    console.error("Error updating author rating:", err);
    res.status(500).send({ success: false });
  }
});

// Add new author rating
app.post("/api/authors/add-rating", async (req, res) => {
  const { ratings } = req.body;

  if (!ratings || !ratings.author_id || !ratings.topic_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  try {
    const result = await query(
      `INSERT INTO author_ratings 
        (author_id, topic_id, source, url, notes, bias_score, veracity_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ratings.author_id,
        ratings.topic_id,
        ratings.source || null,
        ratings.url || null,
        ratings.notes || null,
        ratings.bias_score ?? 0,
        ratings.veracity_score ?? 0,
      ]
    );

    const newId = result.insertId;

    const [newRating] = await query(
      `SELECT ar.*, t.topic_name
       FROM author_ratings ar
       JOIN topics t ON ar.topic_id = t.topic_id
       WHERE ar.author_rating_id = ?`,
      [newId]
    );

    res.json(newRating);
  } catch (err) {
    console.error("Error inserting new author rating:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

//Get publishers
app.get("/api/content/:taskId/publishers", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM publishers a join content_publishers ta 
  on a.publisher_id = ta.publisher_id WHERE content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.log(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching publishers");
    }

    return res.json(rows);
  });
});

//Add publishers
app.post("/api/content/:contentId/publishers", async (req, res) => {
  const contentId = req.body.contentId;
  const publisher = req.body.publisher; // Expect a single publisher object

  const sql = `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`;

  try {
    const result = await query(sql, [publisher.name]);
    const publisherId = result[0][0].publisherId;

    if (publisherId) {
      const insertTaskPublisher = `INSERT IGNORE INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`;
      await pool.query(insertTaskPublisher, [contentId, publisherId]);
    }
    res.status(200).send("Publisher added successfully");
  } catch (error) {
    console.error("Error inserting publisher:", error);
    res.status(500).send("Error adding publisher");
  }
});

app.get("/api/publishers/:publisherId/ratings", async (req, res) => {
  const { publisherId } = req.params;

  const sql = `
    SELECT pr.*, t.topic_name 
    FROM publisher_ratings pr 
    JOIN topics t ON pr.topic_id = t.topic_id 
    WHERE pr.publisher_id = ?
  `;

  try {
    const rows = await query(sql, [publisherId]);

    res.send(rows);
  } catch (err) {
    console.error("❌ Error fetching publisher ratings:", err);
    res.status(500).send({ success: false });
  }
});

//get all topics in ratings
// GET ratings for a specific publisher
app.get("/api/publishers/ratings-topics", async (req, res) => {
  try {
    const rows = await query(
      `SELECT DISTINCT t.topic_id, t.topic_name
       FROM publisher_ratings pr
       JOIN topics t ON pr.topic_id = t.topic_id`
    );
    res.send(rows);
  } catch (err) {
    console.error("Error fetching publisher rating topics:", err);
    res.status(500).send({ success: false });
  }
});

//update ratings for a specific publisher
app.put("/api/publishers/:publisherId/ratings", async (req, res) => {
  const { publisherId } = req.params;
  const { ratings } = req.body;

  try {
    await db.query("DELETE FROM publisher_ratings WHERE publisher_id = ?", [
      publisherId,
    ]);
    for (const r of ratings) {
      await db.query(
        `INSERT INTO publisher_ratings (publisher_id, topic_id, source, score, url, last_checked, bias_score, veracity_score)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          publisherId,
          r.topic_id,
          r.source || null,
          r.score || null,
          r.url || null,
          r.bias_score,
          r.veracity_score,
        ]
      );
    }
    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false });
  }
});

// Update a single publisher rating
app.put("/api/publishers/:publisherRatingId/rating", async (req, res) => {
  const { publisherRatingId } = req.params;
  const { topic_id, source, url, bias_score, veracity_score, notes } =
    req.body.rating;

  try {
    await query(
      `UPDATE publisher_ratings 
       SET topic_id = ?, source = ?, url = ?, bias_score = ?, veracity_score = ?, notes = ?, last_checked = NOW() 
       WHERE publisher_rating_id = ?`,
      [
        topic_id,
        source,
        url,
        bias_score,
        veracity_score,
        notes || null,
        publisherRatingId,
      ]
    );

    res.send({ success: true });
  } catch (err) {
    console.error("Error updating publisher rating:", err);
    res.status(500).send({ success: false });
  }
});

//Get auth_references
app.get("/api/content/:taskId/auth_references", async (req, res) => {
  const { taskId } = req.params;
  const sql = `
  select * from auth_references where 
  (author_id in (select author_id from content_authors where content_id=?)) 
  or 
  (reference_content_id in 
  (select reference_content_id from content_relations where content_id=?))
`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error auth_references");
    }

    return res.json(rows);
  });
});

app.get("/api/get-graph-data", async (req, res) => {
  const { entity, entityType } = req.query;

  if (!entity || !entityType) {
    return res
      .status(400)
      .json({ error: "Missing entity or entityType parameter" });
  }

  //console.log("🔍 Received Graph Data Request:", { entity, entityType });

  const nodeSql = getNodesForEntity(entityType);
  const linkSql = getLinksForEntity(entityType);

  if (!nodeSql || !linkSql) {
    return res.status(400).json({ error: "Invalid entityType parameter" });
  }

  try {
    const nodes = await query(nodeSql, [entity, entity, entity, entity]);
    const links = await query(linkSql, [entity, entity, entity, entity]);

    //console.log("📌 Nodes Retrieved:", nodes);
    //console.log("🔗 Links Retrieved:", links);

    // Ensure JSON-safe response
    res.json({
      nodes: JSON.parse(JSON.stringify(nodes)),
      links: JSON.parse(JSON.stringify(links)),
    });
  } catch (error) {
    console.error("🚨 SQL Error:", error);
    res.status(500).json({ error: "Database query failed", details: error });
  }
});

//get claims from claim_id

app.get("/api/claim/:claimId", async (req, res) => {
  const { claimId } = req.params;

  try {
    const SQL = `
    SELECT  
      claim_id,
      claim_text,
      veracity_score,
      confidence_level,
      last_verified
  
    FROM claims
    WHERE claim_id=?
    `;

    const params = [claimId];
    const claim = await query(SQL, params);
    res.json(claim);
  } catch (err) {
    console.error("Error fetching references with claims:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//get references with claims for a content_id
app.get(
  "/api/content/:task_content_id/references-with-claims",
  async (req, res) => {
    console.log("Received request for contentId:", req.params.task_content_id);
    const { task_content_id } = req.params;

    try {
      const SQL = `
      SELECT  c.content_id AS reference_content_id,
        c.content_name,
        c.url,
        c.thumbnail,
        c.progress,
        c.details,
        c.media_source,
        c.topic,
        c.subtopic,
             COALESCE(JSON_ARRAYAGG(
               JSON_OBJECT('claim_id', cl.claim_id, 'claim_text', cl.claim_text)
             ), '[]') AS claims
       FROM content c
      INNER JOIN content_relations cr ON c.content_id = cr.reference_content_id
      LEFT JOIN content_claims cc ON c.content_id = cc.content_id
      LEFT JOIN claims cl ON cc.claim_id = cl.claim_id
      WHERE cr.content_id = ?
      GROUP BY c.content_id
      `;

      const params = [task_content_id];
      const referencesWithClaims = await query(SQL, params);
      res.json(referencesWithClaims);
    } catch (err) {
      console.error("Error fetching references with claims:", err);
      res.status(500).json({ error: "Database error" });
    }
  }
);

//Get References, aka source because reference is a reserved word
app.get("/api/content/:taskId/source-references", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM content c join content_relations cr 
  on c.content_id = cr.reference_content_id WHERE cr.content_id =?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      //(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching references");
    }

    return res.json(rows);
  });
});

// Get References with Optional Search Term
app.get("/api/references/:searchTerm?", async (req, res) => {
  let { searchTerm } = req.params;
  let { page = 1 } = req.query; // 🔥 Extract page number (default = 1)
  const limit = 50;
  const offset = (page - 1) * limit; // 🔥 Calculate offset

  let sql = `SELECT content_id, content_name, url FROM content`;

  if (searchTerm && searchTerm !== "all") {
    sql += ` WHERE content_name LIKE ?`;
    searchTerm = `%${searchTerm}%`;
  }

  sql += ` LIMIT ? OFFSET ?`; // ✅ Now supports pagination

  pool.query(
    sql,
    searchTerm && searchTerm !== "all"
      ? [searchTerm, limit, offset]
      : [limit, offset],
    (err, rows) => {
      if (err) {
        console.error("❌ Error fetching references:", err);
        return res.status(500).send("Error fetching references");
      }

      return res.json(rows);
    }
  );
});

//Get content_relations
app.get("/api/content/:taskId/content_relations", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM  content_relations ta 
  WHERE content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.log(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching references");
    }

    return res.json(rows);
  });
});

//Add References
app.post("/api/add-content-relation", async (req, res) => {
  const taskContentId = req.body.taskContentId;
  const referenceContentId = req.body.referenceContentId;

  try {
    // Step 3: Check if this task-reference pair already exists
    const checkExistingTaskRef = `SELECT 1 FROM content_relations WHERE content_id = ? AND reference_content_id = ?`;
    const existingTaskRefs = await query(checkExistingTaskRef, [
      taskContentId,
      referenceContentId,
    ]);

    if (existingTaskRefs.length === 0) {
      // Step 4: Insert task-reference if it doesn't exist
      await query(
        `INSERT INTO content_relations (content_id, reference_content_id) VALUES (?, ?)`,
        [taskContentId, referenceContentId]
      );
      console.log(
        `Reference ${referenceContentId} linked to task ${taskContentId}`
      );
    } else {
      console.log(
        `Reference ${referenceContentId} already linked to task ${taskContentId}, skipping insert.`
      );
    }

    res.status(200).json({
      message: "Reference relation added successfully",
      referenceContentId,
    });
  } catch (error) {
    console.error("Error inserting references:", error);
    res.status(500).json({ error: "Error adding references" });
  }
});

//delete references
app.delete("/api/remove-content-relation", async (req, res) => {
  const taskContentId = req.body.taskContentId;
  const referenceContentId = req.body.referenceContentId;
  const sql = `DELETE FROM content_relations WHERE content_id = ? AND reference_content_id =?`;
  pool.query(sql, [taskContentId, referenceContentId], (err) => {
    if (err) return res.status(500).send("Error removing sources");
    res.send("Sources removed");
  });
});

//Users
//sto9re and get sessions
app.post("/api/store-extension-session", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  console.log("🔑 Token received:", token);
  const user = decodeJwt(token); // your existing decode function

  const { device_fingerprint } = req.body;

  if (!device_fingerprint || !user?.user_id) {
    return res.status(400).json({ error: "Missing fingerprint or user" });
  }

  await query(
    `
    INSERT INTO user_sessions (device_fingerprint, user_id, jwt, updated_at)
    VALUES (?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), jwt = VALUES(jwt), updated_at = NOW()
  `,
    [device_fingerprint, user.user_id, token]
  );

  res.json({ message: "Session stored" });
});

//check for session
app.get("/api/get-session-user", async (req, res) => {
  const { fingerprint } = req.query;
  if (!fingerprint) {
    return res.status(400).json({ error: "Missing fingerprint" });
  }
  const result = await query(
    `
    SELECT jwt FROM user_sessions
    WHERE device_fingerprint = ?
    AND updated_at > NOW() - INTERVAL 1 DAY
    LIMIT 1
  `,
    [fingerprint]
  );

  if (result.length === 0) {
    return res.json({ jwt: null }); // guest
  }
  const token = result[0].jwt;

  try {
    // ✅ Check if it's still valid
    jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ jwt: token });
  } catch (err) {
    console.warn("⚠️ Stored session token is invalid or expired:", err.message);
    return res.json({ jwt: null }); // fallback to guest
  }
});

//all users
app.get("/api/all-users", async (req, res) => {
  const sql = "SELECT * FROM users";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching content_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});
//Users assigned to a task
app.get("/api/content/:taskId/get-users", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT u.username,u.user_id
       FROM users u
       JOIN content_users tu ON u.user_id = tu.user_id
       WHERE tu.content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error("Error fetching content_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    if (rows && rows[0]) {
      res.json(rows);
    }
  });
});

app.post("/api/content/:taskId/assign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `INSERT INTO content_users (content_id, user_id) VALUES (?, ?)`;
  const params = [taskId, userId];
  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error assigning user to task");
    }
    res.status(200).send("User assigned successfully");
  });
});
app.post("/api/content/:taskId/unassign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `DELETE FROM content_users WHERE content_id = ? AND user_id = ?`;

  pool.query(sql, [taskId, userId], (err) => {
    if (err) return res.status(500).send("Error unassigning user");
    res.send("User unassigned");
  });
});

app.get("/api/scrapecontent", async (req, res) => {
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

async function verifyCaptcha(token) {
  const secret = process.env.VITE_RECAPTCHA_SECRET_KEY;
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${secret}&response=${token}`,
  });

  const data = await res.json();
  console.log("CAPTCHA VERIFICATION RESULT:", data);
  console.log("CAPTCHA VERIFICATION RESULT:", token);
  return data.success;
}

// Register endpoint
app.post("/api/register", async (req, res) => {
  const { username, password, email, captcha } = req.body;
  const ipAddress = req.ip;

  if (!username || !password || !email || !captcha) {
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: false,
      message: "Missing required fields or CAPTCHA",
    });
    return res
      .status(400)
      .json({ error: "All fields and CAPTCHA are required." });
  }

  const isHuman = await verifyCaptcha(captcha);
  if (!isHuman) {
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: false,
      message: "Failed CAPTCHA verification",
    });
    return res.status(403).json({ error: "Failed CAPTCHA verification" });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const sql = "INSERT INTO users (username, password, email) VALUES (?, ?, ?)";
  const params = [username, hashedPassword, email];

  pool.query(sql, params, async (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        await logRegistrationAttempt({
          username,
          email,
          ipAddress,
          success: false,
          message: "Duplicate username or email",
        });
        return res
          .status(409)
          .json({ error: "Username or email already exists." });
      }

      console.error("Error registering user:", err);
      await logRegistrationAttempt({
        username,
        email,
        ipAddress,
        success: false,
        message: `Database error: ${err.message}`,
      });
      return res.status(500).json({ error: "Database error." });
    }

    // Log success
    await logRegistrationAttempt({
      username,
      email,
      ipAddress,
      success: true,
      message: "Registration successful",
    });

    res.status(201).json({
      user: {
        id: result.insertId,
        username,
        email,
      },
    });
  });
});

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { username, password, captcha, fingerprint } = req.body;
  const ipAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // CAPTCHA bypass for extensions or post-registration
  const skipCaptcha = req.headers["x-skip-captcha"] === "true";

  if (!username || !password || (!skipCaptcha && !captcha)) {
    return res.status(400).json({ error: "All fields are required." });
  }

  if (!skipCaptcha) {
    const isHuman = await verifyCaptcha(captcha);
    if (!isHuman) {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "captcha_failed",
        fingerprint,
      });

      return res.status(403).json({ error: "Failed CAPTCHA verification" });
    }
  }

  const sql = "SELECT * FROM users WHERE username = ?";
  pool.query(sql, [username], async (err, results) => {
    if (err) {
      console.error("Error logging in user:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "user_not_found",
        fingerprint,
      });
      return res.status(404).send("User not found.");
    }

    const user = results[0];
    const isValidPassword = bcrypt.compareSync(password, user.password);

    if (isValidPassword) {
      const token = jwt.sign(
        {
          user_id: user.user_id,
          username: user.username,
          can_post: true,
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // --- SESSION LOGIC ---
      // For extension logins, fingerprint will be present.
      // For dashboard logins, fallback to "manual_login" or generate as needed.
      const sessionFingerprint = fingerprint || "manual_login";
      try {
        // Optionally: upsert/replace session for extension/device logins
        if (fingerprint) {
          await pool.query(
            "REPLACE INTO user_sessions (device_fingerprint, user_id, jwt, updated_at) VALUES (?, ?, ?, NOW())",
            [fingerprint, user.user_id, token]
          );
        }

        // Log the login event
        await pool.query(
          "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'login', ?, ?)",
          [
            user.user_id,
            sessionFingerprint,
            ipAddress,
            JSON.stringify({ username, agent: req.headers["user-agent"] }),
          ]
        );
      } catch (logErr) {
        console.warn("Login event/session log failed:", logErr.message);
      }

      // --- END SESSION LOGIC ---

      await logSuccessfulLogin({
        userId: user.user_id,
        jwt: token,
        ipAddress,
        fingerprint: sessionFingerprint,
      });

      res.status(200).json({
        auth: true,
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          can_post: true,
          user_profile_image: user.user_profile_image ?? null,
        },
      });
    } else {
      await logFailedLogin({
        username,
        ipAddress,
        userAgent: req.headers["user-agent"],
        reason: "Invalid credentials",
        fingerprint,
      });
      res.status(401).send("Invalid credentials.");
    }
  });
});

// Requires: const pool = require('./db'); // or your db import
app.post("/api/logout", (req, res) => {
  const { fingerprint } = req.body;
  if (!fingerprint) {
    return res.status(400).json({ error: "Missing fingerprint" });
  }

  // 1. First, get the user_id for audit logging
  pool.query(
    "SELECT user_id FROM user_sessions WHERE device_fingerprint = ? LIMIT 1",
    [fingerprint],
    (err, results) => {
      if (err) {
        console.error("Error selecting session for logout:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      const userId = results.length ? results[0].user_id : null;

      // 2. Delete the session row
      pool.query(
        "DELETE FROM user_sessions WHERE device_fingerprint = ?",
        [fingerprint],
        (err2) => {
          if (err2) {
            console.error("Error deleting session:", err2);
            return res.status(500).json({ error: "Failed to log out" });
          }

          // 3. Optionally log the event for auditing
          pool.query(
            "INSERT INTO login_events (user_id, fingerprint, event_type, ip_address, details) VALUES (?, ?, 'logout', ?, ?)",
            [
              userId,
              fingerprint,
              req.ip,
              JSON.stringify({ agent: req.headers["user-agent"] }),
            ],
            (err3) => {
              if (err3) {
                console.error("Error logging logout event:", err3);
                // We still return success, since session was deleted!
              }
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// Password reset endpoint (simplified)
app.post("/api/reset-password", (req, res) => {
  const { email, newPassword } = req.body;
  const hashedPassword = bcrypt.hashSync(newPassword, 10);

  db.query(
    "UPDATE users SET password = ? WHERE email = ?",
    [hashedPassword, email],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.status(200).send("Password reset successful.");
    }
  );
});

// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// 🔐 Change Email
app.post("/api/change-email", authenticateToken, (req, res) => {
  const { newEmail, password } = req.body;
  const userId = req.user.id;

  if (!newEmail || !password)
    return res.status(400).json({ error: "Missing fields." });

  pool.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ error: "User not found." });

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid password." });
    }

    pool.query(
      "UPDATE users SET email = ? WHERE id = ?",
      [newEmail, userId],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Update failed." });
        res.status(200).json({ message: "Email updated successfully." });
      }
    );
  });
});

// 🔐 Change Password
app.post("/api/change-password", authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Missing fields." });

  pool.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ error: "User not found." });

    const user = results[0];
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: "Current password incorrect." });
    }

    const hashedNew = bcrypt.hashSync(newPassword, 10);
    pool.query(
      "UPDATE users SET password = ? WHERE id = ?",
      [hashedNew, userId],
      (err2) => {
        if (err2)
          return res.status(500).json({ error: "Password update failed." });
        res.status(200).json({ message: "Password changed successfully." });
      }
    );
  });
});

///Unified taskauthorpubuser
// 🔧 EXPRESS API ROUTE (backend/api/index.js or wherever you define routes)
// Server-side pivot route
app.get("/api/unified-tasks/:pivotType/:pivotId", (req, res) => {
  const { pivotType, pivotId } = req.params;

  let sql = "";
  let params = [pivotId];

  if (pivotType === "task") {
    sql = `SELECT ... FROM content t WHERE t.content_id = ?`;
  } else if (pivotType === "author") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_authors ca ON t.content_id = ca.content_id
      WHERE ca.author_id = ?`;
  } else if (pivotType === "publisher") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_publishers cp ON t.content_id = cp.content_id
      WHERE cp.publisher_id = ?`;
  } else {
    return res.status(400).json({ error: "Invalid pivot type" });
  }

  // Append your JSON subqueries for authors, publishers, users, topic here 👇
  sql = sql.replace(
    "SELECT ...",
    `
    SELECT DISTINCT
      t.*,
      (
        SELECT topic_name 
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,

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
      ) AS publishers,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'user_id', u.user_id,
                   'username', u.username,
                   'email', u.email
                 )
               )
        FROM content_users cu
        JOIN users u ON cu.user_id = u.user_id
        WHERE cu.content_id = t.content_id
      ) AS users
  `
  );

  pool.query(sql, params, (err, results) => {
    if (err) {
      console.error("Pivot query failed:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

//Tasks
app.get("/api/content/:id", (req, res) => {
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

app.get("/api/content", (req, res) => {
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

//tasks for a user
app.get("/api/user-tasks/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT 
      t.*,
      (
        SELECT topic_name 
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,
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
    JOIN content_users cu ON t.content_id = cu.content_id
    WHERE cu.user_id = ? AND t.content_type = 'task'
    GROUP BY t.content_id
  `;
  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching user tasks:", err);
      return res.status(500).json({ error: "Query failed" });
    }
    res.json(results);
  });
});

//content_topics?
app.get("/api/content_topics", (req, res) => {
  const sql = "SELECT * FROM content_topics";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching content_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

//Topics
app.get("/api/topics", async (req, res) => {
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

// Update reference title
app.put("/api/updateReference", async (req, res) => {
  const { content_id, title } = req.body; // Extract from request body

  if (!title || !content_id) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  const sql = "UPDATE content SET content_name = ? WHERE content_id = ?";
  const params = [title, content_id];

  console.log("Updating content_name for content_id:", content_id);

  pool.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ Error updating references:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json({ message: "Reference updated successfully", results });
  });
});

//claims
//get claims for  a task or reference
app.get("/api/claims/:content_id", async (req, res) => {
  const { content_id } = req.params;
  const viewerId = req.query.viewerId;

  const sql = `
    SELECT 
      c.claim_id,
      c.claim_text,
      c.veracity_score,
      c.confidence_level,
      c.last_verified,
      COALESCE(GROUP_CONCAT(DISTINCT cc.relationship_type ORDER BY cc.relationship_type SEPARATOR ', '), '') AS relationship_type,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'reference_content_id', cr.reference_content_id,
            'content_name', ref.content_name,
            'url', ref.url,
            'support_level', IFNULL(cr.support_level, 0)
          )
        ), 
        JSON_ARRAY()
      ) AS reference_list
    FROM claims c
    LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
    LEFT JOIN claims_references cr ON c.claim_id = cr.claim_id
    LEFT JOIN content ref ON cr.reference_content_id = ref.content_id
    WHERE cc.content_id = ?
      ${
        viewerId
          ? "AND (cc.user_id IS NULL OR cc.user_id = ?)"
          : "AND cc.user_id IS NULL"
      }
    GROUP BY c.claim_id;
  `;

  const params = viewerId ? [content_id, viewerId] : [content_id];

  pool.query(sql, params, async (err, results) => {
    if (err) {
      console.error("❌ Error fetching claims:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    res.json(results);
  });
});

//add a full new claim
app.post("/api/claims", async (req, res) => {
  const {
    claim_text,
    veracity_score = 0,
    confidence_level = 0,
    last_verified = new Date(),
    content_id,
    relationship_type = "task",
  } = req.body;
  const formattedDate = new Date(last_verified)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  if (!claim_text || !content_id) {
    return res
      .status(400)
      .json({ error: "claim_text and content_id are required" });
  }

  try {
    const insertResult = await query(
      "INSERT INTO claims (claim_text, veracity_score, confidence_level, last_verified) VALUES (?, ?, ?, ?)",
      [claim_text, veracity_score, confidence_level, formattedDate]
    );

    const claimId = insertResult.insertId;

    await query(
      "INSERT INTO content_claims (content_id, claim_id, relationship_type) VALUES (?, ?, ?)",
      [content_id, claimId, relationship_type]
    );

    res.json({ success: true, claimId });
  } catch (error) {
    console.error("❌ Error creating claim:", error);
    res.status(500).json({ error: "Failed to insert claim" });
  }
});

//edit a full new claim
app.put("/api/claims/:claim_id", async (req, res) => {
  const claimId = req.params.claim_id;
  const {
    claim_text,
    veracity_score = 0,
    confidence_level = 0,
    last_verified = new Date(),
  } = req.body;
  const formattedDate = new Date(last_verified)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  console.log(claimId, "To edit");
  if (!claim_text || !claimId) {
    return res.status(400).json({ error: "claim_text and claim_id required" });
  }

  try {
    await query(
      "UPDATE claims SET claim_text = ?, veracity_score = ?, confidence_level = ?, last_verified = ? WHERE claim_id = ?",
      [claim_text, veracity_score, confidence_level, formattedDate, claimId]
    );

    res.json({ success: true, claimId });
  } catch (error) {
    console.error("❌ Error updating claim:", error);
    res.status(500).json({ error: "Failed to update claim" });
  }
});

//save or edit a claim link
app.post("/api/claim-links", async (req, res) => {
  const {
    source_claim_id,
    target_claim_id,
    user_id,
    support_level,
    relationship = "related", // fallback
    notes,
  } = req.body;

  if (!source_claim_id || !target_claim_id || !user_id) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const sql = `
      INSERT INTO claim_links 
        (source_claim_id, target_claim_id, relationship, user_id, support_level,notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [
      source_claim_id,
      target_claim_id,
      relationship,
      user_id,
      support_level,
      notes,
    ];

    await query(sql, params);
    res.status(201).json({ message: "Claim link created" });
  } catch (err) {
    console.error("❌ Error inserting claim link:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET /api/linked-claims-for-task/:contentId?viewerId=123
// api/linked-claims-for-claim/:claimId
app.get("/api/linked-claims-for-claim/:claimId", async (req, res) => {
  const claimId = req.params.claimId;
  const viewerId = req.query.viewerId ? req.query.viewerId : null;

  const sql = `

      SELECT 
  cl.claim_link_id,
  cl.target_claim_id,
  cl.source_claim_id,

  cl.relationship,
  cl.support_level,
  cl.notes,
  c.veracity_score AS verimeter_score,

  c.claim_id AS source_claim_id,
  c.claim_text AS source_claim_text,
  c.veracity_score AS source_veracity,
  c.confidence_level AS source_confidence,
  c.last_verified AS source_last_verified,

  cc.content_id AS reference_content_id
  
    FROM claim_links cl
    JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    JOIN claims c ON cc.claim_id = c.claim_id
    WHERE cl.target_claim_id = ?
      AND cl.disabled = 0
      ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

  const params = viewerId ? [claimId, viewerId] : [claimId];

  try {
    const rows = await query(sql, params);
    console.log(rows, ":::ROWOS");
    const formatted = rows.map((row) => ({
      claim_link_id: row.claim_link_id,
      claimId: row.target_claim_id,
      referenceId: row.reference_content_id,
      sourceClaimId: row.source_claim_id,
      relation:
        row.relationship === "supports"
          ? "support"
          : row.relationship === "refutes"
          ? "refute"
          : "support", // fallback
      confidence: row.confidence,
      notes: row.notes,
      verimeter_score: row.verimeter_score ?? null,
      sourceClaim: {
        claim_id: row.source_claim_id,
        claim_text: row.source_claim_text,
        veracity_score: row.source_veracity,
        confidence_level: row.source_confidence,
        last_verified: row.source_last_verified,
      },
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching linked claims for claim:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/live-verimeter-score/:claimId", async (req, res) => {
  const claimId = parseInt(req.params.claimId);
  const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
  console.log(claimId, "::::DKCJKDS", viewerId, "::::DJFHFG");

  if (isNaN(claimId)) {
    console.warn("Invalid claimId received:", req.params.claimId);
    return res.status(400).json({ error: "Invalid claim ID" });
  }

  const sql = viewerId
    ? "CALL compute_and_store_verimeter_score_for_claim(?, ?);"
    : "CALL compute_and_store_verimeter_score_for_claim(?, NULL);";

  const params = viewerId ? [claimId, viewerId] : [claimId];

  try {
    const rows = await query(sql, params); // rows[0] is the SELECT at the end of SP
    res.json(rows[0]); // Return just the final SELECT output
  } catch (err) {
    console.error("Error computing Verimeter score:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/linked-claims-for-task/:contentId", async (req, res) => {
  const contentId = req.params.contentId;
  const viewerId = req.query.viewerId ? req.query.viewerId : null;

  const sql = `
   SELECT 
  cl.claim_link_id,
  cl.target_claim_id,
  cl.source_claim_id,
  cl.relationship,
  cl.support_level,
  cl.notes,
  c.claim_text AS source_claim_text,
  cc.content_id AS reference_content_id
FROM claim_links cl
JOIN content_claims cc_task ON cl.target_claim_id = cc_task.claim_id
JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
JOIN claims c ON cc.claim_id = c.claim_id
WHERE cc_task.content_id = ?
  AND cl.disabled = 0
  ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

  const params = viewerId ? [contentId, viewerId] : [contentId];
  try {
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching linked claims:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/claims-and-linked-references/:contentId", async (req, res) => {
  const contentId = req.params.contentId;
  const viewerId = req.query.viewerId;

  const sql = `
    SELECT 
      CONCAT(cl.claim_link_id, cr.reference_content_id) AS id,
      cl.claim_link_id AS claim_link_id,
      cc_task.content_id AS task_content_id,
      cl.target_claim_id AS left_claim_id,
      cl.source_claim_id,
      cr.reference_content_id AS right_reference_id,
      cl.relationship,
      cl.support_level AS confidence,
      cl.notes AS notes
    FROM claim_links cl
    JOIN content_claims cc_task ON cl.target_claim_id = cc_task.claim_id
    JOIN content_claims cc_ref ON cl.source_claim_id = cc_ref.claim_id
    JOIN content_relations cr ON cr.reference_content_id = cc_ref.content_id
    WHERE cc_task.content_id = cr.content_id
      AND cc_task.content_id = ?
      AND cl.disabled = false
      ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

  const params = viewerId ? [contentId, viewerId] : [contentId];

  try {
    const claimsWithReferences = await query(sql, params);
    res.json(claimsWithReferences);
  } catch (err) {
    console.error("Error fetching references with claims:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//add claims in batch for a content_id (as in a scrape)
// and link the claim to the content_id
app.post("/api/claims/add", async (req, res) => {
  try {
    const { content_id, claims, content_type, user_id } = req.body;

    // ✅ Validate required fields
    if (
      !content_id ||
      !Array.isArray(claims) ||
      claims.length === 0 ||
      !content_type
    ) {
      console.error("❌ Missing required fields:", {
        content_id,
        claims,
        content_type,
      });
      return res.status(400).json({
        error: "content_id, claims array, and content_type are required",
      });
    }

    let insertedCount = 0;

    for (const claimText of claims) {
      if (typeof claimText !== "string" || claimText.trim() === "") {
        console.warn("⚠️ Skipping empty or invalid claim:", claimText);
        continue;
      }

      const cleanClaimText = claimText.trim();
      let claimId;
      let isNewClaim = false;

      try {
        // 1️⃣ **Check if claim already exists**
        const existingClaimResult = await query(
          "SELECT claim_id FROM claims WHERE claim_text = ?",
          [cleanClaimText]
        );
        const existingClaim = Array.isArray(existingClaimResult)
          ? existingClaimResult
          : [];

        if (existingClaim.length > 0) {
          claimId = existingClaim[0].claim_id;
        } else {
          // 2️⃣ **Insert new claim since it doesn't exist**
          const insertResult = await query(
            "INSERT INTO claims (claim_text) VALUES (?)",
            [cleanClaimText]
          );
          claimId = insertResult?.insertId || null;
          isNewClaim = true; // ✅ Mark this claim as newly inserted
        }
      } catch (err) {
        console.error("❌ Database error inserting claim:", err);
        continue; // Skip this claim and move to the next
      }

      if (!claimId) {
        console.warn(
          "⚠️ Skipping claim as claimId is undefined:",
          cleanClaimText
        );
        continue;
      }

      try {
        // 3️⃣ **If this is a NEW claim, no need to check for a link—just insert it.**
        if (isNewClaim) {
          await query(
            "INSERT INTO content_claims (content_id, claim_id, relationship_type,user_id) VALUES (?,?,?,?)",
            [content_id, claimId, content_type, user_id]
          );
          insertedCount++;
          console.log(
            `🔗 Created new claim & linked to content: ${cleanClaimText}`
          );
        } else {
          // 4️⃣ **If claim already existed, check if link exists first.**
          const existingLinkResult = await query(
            "SELECT cc_id FROM content_claims WHERE content_id = ? AND claim_id = ?",
            [content_id, claimId]
          );
          const existingLink = Array.isArray(existingLinkResult)
            ? existingLinkResult
            : [];

          if (existingLink.length === 0) {
            await query(
              "INSERT INTO content_claims (content_id, claim_id, relationship_type) VALUES (?,?,?)",
              [content_id, claimId, content_type]
            );
            insertedCount++;
            console.log(
              `🔗 Linked existing claim to content: ${cleanClaimText}`
            );
          } else {
            console.log("✅ Claim already linked, skipping:", cleanClaimText);
          }
        }
      } catch (err) {
        console.error("❌ Database error linking claim to content:", err);
      }
    }

    console.log(`✅ Successfully linked ${insertedCount} claims.`);
    return res.json({ success: true, insertedCount });
  } catch (error) {
    console.error("❌ Error in /api/claims/add:", error);
    return res.status(500).json({ error: "Server error storing claims" });
  }
});

//VERIMETER and TROLLMETER SCORES
app.get("/api/content/:contentId/claim-scores", async (req, res) => {
  const { contentId } = req.params;
  const userId = req.query.viewerId ?? null;

  try {
    await query("CALL compute_verimeter_for_content(?, ?)", [
      contentId,
      userId,
    ]);

    const results = await query(
      `
      SELECT claim_id, verimeter_score
      FROM claim_scores
      WHERE content_id = ? AND (user_id IS NULL OR user_id = ?)
    `,
      [contentId, userId]
    );

    const scoreMap = {};
    for (const row of results) {
      scoreMap[row.claim_id] = Number(row.verimeter_score);
    }

    res.json(scoreMap);
  } catch (err) {
    console.error("Error fetching claim scores:", err);
    res.status(500).json({ error: "Failed to fetch claim scores" });
  }
});

app.get("/api/content/:contentId/scores", async (req, res) => {
  const { contentId } = req.params;
  const { userId } = req.body;

  let [row] = await query(
    "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
    [contentId]
  );
  if (!row) {
    // Run your stored procedures to populate the table
    await query("CALL compute_verimeter_for_content(?, ?)", [
      contentId,
      userId,
    ]);

    await query("CALL compute_trollmeter_score(?)", [contentId]);
    // Try again
    [row] = await query(
      "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
      [contentId]
    );
    if (!row)
      return res.status(404).json({ error: "Not found, even after compute" });
  }

  res.json(row);
});

app.post("/api/content/:contentId/scores/recompute", async (req, res) => {
  const { contentId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    // Run your stored procedures with userId
    await query("CALL compute_verimeter_for_content(?, ?)", [
      contentId,
      userId,
    ]);

    await query("CALL compute_trollmeter_score(?)", [contentId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to recompute scores:", err);
    res.status(500).json({ error: "Failed to recompute scores" });
  }
});

app.post("/api/testimonials/add", async (req, res) => {
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

// ✅ Add new claim source (reference or Task)
app.post("/api/claim-sources", (req, res) => {
  const { claim_id, reference_content_id, is_primary, user_id } = req.body;
  const query = `
    INSERT INTO claim_sources (claim_id, reference_content_id, is_primary, user_id)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    query,
    [claim_id, reference_content_id, is_primary, user_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ claim_source_id: results.insertId });
    }
  );
});

// ✅ Fetch claim sources for a given claim
app.get("/api/claim-sources/:claimId", (req, res) => {
  const claimId = req.params.claimId;
  const query = `
    SELECT cs.claim_source_id, cs.reference_content_id, cs.is_primary, cs.created_at, c.content_name,c.url
    FROM claim_sources cs JOIN content c
    ON cs.reference_content_id=c.content_id
    WHERE cs.claim_id = ?
  `;
  db.query(query, [claimId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

//delete a claim source for a claim_id
app.delete("/api/claim-sources/:claimId", (req, res) => {
  const claimId = req.params.claimId;
  const query = `
    DELETE FROM claim_sources
    WHERE claim_sources_id = ?
  `;
  db.query(query, [claimId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});
// ✅ Update claim sources for a given claim
app.put("/api/claim-sources/:claim_sources_id", (req, res) => {
  const claim_sources_id = req.params.claim_sources_id;
  const { new_reference_id, notes } = req.body;
  const query = `
    UPDATE claim_sources SET reference_id = ?, notes = ?
    WHERE claim_source_id = ?
  `;
  db.query(
    query,
    [new_reference_id, notes || null, claim_sources_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});
app.get("/api/test-connection", (req, res) => {
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

app.post("/api/check-content", (req, res) => {
  const { url } = req.body;
  const query = "SELECT * FROM content WHERE url = ?";
  db.query(query, [url], (err, results) => {
    if (err) return res.status(500).send({ error: err });
    if (results.length > 0) {
      res.send({ exists: true, task: results[0] });
    } else {
      res.send({ exists: false });
    }
  });
});

app.post("/api/addContent", async (req, res) => {
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
    await db.query(callQuery, params);
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
    res.status(500).send("Database error during task ID fetch.");
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
    console.log("✅ Downloaded image with Axios.");
  } catch (axiosErr) {
    // Only try Puppeteer if the error is a network/HTTP error
    console.warn(
      "⚠️ Axios image fetch failed, falling back to Puppeteer...",
      axiosErr.message
    );

    try {
      // Use your Puppeteer image download logic here
      const puppeteerRes = await axios.post(
        `${BASE_URL}/api/fetch-image-with-puppeteer`,
        { imageUrl: thumbnail },
        { responseType: "arraybuffer" }
      );
      buffer = Buffer.from(puppeteerRes.data, "binary");
      usedPuppeteer = true;
      console.log("✅ Downloaded image with Puppeteer.");
    } catch (puppeteerErr) {
      console.error(
        "❌ Both Axios and Puppeteer image fetch failed.",
        puppeteerErr
      );
      return res.status(500).send("Image download failed");
    }
  }

  try {
    await sharp(buffer).resize({ width: 300 }).toFile(imagePath);
  } catch (error) {
    console.error("Error resizing image:", error);
    return res.status(500).send("Image processing error");
  }

  // Step 3: Update the task with the thumbnail path
  //change thumbnail path from absolute to relative
  const relativeImagePath = getRelativePath(imagePath);
  const updateQuery = "UPDATE content SET thumbnail = ? WHERE content_id = ?";
  db.query(updateQuery, [relativeImagePath, contentId], (updateErr) => {
    if (updateErr) {
      console.error("Error updating task with thumbnail:", updateErr);
      return res.status(500).send("Database update error");
    }
    console.log("✅ Server Response:", {
      success: true,
      content_id: contentId,
    });
    res.status(200).send({ success: true, content_id: contentId });
  });
});

app.get("/api/check-reference", async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const sql = "SELECT content_id FROM content WHERE url = ?";
    const [result] = await query(sql, [url]);

    if (!result || result.length === 0) {
      return res.status(200).json({ id: null }); // Reference not found
    }

    return res.status(200).json({ content_id: result.content_id });
  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Database lookup failed" });
  }
});

import { encoding_for_model } from "tiktoken";

const MAX_TOKENS = 12000;

app.post("/api/analyze-content", async (req, res) => {
  const { content, testimonials } = req.body;
  if (!content) {
    return res.status(400).json({ error: "Missing 'content' in request body" });
  }

  try {
    const results = await analyzeInChunks(content, testimonials);
    res.json(results);
  } catch (err) {
    console.error("❌ Error during analysis:", err);
    res.status(500).json({ error: err.message });
  }
});

function parseOrRepairJSON2(input) {
  try {
    return JSON.parse(input);
  } catch (err) {
    // Attempt repair: remove trailing commas
    const fixed = input.replace(/,\s*([\]}])/g, "$1");
    try {
      return JSON.parse(fixed);
    } catch (repairErr) {
      throw new Error("Irreparable JSON");
    }
  }
}

async function analyzeInChunks(content, testimonials) {
  const tokenizer = encoding_for_model("gpt-4");
  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = "";
  let chunkList = [];

  for (let para of paragraphs) {
    const testChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    const tokens = tokenizer.encode(testChunk);
    if (tokens.length > MAX_TOKENS) {
      if (currentChunk) chunkList.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk = testChunk;
    }
  }
  if (currentChunk) chunkList.push(currentChunk);

  console.log(`📦 Sending ${chunkList.length} chunk(s) to GPT-4`);

  let allClaims = [];
  let allTestimonials = [];
  let generalTopicCounts = {};
  let specificTopicsCounts = {};

  for (let i = 0; i < chunkList.length; i++) {
    const chunk = chunkList[i];
    const tokenLength = tokenizer.encode(chunk).length;
    console.log(
      `🔹 Chunk ${i + 1}/${chunkList.length} (${tokenLength} tokens)`
    );

    try {
      const result = await callOpenAiAnalyzeSingleChunk(chunk, testimonials);

      if (result.claims) allClaims.push(...result.claims);
      if (result.testimonials) allTestimonials.push(...result.testimonials);

      if (result.generalTopic) {
        generalTopicCounts[result.generalTopic] =
          (generalTopicCounts[result.generalTopic] || 0) + 1;
      }

      if (Array.isArray(result.specificTopics)) {
        for (let topic of result.specificTopics) {
          specificTopicsCounts[topic] = (specificTopicsCounts[topic] || 0) + 1;
        }
      }
    } catch (err) {
      console.warn(`⚠️ Error in chunk ${i + 1}:`, err.message);
    }
  }

  const generalTopic =
    Object.entries(generalTopicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "";
  const specificTopics = Object.entries(specificTopicsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  return {
    generalTopic,
    specificTopics,
    claims: [...new Set(allClaims)],
    testimonials: allTestimonials,
  };
}

async function callOpenAiAnalyzeSingleChunk(chunk, testimonials) {
  const testimonialsText =
    testimonials?.length > 0
      ? `
Below is a list of testimonials detected by an extractor. Please consider these, and deduplicate or improve them if they also appear in the main article text.

Extracted testimonials:
${JSON.stringify(testimonials, null, 2)}
`
      : "";

  const messages = [
    {
      role: "system",
      content:
        "You are a combined topic, claim, and testimonial extraction assistant.",
    },
    {
      role: "user",
      content: `
You are a fact-checking assistant.

First, identify the most general topic (max 2 words) for this text.
Then, list more specific subtopics under that topic (2 to 5).
Next, extract every distinct factual assertion or claim — especially those with numbers, statistics, or timelines. 
Avoid generalizations or summaries. Do not combine multiple claims. 
Each claim must be independently verifiable and phrased as a full sentence.

Also, extract any testimonials or first-person case studies in the text (phrases such as “I used this and it worked for me,” or “Bobby used this method and made $20 billion”), and try to include a name or image URL if present. Testimonials must be objects: { "text": "...", "name": "...", "imageUrl": "..." } (name and imageUrl are optional).

${testimonialsText}

Return your answer in strict JSON like this:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" },
    ...
  ]
}

Text:
${chunk}
`,
    },
  ];

  const body = {
    model: "gpt-4-turbo",
    messages,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();

  if (!response.ok) {
    console.error("❌ OpenAI API error", response.status, raw.slice(0, 500));
    throw new Error(`OpenAI API error: ${response.status} - ${raw}`);
  }

  try {
    const json = JSON.parse(raw);
    let reply = json.choices?.[0]?.message?.content?.trim() || "";

    // 🧼 Strip markdown code block if present
    if (reply.startsWith("```json")) {
      reply = reply
        .replace(/^```json\s*/, "")
        .replace(/```$/, "")
        .trim();
    }

    const parsed = parseOrRepairJSON2(reply);
    console.log("YEYEYEYEYEYEYE");
    return parsed;
  } catch (e) {
    console.error("❌ Failed to parse or repair assistant message:", raw);
    throw new Error(
      "Could not parse or repair assistant response: " + e.message
    );
  }
}

app.get("/api/store-content", async (req, res) => {
  const db = getConnection(); // or however you get your MySQL connection
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
    const [existing] = await db.query(
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
    const [result] = await db.query(
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

app.post("/api/pre-scrape", async (req, res) => {
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
app.post("/api/checkAndDownloadTopicIcon", async (req, res) => {
  const { generalTopic } = req.body;

  try {
    // ✅ Check if the topic exists in `topics` or `topic_aliases`
    const topicQuery = `
      SELECT topics.topic_id 
      FROM topics
      LEFT JOIN topic_aliases ON topics.topic_id = topic_aliases.topic_id
      WHERE topics.topic_name = ? OR topic_aliases.alias_name = ?
    `;
    const results = await query(topicQuery, [generalTopic, generalTopic]);

    console.log(results, generalTopic, ": results for topic check");

    // ✅ If topic exists in DB, return `{ exists: true, thumbnail_url: null }` (no action needed)
    if (results.length > 0) {
      return res.status(200).send({ exists: true, thumbnail_url: null });
    }

    // ✅ If not found in DB, check local icon storage
    const { exists, thumbnail_url } = await fetchIconForTopic(
      generalTopic,
      query
    );
    // 🔥 Ensure thumbnail is stored WITHOUT BASE_URL
    let newthumbnail_url = thumbnail_url
      .replace(BASE_URL, "")
      .replace(/^\/+/, ""); // Remove leading slashes if needed

    res.status(200).send({ exists, newthumbnail_url });
  } catch (error) {
    console.error("❌ Error in checkAndDownloadTopicIcon:", error);
    res.status(500).send({ error: "Failed to process topic icon." });
  }
});

import puppeteer from "puppeteer";

app.post("/api/fetch-image-with-puppeteer", async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl || typeof imageUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid imageUrl" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

    // Navigate to a blank page first to set cookies etc if you want
    await page.goto("about:blank");
    // Go to the image url directly
    const viewSource = await page.goto(imageUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const buffer = await viewSource.buffer();
    // Option 1: Send as base64 (easy for frontend)
    // const base64 = buffer.toString('base64');
    // res.json({ success: true, base64 });

    // Option 2: Send as image/binary for backend processing
    res.set(
      "Content-Type",
      viewSource.headers()["content-type"] || "image/jpeg"
    );
    res.send(buffer);

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    console.error("🧨 Puppeteer image error:", err.message);
    res
      .status(500)
      .json({ error: "Puppeteer image fetch error", details: err.message });
  }
});

app.post("/api/fetch-page-content", async (req, res) => {
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
      .json({ error: "Failed to fetch page via both axios and puppeteer" });
  }
});

app.post("/api/extractText", async (req, res) => {
  try {
    let { url, html } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: "No URL provided" });
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

    let pageText = article?.textContent?.trim() || "";

    // 🔥 Fix: Ensure API response includes `success: true`
    return res.json({ success: true, pageText });
  } catch (error) {
    console.error("❌ Error extracting text:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Error extracting text from the URL" });
  }
});

app.get("/api/full-graph/:taskId", async (req, res) => {
  const { entity, entityType } = req.query;
  const taskId = parseInt(req.params.taskId);
  const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;

  if (!entity || !entityType) {
    return res
      .status(400)
      .json({ error: "Missing entity or entityType parameter" });
  }

  const nodeSql = getNodesForEntity(entityType);
  const linkSql = getLinksForEntity(entityType);

  if (!nodeSql || !linkSql) {
    return res.status(400).json({ error: "Invalid entityType parameter" });
  }
  console.log(entity);
  try {
    // 1. Base nodes/links
    const nodes = await query(nodeSql, [entity, entity, entity, entity]);
    const links = await query(linkSql, [entity, entity, entity, entity]);

    // 2. Only claims & links actually connected to the task
    const { claimNodeSql, claimNodeParams, claimLinkSql, claimLinkParams } =
      getLinkedClaimsAndLinksForTask(taskId, viewerId);
    const claimNodes = await query(claimNodeSql, claimNodeParams);
    const claimLinks = await query(claimLinkSql, claimLinkParams);

    // 3. Merge and return
    res.json({
      nodes: JSON.parse(JSON.stringify([...nodes, ...claimNodes])),
      links: [...links, ...claimLinks],
    });
  } catch (err) {
    console.error("🌐 Full Graph Error:", err);
    res.status(500).json({ error: "Failed to build full graph" });
  }
});
