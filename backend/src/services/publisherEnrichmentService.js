// backend/src/services/publisherEnrichmentService.js
// ──────────────────────────────────────────────────────────────────
// Publisher enrichment: fetch bias/reliability/profile data from
// AllSides, Ad Fontes, and Wikipedia and store in the DB.
//
// Entry point: enrichPublisherIfNeeded({ query, publisherId?, publisherName, sourceUrl, domain?, force?, context? })
//
// The function is designed to be called fire-and-forget from the scrape
// pipeline. It never throws to its caller and never blocks the scrape.
// ──────────────────────────────────────────────────────────────────

import logger from "../utils/logger.js";
import { tavilySearch } from "../core/tavilySearch.js";
import { openAiLLM } from "../core/openAiLLM.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const FRESHNESS_DAYS = 30;
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 12000;
const MAX_PAGE_TEXT_CHARS = 20000;

// AllSides label → numeric bias score (used for backward-compat with UI that expects a number)
const ALLSIDES_SCORE = {
  Left: -100,
  "Lean Left": -50,
  Center: 0,
  "Lean Right": 50,
  Right: 100,
};

// Private/loopback IP ranges — block to prevent SSRF
const PRIVATE_IP_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;

// ────────────────────────────────────────────────────────────
// URL helpers
// ────────────────────────────────────────────────────────────

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname === "localhost") return false;
    if (PRIVATE_IP_RE.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Page fetching
// ────────────────────────────────────────────────────────────

async function fetchPageText(url) {
  if (!isSafeUrl(url)) throw new Error(`SSRF blocked: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TruthTrollers-Enrichment/1.0; +https://truthtrollers.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
    const html = await resp.text();

    // Try Readability first
    try {
      const dom = new JSDOM(html, { url });
      const article = new Readability(dom.window.document).parse();
      if (article?.textContent) {
        return article.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS);
      }
    } catch (_) {}

    // Fallback: strip tags
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────
// Freshness checks
// ────────────────────────────────────────────────────────────

async function isStaleRating(query, publisherId, source) {
  const rows = await query(
    `SELECT MAX(last_checked) AS last_checked
     FROM publisher_ratings
     WHERE publisher_id = ? AND source = ? AND user_id IS NULL`,
    [publisherId, source]
  );
  const last = rows[0]?.last_checked;
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) / 86400000 > FRESHNESS_DAYS;
}

async function isStaleProfile(query, publisherId, source) {
  const rows = await query(
    `SELECT MAX(last_checked) AS last_checked
     FROM publisher_profiles
     WHERE publisher_id = ? AND source = ?`,
    [publisherId, source]
  );
  const last = rows[0]?.last_checked;
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) / 86400000 > FRESHNESS_DAYS;
}

// ────────────────────────────────────────────────────────────
// Candidate selection
// ────────────────────────────────────────────────────────────

function pickCandidate(results, publisherName, domain, requiredDomain) {
  const lowerName = (publisherName || "").toLowerCase();
  const lowerDomain = (domain || "").toLowerCase();

  const scored = results
    .filter((r) => r.url && isSafeUrl(r.url))
    .map((r) => {
      let score = 0;
      const url = r.url.toLowerCase();
      const title = (r.title || "").toLowerCase();
      const snippet = (r.snippet || "").toLowerCase();

      if (requiredDomain && url.includes(requiredDomain)) score += 10;
      if (lowerName && title.includes(lowerName)) score += 5;
      if (lowerName && url.includes(lowerName.replace(/\s+/g, "-"))) score += 4;
      if (lowerDomain && url.includes(lowerDomain)) score += 3;
      if (lowerName && snippet.includes(lowerName)) score += 2;

      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score);

  // Must be on the required domain to qualify
  if (!scored.length || scored[0]._score < 10) return null;
  return scored[0];
}

// ────────────────────────────────────────────────────────────
// Database write helpers
// ────────────────────────────────────────────────────────────

async function logEnrichmentRun(query, opts) {
  const {
    publisherId,
    domain,
    provider,
    searchQuery,
    candidateUrl,
    status,
    extractedRatingLabel,
    extractedBiasScore,
    extractedVeracityScore,
    extractedReliabilityScore,
    evidenceQuote,
    confidence,
    errorMessage,
    rawResultJson,
  } = opts;

  try {
    await query(
      `INSERT INTO publisher_enrichment_runs
         (publisher_id, domain, provider, search_query, candidate_url, status,
          extracted_rating_label, extracted_bias_score, extracted_veracity_score,
          extracted_reliability_score, evidence_quote, confidence, error_message,
          raw_result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publisherId,
        domain || null,
        provider,
        searchQuery || null,
        candidateUrl || null,
        status || "found",
        extractedRatingLabel || null,
        extractedBiasScore ?? null,
        extractedVeracityScore ?? null,
        extractedReliabilityScore ?? null,
        (evidenceQuote || "").slice(0, 500) || null,
        confidence || "unknown",
        errorMessage || null,
        rawResultJson ? JSON.stringify(rawResultJson).slice(0, 65000) : null,
      ]
    );
  } catch (err) {
    logger.warn("[enrichment] Failed to write enrichment_run log:", err.message);
  }
}

