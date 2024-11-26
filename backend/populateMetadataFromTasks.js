import * as cheerio from "cheerio";
import axios from "axios";
import db from "./dataBase.js";

const { query } = db;

//get some references
const extractInlineReferences = ($) => {
  const references = [];

  // Select the main content container (adjust selector based on target sites)
  const mainContent = $("article, .content, .post-body, .entry-content");

  // Extract hyperlinks only from the main content
  mainContent.find("a[href]").each((_, el) => {
    const link = $(el).attr("href");
    const text = $(el).text().trim();

    // Only include links with meaningful anchor text
    if (
      link &&
      link.startsWith("http") &&
      text.length > 2 && // Exclude links like "Read more"
      !isNavigationLink(link) // Filter out navigation or ads
    ) {
      references.push(link.trim());
    }
  });

  return references;
};

const isNavigationLink = (link) => {
  const patterns = [
    /#/, // Fragments
    /twitter\.com|facebook\.com|linkedin\.com|instagram\.com/, // Social media
    /subscribe|comment|share/, // Call-to-action links
  ];

  return patterns.some((pattern) => pattern.test(link));
};

const isValidReference = (link) => {
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

const extractAndInsertAuthor = async ($, task_id) => {
  try {
    const authorCandidates = []; // Array to store all potential authors

    $('script[type="application/ld+json"]').each((_, scriptTag) => {
      try {
        const metadata = JSON.parse($(scriptTag).html());

        if (Array.isArray(metadata)) {
          metadata.forEach((entry) => {
            if (entry["@type"] === "Person" && entry.name) {
              const author = {
                name: entry.name,
                description: entry.description || null,
                image: entry.image?.contentUrl || null,
              };
              authorCandidates.push(author);
            }
          });
        } else if (metadata.author) {
          const authors = Array.isArray(metadata.author)
            ? metadata.author
            : [metadata.author];
          authors.forEach((author) => {
            if (typeof author === "object" && author.name) {
              authorCandidates.push({
                name: author.name,
                description: author.description || null,
                image: author.image?.contentUrl || null,
              });
            } else if (typeof author === "string") {
              authorCandidates.push({
                name: author,
                description: null,
                image: null,
              });
            }
          });
        }
      } catch (err) {
        console.error("Error parsing ld+json for authors:", err);
      }
    });

    // Step 2: Check meta tags for author information
    if (authorCandidates.length === 0) {
      const rawAuthorNames =
        $('meta[name="author"]').attr("content") ||
        $('meta[property="article:author"]').attr("content") ||
        null;
      if (rawAuthorNames) {
        const splitAuthors = rawAuthorNames.split(/\s*and\s*|,\s*/);
        for (const candidate of splitAuthors) {
          authorCandidates.push({ name: candidate.trim(), title: null });
        }
      }
    }

    // Step 3: Fallback for specific sites like Children's Health Defense
    if (authorCandidates.length === 0) {
      // Look for the script containing `var chd_ga4_data`
      $("script").each((_, scriptTag) => {
        const scriptContent = $(scriptTag).html();

        if (scriptContent.includes("var chd_ga4_data =")) {
          try {
            // Extract the JSON-like string
            const match = scriptContent.match(/var chd_ga4_data = (\{.*?\});/s);

            if (match && match[1]) {
              const chdData = JSON.parse(match[1]);

              // Extract author details
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
    // Step 4: Process all collected author candidates
    for (const { name, title } of authorCandidates) {
      const authorNameParts = name.split(" ");
      const firstName = authorNameParts[0] || null;
      console.log("FN:", firstName);
      const lastName = authorNameParts.slice(1).join(" ") || null;
      console.log(lastName);
      // Call stored procedure to insert or fetch author
      const author = await query(
        "CALL InsertOrGetAuthor(?, ?, NULL, ?, NULL, @authorId)",
        [firstName, lastName, title]
      );

      if (author && author[0] && author[0][0]) {
        const authorId = author[0][0].authorId;

        // Insert into task_authors
        await query(
          "INSERT INTO task_authors (task_id, author_id) VALUES (?, ?)",
          [task_id, authorId]
        );
      } else {
        console.warn(`Failed to process author: ${name}`);
      }
    }
  } catch (error) {
    console.error(`Error extracting author for task ID ${task_id}:`, error);
  }
};

const populateMetadataFromTasks = async () => {
  try {
    const tasks = await query(
      "SELECT task_id, url FROM tasks WHERE url IS NOT NULL"
    );

    for (const task of tasks) {
      const { task_id, url } = task;
      console.log(task_id);
      if (task_id) {
        try {
          console.log("wait");
          const { data } = await axios.get(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; TruthTrollers/1.0)",
            },
          });

          const $ = cheerio.load(data);
          //do the author
          extractAndInsertAuthor($, task_id);

          let publisherName = "Unknown Publisher";

          // General metadata extraction
          publisherName =
            $('meta[property="og:site_name"]').attr("content") ||
            $('meta[name="publisher"]').attr("content") ||
            "Unknown Publisher";

          // Substack-specific fallback
          if (
            publisherName === "Unknown Publisher" &&
            url.includes("substack.com")
          ) {
            const title = $("title").text();
            const publisherMatch = title.match(/^(.*?)(?: on Substack)?$/i); // Extract name before "on Substack"
            publisherName = publisherMatch
              ? publisherMatch[1].trim()
              : "Unknown Publisher";
          }

          const publisher = await query(
            "CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)",
            [publisherName]
          );

          if (publisher && publisher[0] && publisher[0][0]) {
            const publisherId = publisher[0][0].publisherId;
            await query(
              "INSERT INTO task_publishers (task_id, publisher_id) VALUES (?, ?)",
              [task_id, publisherId]
            );
          }

          const references = [];
          // Parse <script type="application/ld+json"> for structured data
          $('script[type="application/ld+json"]').each((_, scriptTag) => {
            try {
              const metadata = JSON.parse($(scriptTag).html());
              if (metadata.citation || metadata.references) {
                const refs = Array.isArray(metadata.references)
                  ? metadata.references
                  : [metadata.references];
                refs.forEach((ref) => {
                  if (ref.url && isValidReference(ref.url)) {
                    references.push(ref.url);
                  }
                });
              }
            } catch (err) {
              console.error("Error parsing ld+json:", err);
            }
          });

          // Select the main content container (adjust selector based on target sites)
          const mainContent = $(
            "article, .content, .post-body, .entry-content"
          );

          // Extract hyperlinks only from the main content
          mainContent.find("a[href]").each((_, el) => {
            const link = $(el).attr("href");
            const text = $(el).text().trim();

            // Only include links with meaningful anchor text
            if (
              link &&
              link.startsWith("http") &&
              text.length > 2 && // Exclude links like "Read more"
              !isNavigationLink(link) // Filter out navigation or ads
            ) {
              references.push(link.trim());
            }
          });

          for (const referenceLink of references) {
            try {
              const litReference = await query(
                "CALL InsertOrGetReference(?, @litReferenceId)",
                [referenceLink]
              );

              if (litReference && litReference[0] && litReference[0][0]) {
                const litReferenceId = litReference[0][0].litReferenceId;

                // Insert into task_references table
                await query(
                  "INSERT INTO task_references (task_id, lit_reference_id) VALUES (?, ?)",
                  [task_id, litReferenceId]
                );
              } else {
                console.error(
                  "Failed to insert or retrieve lit reference for:",
                  referenceLink
                );
              }
            } catch (err) {
              console.error(
                "Error handling lit reference:",
                referenceLink,
                err
              );
            }
          }
        } catch (err) {
          console.error(`Error processing task ID ${task_id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("Error populating metadata:", err.message);
  }
};

populateMetadataFromTasks();
