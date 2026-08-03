import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxSubstantiveReviewReportHtml,
} from "../../../src/claimfoundry/cfx/substantiveReview/buildReportHtml.js";
import {
  buildCfxSubstantiveReviewRequest,
  runCfxSubstantiveReview,
} from "../../../src/claimfoundry/cfx/substantiveReview/runSubstantiveReview.js";
import {
  CFX_SUBSTANTIVE_REVIEW_PROMPT_SHA256,
  loadCfxSubstantiveReviewPrompt,
} from "../../../src/claimfoundry/cfx/prompts/governedPrompts.js";
import {
  CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA,
} from "../../../src/claimfoundry/cfx/schemas/substantiveReviewSchema.js";
import type {
  CfxUnitAwareInventory,
} from "../../../src/claimfoundry/cfx/discoveryWithUnits/types.js";
import type {
  CfxFrozenArticle,
} from "../../../src/claimfoundry/cfx/types/index.js";

function syntheticArticle(): CfxFrozenArticle {
  const sourceUnits = [
    {
      unitId: "U0001",
      text: "The first source unit.",
      charStart: 0,
      charEnd: 22,
    },
    {
      unitId: "U0002",
      text: "The second source unit.",
      charStart: 23,
      charEnd: 46,
    },
    {
      unitId: "U0003",
      text: "The final source unit.",
      charStart: 47,
      charEnd: 69,
    },
  ];
  return {
    fixtureId: "synthetic",
    fixturePath: "/synthetic",
    fixtureFileSha256: "fixture",
    articleTextSha256: "article",
    normalizedArticleHash: "normalized",
    sourceUnitManifestHash: "unit-manifest",
    articleTitle: "Synthetic",
    articleText: sourceUnits.map((unit) => unit.text).join(" "),
    canonicalText: sourceUnits.map((unit) => unit.text).join(" "),
    articleCharacterCount: 69,
    sourceUnitCount: sourceUnits.length,
    sourceUnits,
    unitProjection: sourceUnits.map(
      (unit) => `[${unit.unitId}] ${unit.text}`,
    ).join("\n\n"),
    unitProjectionSha256: "projection",
  };
}

function sourceInventory(): CfxUnitAwareInventory {
  return {
    schemaVersion: "cfx.unitAwarePropositions.v1",
    fixtureId: "synthetic",
    propositions: Array.from({ length: 12 }, (_, index) => ({
      propositionId: `P${String(index + 1).padStart(2, "0")}`,
      assertion: index === 0
        ? "<script>selected</script>"
        : `Selected assertion ${index + 1}`,
      assertionSource: `Current source ${index + 1}`,
      whyItMattersToArticleThesis: `Reason ${index + 1}`,
      groundingUnitIds: [
        `U${String((index % 3) + 1).padStart(4, "0")}`,
      ],
    })),
  };
}

function reviewOutput() {
  return {
    results: Array.from({ length: 12 }, (_, index) => ({
      propositionId: `P${String(index + 1).padStart(2, "0")}`,
      substantiveAssertion: index === 0
        ? "<img src=x onerror=alert(1)>"
        : `Substantive assertion ${index + 1}`,
      assertionSource: `Reviewed source ${index + 1}`,
      articleStance:
        (["adopts", "challenges", "reports"] as const)[index % 3]!,
    })),
  };
}

test("substantive-review prompt and schema preserve the governed surface", async () => {
  const prompt = await loadCfxSubstantiveReviewPrompt();
  assert.equal(prompt.promptHash, CFX_SUBSTANTIVE_REVIEW_PROMPT_SHA256);
  assert.ok(prompt.prompt.startsWith(
    "Review the complete article and the already-selected propositions.",
  ));
  assert.ok(prompt.prompt.includes(
    "Do not delete, merge, split, broaden, or narrow a proposition.",
  ));
  assert.ok(prompt.prompt.endsWith(
    "11. Return only the structured results required by the schema.",
  ));
  assert.equal(
    CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA.name,
    "cfx_substantive_review_v1",
  );
  const root = CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA.schema;
  assert.deepEqual(root.required, ["results"]);
  assert.equal(root.properties.results.minItems, 12);
  assert.equal(root.properties.results.maxItems, 12);
  const item = root.properties.results.items;
  assert.deepEqual(item.required, [
    "propositionId",
    "substantiveAssertion",
    "assertionSource",
    "articleStance",
  ]);
  assert.deepEqual(item.properties.articleStance.enum, [
    "adopts",
    "challenges",
    "reports",
  ]);
});

test("request contains all fixed propositions followed by every labelled unit", async () => {
  const article = syntheticArticle();
  const inventory = sourceInventory();
  const prompt = await loadCfxSubstantiveReviewPrompt();
  const request = buildCfxSubstantiveReviewRequest({
    article,
    inventory,
    prompt,
  });
  assert.equal(request.system, "");
  assert.equal(request.user.startsWith(`${prompt.prompt}\n\n`), true);
  assert.equal(
    request.user.match(/^propositionId:$/gm)?.length,
    12,
  );
  for (const proposition of inventory.propositions) {
    assert.ok(request.user.includes(proposition.propositionId));
    assert.ok(request.user.includes(proposition.assertion));
    assert.ok(request.user.includes(proposition.assertionSource));
    assert.ok(request.user.includes(
      proposition.whyItMattersToArticleThesis,
    ));
    assert.ok(request.user.includes(proposition.groundingUnitIds.join(", ")));
  }
  for (const unit of article.sourceUnits) {
    assert.ok(request.user.includes(`[${unit.unitId}]\n${unit.text}`));
  }
  assert.ok(
    request.user.indexOf("FIXED_PROPOSITIONS:")
      < request.user.indexOf("COMPLETE_UNIT_LABELLED_ARTICLE:"),
  );
  assert.equal(request.user.includes("groundingStatus"), false);
  assert.equal(request.user.includes("verbatimEvidence"), false);
});

