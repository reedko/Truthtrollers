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

  // Target main content areas, including ref-list
  const mainContent = $(
    "article, .content, .post-body, .entry-content, .ref-list"
  );

  // Extract hyperlinks from the main content
  mainContent.find("a[href]").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();

    if (
      link &&
      link.startsWith("http") &&
      text.length > 2 &&
      !isNavigationLink(link)
    ) {
      const p = fetchTitleFromDiffbot(link)
        .then((title) => {
          lit_references.push({
            lit_reference_link: link.trim(),
            lit_reference_title: title || formatUrlForTitle(link), // Fallback if title fails
          });
        })
        .catch((err) => {
          console.error(`Error fetching title for ${link}:`, err);
          lit_references.push({
            lit_reference_link: link.trim(),
            lit_reference_title: formatUrlForTitle(link),
          });
        });

      promises.push(p);
    }
  });

  // Parse <script type="application/ld+json"> for structured data
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const rawJson = $(scriptTag).html();
      if (rawJson) {
        const metadata = JSON.parse(rawJson);
        if (metadata.citation || metadata.references) {
          const refs = Array.isArray(metadata.references)
            ? metadata.references
            : [metadata.references];

          refs.forEach((ref: any) => {
            if (ref.url && isValidReference(ref.url)) {
              const p = fetchTitleFromDiffbot(ref.url)
                .then((title) => {
                  lit_references.push({
                    lit_reference_link: ref.url,
                    lit_reference_title: title || formatUrlForTitle(ref.url),
                  });
                })
                .catch((err) => {
                  console.error(
                    `Error fetching title for reference ${ref.url}:`,
                    err
                  );
                  lit_references.push({
                    lit_reference_link: ref.url,
                    lit_reference_title: formatUrlForTitle(ref.url),
                  });
                });

              promises.push(p);
            }
          });
        }
      }
    } catch (err) {
      console.error("Error parsing ld+json:", err);
    }
  });

  // Look specifically for unordered lists with the class "ref-list"
  $(".ref-list li cite").each((_, citeEl) => {
    const citationText = $(citeEl).text().trim();
    if (citationText) {
      const doiLink = $(citeEl).siblings('a[href*="doi.org"]').attr("href");
      const pubMedLink = $(citeEl)
        .siblings('a[href*="pubmed.ncbi.nlm.nih.gov"]')
        .attr("href");

      if (pubMedLink && isValidReference(pubMedLink)) {
        const p = fetchTitleFromDiffbot(pubMedLink)
          .then((title) => {
            lit_references.push({
              lit_reference_link: pubMedLink,
              lit_reference_title: title || formatUrlForTitle(pubMedLink),
            });
          })
          .catch((err) => {
            console.error(
              `Error fetching title for reference ${pubMedLink}:`,
              err
            );
            lit_references.push({
              lit_reference_link: pubMedLink,
              lit_reference_title: formatUrlForTitle(pubMedLink),
            });
          });

        promises.push(p);
      }
    }
  });

  await Promise.all(promises);

  return lit_references;
};

// ✅ Use Diffbot API to fetch the title for a given URL
const fetchTitleFromDiffbot = async (url: string) => {
  const response = await fetch(`${BASE_URL}/api/get-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    console.error("Error fetching title from Diffbot:", response.statusText);
    return null;
  }

  const responseData = await response.json();
  console.log(responseData, "<-string title");
  return responseData || null;
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
