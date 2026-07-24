import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { tokenizeBearingText } from "./evidenceNeed.js";
import { retrievalContextForTarget } from "./retrievalContext.js";

const clean = (value, max = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values, limit = 20) => [...new Set((values || []).map((value) => clean(value)).filter(Boolean))].slice(0, limit);
const studySearchClues = (context = {}) => (context.studyClues || [])
  .filter((clue) => !/referenced study\/document identity unresolved/i.test(clue));
const GENERIC_IDENTITY_TOKENS = new Set([
  "adverse", "analysis", "data", "deaths", "events", "evidence", "health",
  "journal", "paper", "public", "research", "safety", "study", "system",
]);
const SECONDARY_STUDY_TITLE_RE = /\b(?:systematic review|meta-analysis|review|an update of|update of|scientific evidence)\b/i;

function boundedIdentity(identity = {}) {
  return {
    title: clean(identity.title, 500),
    authors: clean(identity.authors, 500),
    year: identity.year || null,
    journalOrInstitution: clean(identity.journalOrInstitution, 300),
    identifier: clean(identity.identifier, 300),
    pmid: identity.pmid || null,
    doi: identity.doi || null,
    population: clean(identity.population, 300) || null,
    url: clean(identity.url, 700),
    provider: clean(identity.provider, 80),
    identityRole: identity.identityRole || "unclassified",
    identityScore: Number(identity.identityScore) || 0,
    scoreComponents: identity.scoreComponents || {},
    stableKey: clean(identity.stableKey, 700),
    verifiedDocumentIdentity: Boolean(identity.verifiedDocumentIdentity),
    identityTargetId: Number(identity.identityTargetId) || null,
    evaluationTargetId: Number(identity.evaluationTargetId) || null,
    evaluationTargetType: clean(identity.evaluationTargetType, 60) || null,
  };
}

function explicitStudyYears(context = {}) {
  const values = [
    ...(context.studyYears || []),
    ...(context.dates || []),
    ...studySearchClues(context),
    context.targetText,
    context.objectClaimText,
    context.articlePassageContext,
  ].filter(Boolean);
  const years = [];
  for (const value of values) {
    const text = String(value);
    for (const pattern of [
      /\b((?:19|20)\d{2})\b(?:(?!\b(?:19|20)\d{2}\b).){0,45}\b(?:study|paper|analysis|dataset|results?|protocol)\b/gi,
      /\b(?:study|paper|analysis|dataset|results?|protocol)\b(?:(?!\b(?:19|20)\d{2}\b).){0,45}\b((?:19|20)\d{2})\b/gi,
    ]) {
      for (const match of text.matchAll(pattern)) years.push(match[1]);
    }
  }
  return unique(years, 6);
}

export function buildStudyIdentityDiscoveryQueries(context = {}) {
  const people = context.speakerEntities || [];
  const organizations = context.organizations || [];
  const studyClues = studySearchClues(context);
  const clueTerms = unique(
    studyClues.flatMap((clue) => tokenizeBearingText(clue).filter((token) => token.length > 3)),
    10,
  );
  const topics = unique([
    ...clueTerms,
    ...(context.requiredAnchors || []),
    ...tokenizeBearingText(`${context.objectClaimText || ""} ${context.targetText || ""}`)
      .filter((token) => token.length > 3),
  ], 10);
  const studyYears = explicitStudyYears(context);
  const base = unique([...people, ...organizations, ...studyYears, ...clueTerms, ...topics], 12);
  const queries = [];
  if (base.length) queries.push([...base, "study"].join(" "));
  const population = (context.populations || [])[0];
  const second = unique([...studyYears, population, ...clueTerms, ...people, ...organizations, ...topics.slice(0, 4)], 12);
  if (second.length) queries.push([...second, "journal paper analysis"].join(" "));
  return unique(queries, 2);
}

function identifierFromUrl(url = "") {
  let decoded = clean(url, 1500);
  try { decoded = decodeURIComponent(decoded); } catch { /* retain original */ }
  return {
    pmid: decoded.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/i)?.[1] || "",
    doi: decoded.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+?)(?=[?#]|$)/i)?.[1]?.replace(/[.,;:)]+$/, "") || "",
  };
}

