/**
 * URL Canonicalization Service
 * Normalizes URLs to a consistent format for caching and comparison
 */

// Sensitive domains where we should NEVER check passively
const SENSITIVE_DOMAINS = new Set([
  // Banking & Finance
  'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com',
  'paypal.com', 'venmo.com', 'stripe.com', 'square.com',
  'americanexpress.com', 'discover.com', 'capitalone.com',

  // Email
  'gmail.com', 'outlook.com', 'yahoo.com', 'protonmail.com',
  'mail.google.com', 'outlook.live.com',

  // Health
  'healthcare.gov', 'mychart.', 'patient.', 'health.',

  // Cloud Docs
  'docs.google.com', 'drive.google.com', 'dropbox.com',
  'onedrive.live.com', 'icloud.com',

  // Internal/Admin
  'localhost', '127.0.0.1', 'admin.', 'dashboard.',

  // Social Media Private Areas
  'facebook.com/messages', 'messenger.com', 'mail.',

  // Password managers
  '1password.com', 'lastpass.com', 'bitwarden.com',
]);

// Blocked protocols that we should never touch
const BLOCKED_PROTOCOLS = new Set([
  'chrome:', 'about:', 'file:', 'moz-extension:',
  'chrome-extension:', 'edge:', 'devtools:'
]);

// Common tracking parameters to strip
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'source'
]);

/**
 * Check if a URL should be ignored for privacy/security reasons
 */
export function isSensitiveUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Check protocol
    if (BLOCKED_PROTOCOLS.has(urlObj.protocol)) {
      return true;
    }

    // Check domain
    const hostname = urlObj.hostname.toLowerCase();
    for (const sensitive of SENSITIVE_DOMAINS) {
      if (hostname.includes(sensitive)) {
        return true;
      }
    }

    // Check for sign-in pages
    const path = urlObj.pathname.toLowerCase();
    if (path.includes('/signin') ||
        path.includes('/login') ||
        path.includes('/auth') ||
        path.includes('/password') ||
        path.includes('/checkout') ||
        path.includes('/payment')) {
      return true;
    }

    return false;
  } catch {
    // Invalid URL - treat as sensitive
    return true;
  }
}

/**
 * Canonicalize a URL to a consistent format
 * Returns null if the URL should be ignored
 */
export function canonicalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);

    // Block sensitive protocols
    if (BLOCKED_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    // Check if sensitive domain/path
    if (isSensitiveUrl(rawUrl)) {
      return null;
    }

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
  } catch {
    return null;
  }
}

/**
 * Hash a canonical URL using SHA-256
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
