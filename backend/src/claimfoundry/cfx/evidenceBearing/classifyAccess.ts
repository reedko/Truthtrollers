import type {
  CfxEvidenceRetrievalAttempt,
  CfxEvidenceTextAccess,
} from "./types.js";

export const CFX_SOURCE_LINEAGE_TYPES = [
  "original",
  "excerpt",
  "repost",
  "syndicated",
  "pointer",
  "archive",
  "unknown",
] as const;

export type CfxSourceLineageType =
  typeof CFX_SOURCE_LINEAGE_TYPES[number];

export type CfxAcquiredDocument = {
  candidateId: string;
  text: string | null;
  textSource: CfxEvidenceTextAccess["textSource"];
  documentKind: "document" | "abstract" | "snippet" | "metadata";
  completeness: "complete" | "partial" | "unknown";
  lineageType: CfxSourceLineageType;
  requestedUrl: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  pmid: string | null;
  retrievalAttempts: CfxEvidenceRetrievalAttempt[];
  diagnostics?: string[];
};

/**
 * Deterministic access-ceiling classification only. It does not decide
 * relevance, bearing, trust, or document meaning.
 */
export function classifyCfxEvidenceAccess(
  input: CfxAcquiredDocument,
): CfxEvidenceTextAccess & {
  requestedUrl: string | null;
  lineageType: CfxSourceLineageType;
} {
  const text = input.text === null ? null : String(input.text);
  const characterCount = text?.length ?? 0;
  const wordCount = text?.trim()
    ? text.trim().split(/\s+/u).length
    : 0;
  const diagnostics = [...(input.diagnostics ?? [])];

  let accessLevel: CfxEvidenceTextAccess["accessLevel"];
  if (input.documentKind === "metadata" || !text?.trim()) {
    const awaitingUser = input.retrievalAttempts.some((attempt) =>
      attempt.status === "user_action_required");
    const unavailable = input.retrievalAttempts.some((attempt) =>
      ["blocked", "not_found", "timeout", "parse_failure", "failed"]
        .includes(attempt.status));
    accessLevel = awaitingUser
      ? "user_action_required"
      : unavailable ? "unavailable" : "metadata_only";
  } else if (input.documentKind === "abstract") {
    accessLevel = "abstract";
  } else if (input.documentKind === "snippet") {
    accessLevel = "snippet";
  } else if (
    input.lineageType === "excerpt"
    || input.lineageType === "pointer"
  ) {
    accessLevel = characterCount >= 400
      ? "substantial_excerpt"
      : "snippet";
    diagnostics.push(
      `Production source lineage ${input.lineageType} prevents full_text`,
    );
  } else if (input.completeness === "complete") {
    accessLevel = "full_text";
  } else {
    accessLevel = characterCount >= 400
      ? "substantial_excerpt"
      : "snippet";
    diagnostics.push(
      "Document completeness was not established; full_text was not assigned",
    );
  }

  return {
    candidateId: input.candidateId,
    accessLevel,
    textSource: input.textSource,
    text: accessLevel === "metadata_only" || accessLevel === "unavailable"
      || accessLevel === "user_action_required"
      ? null
      : text,
    characterCount,
    wordCount,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl,
    doi: input.doi,
    pmid: input.pmid,
    retrievalAttempts: input.retrievalAttempts,
    accessDiagnostics: diagnostics,
    requestedUrl: input.requestedUrl,
    lineageType: input.lineageType,
  };
}
