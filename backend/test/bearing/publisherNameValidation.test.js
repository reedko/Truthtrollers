import assert from "node:assert/strict";
import test from "node:test";
import * as cheerio from "cheerio";

import {
  extractHtmlPublishingIdentity,
  chooseLegacyPrimaryPublisher,
} from "../../src/utils/extractPublisher.js";
import {
  isTrackingOrCodePublisherName,
  isUsableSourceEntityName,
} from "../../src/utils/publisherNameValidation.js";

test("publisher identity rejects tracking-parameter and JavaScript expressions", () => {
  assert.equal(isTrackingOrCodePublisherName("params.utm_source,"), true);
  assert.equal(isTrackingOrCodePublisherName("searchParams.get(utm_source)"), true);
  assert.equal(isUsableSourceEntityName("Port Townsend FreePress"), true);
  assert.equal(isUsableSourceEntityName("Centers for Disease Control and Prevention (CDC)"), true);
  assert.equal(isUsableSourceEntityName("params.utm_source,"), false);
});

test("publisher visible-label extraction ignores Publisher text inside scripts", async () => {
  const $ = cheerio.load(`
    <html>
      <head>
        <title>Public Health's Truth About Vaccines | Port Townsend FreePress</title>
        <meta property="og:site_name" content="Port Townsend FreePress">
        <script>const label = "Publisher: params.utm_source,";</script>
      </head>
      <body><article>Article body.</article></body>
    </html>
  `);
  const identity = await extractHtmlPublishingIdentity(
    $,
    "https://www.porttownsendfreepress.com/2026/04/12/example/",
  );
  const allNames = identity.candidates.map((candidate) => candidate.name);

  assert.equal(allNames.includes("params.utm_source"), false);
  assert.equal(chooseLegacyPrimaryPublisher(identity).name, "Port Townsend FreePress");
});
