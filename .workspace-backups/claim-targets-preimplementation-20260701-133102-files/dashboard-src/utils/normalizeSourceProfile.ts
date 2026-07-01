/**
 * normalizeSourceProfile
 *
 * Maps whatever publisher / reference fields are available into the canonical
 * SourceCrest props (sourceType, reliability, publisherName).
 * Never throws — always returns a valid profile, defaulting to unknown/unchecked.
 */

export type SourceType =
  | "primary"
  | "government"
  | "academic"
  | "journalism"
  | "reference"
  | "advocacy"
  | "corporate"
  | "opinion"
  | "social"
  | "unknown";

export type Reliability =
  | "high"
  | "medium"
  | "mixed"
  | "low"
  | "flagged"
  | "unchecked";

export interface SourceProfile {
  sourceType: SourceType;
  reliability: Reliability;
  publisherName: string;
  score?: number;         // raw veracity score 0–100, passed through to SourceCrest
  admiraltyCode?: string; // e.g. "D4" — from admiralty_evaluations table when available
}

// Fields accepted from any combination of Publisher / PublisherRating /
// ReferenceWithClaims / CandidateClaim
export interface RawSourceData {
  publisher_name?: string;
  source_name?: string;           // CandidateClaim
  is_primary_source?: boolean;    // ReferenceWithClaims
  media_source?: string;          // ReferenceWithClaims (media outlet hint)
  source_reliability?: number;    // CandidateClaim  (0–1)
  veracity_score?: number;        // PublisherRating  (0–100)
  bias_score?: number;
  rating_label?: string;          // PublisherRating enrichment
  rating_type?: string;           // PublisherRating enrichment
  source_type?: string;           // Verified publisher profile type
  admiralty_code?: string;        // From admiralty_evaluations join
}

// Ordered from most-specific to most-generic
const SOURCE_TYPE_PATTERNS: [RegExp, SourceType][] = [
  [/\.gov\b|government|official|federal|state\.(us|gov)|white\s?house|congress/i, "government"],
  [/\.edu\b|university|univers|college|journal\b|academic|research|science|scholar|pubmed|arxiv|preprint/i, "academic"],
  [/wikipedia|britannica|encyclopedia|merriam|dictionary|reference|library/i, "reference"],
  [/advocacy|think.?tank|institute|foundation|policy\s?org|ngo|nonprofit|501c/i, "advocacy"],
  [/corp|inc\b|ltd\b|llc\b|corporate|business|pr\b|press.?release|investor|sec\.gov/i, "corporate"],
  [/opinion|editorial|commentary|column|op.?ed|blog\b/i, "opinion"],
  [/twitter|x\.com|facebook|reddit|instagram|tiktok|social|forum|user.?generat/i, "social"],
  [/news|press|times|herald|post|tribune|gazette|media|reporter|journalist|wire|associated\s?press|reuters|ap\b|bbc|cnn|nbc|abc|cbs|npr/i, "journalism"],
];

function detectSourceType(data: RawSourceData): SourceType {
  if (data.is_primary_source) return "primary";

  // rating_type from the enrichment pipeline is most authoritative
  const rt = data.source_type ?? data.rating_type ?? "";
  if (rt) {
    for (const [pat, type] of SOURCE_TYPE_PATTERNS) {
      if (pat.test(rt)) return type;
    }
  }

  // Fall back to pattern-matching on whatever name/url strings are available
  const candidate = [
    data.publisher_name,
    data.source_name,
    data.media_source,
  ]
    .filter(Boolean)
    .join(" ");

  for (const [pat, type] of SOURCE_TYPE_PATTERNS) {
    if (pat.test(candidate)) return type;
  }

  return "unknown";
}

function detectReliability(data: RawSourceData): Reliability {
  if (data.rating_label?.toLowerCase().includes("flagged")) return "flagged";

  // Normalise score to 0–100
  let score: number | null = null;
  if (data.veracity_score != null) {
    score = data.veracity_score;
  } else if (data.source_reliability != null) {
    score = data.source_reliability * 100;
  }

  if (score === null) return "unchecked";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "mixed";
  return "low";
}

export function normalizeSourceProfile(data: RawSourceData): SourceProfile {
  let score: number | undefined;
  if (data.veracity_score != null) score = data.veracity_score;
  else if (data.source_reliability != null) score = data.source_reliability * 100;

  return {
    publisherName: data.publisher_name ?? data.source_name ?? "",
    sourceType: detectSourceType(data),
    reliability: detectReliability(data),
    score,
    admiraltyCode: data.admiralty_code ?? undefined,
  };
}

// Human-readable display names (used by SourceCrest tooltip)
export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  primary:    "Primary Source",
  government: "Government / Official",
  academic:   "Academic / Scientific",
  journalism: "Journalism",
  reference:  "Reference / Secondary",
  advocacy:   "Advocacy / Think Tank",
  corporate:  "Corporate / PR",
  opinion:    "Opinion / Commentary",
  social:     "Social / User-Generated",
  unknown:    "Unknown Source Type",
};

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  high:      "High Reliability",
  medium:    "Medium Reliability",
  mixed:     "Mixed / Context Needed",
  low:       "Low Reliability",
  flagged:   "Flagged Source",
  unchecked: "Unchecked Source",
};
