#!/usr/bin/env node
// Isolated benchmark: local factual questions from small structural-block
// batches, followed by article-blind evidence-axis and orientation synthesis.
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const { createOpenAiStreamingCf1Transport } = await import(
  "../test/claim-foundry/prompt-benchmark/openAiStreamingTransport.js");
const { P1A_V13_LOCAL_QUESTIONS, buildP1aV13BlockBatches,
  buildP1aV13LocalQuestionsPrompt,
  normalizeAndVerifyP1aV13LocalQuestions, mergeP1aV13LocalQuestions } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV13LocalQuestions.js");
const { P1A_V13_AXIS_SYNTHESIS, buildP1aV13AxisSynthesisPrompt,
  verifyAndEnrichP1aV13AxisSynthesis } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV13AxisSynthesis.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini", seed: 3724605090,
    maximumBlocks: 7, timeoutMs: 240_000, localMaxOutputTokens: 6_000,
    synthesisMaxOutputTokens: 10_000, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--maximum-blocks") options.maximumBlocks = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--local-max-output-tokens") options.localMaxOutputTokens = Number(argv[++index]);
    else if (arg === "--synthesis-max-output-tokens") options.synthesisMaxOutputTokens = Number(argv[++index]);
    else if (arg === "--out") options.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function fingerprint(prompt) {
  const schema = JSON.stringify(prompt.responseSchema);
  return { systemSha256: sha(prompt.system), userSha256: sha(prompt.user),
    schemaSha256: sha(schema), assembledSha256: sha(`${prompt.system}\n${prompt.user}\n${schema}`) };
}

async function invoke({ prompt, label, options, maxOutputTokens }) {
  const events = [];
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName: "question", repetitionThreshold: 4,
    onClaim: (event) => events.push(event),
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, maxOutputTokens,
    usageContext: { component: "claim_foundry", path: "p1a_v13_bottom_up", stage: label } });
  return { label, output: response.output, usage: response.usage,
    elapsedMs: Date.now() - startedAt, events, fingerprint: fingerprint(prompt), prompt,
    provider: { responseId: response.rawResponse?.id ?? null,
      requestId: response.rawResponse?.request_id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model,
      finishReason: response.rawResponse?.choices?.[0]?.finish_reason ?? null },
    streaming: response.rawResponse?.streamingDiagnostics ?? null };
}

