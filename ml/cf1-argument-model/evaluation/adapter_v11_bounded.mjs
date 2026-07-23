#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const { prepareArticle } = await import(
  "../../../backend/test/claim-foundry/prompt-benchmark/generationRun.js"
);
const { mergeP1aV7Assertions, articleRegionCounts } = await import(
  "../../../backend/test/claim-foundry/prompt-benchmark/p1aV7Merge.js"
);
const { selectBalancedCandidatesV2 } = await import(
  "../../../backend/test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV2.js"
);
const { detectSplitAtomicRepairSignals } = await import(
  "../../../backend/src/claim-foundry/splitAtomicRepair.js"
);

const SYSTEM = `You are a grounded argument-analysis component. Perform exactly the named task. Use only the supplied input. Return only one valid JSON object with no markdown or commentary outside that object.`;
const INSTRUCTION = `Extract every material atomic factual assertion in the supplied passage. Each assertion must express one independently testable proposition, preserve the passage's polarity, and cite only supporting source-unit IDs.`;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const sha = (value) => createHash("sha256").update(String(value)).digest("hex");

function options(argv) {
  const output = { mode: argv[0], fixture: "CF1-F03", maximum: 16,
    passageUnits: 5, outputDir: null, predictions: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") output.fixture = argv[++index];
    else if (arg === "--maximum") output.maximum = Number(argv[++index]);
    else if (arg === "--passage-units") output.passageUnits = Number(argv[++index]);
    else if (arg === "--output-dir") output.outputDir = path.resolve(argv[++index]);
    else if (arg === "--predictions") output.predictions = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["prepare", "finalize"].includes(output.mode)) {
    throw new Error("First argument must be prepare or finalize");
  }
  if (!output.outputDir) throw new Error("--output-dir is required");
  return output;
}

function fixtureData(fixtureId) {
  const fixturePath = path.join(repoRoot, "backend/test/claim-foundry/fixtures",
    fixtureId, "article.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  return prepareArticle(raw.article ?? raw);
}

function makePassages(structuralBlocks, sourceUnits, maximumUnits) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const passages = [];
  for (const block of structuralBlocks) {
    for (let offset = 0; offset < block.sourceUnitIds.length; offset += maximumUnits) {
      const unitIds = block.sourceUnitIds.slice(offset, offset + maximumUnits);
      passages.push({
        passageId: `PB${String(passages.length + 1).padStart(3, "0")}`,
        blockId: block.blockId,
        structuralType: block.structuralType,
        sourceUnits: unitIds.map((unitId) => unitsById.get(unitId)),
      });
    }
  }
  const emitted = passages.flatMap((passage) =>
    passage.sourceUnits.map((unit) => unit.unitId));
  const expected = sourceUnits.map((unit) => unit.unitId);
  if (JSON.stringify(emitted) !== JSON.stringify(expected)) {
    throw new Error("Bounded passages do not cover every source unit exactly once");
  }
  return passages;
}

function promptRow(fixtureId, passage) {
  const payload = {
    input: { sourceUnits: passage.sourceUnits.map(({ unitId, text }) => ({
      text, unitId,
    })) },
    instruction: INSTRUCTION,
    task: "extract_assertions",
  };
  return {
    rowId: `${fixtureId}:adapter-v11:${passage.passageId}`,
    fixtureId,
    task: "extract_assertions",
    passage: {
      passageId: passage.passageId,
      blockId: passage.blockId,
      structuralType: passage.structuralType,
      sourceUnitIds: passage.sourceUnits.map((unit) => unit.unitId),
    },
    prompt: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
    completion: [{ role: "assistant", content: '{"assertions":[]}' }],
  };
}

