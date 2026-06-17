// backend/services/sourceLineageResolver.js
//
// Detects whether a URL is an original article, excerpt, full repost,
// pointer/link-roundup, syndication, or an archive.org wrapper.
//
// Algorithm:
//   1. Archive normalization — web.archive.org → original URL + timestamp
//   2. Fetch first 100 KB of page (with browser UA)
//   3. Structural signals — rel=canonical, og:url, <link rel="alternate">
//   4. Text heuristics — detect excerpt/repost/pointer phrases
//   5. Attribution-link scan — "Originally published at", "Via:", "Source:" links
//   6. Follow upstream URL up to MAX_DEPTH hops
//
// Exports: resolveSourceLineage(url, options)

import { canonicalizeUrl } from "../src/utils/canonicalizeUrl.js";
import logger from "../src/utils/logger.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES  = 102400; // 100 KB
const MAX_DEPTH        = 3;

// ── Archive URL detection ─────────────────────────────────────────────────────

const ARCHIVE_ORG_RE = /^https?:\/\/web\.archive\.org\/web\/(\d{14})\*?\/?(.+)$/i;
const CACHED_PAGE_RE = /^https?:\/\/(?:webcache\.googleusercontent\.com|cache\.google\.com)/i;

function parseArchiveUrl(url) {
  const m = url.match(ARCHIVE_ORG_RE);
  if (m) {
    const timestamp = m[1];
    const originalUrl = m[2].startsWith("http") ? m[2] : `https://${m[2]}`;
    return { isArchive: true, originalUrl, timestamp };
  }
  if (CACHED_PAGE_RE.test(url)) {
    const inner = new URL(url).searchParams.get("q") ?? new URL(url).searchParams.get("url");
    return inner ? { isArchive: true, originalUrl: inner, timestamp: null } : { isArchive: false };
  }
  return { isArchive: false };
}

// ── Page fetch ────────────────────────────────────────────────────────────────

async function fetchPageHtml(url) {
  try {
    const resp = await Promise.race([
      fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), FETCH_TIMEOUT_MS)),
    ]);
    if (!resp.ok) return null;

    const reader = resp.body?.getReader();
    if (!reader) return null;

    let html = "";
    while (html.length < MAX_FETCH_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel().catch(() => {});
    return html;
  } catch {
    return null;
  }
}

// ── Structural signals ────────────────────────────────────────────────────────

function extractStructuralSignals(html, sourceUrl) {
  const signals = [];
  let canonicalUrl = null;
  let ogUrl = null;

  // rel=canonical
  const canonRe = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
  const canonRe2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i;
  const canonMatch = html.match(canonRe) ?? html.match(canonRe2);
  if (canonMatch?.[1]) canonicalUrl = canonMatch[1].trim();

  // og:url
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  if (ogMatch?.[1]) ogUrl = ogMatch[1].trim();

  // Compare canonical / og:url domain against source domain
  let sourceDomain = null;
  try { sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch {}

  let canonicalUpstream = null;

  for (const candidate of [canonicalUrl, ogUrl]) {
    if (!candidate) continue;
    try {
      const candidateDomain = new URL(candidate).hostname.replace(/^www\./, "");
      if (candidateDomain && candidateDomain !== sourceDomain) {
        canonicalUpstream = candidate;
        signals.push({ type: "canonical_cross_domain", url: candidate, domain: candidateDomain });
      }
    } catch { /* ignore invalid URLs */ }
  }

  return { canonicalUrl, ogUrl, canonicalUpstream, signals };
}

// ── Text heuristics ───────────────────────────────────────────────────────────

const REPOST_PATTERNS = [
  /originally published (?:at|in|by|on)/i,
  /originally appeared (?:at|in|on)/i,
  /this article (?:was |originally )?(?:published|appeared|ran)/i,
  /republished (?:with permission|from)/i,
  /cross.?posted from/i,
  /first published (?:at|in|by|on)/i,
  /re.?published from/i,
];

const EXCERPT_PATTERNS = [
  /(?:^|\n)(?:excerpt|excerpted) from/im,
  /this is an excerpt/i,
  /read (?:the )?(?:full|rest|more|complete) (?:article|story|post|piece) (?:at|on|here)/i,
  /continue reading (?:at|on|here)/i,
  /\[\.{3}\]/,  // [...] ellipsis placeholder common in excerpts
  /read more at/i,
];

const POINTER_PATTERNS = [
  /\bvia\b[:\s]+(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)/i,
  /\bsource[:\s]+(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)/i,
  /\bh\/t\b/i,
  /\bhat tip\b/i,
  /\blink roundup\b/i,
  /\bweekly links?\b/i,
  /\bquick links?\b/i,
];

const SYNDICATION_PATTERNS = [
  /syndicated from/i,
  /syndication partner/i,
  /\bap wire\b/i,
  /\breuters\b.*\bcopyright\b/i,
];

function detectTextSignals(html) {
  // Operate on a text-stripped slice of the body (remove tags for pattern matching)
  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  const text = bodyMatch
    ? bodyMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000)
    : html.slice(0, 8000);

  const signals = [];

  for (const p of REPOST_PATTERNS)   if (p.test(text)) signals.push({ type: "repost_phrase",  pattern: p.source.slice(0, 60) });
  for (const p of EXCERPT_PATTERNS)  if (p.test(text)) signals.push({ type: "excerpt_phrase", pattern: p.source.slice(0, 60) });
  for (const p of POINTER_PATTERNS)  if (p.test(text)) signals.push({ type: "pointer_phrase", pattern: p.source.slice(0, 60) });
  for (const p of SYNDICATION_PATTERNS) if (p.test(text)) signals.push({ type: "syndication_phrase", pattern: p.source.slice(0, 60) });

  return { text, signals };
}

