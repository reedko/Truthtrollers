import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeCf1Artifacts } from "../../src/claim-foundry/artifacts.js";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { normalizeOneCallAgentOutput } from "../../src/claim-foundry/oneCallAgentNormalization.js";
import { verifyOneCallAgentOutput } from "../../src/claim-foundry/oneCallAgentVerification.js";
import { runClaimFoundry } from "../../src/claim-foundry/runClaimFoundry.js";
import { runHostSemanticCritic } from "../../src/claim-foundry/hostSemanticCritic.js";
import { verifySemanticInventory, verifySelectedEnrichment } from
  "../../src/claim-foundry/twoCallAgentVerification.js";
import { expandTwoCallAgentOutput } from "../../src/claim-foundry/twoCallAgentOutput.js";
import { createArticleAndBlocks, createOneCallAgentOutput, createSelectedEnrichmentOutput,
  createSemanticInventoryOutput } from "./fixtures/packages.js";

const OPTIONS = {
  model: "fake", modelContextTokens: 100_000, timeoutMs: 1_000,
  blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
  budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000,
    maxDurationMs: 30_000 },
};

function runner(calls) {
  return createCf1ModelRunner({ transport: { invoke: async (request) => {
    calls.push(request);
    return { output: request.usageContext.stage === "semantic_inventory"
      ? createSemanticInventoryOutput() : createSelectedEnrichmentOutput(), model: "fake",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
}

test("default CF1 path performs critic-driven revision before finalization", async (t) => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "cf1-agent-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  const result = await runClaimFoundry({ article,
    options: { ...OPTIONS, artifactRoot },
    dependencies: { modelRunner: runner(calls),
      artifactWriter: writeCf1Artifacts,
      evidenceSearch: () => { throw new Error("CF1 must not search for evidence"); } } });

  assert.equal(result.run.status, "ready_for_evidence");
  assert.equal(result.run.executionMode, "agent");
  assert.equal(result.run.executionPath, "agent");
  assert.deepEqual(calls.map((call) => call.usageContext.stage),
    ["semantic_inventory", "selected_claim_enrichment"]);
  assert.match(calls[0].system, /semantic reader/);
  assert.match(calls[1].system, /selected-claim evidence planner/);
  assert.equal(calls[1].responseSchema.schema.properties.enrichedClaims.minItems, 1);
  assert.equal(calls[1].responseSchema.schema.properties.enrichedClaims.maxItems, 1);
  const enrichmentFields = calls[1].responseSchema.schema.properties.enrichedClaims
    .items.properties;
  assert.ok(enrichmentFields.supportCriteria);
  assert.ok(enrichmentFields.searchConcepts);
  assert.equal("verificationQuestion" in enrichmentFields, false);
  assert.equal("queryLaneSeeds" in enrichmentFields, false);
  assert.equal("identifierHints" in enrichmentFields, false);
  assert.match(result.claimPackage.selectedEvaluationClaims[0].claimText, /city audit/);
  assert.deepEqual(result.claimPackage.selectedEvaluationClaims[0].relatedPillarIds, ["P01"]);
  assert.match(result.claimPackage.selectedEvaluationClaims[0].selectionRationale,
    /Theme gate.*Late procurement/);
  assert.notEqual(result.claimPackage.rawAssertions[0].rawAssertionId,
    result.claimPackage.selectedEvaluationClaims[0].selectedClaimId);
  assert.ok(result.claimPackage.phase3Targets.every((target) =>
    result.claimPackage.selectedEvaluationClaims.some((claim) => claim.selectedClaimId === target.selectedClaimId)));
  assert.doesNotMatch(result.claimPackage.evidenceNeedCards[0].queryLaneSeeds[0].query,
    /city audit city audit/i);
  // The claim is a substantive dispute the article stipulates, so the article's own
  // identity (author/year/title/own DOI) is detached: no article-primary lane, no own DOI.
  assert.ok(result.claimPackage.evidenceNeedCards[0].queryLaneSeeds.every((seed) =>
    !/Rivera.*2024/i.test(seed.query)));
  assert.deepEqual(result.claimPackage.evidenceNeedCards[0].identifierHints.doi, []);
  // The cited work's identity is unaffected — the audit's DOI survives in a named-work lane.
  assert.ok(result.claimPackage.evidenceNeedCards[0].queryLaneSeeds.some((seed) =>
    /10\.1234\/Bridge\.7/i.test(seed.query)));
  assert.ok(result.claimPackage.evidenceNeedCards[0].queryLaneSeeds.some((seed) =>
    /bridge procurement.*nine-month delay/i.test(seed.query)));
  assert.match(result.claimPackage.evidenceNeedCards[0].falsifiability.wouldRefuteIf,
    /began on time/i);
  assert.ok(result.claimPackage.articleMap.contextWorks.some((work) => work.mentionText === "The audit"));
  assert.deepEqual(result.claimPackage.evidenceNeedCards[0].relevantNamedWorkIds, ["NW001"]);
  assert.equal(result.claimPackage.evidenceNeedCards[0].namedWorkHints[0].namedWorkId, "NW001");
  assert.equal("namedWorkHints" in calls[1].responseSchema.schema.properties.enrichedClaims.items.properties,
    false);
  assert.equal(result.run.usage.semanticCalls, 2);
  assert.equal(result.claimPackage.diagnostics.agentRuntime.stepTrace.length, 6);
  assert.ok(result.claimPackage.diagnostics.agentRuntime.artifactNames.includes("critic_report.json"));
  for (const name of result.claimPackage.diagnostics.agentRuntime.artifactNames) {
    assert.ok(result.artifactRefs.files.some((file) => file.endsWith(name)), name);
  }
  const trace = JSON.parse(await readFile(path.join(result.artifactRefs.artifactRoot,
    "cf1_agent_trace.json"), "utf8"));
  assert.equal(trace.steps.filter((step) => step.modelCall).length, 2);
  assert.deepEqual(trace.steps.map((step) => step.stage), ["semantic_inventory",
    "orientation_materialized", "initial_claims_materialized", "host_semantic_critic",
    "selected_claim_enrichment", "revision_and_selection_materialized"]);
});

test("host corrects primary-article routing when semantic guidance requires an official record", async () => {
  const { article } = createArticleAndBlocks();
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async (request) => {
    if (request.usageContext.stage === "semantic_inventory") {
      return { output: createSemanticInventoryOutput(), model: "fake",
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
    }
    const output = createSelectedEnrichmentOutput();
    output.enrichedClaims[0].sourceStrategy = "primary_article_result";
    output.enrichedClaims[0].supportCriteria = ["Official agency records confirm the dated procurement timeline."];
    return { output, model: "fake",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
  const result = await runClaimFoundry({ article, options: OPTIONS, dependencies: { modelRunner } });
  assert.equal(result.run.status, "ready_for_evidence");
  assert.deepEqual(result.claimPackage.evidenceNeedCards[0].bestSourceTypes, ["official record"]);
  assert.deepEqual(result.claimPackage.evidenceNeedCards[0].evidenceRolesNeeded,
    ["official-response", "primary-record"]);
});

test("host strips repeated protected named-work labels from Call 2 free text", () => {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  const sourceUnits = articleDocument.sourceUnits;
  const inventory = verifySemanticInventory(createSemanticInventoryOutput(), { sourceUnits, article });
  const critic = runHostSemanticCritic(inventory,
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  const output = createSelectedEnrichmentOutput();
  output.enrichedClaims[0].searchConcepts = ["The audit", "nine-month procurement delay"];
  output.enrichedClaims[0].cautions = ["The audit title was repeated by the model."];
  const result = verifySelectedEnrichment(output,
    { selectedClaims: critic.selectedClaims, inventory, sourceUnits, criticReport: critic, article });
  assert.deepEqual(result.selectedClaims[0].searchConcepts,
    ["nine-month procurement delay"]);
  assert.deepEqual(result.selectedClaims[0].warnings, []);
  assert.deepEqual(result.selectedClaims[0].relevantNamedWorkIds, ["NW001"]);
});

test("host-backfill origin survives Call 2 merge into package claims and cards", async () => {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  const sourceUnits = articleDocument.sourceUnits;
  const rawInventory = createSemanticInventoryOutput();
  rawInventory.pillars.push({ label: "Two-year delay",
    text: "Bridge repairs were delayed for two years.", importance: "major", sourceUnitIds: ["U0001"] });
  const inventory = verifySemanticInventory(rawInventory, { sourceUnits, article });
  const critic = runHostSemanticCritic(inventory,
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  const backfilled = critic.selectedClaims.find((claim) => claim.origin === "host_pillar_backfill");
  assert.equal(backfilled.relatedPillarLabels[0], "Two-year delay");
  // Consensus stance: the only candidate grounded in the pillar's unit is endorsed.
  assert.equal(backfilled.articleUse, "endorsed");
  const output = createSelectedEnrichmentOutput();
  output.enrichedClaims.push({ candidateId: backfilled.candidateId,
    disputedQuestion: {
      verificationTarget: "substantive",
      disputedProposition: "Whether bridge repairs were actually delayed for two years.",
      stipulatedByArticle: "The article reports the audit's two-year delay finding.",
      whyThisTarget: "The contested issue is the underlying repair timeline.",
    },
    supportCriteria: ["Dated repair records show a two-year delay."],
    refuteCriteria: ["Dated repair records show repairs finished on schedule."],
    qualifyCriteria: ["Only some repair phases were delayed by two years."],
    mustMatch: ["two-year bridge repair delay"],
    rejectIfOnly: ["A source discusses bridge repairs without documenting the delay length."],
    sourceStrategy: "official_record", searchConcepts: ["bridge repairs", "two-year delay"],
    relevantNamedWorkIds: [], cautions: [],
  });
  const oldShape = verifySelectedEnrichment(output,
    { selectedClaims: critic.selectedClaims, inventory, sourceUnits, criticReport: critic, article });
  const originsById = new Map(oldShape.selectedClaims.map((claim) => [claim.candidateId, claim.origin]));
  assert.equal(originsById.get(backfilled.candidateId), "host_pillar_backfill");
  assert.ok([...originsById.values()].includes("model"));
  const draft = expandTwoCallAgentOutput(oldShape, { structuralBlocks, article });
  assert.deepEqual(draft.selectedEvaluationClaims.map((claim) => claim.origin),
    oldShape.selectedClaims.map((claim) => claim.origin));
  assert.deepEqual(draft.evidenceNeedCards.map((card) => card.origin),
    oldShape.selectedClaims.map((claim) => claim.origin));
});

test("agent stage failure preserves a failed step trace and produces no package", async () => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async (request) => {
    calls.push(request);
    throw Object.assign(new Error("agent fixture stopped"), { retryable: false });
  } } });
  const result = await runClaimFoundry({ article, options: OPTIONS, dependencies: { modelRunner } });
  assert.equal(result.run.status, "failed");
  assert.equal(result.claimPackage, null);
  assert.equal(result.run.error.code, "CF1_MODEL_UNAVAILABLE");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maximumAttempts, 1);
});

test("normalization cannot preserve a trace that drops a selected claim", () => {
  const output = createOneCallAgentOutput();
  output.revisionTrace = [{ findingType: "missing_attribution",
    beforeClaimText: output.selectedClaims[0].claimText, afterClaimText: null,
    action: "drop", explanation: "Invalid selected drop." }];
  const normalized = normalizeOneCallAgentOutput(output);
  assert.equal(normalized.revisionTrace.length, 0);
  assert.throws(() => verifyOneCallAgentOutput(normalized),
    (error) => error.message === "At least one critic finding must drive an actual revision action");
});

test("theme gate rejects topic labels and selected claims without explicit pillar bearing", () => {
  const topicOnly = createOneCallAgentOutput();
  topicOnly.orientation.theme = "Bridge repairs";
  assert.throws(() => verifyOneCallAgentOutput(topicOnly),
    (error) => error.message.includes("argumentative point"));

  const unlinked = createOneCallAgentOutput();
  unlinked.selectedClaims[0].relatedPillarLabels = [];
  assert.throws(() => verifyOneCallAgentOutput(unlinked),
    (error) => error.message.includes("bear on at least one pillar"));
});

test("theme gate rejects a research objective masquerading as the article theme", () => {
  const output = createOneCallAgentOutput();
  output.orientation.theme = "The audit examines delays in bridge repairs.";
  assert.throws(() => verifyOneCallAgentOutput(output),
    (error) => error.message.includes("objective or topic"));
});

test("theme gate rejects uncovered load-bearing pillars", () => {
  const output = createOneCallAgentOutput();
  output.orientation.pillars.push({ label: "Budget withholding",
    text: "The council has withheld the repair budget.", importance: "major" });
  assert.throws(() => verifyOneCallAgentOutput(output),
    (error) => error.message.includes("needs a selected evidence task"));
});

test("theme gate rejects generic bearing, duplicate selections, and ungrounded causal scope", () => {
  const generic = createOneCallAgentOutput();
  generic.selectedClaims[0].themeBearing = "This claim is important.";
  assert.throws(() => verifyOneCallAgentOutput(generic),
    (error) => error.message.includes("consequence for the article"));

  const duplicate = createOneCallAgentOutput();
  duplicate.selectedClaims.push({ ...structuredClone(duplicate.selectedClaims[0]),
    claimText: "The city audit found bridge-repair procurement began nine months behind schedule." });
  assert.throws(() => verifyOneCallAgentOutput(duplicate),
    (error) => error.message.includes("near-duplicate"));

  const causal = createOneCallAgentOutput();
  causal.orientation.theme = "Late procurement caused the bridge repairs to finish late.";
  const { articleDocument } = createArticleAndBlocks();
  assert.throws(() => verifyOneCallAgentOutput(causal,
    { sourceUnits: articleDocument.sourceUnits }),
  (error) => error.message.includes("Causal theme or thesis"));
});
