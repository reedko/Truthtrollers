// Isolated Call 1A Chat Completions streaming probe. It uses the preserved
// Simple V2 prompt/schema but never enters Call 1B or the normal CF1 transport.
// Its purpose is to determine whether repeated claimText values can serve as an
// early, client-observable signal of a degenerate generation loop.
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { buildSplitCall1aPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptSimpleV2.js");
const { createOpenAiStreamingCf1Transport } = await import(
  "../test/claim-foundry/prompt-benchmark/openAiStreamingTransport.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");
const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini", threshold: 3,
    maxOutputTokens: 12_000, timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--threshold") options.threshold = Number(argv[++index]);
    else if (arg === "--max-output-tokens") options.maxOutputTokens = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", options.fixture, "article.json");
  const raw = JSON.parse(readFileSync(fixturePath));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const prompt = buildSplitCall1aPrompt({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits });
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const runId = `call1a-stream-probe-${timestamp}-${sha256(Date.now()).slice(0, 6)}`;
  const outDir = path.join(repoRoot, "artifacts/claim-foundry/streaming-probe", runId);
  mkdirSync(outDir, { recursive: true });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();
  console.log(`Streaming ${options.fixture} Call 1A with ${options.model}; repetition threshold ${options.threshold}`);
  const transport = createOpenAiStreamingCf1Transport({
    repetitionThreshold: options.threshold,
    onClaim: (claim) => console.log(`  claim ${claim.ordinal} · ${claim.observedAtMs} ms${claim.count > 1 ? ` · repeat ${claim.count}` : ""}: ${claim.claimText}`),
  });
  let result;
  try {
    const response = await transport.invoke({ ...prompt, model: options.model,
      temperature: 0, maxOutputTokens: options.maxOutputTokens,
      signal: controller.signal,
    });
    const diagnostics = response.rawResponse.streamingDiagnostics;
    result = { status: "completed", elapsedMs: Date.now() - startedAt,
      provider: { responseId: response.rawResponse.id, model: response.rawResponse.model,
        systemFingerprint: response.rawResponse.system_fingerprint },
      finishReason: response.rawResponse.choices?.[0]?.finish_reason ?? null,
      usage: response.usage, requestId: response.rawResponse.request_id,
      claimsObserved: diagnostics.claimsObserved,
      repetition: diagnostics.repetition,
      outputCharacters: diagnostics.outputCharacters,
      output: response.output };
  } catch (error) {
    const diagnostics = error.providerMetadata?.streamingDiagnostics;
    result = { status: error.code === "CF1_MODEL_REPETITION_LOOP"
      ? "aborted_repetition" : controller.signal.aborted ? "aborted" : "failed",
    elapsedMs: Date.now() - startedAt,
    claimsObserved: diagnostics?.claimsObserved ?? [], repetition: diagnostics?.repetition ?? null,
    outputCharacters: diagnostics?.outputCharacters ?? 0,
    error: { name: error.name, code: error.code ?? null, message: error.message,
      providerMetadata: error.providerMetadata ?? null } };
  } finally {
    clearTimeout(timeout);
  }
  const artifact = { runId, generatedAt: new Date().toISOString(), fixture: options.fixture,
    model: options.model, threshold: options.threshold,
    request: { maxOutputTokens: options.maxOutputTokens,
      schemaMaxItems: prompt.responseSchema.schema.properties.candidateClaims.maxItems,
      systemSha256: sha256(prompt.system), userSha256: sha256(prompt.user),
      schemaSha256: sha256(JSON.stringify(prompt.responseSchema)) },
    result };
  writeFileSync(path.join(outDir, "result.json"), JSON.stringify(artifact, null, 2));
  console.log(`${result.status} · ${result.claimsObserved?.length ?? 0} claimText values · ${result.elapsedMs} ms`);
  if (result.repetition) console.log(`Loop signal: ${JSON.stringify(result.repetition)}`);
  console.log(`Artifact: ${path.join(outDir, "result.json")}`);
  if (result.status === "failed") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
