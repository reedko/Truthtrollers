import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { extractProductionReadableHtml } from "../../src/core/productionDocumentExtraction.js";
import { looksLikeGenuineArticleText } from "../../src/utils/fetchWithFallbacks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const sourceRun = path.resolve(process.argv[2] || "");
const reviewDirectory = path.resolve(process.argv[3] || "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node auditLegacyEvidencePromptsAndAcquisitionFailures.mjs <source-run> <review-directory>");
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fence = (value, language = "text") => `\`\`\`${language}\n${String(value || "").trimEnd()}\n\`\`\``;
const codeSlice = (source, startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start < 0 || end < 0) throw new Error(`Could not slice source between ${startNeedle} and ${endNeedle}`);
  return source.slice(start, end + endNeedle.length);
};

const report = await readJson(path.join(sourceRun, "report.json"));
const wikipediaDirectory = path.join(sourceRun, "documents", "DOC-bba9c9ef152859d0e207");
const wikipediaHtml = await readFile(path.join(wikipediaDirectory, "attempt-001-raw-response.txt"), "utf8");
const wikipediaExtracted = extractProductionReadableHtml(wikipediaHtml, {
  url: "https://en.wikipedia.org/wiki/MMR_vaccine_and_autism",
  maximumCharacters: 2_000_000,
});
const wikipediaAssessment = looksLikeGenuineArticleText(wikipediaExtracted.text);
const repeatedFragments = new Map();
for (const fragment of wikipediaExtracted.text.replace(/\s+/gu, " ").trim()
  .split(/(?<=[.!?])\s+|\n/u).map((value) => value.trim()).filter(Boolean)) {
  if (fragment.length < 20) continue;
  repeatedFragments.set(fragment, (repeatedFragments.get(fragment) || 0) + 1);
}
const wikipediaRepeated = [...repeatedFragments]
  .filter(([, count]) => count >= 4)
  .sort((left, right) => right[1] - left[1]);

const senate = report.documents.find((document) => document.documentKey === "DOC-f3c2315d916838f731d6");
const wikipedia = report.documents.find((document) => document.documentKey === "DOC-bba9c9ef152859d0e207");
if (!senate || !wikipedia) throw new Error("The two expected failed documents are missing from report.json");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const promptNames = [
  "claim_extraction_stack_system",
  "claim_extraction_stack_with_topics",
  "claim_extraction_stack_no_topics",
  "claim_extraction_source_context_instruction",
  "claim_extraction_unresolved_targets_instruction",
  "claim_extraction_edge_for_source_system",
  "claim_extraction_edge_for_source_user",
  "claim_matching_system",
  "claim_matching_user",
  "claim_matching_bearing_system",
  "claim_matching_bearing_user",
  "theme_fusion",
];
const placeholders = promptNames.map(() => "?").join(",");
const [promptRows] = await connection.query(
  `SELECT prompt_id,prompt_name,prompt_type,prompt_text,parameters,version,is_active,
          max_claims,min_sources,max_sources
     FROM llm_prompts
    WHERE prompt_name IN (${placeholders})
    ORDER BY prompt_name,version,prompt_id`,
  promptNames,
);
const [configRows] = await connection.query(
  `SELECT config_key,config_value
     FROM evidence_search_config
    WHERE config_key IN ('extraction_mode','extraction_mode_config','bearing_config')
    ORDER BY config_key`,
);
await connection.end();

const historicalProcess = execFileSync("git", [
  "show", "4714383a^:backend/src/core/processTaskClaims.js",
], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 5_000_000 });
const historicalClaimsEngine = execFileSync("git", [
  "show", "4714383a^:backend/src/core/claimsEngine.js",
], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 10_000_000 });
const originalClaimsEngine = execFileSync("git", [
  "show", "968ed20d:backend/src/core/claimsEngine.js",
], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 10_000_000 });
const currentProcess = await readFile(path.join(backendRoot, "src/core/processTaskClaims.js"), "utf8");
const currentMatcher = await readFile(path.join(backendRoot, "src/core/matchClaims.js"), "utf8");
const currentQuote = await readFile(path.join(backendRoot, "src/utils/extractQuote.js"), "utf8");

