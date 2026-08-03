import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCfxDocumentBearingRequests,
  cfxDocumentBearingTargetInventoryHash,
  cfxEvidenceAssertionFingerprint,
  cfxSelectedTextVersionHash,
  loadCfxDocumentBearingPrompt,
  mergeCfxDocumentBearingTargets,
  runCfxDocumentBearingExtraction,
  validateCfxDocumentBearingExtraction,
} from "../../../src/claimfoundry/cfx/evidenceBearing/documentExtraction.js";
import { buildCfxEvidenceBlocks } from "../../../src/claimfoundry/cfx/evidenceBearing/targetedExtraction.js";
import type { CfxBearingExtractionRow, CfxEvidenceTextAccess } from "../../../src/claimfoundry/cfx/evidenceBearing/types.js";
import { writeCfxPhase3ForensicArtifacts } from "../../../src/claimfoundry/cfx/phase3/forensicArtifacts.js";
import { prioritizeCfxPhase3Documents } from "../../../src/claimfoundry/cfx/phase3/prioritization.js";

const text = [
  "Trial A found lower disease incidence after vaccination.",
  "Trial B found no association with the alleged outcome.",
  "The effect was observed only in adults over 65.",
  "A background paragraph merely discusses vaccines.",
].join("\n\n");
const access: CfxEvidenceTextAccess = {
  candidateId: "DOC-P3", accessLevel: "full_text", textSource: "pmc", text,
  characterCount: text.length, wordCount: text.split(/\s+/u).length,
  sourceUrl: "https://example.test/doc", canonicalUrl: "https://example.test/doc",
  doi: "10.1000/test", pmid: "123", retrievalAttempts: [], accessDiagnostics: [],
};
const targets = [
  { propositionId: "P01", claimId: 1, assertion: "Vaccination lowers disease incidence." },
  { propositionId: "P02", claimId: 2, assertion: "Vaccination causes the alleged outcome." },
  { propositionId: "P03", claimId: 3, assertion: "The effect occurs in every age group." },
  { propositionId: "P04", claimId: 4, assertion: "A topical assertion without evidence." },
];
const row = (
  evidenceAssertion: string,
  exactExcerpt: string,
  bearingRelation: CfxBearingExtractionRow["bearingRelation"],
): CfxBearingExtractionRow => ({
  evidenceAssertion, bearingRelation, exactExcerpt,
  sourceLocation: {
    page: null, section: null, paragraph: null, blockId: null,
    charStart: null, charEnd: null,
  },
  whyItBears: "The literal finding bears on this fixed target.",
  confidence: 0.9, quality: 0.8, limitationsVisibleInText: [],
});
const output = {
  documentId: "DOC-P3", accessLevel: "full_text",
  targets: [
    { propositionId: "P01", noBearingAssertionsFound: false, assertions: [
      row("Vaccination lowered disease incidence.", "Trial A found lower disease incidence after vaccination.", "supports"),
    ] },
    { propositionId: "P02", noBearingAssertionsFound: false, assertions: [
      row("No association was found.", "Trial B found no association with the alleged outcome.", "challenges"),
    ] },
    { propositionId: "P03", noBearingAssertionsFound: false, assertions: [
      row("The effect was limited to older adults.", "The effect was observed only in adults over 65.", "qualifies"),
    ] },
    { propositionId: "P04", noBearingAssertionsFound: true, assertions: [] },
  ],
};

test("1: one document supports, challenges, qualifies, and returns no bearing independently", () => {
  const validated = validateCfxDocumentBearingExtraction({
    rawOutput: output, documentId: "DOC-P3", targets, access,
    blocks: buildCfxEvidenceBlocks(text),
  });
  assert.equal(validated.structurallyValid, true);
  assert.deepEqual(validated.acceptedTargets.map((target) =>
    target.assertions[0]?.bearingRelation ?? "none"),
  ["supports", "challenges", "qualifies", "none"]);
});

test("2: one evidence assertion may link to multiple targets", () => {
  const shared = row("A shared result.", text.split("\n\n")[0], "supports");
  const merged = mergeCfxDocumentBearingTargets({
    documentId: "DOC-P3", targets,
    parts: [[
      { propositionId: "P01", claimId: 1, noBearingAssertionsFound: false, assertions: [shared] },
      { propositionId: "P02", claimId: 2, noBearingAssertionsFound: false, assertions: [{ ...shared, bearingRelation: "qualifies" }] },
    ]],
  });
  assert.equal(merged.evidenceAssertions.length, 1);
  assert.equal(merged.evidenceAssertions[0].targetLinks.length, 2);
});