function prepare(args) {
  const { article, structuralBlocks, articleDocument } = fixtureData(args.fixture);
  const sourceUnits = articleDocument.sourceUnits;
  const passages = makePassages(structuralBlocks, sourceUnits, args.passageUnits);
  const rows = passages.map((passage) => promptRow(args.fixture, passage));
  mkdirSync(args.outputDir, { recursive: true });
  writeFileSync(path.join(args.outputDir, "input.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const manifest = {
    label: "adapter-original-bounded-plus-v11-host",
    fixture: args.fixture,
    article: { title: article.title, contentHash: article.contentHash,
      sourceUnitCount: sourceUnits.length, structuralBlockCount: structuralBlocks.length },
    passageUnitsMaximum: args.passageUnits,
    passageCount: passages.length,
    prompt: { system: SYSTEM, instruction: INSTRUCTION,
      learnedOutputShape: { assertions: [{ proposition: "string",
        groundingUnitIds: ["U####"], scopeQualifiers: [] }] },
      systemSha256: sha(SYSTEM), instructionSha256: sha(INSTRUCTION) },
    passages: passages.map((passage) => ({ ...passage,
      sourceUnits: passage.sourceUnits.map((unit) => unit.unitId) })),
  };
  writeFileSync(path.join(args.outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ outputDir: args.outputDir,
    passages: passages.length, sourceUnits: sourceUnits.length,
    input: path.join(args.outputDir, "input.jsonl") }, null, 2));
}

function analyze(assertions, sourceUnits) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  return assertions.map((assertion, index) => {
    const positions = assertion.sourceUnitIds.map((id) => order.get(id))
      .filter(Number.isInteger);
    const first = positions.length ? Math.min(...positions) : null;
    const quarter = first === null ? "unresolved"
      : `Q${Math.min(4, Math.floor((first / sourceUnits.length) * 4) + 1)}`;
    const groundingText = assertion.sourceUnitIds.map((id) =>
      `[${id}] ${unitsById.get(id)?.text ?? "[missing]"}`).join("\n");
    const signals = detectSplitAtomicRepairSignals({ claim: assertion,
      sourceUnitsById: unitsById }).signals;
    return { ...assertion, index: index + 1, quarter, groundingText, signals };
  });
}

