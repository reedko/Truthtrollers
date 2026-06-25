// backend/src/utils/parseSocialPublisher.js
// ──────────────────────────────────────────────────────────────────
// Extract a meaningful publisher label from social-media URLs.
// Called before/after HTML meta-extraction so the URL is the ground truth.

const FB_RESERVED = new Set([
  "pages", "permalink", "photo", "photos", "video", "videos",
  "events", "profile", "groups", "watch", "marketplace", "gaming",
  "stories", "notifications", "friends", "messages",
]);

function humanizeFacebookLabel(value) {
  return String(value || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function inferFacebookChannelFromText(text) {
  const bad = new Set([
    "facebook", "like", "comment", "share", "follow", "see more", "join group",
    "notifications", "public group", "private group", "author", "admin",
  ]);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && line.length <= 80);
  for (const line of lines.slice(0, 40)) {
    const cleaned = line.replace(/\s+/g, " ").trim();
    const lower = cleaned.toLowerCase();
    if (bad.has(lower)) continue;
    if (/^facebook group \d+$/i.test(cleaned)) continue;
    if (/^[A-Z0-9][A-Z0-9 &'’.-]{2,}$/.test(cleaned) && /[A-Z]{2}/.test(cleaned)) {
      return humanizeFacebookLabel(cleaned);
    }
  }
  return null;
}

/**
 * parseFacebookMeta(url) → { platform, channel, publisherLabel }
 *
 * Extracts the distribution-layer metadata from a Facebook URL:
 *   platform       — always "facebook"
 *   channel        — human-readable group/page name (slug → spaces), or null
 *   publisherLabel — what to use as media_source when no external article is found
 *
 * facebook.com/groups/{slug}/...  → channel = slug (underscores → spaces)
 * facebook.com/groups/{numericId} → channel = "Facebook Group {id}"
 * facebook.com/{page}/posts/...   → channel = page name
 * Anything else                   → channel = null
 */
export function parseFacebookMeta(url) {
  try {
    const { pathname } = new URL(url);

    const groupMatch = pathname.match(/^\/groups\/([^/]+)/i);
    if (groupMatch) {
      const slug = groupMatch[1];
      const channel = /^\d+$/.test(slug)
        ? `Facebook Group ${slug}`
        : humanizeFacebookLabel(slug);
      return { platform: "facebook", channel, publisherLabel: channel };
    }

    const pageMatch = pathname.match(/^\/([^/]+)\/posts\//i);
    if (pageMatch && !FB_RESERVED.has(pageMatch[1].toLowerCase())) {
      const channel = humanizeFacebookLabel(pageMatch[1]);
      return { platform: "facebook", channel, publisherLabel: channel };
    }
  } catch { /* bad URL */ }
  return { platform: "facebook", channel: null, publisherLabel: "Facebook" };
}

/**
 * parseFacebookPublisher(url) → human-readable publisher string (legacy wrapper)
 * Kept for backward compatibility — prefer parseFacebookMeta for new code.
 */
export function parseFacebookPublisher(url) {
  return parseFacebookMeta(url).publisherLabel;
}

/**
 * parseSocialPublisher(url) → publisher label for any social URL, or null.
 * Returns null for non-social URLs so callers can fall through to HTML extraction.
 */
export function parseSocialPublisher(url) {
  if (!url) return null;
  if (/facebook\.com|fb\.com/i.test(url)) return parseFacebookPublisher(url);
  return null;
}

/**
 * parseSocialMeta(url) → { platform, channel, publisherLabel } or null.
 * Returns null for non-social URLs.
 */
export function parseSocialMeta(url) {
  if (!url) return null;
  if (/facebook\.com|fb\.com/i.test(url)) return parseFacebookMeta(url);
  return null;
}