function candidateIdentity(candidate = {}) {
  const meta = candidate.academicMetadata || candidate.providerMetadata || {};
  const fromUrl = identifierFromUrl(candidate.url);
  const pmid = clean(meta.pmid || candidate.pmid || fromUrl.pmid, 80);
  const doi = clean(meta.doi || candidate.doi || fromUrl.doi, 255);
  const openAlexId = clean(meta.openAlexId || candidate.openAlexId, 255);
  const semanticScholarId = clean(meta.semanticScholarId || candidate.paperId, 255);
  const identifier = unique([
    pmid ? `PMID ${pmid}` : "",
    doi ? `DOI ${doi}` : "",
    openAlexId,
    semanticScholarId,
  ], 4).join("; ");
  const title = clean(candidate.title, 1000);
  const titleYears = unique(title.match(/\b(?:19|20)\d{2}\b/g) || [], 4);
  const publishedYear = Number(String(meta.year || candidate.publishedAt || "").match(/\b(?:19|20)\d{2}\b/)?.[0]) || null;
  const inferredPopulation = title.match(/\bpopulation-based study in ([^:;,.]+)/i)?.[1] || "";
  const url = clean(candidate.url, 1000);
  const canonicalUrl = canonicalizeUrl(url) || url;
  return {
    title,
    authors: clean(Array.isArray(meta.authors) ? meta.authors.join(", ") : meta.authors, 1000),
    year: publishedYear || Number(titleYears[0]) || null,
    publishedYear,
    titleYears,
    journalOrInstitution: clean(meta.journal || meta.containerTitle || meta.venue, 500),
    identifier,
    pmid: pmid || null,
    doi: doi || null,
    population: clean(meta.population || inferredPopulation, 500) || null,
    url,
    canonicalUrl,
    provider: clean(candidate.provider || candidate.source, 80),
    snippet: clean(candidate.searchSnippet || candidate.snippet, 1200),
    publicationTypes: Array.isArray(meta.publicationTypes) ? meta.publicationTypes.map((item) => clean(item, 100)) : [],
    stableKey: identifier || canonicalUrl || `${title.toLowerCase()}|${publishedYear || titleYears[0] || ""}`,
  };
}

function classifyStudyCandidate(identity = {}) {
  const url = identity.url.toLowerCase();
  const title = identity.title.toLowerCase();
  const snippet = identity.snippet.toLowerCase();
  const combined = `${title} ${snippet}`;
  const provider = identity.provider.toLowerCase();
  let hostname = "";
  try { hostname = new URL(identity.url).hostname.toLowerCase(); } catch { /* empty */ }

  const pressRelease = /(?:news|press)[-_ /]?release|globenewswire|prnewswire|businesswire|einpresswire/.test(`${url} ${hostname} ${combined}`);
  if (pressRelease) return { role: "press_release", primaryEligible: false, retainEligible: false, reason: "press_release_not_study_identity" };

  const reanalysis = /\bre-?analy(?:sis|sed|zed)|\bsecondary analysis\b|\breexamin(?:e|ed|ation)/.test(combined);
  const review = SECONDARY_STUDY_TITLE_RE.test(title);
  const official = /(?:^|\.)gov$/.test(hostname) || /\.gov\//.test(url);
  const academicProvider = ["pubmed", "openalex", "crossref", "semantic_scholar"].includes(provider);
  const scholarly = Boolean(identity.identifier || academicProvider || /doi\.org|pubmed\.ncbi|pmc\.ncbi|link\.springer|sciencedirect|wiley|tandfonline/.test(url));
  const studyLanguage = /\b(?:study|trial|analysis|research|dataset|population-based)\b/.test(combined);
  const attributionDocument = /\b(?:statement|testimony|affidavit|declaration|transcript)\b/.test(combined);

  if (reanalysis && scholarly) return { role: "reanalysis", primaryEligible: false, retainEligible: true, reason: "scholarly_reanalysis" };
  if (review && scholarly) return { role: "review", primaryEligible: false, retainEligible: false, reason: "review_not_subject_study" };
  if (scholarly && (studyLanguage || academicProvider || identity.identifier)) {
    return { role: "original_study", primaryEligible: true, retainEligible: true, reason: "scholarly_study_record" };
  }
  if (official && studyLanguage) return { role: "official_study_page", primaryEligible: true, retainEligible: true, reason: "official_study_page" };
  if (official) return { role: "official_statement", primaryEligible: false, retainEligible: true, reason: "official_statement" };
  if (attributionDocument) return { role: "attribution_document", primaryEligible: false, retainEligible: true, reason: "attribution_document" };
  if (/\b(?:news|report|commentary|opinion|questions validity|controversy)\b/.test(combined)) {
    return { role: "news_or_commentary", primaryEligible: false, retainEligible: false, reason: "secondary_commentary" };
  }
  return { role: "unclassified", primaryEligible: false, retainEligible: false, reason: "unclassified_document" };
}