// ── Attribution link scanner ──────────────────────────────────────────────────

const ATTRIBUTION_LINK_TEXT_RE = /original(?:ly)?\s+(?:source|article|published|post)|source\s+article|read\s+(?:original|full|more)|published\s+(?:at|in|by|on)|hat\s+tip|via/i;

function extractAttributionLinks(html, sourceDomain) {
  const links = [];
  // Find all <a href="...">text</a> pairs
  const linkRe = /<a\b[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].trim();
    const linkText = m[2].replace(/<[^>]+>/g, "").trim();
    if (!href.startsWith("http")) continue;
    try {
      const linkDomain = new URL(href).hostname.replace(/^www\./, "");
      if (linkDomain === sourceDomain) continue; // same-domain link
      if (ATTRIBUTION_LINK_TEXT_RE.test(linkText)) {
        links.push({ url: href, text: linkText.slice(0, 80), domain: linkDomain });
      }
    } catch { /* ignore */ }
  }
  return links;
}

// ── Classify from signals ─────────────────────────────────────────────────────

function classify(allSignals) {
  const types = allSignals.map(s => s.type);

  // Count signal types
  const repostCount     = types.filter(t => t === "repost_phrase").length;
  const excerptCount    = types.filter(t => t === "excerpt_phrase").length;
  const pointerCount    = types.filter(t => t === "pointer_phrase").length;
  const syndicateCount  = types.filter(t => t === "syndication_phrase").length;
  const crossCanonical  = types.filter(t => t === "canonical_cross_domain").length;
  const attrLinks       = types.filter(t => t === "attribution_link").length;

  if (repostCount >= 1 || syndicateCount >= 1) {
    return { lineageType: "repost", confidence: repostCount >= 2 ? "high" : "medium" };
  }
  if (crossCanonical >= 1 && (repostCount + excerptCount + attrLinks) >= 1) {
    return { lineageType: "syndicated", confidence: "high" };
  }
  if (crossCanonical >= 1) {
    return { lineageType: "syndicated", confidence: "medium" };
  }
  if (excerptCount >= 1) {
    return { lineageType: "excerpt", confidence: excerptCount >= 2 ? "high" : "medium" };
  }
  if (pointerCount >= 2 || (pointerCount >= 1 && attrLinks >= 1)) {
    return { lineageType: "pointer", confidence: "medium" };
  }
  if (attrLinks >= 1) {
    return { lineageType: "repost", confidence: "low" };
  }
  return { lineageType: "original", confidence: "low" };
}

// ── Pick the best upstream URL from all gathered signals ─────────────────────