const originalPromptCode = codeSlice(
  originalClaimsEngine,
  "    const system =",
  "      temperature: 0.2,\n    });",
);
const databaseEraAssemblyCode = codeSlice(
  historicalClaimsEngine,
  "    const prompts = await this.loadClaimExtractionPrompts(",
  "      temperature: 0.2,\n    });",
);
const historicalRouteCode = codeSlice(
  historicalProcess,
  "  // -----------------------------------------------------\n  // 1. Claim extraction (LLM)",
  "  let claims = extraction.claimsDetailed || extraction.claims || [];",
);
const currentFlowCode = codeSlice(
  currentProcess,
  "  // =====================================================\n  // PROMPT 4: Detect provisional article frame",
  "  const selectedEvaluationClaims = await reduceEvaluationClaims(evaluationClusterGroups, finalFrame);",
);
const matcherAssemblyCode = codeSlice(
  currentMatcher,
  "  // Try to load from database if promptManager is available",
  "  const schemaHint = `",
);
const quotePromptCode = codeSlice(
  currentQuote,
  "    const system = `You extract verbatim quotes from sources AND evaluate source quality in a single analysis. Return valid JSON only.`;",
  "    const out = await llm.generate({",
);

const activeRows = promptRows.filter((row) => Boolean(row.is_active));
const rowSection = (row) => [
  `### ${row.prompt_name} — version ${row.version}${row.is_active ? " (ACTIVE)" : " (inactive historical row)"}`,
  "",
  `- DB row: \`${row.prompt_id}\``,
  `- Type: \`${row.prompt_type}\``,
  `- Parameters: \`${JSON.stringify(row.parameters ?? {})}\``,
  `- Limits: max_claims=${row.max_claims}, min_sources=${row.min_sources}, max_sources=${row.max_sources}`,
  "",
  fence(row.prompt_text),
  "",
].join("\n");

