// Stage-2 live runner for the CF1 Call-1 split arm
// (pipeline-y-canonical-relation-split-v1). Runs 1A+1B on chosen fixtures with the
// real OpenAI transport, writes per-run artifacts, and renders an HTML report.
//
// Usage (from backend/):
//   node scripts/cf1SplitStage2.mjs --fixture CF1-F02 --fixture CF1-F03 --repeats 3 --model gpt-4o-mini
// Add --stream-call1a to stream only Chat Completions stage 1A and abort on
// the third normalized repetition of one claimText.
import dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();
// openAiLLM reads OPENAI_API_KEY, falling back to REACT_APP_OPENAI_API_KEY; make
// the canonical name available too so any direct reader works.
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { runCall1Split } = await import("../test/claim-foundry/prompt-benchmark/runCall1Split.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiCf1Transport } = await import("../src/claim-foundry/openAiTransport.js");
const { createOpenAiResponsesCf1Transport } = await import("../src/claim-foundry/openAiResponsesTransport.js");
const { createOpenAiStreamingCf1Transport } = await import(
  "../test/claim-foundry/prompt-benchmark/openAiStreamingTransport.js");
const { renderSplitArmHtml } = await import("../test/claim-foundry/prompt-benchmark/splitArmHtml.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

function parseArgs(argv) {
  const args = { fixtures: [], repeats: 3, model: "gpt-4o-mini", call1aModel: null,
    call1bModel: null, arm: "attribution-host-v4", api: "chat", call1aApi: null,
    call1bApi: null, streamCall1a: false, atomicRepair: false,
    includeAuthorCandidates: false,
    timeoutMs: 180_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fixture") args.fixtures.push(argv[++i]);
    else if (a === "--repeats") args.repeats = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--call1a-model") args.call1aModel = argv[++i];
    else if (a === "--call1b-model") args.call1bModel = argv[++i];
    else if (a === "--arm") args.arm = argv[++i];
    else if (a === "--api") args.api = argv[++i];
    else if (a === "--call1a-api") args.call1aApi = argv[++i];
    else if (a === "--call1b-api") args.call1bApi = argv[++i];
    else if (a === "--stream-call1a") args.streamCall1a = true;
    else if (a === "--atomic-repair") args.atomicRepair = true;
    else if (a === "--include-author-candidates") args.includeAuthorCandidates = true;
    else if (a === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
  }
  if (!args.fixtures.length) args.fixtures = ["CF1-F02", "CF1-F03"];
  return args;
}

const seedFor = (fixtureId, repeat) =>
  Number.parseInt(createHash("sha256").update(`${fixtureId}:${repeat}`).digest("hex").slice(0, 8), 16);

async function main() {
  const { fixtures, repeats, model, call1aModel: requested1aModel,
    call1bModel: requested1bModel, arm, api, call1aApi: requested1aApi,
    call1bApi: requested1bApi, streamCall1a, includeAuthorCandidates,
    atomicRepair, timeoutMs } = parseArgs(process.argv.slice(2));
  const call1aModel = requested1aModel ?? model;
  const call1bModel = requested1bModel ?? model;
  const call1aApi = requested1aApi ?? api;
  const call1bApi = requested1bApi ?? api;
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14).replace(/(\d{8})(\d{6})/, "$1-$2");
  const runId = `split-${timestamp}-${createHash("sha256")
    .update(`${Date.now()}`).digest("hex").slice(0, 6)}`;
  const outDir = path.join(repoRoot, "artifacts", "claim-foundry", "split-arm", runId);
  mkdirSync(outDir, { recursive: true });

  for (const [label, value] of [["--call1a-api", call1aApi], ["--call1b-api", call1bApi]]) {
    if (!new Set(["chat", "responses"]).has(value)) throw new Error(`${label} must be chat or responses`);
  }
  if (streamCall1a && call1aApi !== "chat") {
    throw new Error("--stream-call1a requires --call1a-api chat");
  }
  const transportFor = (mode) => mode === "responses"
    ? createOpenAiResponsesCf1Transport() : createOpenAiCf1Transport();
  const modelRunners = {
    call1a: createCf1ModelRunner({ transport: streamCall1a
      ? createOpenAiStreamingCf1Transport({ repetitionThreshold: 3,
        onClaim: (claim) => process.stdout.write(`${claim.ordinal === 1 ? "\n" : ""}    1A claim ${claim.ordinal}${claim.count > 1 ? ` repeat ${claim.count}` : ""}: ${claim.claimText.slice(0, 140)}\n`) })
      : transportFor(call1aApi) }),
    call1b: createCf1ModelRunner({ transport: transportFor(call1bApi) }),
    atomicRepair: createCf1ModelRunner({ transport: transportFor(call1bApi) }),
  };
  const options = { model, call1aModel, call1bModel, call1aApiMode: call1aApi,
    call1bApiMode: call1bApi, call1aStreaming: streamCall1a, temperature: 0, timeoutMs,
    packetOptions: { includeArticleVoiceCandidates: includeAuthorCandidates },
    atomicRepair,
    budgetLimits: { maxOutputTokensPerCall: 12_000 } };

  console.log(`Stage-2 split run ${runId} · arm ${arm} · 1A ${call1aModel}/${call1aApi}${streamCall1a ? "/stream" : ""} · census diagnostic only · atomic repair ${atomicRepair} · 1B ${call1bModel}/${call1bApi} · author candidates ${includeAuthorCandidates} · fixtures ${fixtures.join(",")} · ${repeats} repeats each`);
  const runs = [];
  for (const fixtureId of fixtures) {
    const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures", fixtureId, "article.json")));
    const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      // Chat Completions accepts a best-effort seed. The Responses create
      // contract does not, so never record a synthetic seed for Responses runs.
      const seed = call1aApi === "chat" ? seedFor(fixtureId, repeat) : null;
      process.stdout.write(`  ${fixtureId} run ${repeat} (${seed == null ? "unseeded" : `seed ${seed}`}) … `);
      const startedAt = Date.now();
      const record = { fixtureId, repeat, seed, status: "completed" };
      try {
        record.result = await runCall1Split({ article, structuralBlocks,
          sourceUnits: articleDocument.sourceUnits, modelRunners,
          options: { ...options, arm, seed } });
        console.log(`ok · ${record.result.inventory.candidateClaims.length} claims · ${record.result.usage.totalTokens} tok`);
      } catch (error) {
        record.status = "failed";
        const causes = [];
        for (let current = error?.cause, depth = 0; current && depth < 5;
          current = current.cause, depth += 1) {
          causes.push({ code: current.code ?? null, status: current.status ?? null,
            message: String(current.message ?? current).slice(0, 500),
            ...(current.providerMetadata ? { providerMetadata: current.providerMetadata } : {}) });
        }
        record.error = { code: error.code ?? null, message: String(error.message).slice(0, 500), causes };
        console.log(`FAILED · ${record.error.code ?? ""} ${record.error.message}`);
        if (causes.length) console.log(`    cause: ${causes.map((item) => item.code ?? item.message).join(" <- ")}`);
      }
      record.elapsedMs = Date.now() - startedAt;
      writeFileSync(path.join(outDir, `${fixtureId}-run${repeat}.json`), JSON.stringify(record, null, 2));
      runs.push(record);
    }
  }

  const generatedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, "runs.json"), JSON.stringify({ runId, arm, model,
    call1aModel, call1bModel, api: call1aApi === call1bApi ? call1aApi : "mixed",
    call1aApi, call1bApi, streamCall1a, atomicRepair,
    includeAuthorCandidates, generatedAt, runs }, null, 2));
  const reportPath = path.join(outDir, "report.html");
  // Rendering is diagnostic only. A report bug must never retroactively turn a
  // completed CF1 extraction into a failed run; runs.json remains the artifact.
  try {
    const html = renderSplitArmHtml({ runId,
      model: `1A ${call1aModel} / 1B ${call1bModel}`, generatedAt, runs,
      note: `arm ${arm}; 1A API ${call1aApi}${streamCall1a ? " streamed" : ""}; census diagnostic only; atomic repair ${atomicRepair}; 1B API ${call1bApi}; author candidates ${includeAuthorCandidates}` });
    writeFileSync(reportPath, html);
  } catch (error) {
    writeFileSync(path.join(outDir, "report-render-error.json"), JSON.stringify({
      message: String(error?.message ?? error), generatedAt,
    }, null, 2));
    console.error(`Report rendering failed (runs remain valid): ${error.message}`);
  }
  const ok = runs.filter((r) => r.status === "completed").length;
  console.log(`\nDone: ${ok}/${runs.length} completed.`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
