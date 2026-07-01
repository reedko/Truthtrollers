// backend/services/sourceIdentityResolver.js
// Domain-first, progressive source identity resolution.
// Never throws. Always returns a usable SourceIdentity object.
//
// Resolution levels:
//   0: no URL   1: domain extracted   2: name/type derived   3: DB publisher matched
//   4: type classified   5: reliability from ratings   6: human reviewed
//
// Usage:
//   const identity = await resolveSourceIdentity(url, { query, hintName, title, author, force });

import { canonicalizeUrl } from "../src/utils/canonicalizeUrl.js";
import { classifyPlatform } from "./sourcePlatformClassifier.js";
import logger from "../src/utils/logger.js";
import { processPublishingIdentity } from "../src/services/publishingIdentityPipeline.js";

// ── Domain-level source type patterns ────────────────────────────────────────
const GOV_TLD    = /\.(gov|mil|gc\.ca|gov\.uk|govt\.nz|europa\.eu|fed\.us)$/i;
const EDU_TLD    = /\.(edu|ac\.uk|ac\.nz|edu\.au|ac\.in)$/i;
const GOV_NAME   = /\b(fda|cdc|nih|who|nasa|noaa|usda|epa|doj|hhs|cms\.gov|nist|nsa\.gov)\b/i;
const ACADEMIC   = /arxiv\.org|biorxiv\.org|ssrn\.com|pubmed\.ncbi|ncbi\.nlm\.nih|sciencedirect|springer|nature\.com|plos\.org|wiley\.com/i;
const REFERENCE  = /wikipedia\.org|wikimedia\.org|archive\.org|web\.archive\.org/i;

function classifyDomainType(domain) {
  if (!domain) return "unknown";
  if (GOV_TLD.test(domain) || GOV_NAME.test(domain)) return "government";
  if (EDU_TLD.test(domain)) return "academic";
  if (ACADEMIC.test(domain))  return "academic";
  if (REFERENCE.test(domain)) return "reference";
  return "unknown";
}

function deriveDisplayName(domain) {
  const base = domain?.split(".")?.[0] ?? "";
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
}

function repositoryIdentityForUrl(url, rootDomain) {
  const host = String(rootDomain || "").toLowerCase();
  if (host === "bvsalud.org" || host.endsWith(".bvsalud.org")) {
    return {
      name: "Biblioteca Virtual em Saúde",
      sourceType: "reference",
      sourceIdentityKind: "primary_document",
      resolutionStatus: "matched_metadata",
    };
  }
  return null;
}

// ── Lightweight page-meta fetch (JSON-LD + og:site_name) ─────────────────────
const PAGE_FETCH_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PAGE_FETCH_TIMEOUT_MS = 6000;

