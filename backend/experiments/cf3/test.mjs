import test from "node:test";
import assert from "node:assert/strict";
import { buildCf3DiscoveryPrompt, buildCf3ArgumentPrompt } from "./prompts.js";
import {
  splitStructural,
  normalizeChunkDiscovery,
  buildInventory,
  deriveScoreTransform,
  normalizeArgument,
  attributionFusionToken,
  reportingResidueVerb,
  runCf3,
} from "./pipeline.js";
import { renderCf3Html } from "./report.js";

const units = Array.from({ length: 20 }, (_, index) => ({
  unitId: `U${String(index + 1).padStart(4, "0")}`,
  order: index,
  text: `Sentence ${index + 1}.`,
}));

test("CF3 chunking splits into 4 ranges with bounded overlap", () => {
  const chunks = splitStructural(units, { count: 4, overlap: 0.1 });
  assert.equal(chunks.length, 4);
  assert.ok(chunks.every((chunk) => chunk.chunkCount === 4));
  // core ranges tile the article without gaps or overlap
  assert.deepEqual(chunks.map((chunk) => [chunk.coreStart, chunk.coreEnd]),
    [[0, 5], [5, 10], [10, 15], [15, 20]]);
  // overlap of round(5*0.1)=1 unit extends interior chunks on both sides
  assert.equal(chunks[1].units.length, 7);
  assert.equal(chunks[0].units.length, 6);
});