test("3: one document retains several distinct evidence assertions", () => {
  const validated = validateCfxDocumentBearingExtraction({
    rawOutput: output, documentId: "DOC-P3", targets, access,
    blocks: buildCfxEvidenceBlocks(text),
  });
  const merged = mergeCfxDocumentBearingTargets({ documentId: "DOC-P3", targets, parts: [validated.acceptedTargets] });
  assert.equal(merged.evidenceAssertions.length, 3);
});

test("4: support-lane provenance cannot force a supporting relation", () => {
  const ranked = prioritizeCfxPhase3Documents({ documents: [{
    documentId: "D1", canonicalIdentityKind: "pmid", accessLevel: "abstract",
    textLength: 100, selectedTextVersionHash: "a".repeat(64), propositionIds: ["P02"],
    queryIds: ["Q4"], queryIntents: ["independent_evidence"], providers: ["pubmed"],
    publishers: ["Journal"], documentRoles: ["independent"],
  }] });
  assert.equal(ranked[0].queryIntents[0], "independent_evidence");
  assert.equal(output.targets[1].assertions[0].bearingRelation, "challenges");
});

test("5: counterevidence-lane provenance cannot force a challenging relation", () => {
  const ranked = prioritizeCfxPhase3Documents({ documents: [{
    documentId: "D2", canonicalIdentityKind: "doi", accessLevel: "abstract",
    textLength: 100, selectedTextVersionHash: "b".repeat(64), propositionIds: ["P01"],
    queryIds: ["Q5"], queryIntents: ["counterevidence"], providers: ["pubmed"],
    publishers: ["Journal"], documentRoles: ["independent"],
  }] });
  assert.equal(ranked[0].queryIntents[0], "counterevidence");
  assert.equal(output.targets[0].assertions[0].bearingRelation, "supports");
});

test("6: topical-only targets return explicit no bearing", () => {
  assert.deepEqual(output.targets[3], {
    propositionId: "P04", noBearingAssertionsFound: true, assertions: [],
  });
});

test("7: one bad excerpt does not erase a valid sibling row", () => {
  const malformed = structuredClone(output);
  malformed.targets[1].assertions[0].exactExcerpt = "invented quote";
  const validated = validateCfxDocumentBearingExtraction({
    rawOutput: malformed, documentId: "DOC-P3", targets, access,
    blocks: buildCfxEvidenceBlocks(text),
  });
  assert.equal(validated.acceptedTargets[0].assertions.length, 1);
  assert.equal(validated.acceptedTargets[1].assertions.length, 0);
  assert.equal(validated.quarantinedRows.length, 1);
});

