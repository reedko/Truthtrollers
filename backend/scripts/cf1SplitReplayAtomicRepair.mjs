// Replay atomic repair + selection + 1B from a stored split-run 1A inventory.
// The expensive whole-article 1A call is never repeated.
// Usage (backend/):
// node scripts/cf1SplitReplayAtomicRepair.mjs --source ../artifacts/.../CF1-F03-run1.json
import dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiCf1Transport } = await import("../src/claim-foundry/openAiTransport.js");
const { createOpenAiResponsesCf1Transport } = await import("../src/claim-foundry/openAiResponsesTransport.js");
const { buildSplitAtomicRepairPackets, applySplitAtomicRepairs,
  unavailableSplitAtomicRepair } = await import("../src/claim-foundry/splitAtomicRepair.js");
const { buildSplitAtomicRepairPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/splitAtomicRepairPromptV1.js");
const { collectAttributionSurface } = await import("../src/claim-foundry/attributionSurfaceCensus.js");
const { buildSplitCensusDiagnostic } = await import("../src/claim-foundry/splitCensusDiagnostic.js");
const { deriveSplitClaimBudgets } = await import("../src/claim-foundry/splitClaimBudget.js");
const { selectSplitCandidates } = await import("../src/claim-foundry/splitCandidateSelector.js");
const { assembleCall1bPackets } = await import("../src/claim-foundry/splitPacketAssembly.js");
const { buildSplitCall1bPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV1.js");
const { finalizeSplitInventory } = await import("../src/claim-foundry/splitHostFinalize.js");
const { tagCandidateGroundingSpans } = await import("../src/claim-foundry/candidateGroundingSpan.js");
const { buildModelCallProvenance } = await import("../src/claim-foundry/modelCallProvenance.js");
const { renderSplitArmHtml } = await import("../test/claim-foundry/prompt-benchmark/splitArmHtml.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

function argsOf(argv) {
  const args = { source: null, model: "gpt-4.1-mini", api: "responses", timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") args.source = argv[++index];
    else if (argv[index] === "--model") args.model = argv[++index];
    else if (argv[index] === "--api") args.api = argv[++index];
    else if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
  }
  if (!args.source) throw new Error("--source is required");
  if (!new Set(["chat", "responses"]).has(args.api)) throw new Error("--api must be chat or responses");
  return args;
}

const usageSum = (...entries) => ({
  inputTokens: entries.reduce((sum, entry) => sum + (entry?.inputTokens ?? 0), 0),
  outputTokens: entries.reduce((sum, entry) => sum + (entry?.outputTokens ?? 0), 0),
  totalTokens: entries.reduce((sum, entry) => sum + (entry?.totalTokens ?? 0), 0),
  cachedInputTokens: entries.reduce((sum, entry) => sum + (entry?.cachedInputTokens ?? 0), 0),
});

async function main() {
  const args = argsOf(process.argv.slice(2));
  const sourcePath = path.resolve(backend, args.source);
  const priorRecord = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (priorRecord.status !== "completed" || !priorRecord.result) throw new Error("source run is not completed");
  const fixtureId = priorRecord.fixtureId;
  const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures",
    fixtureId, "article.json"), "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const sourceUnits = articleDocument.sourceUnits;
  const primary = priorRecord.result.raw.call1a;
  const packetBuild = buildSplitAtomicRepairPackets({ candidateClaims: primary.candidateClaims,
    sourceUnits, structuralBlocks });
  const transport = args.api === "responses"
    ? createOpenAiResponsesCf1Transport() : createOpenAiCf1Transport();
  const runner = createCf1ModelRunner({ transport });
  const invoke = (prompt, stage) => runner.invokeStructured({ ...prompt, model: args.model,
    temperature: args.api === "responses" ? null : 0, timeoutMs: args.timeoutMs,
    maximumAttempts: 1, seed: null, maxOutputTokens: 12_000,
    usageContext: { component: "claim_foundry", path: "benchmark_replay", stage } });

  let atomicRepair; let repairedInventory = primary;
  try {
    const repairPrompt = buildSplitAtomicRepairPrompt({ inventory1a: primary,
      packets: packetBuild.packets });
    const repairCall = await invoke(repairPrompt, "semantic_inventory_1a_atomic_repair");
    const application = applySplitAtomicRepairs({ candidateClaims: primary.candidateClaims,
      packets: packetBuild.packets, repairOutput: repairCall.output });
    repairedInventory = { ...primary,
      candidateClaims: tagCandidateGroundingSpans(application.candidateClaims) };
    atomicRepair = { status: "available", packetBuild, output: repairCall.output, application,
      modelCall: buildModelCallProvenance({ prompt: repairPrompt, response: repairCall,
        request: { model: args.model, apiMode: args.api, temperature: args.api === "responses" ? null : 0,
          seed: null, stream: false, maxOutputTokens: 12_000 } }),
      usage: repairCall.usage ?? {}, attempts: repairCall.attempts ?? null };
  } catch (error) {
    atomicRepair = unavailableSplitAtomicRepair(error, packetBuild);
  }

  const censusItems = collectAttributionSurface({ sourceUnits, structuralBlocks });
  const censusDiagnostic = buildSplitCensusDiagnostic({ censusItems,
    candidateClaims: primary.candidateClaims, structuralBlocks });
  const budget = priorRecord.result.budget ?? deriveSplitClaimBudgets(article);
  const selector = selectSplitCandidates({ candidateClaims: repairedInventory.candidateClaims,
    sourceUnits, budget });
  const payload = assembleCall1bPackets({ inventory1a: { ...repairedInventory,
    candidateClaims: selector.selectedClaims }, sourceUnits, structuralBlocks, article,
  options: { includeArticleVoiceCandidates: false } });
  const call1bPrompt = buildSplitCall1bPrompt(payload);
  const call1b = await invoke(call1bPrompt, "source_posture_1b");
  const finalized = finalizeSplitInventory({ inventory1a: { ...repairedInventory,
    candidateClaims: selector.selectedClaims }, call1bOutput: call1b.output,
  packets: payload.packets, article, options: { minimumCandidates: budget.finalPortfolioMinimum,
    targetMax: budget.finalPortfolioMaximum } });

  const result = { ...priorRecord.result, inventory: finalized.inventory, selector,
    hostSignals: finalized.hostSignals, diagnostics: finalized.diagnostics,
    droppedFromSelection: finalized.droppedFromSelection,
    censusDiagnostic, censusRecovery: { status: "disabled", packetSelection: null,
      output: { candidateClaims: [] }, merge: null, modelCall: null, usage: {} },
    atomicRepair,
    raw: { ...priorRecord.result.raw, call1aWithRecovery: repairedInventory,
      call1b: call1b.output, packets: payload.packets, censusPackets: censusItems },
    modelCalls: { call1a: priorRecord.result.modelCalls.call1a,
      ...(atomicRepair.modelCall ? { atomicRepair: atomicRepair.modelCall } : {}),
      call1b: buildModelCallProvenance({ prompt: call1bPrompt, response: call1b,
        request: { model: args.model, apiMode: args.api,
          temperature: args.api === "responses" ? null : 0, seed: null,
          stream: false, maxOutputTokens: 12_000 } }) },
    usage: usageSum(atomicRepair.usage, call1b.usage),
    attempts: { call1a: "stored", atomicRepair: atomicRepair.attempts ?? null,
      call1b: call1b.attempts ?? null } };

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(path.dirname(sourcePath),
    `atomic-repair-${timestamp}-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 6)}`);
  mkdirSync(outDir, { recursive: true });
  const record = { fixtureId, repeat: priorRecord.repeat, seed: null, status: "completed",
    elapsedMs: null, result };
  writeFileSync(path.join(outDir, `${fixtureId}.json`), JSON.stringify(record, null, 2));
  writeFileSync(path.join(outDir, "report.html"), renderSplitArmHtml({
    runId: path.basename(outDir), model: `stored 1A / repair+1B ${args.model}`,
    generatedAt: new Date().toISOString(), runs: [record],
    note: `Atomic repair replay from ${sourcePath}; census diagnostic only; no 1A model call.` }));
  console.log(JSON.stringify({ outDir, report: path.join(outDir, "report.html"),
    repair: atomicRepair.application?.summary ?? { status: atomicRepair.status },
    selected: selector.selectedClaims.length, final: finalized.inventory.candidateClaims.length,
    usage: result.usage }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
