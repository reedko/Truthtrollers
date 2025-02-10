import * as cheerio from "cheerio";
import { Author, Lit_references, Publisher } from "../entities/Task";

const isValidReference = (link: any) => {
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
  return cheerio.load(document.documentElement.outerHTML);
};

export const extractAuthors = async (
  $: cheerio.CheerioAPI
): Promise<Author[]> => {
  const authorCandidates: Author[] = [];

  // Step 1: Extract from JSON-LD
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const metadata = JSON.parse($(scriptTag).html() || "");

      if (Array.isArray(metadata)) {
        metadata.forEach((entry) => {
          if (entry["@type"] === "Person" && entry.name) {
            authorCandidates.push({
              name: entry.name,
              description: entry.description || null,
              image: entry.image?.contentUrl || null,
            });
          }
        });
      } else if (metadata.author) {
        const authors = Array.isArray(metadata.author)
          ? metadata.author
          : [metadata.author];
        authors.forEach((author: any) => {
          if (typeof author === "object" && author.name) {
            authorCandidates.push({
              name: author.name,
              description: author.description || null,
              image: author.image?.contentUrl || null,
            });
          } else if (typeof author === "string") {
            authorCandidates.push({ name: author });
          }
        });
      }
    } catch (err) {
      console.error("Error parsing ld+json for authors:", err);
    }
  });

  // Step 2: Extract from meta tags
  if (authorCandidates.length === 0) {
    const rawAuthorNames =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content") ||
      null;

    if (rawAuthorNames) {
      const splitAuthors = rawAuthorNames.split(/\s*and\s*|,\s*/);
      splitAuthors.forEach((name) => {
        authorCandidates.push({ name: name.trim() });
      });
    }
  }
  // Step 2: Extract from meta citation tags
  if (authorCandidates.length === 0) {
    // Find all relevant meta tags for authors
    $(
      'meta[name="citation_author"], meta[property="article:citation_author"]'
    ).each((_, metaTag) => {
      const rawAuthorName = $(metaTag).attr("content");
      if (rawAuthorName) {
        // Split names if multiple authors are listed in a single tag
        const splitAuthors = rawAuthorName.split(/\s*and\s*|,\s*/);
        splitAuthors.forEach((name) => {
          authorCandidates.push({ name: name.trim() });
        });
      }
    });
  }

  // Step 3: Fallback for specific cases (e.g., Children's Health Defense)
  if (authorCandidates.length === 0) {
    $("script").each((_, scriptTag) => {
      const scriptContent = $(scriptTag).html();
      if (scriptContent?.includes("var chd_ga4_data =")) {
        try {
          const match = scriptContent.match(/var chd_ga4_data = (\{.*?\});/s);
          if (match && match[1]) {
            const chdData = JSON.parse(match[1]);
            if (chdData.contentAuthor) {
              authorCandidates.push({
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
  console.log(authorCandidates, ":AC");
  return authorCandidates;
};
export const extractPublisher = async (
  $: cheerio.CheerioAPI
): Promise<Publisher> => {
  // Step 1: Extract from meta tags
  let publisherName =
    $('meta[property="og:site_name"]').attr("content") ||
    $('meta[name="publisher"]').attr("content") ||
    $('meta[name="citation_journal_title"]').attr("content") ||
    "Unknown Publisher";

  // Step 2: If not found, attempt to extract from ld+json scripts
  if (publisherName === "Unknown Publisher") {
    const ldJsonScripts = $('script[type="application/ld+json"]');

    ldJsonScripts.each((_, elem) => {
      try {
        const jsonText = $(elem).contents().text();
        const jsonData = JSON.parse(jsonText);

        // Helper function to recursively search for NewsMediaOrganization
        const findPublisherInJson = (data: any): string | null => {
          if (Array.isArray(data)) {
            for (const item of data) {
              const result = findPublisherInJson(item);
              if (result) return result;
            }
          } else if (typeof data === "object" && data !== null) {
            if (data["@type"] === "NewsMediaOrganization" && data.name) {
              return data.name;
            }
            // Recursively search in all properties
            for (const key in data) {
              if (data.hasOwnProperty(key)) {
                const result = findPublisherInJson(data[key]);
                if (result) return result;
              }
            }
          }
          return null;
        };

        const publisherFromJson = findPublisherInJson(jsonData);
        if (publisherFromJson) {
          publisherName = publisherFromJson;
          return false; // Break out of `.each()`
        }
      } catch (err) {
        console.warn(`Failed to parse ld+json script: ${err}`);
      }
    });
  }

  // Step 3: Handle special cases (e.g., Substack) **without using URL**
  if (publisherName === "Unknown Publisher") {
    const title = $("title").text();
    if (title.includes("on Substack")) {
      const match = title.match(/^(.*?)(?: on Substack)?$/i);
      publisherName = match ? match[1].trim() : "Unknown Publisher";
    }
  }

  return { name: publisherName };
};

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const extractReferences = async (
  $: cheerio.CheerioAPI
): Promise<Lit_references[]> => {
  const lit_references: Lit_references[] = [];
  const promises: Promise<void>[] = [];

  const processReference = async (url: string, potentialTitle?: string) => {
    url = url.trim();
    if (!isValidReference(url)) return;

    // Step 1: Check the database first
    const storedTitle = await checkDatabaseForReference(url);
    if (storedTitle) {
      lit_references.push({
        lit_reference_link: url,
        lit_reference_title: storedTitle,
      });
      return;
    }

    // Step 2: Fetch title from Diffbot (Highest Priority)
    try {
      const title = await fetchTitleFromDiffbot(url);
      if (title && title.trim().length > 3) {
        lit_references.push({
          lit_reference_link: url,
          lit_reference_title: title,
        });
        return;
      }
    } catch (err) {
      console.error(`Error fetching title for ${url}:`, err);
    }

    // Step 3: Use potential inline title as a fallback
    if (potentialTitle && potentialTitle.length > 3) {
      lit_references.push({
        lit_reference_link: url,
        lit_reference_title: potentialTitle,
      });
      return;
    }

    // Step 4: Final fallback – Format URL into a readable title
    lit_references.push({
      lit_reference_link: url,
      lit_reference_title: formatUrlForTitle(url),
    });
  };

  // **Extract from Main Content**
  $("article, .content, .post-body, .entry-content, .ref-list")
    .find("a[href]")
    .each((_, el) => {
      const link = $(el).attr("href")?.trim();
      const inlineText = $(el).text().trim(); // Extract inline text normally

      if (link && link.startsWith("http") && !isNavigationLink(link)) {
        promises.push(processReference(link, inlineText));
      }
    });

  // **Extract from JSON-LD structured data**
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const rawJson = $(scriptTag).html();
      if (rawJson) {
        const metadata = JSON.parse(rawJson);
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
      console.error("Error parsing ld+json:", err);
    }
  });

  // **Extract from Citation Lists (PubMed, DOI, etc.)**
  $(".ref-list li cite").each((_, citeEl) => {
    const citationText = $(citeEl).text().trim();
    const doiLink = $(citeEl)
      .siblings('a[href*="doi.org"]')
      .attr("href")
      ?.trim();
    const pubMedLink = $(citeEl)
      .siblings('a[href*="pubmed.ncbi.nlm.nih.gov"]')
      .attr("href")
      ?.trim();

    if (doiLink) promises.push(processReference(doiLink, citationText));
    if (pubMedLink) promises.push(processReference(pubMedLink, citationText));
  });

  await Promise.all(promises);
  return lit_references;
};

// ✅ Use Diffbot API to fetch the title for a given URL
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

const checkDatabaseForReference = async (
  url: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "checkDatabaseForReference", url },
      (response) => {
        resolve(response);
      }
    );
  });
};

// ✅ Fallback: Convert a URL into a readable title-like string
const formatUrlForTitle = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const readablePart = pathname.split("/").filter((part) => part.length > 3); // Ignore short fragments
    return readablePart.length
      ? readablePart.join(" ").replace(/-/g, " ")
      : hostname;
  } catch (err) {
    return url; // Fallback to full URL if parsing fails
  }
};

const isNavigationLink = (link: string): boolean => {
  const patterns = [
    /#/, // Fragments
    /twitter\.com|facebook\.com|linkedin\.com|instagram\.com/, // Social media
    /subscribe|comment|share/, // Call-to-action links
  ];

  return patterns.some((pattern) => pattern.test(link));
};
