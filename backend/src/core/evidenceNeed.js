const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by",
  "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "hers", "him", "his", "how", "in", "into", "is", "it", "its", "of",
  "on", "or", "our", "she", "that", "the", "their", "them", "there",
  "these", "they", "this", "those", "to", "was", "were", "what", "when",
  "where", "which", "who", "will", "with", "would",
]);

const RELATION_GROUPS = [
  ["cause", "causes", "caused", "causing", "lead", "leads", "led", "result", "results", "produce", "produces", "trigger", "triggers"],
  ["associate", "associated", "association", "correlate", "correlated", "correlation", "linked", "relationship"],
  ["increase", "increases", "increased", "higher", "raise", "raises", "elevate", "elevated", "worsen", "worsens"],
  ["decrease", "decreases", "decreased", "lower", "reduce", "reduces", "reduced", "improve", "improves"],
  ["support", "supports", "supported", "confirm", "confirms", "confirmed", "corroborate", "corroborates"],
  ["contradict", "contradicts", "contradicted", "refute", "refutes", "debunk", "debunks", "disprove", "disproves"],
  ["show", "shows", "showed", "find", "finds", "found", "report", "reports", "reported", "demonstrate", "demonstrates"],
  ["say", "says", "said", "state", "states", "stated", "claim", "claims", "claimed", "allege", "alleges", "alleged", "reveal", "reveals", "revealed"],
  ["destroy", "destroys", "destroyed", "omit", "omits", "omitted", "exclude", "excludes", "excluded", "manipulate", "manipulates", "manipulated", "conceal", "conceals", "concealed"],
  ["exceed", "exceeds", "outweigh", "outweighs", "greater", "less", "more", "than"],
];

const SCOPE_WORDS = new Set([
  "adult", "adults", "adolescent", "adolescents", "child", "children",
  "elderly", "infant", "infants", "men", "women", "patient", "patients",
  "population", "populations", "pregnant", "school", "schools", "student",
  "students", "dose", "doses", "daily", "weekly", "monthly", "yearly",
  "urban", "rural", "global", "national", "local", "percent", "percentage",
]);

const MISCONDUCT_RE = /\b(fraud|cover[ -]?up|destroy(?:ed|ing)?|shredd(?:ed|ing)?|conceal(?:ed|ing)?|suppress(?:ed|ing)?|manipulat(?:ed|ing|ion)?|fabricat(?:ed|ing|ion)?|ordered?\s+.+\s+destroy)\b/i;
const CAUSAL_RE = /\b(cause[sd]?|causing|causal|leads? to|led to|results? in|resulted in|produces?|triggers?|because of|due to)\b/i;
const ASSOCIATION_RE = /\b(associat(?:ed|ion)|correlat(?:ed|ion)|linked (?:to|with)|relationship between|coincid(?:e|ed|ence))\b/i;
const METHODOLOGY_RE = /\b(methodolog(?:y|ical)|sample size|randomi[sz]ed|control group|cohort|confound(?:er|ing)?|study design|selection bias|statistical method)\b/i;
const INTERPRETIVE_RE = /\b(suggests?|implies?|interpret(?:s|ed|ation)?|argues?|indicates?)\b/i;

export function normalizeBearingText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9%.'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeBearingText(value) {
  return normalizeBearingText(value)
    .split(" ")
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function unique(values, limit = 20) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function extractNamedPhrases(text) {
  const matches = String(text || "").match(
    /\b(?:[A-Z][A-Za-z0-9'’.-]+(?:\s+[A-Z][A-Za-z0-9'’.-]+){0,4}|[A-Z]{2,}|\d{4})\b/g,
  ) || [];
  return matches.map(normalizeBearingText).filter(Boolean);
}

function extractScopeTerms(tokens, text) {
  const numeric = normalizeBearingText(text).match(
    /\b(?:\d+(?:\.\d+)?%?|19\d{2}|20\d{2}|\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|hz|ghz|days?|weeks?|months?|years?))\b/g,
  ) || [];
  return unique([
    ...numeric,
    ...tokens.filter((token) => SCOPE_WORDS.has(token)),
  ], 12);
}

