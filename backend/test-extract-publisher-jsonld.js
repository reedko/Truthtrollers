import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { extractPublisher } from "./src/utils/extractPublisher.js";

const $ = cheerio.load(`
  <html>
    <head>
      <meta property="og:site_name" content="News">
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Study finds fluoride in water does not affect brain development",
        "publisher": {
          "@type": "EducationalOrganization",
          "name": "The University of Queensland"
        }
      }</script>
    </head>
    <body><article>Study body</article></body>
  </html>
`);

const publisher = await extractPublisher($, "https://news.uq.edu.au/example");
assert.equal(publisher?.name, "The University of Queensland");
console.log("publisher JSON-LD precedence test passed");
