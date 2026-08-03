import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCfxS2ReportHtml,
} from "../../../src/claimfoundry/cfx/grounding/report/buildS2ReportHtml.js";
import {
  runCfxS2Comparison,
} from "../../../src/claimfoundry/cfx/grounding/runComparison.js";
import {
  runCfxGroundingArm,
} from "../../../src/claimfoundry/cfx/grounding/runGrounding.js";
import {
  CFX_GROUNDING_JSON_SCHEMA,
} from "../../../src/claimfoundry/cfx/schemas/groundingSchema.js";
import {
  canonicalHash,
} from "../../../src/claimfoundry/shared/sourceUnits/index.js";
import type {
  CfxCanonicalInventory,
  CfxFrozenArticle,
  CfxGroundingRow,
  CfxStructuredProvider,
} from "../../../src/claimfoundry/cfx/types/index.js";

function syntheticArticle(): CfxFrozenArticle {
  const texts = Array.from(
    { length: 12 },
    (_, index) => `Evidence ${String(index + 1).padStart(2, "0")}.`,
  );
  const canonicalText = texts.join(" ");
  let cursor = 0;
  const sourceUnits = texts.map((text, index) => {
    const charStart = cursor;
    const charEnd = charStart + text.length;
    cursor = charEnd + 1;
    return {
      unitId: `U${String(index + 1).padStart(4, "0")}`,
      text,
      charStart,
      charEnd,
    };
  });
  return {
    fixtureId: "synthetic",
    fixturePath: "/synthetic",
    fixtureFileSha256: "fixture",
    articleTextSha256: "article",
    normalizedArticleHash: "normalized",
    sourceUnitManifestHash: "units",
    articleTitle: "Synthetic",
    articleText: canonicalText,
    canonicalText,
    articleCharacterCount: canonicalText.length,
    sourceUnitCount: 12,
    sourceUnits,
    unitProjection: sourceUnits.map(
      (unit) => `[${unit.unitId}] ${unit.text}`,
    ).join("\n\n"),
    unitProjectionSha256: "projection",
  };
}

function inventory(): CfxCanonicalInventory {
  return {
    schemaVersion: "cfx.canonicalPropositions.v1",
    fixtureId: "synthetic",
    propositions: Array.from({ length: 12 }, (_, index) => ({
      propositionId: `P${String(index + 1).padStart(2, "0")}`,
      assertion: index === 0
        ? "<script>alert('canonical')</script>"
        : `Assertion ${index + 1}`,
      assertionSource: `Source ${index + 1}`,
      whyItMattersToArticleThesis: `Reason ${index + 1}`,
    })),
  };
}

function providerOutput(
  propositionIds: string[],
  perProposition: boolean,
): { groundings: CfxGroundingRow[] } {
  return {
    groundings: propositionIds.map((propositionId) => {
      const number = Number(propositionId.slice(1));
      const unitId = `U${String(number).padStart(4, "0")}`;
      const evidence = `Evidence ${String(number).padStart(2, "0")}.`;
      if (number === 3) {
        return {
          propositionId,
          groundingStatus: "unsupported",
          groundingType: "none",
          evidenceSegments: [],
          supportedComponents: [],
          unsupportedComponents: [],
          notes: null,
        };
      }
      return {
        propositionId,
        groundingStatus: "grounded_direct",
        groundingType: "direct",
        evidenceSegments: [{
          sourceUnitIds: [unitId],
          verbatimEvidence:
            perProposition && number === 5 ? "Altered evidence." : evidence,
        }],
        supportedComponents: [],
        unsupportedComponents: [],
        notes: number === 2 ? "<img src=x onerror=alert(1)>" : null,
      };
    }),
  };
}