function render({ artifact, assertions, selection, sourceUnits, predictions }) {
  const selectedTexts = new Set(selection.selectedClaims.map((item) => item.claimText));
  const selectedDetails = new Map(selection.selected.map((item) =>
    [item.claimText, item]));
  const tableRow = (item, includeUnevaluated = false) => {
    const selected = selectedTexts.has(item.claimText);
    const detail = selectedDetails.get(item.claimText);
    return `<tr class="${selected ? "selected" : ""}">
      <td>${item.index}</td><td>${selected ? "✓" : ""}</td>
      <td>${esc(item.claimText)}</td><td>${esc(item.quarter)}</td>
      <td>${esc(item.sourceUnitIds.join(", "))}</td>
      <td>${esc(item.passageIds.join(", "))}</td>
      <td>${detail?.score ?? "—"}</td><td>${esc(item.signals.join(", ") || "none")}</td>
      ${includeUnevaluated ? `<td class="na">Not evaluated</td>
      <td class="na">Not evaluated</td><td class="na">Not evaluated</td>
      <td class="na">Not evaluated</td>` : ""}
      <td><details><summary>Grounding</summary><pre>${esc(item.groundingText)}</pre></details></td>
    </tr>`;
  };
  const rows = assertions.map((item) => tableRow(item)).join("\n");
  const selectedRows = assertions.filter((item) => selectedTexts.has(item.claimText))
    .map((item) => tableRow(item, true)).join("\n");
  const spotlightIds = artifact.fixture === "CF1-F03"
    ? new Set(["U0008", "U0009", "U0010", "U0011", "U0012"]) : new Set();
  const spotlight = assertions.filter((item) =>
    item.sourceUnitIds.some((unitId) => spotlightIds.has(unitId)));
  const spotlightRows = spotlight.map((item) => tableRow(item, true)).join("\n");
  const errors = predictions.filter((row) => row.error);
  return `<!doctype html><html><head><meta charset="utf-8">
  <title>Bounded adapter + V11 host review</title><style>
  body{font:14px system-ui;margin:24px;color:#18212b}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #c8ced4;padding:7px;text-align:left;vertical-align:top}
  th{background:#edf1f4;position:sticky;top:0}.selected{background:#e8f6e8}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}
  .cards{display:flex;gap:10px;flex-wrap:wrap}.card{padding:10px 14px;border:1px solid #ccd3da;border-radius:8px}
  .notice{background:#fff3cd;border:1px solid #dbc46a;padding:12px;margin:14px 0}
  .na{color:#6b7280;font-style:italic}.spotlight{border-left:5px solid #a04a00;padding-left:14px}
  </style></head><body><h1>${esc(artifact.fixture)} · original bounded adapter prompt + V11 host</h1>
  <p><b>Inference provider:</b> ${esc(artifact.inferenceProvider)}.</p>
  <div class="notice"><b>Scope of this run:</b> ${artifact.passageCount} independent extraction
  calls over non-overlapping passages of at most ${artifact.passageUnitsMaximum} source units,
  followed by V11’s deterministic exact merge and balanced selector. This run did
  <b>not</b> evaluate stance, article treatment, assertion source, pillars, or evidence targets.
  “Not evaluated” below means no model or host attempted that field.</div>
  <div class="cards">${Object.entries(artifact.summary).map(([key, value]) =>
    `<div class="card"><b>${esc(key)}</b><br>${esc(value)}</div>`).join("")}</div>
  <h2>Selected portfolio · ${selection.selectedClaims.length} assertions</h2>
  <table><thead><tr><th>#</th><th>Selected</th><th>Assertion</th><th>Quarter</th>
  <th>Units</th><th>Passages</th><th>Host score</th><th>Atomicity</th>
  <th>Stance</th><th>Article treatment</th><th>Assertion source</th><th>Pillars</th>
  <th>Detail</th></tr></thead><tbody>${selectedRows}</tbody></table>
  ${spotlight.length ? `<section class="spotlight"><h2>F03 opening opponent propositions</h2>
  <p>These are the candidates grounded in U0008–U0012. This section makes extraction
  recall and selection outcome visible; it does not supply stance or attribution.</p>
  <table><thead><tr><th>#</th><th>Selected</th><th>Assertion</th><th>Quarter</th>
  <th>Units</th><th>Passages</th><th>Host score</th><th>Atomicity</th>
  <th>Stance</th><th>Article treatment</th><th>Assertion source</th><th>Pillars</th>
  <th>Detail</th></tr></thead><tbody>${spotlightRows}</tbody></table></section>` : ""}
  <details><summary><b>Complete merged inventory · ${assertions.length} assertions</b></summary>
  <table><thead><tr><th>#</th><th>Selected</th>
  <th>Assertion</th><th>Quarter</th><th>Units</th><th>Passages</th><th>Score</th>
  <th>Atomicity</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>
  </details>
  <details><summary>Failed passage outputs (${errors.length})</summary>
  <pre>${esc(JSON.stringify(errors, null, 2))}</pre></details>
  <details><summary>Exact original adapter prompt</summary><pre>${esc(
    `${SYSTEM}\n\n${JSON.stringify({ input: { sourceUnits: [
      { text: "{{LOCAL_PASSAGE_UNIT}}", unitId: "U####" }] },
    instruction: INSTRUCTION, task: "extract_assertions" }, null, 2)}`)}</pre></details>
  </body></html>`;
}

