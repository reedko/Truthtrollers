const clean = (value, max = 1_000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values) => [...new Set((values || []).map((x) => clean(x)).filter(Boolean))];
const GENERIC_WORK = /^(?:several|various|multiple|previous|prior|recent|other)\b.*\b(?:studies|research|reports?|articles?|reviews?)\b/i;
const ORGANIZATION_ONLY = /\b(?:institute|agency|department|organization|committee|association)\b/i;
const STOP = new Set("about after among article before between children claim control does evidence found from have indicating into no not study suggesting supporting that their there these this those were which with would".split(" "));

function articleIdentity(article = {}) {
  const author = clean(article.authors?.[0]?.name || article.authors?.[0], 100);
  return { surname: author.split(/\s+/).at(-1) || null,
    year: clean(article.publishedAt, 30).match(/\b(?:19|20)\d{2}\b/)?.[0] || null };
}

function queryParts(values, max = 300) {
  const seen = new Set();
  const parts = [];
  for (const value of values.flat(Infinity)) {
    const text = clean(value, 180);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key); parts.push(text);
  }
  const joined = clean(parts.join(" "), 4_000);
  return joined.length <= max ? joined : joined.slice(0, max).replace(/\s+\S*$/, "").trim();
}

function propositionParts(target, criteria) {
  const criterionTokens = new Set([...(criteria.mustMatch || []), ...(criteria.shouldMatch || [])]
    .join(" ").toLowerCase().match(/\b(?:\d+(?:\.\d+)?%?|no|not|[a-z][a-z-]{3,})\b/g) || []);
  const targetTerms = (criteria.mustMatch || []).length >= 2 ? [] : (clean(target.targetText, 2_000).toLowerCase()
    .match(/\b(?:\d+(?:\.\d+)?%?|no|not|[a-z][a-z-]{3,})\b/g) || [])
    .filter((term) => !STOP.has(term) && !criterionTokens.has(term)).slice(0, 5);
  return [criteria.mustMatch?.slice(0, 4), criteria.shouldMatch?.slice(0, 1), targetTerms];
}

function qualificationRole(card, task) {
  const text = `${card.falsifiability?.wouldQualifyIf || ""} ${card.scope || ""} ` +
    `${card.evidenceRolesNeeded || ""} ${card.bestSourceTypes || ""} ${card.warnings || ""} ` +
    `${task.articleRole || ""} ${task.articleUse || ""}`.toLowerCase();
  if (/\b(?:law|legal|statute|administrative|regulation|requirement)\b/.test(text)) return "official_or_legal_context";
  if (/\b(?:method|methodology|limitation|bias|confound|study design)\b|\brecords? (?:missing|unavailable|incomplete)\b/.test(text)) return "methodology_or_limitation";
  if (/\b(?:definition|criteria|terminology)\b/.test(text)) return "definition_or_scope";
  return "subgroup_or_scope";
}

const ROLE_TERMS = Object.freeze({
  primary_result: ["study results"],
  independent_corrob_or_review: ["systematic review", "epidemiological study"],
  reanalysis_or_correction: ["reanalysis", "correction"],
  methodology_or_limitation: ["methodology", "limitations"],
  subgroup_or_scope: ["subgroup", "effect modification"],
  definition_or_scope: ["definition", "criteria"],
  official_or_legal_context: ["official record", "requirements"],
  opponent_or_claim_provenance: ["original publication", "claim provenance"],
});

function roleSpecs(card, task) {
  const falsifiability = card.falsifiability || {};
  const roles = unique(card.evidenceRolesNeeded).join(" ").toLowerCase();
  const primary = /\b(?:target-primary|primary-record|underlying results?)\b/.test(roles);
  const rows = [];
  if (falsifiability.wouldSupportIf || falsifiability.verificationQuestion) rows.push({
    evidenceRole: primary ? "primary_result" : "independent_corrob_or_review",
    falsifiabilityBasis: falsifiability.wouldSupportIf ? "wouldSupportIf" : "verificationQuestion",
  });
  if (falsifiability.wouldRefuteIf) rows.push({ evidenceRole: "reanalysis_or_correction",
    falsifiabilityBasis: "wouldRefuteIf" });
  if (falsifiability.wouldQualifyIf) rows.push({ evidenceRole: qualificationRole(card, task),
    falsifiabilityBasis: "wouldQualifyIf" });
  if (!rows.length) rows.push({ evidenceRole: primary ? "primary_result" : "independent_corrob_or_review",
    falsifiabilityBasis: "verificationQuestion" });
  return rows;
}