function tokenSet(value) {
  return new Set(tokenizeBearingText(value));
}

function scoreIdentity(identity, context, classification) {
  const haystack = tokenSet(`${identity.title} ${identity.authors} ${identity.journalOrInstitution}`);
  const anchors = [...new Set(unique([
    ...(context.requiredAnchors || []),
    ...(context.speakerEntities || []),
    ...(context.organizations || []),
  ], 30).flatMap(tokenizeBearingText))];
  const overlapTokens = anchors.filter((token) => haystack.has(token));
  const distinctiveOverlap = overlapTokens.filter((token) => !GENERIC_IDENTITY_TOKENS.has(token));
  const targetTokens = tokenSet(`${context.objectClaimText || ""} ${context.targetText || ""}`);
  const topicOverlapTokens = [...targetTokens].filter((token) => haystack.has(token));
  const studyYears = explicitStudyYears(context);
  const candidateYears = unique([identity.publishedYear, ...(identity.titleYears || [])].filter(Boolean).map(String), 6);
  const yearMatch = candidateYears.some((year) => studyYears.includes(year));
  const speakerTokens = tokenSet((context.speakerEntities || []).join(" "));
  const authorTokens = tokenSet(identity.authors);
  const authorMatch = [...speakerTokens].some((token) => authorTokens.has(token));
  const populationMatch = (context.populations || []).some((population) => {
    const expected = tokenSet(population);
    return [...expected].some((token) => haystack.has(token));
  });
  const official = classification.role === "official_study_page" || classification.role === "official_statement";
  const components = {
    anchorOverlap: Math.min(0.35, overlapTokens.length * 0.07),
    distinctiveTitle: Math.min(0.15, distinctiveOverlap.length * 0.05),
    topicAlignment: Math.min(0.2, topicOverlapTokens.length * 0.04),
    stableIdentifier: identity.identifier && (overlapTokens.length >= 2 || topicOverlapTokens.length >= 3) ? 0.25 : 0,
    explicitStudyYear: yearMatch ? 0.15 : 0,
    authorMatch: authorMatch ? 0.1 : 0,
    populationMatch: populationMatch ? 0.1 : 0,
    officialHost: official ? 0.15 : 0,
    documentType: classification.role === "original_study" ? 0.1
      : classification.role === "official_study_page" ? 0.1
      : classification.role === "reanalysis" ? 0.08
      : 0,
    ineligiblePrimaryPenalty: classification.primaryEligible ? 0 : 0,
  };
  const score = Math.max(0, Math.min(1,
    Object.entries(components)
      .filter(([key]) => key !== "ineligiblePrimaryPenalty")
      .reduce((sum, [, value]) => sum + value, 0)
  ));
  const grounded = (overlapTokens.length >= 2 || topicOverlapTokens.length >= 3) && (
    Boolean(identity.identifier) || yearMatch || official || authorMatch || populationMatch
  );
  return {
    score,
    anchorOverlap: overlapTokens.length,
    overlapTokens,
    topicOverlapTokens,
    studyYears,
    candidateYears,
    yearMatch,
    grounded,
    scoreComponents: components,
  };
}

