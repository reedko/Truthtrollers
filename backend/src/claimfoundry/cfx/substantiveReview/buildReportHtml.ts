import { escapeHtml } from "../grounding/report/escapeHtml.js";
import type {
  CfxUnitAwareInventory,
} from "../discoveryWithUnits/types.js";
import type {
  CfxSubstantiveReviewInventory,
} from "./types.js";

export function buildCfxSubstantiveReviewReportHtml(input: {
  runId: string;
  generatedAt: string;
  model: string;
  sourceInventory: CfxUnitAwareInventory;
  reviewInventory: CfxSubstantiveReviewInventory;
  promptHash: string;
  schemaHash: string;
  requestHash: string;
  sourceInventoryHash: string;
  resultInventoryHash: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}): string {
  const source = new Map(
    input.sourceInventory.propositions.map((item) => [
      item.propositionId,
      item,
    ]),
  );
  const stanceCounts = {
    adopts: 0,
    challenges: 0,
    reports: 0,
  };
  for (const row of input.reviewInventory.results) {
    stanceCounts[row.articleStance] += 1;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFX S2 Substantive Review</title>
<style>
body{max-width:1120px;margin:0 auto;padding:38px 24px 80px;background:#f4f6f9;color:#172033;font:16px/1.5 system-ui,sans-serif}header,.panel,.row{background:#fff;border:1px solid #d5dbe4;border-radius:12px;padding:22px;margin:14px 0}header{background:#2e294e;color:#fff}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.card{padding:14px;background:#edeaf8;border-radius:8px}.card strong{font-size:1.5rem;display:block}.id{font:700 .82rem ui-monospace,monospace;color:#6656a5}.before,.after{padding:12px;border-radius:8px}.before{background:#f0f2f5}.after{background:#e9f3ef;border-left:4px solid #26705d}.stance{display:inline-block;padding:4px 9px;border-radius:999px;background:#edeaf8;font-weight:700}.changed{color:#8a4c13}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d5dbe4;padding:8px;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}
</style></head><body>
<header><p>CFX · S2 substantive review</p><h1>Fixed propositions → evidence-ready assertions, suppliers, and article stance</h1><p>This one-call review received the 12 frozen unit-aware propositions and the complete 398-unit article. It could not add, delete, merge, or split proposition IDs.</p></header>
<section class="panel"><div class="cards">
<div class="card"><strong>12</strong>fixed proposition IDs</div>
<div class="card"><strong>${stanceCounts.adopts}</strong>adopts</div>
<div class="card"><strong>${stanceCounts.challenges}</strong>challenges</div>
<div class="card"><strong>${stanceCounts.reports}</strong>reports</div>
<div class="card"><strong>${input.usage.inputTokens.toLocaleString()}</strong>input tokens</div>
<div class="card"><strong>${(input.latencyMs / 1000).toFixed(2)}s</strong>latency</div>
</div></section>
<section><h2>Review results</h2>
${input.reviewInventory.results.map((result) => {
  const original = source.get(result.propositionId)!;
  const assertionChanged =
    original.assertion !== result.substantiveAssertion;
  const sourceChanged =
    original.assertionSource !== result.assertionSource;
  const handoff = result.evidenceSearchHandoff;
  const identifiers = handoff?.literalIdentifiers ?? {
    people: [],
    organizations: [],
    laws: [],
    studyTitles: [],
    journals: [],
    years: [],
    dateRanges: [],
    doi: [],
    pmid: [],
    urls: [],
    citationNumbers: [],
    acronyms: [],
  };
  const hints = handoff?.lookupHints ?? {
    populations: [],
    exposures: [],
    outcomes: [],
    interventions: [],
    geography: [],
    documentTypes: [],
    topics: [],
  };
  return `<article class="row">
  <div class="id">${escapeHtml(result.propositionId)}</div>
  <p><span class="stance">${escapeHtml(result.articleStance)}</span></p>
  <h3>Selected assertion</h3><p class="before">${escapeHtml(original.assertion)}</p>
  <h3>Substantive assertion ${assertionChanged ? '<span class="changed">(text changed)</span>' : "(unchanged)"}</h3>
  <p class="after">${escapeHtml(result.substantiveAssertion)}</p>
  <table><tbody>
    <tr><th>Previous source</th><td>${escapeHtml(original.assertionSource)}</td></tr>
    <tr><th>Reviewed source ${sourceChanged ? '<span class="changed">(changed)</span>' : ""}</th><td>${escapeHtml(result.assertionSource)}</td></tr>
    <tr><th>Associated source units</th><td>${escapeHtml(original.groundingUnitIds.join(", "))}</td></tr>
    <tr><th>Why it mattered</th><td>${escapeHtml(original.whyItMattersToArticleThesis)}</td></tr>
  </tbody></table>
  ${handoff ? `<h3>Deterministic evidence-search handoff</h3>
  <table><tbody>
    <tr><th>Explicit study identity</th><td>${handoff.explicitStudyIdentityFound ? "Found in permitted literal context" : "Not found (lookup hints and queries remain available)"}</td></tr>
    <tr><th>People</th><td>${escapeHtml(identifiers.people.join("\n") || "None")}</td></tr>
    <tr><th>Organizations</th><td>${escapeHtml(identifiers.organizations.join("\n") || "None")}</td></tr>
    <tr><th>Laws</th><td>${escapeHtml(identifiers.laws.join("\n") || "None")}</td></tr>
    <tr><th>Study titles / journals</th><td>${escapeHtml([
      ...identifiers.studyTitles,
      ...identifiers.journals,
    ].join("\n") || "None")}</td></tr>
    <tr><th>Years / date ranges</th><td>${escapeHtml([
      ...identifiers.years,
      ...identifiers.dateRanges,
    ].join("\n") || "None")}</td></tr>
    <tr><th>Acronyms</th><td>${escapeHtml(identifiers.acronyms.join("\n") || "None")}</td></tr>
    <tr><th>DOI / PMID / URL / citations</th><td>${escapeHtml([
      ...identifiers.doi.map((value) => `DOI ${value}`),
      ...identifiers.pmid.map((value) => `PMID ${value}`),
      ...identifiers.urls,
      ...identifiers.citationNumbers.map((value) => `Citation ${value}`),
    ].join("\n") || "None in the permitted literal context.")}</td></tr>
    <tr><th>Populations</th><td>${escapeHtml(hints.populations.join("\n") || "None")}</td></tr>
    <tr><th>Exposures</th><td>${escapeHtml(hints.exposures.join("\n") || "None")}</td></tr>
    <tr><th>Interventions</th><td>${escapeHtml(hints.interventions.join("\n") || "None")}</td></tr>
    <tr><th>Outcomes</th><td>${escapeHtml(hints.outcomes.join("\n") || "None")}</td></tr>
    <tr><th>Geography</th><td>${escapeHtml(hints.geography.join("\n") || "None")}</td></tr>
    <tr><th>Document types</th><td>${escapeHtml(hints.documentTypes.join("\n") || "None")}</td></tr>
    <tr><th>Topics</th><td>${escapeHtml(hints.topics.join("\n") || "None")}</td></tr>
    <tr><th>Literal query</th><td>${escapeHtml(handoff.queries.literal.join("\n") || "None")}</td></tr>
    <tr><th>Source-qualified query</th><td>${escapeHtml(handoff.queries.sourceQualified.join("\n") || "None")}</td></tr>
    <tr><th>Study lookup queries</th><td>${escapeHtml(handoff.queries.studyLookup.join("\n") || "Insufficient literal lookup clues.")}</td></tr>
    <tr><th>Grounding text</th><td>${escapeHtml(handoff.groundingText)}</td></tr>
  </tbody></table>` : ""}
</article>`;
}).join("")}</section>
<section class="panel"><h2>Interpretation boundary</h2><p>The host validated only the closed schema and exact coverage of the 12 frozen proposition IDs. Whether a substantive assertion preserved meaning, whether its supplier is correct, and whether the stance classification is semantically sound remain human-review judgments.</p></section>
<section class="panel"><h2>Integrity</h2><table><tbody>
<tr><th>Run ID</th><td><code>${escapeHtml(input.runId)}</code></td></tr>
<tr><th>Generated at</th><td>${escapeHtml(input.generatedAt)}</td></tr>
<tr><th>Model</th><td>${escapeHtml(input.model)}</td></tr>
<tr><th>Source inventory hash</th><td><code>${escapeHtml(input.sourceInventoryHash)}</code></td></tr>
<tr><th>Result inventory hash</th><td><code>${escapeHtml(input.resultInventoryHash)}</code></td></tr>
<tr><th>Prompt hash</th><td><code>${escapeHtml(input.promptHash)}</code></td></tr>
<tr><th>Schema hash</th><td><code>${escapeHtml(input.schemaHash)}</code></td></tr>
<tr><th>Request hash</th><td><code>${escapeHtml(input.requestHash)}</code></td></tr>
<tr><th>Tokens</th><td>${input.usage.inputTokens.toLocaleString()} input; ${input.usage.cachedInputTokens.toLocaleString()} cached; ${input.usage.outputTokens.toLocaleString()} output; ${input.usage.totalTokens.toLocaleString()} total</td></tr>
</tbody></table></section>
</body></html>
`;
}
