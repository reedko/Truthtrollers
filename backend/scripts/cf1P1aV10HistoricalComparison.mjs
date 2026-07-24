#!/usr/bin/env node
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

const { prepareArticle } = await import(
  "../test/claim-foundry/prompt-benchmark/generationRun.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiResponsesCf1Transport } = await import(
  "../src/claim-foundry/openAiResponsesTransport.js");
const { detectSplitAtomicRepairSignals } = await import(
  "../src/claim-foundry/splitAtomicRepair.js");
const {
  P1A_V10_MINIMAL_WHOLE_ARTICLE_ASSERTIONS,
  buildP1aV10MinimalWholeArticleAssertionsPrompt,
} = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV10MinimalWholeArticleAssertions.js");
const {
  P1A_HISTORICAL_LIVE_20260715,
  buildP1aHistoricalLive20260715Prompt,
} = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aHistoricalLive20260715.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const slug = (value) => String(value).replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", timeoutMs: 300_000,
    out: null, maxOutputTokens: 12_000, arms: null, append: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--max-output-tokens") options.maxOutputTokens = Number(argv[++index]);
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--arms") options.arms = argv[++index].split(",")
      .map((value) => value.trim()).filter(Boolean);
    else if (arg === "--append") options.append = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function claimsFromOutput(output, kind) {
  if (kind === "minimal") {
    return (output?.assertions ?? []).map((assertion) => ({
      ...assertion, claimText: assertion.assertionText,
    }));
  }
  return output?.candidateClaims ?? [];
}

function groundingText(sourceUnitIds, unitsById) {
  return (sourceUnitIds ?? []).map((unitId) =>
    `[${unitId}] ${unitsById.get(unitId)?.text ?? "[missing unit]"}`).join("\n");
}

function quarterForClaim(sourceUnitIds, unitOrder) {
  const positions = (sourceUnitIds ?? []).map((unitId) => unitOrder.get(unitId))
    .filter(Number.isInteger);
  if (!positions.length) return "unresolved";
  const position = Math.min(...positions);
  const total = Math.max(unitOrder.size, 1);
  return `Q${Math.min(4, Math.floor((position / total) * 4) + 1)}`;
}

function analyzeClaims(claims, sourceUnits) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const seen = new Map();
  return claims.map((claim, index) => {
    const key = normalizeText(claim.claimText);
    const duplicateOf = seen.get(key) ?? null;
    if (!duplicateOf && key) seen.set(key, index + 1);
    const signals = detectSplitAtomicRepairSignals({ claim, sourceUnitsById: unitsById }).signals;
    return { ...claim, index: index + 1, duplicateOf, signals,
      quarter: quarterForClaim(claim.sourceUnitIds, unitOrder),
      groundingText: groundingText(claim.sourceUnitIds, unitsById) };
  });
}

function diagnostics(claims) {
  const quarterCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, unresolved: 0 };
  const useCounts = {};
  const roleCounts = {};
  const signalCounts = {};
  for (const claim of claims) {
    quarterCounts[claim.quarter] = (quarterCounts[claim.quarter] ?? 0) + 1;
    if (claim.articleUse) useCounts[claim.articleUse] = (useCounts[claim.articleUse] ?? 0) + 1;
    if (claim.articleRole) roleCounts[claim.articleRole] = (roleCounts[claim.articleRole] ?? 0) + 1;
    for (const signal of claim.signals) signalCounts[signal] = (signalCounts[signal] ?? 0) + 1;
  }
  return { claimCount: claims.length, exactDuplicateCount: claims.filter((claim) => claim.duplicateOf).length,
    flaggedClaimCount: claims.filter((claim) => claim.signals.length).length,
    quarterCounts, useCounts, roleCounts, signalCounts };
}

function promptHashes(prompt) {
  return { systemSha256: sha(prompt.system), userSha256: sha(prompt.user),
    schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
    assembledSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) };
}

