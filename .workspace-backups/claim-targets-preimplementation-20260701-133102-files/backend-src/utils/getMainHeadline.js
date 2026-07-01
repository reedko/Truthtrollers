// backend/src/utils/getMainHeadline.js
// ─────────────────────────────────────────────
// Extract main headline/title from HTML
// Ported from extension/src/services/getMainHeadline.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

/**
 * getMainHeadline($)
 *
 * Extracts the main headline from the page in order of priority:
 * 1. <title> tag (if not generic)
 * 2. H1 tags (non-navigation)
 * 3. H2 tags (non-navigation)
 * 4. Elements with headline/title in class/id
 * 5. Fallback to <title>
 *
 * Returns: string | null
 */
export async function getMainHeadline($) {
  try {
    let mainHeadline = null;

    // 🔹 Step 0: Prefer the document <title> from <head>
    const pageTitle = $("title").first().text().trim();
    if (pageTitle && pageTitle.toLowerCase() !== "bookshelf") {
      return pageTitle;
    }

    // Step 1: Prioritize H1 and H2
    const headings = $("h1, h2").filter((_, heading) => {
      const classes = $(heading).attr("class") || "";
      const id = $(heading).attr("id") || "";
      return (
        !classes.toLowerCase().includes("navigat") &&
        !id.toLowerCase().includes("navigat") &&
        !classes.toLowerCase().includes("hidden") &&
        !id.toLowerCase().includes("hidden")
      );
    });

    headings.each((_, heading) => {
      if ($(heading).prop("tagName") === "H1") {
        mainHeadline = $(heading).text().trim(); // Prefer H1
        return false; // Break out of `.each()`
      } else if (!mainHeadline && $(heading).prop("tagName") === "H2") {
        mainHeadline = $(heading).text().trim(); // Fallback to H2
      }
    });

    // Step 2: If no valid H1 or H2, check headline divs
    if (!mainHeadline) {
      const headlineDivs = $(
        '*[class*="headline"], *[id*="headline"], *[data-testid*="headline"], *[class*="title"]'
      ).filter((_, div) => {
        const element = $(div);
        const classes = element.attr("class") || "";
        const id = element.attr("id") || "";
        return (
          !classes.toLowerCase().includes("navigat") &&
          !id.toLowerCase().includes("navigat") &&
          !classes.toLowerCase().includes("hidden") &&
          !id.toLowerCase().includes("hidden")
        );
      });

      headlineDivs.each((_, div) => {
        const innerText = extractInnermostText($, div);
        if (innerText && innerText.toLowerCase() !== "bookshelf") {
          mainHeadline = innerText;
          return false; // Break out of `.each()`
        }
      });
    }

    // Step 3: Fallback to <title> (guard against plain "Bookshelf")
    if (!mainHeadline) {
      const t = $("title").text().trim();
      return t && t.toLowerCase() !== "bookshelf" ? t : null;
    }

    return mainHeadline;
  } catch (error) {
    logger.error("Error extracting headline:", error);
    return null;
  }
}

/**
 * extractInnermostText - recursively extract text from innermost elements
 */
function extractInnermostText($, element) {
  const $el = $(element);

  // Check if the element has no child elements
  const children = $el.children();
  if (children.length === 0) {
    return $el.text().trim() || null;
  }

  let text = "";
  // Iterate over child elements
  children.each((_, child) => {
    const childText = extractInnermostText($, child);
    if (childText) {
      text += (text ? " " : "") + childText;
    }
  });

  return text || null;
}
