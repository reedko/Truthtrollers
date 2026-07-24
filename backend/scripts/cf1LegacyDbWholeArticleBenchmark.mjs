#!/usr/bin/env node
// Executes the isolated July 1 legacy DB-backed whole-article claim arm.
// Read-only with respect to the application database: it loads configuration
// and active prompts, calls the model, and writes local benchmark artifacts.
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

const { query, pool } = await import("../src/db/pool.js");
const { openAiLLM } = await import("../src/core/openAiLLM.js");
const { prepareArticle } = await import(
  "../test/claim-foundry/prompt-benchmark/generationRun.js");
const {
  LEGACY_DB_WHOLE_ARTICLE_ARM,
  runLegacyDbWholeArticleArm,
} = await import(
  "../test/claim-foundry/prompt-benchmark/legacyDbWholeArticleArm.js");

function parseArgs(argv) {
  const options = {
    fixture: "CF1-F03",
    mode: null,
    model: LEGACY_DB_WHOLE_ARTICLE_ARM.defaultModel,
    repeats: 1,
    seed: null,
    timeoutMs: 180_000,
    maxOutputTokens: 12_000,
    assertionLanguage: false,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") options.fixture = argv[++index];
    else if (argument === "--mode") options.mode = argv[++index];
    else if (argument === "--model") options.model = argv[++index];
    else if (argument === "--repeats") options.repeats = Number(argv[++index]);
    else if (argument === "--seed") options.seed = Number(argv[++index]);
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--max-output-tokens") {
      options.maxOutputTokens = Number(argv[++index]);
    } else if (argument === "--out") options.out = argv[++index];
    else if (argument === "--assertion-language") options.assertionLanguage = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.repeats) || options.repeats < 1) {
    throw new Error("--repeats must be a positive integer");
  }
  if (options.seed !== null && !Number.isInteger(options.seed)) {
    throw new Error("--seed must be an integer");
  }
  return options;
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

async function resolveExtractionMode(requestedMode) {
  if (requestedMode) return { mode: requestedMode, source: "cli" };
  try {
    const rows = await query(
      "SELECT config_value FROM evidence_search_config WHERE config_key = 'extraction_mode' LIMIT 1",
    );
    return { mode: rows?.[0]?.config_value || "ranked",
      source: rows?.[0]?.config_value ? "database" : "fallback" };
  } catch (error) {
    return { mode: "ranked", source: "fallback", error: error.message };
  }
}

async function activePromptMetadata(selectedNames) {
  const names = [selectedNames.system, selectedNames.user];
  try {
    return await query(
      `SELECT prompt_id, prompt_name, prompt_type, version, is_active,
              max_claims, min_sources, max_sources, parameters
         FROM llm_prompts
        WHERE is_active = TRUE AND prompt_name IN (?, ?)
        ORDER BY prompt_name, version DESC`,
      names,
    );
  } catch (error) {
    return [{ metadataError: error.message }];
  }
}

