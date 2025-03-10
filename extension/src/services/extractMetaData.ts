// extractMetaData.ts
import * as cheerio from "cheerio";
import { Author, TaskData, Lit_references, Publisher } from "../entities/Task";
import { DiffbotData } from "../entities/diffbotData";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

const isValidReference = (link: string): boolean => {
  const excludedPatterns = [
    "ads",
    "sponsored",
    "tracking",
    "login",
    "share",
    "subscribe",
    "instagram",
  ];
  return (
    link.startsWith("http") &&
    excludedPatterns.every((pattern) => !link.includes(pattern))
  );
};

// A) Utility to get text from server via the background
export async function getExtractedTextFromBackground(
  url: string,
  html: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "extractText", url, html }, // ✅ Send extracted HTML
      (response) => {
        if (response?.success) {
          resolve(response.pageText);
        } else {
          reject(response?.error || "Failed to extract text");
        }
      }
    );
  });
}

// B) Utility to get claims from ClaimBuster via the background
export async function getClaimsFromBackground(text: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "claimBuster", text }, (response) => {
      if (response?.success) {
        resolve(response.claims);
      } else {
        reject(response?.error || "Failed to call ClaimBuster");
      }
    });
  });
}

export const getBestImage = async (
  url: string,
  extractedHtml: string,
  diffbotData: DiffbotData
) => {
  return new Promise<string>((resolve) => {
    chrome.runtime.sendMessage(
      { action: "captureImage", url, html: extractedHtml, diffbotData },
      (res) => {
        resolve(res.imageUrl || `${BASE_URL}/assets/images/miniLogo.png`);
      }
    );
  });
};

export const extractImageFromHtml = (
  html: string,
  url: string
): string | null => {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);

  // 1️⃣ Prefer OpenGraph image if available
  let ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    if (!ogImage.startsWith("http")) {
      if (ogImage.startsWith("/")) {
        // ✅ If it starts with `/`, use baseUrl (origin)
        ogImage = new URL(ogImage, baseUrl.origin).href;
      } else {
        // ✅ If no `/`, assume it's relative to the full article URL
        ogImage = new URL(ogImage, baseUrl).href;
      }
    }
    return ogImage;
  }

  // 2️⃣ Extract from <img> tags, prioritizing srcset
  let maxArea = 0;
  let chosenImage = null;

  $("img").each((_, img) => {
    let src = $(img).attr("src") || "";
    let srcset = $(img).attr("srcset") || "";
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;

    // ✅ If srcset exists, parse it to find the highest-resolution image
    if (srcset) {
      const candidates = srcset.split(",").map((entry) => {
        const [url, size] = entry.trim().split(/\s+/);
        return { url, width: parseInt(size, 10) || 0 };
      });

      // Pick the largest image from srcset
      const bestSrcsetImage = candidates.reduce(
        (best, candidate) => {
          return candidate.width > best.width ? candidate : best;
        },
        { url: "", width: 0 }
      );

      if (bestSrcsetImage.url) {
        src = bestSrcsetImage.url;
      }
    }

    // ✅ Convert relative URLs to absolute
    if (src.startsWith("/") && baseUrl) {
      src = baseUrl.origin + src;
    }

    // ✅ Pick the largest available image
    if (area > maxArea && src) {
      maxArea = area;
      chosenImage = src;
    }
  });

  return chosenImage;
};

export const fetchPageContent = (): cheerio.CheerioAPI => {
  const loadedCheerio = cheerio.load(document.documentElement.outerHTML);
  console.log(loadedCheerio, ":from cheerio");
  return loadedCheerio;
};

export const fetchExternalPageContent = async (
  url: string
): Promise<cheerio.CheerioAPI> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "fetchPageContent", url },
      (response) => {
        console.log("🔎 Fetch Response:", response); // ✅ Log full response

        if (chrome.runtime.lastError) {
          console.error("Runtime error:", chrome.runtime.lastError);
          return resolve(cheerio.load(""));
        }

        // ✅ Properly detect failed requests (e.g., 403 errors)
        if (!response?.success || !response.html) {
          console.error(
            "🚨 Fetch failed (likely 403). Falling back to Wayback Machine:",
            url
          );

          // ✅ Attempt Wayback Machine fallback
          const archiveUrl = `https://web.archive.org/web/${url}`;
          return resolve(fetchExternalPageContent(archiveUrl));
        }

        return resolve(cheerio.load(response.html));
      }
    );
  });
};

