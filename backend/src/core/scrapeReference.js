// backend/src/core/scrapeReference.js
// ─────────────────────────────────────────────
// Process an AI reference using pre-fetched text
// (avoiding double-fetch from evidence engine)
// ─────────────────────────────────────────────

import logger from "../utils/logger.js";
import * as cheerio from "cheerio";
import { extractAuthors, followProfileLinks } from "../utils/extractAuthors.js";
import { extractPublisher } from "../utils/extractPublisher.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { createContentInternal } from "../storage/createContentInternal.js";
import { getBestImage } from "../utils/getBestImage.js";
import { choosePdfPublisher } from "../utils/pdfPublisherExtractor.js";
import { parseSocialPublisher } from "../utils/parseSocialPublisher.js";

const SOURCE_ATTR_RE = /\b(source|via|originally published|originally at|reprinted from|cross[- ]?posted from|from the)\b/i;
const MAX_CHAIN_DEPTH = 3;
// Generic/garbage publisher names — includes old media_source platform values and generic web terms
const JUNK_PUBLISHER_RE = /^(unknown( publisher)?|web|website|home|index|default|page|site|blog|news|online|internet|portal|network|media|publications?|facebook|youtube|twitter|instagram|tiktok|reddit|linkedin|pinterest|snapchat|telegram|x\.com|recaptcha|just a moment|cloudflare|attention required|one more step|checking your browser|access denied|bot protected)$/i;

// Bot/CAPTCHA challenge pages — detect before parsing so we use domain as fallback publisher
const BOT_PAGE_RE = /class="g-recaptcha"|id="challenge-(?:form|stage|running)"|cf-challenge|checking your browser|just a moment\.\.\.|enable javascript and cookies to continue|are you a robot\?|ddos-guard|please complete the security check|access to this page has been denied/i;

function isBotProtectedHtml(html) {
  if (!html || html.length < 50) return false;
  return BOT_PAGE_RE.test(html);
}

// Extract a human-readable domain label from a URL (e.g. "pubmed.ncbi.nlm.nih.gov" → "pubmed.ncbi.nlm.nih.gov")
function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function repositoryPublisherFromUrl(url) {
  const domain = domainFromUrl(url);
  if (!domain) return null;
  if (/^iarc\.who\.int$/i.test(domain)) {
    return { name: "International Agency for Research on Cancer", confidence: "curated" };
  }
  if (/^who\.int$/i.test(domain) || /\.who\.int$/i.test(domain)) {
    return { name: "World Health Organization", confidence: "curated" };
  }
  if (/bvsalud\.org$/i.test(domain) || domain.includes(".bvsalud.org")) {
    return { name: "Biblioteca Virtual em Saúde" };
  }
  return null;
}