function meaningfulAnchorTokens(values = []) {
  return [...new Set(values
    .flatMap((value) => tokenizeBearingText(value))
    .filter((token) => token.length > 3 && !GENERIC_IDENTITY_TOKENS.has(token)))];
}

function hasLocalHardAnchorMatch(item, context = {}) {
  const identity = item.identity || {};
  const haystack = tokenSet(`${identity.title} ${identity.authors} ${identity.journalOrInstitution} ${identity.snippet}`);
  const studyYears = explicitStudyYears(context);
  if (studyYears.length > 0) {
    return item.yearMatch;
  }

  const speakerOrAuthor = item.scoreComponents?.authorMatch > 0;
  if (speakerOrAuthor) return true;

  const namedAnchorTokens = meaningfulAnchorTokens([
    ...(context.speakerEntities || []),
    ...(context.organizations || []),
  ]);
  const namedOverlap = namedAnchorTokens.filter((token) => haystack.has(token));
  if (namedOverlap.length >= 1 && item.anchorOverlap >= 2) return true;

  const clueTokens = meaningfulAnchorTokens(studySearchClues(context));
  const clueOverlap = clueTokens.filter((token) => haystack.has(token));
  if (clueTokens.length >= 3 && clueOverlap.length >= 3) return true;

  return false;
}

function classifyAndScoreCandidates(candidates = [], context = {}) {
  const distinct = new Map();
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    if (!identity.stableKey || distinct.has(identity.stableKey)) continue;
    const classification = classifyStudyCandidate(identity);
    const assessment = scoreIdentity(identity, context, classification);
    distinct.set(identity.stableKey, { candidate, identity, classification, ...assessment });
  }
  return [...distinct.values()].sort((a, b) =>
    (b.score - a.score) || (b.anchorOverlap - a.anchorOverlap)
  );
}

function sameBibliographicIdentity(first, second) {
  if (!first || !second) return false;
  if (first.identity.pmid && second.identity.pmid) return first.identity.pmid === second.identity.pmid;
  if (first.identity.doi && second.identity.doi) return first.identity.doi.toLowerCase() === second.identity.doi.toLowerCase();
  return first.identity.stableKey === second.identity.stableKey;
}

export function resolveStudyIdentityCandidates(candidates = [], context = {}) {
  const ranked = classifyAndScoreCandidates(candidates, context);
  const primaryCandidates = ranked.filter((item) =>
    item.classification.primaryEligible &&
    item.grounded &&
    item.score >= 0.5 &&
    hasLocalHardAnchorMatch(item, context)
  );
  const stableOriginal = primaryCandidates.find((item) =>
    item.classification.role === "original_study" && Boolean(item.identity.identifier)
  );
  const best = stableOriginal || primaryCandidates[0] || null;
  const runnerUp = primaryCandidates.find((item) => item !== best) || null;
  const ambiguous = Boolean(
    best && runnerUp && !stableOriginal && best.classification.role === runnerUp.classification.role &&
    best.score - runnerUp.score < 0.08 && !sameBibliographicIdentity(best, runnerUp)
  );
  const primary = best && !ambiguous ? best : null;

  const retained = [];
  const addRetained = (item) => {
    if (!item || retained.some((existing) => existing.identity.stableKey === item.identity.stableKey)) return;
    retained.push(item);
  };
  addRetained(primary);
  addRetained(ranked.find((item) =>
    item.classification.role === "official_study_page" &&
    item.grounded &&
    item.score >= 0.45 &&
    hasLocalHardAnchorMatch(item, context)
  ));
  addRetained(ranked.find((item) =>
    item.classification.role === "reanalysis" &&
    item.grounded &&
    item.score >= 0.4 &&
    hasLocalHardAnchorMatch(item, context)
  ));
  addRetained(ranked.find((item) =>
    item.classification.role === "attribution_document" &&
    item.grounded &&
    item.score >= 0.4 &&
    hasLocalHardAnchorMatch(item, context)
  ));

  const retainedWorks = retained.slice(0, 3).map((item) => ({
    ...item.identity,
    identityRole: item.classification.role,
    identityScore: item.score,
    scoreComponents: item.scoreComponents,
    verifiedDocumentIdentity: true,
  }));
  const rejectedCandidates = ranked
    .filter((item) => !retained.some((kept) => kept.identity.stableKey === item.identity.stableKey))
    .slice(0, 12)
    .map((item) => ({
      ...boundedIdentity({
        ...item.identity,
        identityRole: item.classification.role,
        identityScore: item.score,
        scoreComponents: item.scoreComponents,
      }),
      rejectionReason: item.classification.primaryEligible
        ? item.grounded ? "not_selected_or_ambiguous" : "insufficient_identity_anchors"
        : item.classification.reason,
    }));
  const primaryStudy = primary ? retainedWorks.find((work) => work.stableKey === primary.identity.stableKey) || null : null;
  return {
    status: primaryStudy ? "resolved" : "unresolved",
    primaryStudy,
    resolvedWork: primaryStudy,
    retainedWorks,
    officialStudyPages: retainedWorks.filter((work) => work.identityRole === "official_study_page"),
    relatedAnalyses: retainedWorks.filter((work) => work.identityRole === "reanalysis"),
    attributionDocuments: retainedWorks.filter((work) => work.identityRole === "attribution_document"),
    rejectedCandidates,
    candidates: ranked.slice(0, 12).map((item) => boundedIdentity({
      ...item.identity,
      identityRole: item.classification.role,
      identityScore: item.score,
      scoreComponents: item.scoreComponents,
    })),
    reason: primaryStudy ? null
      : ambiguous ? "ambiguous_identity_candidates"
      : primaryCandidates.length ? "no_unambiguous_primary_study"
      : ranked.some((item) => item.classification.primaryEligible)
        ? "insufficient_identity_anchors"
        : ranked.length ? "no_eligible_primary_study" : "no_identity_candidates",
  };
}

