import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  CLAIM_FOUNDRY_TOOL_NAMES,
  claimFoundryManagerToolSchemas,
  createClaimFoundryAgentDefinition,
} from "../../claimFoundry/claimFoundryAgent.js";
import {
  applyCoverageUpdates,
  deriveContentRegions,
} from "../../claimFoundry/claimFoundryCoverage.js";
import {
  buildClaimFoundryDecisionState,
  createClaimFoundryInputFilter,
} from "../../claimFoundry/claimFoundryInputFilter.js";
import {
  MemoryClaimFoundryPersistence,
} from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import { createClaimFoundryTools } from "../../claimFoundry/claimFoundryTools.js";
import {
  enforceProjectedInputBudget,
} from "../../claimFoundry/claimFoundryRunner.js";
import { validateWorkingPackage } from "../../claimFoundry/claimFoundryValidation.js";
import { document, manifestHash, pkg } from "../claimFoundry/fixtures.js";

const runtimeBudget = { maxModelTurns: 12, maxToolCalls: 30, maxWallTimeMs: 180_000 };
const persistedBudget = {
  maxToolCalls: 30, maxUnitsRead: 100, maxRepairRounds: 2, maxInputTokens: 45_000,
};

async function setup(runId: string, withCoverage = true) {
  const persistence = new MemoryClaimFoundryPersistence();
  const regions = withCoverage ? deriveContentRegions(document) : [];
  await persistence.create(createRunState({
    runId, contentId: "content-1", contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash, budgets: persistedBudget,
    contentRegions: regions, traceId: null,
    versions: {
      instruction: "cf6.claim-foundry.manager.v2-coverage",
      toolSchema: "cf6.tools.v1", model: "test-model", code: "test",
    },
  }));
  return {
    persistence, regions,
    context: { runId, contentId: "content-1", articleDocument: document, persistence },
  };
}

test("major coverage regions derive deterministically and exclusions require reasons", () => {
  const first = deriveContentRegions(document);
  const second = deriveContentRegions(document);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.throws(() => applyCoverageUpdates(first, [{
    regionId: first[0]!.regionId, status: "excluded",
    candidateBearing: "unlikely", dispositionReason: null,
  }]), /disposition/i);
});

test("reading exact units updates the correct coverage region and remains rereadable", async () => {
  const run = await setup("coverage-read");
  const tools = createClaimFoundryTools(run.context);
  const unitId = run.regions[0]!.startUnitId;
  const first = await tools.read_source_units({
    idempotencyKey: "coverage-read-one", unitIds: [unitId], adjacent: 0,
    maxTextChars: 10_000,
  });
  const affected = first.state.contentRegions.find(region => region.regionId === run.regions[0]!.regionId)!;
  assert.ok(affected.sampledUnitIds.includes(unitId));
  const second = await tools.read_source_units({
    idempotencyKey: "coverage-reread", unitIds: [unitId], adjacent: 0,
    maxTextChars: 10_000,
  });
  assert.equal(second.result.units[0]!.text, first.result.units[0]!.text);
});

test("unseen regions are hard findings and block completion", async () => {
  const run = await setup("coverage-block");
  const tools = createClaimFoundryTools(run.context);
  await tools.save_working_package({
    idempotencyKey: "coverage-save-block", package: pkg("coverage-block"),
  });
  const report = await tools.validate_working_package({ idempotencyKey: "coverage-validate-block" });
  assert.equal(report.result.hardPass, false);
  assert.ok(report.result.findings.some(finding => finding.code === "UNINSPECTED_MAJOR_REGION"));
  await assert.rejects(tools.finalize_claim_package({
    idempotencyKey: "coverage-final-block", mode: "complete", inspectedContextUnitIds: [],
  }), /Structural hard errors remain/);
});

test("short fully covered content may finalize despite THIN_PORTFOLIO", async () => {
  const run = await setup("coverage-complete");
  const tools = createClaimFoundryTools(run.context);
  await tools.read_source_units({
    idempotencyKey: "coverage-read-all",
    unitIds: document.sourceUnits.map(unit => unit.unitId),
    adjacent: 0, maxTextChars: 20_000,
  });
  await tools.save_working_package({
    idempotencyKey: "coverage-save-all", package: pkg("coverage-complete"),
  });
  const report = await tools.validate_working_package({ idempotencyKey: "coverage-validate-all" });
  assert.equal(report.result.hardPass, true);
  assert.ok(report.result.findings.some(finding => finding.code === "THIN_PORTFOLIO"));
  const final = await tools.finalize_claim_package({
    idempotencyKey: "coverage-final-all", mode: "complete", inspectedContextUnitIds: [],
  });
  assert.equal(final.result.status, "completed");
});