function relationTermsForText(text, tokens) {
  const normalized = normalizeBearingText(text);
  const groups = RELATION_GROUPS.filter((group) =>
    group.some((term) => normalized.includes(` ${term} `) || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`)),
  );
  if (groups.length > 0) return unique(groups.flat(), 24);

  return unique(tokens.filter((token) =>
    /(ed|ing|ize|ise|ates|ects|ains|ows|orts|inds)$/.test(token),
  ), 8);
}

function firstRelationIndex(tokens, relationTerms) {
  const relationSet = new Set(relationTerms);
  return tokens.findIndex((token) => relationSet.has(token));
}

function detectClaimType(claim, effectiveText) {
  const role = String(claim?.role || claim?.claimRole || "").toLowerCase();
  if (role === "background") return "background";
  if (claim?.isAttribution) return "attribution";
  if (MISCONDUCT_RE.test(effectiveText)) return "misconduct";
  if (CAUSAL_RE.test(effectiveText)) return "causal";
  if (ASSOCIATION_RE.test(effectiveText)) return "association";
  if (METHODOLOGY_RE.test(effectiveText)) return "methodology";
  if (/\b\d+(?:\.\d+)?%|statistic(?:al|ally)?|odds ratio|confidence interval|relative risk|hazard ratio\b/i.test(effectiveText)) return "statistical";
  if (INTERPRETIVE_RE.test(effectiveText)) return "interpretive";
  return effectiveText ? "factual" : "unknown";
}

function buildEvidenceTargets({ claimType, isAttribution, effectiveClaimText, speakerEntity }) {
  const targets = [];
  const add = (id, stanceGoal, evidenceTargetType, bearingRequirement, queryHint, mustIncludeTerms = []) => {
    targets.push({
      id,
      stanceGoal,
      evidenceTargetType,
      bearingRequirement,
      queryHint,
      mustIncludeTerms,
    });
  };

  if (isAttribution) {
    add(
      "origin",
      "origin",
      "primary_source",
      "source_attribution",
      [speakerEntity, effectiveClaimText].filter(Boolean).join(" "),
      speakerEntity ? [speakerEntity] : [],
    );
  }

  if (claimType === "causal") {
    add("causal-evidence", "open", "systematic_review", "causal_mechanism", effectiveClaimText);
  } else if (claimType === "methodology" || claimType === "statistical") {
    add("method-or-data", "open", claimType === "statistical" ? "dataset" : "original_study", "warrant_test", effectiveClaimText);
  } else if (claimType === "misconduct") {
    add("misconduct-primary", "open", "primary_source", "direct_truth_value", effectiveClaimText);
    add(
      "misconduct-corroboration",
      "open",
      "official_statement",
      "source_attribution",
      `${effectiveClaimText} primary documents records testimony`,
    );
    if (/\b(stud(?:y|ies)|data|results?|evidence|analysis|research)\b/i.test(effectiveClaimText)) {
      add(
        "misconduct-underlying-study",
        "open",
        "original_study",
        "warrant_test",
        `${effectiveClaimText} original study methodology data analysis confounding`,
      );
    }
  } else {
    add("direct", "open", "other", "direct_truth_value", effectiveClaimText);
  }

  return targets;
}

const VALID_STANCE_GOALS = new Set(["support", "refute", "both", "context", "open", "origin", "steelman", "limitations"]);

function normalizeList(value, limit = 12) {
  return unique(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    limit,
  );
}

function normalizeStanceGoal(value) {
  const normalized = String(value || "both").trim().toLowerCase();
  if (VALID_STANCE_GOALS.has(normalized)) return normalized;
  if (normalized === "nuance" || normalized === "background" || normalized === "factbox") return "context";
  return "both";
}

function inferAssertionTargetType(assertion, claim = {}) {
  const explicit = String(assertion?.evidenceTargetType || assertion?.evidence_target_type || "").trim();
  if (explicit) return explicit;
  const evidenceType = String(claim.evidenceType || claim.evidence_type || "").toLowerCase();
  const claimKind = String(claim.claimKind || claim.claim_kind || "").toLowerCase();
  if (evidenceType === "study") return "original_study";
  if (evidenceType === "dataset" || /statistical_risk/.test(claimKind)) return "dataset";
  if (evidenceType === "official_statement") return "official_statement";
  if (["document", "quote", "legal_claim", "retraction_or_correction"].includes(evidenceType)) return "primary_source";
  if (/methodology|study_interpretation/.test(claimKind)) return "original_study";
  if (/fraud|coverup|suppression|manipulation|destruction|misconduct|whistleblower/.test(claimKind)) return "primary_source";
  return "other";
}

function inferBearingRequirement(assertion, claim = {}) {
  const explicit = String(assertion?.bearingRequirement || assertion?.bearing_requirement || "").trim();
  if (explicit) return explicit;
  const kind = String(claim.claimKind || claim.claim_kind || "").toLowerCase();
  if (/causal/.test(kind)) return "causal_mechanism";
  if (/methodology|statistical|study_interpretation/.test(kind)) return "warrant_test";
  if (claim.isAttribution || claim.is_attribution) return "source_attribution";
  return "direct_truth_value";
}

function assertionBearsOnClaim(assertionText, queryHint, effectiveClaimText) {
  const claimTokens = new Set(tokenizeBearingText(effectiveClaimText));
  if (claimTokens.size === 0) return true;
  return tokenizeBearingText(`${assertionText} ${queryHint}`).some((token) => claimTokens.has(token));
}

export function validateEvidenceNeed(evidenceNeed) {
  if (!evidenceNeed || typeof evidenceNeed !== "object") return { valid: false, errors: ["missing_evidence_need"] };
  const errors = [];
  if (!String(evidenceNeed.effectiveClaimText || "").trim()) errors.push("missing_effective_claim_text");
  if (!Array.isArray(evidenceNeed.evidenceTargets) || evidenceNeed.evidenceTargets.length === 0) errors.push("missing_evidence_targets");
  for (const target of evidenceNeed.evidenceTargets || []) {
    if (!String(target?.id || "").trim()) errors.push("target_missing_id");
    if (!String(target?.evidenceTargetType || "").trim()) errors.push("target_missing_type");
    if (!String(target?.stanceGoal || "").trim()) errors.push("target_missing_stance_goal");
    if (!String(target?.bearingRequirement || "").trim()) errors.push("target_missing_bearing_requirement");
  }
  return { valid: errors.length === 0, errors: unique(errors, 20) };
}

export function buildEvidenceNeedsFromSearchAssertions(claim = {}, baseNeed = null) {
  const need = baseNeed || buildEvidenceNeedV1({ ...claim, searchAssertions: [] });
  const assertions = Array.isArray(claim.searchAssertions) ? claim.searchAssertions : [];
  const assertionTargets = assertions.slice(0, 12).map((assertion, index) => {
    if (!assertion || typeof assertion !== "object") return null;
    const assertionText = String(assertion.assertion || assertion.text || "").trim();
    const queryHint = String(assertion.query || assertion.searchQuery || assertion.search_query || assertionText).trim();
    if (!queryHint) return null;
    if (!assertionBearsOnClaim(assertionText, queryHint, need.effectiveClaimText)) return null;
    const mustIncludeTerms = normalizeList([
      ...normalizeList(assertion.mustIncludeTerms || assertion.must_include_terms),
      ...normalizeList(assertion.entityFocus || assertion.entity_focus),
      ...normalizeList(assertion.dateFocus || assertion.date_focus),
    ], 12);
    return {
      id: String(assertion.id || assertion.assertionId || assertion.assertion_id || `assertion-${index + 1}`),
      stanceGoal: normalizeStanceGoal(assertion.searchIntent || assertion.search_intent),
      evidenceTargetType: inferAssertionTargetType(assertion, claim),
      bearingRequirement: inferBearingRequirement(assertion, claim),
      queryHint,
      assertion: assertionText || queryHint,
      mustIncludeTerms,
      optionalTerms: normalizeList(assertion.optionalTerms || assertion.optional_terms, 12),
      reasonForSearch: String(assertion.reasonForSearch || assertion.reason_for_search || assertion.reason || "").trim().slice(0, 500),
      source: "search_assertion",
    };
  }).filter(Boolean);

  const enriched = assertionTargets.length > 0
    ? { ...need, evidenceTargets: assertionTargets, searchAssertionCount: assertionTargets.length }
    : { ...need, searchAssertionCount: 0 };
  const validation = validateEvidenceNeed(enriched);
  return {
    ...enriched,
    derivation: {
      ...(enriched.derivation || {}),
      method: assertionTargets.length > 0 ? "search_assertions_v1" : enriched.derivation?.method || "deterministic_v1",
      warnings: unique([
        ...(enriched.derivation?.warnings || []),
        ...(assertions.length > assertionTargets.length ? ["invalid_or_unaligned_search_assertions_ignored"] : []),
        ...validation.errors,
      ], 20),
    },
  };
}

export function buildEvidenceTargetQueries(evidenceNeed, limit = 3) {
  const maxQueries = Math.max(0, Math.min(12, Number(limit) || 0));
  const targets = Array.isArray(evidenceNeed?.evidenceTargets) ? evidenceNeed.evidenceTargets : [];
  const queries = [];
  for (const target of targets) {
    const query = String(target?.queryHint || target?.assertion || "").replace(/\s+/g, " ").trim();
    if (!query) continue;
    const normalized = query.toLowerCase();
    if (queries.some((item) => item.query.toLowerCase() === normalized)) continue;
    queries.push({
      query,
      intent: target.stanceGoal || "open",
      stanceGoal: target.stanceGoal || "open",
      matchedPart: target.source === "search_assertion" ? "search_assertion" : "object_claim",
      evidenceTargetId: target.id || null,
      evidenceTargetType: target.evidenceTargetType || "other",
      bearingRequirement: target.bearingRequirement || "direct_truth_value",
    });
    if (queries.length >= maxQueries) break;
  }
  return queries;
}

const GENERIC_QUERY_TERMS = new Set([
  "article", "background", "context", "data", "evidence", "fact", "facts",
  "information", "news", "report", "research", "source", "study",
]);

/**
 * Reject search strings that cannot be traced back to the exact claim need.
 * This is intentionally lexical and conservative: it prevents generic LLM
 * output from reaching providers without pretending to judge query quality.
 */
export function validateEvidenceTargetQuery(evidenceNeed, query) {
  const queryTokens = unique(tokenizeBearingText(query), 50);
  if (queryTokens.length < 3) {
    return { valid: false, reasons: ["query_too_short"] };
  }

  const anchorTokens = new Set(unique([
    ...(evidenceNeed?.subjectTerms || []).flatMap(tokenizeBearingText),
    ...(evidenceNeed?.relationTerms || []).flatMap(tokenizeBearingText),
    ...(evidenceNeed?.objectTerms || []).flatMap(tokenizeBearingText),
    ...(evidenceNeed?.scopeTerms || []).flatMap(tokenizeBearingText),
    ...(evidenceNeed?.mustIncludeTerms || []).flatMap(tokenizeBearingText),
  ], 80));
  const substantive = queryTokens.filter((token) => !GENERIC_QUERY_TERMS.has(token));
  const overlap = substantive.filter((token) => anchorTokens.has(token));
  const requiredOverlap = anchorTokens.size <= 1 ? 1 : 2;
  const reasons = [];
  if (substantive.length < 2) reasons.push("query_is_generic");
  if (anchorTokens.size && overlap.length < requiredOverlap) reasons.push("insufficient_claim_anchors");
  return {
    valid: reasons.length === 0,
    reasons,
    anchorOverlap: overlap,
  };
}

export function queryPreservesNumericScope(evidenceNeed, query) {
  const requiredNumbers = (evidenceNeed?.scopeTerms || [])
    .flatMap((term) => String(term).match(/\d+(?:\.\d+)?/g) || []);
  if (!requiredNumbers.length) return true;
  const queryNumbers = new Set(String(query || "").match(/\d+(?:\.\d+)?/g) || []);
  // The first numeric scope is the primary statistic/dose/date as it appears
  // in the claim. Later numbers often describe a unit window (for example,
  // "under 1 month") and may legitimately be spelled out by the query model.
  return queryNumbers.has(requiredNumbers[0]);
}

/**
 * Build the deliberately lightweight EvidenceNeed used by Phase 1 shadow
 * scoring. It relies only on fields already available at evidence time.
 * Its heuristic term groups are diagnostics, not persisted semantic truth.
 */
export function buildEvidenceNeedV1(claim = {}) {
  const claimText = String(claim.text || claim.claimText || "").trim();
  const objectClaimText = String(claim.objectClaim || claim.objectClaimText || "").trim();
  const effectiveClaimText = String(
    objectClaimText || claim.searchText || claim.promptText || claimText,
  ).trim();
  const tokens = unique(tokenizeBearingText(effectiveClaimText), 40);
  const relationTerms = relationTermsForText(effectiveClaimText, tokens);
  const relationIndex = firstRelationIndex(tokens, relationTerms);
  const namedPhrases = extractNamedPhrases(effectiveClaimText);
  const scopeTerms = extractScopeTerms(tokens, effectiveClaimText);
  const scopeSet = new Set(scopeTerms);

  const beforeRelation = relationIndex >= 0 ? tokens.slice(0, relationIndex) : tokens.slice(0, 4);
  const afterRelation = relationIndex >= 0 ? tokens.slice(relationIndex + 1) : tokens.slice(4);
  const subjectTerms = unique([
    ...namedPhrases,
    ...beforeRelation.filter((token) => !scopeSet.has(token)),
  ], 12);
  const relationSet = new Set(relationTerms);
  const subjectSet = new Set(subjectTerms.flatMap(tokenizeBearingText));
  const objectTerms = unique(afterRelation.filter((token) =>
    !scopeSet.has(token) && !relationSet.has(token) && !subjectSet.has(token),
  ), 16);
  const mustIncludeTerms = unique([
    ...namedPhrases,
    ...scopeTerms.filter((term) => /\d/.test(term)),
  ], 10);
  const warnings = [];
  if (relationTerms.length === 0) warnings.push("no_relation_terms_detected");
  if (objectTerms.length === 0) warnings.push("no_object_terms_detected");
  if (subjectTerms.length === 0) warnings.push("no_subject_terms_detected");

  const isAttribution = Boolean(claim.isAttribution || claim.is_attribution);
  const speakerEntity = String(claim.speakerEntity || claim.speaker_entity || "").trim() || null;
  const claimType = detectClaimType({ ...claim, isAttribution }, effectiveClaimText);

  const baseNeed = {
    version: 1,
    claimId: Number(claim.id || claim.claimId || 0),
    claimText,
    effectiveClaimText,
    objectClaimText: objectClaimText || undefined,
    isAttribution,
    speakerEntity,
    argumentFunction: claim.argumentFunction || claim.argument_function || null,
    scoreTransform: claim.scoreTransform || claim.score_transform || null,
    claimRole: claim.role || claim.claimRole || null,
    priority: Number(claim.priority) || 0,
    verifiability: Number(claim.verifiability) || 0,
    centrality: Number(claim.centrality) || 0,
    claimType,
    subjectTerms,
    relationTerms,
    objectTerms,
    scopeTerms,
    mustIncludeTerms,
    evidenceTargets: buildEvidenceTargets({
      claimType,
      isAttribution,
      effectiveClaimText,
      speakerEntity,
    }),
    derivation: {
      method: "deterministic_v1",
      warnings,
    },
  };
  return Array.isArray(claim.searchAssertions) && claim.searchAssertions.length > 0
    ? buildEvidenceNeedsFromSearchAssertions(claim, baseNeed)
    : baseNeed;
}
