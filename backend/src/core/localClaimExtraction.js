const LOCAL_ROLES = new Set([
  "thesis",
  "pillar",
  "evidence",
  "background",
  "opposing_claim",
  "unclear",
]);

const ARTICLE_STANCES = new Set(["endorses", "rejects", "neutral", "unclear"]);

export const LOCAL_CLAIM_EXTRACTION_PROMPT = {
  system: `Extract locally verifiable claims from one article chunk.

Return strict JSON only. Use only the supplied chunk; do not use outside knowledge.
Keep each claim tied to the nearby language that gives it meaning. Do not construct a
document-wide argument hierarchy here.

For each claim return:
- claimText: a complete factual assertion
- localSourceExcerpt: one to three short exact sentences from this chunk that contain the claim
  and preserve nearby actor, study/year, action, population, subgroup, or protocol clues
- localRoleSuggestion: thesis | pillar | evidence | background | opposing_claim | unclear
- articleStance: endorses | rejects | neutral | unclear
- namedActors: people or organizations acting in the claim
- namedStudiesOrDocuments: specifically named or clearly referenced works, datasets, laws, protocols, or reports
- allegedAction: the alleged act for misconduct/attribution claims, otherwise empty
- claimType: booleans for attribution, misconduct, causation, disputed_study, statistical,
  legal_or_regulatory, and background
- thesisCandidate: true only if this chunk expresses a likely article thesis
- pillarCandidate: true only if the claim appears to carry a major part of the article's argument

Separate what a speaker allegedly said from whether the embedded proposition is true in the
metadata, but keep claimText faithful to the article. Preserve named actors, studies, actions,
numbers, populations, and qualifications. Avoid generic topic summaries.`,
  user: `Extract {{minClaims}} to {{maxClaims}} locally grounded claims when the chunk contains
that many worthy claims. Return fewer when it does not.

Return:
{
  "localClaims": [
    {
      "claimText": "",
      "localSourceExcerpt": "",
      "localRoleSuggestion": "thesis|pillar|evidence|background|opposing_claim|unclear",
      "articleStance": "endorses|rejects|neutral|unclear",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "allegedAction": "",
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "disputed_study": false,
        "statistical": false,
        "legal_or_regulatory": false,
        "background": false
      },
      "thesisCandidate": false,
      "pillarCandidate": false,
      "confidence": 0
    }
  ]
}

ARTICLE CHUNK:
{{chunk}}`,
  parameters: { max_claims: 12 },
};

export const DOCUMENT_SYNTHESIS_PROMPT = {
  system: `Consolidate and organize local claim fragments into one article-level argument map.

CONSOLIDATION IS CRITICAL: The input includes many near-duplicate fragments (e.g., the same
allegation stated identically dozens of times, or trivial variations). Group these duplicates
and return a SINGLE canonical representative for each group. Return claimAssignments ONLY for
canonical claims — omit duplicates entirely from the result.

Identify canonical claims as: claims with distinct substantive content, claims marked as
thesis/pillar/evidence (not generic fragments), and for duplicates, the earliest or most
complete instance.

Return strict JSON only. Do not fact-check and do not use outside knowledge. The article body
is intentionally absent. Use the claim texts, exact local excerpts, local role suggestions,
stance, and candidate markers already extracted from each chunk.

Do not rewrite claims or invent missing local context. For each canonical claim, assign a
final role and article stance. Prefer a claim explicitly marked thesisCandidate for the global
thesis. Pillars must be load-bearing propositions, not generic topics.`,
  user: `STRUCTURED LOCAL CLAIMS:
{{claimsJson}}

TASK: Identify all groups of near-duplicate claims (same core allegation, same target, same
stance, but repeated across different chunks or with minor wording variations). For each group,
select ONE canonical representative (the most complete, earliest, or most specific instance).

Return ONLY claimAssignments for canonical claims — omit all duplicates from the result. The
engine will drop non-canonical claims automatically.

Return:
{
  "globalThesis": "",
  "globalPillars": [
    { "text": "", "memberClaimIds": [] }
  ],
  "claimRelationships": [
    { "fromClaimId": "", "toClaimId": "", "relationship": "supports|opposes|evidence_for|background_to" }
  ],
  "claimAssignments": [
    {
      "localClaimId": "",
      "finalRole": "thesis|pillar|evidence|background|opposing_claim|unclear",
      "articleStance": "endorses|rejects|neutral|unclear",
      "parentClaimId": "",
      "thesisLoadScore": 0
    }
  ]
}

Return claimAssignments for CANONICAL claims only. Do not include duplicate/variant instances
in the claimAssignments list.`,
  parameters: {},
};

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function strings(value, maxItems = 12, maxChars = 300) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => clean(item, maxChars)).filter(Boolean))].slice(0, maxItems)
    : [];
}

