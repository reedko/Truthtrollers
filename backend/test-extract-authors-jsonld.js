import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { extractAuthors, mergeAuthors } from "./src/utils/extractAuthors.js";

const nestedGraphHtml = `
  <html><head><script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "Article",
      "headline": "Example",
      "author": [{"@type": "Person", "name": "Ada Example"}]
    }]
  }
  </script></head><body><article><h1>Example</h1></article></body></html>`;

const noAuthorHtml = `
  <html><head><script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Study finds fluoride in water does not affect brain development",
    "publisher": {"@type": "EducationalOrganization", "name": "The University of Queensland"}
  }
  </script></head><body><article><h1>Study</h1><p>Professor Loc Do said the study...</p></article></body></html>`;

const graphAuthors = await extractAuthors(cheerio.load(nestedGraphHtml));
assert.deepEqual(graphAuthors.map((author) => author.name), ["Ada Example"]);

const absentAuthors = await extractAuthors(cheerio.load(noAuthorHtml));
assert.deepEqual(absentAuthors, [], "quoted people must not be invented as webpage authors");

const mergedPdfAuthors = mergeAuthors(
  [{ name: "Lennart Hardell" }, { name: "Mona Nilsson" }],
  [{ name: "Lennart Hardell" }],
);
assert.deepEqual(
  mergedPdfAuthors.map((author) => author.name),
  ["Lennart Hardell", "Mona Nilsson"],
  "partial extension metadata must not suppress authors extracted from the PDF byline",
);

console.log("✅ extractAuthors handles nested JSON-LD and preserves explicit no-author results");
