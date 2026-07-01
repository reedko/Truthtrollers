// backend/src/utils/getBestImage.js
// Extract the best thumbnail image from HTML

/**
 * Extract the best thumbnail image from HTML
 * Priority: og:image > largest img with width/height > first processable img > author avatar (for Substack)
 */
export function getBestImage($, baseUrl) {
  const isSubstack = baseUrl.includes('substack.com');

  // 1. Try og:image first
  let ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    ogImage = resolveUrl(ogImage, baseUrl);
    if (isProcessableImage(ogImage)) {
      return ogImage;
    }
  }

  // 2. Try twitter:image
  let twitterImage = $('meta[name="twitter:image"]').attr("content");
  if (twitterImage) {
    twitterImage = resolveUrl(twitterImage, baseUrl);
    if (isProcessableImage(twitterImage)) {
      return twitterImage;
    }
  }

  // 3. Find largest image with explicit dimensions
  let maxArea = 0;
  let chosenImage = null;

  $("img").each((_, img) => {
    let src = $(img).attr("src") || "";
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
    let src = $(img).attr("src") || "";
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
 * Resolve relative URLs to absolute
 */
function resolveUrl(urlStr, baseUrl) {
  try {
    if (!urlStr) return "";
    // Already absolute
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      return urlStr;
    }
    // Protocol-relative
    if (urlStr.startsWith("//")) {
      return `https:${urlStr}`;
    }
    // Relative to base
    const resolved = new URL(urlStr, baseUrl);
    return resolved.href;
  } catch (err) {
    return "";
  }
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
  ];

  for (const pattern of badPatterns) {
    if (lowerSrc.includes(pattern)) return false;
  }

  // Must be image extension
  if (
    !lowerSrc.match(/\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i)
  ) {
    return false;
  }

  return true;
}
