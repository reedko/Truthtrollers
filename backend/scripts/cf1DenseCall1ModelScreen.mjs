#!/usr/bin/env node
// Frozen single-call CF1 Call-1 model screen. Runs one byte-identical control
// prompt/schema through the Responses API for each requested model and renders
// the raw semantic inventories side by side. It does not run host selection or
// Call 2, so differences measure Call-1 model behavior only.
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const { prepareArticle } = await import(
  "../test/claim-foundry/prompt-benchmark/generationRun.js"
);
const { SET_CONTROL_CURRENT_V1 } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/setControlCurrentV1.js"
);
const { verifySemanticInventory } = await import(
  "../src/claim-foundry/twoCallAgentVerification.js"
);
const { buildModelCallProvenance } = await import(
  "../src/claim-foundry/modelCallProvenance.js"
);
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiResponsesCf1Transport } = await import(
  "../src/claim-foundry/openAiResponsesTransport.js"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

function args(argv) {
  const parsed = { fixture: "CF1-F03", models: [], timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") parsed.fixture = argv[++index];
    else if (argv[index] === "--model") parsed.models.push(argv[++index]);
    else if (argv[index] === "--timeout-ms") parsed.timeoutMs = Number(argv[++index]);
  }
  if (!parsed.models.length) throw new Error("Pass --model at least once");
  return parsed;
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const slug = (value) => String(value).replace(/[^a-zA-Z0-9.-]+/g, "-");

function sourceText(claim, unitsById) {
  return (claim.sourceUnitIds ?? []).map((id) => `[${id}] ${unitsById.get(id)?.text ?? ""}`)
    .join("\n");
}

function render({ runId, generatedAt, fixture, promptHashes, records, unitsById }) {
  const summary = records.map((record) => {
    const claims = record.inventory?.candidateClaims ?? [];
    const use = Object.groupBy?.(claims, (claim) => claim.articleUse) ?? claims.reduce((all, claim) => {
      all[claim.articleUse] ??= []; all[claim.articleUse].push(claim); return all;
    }, {});
    return `<tr><td>${esc(record.model)}</td><td>${esc(record.status)}</td>
      <td>${claims.length}</td><td>${record.usage?.totalTokens ?? "—"}</td>
      <td>${Math.round((record.elapsedMs ?? 0) / 1000)}s</td>
      <td>${Object.entries(use).map(([key, values]) => `${esc(key)}:${values.length}`).join(" · ")}</td></tr>`;
  }).join("");
  const sections = records.map((record) => {
    if (record.status !== "completed") return `<section><h2>${esc(record.model)}</h2>
      <p class="bad">${esc(record.error?.message)}</p>
      ${record.rawOutput ? `<details><summary>Model output rejected by host verification</summary>
        <pre>${esc(JSON.stringify(record.rawOutput, null, 2))}</pre></details>` : ""}</section>`;
    const inventory = record.inventory;
    const rows = inventory.candidateClaims.map((claim, index) => `<tr>
      <td>${index + 1}</td><td><details><summary>${esc(claim.claimText)}</summary>
        <pre>${esc(sourceText(claim, unitsById))}</pre>
        <div><b>Hint:</b> ${esc(claim.evidenceUsefulnessHint)}</div></details></td>
      <td>${esc(claim.articleRole)}</td><td>${esc(claim.articleUse)}</td>
      <td>${esc(claim.assertionSource)}</td><td>${esc(claim.materiality)}</td>
      <td>${esc(claim.scope)}</td><td>${esc((claim.sourceUnitIds ?? []).join(", "))}</td></tr>`).join("");
    return `<section><h2>${esc(record.model)}</h2>
      <p><b>Theme:</b> ${esc(inventory.theme.text)}</p>
      <p><b>Thesis:</b> ${esc(inventory.thesis.text)}</p>
      <p><b>Thesis hinge:</b> ${esc(inventory.thesisHinge)}</p>
      <details><summary>Pillars (${inventory.pillars.length})</summary><pre>${esc(JSON.stringify(inventory.pillars, null, 2))}</pre></details>
      <table><thead><tr><th>#</th><th>Claim and grounding</th><th>Role</th><th>Use</th>
      <th>Assertion source</th><th>Materiality</th><th>Scope</th><th>Units</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(runId)}</title>
  <style>body{font:14px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%;margin:12px 0 28px}th,td{border:1px solid #ccd1d1;padding:7px;vertical-align:top;text-align:left}th{background:#eef2f3;position:sticky;top:0}section{border-top:4px solid #34495e;margin-top:35px;padding-top:12px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;background:#f7f9f9;padding:10px}.bad{color:#a93226}.meta{color:#566573}</style>
  </head><body><h1>Dense single-Call-1 model screen · ${esc(fixture)}</h1>
  <p class="meta">${esc(generatedAt)} · Responses API · frozen control-current Call 1 · no host selection · no Call 2</p>
  <p class="meta">system ${esc(promptHashes.system)} · user ${esc(promptHashes.user)} · schema ${esc(promptHashes.schema)}</p>
  <table><thead><tr><th>Model</th><th>Status</th><th>Claims</th><th>Tokens</th><th>Elapsed</th><th>articleUse distribution</th></tr></thead><tbody>${summary}</tbody></table>
  ${sections}</body></html>`;
}

async function main() {
  const { fixture, models, timeoutMs } = args(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures", fixture,
    "article.json"), "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const prompt = SET_CONTROL_CURRENT_V1.call1.build({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits });
  const promptHashes = { system: sha(prompt.system), user: sha(prompt.user),
    schema: sha(JSON.stringify(prompt.responseSchema)) };
  const transport = createOpenAiResponsesCf1Transport();
  const runner = createCf1ModelRunner({ transport });
  const records = [];
  for (const model of models) {
    const started = Date.now();
    let response = null;
    process.stdout.write(`${model} … `);
    try {
      const request = { ...prompt, model, timeoutMs, maximumAttempts: 1,
        maxOutputTokens: 12_000, apiMode: "responses", store: false,
        usageContext: { component: "claim_foundry", path: "dense_call1_model_screen",
          stage: "semantic_inventory" } };
      response = await runner.invokeStructured(request);
      const inventory = verifySemanticInventory(structuredClone(response.output), {
        sourceUnits: articleDocument.sourceUnits, article, minimumCandidates: 8,
      });
      records.push({ model, status: "completed", inventory, usage: response.usage,
        elapsedMs: Date.now() - started,
        provenance: buildModelCallProvenance({ prompt, response, request }) });
      console.log(`ok · ${inventory.candidateClaims.length} claims · ${response.usage.totalTokens} tok`);
    } catch (error) {
      records.push({ model, status: "failed", error: { code: error.code ?? null,
        message: String(error.message ?? error), cause: String(error.cause?.message ?? "") },
        rawOutput: response?.output ?? null, usage: response?.usage ?? null,
        elapsedMs: Date.now() - started,
        provenance: response ? buildModelCallProvenance({ prompt, response,
          request: { model, maxOutputTokens: 12_000, apiMode: "responses", store: false } }) : null });
      console.log(`FAILED · ${error.code ?? ""} ${error.message}`);
    }
  }
  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const runId = `dense-call1-${fixture.toLowerCase()}-responses-model-screen-${stamp}`;
  const outDir = path.join(repoRoot, "artifacts", "claim-foundry", "dense-call1", runId);
  mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const unitsById = new Map(articleDocument.sourceUnits.map((unit) => [unit.unitId, unit]));
  for (const record of records) writeFileSync(path.join(outDir, `${slug(record.model)}.json`),
    JSON.stringify(record, null, 2));
  writeFileSync(path.join(outDir, "runs.json"), JSON.stringify({ runId, fixture, generatedAt,
    api: "responses", promptProfile: SET_CONTROL_CURRENT_V1.id, promptHashes, records }, null, 2));
  writeFileSync(path.join(outDir, "claims.csv"), [
    ["model", "status", "claimIndex", "claimText", "articleRole", "articleUse",
      "assertionSource", "materiality", "scope", "sourceUnitIds", "groundingText"].map(csv).join(","),
    ...records.flatMap((record) => record.status === "completed"
      ? record.inventory.candidateClaims.map((claim, index) => [record.model, record.status, index + 1,
        claim.claimText, claim.articleRole, claim.articleUse, claim.assertionSource, claim.materiality,
        claim.scope, (claim.sourceUnitIds ?? []).join(" "), sourceText(claim, unitsById)].map(csv).join(","))
      : [[record.model, record.status, "", record.error?.message ?? "", "", "", "", "", "", "", ""]
        .map(csv).join(",")]),
  ].join("\n"));
  writeFileSync(path.join(outDir, "report.html"), render({ runId, generatedAt, fixture,
    promptHashes, records, unitsById }));
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  if (records.some((record) => record.status !== "completed")) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
