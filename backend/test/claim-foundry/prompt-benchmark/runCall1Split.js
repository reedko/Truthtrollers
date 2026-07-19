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
import { buildSplitCall1bPrompt } from "./promptSets/splitCall1bSourcePosturePromptV1.js";
import { buildSplitCall1bAttributionPrompt }
  from "./promptSets/splitCall1bSourcePosturePromptV2.js";
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
import { buildModelCallProvenance } from "../../../src/claim-foundry/modelCallProvenance.js";

const sumUsage = (a = {}, b = {}) => {
  const usage = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[key]; const right = b[key];
    usage[key] = typeof left === "number" || typeof right === "number"
      ? (left ?? 0) + (right ?? 0) : left ?? right;
  }
  return usage;
};

export async function runCall1Split({ article, structuralBlocks, sourceUnits,
  modelRunner, options = {} } = {}) {
  const arm = options.arm ?? "attribution-host-v4";
  if (!new Set(["simple-v2", "attribution-v3", "attribution-host-v4"]).has(arm)) {
    throw new Error(`Unknown split Call-1 arm: ${arm}`);
  }
  const call1aModel = options.call1aModel ?? options.model;
  const call1bModel = options.call1bModel ?? options.model;
  const apiMode = options.apiMode ?? "chat";
  const effectiveTemperature = apiMode === "responses" ? null : options.temperature ?? 0;
  const invoke = (prompt, stage) => modelRunner.invokeStructured({ ...prompt,
    model: stage === "semantic_inventory_1a" ? call1aModel : call1bModel,
    temperature: effectiveTemperature, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, seed: options.seed,
    maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall,
    usageContext: { component: "claim_foundry", path: options.path ?? "benchmark", stage } });

  // Call 1A — canonical proposition discovery from the full article.
  const budget = options.budget ?? deriveSplitClaimBudgets(article);
  const finalArticleCoverageRange = deriveFinalArticleCoverageRange({ structuralBlocks, sourceUnits });
  const call1aPrompt = arm === "attribution-v3" ? buildSplitCall1aAttributionPrompt
    : buildSplitCall1aPrompt;
  const call1bPrompt = arm === "simple-v2" ? buildSplitCall1bPrompt
    : buildSplitCall1bAttributionPrompt;
  const call1aBuiltPrompt = call1aPrompt({ article, structuralBlocks, sourceUnits });
  const call1a = await invoke(call1aBuiltPrompt, "semantic_inventory_1a");
  const modelInventory1a = { ...call1a.output,
    candidateClaims: tagCandidateGroundingSpans(call1a.output.candidateClaims ?? []) };
  const occurrenceExpansion = arm === "attribution-host-v4"
    ? expandSplitAttributedOccurrences({ candidateClaims: modelInventory1a.candidateClaims, sourceUnits })
    : { candidateClaims: modelInventory1a.candidateClaims, additions: [],
      originalCount: modelInventory1a.candidateClaims.length,
      expandedCount: modelInventory1a.candidateClaims.length };
  const inventory1a = { ...modelInventory1a, candidateClaims: occurrenceExpansion.candidateClaims };

  // Host-only census: an observation diagnostic, never a model input or recovery path.
  let censusDiagnostic;
  try {
    const censusItems = collectAttributionSurface({ sourceUnits });
    censusDiagnostic = buildSplitCensusDiagnostic({ censusItems,
      candidateClaims: inventory1a.candidateClaims });
  } catch (error) {
    censusDiagnostic = unavailableSplitCensusDiagnostic(error);
  }
  const selector = selectSplitCandidates({ candidateClaims: inventory1a.candidateClaims, sourceUnits, budget });
  const payload = assembleCall1bPackets({ inventory1a: { ...inventory1a, candidateClaims: selector.selectedClaims }, sourceUnits,
    structuralBlocks, article, options: options.packetOptions });

  // Call 1B — source/posture from packets only.
  const call1bBuiltPrompt = call1bPrompt(payload);
  const call1b = await invoke(call1bBuiltPrompt, "source_posture_1b");

  // Host: merge + classify + dedup + scoreTransform + selection.
  const finalized = finalizeSplitInventory({ inventory1a: { ...inventory1a, candidateClaims: selector.selectedClaims }, call1bOutput: call1b.output,
    packets: payload.packets,
    article, options: { ...options.finalizeOptions, minimumCandidates: budget.finalPortfolioMinimum, targetMax: budget.finalPortfolioMaximum } });

  return {
    inventory: finalized.inventory,
    arm,
    budget, selector, finalArticleCoverageRange,
    hostSignals: finalized.hostSignals,
    censusDiagnostic,
    diagnostics: finalized.diagnostics,
    droppedFromSelection: finalized.droppedFromSelection,
    raw: { call1aModel: modelInventory1a, call1a: inventory1a,
      occurrenceExpansion, call1b: call1b.output, packets: payload.packets,
      censusPackets: censusDiagnostic.packets },
    modelCalls: {
      call1a: buildModelCallProvenance({ prompt: call1aBuiltPrompt, response: call1a,
        request: { model: call1aModel, temperature: effectiveTemperature, apiMode,
          seed: options.seed, maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall } }),
      call1b: buildModelCallProvenance({ prompt: call1bBuiltPrompt, response: call1b,
        request: { model: call1bModel, temperature: effectiveTemperature, apiMode,
          seed: options.seed, maxOutputTokens: options.budgetLimits?.maxOutputTokensPerCall } }),
    },
    usage: sumUsage(call1a.usage, call1b.usage),
    attempts: { call1a: call1a.attempts ?? null, call1b: call1b.attempts ?? null },
  };
}
