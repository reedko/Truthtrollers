#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolDir, "..");
const draftDir = path.join(projectDir, "data", "annotation-prompts");
const formDir = path.join(projectDir, "data", "annotation-forms");
const outputDir = path.join(projectDir, "review-packets", "argument-drafts-v1");

const fixtureIds = Array.from({ length: 9 }, (_, index) =>
  `CF1-F${String(index + 1).padStart(2, "0")}`,
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function argumentFlags(argument) {
  const flags = [];
  const proposition = argument.canonicalAtomicProposition ?? "";
  const deployment = argument.articleTreatment?.deployment ?? "";
  const basis = argument.articleTreatment?.basis ?? "";
  const disputed = argument.evidenceTarget?.disputedProposition ?? "";
  const warrant = argument.evidenceTarget?.warrant ?? "";

  if (/\b(and|but|while|whereas)\b|;/.test(proposition)) {
    flags.push({ code: "atomicity_review", label: "Review atomicity", severity: "warn" });
  }
  if (proposition.length > 280) {
    flags.push({ code: "long_proposition", label: "Long proposition", severity: "warn" });
  }
  if ((argument.grounding?.sourceUnitIds?.length ?? 0) > 5) {
    flags.push({ code: "wide_grounding", label: "Wide grounding", severity: "note" });
  }
  if (argument.assertionSource?.kind === "unknown") {
    flags.push({ code: "unknown_source", label: "Unknown source", severity: "warn" });
  }
  if (
    (deployment === "rebutted" && basis.includes("opponent_to_rebut")) ||
    (deployment === "opponent_to_rebut" && basis.includes("rebutted"))
  ) {
    flags.push({ code: "deployment_basis_conflict", label: "Deployment/basis conflict", severity: "error" });
  }
  if (normalize(proposition) === normalize(disputed)) {
    flags.push({ code: "target_copies_proposition", label: "Evidence target is copied proposition", severity: "note" });
  }
  if (warrant.startsWith("Evidence bearing on the stated relationship")) {
    flags.push({ code: "generic_warrant", label: "Generic warrant", severity: "note" });
  }
  return flags;
}

function mapSourceRegionTargets(rubricTargets, argumentsList) {
  return rubricTargets.map((target) => {
    if (target.category !== "required_source_region" || !target.excerpt) return target;
    const needle = normalize(target.excerpt);
    const matches = argumentsList
      .filter((argument) => normalize(argument.grounding?.verbatimExcerpt).includes(needle))
      .map((argument) => argument.argumentUnitId);
    return { ...target, apparentArgumentUnitIds: matches };
  });
}

const fixtures = fixtureIds.map((fixtureId) => {
  const draftPath = path.join(draftDir, `${fixtureId}.argumentDraft.v1.json`);
  const formPath = path.join(formDir, `${fixtureId}.annotation.json`);
  const draft = readJson(draftPath);
  const form = readJson(formPath);
  const argumentsList = draft.argumentUnits.map((argument) => ({
    ...argument,
    automaticFlags: argumentFlags(argument),
  }));
  const includedCount = argumentsList.filter((argument) => argument.portfolio?.include).length;
  const fixtureFlags = [];
  if (argumentsList.length && includedCount / argumentsList.length > 0.85) {
    fixtureFlags.push({
      code: "portfolio_overinclusive_review",
      label: `Portfolio includes ${includedCount}/${argumentsList.length}; review selectivity`,
      severity: "warn",
    });
  }
  if (
    argumentsList.length &&
    argumentsList.every((argument) =>
      argument.automaticFlags.some((flag) => flag.code === "generic_warrant"),
    )
  ) {
    fixtureFlags.push({
      code: "generic_evidence_package_review",
      label: "All evidence warrants are draft-model templates; adjudicate them before training evidence tasks",
      severity: "warn",
    });
  }
  return {
    fixtureId,
    schemaVersion: draft.schemaVersion,
    draftPath: path.relative(projectDir, draftPath),
    formPath: path.relative(projectDir, formPath),
    orientation: draft.orientation,
    passageCoverage: draft.passageCoverage,
    argumentUnits: argumentsList,
    relations: draft.relations,
    consistencyFindings: draft.consistencyFindings,
    rubricCoverage: {
      ...form.rubricCoverage,
      targets: mapSourceRegionTargets(form.rubricCoverage.targets, argumentsList),
    },
    fixtureFlags,
    counts: {
      sourceUnits: new Set(draft.passageCoverage.flatMap((coverage) => coverage.sourceUnitIds)).size,
      coverageRows: draft.passageCoverage.length,
      argumentUnits: argumentsList.length,
      included: includedCount,
      relations: draft.relations.length,
      consistencyFindings: draft.consistencyFindings.length,
      flaggedArguments: argumentsList.filter((argument) =>
        argument.automaticFlags.some((flag) => flag.severity === "error" || flag.severity === "warn"),
      ).length,
      opponents: argumentsList.filter((argument) => argument.articleTreatment?.role === "opponent_claim").length,
      unknownSources: argumentsList.filter((argument) => argument.assertionSource?.kind === "unknown").length,
    },
  };
});

const totals = fixtures.reduce(
  (accumulator, fixture) => {
    for (const key of Object.keys(accumulator)) accumulator[key] += fixture.counts[key] ?? 0;
    return accumulator;
  },
  {
    sourceUnits: 0,
    coverageRows: 0,
    argumentUnits: 0,
    included: 0,
    relations: 0,
    consistencyFindings: 0,
    flaggedArguments: 0,
    opponents: 0,
    unknownSources: 0,
  },
);

const manifest = {
  schemaVersion: "cf1.argumentDraftReviewManifest.v1",
  generatedAt: new Date().toISOString(),
  sourceDraftVersion: "argumentDraft.v1",
  fixtureIds,
  totals,
  fixtures: fixtures.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    counts: fixture.counts,
    fixtureFlags: fixture.fixtureFlags,
  })),
};

