import test from "node:test";
import assert from "node:assert/strict";
import { buildCf2DiscoveryPrompt, buildCf2FinalizationPrompt } from "./prompts.js";
import {
  attachLocalContext,
  normalizeDiscovery,
  normalizeFinalization,
  runCf2,
  selectCf2Portfolio,
  transformForEffect,
} from "./pipeline.js";
import { renderCf2Html } from "./report.js";

const article = {
  title: "A test article",
  text: "Institution A says the treatment works. The author disputes that statement. A study found fewer events.",
  authors: ["Alex Author"],
  publisher: "Example",
  publishedAt: "2026-01-01T00:00:00Z",
  language: "en",
};

const units = [
  { unitId: "U0001", order: 0, text: "Institution A says the treatment works." },
  { unitId: "U0002", order: 1, text: "The author disputes that statement." },
  { unitId: "U0003", order: 2, text: "A study found fewer events." },
];

test("CF2 discovery prompt is minimal and fixture-neutral", () => {
  const prompt = buildCf2DiscoveryPrompt({ article, sourceUnits: units });
  assert.match(prompt.user, /no more than 18/);
  assert.match(`${prompt.system}\n${prompt.user}`, /original polarity/i);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`,
    /\b(?:vaccine|vaccination|CDC|JCPH|thimerosal|MMR|autism|William Thompson)\b/i);
  assert.deepEqual(prompt.responseSchema.schema.required, ["thesisAssertion", "candidates"]);
  assert.deepEqual(prompt.responseSchema.schema.properties.candidates.items.required,
    ["rawAssertion", "groundingUnitIds"]);
});

test("CF2 host assigns IDs, removes exact duplicates, and validates grounding", () => {
  const output = {
    thesisAssertion: "The treatment claim is unsupported.",
    candidates: [
      { rawAssertion: "Institution A says the treatment works.", groundingUnitIds: ["U0001"] },
      { rawAssertion: " Institution A says the treatment works. ", groundingUnitIds: ["U0001"] },
      { rawAssertion: "A study found fewer events.", groundingUnitIds: ["U0003"] },
    ],
  };
  assert.deepEqual(normalizeDiscovery(output, units).candidates.map((item) => item.candidateId),
    ["C01", "C02"]);
  assert.throws(() => normalizeDiscovery({
    thesisAssertion: "Thesis",
    candidates: [{ rawAssertion: "Bad", groundingUnitIds: ["U9999"] }],
  }, units), /U9999/);
});

test("CF2 local context is deterministic and bounded", () => {
  const candidates = [{ candidateId: "C01", rawAssertion: "Study result",
    groundingUnitIds: ["U0003"] }];
  const [packet] = attachLocalContext(candidates, units, 1);
  assert.deepEqual(packet.contextUnits.map((unit) => unit.unitId), ["U0002", "U0003"]);
});

test("CF2 finalization puts source fields after relation fields", () => {
  const candidates = attachLocalContext([
    { candidateId: "C01", rawAssertion: "Institution A says the treatment works.",
      groundingUnitIds: ["U0001"] },
  ], units);
  const prompt = buildCf2FinalizationPrompt({
    article,
    thesisAssertion: "The treatment claim is unsupported.",
    candidates,
  });
  const properties = Object.keys(prompt.responseSchema.schema.properties.assertions
    .items.properties);
  assert.ok(properties.indexOf("articleTreatment") < properties.indexOf("sourceName"));
  assert.ok(properties.indexOf("effectIfTrue") < properties.indexOf("sourceName"));
  assert.match(prompt.user, /one judgment for every supplied candidate/i);
  assert.doesNotMatch(prompt.user, /select no more than/i);
  assert.doesNotMatch(prompt.user, /\b(?:pillar|materiality|rationale)\b/i);
  assert.equal(properties.includes("confidence"), false);
});

test("CF2 host derives transforms and never supplies a missing source", () => {
  const candidates = attachLocalContext([
    { candidateId: "C01", rawAssertion: "Institution A says the treatment works.",
      groundingUnitIds: ["U0001"] },
    { candidateId: "C02", rawAssertion: "A study found fewer events.",
      groundingUnitIds: ["U0003"] },
  ], units);
  const assertions = normalizeFinalization({
    assertions: [
      {
        candidateId: "C01",
        assertionText: "The treatment works.",
        groundingUnitIds: ["U0001"],
        articleTreatment: "challenged",
        effectIfTrue: "weakens",
        sourceName: "Institution A",
        sourceKind: "institution",
        sourceUnitIds: ["U0001"],
      },
      {
        candidateId: "C02",
        assertionText: "The study found fewer events.",
        groundingUnitIds: ["U0003"],
        articleTreatment: "reported",
        effectIfTrue: "no_effect",
        sourceName: "unknown",
        sourceKind: "unknown",
        sourceUnitIds: [],
      },
    ],
  }, candidates, units);
  assert.equal(assertions[0].scoreTransform, "invert");
  assert.equal(assertions[1].sourceName, null);
  assert.equal(transformForEffect("strengthens"), "normal");

  const [namedUnknown] = normalizeFinalization({
    assertions: [{
      candidateId: "C01",
      assertionText: "The treatment works.",
      groundingUnitIds: ["U0001"],
      articleTreatment: "reported",
      effectIfTrue: "no_effect",
      sourceName: "Institution A",
      sourceKind: "unknown",
      sourceUnitIds: ["U0001"],
    }],
  }, [candidates[0]], units);
  assert.equal(namedUnknown.sourceName, "Institution A");
  assert.equal(namedUnknown.sourceKind, "unknown");

  const [articleVoice] = normalizeFinalization({
    assertions: [{
      candidateId: "C02",
      assertionText: "The study found fewer events.",
      groundingUnitIds: ["U0003"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
      sourceName: null,
      sourceKind: "article_voice",
      sourceUnitIds: ["U0003"],
    }],
  }, [candidates[1]], units, { articleAuthors: ["Alex Author"] });
  assert.equal(articleVoice.sourceName, "Alex Author");
  assert.equal(articleVoice.sourceNameOrigin, "host_materialized_byline");
});

test("CF2 host preserves challenged judgments and balances remaining portfolio", () => {
  const sourceUnits = Array.from({ length: 8 }, (_, index) => ({
    unitId: `U${String(index + 1).padStart(4, "0")}`,
    text: `Unit ${index + 1}`,
  }));
  const assertions = [
    { candidateId: "C01", articleTreatment: "reported", effectIfTrue: "weakens",
      groundingUnitIds: ["U0002"] },
    { candidateId: "C02", articleTreatment: "adopted", effectIfTrue: "strengthens",
      groundingUnitIds: ["U0001"] },
    { candidateId: "C03", articleTreatment: "adopted", effectIfTrue: "strengthens",
      groundingUnitIds: ["U0003"] },
    { candidateId: "C04", articleTreatment: "adopted", effectIfTrue: "strengthens",
      groundingUnitIds: ["U0005"] },
    { candidateId: "C05", articleTreatment: "adopted", effectIfTrue: "strengthens",
      groundingUnitIds: ["U0008"] },
    { candidateId: "C06", articleTreatment: "reported", effectIfTrue: "no_effect",
      groundingUnitIds: ["U0007"] },
  ];
  const selected = selectCf2Portfolio(assertions, sourceUnits, 4);
  assert.deepEqual(selected.map((assertion) => assertion.candidateId),
    ["C01", "C02", "C03", "C04"]);
});

test("CF2 pipeline makes exactly two injected calls and renders review details", async () => {
  const requests = [];
  const progress = [];
  const runner = (output) => ({
    invokeStructured: async (request) => {
      requests.push(request);
      return { output, model: request.model, attempts: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, rawResponse: {} };
    },
  });
  const result = await runCf2({
    rawArticle: article,
    callARunner: runner({
      thesisAssertion: "The treatment claim is unsupported.",
      candidates: [
        { rawAssertion: "Institution A says the treatment works.",
          groundingUnitIds: ["U0001"] },
      ],
    }),
    callBRunner: runner({
      assertions: [{
        candidateId: "C01",
        assertionText: "The treatment works.",
        groundingUnitIds: ["U0001"],
        articleTreatment: "challenged",
        effectIfTrue: "weakens",
        sourceName: "Institution A",
        sourceKind: "institution",
        sourceUnitIds: ["U0001"],
      }],
    }),
    clock: (() => {
      let time = 0;
      return () => new Date(time += 100);
    })(),
    onProgress: (event) => progress.push(event.stage),
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(progress, ["call_a_completed", "call_b_completed"]);
  assert.equal(result.assertions.length, 1);
  const html = renderCf2Html(result);
  assert.match(html, /If true: weakens article/);
  assert.match(html, /Raw candidate, grounding, and local context/);
});