async function insertPublisherRating(query, opts) {
  const {
    publisherId,
    source,
    ratingType,
    ratingLabel,
    biasScore,
    veracityScore,
    score,
    candidateUrl,
    notes,
    confidence,
    extractionMethod,
    evidenceQuote,
    rawPayload,
  } = opts;

  await query(
    `INSERT INTO publisher_ratings
       (publisher_id, source, rating_label, rating_type,
        bias_score, veracity_score, score, url, last_checked,
        notes, confidence, extraction_method, evidence_quote,
        raw_provider_payload, user_id, topic_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      publisherId,
      source,
      ratingLabel || null,
      ratingType || "unknown",
      biasScore ?? null,
      veracityScore ?? null,
      score ?? null,
      candidateUrl || null,
      (notes || "").slice(0, 255) || null,
      confidence || "unknown",
      extractionMethod || "llm_extraction",
      (evidenceQuote || "").slice(0, 500) || null,
      rawPayload ? JSON.stringify(rawPayload).slice(0, 65000) : null,
    ]
  );
}

async function upsertPublisherProfile(query, opts) {
  const {
    publisherId,
    source,
    profileUrl,
    description,
    ownershipNotes,
    fundingNotes,
    credibilityNotes,
    politicalNotes,
    sourceType,
    country,
    evidenceQuote,
    confidence,
    extractionMethod,
    rawPayload,
  } = opts;

  const existing = await query(
    `SELECT publisher_profile_id FROM publisher_profiles
     WHERE publisher_id = ? AND source = ? LIMIT 1`,
    [publisherId, source]
  );

  const payloadStr = rawPayload ? JSON.stringify(rawPayload).slice(0, 65000) : null;

  if (existing.length > 0) {
    await query(
      `UPDATE publisher_profiles SET
         profile_url = ?, description = ?, ownership_notes = ?,
         funding_notes = ?, credibility_notes = ?, political_notes = ?,
         source_type = ?, country = ?, evidence_quote = ?,
         confidence = ?, extraction_method = ?, last_checked = NOW(),
         raw_provider_payload = ?
       WHERE publisher_id = ? AND source = ?`,
      [
        profileUrl || null,
        description || null,
        ownershipNotes || null,
        fundingNotes || null,
        credibilityNotes || null,
        politicalNotes || null,
        sourceType || null,
        country || null,
        (evidenceQuote || "").slice(0, 500) || null,
        confidence || "unknown",
        extractionMethod || "llm_extraction",
        payloadStr,
        publisherId,
        source,
      ]
    );
  } else {
    await query(
      `INSERT INTO publisher_profiles
         (publisher_id, source, profile_url, description, ownership_notes,
          funding_notes, credibility_notes, political_notes, source_type,
          country, evidence_quote, confidence, extraction_method,
          last_checked, raw_provider_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        publisherId,
        source,
        profileUrl || null,
        description || null,
        ownershipNotes || null,
        fundingNotes || null,
        credibilityNotes || null,
        politicalNotes || null,
        sourceType || null,
        country || null,
        (evidenceQuote || "").slice(0, 500) || null,
        confidence || "unknown",
        extractionMethod || "llm_extraction",
        payloadStr,
      ]
    );
  }
}

