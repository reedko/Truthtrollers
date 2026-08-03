import type {
  CfxCanonicalInventory,
} from "../../types/index.js";
import { escapeHtml } from "../../grounding/report/escapeHtml.js";

export type CfxS1ReportInput = {
  runId: string;
  generatedAt: string;
  fixtureId: string;
  articleTitle: string;
  articleCharacterCount: number;
  sourceUnitCount: number;
  fixtureFileSha256: string;
  articleTextSha256: string;
  sourceUnitManifestHash: string;
  promptId: string;
  promptHash: string;
  promptText: string;
  schemaHash: string;
  requestHash: string;
  canonicalInventoryHash: string;
  artifactAggregateSha256: string;
  model: string;
  temperature: number;
  providerCallCount: number;
  retryCount: number;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  canonicalInventory: CfxCanonicalInventory;
  sourceRunDirectory: string;
  articleText: string;
};

function wordCount(value: string): number {
  return value.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length ?? 0;
}

export function buildCfxS1ReportHtml(input: CfxS1ReportInput): string {
  const propositions = [...input.canonicalInventory.propositions]
    .sort((left, right) => left.propositionId.localeCompare(right.propositionId));
  const exactSourceLabels = propositions.filter((row) =>
    input.articleText.includes(row.assertionSource)).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CFX Whole-Article Meaning Discovery</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#657084;--line:#d7dce4;--paper:#fff;--wash:#f4f6f9;--accent:#285f52;--accent2:#e7f3ef}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1080px;margin:0 auto;padding:38px 24px 80px}header{background:#132d2a;color:#fff;border-radius:16px;padding:34px;margin-bottom:22px}header p{max-width:800px;color:#dceae6}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.78rem;font-weight:750;color:#9dd5c5}h1{font-size:2.25rem;line-height:1.1;margin:.35rem 0 1rem}h2{margin-top:34px}h3{line-height:1.25}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.metric,.panel,.claim{background:var(--paper);border:1px solid var(--line);border-radius:12px}.metric{padding:15px}.metric strong{display:block;font-size:1.45rem;color:var(--accent)}.metric span,.muted{color:var(--muted)}.panel{padding:20px;margin:16px 0}.claim{padding:22px;margin:14px 0;border-left:5px solid var(--accent)}.claim-id{font:700 .8rem/1 ui-monospace,SFMono-Regular,monospace;color:var(--accent);letter-spacing:.08em}.claim h3{margin:.55rem 0 1rem}.label{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;font-weight:750;color:var(--muted);margin-top:1rem}.source,.why{margin:.3rem 0}.why{background:var(--accent2);padding:12px;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef1f5;border-radius:8px;padding:16px}code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.88em;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;background:#fff}th,td{border:1px solid var(--line);padding:9px;text-align:left;vertical-align:top}th{background:#eef1f5}.warning{border-left:5px solid #b47b24;background:#fff8e8}.ok{border-left:5px solid var(--accent)}
</style>
</head>
<body><main class="wrap">
<header>
  <div class="eyebrow">CFX · S0 frozen input + S1 meaning discovery</div>
  <h1>The one-call whole-article result</h1>
  <p>This is the simple experiment: the complete article was shown once, and the model returned the 12 propositions it judged to carry the article’s burden of proof. No chunks, assertion inventory, semantic grouping, selector, grounding pass, or evaluator was visible.</p>
</header>

<section class="grid">
  <div class="metric"><strong>${propositions.length}</strong><span>canonical propositions</span></div>
  <div class="metric"><strong>${input.providerCallCount}</strong><span>model request</span></div>
  <div class="metric"><strong>${input.usage.inputTokens.toLocaleString()}</strong><span>input tokens</span></div>
  <div class="metric"><strong>${input.usage.outputTokens.toLocaleString()}</strong><span>output tokens</span></div>
  <div class="metric"><strong>${(input.latencyMs / 1000).toFixed(2)}s</strong><span>latency</span></div>
  <div class="metric"><strong>${input.retryCount}</strong><span>retries</span></div>
</section>

<section class="panel ok">
  <h2>Run identity</h2>
  <table>
    <tbody>
      <tr><th>Run ID</th><td><code>${escapeHtml(input.runId)}</code></td></tr>
      <tr><th>Fixture</th><td>${escapeHtml(input.fixtureId)} — ${escapeHtml(input.articleTitle)}</td></tr>
      <tr><th>Model</th><td><code>${escapeHtml(input.model)}</code>, temperature ${escapeHtml(input.temperature)}</td></tr>
      <tr><th>Article</th><td>${input.articleCharacterCount.toLocaleString()} characters; ${input.sourceUnitCount} deterministic S0 units</td></tr>
      <tr><th>Canonical inventory hash</th><td><code>${escapeHtml(input.canonicalInventoryHash)}</code></td></tr>
      <tr><th>Run artifact hash</th><td><code>${escapeHtml(input.artifactAggregateSha256)}</code></td></tr>
      <tr><th>Source run</th><td><code>${escapeHtml(input.sourceRunDirectory)}</code></td></tr>
    </tbody>
  </table>
</section>

<section>
  <h2>The 12 burden-bearing propositions</h2>
  ${propositions.map((row) => `<article class="claim">
    <div class="claim-id">${escapeHtml(row.propositionId)}</div>
    <h3>${escapeHtml(row.assertion)}</h3>
    <div class="label">Assertion source</div>
    <p class="source">${escapeHtml(row.assertionSource)}</p>
    <div class="label">Why it matters to the article’s thesis</div>
    <p class="why">${escapeHtml(row.whyItMattersToArticleThesis)}</p>
  </article>`).join("")}
</section>

<section class="panel warning">
  <h2>What this report does—and does not—prove</h2>
  <p>The output passed the governed structural schema and contains 12 unique assertions. It has not been judged by a sealed semantic evaluator. Source labels found verbatim in the article: <strong>${exactSourceLabels}/${propositions.length}</strong>. Descriptive source labels are therefore not exact citations; exact grounding was intentionally a separate S2 experiment.</p>
</section>

<section class="panel">
  <h2>Governed prompt</h2>
  <pre>${escapeHtml(input.promptText)}</pre>
</section>

<section class="panel">
  <h2>Structural inventory</h2>
  <table>
    <thead><tr><th>ID</th><th>Assertion words</th><th>Source-label words</th><th>Why-it-matters words</th><th>Source label exact?</th></tr></thead>
    <tbody>${propositions.map((row) => `<tr>
      <td>${escapeHtml(row.propositionId)}</td>
      <td>${wordCount(row.assertion)}</td>
      <td>${wordCount(row.assertionSource)}</td>
      <td>${wordCount(row.whyItMattersToArticleThesis)}</td>
      <td>${input.articleText.includes(row.assertionSource) ? "yes" : "no"}</td>
    </tr>`).join("")}</tbody>
  </table>
</section>

<section class="panel">
  <h2>Integrity and accounting</h2>
  <table><tbody>
    <tr><th>Generated at</th><td>${escapeHtml(input.generatedAt)}</td></tr>
    <tr><th>Fixture file SHA-256</th><td><code>${escapeHtml(input.fixtureFileSha256)}</code></td></tr>
    <tr><th>Article text SHA-256</th><td><code>${escapeHtml(input.articleTextSha256)}</code></td></tr>
    <tr><th>Source-unit manifest SHA-256</th><td><code>${escapeHtml(input.sourceUnitManifestHash)}</code></td></tr>
    <tr><th>Prompt</th><td>${escapeHtml(input.promptId)} · <code>${escapeHtml(input.promptHash)}</code></td></tr>
    <tr><th>Schema SHA-256</th><td><code>${escapeHtml(input.schemaHash)}</code></td></tr>
    <tr><th>Request SHA-256</th><td><code>${escapeHtml(input.requestHash)}</code></td></tr>
    <tr><th>Tokens</th><td>${input.usage.inputTokens.toLocaleString()} input; ${input.usage.cachedInputTokens.toLocaleString()} cached; ${input.usage.outputTokens.toLocaleString()} output; ${input.usage.totalTokens.toLocaleString()} total</td></tr>
  </tbody></table>
</section>
</main></body></html>
`;
}