test("runner makes one call, captures raw evidence before validation, and orders results", async () => {
  const output = reviewOutput();
  output.results.reverse();
  const events: string[] = [];
  let calls = 0;
  const result = await runCfxSubstantiveReview({
    article: syntheticArticle(),
    inventory: sourceInventory(),
    sourceInventoryHash: "source-inventory-hash",
    prompt: await loadCfxSubstantiveReviewPrompt(),
    provider: {
      async invokeStructured() {
        calls += 1;
        events.push("provider");
        return {
          output,
          rawResponse: { id: "response-1", output },
          model: "test-model",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 3,
            totalTokens: 13,
          },
          responseId: "response-1",
          requestId: "request-1",
        };
      },
    },
    async beforeInvoke() {
      events.push("before");
    },
    async afterResponse(value) {
      events.push("raw");
      assert.deepEqual(value.rawResponse, {
        id: "response-1",
        output,
      });
      assert.equal(value.metadata.capturedBeforeValidation, true);
    },
  });
  events.push("returned");
  assert.equal(calls, 1);
  assert.deepEqual(events, ["before", "provider", "raw", "returned"]);
  assert.equal(result.status, "completed");
  assert.equal(result.providerCallCount, 1);
  assert.deepEqual(
    result.inventory?.results.map((row) => row.propositionId),
    Array.from(
      { length: 12 },
      (_, index) => `P${String(index + 1).padStart(2, "0")}`,
    ),
  );
  assert.equal(
    result.inventory?.results[0]?.substantiveAssertion,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(
    result.inventory?.results[0]?.evidenceSearchHandoff
      ?.normalizedAssertion,
    "<img src=x onerror=alert(1)>",
  );
  assert.deepEqual(
    result.inventory?.results[0]?.evidenceSearchHandoff
      ?.groundingUnitIds,
    ["U0001"],
  );
});

test("ID coverage failure blocks publication without erasing raw evidence", async () => {
  const invalid = reviewOutput();
  invalid.results[10]!.propositionId = "P01";
  invalid.results[11]!.propositionId = "P99";
  let captured: unknown = null;
  const result = await runCfxSubstantiveReview({
    article: syntheticArticle(),
    inventory: sourceInventory(),
    sourceInventoryHash: "source-inventory-hash",
    prompt: await loadCfxSubstantiveReviewPrompt(),
    provider: {
      async invokeStructured() {
        return {
          output: invalid,
          rawResponse: { id: "response-invalid", output: invalid },
          model: "test-model",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 3,
            totalTokens: 13,
          },
          responseId: "response-invalid",
          requestId: "request-invalid",
        };
      },
    },
    async afterResponse(value) {
      captured = value.rawResponse;
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.inventory, null);
  assert.equal(result.rawOutput, invalid);
  assert.deepEqual(captured, {
    id: "response-invalid",
    output: invalid,
  });
  assert.ok(result.diagnostics.some(
    (item) => item.code === "DUPLICATE_PROPOSITION_ID",
  ));
  assert.ok(result.diagnostics.some(
    (item) => item.code === "UNEXPECTED_PROPOSITION_ID",
  ));
  assert.ok(result.diagnostics.some(
    (item) => item.code === "MISSING_PROPOSITION_ID",
  ));
});

test("report is deterministic, compares before and after, and escapes model text", () => {
  const inventory = sourceInventory();
  const reviewed = reviewOutput();
  const reportInput = {
    runId: "run-1",
    generatedAt: "2026-07-31T00:00:00.000Z",
    model: "test-model",
    sourceInventory: inventory,
    reviewInventory: {
      schemaVersion: "cfx.substantiveReview.v1" as const,
      sourceUnitAwareInventoryHash: "source-inventory-hash",
      results: reviewed.results,
    },
    promptHash: "prompt",
    schemaHash: "schema",
    requestHash: "request",
    sourceInventoryHash: "source-inventory-hash",
    resultInventoryHash: "result-inventory-hash",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      totalTokens: 13,
    },
    latencyMs: 1000,
  };
  const html = buildCfxSubstantiveReviewReportHtml(reportInput);
  assert.equal(html, buildCfxSubstantiveReviewReportHtml(reportInput));
  assert.equal(html.includes("<script>selected</script>"), false);
  assert.ok(html.includes("&lt;script&gt;selected&lt;/script&gt;"));
  assert.equal(html.includes("<img src=x onerror=alert(1)>"), false);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("Selected assertion"));
  assert.ok(html.includes("Substantive assertion"));
  assert.ok(html.includes("<strong>4</strong>adopts"));
  assert.ok(html.includes("<strong>4</strong>challenges"));
  assert.ok(html.includes("<strong>4</strong>reports"));
});
