import type {
  Cf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { GOnlyForensicWriter } from "./artifacts.js";
import {
  buildGOnlySelectorUserPrompt,
  G_ONLY_SELECTOR_PROMPT,
} from "./prompt.js";
import {
  G_ONLY_SELECTOR_JSON_SCHEMA,
  gOnlySelectorOutputSchema,
} from "./schema.js";
import type {
  GOnlyFrozenInput,
  GOnlyRunResult,
  GOnlyRunRow,
  SemanticGroupingConfig,
} from "./types.js";

export const DEFAULT_G_ONLY_SELECTOR_CONFIG: Readonly<
  SemanticGroupingConfig
> = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maximumConcurrency: 4,
  maxOutputTokens: 1_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false,
});

function requestKey(groupIndex: number, groupId: string): string {
  return `${String(groupIndex).padStart(3, "0")}-${groupId.replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  )}`;
}

export async function runGOnlySelectorExperiment(input: {
  frozen: GOnlyFrozenInput;
  provider: Cf7StructuredProvider;
  forensicWriter: GOnlyForensicWriter;
  config?: SemanticGroupingConfig;
}): Promise<GOnlyRunResult> {
  const config = input.config ?? DEFAULT_G_ONLY_SELECTOR_CONFIG;
  if (
    input.frozen.groupCount !== 21
    || config.maximumConcurrency !== 4
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Error("Invalid G-only selector configuration");
  }
  const rows = new Array<GOnlyRunRow | null>(21).fill(null);
  let cursor = 0;
  let providerCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= input.frozen.groups.length) return;
      const group = input.frozen.groups[index]!;
      const key = requestKey(group.groupIndex, group.groupId);
      const request = {
        system: "",
        user: buildGOnlySelectorUserPrompt(group),
        responseSchema: G_ONLY_SELECTOR_JSON_SCHEMA,
        model: config.model,
        temperature: config.temperature,
        retryCount: config.retryCount,
        store: config.store,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      };
      await input.forensicWriter.beginRequest({ requestKey: key, request });
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
            groupId: group.groupId,
            groupIndex: group.groupIndex,
            model: response.model,
            responseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const parsed = gOnlySelectorOutputSchema.safeParse(response.output);
        const structurallyValid = parsed.success
          && group.assertionIds.includes(parsed.data.selectedAssertionId);
        rows[index] = {
          requestKey: key,
          groupId: group.groupId,
          groupIndex: group.groupIndex,
          requestHash: canonicalHash(request),
          output: parsed.success ? parsed.data : null,
          rawOutput: response.output,
          structurallyValid,
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
            groupId: group.groupId,
            groupIndex: group.groupIndex,
            model: config.model,
            responseId: null,
            providerRequestId: null,
            usage: null,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        rows[index] = {
          requestKey: key,
          groupId: group.groupId,
          groupIndex: group.groupIndex,
          requestHash: canonicalHash(request),
          output: null,
          rawOutput: null,
          structurallyValid: false,
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
    { length: Math.min(config.maximumConcurrency, 21) },
    () => worker(),
  ));
  if (providerCallCount !== 21) {
    throw new Error(`${providerCallCount} provider calls made; expected 21`);
  }
  const completedRows = rows.map((row, index) => {
    if (!row) throw new Error(`Missing G-only selector row ${index}`);
    return row;
  });
  const selections = input.frozen.groups.map((group, index) => {
    const row = completedRows[index]!;
    const selectedAssertionId = row.structurallyValid
      ? row.output!.selectedAssertionId
      : null;
    return {
      groupId: group.groupId,
      assertionIds: [...group.assertionIds],
      selectedAssertionId,
      selectedAssertionText: selectedAssertionId
        ? group.assertions.find(
          (assertion) => assertion.assertionId === selectedAssertionId,
        )!.assertionText
        : null,
      structurallyValid: row.structurallyValid,
    };
  });
  return {
    status: completedRows.every(
      (row) => !row.error && row.structurallyValid,
    ) ? "completed" : "failed",
    providerCallCount,
    expectedProviderCallCount: 21,
    configuration: { ...config },
    rows: completedRows,
    selections,
  };
}

export const G_ONLY_PROMPT_HASH = canonicalHash(G_ONLY_SELECTOR_PROMPT);
export const G_ONLY_SCHEMA_HASH = canonicalHash(G_ONLY_SELECTOR_JSON_SCHEMA);
