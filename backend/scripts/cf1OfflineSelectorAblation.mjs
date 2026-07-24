// Offline selector ablation over a stored split-arm 1A inventory.
// It never calls a model and never mutates the stored run.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArticle } from "../test/claim-foundry/prompt-benchmark/generationRun.js";
import { selectSplitCandidates } from "../src/claim-foundry/splitCandidateSelector.js";
import { detectSplitAtomicRepairSignals } from "../src/claim-foundry/splitAtomicRepair.js";
import { semanticOverlap, semanticWords } from "../src/claim-foundry/semanticGrounding.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");
const defaultSource = path.join(repoRoot, "artifacts/claim-foundry/split-arm",
  "split-20260721-021208-c5070c/CF1-F03-run1.json");
const source = path.resolve(process.argv[2] ?? defaultSource);
const maximum = Number(process.argv[3] ?? 16);
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function rankSignals(claim, sourceUnitsById, localText) {
  const sourceText = (claim.sourceUnitIds ?? []).map((id) => sourceUnitsById.get(id)?.text)
    .filter(Boolean).join(" ");
  const atomic = detectSplitAtomicRepairSignals({ claim, sourceUnitsById });
  const claimWords = semanticWords(claim.claimText).size;
  const overlap = semanticOverlap(claim.claimText, sourceText);
  const groundingRatio = claimWords ? overlap / claimWords : 0;
  const localOverlap = semanticOverlap(claim.claimText, localText);
  const localGroundingRatio = claimWords ? localOverlap / claimWords : 0;
  const effectiveGroundingRatio = Math.max(groundingRatio, localGroundingRatio);
  const text = `${claim.claimText} ${sourceText}`;
  const numericOrComparison = /\b\d[\d,.]*(?:%|\b)|\b(?:percent|times|more|less|higher|lower|increase|decrease|rate|ratio|compared|versus)\b/i.test(text);
  const evidenceAnchor = /\b(?:study|analysis|report|review|trial|survey|database|dataset|data|record|document|law|act|statute|regulation|package insert|meta-analysis|classified|announced)\b/i.test(text);
  const concretePredicate = /\b(?:found|showed|reported|measured|increased|decreased|removed|contains?|caused|linked|tested|funded|classified|banned|required|ordered|released|manipulated)\b/i.test(claim.claimText);
  const genericAllegation = /\b(?:accused of|concerns?|narrative|awareness|comes at a time|attempts? to|aims? to|intends? to)\b/i.test(claim.claimText);
  let score = Math.min(4, Math.round(effectiveGroundingRatio * 4));
  if (numericOrComparison) score += 3;
  if (evidenceAnchor) score += 3;
  if (concretePredicate) score += 2;
  if (genericAllegation) score -= 3;
  if (atomic.signals.includes("possible_multiple_assertions")) score -= 3;
  if (atomic.signals.includes("presentation_or_intent_claim")) score -= 8;
  if (atomic.signals.includes("audience_characterization")) score -= 6;
  if (atomic.signals.includes("weak_claim_to_grounding_overlap")
    && localGroundingRatio < 0.4) score -= 5;
  if (atomic.signals.includes("grounded_only_in_short_label")
    && localGroundingRatio < 0.4) score -= 4;
  return { score, groundingRatio, localGroundingRatio,
    locallyRecoverable: groundingRatio < 0.4 && localGroundingRatio >= 0.4,
    numericOrComparison, evidenceAnchor,
    concretePredicate, genericAllegation, signals: atomic.signals };
}

function itemsFor(candidateClaims, sourceUnits) {
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return candidateClaims.map((claim, index) => {
    const first = Math.min(...(claim.sourceUnitIds ?? [])
      .map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER));
    const region = sourceUnits.length && Number.isFinite(first)
      ? Math.min(3, Math.floor((first / sourceUnits.length) * 4)) : 0;
    const localText = sourceUnits.slice(Math.max(0, first - 3),
      Math.min(sourceUnits.length, first + 4)).map((unit) => unit.text).join(" ");
    return { claim, index, first, region,
      ...rankSignals(claim, sourceUnitsById, localText) };
  });
}

function selectReverse(items, budget) {
  const materiality = { high: 3, medium: 2, low: 1 };
  const sorted = [...items].sort((a, b) =>
    (materiality[b.claim.materiality] ?? 0) - (materiality[a.claim.materiality] ?? 0)
    || b.first - a.first || b.index - a.index);
  const selected = []; const pillars = new Set(); const regions = new Set();
  for (const item of sorted) {
    if (selected.length >= budget) break;
    const newPillar = (item.claim.relatedPillarLabels ?? []).some((p) => !pillars.has(p));
    if (newPillar || !regions.has(item.region)) {
      selected.push(item); regions.add(item.region);
      (item.claim.relatedPillarLabels ?? []).forEach((p) => pillars.add(p));
    }
  }
  for (const item of sorted) if (selected.length < budget && !selected.includes(item)) {
    selected.push(item);
  }
  return selected;
}

