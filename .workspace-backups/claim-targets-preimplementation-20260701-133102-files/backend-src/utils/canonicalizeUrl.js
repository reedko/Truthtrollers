// backend/src/utils/canonicalizeUrl.js
// URL canonicalization utilities (server-side)
import crypto from 'crypto';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'source'
]);

/**
 * Canonicalize a URL to a consistent format
 * Must match the client-side implementation exactly
 */
export function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    // Remove hash fragment
    url.hash = "";

    // Filter and sort query parameters
    const params = [...url.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !TRACKING_PARAMS.has(lower);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    // Rebuild search params
    url.search = "";
    for (const [k, v] of params) {
      url.searchParams.append(k, v);
    }

    // Normalize hostname to lowercase
    url.hostname = url.hostname.toLowerCase();

    // Remove default ports
    if ((url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    // Remove trailing slash from pathname (except root)
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch (err) {
    return null;
  }
}

/**
 * Hash a canonical URL using SHA-256
 */
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Canonicalize and hash a URL in one step
 */
export function canonicalizeAndHash(rawUrl) {
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) return { canonical: null, hash: null };

  const hash = sha256Hex(canonical);
  return { canonical, hash };
}