test("8: unknown target IDs are rejected while known siblings survive", () => {
  const unknown = structuredClone(output);
  unknown.targets[1].propositionId = "P99";
  const validated = validateCfxDocumentBearingExtraction({
    rawOutput: unknown, documentId: "DOC-P3", targets, access,
    blocks: buildCfxEvidenceBlocks(text),
  });
  assert.equal(validated.structurallyValid, false);
  assert.equal(validated.acceptedTargets.some((target) => target.propositionId === "P01"), true);
  assert.equal(validated.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_PROPOSITION_ID"), true);
});

test("9: every fixed assertion appears exactly once in a valid response", () => {
  assert.deepEqual(output.targets.map((target) => target.propositionId).sort(), targets.map((target) => target.propositionId).sort());
  assert.equal(new Set(output.targets.map((target) => target.propositionId)).size, targets.length);
});

test("10: long-document fallback repeats the complete immutable target inventory", async () => {
  const prompt = await loadCfxDocumentBearingPrompt();
  const longText = Array.from({ length: 8 }, (_, index) =>
    `Paragraph ${index}. ${"Evidence sentence. ".repeat(45)}`).join("\n\n");
  const longAccess = { ...access, text: longText, characterCount: longText.length };
  const parts = buildCfxDocumentBearingRequests({
    documentId: "DOC-P3", targets, access: longAccess, prompt, model: "gpt-4o-mini",
    temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 180_000,
    maximumDocumentCharactersPerRequest: 1_000,
  });
  assert.ok(parts.length > 1);
  for (const part of parts) {
    for (const target of targets) assert.match(part.request.user, new RegExp(`propositionId: ${target.propositionId}`));
  }
  assert.equal(new Set(parts.flatMap((part) => part.blocks.map((block) => block.blockId))).size,
    parts.flatMap((part) => part.blocks).length);
});

test("11: block merging deduplicates one scoped evidence assertion", () => {
  const assertion = row("Repeated result.", text.split("\n\n")[0], "supports");
  const target = { propositionId: "P01", claimId: 1, noBearingAssertionsFound: false, assertions: [assertion] };
  const merged = mergeCfxDocumentBearingTargets({ documentId: "DOC-P3", targets, parts: [[target], [target]] });
  assert.equal(merged.acceptedTargets[0].assertions.length, 1);
  assert.equal(merged.evidenceAssertions.length, 1);
});

test("12: snippet-only material remains provisional and cannot be requested", async () => {
  const ranked = prioritizeCfxPhase3Documents({ documents: [{
    documentId: "D3", canonicalIdentityKind: "resolved_url", accessLevel: "snippet",
    textLength: 100, selectedTextVersionHash: "c".repeat(64), propositionIds: ["P01"],
    queryIds: ["Q1"], queryIntents: ["canonical"], providers: ["web"],
    publishers: [], documentRoles: ["other"],
  }] });
  assert.equal(ranked[0].tier, "excluded");
  const prompt = await loadCfxDocumentBearingPrompt();
  assert.throws(() => buildCfxDocumentBearingRequests({
    documentId: "D3", targets, access: { ...access, accessLevel: "snippet" }, prompt,
    model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 180_000,
  }));
});

test("13: queryIntent is absent from the model-visible request and fingerprints are stance-independent", async () => {
  const prompt = await loadCfxDocumentBearingPrompt();
  const [part] = buildCfxDocumentBearingRequests({
    documentId: "DOC-P3", targets, access, prompt, model: "gpt-4o-mini",
    temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 180_000,
  });
  assert.doesNotMatch(part.request.user, /queryIntent|counterevidence|independent_evidence/u);
  const assertion = output.targets[0].assertions[0];
  assert.equal(cfxEvidenceAssertionFingerprint({ documentId: "DOC-P3", assertion }),
    cfxEvidenceAssertionFingerprint({ documentId: "DOC-P3", assertion: { ...assertion, bearingRelation: "mixed" } }));
});

test("14: raw provider response, hashes, usage, and validation survive rejection", async () => {
  const prompt = await loadCfxDocumentBearingPrompt();
  const rejected = structuredClone(output);
  rejected.targets[0].assertions[0].exactExcerpt = "not in source";
  const result = await runCfxDocumentBearingExtraction({
    documentId: "DOC-P3", targets, access, prompt, model: "gpt-4o-mini",
    temperature: 0.1, maxOutputTokens: 8_000, timeoutMs: 180_000,
    provider: { async invokeStructured() { return {
      output: rejected, rawResponse: { id: "resp-forensic", output: rejected },
      model: "gpt-4o-mini", responseId: "resp-forensic", requestId: "req-forensic",
      usage: { inputTokens: 101, cachedInputTokens: 0, outputTokens: 22, totalTokens: 123 },
    }; } },
  });
  assert.equal(result.forensicResponses[0].capturedBeforeValidation, true);
  assert.equal(result.quarantinedRows.length, 1);
  assert.equal(result.targetInventoryHash, cfxDocumentBearingTargetInventoryHash(targets));
  assert.equal(result.selectedTextVersionHash, cfxSelectedTextVersionHash(access));
  const root = path.join(tmpdir(), `cfx-phase3-forensic-${process.pid}-${Date.now()}`);
  await writeCfxPhase3ForensicArtifacts(root, { documentId: "DOC-P3", ...result });
  const raw = JSON.parse(await readFile(path.join(root, "request-001", "raw_response.json"), "utf8"));
  assert.equal(raw.id, "resp-forensic");
  const manifest = JSON.parse(await readFile(path.join(root, "run_manifest.json"), "utf8"));
  assert.equal(manifest.usage.totalTokens, 123);
});
