import { readFile } from "fs/promises";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Setup path resolution (since __dirname isn't available in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read HTML file
const html = await readFile(path.join(__dirname, "fortune.html"), "utf-8");

const body = {
  url: "https://fortune.com/well/article/polio-vaccine-fda-petition-rfk-jr-aaron-siri/",
  html,
};

try {
  const res = await fetch("https://localhost:5001/api/extract-readable-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("✅ Response from readability endpoint:");
  console.log(data);
} catch (err) {
  console.error("❌ Error sending request:", err);
}
