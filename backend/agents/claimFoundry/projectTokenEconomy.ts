import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  claimFoundryAgentCompletionSchema,
} from "./claimFoundryCompletion.js";
import {
  createClaimFoundryAgentDefinition,
} from "./claimFoundryAgent.js";
import { deriveContentRegions } from "./claimFoundryCoverage.js";
import { buildClaimFoundryDecisionState } from "./claimFoundryInputFilter.js";
import {
  CLAIM_FOUNDRY_INSTRUCTION_VERSION,
} from "./claimFoundryInstructions.js";
import { hashValue, MemoryClaimFoundryPersistence } from "./claimFoundryPersistence.js";
import { CLAIM_FOUNDRY_RUNTIME_BUDGET } from "./claimFoundryRunner.js";
import { createRunState } from "./claimFoundryState.js";
import { validateWorkingPackage } from "./claimFoundryValidation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const require = createRequire(path.join(backendRoot, "package.json"));
const { encoding_for_model: encodingForModel } = require("tiktoken");
const encoding = encodingForModel("gpt-4.1-mini");
const buildArticleDocument = articleDocumentFromText as unknown as
  (input: { text: string; metadata?: Record<string, unknown> }) => any;
const tokens = (value: unknown) => encoding.encode(
  typeof value === "string" ? value : JSON.stringify(value),
).length;

