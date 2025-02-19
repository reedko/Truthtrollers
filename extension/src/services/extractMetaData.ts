// extractMetaData.ts
import * as cheerio from "cheerio";
import { Author, TaskData, Lit_references, Publisher } from "../entities/Task";

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

export const fetchPageContent = (): cheerio.CheerioAPI => {
  const loadedCheerio = cheerio.load(document.documentElement.outerHTML);
  console.log(loadedCheerio, ":from cheerio");
  return loadedCheerio;
};

export const fetchExternalPageContent = async (
  url: string
): Promise<cheerio.CheerioAPI> => {
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok)
      throw new Error(`Failed to fetch page: ${response.status}`);
    const html = await response.text();
    return cheerio.load(html); // Return Cheerio instance
  } catch (error) {
    console.error(`Error fetching external page: ${error}`);
    return cheerio.load(""); // Return an empty Cheerio instance if error
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
  if (publisherName === "Unknown Publisher") {
    $('script[type="application/ld+json"]').each((_, elem) => {
      try {
        const jsonData = JSON.parse($(elem).contents().text());
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
        publisherName = findPublisher(jsonData) || publisherName;
      } catch (err) {
        console.warn(`Failed to parse ld+json script: ${err}`);
      }
    });
  }

  // Handle Substack
  if (publisherName === "Unknown Publisher") {
    const title = $("title").text();
    if (title.includes("on Substack")) {
      const match = title.match(/^(.*?)(?: on Substack)?$/i);
      publisherName = match ? match[1].trim() : "Unknown Publisher";
    }
  }

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

    let content_name = await fetchTitleFromDiffbot(url);

    content_name = content_name || potentialTitle || formatUrlForTitle(url);

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
      if (link && link.startsWith("http") && !isNavigationLink(link)) {
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
  return references;
};

// Helpers
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