test("S2 executes 1+12 calls, preserves every response, isolates one invalid row, and renders deterministic safe HTML", async (t) => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "cfx-s2-test-"));
  t.after(async () => {
    await rm(artifactRoot, { recursive: true, force: true });
  });
  const article = syntheticArticle();
  const canonicalInventory = inventory();
  const beforeHash = canonicalHash(canonicalInventory);
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const provider: CfxStructuredProvider = {
    async invokeStructured(request) {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const ids = [...request.user.matchAll(
        /"propositionId": "(P\d{2})"/g,
      )].map((match) => match[1]!);
      const value = ids.length === 1 && ids[0] === "P06"
        ? {
            groundings: [{
              propositionId: "P06",
              assertion: "Forbidden model-authored replacement",
            }],
          }
        : providerOutput(ids, ids.length === 1);
      active -= 1;
      return {
        output: value,
        rawResponse: { id: `response-${calls}`, output: value },
        model: "gpt-4o-mini-test",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 5,
          totalTokens: 15,
        },
        responseId: `response-${calls}`,
        requestId: `request-${calls}`,
      };
    },
  };
  const result = await runCfxS2Comparison({
    artifactRoot,
    article,
    canonicalInventory,
    prompt: {
      schemaVersion: "cfx.prompt.v1",
      promptId: "exact-grounding-v1",
      prompt: "Governed prompt",
      promptHash: "prompt-hash",
    },
    provider,
  });
  assert.equal(calls, 13);
  assert.equal(result.providerCallCount, 13);
  assert.ok(maxActive <= 4);
  assert.ok(maxActive > 1);
  assert.equal(result.wholeArticle.acceptedRows.length, 12);
  assert.equal(result.perProposition.acceptedRows.length, 10);
  assert.equal(result.perProposition.rejectedRows.length, 2);
  assert.deepEqual(
    result.perProposition.rejectedRows.map((row) => row.propositionId),
    ["P05", "P06"],
  );
  assert.ok(result.perProposition.diagnostics.some(
    (item) => item.code === "EXACT_SUBSTRING_FAILURE",
  ));
  assert.ok(result.perProposition.diagnostics.some(
    (item) => item.code === "GROUNDING_ROW_SCHEMA_FAILURE",
  ));
  assert.equal(canonicalHash(canonicalInventory), beforeHash);
  assert.equal(result.wholeArticle.canonicalInventoryUnchanged, true);
  assert.equal(result.perProposition.canonicalInventoryUnchanged, true);

  for (const proposition of canonicalInventory.propositions) {
    await access(path.join(
      artifactRoot,
      "s2-grounding/per-proposition",
      proposition.propositionId,
      "request-001/raw_response.json",
    ));
  }
  await access(path.join(
    artifactRoot,
    "s2-grounding/whole-article/request-001/raw_response.json",
  ));
  const rejected = JSON.parse(await readFile(path.join(
    artifactRoot,
    "s2-grounding/per-proposition/P05/request-001/rejected_rows.json",
  ), "utf8")) as unknown[];
  assert.equal(rejected.length, 1);

  const reportInput = {
    runId: "run-1",
    fixtureId: "synthetic",
    generatedAt: "2026-07-31T00:00:00.000Z",
    provider: "OpenAI" as const,
    model: "gpt-4o-mini",
    promptId: "exact-grounding-v1",
    promptHash: "prompt-hash",
    schemaHash: canonicalHash(CFX_GROUNDING_JSON_SCHEMA),
    article,
    canonicalInventory,
    wholeArticle: result.wholeArticle,
    perProposition: result.perProposition,
    comparison: result.comparison,
    artifactPaths: ["raw_response.json"],
    artifactHashes: [{ path: "raw_response.json", sha256: "abc" }],
  };
  const html = buildCfxS2ReportHtml(reportInput);
  assert.equal(html, buildCfxS2ReportHtml(reportInput));
  assert.equal(html.includes("<script>alert('canonical')</script>"), false);
  assert.ok(html.includes("&lt;script&gt;alert(&#39;canonical&#39;)&lt;/script&gt;"));
  assert.equal(html.includes("<img src=x onerror=alert(1)>"), false);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("https://"), false);
  assert.ok(html.indexOf("P01") < html.indexOf("P12"));
  assert.ok(html.includes("No quotation."));
  assert.ok(html.includes("EXACT_SUBSTRING_FAILURE"));
  assert.equal(result.comparison.arms.wholeArticle.requestCount, 1);
  assert.equal(result.comparison.arms.perProposition.requestCount, 12);
  assert.equal(result.comparison.arms.perProposition.inputTokens, 120);
  assert.equal(result.comparison.arms.perProposition.parserFailureCount, 1);
});

test("one provider failure in per-proposition mode does not prevent the other propositions from completing", async () => {
  const article = syntheticArticle();
  const canonicalInventory = inventory();
  let calls = 0;
  const arm = await runCfxGroundingArm({
    mode: "perProposition",
    article,
    canonicalInventory,
    prompt: {
      schemaVersion: "cfx.prompt.v1",
      promptId: "exact-grounding-v1",
      prompt: "Governed prompt",
      promptHash: "prompt-hash",
    },
    provider: {
      async invokeStructured(request) {
        calls += 1;
        const propositionId = request.user.match(
          /"propositionId": "(P\d{2})"/,
        )?.[1]!;
        if (propositionId === "P07") throw new Error("synthetic failure");
        const value = providerOutput([propositionId], false);
        return {
          output: value,
          rawResponse: { output: value },
          model: "test",
          usage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 1,
            totalTokens: 2,
          },
          responseId: null,
          requestId: null,
        };
      },
    },
  });
  assert.equal(calls, 12);
  assert.equal(arm.acceptedRows.length, 11);
  assert.equal(arm.rejectedRows.length, 1);
  assert.equal(arm.rejectedRows[0]?.propositionId, "P07");
  assert.equal(
    arm.outcomes.find((outcome) =>
      outcome.propositionIds.includes("P07"))?.providerError?.message,
    "synthetic failure",
  );
  assert.equal(arm.status, "completed_with_quarantine");
});
