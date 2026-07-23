#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values[key.slice(2)] = value;
  }
  for (const required of ["predictions", "validation", "scores", "output"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  return values;
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function equal(left, right) {
  return normalized(left) === normalized(right);
}

function tokenF1(left, right) {
  const leftTokens = new Set(normalized(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalized(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  if (!overlap) return 0;
  const precision = overlap / rightTokens.size;
  const recall = overlap / leftTokens.size;
  return (2 * precision * recall) / (precision + recall);
}

function inputFor(validationRow) {
  const user = validationRow?.prompt?.find((message) => message.role === "user");
  if (!user) return {};
  try {
    return JSON.parse(user.content).input ?? {};
  } catch {
    return {};
  }
}

function sourceUnits(input) {
  return input.sourceUnits ?? input.localContext ?? [];
}

function renderUnits(units) {
  if (!units?.length) return "";
  return `<div class="units">${units
    .map(
      (unit) =>
        `<div class="unit"><span>${escapeHtml(unit.unitId)}</span>${escapeHtml(unit.text)}</div>`,
    )
    .join("")}</div>`;
}

function badge(label, tone = "") {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function compareFields(expected, predicted, fields) {
  return `<div class="field-grid">${fields
    .map((field) => {
      const matches = predicted && equal(expected?.[field], predicted?.[field]);
      return `<div class="field-row ${matches ? "match" : "miss"}">
        <div class="field-name">${escapeHtml(field)}</div>
        <div><small>GOLD</small>${escapeHtml(JSON.stringify(expected?.[field] ?? null))}</div>
        <div><small>MODEL</small>${escapeHtml(JSON.stringify(predicted?.[field] ?? null))}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function extractionComparison(expected, predicted) {
  const gold = expected?.assertions ?? [];
  const guesses = predicted?.assertions ?? [];
  const matches = gold.map((item) => {
    let best = null;
    for (const guess of guesses) {
      const score = tokenF1(item.proposition, guess.proposition);
      if (!best || score > best.score) best = { guess, score };
    }
    return { item, ...best };
  });
  return `<div class="extract-grid">
    <div><h5>Gold assertions (${gold.length})</h5>${matches
      .map(({ item, guess, score }) => {
        const tone = score >= 0.68 ? "good" : score >= 0.4 ? "warn" : "bad";
        return `<div class="assertion">
          ${badge(`best overlap ${(score * 100).toFixed(0)}%`, tone)}
          <strong>${escapeHtml(item.proposition)}</strong>
          <small>Units: ${escapeHtml((item.groundingUnitIds ?? []).join(", "))}</small>
          ${guess ? `<div class="paired">Closest model: ${escapeHtml(guess.proposition)}</div>` : ""}
        </div>`;
      })
      .join("")}</div>
    <div><h5>Model assertions (${guesses.length})</h5>${guesses
      .map(
        (item) => `<div class="assertion">
          <strong>${escapeHtml(item.proposition)}</strong>
          <small>Units: ${escapeHtml((item.groundingUnitIds ?? []).join(", "))}</small>
        </div>`,
      )
      .join("")}</div>
  </div>`;
}

const taskFields = {
  detect_assertions: ["classification"],
  attribute: ["kind", "name", "sourceUnitIds"],
  deploy: ["contentStance", "deployment", "role"],
  select: ["include"],
  relate: ["relationType"],
  orient: ["theme", "thesis", "thesisStatus"],
};

function rowStatus(row) {
  if (!row.prediction) return "error";
  if (row.task === "extract_assertions") {
    const gold = row.expected.assertions ?? [];
    const guesses = row.prediction.assertions ?? [];
    const best = gold.map((item) =>
      Math.max(0, ...guesses.map((guess) => tokenF1(item.proposition, guess.proposition))),
    );
    return gold.length === guesses.length && best.every((score) => score >= 0.68)
      ? "match"
      : best.some((score) => score >= 0.4)
        ? "partial"
        : "miss";
  }
  return (taskFields[row.task] ?? []).every((field) =>
    equal(row.expected?.[field], row.prediction?.[field]),
  )
    ? "match"
    : "miss";
}

function renderRow(row, validationRow) {
  const input = inputFor(validationRow);
  const status = rowStatus(row);
  let subject = input.proposition ?? input.from?.proposition ?? "";
  if (row.task === "detect_assertions") {
    subject = sourceUnits(input)[0]?.text ?? "";
  } else if (row.task === "extract_assertions") {
    subject = sourceUnits(input)[0]?.text ?? "";
  } else if (row.task === "relate") {
    subject = `${input.from?.proposition ?? ""} → ${input.to?.proposition ?? ""}`;
  } else if (row.task === "orient") {
    subject = "Whole-article orientation";
  }

  const units =
    row.task === "relate"
      ? [...(input.from?.localContext ?? []), ...(input.to?.localContext ?? [])]
      : sourceUnits(input);

  let comparison = "";
  if (row.task === "extract_assertions") {
    comparison = extractionComparison(row.expected, row.prediction);
  } else if (row.task === "orient" && !row.prediction) {
    comparison = `<div class="orientation-failure"><strong>Model text (invalid JSON)</strong><p>${escapeHtml(
      row.predictionText,
    )}</p></div>`;
  } else {
    comparison = compareFields(row.expected, row.prediction, taskFields[row.task] ?? []);
  }

  return `<details class="result ${status}" data-task="${escapeHtml(row.task)}" data-status="${status}">
    <summary>
      ${badge(status.toUpperCase(), status === "match" ? "good" : status === "partial" ? "warn" : "bad")}
      <code>${escapeHtml(row.rowId)}</code>
      <span class="subject">${escapeHtml(subject)}</span>
    </summary>
    <div class="detail-body">
      ${renderUnits(units)}
      ${comparison}
      <details class="raw"><summary>Raw expected and prediction</summary>
        <pre>${escapeHtml(JSON.stringify({ expected: row.expected, prediction: row.prediction, error: row.error }, null, 2))}</pre>
      </details>
    </div>
  </details>`;
}

function metricCard(label, value, note, tone = "") {
  return `<div class="metric ${tone}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(
    label,
  )}</span><small>${escapeHtml(note)}</small></div>`;
}

const args = parseArgs(process.argv);
const predictions = readJsonl(args.predictions);
const validation = new Map(readJsonl(args.validation).map((row) => [row.rowId, row]));
const scores = JSON.parse(fs.readFileSync(args.scores, "utf8"));

const deploymentRows = predictions.filter((row) => row.task === "deploy" && row.prediction);
const opponentRows = deploymentRows.filter(
  (row) => row.expected.contentStance === "contradicts_thesis",
);
const opponentHits = opponentRows.filter(
  (row) => row.prediction.contentStance === "contradicts_thesis",
).length;
const detectionRows = predictions.filter((row) => row.task === "detect_assertions");
const materialRows = detectionRows.filter(
  (row) => row.expected.classification === "material_assertion_present",
);
const materialHits = materialRows.filter(
  (row) => row.prediction?.classification === "material_assertion_present",
).length;
const falsePositiveDetection = detectionRows.filter(
  (row) =>
    row.expected.classification === "no_material_assertion" &&
    row.prediction?.classification === "material_assertion_present",
).length;
const selectionRows = predictions.filter((row) => row.task === "select");
const goldIncluded = selectionRows.filter((row) => row.expected.include === true);
const includedHits = goldIncluded.filter((row) => row.prediction?.include === true).length;
const rebuttalRows = predictions.filter(
  (row) => row.task === "relate" && row.expected.relationType === "rebuts",
);
const rebuttalHits = rebuttalRows.filter(
  (row) => row.prediction?.relationType === "rebuts",
).length;

const taskOrder = [
  "orient",
  "detect_assertions",
  "extract_assertions",
  "attribute",
  "deploy",
  "select",
  "relate",
];

const sections = taskOrder
  .map((task) => {
    const rows = predictions.filter((row) => row.task === task);
    const counts = rows.reduce(
      (acc, row) => {
        acc[rowStatus(row)] += 1;
        return acc;
      },
      { match: 0, partial: 0, miss: 0, error: 0 },
    );
    return `<section id="${task}" class="task-section">
      <h2>${escapeHtml(task.replaceAll("_", " "))}</h2>
      <p>${rows.length} rows · ${counts.match} exact field matches · ${counts.partial} partial extraction matches · ${
        counts.miss + counts.error
      } misses/errors</p>
      ${rows.map((row) => renderRow(row, validation.get(row.rowId))).join("")}
    </section>`;
  })
  .join("");

const opponentTable = opponentRows
  .map((row) => {
    const input = inputFor(validation.get(row.rowId));
    const correct = row.prediction.contentStance === "contradicts_thesis";
    return `<tr class="${correct ? "correct-row" : "wrong-row"}"><td>${escapeHtml(
      input.proposition,
    )}</td><td>${escapeHtml(row.expected.contentStance)}</td><td>${escapeHtml(
      row.prediction.contentStance,
    )}</td><td>${escapeHtml(row.prediction.deployment)}</td></tr>`;
  })
  .join("");

const missedPortfolio = goldIncluded
  .filter((row) => row.prediction?.include !== true)
  .map((row) => `<li>${escapeHtml(inputFor(validation.get(row.rowId)).proposition)}</li>`)
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CF1-F03 Held-out Model Review</title>
<style>
:root{--bg:#f4f1e9;--paper:#fffdf7;--ink:#25231f;--muted:#706c62;--line:#d8d1c2;--good:#237a52;--bad:#ad3c32;--warn:#a66a19;--blue:#315e82}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{background:#1f2b26;color:#fff;padding:36px max(24px,calc((100vw - 1260px)/2));border-bottom:6px solid #c5a35c}header h1{margin:0 0 8px;font:700 34px/1.1 Georgia,serif}header p{margin:0;color:#d8e0dc;max-width:900px}
main{max-width:1260px;margin:auto;padding:24px}.notice{background:#fff3d6;border:1px solid #dfbd72;border-left:6px solid var(--warn);padding:16px;margin:0 0 20px;border-radius:8px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:20px 0}.metric{background:var(--paper);border:1px solid var(--line);border-top:5px solid var(--blue);border-radius:8px;padding:14px}.metric.good{border-top-color:var(--good)}.metric.bad{border-top-color:var(--bad)}.metric.warn{border-top-color:var(--warn)}.metric strong{display:block;font-size:27px}.metric span{display:block;font-weight:700}.metric small{display:block;color:var(--muted);margin-top:4px}
nav{position:sticky;top:0;z-index:3;background:rgba(244,241,233,.96);backdrop-filter:blur(8px);padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap}nav a,button{border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:7px 10px;border-radius:18px;text-decoration:none;cursor:pointer}
h2{font:700 27px Georgia,serif;margin:35px 0 4px;text-transform:capitalize}.task-section>p{color:var(--muted);margin-top:0}
.core{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.panel{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:18px;overflow:auto}.panel h3{margin-top:0;font:700 21px Georgia,serif}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.wrong-row{background:#fff0ee}.correct-row{background:#ebf7f0}
.result{background:var(--paper);border:1px solid var(--line);border-left:5px solid var(--bad);border-radius:7px;margin:8px 0}.result.match{border-left-color:var(--good)}.result.partial{border-left-color:var(--warn)}.result summary{display:flex;align-items:center;gap:9px;padding:10px 12px;cursor:pointer}.subject{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#47443e}.detail-body{padding:0 14px 16px}
.badge{display:inline-block;border-radius:12px;padding:2px 7px;font-size:11px;font-weight:800;background:#e6e2d8}.badge.good{color:#fff;background:var(--good)}.badge.bad{color:#fff;background:var(--bad)}.badge.warn{color:#fff;background:var(--warn)}
.units{border:1px solid var(--line);border-radius:6px;margin:8px 0 14px}.unit{padding:8px 10px;border-bottom:1px solid var(--line)}.unit:last-child{border:0}.unit span{font:700 12px ui-monospace,monospace;color:var(--blue);margin-right:9px}
.field-grid{display:grid;gap:6px}.field-row{display:grid;grid-template-columns:150px 1fr 1fr;gap:10px;padding:8px;border-radius:5px;background:#fff0ee}.field-row.match{background:#ebf7f0}.field-name{font-weight:800}.field-row small,.assertion small{display:block;color:var(--muted);font-size:10px;letter-spacing:.08em}
.extract-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.assertion{border:1px solid var(--line);border-radius:6px;padding:10px;margin:7px 0}.assertion strong{display:block;margin:5px 0}.paired{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);color:var(--muted)}
.raw{margin-top:14px}.raw pre{white-space:pre-wrap;background:#222;color:#e9e5da;padding:12px;border-radius:6px;max-height:500px;overflow:auto}.orientation-failure{background:#fff0ee;padding:12px;border-radius:6px}
.hidden{display:none!important}ol,ul{padding-left:22px}@media(max-width:800px){.core,.extract-grid{grid-template-columns:1fr}.field-row{grid-template-columns:1fr}.subject{white-space:normal}header{padding:26px 20px}}
</style>
</head>
<body>
<header><h1>CF1-F03 Held-out Model Review</h1><p>Mistral-Nemo public argument-mining warm-up followed by CF1 specialization on eight fixtures. F03 was excluded from CF1 specialization.</p></header>
<main>
<div class="notice"><strong>Bottom line:</strong> the model learned high-recall assertion detection and dominant supportive labels, but it did not solve opponent recognition, portfolio inclusion, or reliable source naming. Overall accuracy figures are inflated by label imbalance.</div>
<div class="metrics">
${metricCard("Valid JSON", "637 / 638", "One orientation formatting failure", "good")}
${metricCard("Material recall", `${materialHits} / ${materialRows.length}`, `${falsePositiveDetection} nonclaim false positives`, "good")}
${metricCard("Opponent stance", `${opponentHits} / ${opponentRows.length}`, "Six opponent claims flattened into support", "bad")}
${metricCard("Portfolio inclusion", `${includedHits} / ${goldIncluded.length}`, "Model selected nothing", "bad")}
${metricCard("Source kind", `${(scores.fieldMetrics["attribute.kind"] * 100).toFixed(1)}%`, "Exact source name was 3.3%", "bad")}
${metricCard("Grounding units", `${(scores.fieldMetrics["attribute.sourceUnitIds"] * 100).toFixed(1)}%`, "The local source passages were usually correct", "good")}
${metricCard("Rebuttal relations", `${rebuttalHits} / ${rebuttalRows.length}`, "Strong result on explicit rebuttals", "good")}
${metricCard("All relation types", `${(scores.fieldMetrics["relate.relationType"] * 100).toFixed(1)}%`, "Supports vs provides-evidence confusion", "warn")}
</div>
<div class="core">
  <div class="panel"><h3>All ten opponent-stance cases</h3><table><thead><tr><th>Proposition</th><th>Gold</th><th>Model stance</th><th>Model deployment</th></tr></thead><tbody>${opponentTable}</tbody></table></div>
  <div class="panel"><h3>All 22 portfolio inclusions missed</h3><ol>${missedPortfolio}</ol></div>
</div>
<nav>${taskOrder.map((task) => `<a href="#${task}">${escapeHtml(task.replaceAll("_", " "))}</a>`).join("")}
<button data-filter="all">All</button><button data-filter="miss">Misses</button><button data-filter="partial">Partial</button><button data-filter="match">Matches</button></nav>
${sections}
</main>
<script>
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  const filter=button.dataset.filter;
  document.querySelectorAll(".result").forEach(row=>row.classList.toggle("hidden",filter!=="all"&&row.dataset.status!==filter));
}));
</script>
</body></html>`;

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, html);
console.log(args.output);