function flagHtml(flags) {
  return flags
    .filter((flag) => flag.code !== "target_copies_proposition" && flag.code !== "generic_warrant")
    .map((flag) => `<span class="flag ${escapeHtml(flag.severity)}">${escapeHtml(flag.label)}</span>`)
    .join("");
}

function reviewSelect(key, kind = "item") {
  return `<select class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="decision" aria-label="Review decision">
    <option value="unreviewed">Unreviewed</option>
    <option value="accept">Accept</option>
    <option value="edit">Edit</option>
    <option value="split">Split</option>
    <option value="remove">Remove</option>
    <option value="uncertain">Uncertain</option>
    ${kind === "fixture" ? '<option value="ready_for_second_review">Ready for second review</option>' : ""}
  </select>`;
}

function argumentHtml(fixture, argument) {
  const key = `${fixture.fixtureId}:argument:${argument.argumentUnitId}`;
  const treatment = argument.articleTreatment ?? {};
  const source = argument.assertionSource ?? {};
  const evidence = argument.evidenceTarget ?? {};
  const relations = fixture.relations.filter(
    (relation) =>
      relation.fromArgumentUnitId === argument.argumentUnitId || relation.toArgumentUnitId === argument.argumentUnitId,
  );
  const classes = [
    "argument-card",
    argument.portfolio?.include ? "included" : "excluded",
    treatment.role === "opponent_claim" ? "opponent" : "",
    argument.automaticFlags.some((flag) => flag.severity === "error" || flag.severity === "warn") ? "flagged" : "",
    source.kind === "unknown" ? "unknown-source" : "",
  ].filter(Boolean).join(" ");
  return `<article class="${classes}" data-search="${escapeHtml(normalize([
    argument.argumentUnitId,
    argument.canonicalAtomicProposition,
    source.name,
    treatment.contentStance,
    treatment.deployment,
    treatment.role,
    ...(argument.grounding?.sourceUnitIds ?? []),
  ].join(" ")))}">
    <div class="argument-header">
      <div>
        <span class="id">${escapeHtml(argument.argumentUnitId)}</span>
        ${argument.portfolio?.include ? '<span class="badge include">portfolio</span>' : '<span class="badge exclude">excluded</span>'}
        ${treatment.role === "opponent_claim" ? '<span class="badge opponent">opponent</span>' : ""}
        ${flagHtml(argument.automaticFlags)}
      </div>
      ${reviewSelect(key)}
    </div>
    <h4>${escapeHtml(argument.canonicalAtomicProposition)}</h4>
    <div class="field-grid">
      <div><label>Assertion source</label><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.kind)}</small></div>
      <div><label>Content stance</label><strong>${escapeHtml(treatment.contentStance)}</strong></div>
      <div><label>Deployment</label><strong>${escapeHtml(treatment.deployment)}</strong></div>
      <div><label>Role</label><strong>${escapeHtml(treatment.role)}</strong></div>
      <div><label>Grounding units</label><strong>${escapeHtml((argument.grounding?.sourceUnitIds ?? []).join(", "))}</strong></div>
      <div><label>Scope</label><strong>${escapeHtml((argument.scopeQualifiers ?? []).join("; ") || "—")}</strong></div>
    </div>
    <details open><summary>Grounding and decision basis</summary>
      <blockquote>${escapeHtml(argument.grounding?.verbatimExcerpt)}</blockquote>
      <p><b>Source basis:</b> ${escapeHtml(source.basis)}</p>
      <p><b>Treatment basis:</b> ${escapeHtml(treatment.basis)}</p>
      <p><b>Portfolio basis:</b> ${escapeHtml(argument.portfolio?.basis)}</p>
    </details>
    <details><summary>Evidence target and warrant</summary>
      <p><b>Disputed proposition:</b> ${escapeHtml(evidence.disputedProposition)}</p>
      <p><b>Verification question:</b> ${escapeHtml(evidence.verificationQuestion)}</p>
      <p><b>Support:</b> ${escapeHtml((evidence.supportWouldRequire ?? []).join("; "))}</p>
      <p><b>Refute:</b> ${escapeHtml((evidence.refuteWouldRequire ?? []).join("; "))}</p>
      <p><b>Qualify:</b> ${escapeHtml((evidence.qualifyWouldRequire ?? []).join("; "))}</p>
      <p><b>Warrant:</b> ${escapeHtml(evidence.warrant)}</p>
    </details>
    ${relations.length ? `<details><summary>Relations (${relations.length})</summary><ul>${relations.map((relation) =>
      `<li>${escapeHtml(relation.fromArgumentUnitId)} <b>${escapeHtml(relation.type)}</b> ${escapeHtml(relation.toArgumentUnitId)} — ${escapeHtml(relation.basis)}</li>`,
    ).join("")}</ul></details>` : ""}
    <div class="review-edit">
      <label>Corrected atomic proposition (only if editing or splitting)</label>
      <textarea class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="correctedProposition" rows="2"></textarea>
      <label>Reviewer notes</label>
      <textarea class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="notes" rows="2"></textarea>
    </div>
  </article>`;
}