async function main() {
  const fixture = "CF1-F03";
  const raw = JSON.parse(readFileSync(path.join(
    backendRoot, "test/claim-foundry/fixtures", fixture, "article.json",
  ), "utf8"));
  const source = raw.article ?? raw;
  const articleDocument = buildArticleDocument({
    text: source.text, metadata: { title: source.title, language: source.language },
  }) as any;
  const regions = deriveContentRegions(articleDocument);
  const runId = "cf6-projection-f03";
  const contentId = "cf1-f03";
  const sourceUnitManifestHash = hashValue(articleDocument.sourceUnits.map((unit: any) => ({
    unitId: unit.unitId, text: unit.text, sourceOffsets: unit.sourceOffsets,
  })));
  const persistence = new MemoryClaimFoundryPersistence();
  const persistedBudget = {
    maxToolCalls: 30, maxUnitsRead: 250, maxRepairRounds: 2, maxInputTokens: 45_000,
  };
  await persistence.create(createRunState({
    runId, contentId, contentHash: articleDocument.contentHash,
    sourceUnitManifestHash, contentRegions: regions, budgets: persistedBudget,
    traceId: null, versions: {
      instruction: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
      toolSchema: "cf6.tools.v1", model: "gpt-4.1-mini",
      code: "cf6.milestone4c.projection",
    },
  }));
  const context = { runId, contentId, articleDocument, persistence };
  const definition = createClaimFoundryAgentDefinition({
    context, model: "gpt-4.1-mini",
    runtimeBudget: CLAIM_FOUNDRY_RUNTIME_BUDGET, persistedBudget,
  });
  const originalPackage = JSON.parse(readFileSync(path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf6-agent/cf1-f03-20260727140358/final-package.json",
  ), "utf8"));
  const workingPackage = {
    ...originalPackage, runId, contentId,
    contentHash: articleDocument.contentHash, sourceUnitManifestHash,
    status: "working", packageHash: null, validationReports: [],
    audit: {
      instructionVersion: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
      toolSchemaVersion: "cf6.tools.v1", model: "gpt-4.1-mini",
      codeVersion: "cf6.milestone4c.projection",
    },
  };
  const sampleIds = regions.map(region => region.startUnitId);
  const sampleUnits = articleDocument.sourceUnits.filter((unit: any) =>
    sampleIds.includes(unit.unitId));
  const deeperUnits = articleDocument.sourceUnits.filter((_: any, index: number) =>
    index % 24 === 12).slice(0, 16);

  const rows: any[] = [];
  const historyItems: any[] = [];
  for (let turn = 1; turn <= 11; turn += 1) {
    let latestItems: any[] = [];
    if (turn === 2) {
      latestItems = exchange("get_content_map", { status: "persisted" }, "map");
    }
    if (turn === 3) {
      latestItems = exchange("read_source_units", { result: { units: sampleUnits } }, "sample");
    }
    if (turn === 4) {
      await persistence.mutate(runId, "projection_coverage", "projection-coverage", {}, state => {
        state.contentRegions = state.contentRegions.map(region => ({
          ...region, status: "sampled", sampledUnitIds: [region.startUnitId],
          candidateBearing: "likely", dispositionReason: null,
        }));
        return { state, result: {} };
      });
      latestItems = exchange("get_content_map", { status: "persisted" }, "coverage");
    }
    if (turn === 5 || turn === 7) {
      latestItems = exchange("read_source_units", { result: { units: deeperUnits } }, `deep-${turn}`);
    }
    if (turn === 6 || turn === 8) {
      await persistence.mutate(runId, `projection_save_${turn}`, `projection-save-${turn}`, {}, state => {
        state.workingPackage = structuredClone(workingPackage);
        state.status = "drafting";
        return { state, result: {} };
      });
      latestItems = exchange("save_working_package", { status: "persisted" }, `save-${turn}`);
    }
    if (turn === 9 || turn === 10) {
      await persistence.mutate(runId, `projection_validate_${turn}`, `projection-validate-${turn}`, {}, state => {
        const report = validateWorkingPackage(state.workingPackage, articleDocument, state.contentRegions);
        state.validationReports.push(report);
        state.status = "validating";
        return { state, result: {} };
      });
      latestItems = exchange("validate_working_package", { status: "persisted" }, `validate-${turn}`);
    }
    if (turn === 11) {
      await persistence.mutate(runId, "projection_terminal", "projection-terminal", {}, state => {
        state.status = "completed";
        state.finalPackageId = "CF6P-projection";
        return { state, result: {} };
      });
      latestItems = exchange("finalize_claim_package", { status: "persisted" }, "final");
    }
    historyItems.push(...latestItems);
    const decisionState = await buildClaimFoundryDecisionState(context, historyItems);
    const enabledTools = (await Promise.all(definition.tools.map(async tool => ({
      tool, enabled: await tool.isEnabled?.(),
    })))).filter(item => item.enabled).map(item => item.tool);
    const instructionTokens = tokens(definition.instructions);
    const terminalSchemaTokens = tokens(z.toJSONSchema(claimFoundryAgentCompletionSchema));
    const toolsTokens = tokens(enabledTools.map(tool => ({
      name: tool.name, description: tool.description,
      parameters: z.toJSONSchema(tool.parameters),
    })));
    const sourceTextTokens = latestItems.length && latestItems[0]?.name === undefined &&
      ["read_source_units"].includes((latestItems[0] as any)?.name)
      ? tokens(latestItems) : latestItems.some((item: any) =>
        item.type === "function_call" && item.name === "read_source_units")
        ? tokens(latestItems) : 0;
    const compactStateTokens = tokens(decisionState);
    rows.push({
      turn,
      managerInstructions: instructionTokens,
      terminalSchema: terminalSchemaTokens,
      toolsExposed: enabledTools.map(tool => tool.name),
      toolSchemaAndDescriptionTokens: toolsTokens,
      compactStatePayload: compactStateTokens,
      sourceTextPayload: sourceTextTokens,
      packageClaimPayload: tokens(decisionState.package ?? {}),
      validationPayload: tokens(decisionState.activeValidation ?? {}),
      projectedInputTokens: instructionTokens + terminalSchemaTokens +
        toolsTokens + compactStateTokens,
    });
  }
  const cumulative = rows.reduce((sum, row) => sum + row.projectedInputTokens, 0);
  const outDir = path.join(
    repositoryRoot, "artifacts/claim-foundry/cf6-agent/m4c-offline-projection",
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "projection.json"), `${JSON.stringify({
    fixture, model: "gpt-4.1-mini", turns: rows,
    instructionVersion: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
    projectedCumulativeInputTokens: cumulative,
    hardGate: 45_000, target: 30_000,
    gatePassed: cumulative <= 45_000,
    sourceUnitCount: articleDocument.sourceUnits.length,
    regionCount: regions.length,
  }, null, 2)}\n`);
  const table = rows.map(row =>
    `| ${row.turn} | ${row.managerInstructions} | ${row.terminalSchema} | ` +
    `${row.toolsExposed.join(", ")} | ${row.toolSchemaAndDescriptionTokens} | ` +
    `${row.compactStatePayload} | ${row.sourceTextPayload} | ${row.packageClaimPayload} | ` +
    `${row.validationPayload} | ${row.projectedInputTokens} |`
  ).join("\n");
  writeFileSync(path.join(outDir, "projection.md"), `# CF6 Milestone 4C offline projection

| Turn | Instructions | Terminal | Tools exposed | Tool tokens | Compact state | Source payload | Package payload | Validation | Projected input |
|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
${table}

Projected cumulative input: **${cumulative} tokens**.

Hard gate: **45,000**. Target: **approximately 30,000**. Gate: **${cumulative <= 45_000 ? "PASS" : "FAIL"}**.

This projection uses the actual F03 ArticleDocument, 33-region ledger, current versioned instructions, repository terminal schema, conditionally enabled tool schemas, compact filtered state, and exact representative source-unit text. It makes no model calls.
`);
  console.log(JSON.stringify({ outDir, cumulative, gatePassed: cumulative <= 45_000 }, null, 2));
  encoding.free();
}

function exchange(name: string, output: unknown, id: string) {
  return [
    { type: "function_call", call_id: id, name, arguments: "{}" },
    { type: "function_call_output", call_id: id, output: JSON.stringify(output) },
  ];
}

void main();