async function ensureReferencePublisherLink(query, { referenceContentId, url, publisher }) {
  const pubName = publisher?.name;
  if (!pubName || pubName === "Unknown Publisher" || JUNK_PUBLISHER_RE.test(pubName)) {
    logger.warn(`⚠️  [scrapeReference] No publisher name resolved for ${url} — skipping publisher link`);
    return null;
  }

  const [existingAdm] = await query(
    `SELECT admiralty_code FROM admiralty_evaluations WHERE target_type = 'content' AND target_id = ? LIMIT 1`,
    [referenceContentId]
  );
  const needsAdmiralty = !existingAdm?.admiralty_code;
  const urlDomain = domainFromUrl(url);
  let publisherId = null;
  let publisherName = pubName.trim();
  const isPublisherProxy = publisher?.role === "journal" || publisher?.confidence === "proxy";
  const isCuratedUrlPublisher = publisher?.confidence === "curated";

  if (urlDomain && !isPublisherProxy && !isCuratedUrlPublisher) {
    const domainResults = await query(
      `SELECT
         p.publisher_id,
         MIN(p.publisher_name) AS publisher_name,
         COUNT(*) AS content_count
       FROM content c
       JOIN content_publishers cp ON c.content_id = cp.content_id
       JOIN publishers p ON cp.publisher_id = p.publisher_id
       WHERE c.url LIKE CONCAT('%', ?, '%')
         AND p.publisher_name NOT REGEXP '^(unknown publisher|recaptcha|bot protected|just a moment)$'
       GROUP BY p.publisher_id
       ORDER BY content_count DESC
       LIMIT 1`,
      [urlDomain]
    );

    if (domainResults.length > 0) {
      publisherId = domainResults[0].publisher_id;
      const existingName = domainResults[0].publisher_name;
      if (publisherName.length > existingName.length + 8 && !publisherName.includes("://")) {
        await query(`UPDATE publishers SET publisher_name = ? WHERE publisher_id = ?`, [publisherName, publisherId]);
        logger.log(`📝 [scrapeReference] Upgraded publisher "${existingName}" → "${publisherName}" for ${urlDomain}`);
      } else {
        publisherName = existingName;
      }
    }
  } else if (isPublisherProxy) {
    logger.log(
      `🧾 [scrapeReference] Linking scholarly source proxy "${publisherName}" directly; not reusing prior publisher for ${urlDomain}`
    );
  }

  if (!publisherId) {
    const insertRows = await query(
      `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`,
      [publisherName]
    );
    publisherId = insertRows[0]?.[0]?.publisherId || null;
  }

  if (!publisherId) {
    logger.warn(`⚠️  [scrapeReference] InsertOrGetPublisher returned no ID for "${publisherName}"`);
    return null;
  }

  await query(`DELETE FROM content_publishers WHERE content_id = ?`, [referenceContentId]);
  await query(`INSERT INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`, [referenceContentId, publisherId]);

  return { publisherId, publisherName, needsAdmiralty };
}

/**
 * Walk the article chain to find the deepest real publisher.
 * At each level:
 *   1. Check DB — if URL is already stored with a known publisher, use it (no fetch needed).
 *   2. Fetch → extractPublisher.
 *   3. Check canonical URL on a different domain → recurse.
 *   4. Check source-attribution elements → recurse.
 */
