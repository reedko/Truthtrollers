/**
 * VERIMETER LABEL CONFIGURATION FOR EXTENSION
 *
 * Change these values to switch between label styles:
 * - Original: { positive: "TRUE", negative: "FALSE" }
 * - Alternative: { positive: "SUPPORTED", negative: "REFUTED" }
 *
 * Simply change USE_ORIGINAL_LABELS to toggle between styles
 */
const USE_ORIGINAL_LABELS = false; // Set to true to use TRUE/FALSE, false for SUPPORTED/REFUTED

export const VERIMETER_LABELS = {
  positive: USE_ORIGINAL_LABELS ? "TRUE" : "SUPPORTED",
  negative: USE_ORIGINAL_LABELS ? "FALSE" : "REFUTED",
  neutral: "NUANCED",
  unknown: "UNKNOWN",
};
