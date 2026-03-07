// /backend/server.js
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════
// GLOBAL ERROR HANDLERS - Catch all uncaught errors
// ═══════════════════════════════════════════════
process.on('uncaughtException', (error) => {
  const errMsg = `
🔥🔥🔥 UNCAUGHT EXCEPTION 🔥🔥🔥
Time: ${new Date().toISOString()}
Error: ${error.message}
Stack: ${error.stack}
🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥
`;
  process.stderr.write(errMsg);
  console.error(errMsg);
  // Don't exit - let PM2 handle restart if needed
});

process.on('unhandledRejection', (reason, promise) => {
  const errMsg = `
⚠️⚠️⚠️ UNHANDLED PROMISE REJECTION ⚠️⚠️⚠️
Time: ${new Date().toISOString()}
Reason: ${reason}
Promise: ${promise}
Stack: ${reason?.stack || 'No stack trace'}
⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
`;
  process.stderr.write(errMsg);
  console.error(errMsg);
});

import fs from "fs-extra";
import http from "http";
import https from "https";
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { dirname } from "path";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import mysql from "mysql";
import { promisify } from "util";

// ─────────────────────────────────────────────
// V1 register-style routes (legacy, but still used)
// ─────────────────────────────────────────────
import registerBeaconRoutes from "./src/routes/beaconRoutes.js";
import registerDiscussionRoutes from "./src/routes/discussionRoutes.js";
import analyzeContentRoute from "./src/routes/analyzeContent.js";
// NOTE: referenceClaimRoutes and fetchWithPuppeteer are in temp/, not src/routes/
// These will be refactored later

// ─────────────────────────────────────────────
// V2 router-style domains (new modular routes)
// ─────────────────────────────────────────────
import createAuthRouter from "./src/routes/auth/index.js";
import createUsersRouter from "./src/routes/users/index.js";
import createContentRouter from "./src/routes/content/index.js";
import createAuthorsRouter from "./src/routes/authors/index.js";
import createPublishersRouter from "./src/routes/publishers/index.js";
import createClaimsRouter from "./src/routes/claims/index.js";
import createReferencesRouter from "./src/routes/references/index.js";
import createScoresRouter from "./src/routes/scores/index.js";
import createTopicsRouter from "./src/routes/topics/index.js";
import createTestimonialsRouter from "./src/routes/testimonials/index.js";
import createMiscRouter from "./src/routes/misc/index.js";
import createGraphRouter from "./src/routes/graph/index.js";
import createEvidenceRouter from "./src/routes/evidence/index.js";
import createPromptRoutes from "./src/routes/prompts.routes.js";
import createMoleculeViewsRoutes from "./src/routes/molecule-views.routes.js";
import createFacebookRoutes from "./src/routes/social/facebook.routes.js";
import createChatRouter from "./src/routes/chat.routes.js";
import createTutorialsRouter from "./src/routes/tutorials/tutorials.routes.js";
import createAdminRouter from "./src/routes/admin/admin.routes.js";
import createSearchAnalysisRouter from "./src/routes/search-analysis.routes.js";
import { initSocketServer } from "./src/realtime/socketServer.js";

// Logger utility
import { clearLogFile } from "./src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────
// Database Setup (using connection pool for auto-reconnect)
// ─────────────────────────────────────────────
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
  // Auto-reconnect configuration
  acquireTimeout: 10000,
  waitForConnections: true,
  queueLimit: 0,
});

// Use pool for all queries (provides automatic reconnection)
const poolQuery = promisify(pool.query).bind(pool);

