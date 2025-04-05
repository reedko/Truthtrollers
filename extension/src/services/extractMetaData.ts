// extractMetaData.ts
import * as cheerio from "cheerio";
import { Author, TaskData, Lit_references, Publisher } from "../entities/Task";
import { DiffbotData } from "../entities/diffbotData";
import { fetchHtmlWithPuppeteer } from "./getHtmlWithPuppeteer";

// Determine if running in the extension or dashboard
const IS_EXTENSION = !!chrome?.runtime?.id;

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
//const BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

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
      return await handleExtractText(url, html); // ✅ Await the async function
    } catch (error) {
      console.error("❌ Text extraction failed:", error);
      throw error;
    }
  }
};

async function handleExtractText(url: string, html: string): Promise<string> {
  if (!html) {
    console.log("🌍 No HTML provided, fetching from backend:", url);
    try {
      const response = await fetch(`${BASE_URL}/api/extractText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html }),
      });

      const textResponse = await response.text();

      let data;
      try {
        data = JSON.parse(textResponse);
      } catch (err) {
        console.error("❌ JSON Parse Error:", textResponse);
        throw new Error("Invalid JSON returned from extractText API");
      }

      if (!data.success || !data.pageText) {
        throw new Error(`Text extraction failed: ${JSON.stringify(data)}`);
      }

      return data.pageText;
    } catch (error) {
      console.error("❌ Text extraction failed:", error);
      throw error; // Pass it up for orchestrateScraping to catch
    }
  } else {
    console.log("✅ HTML provided, skipping API request.");
    console.log("USE_HTML_DIRECTLY"); // ❗ Let orchestrateScraping handle it

    return html;
  }
}

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
    ogImage = resolveUrl(ogImage, baseUrl); // Convert relative URLs
    if (isProcessableImage(ogImage)) {
      return ogImage;
    }
  }

  // 2️⃣ Extract from <img> tags, prioritizing largest image
  let maxArea = 0;
  let chosenImage: string | null = null;

  $("img").each((_, img) => {
    let src = $(img).attr("src") || "";
    let srcset = $(img).attr("srcset") || "";
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;

    // ✅ If srcset exists, pick the highest-resolution image
    if (srcset) {
      const bestSrc = parseSrcset(srcset);
      if (bestSrc) src = bestSrc;
    }

    // ✅ Convert relative URLs to absolute
    src = resolveUrl(decodeURIComponent(src), baseUrl);

    // ✅ Validate & Pick the Largest Image
    if (area > maxArea && isProcessableImage(src)) {
      maxArea = area;
      chosenImage = src;
    }
  });

  // 3️⃣ Fallback: If no large image, pick any valid one
  if (!chosenImage) {
    $("img").each((_, img) => {
      let src = $(img).attr("src") || "";
      src = resolveUrl(decodeURIComponent(src), baseUrl);
      if (isProcessableImage(src)) {
        chosenImage = src;
        return false; // Break loop
      }
    });
  }

  console.log(
    chosenImage
      ? `✅ Selected Image: ${chosenImage}`
      : "❌ No valid image found."
  );
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

  return loadedCheerio;
};
const detectRetraction = (html: string): boolean => {
  const lower = html.toLowerCase();
  return lower.includes("retracted") || lower.includes("withdrawn");
};

const removeCookieWalls = (html: string): string => {
  const $ = cheerio.load(html);
  $(
    '[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"],' +
      ".qc-cmp2-container, .truste_popframe, #onetrust-banner-sdk"
  ).remove();
  return $.html();
};

const isLikelyRSS = (html: string) =>
  html.trim().startsWith("<rss") || html.toLowerCase().includes("<feed");

const fetchViaPuppeteer = async (url: string) => {
  console.warn("🤖 Fetching via Puppeteer:", url);
  const res = await fetchHtmlWithPuppeteer(url);
  if (res.success && res.html) {
    const cleaned = removeCookieWalls(res.html);
    const $ = cheerio.load(cleaned);
    const text = $("body").text().trim();
    if (text.length > 300) {
      console.log("✅ Puppeteer succeeded, length:", text.length);
      return { $, isRetracted: detectRetraction(cleaned) };
    }
  }
  return null;
};

const fetchFromWaybackWithPuppeteer = async (originalUrl: string) => {
  const archiveUrl = `https://web.archive.org/web/${originalUrl}`;
  console.warn("🕰️ Trying Wayback Machine via Puppeteer:", archiveUrl);
  return await fetchViaPuppeteer(archiveUrl);
};
const checkIfPdfViaHead = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const contentType = res.headers.get("Content-Type") || "";
    return contentType.includes("application/pdf");
  } catch (e) {
    console.warn("❌ PDF HEAD check failed:", e);
    return false;
  }
};
export const fetchExternalPageContent = async (
  url: string
): Promise<{
  $: cheerio.CheerioAPI;
  isRetracted: boolean;
  isRSS?: boolean;
  pdfMeta?: {
    title?: string;
    author?: string;
    thumbnailUrl?: string;
    // Add image?: string later if you extract one
  };
}> => {
  let isPdf = url.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      // Wrap in a promise so we can await it
      isPdf = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "checkIfPdf", url },
          (response) => {
            resolve(response?.isPdf);
          }
        );
      });
    } else {
      isPdf = await checkIfPdfViaHead(url);
      console.log("✅ Detected PDF from frontend:", isPdf);
    }
  }
  console.log("✅ Detected PDF in extension?:", isPdf);
  // ✅ Handle PDF
  if (isPdf) {
    // Extension
    console.log(url, ":URL PASSED TO PDF DETECT");
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "fetchPdfText", url },
          (response) => {
            console.log("Got fetchPdfText response:", response);
            if (!response?.success || !response.text) {
              return resolve({ $: cheerio.load(""), isRetracted: false });
            }
            const $ = cheerio.load(`<body>${response.text.trim()}</body>`);
            const resultObj = {
              $,
              isRetracted: detectRetraction(response.text),
              pdfMeta: {
                title: response.title,
                author: response.author,
                thumbnailUrl: response.thumbnailUrl,
              },
            };

            console.log("About to resolve fetchPdfText with:", resultObj);
            resolve(resultObj);
          }
        );
      });
    }

    // Server-side PDF
    try {
      const pdfRes = await fetch(`${BASE_URL}/api/fetch-pdf-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await pdfRes.json();

      if (!json?.success || !json.text) {
        return { $: cheerio.load(""), isRetracted: false };
      }

      const $ = cheerio.load(`<body>${json.text.trim()}</body>`);
      const thumbRes = await fetch(`${BASE_URL}/api/pdf-thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const thumbJson = await thumbRes.json();

      return {
        $,
        isRetracted: detectRetraction(json.text),
        pdfMeta: {
          title: json.title,
          author: json.author,
          thumbnailUrl: thumbJson?.imageUrl || undefined,
        },
      };
    } catch (err) {
      console.error("❌ PDF parse failed:", err);
      return { $: cheerio.load(""), isRetracted: false };
    }
  }

  // 🔁 HTML fetch: Extension first
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "fetchPageContent", url },
        async (response) => {
          if (
            chrome.runtime.lastError ||
            !response?.success ||
            !response.html
          ) {
            console.warn("⚠️ Extension fetch failed. Trying Puppeteer...");
            const puppeteerTry = await fetchViaPuppeteer(url);
            if (puppeteerTry) return resolve(puppeteerTry);

            const waybackTry = await fetchFromWaybackWithPuppeteer(url);
            if (waybackTry) return resolve(waybackTry);

            return resolve({ $: cheerio.load(""), isRetracted: false });
          }

          const cleaned = removeCookieWalls(response.html);
          if (isLikelyRSS(cleaned)) {
            console.warn("🛑 RSS feed detected. Skipping.");
            return resolve({
              $: cheerio.load(""),
              isRetracted: false,
              isRSS: true,
            });
          }

          const $ = cheerio.load(cleaned);
          const len = $("body").text().trim().length;

          if (len < 300) {
            console.warn("⚠️ Short content. Trying Puppeteer...");
            const puppetAlt = await fetchViaPuppeteer(url);
            if (puppetAlt) return resolve(puppetAlt);

            const waybackTry = await fetchFromWaybackWithPuppeteer(url);
            if (waybackTry) return resolve(waybackTry);
          }

          return resolve({ $, isRetracted: detectRetraction(cleaned) });
        }
      );
    });
  }

  // 🔁 Server-side HTML fetch
  try {
    const res = await fetch(`${BASE_URL}/api/fetch-page-content`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const json = await res.json();
    const cleaned = removeCookieWalls(json.html);
    if (isLikelyRSS(cleaned)) {
      console.warn("🛑 RSS feed detected. Skipping.");
      return { $: cheerio.load(""), isRetracted: false, isRSS: true };
    }

    const $ = cheerio.load(cleaned);
    const len = $("body").text().trim().length;

    if (len < 300) {
      console.warn("⚠️ Short server content. Trying Puppeteer + Wayback...");
      const puppet = await fetchViaPuppeteer(url);
      if (puppet) return puppet;

      const wayback = await fetchFromWaybackWithPuppeteer(url);
      if (wayback) return wayback;
    }

    return { $, isRetracted: detectRetraction(cleaned) };
  } catch (err) {
    console.error("❌ Server fetch error:", err);
    return { $: cheerio.load(""), isRetracted: false };
  }
};

