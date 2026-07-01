import test from "node:test";
import assert from "node:assert/strict";

import {
  describeClaimMatchResponse,
  extractClaimMatchArray,
  isBearingPacketEnabled,
  matchClaimsToTaskClaims,
} from "../../src/core/matchClaims.js";

const taskClaims = [{ id: 10, text: "Exposure X causes outcome Y in adolescents." }];
const referenceClaims = [
  { id: 21, text: "A controlled study found Exposure X caused outcome Y in adolescents." },
  { id: 22, text: "Exposure X is widely discussed in public health." },
  { id: 23, text: "Exposure X may affect an unrelated adult outcome." },
];

const passthroughPromptManager = {
  getPrompt: async (_name, fallback) => fallback,
};

test("bearing-aware claim matching rejects topic-only and low-bearing links", async () => {
  const matches = await matchClaimsToTaskClaims({
    referenceClaims,
    taskClaims,
    promptManager: passthroughPromptManager,
    enableBearingPacket: true,
    llm: {
      generate: async () => ([
        {
          referenceClaimIndex: 1,
          taskClaimIndex: 1,
          stance: "support",
          veracityScore: 0.8,
          confidence: 0.9,
          supportLevel: 0.8,
          rationale: "Direct causal result.",
          bearingScore: 0.88,
          bearingType: "direct",
          claimComponentAddressed: "whole_claim",
          causalStrength: "causal",
          bearingReason: "Matches exposure, predicate, outcome, and population.",
        },
        {
          referenceClaimIndex: 2,
          taskClaimIndex: 1,
          stance: "nuance",
          bearingScore: 0.9,
          bearingType: "none",
          claimComponentAddressed: "subject",
        },
        {
          referenceClaimIndex: 3,
          taskClaimIndex: 1,
          stance: "support",
          bearingScore: 0.2,
          bearingType: "indirect",
          claimComponentAddressed: "subject",
        },
      ]),
    },
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].referenceClaimId, 21);
  assert.equal(matches[0].bearingScore, 0.88);
  assert.equal(matches[0].claimComponentAddressed, "whole_claim");
  assert.equal(matches[0].causalStrength, "causal");
});

test("claim matcher requests and accepts the JSON-object matches envelope", async () => {
  let request;
  const matches = await matchClaimsToTaskClaims({
    referenceClaims: [referenceClaims[0]],
    taskClaims,
    promptManager: passthroughPromptManager,
    enableBearingPacket: true,
    llm: {
      generate: async (input) => {
        request = input;
        return { matches: [{
          referenceClaimIndex: 1,
          taskClaimIndex: 1,
          stance: "support",
          veracityScore: 0.8,
          confidence: 0.9,
          supportLevel: 0.8,
          rationale: "Direct causal result.",
          bearingScore: 0.9,
          bearingType: "direct",
          claimComponentAddressed: "whole_claim",
          causalStrength: "causal",
          bearingReason: "Exact claim match.",
        }] };
      },
    },
  });

  assert.equal(matches.length, 1);
  assert.match(request.user, /FINAL JSON ENVELOPE/);
  assert.match(request.schemaHint, /^\{"matches":\[/);
});

test("claim-match envelope parser supports bounded compatibility shapes", () => {
  const row = { referenceClaimIndex: 1, taskClaimIndex: 1 };
  assert.deepEqual(extractClaimMatchArray({ matches: [row] }), [row]);
  assert.deepEqual(extractClaimMatchArray({ claimMatches: [row] }), [row]);
  assert.deepEqual(extractClaimMatchArray({ results: [row] }), [row]);
  assert.deepEqual(extractClaimMatchArray({ data: { matches: [row] } }), [row]);
  assert.deepEqual(extractClaimMatchArray({ match: row }), [row]);
  assert.deepEqual(extractClaimMatchArray(row), [row]);
  assert.equal(extractClaimMatchArray({ output: [row] }), null);
  assert.deepEqual(describeClaimMatchResponse({ output: [row] }).topLevelKeys, ["output"]);
});

test("claim matcher deterministically refutes 25 percent evidence for a majority claim", async () => {
  const matches = await matchClaimsToTaskClaims({
    referenceClaims: [{ id: 31, text: "Approximately 25% of children born with a CHD will need heart surgery in their first year to survive." }],
    taskClaims: [{ id: 30, text: "More than half of all babies born with CHD will require surgery in order to survive." }],
    promptManager: passthroughPromptManager,
    enableBearingPacket: true,
    llm: { async generate() { return { matches: [{
      referenceClaimIndex: 1,
      taskClaimIndex: 1,
      stance: "support",
      veracityScore: 0.9,
      confidence: 0.9,
      supportLevel: 0.8,
      rationale: "A significant percentage require surgery.",
      bearingScore: 0.9,
      bearingType: "direct",
      claimComponentAddressed: "whole_claim",
      causalStrength: "not_applicable",
      bearingReason: "Same population and outcome.",
    }] }; } },
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].stance, "refutes");
  assert.ok(matches[0].supportLevel < 0);
  assert.match(matches[0].rationale, /25%.*contradicts.*50%/);
});

test("claim matcher drops absolute-count support for a percentage claim", async () => {
  const matches = await matchClaimsToTaskClaims({
    referenceClaims: [{ id: 41, text: "Around 3,000 surgeries take place on babies under one year of age every year." }],
    taskClaims: [{ id: 40, text: "More than half of all babies born with CHD will require surgery in order to survive." }],
    promptManager: passthroughPromptManager,
    enableBearingPacket: true,
    llm: { async generate() { return { matches: [{
      referenceClaimIndex: 1,
      taskClaimIndex: 1,
      stance: "support",
      veracityScore: 0.8,
      confidence: 0.9,
      supportLevel: 0.8,
      rationale: "This is a large number of surgeries.",
      bearingScore: 0.8,
      bearingType: "direct",
      claimComponentAddressed: "object",
      causalStrength: "not_applicable",
      bearingReason: "Same general topic.",
    }] }; } },
  });

  assert.deepEqual(matches, []);
});

test("disabled packet mode preserves the legacy claim-match shape", async () => {
  const matches = await matchClaimsToTaskClaims({
    referenceClaims: [referenceClaims[0]],
    taskClaims,
    promptManager: passthroughPromptManager,
    enableBearingPacket: false,
    llm: {
      generate: async () => ([{
        referenceClaimIndex: 1,
        taskClaimIndex: 1,
        stance: "support",
        veracityScore: 0.8,
        confidence: 0.9,
        supportLevel: 0.8,
        rationale: "Legacy match.",
      }]),
    },
  });

  assert.equal(matches.length, 1);
  assert.equal("bearingScore" in matches[0], false);
  assert.deepEqual(Object.keys(matches[0]), [
    "referenceClaimId",
    "taskClaimId",
    "stance",
    "veracityScore",
    "confidence",
    "supportLevel",
    "rationale",
  ]);
});

test("bearing packet feature is opt-in", () => {
  assert.equal(isBearingPacketEnabled({}), false);
  assert.equal(isBearingPacketEnabled({ ENABLE_BEARING_PACKET: "true" }), true);
  assert.equal(isBearingPacketEnabled({ ENABLE_BEARING_PACKET: "false" }), false);
});