// Extract Authors
export const extractAuthors = async (
  $: cheerio.CheerioAPI
): Promise<Author[]> => {
  const authors: Author[] = [];

  // Extract from JSON-LD
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const metadata = JSON.parse($(scriptTag).html() || "");
      const authorData = Array.isArray(metadata) ? metadata : [metadata];

      authorData.forEach((entry) => {
        if (entry["@type"] === "Person" && entry.name) {
          authors.push({
            name: entry.name,
            description: entry.description || null,
            image: entry.image?.contentUrl || null,
          });
        }
      });

      if (metadata.author) {
        (Array.isArray(metadata.author)
          ? metadata.author
          : [metadata.author]
        ).forEach((author: any) => {
          authors.push(
            typeof author === "object"
              ? {
                  name: author.name,
                  description: author.description || null,
                  image: author.image?.contentUrl || null,
                }
              : { name: author }
          );
        });
      }
    } catch (err) {
      console.error("Error parsing ld+json for authors:", err);
    }
  });

  // Extract from meta tags
  if (!authors.length) {
    const rawAuthorNames =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content");
    if (rawAuthorNames) {
      rawAuthorNames
        .split(/\s*and\s*|,\s*/)
        .forEach((name) => authors.push({ name: name.trim() }));
    }
  }

  // Extract from citation meta tags
  if (!authors.length) {
    $(
      'meta[name="citation_author"], meta[property="article:citation_author"]'
    ).each((_, metaTag) => {
      const rawAuthorName = $(metaTag).attr("content");
      if (rawAuthorName) {
        rawAuthorName
          .split(/\s*and\s*|,\s*/)
          .forEach((name) => authors.push({ name: name.trim() }));
      }
    });
  }

  // Special case handling for certain sites (e.g., Children's Health Defense)
  if (!authors.length) {
    $("script").each((_, scriptTag) => {
      const scriptContent = $(scriptTag).html();
      if (scriptContent?.includes("var chd_ga4_data =")) {
        try {
          const match = scriptContent.match(/var chd_ga4_data = (\{.*?\});/s);
          if (match && match[1]) {
            const chdData = JSON.parse(match[1]);
            if (chdData.contentAuthor) {
              authors.push({
                name: chdData.contentAuthor,
                title: chdData.contentAuthorTitle || null,
              });
            }
          }
        } catch (err) {
          console.error("Error parsing chd_ga4_data:", err);
        }
      }
    });
  }

  return authors;
};

// Extract Publisher
export const extractPublisher = async (
  $: cheerio.CheerioAPI
): Promise<Publisher> => {
  let publisherName =
    $('meta[property="og:site_name"]').attr("content") ||
    $('meta[name="publisher"]').attr("content") ||
    $('meta[name="citation_journal_title"]').attr("content") ||
    "Unknown Publisher";

  // Extract from JSON-LD
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const metadata = JSON.parse($(scriptTag).text().trim());

      // Check if publisher exists as an object

      if (
        metadata.publisher &&
        typeof metadata.publisher === "object" &&
        metadata.publisher.name
      ) {
        publisherName = metadata.publisher.name;
        console.log("✅ Publisher Found (Direct):", publisherName);
        return false; // Exit early if found
      }

      // If `publisher` is nested within another structure (e.g., `isPartOf`)
      if (
        metadata.isPartOf &&
        typeof metadata.isPartOf === "object" &&
        metadata.isPartOf.name
      ) {
        publisherName = metadata.isPartOf.name;
        console.log("✅ Publisher Found (isPartOf):", publisherName);
        return false;
      }

      // Recursive fallback for complex structures
      const findPublisher = (data: any): string | null => {
        if (Array.isArray(data))
          return data.map(findPublisher).find((name) => name) || null;
        if (typeof data === "object" && data) {
          if (data["@type"] === "NewsMediaOrganization" && data.name)
            return data.name;
          return (
            Object.values(data)
              .map(findPublisher)
              .find((name) => name) || null
          );
        }
        return null;
      };

      const foundPublisher = findPublisher(metadata);
      if (foundPublisher) {
        publisherName = foundPublisher;
        console.log("✅ Publisher Found (Recursive):", publisherName);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse ld+json script: ${err}`);
    }
  });

  return { name: publisherName };
};

// Extract References
export const extractReferences = async (
  $: cheerio.CheerioAPI
): Promise<Lit_references[]> => {
  const references: Lit_references[] = [];
  const promises: Promise<void>[] = [];

  const processReference = async (url: string, potentialTitle?: string) => {
    url = url.trim();
    if (!isValidReference(url)) return;
    // let content_name = await fetchTitleFromDiffbot(url);
    let content_name = potentialTitle || formatUrlForTitle(url);
    references.push({
      url,
      content_name,
    });
  };

  // Extract references from inline links
  $("article, .content, .post-body, .entry-content, .ref-list")
    .find("a[href]")
    .each((_, el) => {
      const link = $(el).attr("href")?.trim();
      const inlineText = $(el).text().trim();
      if (
        link &&
        link.startsWith("http") &&
        !isNavigationLink(link) &&
        !$(el).closest("nav, header, .menu, .navbar, aside, footer").length
      ) {
        // ✅ NEW: Exclude menu links
        promises.push(processReference(link, inlineText));
      }
    });

  // Extract references from JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const rawJson = $(scriptTag).html();
      if (rawJson) {
        const metadata = JSON.parse(rawJson);
        // ✅ Make sure metadata.references exists and is an array
        if (!metadata.references || !Array.isArray(metadata.references)) {
          return; // Skip this JSON-LD entry if no references are found
        }
        const refs = Array.isArray(metadata.references)
          ? metadata.references
          : [metadata.references];

        refs.forEach((ref: any) => {
          const refUrl = ref.url?.trim();
          const refTitle = ref.name?.trim();
          if (refUrl) {
            promises.push(processReference(refUrl, refTitle));
          }
        });
      }
    } catch (err) {
      console.error("Error parsing ld+json for references:", err);
    }
  });

  await Promise.all(promises);
  const uniqueReferences = references.filter(
    (ref, index, self) => index === self.findIndex((r) => r.url === ref.url)
  );
  return uniqueReferences;
};

/* // Helpers
const fetchTitleFromDiffbot = async (url: string): Promise<string | null> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "fetchTitleFromDiffbot", url },
      (response) => {
        resolve(response);
      }
    );
  });
};
 */
const formatUrlForTitle = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const readablePart = pathname.split("/").filter((part) => part.length > 3);
    return readablePart.length
      ? readablePart.join(" ").replace(/-/g, " ")
      : hostname;
  } catch (err) {
    return url;
  }
};

const isNavigationLink = (link: string): boolean => {
  return /#|twitter\.com|facebook\.com|linkedin\.com|instagram\.com|subscribe|comment|share/.test(
    link
  );
};
