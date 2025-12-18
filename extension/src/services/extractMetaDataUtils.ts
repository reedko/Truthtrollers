// extractMetaDataUtils.ts
import * as cheerio from "cheerio";
import { Author, Lit_references, Publisher } from "../entities/Task";
import {
  isLikelyBad,
  CONTENT_SELECTORS,
  BAD_ANCESTORS,
  hasCitationCue,
} from "./referenceExtractor";

export const extractImageFromHtml = (
  html: string,
  url: string
): string | null => {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);
  let ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    ogImage = decodeURIComponent(ogImage);
    ogImage = resolveUrl(ogImage, baseUrl);
    if (isProcessableImage(ogImage)) return ogImage;
  }
  let maxArea = 0;
  let chosenImage: string | null = null;
  $("img").each((_, img) => {
    let src = $(img).attr("src") || "";
    let srcset = $(img).attr("srcset") || "";
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;
    if (srcset) {
      const bestSrc = parseSrcset(srcset);
      if (bestSrc) src = bestSrc;
    }
    src = resolveUrl(decodeURIComponent(src), baseUrl);
    if (area > maxArea && isProcessableImage(src)) {
      maxArea = area;
      chosenImage = src;
    }
  });
  if (!chosenImage) {
    $("img").each((_, img) => {
      let src = $(img).attr("src") || "";
      src = resolveUrl(decodeURIComponent(src), baseUrl);
      if (isProcessableImage(src)) {
        chosenImage = src;
        return false;
      }
    });
  }
  return chosenImage;
};

export const removeCookieWalls = (html: string): string => {
  const $ = cheerio.load(html);
  $(
    '[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"],' +
      ".qc-cmp2-container, .truste_popframe, #onetrust-banner-sdk"
  ).remove();
  return $.html();
};

export const detectRetraction = (html: string): boolean => {
  const lower = html.toLowerCase();
  return lower.includes("retracted") || lower.includes("withdrawn");
};

export const isLikelyRSS = (html: string) =>
  html.trim().startsWith("<rss") || html.toLowerCase().includes("<feed");

export const testImageLoad = async (url: string) => {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) throw new Error(`HTTP status ${response.status}`);
    const contentType = response.headers.get("content-type");
    return contentType?.startsWith("image/") ?? false;
  } catch {
    return false;
  }
};

export const parseSrcset = (srcset: string) => {
  return srcset
    .split(",")
    .map((entry) => {
      const [url, size] = entry.trim().split(/\s+/);
      return { url, width: parseInt(size, 10) || 0 };
    })
    .reduce(
      (best, candidate) => (candidate.width > best.width ? candidate : best),
      {
        url: "",
        width: 0,
      }
    ).url;
};

export const resolveUrl = (src: string, baseUrl: URL) => {
  if (!src.startsWith("http")) {
    return src.startsWith("/")
      ? new URL(src, baseUrl.origin).href
      : new URL(src, baseUrl).href;
  }
  return src;
};

export const isProcessableImage = (url: string) => {
  if (!url) return false;
  const decodedUrl = decodeURIComponent(url);
  const httpsCount = (decodedUrl.match(/https:\/\//g) || []).length;
  const isLikelySrcSet =
    decodedUrl.includes("&w=") || decodedUrl.includes(" 400w");
  if (httpsCount > 1 && !isLikelySrcSet) return false;
  const invalidPatterns = ["data:", "blob:", "svg", "gif"];
  if (invalidPatterns.some((pattern) => decodedUrl.includes(pattern)))
    return false;
  return /\.(jpg|jpeg|png|webp)$/i.test(decodedUrl);
};

export const formatUrlForTitle = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const readablePart = pathname.split("/").filter((part) => part.length > 3);
    return readablePart.length
      ? readablePart.join(" ").replace(/[-_]/g, " ")
      : hostname;
  } catch {
    return url;
  }
};

export const isValidReference = (link: string): boolean => {
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

export const isNavigationLink = (link: string): boolean => {
  return /#|twitter\.com|facebook\.com|linkedin\.com|instagram\.com|subscribe|comment|share|login|menu|footer|nav/i.test(
    link
  );
};

export const getNavCategoryPrefixes = ($: cheerio.CheerioAPI): string[] => {
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
        } catch {}
      }
    }
  );
  return [...prefixes];
};

