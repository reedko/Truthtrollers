// Host-owned mapping from the model's evidence intent to concrete source strategy.
// The model chooses a claim's disputed question and a first-guess sourceStrategy;
// the host reconciles the two deterministically. Central rule (design note §2.2):
// a substantive dispute the article already stipulates can never be settled by the
// article's own text, so it must not resolve to primary_article_result.

export const CF1_STRATEGY_FIELDS = Object.freeze({
  primary_article_result: { sourceTypes: ["primary article or study record", "underlying results"],
    roles: ["target-primary", "primary-record"] },
  named_work_result: { sourceTypes: ["named primary work", "bibliographic record"],
    roles: ["target-primary", "study-identity"] },
  official_record: { sourceTypes: ["official record"],
    roles: ["official-response", "primary-record"] },
  methodology_review: { sourceTypes: ["primary methods and results", "methodology analysis"],
    roles: ["target-primary", "methodology-reanalysis"] },
  independent_corroboration: { sourceTypes: ["independent primary research", "systematic review"],
    roles: ["target-primary", "context-background"] },
  mixed_sources: { sourceTypes: ["primary record", "independent primary research"],
    roles: ["target-primary", "context-background"] },
});

const OFFICIAL_EVIDENCE = /\b(?:official|agency|government|court|regulatory|administrative|seismic|geological|meteorological)\b/i;

function isStipulated(disputedQuestion) {
  const value = disputedQuestion?.stipulatedByArticle;
  return value != null && String(value).trim() !== "";
}

/**
 * Reconcile the model's first-guess strategy with the disputed-question decision.
 * Preserves the prior official/named-work overrides, then applies the disputed-question
 * matrix. Returns the resolved strategy and an optional host adjustment note for audit.
 */
export function resolveEvidenceStrategy({ modelStrategy, disputedQuestion, semanticGuidance,
  externalWork }) {
  const officialSignal = OFFICIAL_EVIDENCE.test(semanticGuidance ?? "");
  const target = disputedQuestion?.verificationTarget;

  // substantive, both_needed, or (baseline path) no disputed question.
  let sourceStrategy = modelStrategy === "primary_article_result" && officialSignal ? "official_record"
    : externalWork ? "named_work_result" : modelStrategy;

  let adjustment = null;
  if ((target === "substantive" || target === "both_needed") && isStipulated(disputedQuestion)
    && sourceStrategy === "primary_article_result") {
    sourceStrategy = officialSignal ? "official_record" : "independent_corroboration";
    adjustment = "Host redirected a stipulated substantive dispute away from the article's own text: "
      + "the article cannot be evidence for a matter it already stipulates.";
  }
  return { sourceStrategy, adjustment };
}
