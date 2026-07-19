// Replays Call 1B over the exact frozen Call 1A inventory and deterministic
// selector output from a prior split-arm run. This avoids a new Call 1A and
// isolates changes in packet assembly / Call 1B behavior.
//
// Usage (from backend/):
//   node scripts/cf1SplitReplay1b.mjs \
//     --run ../artifacts/claim-foundry/split-arm/<run-id> --fixture CF1-F03
import dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { buildSplitCall1bAttributionPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV2.js"
);
const { buildSplitCall1bPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV1.js"
);
const { assembleCall1bPackets } = await import("../src/claim-foundry/splitPacketAssembly.js");
const { finalizeSplitInventory } = await import("../src/claim-foundry/splitHostFinalize.js");
const { buildModelCallProvenance } = await import("../src/claim-foundry/modelCallProvenance.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiCf1Transport } = await import("../src/claim-foundry/openAiTransport.js");
const { createOpenAiResponsesCf1Transport } = await import(
  "../src/claim-foundry/openAiResponsesTransport.js"
);
const { renderSplitArmHtml } = await import(
  "../test/claim-foundry/prompt-benchmark/splitArmHtml.js"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

function parseArgs(argv) {
  const args = { run: null, fixture: "CF1-F03", model: "gpt-4o-mini",
    promptVersion: "v2", apiMode: "chat", reasoningEffort: "medium",
    useStoredPackets: false, includeAuthorCandidates: false,
    suppressSourceCandidates: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run") args.run = argv[++index];
    else if (argv[index] === "--fixture") args.fixture = argv[++index];
    else if (argv[index] === "--model") args.model = argv[++index];
    else if (argv[index] === "--prompt-version") args.promptVersion = String(argv[++index] ?? "");
    else if (argv[index] === "--api") args.apiMode = String(argv[++index] ?? "");
    else if (argv[index] === "--reasoning-effort") args.reasoningEffort = String(argv[++index] ?? "");
    else if (argv[index] === "--use-stored-packets") args.useStoredPackets = true;
    else if (argv[index] === "--include-author-candidates") args.includeAuthorCandidates = true;
    else if (argv[index] === "--suppress-source-candidates") {
      for (const id of String(argv[++index] ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
        args.suppressSourceCandidates.add(id);
      }
    }
  }
  if (!args.run) throw new Error("--run <prior split-arm directory> is required");
  if (!new Set(["v1", "v2"]).has(args.promptVersion)) {
    throw new Error("--prompt-version must be v1 or v2");
  }
  if (!new Set(["chat", "responses"]).has(args.apiMode)) {
    throw new Error("--api must be chat or responses");
  }
  if (!new Set(["none", "minimal", "low", "medium", "high"]).has(args.reasoningEffort)) {
    throw new Error("--reasoning-effort must be none, minimal, low, medium, or high");
  }
  return args;
}

const countBy = (items, key) => items.reduce((counts, item) => {
  const value = item?.[key] ?? "(missing)";
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});

async function main() {
  const { run, fixture, model, promptVersion, apiMode, reasoningEffort, useStoredPackets,
    includeAuthorCandidates, suppressSourceCandidates } = parseArgs(process.argv.slice(2));
  const priorDir = path.isAbsolute(run) ? run : path.resolve(backend, run);
  const priorPath = path.join(priorDir, `${fixture}-run1.json`);
  const prior = JSON.parse(readFileSync(priorPath, "utf8"));
  if (prior.status !== "completed") throw new Error(`Prior run is not completed: ${priorPath}`);

  const rawFixture = JSON.parse(readFileSync(
    path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json"), "utf8"
  ));
  const { article, structuralBlocks, articleDocument } = prepareArticle(rawFixture.article ?? rawFixture);
  const frozenInventory = prior.result.raw.call1a;
  const frozenSelectedClaims = prior.result.selector.selectedClaims;
  const selectedInventory = { ...frozenInventory, candidateClaims: frozenSelectedClaims };

  const articleAuthors = (article?.authors ?? [])
    .map((author) => (typeof author === "string" ? author : author?.name))
    .map((name) => String(name ?? "").trim()).filter(Boolean);
  const payload = useStoredPackets
    ? {
      orientation: {
        theme: selectedInventory.theme,
        thesis: selectedInventory.thesis,
        pillars: selectedInventory.pillars,
        thesisHinge: selectedInventory.thesisHinge,
      },
      articleAuthors,
      packets: structuredClone(prior.result.raw.packets),
    }
    : assembleCall1bPackets({
      inventory1a: selectedInventory,
      sourceUnits: articleDocument.sourceUnits,
      structuralBlocks,
      article,
      options: { includeArticleVoiceCandidates: includeAuthorCandidates },
    });
  for (const packet of payload.packets) {
    if (!suppressSourceCandidates.has(packet.id)) continue;
    packet.sourceCandidates = [];
    packet.sourceCandidateStatus = "no_candidates_detected";
  }
  if (promptVersion === "v1") {
    // Reproduce the original 1B information boundary: source attribution remains
    // a model task, but no deterministic source-candidate hints enter its context.
    for (const packet of payload.packets) {
      delete packet.sourceCandidateStatus;
      delete packet.sourceCandidates;
    }
  }
  const injectedAuthorCandidates = payload.packets.flatMap((packet) =>
    (packet.sourceCandidates ?? []).filter((candidate) => candidate.candidateKind === "article_voice")
  );
  if (!includeAuthorCandidates && injectedAuthorCandidates.length) {
    throw new Error(`Replay still contains ${injectedAuthorCandidates.length} injected article_voice candidates`);
  }

  const transport = apiMode === "responses"
    ? createOpenAiResponsesCf1Transport() : createOpenAiCf1Transport();
  const modelRunner = createCf1ModelRunner({ transport });
  const call1bBuiltPrompt = promptVersion === "v1"
    ? buildSplitCall1bPrompt(payload) : buildSplitCall1bAttributionPrompt(payload);
  const call1bRequest = {
    ...call1bBuiltPrompt,
    model,
    timeoutMs: 180_000,
    maximumAttempts: 1,
    maxOutputTokens: 12_000,
    ...(apiMode === "responses"
      ? { apiMode, reasoningEffort, store: false }
      : { apiMode, temperature: 0, seed: prior.seed }),
    usageContext: {
      component: "claim_foundry",
      path: "replay_1b_without_host_author_candidates",
      stage: "source_posture_1b",
    },
  };
  const call1b = await modelRunner.invokeStructured(call1bRequest);

  const budget = prior.result.budget;
  const finalized = finalizeSplitInventory({
    inventory1a: selectedInventory,
    call1bOutput: call1b.output,
    packets: payload.packets,
    article,
    options: {
      minimumCandidates: budget.finalPortfolioMinimum,
      targetMax: budget.finalPortfolioMaximum,
    },
  });

  const result = {
    inventory: finalized.inventory,
    arm: `${prior.result.arm}-replay1b-no-host-author-candidates`,
    budget,
    selector: prior.result.selector,
    finalArticleCoverageRange: prior.result.finalArticleCoverageRange,
    hostSignals: finalized.hostSignals,
    censusDiagnostic: prior.result.censusDiagnostic,
    diagnostics: finalized.diagnostics,
    droppedFromSelection: finalized.droppedFromSelection,
    raw: {
      call1aModel: prior.result.raw.call1aModel,
      call1a: frozenInventory,
      occurrenceExpansion: prior.result.raw.occurrenceExpansion,
      call1b: call1b.output,
      packets: payload.packets,
      censusPackets: prior.result.raw.censusPackets,
    },
    modelCalls: {
      call1b: buildModelCallProvenance({ prompt: call1bBuiltPrompt, response: call1b,
        request: call1bRequest }),
    },
    usage: call1b.usage,
    attempts: { call1a: 0, call1b: call1b.attempts ?? null },
  };
  const record = {
    fixtureId: fixture,
    repeat: 1,
    seed: prior.seed,
    status: "completed",
    result,
    elapsedMs: null,
  };

  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const storedPacketTag = useStoredPackets ? "-stored-packets" : "";
  const suppressionTag = suppressSourceCandidates.size
    ? `-suppress-${[...suppressSourceCandidates].join("-").toLowerCase()}` : "";
  const modelTag = model.replace(/[^a-zA-Z0-9.-]/g, "-");
  const authorTag = includeAuthorCandidates ? "-with-host-author" : "-no-host-author";
  const runId = `replay1b-${promptVersion}-${apiMode}-${modelTag}${authorTag}${storedPacketTag}${suppressionTag}-${stamp}`;
  const outDir = path.join(priorDir, runId);
  mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, `${fixture}-run1.json`), JSON.stringify(record, null, 2));
  writeFileSync(path.join(outDir, "runs.json"), JSON.stringify({
    runId, arm: result.arm, model, generatedAt, sourceRun: path.basename(priorDir), runs: [record],
  }, null, 2));
  writeFileSync(path.join(outDir, "report.html"), renderSplitArmHtml({
    runId, model, generatedAt, runs: [record],
    note: `Frozen 1A replay from ${path.basename(priorDir)}; 1B ${promptVersion}; API ${apiMode}; reasoning ${apiMode === "responses" ? reasoningEffort : "n/a"}; ${useStoredPackets ? "exact stored packets" : "current packet assembly"}; host author candidates ${includeAuthorCandidates ? "enabled" : "removed"}; suppressed source candidates: ${[...suppressSourceCandidates].join(", ") || "none"}`,
  }));

  const judgments = call1b.output.candidateJudgments ?? [];
  console.log(JSON.stringify({
    outDir,
    frozen1aClaims: frozenInventory.candidateClaims?.length ?? 0,
    frozenSelectedClaims: frozenSelectedClaims.length,
    packets: payload.packets.length,
    promptVersion,
    apiMode,
    reasoningEffort: apiMode === "responses" ? reasoningEffort : null,
    useStoredPackets,
    includeAuthorCandidates,
    injectedAuthorCandidates: injectedAuthorCandidates.length,
    suppressedSourceCandidateIds: [...suppressSourceCandidates],
    contentStance: countBy(judgments, "contentStance"),
    articleDeployment: countBy(judgments, "articleDeployment"),
    assertionSource: countBy(judgments, "assertionSource"),
    modelCall: result.modelCalls.call1b,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
