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
  } else {
    add("direct", "open", "other", "direct_truth_value", effectiveClaimText);
  }

  return targets;
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

  return {
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
}