// Returns { publisherName, authorName } on success,
//         { blocked: true } when server returns 4xx/5xx (bot wall, auth gate, etc.),
//         null on network error / timeout.
async function fetchPageMeta(url) {
  try {
    const resp = await Promise.race([
      fetch(url, {
        headers: {
          "User-Agent": PAGE_FETCH_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), PAGE_FETCH_TIMEOUT_MS)),
    ]);
    if (!resp.ok) return { blocked: true };

    // If the server sends back a PDF (even when the URL has no .pdf extension), bail out
    // so the caller can route to fetchPdfMeta instead.
    const ct = resp.headers?.get?.("content-type") ?? "";
    if (ct.includes("application/pdf")) {
      resp.body?.getReader()?.cancel().catch(() => {});
      return { isPdf: true };
    }

    // Read only the first 50 KB — the <head> is always near the top
    const reader = resp.body?.getReader();
    if (!reader) return null;
    let html = "";
    while (html.length < 51200) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel().catch(() => {});

    // ── JSON-LD: find all <script type="application/ld+json"> blocks ──────────
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ldRe.exec(html)) !== null) {
      try {
        const raw = JSON.parse(m[1].trim());
        const items = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          // publisher.name covers BlogPosting / Article / NewsArticle
          const pubName =
            item?.publisher?.name ||
            item?.sourceOrganization?.name ||
            item?.provider?.name ||
            item?.["@graph"]?.find?.((n) => n["@type"] === "Organization")?.name;
          if (pubName && typeof pubName === "string") {
            return {
              publisherName: pubName.trim(),
              authorName: item?.author?.name?.trim() ?? null,
            };
          }
        }
      } catch { /* malformed JSON-LD — skip */ }
    }

    // ── Fallback: direct meta tags from the head ──────────────────────────────
    const metaMatch =
      html.match(/<meta[^>]+name=["']citation_publisher["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_publisher["']/i)
      ?? html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)
      ?? html.match(/<meta[^>]+name=["']publisher["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']publisher["']/i)
      ?? html.match(/<meta[^>]+name=["']citation_journal_title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_journal_title["']/i);
    if (metaMatch?.[1]) return { publisherName: metaMatch[1].trim(), authorName: null };

    return null;
  } catch {
    return null;
  }
}

const PDF_FETCH_TIMEOUT_MS = 25000;
const PDF_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — large government/academic PDFs can be 5-10 MB

function isPdfUrl(url) {
  try { return /\.pdf($|\?)/i.test(new URL(url).pathname); } catch { return false; }
}

// Returns { publisherName, authorName } on success, null on failure.
// Only called for URLs that look like PDFs.
async function fetchPdfMeta(url) {
  try {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const { default: axios } = await import("axios");

    const response = await Promise.race([
      axios.get(url, {
        responseType: "arraybuffer",
        maxContentLength: PDF_MAX_BYTES,
        headers: { "User-Agent": PAGE_FETCH_UA },
        timeout: PDF_FETCH_TIMEOUT_MS,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("pdf-timeout")), PDF_FETCH_TIMEOUT_MS)),
    ]);

    if (!response.data) return null;

    // Parse only the first page to keep it fast
    const parsed = await pdfParse(Buffer.from(response.data), { max: 1 });
    const info = parsed.info ?? {};
    const normalizedPdfIdentity = (await processPublishingIdentity({
      documentType: "pdf",
      pdfInfo: info,
      pdfMetadata: parsed.metadata || null,
      pdfText: parsed.text || "",
      sourceUrl: url,
    })).identity;
    const publisherName = normalizedPdfIdentity.entities?.publishing_organization?.name
      || normalizedPdfIdentity.entities?.publication_venue?.name;
    const authorName = info.Author?.trim() || null;

    logger.log(`[fetchPdfMeta] ${url} → publisher="${publisherName}" author="${authorName}"`);
    return (publisherName || authorName) ? {
      publisherName,
      authorName,
      publicationVenue: normalizedPdfIdentity.entities?.publication_venue?.name || null,
      articleType: normalizedPdfIdentity.document?.article_type || null,
    } : null;
  } catch (err) {
    logger.warn(`[fetchPdfMeta] Failed for ${url}: ${err.message}`);
    return null;
  }
}

// ── Base return shape ─────────────────────────────────────────────────────────
function makeBase(sourceUrl) {
  return {
    sourceUrl:          sourceUrl ?? null,
    normalizedUrl:      null,
    rootDomain:         null,
    displayDomain:      null,
    publisherId:        null,
    publisherName:      null,
    sourceIdentityKind: "unresolved",
    resolutionLevel:    0,
    resolutionStatus:   "unresolved",
    sourceType:         "unknown",
    reliability:        "unchecked",
    needsHumanReview:   true,
    // true when we attempted fetchPageMeta and got a non-2xx (bot wall, 403, etc.)
    pageBlocked:        false,
    metadata: {
      title:               null,
      author:              null,
      publisherFromMetadata: null,
      canonicalUrl:        null,
      publishedDate:       null,
      platformName:        null,
      platformAccountName: null,
      archiveTimestamp:    null,
    },
    // All publisher name candidates gathered during resolution, ordered best-first.
    // Each: { source: string, name: string, confidence: 'high'|'medium'|'low' }
    candidates: [],
  };
}

// ── Cache read ────────────────────────────────────────────────────────────────
async function checkCache(query, normalizedUrl, rootDomain, { allowDomainFallback = true } = {}) {
  try {
    let rows = await query(
      `SELECT * FROM source_identity_cache
       WHERE normalized_url = ?
       ORDER BY resolution_level DESC, last_checked_at DESC
       LIMIT 1`,
      [normalizedUrl]
    );
    if (!rows.length && allowDomainFallback) {
      rows = await query(
        `SELECT * FROM source_identity_cache
         WHERE root_domain = ?
         ORDER BY resolution_level DESC, last_checked_at DESC
         LIMIT 1`,
        [rootDomain]
      );
    }
    if (!rows.length) return null;
    const r = rows[0];
    const base = makeBase(r.source_url);
    return {
      ...base,
      normalizedUrl:      r.normalized_url,
      rootDomain:         r.root_domain,
      displayDomain:      r.root_domain,
      publisherId:        r.publisher_id,
      publisherName:      r.publisher_name,
      sourceIdentityKind: r.source_identity_kind,
      resolutionLevel:    r.resolution_level,
      resolutionStatus:   r.resolution_status,
      sourceType:         r.source_type,
      reliability:        r.reliability,
      needsHumanReview:   !!r.needs_human_review,
      metadata:           r.metadata_json ? JSON.parse(r.metadata_json) : base.metadata,
      _fromCache:         true,
    };
  } catch {
    return null;
  }
}

// ── Publisher DB lookup ───────────────────────────────────────────────────────
async function lookupPublisher(query, rootDomain, hintName, { preferHintName = false } = {}) {
  try {
    if (preferHintName && hintName) {
      const byName = await query(
        `SELECT publisher_id, publisher_name FROM publishers WHERE publisher_name = ? LIMIT 1`,
        [hintName]
      );
      if (byName.length) return byName[0];
      return null;
    }

    // publisher_domains table (multi-domain support)
    const byDomain = await query(
      `SELECT p.publisher_id, p.publisher_name
       FROM publisher_domains pd
       JOIN publishers p ON pd.publisher_id = p.publisher_id
       WHERE pd.root_domain = ?
       LIMIT 1`,
      [rootDomain]
    );
    if (byDomain.length) return byDomain[0];

    // publishers.domain column
    const byPubDomain = await query(
      `SELECT publisher_id, publisher_name FROM publishers WHERE domain = ? LIMIT 1`,
      [rootDomain]
    );
    if (byPubDomain.length) return byPubDomain[0];

    // publisher name hint
    if (hintName) {
      const byName = await query(
        `SELECT publisher_id, publisher_name FROM publishers WHERE publisher_name = ? LIMIT 1`,
        [hintName]
      );
      if (byName.length) return byName[0];
    }
  } catch (err) {
    logger.warn("[sourceIdentityResolver] Publisher lookup error:", err.message);
  }
  return null;
}

// ── Reliability from publisher_ratings ────────────────────────────────────────
async function lookupReliability(query, publisherId) {
  try {
    const rows = await query(
      `SELECT AVG(veracity_score) AS avg_v
       FROM publisher_ratings
       WHERE publisher_id = ? AND user_id IS NULL AND veracity_score IS NOT NULL`,
      [publisherId]
    );
    const avg = rows[0]?.avg_v;
    if (avg == null) return null;
    if (avg >= 70) return "high";
    if (avg >= 50) return "medium";
    if (avg >= 30) return "mixed";
    return "low";
  } catch {
    return null;
  }
}

// ── Cache write ───────────────────────────────────────────────────────────────
async function writeCache(query, identity) {
  try {
    await query(
      `INSERT INTO source_identity_cache
         (source_url, normalized_url, root_domain, publisher_id, publisher_name,
          source_identity_kind, resolution_level, resolution_status, source_type,
          reliability, needs_human_review, metadata_json, last_checked_at)
       VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,NOW())
       ON DUPLICATE KEY UPDATE
         publisher_id        = VALUES(publisher_id),
         publisher_name      = VALUES(publisher_name),
         source_identity_kind= VALUES(source_identity_kind),
         resolution_level    = IF(VALUES(resolution_level) > resolution_level,
                                  VALUES(resolution_level), resolution_level),
         resolution_status   = VALUES(resolution_status),
         source_type         = VALUES(source_type),
         reliability         = VALUES(reliability),
         needs_human_review  = VALUES(needs_human_review),
         metadata_json       = VALUES(metadata_json),
         last_checked_at     = NOW()`,
      [
        identity.sourceUrl,
        identity.normalizedUrl,
        identity.rootDomain,
        identity.publisherId,
        identity.publisherName,
        identity.sourceIdentityKind,
        identity.resolutionLevel,
        identity.resolutionStatus,
        identity.sourceType,
        identity.reliability,
        identity.needsHumanReview ? 1 : 0,
        JSON.stringify(identity.metadata),
      ]
    );
  } catch (err) {
    logger.warn("[sourceIdentityResolver] Cache write failed:", err.message);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Resolve a source URL to a SourceIdentity object.
 *
 * @param {string}  sourceUrl
 * @param {object}  options
 * @param {function} options.query     - DB query function (optional; skips DB lookups if absent)
 * @param {string}  options.hintName  - Publisher name already known from scrape metadata
 * @param {string}  options.title     - Page title (stored in metadata)
 * @param {string}  options.author    - Primary author name (stored in metadata)
 * @param {boolean} options.force     - Bypass cache
 * @param {object} options.structuredIdentity - Already-extracted source-identity-v1 data; skips page fetch
 * @returns {SourceIdentity}          - Never null; always a usable object
 */
export async function resolveSourceIdentity(sourceUrl, options = {}) {
  const { query, title, author, force, structuredIdentity = null } = options;
  const structuredPrimary = structuredIdentity?.context?.context_type === "scholarly"
    && structuredIdentity?.entities?.publication_venue?.name
      ? structuredIdentity.entities.publication_venue
      : structuredIdentity?.entities?.publishing_organization?.name
        ? structuredIdentity.entities.publishing_organization
        : structuredIdentity?.entities?.publication_venue || null;
  const hintName = options.hintName || structuredPrimary?.name || null;
  const identity = makeBase(sourceUrl);

  try {
    if (!sourceUrl) return identity;

    // ── Level 1: URL normalization + domain extraction ──────────────────────
    const normalizedUrl = canonicalizeUrl(sourceUrl) ?? sourceUrl;
    identity.normalizedUrl = normalizedUrl;
    identity.metadata.canonicalUrl = normalizedUrl;

    let rootDomain = null;
    try { rootDomain = new URL(normalizedUrl).hostname.replace(/^www\./, ""); } catch {}
    // Reject localhost / private-network URLs — they're dev-server or API origins, not real sources
    if (!rootDomain || rootDomain === "localhost" || /^127\.|^192\.168\.|^10\./.test(rootDomain)) return identity;

    identity.rootDomain    = rootDomain;
    identity.displayDomain = rootDomain;
    identity.resolutionLevel  = 1;
    identity.resolutionStatus = "domain_only";
    identity.sourceIdentityKind = "domain_fallback";
    const repositoryIdentity = repositoryIdentityForUrl(normalizedUrl, rootDomain);
    if (repositoryIdentity) {
      identity.publisherName = repositoryIdentity.name;
      identity.sourceType = repositoryIdentity.sourceType;
      identity.sourceIdentityKind = repositoryIdentity.sourceIdentityKind;
      identity.resolutionStatus = repositoryIdentity.resolutionStatus;
      identity.resolutionLevel = 2;
    }

    if (title)    identity.metadata.title  = title;
    if (author)   identity.metadata.author = author;
    if (hintName) identity.metadata.publisherFromMetadata = hintName;
    if (structuredIdentity?.version === "source-identity-v1") {
      identity.metadata.normalizedPublishingIdentity = structuredIdentity;
    }

    // ── Level 2a: Platform detection ────────────────────────────────────────
    const platform = classifyPlatform(rootDomain, normalizedUrl);
    if (platform.isPlatform) {
      identity.sourceIdentityKind = "platform_hosted";
      identity.sourceType         = platform.sourceType;
      identity.resolutionLevel    = 2;
      identity.resolutionStatus   = "matched_platform_host";
      identity.metadata.platformName        = platform.platformName;
      identity.metadata.platformAccountName = platform.accountName;
    }

    // ── Level 2b: Domain-level source type ──────────────────────────────────
    const domainType = classifyDomainType(rootDomain);
    if (domainType !== "unknown" && identity.sourceType === "unknown") {
      identity.sourceType = domainType;
      if (domainType === "government")  identity.sourceIdentityKind = "government_source";
      else if (domainType === "academic")   identity.sourceIdentityKind = "academic_source";
      else if (domainType === "reference")  identity.sourceIdentityKind = "primary_document";
      identity.resolutionLevel = Math.max(identity.resolutionLevel, 2);
    }

    // ── Level 2c: Page-meta fetch (JSON-LD / og:site_name for HTML; pdf-parse for PDFs) ──
    // Only for non-platform URLs — platforms use account extraction instead.
    // Skip if hintName already provided (scrape pipeline already extracted meta).
    let pageMeta = null;
    if (!platform.isPlatform && !hintName && structuredIdentity?.version !== "source-identity-v1") {
      if (isPdfUrl(normalizedUrl)) {
        // URL extension says PDF — go straight to PDF parser
        pageMeta = await fetchPdfMeta(normalizedUrl);
      } else {
        // HTML path — fetchPageMeta will signal { isPdf: true } if Content-Type says PDF
        pageMeta = await fetchPageMeta(normalizedUrl);
        if (pageMeta?.isPdf) {
          // Server returned application/pdf despite non-.pdf URL — re-route to PDF parser
          pageMeta = await fetchPdfMeta(normalizedUrl);
        } else if (pageMeta?.blocked) {
          identity.pageBlocked = true;
          pageMeta = null;
        }
      }
      if (pageMeta?.publisherName) {
        identity.resolutionLevel = Math.max(identity.resolutionLevel, 2);
        identity.resolutionStatus = "meta_extracted";
        if (pageMeta.authorName) identity.metadata.author = pageMeta.authorName;
      }
    }

    // ── Build candidates (all possible publisher names, best-first) ──────────
    const domainName = deriveDisplayName(rootDomain);
    const candidates = [];

    // JSON-LD / og:site_name — highest confidence from actual page structure
    if (pageMeta?.publisherName) {
      candidates.push({ source: "metadata", name: pageMeta.publisherName, confidence: "high" });
    }
    // Scrape pipeline hint (already-extracted publisher name)
    if (hintName) {
      candidates.push({ source: "metadata", name: hintName, confidence: "medium" });
    }
    if (repositoryIdentity && !candidates.some(c => c.name === repositoryIdentity.name)) {
      candidates.push({ source: "repository", name: repositoryIdentity.name, confidence: "medium" });
    }
    if (platform.isPlatform && platform.accountName) {
      candidates.push({ source: "platform_account", name: platform.accountName, confidence: "high" });
    }
    if (platform.isPlatform && platform.platformName) {
      candidates.push({ source: "platform", name: platform.platformName, confidence: "medium" });
    }
    if (domainName && !candidates.some(c => c.name === domainName)) {
      candidates.push({ source: "domain", name: domainName, confidence: "low" });
    }

    identity.candidates = candidates;

    // Best publisher name: page meta > hint > platform account > domain
    identity.publisherName = candidates[0]?.name ?? identity.publisherName ?? domainName;

    // ── No DB → return level 1-2 result ─────────────────────────────────────
    if (!query) {
      identity.needsHumanReview = true;
      return identity;
    }

    // ── Cache check ──────────────────────────────────────────────────────────
    if (!force) {
      const allowDomainFallback = !(platform.isPlatform && platform.accountName);
      const cached = await checkCache(query, normalizedUrl, rootDomain, { allowDomainFallback });
      if (cached && cached.resolutionLevel >= identity.resolutionLevel) {
        const cachedIsGenericPlatform =
          platform.isPlatform &&
          platform.accountName &&
          String(cached.publisherName || "").toLowerCase() === String(platform.platformName || "").toLowerCase();
        if (cachedIsGenericPlatform) {
          // Keep resolving: exact platform-account URLs should not inherit the
          // generic platform publisher's ratings.
        } else {
        // Merge freshly-derived candidates into cached result (cache doesn't store them)
          cached.candidates = candidates;
          return cached;
        }
      }
    }

    // ── Level 3: DB publisher lookup ─────────────────────────────────────────
    const dbMatch = await lookupPublisher(query, rootDomain, hintName || identity.publisherName, {
      preferHintName: platform.isPlatform && !!platform.accountName,
    });
    if (dbMatch) {
      identity.publisherId      = dbMatch.publisher_id;
      identity.publisherName    = dbMatch.publisher_name;
      identity.resolutionLevel  = 3;
      identity.resolutionStatus = "matched_publisher_domain";
      if (identity.sourceIdentityKind === "domain_fallback") {
        identity.sourceIdentityKind = "publisher_domain";
      }
      // Promote matched publisher to front of candidates
      identity.candidates = [
        { source: "matched", name: dbMatch.publisher_name, confidence: "high" },
        ...candidates.filter(c => c.name !== dbMatch.publisher_name),
      ];
    } else {
      identity.resolutionStatus = platform.isPlatform ? "matched_platform_host" : "domain_only";
    }

    // ── Level 5: reliability from publisher_ratings ──────────────────────────
    if (identity.publisherId) {
      const rel = await lookupReliability(query, identity.publisherId);
      if (rel) {
        identity.reliability     = rel;
        identity.resolutionLevel = Math.max(identity.resolutionLevel, 5);
      }
    }

    identity.needsHumanReview = identity.resolutionLevel < 3;

    // Write to cache — non-blocking, fire and forget
    writeCache(query, identity).catch(() => {});

    return identity;
  } catch (err) {
    logger.warn("[sourceIdentityResolver] Resolution error:", err.message);
    return identity; // always return usable base
  }
}