function renderReport({ fixture, generatedAt, records }) {
  const summaryRows = records.map((record) => `<tr><td>${esc(record.label)}</td>
    <td>${esc(record.model)}</td><td>${esc(record.status)}</td>
    <td>${record.diagnostics?.claimCount ?? "—"}</td>
    <td>${record.diagnostics?.flaggedClaimCount ?? "—"}</td>
    <td>${record.diagnostics?.exactDuplicateCount ?? "—"}</td>
    <td>${esc(record.diagnostics ? Object.values(record.diagnostics.quarterCounts)
      .slice(0, 4).join(" / ") : "—")}</td>
    <td>${record.usage?.totalTokens ?? "—"}</td>
    <td>${record.elapsedMs ? (record.elapsedMs / 1000).toFixed(1) : "—"}s</td></tr>`).join("\n");
  const sections = records.map((record) => {
    const promptDetails = `<details><summary>Exact assembled prompt, schema, and fingerprints</summary>
      <h3>System</h3><pre>${esc(record.prompt.system)}</pre>
      <h3>User</h3><pre>${esc(record.prompt.user)}</pre>
      <h3>Response schema</h3><pre>${esc(JSON.stringify(record.prompt.responseSchema, null, 2))}</pre>
      <h3>Fingerprints</h3><pre>${esc(JSON.stringify(record.promptHashes, null, 2))}</pre></details>`;
    if (record.status !== "completed") return `<section><h2>${esc(record.label)} · ${esc(record.model)}</h2>
      <p class="bad">FAILED: ${esc(record.error?.code)} ${esc(record.error?.message)}</p>
      ${promptDetails}</section>`;
    const outputExtras = record.kind === "historical" ? `<details><summary>Historical orientation and named works</summary>
      <h3>Theme</h3><pre>${esc(JSON.stringify(record.output.theme, null, 2))}</pre>
      <h3>Thesis</h3><pre>${esc(JSON.stringify(record.output.thesis, null, 2))}</pre>
      <h3>Pillars</h3><pre>${esc(JSON.stringify(record.output.pillars, null, 2))}</pre>
      <h3>Named works</h3><pre>${esc(JSON.stringify(record.output.namedWorks, null, 2))}</pre></details>` : "";
    const rows = record.claims.map((claim) => `<tr class="claim" data-key="${esc(`${record.label}-${claim.index}`)}">
      <td>${claim.index}</td><td>${esc(claim.claimText)}</td><td>${esc(claim.quarter)}</td>
      <td>${esc((claim.sourceUnitIds ?? []).join(", "))}</td>
      <td>${esc(claim.articleRole ?? "not requested")}</td>
      <td>${esc(claim.articleUse ?? "not requested")}</td>
      <td>${esc(claim.assertionSource ?? "not requested")}</td>
      <td>${esc(claim.materiality ?? "not requested")}</td>
      <td>${esc(claim.signals.join(", ") || "none")}</td></tr>
      <tr class="detail-row" id="${esc(`${record.label}-${claim.index}`)}"><td colspan="9"><div class="detail">
      <h4>Grounding</h4><pre>${esc(claim.groundingText)}</pre>
      ${claim.duplicateOf ? `<p class="bad">Exact normalized duplicate of #${claim.duplicateOf}</p>` : ""}
      <p><b>Scope:</b> ${esc(claim.scope ?? "not requested")}<br>
      <b>Pillars:</b> ${esc((claim.relatedPillarLabels ?? []).join("; ") || "not requested")}<br>
      <b>Evidence hint:</b> ${esc(claim.evidenceUsefulnessHint ?? "not requested")}</p>
      <details><summary>Raw item</summary><pre>${esc(JSON.stringify(claim, null, 2))}</pre></details>
      </div></td></tr>`).join("\n");
    return `<section><h2>${esc(record.label)} · ${esc(record.model)}</h2>
      <p>${record.claims.length} assertions · ${record.diagnostics.flaggedClaimCount} atomicity-signal flags ·
      quarters ${Object.values(record.diagnostics.quarterCounts).slice(0, 4).join(" / ")} ·
      ${record.usage.totalTokens} tokens · ${(record.elapsedMs / 1000).toFixed(1)}s</p>
      <p><b>Role counts:</b> ${esc(JSON.stringify(record.diagnostics.roleCounts))}<br>
      <b>Use counts:</b> ${esc(JSON.stringify(record.diagnostics.useCounts))}<br>
      <b>Signal counts:</b> ${esc(JSON.stringify(record.diagnostics.signalCounts))}</p>
      ${promptDetails}${outputExtras}
      <h3>Every raw model assertion—no host selection</h3>
      <table><thead><tr><th>#</th><th>Assertion</th><th>Quarter</th><th>Units</th>
      <th>Role</th><th>Use</th><th>Source</th><th>Materiality</th><th>Atomicity signals</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>P1aV10 comparison</title>
  <style>body{font:14px system-ui;margin:24px;color:#18212b}table{border-collapse:collapse;width:100%;margin:12px 0 28px}th,td{border:1px solid #c8ced4;padding:7px;vertical-align:top;text-align:left}th{background:#edf1f4;position:sticky;top:0}.claim:hover{background:#f3f7ff;cursor:pointer}.detail-row{display:none}.detail{border-left:4px solid #486a9a;padding:4px 14px;background:#f8faff}section{border-top:5px solid #34495e;padding-top:12px;margin-top:36px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}.bad{color:#a12622;font-weight:700}.note{background:#fff8d9;border:1px solid #e1cf72;padding:10px}summary{cursor:pointer;font-weight:650}</style></head><body>
  <h1>${esc(fixture)} · minimal versus historical whole-article extraction</h1>
  <p>${esc(generatedAt)} · one repeat per arm · Responses API · raw model output only.</p>
  <p class="note">Atomicity signals are deterministic review flags, not verdicts. Quarter counts use the first grounding unit. The minimal arms deliberately do not emit stance, attribution, materiality, pillars, or evidence hints.</p>
  <table><thead><tr><th>Arm</th><th>Model</th><th>Status</th><th>Assertions</th><th>Flagged</th><th>Exact dupes</th><th>Q1/Q2/Q3/Q4</th><th>Tokens</th><th>Elapsed</th></tr></thead><tbody>${summaryRows}</tbody></table>
  ${sections}<script>document.querySelectorAll('tr.claim').forEach((row)=>row.addEventListener('click',()=>{const detail=document.getElementById(row.dataset.key);detail.style.display=detail.style.display==='table-row'?'none':'table-row';}));</script></body></html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", options.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const input = { article, structuralBlocks, sourceUnits: articleDocument.sourceUnits };
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(options.out ?? path.join(repoRoot,
    "artifacts/claim-foundry/p1a-v10-historical-comparison",
    `${options.fixture.toLowerCase()}-${stamp}`));
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const allArms = [
    { id: "minimal-gpt5", label: P1A_V10_MINIMAL_WHOLE_ARTICLE_ASSERTIONS,
      kind: "minimal", model: "gpt-5",
      build: buildP1aV10MinimalWholeArticleAssertionsPrompt },
    { id: "historical-gpt5", label: P1A_HISTORICAL_LIVE_20260715,
      kind: "historical", model: "gpt-5",
      build: buildP1aHistoricalLive20260715Prompt },
    { id: "minimal-4o", label: `${P1A_V10_MINIMAL_WHOLE_ARTICLE_ASSERTIONS}-4o-baseline`, kind: "minimal",
      model: "gpt-4o-mini", build: buildP1aV10MinimalWholeArticleAssertionsPrompt },
  ];
  const arms = options.arms ? allArms.filter((arm) => options.arms.includes(arm.id)) : allArms;
  if (options.arms && arms.length !== options.arms.length) {
    throw new Error(`Unknown or duplicate --arms value. Known values: ${allArms.map((arm) => arm.id).join(", ")}`);
  }
  const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
  const resultsPath = path.join(outDir, "results.json");
  const previous = options.append && existsSync(resultsPath)
    ? JSON.parse(readFileSync(resultsPath, "utf8")) : null;
  const records = previous?.records ?? [];
  for (const arm of arms) {
    const prompt = arm.build(input);
    const hashes = promptHashes(prompt);
    writeFileSync(path.join(outDir, "prompts", `${slug(arm.label)}-${slug(arm.model)}.json`),
      JSON.stringify({ label: arm.label, model: arm.model, ...prompt, hashes }, null, 2));
    process.stdout.write(`${arm.label} · ${arm.model} … `);
    const startedAt = Date.now();
    try {
      const response = await runner.invokeStructured({ ...prompt, model: arm.model,
        timeoutMs: options.timeoutMs, maximumAttempts: 1,
        maxOutputTokens: options.maxOutputTokens, apiMode: "responses", store: false,
        usageContext: { component: "claim_foundry", path: "p1a_v10_historical_comparison",
          stage: arm.label } });
      const claims = analyzeClaims(claimsFromOutput(response.output, arm.kind),
        articleDocument.sourceUnits);
      const record = { label: arm.label, kind: arm.kind, model: arm.model,
        status: "completed", elapsedMs: Date.now() - startedAt, prompt, promptHashes: hashes,
        provider: { responseId: response.rawResponse?.id ?? null,
          systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
          responseModel: response.rawResponse?.model ?? response.model,
          responseStatus: response.rawResponse?.status ?? null },
        usage: response.usage, output: response.output, claims, diagnostics: diagnostics(claims) };
      const priorIndex = records.findIndex((item) => item.label === arm.label
        && item.model === arm.model);
      if (priorIndex >= 0) records[priorIndex] = record; else records.push(record);
      console.log(`ok · ${claims.length} assertions · ${response.usage.totalTokens} tokens · ${(record.elapsedMs / 1000).toFixed(1)}s`);
    } catch (error) {
      const failedRecord = { label: arm.label, kind: arm.kind, model: arm.model, status: "failed",
        elapsedMs: Date.now() - startedAt, prompt, promptHashes: hashes,
        error: { code: error.cause?.code ?? error.code ?? null,
          message: error.cause?.message ?? error.message,
          outerCode: error.code ?? null, outerMessage: error.message } };
      const priorIndex = records.findIndex((item) => item.label === arm.label
        && item.model === arm.model);
      if (priorIndex >= 0) records[priorIndex] = failedRecord; else records.push(failedRecord);
      console.log(`FAILED · ${error.cause?.code ?? error.code ?? ""} ${error.cause?.message ?? error.message}`);
    }
  }
  const artifact = { fixture: options.fixture, generatedAt, apiMode: "responses",
    maxOutputTokens: options.maxOutputTokens, records };
  writeFileSync(resultsPath, JSON.stringify(artifact, null, 2));
  const csvHeader = ["arm", "model", "status", "index", "assertionText", "sourceUnitIds",
    "quarter", "articleRole", "articleUse", "assertionSource", "materiality", "scope",
    "relatedPillarLabels", "evidenceUsefulnessHint", "atomicitySignals", "duplicateOf",
    "groundingText"];
  const csvRows = records.flatMap((record) => record.status === "completed"
    ? record.claims.map((claim) => [record.label, record.model, record.status, claim.index,
      claim.claimText, (claim.sourceUnitIds ?? []).join(";"), claim.quarter,
      claim.articleRole ?? "", claim.articleUse ?? "", claim.assertionSource ?? "",
      claim.materiality ?? "", claim.scope ?? "", (claim.relatedPillarLabels ?? []).join(";"),
      claim.evidenceUsefulnessHint ?? "", claim.signals.join(";"), claim.duplicateOf ?? "",
      claim.groundingText].map(csv).join(","))
    : [[record.label, record.model, record.status, "", record.error?.message ?? "",
      "", "", "", "", "", "", "", "", "", "", "", ""].map(csv).join(",")]);
  writeFileSync(path.join(outDir, "claims.csv"),
    `${csvHeader.map(csv).join(",")}\n${csvRows.join("\n")}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderReport({ fixture: options.fixture,
    generatedAt, records }));
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`CSV: ${path.join(outDir, "claims.csv")}`);
  if (records.some((record) => record.status === "failed")) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
