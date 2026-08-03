import type {
  Cf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { SEMANTIC_GROUPING_COMMON_RULES } from "../semanticGrouping/prompts.js";
import type {
  Gde2ExperimentId,
  Gde2PromptId,
  Gde2RunResult,
  Gde2RunRow,
  Gde2Validation,
  Gde2VariantId,
  SemanticGroupingAssertion,
  SemanticGroupingConfig,
} from "./types.js";
import { Gde2ForensicWriter } from "./artifacts.js";
import {
  buildGde2Instruction,
  buildGde2UserPrompt,
  GDE2_REPRESENTATIVE_ADDITIONS,
  getGde2OriginalPrompt,
} from "./prompts.js";
import { GDE2_JSON_SCHEMAS } from "./schema.js";
import { validateGde2Output } from "./validate.js";

export const GDE2_EXPERIMENTS: ReadonlyArray<{
  experimentId: Gde2ExperimentId;
  promptId: Gde2PromptId;
  variantId: Gde2VariantId;
}> = Object.freeze([
  { experimentId: "G-A", promptId: "G", variantId: "A" },
  { experimentId: "G-B", promptId: "G", variantId: "B" },
  { experimentId: "G-C", promptId: "G", variantId: "C" },
  { experimentId: "D-A", promptId: "D", variantId: "A" },
  { experimentId: "D-B", promptId: "D", variantId: "B" },
  { experimentId: "D-C", promptId: "D", variantId: "C" },
  { experimentId: "E-A", promptId: "E", variantId: "A" },
  { experimentId: "E-B", promptId: "E", variantId: "B" },
  { experimentId: "E-C", promptId: "E", variantId: "C" },
]);

export const DEFAULT_GDE2_CONFIG: Readonly<SemanticGroupingConfig> =
  Object.freeze({
    model: "gpt-4o-mini",
    temperature: 0.1,
    maximumConcurrency: 4,
    maxOutputTokens: 6_000,
    timeoutMs: 180_000,
    retryCount: 0,
    store: false,
  });

function failedValidation(
  assertions: SemanticGroupingAssertion[],
): Gde2Validation {
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
    invalidRepresentativeGroupIds: [],
    selectedRepresentativeOutsideGroup: [],
  };
}

export async function runGde2Experiment(input: {
  assertions: SemanticGroupingAssertion[];
  assertionInventoryHash: string;
  provider: Cf7StructuredProvider;
  forensicWriter: Gde2ForensicWriter;
  config?: SemanticGroupingConfig;
}): Promise<Gde2RunResult> {
  const config = input.config ?? DEFAULT_GDE2_CONFIG;
  if (
    input.assertions.length !== 267
    || config.retryCount !== 0
    || config.store !== false
    || config.maximumConcurrency !== 4
  ) {
    throw new Error("Invalid GDE-2 experiment configuration");
  }
  const rows = new Array<Gde2RunRow | null>(GDE2_EXPERIMENTS.length).fill(null);
  let cursor = 0;
  let providerCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= GDE2_EXPERIMENTS.length) return;
      const experiment = GDE2_EXPERIMENTS[index]!;
      const originalPromptText = getGde2OriginalPrompt(experiment.promptId);
      const representativeAddition =
        GDE2_REPRESENTATIVE_ADDITIONS[experiment.variantId];
      const combinedInstruction = buildGde2Instruction(experiment);
      const user = buildGde2UserPrompt({
        ...experiment,
        assertions: input.assertions,
      });
      const responseSchema = GDE2_JSON_SCHEMAS[experiment.variantId];
      const request = {
        system: SEMANTIC_GROUPING_COMMON_RULES,
        user,
        responseSchema,
        model: config.model,
        temperature: config.temperature,
        retryCount: config.retryCount,
        store: config.store,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      };
      await input.forensicWriter.beginRequest({
        experimentId: experiment.experimentId,
        request,
      });
      const startedAt = performance.now();
      try {
        providerCallCount += 1;
        const response = await input.provider.invokeStructured(request);
        const latencyMs = Math.round(performance.now() - startedAt);
        await input.forensicWriter.recordResponse({
          experimentId: experiment.experimentId,
          rawResponse: response.rawResponse ?? response,
          metadata: {
            experimentId: experiment.experimentId,
            promptId: experiment.promptId,
            variantId: experiment.variantId,
            model: response.model,
            responseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const inspected = validateGde2Output({
          assertions: input.assertions,
          variantId: experiment.variantId,
          output: response.output,
        });
        await input.forensicWriter.recordValidation({
          experimentId: experiment.experimentId,
          validation: inspected.validation,
          schemaIssues: inspected.schemaIssues,
        });
        rows[index] = {
          ...experiment,
          originalPromptText,
          representativeAddition,
          combinedPromptHash: canonicalHash(combinedInstruction),
          schemaHash: canonicalHash(responseSchema),
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
          experimentId: experiment.experimentId,
          error,
          metadata: {
            experimentId: experiment.experimentId,
            promptId: experiment.promptId,
            variantId: experiment.variantId,
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
          experimentId: experiment.experimentId,
          validation,
          schemaIssues: [],
        });
        rows[index] = {
          ...experiment,
          originalPromptText,
          representativeAddition,
          combinedPromptHash: canonicalHash(combinedInstruction),
          schemaHash: canonicalHash(responseSchema),
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
    { length: Math.min(config.maximumConcurrency, GDE2_EXPERIMENTS.length) },
    () => worker(),
  ));
  if (providerCallCount !== 9) {
    throw new Error(`${providerCallCount} provider calls made; expected 9`);
  }
  const completedRows = rows.map((row, index) => {
    if (!row) throw new Error(`Missing GDE-2 result ${index}`);
    return row;
  });
  return {
    status: completedRows.every(
      (row) => row.validation.status === "PASS" && !row.error,
    ) ? "completed" : "failed",
    providerCallCount,
    promptCount: 9,
    assertionCount: input.assertions.length,
    assertionInventoryHash: input.assertionInventoryHash,
    commonRulesHash: canonicalHash(SEMANTIC_GROUPING_COMMON_RULES),
    configuration: { ...config },
    rows: completedRows,
  };
}
