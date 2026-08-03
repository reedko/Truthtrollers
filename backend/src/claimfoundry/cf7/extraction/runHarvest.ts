import type {
  Cf7StructuredModelResponse,
  Cf7StructuredProvider,
} from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import type { Cf7Chunk, Cf7SourceUnit } from "../types/index.js";
import {
  buildCf7HarvestUserPrompt,
  CF7_HARVEST_SYSTEM_PROMPT,
} from "./prompt.js";
import {
  cf7HarvestResultSchema,
  CF7_HARVEST_JSON_SCHEMA,
} from "./schema.js";
import {
  validateHarvestGrounding,
  type Cf7AcceptedHarvestRow,
  type Cf7HarvestFinding,
} from "./validateHarvest.js";

export type Cf7HarvestConfig = {
  model: string;
  maximumConcurrency: number;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature: number;
  retryCount: number;
  store: false;
  seed?: number;
};

export const DEFAULT_CF7_HARVEST_CONFIG: Readonly<Cf7HarvestConfig> =
  Object.freeze({
    model: "gpt-4o-mini",
    maximumConcurrency: 4,
    maxOutputTokens: 4_000,
    timeoutMs: 180_000,
    temperature: 0.2,
    retryCount: 0,
    store: false,
  });

export type Cf7HarvestRequestAccounting = {
  chunkId: string;
  status: "completed" | "failed";
  model: string;
  responseId: string | null;
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
};

export type Cf7ChunkHarvestResult = {
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  status: "completed" | "failed";
  rawOutput: unknown;
  acceptedRows: Cf7AcceptedHarvestRow[];
  findings: Cf7HarvestFinding[];
  promptHash: string;
  accounting: Cf7HarvestRequestAccounting;
  error: { name: string; message: string } | null;
};

export type Cf7HarvestInventoryRow = Cf7AcceptedHarvestRow & {
  harvestRowId: string;
  chunkId: string;
  chunkIndex: number;
};