function selectBalanced(items, budget) {
  const quality = (a, b) => b.score - a.score || a.first - b.first || a.index - b.index;
  const selected = []; const selectedIndexes = new Set();
  const eligible = items.filter((item) =>
    !item.signals.includes("presentation_or_intent_claim")
    && !item.signals.includes("audience_characterization"));
  const add = (item, reason) => {
    if (!item || selectedIndexes.has(item.index) || selected.length >= budget) return;
    selected.push({ ...item, reason }); selectedIndexes.add(item.index);
  };

  // One strongest claim for each model-proposed argumentative axis. The label is
  // used only as a grouping key; model materiality and pillar importance are ignored.
  const pillarLabels = [...new Set(eligible.flatMap((item) =>
    item.claim.relatedPillarLabels ?? []))];
  for (const label of pillarLabels) {
    add([...eligible].filter((item) => item.claim.relatedPillarLabels?.includes(label))
      .sort(quality)[0], "pillar_best");
  }

  // Four source quartiles; reserve up to one quarter of the Call 1B budget per
  // region, redistributing empty-region capacity globally below.
  const quota = Math.max(1, Math.floor(budget / 4));
  for (let region = 0; region < 4; region += 1) {
    const regionItems = eligible.filter((item) => item.region === region).sort(quality);
    let inRegion = selected.filter((item) => item.region === region).length;
    for (const item of regionItems) {
      if (inRegion >= quota || selected.length >= budget) break;
      if (!selectedIndexes.has(item.index)) { add(item, "region_quota"); inRegion += 1; }
    }
  }
  for (const item of [...eligible].sort(quality)) add(item, "global_quality");
  for (const item of [...items].sort(quality)) add(item, "fallback_only");
  return selected;
}

function summarize(name, selected, allItems) {
  const normalizedSelected = selected.map((entry) => entry.claim ? entry : allItems
    .find((item) => normalized(item.claim.claimText) === normalized(entry.claimText))).filter(Boolean);
  const counts = Object.fromEntries([0, 1, 2, 3].map((region) =>
    [region, normalizedSelected.filter((item) => item.region === region).length]));
  return { name, selected: normalizedSelected, regionCounts: counts,
    averageScore: normalizedSelected.reduce((sum, item) => sum + item.score, 0)
      / Math.max(1, normalizedSelected.length),
    suspicious: normalizedSelected.filter((item) => item.signals.length).length,
    weakGrounding: normalizedSelected.filter((item) =>
      item.signals.includes("weak_claim_to_grounding_overlap")).length,
    compound: normalizedSelected.filter((item) =>
      item.signals.includes("possible_multiple_assertions")).length };
}

const record = JSON.parse(readFileSync(source));
const fixtureId = record.fixtureId ?? "CF1-F03";
const rawFixture = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures",
  fixtureId, "article.json")));
const { articleDocument } = prepareArticle(rawFixture.article ?? rawFixture);
const candidateClaims = record.result?.raw?.call1a?.candidateClaims
  ?? record.result?.raw?.call1aModel?.candidateClaims ?? [];
if (!candidateClaims.length) throw new Error(`No stored raw 1A claims in ${source}`);
const allItems = itemsFor(candidateClaims, articleDocument.sourceUnits);
const currentResult = selectSplitCandidates({ candidateClaims,
  sourceUnits: articleDocument.sourceUnits, budget: { call1bCandidateMaximum: maximum } });
const arms = [
  summarize("Current: materiality → source order", currentResult.selectedClaims, allItems),
  summarize("Reverse: materiality → reverse source order", selectReverse(allItems, maximum), allItems),
  summarize("Balanced: no materiality; pillars + quartiles + generic quality",
    selectBalanced(allItems, maximum), allItems),
];

const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.join(repoRoot, "artifacts/claim-foundry/selector-ablation",
  `${fixtureId.toLowerCase()}-${timestamp}`);
mkdirSync(outDir, { recursive: true });
const artifact = { fixtureId, source, maximum, candidateCount: candidateClaims.length,
  generatedAt: new Date().toISOString(), arms: arms.map((arm) => ({ ...arm,
    selected: arm.selected.map((item) => ({ index: item.index + 1,
      claimText: item.claim.claimText, sourceUnitIds: item.claim.sourceUnitIds,
      modelMateriality: item.claim.materiality, relatedPillarLabels: item.claim.relatedPillarLabels,
      region: item.region, qualityScore: item.score, signals: item.signals,
      reason: item.reason ?? currentResult.selected.find((entry) =>
        entry.index === item.index)?.reason ?? "current_selector" })) })) };
writeFileSync(path.join(outDir, "selector-ablation.json"), JSON.stringify(artifact, null, 2));

const cards = artifact.arms.map((arm) => `<section><h2>${esc(arm.name)}</h2>
<p>average generic score ${arm.averageScore.toFixed(2)} · regions ${Object.values(arm.regionCounts).join(" / ")} · suspicious ${arm.suspicious} · weak grounding ${arm.weakGrounding} · compound ${arm.compound}</p>
<table><thead><tr><th>#</th><th>claim</th><th>units</th><th>region</th><th>score</th><th>model materiality</th><th>reason</th><th>signals</th></tr></thead><tbody>
${arm.selected.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.claimText)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td><td>${item.region + 1}</td><td>${item.qualityScore}</td><td>${esc(item.modelMateriality)}</td><td>${esc(item.reason)}</td><td>${esc(item.signals.join(", ") || "none")}</td></tr>`).join("\n")}
</tbody></table></section>`).join("\n");
const html = `<!doctype html><meta charset="utf-8"><title>CF1 offline selector ablation</title>
<style>body{font:14px system-ui;margin:24px;color:#202124}h1{margin-bottom:4px}section{margin:28px 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:7px;vertical-align:top;text-align:left}th{background:#eee}tr:nth-child(even){background:#fafafa}p{color:#555}</style>
<h1>${esc(fixtureId)} offline selector ablation</h1><p>Frozen 1A inventory: ${candidateClaims.length} claims. No model calls. Maximum ${maximum}. Generic quality scores are experimental and contain no fixture-specific vocabulary.</p>${cards}`;
writeFileSync(path.join(outDir, "report.html"), html);
console.log(JSON.stringify({ outDir, report: path.join(outDir, "report.html"),
  summaries: artifact.arms.map(({ name, averageScore, regionCounts, suspicious,
    weakGrounding, compound }) => ({ name, averageScore, regionCounts,
    suspicious, weakGrounding, compound })) }, null, 2));