async function resolvePublisherChain(url, depth, dbQuery) {
  if (depth >= MAX_CHAIN_DEPTH) return null;

  // ── 1. DB short-circuit ──────────────────────────────────────────────────
  // Look up publisher via the proper publishers table (not legacy media_source)
  if (dbQuery) {
    try {
      const rows = await dbQuery(
        `SELECT c.content_id, p.publisher_name
           FROM content c
           LEFT JOIN content_publishers cp ON c.content_id = cp.content_id
           LEFT JOIN publishers p ON cp.publisher_id = p.publisher_id
          WHERE c.url = ?
          LIMIT 1`,
        [url]
      );
      if (rows?.[0]) {
        const name = rows[0].publisher_name;
        if (name && !JUNK_PUBLISHER_RE.test(name) && name.length > 2) {
          logger.log(`📦 [chain:${depth}] Already in DB: "${name}" for ${url}`);
          return { name, content_id: rows[0].content_id };
        }
      }
    } catch {}
  }

  // ── 2. Fetch & parse ─────────────────────────────────────────────────────
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TruthTrollers/1.0)' },
    });
    clearTimeout(timer);
    logger.log(`🔗 [chain:${depth}] fetch ${url} → ${res.status}`);
    if (!res.ok) {
      // On 403/404 for a subpage, try the root domain — it often has og:site_name
      if (res.status === 403 || res.status === 404 || res.status === 401) {
        const origin = new URL(url).origin;
        const urlNoSlash = url.replace(/\/$/, '');
        if (origin !== urlNoSlash) {
          logger.log(`🔗 [chain:${depth}] ${res.status} on subpage → trying root ${origin}`);
          return resolvePublisherChain(origin, depth, dbQuery);
        }
      }
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const curHost = new URL(url).hostname.replace(/^www\./, '');

    let pub = await extractPublisher($, url);
    const ogSite = $('meta[property="og:site_name"]').attr('content')
      || $('meta[name="publisher"]').attr('content');
    if (!pub?.name && ogSite?.trim().length > 1) pub = { name: ogSite.trim() };
    logger.log(`🔗 [chain:${depth}] extractPublisher → "${pub?.name || 'none'}", og:site_name → "${ogSite || 'none'}"`);

    // ── 3. Canonical on a different domain → recurse ─────────────────────
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical) {
      try {
        const canonHost = new URL(canonical, url).hostname.replace(/^www\./, '');
        if (canonHost && canonHost !== curHost) {
          logger.log(`🔗 [chain:${depth}] Canonical redirect ${curHost} → ${canonHost}`);
          const deeper = await resolvePublisherChain(new URL(canonical, url).href, depth + 1, dbQuery);
          if (deeper?.name) return deeper;
        }
      } catch {}
    }

    // ── 4. Source-attribution text anywhere on page with external link ────
    {
      // Helper: resolve a candidate href to an external article URL or null.
      // Skips social platforms and author/profile/nav paths — those aren't the publisher.
      const PROFILE_PATH_RE = /^\/(authors?|contributors?|team|about|staff|bio|profile|user|members?|tag|category|topics?)\//i;
      const toExternal = (href, articleOnly = false) => {
        if (!href) return null;
        try {
          const full = new URL(href, url);
          const h = full.hostname.replace(/^www\./, '');
          if (!h || h === curHost) return null;
          if (h.includes('facebook') || h.includes('twitter') || h.includes('instagram')) return null;
          if (articleOnly && PROFILE_PATH_RE.test(full.pathname)) return null;
          return full.href;
        } catch {}
        return null;
      };

      // Scope link search to article body — avoids nav/footer noise
      const $body = $('article, [role="main"], .post-content, .entry-content, .post-body, .article-body, main, #content, #main').first();
      const $scope = $body.length ? $body : $('body');

      const allLinks = $scope.find('a[href]').map((_, a) => $(a).attr('href')).get().filter(Boolean);
      const allExternal = allLinks.map(toExternal).filter(Boolean);

      const pageText = $scope.text();
      const attrMatch = SOURCE_ATTR_RE.test(pageText);
      logger.log(`🔗 [chain:${depth}] step4: totalLinks=${allLinks.length} externalLinks=${allExternal.length} attrMatch=${attrMatch} scope=${$body.length ? $body.get(0).tagName : 'body'}`);
      if (allExternal.length > 0) logger.log(`🔗 [chain:${depth}] external links: ${allExternal.slice(0, 5).join(' | ')}`);

      let sourceUrl = null;

      // First pass: find a small inline element that matches attribution text AND contains an external link.
      // We do NOT filter profile/author URLs here — if we land on a 403, the fetch handler
      // will retry the root domain (e.g. /authors/foo → 403 → try childrenshealthdefense.org root).
      $scope.find('p, li, h1, h2, h3, h4, blockquote, cite, .source, .credit, .attribution').each((_, el) => {
        if (sourceUrl) return;
        const text = $(el).text();
        if (!SOURCE_ATTR_RE.test(text)) return;
        logger.log(`🔗 [chain:${depth}] Attribution element: "${text.trim().slice(0, 120)}"`);
        $(el).find('a[href]').each((__, a) => {
          if (sourceUrl) return;
          sourceUrl = toExternal($(a).attr('href')); // allow profile links — 403 fallback handles them
        });
        // Also check next few siblings for a link
        if (!sourceUrl) {
          $(el).nextAll('p, a, div').slice(0, 3).each((__, sib) => {
            if (sourceUrl) return;
            $(sib).find('a[href]').addBack('a[href]').each((___, a) => {
              if (sourceUrl) return;
              sourceUrl = toExternal($(a).attr('href'));
            });
          });
        }
      });

      // Second pass: attribution anywhere + pick the dominant external domain's article link
      // (emfacts has 23 external links, mostly CHD — find the first non-profile CHD one)
      if (!sourceUrl && attrMatch && allExternal.length >= 1) {
        // Prefer a link that is NOT a profile/author URL
        const articleLinks = allLinks.map(h => toExternal(h, true)).filter(Boolean);
        if (articleLinks.length > 0) {
          sourceUrl = articleLinks[0];
          logger.log(`🔗 [chain:${depth}] Attribution match → first article link: ${sourceUrl}`);
        } else if (allExternal.length === 1) {
          sourceUrl = allExternal[0];
          logger.log(`🔗 [chain:${depth}] Attribution + sole external link → ${sourceUrl}`);
        }
      }

      if (sourceUrl) {
        logger.log(`🔗 [chain:${depth}] Following → ${sourceUrl}`);
        const deeper = await resolvePublisherChain(sourceUrl, depth + 1, dbQuery);
        if (deeper?.name) return deeper;
      }
    }

    logger.log(`🔗 [chain:${depth}] Returning pub: "${pub?.name || 'none'}"`);
    return pub?.name ? pub : null;
  } catch (e) {
    logger.log(`⚠️  [chain:${depth}] fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * scrapeReference(query, { url, raw_text, raw_html, title, authors, taskContentId })
 *
 * Processes a reference using pre-fetched text/HTML:
 * - Parse HTML with cheerio (or use raw_text for PDFs)
 * - Extract metadata (authors, publisher, title)
 * - Create reference content row
 * - Returns: { referenceContentId, url, title, text, authors, publisher }
 *
 * NOTE: Claims extraction happens separately via processReferenceClaims
 */
export async function scrapeReference(query, {
  url, raw_text, raw_html, title,
  authors: providedAuthors, taskContentId,
  // Distribution-layer provenance (optional — from social posts)
  platform, distribution_channel, linked_url, linked_publisher,
}) {
  try {
    logger.log(`🟦 [scrapeReference] Processing reference: ${url}`);

    // Accept either raw_html or raw_text (raw_html takes precedence)
    const htmlContent = raw_html || raw_text;

    if (!htmlContent || htmlContent.length < 100) {
      logger.warn(`⚠️ [scrapeReference] Insufficient HTML/text for ${url}`);
      return null;
    }

    // ─────────────────────────────────────────────
    // 1. PARSE HTML (skip parsing if we only have plain text from PDF)
    // ─────────────────────────────────────────────

    // Detect bot/CAPTCHA challenge pages before any parsing
    const botBlocked = raw_html ? isBotProtectedHtml(raw_html) : false;
    if (botBlocked) {
      logger.warn(`🤖 [scrapeReference] Bot-protection challenge detected for ${url} — will use domain as publisher`);
    }

    const $ = raw_html ? cheerio.load(htmlContent) : null;

    // ─────────────────────────────────────────────
    // 2. EXTRACT METADATA: title, authors, publisher
    // ─────────────────────────────────────────────

    // Use provided title (from PDF metadata) or extract from HTML/text
    let finalTitle = title || ($? await getMainHeadline($) : null) || "AI Reference";

    // If no title and we have raw_text (PDF), extract from first line
    if ((!finalTitle || finalTitle === "AI Reference" || finalTitle.length < 3) && raw_text && !raw_html) {
      const lines = raw_text.split('\n').map(l => l.trim()).filter(Boolean);
      // Use first substantial line as title (skip very short lines)
      for (const line of lines) {
        if (line.length > 10 && line.length < 200) {
          finalTitle = `[PDF] ${line}`;
          break;
        }
      }
    }

    if (!finalTitle || finalTitle.length < 3) {
      finalTitle = ($? await getMainHeadline($) : null) || "AI Reference";
    }

    // If we're on a bot-blocked page, the extracted title would be the challenge page
    // title ("reCAPTCHA", "Just a moment…", etc.) — replace it with a meaningful fallback.
    if (botBlocked && /recaptcha|just a moment|checking your browser|attention required|access denied|ddos.guard|cloudflare/i.test(finalTitle)) {
      const domain = domainFromUrl(url);
      finalTitle = `[Bot Protected] ${domain || url.slice(0, 80)}`;
      logger.warn(`🤖 [scrapeReference] Replaced challenge page title with: "${finalTitle}"`);
    }

    // Use provided authors (from PDF metadata) or extract from HTML.
    // Skip author extraction on bot-blocked pages — the HTML has no real content.
    // If none found inline, follow author profile links on the page to get the name.
    let authors = providedAuthors || ($ && !botBlocked ? await extractAuthors($) : []);
    if (!authors.length && $ && !botBlocked && url) {
      const profileAuthors = await followProfileLinks($, url);
      if (profileAuthors.length) authors = profileAuthors;
    }
    // For HTML: use cheerio-based extractor. For PDFs (raw_text only): scan first-page lines.
    // Skip HTML publisher extraction on bot-blocked pages — would pick up "reCAPTCHA" etc.
    let publisher = ($ && !botBlocked) ? await extractPublisher($, url) : (() => {
      const lines = (raw_text || "").replace(/\r/g, "").slice(0, 4000)
        .split(/\n+/).map(s => s.trim()).filter(s => s.length > 3);
      const name = choosePdfPublisher({}, lines);
      return name ? { name } : repositoryPublisherFromUrl(url);
    })();

    // Domain fallback: if no publisher extracted (snippet-only Tavily text, bot-blocked page,
    // or PDF with no metadata), use the URL hostname. This ensures PubMed, NIH, etc.
    // get a publisher name even when we can't parse their HTML, and prevents bot-challenge
    // publisher names like "reCAPTCHA" from reaching the enrichment pipeline.
    if (!publisher?.name || publisher.name === "Unknown Publisher") {
      const domain = domainFromUrl(url);
      if (domain && domain.length > 3) {
        publisher = { name: domain };
        logger.log(`🌐 [scrapeReference] Using domain fallback publisher: "${domain}"`);
      }
    }

    // For Facebook URLs: extract the linked article domain from the raw HTML
    // using regex. The extension sends the full page HTML even when text
    // extraction fails, so we can find the linked domain here without a live DOM.
    // Do this BEFORE the social-name override so the article domain wins.
    if (/facebook\.com/i.test(url) && raw_html && !linked_publisher) {
      let extractedUrl = null;
      let extractedDomain = null;
      const SKIP = /^(facebook|fbcdn|instagram|messenger|whatsapp|adobe|google|apple|amazon|akamai|cloudfront|googleapis|gstatic|youtube|twitter|tiktok|snapchat|pinterest|linkedin)\./i;

      const tryUrl = (rawUrl) => {
        try {
          const u = new URL(rawUrl.replace(/\\/g, ''));
          if (!u.hostname.includes('facebook.com') && !u.hostname.includes('fbcdn.net') && !SKIP.test(u.hostname)) {
            return { url: u.href, domain: u.hostname.replace(/^www\./, '') };
          }
        } catch {}
        return null;
      };

      let m;

      // Pattern 2: data-lynx-uri attribute — Facebook adds this to links in post text
      if (!extractedDomain) {
        const lynxRe = /data-lynx-uri="(https?:\/\/[^"]+)"/gi;
        while (!extractedDomain && (m = lynxRe.exec(raw_html)) !== null) {
          const result = tryUrl(m[1]);
          if (result) { extractedUrl = result.url; extractedDomain = result.domain; }
        }
      }

      // Pattern 3: Facebook's GraphQL/JSON embedded in page — "url":"https://..." for story attachments.
      // Keyed on "url" or "link" within 200 chars of "attachment" to stay on-topic.
      if (!extractedDomain) {
        const attachRe = /attachments?[^}]{0,200}"(?:url|link|href)"\s*:\s*"(https?:\\?\/\\?\/[^"]{10,300})"/gi;
        while (!extractedDomain && (m = attachRe.exec(raw_html)) !== null) {
          const result = tryUrl(m[1]);
          if (result) { extractedUrl = result.url; extractedDomain = result.domain; }
        }
      }

      // Pattern 4: "display_url" JSON key — Facebook embeds the link preview domain here
      if (!extractedDomain) {
        const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?\.[a-z]{2,}(?:\.[a-z]{2,})?$/i;
        const displayUrlRe = /"display_url"\s*:\s*"([^"]{4,100})"/gi;
        while (!extractedDomain && (m = displayUrlRe.exec(raw_html)) !== null) {
          const text = m[1].trim().replace(/\\/g, '');
          if (DOMAIN_RE.test(text) && !SKIP.test(text + '.')) {
            extractedDomain = text.toLowerCase();
          }
        }
      }

      if (extractedDomain) {
        logger.log(`🔗 [scrapeReference] Extracted linked publisher from raw HTML: ${extractedDomain}${extractedUrl ? ` (${extractedUrl.slice(0,80)})` : ''}`);
        linked_publisher = extractedDomain;
        // Strip tracking params (fbclid, utm_*) from the linked URL before storing
        if (extractedUrl) {
          try {
            const u = new URL(extractedUrl);
            ['fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','mc_cid','mc_eid'].forEach(p => u.searchParams.delete(p));
            if ([...u.searchParams].length === 0) u.search = '';
            extractedUrl = u.href;
          } catch {}
        }
        linked_url = linked_url || extractedUrl || null;
        publisher = { name: extractedDomain };

        // Recursively resolve the publisher by following the article chain.
        // Use the full article URL when we have one; fall back to the root domain (Pattern 4 only gets a domain).
        const chainUrl = extractedUrl || `https://${extractedDomain}`;
        {
          const resolved = await resolvePublisherChain(chainUrl, 0, query);
          if (resolved?.name && !JUNK_PUBLISHER_RE.test(resolved.name)) {
            publisher = resolved;
            logger.log(`📰 [scrapeReference] Resolved publisher chain → "${resolved.name}"`);
          }
        }
      }
    }

    // Social URLs (Facebook groups/pages) carry the publisher in the URL itself —
    // override the generic HTML result when the URL is more informative.
    // Only apply when no linked article domain was extracted above.
    const socialName = parseSocialPublisher(url);
    if (socialName && (!publisher?.name || publisher.name === "Unknown Publisher")) {
      publisher = { name: socialName };
    }

    // Never persist a bare social platform name ("Facebook", "Twitter/X") as a
    // publisher when a linked article domain was found — the platform is not the publisher.
    if (linked_publisher && publisher?.name && /^(facebook|twitter|instagram|tiktok|youtube|reddit)$/i.test(publisher.name)) {
      publisher = { name: linked_publisher };
    }

    // Extract thumbnail
    let thumbnail = "";
    const isPdf = !raw_html && raw_text; // PDF if we have text but no HTML

    if (isPdf) {
      // TODO: For PDFs scraped from extension, we need to pass the blob to thumbnail generator
      // For now, skip thumbnail generation (would need to refetch PDF which might be blocked)
      logger.log(`🖼️  [scrapeReference] Skipping PDF thumbnail (would require re-fetching blocked PDF)`);
    } else if ($) {
      // For HTML pages, extract image from page
      thumbnail = getBestImage($, url) || "";
      if (thumbnail) {
        logger.log(`🖼️  [scrapeReference] Extracted thumbnail: ${thumbnail.slice(0, 80)}...`);
      }
    }

    // ─────────────────────────────────────────────
    // 3. EXTRACT CLEAN TEXT
    // ─────────────────────────────────────────────

    let text;
    if (raw_html) {
      // Extract clean text from HTML
      $("script, style, link").remove();
      let cleanText = $.text().trim();
      if (cleanText.length > 60000) {
        cleanText = cleanText.slice(0, 60000);
      }
      text = cleanText;
    } else {
      // Use raw_text directly (for PDFs)
      text = raw_text.slice(0, 60000);
    }

    // ─────────────────────────────────────────────
    // 4. CREATE REFERENCE CONTENT ROW
    // ─────────────────────────────────────────────

    const referenceContentId = await createContentInternal(query, {
      content_name: finalTitle,
      url,
      media_source: platform || (isPdf ? "pdf" : /facebook\.com|fb\.com/i.test(url) ? "facebook" : /youtube\.com|youtu\.be/i.test(url) ? "youtube" : "web"),
      topic: "AI Evidence",
      subtopics: [],
      taskContentId, // passing this is what creates the content_relations link
      thumbnail,
      details: text.slice(0, 500),
      platform,
      distribution_channel,
      linked_url,
      linked_publisher,
    });

    logger.log(
      `✅ [scrapeReference] Created reference content_id=${referenceContentId} for ${url}`
    );

    let publisherLink = null;
    try {
      publisherLink = await ensureReferencePublisherLink(query, { referenceContentId, url, publisher });
    } catch (err) {
      logger.warn(`⚠️  [scrapeReference] Publisher link skipped: ${err.message}`);
    }

    // ─────────────────────────────────────────────
    // 5. PUBLISHER ENRICH + ADMIRALTY (fire-and-forget)
    // ─────────────────────────────────────────────
    // Uses the same code path as SourceDetailModal's "Enrich & Link":
    //   InsertOrGetPublisher → enrichPublisherIfNeeded → evaluateAdmiraltyCode
    // Runs async — never delays or blocks the scrape return.
    (async () => {
      try {
        const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../services/admiraltyEvaluator.js");
        const { enrichPublisherIfNeeded } = await import("../../services/publisherEnrichmentService.js");

        if (!publisherLink?.publisherId) {
          logger.warn(`⚠️  [scrapeReference] No linked publisher for ${url} — skipping enrichment`);
          return;
        }

        // ── 3. Enrich publisher — AllSides, Ad Fontes, Wikipedia ─────────────
        //    Force re-enrichment if no admiralty code exists yet — ensures content
        //    that was previously stored with a poor publisher name gets a proper evaluation.
        const enrichResult = await enrichPublisherIfNeeded({
          query,
          publisherId: publisherLink.publisherId,
          publisherName: publisherLink.publisherName,
          domain: null,
          sourceUrl: url,
          force: publisherLink.needsAdmiralty,
          context: "case_content",
        });
        logger.log(`📚 [scrapeReference] Publisher enriched: "${publisherLink.publisherName}" id=${publisherLink.publisherId} status=${enrichResult?.status ?? 'done'}`);

        // ── 4. Re-query freshly written publisher data for admiralty eval ─────
        const [profileRows, ratingRows] = await Promise.all([
          query(
            `SELECT source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`,
            [publisherLink.publisherId]
          ),
          query(
            `SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence
               FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`,
            [publisherLink.publisherId]
          ),
        ]);

        const dbSourceType = profileRows[0]?.source_type || null;
        const existingSourceRatings = ratingRows;

        // ── 5. Provider lookup for admiralty signals ─────────────────────────
        const { lookupPublisherAllProviders } = await import("../../services/sourceProviders/sourceProviderRegistry.js");
        const providerResults = await lookupPublisherAllProviders({
          sourceUrl: url,
          publisherName: publisherLink.publisherName,
        });

        // ── 6. Evaluate and store admiralty code ─────────────────────────────
        const evaluation = await evaluateAdmiraltyCode({
          sourceUrl: url,
          publisherName: publisherLink.publisherName,
          sourceIdentity: {
            sourceType:      dbSourceType || undefined,
            resolutionLevel: 3, // publisher is now definitively in DB
          },
          existingSourceRatings,
          providerResults,
        });

        await storeEvaluation(query, {
          targetType: "content",
          targetId:   referenceContentId,
          sourceUrl:  url,
          publisherId: publisherLink.publisherId,
          evaluation,
        });
        logger.log(`🛡  [scrapeReference] Admiralty ${evaluation.admiraltyCode} stored for content ${referenceContentId} publisher="${publisherLink.publisherName}" id=${publisherLink.publisherId}`);
      } catch (err) {
        logger.warn(`⚠️  [scrapeReference] Publisher enrichment/admiralty skipped: ${err.message}`);
      }
    })();

    // ─────────────────────────────────────────────
    // 6. RETURN STRUCTURED OUTPUT
    // ─────────────────────────────────────────────

    return {
      referenceContentId,
      url,
      title: finalTitle,
      text,
      authors,
      publisher,
    };
  } catch (err) {
    logger.error("❌ [scrapeReference] Fatal error on:", url, err);
    return null;
  }
}
