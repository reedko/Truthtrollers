import {
  escapeHtml,
} from "../grounding/report/escapeHtml.js";
import type {
  CfxCandidateDedupeAudit,
  CfxEvidenceCandidate,
  CfxEvidenceInput,
  CfxQueryPlan,
  CfxRetrievalOutcome,
} from "./types.js";

function lines(values: string[]): string {
  return escapeHtml(values.join("\n") || "None");
}

export function buildCfxInitialRetrievalReportHtml(input: {
  runId: string;
  generatedAt: string;
  evidenceInputs: CfxEvidenceInput[];
  queryPlan: CfxQueryPlan;
  outcomes: CfxRetrievalOutcome[];
  dedupedCandidates: CfxEvidenceCandidate[];
  dedupeAudit: CfxCandidateDedupeAudit[];
  accounting: {
    modelRequestCount: number;
    retrievalRequestCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    modelLatencyMs: number;
    retrievalLatencyMs: number;
    estimatedCostUsd: number | null;
  };
}): string {
  const inputById = new Map(
    input.evidenceInputs.map((row) => [row.propositionId, row]),
  );
  const outcomesByProposition = new Map<string, CfxRetrievalOutcome[]>();
  for (const outcome of input.outcomes) {
    const rows = outcomesByProposition.get(outcome.request.propositionId) ?? [];
    rows.push(outcome);
    outcomesByProposition.set(outcome.request.propositionId, rows);
  }
  const dedupedByProposition = new Map<string, CfxEvidenceCandidate[]>();
  for (const candidate of input.dedupedCandidates) {
    const rows = dedupedByProposition.get(candidate.propositionId) ?? [];
    rows.push(candidate);
    dedupedByProposition.set(candidate.propositionId, rows);
  }
  const failures = input.outcomes.filter(
    (outcome) => outcome.status === "provider_error",
  ).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFX → EvidenceRun Initial Retrieval</title>
<style>
body{max-width:1280px;margin:auto;padding:34px 22px 80px;background:#f4f6f8;color:#182231;font:15px/1.5 system-ui,sans-serif}header,.panel,.proposition,.candidate{background:#fff;border:1px solid #d5dce5;border-radius:12px;padding:20px;margin:14px 0}header{background:#17324d;color:#fff}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.card{background:#eaf0f6;border-radius:8px;padding:13px}.card strong{display:block;font-size:1.5rem}.id{font:700 .82rem ui-monospace,monospace;color:#476d91}.query{background:#eff5fa;border-left:4px solid #3f739f;padding:10px;margin:8px 0}.missing{border-left-color:#ad6c2d;background:#fff4e7}.failed{border-left-color:#a33;background:#fff0f0}.grounding{white-space:pre-wrap;background:#f6f7f8;padding:12px;border-radius:8px}.candidate{background:#fbfcfd}.metadata{display:grid;grid-template-columns:180px 1fr;gap:4px 12px}.review{display:flex;flex-wrap:wrap;gap:8px}.review span{border:1px solid #bbc5d0;border-radius:999px;padding:3px 8px}code{overflow-wrap:anywhere}pre{white-space:pre-wrap}details{margin:10px 0}a{color:#235f92}
</style></head><body>
<header><p>CFX → EvidenceRun</p><h1>Initial query and retrieval experiment</h1><p>Query quality and candidate retrieval only. No bearing, stance adjudication, source-quality score, or portfolio selection is present.</p></header>
<section class="panel"><div class="cards">
<div class="card"><strong>${input.evidenceInputs.length}</strong>propositions</div>
<div class="card"><strong>${input.outcomes.length}</strong>query executions</div>
<div class="card"><strong>${input.outcomes.reduce((sum, row) => sum + row.candidates.length, 0)}</strong>raw candidate slots</div>
<div class="card"><strong>${input.dedupedCandidates.length}</strong>deduplicated candidates</div>
<div class="card"><strong>${failures}</strong>provider failures</div>
<div class="card"><strong>${input.accounting.modelRequestCount}</strong>planning-model call</div>
</div></section>
${input.queryPlan.propositions.map((plan) => {
  const evidence = inputById.get(plan.propositionId)!;
  const outcomes = outcomesByProposition.get(plan.propositionId) ?? [];
  const candidates = dedupedByProposition.get(plan.propositionId) ?? [];
  return `<section class="proposition">
<div class="id">${escapeHtml(plan.propositionId)}</div>
<h2>${escapeHtml(evidence.substantiveAssertion)}</h2>
<p><strong>Assertion source:</strong> ${escapeHtml(evidence.assertionSource)} · <strong>Article stance:</strong> ${escapeHtml(evidence.articleStance)}</p>
<details><summary>Grounding and deterministic inputs</summary>
<p><strong>Units:</strong> ${escapeHtml(evidence.groundingUnitIds.join(", "))}</p>
<div class="grounding">${escapeHtml(evidence.groundingText)}</div>
<div class="metadata">
<strong>People</strong><span>${lines(evidence.literalIdentifiers.people)}</span>
<strong>Organizations</strong><span>${lines(evidence.literalIdentifiers.organizations)}</span>
<strong>Laws / works</strong><span>${lines([...evidence.literalIdentifiers.laws, ...evidence.literalIdentifiers.studyTitles])}</span>
<strong>Years / ranges</strong><span>${lines([...evidence.literalIdentifiers.years, ...evidence.literalIdentifiers.dateRanges])}</span>
<strong>Populations</strong><span>${lines(evidence.lookupHints.populations)}</span>
<strong>Exposure / intervention</strong><span>${lines([...evidence.lookupHints.exposures, ...evidence.lookupHints.interventions])}</span>
<strong>Outcomes</strong><span>${lines(evidence.lookupHints.outcomes)}</span>
<strong>Geography / document types</strong><span>${lines([...evidence.lookupHints.geography, ...evidence.lookupHints.documentTypes])}</span>
</div></details>
<h3>Five query lanes</h3>
${plan.queries.map((query) => `<div class="query ${query.query ? "" : "missing"}"><strong>${escapeHtml(query.queryId)} · ${escapeHtml(query.lane)}</strong> · ${escapeHtml(query.provider ?? "not executed")}<br>${escapeHtml(query.query ?? query.missingReason ?? "Missing")}${query.modelProposedQuery && query.modelProposedQuery !== query.query ? `<br><small>Preserved model proposal: ${escapeHtml(query.modelProposedQuery)}</small>` : ""}<br><small>${escapeHtml(query.rationale)}</small></div>`).join("")}
<h3>Returned candidates by query</h3>
${outcomes.map((outcome) => `<details ${outcome.status === "provider_error" ? 'class="failed"' : ""}><summary>${escapeHtml(outcome.request.queryId)} · ${escapeHtml(outcome.provider)} · ${outcome.candidates.length} candidates · ${outcome.latencyMs} ms</summary>${outcome.error ? `<p>${escapeHtml(outcome.error.message)}</p>` : outcome.candidates.map((candidate) => `<p><strong>${escapeHtml(candidate.title || "(untitled)")}</strong><br>${escapeHtml(candidate.publication ?? "")} ${escapeHtml(candidate.publicationDate ?? "")}<br>${escapeHtml(candidate.abstractOrSnippet ?? "")}</p>`).join("")}</details>`).join("") || "<p>No query executed.</p>"}
<h3>Deduplicated candidate list (${candidates.length})</h3>
${candidates.map((candidate) => `<article class="candidate">
<h4>${escapeHtml(candidate.title || "(untitled)")}</h4>
<div class="metadata">
<strong>Authors</strong><span>${lines(candidate.authors)}</span>
<strong>Publication / date</strong><span>${escapeHtml([candidate.publication, candidate.publicationDate].filter(Boolean).join(" · ") || "Unknown")}</span>
<strong>DOI / PMID</strong><span>${escapeHtml([candidate.doi && `DOI ${candidate.doi}`, candidate.pmid && `PMID ${candidate.pmid}`].filter(Boolean).join(" · ") || "None")}</span>
<strong>URL</strong><span>${candidate.url ? `<a href="${escapeHtml(candidate.url)}">${escapeHtml(candidate.url)}</a>` : "None"}</span>
<strong>Found by</strong><span>${escapeHtml(candidate.discoveryPaths.map((path) => `${path.queryId}/${path.queryIntent}/${path.provider} rank ${path.retrievalRank}`).join("\n"))}</span>
<strong>Snippet / abstract</strong><span>${escapeHtml(candidate.abstractOrSnippet ?? "None")}</span>
</div>
<p class="review"><strong>Manual review:</strong><span>bears directly</span><span>possibly bears</span><span>topic only</span><span>irrelevant</span><span>duplicate</span><span>inaccessible</span><span>not reviewed</span></p>
</article>`).join("") || "<p>No deduplicated candidates.</p>"}
</section>`;
}).join("")}
<section class="panel"><h2>Duplicate merges</h2><pre>${escapeHtml(JSON.stringify(input.dedupeAudit.filter((row) => row.mergedCandidateIds.length > 1), null, 2))}</pre></section>
<section class="panel"><h2>Accounting and integrity</h2><div class="metadata">
<strong>Run ID</strong><code>${escapeHtml(input.runId)}</code>
<strong>Generated</strong><span>${escapeHtml(input.generatedAt)}</span>
<strong>Planning tokens</strong><span>${input.accounting.inputTokens} input; ${input.accounting.cachedInputTokens} cached; ${input.accounting.outputTokens} output</span>
<strong>Latency</strong><span>${input.accounting.modelLatencyMs} ms planning; ${input.accounting.retrievalLatencyMs} ms summed retrieval</span>
<strong>Estimated cost</strong><span>${input.accounting.estimatedCostUsd ?? "Not calculated"}</span>
</div></section>
</body></html>`;
}
