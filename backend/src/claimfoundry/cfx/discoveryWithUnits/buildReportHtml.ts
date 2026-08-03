import { escapeHtml } from "../grounding/report/escapeHtml.js";
import type {
  CfxFrozenArticle,
} from "../types/index.js";
import type {
  CfxUnitAwareInventory,
} from "./types.js";

export function buildCfxUnitAwareReportHtml(input: {
  runId: string;
  generatedAt: string;
  article: CfxFrozenArticle;
  inventory: CfxUnitAwareInventory;
  model: string;
  promptHash: string;
  schemaHash: string;
  requestHash: string;
  canonicalInventoryHash: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}): string {
  const units = new Map(
    input.article.sourceUnits.map((unit) => [unit.unitId, unit.text]),
  );
  const propositions = [...input.inventory.propositions].sort(
    (left, right) => left.propositionId.localeCompare(right.propositionId),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFX Unit-Aware Whole-Article Discovery</title>
<style>
body{max-width:1100px;margin:0 auto;padding:36px 24px 80px;background:#f5f7fa;color:#172033;font:16px/1.5 system-ui,sans-serif}header,.claim,.panel{background:#fff;border:1px solid #d5dbe4;border-radius:12px;padding:22px;margin:14px 0}header{background:#172f47;color:#fff}h1{margin:.2rem 0}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.meta div{background:#edf2f7;padding:10px;border-radius:8px}.id{font:700 .82rem ui-monospace,monospace;color:#176b5a}.why{background:#e8f3ef;padding:12px;border-radius:8px}.unit{border-left:4px solid #176b5a;padding:8px 12px;margin:10px 0;background:#f8fafb}.unit code{font-weight:700}pre{white-space:pre-wrap}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d5dbe4;padding:8px;text-align:left}code{overflow-wrap:anywhere}
</style></head><body>
<header><p>CFX · unit-aware discovery experiment</p><h1>One-call meaning discovery with S0 source-unit IDs</h1><p>The complete article remained visible, but was serialized as 398 labelled source units. The model selected 12 burden-bearing propositions and returned associated unit IDs in the same response.</p></header>
<section class="panel"><h2>Run identity</h2><div class="meta">
<div><strong>Run</strong><br><code>${escapeHtml(input.runId)}</code></div>
<div><strong>Model</strong><br>${escapeHtml(input.model)}</div>
<div><strong>Propositions</strong><br>${propositions.length}</div>
<div><strong>S0 units</strong><br>${input.article.sourceUnitCount}</div>
<div><strong>Input tokens</strong><br>${input.usage.inputTokens.toLocaleString()}</div>
<div><strong>Output tokens</strong><br>${input.usage.outputTokens.toLocaleString()}</div>
<div><strong>Latency</strong><br>${(input.latencyMs / 1000).toFixed(2)}s</div>
</div></section>
<section><h2>Propositions and associated source units</h2>
${propositions.map((proposition) => `<article class="claim">
<div class="id">${escapeHtml(proposition.propositionId)}</div>
<h3>${escapeHtml(proposition.assertion)}</h3>
<p><strong>Assertion source:</strong> ${escapeHtml(proposition.assertionSource)}</p>
<p class="why"><strong>Why it matters:</strong> ${escapeHtml(proposition.whyItMattersToArticleThesis)}</p>
<p><strong>Returned unit IDs:</strong> ${escapeHtml(proposition.groundingUnitIds.join(", "))}</p>
${proposition.groundingUnitIds.map((unitId) => `<div class="unit"><code>${escapeHtml(unitId)}</code><pre>${escapeHtml(units.get(unitId) ?? "[unknown unit]")}</pre></div>`).join("")}
</article>`).join("")}</section>
<section class="panel"><h2>Interpretation boundary</h2><p>Unit IDs were selected by the same model call that discovered the propositions. The host verified only that every returned ID exists and is not duplicated within a proposition. This report does not claim that an associated unit semantically supports the proposition or that it is the smallest sufficient passage.</p></section>
<section class="panel"><h2>Integrity</h2><table><tbody>
<tr><th>Generated at</th><td>${escapeHtml(input.generatedAt)}</td></tr>
<tr><th>Article SHA-256</th><td><code>${escapeHtml(input.article.articleTextSha256)}</code></td></tr>
<tr><th>Unit projection SHA-256</th><td><code>${escapeHtml(input.article.unitProjectionSha256)}</code></td></tr>
<tr><th>Prompt SHA-256</th><td><code>${escapeHtml(input.promptHash)}</code></td></tr>
<tr><th>Schema SHA-256</th><td><code>${escapeHtml(input.schemaHash)}</code></td></tr>
<tr><th>Request SHA-256</th><td><code>${escapeHtml(input.requestHash)}</code></td></tr>
<tr><th>Inventory SHA-256</th><td><code>${escapeHtml(input.canonicalInventoryHash)}</code></td></tr>
<tr><th>Cached / total tokens</th><td>${input.usage.cachedInputTokens.toLocaleString()} / ${input.usage.totalTokens.toLocaleString()}</td></tr>
</tbody></table></section>
</body></html>
`;
}