// ────────────────────────────────────────────────────────────
// Provider: AllSides
// ────────────────────────────────────────────────────────────

async function runAllSides(query, { publisherId, publisherName, domain }) {
  const provider = "AllSides";
  const searchQuery = `"${publisherName}" AllSides Media Bias Rating`;

  logger.log(`[enrichment] AllSides search for: ${publisherName}`);

  let results = [];
  try {
    results = await Promise.race([
      tavilySearch.web({ query: searchQuery, topK: 5, prefer: ["allsides.com"] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SEARCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "error", errorMessage: err.message });
    return { status: "error" };
  }

  const candidate = pickCandidate(results, publisherName, domain, "allsides.com");
  if (!candidate) {
    await logEnrichmentRun(query, {
      publisherId, domain, provider, searchQuery, status: "not_found",
      rawResultJson: results.slice(0, 5).map((r) => ({ url: r.url, title: r.title })),
    });
    return { status: "not_found" };
  }

  let pageText = candidate.snippet || "";
  let extractionMethod = "tavily_search";
  try {
    pageText = await fetchPageText(candidate.url);
    extractionMethod = "llm_extraction";
  } catch (err) {
    logger.warn(`[enrichment] AllSides fetch failed (${candidate.url}):`, err.message);
  }

  if (pageText.length < 50) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "not_found", errorMessage: "no usable text" });
    return { status: "not_found" };
  }

  let extracted;
  try {
    extracted = await openAiLLM.generate({
      system:
        "You extract source ratings from page text. Extract ONLY information explicitly present in the text. Do not infer. Do not guess. If the rating is not clearly stated for the named publisher, return rating_label null and confidence low.",
      user:
        `Publisher name: ${publisherName}\nDomain: ${domain}\nPage URL: ${candidate.url}\n\n` +
        `Extract the AllSides media bias rating for this publisher from the page text below.\n` +
        `Allowed rating_label values: Left, Lean Left, Center, Lean Right, Right, Mixed, Not Rated\n\n` +
        `Page text:\n${pageText}`,
      schemaHint:
        '{"provider":"AllSides","publisher_name":string|null,"domain":string|null,' +
        '"rating_label":"Left"|"Lean Left"|"Center"|"Lean Right"|"Right"|"Mixed"|"Not Rated"|null,' +
        '"bias_score":number|null,"veracity_score":null,"reliability_score":null,' +
        '"evidence_quote":string|null,"confidence":"high"|"medium"|"low","notes":string|null}',
      temperature: 0,
    });
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "error", errorMessage: `LLM: ${err.message}` });
    return { status: "error" };
  }

  const ratingLabel = extracted?.rating_label || null;
  const confidence = extracted?.confidence || "low";

  if (!ratingLabel) {
    await logEnrichmentRun(query, {
      publisherId, domain, provider, searchQuery, candidateUrl: candidate.url,
      status: "ambiguous", confidence,
      rawResultJson: { extracted, snippet: candidate.snippet?.slice(0, 300) },
    });
    return { status: "ambiguous" };
  }

  const biasScore = Object.prototype.hasOwnProperty.call(ALLSIDES_SCORE, ratingLabel)
    ? ALLSIDES_SCORE[ratingLabel]
    : (extracted?.bias_score ?? null);

  const rawPayload = { extracted, candidateUrl: candidate.url, searchQuery };

  await insertPublisherRating(query, {
    publisherId, source: "AllSides", ratingType: "bias",
    ratingLabel, biasScore, veracityScore: null,
    score: biasScore, candidateUrl: candidate.url,
    notes: extracted?.notes || null,
    confidence, extractionMethod,
    evidenceQuote: extracted?.evidence_quote || null,
    rawPayload,
  });

  await logEnrichmentRun(query, {
    publisherId, domain, provider, searchQuery, candidateUrl: candidate.url,
    status: "found", extractedRatingLabel: ratingLabel,
    extractedBiasScore: biasScore,
    evidenceQuote: extracted?.evidence_quote || null,
    confidence, rawResultJson: rawPayload,
  });

  logger.log(`[enrichment] ✅ AllSides: ${publisherName} → ${ratingLabel} (${confidence})`);
  return { status: "found", ratingLabel, biasScore, confidence };
}

