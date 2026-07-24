import test from "node:test";
import assert from "node:assert/strict";
import { buildCf2DiscoveryPrompt } from "../prompts.js";
import { buildCf2V6DiscoveryPrompt } from "./prompts.js";
import { detectAttributionCues } from "./cues.js";
import { resolveCurrentWorkFrames } from "./currentWorkFrames.js";
import {
  lockStructuralSources,
  normalizeEvidenceAnchors,
  normalizeV6Decomposition,
  normalizeV6DecompositionWithQuarantine,
} from "./pipeline.js";

const article = {
  title: "Test",
  text: "Text",
  authors: ["Ana Wolpin"],
};
const units = [
  {
    unitId: "U0001",
    text: "Senior CDC scientist William Thompson revealed that the CDC manipulated data linking the MMR vaccine to autism.",
  },
  {
    unitId: "U0002",
    text: "The article states that the vaccination schedule expanded.",
  },
];

test("CF2 V6 preserves the protected V5 Call A prompt exactly", () => {
  const v5 = buildCf2DiscoveryPrompt({ article, sourceUnits: units });
  const v6 = buildCf2V6DiscoveryPrompt({ article, sourceUnits: units });
  assert.deepEqual(v6, v5);
});

test("CF2 V6 candidate-cap ablation changes only the requested capacity", () => {
  const baseline = buildCf2V6DiscoveryPrompt({ article, sourceUnits: units });
  const cap30 = buildCf2V6DiscoveryPrompt({
    article,
    sourceUnits: units,
    candidateMaximum: 30,
  });
  assert.equal(
    baseline.responseSchema.schema.properties.candidates.maxItems,
    18,
  );
  assert.equal(cap30.responseSchema.schema.properties.candidates.maxItems, 30);
  assert.match(cap30.user, /no more than 30 candidate assertions/);
  assert.equal(
    cap30.user.replace(
      "no more than 30 candidate assertions",
      "no more than 18 candidate assertions",
    ),
    baseline.user,
  );
  assert.deepEqual(
    {
      ...cap30.responseSchema,
      name: baseline.responseSchema.name,
      schema: {
        ...cap30.responseSchema.schema,
        properties: {
          ...cap30.responseSchema.schema.properties,
          candidates: {
            ...cap30.responseSchema.schema.properties.candidates,
            maxItems: 18,
          },
        },
      },
    },
    baseline.responseSchema,
  );
});

test("CF2 V6 detects explicit reporting syntax without deciding its semantics", () => {
  const [cue] = detectAttributionCues({
    rawAssertion: "William Thompson revealed privately in 2014 that data had been manipulated by the CDC.",
    contextUnits: [units[0]],
  });
  assert.equal(cue.supplierText, "William Thompson");
  assert.equal(cue.operator, "revealed");
  assert.equal(cue.embeddedContent, "data had been manipulated by the CDC");
  assert.deepEqual(cue.sourceUnitIds, ["U0001"]);
  const [accordingCue] = detectAttributionCues({
    rawAssertion: "According to the CDC, vaccination rates declined.",
    contextUnits: [{
      unitId: "U0003",
      text: "According to the CDC, vaccination rates declined.",
    }],
  });
  assert.equal(accordingCue.supplierText, "the CDC");
  assert.equal(accordingCue.operator, "according_to");
  assert.equal(accordingCue.embeddedContent, "vaccination rates declined");
});

test("CF2 V6 removes only an ungrounded generic current-study frame", () => {
  const original = "The study found that vaccination rates were similar.";
  const [resolved] = resolveCurrentWorkFrames([{
    candidateId: "C01",
    rawAssertion: original,
    groundingUnitIds: ["U0001"],
    contextUnits: [{
      unitId: "U0001",
      text: "Vaccination rates were similar in case and control children.",
    }],
  }], article);
  assert.equal(resolved.rawAssertion, "vaccination rates were similar.");
  assert.equal(resolved.surfaceAssertion, original);
  assert.equal(
    resolved.currentWorkFrameAudit.status,
    "host_removed_ungrounded_current_work_frame",
  );
  assert.equal(resolved.currentWorkFrameAudit.sourceKind, "article_voice");
});

test("CF2 V6 preserves a grounded external-study frame for antecedent resolution", () => {
  const original = "The study found that relative risk was 0.92.";
  const [resolved] = resolveCurrentWorkFrames([{
    candidateId: "C01",
    rawAssertion: original,
    groundingUnitIds: ["U0002"],
    contextUnits: [
      {
        unitId: "U0001",
        text: "A retrospective cohort study from Denmark included half a million children.",
      },
      {
        unitId: "U0002",
        text: "The study found that relative risk was 0.92.",
      },
    ],
  }], article);
  assert.equal(resolved.rawAssertion, original);
  assert.equal(
    resolved.currentWorkFrameAudit.status,
    "grounded_study_frame_preserved",
  );
});

