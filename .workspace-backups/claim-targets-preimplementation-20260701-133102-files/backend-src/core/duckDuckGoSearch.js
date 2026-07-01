// backend/src/core/duckDuckGoSearch.js
// DuckDuckGo search for finding fringe/low-quality sources
// Less filtered than Tavily/Bing - better for finding conspiracy sites, propaganda, etc.

import fetch from "node-fetch";
import logger from "../utils/logger.js";

/**
 * DuckDuckGo Instant Answer API (free, no API key needed)
 * Note: This is less comprehensive than their paid API, but works for fringe discovery
 */
async function searchDuckDuckGo({ query, topK = 10 }) {
  try {
    logger.log(`🦆 [DuckDuckGo] Searching for: ${query}`);

    // DuckDuckGo HTML scraping approach (since free API is limited)
    // We'll use their HTML search and parse results
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`⚠️ [DuckDuckGo] Search failed: ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Parse DuckDuckGo HTML results
    const results = parseDuckDuckGoHTML(html);

    // Format results to match our search interface
    const formattedResults = results.slice(0, topK).map((result, index) => ({
      id: result.url,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      score: 1.0 - (index * 0.05), // Decay score by position
      publishedAt: null, // DDG doesn't provide dates easily
      domain: extractDomain(result.url),
      source: 'duckduckgo',
    }));

    logger.log(`✅ [DuckDuckGo] Found ${formattedResults.length} results`);
    return formattedResults;

  } catch (err) {
    logger.error(`❌ [DuckDuckGo] Search error:`, err.message);
    return [];
  }
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseDuckDuckGoHTML(html) {
  const results = [];

  try {
    // DuckDuckGo HTML structure uses specific classes
    // This is a simple regex-based parser (could use cheerio for more robust parsing)

    // Match result blocks
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]+)<\/a>/g;

    let match;
    while ((match = resultPattern.exec(html)) !== null) {
      const [, url, title, snippet] = match;

      // Decode HTML entities
      const decodedUrl = decodeURIComponent(url);
      const decodedTitle = decodeHTML(title);
      const decodedSnippet = decodeHTML(snippet);

      results.push({
        url: decodedUrl,
        title: decodedTitle,
        snippet: decodedSnippet,
      });

      if (results.length >= 20) break; // Limit parsing
    }

  } catch (err) {
    logger.error(`❌ [DuckDuckGo] HTML parsing error:`, err.message);
  }

  return results;
}

/**
 * Simple HTML entity decoder
 */
function decodeHTML(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Generate fringe-seeking queries based on claim type
 */
function generateFringeQueries(claimText, claimType = null) {
  const baseQueries = [
    `${claimText} hoax`,
    `${claimText} false flag`,
    `${claimText} debunked`,
    `${claimText} conspiracy`,
  ];

  // Claim-type specific fringe queries
  const typeSpecificQueries = {
    antisemitism: [
      `site:gab.com ${claimText}`,
      `site:bitchute.com ${claimText}`,
      `"antisemitism myth" ${claimText}`,
      `"Jewish victimhood" ${claimText}`,
    ],
    vaccines: [
      `site:naturalnews.com ${claimText}`,
      `site:childrenshealthdefense.org ${claimText}`,
      `"vaccine dangers" ${claimText}`,
      `"big pharma coverup" ${claimText}`,
    ],
    climate: [
      `site:wattsupwiththat.com ${claimText}`,
      `site:climatedepot.com ${claimText}`,
      `"climate hoax" ${claimText}`,
      `"global warming fraud" ${claimText}`,
    ],
    election: [
      `site:thegatewaypundit.com ${claimText}`,
      `"election fraud" ${claimText}`,
      `"rigged election" ${claimText}`,
    ],
    covid: [
      `site:naturalnews.com ${claimText}`,
      `site:theepochtimes.com ${claimText}`,
      `"covid hoax" ${claimText}`,
      `"plandemic" ${claimText}`,
    ],
  };

  const specific = typeSpecificQueries[claimType] || [];
  return [...baseQueries, ...specific];
}

/**
 * Detect claim type from text (simple keyword matching)
 */
function detectClaimType(claimText) {
  const text = claimText.toLowerCase();

  if (text.match(/antisemit|jewish|jew|israel|zion/)) return 'antisemitism';
  if (text.match(/vaccine|vax|immuniz/)) return 'vaccines';
  if (text.match(/climate|global warming|carbon|emissions/)) return 'climate';
  if (text.match(/election|vote|ballot|fraud/)) return 'election';
  if (text.match(/covid|coronavirus|pandemic/)) return 'covid';
  if (text.match(/pesticide|herbicide|glyphosate/)) return 'pesticides';

  return null;
}

export const duckDuckGoSearch = {
  web: searchDuckDuckGo,
  generateFringeQueries,
  detectClaimType,
};
