export interface SourceCrestSashStop {
  offset: number;
  color: string;
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