const markdown = [
  "# Legacy production evidence prompts and failed-acquisition analysis",
  "",
  `Generated from source run \`${report.runId}\`, current repository code, git history, and read-only queries against the live development \`llm_prompts\` and \`evidence_search_config\` tables.`,
  "",
  "No model call, production mutation, or prompt-table mutation was made.",
  "",
  "## Bottom line",
  "",
  "1. Wikipedia did load and extract correctly. It was discarded by a false-positive duplicate-fragment heuristic.",
  "2. The Senate PDF parser did not fail. Akamai denied the automated transport before PDF bytes arrived; then the Wayback/headless PDF fallbacks incorrectly treated the browser's empty PDF-viewer shell as HTML.",
  "3. The production reference-claim path that previously worked was materially simpler than today's `processTaskClaims()` path. It made one whole-document `ClaimExtractor.analyzeContent()` request, then a separate all-pairs `matchClaimsToTaskClaims()` request.",
  "4. Today's `processTaskClaims()` no longer calls `ClaimExtractor.analyzeContent()` at all. It runs frame detection, chunk surveys, theme fusion, optional repair, and reduction. Consequently, the live DB `claim_extraction_stack_*` prompts are currently dormant for that route even though they remain active in the database.",
  "",
  "## Failure 1: Wikipedia",
  "",
  `- URL: ${wikipedia.url}`,
  `- Direct HTTP: 200; raw HTML: ${wikipediaHtml.length.toLocaleString()} characters.`,
  `- Bot/challenge detected: no.`,
  `- Extractor selected: \`${wikipediaExtracted.method}\`.`,
  `- Extracted article text: ${wikipediaExtracted.text.length.toLocaleString()} characters / ${wikipediaAssessment.wordCount?.toLocaleString()} words.`,
  `- First extracted sentence: “${wikipediaExtracted.text.slice(0, 188)}…”`,
  `- Rejection rule: \`${wikipediaAssessment.reason}\`; maximum identical-fragment count: ${wikipediaAssessment.maxRepeat}.`,
  "- Exact repeated fragments that triggered the generic boilerplate rule:",
  ...wikipediaRepeated.map(([fragment, count]) => `  - ${count}× \`${fragment}\``),
  "",
  "**Specific defect:** `looksLikeGenuineArticleText()` rejects any non-trivial sentence fragment repeated four times. Wikipedia citation/reference prose legitimately repeats “Retrieved …” dates. The validator does not distinguish reference-list boilerplate from duplicated article-body boilerplate. All four acquisition tiers therefore threw away valid extracted prose.",
  "",
  "**Correct classification:** successful acquisition followed by false-negative local validation—not a loading failure, botwall, Readability failure, or model failure.",
  "",
  "## Failure 2: Senate birth-cohort PDF",
  "",
  `- URL: ${senate.url}`,
  "- Controlled diagnostic fetch: HTTP 403, `Content-Type: text/html`, 678-byte body.",
  "- Edge response: `Server: AkamaiGHost`, `X-Reference-Error: 18.91f23517.1785645359.626a0b81`.",
  "- Body title: `Access Denied`; this is edge/network access control, not an interactive browser challenge page.",
  "- Direct and direct-retry attempts never received `%PDF-` bytes, so `extractProductionPdfDocument()` and `pdf-parse` were never reached.",
  `- Wayback result: ${senate.attempts[2].characterCount} bytes; headless result: ${senate.attempts[3].characterCount} bytes.`,
  "- Both 242-byte results are the Chromium built-in PDF viewer's empty HTML shell:",
  "",
  fence("<!DOCTYPE html><html><head>\n  <style>\n    body { height: 100%; width: 100%; overflow: hidden; margin: 0; background-color: rgb(38, 38, 38); }\n  </style>\n</head><body></body></html>", "html"),
  "",
  "**Specific defects:**",
  "",
  "- `acquireCfxDocumentAutomatically()` correctly recognizes `.pdf` only in its direct-stage branch.",
  "- Its Wayback/headless loop unconditionally calls `extractProductionHtmlDocument()` even when the canonical URL is a PDF.",
  "- `fetchWithPuppeteer()` returns `page.content()`, which is only the browser's PDF-viewer shell—not the PDF response body.",
  "- No alternate repository/attachment URL was present on this candidate, and the ladder never attempted a binary Wayback download or intercepted the PDF network response.",
  "",
  "**Correct classification:** current direct access was denied by Akamai, followed by a PDF-specific fallback-routing bug. Prior successful parser tests are not contradicted: those tests supplied actual PDF bytes; this run supplied none.",
  "",
  "## What the earlier working production path actually did",
  "",
  "At commit `4714383a^` (the production path immediately before the July multi-pass replacement), both reference scrape routes called `processTaskClaims({ claimType: 'reference', taskClaimsContext })`. The function performed one whole-document extraction call:",
  "",
  fence(historicalRouteCode, "js"),
  "",
  "Prompt-selection order was:",
  "",
  "1. `claim_extraction_stack_system`;",
  "2. `claim_extraction_stack_with_topics` for the first/only whole-document chunk;",
  "3. `claim_extraction_source_context_instruction` prepended when case-claim context was supplied;",
  "4. source-specific edge prompts only as fallbacks if the preferred stack prompts were absent.",
  "",
  "This means the active `claim_extraction_edge_for_source_*` rows were not selected while the active stack prompts existed. The code's exact assembly was:",
  "",
  fence(databaseEraAssemblyCode, "js"),
  "",
  "The resulting model-visible user message was:",
  "",
  fence(`You are a fact-checking assistant.

<claim_extraction_source_context_instruction with {{taskClaims}} replaced, when supplied>
<claim_extraction_stack_with_topics with min/max/mode/role tokens replaced>

TEXT:
<complete acquired reference-document text>`),
  "",
  "It used temperature `0.2` and `schemaHint: \"\"`.",
  "",
  "## The original working-era simple extractor (commit 968ed20d, 2025-12-18)",
  "",
  "This is the exact production source that assembled the original evidence-document extraction request. Dynamic values were only the claim bounds, optional testimonial context, and document text:",
  "",
  fence(originalPromptCode, "js"),
  "",
  "This was one direct extraction request per document. It did not run frame detection, theme fusion, repair, or semantic reduction before persisting reference claims.",
  "",
  "## Current production divergence",
  "",
  "Current `processTaskClaims()` uses the following multi-stage path for both task and reference content. Notice that `claimType` and `taskClaimsContext` are not passed into frame detection or chunk surveying, and `ClaimExtractor.analyzeContent()` is not invoked:",
  "",
  fence(currentFlowCode, "js"),
  "",
  "This is why merely inspecting the active DB claim-extraction prompts does not describe today's route. The route bypasses them, except that `theme_fusion` remains DB-backed.",
  "",
  "## Live database configuration",
  "",
  fence(JSON.stringify(configRows, null, 2), "json"),
  "",
  "The database has no timestamps on `llm_prompts`, so it cannot prove which prompt version was active for an arbitrary historical run. The git call path proves the selected prompt names; the rows below preserve every currently stored version of those names.",
  "",
  "## Exact live and historical DB prompt rows",
  "",
  ...promptRows.map(rowSection),
  "## Separate legacy all-pairs claim matcher",
  "",
  "After extracting reference claims, production called `matchClaimsToTaskClaims()` once with all reference claims and all case claims. Its DB prompt pair is included above. Current assembly additionally appends stance/misconduct contracts and a required `{\"matches\":[...]}` envelope:",
  "",
  fence(matcherAssemblyCode, "js"),
  "",
  "## Separate per-case quote and quality call",
  "",
  "Production also had an overlapping path that read up to the first 8,000 characters of the source against one case claim, extracted quotes, classified stance, and scored eight quality dimensions. This was not the reference-claim extractor; it was an additional semantic call. Its current exact inline prompt construction is:",
  "",
  fence(quotePromptCode, "js"),
  "",
  "## Audit conclusion",
  "",
  "The acquisition failures are deterministic host bugs, not evidence that these documents are unavailable or unparseable. The prompt audit also confirms that the older successful reference pipeline began with a simple whole-document claim extraction call. The present multi-pass `processTaskClaims()` architecture is a later replacement and should not be mistaken for the prompt path used by the earlier working reference runs.",
  "",
].join("\n");

const auditPath = path.join(reviewDirectory, "legacy_production_prompts_and_failure_analysis.md");
await writeFile(auditPath, markdown, "utf8");

const promptDumpPath = path.join(reviewDirectory, "live_db_prompt_rows.json");
await writeFile(promptDumpPath, `${JSON.stringify({
  capturedAt: new Date().toISOString(),
  readOnly: true,
  configRows,
  activePromptCount: activeRows.length,
  promptRows,
}, null, 2)}\n`, "utf8");

const names = (await readdir(reviewDirectory))
  .filter((name) => name !== "artifact_hashes.json")
  .sort();
const files = [];
for (const name of names) {
  const content = await readFile(path.join(reviewDirectory, name));
  files.push({ path: name, bytes: content.length, sha256: sha256(content) });
}
const aggregateSha256 = sha256(files.map((file) => `${file.path}\0${file.sha256}`).join("\n"));
await writeFile(path.join(reviewDirectory, "artifact_hashes.json"), `${JSON.stringify({
  sourceRun,
  files,
  aggregateSha256,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  auditPath,
  promptDumpPath,
  promptRows: promptRows.length,
  activePromptRows: activeRows.length,
  aggregateSha256,
}, null, 2));