// ────────────────────────────────────────────────────────────
// Provider: Ad Fontes Media
// ────────────────────────────────────────────────────────────

async function runAdFontes(query, { publisherId, publisherName, domain }) {
  const provider = "Ad Fontes";
  const searchQuery = `"${publisherName}" site:adfontesmedia.com`;

  logger.log(`[enrichment] Ad Fontes search for: ${publisherName}`);

  let results = [];
  try {
    results = await Promise.race([
      tavilySearch.web({ query: searchQuery, topK: 5, prefer: ["adfontesmedia.com"] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SEARCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "error", errorMessage: err.message });
    return { status: "error" };
  }

  const candidate = pickCandidate(results, publisherName, domain, "adfontesmedia.com");
  if (!candidate) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "not_found" });
    return { status: "not_found" };
  }

  let pageText = candidate.snippet || "";
  let extractionMethod = "tavily_search";
  try {
    pageText = await fetchPageText(candidate.url);
    extractionMethod = "llm_extraction";
  } catch (err) {
    logger.warn(`[enrichment] Ad Fontes fetch failed (${candidate.url}):`, err.message);
  }

  if (pageText.length < 50) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "not_found" });
    return { status: "not_found" };
  }

  let extracted;
  try {
    extracted = await openAiLLM.generate({
      system:
        "Extract Ad Fontes media ratings from page text. Extract ONLY explicitly stated values. Do not infer or estimate numbers from vague descriptions. Return null if not clearly present for the named publisher.",
      user:
        `Publisher name: ${publisherName}\nDomain: ${domain}\nPage URL: ${candidate.url}\n\n` +
        `Extract the Ad Fontes rating for this publisher.\n` +
        `Ad Fontes may use numeric bias and reliability values. Extract numbers only if explicitly present.\n\n` +
        `Page text:\n${pageText}`,
      schemaHint:
        '{"provider":"Ad Fontes","publisher_name":string|null,"domain":string|null,' +
        '"rating_label":string|null,"bias_score":number|null,"veracity_score":null,' +
        '"reliability_score":number|null,"evidence_quote":string|null,' +
        '"confidence":"high"|"medium"|"low","notes":string|null}',
      temperature: 0,
    });
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "error", errorMessage: `LLM: ${err.message}` });
    return { status: "error" };
  }

  const ratingLabel = extracted?.rating_label || null;
  const biasScore = extracted?.bias_score ?? null;
  const reliabilityScore = extracted?.reliability_score ?? null;
  const confidence = extracted?.confidence || "low";

  if (!ratingLabel && biasScore === null && reliabilityScore === null) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "ambiguous", confidence });
    return { status: "ambiguous" };
  }

  const ratingType = reliabilityScore !== null ? "reliability" : biasScore !== null ? "bias" : "unknown";
  const score = reliabilityScore ?? biasScore ?? null;
  const rawPayload = { extracted, candidateUrl: candidate.url, searchQuery };

  await insertPublisherRating(query, {
    publisherId, source: "Ad Fontes", ratingType, ratingLabel,
    biasScore, veracityScore: reliabilityScore,
    score, candidateUrl: candidate.url,
    notes: extracted?.notes || null,
    confidence, extractionMethod,
    evidenceQuote: extracted?.evidence_quote || null,
    rawPayload,
  });

  await logEnrichmentRun(query, {
    publisherId, domain, provider, searchQuery, candidateUrl: candidate.url,
    status: "found", extractedRatingLabel: ratingLabel,
    extractedBiasScore: biasScore, extractedReliabilityScore: reliabilityScore,
    confidence, rawResultJson: rawPayload,
  });

  logger.log(`[enrichment] ✅ Ad Fontes: ${publisherName} → label=${ratingLabel} bias=${biasScore} reliability=${reliabilityScore} (${confidence})`);
  return { status: "found", ratingLabel, biasScore, reliabilityScore, confidence };
}

// ────────────────────────────────────────────────────────────
// Provider: Wikipedia
// ────────────────────────────────────────────────────────────

