import * as cheerio from "cheerio";

export const getMainHeadline = ($: cheerio.CheerioAPI): string | null => {
  try {
    let mainHeadline: string | null = null;

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
        const innerText = extractInnermostText($, div as unknown as Element); // ✅ Cast to native Element
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
    console.error("Error extracting headline:", error);
    return null;
  }
};

// ✅ Use native `Element` for typing
const extractInnermostText = (
  $: cheerio.CheerioAPI,
  element: Element
): string | null => {
  // Check if the element has no child elements
  if (element.children.length === 0) {
    return element.textContent?.trim() || null; // Use textContent for native Element
  }

  let text = "";
  // Iterate over child elements
  Array.from(element.children).forEach((child) => {
    const childText = extractInnermostText($, child as Element); // Recursively extract text
    if (childText) {
      text += (text ? " " : "") + childText;
    }
  });

  return text || null;
};
