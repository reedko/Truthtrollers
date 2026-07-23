#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolDir, "..");
const defaultCandidateDir = path.join(
  projectDir,
  "data",
  "adjudication-candidates",
  "argument-drafts-v1-r2",
);

function parseArgs(argv) {
  const output = { candidateDir: defaultCandidateDir };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--candidate-dir") output.candidateDir = path.resolve(argv[++index]);
    else if (argv[index] === "--help") {
      console.log("Usage: node ml/cf1-argument-model/tools/generate-focused-review-packet.mjs [--candidate-dir DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return output;
}

function readRawJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    raw,
    value: JSON.parse(raw),
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const args = parseArgs(process.argv.slice(2));
const queuePath = path.join(args.candidateDir, "review-queue.json");
const reportPath = path.join(args.candidateDir, "compilation-report.json");
const queueFile = readRawJson(queuePath);
const reportFile = readRawJson(reportPath);
const fixtureIds = Array.from({ length: 9 }, (_, index) =>
  `CF1-F${String(index + 1).padStart(2, "0")}`,
);
const fixtures = fixtureIds.map((fixtureId) => {
  const candidatePath = path.join(args.candidateDir, `${fixtureId}.annotation.candidate.v1.json`);
  const candidateFile = readRawJson(candidatePath);
  const draftPath = path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.argumentDraft.v1.json`);
  const draftFile = readRawJson(draftPath);
  return {
    fixtureId,
    candidatePath,
    candidateSha256: candidateFile.sha256,
    candidate: candidateFile.value,
    draft: draftFile.value,
  };
});
const queue = queueFile.value;

function options(values) {
  return values.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function selectControl(key, field, values, label) {
  return `<label>${escapeHtml(label)}<select class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="${escapeHtml(field)}">${options(values)}</select></label>`;
}

function inputControl(key, field, label, value = "", placeholder = "") {
  return `<label>${escapeHtml(label)}<input class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="${escapeHtml(field)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
}

function textareaControl(key, field, label, value = "", placeholder = "", rows = 2) {
  return `<label>${escapeHtml(label)}<textarea class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="${escapeHtml(field)}" placeholder="${escapeHtml(placeholder)}" rows="${rows}">${escapeHtml(value)}</textarea></label>`;
}

const decisionOptions = [
  ["unreviewed", "Unreviewed"],
  ["accept", "Accept"],
  ["edit", "Edit"],
  ["remove", "Remove"],
  ["uncertain", "Uncertain"],
];
const sourceKindOptions = [
  ["preserve", "Preserve"],
  ["article_voice", "Article voice"],
  ["person", "Person"],
  ["institution", "Institution"],
  ["document", "Document"],
  ["study", "Study"],
  ["legal_party", "Legal party"],
  ["unknown", "Unknown"],
];
const stanceOptions = [
  ["preserve", "Preserve"],
  ["supports_thesis", "Supports thesis"],
  ["contradicts_thesis", "Contradicts thesis"],
  ["neutral", "Neutral"],
  ["unclear", "Unclear"],
];
const deploymentOptions = [
  ["preserve", "Preserve"],
  ["endorsed", "Endorsed"],
  ["opponent_to_rebut", "Opponent to rebut"],
  ["rebutted", "Rebutted"],
  ["qualified", "Qualified"],
  ["reported_neutral", "Reported neutral"],
  ["unclear", "Unclear"],
];
const roleOptions = [
  ["preserve", "Preserve"],
  ["pillar", "Pillar"],
  ["pillar_support", "Pillar support"],
  ["opponent_claim", "Opponent claim"],
  ["rebuttal", "Rebuttal"],
  ["qualification", "Qualification"],
  ["context", "Context"],
  ["unclear", "Unclear"],
];

function assertionSummary(argument) {
  if (!argument) return '<span class="missing">removed or unavailable</span>';
  return `<span class="id">${escapeHtml(argument.argumentUnitId)}</span> ${escapeHtml(argument.canonicalAtomicProposition)}`;
}

function splitChildHtml(fixture, child) {
  const key = `${fixture.fixtureId}:splitChild:${child.argumentUnitId}`;
  const treatment = child.articleTreatment;
  const source = child.assertionSource;
  return `<article class="review-card split-child" data-search="${escapeHtml(normalize([
    child.argumentUnitId,
    child.proposition,
    source.name,
    treatment.contentStance,
    treatment.deployment,
    treatment.role,
    ...(child.grounding.sourceUnitIds ?? []),
  ].join(" ")))}">
    <header><div><span class="id">${escapeHtml(child.argumentUnitId)}</span>${child.portfolio.include ? '<span class="badge include">portfolio</span>' : '<span class="badge exclude">excluded</span>'}</div>${selectControl(key, "decision", decisionOptions, "Decision")}</header>
    <h4>${escapeHtml(child.proposition)}</h4>
    <div class="field-grid">
      <div><b>Source</b><span>${escapeHtml(source.name)} <small>${escapeHtml(source.kind)}</small></span></div>
      <div><b>Stance</b><span>${escapeHtml(treatment.contentStance)}</span></div>
      <div><b>Deployment</b><span>${escapeHtml(treatment.deployment)}</span></div>
      <div><b>Role</b><span>${escapeHtml(treatment.role)}</span></div>
      <div><b>Units</b><span>${escapeHtml(child.grounding.sourceUnitIds.join(", "))}</span></div>
    </div>
    <details open><summary>Grounding</summary><blockquote>${escapeHtml(child.grounding.verbatimExcerpt)}</blockquote></details>
    <div class="edit-grid">
      ${textareaControl(key, "correctedProposition", "Corrected proposition", "", "Leave blank to preserve", 2)}
      ${selectControl(key, "correctedAssertionSourceKind", sourceKindOptions, "Source kind")}
      ${inputControl(key, "correctedAssertionSourceName", "Source name", "", "Leave blank to preserve")}
      ${selectControl(key, "correctedContentStance", stanceOptions, "Content stance")}
      ${selectControl(key, "correctedDeployment", deploymentOptions, "Deployment")}
      ${selectControl(key, "correctedRole", roleOptions, "Role")}
      ${selectControl(key, "portfolioInclude", [["preserve", "Preserve"], ["true", "Include"], ["false", "Exclude"]], "Portfolio")}
      ${textareaControl(key, "notes", "Reviewer notes")}
    </div>
  </article>`;
}

function splitGroupHtml(fixture, sourceId, children) {
  const parent = fixture.draft.argumentUnits.find((argument) => argument.argumentUnitId === sourceId);
  return `<details class="split-group" open><summary><span class="id">${escapeHtml(sourceId)}</span> → ${children.length} children</summary>
    <div class="parent-box"><b>Original compound proposition</b><p>${escapeHtml(parent?.canonicalAtomicProposition ?? "Unavailable")}</p>${parent?.grounding?.verbatimExcerpt ? `<blockquote>${escapeHtml(parent.grounding.verbatimExcerpt)}</blockquote>` : ""}</div>
    ${children.map((child) => splitChildHtml(fixture, child)).join("\n")}
  </details>`;
}

function relationHtml(fixture, item, argumentMap) {
  const relation = item.relation;
  const key = `${fixture.fixtureId}:relation:${relation.relationId}`;
  const fromRows = item.candidateFromArgumentUnitIds.map((id) => assertionSummary(argumentMap.get(id))).join("<br>") || '<span class="missing">removed</span>';
  const toRows = item.candidateToArgumentUnitIds.map((id) => assertionSummary(argumentMap.get(id))).join("<br>") || '<span class="missing">removed</span>';
  return `<article class="review-card relation-card"><header><div><span class="id">${escapeHtml(relation.relationId)}</span><span class="badge relation">${escapeHtml(relation.type)}</span></div>${selectControl(key, "decision", [["unreviewed", "Unreviewed"], ["remap", "Remap"], ["fan_out", "Fan out explicitly"], ["remove", "Remove"], ["uncertain", "Uncertain"]], "Decision")}</header>
    <p><b>Original:</b> ${escapeHtml(relation.fromArgumentUnitId)} → ${escapeHtml(relation.type)} → ${escapeHtml(relation.toArgumentUnitId)}</p>
    <p>${escapeHtml(relation.basis)}</p>
    <div class="endpoint-grid"><div><b>Candidate from</b>${fromRows}</div><div><b>Candidate to</b>${toRows}</div></div>
    <div class="edit-grid">
      ${textareaControl(key, "mappings", "Exact mappings", "", "One per line: FROM_ID | relation_type | TO_ID", 3)}
      ${textareaControl(key, "notes", "Reviewer notes")}
    </div>
  </article>`;
}

function findingHtml(fixture, item, argumentMap) {
  const finding = item.finding;
  const key = `${fixture.fixtureId}:finding:${finding.findingId}`;
  const endpoints = item.endpointReplacements.map((replacement) =>
    `<div><b>${escapeHtml(replacement.sourceArgumentUnitId)}</b> → ${replacement.candidateArgumentUnitIds.map((id) => assertionSummary(argumentMap.get(id))).join("<br>") || '<span class="missing">removed</span>'}</div>`,
  ).join("");
  return `<article class="review-card finding-card"><header><div><span class="id">${escapeHtml(finding.findingId)}</span><span class="badge finding">${escapeHtml(finding.type)}</span></div>${selectControl(key, "decision", [["unreviewed", "Unreviewed"], ["remap", "Remap"], ["remove", "Remove"], ["uncertain", "Uncertain"]], "Decision")}</header>
    <p>${escapeHtml(finding.basis)}</p><div class="endpoint-grid">${endpoints}</div>
    <div class="edit-grid">${inputControl(key, "argumentUnitIds", "Final argument IDs", "", "Comma-separated")}${selectControl(key, "findingType", [["preserve", "Preserve"], ["contradiction", "Contradiction"], ["tension", "Tension"], ["qualification", "Qualification"], ["not_contradiction", "Not contradiction"]], "Finding type")}${textareaControl(key, "notes", "Reviewer notes")}</div>
  </article>`;
}

function coverageHtml(item) {
  const key = `${item.fixtureId}:coverage:${item.coverageId}`;
  return `<article class="review-card"><header><div><span class="id">${escapeHtml(item.coverageId)}</span></div>${selectControl(key, "decision", decisionOptions, "Decision")}</header>
    <p><b>Units:</b> ${escapeHtml(item.sourceUnitIds.join(", "))}</p><p><b>Original:</b> ${escapeHtml(item.originalClassification)} → <b>compiler proposal:</b> ${escapeHtml(item.proposedClassification)}</p>
    <div class="edit-grid">${selectControl(key, "classification", [["uncertain", "Uncertain"], ["material_assertion_present", "Material assertion present"], ["no_material_assertion", "No material assertion"], ["mixed", "Mixed"], ["duplicate_expression", "Duplicate expression"]], "Final classification")}${inputControl(key, "argumentUnitIds", "Linked argument IDs", "", "Comma-separated or blank")}${textareaControl(key, "notes", "Reviewer notes")}</div>
  </article>`;
}

function attributionHtml(item) {
  const key = `${item.fixtureId}:attribution:${item.argumentUnitId}`;
  return `<article class="review-card"><header><div><span class="id">${escapeHtml(item.argumentUnitId)}</span><span class="badge source">unknown source</span></div>${selectControl(key, "decision", [["unreviewed", "Unreviewed"], ["accept_unknown", "Accept unknown"], ["correct", "Correct source"], ["remove", "Remove assertion"], ["uncertain", "Uncertain"]], "Decision")}</header>
    <h4>${escapeHtml(item.proposition)}</h4><blockquote>${escapeHtml(item.grounding.verbatimExcerpt)}</blockquote><p><b>Current:</b> ${escapeHtml(item.assertionSource.name)} (${escapeHtml(item.assertionSource.kind)})</p>
    <div class="edit-grid">${selectControl(key, "sourceKind", sourceKindOptions, "Source kind")}${inputControl(key, "sourceName", "Source name", "", "Required when correcting")}${inputControl(key, "sourceUnitIds", "Source unit IDs", item.assertionSource.sourceUnitIds.join(", "))}${textareaControl(key, "notes", "Reviewer notes")}</div>
  </article>`;
}

function rubricHtml(item) {
  const targets = item.targets.map((target) => {
    const key = `${item.fixtureId}:rubric:${target.targetId}`;
    return `<tr><td>${escapeHtml(target.targetId)}</td><td>${escapeHtml(target.category)}</td><td>${escapeHtml(target.description)}${target.excerpt ? `<blockquote>${escapeHtml(target.excerpt)}</blockquote>` : ""}</td><td>${selectControl(key, "status", [["unreviewed", "Unreviewed"], ["satisfied", "Satisfied"], ["not_satisfied", "Not satisfied"], ["key_needs_revision", "Key needs revision"], ["uncertain", "Uncertain"]], "Status")}${inputControl(key, "argumentUnitIds", "Argument IDs", "", "Comma-separated")}${inputControl(key, "relationIds", "Relation IDs", "", "Comma-separated")}${textareaControl(key, "notes", "Notes")}</td></tr>`;
  }).join("");
  const prohibitions = item.prohibitedInterpretations.map((prohibition) => {
    const key = `${item.fixtureId}:prohibition:${prohibition.prohibitionId}`;
    return `<li><p>${escapeHtml(prohibition.description)}</p>${selectControl(key, "status", [["unreviewed", "Unreviewed"], ["not_violated", "Not violated"], ["violated", "Violated"], ["key_needs_revision", "Key needs revision"], ["uncertain", "Uncertain"]], "Status")}${inputControl(key, "argumentUnitIds", "Affected argument IDs", "", "Comma-separated")}${textareaControl(key, "notes", "Notes")}</li>`;
  }).join("");
  return `<details class="rubric-block"><summary>Evaluation-key reconciliation</summary><div class="warning">The key is a post-draft checklist. Do not rewrite valid annotations merely to echo its wording.</div><h3>Targets</h3><table><thead><tr><th>ID</th><th>Category</th><th>Requirement</th><th>Review</th></tr></thead><tbody>${targets}</tbody></table><h3>Prohibited interpretations</h3><ol>${prohibitions}</ol><h3>Inherited notes</h3><ul>${item.inheritedReviewNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></details>`;
}

function fixtureHtml(fixture) {
  const argumentMap = new Map(fixture.candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
  const splitChildren = queue.splitChildren.filter((item) => item.fixtureId === fixture.fixtureId);
  const splitGroups = groupBy(splitChildren, (item) => item.sourceArgumentUnitId);
  const relations = queue.relations.filter((item) => item.fixtureId === fixture.fixtureId);
  const findings = queue.consistencyFindings.filter((item) => item.fixtureId === fixture.fixtureId);
  const coverage = queue.passageCoverage.filter((item) => item.fixtureId === fixture.fixtureId);
  const attribution = queue.attributionSpotChecks.filter((item) => item.fixtureId === fixture.fixtureId);
  const rubric = queue.rubricCoverage.find((item) => item.fixtureId === fixture.fixtureId);
  const itemCount = splitChildren.length + relations.length + findings.length + coverage.length + attribution.length + (rubric?.targets.length ?? 0) + (rubric?.prohibitedInterpretations.length ?? 0);
  return `<section class="fixture" id="${escapeHtml(fixture.fixtureId)}"><header class="fixture-header"><div><h2>${escapeHtml(fixture.fixtureId)}</h2><span>${itemCount} focused decisions</span></div><span class="fixture-progress" data-fixture-progress="${escapeHtml(fixture.fixtureId)}"></span></header>
    <nav class="section-links"><a href="#${fixture.fixtureId}-splits">Splits (${splitChildren.length})</a><a href="#${fixture.fixtureId}-relations">Relations (${relations.length})</a><a href="#${fixture.fixtureId}-findings">Findings (${findings.length})</a><a href="#${fixture.fixtureId}-coverage">Coverage (${coverage.length})</a><a href="#${fixture.fixtureId}-attribution">Attribution (${attribution.length})</a></nav>
    <section id="${fixture.fixtureId}-splits"><h3>Split-child verification</h3>${splitChildren.length ? `<div class="toolbar"><input class="split-search" data-fixture="${fixture.fixtureId}" placeholder="Search split children"><label><input type="checkbox" class="split-filter" data-fixture="${fixture.fixtureId}" value="portfolio"> Portfolio only</label><span class="visible-count"></span></div>${[...splitGroups].map(([sourceId, children]) => splitGroupHtml(fixture, sourceId, children)).join("\n")}` : "<p>None.</p>"}</section>
    <section id="${fixture.fixtureId}-relations"><h3>Relation remapping</h3>${relations.map((item) => relationHtml(fixture, item, argumentMap)).join("\n") || "<p>None.</p>"}</section>
    <section id="${fixture.fixtureId}-findings"><h3>Consistency-finding remapping</h3>${findings.map((item) => findingHtml(fixture, item, argumentMap)).join("\n") || "<p>None.</p>"}</section>
    <section id="${fixture.fixtureId}-coverage"><h3>Passage coverage</h3>${coverage.map(coverageHtml).join("\n") || "<p>None.</p>"}</section>
    <section id="${fixture.fixtureId}-attribution"><h3>Attribution spot checks</h3>${attribution.map(attributionHtml).join("\n") || "<p>None.</p>"}</section>
    ${rubric ? rubricHtml(rubric) : ""}
  </section>`;
}

const manifest = {
  schemaVersion: "cf1.focusedReviewManifest.v1",
  generatedAt: new Date().toISOString(),
  candidateDirectory: path.relative(projectDir, args.candidateDir),
  reviewQueueSha256: queueFile.sha256,
  compilationReportSha256: reportFile.sha256,
  candidateFiles: fixtures.map((fixture) => ({ fixtureId: fixture.fixtureId, sha256: fixture.candidateSha256 })),
  counts: {
    splitChildren: queue.splitChildren.length,
    unresolvedRelations: queue.relations.length,
    unresolvedConsistencyFindings: queue.consistencyFindings.length,
    unresolvedPassageCoverage: queue.passageCoverage.length,
    attributionSpotChecks: queue.attributionSpotChecks.length,
    rubricTargets: queue.rubricCoverage.reduce((sum, item) => sum + item.targets.length, 0),
    prohibitedInterpretations: queue.rubricCoverage.reduce((sum, item) => sum + item.prohibitedInterpretations.length, 0),
  },
};
const manifestJson = JSON.stringify(manifest).replaceAll("<", "\\u003c");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CF1 Focused Adjudication Review</title><style>
:root{--ink:#19212b;--muted:#667085;--line:#d4dae2;--panel:#fff;--bg:#f2f4f7;--navy:#172b48;--blue:#285ea8;--green:#146c43;--purple:#6b38a1;--amber:#8a5900}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:20px}.hero{background:var(--navy);color:#fff;padding:26px;border-radius:14px}.hero h1{margin:0}.hero p{max-width:1050px}.actions,.toc,.section-links,.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.actions button{padding:8px 12px;border-radius:7px;border:1px solid #a9b4c3;background:#fff;color:var(--navy);font-weight:700;cursor:pointer}.toc{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px;margin:16px 0;position:sticky;top:0;z-index:20}.toc a,.section-links a{color:var(--blue);font-weight:650}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px;margin:16px 0}.metric-grid div{background:#fff;border:1px solid var(--line);padding:12px;border-radius:9px}.metric-grid strong{display:block;font-size:23px}.fixture{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;margin:22px 0;scroll-margin-top:65px}.fixture-header{display:flex;justify-content:space-between;border-bottom:2px solid #e8ebef;align-items:center}.fixture-header h2{margin:0 0 7px}.section-links{padding:10px 0}.fixture section{scroll-margin-top:65px}.fixture section>h3{font-size:20px;border-bottom:1px solid var(--line);padding-bottom:6px}.split-group,.rubric-block{border:1px solid var(--line);border-radius:9px;padding:8px 12px;margin:12px 0}.split-group>summary,.rubric-block>summary{font-weight:750;font-size:16px;cursor:pointer}.parent-box{background:#eef2f7;padding:10px;border-radius:8px;margin:10px 0}.review-card{border:1px solid var(--line);border-left:5px solid #9ba9ba;border-radius:9px;padding:13px;margin:10px 0}.relation-card{border-left-color:var(--purple)}.finding-card{border-left-color:var(--amber)}.review-card header{display:flex;justify-content:space-between;gap:12px;align-items:start}.review-card h4{font-size:16px;margin:8px 0}.id{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace}.badge{display:inline-block;margin-left:5px;padding:2px 7px;border-radius:999px;background:#e9edf2;font-size:11px}.badge.include{background:#dff3e8;color:var(--green)}.badge.exclude{background:#eceef1}.badge.relation{background:#ede2f8;color:var(--purple)}.badge.finding{background:#fff0cf;color:var(--amber)}.badge.source{background:#fce8e8;color:#9c2e2e}.field-grid,.edit-grid,.endpoint-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.field-grid{background:#f7f8fa;padding:9px;border-radius:8px}.field-grid b,.field-grid span{display:block}.field-grid small{color:var(--muted)}.edit-grid{background:#f7fafc;padding:10px;border-radius:8px;margin-top:9px}.endpoint-grid>div{background:#f5f6f8;padding:9px;border-radius:7px}label{display:block;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em}select,input,textarea{display:block;width:100%;font:inherit;border:1px solid #aab4c1;border-radius:6px;padding:6px;background:#fff;color:var(--ink);text-transform:none;letter-spacing:normal}textarea{resize:vertical}blockquote{white-space:pre-wrap;margin:8px 0;padding:8px 12px;border-left:3px solid #9cabc0;background:#f5f7fa}.toolbar{background:#eef2f7;padding:9px;border-radius:8px;position:sticky;top:48px;z-index:10}.toolbar input[type=checkbox]{display:inline;width:auto}.toolbar .split-search{min-width:300px;flex:1}.warning{padding:10px;background:#fff5d6;border:1px solid #e5c769;border-radius:8px;margin:10px 0}.missing{color:#a12e2e;font-style:italic}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--line);padding:7px;vertical-align:top;text-align:left}th{background:#eef1f5}ol li{margin:12px 0}.hidden{display:none!important}.progress{color:#dce7f6}.fixture-progress{color:var(--muted)}@media(max-width:700px){main{padding:7px}.fixture{padding:9px}.toc,.toolbar{position:static}.field-grid,.edit-grid,.endpoint-grid{grid-template-columns:1fr}table{display:block;overflow:auto}}
</style></head><body><main><header class="hero"><h1>CF1 Focused Adjudication Review</h1><p>This is the second-pass queue only. Verify split children against grounding, explicitly remap graph edges, resolve remaining coverage and attribution questions, then reconcile the independent draft against the evaluation key. Evidence targets and warrants remain excluded.</p><div class="actions"><button id="export">Export focused decisions</button><button id="import">Import decisions</button><button id="clear">Clear saved decisions</button><input type="file" id="import-file" accept="application/json" hidden><span class="progress" id="progress"></span></div></header>
<div class="metric-grid"><div><strong>${manifest.counts.splitChildren}</strong>split children</div><div><strong>${manifest.counts.unresolvedRelations}</strong>relations</div><div><strong>${manifest.counts.unresolvedConsistencyFindings}</strong>findings</div><div><strong>${manifest.counts.unresolvedPassageCoverage}</strong>coverage</div><div><strong>${manifest.counts.attributionSpotChecks}</strong>attribution</div><div><strong>${manifest.counts.rubricTargets}</strong>key targets</div><div><strong>${manifest.counts.prohibitedInterpretations}</strong>prohibitions</div></div>
<nav class="toc"><b>Fixtures:</b>${fixtureIds.map((fixtureId) => `<a href="#${fixtureId}">${fixtureId}</a>`).join("")}</nav>
${fixtures.map(fixtureHtml).join("\n")}
</main><script>const manifest=${manifestJson};const storageKey="cf1-focused-adjudication-review-r2";let decisions={};try{decisions=JSON.parse(localStorage.getItem(storageKey)||"{}")}catch{decisions={}}function save(){localStorage.setItem(storageKey,JSON.stringify(decisions));progress()}function controls(){document.querySelectorAll(".review-control").forEach(control=>{const key=control.dataset.reviewKey,field=control.dataset.reviewField;if(decisions[key]?.[field]!==undefined)control.value=decisions[key][field];const update=()=>{decisions[key]??={};decisions[key][field]=control.value;save()};control.addEventListener("change",update);control.addEventListener("input",update)})}function progress(){const reviewed=Object.values(decisions).filter(item=>item.decision&&item.decision!=="unreviewed"||item.status&&item.status!=="unreviewed").length;document.getElementById("progress").textContent=reviewed+" decisions recorded locally";document.querySelectorAll("[data-fixture-progress]").forEach(node=>{const prefix=node.dataset.fixtureProgress+":";const count=Object.entries(decisions).filter(([key,value])=>key.startsWith(prefix)&&(value.decision&&value.decision!=="unreviewed"||value.status&&value.status!=="unreviewed")).length;node.textContent=count+" reviewed"})}function filterSplits(fixtureId){const fixture=document.getElementById(fixtureId);const query=String(fixture.querySelector(".split-search")?.value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();const portfolio=fixture.querySelector(".split-filter")?.checked;let visible=0;fixture.querySelectorAll(".split-child").forEach(card=>{const show=(!query||card.dataset.search.includes(query))&&(!portfolio||card.querySelector(".badge.include"));card.classList.toggle("hidden",!show);if(show)visible++});const counter=fixture.querySelector(".visible-count");if(counter)counter.textContent=visible+" visible"}document.querySelectorAll(".split-search,.split-filter").forEach(control=>control.addEventListener("input",()=>filterSplits(control.dataset.fixture)));document.getElementById("export").addEventListener("click",()=>{const payload={schemaVersion:"cf1.focusedAdjudicationReviewDecisions.v1",exportedAt:new Date().toISOString(),manifest,decisions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="CF1-focused-adjudication-review-decisions-r2.json";link.click();URL.revokeObjectURL(link.href)});document.getElementById("import").addEventListener("click",()=>document.getElementById("import-file").click());document.getElementById("import-file").addEventListener("change",async event=>{const file=event.target.files[0];if(!file)return;const payload=JSON.parse(await file.text());decisions=payload.decisions||{};save();location.reload()});document.getElementById("clear").addEventListener("click",()=>{if(confirm("Clear all locally saved focused-review decisions?")){decisions={};save();location.reload()}});controls();progress();${JSON.stringify(fixtureIds)}.forEach(filterSplits);</script></body></html>`;

const outputDir = path.join(args.candidateDir, "focused-review");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "focused-review.html"), html);
fs.writeFileSync(path.join(outputDir, "focused-review-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(path.join(outputDir, "focused-review.html"));
console.log(path.join(outputDir, "focused-review-manifest.json"));
