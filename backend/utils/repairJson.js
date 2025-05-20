// For .js or .ts in Node:
import { jsonrepair } from "jsonrepair";
// OR, if using ESM/TypeScript:
// import { jsonrepair } from "jsonrepair";

/**
 * Parses or repairs a JSON string, returning an object.
 * @param {string} input - The raw JSON string (possibly malformed).
 * @returns {any} The parsed object, or throws if irreparable.
 */
export function parseOrRepairJSON(input) {
  // 1) First, try direct parse
  try {
    return JSON.parse(input);
  } catch (directErr) {
    console.warn("Direct JSON.parse failed, attempting jsonrepair...");

    // 2) Attempt to repair common bracket/comma issues
    try {
      const repaired = jsonrepair(input);
      return JSON.parse(repaired);
    } catch (repairErr) {
      console.error("jsonrepair also failed:", repairErr);
      throw new Error("Irreparable JSON");
    }
  }
}

// Example usage:
// const result = parseOrRepairJSON(badJsonString);
