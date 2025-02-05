// Import dependencies
import fetchIconForTopic from "../extension/src/services/fetchIconForTopic.js"; // Assuming the service uses export default
import express from "express";
import mysql from "mysql";
import bodyParser from "body-parser";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import dotenv from "dotenv";
import "cheerio";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Increase payload size limit (e.g., 50MB)
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// Configure environment variables
dotenv.config();

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
// Serve static files from the assets directory

const assetsPath = path.join(__dirname, "assets");
const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;

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
  console.log("MySQL connected!");
});

app.listen(3000, () => console.log("Proxy server running on port 3000"));

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
  console.log(`Incoming request: ${req.method} ${req.originalUrl}`);
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
    //console.log("respose:", response);
    res.send(response.data);
  } catch (error) {
    console.error("Error fetching the URL:");
    res.status(500).send("Failed to fetch data");
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

//Get Authors
app.get("/api/tasks/:taskId/authors", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM authors a join task_authors ta 
  on a.author_id = ta.author_id WHERE task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Get task_Authors
app.get("/api/tasks/:taskId/task_authors", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM  task_authors
  WHERE task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching authors");
    }

    return res.json(rows);
  });
});

//Add Authors
app.post("/api/tasks/:taskId/authors", async (req, res) => {
  const { taskId } = req.params;
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
        const insertTaskAuthor = `INSERT INTO task_authors (task_id, author_id) VALUES (?, ?)`;
        await pool.query(insertTaskAuthor, [taskId, authorId]);
      }
    }
    res.status(200).send("Authors added successfully");
  } catch (error) {
    console.error("Error inserting authors:", error);
    res.status(500).send("Error adding authors");
  }
});

//Get publishers
app.get("/api/tasks/:taskId/publishers", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM publishers a join task_publishers ta 
  on a.publisher_id = ta.publisher_id WHERE task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      // console.log(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching publishers");
    }

    return res.json(rows);
  });
});

//Add publishers
app.post("/api/tasks/:taskId/publishers", async (req, res) => {
  const { taskId } = req.params;
  const publisher = req.body.publisher; // Expect a single publisher object

  const sql = `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`;

  try {
    const result = await query(sql, [publisher.name]);
    const publisherId = result[0][0].publisherId;

    if (publisherId) {
      const insertTaskPublisher = `INSERT INTO task_publishers (task_id, publisher_id) VALUES (?, ?)`;
      await pool.query(insertTaskPublisher, [taskId, publisherId]);
    }
    res.status(200).send("Publisher added successfully");
  } catch (error) {
    console.error("Error inserting publisher:", error);
    res.status(500).send("Error adding publisher");
  }
});

//Get auth_references
app.get("/api/tasks/:taskId/auth_references", async (req, res) => {
  const { taskId } = req.params;
  const sql = `
  select * from auth_references where 
  (auth_id in (select author_id from task_authors where task_id=?)) 
  or 
  (lit_reference_id in 
  (select lit_reference_id from task_references where task_id=?))
`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error auth_references");
    }

    return res.json(rows);
  });
});
//Get References, aka source because reference is a reserved word
app.get("/api/tasks/:taskId/source-references", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM lit_references lr join task_references tr 
  on lr.lit_reference_id = tr.lit_reference_id WHERE task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      //(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching references");
    }

    return res.json(rows);
  });
});

//Get task_references
app.get("/api/tasks/:taskId/task_references", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT * FROM  task_references ta 
  WHERE task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      //console.log(rows, taskId);
      console.error(err);
      return res.status(500).send("Error fetching referenceieseses");
    }

    return res.json(rows);
  });
});

//Add References
app.post("/api/tasks/:taskId/add-source", async (req, res) => {
  const { taskId } = req.params;
  const reference = req.body.lit_reference; // Expect an array of reference URLs

  const link = reference.lit_reference_link;
  const title = reference.lit_reference_title;

  const sql = `CALL InsertOrGetReference(?, ?,@litReferenceId)`;

  try {
    const result = await query(sql, [link, title]);

    const litReferenceId = result[0][0].litReferenceId;

    if (litReferenceId) {
      const insertTaskReference = `INSERT INTO task_references (task_id, lit_reference_id) VALUES (?, ?)`;
      await pool.query(insertTaskReference, [taskId, litReferenceId]);
    }

    res.status(200).send("References added successfully");
  } catch (error) {
    console.error("Error inserting references:", error);
    res.status(500).send("Error adding references");
  }
});

app.post("/api/tasks/:taskId/remove-sources", async (req, res) => {
  const { taskId } = req.params;
  const { sources } = req.body;
  const sql = `DELETE FROM task_references WHERE task_id = ? AND lit_reference_id IN (?)`;
  pool.query(sql, [taskId, sources], (err) => {
    if (err) return res.status(500).send("Error removing sources");
    res.send("Sources removed");
  });
});

app.post("/api/tasks/:taskId/add-sourcex", async (req, res) => {
  const { taskId } = req.params;
  const { name } = req.body;
  const sql = `INSERT INTO lit_references (name) VALUES (?)`;
  pool.query(sql, [name], (err, result) => {
    if (err) return res.status(500).send("Error adding source");
    const referenceId = result.insertId;
    const linkSql = `INSERT INTO task_references (task_id, lit_reference_id) VALUES (?, ?)`;
    pool.query(linkSql, [taskId, referenceId], (linkErr) => {
      if (linkErr) return res.status(500).send("Error linking source");
      res.json({ id: referenceId, name });
    });
  });
});

//Users
//all users
app.get("/api/all-users", async (req, res) => {
  const sql = "SELECT * FROM users";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching task_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});
