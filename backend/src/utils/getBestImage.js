// backend/src/utils/getBestImage.js
// Extract the best thumbnail image from HTML

/**
 * Extract the best thumbnail image from HTML
 * Priority: social metadata > largest img with width/height > first processable img > author avatar (for Substack)
 */
export function getBestImage($, baseUrl) {
  const isSubstack = baseUrl.includes('substack.com');

  // 1. Prefer explicit social-preview metadata. Sites use several equivalent keys.
  const metadataSelectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[property="twitter:image"]',
    'link[rel="image_src"]',
  ];
  for (const selector of metadataSelectors) {
    const raw = selector.startsWith('link')
      ? $(selector).first().attr('href')
      : $(selector).first().attr('content');
    const resolved = resolveUrl(raw, baseUrl);
    if (isProcessableImage(resolved)) return resolved;
  }

  // 3. Find largest image with explicit dimensions
  let maxArea = 0;
  let chosenImage = null;

  $("img").each((_, img) => {
    let src = getImageSource($, img);
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;

    if (src) {
      src = resolveUrl(src, baseUrl);
      if (area > maxArea && isProcessableImage(src)) {
        maxArea = area;
        chosenImage = src;
      }
    }
  });

  if (chosenImage) return chosenImage;

  // 4. Fallback: first processable image
  let firstImage = null;
  $("img").each((_, img) => {
    let src = getImageSource($, img);
    if (src) {
      src = resolveUrl(src, baseUrl);
      if (isProcessableImage(src)) {
        firstImage = src;
        return false; // break
      }
    }
  });

  if (firstImage) return firstImage;

  // 5. Substack-specific: Use author avatar if no other image found
  if (isSubstack) {
    let authorAvatar = null;
    $("img").each((_, img) => {
      let src = $(img).attr("src") || "";
      const lowerSrc = src.toLowerCase();

      // Look for Substack author avatar patterns
      if (src && (lowerSrc.includes('avatar') || lowerSrc.includes('profile'))) {
        src = resolveUrl(src, baseUrl);
        // Check it's a valid image format but skip other bad patterns
        if (src.match(/\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i)) {
          authorAvatar = src;
          return false; // break
        }
      }
    });

    if (authorAvatar) return authorAvatar;
  }

  return null;
}

/**
 * Select the first usable image URL supplied by a search provider.
 * Tavily can return image strings or { url, description } objects.
 */
export function getBestImageFromCandidates(candidates, baseUrl) {
  if (!Array.isArray(candidates)) return null;

  for (const candidate of candidates) {
    const raw = typeof candidate === "string" ? candidate : candidate?.url;
    const resolved = resolveUrl(raw, baseUrl);
    if (isProcessableImage(resolved)) return resolved;
  }

  return null;
}

/**
 * Resolve relative URLs to absolute
 */
function resolveUrl(urlStr, baseUrl) {
  try {
    if (!urlStr) return "";
    const cleaned = String(urlStr).trim();
    // Reject metadata containing more than one URL, a pattern seen in malformed og:image values.
    if ((cleaned.match(/https?:\/\//gi) || []).length > 1) return "";
    const resolved = new URL(cleaned, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return "";
    return resolved.href;
  } catch (err) {
    return "";
  }
}

function getImageSource($, img) {
  const element = $(img);
  const src = element.attr('src') || '';
  if (src && !src.startsWith('data:') && !src.startsWith('blob:')) return src;

  const lazySource =
    element.attr('data-src') ||
    element.attr('data-lazy-src') ||
    element.attr('data-original');
  if (lazySource) return lazySource;

  const srcset = element.attr('srcset') || element.attr('data-srcset') || '';
  const candidates = srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
  return candidates.at(-1) || '';
}

/**
 * Check if image URL is processable (not icon/logo/spacer/etc)
 */
function isProcessableImage(src) {
  if (!src) return false;

  const lowerSrc = src.toLowerCase();

  // Skip common icon/logo/tracking images
  const badPatterns = [
    "logo",
    "icon",
    "favicon",
    "sprite",
    "blank",
    "spacer",
    "pixel",
    "1x1",
    "tracking",
    "avatar",
    "badge",
    "button",
    "us_flag",
    "noscript",
    "gbc-footer",
    "action-bookmark",
    "/search.svg",
    "bluesky_",
    "nyc_white",
  ];

  for (const pattern of badPatterns) {
    if (lowerSrc.includes(pattern)) return false;
  }

  // Modern image CDNs commonly omit a filename extension. The downloader verifies
  // the response Content-Type before handing bytes to Sharp.
  try {
    return ['http:', 'https:'].includes(new URL(src).protocol);
  } catch {
    return false;
  }
}