async function runWikipedia(query, { publisherId, publisherName, domain }) {
  const provider = "Wikipedia";
  const searchQuery = `"${publisherName}" Wikipedia publisher ownership`;

  logger.log(`[enrichment] Wikipedia search for: ${publisherName}`);

  let results = [];
  try {
    results = await Promise.race([
      tavilySearch.web({ query: searchQuery, topK: 5, prefer: ["wikipedia.org"] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SEARCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "error", errorMessage: err.message });
    return { status: "error" };
  }

  const candidate = pickCandidate(results, publisherName, domain, "wikipedia.org");
  if (!candidate) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "not_found" });
    return { status: "not_found" };
  }

  let pageText = candidate.snippet || "";
  let extractionMethod = "tavily_search";
  try {
    pageText = await fetchPageText(candidate.url);
    extractionMethod = "llm_extraction";
  } catch (err) {
    logger.warn(`[enrichment] Wikipedia fetch failed (${candidate.url}):`, err.message);
  }

  if (pageText.length < 50) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "not_found" });
    return { status: "not_found" };
  }

  let extracted;
  try {
    extracted = await openAiLLM.generate({
      system:
        "Extract source profile and credibility-relevant context from the page text. Extract ONLY explicitly stated facts. " +
        "Do not turn ordinary descriptions into accusations. Do not infer hidden agendas. " +
        "If the page states the organization was founded by, funded by, owned by, sponsored by, affiliated with, or " +
        "created for a purpose, extract that concisely. Look for: ownership, funding, sponsorship, advocacy, lobbying, " +
        "PR background, industry affiliation, state media status, religious affiliation, partisan affiliation, think tank affiliation.",
      user:
        `Publisher name: ${publisherName}\nDomain: ${domain}\nPage URL: ${candidate.url}\n\n` +
        `Extract source profile and credibility-relevant context from the page text below.\n\n` +
        `Page text:\n${pageText}`,
      schemaHint:
        '{"provider":"Wikipedia","publisher_name":string|null,"domain":string|null,' +
        '"description":string|null,"source_type":string|null,"country":string|null,' +
        '"ownership_notes":string|null,"funding_notes":string|null,' +
        '"credibility_notes":string|null,"political_notes":string|null,' +
        '"evidence_quote":string|null,"confidence":"high"|"medium"|"low","notes":string|null}',
      temperature: 0,
    });
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "error", errorMessage: `LLM: ${err.message}` });
    return { status: "error" };
  }

  const confidence = extracted?.confidence || "low";
  const hasContent = extracted?.description || extracted?.ownership_notes || extracted?.funding_notes || extracted?.credibility_notes;

  if (!hasContent) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "ambiguous", confidence });
    return { status: "ambiguous" };
  }

  const rawPayload = { extracted, candidateUrl: candidate.url, searchQuery };

  await upsertPublisherProfile(query, {
    publisherId, source: "Wikipedia",
    profileUrl: candidate.url,
    description: extracted?.description || null,
    ownershipNotes: extracted?.ownership_notes || null,
    fundingNotes: extracted?.funding_notes || null,
    credibilityNotes: extracted?.credibility_notes || null,
    politicalNotes: extracted?.political_notes || null,
    sourceType: extracted?.source_type || null,
    country: extracted?.country || null,
    evidenceQuote: extracted?.evidence_quote || null,
    confidence, extractionMethod, rawPayload,
  });

  await logEnrichmentRun(query, {
    publisherId, domain, provider, searchQuery, candidateUrl: candidate.url,
    status: "found", confidence, rawResultJson: rawPayload,
  });

  logger.log(`[enrichment] ✅ Wikipedia profile stored for ${publisherName} (${confidence})`);
  return { status: "found", confidence };
}

// ────────────────────────────────────────────────────────────
// Main exported function
// ────────────────────────────────────────────────────────────

/**
 * enrichPublisherIfNeeded
 *
 * Checks recency, then runs stale providers (AllSides, Ad Fontes, Wikipedia).
 * Safe to call fire-and-forget — never throws.
 *
 * @param {object} opts
 * @param {Function} opts.query        - Promisified DB query function
 * @param {number}  [opts.publisherId] - Resolved publisher_id (looked up by name/domain if absent)
 * @param {string}  [opts.publisherName]
 * @param {string}  [opts.sourceUrl]  - Original article URL (used to derive domain)
 * @param {string}  [opts.domain]     - Pre-normalized domain (optional, derived from sourceUrl)
 * @param {boolean} [opts.force]      - Skip freshness check and re-enrich all providers
 * @param {string}  [opts.context]    - 'case_content' (default) | 'reference_source' (future)
 */
