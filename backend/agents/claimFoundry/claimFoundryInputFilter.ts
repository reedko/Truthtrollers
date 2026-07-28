import type {
  CallModelInputFilter,
  AgentInputItem,
} from "@openai/agents";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import {
  CF6_ARTICLE_CONTEXT_OPEN,
} from "./claimFoundryArticleContext.js";

function parsedOutput(item: any): unknown {
  const output = item?.output;
  if (typeof output !== "string") return output ?? null;
  try { return JSON.parse(output); } catch { return output; }
}

function latestToolExchange(items: AgentInputItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const output = items[index] as any;
    if (!["function_call_output", "tool_call_output"].includes(output?.type)) continue;
    const callId = output.call_id ?? output.callId;
    const call = [...items].slice(0, index).reverse().find((candidate: any) =>
      ["function_call", "tool_call"].includes(candidate?.type) &&
      (candidate.call_id ?? candidate.callId) === callId) as any;
    return {
      name: call?.name ?? "unknown",
      output: parsedOutput(output),
    };
  }
  return null;
}

function allToolExchanges(items: AgentInputItem[]) {
  const calls = new Map<string, any>();
  const exchanges: Array<{ name: string; output: any }> = [];
  for (const item of items as any[]) {
    if (["function_call", "tool_call"].includes(item?.type)) {
      calls.set(item.call_id ?? item.callId, item);
    }
    if (["function_call_output", "tool_call_output"].includes(item?.type)) {
      const call = calls.get(item.call_id ?? item.callId);
      exchanges.push({ name: call?.name ?? "unknown", output: parsedOutput(item) });
    }
  }
  return exchanges;
}

function sourceUnits(exchange: { name: string; output: any }) {
  if (exchange.name === "read_source_units") {
    return exchange.output?.result?.units ?? exchange.output?.units ?? [];
  }
  if (exchange.name === "find_source_units") {
    return exchange.output?.result?.matches ?? exchange.output?.matches ?? [];
  }
  return [];
}

export async function buildClaimFoundryDecisionState(
  context: ClaimFoundryToolContext,
  inputItems: AgentInputItem[],
) {
  const state = await context.persistence.load(context.runId);
  if (!state) throw new Error("CF6 persisted run state is missing");
  const latest = latestToolExchange(inputItems);
  const exchanges = allToolExchanges(inputItems);
  const rawLatestSourceResult = latest?.name === "read_source_units" ? latest.output as any : null;
  const rawUnits = rawLatestSourceResult?.result?.units ?? rawLatestSourceResult?.units;
  const latestSourceResult = Array.isArray(rawUnits) ? {
    units: rawUnits.map((unit: any) => ({
      unitId: unit.unitId, order: unit.order, type: unit.type, text: unit.text,
    })),
  } : rawLatestSourceResult;
  const latestDecisionResult = latest && [
    "get_content_map", "save_working_package", "validate_working_package",
    "apply_package_patch", "finalize_claim_package",
  ].includes(latest.name)
    ? { status: "persisted; use the compact current state" }
    : latest?.output ?? null;
  const latestValidation = state.validationReports.at(-1) ?? null;
  const referencedUnitIds = new Set([
    ...(state.workingPackage?.selectedClaims.flatMap(claim => [
      ...claim.attributionUnitIds,
      ...claim.substantiveGroundingUnitIds,
      ...claim.attributionLayers.flatMap(layer => layer.unitIds),
    ]) ?? []),
    ...state.validationReports.flatMap(report =>
      report.findings.flatMap(finding => finding.sourceUnitIds)),
  ]);
  const retainedSourceReads = exchanges
    .filter(exchange => ["read_source_units", "find_source_units"].includes(exchange.name))
    .filter((exchange, index, sourceExchanges) => {
      const units = sourceUnits(exchange);
      const latestSourceIndex = sourceExchanges.length - 1;
      return index === latestSourceIndex ||
        units.some((unit: any) => !referencedUnitIds.has(unit.unitId));
    })
    .map(exchange => ({
      tool: exchange.name,
      units: sourceUnits(exchange).map((unit: any) => ({
        unitId: unit.unitId, order: unit.order, type: unit.type, text: unit.text,
      })),
    }));
  return {
    directive: "Choose the next legal ClaimFoundry action. This compact state supersedes older tool envelopes.",
    run: {
      runId: state.runId,
      contentId: state.contentId,
      status: state.status,
      remainingBudgets: {
        toolCalls: state.budgets.maxToolCalls - state.counters.toolCalls,
        unitsRead: state.budgets.maxUnitsRead - state.counters.unitsRead,
        repairRounds: state.budgets.maxRepairRounds - state.counters.repairRounds,
        inputTokens: state.budgets.maxInputTokens -
          (await context.persistence.modelRequests(state.runId))
            .reduce((sum, request) => sum + request.inputTokens, 0),
      },
    },
    coverage: {
      rowFormat: "regionId|heading|type|start-end|unitCount|status|sampledIds|candidateBearing|reason",
      rows: state.contentRegions.map(region => [
        region.regionId,
        region.heading || "-",
        region.structuralType,
        `${region.startUnitId}-${region.endUnitId}`,
        region.unitCount,
        region.status,
        region.sampledUnitIds.join(",") || "-",
        region.candidateBearing,
        region.dispositionReason || "-",
      ].join("|")),
    },
    package: state.workingPackage ? {
      selectedClaims: state.workingPackage.selectedClaims,
      dispositions: state.workingPackage.dispositions,
    } : null,
    activeValidation: latestValidation ? {
      reportId: latestValidation.reportId,
      hardPass: latestValidation.hardPass,
      findings: latestValidation.findings,
    } : null,
    pendingReviewReasons: state.pendingReviewReasons,
    retainedExactSource: retainedSourceReads,
    latestTool: latest ? {
      name: latest.name,
      result: ["read_source_units", "find_source_units"].includes(latest.name)
        ? { status: "exact result retained in retainedExactSource" }
        : latestDecisionResult,
    } : null,
    exactSourceRetention: latestSourceResult
      ? "Latest exact source text is retained. Older reads remain unless all units are referenced by persisted claims/findings."
      : "Older exact source text remains unless all units are referenced by persisted claims/findings; every unit remains rereadable.",
  };
}

export function createClaimFoundryInputFilter(
  context: ClaimFoundryToolContext,
): CallModelInputFilter {
  return async ({ modelData }) => {
    const decisionState = await buildClaimFoundryDecisionState(context, modelData.input);
    return {
      instructions: modelData.instructions,
      input: [{
        type: "message",
        role: "user",
        content: JSON.stringify(decisionState),
      }],
    };
  };
}

/**
 * Assertion-only boundary for the whole-article path. It preserves every input item
 * byte-for-byte and performs no relevance selection, summarization, or projection.
 */
export function createWholeArticleAssertionInputFilter(): CallModelInputFilter {
  let turn = 0;
  return async ({ modelData }) => {
    turn += 1;
    const serialized = JSON.stringify(modelData.input);
    const articleOccurrences = serialized.split(CF6_ARTICLE_CONTEXT_OPEN).length - 1;
    if (turn === 1 && articleOccurrences !== 1) {
      throw new Error(
        `CF6 initial client input must contain one article; found ${articleOccurrences}`,
      );
    }
    if (turn > 1 && articleOccurrences !== 0) {
      throw new Error(
        `CF6 later client input manually replayed the article on turn ${turn}`,
      );
    }
    return {
      instructions: modelData.instructions,
      input: modelData.input,
    };
  };
}
