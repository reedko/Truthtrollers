import { jsonrepair } from "jsonrepair";

export interface GptJson {
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
  testimonials?: { text: string; name?: string; imageUrl?: string | null }[];
}

/**
 * Parses or repairs a JSON string, returning a generic type T.
 * @param input The raw JSON string (possibly malformed).
 * @returns An object of type T if successful, otherwise throws an error.
 */
export function parseOrRepairJSON<T = any>(input: string): T {
  // 1) First, try direct parse
  try {
    return JSON.parse(input) as T;
  } catch (directErr) {
    console.warn("Direct JSON.parse failed, attempting jsonrepair...");

    // 2) Attempt to repair common bracket/comma issues
    try {
      const repaired = jsonrepair(input);
      return JSON.parse(repaired) as T;
    } catch (repairErr) {
      console.error("jsonrepair also failed:", repairErr);
      throw new Error("Irreparable JSON");
    }
  }
}
