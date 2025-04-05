// Import dependencies
import { fetchIconForTopic } from "../extension/src/services/fetchIconForTopic.js";
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
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import pdfPoppler from "pdf-poppler";
import { spawn } from "child_process";

//const pdfParse = pkg.default || pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

// Load SSL certificate and key
const options = {
  key: fs.readFileSync("../ssl/server.key"),
  cert: fs.readFileSync("../ssl/server.cert"),
};
process.env.PATH = [process.env.PATH, "/usr/local/bin"].join(":");
console.log("🧭 PATH:", process.env.PATH);
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Connection: "keep-alive",
  Referer: "https://www.google.com/",
};

// ✅ Use HTTPS for localhost:5001
https.createServer(options, app).listen(5001, () => {
  console.log("✅ HTTPS Server running on https://localhost:5001");
});

// 🔄 Optional: Redirect HTTP to HTTPS (port 5000 → 5001)
http
  .createServer((req, res) => {
    res.writeHead(301, { Location: "https://localhost:5001" + req.url });
    res.end();
  })
  .listen(5080);
// Increase payload size limit (e.g., 50MB)
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// Configure environment variables
dotenv.config();
// ✅ Puppeteer route
app.use(fetchWithPuppeteer);
app.use(cors());

// Serve static files from the assets directory

const assetsPath = path.join(__dirname, "assets");
const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;
const BASE_URL = process.env.REACT_APP_BASE_URL;

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

