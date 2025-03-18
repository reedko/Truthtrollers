// extractMetaData.ts
import * as cheerio from "cheerio";
import { Author, TaskData, Lit_references, Publisher } from "../entities/Task";
import { DiffbotData } from "../entities/diffbotData";
// Determine if running in the extension or dashboard
const IS_EXTENSION = !!chrome?.runtime?.id;
console.log("Running in extension:", IS_EXTENSION);
const EXTENSION_ID = "hfihldigngpdcbmedijohjdcjppdfepj";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
//const BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";
console.log(IS_EXTENSION, "ISIEIXITI");
const isValidReference = (link: string): boolean => {
  const excludedPatterns = [
    "\\bads\\b", // Match "ads" as a whole word (not inside "uploads")
    "\\bsponsored\\b",
    "\\btracking\\b",
    "\\blogin\\b",
    "\\bshare\\b",
    "\\bsubscribe\\b",
    "\\binstagram\\b",
  ];
  return (
    link.startsWith("http") &&
    excludedPatterns.every((pattern) => !link.includes(pattern))
  );
};

// B) Utility: Extract Text Content (Extension & Dashboard Variants)
export const getExtractedTextFromBackground = async (
  url: string,
  html: string
): Promise<string> => {
  if (IS_EXTENSION) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "extractText", url, html },
        (response) => {
          if (response?.success) {
            resolve(response.pageText);
          } else {
            reject(response?.error || "Failed to extract text");
          }
        }
      );
    });
  } else {
    try {
      const response = await fetch(`${BASE_URL}/api/extract-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html }),
      });
      const data = await response.json();
      if (!data.success) throw new Error("Text extraction failed.");
      return data.pageText;
    } catch (error) {
      console.error("❌ Text extraction failed:", error);
      return "";
    }
  }
};

// B) Utility to get claims from ClaimBuster via the background
export const getClaimsFromBackground = async (text: string): Promise<any[]> => {
  if (IS_EXTENSION) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "claimBuster", text },
        (response) => {
          if (response?.success) {
            resolve(response.claims);
          } else {
            reject(response?.error || "Failed to call ClaimBuster");
          }
        }
      );
    });
  } else {
    try {
      const response = await fetch(`${BASE_URL}/api/claim-buster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!data.success) throw new Error("ClaimBuster request failed.");
      return data.claims;
    } catch (error) {
      console.error("❌ ClaimBuster request failed:", error);
      return [];
    }
  }
};

// B) Image Extraction (Restored)
export const getBestImage = async (
  url: string,
  extractedHtml: string,
  diffbotData: DiffbotData
) => {
  return new Promise<string>((resolve) => {
    if (IS_EXTENSION) {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "captureImage", url, html: extractedHtml, diffbotData },
        (res) => {
          resolve(res.imageUrl || `${BASE_URL}/assets/images/miniLogo.png`);
        }
      );
    } else {
      resolve(
        extractImageFromHtml(extractedHtml, url) ||
          `${BASE_URL}/assets/images/miniLogo.png`
      );
    }
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
    ogImage = decodeURIComponent(ogImage); // Decode
    if (isProcessableImage(ogImage)) return resolveUrl(ogImage, baseUrl);
  }

  // 2️⃣ Extract from <img> tags, prioritizing srcset
  let maxArea = 0;
  let chosenImage = null;

  $("img").each((_, img) => {
    let src = decodeURIComponent($(img).attr("src") || "");
    let srcset = decodeURIComponent($(img).attr("srcset") || "");
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;

    // ✅ If srcset exists, pick the largest image
    if (srcset) {
      const bestSrc = parseSrcset(srcset);
      if (isProcessableImage(bestSrc)) src = bestSrc;
    }

    // ✅ Convert relative URLs to absolute
    src = resolveUrl(src, baseUrl);

    // ✅ If it's a processable image, compare size and pick the largest
    if (area > maxArea && isProcessableImage(src)) {
      maxArea = area;
      chosenImage = src;
    }
  });

  return chosenImage;
};

// ✅ Helper: Convert relative URLs to absolute
const resolveUrl = (src: string, baseUrl: URL) => {
  if (!src.startsWith("http")) {
    return src.startsWith("/")
      ? new URL(src, baseUrl.origin).href
      : new URL(src, baseUrl).href;
  }
  return src;
};