test("CF3 discovery prompt is per-chunk and fixture-neutral", () => {
  const [chunk] = splitStructural(units, { count: 4 });
  const prompt = buildCf3DiscoveryPrompt({ chunk });
  assert.match(prompt.user, /ARTICLE SECTION 1 OF 4/);
  assert.match(`${prompt.system}\n${prompt.user}`, /original polarity/i);
  assert.match(prompt.user, /in challengedAssertions, return the assertions/);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`,
    /\b(?:vaccine|CDC|JCPH|thimerosal|autism|William Thompson)\b/i);
  // v2: two arrays, challengedAssertions first, no per-item boolean.
  assert.deepEqual(Object.keys(prompt.responseSchema.schema.properties),
    ["challengedAssertions", "assertions"]);
  assert.deepEqual(prompt.responseSchema.schema.properties.assertions.items.required,
    ["assertionText", "groundingUnitIds"]);
});

test("CF3 discovery drops assertions grounded outside the chunk range", () => {
  const chunk = { chunkIndex: 1, chunkCount: 1,
    unitIds: new Set(["U0001", "U0002"]), units };
  const { assertions, findings } = normalizeChunkDiscovery({
    challengedAssertions: [
      { assertionText: "Disputed one.", groundingUnitIds: ["U0002"] },
    ],
    assertions: [
      { assertionText: "In range.", groundingUnitIds: ["U0001"] },
      { assertionText: "Out of range.", groundingUnitIds: ["U0099"] },
      { assertionText: "  ", groundingUnitIds: ["U0001"] },
    ],
  }, chunk);
  // challengedAssertions items are tagged challenged:true; grounding still validated.
  assert.deepEqual(assertions.map((item) => item.assertionText), ["Disputed one.", "In range."]);
  assert.deepEqual(assertions.map((item) => item.challenged), [true, false]);
  assert.deepEqual(findings.map((finding) => finding.code),
    ["CF3_GROUNDING_OUT_OF_CHUNK", "CF3_DISCOVERY_EMPTY_ASSERTION"]);
});

test("CF3 inventory dedupes, ORs challenged, unions grounding, assigns global IDs", () => {
  const inventory = buildInventory([
    { assertions: [
      { assertionText: "Claim one.", groundingUnitIds: ["U0001"], challenged: false },
      { assertionText: "Claim two.", groundingUnitIds: ["U0003"], challenged: false },
    ] },
    { assertions: [
      { assertionText: " claim one. ", groundingUnitIds: ["U0002"], challenged: true },
    ] },
  ]);
  assert.deepEqual(inventory.map((item) => item.assertionId), ["A001", "A002"]);
  assert.equal(inventory[0].challenged, true);
  assert.deepEqual(inventory[0].groundingUnitIds, ["U0001", "U0002"]);
});

test("CF3 scoreTransform follows the derivation table", () => {
  assert.equal(deriveScoreTransform("adopted", "no_effect"), "normal");
  assert.equal(deriveScoreTransform("challenged", "strengthens"), "invert");
  assert.equal(deriveScoreTransform("reported", "strengthens"), "normal");
  assert.equal(deriveScoreTransform("reported", "weakens"), "invert");
  assert.equal(deriveScoreTransform("reported", "no_effect"), "none");
});

const inventory = [
  { assertionId: "A001", assertionText: "The treatment works.", groundingUnitIds: ["U0001"], challenged: false },
  { assertionId: "A002", assertionText: "A study found fewer events.", groundingUnitIds: ["U0003"], challenged: false },
  { assertionId: "A003", assertionText: "The agency withheld data.", groundingUnitIds: ["U0005"], challenged: true },
];

function labeled(assertionId, overrides = {}) {
  return {
    assertionId,
    // testableAssertion defaults to a fresh (non-echoed) statement to avoid tripping
    // CF3_ASSERTION_VERBATIM_COPY in unrelated tests.
    testableAssertion: `Restated ${assertionId}.`,
    thesisEffect: "strengthens",
    articleTreatment: "adopted",
    assertionSource: { name: "Author", kind: "article_voice", sourceUnitIds: ["U0001"] },
    argumentBranchId: "B01",
    citedWorks: [],
    ...overrides,
  };
}

test("CF3 argument validation rejects structural violations", () => {
  const base = {
    stanceAnchor: "Anchor.",
    selectedAssertionIds: ["A001", "A002"],
    selectedAssertions: [labeled("A001"), labeled("A002")],
    argumentBranches: [{ branchId: "B01", branchQuestion: "Q?" }],
  };
  // wrong count
  assert.throws(() => normalizeArgument(base, inventory, units, 3),
    { code: "CF3_SELECTION_COUNT" });
  // unknown id
  assert.throws(() => normalizeArgument({ ...base,
    selectedAssertionIds: ["A001", "A999"],
    selectedAssertions: [labeled("A001"), labeled("A002")] }, inventory, units, 2),
    { code: "CF3_UNKNOWN_ASSERTION" });
  // labeled set mismatch
  assert.throws(() => normalizeArgument({ ...base,
    selectedAssertions: [labeled("A001"), labeled("A001")] }, inventory, units, 2),
    { code: "CF3_SELECTION_MISMATCH" });
});

test("CF3 argument records challenged-drop and polarity findings", () => {
  const mapped = normalizeArgument({
    stanceAnchor: "The treatment is effective.",
    selectedAssertionIds: ["A001", "A002"],
    selectedAssertions: [
      labeled("A001", { testableAssertion: "The treatment does not work.", articleTreatment: "challenged", thesisEffect: "weakens" }),
      labeled("A002"),
    ],
    argumentBranches: [{ branchId: "B01", branchQuestion: "Does it work?" }],
  }, inventory, units, 2);
  const codes = mapped.findings.map((finding) => finding.code);
  assert.ok(codes.includes("CF3_POLARITY_FLIP_SUSPECTED"));
  assert.ok(codes.includes("CF3_CHALLENGED_DROPPED")); // A003 challenged, not selected
  assert.equal(mapped.assertions[0].scoreTransform, "invert"); // challenged
  assert.equal(mapped.assertions[0].groundingUnitIds[0], "U0001"); // host join from inventory
});

test("CF3 fusion detector flags a source name left inside assertionText", () => {
  // Distinctive token present -> fused.
  assert.equal(attributionFusionToken("William Thompson",
    "William Thompson revealed the data was manipulated."), "William");
  // Attribution stripped -> clean.
  assert.equal(attributionFusionToken("William Thompson",
    "The CDC manipulated the MMR–autism data."), null);
  // Generic descriptor words alone are not a signal.
  assert.equal(attributionFusionToken("Senior scientist",
    "The scientist findings were destroyed."), null);

  const mapped = normalizeArgument({
    stanceAnchor: "Anchor.",
    selectedAssertionIds: ["A001", "A002"],
    selectedAssertions: [
      labeled("A001", { testableAssertion: "William Thompson said the data was manipulated.",
        assertionSource: { name: "William Thompson", kind: "person", sourceUnitIds: ["U0001"] } }),
      labeled("A002"),
    ],
    argumentBranches: [{ branchId: "B01", branchQuestion: "Q?" }],
  }, [
    { assertionId: "A001", assertionText: "William Thompson said the data was manipulated.", groundingUnitIds: ["U0001"], challenged: false },
    { assertionId: "A002", assertionText: "A study found fewer events.", groundingUnitIds: ["U0003"], challenged: false },
  ], units, 2);
  const fused = mapped.findings.filter((finding) => finding.code === "CF3_SOURCE_FUSED");
  assert.equal(fused.length, 1);
  assert.equal(fused[0].assertionId, "A001");
  assert.equal(fused[0].matchedToken, "William");
});

test("CF3 flags a testableAssertion that verbatim-copies the inventory text", () => {
  const inv = [
    { assertionId: "A001", assertionText: "The agency manipulated the data.", groundingUnitIds: ["U0001"], challenged: false },
    { assertionId: "A002", assertionText: "A study found fewer events.", groundingUnitIds: ["U0003"], challenged: false },
  ];
  const mapped = normalizeArgument({
    stanceAnchor: "Anchor.",
    selectedAssertionIds: ["A001", "A002"],
    selectedAssertions: [
      // echoes inventory text verbatim (the A009 failure mode)
      labeled("A001", { testableAssertion: "The agency manipulated the data." }),
      // fresh restatement -> clean
      labeled("A002", { testableAssertion: "Vaccinated infants had fewer adverse events." }),
    ],
    argumentBranches: [{ branchId: "B01", branchQuestion: "Q?" }],
  }, inv, units, 2);
  const copies = mapped.findings.filter((f) => f.code === "CF3_ASSERTION_VERBATIM_COPY");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].assertionId, "A001");
});

test("CF3 prompts use no known-degrading terminology (proposition/claim)", () => {
  // §9.4/§11.1: "proposition" and "claim" measurably degrade output; the model-facing
  // word is "assertion". Dummy data is term-free so any hit comes from prompt prose,
  // not injected article/inventory content.
  const disc = buildCf3DiscoveryPrompt({
    chunk: { chunkIndex: 1, chunkCount: 1, units: [{ unitId: "U0001", text: "x" }] },
  });
  const argp = buildCf3ArgumentPrompt({
    article: { title: "T", authors: ["A"], publisher: "P", publishedAt: "2026" },
    sourceUnits: [{ unitId: "U0001", text: "x" }],
    inventory: [{ assertionId: "A001", assertionText: "x", groundingUnitIds: ["U0001"], challenged: false }],
    portfolioSize: 12,
  });
  const banned = /\b(?:propositions?|claims?)\b/i;
  for (const [label, text] of [["discovery.system", disc.system], ["discovery.user", disc.user],
    ["argument.system", argp.system], ["argument.user", argp.user]]) {
    const hit = (text.match(banned) ?? [])[0];
    assert.equal(hit, undefined, `${label} contains banned term "${hit}"`);
  }
});

test("CF3 reporting-residue detector catches frames the fusion detector cannot", () => {
  // Fusion detector is blind here (source is mis-attributed to the article), but the
  // reporting verb is caught regardless of the source field.
  assert.equal(reportingResidueVerb("William Thompson revealed the data was manipulated."), "revealed");
  assert.equal(reportingResidueVerb("According to the CDC, the data was manipulated."), "According to");
  assert.equal(reportingResidueVerb("The CDC manipulated the MMR–autism data."), null);

  const inv = [
    { assertionId: "A001", assertionText: "William Thompson revealed the data was manipulated.", groundingUnitIds: ["U0001"], challenged: false },
    { assertionId: "A002", assertionText: "A study found fewer events.", groundingUnitIds: ["U0003"], challenged: false },
  ];
  const mapped = normalizeArgument({
    stanceAnchor: "Anchor.",
    selectedAssertionIds: ["A001", "A002"],
    selectedAssertions: [
      // source mis-attributed to article_voice -> fusion detector stays silent
      labeled("A001", { testableAssertion: "William Thompson revealed the data was manipulated.",
        assertionSource: { name: "author Ana Wolpin", kind: "article_voice", sourceUnitIds: ["U0001"] } }),
      labeled("A002"),
    ],
    argumentBranches: [{ branchId: "B01", branchQuestion: "Q?" }],
  }, inv, units, 2);
  assert.equal(mapped.findings.filter((f) => f.code === "CF3_SOURCE_FUSED").length, 0);
  const residue = mapped.findings.filter((f) => f.code === "CF3_REPORTING_RESIDUE");
  assert.equal(residue.length, 1);
  assert.equal(residue[0].assertionId, "A001");
  assert.equal(residue[0].matchedVerb, "revealed");
});

test("CF3 argument prompt orders stance before source and injects portfolio size", () => {
  const prompt = buildCf3ArgumentPrompt({
    article: { title: "T", authors: ["A"] }, sourceUnits: units, inventory, portfolioSize: 12,
  });
  assert.match(prompt.user, /Select exactly 12 assertions/);
  // Stance-before-source (§8.4) is carried by schema property order, not prose.
  const items = prompt.responseSchema.schema.properties.selectedAssertions.items;
  const props = Object.keys(items.properties);
  assert.ok(props.indexOf("thesisEffect") < props.indexOf("assertionSource"));
  assert.ok(props.indexOf("articleTreatment") < props.indexOf("assertionSource"));
  // §6.2 property order is load-bearing (not just JSON validity):
  assert.equal(props[props.length - 1], "citedWorks"); // citedWorks is the last property
  assert.deepEqual(Object.keys(items.properties.assertionSource.properties),
    ["name", "kind", "sourceUnitIds"]); // sourceUnitIds after name and kind
  assert.deepEqual(Object.keys(items.properties.citedWorks.items.properties),
    ["name", "type", "sourceUnitIds"]);
  assert.match(prompt.user, /citedWorks — studies, documents/); // prose line present
  assert.doesNotMatch(prompt.user, /\b(?:pillar|materiality|centrality|confidence)\b/i);
});

test("CF3 pipeline makes 4 discovery calls plus 1 argument call and renders", async () => {
  const requests = [];
  const discoveryRunner = {
    invokeStructured: async (request) => {
      requests.push({ kind: "discovery", model: request.model });
      // Each chunk returns one grounded assertion within its own unit range.
      const firstUnit = request.user.match(/\[(U\d{4})\]/)[1];
      return { output: { challengedAssertions: [], assertions: [
        { assertionText: `Assertion at ${firstUnit}.`, groundingUnitIds: [firstUnit] },
      ] }, model: request.model, attempts: 1,
        usage: { totalTokens: 100 }, rawResponse: {} };
    },
  };
  const argumentRunner = {
    invokeStructured: async (request) => {
      requests.push({ kind: "argument", model: request.model });
      const inv = JSON.parse(request.user.match(/ASSERTION INVENTORY\n\n([\s\S]*?)\n\nTASK/)[1]);
      const chosen = inv.slice(0, 2);
      return { output: {
        stanceAnchor: "Anchor.",
        selectedAssertionIds: chosen.map((item) => item.assertionId),
        selectedAssertions: chosen.map((item) => ({
          assertionId: item.assertionId,
          testableAssertion: `Testable ${item.assertionId}.`,
          thesisEffect: "strengthens",
          articleTreatment: "adopted",
          assertionSource: { name: "Author", kind: "article_voice", sourceUnitIds: [] },
          argumentBranchId: "B01",
          citedWorks: [],
        })),
        argumentBranches: [{ branchId: "B01", branchQuestion: "Q?" }],
      }, model: request.model, attempts: 1, usage: { totalTokens: 200 }, rawResponse: {} };
    },
  };
  const result = await runCf3({
    rawArticle: {
      title: "Test", text: units.map((unit) => unit.text).join(" "), language: "en",
    },
    discoveryRunner,
    argumentRunner,
    portfolioSize: 2,
    clock: (() => { let time = 0; return () => new Date(time += 100); })(),
  });
  assert.equal(requests.filter((request) => request.kind === "discovery").length, 4);
  assert.equal(requests.filter((request) => request.kind === "argument").length, 1);
  assert.equal(result.assertions.length, 2);
  const html = renderCf3Html(result);
  assert.match(html, /CF3 · Chunked discovery/);
  assert.match(html, /Argument branches/);
});