const query = async (...args) => {
  try {
    return await poolQuery(...args);
  } catch (error) {
    console.error('❌ [Database] Query failed:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────
// TLS / HTTPS Setup
// ─────────────────────────────────────────────
const httpPort = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 5001);
const DEV_USE_HTTPS =
  String(process.env.DEV_USE_HTTPS || "false").toLowerCase() === "true";

const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_CA_PATH = process.env.SSL_CA_PATH;

// Allow self-signed certs in dev if requested
if (process.env.DEV_TRUST_SELF_SIGNED === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

// ─────────────────────────────────────────────
// App Initialization
// ─────────────────────────────────────────────
const app = express();
app.set("trust proxy", true);

// ─────────────────────────────────────────────
// CORS + Preflight / Private Network Access
// ─────────────────────────────────────────────
const allowedOrigins = [
  "https://localhost:5173",
  "https://localhost:5001",
  "http://localhost:5173",
  "http://localhost:5001",
  "https://truthtrollers.com",
  "http://truthtrollers.com",
  "https://www.truthtrollers.com",
  "http://www.truthtrollers.com",
  "chrome-extension://phacjklngoihnlhcadefaiokbacnagbf",
];

const isAllowedOrigin = (origin) =>
  !origin ||
  allowedOrigins.includes(origin) ||
  origin.startsWith("chrome-extension://") ||
  origin.startsWith("moz-extension://");

app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] || "*"
      );
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      return res.sendStatus(204);
    }
    return res.status(403).send("Not allowed by CORS");
  }
  next();
});

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) {
        return cb(null, true);
      }
      // Log CORS rejections immediately
      const errMsg = `🚫 CORS BLOCKED: origin=${origin} at ${new Date().toISOString()}\n`;
      process.stderr.write(errMsg);
      console.error(errMsg);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// 🔍 REQUEST LOGGER - Log EVERY request that reaches Express
app.use((req, res, next) => {
  const logMsg = `[${new Date().toISOString()}] ${req.method} ${req.path} | Origin: ${req.headers.origin || 'none'} | IP: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}\n`;
  process.stderr.write(logMsg);
  next();
});

app.use(bodyParser.json({ limit: "500mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "500mb" }));
app.use(cookieParser());

// ─────────────────────────────────────────────
// Static assets
// ─────────────────────────────────────────────
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/api/assets", express.static(path.join(__dirname, "assets"))); // Production path

// ─────────────────────────────────────────────
// 🚨 TEMPORARY HACK - REVERT THIS LATER 🚨
// ─────────────────────────────────────────────
// Production nginx config has: location /api/ { proxy_pass http://localhost:3000/; }
// The trailing slash in proxy_pass strips /api/ from the request.
// Example: /api/login → backend receives /login
// This middleware adds /api back so routes like router.post("/api/login") work.
//
// TODO: Figure out why this broke after latest deploy - login was working before.
//       This is a band-aid fix until we identify the root cause.
//       Added: 2026-03-04
app.use((req, res, next) => {
  // Skip if already has /api prefix, or is a static/special route
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/assets') ||
      req.path === '/health' ||
      req.path === '/proxy' ||
      req.path === '/' ||
      req.path.startsWith('/socket.io')) {
    return next();
  }

  // Add /api prefix for nginx-stripped requests
  req.url = '/api' + req.url;
  next();
});

// ─────────────────────────────────────────────
// V1 register-style routes
// (They register their own absolute /api/... paths.)
// ─────────────────────────────────────────────
// app.use(fetchWithPuppeteer); // TODO: Move from temp/ to src/routes/

// registerReferenceClaimRoutes(app, query); // TODO: Move from temp/ to src/routes/
registerBeaconRoutes(app, query, pool);
registerDiscussionRoutes(app, query, pool);
app.use("/api/analyze-content", analyzeContentRoute);

// ─────────────────────────────────────────────
// V2 modular routers, all mounted flat under /api
// Each index.js composes its internal *.routes.js files.
// The individual route files *do not* have /api prefix.
// ─────────────────────────────────────────────
// Mount new modular routes (routes already include /api in their paths)
app.use("/", createAuthRouter({ query, pool })); // Auth routes: /api/register, /api/login, etc.
app.use("/", createUsersRouter({ query, pool })); // User routes: /api/all-users, /api/change-email, etc.
app.use("/", createContentRouter({ query, pool })); // Content routes: /api/content, /api/tasks, etc.
app.use("/", createAuthorsRouter({ query, pool })); // Authors routes: /api/authors, /api/content/:id/authors, etc.
app.use("/", createPublishersRouter({ query, pool })); // Publishers routes: /api/publishers, /api/content/:id/publishers, etc.
app.use("/", createClaimsRouter({ query, pool })); // Claims routes: /api/claims, /api/claim-verifications, etc.
app.use("/", createReferencesRouter({ query, pool })); // References routes: /api/references, /api/content/:id/auth_references, etc.
app.use("/", createScoresRouter({ query, pool })); // Scores routes: /api/live-verimeter-score, /api/content/:id/scores, etc.
app.use("/", createTopicsRouter({ query, pool })); // Topics routes: /api/topics, etc.
app.use("/", createTestimonialsRouter({ query, pool })); // Testimonials routes: /api/testimonials/add, etc.
app.use("/", createMiscRouter({ query, pool })); // Misc routes: /api/upload-image, /api/youtube-transcript, PDF, etc.
app.use("/", createGraphRouter({ query, pool })); // Graph routes: /api/get-graph-data (molecule map)
app.use("/", createEvidenceRouter({ query, pool }));
app.use("/", createPromptRoutes({ query })); // Prompt management routes: /api/prompts
app.use("/", createMoleculeViewsRoutes({ query, pool })); // Molecule views routes: /api/molecule-views
app.use("/", createFacebookRoutes({ query })); // Facebook scraping routes: /api/scrape-facebook-post
app.use("/", createChatRouter({ pool }));      // Chat routes: /api/chat/*, /api/users/search
app.use("/", createSearchAnalysisRouter({ query, pool })); // Search analysis routes: /api/search-analysis
app.use("/", createTutorialsRouter({ query })); // Tutorial videos routes: /api/tutorials
app.use("/", createAdminRouter({ query }));     // Admin routes: /api/admin/*, super_admin only
// ─────────────────────────────────────────────
// Health + Simple Proxy (top-level, legacy behavior)
// ─────────────────────────────────────────────

// Old /health probe (used by infra / browser checks)
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

// Lightweight GET proxy, as in the old giant server.js
// Usage: /proxy?url=https%3A%2F%2Fexample.com
app.get("/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing url query param" });
  }
  try {
    const upstream = await axios.get(url, { responseType: "stream" });
    // Pass through content-type and basic headers
    if (upstream.headers["content-type"]) {
      res.setHeader("Content-Type", upstream.headers["content-type"]);
    }
    upstream.data.pipe(res);
  } catch (err) {
    console.error("❌ /proxy error:", err.message || err);
    res.status(500).json({ error: "Proxy fetch failed" });
  }
});

