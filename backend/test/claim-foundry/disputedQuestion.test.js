import test from "node:test";
import assert from "node:assert/strict";
import { CF1_SELECTED_ENRICHMENT_SCHEMA } from "../../src/claim-foundry/prompts/selectedEnrichmentSchema.js";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { runClaimFoundry } from "../../src/claim-foundry/runClaimFoundry.js";
import { runHostSemanticCritic } from "../../src/claim-foundry/hostSemanticCritic.js";
import { verifySemanticInventory, verifySelectedEnrichment } from
  "../../src/claim-foundry/twoCallAgentVerification.js";
import { createArticleAndBlocks, createSelectedEnrichmentOutput,
  createSemanticInventoryOutput } from "./fixtures/packages.js";

const OPTIONS = {
  model: "fake", modelContextTokens: 100_000, timeoutMs: 1_000,
  blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
  budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000,
    maxDurationMs: 30_000 },
};

function verificationContext() {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  const sourceUnits = articleDocument.sourceUnits;
  const inventory = verifySemanticInventory(createSemanticInventoryOutput(), { sourceUnits, article });
  const critic = runHostSemanticCritic(inventory,
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  return { selectedClaims: critic.selectedClaims, inventory, sourceUnits, criticReport: critic, article };
}

test("Call 2 schema requires a disputedQuestion object with the allowed targets", () => {
  const enrichment = CF1_SELECTED_ENRICHMENT_SCHEMA.schema.properties.enrichedClaims.items;
  assert.ok(enrichment.required.includes("disputedQuestion"));
  const disputed = enrichment.properties.disputedQuestion;
  assert.deepEqual(disputed.required,
    ["verificationTarget", "disputedProposition", "stipulatedByArticle", "whyThisTarget"]);
  assert.deepEqual(disputed.properties.verificationTarget.enum,
    ["substantive", "both_needed"]);
});

test("host rejects Call 2 output without a valid disputedQuestion", () => {
  const context = verificationContext();
  for (const mutate of [
    (claim) => delete claim.disputedQuestion,
    (claim) => { claim.disputedQuestion.verificationTarget = "unknown_kind"; },
    (claim) => { claim.disputedQuestion.disputedProposition = " "; },
    (claim) => { claim.disputedQuestion.whyThisTarget = ""; },
    (claim) => delete claim.disputedQuestion.stipulatedByArticle,
  ]) {
    const output = createSelectedEnrichmentOutput();
    mutate(output.enrichedClaims[0]);
    assert.throws(() => verifySelectedEnrichment(output, context),
      (error) => error.message.includes("disputedQuestion"));
  }
});

test("host carries every allowed verificationTarget verbatim onto the merged claim", () => {
  const variants = [
    { verificationTarget: "substantive",
      disputedProposition: "Whether the reported procurement delay actually occurred.",
      stipulatedByArticle: "The article reports the audit's delay finding.",
      whyThisTarget: "The finding is stipulated; its substance is contested." },
    { verificationTarget: "both_needed",
      disputedProposition: "Whether the finding was made and whether it is true.",
      stipulatedByArticle: null,
      whyThisTarget: "Attribution and substance are inseparable here." },
  ];
  for (const disputedQuestion of variants) {
    const context = verificationContext();
    const output = createSelectedEnrichmentOutput();
    output.enrichedClaims[0].disputedQuestion = structuredClone(disputedQuestion);
    const result = verifySelectedEnrichment(output, context);
    assert.deepEqual(result.selectedClaims[0].disputedQuestion, disputedQuestion);
  }
});

test("disputedQuestion survives verbatim onto evidence need cards in a valid package", async () => {
  const { article } = createArticleAndBlocks();
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async (request) => ({
    output: request.usageContext.stage === "semantic_inventory"
      ? createSemanticInventoryOutput() : createSelectedEnrichmentOutput(),
    model: "fake", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }) } });
  const result = await runClaimFoundry({ article, options: OPTIONS, dependencies: { modelRunner } });
  assert.equal(result.run.status, "ready_for_evidence");
  const expected = createSelectedEnrichmentOutput().enrichedClaims[0].disputedQuestion;
  assert.deepEqual(result.claimPackage.evidenceNeedCards[0].disputedQuestion, expected);
  // A substantive dispute keeps its substantive posture; the verification question now
  // targets the disputed proposition, and a stipulated claim gains a restatement exclusion.
  assert.equal(result.claimPackage.phase3Targets[0].targetType, "article_endorsed_substantive");
  assert.match(result.claimPackage.evidenceNeedCards[0].falsifiability.verificationQuestion,
    /^Does independent evidence resolve the disputed question: Whether bridge-repair procurement/);
  assert.ok(result.claimPackage.evidenceNeedCards[0].bearingCriteria.rejectIfOnly.some((rule) =>
    /only repeats or reports the statement the article already stipulates/.test(rule)));
});

test("package verification rejects a card with an unknown verificationTarget", async () => {
  const { article } = createArticleAndBlocks();
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async (request) => ({
    output: request.usageContext.stage === "semantic_inventory"
      ? createSemanticInventoryOutput() : createSelectedEnrichmentOutput(),
    model: "fake", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }) } });
  const result = await runClaimFoundry({ article, options: OPTIONS, dependencies: { modelRunner } });
  const { verifyCf1Package } = await import("../../src/claim-foundry/verifyPackage.js");
  const tampered = structuredClone(result.claimPackage);
  tampered.evidenceNeedCards[0].disputedQuestion.verificationTarget = "unknown_kind";
  const verification = verifyCf1Package(tampered);
  assert.ok(verification.blockingErrors.some((issue) =>
    issue.code === "CF1_INVALID_VERIFICATION_TARGET"));
});