function pickUpstreamUrl(structural, attributionLinks) {
  // Cross-domain canonical is strongest signal
  if (structural.canonicalUpstream) return structural.canonicalUpstream;
  // Attribution link is next
  if (attributionLinks.length) return attributionLinks[0].url;
  // og:url cross-domain (already captured as canonicalUpstream when present)
  return null;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function readCache(query, normalizedUrl) {
  try {
    const rows = await query(
      `SELECT * FROM source_lineage_cache WHERE normalized_url = ? LIMIT 1`,
      [normalizedUrl]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      lineageType:      r.lineage_type,
      upstreamUrl:      r.upstream_url,
      upstreamPublisher: r.upstream_publisher,
      chainDepth:       r.chain_depth,
      lineageChain:     r.lineage_chain ? JSON.parse(r.lineage_chain) : [],
      detectionSignals: r.detection_signals ? JSON.parse(r.detection_signals) : [],
      confidence:       r.confidence,
      _fromCache:       true,
    };
  } catch {
    return null;
  }
}

async function writeCache(query, result, normalizedUrl, sourceUrl) {
  try {
    await query(
      `INSERT INTO source_lineage_cache
         (source_url, normalized_url, lineage_type, upstream_url, upstream_publisher,
          chain_depth, lineage_chain, detection_signals, confidence, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         lineage_type      = VALUES(lineage_type),
         upstream_url      = VALUES(upstream_url),
         upstream_publisher= VALUES(upstream_publisher),
         chain_depth       = VALUES(chain_depth),
         lineage_chain     = VALUES(lineage_chain),
         detection_signals = VALUES(detection_signals),
         confidence        = VALUES(confidence),
         last_checked_at   = NOW()`,
      [
        sourceUrl,
        normalizedUrl,
        result.lineageType,
        result.upstreamUrl ?? null,
        result.upstreamPublisher ?? null,
        result.chainDepth ?? 0,
        JSON.stringify(result.lineageChain ?? []),
        JSON.stringify(result.detectionSignals ?? []),
        result.confidence,
      ]
    );
  } catch (err) {
    logger.warn("[sourceLineageResolver] Cache write failed:", err.message);
  }
}

// ── Single-URL analysis (no chain following) ──────────────────────────────────

async function analyzeUrl(url) {
  const archiveInfo = parseArchiveUrl(url);
  if (archiveInfo.isArchive) {
    return {
      lineageType:      "archive",
      upstreamUrl:      archiveInfo.originalUrl,
      upstreamPublisher: null,
      chainDepth:       1,
      lineageChain:     [],
      detectionSignals: [{ type: "archive_url", timestamp: archiveInfo.timestamp }],
      confidence:       "high",
    };
  }

  const html = await fetchPageHtml(url);
  if (!html) {
    return {
      lineageType:      "unknown",
      upstreamUrl:      null,
      upstreamPublisher: null,
      chainDepth:       0,
      lineageChain:     [],
      detectionSignals: [{ type: "fetch_failed" }],
      confidence:       "low",
    };
  }

  let sourceDomain = null;
  try { sourceDomain = new URL(url).hostname.replace(/^www\./, ""); } catch {}

  const structural      = extractStructuralSignals(html, url);
  const { signals: textSignals } = detectTextSignals(html);
  const attrLinks       = extractAttributionLinks(html, sourceDomain);
  const attrSignals     = attrLinks.map(l => ({ type: "attribution_link", url: l.url, text: l.text }));

  const allSignals      = [...structural.signals, ...textSignals, ...attrSignals];
  const { lineageType, confidence } = classify(allSignals);
  const upstreamUrl     = lineageType === "original" ? null : pickUpstreamUrl(structural, attrLinks);

  return {
    lineageType,
    upstreamUrl,
    upstreamPublisher: null, // resolved in chain-follow pass
    chainDepth:        upstreamUrl ? 1 : 0,
    lineageChain:      [],
    detectionSignals:  allSignals,
    confidence,
  };
}

// ── Chain follower ────────────────────────────────────────────────────────────

async function followChain(rootUrl, depth = 0) {
  if (depth >= MAX_DEPTH) return [];

  const result = await analyzeUrl(rootUrl);
  const hop = { url: rootUrl, lineageType: result.lineageType, confidence: result.confidence };

  if (!result.upstreamUrl || result.lineageType === "original") {
    return [hop];
  }

  const normalizedUpstream = canonicalizeUrl(result.upstreamUrl) ?? result.upstreamUrl;
  const upstream = await followChain(normalizedUpstream, depth + 1);
  return [hop, ...upstream];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolve source lineage for a URL.
 *
 * @param {string}   sourceUrl
 * @param {object}   options
 * @param {function} options.query  - DB query fn; skips cache if absent
 * @param {boolean}  options.force  - Bypass cache
 * @returns {LineageResult}         - Never null
 */
export async function resolveSourceLineage(sourceUrl, options = {}) {
  const { query, force } = options;

  const empty = {
    lineageType:      "unknown",
    upstreamUrl:      null,
    upstreamPublisher: null,
    chainDepth:       0,
    lineageChain:     [],
    detectionSignals: [],
    confidence:       "low",
  };

  if (!sourceUrl) return empty;

  let normalizedUrl;
  try { normalizedUrl = canonicalizeUrl(sourceUrl) ?? sourceUrl; } catch { return empty; }

  // Reject private/localhost URLs
  try {
    const host = new URL(normalizedUrl).hostname;
    if (host === "localhost" || /^127\.|^10\.|^192\.168\./.test(host)) return empty;
  } catch { return empty; }

  try {
    // Cache check
    if (query && !force) {
      const cached = await readCache(query, normalizedUrl);
      if (cached) return cached;
    }

    // Walk the chain
    const chain = await followChain(normalizedUrl);
    const root  = chain[0] ?? {};

    // The "true original" is the last hop in the chain
    const original = chain[chain.length - 1];
    const upstreamUrl = chain.length > 1 ? chain[1].url : null;

    const result = {
      lineageType:      root.lineageType ?? "unknown",
      upstreamUrl:      upstreamUrl ?? null,
      upstreamPublisher: null,
      chainDepth:       chain.length - 1,
      lineageChain:     chain,
      detectionSignals: [], // signals are inside chain hop objects
      confidence:       root.confidence ?? "low",
    };

    if (query) writeCache(query, result, normalizedUrl, sourceUrl).catch(() => {});

    return result;
  } catch (err) {
    logger.warn("[sourceLineageResolver] Error:", err.message);
    return empty;
  }
}
