import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleCall1bPackets } from "../../src/claim-foundry/splitPacketAssembly.js";
import { prepareArticle } from "./prompt-benchmark/generationRun.js";

const unit = (order, type, text) => ({ unitId: `U${String(order).padStart(4, "0")}`, order, type, text });

const SOURCE_UNITS = [
  unit(1, "sentence", "Glyphosate is applied widely across farms."),
  unit(2, "quotation", "“That is an act of deception,” Antoniou said."),
  unit(3, "sentence", "The regulator disputes this, saying in fact there is no evidence of harm."),
  unit(4, "heading", "Safety testing"),
  unit(5, "sentence", "A later paragraph discusses aluminum adjuvants in isolation."),
];
const STRUCTURAL_BLOCKS = [
  { blockId: "B001", heading: "", structuralType: "paragraph_group", sourceUnitIds: ["U0001"] },
  { blockId: "B002", heading: "", structuralType: "quotation", sourceUnitIds: ["U0002", "U0003"] },
  { blockId: "B003", heading: "Safety testing", structuralType: "heading_section",
    sourceUnitIds: ["U0004", "U0005"] },
];
const INVENTORY_1A = {
  theme: { text: "theme" }, thesis: { text: "thesis" },
  pillars: [{ label: "Regulation", importance: "major" }], thesisHinge: "substance",
  candidateClaims: [
    { claimText: "Deception claim", sourceUnitIds: ["U0002"],
      relatedPillarLabels: ["Regulation"], groundingSpan: "clustered" },
  ],
};
const ARTICLE = { authors: ["Jill Erzen", { name: "Second Author" }] };

function assemble(extra = {}) {
  return assembleCall1bPackets({ inventory1a: INVENTORY_1A, sourceUnits: SOURCE_UNITS,
    structuralBlocks: STRUCTURAL_BLOCKS, article: ARTICLE, ...extra });
}

test("sends selected candidate packets only, even if a census is supplied", () => {
  const census = [{ censusId: "CEN001", kind: "attributed_statement", signals: ["attributed_statement"],
    sourceUnitIds: ["U0003"] }];
  const out = assemble({ censusItems: census });
  assert.equal(out.packets.length, 1);
  assert.equal(out.packets[0].id, "CAND01");
  assert.equal(out.packets[0].origin, "candidate");
  assert.ok(!out.packets.some((packet) => packet.origin === "census"));
});

test("candidate packets carry claimText + groundingSpan", () => {
  const census = [{ censusId: "CEN001", kind: "block_quotation", signals: ["block_quotation"],
    sourceUnitIds: ["U0002"] }];
  const out = assemble({ censusItems: census });
  assert.equal(out.packets[0].claimText, "Deception claim");
  assert.equal(out.packets[0].groundingSpan, "clustered");
  assert.equal(out.packets.length, 1);
});

test("computes groundingSpan when a candidate was not pre-tagged", () => {
  const out = assembleCall1bPackets({ sourceUnits: SOURCE_UNITS, structuralBlocks: STRUCTURAL_BLOCKS,
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "welded", sourceUnitIds: ["U0001", "U0030"] }] } });
  assert.equal(out.packets[0].groundingSpan, "distant"); // gap 29
});

test("builds a structural context window, never using relatedPillarLabels", () => {
  const packet = assemble().packets[0];
  for (const key of ["claimUnits", "attributionContextUnits", "sourceCandidateStatus",
    "sourceCandidates", "localResponseUnits", "sectionHeading", "structuralSignals"]) {
    assert.ok(key in packet, `packet must carry ${key}`);
  }
  assert.ok(!("relatedPillarLabels" in packet));
  assert.equal(packet.structuralSignals.blockType, "quotation");
  assert.match(packet.claimUnits[0].text, /deception/i);
  assert.equal(packet.sourceCandidateStatus, "candidates_found");
  assert.ok(packet.sourceCandidates.some((item) => /Antoniou/i.test(item.nameHint ?? "")));
});