// ✅ Helper: Check if image is processable
const isProcessableImage = (url: string) => {
  if (!url) return false;

  const decodedUrl = decodeURIComponent(url);

  // ✅ Allow multiple "https://" if the URL is part of an `srcset`
  const httpsCount = (decodedUrl.match(/https:\/\//g) || []).length;
  const isLikelySrcSet =
    decodedUrl.includes("&w=") || decodedUrl.includes(" 400w");

  if (httpsCount > 1 && !isLikelySrcSet) {
    console.warn("❌ Rejected multi-https URL (not srcset):", decodedUrl);
    return false;
  }

  // ✅ Exclude invalid patterns
  const invalidPatterns = ["data:", "blob:", "svg", "gif"];
  if (invalidPatterns.some((pattern) => decodedUrl.includes(pattern)))
    return false;

  // ✅ Check for valid image file extensions
  if (/\.(jpg|jpeg|png|webp)$/i.test(decodedUrl)) return true;

  // ✅ Last fallback: Try loading the image to check if it's broken
  return testImageLoad(decodedUrl);
};

// 🔥 Function to check if an image URL actually loads
const testImageLoad = async (url: string) => {
  try {
    const response = await fetch(url, { method: "HEAD" }); // Only check headers, don't download
    if (!response.ok) throw new Error(`HTTP status ${response.status}`);
    const contentType = response.headers.get("content-type");

    // ✅ Allow only valid image types
    if (!contentType || !contentType.startsWith("image/")) {
      console.warn("❌ Not an image:", url);
      return false;
    }

    return true;
  } catch (err) {
    console.warn("❌ Image failed to load:", url, err);
    return false;
  }
};

// ✅ Helper: Parse srcset to find the best image
const parseSrcset = (srcset: string) => {
  return srcset
    .split(",")
    .map((entry) => {
      const [url, size] = entry.trim().split(/\s+/);
      return { url, width: parseInt(size, 10) || 0 };
    })
    .reduce(
      (best, candidate) => (candidate.width > best.width ? candidate : best),
      { url: "", width: 0 }
    ).url;
};

export const fetchPageContent = (): cheerio.CheerioAPI => {
  const loadedCheerio = cheerio.load(document.documentElement.outerHTML);
  console.log(loadedCheerio, ":from cheerio");
  return loadedCheerio;
};

export const fetchExternalPageContent = async (
  url: string
): Promise<cheerio.CheerioAPI> => {
  console.log(`🌍 Fetching page content for: ${url}`);

  // ✅ Unified function for Wayback Machine fallback
  const fetchFromWayback = async (originalUrl: string) => {
    const archiveUrl = `https://web.archive.org/web/${originalUrl}`;
    console.warn("🔄 Fetching from Wayback Machine:", archiveUrl);
    return fetchExternalPageContent(archiveUrl);
  };

  if (IS_EXTENSION) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "fetchPageContent", url },
        (response) => {
          console.log("🔎 Fetch Response:", response);

          if (chrome.runtime.lastError) {
            console.error("Runtime error:", chrome.runtime.lastError);
            return resolve(cheerio.load(""));
          }

          if (!response?.success || !response.html) {
            return resolve(fetchFromWayback(url));
          }

          return resolve(cheerio.load(response.html));
        }
      );
    });
  } else {
    try {
      const response = await fetch(`${BASE_URL}/api/fetch-page-content`, {
        method: "POST",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Content-Type": "application/json",
          Referer: url, // ✅ Some sites check for a valid referrer
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        console.error(
          `❌ HTTP error: ${response.status} - ${response.statusText}`
        );
        return fetchFromWayback(url);
      }

      const jsonResponse = await response.json();
      console.log(
        `✅ Received page content: ${jsonResponse.html?.length || 0} bytes`
      );

      if (!jsonResponse.html) {
        return fetchFromWayback(url);
      }

      return cheerio.load(jsonResponse.html);
    } catch (error) {
      console.error("❌ Error fetching page content:", error);
      return cheerio.load(""); // ✅ Ensures return is always valid
    }
  }
};

const fetchExternalPage = async (url: string) => {
  try {
    console.log(`🌍 Fetching page content for: ${url}`);

    const response = await fetch(`${BASE_URL}/api/fetch-page-content`, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Content-Type": "application/json", // ✅ Fix: Ensure JSON body is read properly
        Referer: url, // ✅ Some sites check for a valid referrer
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      console.error(
        `❌ HTTP error: ${response.status} - ${response.statusText}`
      );
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const jsonResponse = await response.json();
    console.log(
      `✅ Received page content: ${jsonResponse.html?.length || 0} bytes`
    );

    return jsonResponse.html;
  } catch (error) {
    console.error("❌ Error fetching page content:", error);
    return null; // ✅ Avoid unhandled rejections
  }
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

    // ✅ List of files we can't scrape but should still save

    if (!isValidReference(url)) return;

    let content_name = potentialTitle || formatUrlForTitle(url);
    references.push({
      url,
      content_name,
      //nonScrapable: isNonScrapable, // ✅ Flag these files so we don't try to scrape them
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
