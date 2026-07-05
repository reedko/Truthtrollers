import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { detectAcademicIdentifiers } from "./academicContentResolver.js";

const STOP = new Set([
  "about", "after", "among", "article", "children", "data", "first", "from", "into",
  "journal", "paper", "research", "study", "the", "their", "using", "with",
]);
const GENERIC_STUDY_TOPIC = new Set(["vaccine", "autism", "measles", "mumps", "rubella"]);

const clean = (value, max = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
function normalizedToken(token) {
  if (/^vaccin/.test(token)) return "vaccine";
  if (/^autis/.test(token)) return "autism";
  if (/^manipulat/.test(token)) return "manipulate";
  if (/^omit/.test(token)) return "omit";
  return token;
}

const tokens = (value) => {
  const result = new Set();
  for (const raw of clean(value).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (raw === "mmr") {
      result.add("measles");
      result.add("mumps");
      result.add("rubella");
      continue;
    }
    const token = normalizedToken(raw);
    if (token.length >= 4 && !STOP.has(token)) result.add(token);
  }
  return result;
};

function overlap(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return { count: 0, ratio: 0 };
  const count = [...left].filter((token) => right.has(token)).length;
  return { count, ratio: count / Math.min(left.size, right.size) };
}

function distinctiveOverlap(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  return [...left].filter((token) => right.has(token) && !GENERIC_STUDY_TOPIC.has(token)).length;
}

function identifiersForWork(work = {}) {
  return detectAcademicIdentifiers({
    url: work.url,
    title: work.title,
    snippet: work.identifier,
    academicMetadata: { pmid: work.pmid, pmcid: work.pmcid, doi: work.doi },
  });
}

function identifiersMatch(candidateIds, workIds) {
  return Boolean(
    (candidateIds.pmid && workIds.pmid && candidateIds.pmid === workIds.pmid) ||
    (candidateIds.pmcid && workIds.pmcid && candidateIds.pmcid === workIds.pmcid) ||
    (candidateIds.doi && workIds.doi && candidateIds.doi.toLowerCase() === workIds.doi.toLowerCase()),
  );
}

function resolvedWorksForClaim(claim = {}) {
  const works = [];
  for (const context of claim.retrievalContexts || []) {
    for (const work of context.resolvedWorks || []) {
      works.push({
        ...work,
        evaluationTargetId: context.evaluationTargetId || null,
        evaluationTargetType: context.evaluationTargetType || "study_identity",
      });
    }
  }
  return works;
}

function studyTargetId(claim = {}, work = null) {
  if (work?.evaluationTargetId) return work.evaluationTargetId;
  return (claim.evaluationTargets || []).find((target) =>
    String(target.targetType || target.target_type) === "study_identity"
  )?.evaluationTargetId || null;
}

export function classifyIdentityBearingCandidate(claim = {}, candidate = {}) {
  const works = resolvedWorksForClaim(claim);
  if (!works.length) return candidate;
  const candidateIds = detectAcademicIdentifiers(candidate);
  const candidateUrl = canonicalizeUrl(candidate.url) || candidate.url || "";
  const candidateText = [candidate.title, candidate.snippet].filter(Boolean).join(" ");
  let best = null;
  for (const work of works) {
    const workIds = identifiersForWork(work);
    const workUrl = canonicalizeUrl(work.url) || work.url || "";
    const titleOverlap = overlap(candidate.title, work.title);
    const contextOverlap = overlap(candidateText, `${work.title || ""} ${work.authors || ""} ${work.year || ""}`);
    const exactIdentifier = identifiersMatch(candidateIds, workIds);
    const exactUrl = Boolean(candidateUrl && workUrl && candidateUrl === workUrl);
    const workHasStableIdentity = Boolean(workIds.pmid || workIds.pmcid || workIds.doi || workUrl);
    const titleIdentity = titleOverlap.count >= 4 && titleOverlap.ratio >= 0.65 &&
      distinctiveOverlap(candidate.title, work.title) >= 2 &&
      contextOverlap.count >= 4;

    let identity = null;
    if (exactIdentifier || exactUrl) {
      identity = {
        score: 1,
        type: work.identityRole || "original_study",
        rationale: exactIdentifier
          ? "Candidate identifier matches the resolved study."
          : "Candidate URL matches the resolved study.",
      };
    } else if (!workHasStableIdentity && titleIdentity) {
      identity = {
        score: 0.9,
        type: work.identityRole || "original_study",
        rationale: "No stable identifier was available; title and bibliographic context strongly match the resolved study.",
      };
    }
    if (identity && (!best || identity.score > best.score)) best = { ...identity, work };
  }

  if (!best) return candidate;
  return {
    ...candidate,
    protectedDocumentIdentity: true,
    identityBearingScore: best.score,
    identityBearingType: best.type,
    identityBearingRationale: best.rationale,
    identityTargetId: studyTargetId(claim, best.work),
    identityResolvedWork: {
      title: clean(best.work.title, 500),
      identifier: clean(best.work.identifier, 200),
      url: clean(best.work.url, 500),
    },
  };
}

export function applyIdentityBearing(claim, candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) =>
    classifyIdentityBearingCandidate(claim, candidate)
  );
}

// Retained as a compatibility no-op for callers/tests from the retired
// bibliography-expansion path. Citation proximity must never manufacture an
// override identity; only classifyIdentityBearingCandidate may do that from a
// previously resolved work.
export function classifyClaimSubjectStudyCandidate(claim = {}, candidate = {}) {
  void claim;
  return candidate;
}

export function buildIdentityDocumentLink({ candidate = {}, refData = {}, claimIndex } = {}) {
  if (!candidate.protectedDocumentIdentity && !refData.protectedDocumentIdentity) return null;
  const score = Number(candidate.identityBearingScore ?? refData.identityBearingScore ?? 0);
  if (!Number.isFinite(score) || score < 0.8) return null;
  const type = candidate.identityBearingType || refData.identityBearingType || "study_subject";
  const rationale = candidate.identityBearingRationale || refData.identityBearingRationale ||
    "This document is the identified study or a direct analysis of it.";
  const text = String(refData.cleanText || refData.snippet || candidate.snippet || "").trim();
  return {
    referenceContentId: refData.referenceContentId,
    url: candidate.url || refData.url,
    title: refData.title || candidate.title || "Identified study",
    stance: "insufficient",
    why: `${rationale} Document identity does not establish whether the case allegation is true or false.`,
    quote: text.slice(0, 1200) || null,
    claims: Number.isInteger(claimIndex) ? [claimIndex] : [...(refData.claimIndices || [])],
    quality: Math.max(0.8, Math.min(1, score)),
    cleanText: refData.cleanText || "",
    scrapeStatus: "identity_only",
    documentOnly: true,
    identityBearingScore: score,
    identityBearingType: type,
    identityTargetId: candidate.identityTargetId || refData.identityTargetId || null,
  };
}
