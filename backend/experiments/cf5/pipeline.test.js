import test from "node:test";
import assert from "node:assert/strict";
import { runGenerationPipeline } from "./pipeline.js";

const KNOWN_UNITS = new Set(["U0001", "U0002"]);

function claim(overrides = {}) {
  return {
    claimId: "E001",
    claim: "The CDC reported a rise in cases.",
    grounding: ["U0001"],
    articleTreatment: "adopted",
    provenance: null,
    ...overrides,
  };
}

test("no repair is invoked when validation passes", async () => {
  let repairCalls = 0;
  const result = await runGenerationPipeline({
    rawClaims: [claim()],
    knownUnitIds: KNOWN_UNITS,
    repair: async () => { repairCalls += 1; return { repairedClaims: [] }; },
  });
  assert.equal(repairCalls, 0);
  assert.equal(result.repairResult, null);
  assert.equal(result.finalClaims.length, 1);
});

test("repair is invoked exactly once when a hard failure exists, never a second time", async () => {
  let repairCalls = 0;
  const result = await runGenerationPipeline({
    rawClaims: [claim({ grounding: ["U9999"] })],
    knownUnitIds: KNOWN_UNITS,
    repair: async () => {
      repairCalls += 1;
      // Even if the repaired claim is STILL invalid, the pipeline must not call repair again.
      return { repairedClaims: [claim({ grounding: ["U8888"] })] };
    },
  });
  assert.equal(repairCalls, 1, "repair must be invoked at most once, regardless of outcome");
  assert.ok(result.repairResult.stillFailingClaimIds.includes("E001"),
    "a repair that doesn't fix the defect must be recorded as still failing, not retried");
});

test("a successful repair clears the hard failure and the claim is usable", async () => {
  const result = await runGenerationPipeline({
    rawClaims: [claim({ grounding: ["U9999"] })],
    knownUnitIds: KNOWN_UNITS,
    repair: async () => ({ repairedClaims: [claim({ grounding: ["U0002"] })] }),
  });
  assert.equal(result.repairResult.stillFailingClaimIds.length, 0);
  assert.deepEqual(result.finalClaims[0].grounding, ["U0002"]);
});

test("repair only receives the claims that actually failed, not the whole set", async () => {
  let receivedFailedClaims;
  await runGenerationPipeline({
    rawClaims: [
      claim({ claimId: "E001", claim: "Valid claim one." }),
      claim({ claimId: "E002", claim: "Broken claim.", grounding: ["U9999"] }),
    ],
    knownUnitIds: KNOWN_UNITS,
    repair: async ({ failedClaims }) => {
      receivedFailedClaims = failedClaims;
      return { repairedClaims: [claim({ claimId: "E002", grounding: ["U0001"] })] };
    },
  });
  assert.equal(receivedFailedClaims.length, 1);
  assert.equal(receivedFailedClaims[0].claimId, "E002");
});