test("response window stops at a heading (block boundary)", () => {
  // Claim on U0003 (block B002); next unit U0004 is a heading -> window is empty.
  const out = assembleCall1bPackets({ sourceUnits: SOURCE_UNITS, structuralBlocks: STRUCTURAL_BLOCKS,
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "c", sourceUnitIds: ["U0003"] }] } });
  assert.deepEqual(out.packets[0].localResponseUnits, []);
});

test("windows are hard-capped; the full article is never resent", () => {
  const longUnits = [unit(1, "sentence", "x ".repeat(2000))];
  const out = assembleCall1bPackets({ sourceUnits: longUnits,
    structuralBlocks: [{ blockId: "B001", heading: "", structuralType: "paragraph_group",
      sourceUnitIds: ["U0001"] }],
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "c", sourceUnitIds: ["U0001"] }],
      options: {} }, options: { blockChars: 600 } });
  assert.ok(out.packets[0].claimUnits.reduce((n, item) => n + item.text.length, 0) <= 600);
});

test("passes orientation through unchanged and normalizes authors", () => {
  const out = assemble();
  assert.deepEqual(out.orientation, { theme: { text: "theme" }, thesis: { text: "thesis" },
    pillars: [{ label: "Regulation", importance: "major" }], thesisHinge: "substance" });
  assert.deepEqual(out.articleAuthors, ["Jill Erzen", "Second Author"]);
});

test("a list claim receives the preceding structural introduction as attribution context", () => {
  const units = [
    unit(1, "sentence", "The question was asked by the Coastal Safety Board."),
    unit(2, "list_item", "The device failed during testing."),
  ];
  const blocks = [
    { blockId: "B001", order: 0, structuralType: "paragraph_group", sourceUnitIds: ["U0001"] },
    { blockId: "B002", order: 1, structuralType: "list", sourceUnitIds: ["U0002"] },
  ];
  const out = assembleCall1bPackets({ sourceUnits: units, structuralBlocks: blocks,
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "The device failed during testing.",
      sourceUnitIds: ["U0002"], attributionContextUnitIds: [] }] } });
  assert.deepEqual(out.packets[0].attributionContextUnits.map((item) => item.unitId), ["U0001"]);
});

test("an expanded attribution cue in the lookback produces a source candidate", () => {
  const units = [
    unit(1, "sentence", "Researcher Morgan Lee revealed that the coastal data were altered."),
    unit(2, "sentence", "The parameters were then revised."),
  ];
  const blocks = [{ blockId: "B001", order: 0, structuralType: "paragraph_group",
    sourceUnitIds: ["U0001", "U0002"] }];
  const out = assembleCall1bPackets({ sourceUnits: units, structuralBlocks: blocks,
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "The coastal data were altered.",
      sourceUnitIds: ["U0002"] }] } });
  assert.ok(out.packets[0].sourceCandidates.some((item) => /Morgan Lee/.test(item.nameHint)));
  assert.deepEqual(out.packets[0].attributionContextUnits.map((item) => item.unitId), ["U0001"]);
});

test("an attributed alternate occurrence enriches a differently grounded proposition", () => {
  const units = [
    unit(1, "sentence", "The Coastal Safety Board stated:"),
    unit(2, "list_item", "The device failed during testing."),
    unit(10, "sentence", "The device failed during testing."),
  ];
  const blocks = [
    { blockId: "B001", order: 0, structuralType: "paragraph_group", sourceUnitIds: ["U0001"] },
    { blockId: "B002", order: 1, structuralType: "list", sourceUnitIds: ["U0002"] },
    { blockId: "B003", order: 2, structuralType: "paragraph_group", sourceUnitIds: ["U0010"] },
  ];
  const out = assembleCall1bPackets({ sourceUnits: units, structuralBlocks: blocks,
    article: ARTICLE, inventory1a: { candidateClaims: [{ claimText: "The device failed during testing.",
      sourceUnitIds: ["U0010"] }] } });
  const packet = out.packets[0];
  assert.ok(packet.sourceCandidates.some((item) => item.candidateKind === "alternate_occurrence_external"
    && /Coastal Safety Board/.test(item.nameHint)));
  assert.ok(packet.alternateOccurrenceUnits.some((item) => item.unitId === "U0002"));
});

