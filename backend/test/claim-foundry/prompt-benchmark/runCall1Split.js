// Split Call-1 execution path for the arm pipeline-y-canonical-relation-split-v1.
// Chains the two model calls and every deterministic host step into one runnable
// unit that emits an object shaped exactly like cf1_semantic_inventory_v1, so the
// caller (benchmark harness or live pipeline) can drop it in where the single
// dense Call 1 used to run. Only Call 1A reads the full article; Call 1B works
// from compact host packets. No repair, no full-article resend to 1B. Lives in the
// benchmark layer (like generationRun.js) because it references promptSets/.
import { buildSplitCall1aPrompt } from "./promptSets/splitCall1aDiscoveryPromptSimpleV2.js";
import { buildSplitCall1aAttributionPrompt }
  from "./promptSets/splitCall1aDiscoveryPromptAttributionV3.js";
import { buildSplitCall1aAtomicityPrompt }
  from "./promptSets/splitCall1aDiscoveryPromptAtomicityV1.js";
import { buildSplitCall1aClaimLanguagePrompt }
  from "./promptSets/splitCall1aDiscoveryPromptClaimLanguageV3.js";
import { buildSplitCall1aWorkPadPrompt }
  from "./promptSets/splitCall1aDiscoveryPromptWorkPadV0.js";
import { buildSplitCall1bPrompt } from "./promptSets/splitCall1bSourcePosturePromptV1.js";
import { buildSplitCall1bAttributionPrompt }
  from "./promptSets/splitCall1bSourcePosturePromptV2.js";
import { buildSplitAtomicRepairPrompt }
  from "./promptSets/splitAtomicRepairPromptV1.js";
import { tagCandidateGroundingSpans } from "../../../src/claim-foundry/candidateGroundingSpan.js";
import { collectAttributionSurface } from "../../../src/claim-foundry/attributionSurfaceCensus.js";
import { assembleCall1bPackets } from "../../../src/claim-foundry/splitPacketAssembly.js";
import { finalizeSplitInventory } from "../../../src/claim-foundry/splitHostFinalize.js";
import { deriveSplitClaimBudgets } from "../../../src/claim-foundry/splitClaimBudget.js";
import { selectSplitCandidates } from "../../../src/claim-foundry/splitCandidateSelector.js";
import { expandSplitAttributedOccurrences }
  from "../../../src/claim-foundry/splitAttributedOccurrenceExpansion.js";
import { deriveFinalArticleCoverageRange } from "../../../src/claim-foundry/finalArticleCoverageRange.js";
import { buildSplitCensusDiagnostic, unavailableSplitCensusDiagnostic } from "../../../src/claim-foundry/splitCensusDiagnostic.js";
import { buildSplitAtomicRepairPackets, applySplitAtomicRepairs,
  unavailableSplitAtomicRepair } from "../../../src/claim-foundry/splitAtomicRepair.js";
import { buildModelCallProvenance } from "../../../src/claim-foundry/modelCallProvenance.js";

const sumUsage = (...entries) => {
  const usage = {};
  const objects = entries.filter(Boolean);
  for (const key of new Set(objects.flatMap((entry) => Object.keys(entry)))) {
    const values = objects.map((entry) => entry[key]).filter((value) => value != null);
    usage[key] = values.some((value) => typeof value === "number")
      ? values.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0)
      : values[0];
  }
  return usage;
};

