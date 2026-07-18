import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticInventoryPrompt } from "../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { buildSelectedEnrichmentPrompt } from "../../src/claim-foundry/prompts/selectedEnrichmentPrompt.js";
import { buildSelectedEnrichmentContext } from "../../src/claim-foundry/selectedEnrichmentContext.js";
import { runHostSemanticCritic } from "../../src/claim-foundry/hostSemanticCritic.js";
import { verifySemanticInventory } from "../../src/claim-foundry/twoCallAgentVerification.js";
import { canonicalSchemaHash, getPairProfile, listPairProfiles, profilePromptBuilders,
  promptFingerprints, validatePromptRegistry } from "./prompt-benchmark/promptSets/index.js";
import { createArticleAndBlocks, createSemanticInventoryOutput } from "./fixtures/packages.js";

function callInputs() {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  const sourceUnits = articleDocument.sourceUnits;
  const inventory = verifySemanticInventory(createSemanticInventoryOutput(), { sourceUnits, article });
  const critic = runHostSemanticCritic(structuredClone(inventory),
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  const call2Context = buildSelectedEnrichmentContext({ inventory,
    orientation: { theme: inventory.theme.text, thesis: inventory.thesis.text,
      pillars: inventory.pillars }, critic, sourceUnits });
  return { article, structuralBlocks, sourceUnits, call2Context };
}

test("registry preserves original arms and adds corrected B2/C2/D2/E2 arms", () => {
  const profiles = listPairProfiles();
  assert.deepEqual(profiles.map((profile) => profile.id), ["set-control-current-v1",
    "set-a-recall-reasoning-v1", "set-b-fidelity-ladder-v1", "set-c-claim-contract-v1",
    "set-d-orientation-posture-trace-v1", "set-e-posture-first-order-v1",
    "set-f-recall-posture-source-v1", "set-b-fidelity-ladder-v2",
    "set-c-claim-contract-v2", "set-d-orientation-posture-trace-v2",
    "set-e-posture-first-order-v2", "set-e-posture-first-c-full-v1",
    "set-e-posture-first-c-warrant-v1", "set-h-consolidated-source-posture-v1",
    "set-e-canonical-proposition-v1", "set-e-canonical-proposition-v2",
    "set-e-canonical-proposition-v3", "set-e-source-proposition-response-v1",
    "set-x-source-proposition-response-v1"]);
  assert.equal(profiles[0].id, "set-control-current-v1");
  assert.equal(profiles.find((profile) => profile.id === "set-e-posture-first-order-v2").call1Only,
    true);
  assert.equal(profiles.at(-1).call1Only, false);
  assert.throws(() => getPairProfile("set-unknown-v1"),
    (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID");
});

test("registry fails closed on placeholder IDs and schema drift", () => {
  const good = getPairProfile("set-a-recall-reasoning-v1");
  assert.throws(() => validatePromptRegistry([{ ...good, id: "set-c-placeholder-v1" }]),
    (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID");
  assert.throws(() => validatePromptRegistry([good,
    { ...good, id: "set-a-recall-reasoning-v1" }]),
  (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID", "duplicate IDs rejected");
  const drifted = { ...good, call1: { ...good.call1, schemaHash: "0".repeat(64) } };
  assert.throws(() => validatePromptRegistry([drifted]),
    (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID", "schema-hash drift rejected");
});

// FREEZE PIN (remove at promotion, per the control module header): the frozen
// control must equal the live builders byte-for-byte while live is unchanged.
test("frozen control equals the live builders byte-for-byte at freeze time", () => {
  const { article, structuralBlocks, sourceUnits, call2Context } = callInputs();
  const control = getPairProfile("set-control-current-v1");
  const liveCall1 = buildSemanticInventoryPrompt({ article, structuralBlocks, sourceUnits });
  const controlCall1 = control.call1.build({ article, structuralBlocks, sourceUnits });
  assert.equal(controlCall1.system, liveCall1.system);
  assert.equal(controlCall1.user, liveCall1.user);
  assert.deepEqual(controlCall1.responseSchema, liveCall1.responseSchema);
  const liveCall2 = buildSelectedEnrichmentPrompt(call2Context);
  const controlCall2 = control.call2.build(call2Context);
  assert.equal(controlCall2.system, liveCall2.system);
  assert.equal(controlCall2.user, liveCall2.user);
  assert.deepEqual(controlCall2.responseSchema, liveCall2.responseSchema);
});

test("original arms use live schemas; diagnostic arms use their audited schemas", () => {
  const { article, structuralBlocks, sourceUnits, call2Context } = callInputs();
  const reference = buildSelectedEnrichmentPrompt(call2Context);
  const referenceTail = reference.user.slice(reference.user.indexOf("ORIENTATION:"));
  for (const { id } of listPairProfiles()) {
    const profile = getPairProfile(id);
    const call1 = profile.call1.build({ article, structuralBlocks, sourceUnits });
    if (profile.call1.schemaName !== "cf1_semantic_inventory_v1") {
      const sourceFirst = profile.call1.schemaName === "cf1_semantic_inventory_order_trace_v1";
      const hybrid = profile.call1.schemaName === "cf1_semantic_inventory_recall_posture_source_v1";
      const propositionV2 = profile.call1.schemaName === "cf1_semantic_inventory_proposition_v2";
      const sourceStable = profile.call1.schemaName
        === "cf1_semantic_inventory_posture_first_source_stable_v3";
      const canonicalProposition = ["cf1_semantic_inventory_canonical_proposition_v1",
        "cf1_semantic_inventory_canonical_proposition_v2",
        "cf1_semantic_inventory_canonical_proposition_v3"].includes(profile.call1.schemaName);
      const sourcePropositionResponse = ["cf1_semantic_inventory_source_proposition_response_v1",
        "cf1_semantic_inventory_source_proposition_response_v2"].includes(profile.call1.schemaName);
      assert.equal(call1.responseSchema.name, profile.call1.schemaName);
      assert.deepEqual(Object.keys(call1.responseSchema.schema.properties),
        hybrid
          ? ["theme", "thesis", "pillars", "thesisHinge", "opponentScan", "candidateClaims"]
          : ["theme", "thesis", "pillars", "thesisHinge", "candidateClaims"]);
      assert.deepEqual(Object.keys(call1.responseSchema.schema.properties.candidateClaims.items.properties),
        sourcePropositionResponse
          ? ["sourceProposition", "assertionSource", "sourceUnitIds", "articleResponse",
            "articleResponseUnitIds", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
            "articleRole", "scoreTransformCheck", "materiality", "relatedPillarLabels", "scope",
            "evidenceUsefulnessHint"]
          : hybrid
          ? ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
            "articleRole", "scoreTransformCheck", "assertionSourceKind", "assertionSourceName",
            "claimText", "sourceUnitIds", "materiality", "relatedPillarLabels", "scope",
            "evidenceUsefulnessHint"]
          : sourceFirst
          ? ["propositionCore", "assertionSource", "articleRole", "ifSupportedEffect",
            "ifRefutedEffect", "articleUse", "scoreTransformCheck", "claimText", "sourceUnitIds",
            "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"]
          : sourceStable
          ? ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
            "articleRole", "scoreTransformCheck", "assertionSourceKind", "assertionSourceName",
            "claimText", "sourceUnitIds", "materiality", "relatedPillarLabels", "scope",
            "evidenceUsefulnessHint"]
          : canonicalProposition
          ? ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
            "articleRole", "scoreTransformCheck", "assertionSource", "sourceUnitIds",
            "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"]
          : ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
            "articleRole", "scoreTransformCheck", "assertionSource", "claimText", "sourceUnitIds",
            "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"]);
      assert.equal(propositionV2,
        ["set-b-fidelity-ladder-v2", "set-c-claim-contract-v2"].includes(id));
    } else {
      assert.deepEqual(call1.responseSchema,
        buildSemanticInventoryPrompt({ article, structuralBlocks, sourceUnits }).responseSchema,
        `${id} call1 schema must match live`);
    }
    assert.ok(call1.user.includes("STRUCTURED ARTICLE:"), `${id} call1 embeds the article`);
    const call2 = profile.call2.build(call2Context);
    if (profile.call2.schemaName === "cf1_selected_enrichment_v4") {
      assert.equal(call2.responseSchema.name, "cf1_selected_enrichment_v4");
      assert.ok(call2.responseSchema.schema.properties.enrichedClaims.items.required.includes("warrant"));
    } else assert.deepEqual(call2.responseSchema, reference.responseSchema,
      `${id} call2 schema must match live (pinned to selection count)`);
    assert.ok(call2.user.endsWith(referenceTail),
      `${id} call2 must end with the identical five host-supplied blocks`);
  }
});

test("prompt fingerprints are stable and shared components retain identical fingerprints", () => {
  const { article, structuralBlocks, sourceUnits } = callInputs();
  const input = { article, structuralBlocks, sourceUnits };
  const seen = new Map();
  for (const { id } of listPairProfiles()) {
    const build = getPairProfile(id).call1.build;
    const first = promptFingerprints(build(input));
    const second = promptFingerprints(build(input));
    assert.deepEqual(first, second, `${id} fingerprints must be deterministic`);
    if (seen.has(first.systemSha256)) {
      assert.equal(seen.get(first.systemSha256), getPairProfile(id).call1.version,
        `${id} may reuse only an explicitly identical Call 1 component`);
    } else seen.set(first.systemSha256, getPairProfile(id).call1.version);
    assert.equal(first.schemaSha256, canonicalSchemaHash(build(input).responseSchema));
  }
});

test("profile builders inject cleanly and carry component identity", () => {
  const builders = profilePromptBuilders("set-b-fidelity-ladder-v1");
  assert.equal(typeof builders.buildCall1, "function");
  assert.equal(typeof builders.buildCall2, "function");
  assert.deepEqual(builders.identity, { profileId: "set-b-fidelity-ladder-v1",
    call1Version: "fidelity-ladder-call1-v1", call2Version: "epistemic-planning-call2-v1" });
  const fullPair = profilePromptBuilders("set-e-posture-first-c-full-v1");
  assert.deepEqual(fullPair.identity, { profileId: "set-e-posture-first-c-full-v1",
    call1Version: "posture-first-order-corrected-call1-v2",
    call2Version: "claim-contract-call2-v1" });
});

test("test-only arms adapt traced candidates to the live inventory shape", () => {
  const { article, structuralBlocks, sourceUnits } = callInputs();
  for (const id of ["set-d-orientation-posture-trace-v1", "set-e-posture-first-order-v1",
    "set-f-recall-posture-source-v1"]) {
    const profile = getPairProfile(id);
    const hybrid = id === "set-f-recall-posture-source-v1";
    const candidate = { propositionCore: "A factual proposition.",
      articleRole: "pillar", ifSupportedEffect: "strengthens", ifRefutedEffect: "weakens",
      articleUse: "endorsed", scoreTransformCheck: "normal", claimText: "A factual proposition.",
      sourceUnitIds: ["U001"], materiality: "high", relatedPillarLabels: ["P"], scope: "article",
      evidenceUsefulnessHint: "An independent record testing the proposition.",
      ...(hybrid ? { assertionSourceKind: "article_voice", assertionSourceName: "article_voice" }
        : { assertionSource: "article" }) };
    const adapted = profile.call1.adaptOutput({
      theme: { text: "A broad proposition.", sourceUnitIds: ["U001"] },
      thesis: { text: "A specific proposition.", sourceUnitIds: ["U001"] },
      pillars: [{ label: "P", text: "A pillar proposition.", importance: "load_bearing",
        sourceUnitIds: ["U001"] }],
      thesisHinge: "substance",
      ...(hybrid ? { opponentScan: [] } : {}),
      candidateClaims: [candidate],
    });
    assert.equal(adapted.candidateClaims[0].claimText, "A factual proposition.");
    assert.equal(adapted.candidateClaims[0].assertionSource, hybrid ? "article_voice" : "article");
    for (const field of ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "scoreTransformCheck"]) {
      assert.equal(field in adapted.candidateClaims[0], false, `${id}:${field}`);
    }
    assert.equal("assertionSourceKind" in adapted.candidateClaims[0], false, id);
    assert.equal("assertionSourceName" in adapted.candidateClaims[0], false, id);
    assert.throws(() => profilePromptBuilders(id),
      (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID");
  }
});

test("corrected arms retain the proposition trace and reject proposition/source corruption", () => {
  for (const id of ["set-b-fidelity-ladder-v2", "set-c-claim-contract-v2",
    "set-d-orientation-posture-trace-v2", "set-e-posture-first-order-v2"]) {
    const profile = getPairProfile(id);
    const candidate = { propositionCore: "A factual proposition.",
      ifSupportedEffect: "weakens", ifRefutedEffect: "strengthens",
      articleUse: "opponent_to_rebut", articleRole: "opponent_claim",
      scoreTransformCheck: "invert", assertionSource: "Named institution",
      claimText: "A factual proposition.", sourceUnitIds: ["U001"], materiality: "high",
      relatedPillarLabels: ["P"], scope: "article",
      evidenceUsefulnessHint: "An independent record testing the proposition." };
    const output = { theme: { text: "A broad proposition.", sourceUnitIds: ["U001"] },
      thesis: { text: "A specific proposition.", sourceUnitIds: ["U001"] },
      pillars: [{ label: "P", text: "A pillar proposition.", importance: "load_bearing",
        sourceUnitIds: ["U001"] }], thesisHinge: "substance", candidateClaims: [candidate] };
    const adapted = profile.call1.adaptOutput(output);
    assert.equal(adapted.candidateClaims[0].propositionCore, "A factual proposition.");
    assert.equal(adapted.candidateClaims[0].ifSupportedEffect, "weakens");
    assert.equal(adapted.candidateClaims[0].scoreTransformCheck, "invert");
    assert.throws(() => profile.call1.adaptOutput({ ...output,
      candidateClaims: [{ ...candidate, claimText: "The opposite proposition." }] }),
    (error) => error.code === "CF1_AGENT_SEMANTIC_INVALID", `${id}: proposition mutation`);
    assert.throws(() => profile.call1.adaptOutput({ ...output,
      candidateClaims: [{ ...candidate, assertionSource: "the article voice" }] }),
    (error) => error.code === "CF1_AGENT_SEMANTIC_INVALID", `${id}: source placeholder`);
    assert.throws(() => profilePromptBuilders(id),
      (error) => error.code === "CF1_PROMPT_REGISTRY_INVALID");
  }
});

test("canonical-proposition arm copies the one model proposition into live claimText", () => {
  const profile = getPairProfile("set-e-canonical-proposition-v1");
  const candidate = { propositionCore: "A factual proposition.",
    ifSupportedEffect: "weakens", ifRefutedEffect: "strengthens",
    articleUse: "opponent_to_rebut", articleRole: "opponent_claim",
    scoreTransformCheck: "invert", assertionSource: "Named institution",
    sourceUnitIds: ["U001"], materiality: "high", relatedPillarLabels: ["P"], scope: "article",
    evidenceUsefulnessHint: "An independent record testing the proposition." };
  const output = { theme: { text: "A broad proposition.", sourceUnitIds: ["U001"] },
    thesis: { text: "A specific proposition.", sourceUnitIds: ["U001"] },
    pillars: [{ label: "P", text: "A pillar proposition.", importance: "load_bearing",
      sourceUnitIds: ["U001"] }], thesisHinge: "substance", candidateClaims: [candidate] };
  const adapted = profile.call1.adaptOutput(output);
  assert.equal(adapted.candidateClaims[0].claimText, "A factual proposition.");
  assert.equal(adapted.candidateClaims[0].propositionCore, "A factual proposition.");
  assert.throws(() => profile.call1.adaptOutput({ ...output,
    candidateClaims: [{ ...candidate, propositionCore: "" }] }),
  (error) => error.code === "CF1_AGENT_SEMANTIC_INVALID");
});

test("corrected prompt instructions are fixture-neutral and source/posture independent", () => {
  const { article, structuralBlocks, sourceUnits } = callInputs();
  for (const id of ["set-b-fidelity-ladder-v2", "set-c-claim-contract-v2",
    "set-d-orientation-posture-trace-v2", "set-e-posture-first-order-v2"]) {
    const prompt = getPairProfile(id).call1.build({ article, structuralBlocks, sourceUnits });
    assert.doesNotMatch(prompt.system, /the article voice|article's own voice/i, id);
    assert.doesNotMatch(prompt.system, /Never use reported as a default for quoted or attributed matter/i,
      id);
    assert.match(prompt.system, /Source identity provides no evidence of posture/, id);
    assert.match(prompt.system, /Never replace P with the article's denial, rebuttal, implied\s+answer/,
      id);
    assert.doesNotMatch(prompt.system, /vaccine|Jefferson|JCPH|CDC|thimerosal|autism/i, id);
    assert.doesNotMatch(prompt.user, /ARTICLE METADATA|Authors:/, id);
  }
});