test("article voice is offered only when enabled and no external candidate survives", () => {
  const out = assembleCall1bPackets({ sourceUnits: [unit(1, "sentence", "The device failed during testing.")],
    structuralBlocks: [{ blockId: "B001", order: 0, structuralType: "paragraph_group",
      sourceUnitIds: ["U0001"] }], article: ARTICLE,
    inventory1a: { candidateClaims: [{ claimText: "The device failed during testing.",
      sourceUnitIds: ["U0001"] }] }, options: { includeArticleVoiceCandidates: true } });
  assert.ok(out.packets[0].sourceCandidates.some((item) => item.candidateKind === "article_voice"
    && /Jill Erzen/.test(item.nameHint)));
});

// ---- distant-response attachment (feeds articleDeployment only) ----
// Neutral synthetic topic: exercises the lexical scan (shared claim terms + a response
// cue at distance) without any held-out fixture content.
const V_UNITS = [
  unit(1, "quotation", "Coastal turbines generate electricity more cheaply than any other source."),
  unit(3, "sentence", "The brochure also mentioned turbine colours and blade shapes."),
  unit(20, "sentence", "In reality, coastal turbines do not generate electricity cheaply; that figure is misleading."),
  unit(25, "sentence", "An unrelated closing paragraph about parking permits."),
];
const V_INVENTORY = { theme: {}, thesis: {}, pillars: [], thesisHinge: "substance",
  candidateClaims: [{ claimText: "Coastal turbines generate electricity more cheaply than any other source.",
    sourceUnitIds: ["U0001"], groundingSpan: "clustered" }] };

test("no possibleResponse key when the distant-response scan is off (default)", () => {
  const out = assembleCall1bPackets({ inventory1a: V_INVENTORY, sourceUnits: V_UNITS, article: ARTICLE });
  assert.ok(!("possibleResponse" in out.packets[0]));
});

test("distant-response scan attaches an out-of-window rebuttal sharing claim terms + a response cue", () => {
  const out = assembleCall1bPackets({ inventory1a: V_INVENTORY, sourceUnits: V_UNITS,
    article: ARTICLE, options: { attachDistantResponse: true } });
  const pr = out.packets[0].possibleResponse;
  assert.ok(pr, "a distant rebuttal should be attached");
  assert.deepEqual(pr.unitIds, ["U0020"]); // U0003 is inside the exclude radius; U0025 shares no terms
  assert.ok(pr.distance > 6, "must sit beyond the local neighbourhood");
  assert.ok(pr.overlap >= 2);
  assert.match(pr.text, /misleading|do not generate/i);
});

test("distant-response scan attaches null when no out-of-window passage matches", () => {
  const noResponse = [V_UNITS[0], V_UNITS[3]]; // claim + an unrelated far paragraph, no cue+overlap match
  const out = assembleCall1bPackets({ inventory1a: V_INVENTORY, sourceUnits: noResponse,
    article: ARTICLE, options: { attachDistantResponse: true } });
  assert.equal(out.packets[0].possibleResponse, null);
});

test("F02 end-to-end: census never enlarges the bounded 1B payload", () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/CF1-F02/article.json", import.meta.url)));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const out = assembleCall1bPackets({
    inventory1a: { theme: {}, thesis: {}, pillars: [], thesisHinge: "substance",
      candidateClaims: [{ claimText: "c", sourceUnitIds: ["U0005"] }] },
    sourceUnits: articleDocument.sourceUnits, structuralBlocks, article });
  assert.equal(out.packets.length, 1);
  const biggest = Math.max(...out.packets.flatMap((p) => [p.claimUnits, p.attributionContextUnits,
    p.localResponseUnits].map((items) => (items ?? []).reduce((n, item) => n + item.text.length, 0))));
  assert.ok(biggest <= 601, `no packet field may approach full-article size (got ${biggest})`);
});