function rubricHtml(fixture) {
  const targets = fixture.rubricCoverage.targets.map((target) => {
    const key = `${fixture.fixtureId}:rubric:${target.targetId}`;
    const automaticMatches = target.apparentArgumentUnitIds ?? [];
    return `<tr>
      <td>${escapeHtml(target.targetId)}</td>
      <td>${escapeHtml(target.category)}</td>
      <td>${escapeHtml(target.description)}${target.excerpt ? `<blockquote>${escapeHtml(target.excerpt)}</blockquote>` : ""}</td>
      <td>${automaticMatches.length ? escapeHtml(automaticMatches.join(", ")) : "—"}</td>
      <td>${reviewSelect(key)}<input class="review-control compact-input" data-review-key="${escapeHtml(key)}" data-review-field="argumentUnitIds" placeholder="AU001, AU002"></td>
      <td><textarea class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="notes" rows="2"></textarea></td>
    </tr>`;
  }).join("");
  const prohibitions = fixture.rubricCoverage.prohibitedInterpretations.map((prohibition) => {
    const key = `${fixture.fixtureId}:prohibition:${prohibition.prohibitionId}`;
    return `<li><p>${escapeHtml(prohibition.description)}</p>${reviewSelect(key)}<textarea class="review-control" data-review-key="${escapeHtml(key)}" data-review-field="notes" rows="2" placeholder="Any violation and affected AU IDs"></textarea></li>`;
  }).join("");
  return `<details class="rubric-section"><summary>Post-draft evaluation-key reconciliation</summary>
    <div class="warning-box">Review the draft independently before opening this section. The evaluation key is a checklist, not text to copy into annotations. Mark a questionable key requirement as needing revision instead of forcing the draft to match.</div>
    <h3>Targets</h3>
    <table><thead><tr><th>ID</th><th>Category</th><th>Requirement</th><th>Apparent excerpt match</th><th>Decision / linked IDs</th><th>Notes</th></tr></thead><tbody>${targets}</tbody></table>
    <h3>Prohibited interpretations</h3><ol class="prohibition-list">${prohibitions}</ol>
    <h3>Inherited review notes</h3><ul>${fixture.rubricCoverage.inheritedReviewNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
  </details>`;
}

