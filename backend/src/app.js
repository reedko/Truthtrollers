// /backend/src/app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

// Initialize pool once globally
import "./db/pool.js";

// V1 existing routes (unchanged)
import analyzeContentRoute from "./routes/analyzeContent.js";
import beaconRoutes from "./routes/beaconRoutes.js";
import discussionRoutes from "./routes/discussionRoutes.js";
import fetchWithPuppeteerRoute from "./routes/fetchWithPuppeteer.js";
import readabilityRoute from "./routes/readability.js";
import referenceClaimRoutes from "./routes/referenceClaimRoutes.js";

// V2 domain routes
import claimsRouter from "./routes/claims/index.js";
import contentRouter from "./routes/content/index.js";
import tasksRouter from "./routes/tasks/index.js";
import scoresRouter from "./routes/scores/index.js";
import graphRouter from "./routes/graph/index.js";
import claimLinksRouter from "./routes/claimLinks/index.js";
import claimSourcesRouter from "./routes/claimSources/index.js";
import testimonialsRouter from "./routes/testimonials/index.js";
import usersRouter from "./routes/users/index.js";
import scrapeRouter from "./routes/scrape/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // ───────────────────────────────────────────
  // Trust proxy (needed for HTTPS behind nginx)
  // ───────────────────────────────────────────
  app.set("trust proxy", true);

  // ───────────────────────────────────────────
  // Preflight & PNA handler (before CORS)
  // ───────────────────────────────────────────
  const allowedOrigins = [
    "https://localhost:5173",
    "https://localhost:5001",
    "http://localhost:5173",
    "http://localhost:5001",
    "https://truthtrollers.com",
    "chrome-extension://phacjklngoihnlhcadefaiokbacnagbf",
    "safari-web-extension://<your-safari-id>",
  ];

  app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      if (!origin || allowedOrigins.includes(origin)) {
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
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );

  // Body parsers
  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
  app.use(cookieParser());

  // Static assets (unchanged behavior)
  app.use("/assets", express.static(path.join(__dirname, "..", "assets")));

  // ───────────────────────────────────────────
  // V1 routes (preserved)
  // ───────────────────────────────────────────
  app.use("/api/analyze-content", analyzeContentRoute);
  app.use("/api/beacon", beaconRoutes);
  app.use("/api/discussions", discussionRoutes);
  app.use("/api/fetch-puppeteer", fetchWithPuppeteerRoute);
  app.use("/api/extract-text", readabilityRoute);
  app.use("/api/reference-claims", referenceClaimRoutes);

  // ───────────────────────────────────────────
  // V2 routes (modularized)
  // ───────────────────────────────────────────
  app.use("/api/claims", claimsRouter);
  app.use("/api/content", contentRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/scores", scoresRouter);
  app.use("/api/graph", graphRouter);
  app.use("/api/claim-links", claimLinksRouter);
  app.use("/api/claim-sources", claimSourcesRouter);
  app.use("/api/testimonials", testimonialsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/scrape", scrapeRouter);

  // Health check
  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", timestamp: Date.now() })
  );

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