// Mirrors CF1 attachesOwnIdentity (twoCallAgentOutput.js:41-53). The evaluated article's
// own identity may seed a query only when the disputed object IS this article's authorship
// (gradeTarget = attribution, asserter = the article). For any substantive-graded target
// the article is not its own evidence, so its identity must not be injected — restoring the
// Step 2/3 circularity kill that this compiler was bypassing. Baseline packages (no
// gradeTarget) keep prior behavior.
function articleIdentityAllowed(card) {
  if (card.gradeTarget == null) return true;
  return card.gradeTarget === "attribution"
    && /^(?:the )?(?:article|authors?|study)$/i.test(card.assertionSource ?? "");
}

export function compileTargetLanes({ task, target, article }) {
  const card = target.evidenceNeedCard;
  const criteria = card.bearingCriteria || {};
  const identity = articleIdentityAllowed(card) ? articleIdentity(article) : { surname: null, year: null };
  const base = propositionParts(target, criteria);
  const legacyQueryHints = (card.queryLaneSeeds || []).map((seed) => ({
    laneType: seed.laneType, query: seed.query, purpose: seed.purpose,
  }));
  return roleSpecs(card, task).map(({ evidenceRole, falsifiabilityBasis }) => {
    const identityTerms = ["primary_result", "reanalysis_or_correction"].includes(evidenceRole)
      ? [identity.surname, identity.year] : [];
    const scopeTerms = ["subgroup_or_scope", "definition_or_scope"].includes(evidenceRole)
      ? [card.scope] : [];
    return { laneFamily: evidenceRole, evidenceRole, falsifiabilityBasis,
      query: queryParts([base, identityTerms, scopeTerms, ROLE_TERMS[evidenceRole] || []]),
      fieldsUsed: unique(["targetText", "bearingCriteria.mustMatch", "bearingCriteria.shouldMatch",
        `falsifiability.${falsifiabilityBasis}`, "bestSourceTypes", "evidenceRolesNeeded", "scope"]),
      avoidTerms: unique([...(criteria.rejectIfOnly || []), card.falsifiability?.notEnoughIfOnly]),
      legacyQueryHints, warnings: unique(card.warnings) };
  });
}

export function classifyContextWork(entry) {
  const label = clean(entry.workLabel, 300);
  const type = clean(entry.workType, 80).toLowerCase();
  const hasIdentifier = entry.identifiers.doi.length || entry.identifiers.pmid.length || entry.identifiers.canonicalUrls.length;
  if (hasIdentifier) return { status: "resolvable", classification: "specific_identity" };
  if (GENERIC_WORK.test(label)) return { status: "deferred", classification: "generic_context_phrase" };
  if (/(?:standard|manual)/.test(type) && label.length >= 4) return { status: "resolvable", classification: "definition_or_scope" };
  if (/(?:law|policy)/.test(type) && label.split(/\s+/).length >= 3) return { status: "resolvable", classification: "official_or_legal_context" };
  if (ORGANIZATION_ONLY.test(label)) return { status: "deferred", classification: "organization_context" };
  if (/(?:study|case.?series|review|report)/.test(type)) {
    if (entry.publicationYear && (entry.workAuthors.length || entry.publicationVenue)) return { status: "resolvable", classification: "opponent_or_claim_provenance" };
    return { status: "deferred", classification: "provenance_hint" };
  }
  return { status: "deferred", classification: "deferred_context_work" };
}

export function contextWorkQuery(entry, classification) {
  const family = ["official_or_legal_context", "opponent_or_claim_provenance"].includes(classification)
    ? classification : "context_work_resolution";
  const terms = classification === "definition_or_scope" ? ["definition", "criteria"]
    : classification === "official_or_legal_context" ? ["official text", "requirements"]
      : classification === "opponent_or_claim_provenance" ? ROLE_TERMS.opponent_or_claim_provenance : [];
  return { laneFamily: family, query: queryParts([`"${entry.workLabel}"`, entry.workAuthors[0],
    entry.publicationYear, entry.publicationVenue, terms]),
  fieldsUsed: ["workLabel", "workAuthors", "publicationYear", "publicationVenue", "workType"] };
}
