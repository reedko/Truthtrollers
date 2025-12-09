// extractRoutes.js
import fs from "fs";

const text = fs.readFileSync("./server.js", "utf8");

// REGEX PASS 1 – direct routes (app.get/post/put/delete)
const regexApp =
  /app\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

// REGEX PASS 2 – router or inline router definitions
const regexRouter =
  /(router|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

const results = new Set();

// Helper to add route to set
function add(method, path) {
  method = method.toUpperCase();
  const line = `${method}  ${path}`;
  results.add(line);
}

// PASS 1
let m;
while ((m = regexApp.exec(text)) !== null) {
  add(m[1], m[2]);
}

// PASS 2
while ((m = regexRouter.exec(text)) !== null) {
  const method = m[2] || m[1]; // router vs app
  const path = m[3] || m[2];
  add(method, path);
}

// OUTPUT
console.log("\n==== UNIQUE ROUTES ====\n");
const sorted = Array.from(results).sort();
console.log(sorted.join("\n"));
console.log("\n=======================\n");

console.log(`TOTAL UNIQUE ROUTES: ${sorted.length}\n`);