function relationHtml(fixture, relation) {
  const key = `${fixture.fixtureId}:relation:${relation.relationId}`;
  return `<tr><td>${escapeHtml(relation.relationId)}</td><td>${escapeHtml(relation.fromArgumentUnitId)}</td><td>${escapeHtml(relation.type)}</td><td>${escapeHtml(relation.toArgumentUnitId)}</td><td>${escapeHtml((relation.sourceUnitIds ?? []).join(", "))}</td><td>${escapeHtml(relation.basis)}</td><td>${reviewSelect(key)}</td></tr>`;
}

function findingHtml(fixture, finding) {
  const key = `${fixture.fixtureId}:finding:${finding.findingId}`;
  return `<tr><td>${escapeHtml(finding.findingId)}</td><td>${escapeHtml(finding.type)}</td><td>${escapeHtml((finding.argumentUnitIds ?? []).join(", "))}</td><td>${escapeHtml(finding.basis)}</td><td>${reviewSelect(key)}</td></tr>`;
}

function coverageHtml(fixture, coverage) {
  return `<tr><td>${escapeHtml(coverage.coverageId)}</td><td>${escapeHtml((coverage.sourceUnitIds ?? []).join(", "))}</td><td>${escapeHtml(coverage.classification)}</td><td>${escapeHtml((coverage.argumentUnitIds ?? []).join(", ") || "—")}</td><td>${escapeHtml(coverage.basis)}</td></tr>`;
}

