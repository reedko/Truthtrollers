// scanRoutes.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root of your routes directory
const ROUTES_DIR = path.join(__dirname, "src", "routes");

// Regex to match Express routes
// Matches: router.get("/path", ...), app.post('/x', ...)
const ROUTE_REGEX =
  /(router|app)\.(get|post|put|delete)\s*\(\s*["'`](.*?)["'`]/gi;

let allRoutes = [];

// Recursively walk folders
function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      walk(full);
    } else if (
      f.endsWith(".js") ||
      f.endsWith(".mjs")
      // remove ".ts" if you want to skip TS files
    ) {
      const src = fs.readFileSync(full, "utf8");

      let match;
      while ((match = ROUTE_REGEX.exec(src)) !== null) {
        const method = match[2].toUpperCase();
        const route = match[3];
        allRoutes.push({ method, route, file: full });
      }
    }
  }
}

walk(ROUTES_DIR);

// Deduplicate
const unique = [];
const seen = new Set();

for (const r of allRoutes) {
  const key = `${r.method} ${r.route}`;
  if (!seen.has(key)) {
    unique.push(r);
    seen.add(key);
  }
}

// Sort nicely
unique.sort((a, b) => {
  if (a.method !== b.method) return a.method.localeCompare(b.method);
  return a.route.localeCompare(b.route);
});

// Pretty print
console.log("\n==== ROUTES FOUND IN /src/routes ====\n");

for (const r of unique) {
  console.log(
    `${r.method.padEnd(6)} ${r.route}   ← ${path.relative(__dirname, r.file)}`
  );
}

console.log(`\nTOTAL ROUTES: ${unique.length}\n`);
