// backend/src/routes/admin/seedData.routes.js
// ──────────────────────────────────────────────────────────────────
// CRUD API for publisher seed data files (AllSides, MBFC, AdFontes, OpenSources).
// Files are read from / written to backend/data/seeds/*.json.
// Mutations reload the in-memory cache in each provider automatically.
// ──────────────────────────────────────────────────────────────────

import { Router } from "express";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { authenticateToken } from "../../middleware/auth.js";
import logger from "../../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = join(__dirname, "../../../../data/seeds");

const SOURCES = ["allsides", "adfontes", "mbfc", "opensources"];

function seedPath(source) {
  return join(SEEDS_DIR, `${source}.json`);
}

function readSeed(source) {
  const raw = readFileSync(seedPath(source), "utf8");
  return JSON.parse(raw);
}

function writeSeed(source, data) {
  writeFileSync(seedPath(source), JSON.stringify(data, null, 2), "utf8");
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "super_admin required" });
  }
  next();
}

export default function createSeedDataRoutes() {
  const router = Router();

  // ── GET /api/admin/seeds/:source ──────────────────────────────────
  // Returns current seed data for a source.
  router.get("/api/admin/seeds/:source", authenticateToken, requireSuperAdmin, (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return res.status(404).json({ success: false, error: `Unknown source: ${source}` });
    }
    try {
      const data = readSeed(source);
      return res.json({ success: true, source, data });
    } catch (err) {
      logger.error(`[seeds] Error reading ${source}:`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/admin/seeds/:source/entry ───────────────────────────
  // Upserts a single entry.  For array sources (allsides, adfontes, mbfc)
  // matches on domain; for opensources (object) uses domain as key.
  router.post("/api/admin/seeds/:source/entry", authenticateToken, requireSuperAdmin, (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return res.status(404).json({ success: false, error: `Unknown source: ${source}` });
    }
    const entry = req.body;
    if (!entry || !entry.domain) {
      return res.status(400).json({ success: false, error: "Entry must include a domain field" });
    }
    try {
      if (source === "opensources") {
        const data = readSeed(source);
        const { domain, ...rest } = entry;
        data[domain] = rest;
        writeSeed(source, data);
      } else {
        const data = readSeed(source);
        const idx = data.findIndex(e => e.domain === entry.domain);
        if (idx >= 0) {
          data[idx] = { ...data[idx], ...entry };
        } else {
          data.push(entry);
        }
        writeSeed(source, data);
      }
      logger.log(`[seeds] Upserted entry in ${source}: ${entry.domain}`);
      return res.json({ success: true, domain: entry.domain });
    } catch (err) {
      logger.error(`[seeds] Error upserting in ${source}:`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── DELETE /api/admin/seeds/:source/entry ─────────────────────────
  // Removes an entry by domain.
  router.delete("/api/admin/seeds/:source/entry", authenticateToken, requireSuperAdmin, (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return res.status(404).json({ success: false, error: `Unknown source: ${source}` });
    }
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: "domain is required" });
    }
    try {
      if (source === "opensources") {
        const data = readSeed(source);
        delete data[domain];
        writeSeed(source, data);
      } else {
        const data = readSeed(source);
        const filtered = data.filter(e => e.domain !== domain);
        writeSeed(source, filtered);
      }
      logger.log(`[seeds] Deleted ${domain} from ${source}`);
      return res.json({ success: true });
    } catch (err) {
      logger.error(`[seeds] Error deleting from ${source}:`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/admin/seeds/:source/import ──────────────────────────
  // Bulk-replaces seed data.  Accepts the full data payload (array or object).
  router.post("/api/admin/seeds/:source/import", authenticateToken, requireSuperAdmin, (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return res.status(404).json({ success: false, error: `Unknown source: ${source}` });
    }
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, error: "data field required" });
    }
    const isArray = source !== "opensources";
    if (isArray && !Array.isArray(data)) {
      return res.status(400).json({ success: false, error: `${source} expects an array` });
    }
    if (!isArray && (Array.isArray(data) || typeof data !== "object")) {
      return res.status(400).json({ success: false, error: "opensources expects an object" });
    }
    try {
      writeSeed(source, data);
      const count = isArray ? data.length : Object.keys(data).length;
      logger.log(`[seeds] Bulk-imported ${count} entries into ${source}`);
      return res.json({ success: true, count });
    } catch (err) {
      logger.error(`[seeds] Error bulk-importing into ${source}:`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
