// For .js or .ts in Node:
import { jsonrepair } from "jsonrepair";
// OR, if using ESM/TypeScript:
// import { jsonrepair } from "jsonrepair";

/**
 * Parses or repairs a JSON string, returning an object.
 * @param {string} input - The raw JSON string (possibly malformed).
 * @param {{ onRepair?: (directError: Error) => void }} [options]
 * @returns {any} The parsed value, or throws if irreparable.
 */
export function parseOrRepairJSON(input, { onRepair } = {}) {
  // 1) First, try direct parse
  try {
    return JSON.parse(input);
  } catch (directErr) {
    onRepair?.(directErr);

    // 2) Attempt to repair common bracket/comma issues
    try {
      const repaired = jsonrepair(input);
      return JSON.parse(repaired);
    } catch (repairErr) {
      throw new Error("Irreparable JSON", { cause: repairErr });
    }
  }
}

// Example usage:
// const result = parseOrRepairJSON(badJsonString);