function totalUsage(calls) {
  return calls.reduce((total, call) => ({
    inputTokens: total.inputTokens + (call.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (call.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (call.usage?.totalTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens + (call.usage?.cachedInputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 });
}

function promptDetails(call, title) {
  return `<details><summary>${esc(title)} · exact prompt, schema, and fingerprint</summary>
    <h4>System</h4><pre>${esc(call.prompt.system)}</pre>
    <h4>User</h4><pre>${esc(call.prompt.user)}</pre>
    <h4>Structured-output schema</h4><pre>${esc(JSON.stringify(call.prompt.responseSchema, null, 2))}</pre>
    <h4>Fingerprint, provider, usage</h4><pre>${esc(JSON.stringify({ fingerprint: call.fingerprint,
      provider: call.provider, usage: call.usage, elapsedMs: call.elapsedMs,
      streaming: call.streaming }, null, 2))}</pre></details>`;
}

function renderReport({ options, article, structuralBlocks, sourceUnits, batches,
  batchCalls, merged, synthesisCall, synthesis, usage, wallMs }) {
  const byId = new Map(merged.questions.map((item) => [item.localQuestionId, item]));
  const emptyBlocks = merged.blocks.filter((item) => !item.questions.length);
  const batchRows = batchCalls.map(({ batch, call, blocks, attempts, corrections }) => `<tr><td>${esc(batch.batchId)}</td>
    <td>${batch.blockIds.length}</td><td>${blocks.reduce((sum, block) => sum + block.questions.length, 0)}</td>
    <td>${attempts.reduce((sum, item) => sum + item.usage.totalTokens, 0)}</td>
    <td>${(attempts.reduce((sum, item) => sum + item.elapsedMs, 0) / 1000).toFixed(1)}s</td>
    <td>${esc(`${batch.blockIds[0]}–${batch.blockIds.at(-1)}`)}${corrections.length ? ` · ${corrections.length} host block-ID correction(s)` : ""}</td></tr>`).join("");
  const axisRows = synthesis.evidenceAxes.map((axis) => {
    const members = axis.localQuestionIds.map((id) => byId.get(id)).filter(Boolean);
    return `<tr><td>${esc(axis.axisId)}</td><td><b>${esc(axis.label)}</b><br>${esc(axis.question)}</td>
      <td>${esc(axis.proposition)}</td><td>${esc(axis.ifSupported)}</td><td>${esc(axis.ifRefuted)}</td>
      <td>${axis.localQuestionIds.length}</td><td>${esc(axis.sourceBlockIds.join(", "))}</td></tr>
      <tr class="detail-row"><td colspan="7"><details><summary>Member local questions and grounding</summary>
      ${members.map((item) => `<article><b>${esc(item.localQuestionId)} · ${esc(item.blockId)}</b>
      <p>${esc(item.question)}</p><p><i>Contested subject:</i> ${esc(item.contestedSubject)}<br>
      <i>Disconfirming finding:</i> ${esc(item.disconfirmingFinding)}<br>
      <i>Units:</i> ${esc(item.sourceUnitIds.join(", "))}</p></article>`).join("")}
      </details></td></tr>`;
  }).join("");
  const blockDetails = merged.blocks.map((block) => `<details><summary>${esc(block.blockId)} ·
    ${block.questions.length} local question${block.questions.length === 1 ? "" : "s"}</summary>
    ${block.questions.length ? block.questions.map((item) => `<article><b>${esc(item.localQuestionId)}</b>
    <p>${esc(item.question)}</p><p><i>Contested subject:</i> ${esc(item.contestedSubject)}<br>
    <i>Disconfirming finding:</i> ${esc(item.disconfirmingFinding)}<br><i>Units:</i>
    ${esc(item.sourceUnitIds.join(", "))}</p></article>`).join("") : "<p>No locally resolvable factual question.</p>"}
    </details>`).join("");
  const unassigned = synthesis.unassignedLocalQuestionIds.map((id) => byId.get(id)).filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>P1aV13 bottom-up report</title>
  <style>body{font:14px system-ui;margin:24px;color:#18212b;line-height:1.45}section{margin:30px 0;border-top:4px solid #34495e;padding-top:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c8ced4;padding:7px;text-align:left;vertical-align:top}th{background:#edf1f4}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.card{background:#f3f6f8;padding:12px;border:1px solid #ccd4da}.note{background:#fff8d9;border:1px solid #dfcc70;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}summary{cursor:pointer;font-weight:650}article{border-left:3px solid #6685a5;padding-left:10px;margin:10px 0}.orientation{background:#eaf4ed;border:1px solid #8ab596;padding:14px}.detail-row td{background:#fafcff}</style></head><body>
  <h1>${esc(options.fixture)} · P1aV13 bottom-up orientation</h1>
  <p class="note">Experimental benchmark only. Pass A saw small article blocks and no global argument
  concepts. Pass B saw only Pass A's local questions—not the article. No assertions, stance,
  selection, or evidence packages were generated.</p>
  <div class="cards"><div class="card"><b>${batches.length + 1}</b><br>model calls</div>
  <div class="card"><b>${merged.questions.length}</b><br>local questions</div>
  <div class="card"><b>${synthesis.evidenceAxes.length}</b><br>evidence axes</div>
  <div class="card"><b>${emptyBlocks.length}/${structuralBlocks.length}</b><br>empty blocks</div>
  <div class="card"><b>${synthesis.unassignedLocalQuestionIds.length}</b><br>unassigned questions</div>
  <div class="card"><b>${usage.totalTokens}</b><br>total tokens</div>
  <div class="card"><b>${(wallMs / 1000).toFixed(1)}s</b><br>wall time</div></div>
  <section><h2>Pass B orientation</h2><div class="orientation"><p><b>Thesis</b><br>${esc(synthesis.thesis.text)}</p>
  <p><b>Theme</b><br>${esc(synthesis.theme.text)}</p><p><b>Thesis hinge:</b> ${esc(synthesis.thesisHinge)}</p>
  <p><b>Thesis grounding:</b> ${esc(synthesis.thesis.sourceLocalQuestionIds.join(", "))}<br>
  <b>Theme grounding:</b> ${esc(synthesis.theme.sourceLocalQuestionIds.join(", "))}</p></div></section>
  <section><h2>${synthesis.evidenceAxes.length} evidence axes</h2><table><thead><tr><th>ID</th><th>Axis</th>
  <th>Directional proposition</th><th>If supported</th><th>If refuted</th><th>Questions</th><th>Blocks</th>
  </tr></thead><tbody>${axisRows}</tbody></table></section>
  <section><h2>Unassigned local questions</h2>${unassigned.length ? unassigned.map((item) =>
    `<p><b>${esc(item.localQuestionId)} · ${esc(item.blockId)}</b> — ${esc(item.question)}</p>`).join("")
    : "<p>None.</p>"}</section>
  <section><h2>Pass A batch performance</h2><table><thead><tr><th>Batch</th><th>Blocks</th>
  <th>Questions</th><th>Tokens</th><th>Time</th><th>Range</th></tr></thead><tbody>${batchRows}</tbody></table></section>
  <section><h2>Local questions by structural block</h2>${blockDetails}</section>
  <section><h2>Exact prompts and reproducibility</h2>${batchCalls.map(({ batch, attempts }) =>
    attempts.map((call, index) => promptDetails(call,
      `${batch.batchId}${index ? ` ownership retry ${index}` : ""}`)).join("")).join("")}${promptDetails(synthesisCall, P1A_V13_AXIS_SYNTHESIS)}</section>
  <footer><p>${esc(article.title)} · ${sourceUnits.length} source units · model ${esc(options.model)} ·
  seed ${options.seed}</p></footer></body></html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures",
    options.fixture, "article.json"), "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const sourceUnits = articleDocument.sourceUnits;
  const batches = buildP1aV13BlockBatches({ structuralBlocks,
    maximumBlocks: options.maximumBlocks });
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(options.out ?? path.join(repoRoot,
    "artifacts/claim-foundry/p1a-v13-bottom-up", `${options.fixture.toLowerCase()}-${stamp}`));
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const wallStartedAt = Date.now();

  const prompts = batches.map((batch) => ({ batch,
    prompt: buildP1aV13LocalQuestionsPrompt({ batch, sourceUnits }) }));
  for (const { batch, prompt } of prompts) writeFileSync(path.join(outDir, "prompts",
    `${batch.batchId}.json`), JSON.stringify(prompt, null, 2));
  console.log(`Pass A · ${batches.length} parallel local-question batches …`);
  const batchCalls = await Promise.all(prompts.map(async ({ batch, prompt }) => {
    const call = await invoke({ prompt, label: batch.batchId, options,
      maxOutputTokens: options.localMaxOutputTokens });
    const attempts = [call];
    writeFileSync(path.join(outDir, `${batch.batchId}-attempt-1-model-raw.json`),
      JSON.stringify({ output: call.output, fingerprint: call.fingerprint,
        provider: call.provider, usage: call.usage, elapsedMs: call.elapsedMs }, null, 2));
    const normalized = normalizeAndVerifyP1aV13LocalQuestions(call.output, batch);
    const { blocks, corrections } = normalized;
    const questionCount = blocks.reduce((sum, block) => sum + block.questions.length, 0);
    console.log(`  ${batch.batchId} · ${blocks.length} blocks · ${questionCount} questions · ${call.usage.totalTokens} tokens · ${(call.elapsedMs / 1000).toFixed(1)}s${corrections.length ? ` · ${corrections.length} host block-ID correction(s)` : ""}`);
    return { batch, call, attempts, blocks, corrections };
  }));
  writeFileSync(path.join(outDir, "pass-a-model-raw.json"), JSON.stringify(batchCalls.map(
    ({ batch, call, corrections }) => ({ batchId: batch.batchId, output: call.output,
      fingerprint: call.fingerprint, provider: call.provider, usage: call.usage,
      elapsedMs: call.elapsedMs, corrections })), null, 2));
  const merged = mergeP1aV13LocalQuestions(batchCalls.map(({ batch, blocks }) =>
    ({ batchId: batch.batchId, blocks })));

  console.log(`Pass B · article-blind synthesis from ${merged.questions.length} questions …`);
  const synthesisPrompt = buildP1aV13AxisSynthesisPrompt({ localQuestions: merged.questions });
  writeFileSync(path.join(outDir, "prompts", "P1aV13-B.json"),
    JSON.stringify(synthesisPrompt, null, 2));
  const synthesisCall = await invoke({ prompt: synthesisPrompt,
    label: P1A_V13_AXIS_SYNTHESIS, options,
    maxOutputTokens: options.synthesisMaxOutputTokens });
  writeFileSync(path.join(outDir, "pass-b-model-raw.json"),
    JSON.stringify({ output: synthesisCall.output, fingerprint: synthesisCall.fingerprint,
      provider: synthesisCall.provider, usage: synthesisCall.usage,
      elapsedMs: synthesisCall.elapsedMs }, null, 2));
  const synthesis = verifyAndEnrichP1aV13AxisSynthesis(synthesisCall.output, merged.questions);

  const usage = totalUsage([...batchCalls.flatMap((item) => item.attempts), synthesisCall]);
  const wallMs = Date.now() - wallStartedAt;
  const artifact = { label: "P1aV13-bottom-up", generatedAt, options,
    article: { title: article.title, contentHash: article.contentHash,
      structuralBlockCount: structuralBlocks.length, sourceUnitCount: sourceUnits.length },
    calls: { passA: P1A_V13_LOCAL_QUESTIONS, passB: P1A_V13_AXIS_SYNTHESIS,
      count: batches.length + 1 }, wallMs, usage,
    batches: batchCalls.map(({ batch, call, attempts, blocks, corrections }) => ({
      batch: { ...batch, blocks: undefined }, blocks,
      corrections,
      attempts: attempts.map((attempt) => ({ label: attempt.label, usage: attempt.usage,
        elapsedMs: attempt.elapsedMs, fingerprint: attempt.fingerprint,
        provider: attempt.provider, streaming: attempt.streaming })),
      call: { label: call.label, usage: call.usage, elapsedMs: call.elapsedMs,
        fingerprint: call.fingerprint, provider: call.provider, streaming: call.streaming } })),
    localQuestions: merged.questions, blockResults: merged.blocks, synthesis,
    synthesisCall: { usage: synthesisCall.usage, elapsedMs: synthesisCall.elapsedMs,
      fingerprint: synthesisCall.fingerprint, provider: synthesisCall.provider,
      streaming: synthesisCall.streaming } };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));

  const localHeaders = ["localQuestionId", "batchId", "blockId", "question",
    "contestedSubject", "disconfirmingFinding", "sourceUnitIds"];
  const batchByBlock = new Map(batches.flatMap((batch) =>
    batch.blockIds.map((blockId) => [blockId, batch.batchId])));
  writeFileSync(path.join(outDir, "local-questions.csv"),
    `${localHeaders.map(csv).join(",")}\n${merged.questions.map((item) =>
      [item.localQuestionId, batchByBlock.get(item.blockId), item.blockId, item.question,
        item.contestedSubject, item.disconfirmingFinding, item.sourceUnitIds.join(";")]
        .map(csv).join(",")).join("\n")}\n`);
  const axisHeaders = ["axisId", "label", "question", "proposition", "ifSupported",
    "ifRefuted", "localQuestionIds", "sourceBlockIds", "sourceUnitIds"];
  writeFileSync(path.join(outDir, "evidence-axes.csv"),
    `${axisHeaders.map(csv).join(",")}\n${synthesis.evidenceAxes.map((axis) =>
      [axis.axisId, axis.label, axis.question, axis.proposition, axis.ifSupported, axis.ifRefuted,
        axis.localQuestionIds.join(";"), axis.sourceBlockIds.join(";"), axis.sourceUnitIds.join(";")]
        .map(csv).join(",")).join("\n")}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderReport({ options, article,
    structuralBlocks, sourceUnits, batches, batchCalls, merged, synthesisCall, synthesis,
    usage, wallMs }));
  console.log(`Result · ${merged.questions.length} local questions · ${synthesis.evidenceAxes.length} axes · ${synthesis.unassignedLocalQuestionIds.length} unassigned · ${usage.totalTokens} tokens · ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`Local questions: ${path.join(outDir, "local-questions.csv")}`);
  console.log(`Axes: ${path.join(outDir, "evidence-axes.csv")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