export type Cf7HarvestRunResult = {
  status: "completed" | "failed";
  expectedHarvestCallCount: number;
  harvestCallCount: number;
  chunkResults: Cf7ChunkHarvestResult[];
  inventory: Cf7HarvestInventoryRow[];
  findings: Cf7HarvestFinding[];
  accounting: {
    requestCount: number;
    completedRequestCount: number;
    failedRequestCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
  promptHash: string;
  schemaHash: string;
};

function validateConfig(config: Cf7HarvestConfig): void {
  if (
    !config.model.trim()
    || !Number.isInteger(config.maximumConcurrency)
    || config.maximumConcurrency < 1
    || config.maximumConcurrency > 32
    || !Number.isInteger(config.maxOutputTokens)
    || config.maxOutputTokens < 1
    || !Number.isInteger(config.timeoutMs)
    || config.timeoutMs < 1
    || !Number.isFinite(config.temperature)
    || config.temperature < 0
    || config.temperature > 2
    || !Number.isInteger(config.retryCount)
    || config.retryCount < 0
    || config.retryCount > 3
    || config.store !== false
  ) {
    throw new Cf7Error(
      "CF7_INVALID_HARVEST_CONFIG",
      "Invalid CF7 harvest configuration",
    );
  }
}

function failedAccounting(
  chunkId: string,
  config: Cf7HarvestConfig,
  latencyMs: number,
  error: unknown,
): Cf7HarvestRequestAccounting {
  const usage = error && typeof error === "object" && "usage" in error
    ? (error.usage as Record<string, unknown> | undefined)
    : undefined;
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
  const outputTokens = Number(
    usage?.completion_tokens ?? usage?.output_tokens ?? 0,
  ) || 0;
  return {
    chunkId,
    status: "failed",
    model: config.model,
    responseId: null,
    requestId: null,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    totalTokens: Number(usage?.total_tokens ?? inputTokens + outputTokens)
      || inputTokens + outputTokens,
    latencyMs,
  };
}

function completedAccounting(
  chunkId: string,
  response: Cf7StructuredModelResponse,
  latencyMs: number,
): Cf7HarvestRequestAccounting {
  return {
    chunkId,
    status: "completed",
    model: response.model,
    responseId: response.responseId,
    requestId: response.requestId,
    ...response.usage,
    latencyMs,
  };
}

export async function runCf7Harvest(input: {
  chunks: Cf7Chunk[];
  units: Cf7SourceUnit[];
  provider: Cf7StructuredProvider;
  config?: Cf7HarvestConfig;
}): Promise<Cf7HarvestRunResult> {
  const config = input.config ?? DEFAULT_CF7_HARVEST_CONFIG;
  validateConfig(config);
  const results = new Array<Cf7ChunkHarvestResult>(input.chunks.length);
  let cursor = 0;
  let harvestCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= input.chunks.length) return;
      const chunk = input.chunks[index]!;
      const user = buildCf7HarvestUserPrompt(chunk, input.units);
      const promptHash = canonicalHash({
        system: CF7_HARVEST_SYSTEM_PROMPT,
        user,
      });
      harvestCallCount += 1;
      const startedAt = performance.now();
      try {
        const response = await input.provider.invokeStructured({
          system: CF7_HARVEST_SYSTEM_PROMPT,
          user,
          responseSchema: CF7_HARVEST_JSON_SCHEMA,
          model: config.model,
          temperature: config.temperature,
          retryCount: config.retryCount,
          store: config.store,
          ...(config.seed === undefined ? {} : { seed: config.seed }),
          maxOutputTokens: config.maxOutputTokens,
          timeoutMs: config.timeoutMs,
        });
        const output = cf7HarvestResultSchema.parse(response.output);
        const validated = validateHarvestGrounding({
          chunkId: chunk.chunkId,
          chunkUnitIds: chunk.unitIds,
          output,
        });
        results[index] = {
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          status: "completed",
          rawOutput: output,
          acceptedRows: validated.acceptedRows,
          findings: validated.findings,
          promptHash,
          accounting: completedAccounting(
            chunk.chunkId,
            response,
            Math.round(performance.now() - startedAt),
          ),
          error: null,
        };
      } catch (error) {
        results[index] = {
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          status: "failed",
          rawOutput: null,
          acceptedRows: [],
          findings: [],
          promptHash,
          accounting: failedAccounting(
            chunk.chunkId,
            config,
            Math.round(performance.now() - startedAt),
            error,
          ),
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
      length: Math.min(config.maximumConcurrency, input.chunks.length),
    },
    () => worker(),
  ));
  if (harvestCallCount !== input.chunks.length) {
    throw new Cf7Error(
      "CF7_HARVEST_CALL_COUNT_MISMATCH",
      `${harvestCallCount} harvest calls were scheduled for ${input.chunks.length} chunks`,
    );
  }

  const inventory = results.flatMap((result) =>
    result.acceptedRows.map((row) => ({
      ...row,
      harvestRowId: "",
      chunkId: result.chunkId,
      chunkIndex: result.chunkIndex,
    }))).map((row, index) => ({
      ...row,
      harvestRowId: `H${String(index + 1).padStart(4, "0")}`,
    }));
  const findings = results.flatMap((result) => result.findings);
  const accountingRows = results.map((result) => result.accounting);
  const failedRequestCount = accountingRows.filter(
    (row) => row.status === "failed",
  ).length;
  return {
    status: failedRequestCount === 0 ? "completed" : "failed",
    expectedHarvestCallCount: input.chunks.length,
    harvestCallCount,
    chunkResults: results,
    inventory,
    findings,
    accounting: {
      requestCount: accountingRows.length,
      completedRequestCount: accountingRows.length - failedRequestCount,
      failedRequestCount,
      inputTokens: accountingRows.reduce((sum, row) => sum + row.inputTokens, 0),
      cachedInputTokens: accountingRows.reduce(
        (sum, row) => sum + row.cachedInputTokens,
        0,
      ),
      outputTokens: accountingRows.reduce((sum, row) => sum + row.outputTokens, 0),
      totalTokens: accountingRows.reduce((sum, row) => sum + row.totalTokens, 0),
      latencyMs: accountingRows.reduce((sum, row) => sum + row.latencyMs, 0),
    },
    promptHash: canonicalHash(CF7_HARVEST_SYSTEM_PROMPT),
    schemaHash: canonicalHash(CF7_HARVEST_JSON_SCHEMA),
  };
}