app.post("/api/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");
  const { type, id } = req.query;

  const imagePath = `assets/images/${type}/${req.file.filename}`;

  if (type === "authors") {
    db.query("UPDATE authors SET author_profile_pic = ? WHERE author_id = ?", [
      imagePath,
      id,
    ]);
  } else if (type === "publishers") {
    db.query(
      "UPDATE publishers SET publisher_icon = ? WHERE publisher_id = ?",
      [imagePath, id]
    );
  }

  return res
    .status(200)
    .json({ message: "Upload successful", path: req.file.path });
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
/* app.use((req, res, next) => {
  //console.log(`Incoming request: ${req.method} ${req.originalUrl}`);
  next();
}); */

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
app.post("/api/fetch-pdf-text", async (req, res) => {
  const { url } = req.body;

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const parsed = await pdfParse(Buffer.from(buffer));

    const author = parsed.info?.Author || "";
    const title = parsed.info?.Title || "";
    console.log("📄 PDF parsed OK:", { title, author }); // NEW
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
});

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
app.post("/api/content/:contentId/authors", async (req, res) => {
  const contentId = req.body.contentId;
  const authors = req.body.authors; // Expect an array of authors

  const sql = `CALL InsertOrGetAuthor(?, ?, ?, ?, NULL, @authorId)`;

  try {
    for (const author of authors) {
      const nameParts = author.name.split(" ");

      const [firstName, ...rest] = nameParts;
      const lastName = rest.pop() || ""; // Get the last element or an empty string if the array is empty
      const middleNames = rest.join(" "); // Join the remaining names as middle names

      const title = author.title || null;

      const result = await query(sql, [
        firstName,
        lastName,
        middleNames,
        title,
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
  const { bio } = req.body;

  try {
    await query(`UPDATE authors SET description = ? WHERE author_id = ?`, [
      bio,
      authorId,
    ]);
    res.send({ success: true });
  } catch (err) {
    console.error("Failed to update author bio:", err);
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
      const insertTaskPublisher = `INSERT INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`;
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
  console.log("🔍 Publisher ID:", publisherId);

  const sql = `
    SELECT pr.*, t.topic_name 
    FROM publisher_ratings pr 
    JOIN topics t ON pr.topic_id = t.topic_id 
    WHERE pr.publisher_id = ?
  `;

  console.log("📘 SQL:", sql.trim());
  console.log("📘 Params:", [publisherId]);

  try {
    const rows = await query(sql, [publisherId]);
    console.log("📦 Query result:", rows);
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

// Register endpoint
app.post("/api/register", (req, res) => {
  const { username, password, email } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  const sql = "INSERT INTO users (username, password, email) VALUES (?, ?, ?)";
  const params = [username, hashedPassword, email];

  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error("Error registering user:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.status(200).send("User registered!");
  });
});

// Login endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const sql = "SELECT * FROM users WHERE username = ?";
  const params = [username, password];
  pool.query(sql, params, (err, results) => {
    if (err) {
      console.error("Error logging in user:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    if (results.length === 0) return res.status(404).send("User not found.");

    const user = results[0];
    if (bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.status(200).json({ auth: true, token });
    } else {
      res.status(401).send("Invalid credentials.");
    }
  });
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

//Tasks
app.get("/api/content/:id", (req, res) => {
  const taskId = req.params.id;

  const sql = `
    SELECT 
      t.*, 
      -- Fetch topic
      (SELECT topic_name 
       FROM topics tt
       JOIN content_topics ct ON tt.topic_id = ct.topic_id
       WHERE ct.content_id = t.content_id
       ORDER BY ct.topic_order ASC
       LIMIT 1) AS topic,
      -- Authors
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'author_id', a.author_id, 
            'author_first_name', IFNULL(a.author_first_name, ' '), 
            'author_last_name', IFNULL(a.author_last_name, ' ')
          )
        ), 
        JSON_ARRAY()
      ) AS authors,
      -- Publishers
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'publisher_id', p.publisher_id, 
            'publisher_name', p.publisher_name
          )
        ), 
        JSON_ARRAY()
      ) AS publishers
    FROM content t
    LEFT JOIN content_authors ta ON t.content_id = ta.content_id
    LEFT JOIN authors a ON ta.author_id = a.author_id
    LEFT JOIN content_publishers tp ON t.content_id = tp.content_id
    LEFT JOIN publishers p ON tp.publisher_id = p.publisher_id
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
  (
  
    SELECT topic_name 
    FROM topics tt
    JOIN content_topics ct ON tt.topic_id = ct.topic_id
    WHERE ct.content_id = t.content_id
    ORDER BY ct.topic_order ASC
    LIMIT 1
  ) AS topic,
  JSON_ARRAYAGG(
    JSON_OBJECT(
      'author_id', a.author_id,
      'author_first_name', a.author_first_name,
      'author_last_name', a.author_last_name
    )
  ) AS authors,
  JSON_ARRAYAGG(
    JSON_OBJECT(
      'publisher_id', p.publisher_id,
      'publisher_name', p.publisher_name
    )
  ) AS publishers
FROM content t
LEFT JOIN content_authors ca ON t.content_id = ca.content_id
LEFT JOIN authors a ON ca.author_id = a.author_id
LEFT JOIN content_publishers cp ON t.content_id = cp.content_id
LEFT JOIN publishers p ON cp.publisher_id = p.publisher_id
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
  const sql =
    "SELECT * FROM topics WHERE topic_id IN (SELECT DISTINCT(topic_id) FROM content_topics WHERE topic_order=1) ORDER BY topic_name";

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

  const sql = `
SELECT 
    c.claim_id,
    c.claim_text,
    c.veracity_score,
    c.confidence_level,
    c.last_verified,
    COALESCE(GROUP_CONCAT(DISTINCT cc.relationship_type ORDER BY cc.relationship_type SEPARATOR ', '), '') AS relationship_type,  -- ✅ Fix for GROUP BY
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
GROUP BY c.claim_id;



  `;
  console.log("Fetching claims for content_id:", content_id);

  const params = [content_id];
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
  } = req.body;

  if (!source_claim_id || !target_claim_id || !user_id) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const sql = `
      INSERT INTO claim_links 
        (source_claim_id, target_claim_id, relationship, user_id, support_level)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      source_claim_id,
      target_claim_id,
      relationship,
      user_id,
      support_level,
    ];

    await query(sql, params);
    res.status(201).json({ message: "Claim link created" });
  } catch (err) {
    console.error("❌ Error inserting claim link:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//add claims in batch for a content_id (as in a scrape)
// and link the claim to the content_id
app.post("/api/claims/add", async (req, res) => {
  try {
    const { content_id, claims, content_type } = req.body;

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
            "INSERT INTO content_claims (content_id, claim_id, relationship_type) VALUES (?,?,?)",
            [content_id, claimId, content_type]
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
  //console.log("IMAGEFILENAME:", imagePath);
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
        Referer: thumbnail, // Optional: Helps if the server checks the origin
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    const buffer = Buffer.from(response.data, "binary");

    try {
      await sharp(buffer).resize({ width: 300 }).toFile(imagePath);
    } catch (error) {
      console.error("Error resizing image:", error);
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
  } catch (imageError) {
    console.error("Error handling image:", imageError);
    res.status(500).send("Image processing error");
  }
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

/* app.post("/api/checkAndDownloadTopicIcon", async (req, res) => {
  const { generalTopic } = req.body;

  try {
    // Check if the topic exists in topics or topicAliases
    const topicQuery = `
      SELECT topics.topic_id 
      FROM topics
      LEFT JOIN topic_aliases ON topics.topic_id = topic_aliases.topic_id
      WHERE topics.topic_name = ? OR topic_aliases.alias_name = ?
    `;
    const results = await query(topicQuery, [generalTopic, generalTopic]);
    console.log(results, generalTopic, ":results for check topi");
    if (results.length > 0) {
      // Topic or alias exists, return null for the thumbnail
      return res.status(200).send({ exists: true, thumbnail_url: null });
    }

    // If not found, fetch icon
    const icon = await fetchIconForTopic(generalTopic, query); // Fetch the icon from the Noun Project

    if (!icon) {
      throw new Error(`Failed to fetch icon for topic: ${generalTopic}`);
    }

        const imagePath = `./assets/images/topics/${generalTopic.replace(
      /\s+/g,
      "_"
    )}.png`;

    // Download and convert the image to PNG if necessary
     const response = await axios.get(icon, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data);

    // Use Sharp to convert to PNG
    await sharp(buffer).png().toFile(imagePath);

    // Return the local thumbnail URL
    const thumbnailUrl = `assets/images/topics/${generalTopic.replace(
      /\s+/g,
      "_"
    )}.png`;
    res.status(200).send({ exists: false, thumbnail_url: icon });
  } catch (error) {
    console.error("Error in checkAndDownloadTopicIcon:", error);
    res.status(500).send({ error: "Failed to process topic icon." });
  }
});
 */
app.post("/api/fetch-page-content", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    console.error("❌ Invalid or missing URL:", url);
    return res.status(400).json({ error: "Invalid or missing URL" });
  }

  try {
    console.log(`🌍 Fetching external page: ${url}`);

    const response = await axios.get(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Referer: url, // Include referer for added authenticity
      },
      timeout: 3000, // Increased timeout to 3 seconds
    });

    console.log(
      `✅ Successfully fetched ${response.data.length} bytes from ${url}`
    );
    return res.json({ html: response.data });
  } catch (error) {
    console.error("❌ Error fetching external page:", error.message);
    res.status(500).json({ error: "Failed to fetch page content" });
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
    const { claimNodeSql, claimLinkSql, params } =
      getLinkedClaimsAndLinksForTask(taskId);
    const claimNodes = await query(claimNodeSql, params);
    const claimLinks = await query(claimLinkSql, params);

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
