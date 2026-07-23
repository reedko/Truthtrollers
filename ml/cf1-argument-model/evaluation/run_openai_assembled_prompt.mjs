#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve("backend/.env") });
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { openAiLLM } = await import(
  "../../../backend/src/core/openAiLLM.js"
);

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const promptPath = path.resolve(option("--prompt"));
const outputDir = path.resolve(option("--output-dir"));
const model = option("--model", "gpt-4o-mini-2024-07-18");
const maxOutputTokens = Number(option("--max-output-tokens", "12000"));
const timeout = Number(option("--timeout-ms", "180000"));

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const assembled = readFileSync(promptPath, "utf8");
const userMarker = "\nARTICLE METADATA\n";
const markerIndex = assembled.indexOf(userMarker);
if (markerIndex === -1) {
  throw new Error(`Could not find ${JSON.stringify(userMarker)} in ${promptPath}`);
}

const system = assembled.slice(0, markerIndex).trim();
const user = assembled.slice(markerIndex + 1).trim();
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

mkdirSync(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const started = Date.now();

const request = {
  system,
  user,
  temperature: 0.2,
  schemaHint: "",
  model,
  timeout,
  maxRetries: 1,
  maxOutputTokens,
  returnMetadata: true,
};

try {
  const result = await openAiLLM.generate(request);
  const record = {
    status: "completed",
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    modelRequested: model,
    modelReturned: result.model,
    request: {
      system,
      user,
      temperature: request.temperature,
      responseFormat: "json_object",
      maxOutputTokens,
    },
    fingerprints: {
      systemSha256: sha256(system),
      userSha256: sha256(user),
      assembledSha256: sha256(assembled),
    },
    provider: {
      responseId: result.rawResponse?.id ?? null,
      systemFingerprint: result.rawResponse?.system_fingerprint ?? null,
      finishReason: result.rawResponse?.choices?.[0]?.finish_reason ?? null,
      usage: result.usage ?? null,
    },
    output: result.output,
    rawAssistantText: result.rawResponse?.choices?.[0]?.message?.content ?? null,
  };
  writeFileSync(
    path.join(outputDir, "result.json"),
    JSON.stringify(record, null, 2),
  );
  process.stdout.write(`${JSON.stringify({
    status: record.status,
    elapsedMs: record.elapsedMs,
    model: record.modelReturned,
    usage: record.provider.usage,
    responseId: record.provider.responseId,
    systemFingerprint: record.provider.systemFingerprint,
    outputKeys: Object.keys(record.output ?? {}),
  }, null, 2)}\n`);
} catch (error) {
  const record = {
    status: "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    modelRequested: model,
    error: {
      name: error.name,
      code: error.code ?? null,
      message: error.message,
      usage: error.usage ?? null,
      providerMetadata: error.providerMetadata ?? null,
    },
    request: {
      system,
      user,
      temperature: request.temperature,
      responseFormat: "json_object",
      maxOutputTokens,
    },
    fingerprints: {
      systemSha256: sha256(system),
      userSha256: sha256(user),
      assembledSha256: sha256(assembled),
    },
  };
  writeFileSync(
    path.join(outputDir, "result.json"),
    JSON.stringify(record, null, 2),
  );
  process.stderr.write(`${JSON.stringify(record.error, null, 2)}\n`);
  process.exitCode = 1;
}
