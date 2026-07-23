#!/usr/bin/env node

import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

dotenv.config({ path: path.resolve("backend/.env") });
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { openAiLLM } = await import(
  "../../../backend/src/core/openAiLLM.js"
);

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const inputPath = path.resolve(option("--input"));
const outputPath = path.resolve(option("--output"));
const model = option("--model", "gpt-4o-mini");
const concurrency = Number(option("--concurrency", "12"));
const maxOutputTokens = Number(option("--max-output-tokens", "1200"));
const timeout = Number(option("--timeout-ms", "180000"));
const seed = Number(option("--seed", "3724605090"));

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const rows = readFileSync(inputPath, "utf8").split("\n").filter(Boolean)
  .map((line) => JSON.parse(line));
const results = new Array(rows.length);
let nextIndex = 0;

async function worker(workerId) {
  while (true) {
    const index = nextIndex++;
    if (index >= rows.length) return;
    const row = rows[index];
    const started = Date.now();
    try {
      const result = await openAiLLM.generate({
        system: row.prompt[0].content,
        user: row.prompt[1].content,
        schemaHint: "",
        temperature: 0,
        seed,
        model,
        maxRetries: 1,
        timeout,
        maxOutputTokens,
        returnMetadata: true,
      });
      results[index] = {
        rowId: row.rowId,
        fixtureId: row.fixtureId,
        task: row.task,
        passage: row.passage,
        inputTokens: result.usage?.prompt_tokens ?? null,
        prediction: result.output,
        predictionText:
          result.rawResponse?.choices?.[0]?.message?.content
          ?? JSON.stringify(result.output),
        error: null,
        elapsedMs: Date.now() - started,
        provider: {
          requestedModel: model,
          returnedModel: result.model,
          responseId: result.rawResponse?.id ?? null,
          systemFingerprint: result.rawResponse?.system_fingerprint ?? null,
          finishReason: result.rawResponse?.choices?.[0]?.finish_reason ?? null,
          usage: result.usage ?? null,
        },
      };
      process.stdout.write(
        `[${index + 1}/${rows.length}] ${row.passage.passageId} ok `
        + `${results[index].elapsedMs}ms worker=${workerId}\n`,
      );
    } catch (error) {
      results[index] = {
        rowId: row.rowId,
        fixtureId: row.fixtureId,
        task: row.task,
        passage: row.passage,
        inputTokens: error.usage?.prompt_tokens ?? null,
        prediction: null,
        predictionText: "",
        error: `${error.code ?? error.name}:${error.message}`,
        elapsedMs: Date.now() - started,
        provider: error.providerMetadata ?? null,
      };
      process.stdout.write(
        `[${index + 1}/${rows.length}] ${row.passage.passageId} FAILED `
        + `${results[index].error}\n`,
      );
    }
  }
}

const started = Date.now();
await Promise.all(
  Array.from(
    { length: Math.min(concurrency, rows.length) },
    (_, index) => worker(index + 1),
  ),
);
writeFileSync(
  outputPath,
  `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
);

const usage = results.reduce((total, result) => {
  const item = result.provider?.usage ?? {};
  total.inputTokens += item.prompt_tokens ?? 0;
  total.outputTokens += item.completion_tokens ?? 0;
  total.totalTokens += item.total_tokens ?? 0;
  total.cachedInputTokens += item.prompt_tokens_details?.cached_tokens ?? 0;
  return total;
}, { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 });

process.stdout.write(`${JSON.stringify({
  rows: results.length,
  valid: results.filter((result) => !result.error).length,
  failed: results.filter((result) => result.error).length,
  wallMs: Date.now() - started,
  usage,
  models: [...new Set(results.map((result) =>
    result.provider?.returnedModel).filter(Boolean))],
  systemFingerprints: [...new Set(results.map((result) =>
    result.provider?.systemFingerprint).filter(Boolean))],
}, null, 2)}\n`);