test("input filter removes only referenced old source while retaining unreferenced/latest text and findings", async () => {
  const run = await setup("filter-history");
  const oldText = "OLD-SOURCE-TEXT-MUST-DROP";
  const unreferencedText = "UNREFERENCED-SOURCE-MUST-STAY";
  const latestText = document.sourceUnits[0]!.text;
  await run.persistence.mutate("filter-history", "seed_package", "seed-package-key", {}, state => {
    state.workingPackage = pkg("filter-history");
    return { state, result: {} };
  });
  const items: any[] = [
    { type: "function_call", call_id: "old", name: "read_source_units", arguments: "{}" },
    { type: "function_call_output", call_id: "old", output: JSON.stringify({ result: { units: [{
      unitId: document.sourceUnits[1]!.unitId, text: oldText,
    }] } }) },
    { type: "function_call", call_id: "middle", name: "read_source_units", arguments: "{}" },
    { type: "function_call_output", call_id: "middle", output: JSON.stringify({ result: { units: [{
      unitId: document.sourceUnits[2]!.unitId, text: unreferencedText,
    }] } }) },
    { type: "function_call", call_id: "latest", name: "read_source_units", arguments: "{}" },
    { type: "function_call_output", call_id: "latest", output: JSON.stringify({ result: { units: [{ unitId: "U0001", text: latestText }] } }) },
  ];
  const filter = createClaimFoundryInputFilter(run.context);
  const filtered = await filter({
    modelData: { input: items, instructions: "instructions" },
    agent: {} as any, context: undefined,
  });
  const rendered = JSON.stringify(filtered);
  assert.equal(rendered.includes(oldText), false);
  assert.equal(rendered.includes(unreferencedText), true);
  assert.equal(rendered.includes(latestText), true);
  assert.equal(filtered.input.length, 1);

  await run.persistence.mutate("filter-history", "seed_validation", "seed-validation", {}, state => {
    const report = validateWorkingPackage(pkg("filter-history"), document, state.contentRegions);
    state.validationReports.push(report);
    return { state, result: {} };
  });
  const decision = await buildClaimFoundryDecisionState(run.context, []);
  assert.ok(decision.activeValidation?.findings.some(finding =>
    finding.code === "UNINSPECTED_MAJOR_REGION"));
});

test("conditional exposure varies by legal state while preserving multiple model choices", async () => {
  const run = await setup("enabled-tools");
  const definition = createClaimFoundryAgentDefinition({
    context: run.context, model: "test-model", runtimeBudget, persistedBudget,
  });
  const enabled = async () => {
    const values = await Promise.all(definition.tools.map(async tool => [
      tool.name, await tool.isEnabled?.(),
    ] as const));
    return values.filter(([, active]) => active).map(([name]) => name);
  };
  const initial = await enabled();
  assert.ok(initial.length >= 4);
  assert.ok(initial.includes("read_source_units"));
  assert.ok(initial.includes("find_source_units"));
  assert.ok(initial.includes("save_working_package"));
  assert.equal(initial.includes("validate_working_package"), false);
  assert.equal(initial.includes("apply_package_patch"), false);

  const tools = createClaimFoundryTools(run.context);
  await tools.save_working_package({
    idempotencyKey: "enabled-save-package", package: pkg("enabled-tools"),
  });
  const drafting = await enabled();
  assert.ok(drafting.includes("validate_working_package"));
  assert.ok(drafting.includes("read_source_units"));
  assert.ok(drafting.length >= 5);
});

test("request usage persists independently and projected budget blocks before overshoot", async () => {
  const run = await setup("request-accounting");
  const record = {
    runId: "request-accounting", turn: 1, responseId: "resp-1", requestId: "req-1",
    inputTokens: 1000, cachedInputTokens: 800, uncachedInputTokens: 200,
    outputTokens: 100, totalTokens: 1100, model: "test-model",
    toolsExposed: ["read_source_units"], toolSelected: "read_source_units",
    modelVisibleInputHash: "b".repeat(64), estimatedInputTokens: 950,
    payloadClassTokens: { instructions: 100, tools: 300, input: 550 },
    createdAt: new Date().toISOString(),
  };
  await run.persistence.recordModelRequest(record);
  assert.deepEqual(await run.persistence.modelRequests("request-accounting"), [record]);
  assert.throws(() => enforceProjectedInputBudget({
    consumedInputTokens: 44_000, estimatedNextInputTokens: 1_000,
    maxInputTokens: 45_000, turn: 2,
  }), /budget exceeded/i);
});

test("conditional tool exposure reduces schema payload without prescribing one action", () => {
  const schemaTokens = (name: typeof CLAIM_FOUNDRY_TOOL_NAMES[number]) =>
    Math.ceil(JSON.stringify(z.toJSONSchema(claimFoundryManagerToolSchemas[name])).length / 4);
  const turns: Array<Array<typeof CLAIM_FOUNDRY_TOOL_NAMES[number]>> = [
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "validate_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "validate_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "validate_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "validate_working_package", "finalize_claim_package"],
    ["get_content_map", "read_source_units", "find_source_units", "save_working_package", "validate_working_package", "finalize_claim_package"],
  ];
  const conditionalSchemaTokens = turns.reduce(
    (total, tools) => total + tools.reduce((sum, name) => sum + schemaTokens(name), 0),
    0,
  );
  const exposeEverythingTokens = turns.length *
    CLAIM_FOUNDRY_TOOL_NAMES.reduce((sum, name) => sum + schemaTokens(name), 0);
  assert.ok(conditionalSchemaTokens < exposeEverythingTokens);
  assert.ok(turns.every(tools => tools.length > 1));
  assert.ok(new Set(turns.map(tools => tools.join(","))).size > 1);
});
