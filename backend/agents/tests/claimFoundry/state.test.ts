import assert from "node:assert/strict";
import test from "node:test";
import { createRunState, legalTransitions, transitionState } from "../../claimFoundry/claimFoundryState.js";
import { document, manifestHash } from "./fixtures.js";

test("legal transition table accepts legal edges and rejects terminal/illegal edges", () => {
  const state = createRunState({ runId: "r", contentId: "c", contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash, budgets: { maxToolCalls: 1, maxUnitsRead: 1, maxRepairRounds: 0 },
    traceId: null, versions: { instruction: "i", toolSchema: "t", model: "m", code: "c" } });
  assert.equal(transitionState(state, "inspecting").status, "inspecting");
  assert.throws(() => transitionState(state, "completed"), /not legal/);
  assert.deepEqual(legalTransitions.completed, []);
});
