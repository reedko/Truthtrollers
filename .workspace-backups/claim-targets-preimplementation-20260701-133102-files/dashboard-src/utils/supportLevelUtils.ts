/**
 * Standardized utilities for converting support levels to colors and labels
 * STANDARD THRESHOLDS:
 * - Above +15: Support (green)
 * - -15 to +15: Nuanced/Context (yellow/blue)
 * - Below -15: Refute (red)
 */

export interface SupportLevelInfo {
  relation: "support" | "refute" | "nuance";
  label: string;
  color: string;
  colorScheme: "green" | "red" | "yellow" | "blue";
}

/**
 * Get standardized relation info from a numeric support level
 * @param supportLevel - Numeric value (typically -100 to +100)
 * @returns Relation, label, color information
 */
export function getSupportLevelInfo(supportLevel: number): SupportLevelInfo {
  if (supportLevel > 15) {
    return {
      relation: "support",
      label: "Supports",
      color: "green",
      colorScheme: "green",
    };
  } else if (supportLevel < -15) {
    return {
      relation: "refute",
      label: "Refutes",
      color: "red",
      colorScheme: "red",
    };
  } else {
    return {
      relation: "nuance",
      label: "Nuanced",
      color: "yellow",
      colorScheme: "yellow",
    };
  }
}

/**
 * Get color for a relation string
 * @param relation - "support", "refute", or "nuance"
 * @returns Color string
 */
export function getRelationColor(
  relation: "support" | "refute" | "nuance" | string
): string {
  switch (relation.toLowerCase()) {
    case "support":
    case "supports":
      return "green";
    case "refute":
    case "refutes":
      return "red";
    case "nuance":
    case "nuanced":
    case "context":
    case "related":
      return "blue";
    default:
      return "gray";
  }
}

/**
 * Get RGB color with alpha for SVG lines
 * @param relation - "support", "refute", or "nuance"
 * @param isAISuggested - Whether this is an AI suggestion (lighter/more transparent)
 * @returns RGBA color string
 */
export function getLineColor(
  relation: "support" | "refute" | "nuance" | string,
  isAISuggested: boolean = false
): string {
  const baseColors = {
    support: isAISuggested ? "rgba(100, 255, 100, 0.5)" : "green",
    refute: isAISuggested ? "rgba(255, 100, 100, 0.5)" : "red",
    nuance: isAISuggested ? "rgba(100, 150, 255, 0.5)" : "blue",
  };

  const normalizedRelation = relation.toLowerCase();
  if (normalizedRelation.includes("support")) return baseColors.support;
  if (normalizedRelation.includes("refute")) return baseColors.refute;
  return baseColors.nuance;
}
