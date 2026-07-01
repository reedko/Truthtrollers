import path from "path";
import fs from "fs";
import axios from "axios";
import { spawn } from "child_process";

// 1) Helper to spawn pdftocairo, returning a Promise
function spawnPdftocairo(inputPdf, outputBase) {
  return new Promise((resolve, reject) => {
    const proc = spawn("/usr/local/bin/pdftocairo", [
      "-png",
      "-f",
      "1", // Convert from page 1
      "-l",
      "1", // ...to page 1 (only first page)
      "-scale-to",
      "1024",
      inputPdf,
      outputBase,
    ]);

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pdftocairo exited with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    // 2) Create an output folder to store everything
    const tempDir = path.join(process.cwd(), "temp-out");
    fs.mkdirSync(tempDir, { recursive: true });

    // 3) Download a sample PDF. Replace this URL with any PDF you want.
    const pdfUrl =
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
    const pdfPath = path.join(tempDir, "testfile.pdf");

    console.log("Downloading sample PDF...");
    const writer = fs.createWriteStream(pdfPath);
    const response = await axios.get(pdfUrl, { responseType: "stream" });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    console.log("Download complete:", pdfPath);

    // 4) Call spawnPdftocairo to convert first page -> PNG
    const outputBase = path.join(tempDir, "testThumb");
    console.log("Converting first page to PNG using pdftocairo...");
    await spawnPdftocairo(pdfPath, outputBase);

    // 5) Check for the generated PNG
    const firstPagePng = `${outputBase}-1.png`;
    if (fs.existsSync(firstPagePng)) {
      console.log("Success! Created PNG at:", firstPagePng);
    } else {
      console.error("No PNG found, something went wrong.");
    }
  } catch (err) {
    console.error("Failed to convert PDF with child_process spawn:", err);
  }
}

main();
