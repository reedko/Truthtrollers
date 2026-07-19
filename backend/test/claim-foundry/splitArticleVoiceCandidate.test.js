import test from "node:test";
import assert from "node:assert/strict";
import { addSplitArticleVoiceCandidate }
  from "../../src/claim-foundry/splitArticleVoiceCandidate.js";

const none = { sourceCandidateStatus: "no_candidates_detected", sourceCandidates: [] };
const narrative = { claimUnits: [{ unitId: "U0004", text: "The coastal policy increased local costs." }],
  attributionContextUnits: [], structuralSignals: { blockType: "paragraph_group", unitTypes: ["sentence"] },
  articleAuthors: ["Morgan Lee"] };

test("offers a known byline for ordinary unattributed narrative prose", () => {
  const out = addSplitArticleVoiceCandidate({ sourceDiagnostic: none, ...narrative });
  assert.equal(out.sourceCandidateStatus, "candidates_found");
  assert.equal(out.sourceCandidates[0].nameHint, "Morgan Lee");
  assert.equal(out.sourceCandidates[0].candidateKind, "article_voice");
  assert.deepEqual(out.sourceCandidates[0].unitIds, ["U0004"]);
});

test("never adds an author candidate when positive external evidence already exists", () => {
  const explicit = { sourceCandidateStatus: "candidates_found", sourceCandidates: [
    { sourceCandidateId: "SRC01", nameHint: "Coastal Safety Board", candidateKind: "explicit_external" },
  ] };
  assert.deepEqual(addSplitArticleVoiceCandidate({ sourceDiagnostic: explicit, ...narrative }), explicit);
});

test("excludes quotations, lists, documents, attribution context, and missing bylines", () => {
  const cases = [
    { ...narrative, structuralSignals: { blockType: "quotation", unitTypes: ["quotation"] } },
    { ...narrative, structuralSignals: { blockType: "list", unitTypes: ["list_item"] } },
    { ...narrative, claimUnits: [{ unitId: "U0004", text: "A 2011 study found lower costs." }] },
    { ...narrative, claimUnits: [{ unitId: "U0004", text: "[2] SAFETY\nThe product is harmless." }] },
    { ...narrative, attributionContextUnits: [{ unitId: "U0003", text: "Morgan Lee said so." }] },
    { ...narrative, articleAuthors: [] },
  ];
  for (const input of cases) {
    assert.deepEqual(addSplitArticleVoiceCandidate({ sourceDiagnostic: none, ...input }), none);
  }
});