export const fetchPageContent = async (
  url?: string
): Promise<cheerio.CheerioAPI> => {
  // If no URL provided, use current document (extension context)
  if (!url) {
    const loadedCheerio = cheerio.load(document.documentElement.outerHTML);
    return loadedCheerio;
  }

  // Dashboard context: Send message to background script to get HTML from matching tab
  console.log(`🔍 Requesting HTML from tab with UXRL: ${url}`);

  try {
    // Get the extension ID that was injected by the extension's content script
    const extensionId = (window as any).EXTENSION_ID;

    if (!extensionId) {
      throw new Error(
        "Extension ID not found. Make sure the Truthtrollers extension is installed and running."
      );
    }

    console.log(`📤 Sending message to extension ${extensionId}`);

    // Use browser-agnostic API
    const browserAPI = (window as any).browser || (window as any).chrome;

    if (!browserAPI || !browserAPI.runtime) {
      throw new Error("Browser extension API not available");
    }

    console.log(
      `📡 Using API:`,
      browserAPI === (window as any).browser ? "browser" : "chrome"
    );
    console.log(`📨 Sending getHTMLFromTab message for URL: ${url}`);

    const response = await browserAPI.runtime.sendMessage(extensionId, {
      action: "getHTMLFromTab",
      url: url,
    });

    console.log(`📬 Received response:`, response);

    if (!response.success || !response.html) {
      throw new Error(response.error || "Failed to get HTML from tab");
    }

    console.log(`📄 Retrieved ${response.html.length} chars of HTML from tab`);
    const loadedCheerio = cheerio.load(response.html);
    return loadedCheerio;
  } catch (error) {
    console.error("❌ Error fetching HTML from tab:", error);
    throw error;
  }
};

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
  $('[class*="author"][class*="wrapper"]').each((_, authorWrapper) => {
    // Try to get name from various possible elements inside the wrapper
    let name =
      $(authorWrapper).find(".text-weight-semibold").text().trim() ||
      $(authorWrapper).find('[class*="name"]').first().text().trim() ||
      $(authorWrapper).find("strong").first().text().trim() ||
      $(authorWrapper).find("a").first().text().trim();

    // Try to get image src from common class or any img inside
    let image = $(authorWrapper).find("img").first().attr("src") || null;

    if (name) {
      authors.push({
        name,
        description: null,
        image,
      });
      console.log("✨ Found author via [class*='author'][class*='wrapper']:", {
        name,
        image,
      });
    }
  });
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

export const extractReferences = async (
  $: cheerio.CheerioAPI
): Promise<Lit_references[]> => {
  const MAX_RESULTS = 30;
  const seen = new Set<string>();
  const refs: Lit_references[] = [];

  const pushRef = (url?: string, title?: string) => {
    if (!url) return;
    const href = url.trim();
    if (!href || !href.startsWith("http") || isLikelyBad(href)) return;
    if (seen.has(href)) return;
    seen.add(href);
    refs.push({
      url: href,
      content_name: (title || "").trim() || formatUrlForTitle(href),
    });
  };

  // -------- 1) DOM crawl (content-scoped) --------
  const $scope = $(CONTENT_SELECTORS).length ? $(CONTENT_SELECTORS) : $.root();

  $scope.find("a[href]").each((_, el) => {
    const $a = $(el);
    const href = ($a.attr("href") || "").trim();
    if (!href || !href.startsWith("http") || isLikelyBad(href)) return;

    // avoid nav/recirc/etc
    if ($a.closest(BAD_ANCESTORS).length) return;

    // must live in reasonable text containers
    const tag = (
      $a.closest("p, li, figcaption, .footnote, sup").prop("tagName") || ""
    ).toLowerCase();
    if (!tag) return;

    // require a cue in anchor text or the container sentence
    const anchorText = $a.text().trim();
    const containerText =
      $a.closest("p, li, figcaption, .footnote").text().trim() || anchorText;
    if (!hasCitationCue(anchorText) && !hasCitationCue(containerText)) return;

    pushRef(href, anchorText);
  });

  // -------- 2) JSON-LD references (robust parsing) --------
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    let raw = $(scriptTag).text().trim();
    if (!raw) return;

    // Some sites stuff multiple JSON objects or arrays into one tag or have trailing semicolons.
    // Try a few safe parses:
    const candidates: any[] = [];

    const tryParse = (s: string) => {
      try {
        const v = JSON.parse(s);
        candidates.push(v);
      } catch {
        /* ignore */
      }
    };

    // 2a) raw as-is (common case)
    tryParse(raw);

    // 2b) strip trailing semicolon
    if (raw.endsWith(";")) tryParse(raw.slice(0, -1));

    // 2c) if looks like a “}{” concatenation, split naïvely into objects
    if (!candidates.length && /}\s*{/.test(raw)) {
      const parts = raw
        .split(/}\s*{/)
        .map((s, i, arr) =>
          i === 0 ? s + "}" : i === arr.length - 1 ? "{" + s : "{" + s + "}"
        );
      parts.forEach(tryParse);
    }

    const flatten = (v: any): any[] =>
      Array.isArray(v) ? v.flatMap(flatten) : [v];

    const allObjs = candidates.flatMap(flatten);

    const pickRefs = (node: any) => {
      if (!node || typeof node !== "object") return;

      // Schema.org often puts references under `references`
      const refsNode =
        node.references ??
        node.citation ?? // some publishers
        null;

      const list = Array.isArray(refsNode)
        ? refsNode
        : refsNode
        ? [refsNode]
        : [];
      list.forEach((r: any) => {
        const u = typeof r === "string" ? r : r?.url;
        const name =
          (typeof r === "object" && (r.name || r.headline || r.title)) || "";
        pushRef(u, name);
      });

      // Recurse shallowly for nested structures (isPartOf/hasPart/graph)
      ["isPartOf", "hasPart", "@graph", "itemListElement"].forEach((k) => {
        const v = (node as any)[k];
        if (!v) return;
        flatten(v).forEach(pickRefs);
      });
    };

    allObjs.forEach(pickRefs);
  });

  // keep original order preference (DOM first, then JSON-LD appended)
  // already achieved because DOM emits before JSON-LD, and dedupe happens on push

  return refs.slice(0, MAX_RESULTS);
};

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const checkIfPdfViaHead = async (url: string) => {
  console.log("toapi");
  const res = await fetch(
    `${BASE_URL}/api/check-pdf-head?url=${encodeURIComponent(url)}`
  );
  const data = await res.json();
  return data.isPdf;
};
