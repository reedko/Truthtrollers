export const CFX_EVIDENCE_ACCESS_LEVELS = [
  "full_text",
  "substantial_excerpt",
  "abstract",
  "snippet",
  "metadata_only",
  "unavailable",
  "user_action_required",
] as const;

export type CfxEvidenceAccessLevel =
  typeof CFX_EVIDENCE_ACCESS_LEVELS[number];

export type CfxEvidenceRetrievalAttempt = {
  method: string;
  status:
    | "success"
    | "partial"
    | "blocked"
    | "not_found"
    | "timeout"
    | "parse_failure"
    | "user_action_required"
    | "failed";
  url: string | null;
  httpStatus: number | null;
  contentType: string | null;
  characterCount: number;
  diagnostic: string | null;
};

export type CfxEvidenceTextAccess = {
  candidateId: string;
  accessLevel: CfxEvidenceAccessLevel;
  textSource:
    | "provider"
    | "publisher_html"
    | "publisher_pdf"
    | "pubmed"
    | "pmc"
    | "doi_resolution"
    | "institutional_repository"
    | "preprint"
    | "wayback"
    | "headless_browser"
    | "user_assisted_browser"
    | "search_snippet"
    | "metadata";
  text: string | null;
  characterCount: number;
  wordCount: number;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  pmid: string | null;
  retrievalAttempts: CfxEvidenceRetrievalAttempt[];
  accessDiagnostics: string[];
};

export type CfxEvidenceBlock = {
  blockId: string;
  text: string;
  charStart: number;
  charEnd: number;
};

export type CfxBearingExtractionRow = {
  evidenceAssertion: string;
  bearingRelation: "supports" | "challenges" | "qualifies" | "mixed";
  exactExcerpt: string;
  sourceLocation: {
    page: number | null;
    section: string | null;
    paragraph: number | null;
    blockId: string | null;
    charStart: number | null;
    charEnd: number | null;
  };
  whyItBears: string;
  confidence: number;
  quality: number;
  limitationsVisibleInText: string[];
};

export type CfxEvidenceBearingExtraction = {
  candidateId: string;
  propositionId: string;
  accessLevel: Extract<
    CfxEvidenceAccessLevel,
    "full_text" | "substantial_excerpt" | "abstract" | "snippet"
  >;
  noBearingAssertionsFound: boolean;
  assertions: CfxBearingExtractionRow[];
};