export async function runCall1Split({ article, structuralBlocks, sourceUnits,
  modelRunner, modelRunners = {}, options = {} } = {}) {
  const arm = options.arm ?? "attribution-host-v4";
  if (!new Set(["simple-v2", "attribution-v3", "attribution-host-v4",
    "atomicity-trace-v1", "workpad-v0", "simple-v2-expanded-v1",
    "simple-v3-claim-language-v1"]).has(arm)) {
    throw new Error(`Unknown split Call-1 arm: ${arm}`);
  }
  const call1aModel = options.call1aModel ?? options.model;
  const call1bModel = options.call1bModel ?? options.model;
  const call1aApiMode = options.call1aApiMode ?? options.apiMode ?? "chat";
  const call1bApiMode = options.call1bApiMode ?? options.apiMode ?? "chat";
  const atomicRepairModel = options.atomicRepairModel ?? call1bModel;
  const atomicRepairApiMode = options.atomicRepairApiMode ?? call1bApiMode;
  const stageSettings = (stage) => {
    const is1a = stage === "semantic_inventory_1a";
    const isAtomicRepair = stage === "semantic_inventory_1a_atomic_repair";
    const apiMode = is1a ? call1aApiMode : isAtomicRepair ? atomicRepairApiMode : call1bApiMode;
    return {
      apiMode,
      modelRunner: is1a ? (modelRunners.call1a ?? modelRunner)
        : isAtomicRepair ? (modelRunners.atomicRepair ?? modelRunners.call1b ?? modelRunner)
          : (modelRunners.call1b ?? modelRunner),
      temperature: apiMode === "responses" ? null : options.temperature ?? 0,
      seed: apiMode === "chat" ? options.seed : null,
    };
  };
  const invoke = (prompt, stage) => {
    const settings = stageSettings(stage);
    return settings.modelRunner.invokeStructured({ ...prompt,
    model: stage === "source_posture_1b" ? call1bModel
      : stage === "semantic_inventory_1a_atomic_repair" ? atomicRepairModel : call1aModel,
    temperature: settings.temperature, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, seed: settings.seed,
    maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall,
    usageContext: { component: "claim_foundry", path: options.path ?? "benchmark", stage } });
  };

  // Call 1A — canonical proposition discovery from the full article.
  const budget = options.budget ?? deriveSplitClaimBudgets(article);
  const finalArticleCoverageRange = deriveFinalArticleCoverageRange({ structuralBlocks, sourceUnits });
  const call1aPrompt = arm === "attribution-v3" ? buildSplitCall1aAttributionPrompt
    : arm === "atomicity-trace-v1" ? buildSplitCall1aAtomicityPrompt
      : arm === "simple-v3-claim-language-v1" ? buildSplitCall1aClaimLanguagePrompt
      : arm === "workpad-v0" ? buildSplitCall1aWorkPadPrompt
        : buildSplitCall1aPrompt;
  const call1bPrompt = new Set(["simple-v2", "simple-v2-expanded-v1",
    "simple-v3-claim-language-v1"]).has(arm)
    ? buildSplitCall1bPrompt
    : buildSplitCall1bAttributionPrompt;
  const call1aBuiltPrompt = call1aPrompt({ article, structuralBlocks, sourceUnits });
  const call1a = await invoke(call1aBuiltPrompt, "semantic_inventory_1a");
  const modelInventory1a = { ...call1a.output,
    candidateClaims: tagCandidateGroundingSpans(call1a.output.candidateClaims ?? []) };
  const occurrenceExpansion = new Set(["attribution-host-v4", "atomicity-trace-v1",
    "workpad-v0", "simple-v2-expanded-v1", "simple-v3-claim-language-v1"]).has(arm)
    ? expandSplitAttributedOccurrences({ candidateClaims: modelInventory1a.candidateClaims, sourceUnits })
    : { candidateClaims: modelInventory1a.candidateClaims, additions: [],
      originalCount: modelInventory1a.candidateClaims.length,
      expandedCount: modelInventory1a.candidateClaims.length };
  const inventory1a = { ...modelInventory1a, candidateClaims: occurrenceExpansion.candidateClaims };

  // Host-only census diagnostic. It is observation only: it cannot feed a model,
  // add or alter claims, affect selection, or block either model call.
  let censusDiagnostic;
  try {
    const censusItems = collectAttributionSurface({ sourceUnits, structuralBlocks });
    censusDiagnostic = buildSplitCensusDiagnostic({ censusItems,
      candidateClaims: inventory1a.candidateClaims, structuralBlocks });
  } catch (error) {
    censusDiagnostic = unavailableSplitCensusDiagnostic(error);
  }
  let censusRecovery = { status: "disabled", packetSelection: null,
    output: { candidateClaims: [] }, merge: null, modelCall: null, usage: {} };
  let inventoryForSelection = inventory1a;
  let atomicRepair = { status: "disabled", packetBuild: null,
    output: { candidateRepairs: [] }, application: null, modelCall: null, usage: {} };
  if (options.atomicRepair === true) {
    const packetBuild = buildSplitAtomicRepairPackets({
      candidateClaims: inventoryForSelection.candidateClaims, sourceUnits, structuralBlocks });
    if (packetBuild.packets.length) {
      try {
        const repairBuiltPrompt = buildSplitAtomicRepairPrompt({ inventory1a: inventoryForSelection,
          packets: packetBuild.packets });
        const repairCall = await invoke(repairBuiltPrompt, "semantic_inventory_1a_atomic_repair");
        const application = applySplitAtomicRepairs({
          candidateClaims: inventoryForSelection.candidateClaims,
          packets: packetBuild.packets, repairOutput: repairCall.output });
        inventoryForSelection = { ...inventoryForSelection,
          candidateClaims: tagCandidateGroundingSpans(application.candidateClaims) };
        atomicRepair = { status: "available", packetBuild, output: repairCall.output,
          application,
          modelCall: buildModelCallProvenance({ prompt: repairBuiltPrompt,
            response: repairCall, request: { model: atomicRepairModel,
              temperature: stageSettings("semantic_inventory_1a_atomic_repair").temperature,
              apiMode: atomicRepairApiMode,
              seed: stageSettings("semantic_inventory_1a_atomic_repair").seed,
              stream: false,
              maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall } }),
          usage: repairCall.usage ?? {}, attempts: repairCall.attempts ?? null };
      } catch (error) {
        atomicRepair = unavailableSplitAtomicRepair(error, packetBuild);
      }
    } else {
      atomicRepair = { status: "not_needed", packetBuild,
        output: { candidateRepairs: [] }, application: null, modelCall: null, usage: {} };
    }
  }
  const selector = selectSplitCandidates({ candidateClaims: inventoryForSelection.candidateClaims, sourceUnits, budget });
  const payload = assembleCall1bPackets({ inventory1a: { ...inventoryForSelection, candidateClaims: selector.selectedClaims }, sourceUnits,
    structuralBlocks, article, options: options.packetOptions });

  // Call 1B — source/posture from packets only.
  const call1bBuiltPrompt = call1bPrompt(payload);
  const call1b = await invoke(call1bBuiltPrompt, "source_posture_1b");

  // Host: merge + classify + dedup + scoreTransform + selection.
  const finalized = finalizeSplitInventory({ inventory1a: { ...inventoryForSelection, candidateClaims: selector.selectedClaims }, call1bOutput: call1b.output,
    packets: payload.packets,
    article, options: { ...options.finalizeOptions, minimumCandidates: budget.finalPortfolioMinimum, targetMax: budget.finalPortfolioMaximum } });

  return {
    inventory: finalized.inventory,
    arm,
    budget, selector, finalArticleCoverageRange,
    hostSignals: finalized.hostSignals,
    censusDiagnostic,
    censusRecovery,
    atomicRepair,
    diagnostics: finalized.diagnostics,
    droppedFromSelection: finalized.droppedFromSelection,
    raw: { call1aModel: modelInventory1a, call1a: inventory1a,
      call1aWithRecovery: inventoryForSelection,
      occurrenceExpansion, call1b: call1b.output, packets: payload.packets,
      censusPackets: censusDiagnostic.packets },
    modelCalls: {
      call1a: buildModelCallProvenance({ prompt: call1aBuiltPrompt, response: call1a,
        request: { model: call1aModel, temperature: stageSettings("semantic_inventory_1a").temperature,
          apiMode: call1aApiMode, seed: stageSettings("semantic_inventory_1a").seed,
          stream: options.call1aStreaming === true,
          maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall } }),
      call1b: buildModelCallProvenance({ prompt: call1bBuiltPrompt, response: call1b,
        request: { model: call1bModel, temperature: stageSettings("source_posture_1b").temperature,
          apiMode: call1bApiMode, seed: stageSettings("source_posture_1b").seed,
          stream: false,
          maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall } }),
      ...(atomicRepair.modelCall ? { atomicRepair: atomicRepair.modelCall } : {}),
    },
    usage: sumUsage(call1a.usage, atomicRepair.usage, call1b.usage),
    attempts: { call1a: call1a.attempts ?? null,
      censusRecovery: censusRecovery.attempts ?? null,
      atomicRepair: atomicRepair.attempts ?? null, call1b: call1b.attempts ?? null },
  };
}
