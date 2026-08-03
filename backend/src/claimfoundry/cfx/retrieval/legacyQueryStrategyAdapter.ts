import {
  isGlueQuery,
  isInstructionLikeQuery,
} from "../../../core/evidencePurposeLanes.js";
import type {
  CfxEvidenceInput,
  CfxQueryId,
  CfxQueryIntent,
} from "./types.js";

// This is the complete CFX reuse boundary for legacy query-generation code.
// Only the two pure query-shape guards above cross it. Legacy orchestration,
// stance quotas, resolved-work promotion, scoring, and bearing never do.

const TRIVIAL_VERDICT_WORDS = new Set([
  "not", "false", "debunk", "debunked", "myth", "refute", "refuted", "true",
]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "did",
  "do", "does", "for", "from", "had", "has", "have", "in", "is", "it", "of",
  "on", "or", "that", "the", "their", "this", "to", "was", "were", "which",
  "with",
]);

function clean(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(/[.!?]+$/u, "").toLocaleLowerCase();
}

function tokens(value: string): string[] {
  return clean(value).match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(tokens(value).filter(
    (token) => token.length >= 3 && !STOP_WORDS.has(token),
  ));
}

function onlyTrivialVerdictDifference(query: string, assertion: string): boolean {
  const queryTokens = meaningfulTokens(query);
  const assertionTokens = meaningfulTokens(assertion);
  const strippedQuery = new Set(
    [...queryTokens].filter((token) => !TRIVIAL_VERDICT_WORDS.has(token)),
  );
  if (strippedQuery.size !== assertionTokens.size) return false;
  return [...assertionTokens].every((token) => strippedQuery.has(token));
}

function literalAnchorTokens(input: CfxEvidenceInput): Set<string> {
  const values = [
    input.substantiveAssertion,
    input.assertionSource,
    ...Object.values(input.literalIdentifiers).flat(),
    ...Object.values(input.lookupHints).flat(),
  ];
  return meaningfulTokens(values.join(" "));
}

export function validateCfxQueryStrategy(input: {
  queryId: CfxQueryId;
  queryIntent: CfxQueryIntent;
  query: string;
  evidenceInput: CfxEvidenceInput;
}): { valid: boolean; reasons: string[]; matchedLiteralAnchors: string[] } {
  const reasons:string[] = [];
  const query = clean(input.query);
  if (isInstructionLikeQuery(query)) reasons.push("INSTRUCTION_LIKE_QUERY");
  if (isGlueQuery(query)) reasons.push("GLUE_QUERY");

  const fixedIntent:Partial<Record<CfxQueryId, CfxQueryIntent>> = {
    Q1:"canonical", Q2:"entity_predicate", Q3:"source_identity",
    Q4:"independent_evidence",
  };
  if (fixedIntent[input.queryId] && fixedIntent[input.queryId] !== input.queryIntent) {
    reasons.push("QUERY_INTENT_DOES_NOT_MATCH_LANE");
  }
  if (
    input.queryId === "Q5"
    && !["counterevidence", "qualification"].includes(input.queryIntent)
  ) {
    reasons.push("Q5_REQUIRES_COUNTEREVIDENCE_OR_QUALIFICATION_INTENT");
  }

  const queryTokens = meaningfulTokens(query);
  const literalAnchors = literalAnchorTokens(input.evidenceInput);
  const matchedLiteralAnchors = [...queryTokens].filter(
    (token) => literalAnchors.has(token),
  ).sort();
  if (input.queryId === "Q5") {
    if (matchedLiteralAnchors.length < 2) {
      reasons.push("Q5_NOT_CLAIM_SPECIFIC");
    }
    if (onlyTrivialVerdictDifference(query, input.evidenceInput.substantiveAssertion)) {
      reasons.push("Q5_TRIVIAL_VERDICT_INVERSION");
    }
  }
  return { valid: reasons.length === 0, reasons, matchedLiteralAnchors };
}