test("CF2 V6 resolves an explicit current-work frame to the article byline", () => {
  const original = "We found that vaccination rates were similar.";
  const [resolved] = resolveCurrentWorkFrames([{
    candidateId: "C01",
    rawAssertion: original,
    groundingUnitIds: ["U0001"],
    contextUnits: [{
      unitId: "U0001",
      text: "We found that vaccination rates were similar.",
    }],
  }], article);
  assert.equal(resolved.rawAssertion, "vaccination rates were similar.");
  assert.equal(
    resolved.currentWorkFrameAudit.status,
    "host_removed_grounded_current_work_frame",
  );
  assert.equal(resolved.currentWorkFrameAudit.sourceName, "Ana Wolpin");
});

test("CF2 V6 does not strip an ungrounded frame when the proposition lacks support", () => {
  const original = "The study found that vaccination caused every reported illness.";
  const [resolved] = resolveCurrentWorkFrames([{
    candidateId: "C01",
    rawAssertion: original,
    groundingUnitIds: ["U0001"],
    contextUnits: [{
      unitId: "U0001",
      text: "Vaccination rates were similar in case and control children.",
    }],
  }], article);
  assert.equal(resolved.rawAssertion, original);
  assert.equal(
    resolved.currentWorkFrameAudit.status,
    "ungrounded_study_frame_not_repaired",
  );
});

test("CF2 V6 derives the substantive assertion and supplier from the final layer", () => {
  const candidates = [{
    candidateId: "C01",
    rawAssertion: "William Thompson revealed that the CDC manipulated data linking the MMR vaccine to autism.",
    groundingUnitIds: ["U0001"],
  }];
  const [assertion] = normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [{
        supplierName: "William Thompson",
        supplierKind: "person",
        operator: "revealed",
        assertedContent: "The CDC manipulated data linking the MMR vaccine to autism.",
        sourceUnitIds: ["U0001"],
      }],
      substantiveAssertion: "The CDC manipulated data linking the MMR vaccine to autism.",
      groundingUnitIds: ["U0001"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
    }],
  }, candidates, units, article);
  assert.equal(assertion.assertionText,
    "The CDC manipulated data linking the MMR vaccine to autism.");
  assert.equal(assertion.sourceName, "William Thompson");
  assert.equal(assertion.sourceKind, "person");
  assert.equal(assertion.sourceNameOrigin, "call_b_attribution_layer");
  assert.equal(assertion.scoreTransform, "normal");
});

test("CF2 V6 rejects a missing or retained reporting frame", () => {
  const candidates = [{
    candidateId: "C01",
    rawAssertion: "William Thompson revealed that the CDC manipulated data.",
    groundingUnitIds: ["U0001"],
  }];
  assert.throws(() => normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [],
      substantiveAssertion: "William Thompson revealed that the CDC manipulated data.",
      groundingUnitIds: ["U0001"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
    }],
  }, candidates, units, article), { code: "CF2_V6_ATTRIBUTION_LAYER_MISSING" });
  assert.throws(() => normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [{
        supplierName: "William Thompson",
        supplierKind: "person",
        operator: "revealed",
        assertedContent: "William Thompson revealed that the CDC manipulated data.",
        sourceUnitIds: ["U0001"],
      }],
      substantiveAssertion: "William Thompson revealed that the CDC manipulated data.",
      groundingUnitIds: ["U0001"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
    }],
  }, candidates, units, article), { code: "CF2_V6_REPORTING_FRAME_RETAINED" });
});

test("CF2 V6 C30 can quarantine one invalid candidate without losing the batch", () => {
  const candidates = [
    {
      candidateId: "C01",
      rawAssertion: "William Thompson revealed that the CDC manipulated data.",
      groundingUnitIds: ["U0001"],
    },
    {
      candidateId: "C02",
      rawAssertion: "The vaccination schedule expanded.",
      groundingUnitIds: ["U0002"],
    },
  ];
  const result = normalizeV6DecompositionWithQuarantine({
    assertions: [
      {
        candidateId: "C01",
        attributionLayers: [],
        substantiveAssertion: "The CDC manipulated data.",
        groundingUnitIds: ["U0001"],
        articleTreatment: "adopted",
        effectIfTrue: "strengthens",
      },
      {
        candidateId: "C02",
        attributionLayers: [],
        substantiveAssertion: "The vaccination schedule expanded.",
        groundingUnitIds: ["U0002"],
        articleTreatment: "adopted",
        effectIfTrue: "strengthens",
      },
    ],
  }, candidates, units, article, 30);
  assert.deepEqual(result.assertions.map((item) => item.candidateId), ["C02"]);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].candidateId, "C01");
  assert.equal(result.rejections[0].code, "CF2_V6_ATTRIBUTION_LAYER_MISSING");
});

