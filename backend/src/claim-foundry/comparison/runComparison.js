import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCf1ModelRunner } from "../modelRunner.js";
import { createOpenAiCf1Transport } from "../openAiTransport.js";
import { runClaimFoundry } from "../runClaimFoundry.js";
import { verifyCf1Package } from "../verifyPackage.js";
import { buildBlindReviewArtifacts } from "./blindReview.js";
import { runBaselineForComparison } from "./baselineAdapter.js";

const FIXTURES = Array.from({ length: 8 }, (_, index) => `CF1-F0${index + 1}`);

function cf1Claims(claimPackage) {
  return claimPackage.selectedEvaluationClaims.map((claim) => ({ ...claim,
    targets: claimPackage.phase3Targets.filter((target) => target.selectedClaimId === claim.selectedClaimId)
      .map((target) => ({ ...target, evidenceNeedCard: claimPackage.evidenceNeedCards
        .find((card) => card.targetId === target.targetId) })) }));
}

async function runCf1({ article, fixtureId, repeat, model, modelRunner, options }) {
  const started = performance.now();
  let capturedState = null;
  const artifactWriter = async (state) => {
    capturedState = structuredClone(state);
    return { artifactRoot: null, files: [] };
  };
  const result = await runClaimFoundry({ article, options: { ...options, model,
    artifactRoot: "comparison-memory-capture" }, dependencies: { modelRunner, artifactWriter } });
  const valid = result.claimPackage ? verifyCf1Package(result.claimPackage).valid : false;
  const usage = result.run.usage;
  return { status: result.run.status === "ready_for_evidence" ? "completed" : "failed",
    output: result.claimPackage ? { articleMap: result.claimPackage.articleMap,
      internalConsistencyFindings: result.claimPackage.internalConsistencyFindings,
      claims: cf1Claims(result.claimPackage) } : null,
    usage, modelCalls: usage?.semanticCalls ?? 0, totalTokens: usage?.totalTokens ?? null,
    durationMs: Math.round(performance.now() - started),
    validPackage: valid, deterministicGatesPassed: valid,
    repairUsed: Number(result.run.usage?.repairCalls ?? 0) > 0,
    verification: result.verification, agentDraft: capturedState?.agentDraft ?? null,
    error: result.run.error,
    fixtureId, repeat, producer: "cf1" };
}

function runRecord(result, fixtureId, repeat, producer) {
  return { ...result, fixtureId, repeat, producer,
    modelCalls: result.usage?.semanticCalls ?? result.usage?.calls ?? 0,
    totalTokens: result.usage?.totalTokens ?? null, persisted: false, scores: null };
}

export async function runCf1Comparison({ fixtureRoot, outputRoot, model = "gpt-4o-mini",
  repeats = 3, fixtureIds = FIXTURES, producers = ["baseline", "cf1"],
  seed = `cf1-${Date.now()}`, options = {}, onProgress = () => {} }) {
  const modelTrace = [];
  const baseTransport = createOpenAiCf1Transport();
  const transport = { invoke: async (request) => {
    const trace = { request: structuredClone(request), response: null, error: null };
    modelTrace.push(trace);
    try {
      const response = await baseTransport.invoke(request);
      trace.response = structuredClone(response);
      return response;
    } catch (error) {
      trace.error = { code: error.code ?? null, message: error.message,
        usage: error.usage ?? null, model: error.model ?? request.model };
      throw error;
    }
  } };
  const modelRunner = createCf1ModelRunner({ transport });
  const output = resolve(outputRoot);
  await mkdir(join(output, "raw"), { recursive: true });
  const runs = [];
  for (const fixtureId of fixtureIds) {
    if (!FIXTURES.includes(fixtureId)) throw new Error(`Unknown comparison fixture: ${fixtureId}`);
    const article = JSON.parse(await readFile(join(resolve(fixtureRoot), fixtureId, "article.json"), "utf8"));
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      if (producers.includes("baseline")) {
        onProgress({ fixtureId, repeat, producer: "baseline" });
        const baseline = runRecord(await runBaselineForComparison({ article, fixtureId, repeat }),
          fixtureId, repeat, "baseline");
        runs.push(baseline);
        await writeFile(join(output, "raw", `${fixtureId}-${repeat + 1}-baseline.json`),
          `${JSON.stringify(baseline, null, 2)}\n`);
      }
      if (producers.includes("cf1")) {
        modelTrace.length = 0;
        onProgress({ fixtureId, repeat, producer: "cf1" });
        const cf1 = await runCf1({ article, fixtureId, repeat, model, modelRunner, options });
        cf1.modelTrace = structuredClone(modelTrace);
        runs.push(cf1);
        await writeFile(join(output, "raw", `${fixtureId}-${repeat + 1}-cf1.json`),
          `${JSON.stringify(cf1, null, 2)}\n`);
      }
    }
  }
  const blind = buildBlindReviewArtifacts(runs, seed);
  const manifest = { schemaVersion: "cf1.comparisonRuns.v1", generatedAt: new Date().toISOString(),
    model, repeats, fixtureIds, producers, runs };
  await writeFile(join(output, "comparison-runs.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, "blind-review.json"), `${JSON.stringify(blind.packets, null, 2)}\n`);
  await writeFile(join(output, "blind-key.json"), `${JSON.stringify(blind.key, null, 2)}\n`);
  return { output, runCount: runs.length };
}
