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

// Realistic browser UA — avoids 403 from media-bias sites that block simple bots
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchPageText(url) {
  if (!isSafeUrl(url)) throw new Error(`SSRF blocked: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
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

function normalizeNameForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|of|for|media|news|newspaper|press|free|online|official|website|wikipedia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantNameTokens(value) {
  return normalizeNameForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function looksLikeSamePublisher(candidate, publisherName, domain) {
  const title = normalizeNameForMatch(candidate?.title);
  const snippet = normalizeNameForMatch(candidate?.snippet);
  const url = String(candidate?.url || "").toLowerCase();
  const name = normalizeNameForMatch(publisherName);
  const tokens = significantNameTokens(publisherName);
  const domainHost = domain
    ? String(domain).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase()
    : null;

  if (!name || !candidate?.url) return false;
  if (title.includes(name) || name.includes(title)) return true;
  if (domainHost && url.includes(domainHost)) return true;

  const matchedTitleTokens = tokens.filter((token) => title.includes(token)).length;
  const matchedSnippetTokens = tokens.filter((token) => snippet.includes(token)).length;
  const required = Math.min(tokens.length, tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.75));
  return tokens.length > 0 && (matchedTitleTokens >= required || (matchedTitleTokens >= 2 && matchedSnippetTokens >= required));
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

  const params = [
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
  ];

  await query(
    `INSERT INTO publisher_ratings
       (publisher_id, source, rating_label, rating_type,
        bias_score, veracity_score, score, url, last_checked,
        notes, confidence, extraction_method, evidence_quote,
        raw_provider_payload, user_id, topic_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       rating_label       = VALUES(rating_label),
       bias_score         = VALUES(bias_score),
       veracity_score     = VALUES(veracity_score),
       score              = VALUES(score),
       url                = VALUES(url),
       last_checked       = NOW(),
       notes              = VALUES(notes),
       confidence         = VALUES(confidence),
       extraction_method  = VALUES(extraction_method),
       evidence_quote     = VALUES(evidence_quote),
       raw_provider_payload = VALUES(raw_provider_payload)`,
    params
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
  // Target publisher profile pages specifically; allsides.com/news-source/ is where bias ratings live
  const searchQuery = `${publisherName} site:allsides.com/news-source media bias rating`;

  logger.log(`[enrichment] AllSides search for: ${publisherName}`);

  let results = [];
  try {
    results = await Promise.race([
      tavilySearch.web({ query: searchQuery, topK: 8, prefer: ["allsides.com"], includeRawContent: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SEARCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, status: "error", errorMessage: err.message });
    return { status: "error" };
  }

  // Filter out story pages — they mention bias ratings but are not publisher profiles.
  // allsides.com/news-source/... pages contain the canonical bias label for a publisher.
  const profileResults = results.filter(r =>
    r.url?.includes("allsides.com") &&
    !r.url?.includes("/story/") &&
    !r.url?.includes("/blog/") &&
    !r.url?.includes("/news/")
  );

  // Use the best matching candidate from profile pages; fall back to all allsides results.
  const candidate = pickCandidate(profileResults.length ? profileResults : results, publisherName, domain, "allsides.com");
  if (!candidate) {
    await logEnrichmentRun(query, {
      publisherId, domain, provider, searchQuery, status: "not_found",
      rawResultJson: results.slice(0, 5).map((r) => ({ url: r.url, title: r.title })),
    });
    return { status: "not_found" };
  }

  // Strategy: combine raw_content + all snippets from allsides.com results.
  // allsides.com consistently 403s direct fetches; Tavily's infra can fetch them.
  // Never attempt a direct HTTP fetch to allsides.com.
  const allSnippets = results
    .filter(r => r.url?.includes("allsides.com"))
    .map(r => `[${r.title}]\n${r.rawContent || r.snippet || ""}`)
    .join("\n\n---\n\n");

  const pageText = allSnippets.trim();
  const extractionMethod = candidate.rawContent ? "llm_extraction" : "tavily_search";

  if (pageText.length < 50) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "not_found", errorMessage: "no usable text from snippets" });
    return { status: "not_found" };
  }

  let extracted;
  try {
    extracted = await openAiLLM.generate({
      system:
        "You extract source ratings from page text. Extract ONLY information explicitly present in the text. Do not infer. Do not guess. If the rating is not clearly stated for the named publisher, return rating_label null and confidence low.",
      user:
        `Publisher name: ${publisherName}\nDomain: ${domain}\nSource: allsides.com\n\n` +
        `Extract the AllSides media bias rating for this publisher from the search results below.\n` +
        `Allowed rating_label values: Left, Lean Left, Center, Lean Right, Right, Mixed, Not Rated\n` +
        `If AllSides does not have a rating for this publisher, return rating_label null.\n\n` +
        `Search results:\n${pageText}`,
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
  const searchQuery = `${publisherName} site:adfontesmedia.com bias reliability score`;

  logger.log(`[enrichment] Ad Fontes search for: ${publisherName}`);

  let results = [];
  try {
    results = await Promise.race([
      tavilySearch.web({ query: searchQuery, topK: 8, prefer: ["adfontesmedia.com"], includeRawContent: true }),
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

  // Combine raw_content + all adfontesmedia snippets — avoid direct fetch (403-prone).
  const allSnippets = results
    .filter(r => r.url?.includes("adfontesmedia.com"))
    .map(r => `[${r.title}]\n${r.rawContent || r.snippet || ""}`)
    .join("\n\n---\n\n");

  const pageText = allSnippets.trim();
  const extractionMethod = candidate.rawContent ? "llm_extraction" : "tavily_search";

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
        `Publisher name: ${publisherName}\nDomain: ${domain}\nSource: adfontesmedia.com\n\n` +
        `Extract the Ad Fontes rating for this publisher from the search results below.\n` +
        `Ad Fontes uses numeric bias scores (negative=left, positive=right) and reliability scores (0-64 scale).\n` +
        `Extract numbers only if explicitly present. If Ad Fontes has no rating for this publisher, return null.\n\n` +
        `Search results:\n${pageText}`,
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

  const wikiResults = results.filter((result) => looksLikeSamePublisher(result, publisherName, domain));
  const candidate = pickCandidate(wikiResults, publisherName, domain, "wikipedia.org");
  if (!candidate) {
    await logEnrichmentRun(query, {
      publisherId,
      domain,
      provider,
      searchQuery,
      status: "not_found",
      errorMessage: "no Wikipedia result matched publisher identity",
      rawResultJson: results.slice(0, 5).map((r) => ({ title: r.title, url: r.url })),
    });
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
        "PR background, industry affiliation, state media status, religious affiliation, partisan affiliation, think tank affiliation. " +
        "Also set reliability_score (0-100) based on what Wikipedia says or implies about the source's credibility: " +
        "90+ = authoritative primary source (government body, top university, official record); " +
        "70-89 = generally reliable — includes established journalism/media, academic institutions, recognized fact-checkers, sources described as award-winning, trusted, well-regarded, or having strong reputation; " +
        "50-69 = mixed or context-dependent — advocacy orgs, think tanks, partisan outlets, nonprofits without strong credibility signals; " +
        "30-49 = questionable — disputed claims, contradicts mainstream scientific consensus, industry-funded on contested topics; " +
        "0-29 = unreliable — state propaganda, known disinformation, junk science. " +
        "If Wikipedia mentions awards, recognition, independent status, or reputation for accuracy, score 70-82. Only set null if the page has no credibility signals at all.",
      user:
        `Publisher name: ${publisherName}\nDomain: ${domain}\nPage URL: ${candidate.url}\n\n` +
        `Extract source profile and credibility-relevant context from the page text below.\n\n` +
        `Page text:\n${pageText}`,
      schemaHint:
        '{"provider":"Wikipedia","publisher_name":string|null,"domain":string|null,' +
        '"description":string|null,' +
        '"source_type":"primary"|"government"|"academic"|"journalism"|"reference"|"advocacy"|"corporate"|"opinion"|"social"|"unknown"|null,' +
        '"country":string|null,' +
        '"ownership_notes":string|null,"funding_notes":string|null,' +
        '"credibility_notes":string|null,"political_notes":string|null,' +
        '"reliability_score":number|null,' +
        '"evidence_quote":string|null,"confidence":"high"|"medium"|"low","notes":string|null}',
      // reliability_score: 0-100 estimate of source reliability based on what Wikipedia says about this publisher.
      temperature: 0,
    });
  } catch (err) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery, candidateUrl: candidate.url, status: "error", errorMessage: `LLM: ${err.message}` });
    return { status: "error" };
  }

  const confidence = extracted?.confidence || "low";
  const hasContent = extracted?.description || extracted?.ownership_notes || extracted?.funding_notes || extracted?.credibility_notes;
  const extractedIdentity = {
    title: extracted?.publisher_name || candidate.title,
    snippet: `${extracted?.description || ""} ${extracted?.evidence_quote || ""}`,
    url: candidate.url,
  };

  if (!hasContent || confidence === "low" || !looksLikeSamePublisher(extractedIdentity, publisherName, domain)) {
    await logEnrichmentRun(query, {
      publisherId,
      domain,
      provider,
      searchQuery,
      candidateUrl: candidate.url,
      status: "ambiguous",
      confidence,
      errorMessage: !hasContent
        ? "no usable Wikipedia profile content"
        : confidence === "low"
          ? "low-confidence Wikipedia extraction"
          : "extracted Wikipedia entity did not match publisher identity",
      rawResultJson: { extracted, candidateTitle: candidate.title, candidateUrl: candidate.url },
    });
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

  // LLM-extracted score takes precedence; fall back to pattern derivation.
  const llmScore = (typeof extracted?.reliability_score === "number" && extracted.reliability_score >= 0 && extracted.reliability_score <= 100)
    ? Math.round(extracted.reliability_score)
    : null;
  const autoScore = llmScore ?? deriveScoreFromProfile({
    credibility_notes: extracted?.credibility_notes,
    source_type: extracted?.source_type,
  });

  if (autoScore !== null) {
    try {
      await query(
        `INSERT INTO publisher_ratings
           (publisher_id, source, rating_type, veracity_score, notes, last_checked)
         VALUES (?, 'Wikipedia', 'veracity', ?, 'Auto-scored from Wikipedia credibility notes', NOW())
         ON DUPLICATE KEY UPDATE
           veracity_score = VALUES(veracity_score),
           last_checked = NOW()`,
        [publisherId, autoScore]
      );
      logger.log(`[enrichment] 📊 Reliability score ${autoScore} (${llmScore !== null ? "LLM" : "pattern"}) written for ${publisherName} from Wikipedia`);
    } catch (e) {
      logger.warn(`[enrichment] Could not write auto-reliability score:`, e.message);
    }
  }

  await logEnrichmentRun(query, {
    publisherId, domain, provider, searchQuery, candidateUrl: candidate.url,
    status: "found", confidence, rawResultJson: rawPayload,
  });

  logger.log(`[enrichment] ✅ Wikipedia profile stored for ${publisherName} (${confidence})`);
  return { status: "found", confidence };
}

// ────────────────────────────────────────────────────────────
// Provider: SCImago Journal Rankings
// ────────────────────────────────────────────────────────────

// SCImago quartile → veracity_score mapping.
// Q1 = top 25% by citation impact → high reliability for academic content.
// Q4 = bottom 25% → still peer-reviewed but weaker citation standing.
const SJR_QUARTILE_SCORE = { Q1: 88, Q2: 72, Q3: 55, Q4: 40 };
const SCIMAGO_API = "https://www.scimagojr.com/journalsearch.php";

async function runSCImago(query, { publisherId, publisherName, domain }) {
  const provider = "SCImago";

  logger.log(`[enrichment] SCImago search for: ${publisherName}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let journals = [];
  try {
    const apiUrl = `${SCIMAGO_API}?q=${encodeURIComponent(publisherName)}&tip=jrn&out=json`;
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/javascript, */*",
        "Referer": "https://www.scimagojr.com/",
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      // 404/no-results from SCImago for non-journal publishers is expected — not a hard error
      clearTimeout(timer);
      await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery: publisherName, status: "not_found", errorMessage: `HTTP ${resp.status}` });
      return { status: "not_found" };
    }
    const text = await resp.text();
    try {
      journals = JSON.parse(text);
    } catch {
      // SCImago returns HTML for some queries (e.g. non-journal publishers) — treat as not_found
      clearTimeout(timer);
      await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery: publisherName, status: "not_found", errorMessage: "non-JSON response" });
      return { status: "not_found" };
    }
  } catch (err) {
    clearTimeout(timer);
    await logEnrichmentRun(query, {
      publisherId, domain, provider, searchQuery: publisherName,
      status: "error", errorMessage: err.message,
    });
    return { status: "error" };
  }

  if (!Array.isArray(journals) || journals.length === 0) {
    await logEnrichmentRun(query, { publisherId, domain, provider, searchQuery: publisherName, status: "not_found" });
    return { status: "not_found" };
  }

  // Pick best title match — exact first, then substring, then first result
  const lowerName = publisherName.toLowerCase();
  const best =
    journals.find(j => (j.title ?? "").toLowerCase() === lowerName) ??
    journals.find(j => (j.title ?? "").toLowerCase().includes(lowerName)) ??
    journals.find(j => lowerName.includes((j.title ?? "").toLowerCase())) ??
    journals[0];

  const quartile   = best.sjr_best_quartile ?? null;       // "Q1"–"Q4" or "-"
  const validQ     = /^Q[1-4]$/.test(quartile) ? quartile : null;
  const sjrScore   = best.sjr?.[0]?.value   ?? null;       // most-recent SJR value string
  const hIndex     = best.h_index           ?? null;
  const country    = best.country           ?? null;
  const issn       = Array.isArray(best.issn) ? best.issn.join(", ") : (best.issn ?? null);
  const areas      = (best.areas ?? []).map(a => a.name ?? a).filter(Boolean).join(", ");
  const categories = (best.categories ?? []).slice(0, 3).map(c => c.name ?? c).filter(Boolean).join(", ");

  const veracityScore = validQ ? SJR_QUARTILE_SCORE[validQ] : null;
  const ratingLabel   = validQ ?? (sjrScore ? `SJR ${sjrScore}` : null);
  const confidence    = (best.title ?? "").toLowerCase() === lowerName ? "high" : "medium";

  const profileUrl = `${SCIMAGO_API}?q=${encodeURIComponent(publisherName)}&tip=jrn`;
  const noteParts  = [
    validQ     && `Quartile: ${validQ}`,
    sjrScore   && `SJR: ${sjrScore}`,
    hIndex     && `H-index: ${hIndex}`,
    areas      && `Areas: ${areas}`,
    issn       && `ISSN: ${issn}`,
  ].filter(Boolean);

  const rawPayload = { best, quartile, sjrScore, hIndex, areas, categories, issn, country };

  // Write rating (only if we have useful data)
  if (veracityScore !== null || sjrScore !== null) {
    await insertPublisherRating(query, {
      publisherId,
      source: "SCImago",
      ratingType: "academic_impact",
      ratingLabel,
      biasScore: null,
      veracityScore,
      score: sjrScore ? parseFloat(sjrScore) : null,
      candidateUrl: profileUrl,
      notes: noteParts.join(" | ") || null,
      confidence,
      extractionMethod: "api",
      evidenceQuote: `${best.title ?? publisherName} — ${validQ ?? "no quartile"}, SJR ${sjrScore ?? "N/A"}, H-index ${hIndex ?? "N/A"}`,
      rawPayload,
    });
  }

  // Upsert profile: mark source_type = academic, add subject areas + country
  await upsertPublisherProfile(query, {
    publisherId,
    source: "SCImago",
    profileUrl,
    description: areas ? `Academic journal. Subject areas: ${areas}` : "Academic/scientific journal indexed in Scopus.",
    sourceType: "academic",
    country,
    credibilityNotes: validQ
      ? `${validQ} journal in Scopus/SCImago — ${
          validQ === "Q1" ? "top-tier citation impact" :
          validQ === "Q2" ? "above-average citation impact" :
          validQ === "Q3" ? "average citation impact" :
                           "below-average citation impact"
        }. ${categories ? `Categories: ${categories}.` : ""}`
      : `Indexed in Scopus/SCImago. ${areas ? `Areas: ${areas}.` : ""}`,
    confidence,
    extractionMethod: "api",
    rawPayload,
  });

  await logEnrichmentRun(query, {
    publisherId, domain, provider, searchQuery: publisherName,
    candidateUrl: profileUrl,
    status: veracityScore !== null ? "found" : "ambiguous",
    extractedVeracityScore: veracityScore,
    extractedRatingLabel: ratingLabel,
    confidence,
    rawResultJson: rawPayload,
  });

  logger.log(`[enrichment] ✅ SCImago: ${publisherName} → ${validQ ?? "no quartile"} SJR=${sjrScore} H=${hIndex} (${confidence})`);
  return { status: veracityScore !== null ? "found" : "ambiguous", quartile: validQ, sjrScore, hIndex, areas, veracityScore, confidence };
}

// ────────────────────────────────────────────────────────────
// Shared scoring logic (used by runWikipedia + backfill)
// ────────────────────────────────────────────────────────────

function deriveScoreFromProfile({ credibility_notes, source_type }) {
  const credNotes = (credibility_notes ?? "").toLowerCase();
  const srcType   = (source_type ?? "").toLowerCase();

  // Credibility notes — red flags first (explicit)
  if (/predatory|beall'?s list|disinformation|misinformation|fake news|state.controlled|state media|propaganda outlet/.test(credNotes)) return 20;
  if (/retract|retraction|debunked|scientific misconduct|peer.review concern|lack.{0,30}rigor/.test(credNotes)) return 38;
  if (/contradict|disputed by|rejected by|contradicts.{0,60}(institute|agency|consensus|mainstream)/.test(credNotes)) return 40;
  if (/partisan|advocacy|lobbying|industry.funded|funded by.{0,40}(industry|corporation|lobby)/.test(credNotes)) return 50;

  // Credibility notes — positive reputation signals
  if (/pulitzer|peabody|award.winning|won.{0,20}award|received.{0,20}award|multiple award|numerous award/.test(credNotes)) return 78;
  if (/widely.{0,20}trusted|well.?regarded|highly.{0,20}regarded|well.?respected|highly.{0,20}respected|high.{0,20}reputation/.test(credNotes)) return 74;
  if (/recognized.{0,40}(accuracy|reliability|journalism|contribution)|known for.{0,40}(accuracy|fact|reliability)/.test(credNotes)) return 74;
  if (/independent.{0,30}fact.?check|nonpartisan.{0,30}fact.?check/.test(credNotes)) return 76;
  if (/contributions? to.{0,30}(journalism|fact.?check|public.{0,10}discourse)/.test(credNotes)) return 72;
  if (/\bestablished\b.{0,30}(news|media|journal|outlet)|long.standing.{0,20}(news|media|reputation)/.test(credNotes)) return 70;

  // Source type
  if (/\b(fact.?check|fact.?finder)\b/.test(srcType)) return 74;
  if (/\b(intergovernmental|supranational|united nations|european union|eu institution|parliament)\b/.test(srcType)) return 76;
  if (/\b(government|governmental|federal|national agency|public authority)\b/.test(srcType)) return 73;
  if (/\b(academic|university|research institute|scientific institute|research service|research department)\b/.test(srcType)) return 70;
  if (/\b(peer.reviewed|scientific journal|scholarly)\b/.test(srcType)) return 72;
  if (/\b(think.?tank|policy institute|policy research)\b/.test(srcType)) return 64;
  if (/\b(advocacy|activist|campaign|pressure group|interest group)\b/.test(srcType)) return 50;
  if (/\b(nonprofit|ngo|charity|foundation)\b/.test(srcType)) return 58;
  if (/\b(trade association|industry group|lobby)\b/.test(srcType)) return 44;

  return null;
}

/**
 * backfillMissingScores
 *
 * Reads all Wikipedia profiles in publisher_profiles that have no veracity score
 * in publisher_ratings and derives one from the stored credibility_notes / source_type.
 * Called at server startup — no API calls, purely DB reads + writes.
 */
export async function backfillMissingScores(query) {
  try {
    const profiles = await query(
      `SELECT pp.publisher_id, pp.credibility_notes, pp.source_type, p.publisher_name
       FROM publisher_profiles pp
       JOIN publishers p ON pp.publisher_id = p.publisher_id
       WHERE pp.source = 'Wikipedia'
         AND pp.publisher_id NOT IN (
           SELECT DISTINCT publisher_id FROM publisher_ratings
           WHERE source = 'Wikipedia' AND rating_type = 'veracity' AND veracity_score IS NOT NULL
         )`
    );

    if (profiles.length === 0) return;

    // Pre-filter to only publishers we can actually score — avoids noisy startup logs
    const scoreable = profiles.filter(p => deriveScoreFromProfile(p) !== null);
    if (scoreable.length === 0) return;
    logger.log(`[enrichment] 🔄 Backfilling scores for ${scoreable.length} publisher(s) with Wikipedia profiles but no score`);

    for (const p of scoreable) {
      const score = deriveScoreFromProfile(p);
      if (score === null) continue;
      try {
        await query(
          `INSERT INTO publisher_ratings
             (publisher_id, source, rating_type, veracity_score, notes, last_checked)
           VALUES (?, 'Wikipedia', 'veracity', ?, 'Auto-scored from stored Wikipedia profile', NOW())
           ON DUPLICATE KEY UPDATE
             veracity_score = IF(veracity_score IS NULL, VALUES(veracity_score), veracity_score),
             last_checked = NOW()`,
          [p.publisher_id, score]
        );
        logger.log(`[enrichment] 📊 Backfilled score ${score} for "${p.publisher_name}" (id=${p.publisher_id})`);
      } catch (e) {
        logger.warn(`[enrichment] Backfill failed for publisher ${p.publisher_id}:`, e.message);
      }
    }
  } catch (err) {
    logger.warn("[enrichment] backfillMissingScores error:", err.message);
  }
}

// ────────────────────────────────────────────────────────────
// Main exported function
// ────────────────────────────────────────────────────────────

/**
 * reEvaluateAdmiraltyForPublisher
 *
 * Re-evaluates and stores the Admiralty code for all content linked to a publisher,
 * using the latest ratings and source_type from the DB.
 * Called automatically at the end of enrichPublisherIfNeeded so ratings always
 * drive the Admiralty code. Never throws.
 */
async function reEvaluateAdmiraltyForPublisher(query, resolvedId, label) {
  try {
    const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../services/admiraltyEvaluator.js");

    const [profile] = await query(
      `SELECT source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`,
      [resolvedId]
    );
    const dbSourceType = profile?.source_type || null;

    const existingSourceRatings = await query(
      `SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence
         FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL
         ORDER BY last_checked DESC`,
      [resolvedId]
    );

    // Reconstruct normalized provider signals from stored rating labels so that
    // MBFC/AdFontes labels still influence the letter without a live re-lookup.
    const providerResults = existingSourceRatings.map(r => {
      const src   = (r.source ?? "").toLowerCase();
      const lbl   = (r.rating_label ?? "").toLowerCase();
      const reliability =
        lbl.includes("high") || lbl.includes("very reliable")                           ? "high"  :
        lbl.includes("low")  || lbl.includes("unreliable") || lbl.includes("questionable") ? "low"   :
        lbl.includes("mixed") || lbl.includes("mostly reliable")                        ? "medium" : null;
      return {
        providerName: src.includes("mbfc") || src.includes("media bias") ? "mbfc"
                    : src.includes("ad fontes") || src.includes("adfont") ? "adfontes"
                    : src.includes("allsides") ? "allsides"
                    : src.includes("wikipedia") ? "wikipedia"
                    : src,
        matchFound: true,
        normalized: { reliability },
      };
    });

    const contentRows = await query(
      `SELECT cp.content_id, c.url FROM content_publishers cp
         JOIN content c ON cp.content_id = c.content_id
        WHERE cp.publisher_id = ?`,
      [resolvedId]
    );

    // Evaluate once at publisher level using the publisher's own URL as a representative source
    const pubEvaluation = await evaluateAdmiraltyCode({
      sourceUrl: contentRows[0]?.url,
      publisherName: label,
      sourceIdentity: { sourceType: dbSourceType || undefined, resolutionLevel: 3 },
      existingSourceRatings,
      providerResults,
    });
    await storeEvaluation(query, {
      targetType: "publisher",
      targetId:   resolvedId,
      sourceUrl:  contentRows[0]?.url,
      publisherId: resolvedId,
      evaluation: pubEvaluation,
    });

    if (!contentRows?.length) return {};

    // Evaluate and store for all linked content; return map of content_id → admiralty_code
    const updatedCodes = {};
    for (const { content_id, url } of contentRows) {
      const evaluation = await evaluateAdmiraltyCode({
        sourceUrl: url,
        publisherName: label,
        sourceIdentity: { sourceType: dbSourceType || undefined, resolutionLevel: 3 },
        existingSourceRatings,
        providerResults,
      });
      await storeEvaluation(query, {
        targetType: "content",
        targetId:   content_id,
        sourceUrl:  url,
        publisherId: resolvedId,
        evaluation,
      });
      updatedCodes[content_id] = evaluation.admiraltyCode;
    }
    logger.log(`🛡 [enrichment] Admiralty re-evaluated for publisher "${label}" (id=${resolvedId}) + ${contentRows.length} linked content(s), code=${pubEvaluation.admiraltyCode}`);
    return updatedCodes;
  } catch (err) {
    logger.warn(`⚠️ [enrichment] Admiralty re-evaluation skipped for publisher ${resolvedId}: ${err.message}`);
    return {};
  }
}

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

    // 1. Normalize domain — reject localhost/private origins (dev-server URLs must not corrupt enrichment)
    const rawDomain = providedDomain || normalizeDomain(sourceUrl) || null;
    const domain = (rawDomain && rawDomain !== "localhost" && !rawDomain.startsWith("127.") && !rawDomain.startsWith("192.168.")) ? rawDomain : null;

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
    const [allSidesStale, adFontesStale, wikiStale, scimagoStale] = await Promise.all([
      force ? true : isStaleRating(query, resolvedId, "AllSides"),
      force ? true : isStaleRating(query, resolvedId, "Ad Fontes"),
      force ? true : isStaleProfile(query, resolvedId, "Wikipedia"),
      force ? true : isStaleRating(query, resolvedId, "SCImago"),
    ]);

    if (!allSidesStale && !adFontesStale && !wikiStale && !scimagoStale) {
      logger.log(`[enrichment] All providers fresh for "${label}" — re-evaluating Admiralty only`);
      const admiraltyUpdates = await reEvaluateAdmiraltyForPublisher(query, resolvedId, label);
      return { status: "skipped", reason: "all_fresh", admiraltyUpdates };
    }

    logger.log(
      `[enrichment] Stale providers — AllSides:${allSidesStale} AdFontes:${adFontesStale} Wikipedia:${wikiStale} SCImago:${scimagoStale}`
    );

    // 4. Collect stale tasks
    const tasks = [];
    const ctx = { publisherId: resolvedId, publisherName: label, domain };

    if (allSidesStale)  tasks.push({ name: "AllSides",  fn: () => runAllSides(query, ctx) });
    if (adFontesStale)  tasks.push({ name: "Ad Fontes", fn: () => runAdFontes(query, ctx) });
    if (wikiStale)      tasks.push({ name: "Wikipedia", fn: () => runWikipedia(query, ctx) });
    if (scimagoStale)   tasks.push({ name: "SCImago",   fn: () => runSCImago(query, ctx) });

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

    // Re-evaluate Admiralty synchronously so the updated codes are included in
    // the response. Callers can use admiraltyUpdates[contentId] to refresh the
    // crest without a page reload.
    const admiraltyUpdates = await reEvaluateAdmiraltyForPublisher(query, resolvedId, label);

    return { status: "done", publisherId: resolvedId, results, admiraltyUpdates };

  } catch (err) {
    // Never propagate — callers treat enrichment as best-effort
    logger.error("[enrichment] Unexpected top-level error:", err.message);
    return { status: "error", error: err.message };
  }
}

// TODO: When wiring reference-publisher enrichment, call with context: 'reference_source'
// and guard it behind enrichReferencePublishers = false by default.
