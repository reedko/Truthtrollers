// backend/src/utils/logger.js
// Configurable logger that writes to console and/or file

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION - Toggle these on/off as needed
// ============================================================
const ENABLE_CONSOLE_LOGGING = true; // Set to false to disable console output
const ENABLE_FILE_LOGGING = true; // Set to false to disable file logging

// ============================================================
// Log file management
// ============================================================
const getLogFilePath = () => {
  const logsDir = path.join(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(logsDir, `evidence-${date}.log`);
};

// Clear log file on startup
export const clearLogFile = () => {
  if (!ENABLE_FILE_LOGGING) return;

  const logFile = getLogFilePath();
  const timestamp = new Date().toISOString();
  const header = `\n${"=".repeat(80)}\n[${timestamp}] SERVER STARTED - Log Cleared\n${"=".repeat(80)}\n\n`;

  fs.writeFileSync(logFile, header);
  if (ENABLE_CONSOLE_LOGGING) {
    console.log(`📝 Log file initialized: ${logFile}`);
  }
};

// Write to file (synchronous to preserve order)
const writeToFile = (message) => {
  if (!ENABLE_FILE_LOGGING) return;

  const logFile = getLogFilePath();
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(logFile, logLine);
  } catch (err) {
    if (ENABLE_CONSOLE_LOGGING) {
      console.error("Failed to write to log file:", err);
    }
  }
};

// Custom console wrapper
export const logger = {
  log: (...args) => {
    const message = args.join(" ");
    if (ENABLE_CONSOLE_LOGGING) console.log(...args);
    writeToFile(message);
  },

  error: (...args) => {
    const message = args.join(" ");
    if (ENABLE_CONSOLE_LOGGING) console.error(...args);
    writeToFile(`ERROR: ${message}`);
  },

  warn: (...args) => {
    const message = args.join(" ");
    if (ENABLE_CONSOLE_LOGGING) console.warn(...args);
    writeToFile(`WARN: ${message}`);
  },

  time: (label) => {
    if (ENABLE_CONSOLE_LOGGING) console.time(label);
    writeToFile(`TIME START: ${label}`);
  },

  timeEnd: (label) => {
    if (ENABLE_CONSOLE_LOGGING) console.timeEnd(label);
    writeToFile(`TIME END: ${label}`);
  },
};

export default logger;
