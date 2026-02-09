// Quick test to verify /api/assets path configuration
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Both paths should work
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/api/assets", express.static(path.join(__dirname, "assets")));

const port = 3333;

app.listen(port, () => {
  console.log(`Test server running on http://localhost:${port}`);
  console.log('\nTest these URLs in your browser:');
  console.log(`  http://localhost:${port}/assets/images/content/content_id_11254.jpeg`);
  console.log(`  http://localhost:${port}/api/assets/images/content/content_id_11254.jpeg`);
  console.log('\nBoth should serve the same image. Press Ctrl+C to stop.\n');
});