test("CF2 V6 rejects an attribution operator invented by the model", () => {
  const candidates = [{
    candidateId: "C01",
    rawAssertion: "The CDC ordered scientists to destroy evidence.",
    groundingUnitIds: ["U0001"],
  }];
  assert.throws(() => normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [{
        supplierName: "CDC",
        supplierKind: "institution",
        operator: "announced",
        assertedContent: "The CDC ordered scientists to destroy evidence.",
        sourceUnitIds: ["U0001"],
      }],
      substantiveAssertion: "The CDC ordered scientists to destroy evidence.",
      groundingUnitIds: ["U0001"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
    }],
  }, candidates, units, article), { code: "CF2_V6_UNGROUNDED_OPERATOR" });
});

test("CF2 V6 rejects unresolved anaphora in the substantive assertion", () => {
  const candidates = [{
    candidateId: "C01",
    rawAssertion: "The study declared that it had proven the treatment was safe.",
    groundingUnitIds: ["U0003"],
  }];
  const sourceUnits = [{
    unitId: "U0003",
    text: "The study declared that it had proven the treatment was safe.",
  }];
  assert.throws(() => normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [{
        supplierName: "The study",
        supplierKind: "study",
        operator: "declared",
        assertedContent: "it had proven the treatment was safe",
        sourceUnitIds: ["U0003"],
      }],
      substantiveAssertion: "it had proven the treatment was safe",
      groundingUnitIds: ["U0003"],
      articleTreatment: "challenged",
      effectIfTrue: "weakens",
    }],
  }, candidates, sourceUnits, article), { code: "CF2_V6_UNRESOLVED_ANAPHORA" });
});

test("CF2 V6 assigns article voice only when no explicit attribution layer exists", () => {
  const candidates = [{
    candidateId: "C01",
    rawAssertion: "The vaccination schedule expanded.",
    groundingUnitIds: ["U0002"],
  }];
  const [assertion] = normalizeV6Decomposition({
    assertions: [{
      candidateId: "C01",
      attributionLayers: [],
      substantiveAssertion: "The vaccination schedule expanded.",
      groundingUnitIds: ["U0002"],
      articleTreatment: "adopted",
      effectIfTrue: "strengthens",
    }],
  }, candidates, units, article);
  assert.equal(assertion.sourceName, "Ana Wolpin");
  assert.equal(assertion.sourceKind, "article_voice");
  assert.equal(assertion.sourceNameOrigin, "host_article_voice_no_explicit_layer");
});

test("CF2 V6 structural list ownership overrides only the locked list assertion", () => {
  const assertions = [{
    candidateId: "C01",
    sourceName: "Ana Wolpin",
    sourceKind: "article_voice",
    sourceUnitIds: ["U0002"],
    sourceNameOrigin: "host_article_voice_no_explicit_layer",
    attributionBasis: "article_voice",
  }];
  const packets = [{
    candidateId: "C01",
    sourceCandidates: [{
      nameHint: "Jefferson County Public Health",
      candidateKind: "structural_list_owner",
      unitIds: ["U0001"],
      bases: ["explicit owner"],
    }],
  }];
  const [locked] = lockStructuralSources(assertions, packets);
  assert.equal(locked.sourceName, "Jefferson County Public Health");
  assert.equal(locked.sourceKind, "institution");
  assert.equal(locked.sourceNameOrigin, "host_structural_list_owner");
  assert.equal(locked.callBSourceName, "Ana Wolpin");
});

test("CF2 V6 discards an ungrounded optional evidence anchor without blocking", () => {
  const assertions = [{
    candidateId: "C01",
    sourceName: "Ana Wolpin",
    sourceKind: "article_voice",
    sourceUnitIds: ["U0002"],
    sourceNameOrigin: "host_article_voice_no_explicit_layer",
    attributionBasis: "article_voice",
  }];
  const packets = [{
    candidateId: "C01",
    contextUnits: [units[1]],
    sourceCandidates: [],
  }];
  const [normalized] = normalizeEvidenceAnchors({
    attributions: [{
      candidateId: "C01",
      evidenceAnchors: [{
        name: "Invented Study",
        kind: "study",
        unitIds: ["U0002"],
      }],
    }],
  }, assertions, packets, article);
  assert.deepEqual(normalized.evidenceAnchors, []);
  assert.equal(normalized.evidenceAnchorAudit.returned, 1);
  assert.equal(normalized.evidenceAnchorAudit.accepted, 0);
  assert.equal(normalized.evidenceAnchorAudit.discarded.length, 1);
});