function roleCounts(claims) {
  return claims.reduce((counts, claim) => {
    const role = claim.role || "unlabeled";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

function renderReport({ fixture, generatedAt, options, modeResolution, records }) {
  const summary = records.map((record) => `<tr>
    <td>${record.repeat}</td><td>${escapeHtml(record.status)}</td>
    <td>${record.claims?.length ?? "—"}</td>
    <td>${escapeHtml(JSON.stringify(record.roles ?? {}))}</td>
    <td>${record.provider?.usage?.total_tokens ?? "—"}</td>
    <td>${record.elapsedMs ? (record.elapsedMs / 1000).toFixed(1) : "—"}s</td>
    <td>${escapeHtml(record.provider?.systemFingerprint ?? "not returned")}</td></tr>`).join("\n");
  const sections = records.map((record) => {
    const prompt = record.request ? `<details><summary>Exact assembled model request</summary>
      <h4>System</h4><pre>${escapeHtml(record.request.system)}</pre>
      <h4>User</h4><pre>${escapeHtml(record.request.user)}</pre>
      <h4>Request controls</h4><pre>${escapeHtml(JSON.stringify({
        temperature: record.request.temperature,
        schemaHint: record.request.schemaHint,
        model: options.model,
        seed: options.seed,
        apiMode: LEGACY_DB_WHOLE_ARTICLE_ARM.apiMode,
      }, null, 2))}</pre>
      <h4>Fingerprints</h4><pre>${escapeHtml(JSON.stringify(record.fingerprints, null, 2))}</pre>
      </details>` : "";
    if (record.status !== "completed") {
      return `<section><h2>Repeat ${record.repeat}</h2><p class="bad">FAILED: ${escapeHtml(record.error)}</p>${prompt}</section>`;
    }
    const rows = record.claims.map((claim, index) => `<tr class="claim" data-key="r${record.repeat}c${index}">
      <td>${index + 1}</td><td>${escapeHtml(claim.text)}</td>
      <td>${escapeHtml(claim.role ?? "")}</td><td>${escapeHtml(claim.parentId ?? "")}</td>
      <td>${escapeHtml(claim.centrality ?? "")}</td><td>${escapeHtml(claim.verifiability ?? "")}</td>
      <td>${escapeHtml(claim.priority ?? "")}</td><td>${escapeHtml(claim.articleStance ?? "")}</td>
      <td>${escapeHtml(claim.sourceCitedInArticle ?? "")}</td></tr>
      <tr class="detail" id="r${record.repeat}c${index}"><td colspan="9"><pre>${escapeHtml(JSON.stringify(claim, null, 2))}</pre></td></tr>`).join("\n");
    return `<section><h2>Repeat ${record.repeat}</h2>
      <p>${record.claims.length} normalized legacy claims · ${(record.elapsedMs / 1000).toFixed(1)}s ·
      ${record.provider?.usage?.total_tokens ?? "unknown"} tokens</p>
      ${prompt}
      <details><summary>DB prompt selection and active-row metadata</summary>
      <pre>${escapeHtml(JSON.stringify({ promptSelection: record.promptSelection,
        activePromptMetadata: record.activePromptMetadata }, null, 2))}</pre></details>
      <details><summary>Raw model JSON</summary><pre>${escapeHtml(JSON.stringify(record.rawOutput, null, 2))}</pre></details>
      <details><summary>Legacy reasoning stack</summary><pre>${escapeHtml(JSON.stringify(record.reasoningStack, null, 2))}</pre></details>
      <table><thead><tr><th>#</th><th>Claim</th><th>Role</th><th>Parent</th>
      <th>Centrality</th><th>Verifiability</th><th>Priority</th><th>Article stance</th>
      <th>Source cited</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Legacy DB claim arm</title>
  <style>body{font:14px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%;margin:14px 0 30px}th,td{border:1px solid #c9d0d6;padding:7px;vertical-align:top;text-align:left}th{background:#edf1f4;position:sticky;top:0}.claim:hover{background:#f2f7ff;cursor:pointer}.detail{display:none}.detail td{background:#f7f9fb;border-left:4px solid #526f91}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}section{border-top:5px solid #34495e;margin-top:36px;padding-top:12px}.bad{color:#a12622;font-weight:700}.note{background:#fff7d6;border:1px solid #d9c76d;padding:10px}summary{cursor:pointer;font-weight:650}</style></head><body>
  <h1>${escapeHtml(fixture)} · ${escapeHtml(LEGACY_DB_WHOLE_ARTICLE_ARM.label)}</h1>
  <p>${escapeHtml(generatedAt)} · model ${escapeHtml(options.model)} · Chat Completions JSON mode · extraction mode ${escapeHtml(modeResolution.mode)} (${escapeHtml(modeResolution.source)}).</p>
  <p class="note">This is a read-only reconstruction of commit 4714383a. It loads active prompts from <code>llm_prompts</code>, sends the complete article once, performs the historical exact-text flatten/dedupe/cap, and does not persist claims or invoke evidence retrieval.</p>
  <table><thead><tr><th>Repeat</th><th>Status</th><th>Claims</th><th>Roles</th><th>Tokens</th><th>Elapsed</th><th>System fingerprint</th></tr></thead><tbody>${summary}</tbody></table>
  ${sections}<script>document.querySelectorAll('tr.claim').forEach((row)=>row.addEventListener('click',()=>{const detail=document.getElementById(row.dataset.key);detail.style.display=detail.style.display==='table-row'?'none':'table-row';}));</script></body></html>`;
}

async function closePool() {
  await new Promise((resolve) => pool.end(() => resolve()));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures",
    options.fixture, "article.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { article } = prepareArticle(raw.article ?? raw);
  const modeResolution = await resolveExtractionMode(options.mode);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(options.out ?? path.join(repoRoot,
    "artifacts/claim-foundry/legacy-db-whole-article",
    `${options.fixture.toLowerCase()}-${stamp}`));
  mkdirSync(outDir, { recursive: true });
  const records = [];

  for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
    process.stdout.write(`repeat ${repeat}/${options.repeats} … `);
    const started = Date.now();
    let partial = null;
    try {
      const llm = {
        generate: (request) => openAiLLM.generate({
          ...request,
          model: options.model,
          ...(options.seed === null ? {} : { seed: options.seed }),
          timeout: options.timeoutMs,
          maxRetries: 1,
          maxOutputTokens: options.maxOutputTokens,
          returnMetadata: true,
        }),
      };
      partial = await runLegacyDbWholeArticleArm({
        query,
        llm,
        articleText: article.text,
        extractionMode: modeResolution.mode,
        assertionLanguage: options.assertionLanguage,
      });
      const metadata = await activePromptMetadata(partial.promptSelection.selectedNames);
      const claims = partial.extraction.claimsDetailed;
      const record = {
        repeat,
        status: "completed",
        elapsedMs: Date.now() - started,
        request: partial.request,
        fingerprints: partial.fingerprints,
        promptSelection: partial.promptSelection,
        activePromptMetadata: metadata,
        provider: partial.provider,
        modelRawOutput: partial.modelRawOutput,
        rawOutput: partial.rawOutput,
        reasoningStack: partial.extraction.reasoningStack,
        claims,
        roles: roleCounts(claims),
      };
      records.push(record);
      writeFileSync(path.join(outDir, `repeat-${repeat}.json`), JSON.stringify(record, null, 2));
      console.log(`ok · ${claims.length} claims · ${(record.elapsedMs / 1000).toFixed(1)}s`);
    } catch (error) {
      const record = {
        repeat,
        status: "failed",
        elapsedMs: Date.now() - started,
        error: error.cause?.message ?? error.message,
        request: partial?.request ?? null,
        fingerprints: partial?.fingerprints ?? null,
      };
      records.push(record);
      writeFileSync(path.join(outDir, `repeat-${repeat}.json`), JSON.stringify(record, null, 2));
      console.log(`FAILED · ${record.error}`);
    }
  }

  const artifact = {
    arm: LEGACY_DB_WHOLE_ARTICLE_ARM,
    fixture: options.fixture,
    articleContentHash: article.contentHash,
    generatedAt,
    options,
    modeResolution,
    records,
  };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  const csvHeader = ["repeat", "status", "claimIndex", "claimText", "role", "parentId",
    "centrality", "verifiability", "priority", "articleStance", "sourceCitedInArticle",
    "namedEntities", "studiesOrDocuments", "searchText", "isFallibilityCritical"];
  const csvRows = records.flatMap((record) => record.status === "completed"
    ? record.claims.map((claim, index) => [record.repeat, record.status, index + 1,
      claim.text, claim.role, claim.parentId, claim.centrality, claim.verifiability,
      claim.priority, claim.articleStance, claim.sourceCitedInArticle,
      (claim.namedEntities ?? []).join(";"), (claim.studiesOrDocuments ?? []).join(";"),
      claim.searchText, claim.isFallibilityCritical].map(csv).join(","))
    : [[record.repeat, record.status, "", record.error, "", "", "", "", "", "", "",
      "", "", "", ""].map(csv).join(",")]);
  writeFileSync(path.join(outDir, "claims.csv"),
    `${csvHeader.map(csv).join(",")}\n${csvRows.join("\n")}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderReport({
    fixture: options.fixture,
    generatedAt,
    options,
    modeResolution,
    records,
  }));
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`CSV: ${path.join(outDir, "claims.csv")}`);
  if (records.some((record) => record.status === "failed")) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
