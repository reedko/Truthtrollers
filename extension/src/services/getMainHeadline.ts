export const getMainHeadline = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    let mainHeadline: string | null = null;

    // Step 1: Prioritize H1 and H2
    const headings = Array.from(doc.querySelectorAll("h1, h2")).filter(
      (heading) => {
        const hasNavigateOrHidden =
          heading.classList.toString().toLowerCase().includes("navigat") ||
          (heading.id && heading.id.toLowerCase().includes("navigat")) ||
          heading.classList.toString().toLowerCase().includes("hidden") ||
          (heading.id && heading.id.toLowerCase().includes("hidden"));

        return !hasNavigateOrHidden;
      }
    );

    for (const heading of headings) {
      if (heading.tagName === "H1") {
        mainHeadline = heading.textContent?.trim() || null; // Prefer H1
        break;
      } else if (!mainHeadline && heading.tagName === "H2") {
        mainHeadline = heading.textContent?.trim() || null; // Fallback to H2
      }
    }

    // Step 2: If no valid H1 or H2, check headline divs
    if (!mainHeadline) {
      const headlineDivs = Array.from(
        doc.querySelectorAll('div[class*="headline"], div[id*="headline"]')
      ).filter((div) => {
        const hasNavigateOrHidden =
          div.classList.toString().toLowerCase().includes("navigat") ||
          (div.id && div.id.toLowerCase().includes("navigat")) ||
          div.classList.toString().toLowerCase().includes("hidden") ||
          (div.id && div.id.toLowerCase().includes("hidden"));

        return !hasNavigateOrHidden;
      });

      for (const div of headlineDivs) {
        // Extract innermost text
        const innerText = extractInnermostText(div as HTMLElement);
        if (innerText) {
          mainHeadline = innerText;
          break;
        }
      }
    }

    // Step 3: Fallback to <title>
    if (!mainHeadline) {
      const titleTag = doc.querySelector("title");
      mainHeadline = titleTag?.textContent?.trim() || null;
    }

    return mainHeadline;
  } catch (error) {
    console.error("Error fetching headline:", error);
    return null;
  }
};

// Helper function to recursively extract the innermost text
const extractInnermostText = (element: HTMLElement): string | null => {
  // If the element has no child elements, return its text content
  if (!element.children || element.children.length === 0) {
    return element.textContent?.trim() || null;
  }

  // Recursively check child elements for text
  let text = "";
  for (const child of Array.from(element.children)) {
    const childText = extractInnermostText(child as HTMLElement);
    if (childText) {
      text += (text ? " " : "") + childText;
    }
  }
  return text || null;
};