//Users assigned to a task
app.get("/api/tasks/:taskId/get-users", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT u.username,u.user_id
       FROM users u
       JOIN task_users tu ON u.user_id = tu.user_id
       WHERE tu.task_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error("Error fetching task_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    if (rows && rows[0]) {
      res.json(rows);
    }
  });
});

app.post("/api/tasks/:taskId/assign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `INSERT INTO task_users (task_id, user_id) VALUES (?, ?)`;
  const params = [taskId, userId];
  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error assigning user to task");
    }
    res.status(200).send("User assigned successfully");
  });
});
app.post("/api/tasks/:taskId/unassign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `DELETE FROM task_users WHERE task_id = ? AND user_id = ?`;

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
app.get("/api/tasks", (req, res) => {
  const sql = "SELECT * FROM tasks";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching tasks:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    res.json(results);
  });
});

//task_topics?
app.get("/api/task_topics", (req, res) => {
  const sql = "SELECT * FROM task_topics";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching task_topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

//Topics
app.get("/api/topics", (req, res) => {
  const sql =
    "SELECT * FROM topics where topic_id in (SELECT distinct(topic_id) FROM task_topics where topic_order=1) ";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching topics:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    res.json(results);
  });
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
  const query = "SELECT * FROM tasks WHERE url = ?";
  db.query(query, [url], (err, results) => {
    if (err) return res.status(500).send({ error: err });
    if (results.length > 0) {
      res.send({ exists: true, task: results[0] });
    } else {
      res.send({ exists: false });
    }
  });
});

app.post("/api/scrape", async (req, res) => {
  const {
    task_name,
    url,
    media_source,
    topic,
    subtopics,
    users,
    details,
    thumbnail_url,
    assigned,
    progress,
    iconThumbnailUrl,
  } = req.body;

  // Step 1: Insert the task without the thumbnail path
  const callQuery = `CALL InsertTaskAndTopics(?, ?, ?, ?, ?, ?, ?, ?, ?, ?,@taskId);`;

  const params = [
    task_name, // Task name
    url, // URL
    media_source, // Media source
    topic, // Main topic
    JSON.stringify(subtopics), // Subtopics as JSON string
    users, // Users
    details, // Task details
    assigned, // Assigned status
    progress, // Progress status
    iconThumbnailUrl ? iconThumbnailUrl : "",
  ];

  try {
    // Execute the procedure
    await db.query(callQuery, params);
  } catch (err) {
    console.error("Error inserting task:", err);
    return res.status(500).send("Database error during task insertion");
  }
  let taskId = null;
  try {
    const fetchTaskIdQuery = "SELECT task_id FROM tasks WHERE url = ?";
    const results = await query(fetchTaskIdQuery, [url]);
    if (results.length === 0) {
      throw new Error("Task ID not found");
    }

    taskId = results[0].task_id;
  } catch (err) {
    console.log("Detailed Catch Error:", JSON.stringify(err, null, 2));
    res.status(500).send("Database error during task ID fetch.");
  }
  const imageFilename = `task_id_${taskId}.png`;

  const imagePath = `assets/images/tasks/${imageFilename}`;

  try {
    // Step 2: Download and resize the image

    const response = await axios.get(thumbnail_url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Referer: thumbnail_url, // Optional: Helps if the server checks the origin
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
    const updateQuery = "UPDATE tasks SET thumbnail = ? WHERE task_id = ?";
    db.query(updateQuery, [relativeImagePath, taskId], (updateErr) => {
      if (updateErr) {
        console.error("Error updating task with thumbnail:", updateErr);
        return res.status(500).send("Database update error");
      }

      res.status(200).send({ success: true, task_id: taskId });
    });
  } catch (imageError) {
    console.error("Error handling image:", imageError);
    res.status(500).send("Image processing error");
  }
});

// Endpoint to fetch article data using Diffbot
// server.js

// server.js
app.post("/api/get-title", async (req, res) => {
  try {
    const { url } = req.body; // ✅ Fix: Use `url` instead of `Aurl`

    if (!url) {
      return res.status(400).json({ error: "Missing URL in request body" });
    }
    const response = await axios.get(`${DIFFBOT_BASE_URL}/article`, {
      params: {
        token: DIFFBOT_TOKEN,
        url,
        fields: "title",
      },
    });

    const title = response.data.objects?.[0]?.title || {};
    console.log(title, "<-object title");
    return res.status(200).json({ title });
  } catch (err) {
    console.error(`Diffbot API failed for title:`, err);
    return null;
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
        publisher: "Unknown Publisher",
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
      publisher: "Unknown Publisher",
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
    // Check if the topic exists in topics or topicAliases
    const topicQuery = `
      SELECT topics.topic_id 
      FROM topics
      LEFT JOIN topic_aliases ON topics.topic_id = topic_aliases.topic_id
      WHERE topics.topic_name = ? OR topic_aliases.alias_name = ?
    `;
    const results = await query(topicQuery, [generalTopic, generalTopic]);

    if (results.length > 0) {
      // Topic or alias exists, return null for the thumbnail
      return res.status(200).send({ exists: true, thumbnail_url: null });
    }

    // If not found, fetch icon
    const icon = await fetchIconForTopic(generalTopic); // Fetch the icon from the Noun Project

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
    res.status(201).send({ exists: false, thumbnail_url: thumbnailUrl });
  } catch (error) {
    console.error("Error in checkAndDownloadTopicIcon:", error);
    res.status(500).send({ error: "Failed to process topic icon." });
  }
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