function fixtureHtml(fixture) {
  const orientationKey = `${fixture.fixtureId}:orientation`;
  const fixtureKey = `${fixture.fixtureId}:fixture`;
  return `<section class="fixture" id="${escapeHtml(fixture.fixtureId)}">
    <header class="fixture-title">
      <div><h2>${escapeHtml(fixture.fixtureId)}</h2><p>${escapeHtml(fixture.draftPath)}</p></div>
      <div>${reviewSelect(fixtureKey, "fixture")}</div>
    </header>
    <div class="metric-row">
      <span>${fixture.counts.sourceUnits} source units</span><span>${fixture.counts.argumentUnits} assertions</span><span>${fixture.counts.included} included</span><span>${fixture.counts.opponents} opponents</span><span>${fixture.counts.relations} relations</span><span>${fixture.counts.flaggedArguments} flagged</span>
    </div>
    ${fixture.fixtureFlags.length ? `<div class="warning-box">${flagHtml(fixture.fixtureFlags)}</div>` : ""}
    <details class="orientation" open><summary>Orientation</summary>
      <p><b>Theme:</b> ${escapeHtml(fixture.orientation.theme)}</p>
      <p><b>Thesis:</b> ${escapeHtml(fixture.orientation.thesis)}</p>
      <p><b>Status:</b> ${escapeHtml(fixture.orientation.thesisStatus)}</p>
      <p><b>Hinge:</b> ${escapeHtml(fixture.orientation.thesisHinge?.proposition)}</p>
      <p><b>If supported:</b> ${escapeHtml(fixture.orientation.thesisHinge?.ifSupportedEffectOnThesis)}; <b>if refuted:</b> ${escapeHtml(fixture.orientation.thesisHinge?.ifRefutedEffectOnThesis)}</p>
      <p><b>Basis units:</b> ${escapeHtml((fixture.orientation.basisSourceUnitIds ?? []).join(", "))}</p>
      <p><b>Notes:</b> ${escapeHtml(fixture.orientation.notes)}</p>
      <div class="review-edit">${reviewSelect(orientationKey)}<label>Orientation corrections or notes</label><textarea class="review-control" data-review-key="${escapeHtml(orientationKey)}" data-review-field="notes" rows="3"></textarea></div>
    </details>
    <div class="toolbar sticky-toolbar">
      <input class="search" data-fixture="${escapeHtml(fixture.fixtureId)}" placeholder="Search proposition, source, unit, or label">
      <label><input type="checkbox" class="filter" data-fixture="${escapeHtml(fixture.fixtureId)}" data-filter="flagged"> Flagged only</label>
      <label><input type="checkbox" class="filter" data-fixture="${escapeHtml(fixture.fixtureId)}" data-filter="opponent"> Opponents only</label>
      <label><input type="checkbox" class="filter" data-fixture="${escapeHtml(fixture.fixtureId)}" data-filter="included"> Portfolio only</label>
      <label><input type="checkbox" class="filter" data-fixture="${escapeHtml(fixture.fixtureId)}" data-filter="unknown-source"> Unknown source only</label>
      <span class="visible-count"></span>
    </div>
    <div class="arguments">${fixture.argumentUnits.map((argument) => argumentHtml(fixture, argument)).join("\n")}</div>
    <details><summary>Relations (${fixture.relations.length})</summary><table><thead><tr><th>ID</th><th>From</th><th>Relation</th><th>To</th><th>Units</th><th>Basis</th><th>Review</th></tr></thead><tbody>${fixture.relations.map((relation) => relationHtml(fixture, relation)).join("")}</tbody></table></details>
    <details><summary>Consistency findings (${fixture.consistencyFindings.length})</summary><table><thead><tr><th>ID</th><th>Type</th><th>Arguments</th><th>Basis</th><th>Review</th></tr></thead><tbody>${fixture.consistencyFindings.map((finding) => findingHtml(fixture, finding)).join("")}</tbody></table></details>
    <details><summary>Complete passage coverage (${fixture.passageCoverage.length})</summary><table><thead><tr><th>ID</th><th>Source units</th><th>Classification</th><th>Arguments</th><th>Basis</th></tr></thead><tbody>${fixture.passageCoverage.map((coverage) => coverageHtml(fixture, coverage)).join("")}</tbody></table></details>
    ${rubricHtml(fixture)}
    <div class="fixture-notes"><label>Fixture-level adjudication notes</label><textarea class="review-control" data-review-key="${escapeHtml(fixtureKey)}" data-review-field="notes" rows="4"></textarea></div>
  </section>`;
}

