// Zero-provider, zero-DB-write proof that every dynamically imported
// production dependency of cfxProductionEvidencePipeline.js's defaultRuntime()
// resolves against freshly built dist/claimfoundry output -- the same loader
// runCfxProductionEvidencePipeline() uses in production. This exercises the
// real compiled dist/ files (defaultRuntime()'s import() specifiers are
// hardcoded dist/-relative literals in a plain .js file, so tsx running this
// test file does not substitute TS source for them): rebuild dist/ before
// running this test for it to mean anything.
import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntime } from "../../../src/services/cfxProductionEvidencePipeline.js";

test("defaultRuntime(): every dynamically imported production dependency resolves against compiled dist output", async () => {
  const runtime = await defaultRuntime();

  // evidence search
  assert.equal(typeof runtime.buildCfxEvidenceSearchHandoff, "function");
  assert.equal(typeof runtime.attachCfxEvidenceSearchHandoffs, "function");
  // retrieval: query planning
  assert.equal(typeof runtime.runCfxQueryPlanning, "function");
  assert.equal(typeof runtime.loadCfxQueryPlanningPrompt, "function");
  // retrieval: execute
  assert.equal(typeof runtime.executeCfxRetrieval, "function");
  // retrieval: candidates / proposition-scoped dedup
  assert.equal(typeof runtime.dedupeCfxCandidates, "function");
  assert.equal(typeof runtime.normalizeCfxProviderCandidate, "function");
  // acquisition
  assert.equal(typeof runtime.aggregateCfxCanonicalDocuments, "function");
  // artifacts
  assert.equal(typeof runtime.createImmutableDirectory, "function");
  assert.equal(typeof runtime.hashArtifactTree, "function");
  assert.equal(typeof runtime.aggregateArtifactHash, "function");
  // shared/sourceUnits (canonicalHash -- used for request hashing)
  assert.equal(typeof runtime.canonicalHash, "function");
  // Option-A packet selection
  assert.equal(typeof runtime.selectCfxAssertionRelativePackets, "function");
  // one assertion x one document extraction
  assert.equal(typeof runtime.runCfxSingleAssertionPacketExtraction, "function");
  // final linking: link-suggestion contract
  assert.equal(typeof runtime.stableCfxSourceAssertionId, "function");
  assert.equal(typeof runtime.buildCfxLinkSuggestionRequest, "function");
  assert.equal(typeof runtime.validateCfxLinkSuggestions, "function");
  assert.equal(typeof runtime.cfxLinkSuggestionPromptHash, "function");
  assert.equal(typeof runtime.cfxLinkSuggestionSchemaHash, "function");
  // source-assertion persistence
  assert.equal(typeof runtime.persistCfxSourceAssertions, "function");
  // link-suggestion persistence
  assert.equal(typeof runtime.persistCfxLinkSuggestions, "function");
});

test("defaultRuntime()'s Promise.all-over-dynamic-import() pattern fails closed when a target module is missing", async () => {
  // Proves the mechanism defaultRuntime() itself relies on: any one rejected
  // dynamic import() inside a Promise.all() call rejects the whole call --
  // there is no code path that swallows a missing module and returns a
  // partial runtime. Uses an intentionally nonexistent path; touches nothing
  // under the real dist/ tree.
  const missingModulePath = "../../../dist/claimfoundry/cfx/finalLinking/this-module-does-not-exist.js";
  const loadWithOneMissingModule = () => Promise.all([
    import("../../../dist/claimfoundry/shared/sourceUnits/index.js"),
    import(missingModulePath),
  ]);
  await assert.rejects(loadWithOneMissingModule, /Cannot find module|ERR_MODULE_NOT_FOUND/);
});