function finalize(args) {
  if (!args.predictions) throw new Error("--predictions is required for finalize");
  const { article, structuralBlocks, articleDocument } = fixtureData(args.fixture);
  const sourceUnits = articleDocument.sourceUnits;
  const rows = readFileSync(args.predictions, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line));
  const unitsById = new Set(sourceUnits.map((unit) => unit.unitId));
  const raw = [];
  const invalidAssertions = [];
  for (const row of rows) {
    if (row.error || !Array.isArray(row.prediction?.assertions)) continue;
    const owned = new Set(row.passage?.sourceUnitIds ?? []);
    row.prediction.assertions.forEach((item, index) => {
      const claimText = String(item?.proposition ?? item?.assertion ?? "").trim();
      const sourceUnitIds = [...new Set(
        item?.groundingUnitIds ?? item?.sourceUnitIds ?? [],
      )];
      const invalid = !claimText || !sourceUnitIds.length
        || sourceUnitIds.some((id) => !owned.has(id) || !unitsById.has(id));
      if (invalid) {
        invalidAssertions.push({ rowId: row.rowId, item });
        return;
      }
      raw.push({
        candidateId: `${row.passage.passageId}-A${String(index + 1).padStart(2, "0")}`,
        assertionText: claimText,
        claimText,
        sourceUnitIds,
        passageId: row.passage.passageId,
        chunkId: row.passage.passageId,
      });
    });
  }
  const merged = mergeP1aV7Assertions(raw);
  const assertions = analyze(merged.mergedAssertions.map((item) => ({
    ...item,
    passageIds: item.sourceChunkIds ?? [item.chunkId].filter(Boolean),
  })), sourceUnits);
  const selection = selectBalancedCandidatesV2({
    candidateClaims: assertions, sourceUnits, maximum: args.maximum,
  });
  const rawRegions = articleRegionCounts(assertions, sourceUnits);
  const selectedRegions = articleRegionCounts(selection.selectedClaims, sourceUnits);
  const artifact = {
    label: "adapter-original-bounded-plus-v11-host",
    fixture: args.fixture,
    generatedAt: new Date().toISOString(),
    article: { title: article.title, contentHash: article.contentHash,
      sourceUnitCount: sourceUnits.length, structuralBlockCount: structuralBlocks.length },
    passageUnitsMaximum: args.passageUnits,
    passageCount: rows.length,
    inferenceProvider: rows.some((row) => row.provider?.returnedModel)
      ? `OpenAI ${[...new Set(rows.map((row) =>
        row.provider?.returnedModel).filter(Boolean))].join(", ")}`
      : "Tuned Mistral-Nemo adapter",
    summary: {
      validPassages: rows.filter((row) => !row.error).length,
      failedPassages: rows.filter((row) => row.error).length,
      rawAssertions: raw.length,
      invalidGroundings: invalidAssertions.length,
      uniqueAssertions: assertions.length,
      selectedAssertions: selection.selectedClaims.length,
      rawQuarterDistribution: Object.values(rawRegions).join(" / "),
      selectedQuarterDistribution: Object.values(selectedRegions).join(" / "),
      atomicityWarnings: assertions.filter((item) =>
        item.signals.includes("possible_multiple_assertions")).length,
    },
    prompt: { system: SYSTEM, instruction: INSTRUCTION },
    predictionsPath: args.predictions,
    invalidAssertions,
    merge: { summary: merged.summary, duplicateGroups: merged.duplicateGroups },
    selection,
    assertions,
  };
  mkdirSync(args.outputDir, { recursive: true });
  writeFileSync(path.join(args.outputDir, "results.json"),
    JSON.stringify(artifact, null, 2));
  const selected = new Set(selection.selectedClaims.map((item) => item.claimText));
  const headings = ["index", "selected", "assertionText", "sourceUnitIds", "quarter",
    "passageIds", "atomicitySignals", "groundingText"];
  const csvRows = assertions.map((item) => [
    item.index, selected.has(item.claimText), item.claimText,
    item.sourceUnitIds.join(";"), item.quarter, item.passageIds.join(";"),
    item.signals.join(";"), item.groundingText,
  ].map(csv).join(","));
  writeFileSync(path.join(args.outputDir, "claims.csv"),
    `${headings.map(csv).join(",")}\n${csvRows.join("\n")}\n`);
  writeFileSync(path.join(args.outputDir, "report.html"),
    render({ artifact, assertions, selection, sourceUnits, predictions: rows }));
  console.log(JSON.stringify({ summary: artifact.summary,
    report: path.join(args.outputDir, "report.html"),
    csv: path.join(args.outputDir, "claims.csv") }, null, 2));
}

const args = options(process.argv.slice(2));
if (args.mode === "prepare") prepare(args);
else finalize(args);