const embeddedManifest = JSON.stringify(manifest).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CF1 Argument Draft Review Packet v1</title>
<style>
:root{--bg:#f3f4f6;--panel:#fff;--ink:#18202a;--muted:#667085;--line:#d7dce3;--blue:#2456a6;--red:#a62d2d;--amber:#8a5700;--green:#1b6e43;--purple:#6b3aa5}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:24px}.page-header{background:#15253d;color:#fff;padding:28px;border-radius:14px}.page-header h1{margin:0 0 8px}.page-header p{max-width:1050px;margin:6px 0}.page-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}button,.button{border:1px solid #9ba7b8;border-radius:7px;background:#fff;padding:8px 12px;cursor:pointer;color:#15253d;font-weight:650}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.summary-grid div,.toc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}.summary-grid strong{display:block;font-size:24px}.toc a{display:inline-block;margin:4px 12px 4px 0}.fixture{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin:24px 0;padding:20px;scroll-margin-top:15px}.fixture-title{display:flex;justify-content:space-between;gap:20px;align-items:start;border-bottom:2px solid #e8ebef}.fixture-title h2{margin:0;font-size:28px}.fixture-title p{margin:3px 0 12px;color:var(--muted)}.metric-row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.metric-row span,.badge,.flag{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef1f5;font-size:12px}.badge.include{background:#dff3e9;color:var(--green)}.badge.exclude{background:#eceef1;color:#606773}.badge.opponent{background:#eee3fa;color:var(--purple)}.flag{margin-left:4px}.flag.error{background:#fde5e5;color:var(--red)}.flag.warn{background:#fff0cf;color:var(--amber)}.flag.note{background:#e6efff;color:var(--blue)}details{border:1px solid var(--line);border-radius:8px;margin:12px 0;padding:8px 12px}summary{font-weight:750;cursor:pointer;padding:5px}.warning-box{background:#fff8df;border:1px solid #e8cc72;padding:10px;border-radius:8px;margin:10px 0}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eef2f7;padding:10px;border-radius:9px}.sticky-toolbar{position:sticky;top:0;z-index:10;box-shadow:0 2px 7px #0002}.toolbar .search{min-width:310px;flex:1}.argument-card{border:1px solid var(--line);border-left:5px solid #a8b1bc;border-radius:9px;margin:12px 0;padding:14px;background:#fff}.argument-card.opponent{border-left-color:var(--purple)}.argument-card.flagged{box-shadow:0 0 0 1px #e2b55a inset}.argument-header{display:flex;justify-content:space-between;gap:14px}.id{font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace}.argument-card h4{font-size:17px;margin:10px 0}.field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;background:#f7f8fa;padding:10px;border-radius:8px}.field-grid label,.review-edit label,.fixture-notes label{display:block;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-size:11px}.field-grid small{display:block;color:var(--muted)}blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #9faec3;background:#f5f7fa;white-space:pre-wrap}.review-edit,.fixture-notes{background:#f7fafc;padding:10px;border-radius:8px;margin-top:10px}select,input,textarea{font:inherit;border:1px solid #aeb7c4;border-radius:6px;padding:6px;background:#fff}textarea{width:100%;resize:vertical}.compact-input{display:block;width:100%;margin-top:5px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--line);padding:7px;vertical-align:top;text-align:left}th{background:#eef1f5}.prohibition-list li{margin-bottom:12px}.prohibition-list textarea{margin-top:5px}.hidden{display:none!important}.completion{font-size:13px;color:var(--muted)}@media(max-width:700px){main{padding:8px}.fixture{padding:10px}.sticky-toolbar{position:static}.toolbar .search{min-width:100%}.field-grid{grid-template-columns:1fr}table{display:block;overflow:auto}}
</style></head><body><main>
<header class="page-header"><h1>CF1 Argument Draft Review Packet v1</h1>
<p>This packet contains unapproved model drafts. Valid structure is not semantic approval. Review the article orientation and every proposed assertion before opening the evaluation-key reconciliation section.</p>
<p><b>Recommended order:</b> orientation → assertions and grounding → source → stance/deployment → relations → portfolio → evaluation-key reconciliation. The raw draft JSON files remain unchanged.</p>
<div class="page-actions"><button id="export">Export review decisions</button><button id="import">Import decisions</button><button id="clear">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span class="completion" id="completion"></span></div></header>
<div class="summary-grid"><div><strong>${fixtures.length}</strong>fixtures</div><div><strong>${totals.sourceUnits}</strong>source units</div><div><strong>${totals.argumentUnits}</strong>draft assertions</div><div><strong>${totals.included}</strong>portfolio includes</div><div><strong>${totals.opponents}</strong>opponent claims</div><div><strong>${totals.relations}</strong>relations</div><div><strong>${totals.flaggedArguments}</strong>assertions flagged for review</div></div>
<nav class="toc"><b>Fixtures:</b> ${fixtures.map((fixture) => `<a href="#${fixture.fixtureId}">${fixture.fixtureId}</a>`).join("")}</nav>
${fixtures.map(fixtureHtml).join("\n")}
</main><script>
const manifest=${embeddedManifest};
const storageKey="cf1-argument-drafts-v1-review-decisions";
let decisions={};
try{decisions=JSON.parse(localStorage.getItem(storageKey)||"{}")}catch{decisions={}}
function save(){localStorage.setItem(storageKey,JSON.stringify(decisions));updateCompletion()}
function bindControls(){document.querySelectorAll(".review-control").forEach(control=>{const key=control.dataset.reviewKey;const field=control.dataset.reviewField;const saved=decisions[key]?.[field];if(saved!==undefined)control.value=saved;control.addEventListener("change",()=>{decisions[key]??={};decisions[key][field]=control.value;save()});control.addEventListener("input",()=>{decisions[key]??={};decisions[key][field]=control.value;save()})})}
function updateCompletion(){const reviewed=Object.values(decisions).filter(value=>value.decision&&value.decision!=="unreviewed").length;document.getElementById("completion").textContent=reviewed+" decisions recorded locally"}
function applyFilters(fixtureId){const fixture=document.getElementById(fixtureId);const query=normalizeText(fixture.querySelector(".search").value);const active=[...fixture.querySelectorAll(".filter:checked")].map(box=>box.dataset.filter);let visible=0;fixture.querySelectorAll(".argument-card").forEach(card=>{const matchesQuery=!query||card.dataset.search.includes(query);const matchesFilters=active.every(filter=>card.classList.contains(filter));card.classList.toggle("hidden",!(matchesQuery&&matchesFilters));if(matchesQuery&&matchesFilters)visible++});fixture.querySelector(".visible-count").textContent=visible+" visible"}
function normalizeText(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
document.querySelectorAll(".search,.filter").forEach(control=>control.addEventListener("input",()=>applyFilters(control.dataset.fixture)));
document.getElementById("export").addEventListener("click",()=>{const payload={schemaVersion:"cf1.argumentDraftReviewDecisions.v1",exportedAt:new Date().toISOString(),manifest,decisions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="CF1-argument-drafts-v1-review-decisions.json";link.click();URL.revokeObjectURL(link.href)});
document.getElementById("import").addEventListener("click",()=>document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change",async event=>{const file=event.target.files[0];if(!file)return;const payload=JSON.parse(await file.text());decisions=payload.decisions||{};save();location.reload()});
document.getElementById("clear").addEventListener("click",()=>{if(confirm("Clear all locally saved review decisions for this packet?")){decisions={};save();location.reload()}});
bindControls();updateCompletion();fixtureIds=${JSON.stringify(fixtureIds)};fixtureIds.forEach(applyFilters);
</script></body></html>`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "review.html"), html);
fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(path.join(outputDir, "review.html"));
console.log(path.join(outputDir, "manifest.json"));
