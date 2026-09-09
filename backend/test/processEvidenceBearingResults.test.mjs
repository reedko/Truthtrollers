import test from "node:test";
import assert from "node:assert/strict";

import {
  BEARING_ADJUDICATION_CONCURRENCY,
  processEvidenceBearingResults,
} from "../src/core/processEvidenceBearingResults.js";

test("shared bearing workflow retains supported and snippet-only sources and prunes the rest", async () => {
  const queries = [];
  let insertedLinks = [];
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("SELECT content_id") && sql.includes("content_relations")) {
      return [{ content_id: 100 }];
    }
    return { affectedRows: 1 };
  };

  const result = await processEvidenceBearingResults({
    query,
    taskContentId: 100,
    taskClaims: [{ id: 1, text: "The claim" }],
    claimIds: [1],
    aiReferences: [
      { referenceContentId: 10, url: "https://supported.example", scrapeStatus: "full" },
      { referenceContentId: 20, url: "https://irrelevant.example", scrapeStatus: "full" },
      {
        referenceContentId: 30,
        url: "https://failed.example",
        scrapeStatus: "snippet_only",
        quality: 0.4,
        snippetBearings: [{ claimIndex: 0, bearingScore: -0.7, snippet: "Contrary snippet" }],
      },
    ],
    bearingResults: [
      {
        referenceContentId: 10,
        quality: 0.8,
        bearing: {
          assertions: [{ taskClaimId: 1, evidenceAssertion: "Supporting assertion" }],
        },
        snippetBearings: [{ taskClaimId: 1, bearingScore: 0.9, snippet: "Supporting snippet" }],
      },
      { referenceContentId: 20, bearing: { assertions: [] }, snippetBearings: [] },
    ],
    dependencies: {
      promptManager: {},
      llm: {},
      persistClaims: async () => [501],
      adjudicateEvidenceBearing: async () => ({
        results: [{ evidenceAssertionId: "501", bearingScore: 0.9, rationale: "Direct support" }],
      }),
      insertReferenceClaimLinksBulk: async (_query, links) => {
        insertedLinks = links;
        return links.map((_, index) => index + 1);
      },
    },
  });

  assert.deepEqual(
    result.retainedAiReferences.map((reference) => reference.referenceContentId),
    [10, 30],
  );
  assert.equal(result.referenceClaimLinksInserted, 2);
  assert.deepEqual(
    insertedLinks.map(({ reference_content_id, stance, support_level, scrape_status }) => ({
      reference_content_id,
      stance,
      support_level,
      scrape_status,
    })),
    [
      { reference_content_id: 10, stance: "support", support_level: 0.9, scrape_status: "full" },
      { reference_content_id: 30, stance: "refute", support_level: -0.7, scrape_status: "snippet_only" },
    ],
  );
  assert.ok(
    queries.some(({ sql, params }) => sql.includes("reference_claim_task_links") && params[2] === "support"),
  );
  assert.ok(
    queries.some(({ sql, params }) => sql.includes("CALL delete_content_cascade") && params[0] === 20),
  );
});

test("caps concurrent bearing adjudication without changing retention", async () => {
  let active = 0;
  let maxActive = 0;
  const documents = Array.from({ length: 8 }, (_, index) => ({
    referenceContentId: 1000 + index,
    bearing: {
      assertions: [
        {
          taskClaimId: 1,
          evidenceAssertion: `Assertion ${index}`,
        },
      ],
    },
    snippetBearings: [],
  }));

  const result = await processEvidenceBearingResults({
    query: async () => ({ affectedRows: 1 }),
    taskContentId: 100,
    taskClaims: [{ id: 1, text: "The claim" }],
    claimIds: [1],
    aiReferences: documents.map((doc) => ({
      referenceContentId: doc.referenceContentId,
      scrapeStatus: "full",
    })),
    bearingResults: documents,
    dependencies: {
      persistClaims: async (_query, referenceContentId) => [
        referenceContentId * 10,
      ],
      adjudicateEvidenceBearing: async ({ evidenceAssertions }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;

        return {
          results: [
            {
              evidenceAssertionId: evidenceAssertions[0].evidenceAssertionId,
              bearingScore: 0.8,
              rationale: "Supports the claim",
            },
          ],
        };
      },
      insertReferenceClaimLinksBulk: async () => {},
      promptManager: {},
      llm: {},
    },
  });

  assert.equal(maxActive, BEARING_ADJUDICATION_CONCURRENCY);
  assert.equal(result.retainedBearingResults.length, documents.length);
});
