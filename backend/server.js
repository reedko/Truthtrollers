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

// Configure environment variables
dotenv.config();

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
// Serve static files from the assets directory
const BASE_URL = process.env.BASE_URL || "http://localhost:5001";
const assetsPath = path.join(__dirname, "assets");
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
//setup proxy access

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
    console.log(articleContent);
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

  db.query(
    "INSERT INTO users (username, password, email) VALUES (?, ?, ?)",
    [username, hashedPassword, email],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.status(200).send("User registered!");
    }
  );
});

// Login endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  console.log("got here0");

  db.query(
    "SELECT * FROM users WHERE username = ?",
    [username],
    (err, results) => {
      if (err) {
        console.error("Database query error:", err); // Log the error for better insight
        return res.status(500).send("Internal server error");
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

// Task results endpoint (simplified)
/* app.get('/api/tasks', (req, res) => {
    console.log('got here0wer');
    const sql = 'SELECT * FROM tasks'; // Your query to get all tasks
    pool.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching tasks:', err);
            return res.status(500).json({ error: 'Database query failed' });
        }
        res.json(results);
    });
}); */

app.get("/api/tasks", (req, res) => {
  console.log("API call received for tasks");
  const sql = "SELECT * FROM tasks";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching tasks:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    console.log("Fetched tasks:", results); // Log the results
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
    console.log("Task successfully inserted with ID:", taskId);
  } catch (err) {
    console.log("Detailed Catch Error:", JSON.stringify(err, null, 2));
    res.status(500).send("Database error during task ID fetch.");
  }
  const imageFilename = `task_id_${taskId}.png`;

  const imagePath = `./assets/images/tasks/${imageFilename}`;
  console.log("image", imageFilename);
  try {
    // Step 2: Download and resize the image
    const response = await axios.get(thumbnail_url, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data, "binary");

    try {
      await sharp(buffer).resize({ width: 300 }).toFile(imagePath);
      console.log("Image resized and saved to:", imagePath);
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
    console.log("RAWR:", results);
    if (results.length > 0) {
      // Topic or alias exists, return null for the thumbnail
      return res.status(200).send({ exists: true, thumbnail_url: null });
    }

    // If not found, fetch icon
    const icon = await fetchIconForTopic(generalTopic); // Fetch the icon from the Noun Project
    console.log("ICON RETURN", icon);
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
