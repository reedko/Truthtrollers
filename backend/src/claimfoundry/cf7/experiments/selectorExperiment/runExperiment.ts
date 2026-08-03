import type {
  Cf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { Sel1ForensicWriter } from "./artifacts.js";
import {
  buildSel1UserPrompt,
  SEL1_SELECTOR_PROMPTS,
  SEL1_SYSTEM_PROMPT,
} from "./prompts.js";
import { SEL1_JSON_SCHEMA } from "./schema.js";
import type {
  Sel1FrozenInput,
  Sel1RunResult,
  Sel1RunRow,
  Sel1SelectorId,
  Sel1Validation,
  SemanticGroupingConfig,
} from "./types.js";
import { validateSel1Output } from "./validate.js";

export const SEL1_SELECTOR_IDS: Sel1SelectorId[] = ["A", "B"];

export const DEFAULT_SEL1_CONFIG: Readonly<SemanticGroupingConfig> =
  Object.freeze({
    model: "gpt-4o-mini",
    temperature: 0.1,
    maximumConcurrency: 4,
    maxOutputTokens: 1_000,
    timeoutMs: 180_000,
    retryCount: 0,
    store: false,
  });

function requestKey(
  selectorId: Sel1SelectorId,
  groupIndex: number,
  groupId: string,
): string {
  const safeGroupId = groupId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${selectorId}-${String(groupIndex).padStart(3, "0")}-${safeGroupId}`;
}

function failedValidation(): Sel1Validation {
  return {
    status: "FAIL",
    schemaValid: false,
    groupIdMatches: false,
    selectedAssertionInGroup: false,
    atomicAssertionPresent: false,
    introducedProtectedTokens: [],
  };
}

export async function runSel1Experiment(input: {
  frozen: Sel1FrozenInput;
  provider: Cf7StructuredProvider;
  forensicWriter: Sel1ForensicWriter;
  config?: SemanticGroupingConfig;
}): Promise<Sel1RunResult> {
  const config = input.config ?? DEFAULT_SEL1_CONFIG;
  if (
    input.frozen.groupCount !== 24
    || config.retryCount !== 0
    || config.store !== false
    || config.maximumConcurrency !== 4
  ) {
    throw new Error("Invalid SEL-1 experiment configuration");
  }
  const work = SEL1_SELECTOR_IDS.flatMap((selectorId) =>
    input.frozen.groups.map((group) => ({ selectorId, group })));
  if (work.length !== 48) throw new Error("SEL-1 must schedule 48 requests");
  const rows = new Array<Sel1RunRow | null>(work.length).fill(null);
  let cursor = 0;
  let providerCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= work.length) return;
      const item = work[index]!;
      const key = requestKey(
        item.selectorId,
        item.group.groupIndex,
        item.group.groupId,
      );
      const user = buildSel1UserPrompt(item);
      const request = {
        system: SEL1_SYSTEM_PROMPT,
        user,
        responseSchema: SEL1_JSON_SCHEMA,
        model: config.model,
        temperature: config.temperature,
        retryCount: config.retryCount,
        store: config.store,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      };
      await input.forensicWriter.beginRequest({
        requestKey: key,
        request,
      });
      const startedAt = performance.now();
      try {
        providerCallCount += 1;
        const response = await input.provider.invokeStructured(request);
        const latencyMs = Math.round(performance.now() - startedAt);
        await input.forensicWriter.recordResponse({
          requestKey: key,
          rawResponse: response.rawResponse ?? response,
          metadata: {
            requestKey: key,
            selectorId: item.selectorId,
            groupId: item.group.groupId,
            groupIndex: item.group.groupIndex,
            model: response.model,
            responseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const inspected = validateSel1Output({
          group: item.group,
          output: response.output,
        });
        await input.forensicWriter.recordValidation({
          requestKey: key,
          validation: inspected.validation,
          schemaIssues: inspected.schemaIssues,
        });
        rows[index] = {
          requestKey: key,
          selectorId: item.selectorId,
          groupId: item.group.groupId,
          groupIndex: item.group.groupIndex,
          promptHash: canonicalHash(SEL1_SELECTOR_PROMPTS[item.selectorId]),
          schemaHash: canonicalHash(SEL1_JSON_SCHEMA),
          requestHash: canonicalHash(request),
          output: inspected.output,
          rawOutput: response.output,
          validation: inspected.validation,
          schemaIssues: inspected.schemaIssues,
          responseId: response.responseId,
          requestId: response.requestId,
          model: response.model,
          usage: response.usage,
          latencyMs,
          error: null,
        };
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        await input.forensicWriter.recordError({
          requestKey: key,
          error,
          metadata: {
            requestKey: key,
            selectorId: item.selectorId,
            groupId: item.group.groupId,
            groupIndex: item.group.groupIndex,
            model: config.model,
            responseId: null,
            providerRequestId: null,
            usage: null,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const validation = failedValidation();
        await input.forensicWriter.recordValidation({
          requestKey: key,
          validation,
          schemaIssues: [],
        });
        rows[index] = {
          requestKey: key,
          selectorId: item.selectorId,
          groupId: item.group.groupId,
          groupIndex: item.group.groupIndex,
          promptHash: canonicalHash(SEL1_SELECTOR_PROMPTS[item.selectorId]),
          schemaHash: canonicalHash(SEL1_JSON_SCHEMA),
          requestHash: canonicalHash(request),
          output: null,
          rawOutput: null,
          validation,
          schemaIssues: [],
          responseId: null,
          requestId: null,
          model: config.model,
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
          latencyMs,
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(config.maximumConcurrency, work.length) },
    () => worker(),
  ));
  if (providerCallCount !== 48) {
    throw new Error(`${providerCallCount} provider calls made; expected 48`);
  }
  const completedRows = rows.map((row, index) => {
    if (!row) throw new Error(`Missing SEL-1 result ${index}`);
    return row;
  });
  return {
    status: completedRows.every(
      (row) => row.validation.status === "PASS" && !row.error,
    ) ? "completed" : "failed",
    providerCallCount,
    expectedProviderCallCount: 48,
    selectorCount: 2,
    groupCount: 24,
    sourceAssertionAssignmentCount:
      input.frozen.assertionAssignmentCount,
    sourceUniqueAssertionCount: input.frozen.uniqueAssertionCount,
    sourceInputHash: input.frozen.sourceInputHash,
    promptHashes: {
      A: canonicalHash(SEL1_SELECTOR_PROMPTS.A),
      B: canonicalHash(SEL1_SELECTOR_PROMPTS.B),
    },
    schemaHash: canonicalHash(SEL1_JSON_SCHEMA),
    configuration: { ...config },
    rows: completedRows,
  };
}
