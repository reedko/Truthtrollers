import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production provenance routes use live claim_sources columns", async () => {
  const source = await readFile("src/routes/claims/claims.routes.js", "utf8");
  const section = source.slice(source.indexOf("CLAIM SOURCES API"), source.indexOf("GET /api/reference-claim-links"));
  assert.match(section, /WHERE claim_source_id = \?/u);
  assert.match(section, /SET reference_content_id = \?/u);
  assert.doesNotMatch(section, /claim_sources_id\s*=|SET reference_id|notes\s*=\s*\?/u);
});

test("document-link approval does not write an absent verified_at column", async () => {
  const source = await readFile("src/routes/claims/referenceClaimTask.routes.js", "utf8");
  const section = source.slice(source.indexOf("reference-claim-links/approve"), source.indexOf("reassess-claim-relevance"));
  assert.doesNotMatch(section, /verified_at/u);
});