// Extract Authors
export const extractAuthors = async (
  $: cheerio.CheerioAPI
): Promise<Author[]> => {
  const authors: Author[] = [];

  // ✅ Extract directly from article header
  const authorRegex =
    /<span class="chd-defender-article__authors-name">.*?<a.*?>(.*?)<\/a>/;
  const match = $.html().match(authorRegex);

  if (match) {
    console.log("🧠 Found author in CHD article header span.");
    authors.push({
      name: match[1].trim(),
      description: null,
      image: null,
    });
  }

  // ✅ Extract from JSON-LD
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    console.log("trying ld+json");
    try {
      let raw = $(scriptTag).text().trim() || "{}";
      // 🧽 Clean up malformed endings like stray semicolons or double JSON
      if (raw.endsWith(";")) raw = raw.slice(0, -1);
      // ✅ Handle multiple JSON blobs in one script tag
      const entries = raw.split(/}\s*{/).map((s, i, arr) => {
        if (arr.length === 1) return s;
        return i === 0
          ? s + "}"
          : i === arr.length - 1
          ? "{" + s
          : "{" + s + "}";
      });
      entries.forEach((entry) => {
        const metadata = JSON.parse(raw);

        // 🔍 Look directly for metadata.author
        const authorArray = Array.isArray(metadata.author)
          ? metadata.author
          : metadata.author
          ? [metadata.author]
          : [];

        authorArray.forEach((author: any) => {
          if (author?.name) {
            console.log(
              "👤 Found author from metadata.author array:",
              author.name
            );
            authors.push({
              name: author.name.trim(),
              description: author.description || null,
              image: author.image?.contentUrl || null,
            });
          }
        });
      });
    } catch (err) {
      console.error("❌ Error parsing ld+json for authors:", err);
    }
  });

  // ✅ Extract from meta tags
  if (!authors.length) {
    const rawAuthorNames =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content");

    if (rawAuthorNames) {
      console.log("📦 Found author in meta tag:", rawAuthorNames);
      rawAuthorNames
        .split(/\s*and\s*|,\s*/)
        .forEach((name) =>
          authors.push({ name: name.trim(), description: null, image: null })
        );
    }
  }

  // ✅ Extract from citation meta tags
  if (!authors.length) {
    $(
      'meta[name="citation_author"], meta[property="article:citation_author"]'
    ).each((_, metaTag) => {
      const rawAuthorName = $(metaTag).attr("content");
      if (rawAuthorName) {
        console.log("📚 Found citation_author meta:", rawAuthorName);
        rawAuthorName
          .split(/\s*and\s*|,\s*/)
          .forEach((name) =>
            authors.push({ name: name.trim(), description: null, image: null })
          );
      }
    });
  }

  // ✅ Special case: Extract authors from CHD (Children’s Health Defense)
  if (!authors.length) {
    const scripts = $("script");

    scripts.each((_, scriptTag) => {
      const scriptText = $(scriptTag).text().trim();
      if (scriptText.includes("var chd_ga4_data =")) {
        try {
          const match = scriptText.match(/var chd_ga4_data = (\{.*?\});/s);
          if (match && match[1]) {
            const chdData = JSON.parse(match[1]);
            if (chdData.contentAuthor) {
              console.log(
                "🏥 Found author in chd_ga4_data:",
                chdData.contentAuthor
              );
              authors.push({
                name: chdData.contentAuthor,
                description: chdData.contentAuthorTitle || null,
              });
            }
          }
        } catch (err) {
          console.error("❌ Error parsing chd_ga4_data:", err);
        }
      }
    });
  }

  if (!authors.length) {
    console.warn("🚫 No authors found from any source.");
  } else {
    console.log("✅ Total authors extracted:", authors);
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

        return false; // Exit early if found
      }

      // If `publisher` is nested within another structure (e.g., `isPartOf`)
      if (
        metadata.isPartOf &&
        typeof metadata.isPartOf === "object" &&
        metadata.isPartOf.name
      ) {
        publisherName = metadata.isPartOf.name;

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
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse ld+json script: ${err}`);
    }
  });

  return { name: publisherName };
};

// Extract References

const isValidReference = (link: string): boolean => {
  const excludedPatterns = [
    "\\bads\\b",
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

const formatUrlForTitle = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const readablePart = pathname.split("/").filter((part) => part.length > 3);
    return readablePart.length
      ? readablePart.join(" ").replace(/[-_]/g, " ")
      : hostname;
  } catch (err) {
    return url;
  }
};

const isNavigationLink = (link: string): boolean => {
  return /#|twitter\.com|facebook\.com|linkedin\.com|instagram\.com|subscribe|comment|share|login|menu|footer|nav/i.test(
    link
  );
};

export const extractReferences = async (
  $: cheerio.CheerioAPI
): Promise<Lit_references[]> => {
  const references: Lit_references[] = [];
  const promises: Promise<void>[] = [];

  const processReference = async (url: string, potentialTitle?: string) => {
    url = url.trim();
    if (!isValidReference(url)) return;

    const content_name = potentialTitle || formatUrlForTitle(url);
    references.push({ url, content_name });
  };

  // 🔍 1. Collect nav-like category prefixes (e.g. 'defender_category')
  const getNavCategoryPrefixes = ($: cheerio.CheerioAPI): string[] => {
    const prefixes = new Set<string>();

    $("nav a[href], header a[href], .menu a[href], .navbar a[href]").each(
      (_, el) => {
        const href = $(el).attr("href");
        if (href?.startsWith("http")) {
          try {
            const parsed = new URL(href);
            const segments = parsed.pathname?.split("/").filter(Boolean);
            if (segments && segments.length > 0) {
              prefixes.add(segments[0]);
            }
          } catch (err) {
            console.warn("⚠️ Invalid nav link:", href);
          }
        }
      }
    );

    return [...prefixes];
  };

  const navPrefixes = getNavCategoryPrefixes($);
  console.log("📎 Detected nav prefixes:", navPrefixes);

  // 🔥 2. Zones likely to contain references
  const referenceZones = [
    "article",
    "main",
    ".content",
    ".post-body",
    ".entry-content",
    ".ref-list",
    ".references",
    ".citation",
    ".citations",
    ".footnotes",
    "footer", // ✅ footer allowed now
  ].join(",");

  // 🔍 3. Crawl anchor tags in those zones
  $(referenceZones)
    .find("a[href]")
    .each((_, el) => {
      const link = $(el).attr("href")?.trim();
      const inlineText = $(el).text().trim();

      if (!link || !link.startsWith("http")) return;

      try {
        const parsed = new URL(link);
        const pathSegments = parsed.pathname?.split("/").filter(Boolean);
        const firstSegment = pathSegments?.[0];
        const matchesNavPrefix =
          firstSegment && navPrefixes.includes(firstSegment);

        const isInBadNav =
          $(el).closest(
            `nav, header, .menu, .navbar, .nav-container, .nav-list, .nav-list--horizontal-scroll, .nav-list--defender-subnav, aside`
          ).length > 0;

        if (!isInBadNav && !matchesNavPrefix && !isNavigationLink(link)) {
          promises.push(processReference(link, inlineText));
        } else {
          console.log("🛑 Skipped nav-like link:", link);
        }
      } catch (err) {
        console.warn("⚠️ Skipping invalid link:", link);
      }
    });

  // ✅ 4. Extract from ld+json metadata
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const rawJson = $(scriptTag).html();
      if (rawJson) {
        const metadata = JSON.parse(rawJson);
        const refs = Array.isArray(metadata.references)
          ? metadata.references
          : metadata.references
          ? [metadata.references]
          : [];

        refs.forEach((ref: any) => {
          const refUrl = ref.url?.trim();
          const refTitle = ref.name?.trim();
          if (refUrl) {
            promises.push(processReference(refUrl, refTitle));
          }
        });
      }
    } catch (err) {
      console.error("❌ Error parsing ld+json for references:", err);
    }
  });

  await Promise.all(promises);

  // ✅ 5. De-duplicate by URL
  const uniqueReferences = references.filter(
    (ref, index, self) => index === self.findIndex((r) => r.url === ref.url)
  );

  return uniqueReferences;
};