export function buildBibliographicResolutionQueries(resolution = {}, context = {}) {
  const seed = resolution.primaryStudy || resolution.officialStudyPages?.[0] ||
    resolution.retainedWorks?.find((work) => work.identityRole === "official_study_page");
  const studyYears = explicitStudyYears(context);
  const people = context.speakerEntities || [];
  const population = (context.populations || [])[0];
  const title = clean(seed?.title, 500)
    .replace(/\b(?:agency|institution) statement\s*:?\s*/i, "")
    .replace(/\|.*$/, "")
    .trim();
  const topicTerms = unique(tokenizeBearingText(`${context.objectClaimText || ""} ${title}`).filter((term) => term.length > 3), 7);
  const queries = [];
  const anchored = unique([...people, ...studyYears, population, ...topicTerms], 10);
  if (anchored.length) queries.push(anchored.join(" "));
  if (title) queries.push(title);
  return unique(queries, 2);
}

function workKey(work = {}) {
  return work.stableKey || work.identifier || canonicalizeUrl(work.url) || work.url || work.title;
}

function assignWorkTargets(work, claim, studyTargetId) {
  const targets = claim.evaluationTargets || [];
  const substantive = targets.find((target) => String(target.targetType || target.target_type) === "substantive");
  const attribution = targets.find((target) => String(target.targetType || target.target_type) === "attribution");
  const evidenceTarget = work.identityRole === "attribution_document"
    ? attribution || substantive
    : substantive || targets.find((target) => Number(target.evaluationTargetId || target.evaluation_target_id) === studyTargetId);
  return {
    ...work,
    identityTargetId: studyTargetId,
    evaluationTargetId: Number(evidenceTarget?.evaluationTargetId || evidenceTarget?.evaluation_target_id) || studyTargetId,
    evaluationTargetType: String(evidenceTarget?.targetType || evidenceTarget?.target_type || "study_identity"),
  };
}

function studyYearConflict(target = {}) {
  const storedYear = clean(target.studyYear || target.study_year, 20);
  const hints = target.queryHints || target.query_hints || {};
  const hintYears = Array.isArray(hints.numbersOrStatistics)
    ? hints.numbersOrStatistics.map((value) => clean(value, 20)).filter((value) => /\b(?:19|20)\d{2}\b/.test(value))
    : [];
  return Boolean(storedYear && hintYears.length && !hintYears.includes(storedYear));
}

