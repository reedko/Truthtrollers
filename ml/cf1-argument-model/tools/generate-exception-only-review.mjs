#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { resolveFocusedExceptions } from "./lib/focused-exception-resolver.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolDir, "..");
const defaultCandidateDir = path.join(projectDir, "data", "adjudication-candidates", "argument-drafts-v1-r2");
const defaultDecisions = path.join(projectDir, "data", "annotation-prompts", "CF1-argument-drafts-v1-review-decisions-normalized.json");

function parseArgs(argv) {
  const args = { candidateDir: defaultCandidateDir, decisions: defaultDecisions, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--candidate-dir") args.candidateDir = path.resolve(argv[++index]);
    else if (token === "--decisions") args.decisions = path.resolve(argv[++index]);
    else if (token === "--output") args.output = path.resolve(argv[++index]);
    else if (token === "--help") {
      console.log("Usage: node ml/cf1-argument-model/tools/generate-exception-only-review.mjs [--candidate-dir DIR] [--decisions FILE] [--output DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  args.output ??= path.join(args.candidateDir, "exception-review");
  return args;
}

function readRawJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { raw, value: JSON.parse(raw), sha256: sha256(raw) };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function optionRows(values) {
  return values.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
}

function select(key, field, values, label) {
  return `<label>${esc(label)}<select class="review" data-key="${esc(key)}" data-field="${esc(field)}">${optionRows(values)}</select></label>`;
}

function input(key, field, label, placeholder = "") {
  return `<label>${esc(label)}<input class="review" data-key="${esc(key)}" data-field="${esc(field)}" placeholder="${esc(placeholder)}"></label>`;
}

function textarea(key, field, label, placeholder = "") {
  return `<label>${esc(label)}<textarea class="review" data-key="${esc(key)}" data-field="${esc(field)}" rows="3" placeholder="${esc(placeholder)}"></textarea></label>`;
}

const commonDecision = [["unreviewed", "Unreviewed"], ["accept", "Accept"], ["edit", "Edit"], ["remove", "Remove"], ["uncertain", "Uncertain"]];

function endpointRows(endpoint) {
  return endpoint.candidates.map((candidate) => `<li><code>${esc(candidate.argumentUnitId)}</code> <b>${candidate.score.toFixed(3)}</b> — ${esc(candidate.proposition)}</li>`).join("");
}

function candidateRows(candidates) {
  return (candidates ?? []).map((candidate) => `<li><code>${esc(candidate.kind)}:${esc(candidate.id)}</code> <b>${Number(candidate.score).toFixed(3)}</b> — ${esc(candidate.text ?? "")}</li>`).join("");
}

function splitInstructions(item) {
  const instructions = [];
  if (item.reasons.includes("proposition_number_absent_from_grounding")) instructions.push("A number in the proposition is still unsupported. Add the exact supporting source unit, remove that number from the proposition, or remove the child.");
  if (item.reasons.includes("low_independent_grounding_overlap")) instructions.push("The inherited excerpt does not independently support enough of this child. Correct the proposition or grounding, or remove the child.");
  if (item.reasons.includes("child_text_contains_external_attribution_but_source_is_article_voice")) instructions.push("Decide whether the named supplier, rather than the article voice, should be the assertion source.");
  if (item.reasons.includes("opponent_role_deployment_mismatch")) instructions.push("Resolve the incompatible opponent role and deployment; preserve the proposition itself unless it is also wrong.");
  return instructions.join(" ");
}

function splitCard(item) {
  const key = `${item.fixtureId}:splitChild:${item.argumentUnitId}`;
  const augmentation = item.assessment.groundingAugmentation ?? [];
  return `<article class="card split"><header><code>${esc(key)}</code>${select(key, "decision", commonDecision, "Decision")}</header>
    <div class="reason">${item.reasons.map(esc).join(" · ")}</div>
    <p class="instruction"><b>What you need to decide:</b> ${esc(splitInstructions(item))}</p>
    <h4>${esc(item.proposition)}</h4><p><b>Approved split line:</b> ${esc(item.expectedApprovedLine)}</p>
    <div class="facts"><span><b>Source</b>${esc(item.assertionSource.name)} (${esc(item.assertionSource.kind)})</span><span><b>Stance</b>${esc(item.articleTreatment.contentStance)}</span><span><b>Deployment</b>${esc(item.articleTreatment.deployment)}</span><span><b>Role</b>${esc(item.articleTreatment.role)}</span><span><b>Portfolio</b>${item.portfolio.include ? "include" : "exclude"}</span><span><b>Grounding overlap</b>${esc(item.assessment.groundingOverlap)}</span></div>
    <details open><summary>Grounding and lineage</summary><blockquote>${esc(item.grounding.verbatimExcerpt)}</blockquote>${augmentation.length ? `<p><b>Deterministic supporting-unit candidates:</b> ${augmentation.map((unit) => esc(unit.unitId)).join(", ")}</p>${augmentation.map((unit) => `<blockquote>${esc(unit.verbatimExcerpt)}</blockquote>`).join("")}` : ""}<p>Units: ${esc(item.grounding.sourceUnitIds.join(", "))} · parent ${esc(item.sourceArgumentUnitId)} · child ${esc(item.assessment.lineage.childOrdinal)}/${esc(item.assessment.lineage.childCount)}</p></details>
    <div class="controls">${textarea(key, "correctedProposition", "Corrected proposition")}${input(key, "correctedGroundingUnitIds", "Corrected grounding unit IDs", "comma-separated")}${textarea(key, "correctedGroundingExcerpt", "Corrected grounding excerpt")}${input(key, "correctedSource", "Corrected source")}${input(key, "correctedTreatment", "Corrected stance / deployment / role")}${select(key, "portfolioInclude", [["preserve", "Preserve"], ["true", "Include"], ["false", "Exclude"]], "Portfolio")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function relationCard(item) {
  const key = `${item.fixtureId}:relation:${item.relation.relationId}`;
  return `<article class="card graph"><header><code>${esc(key)}</code>${select(key, "decision", [["unreviewed", "Unreviewed"], ["remap", "Remap"], ["fan_out", "Fan out"], ["remove", "Remove"], ["uncertain", "Uncertain"]], "Decision")}</header><div class="reason">${esc(item.reasons.join(" · "))}</div><p><b>${esc(item.relation.fromArgumentUnitId)} → ${esc(item.relation.type)} → ${esc(item.relation.toArgumentUnitId)}</b></p><p>${esc(item.relation.basis)}</p><div class="two"><div><h4>From candidates</h4><ul>${endpointRows(item.endpointAssessment.from)}</ul></div><div><h4>To candidates</h4><ul>${endpointRows(item.endpointAssessment.to)}</ul></div></div><div class="controls">${textarea(key, "mappings", "Final mappings", "FROM | type | TO")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function findingCard(item) {
  const key = `${item.fixtureId}:finding:${item.finding.findingId}`;
  return `<article class="card graph"><header><code>${esc(key)}</code>${select(key, "decision", [["unreviewed", "Unreviewed"], ["remap", "Remap"], ["remove", "Remove"], ["uncertain", "Uncertain"]], "Decision")}</header><div class="reason">${esc(item.reasons.join(" · "))}</div><p><b>${esc(item.finding.type)}</b> — ${esc(item.finding.basis)}</p>${item.endpointAssessment.map((endpoint) => `<h4>Original endpoint ${esc(endpoint.sourceArgumentUnitId)}</h4><ul>${endpointRows(endpoint)}</ul>`).join("")}<div class="controls">${input(key, "argumentUnitIds", "Final argument IDs", "comma-separated")}${input(key, "findingType", "Finding type")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function targetCard(item) {
  const target = item.target;
  const key = `${item.fixtureId}:rubric:${target.targetId}`;
  return `<article class="card key"><header><code>${esc(key)}</code>${select(key, "status", [["unreviewed", "Unreviewed"], ["missing", "Confirmed missing"], ["matched", "Resolve as matched"], ["key_error", "Key error"], ["uncertain", "Uncertain"]], "Decision")}</header><div class="reason">${esc(item.resolution.status)} — ${esc(item.resolution.basis)}</div><h4>${esc(target.description)}</h4>${target.excerpt ? `<blockquote>${esc(target.excerpt)}</blockquote>` : ""}<details open><summary>Closest compiled records</summary><ol>${candidateRows(item.resolution.candidates)}</ol></details><div class="controls">${input(key, "argumentUnitIds", "Matched argument IDs")}${input(key, "relationIds", "Matched relation IDs")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function prohibitionCard(item) {
  const prohibition = item.prohibition;
  const key = `${item.fixtureId}:prohibition:${prohibition.prohibitionId}`;
  return `<article class="card danger"><header><code>${esc(key)}</code>${select(key, "status", [["unreviewed", "Unreviewed"], ["violated", "Violation"], ["not_violated", "Not violated"], ["key_error", "Key error"], ["uncertain", "Uncertain"]], "Decision")}</header><div class="reason">${esc(item.resolution.status)} — ${esc(item.resolution.basis)}</div><h4>${esc(prohibition.description)}</h4><details open><summary>Closest compiled records</summary><ol>${candidateRows(item.resolution.candidates)}</ol></details><div class="controls">${input(key, "argumentUnitIds", "Affected argument IDs")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function coverageCard(item) {
  const key = `${item.fixtureId}:coverage:${item.coverageId}`;
  return `<article class="card"><header><code>${esc(key)}</code>${select(key, "decision", commonDecision, "Decision")}</header><p>${esc(item.basis)}</p><p>Units: ${esc(item.sourceUnitIds.join(", "))} · ${esc(item.originalClassification)} → ${esc(item.proposedClassification)}</p><div class="controls">${input(key, "classification", "Final classification")}${input(key, "argumentUnitIds", "Argument IDs")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function attributionCard(item) {
  const key = `${item.fixtureId}:attribution:${item.argumentUnitId}`;
  return `<article class="card"><header><code>${esc(key)}</code>${select(key, "decision", [["unreviewed", "Unreviewed"], ["accept_unknown", "Accept unknown"], ["correct", "Correct source"], ["remove", "Remove"], ["uncertain", "Uncertain"]], "Decision")}</header><h4>${esc(item.proposition)}</h4><blockquote>${esc(item.grounding.verbatimExcerpt)}</blockquote><p>${esc(item.reason)}</p><div class="controls">${input(key, "sourceKind", "Source kind")}${input(key, "sourceName", "Source name")}${input(key, "sourceUnitIds", "Source unit IDs")}${textarea(key, "notes", "Notes")}</div></article>`;
}

function section(title, items, render, id) {
  return `<section id="${id}"><h2>${esc(title)} <span>${items.length}</span></h2>${items.length ? items.map(render).join("\n") : "<p class=empty>No exceptions.</p>"}</section>`;
}

function markdownReport(report) {
  const auto = Object.entries(report.autoResolved).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  const review = Object.entries(report.requiringReview).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  return `# CF1 Exception-only Adjudication Report\n\nGenerated: ${report.generatedAt}\n\n## Automatically resolved\n\n${auto}\n\n## Requires human review\n\n${review}\n\n## Safeguards\n\n- Fixtures approved: no\n- Training rows generated: no\n- Evidence targets and warrants remain excluded: yes\n- Immutable candidate inputs were not modified.\n`;
}

const args = parseArgs(process.argv.slice(2));
if (fs.existsSync(args.output)) throw new Error(`Refusing to overwrite existing exception packet: ${args.output}`);
const queueFile = readRawJson(path.join(args.candidateDir, "review-queue.json"));
const reportFile = readRawJson(path.join(args.candidateDir, "compilation-report.json"));
const decisionsFile = readRawJson(args.decisions);
const fixtureIds = Array.from({ length: 9 }, (_, index) => `CF1-F${String(index + 1).padStart(2, "0")}`);
const fixtures = fixtureIds.map((fixtureId) => {
  const candidatePath = path.join(args.candidateDir, `${fixtureId}.annotation.candidate.v1.json`);
  const candidateFile = readRawJson(candidatePath);
  const draftPath = path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.argumentDraft.v1.json`);
  const draftFile = readRawJson(draftPath);
  const promptPath = path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.chat-prompt.md`);
  const promptRaw = fs.readFileSync(promptPath, "utf8");
  return { fixtureId, candidate: candidateFile.value, draft: draftFile.value, sourceText: promptRaw, candidateSha256: candidateFile.sha256, draftSha256: draftFile.sha256, sourcePromptSha256: sha256(promptRaw) };
});
const generatedAt = new Date().toISOString();
const provenance = {
  candidateDirectory: path.relative(projectDir, args.candidateDir),
  reviewQueueSha256: queueFile.sha256,
  compilationReportSha256: reportFile.sha256,
  reviewedDecisionsPath: path.relative(projectDir, args.decisions),
  reviewedDecisionsSha256: decisionsFile.sha256,
  fixtureInputs: fixtures.map(({ fixtureId, candidateSha256, draftSha256, sourcePromptSha256 }) => ({ fixtureId, candidateSha256, draftSha256, sourcePromptSha256 })),
};
const result = resolveFocusedExceptions({ fixtures, queue: queueFile.value, reviewedDecisions: decisionsFile.value, generatedAt, provenance });
const expectedByCategory = {
  splitChildren: queueFile.value.splitChildren.length,
  relations: queueFile.value.relations.length,
  consistencyFindings: queueFile.value.consistencyFindings.length,
  rubricTargets: queueFile.value.rubricCoverage.reduce((sum, item) => sum + item.targets.length, 0),
  prohibitedInterpretations: queueFile.value.rubricCoverage.reduce((sum, item) => sum + item.prohibitedInterpretations.length, 0),
};
for (const [category, expected] of Object.entries(expectedByCategory)) {
  const observed = result.report.autoResolved[category] + result.report.requiringReview[category];
  if (observed !== expected) throw new Error(`${category} accounting mismatch: expected ${expected}, observed ${observed}`);
}
const totalAuto = Object.values(result.report.autoResolved).reduce((sum, value) => sum + value, 0);
const totalReview = Object.values(result.report.requiringReview).reduce((sum, value) => sum + value, 0);
result.report.totalAutoResolved = totalAuto;
result.report.totalRequiringReview = totalReview;
result.report.originalFocusedControls = totalAuto + totalReview;

const e = result.exceptions;
const manifest = { schemaVersion: "cf1.exceptionReviewManifest.v1", generatedAt, provenance, counts: result.report.requiringReview, totalRequiringReview: totalReview, evidenceTargetsExcluded: true, fixturesApproved: false, trainingRowsGenerated: false };
const embeddedManifest = JSON.stringify(manifest).replaceAll("<", "\\u003c");
const metrics = [...Object.entries(result.report.autoResolved).map(([key, value]) => `<div><b>${value}</b><span>auto ${esc(key)}</span></div>`), ...Object.entries(result.report.requiringReview).map(([key, value]) => `<div class="reviewMetric"><b>${value}</b><span>review ${esc(key)}</span></div>`)].join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CF1 Exception-only Adjudication</title><style>
:root{--navy:#12233d;--ink:#1d2939;--muted:#667085;--line:#d0d5dd;--bg:#f4f6f8;--blue:#235aa6;--amber:#996300;--red:#a52828}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:20px}.hero{background:var(--navy);color:white;padding:24px;border-radius:14px}.hero h1{margin:0}.hero p{max-width:980px}.actions,.toc,.metrics,.controls,.facts,.two{display:flex;gap:10px;flex-wrap:wrap}.actions button{padding:8px 12px;border:0;border-radius:7px;font-weight:700}.toc{position:sticky;top:0;background:white;padding:10px;border:1px solid var(--line);border-radius:8px;margin:14px 0;z-index:5}.toc a{color:var(--blue);font-weight:700}.metrics{margin:14px 0}.metrics div{background:white;border:1px solid var(--line);padding:10px;border-radius:8px;min-width:135px}.metrics b{display:block;font-size:22px}.metrics span{color:var(--muted)}.metrics .reviewMetric{border-color:#d4ad61}section{scroll-margin-top:60px}section>h2{margin-top:30px;border-bottom:2px solid var(--line)}section>h2 span{font-size:13px;color:var(--muted)}.card{background:white;border:1px solid var(--line);border-left:5px solid #8093aa;padding:13px;margin:10px 0;border-radius:9px}.card.graph{border-left-color:#6b4ca5}.card.key{border-left-color:var(--amber)}.card.danger{border-left-color:var(--red)}.card header{display:flex;justify-content:space-between;gap:10px}.reason{background:#fff4d8;padding:7px;border-radius:6px;margin:8px 0}.instruction{background:#eaf2ff;border-left:3px solid var(--blue);padding:9px}.facts span{background:#f3f5f7;padding:7px;border-radius:6px}.facts b{display:block}.two>div{flex:1;min-width:300px}.controls{background:#f6f8fa;padding:10px;border-radius:7px}.controls label{flex:1;min-width:210px;color:var(--muted);font-size:12px}input,select,textarea{display:block;width:100%;padding:7px;border:1px solid #98a2b3;border-radius:6px;font:inherit;background:white}blockquote{white-space:pre-wrap;background:#f3f5f7;border-left:3px solid #8799ad;margin:8px 0;padding:8px 12px}code{font-weight:700}.empty{color:var(--muted)}ol,ul{padding-left:25px}@media(max-width:650px){main{padding:7px}.toc{position:static}.two{display:block}.card header{display:block}}
</style></head><body><main><header class="hero"><h1>CF1 Exception-only Adjudication</h1><p>Only unresolved exceptions appear here. Exact approved split materializations, unambiguous graph mappings, matched evaluation targets, and clear non-violations were resolved automatically with recorded bases. This packet cannot approve fixtures or generate training rows. Evidence-target fields remain excluded.</p><div class="actions"><button id="export">Export exception decisions</button><button id="import">Import decisions</button><button id="clear">Clear local decisions</button><input id="file" type="file" accept="application/json" hidden><span id="progress"></span></div></header><div class="metrics">${metrics}</div><nav class="toc"><b>Exceptions:</b><a href="#splits">Splits</a><a href="#relations">Relations</a><a href="#findings">Findings</a><a href="#targets">Key targets</a><a href="#prohibitions">Prohibitions</a><a href="#coverage">Coverage</a><a href="#attribution">Attribution</a></nav>
${section("Split-child exceptions", e.splitChildren, splitCard, "splits")}
${section("Ambiguous relation mappings", e.relations, relationCard, "relations")}
${section("Ambiguous consistency mappings", e.consistencyFindings, findingCard, "findings")}
${section("Unresolved evaluation-key targets", e.rubricTargets, targetCard, "targets")}
${section("Apparent or uncertain prohibited interpretations", e.prohibitedInterpretations, prohibitionCard, "prohibitions")}
${section("Passage coverage review", e.passageCoverage, coverageCard, "coverage")}
${section("Attribution spot checks", e.attributionSpotChecks, attributionCard, "attribution")}
</main><script>const manifest=${embeddedManifest};const storageKey="cf1-exception-review-r2";let decisions={};try{decisions=JSON.parse(localStorage.getItem(storageKey)||"{}")}catch{decisions={}}function save(){localStorage.setItem(storageKey,JSON.stringify(decisions));update()}function update(){const reviewed=Object.values(decisions).filter(v=>(v.decision&&v.decision!=="unreviewed")||(v.status&&v.status!=="unreviewed")).length;document.getElementById("progress").textContent=reviewed+" / "+manifest.totalRequiringReview+" exceptions reviewed"}document.querySelectorAll(".review").forEach(node=>{const key=node.dataset.key,field=node.dataset.field;if(decisions[key]?.[field]!==undefined)node.value=decisions[key][field];node.addEventListener("input",()=>{decisions[key]??={};decisions[key][field]=node.value;save()})});document.getElementById("export").onclick=()=>{const payload={schemaVersion:"cf1.exceptionReviewDecisions.v1",exportedAt:new Date().toISOString(),manifest,decisions,fixtureApprovalChanged:false,trainingRowsGenerated:false};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="CF1-exception-review-decisions-r2.json";a.click();URL.revokeObjectURL(a.href)};document.getElementById("import").onclick=()=>document.getElementById("file").click();document.getElementById("file").onchange=async event=>{const file=event.target.files[0];if(!file)return;const payload=JSON.parse(await file.text());decisions=payload.decisions||{};save();location.reload()};document.getElementById("clear").onclick=()=>{if(confirm("Clear locally saved exception decisions?")){decisions={};save();location.reload()}};update();</script></body></html>`;

const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
if (!script) throw new Error("Generated HTML has no script");
new vm.Script(script);
if ((html.match(/class="card/g) ?? []).length !== totalReview) throw new Error("HTML exception-card count does not match report");
fs.mkdirSync(args.output, { recursive: false });
writeJson(path.join(args.output, "automatically-applied-decisions.json"), result.autoApplied);
writeJson(path.join(args.output, "exception-review-queue.json"), result.exceptions);
writeJson(path.join(args.output, "exception-resolution-report.json"), result.report);
writeJson(path.join(args.output, "exception-review-manifest.json"), manifest);
fs.writeFileSync(path.join(args.output, "EXCEPTION_RESOLUTION_REPORT.md"), markdownReport(result.report));
fs.writeFileSync(path.join(args.output, "exception-review.html"), html);
console.log(JSON.stringify({ output: args.output, autoResolved: result.report.autoResolved, requiringReview: result.report.requiringReview, totalAuto, totalReview }, null, 2));