export async function enrichPublisherIfNeeded({
  query,
  publisherId,
  publisherName,
  sourceUrl,
  domain: providedDomain,
  force = false,
  context = "case_content",
}) {
  try {
    if (!tavilySearch) {
      logger.warn("[enrichment] TAVILY_API_KEY not set — skipping publisher enrichment");
      return { status: "skipped", reason: "tavily_not_configured" };
    }

    // 1. Normalize domain
    const domain = providedDomain || normalizeDomain(sourceUrl) || null;

    // 2. Resolve publisherId from name or domain if not supplied
    let resolvedId = publisherId || null;

    if (!resolvedId && publisherName) {
      const rows = await query(
        `SELECT publisher_id FROM publishers WHERE publisher_name = ? LIMIT 1`,
        [publisherName]
      );
      resolvedId = rows[0]?.publisher_id || null;
    }

    if (!resolvedId && domain) {
      const rows = await query(
        `SELECT publisher_id FROM publishers WHERE domain = ? LIMIT 1`,
        [domain]
      );
      resolvedId = rows[0]?.publisher_id || null;
    }

    if (!resolvedId) {
      logger.warn(
        `[enrichment] No publisher found for name="${publisherName}" domain="${domain}" — skipping`
      );
      return { status: "skipped", reason: "publisher_not_found" };
    }

    const label = publisherName || `publisher_${resolvedId}`;
    logger.log(`[enrichment] Starting for "${label}" id=${resolvedId} domain=${domain} context=${context}`);

    // 3. Per-provider freshness checks (parallelized)
    const [allSidesStale, adFontesStale, wikiStale] = await Promise.all([
      force ? true : isStaleRating(query, resolvedId, "AllSides"),
      force ? true : isStaleRating(query, resolvedId, "Ad Fontes"),
      force ? true : isStaleProfile(query, resolvedId, "Wikipedia"),
    ]);

    if (!allSidesStale && !adFontesStale && !wikiStale) {
      logger.log(`[enrichment] All providers fresh for "${label}" — skipping`);
      return { status: "skipped", reason: "all_fresh" };
    }

    logger.log(
      `[enrichment] Stale providers — AllSides:${allSidesStale} AdFontes:${adFontesStale} Wikipedia:${wikiStale}`
    );

    // 4. Collect stale tasks
    const tasks = [];
    const ctx = { publisherId: resolvedId, publisherName: label, domain };

    if (allSidesStale) tasks.push({ name: "AllSides", fn: () => runAllSides(query, ctx) });
    if (adFontesStale) tasks.push({ name: "Ad Fontes", fn: () => runAdFontes(query, ctx) });
    if (wikiStale)     tasks.push({ name: "Wikipedia", fn: () => runWikipedia(query, ctx) });

    // 5. Run with concurrency limit of 2 (rate-limit friendly)
    const results = {};
    for (let i = 0; i < tasks.length; i += 2) {
      const batch = tasks.slice(i, i + 2);
      const settled = await Promise.allSettled(batch.map((t) => t.fn()));
      batch.forEach((t, idx) => {
        const s = settled[idx];
        if (s.status === "fulfilled") {
          results[t.name] = s.value;
        } else {
          results[t.name] = { status: "error" };
          logger.error(`[enrichment] ${t.name} threw unexpectedly:`, s.reason?.message);
        }
      });
    }

    const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]));
    logger.log(`[enrichment] Done for "${label}":`, summary);
    return { status: "done", publisherId: resolvedId, results };

  } catch (err) {
    // Never propagate — callers treat enrichment as best-effort
    logger.error("[enrichment] Unexpected top-level error:", err.message);
    return { status: "error", error: err.message };
  }
}

// TODO: When wiring reference-publisher enrichment, call with context: 'reference_source'
// and guard it behind enrichReferencePublishers = false by default.