export async function discoverStudyIdentities({ query, taskContentId, claims, search }) {
  for (const claim of claims || []) {
    const studyTargets = (claim.evaluationTargets || []).filter((target) =>
      String(target.targetType || target.target_type) === "study_identity" &&
      (!target.studyIdentifier && !target.study_identifier ||
        SECONDARY_STUDY_TITLE_RE.test(String(target.studyTitle || target.study_title || "")) ||
        studyYearConflict(target))
    );
    for (const target of studyTargets) {
      const targetId = Number(target.evaluationTargetId || target.evaluation_target_id) || null;
      const context = retrievalContextForTarget(claim, targetId) || claim.retrievalContext || {};
      const discoveryQueries = buildStudyIdentityDiscoveryQueries(context);
      const candidates = [];
      for (const discoveryQuery of discoveryQueries) {
        const found = await search.web({ query: discoveryQuery, topK: 5, retrievalMode: "study_identity" });
        candidates.push(...(found || []));
      }

      let resolution = resolveStudyIdentityCandidates(candidates, context);
      const hasStableOriginal = resolution.retainedWorks.some((work) =>
        work.identityRole === "original_study" && Boolean(work.identifier)
      );
      const bibliographicQueries = hasStableOriginal ? [] : buildBibliographicResolutionQueries(resolution, context);
      for (const bibliographicQuery of bibliographicQueries) {
        const found = await search.web({
          query: bibliographicQuery,
          topK: 5,
          retrievalMode: "study_bibliographic_resolution",
          onlyProviders: ["pubmed", "crossref", "openalex"],
          includeAcademic: true,
        });
        candidates.push(...(found || []));
      }
      if (bibliographicQueries.length) resolution = resolveStudyIdentityCandidates(candidates, context);

      const routedWorks = resolution.retainedWorks.map((work) => assignWorkTargets(work, claim, targetId));
      logger.log(`[STUDY_IDENTITY_DISCOVERY] ${JSON.stringify({
        event: "study_identity_discovery",
        taskContentId,
        claimId: claim.id,
        evaluationTargetId: targetId,
        discoveryQueries,
        bibliographicQueries,
        status: resolution.status,
        primaryStudy: resolution.primaryStudy ? boundedIdentity(assignWorkTargets(resolution.primaryStudy, claim, targetId)) : null,
        retainedWorks: routedWorks.map(boundedIdentity),
        rejectedCandidates: resolution.rejectedCandidates,
        candidates: resolution.candidates,
        reason: resolution.reason,
      })}`);

      if (resolution.primaryStudy && targetId) {
        const work = assignWorkTargets(resolution.primaryStudy, claim, targetId);
        const fullyResolved = work.identityRole === "original_study" && Boolean(work.identifier);
        await query(
          `UPDATE claim_evaluation_targets
              SET study_title = NULLIF(?, ''), study_authors = NULLIF(?, ''),
                  study_year = ?, study_identifier = NULLIF(?, ''),
                  population_scope = COALESCE(NULLIF(?, ''), population_scope),
                  resolution_status = ?
            WHERE evaluation_target_id = ? AND content_id = ? AND claim_id = ?`,
          [work.title, work.authors, work.year, work.identifier, work.population,
           fullyResolved ? "resolved" : "identified", targetId, taskContentId, claim.id],
        );
        Object.assign(target, {
          studyTitle: work.title,
          studyAuthors: work.authors,
          studyYear: work.year,
          studyIdentifier: work.identifier,
          populationScope: work.population || target.populationScope || "",
          resolutionStatus: fullyResolved ? "resolved" : "identified",
        });
      }

      claim.resolvedWorks = [
        ...(Array.isArray(claim.resolvedWorks) ? claim.resolvedWorks : []),
        ...routedWorks,
      ].filter((item, index, all) => all.findIndex((candidate) => workKey(candidate) === workKey(item)) === index).slice(0, 8);
    }
  }
}
