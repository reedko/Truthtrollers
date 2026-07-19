// High-confidence article-voice candidate eligibility. This never assigns an
// assertionSource; it adds the known byline to the same candidate list 1B judges.

const NARRATIVE_UNIT_TYPES = new Set(["sentence", "paragraph"]);
const NON_AUTHOR_STRUCTURE = new Set(["quotation", "speaker_turn", "social_post",
  "social_reply", "list"]);
const DOCUMENT_OR_ATTRIBUTION_LANGUAGE = /\b(?:according to|quoted?|said|says|told|asked|argued|claimed|claims|wrote|writes|stated|states|reported|reports|revealed|reveals|study|studies|report|analysis|survey|trial|review|paper|document)\b/i;
const QUOTE_MARK = /[“”"]/;
const AMBIGUOUS_LEAD = /^(?:he|she|they|it|this|these|those|the study|the report|the analysis)\b/i;
const ENUMERATED_CLAIM_LEAD = /^\s*\[\d+\]/;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function addSplitArticleVoiceCandidate({ sourceDiagnostic, claimUnits = [],
  attributionContextUnits = [], structuralSignals = {}, articleAuthors = [] } = {}) {
  const diagnostic = sourceDiagnostic ?? {
    sourceCandidateStatus: "not_evaluated", sourceCandidates: [],
  };
  if (diagnostic.sourceCandidateStatus !== "no_candidates_detected") return diagnostic;
  const authors = articleAuthors.map(clean).filter(Boolean);
  if (!authors.length || !claimUnits.length || attributionContextUnits.length) return diagnostic;
  if ((structuralSignals.unitTypes ?? []).some((type) => !NARRATIVE_UNIT_TYPES.has(type))) return diagnostic;
  if (NON_AUTHOR_STRUCTURE.has(structuralSignals.blockType)) return diagnostic;
  const text = clean(claimUnits.map((item) => item.text).join(" "));
  if (!text || ENUMERATED_CLAIM_LEAD.test(text) || QUOTE_MARK.test(text) || DOCUMENT_OR_ATTRIBUTION_LANGUAGE.test(text)
    || AMBIGUOUS_LEAD.test(text)) return diagnostic;

  const sourceCandidates = [...(diagnostic.sourceCandidates ?? []), {
    sourceCandidateId: `SRC${String((diagnostic.sourceCandidates?.length ?? 0) + 1).padStart(2, "0")}`,
    nameHint: authors.join("; "), candidateKind: "article_voice",
    unitIds: claimUnits.map((item) => item.unitId),
    trigger: "unattributed_article_narrative",
    excerpt: text,
    basis: "Unattributed proposition in ordinary article narrative voice",
  }];
  return { sourceCandidateStatus: "candidates_found", sourceCandidates };
}
