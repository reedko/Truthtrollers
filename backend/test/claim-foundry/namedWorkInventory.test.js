import test from "node:test";
import assert from "node:assert/strict";
import { verifySemanticInventory } from "../../src/claim-foundry/twoCallAgentVerification.js";
import { semanticInventorySchemaForArticle } from
  "../../src/claim-foundry/prompts/semanticInventorySchema.js";
import { buildSemanticInventoryPrompt } from
  "../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

const work = (mentionText, workType, sourceUnitIds, citationCallout = null) => ({
  mentionText, workType, citationCallout, source: "text_mention", confidence: "medium",
  sourceUnitIds, linkResolved: false, year: null, peopleOrOrganizations: [], identifiers: [],
});

test("Call 1 preserves visible named-work cues independently of claim selection", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "Wakefield et al15 described a case series involving children." },
    { unitId: "U0002", text: "Cases were classified using DSM-IV criteria." },
  ];
  const output = { theme: { text: "The article reports that the case series influenced the hypothesis.",
    sourceUnitIds: ["U0001"] }, thesis: { text: "The case series influenced the hypothesis.",
    sourceUnitIds: ["U0001"] }, pillars: [{ label: "Case-series influence",
      text: "The case series influenced the hypothesis.", importance: "major", sourceUnitIds: ["U0001"] }],
    candidateClaims: [{ claimText: "Wakefield and colleagues described a case series involving children.",
      sourceUnitIds: ["U0001"], articleRole: "pillar", articleUse: "reported",
      assertionSource: "Wakefield et al", materiality: "medium",
      relatedPillarLabels: ["Case-series influence"], scope: "the described case series",
      evidenceUsefulnessHint: "Locate and identify the cited case series." }] };
  const verified = verifySemanticInventory(output, { sourceUnits, minimumCandidates: 1 });
  assert.deepEqual(verified.namedWorks.map((item) => item.mentionText), ["Wakefield et al", "DSM-IV"]);
  assert.equal(verified.namedWorks[0].citationCallout, "15");
  assert.deepEqual(verified.namedWorks.map((item) => item.namedWorkId), ["NW001", "NW002"]);
  assert.deepEqual(verified.candidateClaims[0].namedWorkHints.map((item) => item.mentionText),
    ["Wakefield et al"]);
});

test("fast Call 1 caps candidates and leaves named-work inventory to the host", () => {
  const article = { title: "Substantial article", text: "x".repeat(5_001) };
  const schema = semanticInventorySchemaForArticle(article).schema;
  const prompt = buildSemanticInventoryPrompt({ article, structuralBlocks: [], sourceUnits: [] });
  assert.equal(schema.properties.candidateClaims.minItems, 8);
  assert.equal(schema.properties.candidateClaims.maxItems, 12);
  assert.equal(schema.required.includes("namedWorks"), false);
  assert.equal("namedWorks" in schema.properties, false);
  assert.match(prompt.system, /host owns named-work detection/);
  assert.match(prompt.user, /up to 12 candidateClaims/);
  assert.doesNotMatch(prompt.user, /host will select/i);
  assert.doesNotMatch(prompt.user, /Independently inventory every text-visible named/);
});

test("host pool deduplicates optional legacy work proposals", () => {
  const sourceUnits = [{ unitId: "U0001",
    text: "Wakefield et al15 published a report; the Wakefield et al. study15 was later discussed." }];
  const base = work("Wakefield et al", "study_or_case_series", ["U0001"], "15");
  const output = { theme: { text: "The article reports that a cited study influenced the debate.",
    sourceUnitIds: ["U0001"] }, thesis: { text: "The cited study influenced the debate.",
    sourceUnitIds: ["U0001"] }, pillars: [{ label: "Study influence",
      text: "The cited study influenced the debate.", importance: "major", sourceUnitIds: ["U0001"] }],
    namedWorks: [base, work("Wakefield et al. study", "study_group", ["U0001"], "15")],
    candidateClaims: [{ claimText: "The cited study influenced the debate.", sourceUnitIds: ["U0001"],
      articleRole: "pillar", articleUse: "reported", assertionSource: "the article", materiality: "medium",
      relatedPillarLabels: ["Study influence"], scope: "the cited study",
      evidenceUsefulnessHint: "Resolve the cited work." }] };
  const verified = verifySemanticInventory(output, { sourceUnits });
  assert.equal(verified.namedWorks.filter((item) => /wakefield/i.test(item.mentionText)).length, 1);
});
