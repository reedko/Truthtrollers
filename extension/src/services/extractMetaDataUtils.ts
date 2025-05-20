// extractMetaDataUtils.ts
import * as cheerio from "cheerio";
import { Author, Lit_references, Publisher } from "../entities/Task";

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

export const fetchPageContent = (): cheerio.CheerioAPI => {
  const loadedCheerio = cheerio.load(document.documentElement.outerHTML);

  return loadedCheerio;
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
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const checkIfPdfViaHead = async (url: string) => {
  console.log("toapi");
  const res = await fetch(
    `${BASE_URL}/api/check-pdf-head?url=${encodeURIComponent(url)}`
  );
  const data = await res.json();
  return data.isPdf;
};