function boolean(value) {
  return value === true || value === 1 || value === "1";
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function findSentenceExcerpt(chunk, claimText) {
  const source = String(chunk || "");
  if (!source.trim()) return "";
  const claimTerms = clean(claimText).toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const uniqueTerms = [...new Set(claimTerms)].slice(0, 12);
  const sentences = source.split(/(?<=[.!?])\s+|\n{2,}/).map((part) => part.trim()).filter(Boolean);
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const lower = sentence.toLowerCase();
    const score = uniqueTerms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  const nearby = sentences.slice(Math.max(0, bestIndex - 1), Math.min(sentences.length, bestIndex + 2)).join(" ");
  return clean(nearby || source.slice(0, 500), 600);
}

export function groundLocalSourceExcerpt(chunk, proposedExcerpt, claimText) {
  const source = String(chunk || "");
  const proposed = clean(proposedExcerpt, 600);
  if (proposed && source.toLowerCase().includes(proposed.toLowerCase())) return proposed;
  return findSentenceExcerpt(source, claimText);
}

export function deriveClaimTypeFlags(claimText, rawFlags = {}) {
  const text = clean(claimText).toLowerCase();
  return {
    attribution: boolean(rawFlags.attribution) ||
      /\b(?:revealed|said|claimed|alleged|reported|testified|admitted|stated|asserted|according to)\b/.test(text),
    misconduct: boolean(rawFlags.misconduct) ||
      /\b(?:manipulat\w*|omit\w*|exclud\w*|destroy\w*|suppress\w*|conceal\w*|fabricat\w*|cover[- ]?up|fraud\w*|falsif\w*)\b/.test(text),
    causation: boolean(rawFlags.causation) ||
      /\b(?:caus(?:e[ds]?|ing|al)?|led to|resulted in|responsible for|because of)\b/.test(text),
    disputed_study: boolean(rawFlags.disputed_study ?? rawFlags.disputedStudy) ||
      /\b(?:study|studies|dataset|data|analysis|paper|protocol|research|trial|report)\b/.test(text) &&
      /\b(?:manipulat\w*|omit\w*|exclud\w*|destroy\w*|suppress\w*|conceal\w*|reanalysis|method\w*|result\w*|link\w*|associat\w*)\b/.test(text),
    statistical: boolean(rawFlags.statistical) || /\b\d+(?:\.\d+)?\s*(?:%|percent|fold|times|deaths?|cases?|doses?)\b/.test(text),
    legal_or_regulatory: boolean(rawFlags.legal_or_regulatory ?? rawFlags.legalOrRegulatory) ||
      /\b(?:act|law|legal|liabilit\w*|regulat\w*|statute|court|mandate|license|approved?|prohibited?)\b/.test(text),
    background: boolean(rawFlags.background),
  };
}

export function normalizeLocalClaimRecord(raw, {
  chunk = "",
  chunkIndex = 0,
  recordIndex = 0,
} = {}) {
  const claimText = clean(raw?.claimText || raw?.claim || raw?.text || raw?.statement, 2000);
  if (!claimText) return null;
  const suggestedRole = clean(raw?.localRoleSuggestion || raw?.local_role_suggestion || raw?.role, 32);
  const articleStance = clean(raw?.articleStance || raw?.article_stance, 32);
  const claimType = deriveClaimTypeFlags(claimText, raw?.claimType || raw?.claim_type || {});
  const localRoleSuggestion = LOCAL_ROLES.has(suggestedRole)
    ? suggestedRole
    : claimType.background ? "background" : "unclear";
  return {
    localClaimId: clean(raw?.localClaimId || raw?.local_claim_id || `chunk-${chunkIndex + 1}-claim-${recordIndex + 1}`, 100),
    text: claimText,
    claimText,
    localSourceExcerpt: groundLocalSourceExcerpt(
      chunk,
      raw?.localSourceExcerpt || raw?.local_source_excerpt,
      claimText,
    ),
    localRoleSuggestion,
    role: localRoleSuggestion,
    articleStance: ARTICLE_STANCES.has(articleStance) ? articleStance : "unclear",
    namedActors: strings(raw?.namedActors || raw?.named_actors),
    namedStudiesOrDocuments: strings(
      raw?.namedStudiesOrDocuments || raw?.named_studies_or_documents || raw?.studiesOrDocuments,
    ),
    allegedAction: clean(raw?.allegedAction || raw?.alleged_action, 500),
    claimType,
    thesisCandidate: boolean(raw?.thesisCandidate ?? raw?.thesis_candidate),
    pillarCandidate: boolean(raw?.pillarCandidate ?? raw?.pillar_candidate),
    localExtractionConfidence: clamp01(raw?.confidence ?? raw?.localExtractionConfidence, 0.5),
    sourceChunkIndex: chunkIndex,
  };
}

export function dedupeLocalClaimRecords(records = []) {
  const byText = new Map();
  for (const record of records) {
    const key = clean(record?.claimText || record?.text).toLowerCase();
    if (!key) continue;
    if (!byText.has(key)) {
      byText.set(key, { ...record });
      continue;
    }
    const existing = byText.get(key);
    existing.namedActors = strings([...(existing.namedActors || []), ...(record.namedActors || [])]);
    existing.namedStudiesOrDocuments = strings([
      ...(existing.namedStudiesOrDocuments || []),
      ...(record.namedStudiesOrDocuments || []),
    ]);
    existing.localSourceExcerpt ||= record.localSourceExcerpt || "";
    existing.allegedAction ||= record.allegedAction || "";
    existing.thesisCandidate ||= Boolean(record.thesisCandidate);
    existing.pillarCandidate ||= Boolean(record.pillarCandidate);
    existing.localExtractionConfidence = Math.max(
      Number(existing.localExtractionConfidence) || 0,
      Number(record.localExtractionConfidence) || 0,
    );
    for (const [flag, value] of Object.entries(record.claimType || {})) {
      existing.claimType[flag] = Boolean(existing.claimType?.[flag] || value);
    }
  }
  return [...byText.values()];
}

export function compactRecordsForSynthesis(records = []) {
  return records.map((record) => ({
    localClaimId: record.localClaimId,
    claimText: clean(record.claimText || record.text, 1600),
    localSourceExcerpt: clean(record.localSourceExcerpt, 400),
    localRoleSuggestion: record.localRoleSuggestion || "unclear",
    articleStance: record.articleStance || "unclear",
    namedActors: strings(record.namedActors, 8, 160),
    namedStudiesOrDocuments: strings(record.namedStudiesOrDocuments, 8, 240),
    allegedAction: clean(record.allegedAction, 300),
    claimType: record.claimType || {},
    thesisCandidate: Boolean(record.thesisCandidate),
    pillarCandidate: Boolean(record.pillarCandidate),
  }));
}

export function applyDocumentSynthesis(records = [], raw = {}) {
  const assignments = new Map(
    (Array.isArray(raw?.claimAssignments) ? raw.claimAssignments : [])
      .map((item) => [clean(item?.localClaimId || item?.local_claim_id, 100), item]),
  );
  // Filter: keep only records that have an assignment (canonical claims). Duplicates omitted.
  const finalRecords = records
    .filter((record) => assignments.has(record.localClaimId))
    .map((record) => {
      const assignment = assignments.get(record.localClaimId) || {};
      const proposedRole = clean(assignment.finalRole || assignment.final_role, 32);
      const proposedStance = clean(assignment.articleStance || assignment.article_stance, 32);
      const finalRole = LOCAL_ROLES.has(proposedRole) ? proposedRole : record.localRoleSuggestion || "unclear";
      const role = finalRole === "opposing_claim" || finalRole === "unclear" ? "evidence" : finalRole;
      return {
        ...record,
        finalRole,
        role,
        articleStance: ARTICLE_STANCES.has(proposedStance) ? proposedStance : record.articleStance,
        parentId: clean(assignment.parentClaimId || assignment.parent_claim_id, 100) || null,
        thesisLoadScore: clamp01(assignment.thesisLoadScore ?? assignment.thesis_load_score,
          record.thesisCandidate ? 1 : record.pillarCandidate ? 0.75 : 0.35),
      };
    });
  const fallbackThesis = finalRecords.find((record) => record.thesisCandidate)?.claimText ||
    finalRecords.find((record) => record.finalRole === "thesis")?.claimText ||
    finalRecords[0]?.claimText || "";
  const globalThesis = clean(raw?.globalThesis || raw?.global_thesis || fallbackThesis, 3000);
  const globalPillars = Array.isArray(raw?.globalPillars)
    ? raw.globalPillars.map((pillar) => ({
        text: clean(pillar?.text, 2000),
        memberClaimIds: strings(pillar?.memberClaimIds || pillar?.member_claim_ids, 30, 100),
      })).filter((pillar) => pillar.text)
    : finalRecords.filter((record) => record.pillarCandidate).map((record) => ({
        text: record.claimText,
        memberClaimIds: [record.localClaimId],
      }));
  const claimRelationships = Array.isArray(raw?.claimRelationships)
    ? raw.claimRelationships.slice(0, 200)
    : [];
  return { globalThesis, globalPillars, claimRelationships, claims: finalRecords };
}
