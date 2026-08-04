import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  runCfxFreshArticleCaseAssertions,
} from "../../../src/claimfoundry/cfx/freshArticle/runFreshArticleCaseAssertions.js";
import type {
  Cf7StructuredModelRequest,
  Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");

// The ground-truth known-successful S1/S2 pair identified in the provenance
// audit: cfx-unit-aware-cf1-f03-20260801065556 (S1, status "completed",
// 12/12) -> cfx-substantive-review-cf1-f03-20260801065622 (S2, status
// "completed", 12/12, sourceInventoryHash matches the S1 run). Their raw
// parsed model responses are frozen here as mocked provider output; the same
// F03 article text that actually produced them is the live input.
const s1ResponseFixture = path.join(
  here, "fixtures/cf1F03KnownS1DiscoveryResponse.json",
);
const s2ResponseFixture = path.join(
  here, "fixtures/cf1F03KnownS2SubstantiveReviewResponse.json",
);
const f03ArticlePath = path.join(
  repositoryRoot, "backend/test/claim-foundry/fixtures/CF1-F03/article.json",
);

async function loadKnownGoodFixtures() {
  const article = JSON.parse(await readFile(f03ArticlePath, "utf8")) as { title: string; text: string };
  const s1Response = JSON.parse(await readFile(s1ResponseFixture, "utf8"));
  const s2Response = JSON.parse(await readFile(s2ResponseFixture, "utf8"));
  return { article, s1Response, s2Response };
}

function twoCallStubProvider(responses: unknown[]): Cf7StructuredProvider & { callCount: number; requests: Cf7StructuredModelRequest[] } {
  let index = 0;
  const requests: Cf7StructuredModelRequest[] = [];
  return {
    requests,
    get callCount() { return index; },
    async invokeStructured(request) {
      requests.push(request);
      const output = responses[index];
      if (output === undefined) throw new Error(`unexpected extra provider call #${index + 1}`);
      index += 1;
      return {
        output,
        rawResponse: { output },
        model: "gpt-4o-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: `resp-${index}`,
        requestId: `req-${index}`,
      };
    },
  };
}

test("the reusable caller reproduces the known successful S1/S2 fixture output", async () => {
  const { article, s1Response, s2Response } = await loadKnownGoodFixtures();
  const provider = twoCallStubProvider([s1Response, s2Response]);

  const result = await runCfxFreshArticleCaseAssertions({
    title: article.title,
    text: article.text,
    sourceUrl: "https://example.test/f03",
    contentId: 18057,
    provider,
  });

  assert.equal(result.status, "completed");
  assert.equal(provider.callCount, 2, "exactly one S1 call and one S2 call, nothing more");
  assert.equal(result.discovery.status, "completed");
  assert.equal(result.substantiveReview?.status, "completed");

  const caseAssertions = result.caseAssertions;
  assert.ok(caseAssertions);
  assert.equal(caseAssertions!.length, 12, "exactly 12 case assertions");

  const first = caseAssertions!.find((row) => row.propositionId === "P01")!;
  assert.equal(
    first.substantiveAssertion,
    "Parents who choose not to vaccinate their children are typically highly educated and scientifically literate.",
  );
  assert.equal(first.assertionSource, "Aaron Siri, foreword of 'Vaccines, Amen: The Religion of Vaccines'");
  assert.equal(first.articleStance, "adopts");
});

test("every returned assertion has grounding unit IDs and an evidenceSearchHandoff/query-hints structure", async () => {
  const { article, s1Response, s2Response } = await loadKnownGoodFixtures();
  const provider = twoCallStubProvider([s1Response, s2Response]);
  const result = await runCfxFreshArticleCaseAssertions({
    title: article.title, text: article.text, provider,
  });

  assert.ok(result.caseAssertions);
  assert.ok(result.sourceInventory);
  const groundingByProposition = new Map(
    result.sourceInventory!.propositions.map((row) => [row.propositionId, row.groundingUnitIds]),
  );

  for (const assertion of result.caseAssertions!) {
    const handoff = assertion.evidenceSearchHandoff;
    assert.ok(handoff, `${assertion.propositionId} has an evidenceSearchHandoff`);
    assert.ok(Array.isArray(handoff!.groundingUnitIds) && handoff!.groundingUnitIds.length > 0);
    assert.deepEqual(
      handoff!.groundingUnitIds,
      groundingByProposition.get(assertion.propositionId),
      `${assertion.propositionId} grounding unit IDs must match S1's discovery, unmodified`,
    );
    for (const unitId of handoff!.groundingUnitIds) {
      assert.ok(
        result.article.sourceUnits.some((unit) => unit.unitId === unitId),
        `${unitId} must be a real S0 source unit`,
      );
    }
    assert.ok(handoff!.literalIdentifiers, "literalIdentifiers present");
    assert.ok(handoff!.lookupHints, "lookupHints present");
    assert.ok(handoff!.queries, "queries (deterministic query hints) present");
  }
});

test("fails closed when S1 does not produce a valid inventory, without attempting S2", async () => {
  const { article } = await loadKnownGoodFixtures();
  const provider = twoCallStubProvider([{ propositions: [] }]);
  const result = await runCfxFreshArticleCaseAssertions({
    title: article.title, text: article.text, provider,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "S1");
  assert.equal(result.caseAssertions, null);
  assert.equal(provider.callCount, 1, "S2 must never be called when S1 fails");
});

test("the fresh-article orchestrator imports no retrieval, acquisition, packet-selection, bearing, SourceCrest, final-linking, or legacy claim-extraction code", async () => {
  const orchestratorPath = fileURLToPath(new URL(
    "../../../src/claimfoundry/cfx/freshArticle/runFreshArticleCaseAssertions.ts",
    import.meta.url,
  ));
  const source = await readFile(orchestratorPath, "utf8");
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/u.test(line))
    .join("\n");
  const forbidden = [
    /processTaskClaims/u,
    /retrieval\//u,
    /acquisition\//u,
    /packetSelectionBridge/u,
    /singleAssertionPacketExtraction/u,
    /evidenceBearing\//u,
    /SourceCrest/iu,
    /finalLinking\//u,
    /cfxProductionEvidencePipeline/u,
    /cfxEvidenceCoordinator/u,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(importLines, pattern, `orchestrator must not import anything matching ${pattern}`);
  }
});

test("no CLI main(), no hardcoded content IDs or fixture paths, no F03 assumptions in the orchestrator", async () => {
  const orchestratorPath = fileURLToPath(new URL(
    "../../../src/claimfoundry/cfx/freshArticle/runFreshArticleCaseAssertions.ts",
    import.meta.url,
  ));
  const source = await readFile(orchestratorPath, "utf8");
  assert.doesNotMatch(source, /async function main\(/u);
  assert.doesNotMatch(source, /CF1-F03/u);
  assert.doesNotMatch(source, /18057/u);
  assert.doesNotMatch(source, /freezeCfxF03|freezeCfxArticle\(/u);
});
