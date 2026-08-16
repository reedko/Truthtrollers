// Single source of truth for the SourceCrest visual: shield geometry,
// palette, and labels. SourceCrest.tsx (DOM/React) and sourceCrestUri.ts
// (Cytoscape data-URI SVG strings) both import from here so the two
// renderers can never visually drift apart the way they used to (e.g. the
// "E" reliability color used to be hand-copied slightly differently in
// each file).

export interface SourceCrestSashStop {
  offset: number;
  color: string;
}

export interface SourceAlignment {
  marker: "IND" | "ADV" | "GOV" | "CORP" | "PART" | "SPON" | "STATE" | string;
  type?: string;
  label: string;
  riskScore?: number | null;
  degree?: "low" | "moderate" | "high" | "unknown" | string;
  explanation?: string | null;
  confidence?: number | null;
  provenance?: string;
}

// Shield geometry — viewBox is always "0 0 64 80" (64:80 shield ratio).
export const SOURCE_CREST_SHIELD = "M32,76 C13,67 5,55 5,43 L5,12 Q5,5 12,5 L52,5 Q59,5 59,12 L59,43 C59,55 51,67 32,76 Z";
export const SOURCE_CREST_BEVEL  = "M32,74 C15,65 7,54 7,43 L7,13 Q7,7 13,7 L51,7 Q57,7 57,13 L57,43 C57,54 49,65 32,74 Z";
export const SOURCE_CREST_SHINE  = "M14,8 Q14,7 20,7 L44,7 Q50,7 50,8 L50,22 Q32,28 14,22 Z";
export const SOURCE_CREST_SASH   = "M2,22 L62,42 L62,67 L2,47 Z";

// Admiralty letter A-E → color  green → teal → blue → amber → red  (Ø = gray)
export const ADMIRALTY_COLORS: Record<string, { base: string; mid: string; glow: string; rim: string }> = {
  A:   { base: "#052E12", mid: "#16A34A", glow: "#22C55E", rim: "#86EFAC" }, // green
  B:   { base: "#0D2E2E", mid: "#0F766E", glow: "#14B8A6", rim: "#99F6E4" }, // teal
  C:   { base: "#061428", mid: "#1D6FA8", glow: "#00A2FF", rim: "#BAE6FD" }, // MR-blue (neutral center)
  D:   { base: "#4A2C07", mid: "#B7791F", glow: "#F6AD55", rim: "#FBD38D" }, // amber
  E:   { base: "#450A0A", mid: "#B91C1C", glow: "#EF4444", rim: "#FCA5A5" }, // red
  "Ø": { base: "#1A202C", mid: "#4A5568", glow: "#718096", rim: "#A0AEC0" }, // gray
};

export const ADMIRALTY_LETTER_LABEL: Record<string, string> = {
  A:   "Highly reliable source",
  B:   "Usually reliable source",
  C:   "Mixed / context-dependent",
  D:   "Questionable source",
  E:   "Unreliable source",
  "Ø": "Source not yet assessed",
};

export const ADMIRALTY_NUMBER_LABEL: Record<string, string> = {
  "1": "Confirmed by authoritative evidence",
  "2": "Probably true",
  "3": "Possibly true, needs corroboration",
  "4": "Doubtful / contested",
  "5": "Probably false",
  "Ø": "Claim not yet assessed",
};

export function parseAdmiraltyCode(admiraltyCode?: string | null): { letter: string; number: string } {
  const rawLetter = admiraltyCode?.match(/^([A-EFØ])/u)?.[1] ?? "Ø";
  const rawNumber = admiraltyCode?.match(/([1-6Ø])$/u)?.[1] ?? "Ø";
  return {
    letter: rawLetter === "F" ? "Ø" : rawLetter,
    number: rawNumber === "6" ? "Ø" : rawNumber,
  };
}

export function clampAlignmentRiskScore(score?: number | null): number | null {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return Math.max(0, Math.min(100, Number(score)));
}

export function sourceCrestMarkerFontSize(marker: string): number {
  const length = marker.trim().length;
  if (length <= 3) return 18.75;
  if (length === 4) return 15.75;
  if (length === 5) return 12.9;
  return 10.5;
}

/**
 * Builds a score-weighted sash rather than a generic traffic-light gradient.
 * Risk color occupies approximately `score` percent from the left; the
 * remainder stays green. This makes 90 mostly red/orange and 10 mostly green.
 */
export function buildSourceCrestSashStops(score?: number | null): SourceCrestSashStop[] {
  const risk = clampAlignmentRiskScore(score);
  if (risk == null) {
    return [
      { offset: 0, color: "#475569" },
      { offset: 50, color: "#64748B" },
      { offset: 100, color: "#334155" },
    ];
  }
  if (risk <= 0) return [{ offset: 0, color: "#16A34A" }, { offset: 100, color: "#22C55E" }];
  if (risk >= 100) {
    return [
      { offset: 0, color: "#B91C1C" },
      { offset: 58, color: "#DC2626" },
      { offset: 100, color: "#F97316" },
    ];
  }

  const orangeAt = Math.max(2, risk * 0.58);
  const amberAt = Math.max(orangeAt, risk - Math.min(6, risk * 0.25));
  const greenAt = Math.min(100, risk + Math.min(4, (100 - risk) * 0.35));
  return [
    { offset: 0, color: "#B91C1C" },
    { offset: orangeAt, color: "#EA580C" },
    { offset: amberAt, color: "#F59E0B" },
    { offset: greenAt, color: "#22C55E" },
    { offset: 100, color: "#15803D" },
  ];
}

export const SOURCE_CREST_VISUAL_EXAMPLES = [
  { sourceReliabilityLetter: "C", alignmentMarker: "IND", alignmentRiskScore: 90, claimCredibilityDisplay: "3" },
  { sourceReliabilityLetter: "C", alignmentMarker: "IND", alignmentRiskScore: 10, claimCredibilityDisplay: "3" },
  { sourceReliabilityLetter: "C", alignmentMarker: "IND", alignmentRiskScore: 90, claimCredibilityDisplay: "Ø" },
] as const;
