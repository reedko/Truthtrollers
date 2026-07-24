import test from "node:test";
import assert from "node:assert/strict";
import { buildSplitAtomicRepairPackets, applySplitAtomicRepairs }
  from "../../src/claim-foundry/splitAtomicRepair.js";
import { buildSplitAtomicRepairPrompt }
  from "./prompt-benchmark/promptSets/splitAtomicRepairPromptV1.js";

const sourceUnits = [
  { unitId: "U0001", order: 0, type: "sentence", text: "Polysorbate 80." },
  { unitId: "U0002", order: 1, type: "sentence",
    text: "It is linked to infertility, known to cause cancer, and banned in Europe." },
  { unitId: "U0003", order: 2, type: "sentence", text: "An unrelated statement." },
];
const structuralBlocks = [{ blockId: "B001", order: 0, structuralType: "list",
  sourceUnitIds: sourceUnits.map((unit) => unit.unitId) }];
const original = { claimText: "Polysorbate 80 is linked to infertility and is banned in Europe.",
  sourceUnitIds: ["U0001"], materiality: "high", relatedPillarLabels: ["Safety"],
  scope: "Europe", evidenceUsefulnessHint: "Toxicology and regulatory evidence." };

test("flags a compound claim whose cited unit is only a short label and supplies local units", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  assert.equal(built.packets.length, 1);
  assert.ok(built.packets[0].signals.includes("possible_multiple_assertions"));
  assert.ok(built.packets[0].signals.includes("grounded_only_in_short_label"));
  assert.deepEqual(built.packets[0].allowedSourceUnitIds, ["U0001", "U0002", "U0003"]);
});

test("accepts one grounded first-clause replacement and inherits established metadata", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const applied = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [{ repairId: "1A-001",
      action: "replace_with_first_atomic_assertion",
      claimText: "Polysorbate 80 is linked to infertility.",
      sourceUnitIds: ["U0001", "U0002"],
      evidenceUsefulnessHint: "Evidence testing whether polysorbate 80 is linked to infertility." }] } });
  assert.equal(applied.summary.replaced, 1);
  assert.equal(applied.candidateClaims[0].claimText,
    "Polysorbate 80 is linked to infertility.");
  assert.equal(applied.candidateClaims[0].materiality, "high");
  assert.equal(applied.candidateClaims[0]._atomicityRepair.status, "replaced");
});

test("does not mistake a date pair for two claims and rejects a nearby substitute proposition", () => {
  const dateClaim = { ...original,
    claimText: "The schedule rose from five doses in the 1950s and 60s to 73 doses by 2016.",
    sourceUnitIds: ["U0002"] };
  const dateBuilt = buildSplitAtomicRepairPackets({ candidateClaims: [dateClaim],
    sourceUnits, structuralBlocks });
  assert.ok(!dateBuilt.packets[0]?.signals.includes("possible_multiple_assertions"));

  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const changed = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [{ repairId: "1A-001",
      action: "replace_with_first_atomic_assertion",
      claimText: "An unrelated statement.", sourceUnitIds: ["U0003"],
      evidenceUsefulnessHint: null }] } });
  assert.equal(changed.candidateClaims[0]._atomicityRepair.reason,
    "replacement_changed_proposition");
});

test("a keep judgment cannot silently approve a deterministically compound claim", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const kept = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [{ repairId: "1A-001", action: "keep",
      claimText: original.claimText, sourceUnitIds: original.sourceUnitIds,
      evidenceUsefulnessHint: null }] } });
  assert.equal(kept.candidateClaims[0]._atomicityRepair.status, "unresolved");
  assert.equal(kept.candidateClaims[0]._atomicityRepair.reason,
    "keep_did_not_resolve_compound");
});

test("drops a nonmaterial candidate and falls back to the original on invalid repair", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const dropped = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [{ repairId: "1A-001", action: "drop_not_material",
      claimText: null, sourceUnitIds: [], evidenceUsefulnessHint: null }] } });
  assert.equal(dropped.candidateClaims.length, 0);
  assert.equal(dropped.summary.dropped, 1);

  const invalid = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [{ repairId: "1A-001",
      action: "replace_with_first_atomic_assertion", claimText: "A fabricated result.",
      sourceUnitIds: ["U9999"], evidenceUsefulnessHint: "Fabricated." }] } });
  assert.equal(invalid.candidateClaims[0].claimText, original.claimText);
  assert.equal(invalid.candidateClaims[0]._atomicityRepair.status, "unresolved");
});

test("missing or duplicate repair judgments retain the original with an unresolved marker", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const missing = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [] } });
  assert.equal(missing.candidateClaims[0]._atomicityRepair.reason, "missing_repair");
  const duplicate = applySplitAtomicRepairs({ candidateClaims: [original], packets: built.packets,
    repairOutput: { candidateRepairs: [
      { repairId: "1A-001", action: "keep" }, { repairId: "1A-001", action: "keep" },
    ] } });
  assert.equal(duplicate.candidateClaims[0]._atomicityRepair.reason, "duplicate_repair");
});

test("repair prompt requires one claim or drop and contains no source/posture task", () => {
  const built = buildSplitAtomicRepairPackets({ candidateClaims: [original],
    sourceUnits, structuralBlocks });
  const prompt = buildSplitAtomicRepairPrompt({ inventory1a: { theme: { text: "Theme" },
    thesis: { text: "Thesis" }, pillars: [] }, packets: built.packets });
  assert.match(prompt.system, /first material.*assertion stated within the original claim/is);
  assert.match(prompt.system, /drop_not_material/);
  assert.match(prompt.system, /Do not determine assertion source/i);
  assert.equal(prompt.responseSchema.schema.required[0], "candidateRepairs");
  assert.equal(prompt.responseSchema.schema.properties.candidateRepairs.minItems, 1);
  assert.equal(prompt.responseSchema.schema.properties.candidateRepairs.maxItems, 1);
  assert.deepEqual(prompt.responseSchema.schema.properties.candidateRepairs.items
    .properties.repairId.enum, ["1A-001"]);
});
