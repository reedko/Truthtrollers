// Isolated re-run of Call 1B (+ host finalize) over the SAME 1A candidates from a
// prior split-arm run, so the contentStance/articleDeployment change can be measured
// without any new 1A variance. Reuses the prior run's raw.call1a; re-assembles packets
// deterministically from the fixture and re-invokes 1B with the current prompt/schema.
// Emits an interactive review.html (renderDeepReviewHtml "split" mode) + JSON.
//
// Usage (billed — needs OPENAI_API_KEY). --run is resolved from the repo root:
//   node scripts/cf1SplitRerun1b.mjs --run artifacts/claim-foundry/split-arm/split-20260718-eeda3e \
//     --fixture CF1-F02 --fixture CF1-F03            # step 1: packets unchanged
//   node scripts/cf1SplitRerun1b.mjs --run artifacts/claim-foundry/split-arm/split-20260718-eeda3e \
//     --fixture CF1-F03 --distant                    # step 3: + distant-response
import dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { buildSplitCall1bPrompt } = await import("../test/claim-foundry/prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV1.js");
const { buildSplitCall1aPrompt } = await import("../test/claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptV1.js");
const { tagCandidateGroundingSpans } = await import("../src/claim-foundry/candidateGroundingSpan.js");
const { assembleCall1bPackets } = await import("../src/claim-foundry/splitPacketAssembly.js");
const { assertCensusMintConsistency } = await import("../src/claim-foundry/splitCensusValidation.js");
const { finalizeSplitInventory } = await import("../src/claim-foundry/splitHostFinalize.js");
const { collectAttributionSurface } = await import("../src/claim-foundry/attributionSurfaceCensus.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiCf1Transport } = await import("../src/claim-foundry/openAiTransport.js");
const { renderDeepReviewHtml } = await import("../test/claim-foundry/prompt-benchmark/deepReviewHtml.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

function parseArgs(argv) {
  const args = { fixtures: [], run: null, model: "gpt-4o-mini", distant: false, fresh1a: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fixture") args.fixtures.push(argv[++i]);
    else if (a === "--run") args.run = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--distant") args.distant = true;
    else if (a === "--fresh1a") args.fresh1a = true; // re-run Call 1A live (tests the 1A count fix); default replays frozen 1A
  }
  if (!args.run) throw new Error("--run <prior split-arm run dir> is required");
  if (!args.fixtures.length) args.fixtures = ["CF1-F02", "CF1-F03"];
  return args;
}

const censusItemsFromPackets = (packets = []) => packets
  .filter((p) => p.origin === "census")
  .map((p) => ({ censusId: p.id, kind: p.censusKind, signals: p.censusSignals, sourceUnitIds: p.sourceUnitIds }));

const grounding = (unitById, ids = []) => ids.map((id) => unitById.get(id)?.text).filter(Boolean).join("  ");

// Build one review row per selected claim, folding host signals + packet possibleResponse.
function rowsFor(fixtureId, finalized, payload, unitById) {
  const sigByText = new Map((finalized.hostSignals ?? []).map((s) => [s.claimText, s]));
  const prByCand = new Map((payload.packets ?? [])
    .filter((p) => p.origin === "candidate" && p.possibleResponse)
    .map((p) => [p.id, p.possibleResponse]));
  return (finalized.inventory.candidateClaims ?? []).map((c) => {
    const sig = sigByText.get(c.claimText) ?? {};
    const pr = sig.candidateId ? prByCand.get(sig.candidateId) : null;
    return { profile: fixtureId, repeat: 1, runStatus: "completed",
      claimText: c.claimText, articleRole: c.articleRole, articleUse: c.articleUse,
      assertionSource: c.assertionSource, materiality: c.materiality, scope: c.scope,
      relatedPillarLabels: c.relatedPillarLabels ?? [], evidenceUsefulnessHint: c.evidenceUsefulnessHint,
      sourceUnitIds: c.sourceUnitIds ?? [], groundingText: grounding(unitById, c.sourceUnitIds),
      contentStance: sig.contentStance, articleDeployment: sig.articleDeployment,
      scoreTransform: sig.scoreTransform, assertionSourceClass: sig.assertionSourceClass,
      groundingSpan: sig.groundingSpan, origin: sig.origin, needsSplit: sig.needsSplit,
      possibleResponseText: pr ? pr.text : null, possibleResponseUnitIds: pr ? pr.unitIds : [] };
  });
}

async function main() {
  const { fixtures, run, model, distant, fresh1a } = parseArgs(process.argv.slice(2));
  const priorDir = path.isAbsolute(run) ? run : path.resolve(repoRoot, run);
  // Timestamp to the second (YYYYMMDD-HHMMSS) so successive runs never overwrite each other.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(priorDir, `rerun1b-${fresh1a ? "fresh1a-" : ""}${distant ? "distant-" : ""}${stamp}`);
  mkdirSync(outDir, { recursive: true });

  const transport = createOpenAiCf1Transport();
  const modelRunner = createCf1ModelRunner({ transport });
  console.log(`Re-run · model ${model} · fresh1a=${fresh1a} · distant=${distant} · prior ${path.basename(priorDir)}`);

  const rows = [];
  const orientations = [];
  const summary = [];
  for (const fixtureId of fixtures) {
    const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures", fixtureId, "article.json")));
    const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
    const sourceUnits = articleDocument.sourceUnits;
    const unitById = new Map(sourceUnits.map((u) => [u.unitId, u]));
    const orient = { repeat: 1, profile: fixtureId, runStatus: "completed" };

    try {
      // 1A: fresh (tests the 1A count fix) or replay the frozen prior output (isolates 1B).
      let inventory1a; let censusItems; let usage1a = {};
      if (fresh1a) {
        const call1a = await modelRunner.invokeStructured({ ...buildSplitCall1aPrompt({ article, structuralBlocks, sourceUnits }),
          model, temperature: 0, timeoutMs: 180_000, maximumAttempts: 1,
          usageContext: { component: "claim_foundry", path: "rerun1b", stage: "semantic_inventory_1a" } });
        inventory1a = { ...call1a.output, candidateClaims: tagCandidateGroundingSpans(call1a.output.candidateClaims ?? []) };
        censusItems = collectAttributionSurface({ sourceUnits });
        usage1a = call1a.usage ?? {};
      } else {
        const prior = JSON.parse(readFileSync(path.join(priorDir, `${fixtureId}-run1.json`)));
        inventory1a = prior.result.raw.call1a;
        censusItems = prior.result.raw.packets
          ? censusItemsFromPackets(prior.result.raw.packets) : collectAttributionSurface({ sourceUnits });
      }
      Object.assign(orient, { call1CandidateCount: (inventory1a.candidateClaims ?? []).length,
        theme: inventory1a.theme?.text, thesis: inventory1a.thesis?.text,
        thesisHinge: inventory1a.thesisHinge, pillars: inventory1a.pillars ?? [] });

      const payload = assembleCall1bPackets({ inventory1a, censusItems, sourceUnits,
        structuralBlocks, article, options: { attachDistantResponse: distant } });
      const call1b = await modelRunner.invokeStructured({ ...buildSplitCall1bPrompt(payload),
        model, temperature: 0, timeoutMs: 180_000, maximumAttempts: 1,
        usageContext: { component: "claim_foundry", path: "rerun1b", stage: "source_posture_1b" } });
      assertCensusMintConsistency(call1b.output);
      const finalized = finalizeSplitInventory({ inventory1a, call1bOutput: call1b.output, censusItems, article });

      const usage = { totalTokens: (usage1a.totalTokens ?? 0) + (call1b.usage?.totalTokens ?? 0),
        call1a: usage1a, call1b: call1b.usage };
      writeFileSync(path.join(outDir, `${fixtureId}.json`),
        JSON.stringify({ fixtureId, model, fresh1a, distant, packets: payload.packets,
          call1a: fresh1a ? inventory1a : "(replayed frozen 1A)", call1b: call1b.output, finalized, usage }, null, 2));
      rows.push(...rowsFor(fixtureId, finalized, payload, unitById));

      const j = call1b.output.candidateJudgments ?? [];
      const count = (key, src) => src.reduce((a, r) => { a[r[key]] = (a[r[key]] ?? 0) + 1; return a; }, {});
      const line = { fixtureId, candidates: j.length,
        contentStance: count("contentStance", j), articleDeployment: count("articleDeployment", j),
        selectedArticleUse: count("articleUse", finalized.inventory.candidateClaims),
        blocking: (finalized.diagnostics.blockingErrors ?? []).length };
      summary.push(line);
      console.log(`  ${fixtureId}:`, JSON.stringify(line));
    } catch (error) {
      orient.runStatus = "failed";
      orient.failure = { failureClass: error.code ?? "ERROR", failureStage: "call1_split" };
      summary.push({ fixtureId, error: error.code ?? String(error.message).slice(0, 200) });
      console.log(`  ${fixtureId}: FAILED ${error.code ?? ""} ${error.message}`);
    }
    orientations.push(orient);
  }

  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ model, distant, summary }, null, 2));
  const html = renderDeepReviewHtml({ phase: `rerun1b${distant ? "-distant" : ""}`, mode: "split", rows, orientations });
  const reportPath = path.join(outDir, "review.html");
  writeFileSync(reportPath, html);
  console.log(`\nWrote ${outDir}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
