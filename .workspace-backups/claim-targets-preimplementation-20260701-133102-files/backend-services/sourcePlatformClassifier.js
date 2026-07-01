// backend/services/sourcePlatformClassifier.js
// Platform host detection — pure function, no DB, no I/O.
// Returns classification info for known hosting platforms.

// Reserved path segments that are platform UI routes, not publisher account names.
const FACEBOOK_RESERVED = new Set([
  "groups", "events", "pages", "marketplace", "watch", "gaming", "video",
  "story", "stories", "hashtag", "search", "help", "ads", "reel", "reels",
  "profile.php", "sharer", "dialog", "plugins", "login", "signup", "share",
  "photo", "photos", "media", "live", "discover", "notifications", "messages",
]);

const TWITTER_RESERVED = new Set([
  "home", "explore", "notifications", "messages", "search", "settings",
  "hashtag", "i", "intent", "share", "login", "signup", "tos", "privacy",
]);

const INSTAGRAM_RESERVED = new Set([
  "explore", "p", "reel", "reels", "stories", "tv", "accounts",
  "privacy", "login", "challenge", "direct", "live",
]);

const GITHUB_RESERVED = new Set([
  "topics", "trending", "explore", "marketplace", "features", "pricing",
  "login", "signup", "organizations", "collections", "about", "contact",
  "security", "enterprise", "settings", "notifications",
]);

const PLATFORMS = {
  "youtube.com":       { name: "YouTube",         type: "platform", acctRe: /\/(?:channel|c|user|@)\/([^/?#]+)/ },
  "youtu.be":          { name: "YouTube",         type: "platform", acctRe: /^\/([^/?#]+)/ },
  "twitter.com":       { name: "Twitter/X",       type: "social",   acctRe: /^\/([^/?#]+)/, reserved: TWITTER_RESERVED },
  "x.com":             { name: "Twitter/X",       type: "social",   acctRe: /^\/([^/?#]+)/, reserved: TWITTER_RESERVED },
  "facebook.com":      { name: "Facebook",        type: "social",   acctRe: /^\/([^/?#]+)/, reserved: FACEBOOK_RESERVED },
  "instagram.com":     { name: "Instagram",       type: "social",   acctRe: /^\/([^/?#]+)/, reserved: INSTAGRAM_RESERVED },
  "tiktok.com":        { name: "TikTok",          type: "social",   acctRe: /^\/@([^/?#]+)/ },
  "reddit.com":        { name: "Reddit",          type: "platform", acctRe: /\/r\/([^/?#]+)/ },
  "medium.com":        { name: "Medium",          type: "opinion",  acctRe: /^\/@([^/?#]+)/ },
  "wikipedia.org":     { name: "Wikipedia",       type: "reference",acctRe: null },
  "web.archive.org":   { name: "Wayback Machine", type: "reference",acctRe: null },
  "archive.org":       { name: "Archive.org",     type: "reference",acctRe: null },
  "substack.com":      { name: "Substack",        type: "opinion",  acctRe: null },
  "github.com":        { name: "GitHub",          type: "reference",acctRe: /^\/([^/?#]+)/, reserved: GITHUB_RESERVED },
  "docs.google.com":   { name: "Google Docs",     type: "reference",acctRe: null },
  "drive.google.com":  { name: "Google Drive",    type: "reference",acctRe: null },
  "rumble.com":        { name: "Rumble",          type: "platform", acctRe: /^\/c\/([^/?#]+)/ },
  "vimeo.com":         { name: "Vimeo",           type: "platform", acctRe: /^\/([^/?#]+)/ },
  "bitchute.com":      { name: "BitChute",        type: "platform", acctRe: /\/channel\/([^/?#]+)/ },
  "odysee.com":        { name: "Odysee",          type: "platform", acctRe: /^\/@([^/?#]+)/ },
};

function humanizeAccountLabel(value) {
  return String(value || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function extractAccount(def, url) {
  const { acctRe, reserved } = def;
  if (!acctRe || !url) return null;
  try {
    const path = new URL(url).pathname;
    const facebookGroup = path.match(/^\/groups\/([^/?#]+)/i);
    if (def.name === "Facebook" && facebookGroup) {
      const slug = decodeURIComponent(facebookGroup[1]);
      return /^\d+$/.test(slug)
        ? `Facebook Group ${slug}`
        : humanizeAccountLabel(slug);
    }
    const m = path.match(acctRe);
    if (!m) return null;
    const account = decodeURIComponent(m[1]).replace(/^@/, "");
    // Reject platform reserved paths (groups, events, etc.) — not real account names
    if (reserved?.has(account.toLowerCase())) return null;
    return humanizeAccountLabel(account);
  } catch {
    return null;
  }
}

/**
 * Classify a URL as platform-hosted and extract the account/channel name.
 * Returns:
 *   { isPlatform: false } for non-platform URLs
 *   { isPlatform: true, platformName, accountName, sourceType } for platform URLs
 */
export function classifyPlatform(rootDomain, normalizedUrl) {
  // Direct match
  const def = PLATFORMS[rootDomain];
  if (def) {
    return {
      isPlatform: true,
      platformName: def.name,
      accountName: extractAccount(def, normalizedUrl),
      sourceType: def.type,
    };
  }

  // Substack newsletters live on subdomain.substack.com
  if (rootDomain.endsWith(".substack.com")) {
    const newsletter = rootDomain.replace(/\.substack\.com$/, "");
    return { isPlatform: true, platformName: "Substack", accountName: newsletter, sourceType: "opinion" };
  }

  // Wikipedia language subdomains (en.wikipedia.org, etc.)
  if (rootDomain.endsWith(".wikipedia.org")) {
    return { isPlatform: true, platformName: "Wikipedia", accountName: null, sourceType: "reference" };
  }

  return { isPlatform: false, platformName: null, accountName: null, sourceType: "unknown" };
}
