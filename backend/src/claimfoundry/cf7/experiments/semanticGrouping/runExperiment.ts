import type {
  Cf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { SemanticGroupingForensicWriter } from "./artifacts.js";
import {
  buildSemanticGroupingUserPrompt,
  SEMANTIC_GROUPING_COMMON_RULES,
  SEMANTIC_GROUPING_PROMPTS,
} from "./prompts.js";
import { SEMANTIC_GROUPING_JSON_SCHEMA } from "./schema.js";
import type {
  SemanticGroupingAssertion,
  SemanticGroupingConfig,
  SemanticGroupingOutput,
  SemanticGroupingPromptId,
  SemanticGroupingValidation,
} from "./types.js";
import { validateSemanticGrouping } from "./validateGrouping.js";

export const SEMANTIC_GROUPING_PROMPT_IDS: SemanticGroupingPromptId[] = [
  "A", "B", "C", "D", "E", "F", "G",
];

export const DEFAULT_SEMANTIC_GROUPING_CONFIG: Readonly<
  SemanticGroupingConfig
> = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maximumConcurrency: 4,
  maxOutputTokens: 6_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false,
});

export type SemanticGroupingRunRow = {
  promptId: SemanticGroupingPromptId;
  promptText: string;
  promptHash: string;
  requestHash: string;
  output: SemanticGroupingOutput | null;
  rawOutput: unknown;
  validation: SemanticGroupingValidation;
  schemaIssues: unknown[];
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  error: { name: string; message: string } | null;
};

export type SemanticGroupingRunResult = {
  status: "completed" | "failed";
  providerCallCount: number;
  promptCount: 7;
  assertionCount: number;
  assertionInventoryHash: string;
  commonRulesHash: string;
  schemaHash: string;
  configuration: SemanticGroupingConfig;
  rows: SemanticGroupingRunRow[];
};

function failedValidation(
  assertions: SemanticGroupingAssertion[],
): SemanticGroupingValidation {
  return {
    status: "FAIL",
    assertionCount: assertions.length,
    assignedAssertionCount: 0,
    groupCount: 0,
    largestGroupSize: 0,
    smallestGroupSize: 0,
    meanGroupSize: 0,
    emptyGroupIds: [],
    duplicateGroupIds: [],
    duplicateAssertionAssignments: [],
    missingAssertionAssignments: assertions.map((row) => row.assertionId),
    inventedAssertionAssignments: [],
  };
}

export async function runSemanticGroupingExperiment(input: {
  assertions: SemanticGroupingAssertion[];
  assertionInventoryHash: string;
  provider: Cf7StructuredProvider;
  forensicWriter: SemanticGroupingForensicWriter;
  config?: SemanticGroupingConfig;
}): Promise<SemanticGroupingRunResult> {
  const config = input.config ?? DEFAULT_SEMANTIC_GROUPING_CONFIG;
  if (
    input.assertions.length !== 267
    || config.retryCount !== 0
    || config.store !== false
    || config.maximumConcurrency < 1
  ) {
    throw new Error("Invalid semantic-grouping experiment configuration");
  }
  const rows = new Array<SemanticGroupingRunRow | null>(7).fill(null);
  let cursor = 0;
  let providerCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= SEMANTIC_GROUPING_PROMPT_IDS.length) return;
      const promptId = SEMANTIC_GROUPING_PROMPT_IDS[index]!;
      const promptText = SEMANTIC_GROUPING_PROMPTS[promptId];
      const user = buildSemanticGroupingUserPrompt({
        promptId,
        assertions: input.assertions,
      });
      const request = {
        system: SEMANTIC_GROUPING_COMMON_RULES,
        user,
        responseSchema: SEMANTIC_GROUPING_JSON_SCHEMA,
        model: config.model,
        temperature: config.temperature,
        retryCount: config.retryCount,
        store: config.store,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      };
      await input.forensicWriter.beginRequest({ promptId, request });
      const startedAt = performance.now();
      try {
        providerCallCount += 1;
        const response = await input.provider.invokeStructured(request);
        const latencyMs = Math.round(performance.now() - startedAt);
        await input.forensicWriter.recordResponse({
          promptId,
          rawResponse: response.rawResponse ?? response,
          metadata: {
            promptId,
            model: response.model,
            responseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const inspected = validateSemanticGrouping({
          assertions: input.assertions,
          output: response.output,
        });
        await input.forensicWriter.recordValidation({
          promptId,
          validation: inspected.validation,
          schemaIssues: inspected.schemaIssues,
        });
        rows[index] = {
          promptId,
          promptText,
          promptHash: canonicalHash(promptText),
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
          promptId,
          error,
          metadata: {
            promptId,
            model: config.model,
            responseId: null,
            providerRequestId: null,
            usage: null,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const validation = failedValidation(input.assertions);
        await input.forensicWriter.recordValidation({
          promptId,
          validation,
          schemaIssues: [],
        });
        rows[index] = {
          promptId,
          promptText,
          promptHash: canonicalHash(promptText),
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
    {
      length: Math.min(
        config.maximumConcurrency,
        SEMANTIC_GROUPING_PROMPT_IDS.length,
      ),
    },
    () => worker(),
  ));
  if (providerCallCount !== 7) {
    throw new Error(`${providerCallCount} provider calls made; expected 7`);
  }
  const completedRows = rows.map((row, index) => {
    if (!row) throw new Error(`Missing prompt result ${index}`);
    return row;
  });
  return {
    status: completedRows.every(
      (row) => row.validation.status === "PASS",
    ) ? "completed" : "failed",
    providerCallCount,
    promptCount: 7,
    assertionCount: input.assertions.length,
    assertionInventoryHash: input.assertionInventoryHash,
    commonRulesHash: canonicalHash(SEMANTIC_GROUPING_COMMON_RULES),
    schemaHash: canonicalHash(SEMANTIC_GROUPING_JSON_SCHEMA),
    configuration: { ...config },
    rows: completedRows,
  };
}