// Optional: if you also want /api/health to work:
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

// ─────────────────────────────────────────────
// Initialize Logger (clear log file on startup)
// ─────────────────────────────────────────────
clearLogFile();

// ─────────────────────────────────────────────
// Database Health Check (fail fast if DB is down)
// ─────────────────────────────────────────────
async function checkDatabaseConnection() {
  try {
    console.log("🔍 Checking database connection...");
    await query("SELECT 1");
    console.log("✅ Database connection successful");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    console.error("💡 Make sure MySQL is running: mysql.server start");
    process.exit(1); // Exit with error code
  }
}

// Check DB before starting servers
await checkDatabaseConnection();

// ─────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────
const httpServer = http.createServer(app);
initSocketServer(httpServer, pool); // Attach Socket.io for real-time chat
httpServer.listen(httpPort, () => {
  console.log(`🌐 HTTP server on http://localhost:${httpPort}`);
});

// ─────────────────────────────────────────────
// HTTPS Server (dev) — matches old behavior
// ─────────────────────────────────────────────
if (
  DEV_USE_HTTPS &&
  SSL_KEY_PATH &&
  SSL_CERT_PATH &&
  fs.existsSync(SSL_KEY_PATH) &&
  fs.existsSync(SSL_CERT_PATH)
) {
  const httpsOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
    ...(SSL_CA_PATH && fs.existsSync(SSL_CA_PATH)
      ? { ca: fs.readFileSync(SSL_CA_PATH) }
      : {}),
  };

  const httpsServer = https.createServer(httpsOptions, app);
  httpsServer.listen(httpsPort, () => {
    console.log(`🔐 HTTPS server on https://localhost:${httpsPort}`);
  });
} else if (DEV_USE_HTTPS) {
  console.warn(
    "⚠️ DEV_USE_HTTPS=true but SSL files missing. Serving HTTP only."
  );
}
