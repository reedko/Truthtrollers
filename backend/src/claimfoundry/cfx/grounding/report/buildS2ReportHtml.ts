import type {
  CfxCanonicalProposition,
  CfxGroundingArmMetrics,
  CfxGroundingStatus,
  CfxS2ArmResult,
  CfxValidatedGrounding,
} from "../../types/index.js";
import { escapeHtml } from "./escapeHtml.js";
import type { CfxS2ReportInput } from "./reportTypes.js";

function rowFor(
  arm: CfxS2ArmResult,
  propositionId: string,
): CfxValidatedGrounding | null {
  return arm.acceptedRows.find(
    (row) => row.propositionId === propositionId,
  ) ?? null;
}

function rejectedReason(
  arm: CfxS2ArmResult,
  propositionId: string,
): string {
  return arm.rejectedRows
    .filter((row) => row.propositionId === propositionId)
    .flatMap((row) => row.diagnostics)
    .map((item) => `${item.code}: ${item.message}`)
    .join("; ");
}

function segments(row: CfxValidatedGrounding | null): string {
  if (!row || row.evidenceSegments.length === 0) {
    return '<p class="muted">No quotation.</p>';
  }
  return row.evidenceSegments.map((segment, index) => {
    const snapshot = row.sourceSnapshots[index];
    return `<section class="segment">
      <h5>Segment ${index + 1}</h5>
      <p><strong>Units:</strong> ${escapeHtml(segment.sourceUnitIds.join(", "))}</p>
      <blockquote>${escapeHtml(segment.verbatimEvidence)}</blockquote>
      <details><summary>Cited-unit text snapshot</summary><pre>${escapeHtml(snapshot?.citedUnitText ?? "")}</pre></details>
      <p><strong>Exact substring:</strong> ${snapshot?.exactSubstring ? "PASS" : "FAIL"}</p>
    </section>`;
  }).join("");
}

function propositionSection(input: {
  proposition: CfxCanonicalProposition;
  armName: string;
  arm: CfxS2ArmResult;
}): string {
  const row = rowFor(input.arm, input.proposition.propositionId);
  const failure = rejectedReason(input.arm, input.proposition.propositionId);
  return `<article class="proposition">
    <h3>${escapeHtml(input.proposition.propositionId)} — ${escapeHtml(input.armName)}</h3>
    <p><strong>Canonical assertion:</strong> ${escapeHtml(input.proposition.assertion)}</p>
    <p><strong>Assertion source:</strong> ${escapeHtml(input.proposition.assertionSource)}</p>
    <p><strong>Why it matters:</strong> ${escapeHtml(input.proposition.whyItMattersToArticleThesis)}</p>
    <dl>
      <dt>Status</dt><dd>${escapeHtml(row?.groundingStatus ?? "rejected")}</dd>
      <dt>Type</dt><dd>${escapeHtml(row?.groundingType ?? "n/a")}</dd>
      <dt>Validation</dt><dd>${row ? "PASS" : "FAIL"}</dd>
      <dt>Cited units</dt><dd>${escapeHtml(row?.citedUnitCount ?? 0)}</dd>
      <dt>Quoted words</dt><dd>${escapeHtml(row?.quotedWordCount ?? 0)}</dd>
      <dt>Quoted characters</dt><dd>${escapeHtml(row?.quotedCharacterCount ?? 0)}</dd>
      <dt>Evidence segments</dt><dd>${escapeHtml(row?.evidenceSegmentCount ?? 0)}</dd>
    </dl>
    ${segments(row)}
    <p><strong>Supported components:</strong> ${escapeHtml(row?.supportedComponents.join(" | ") ?? "")}</p>
    <p><strong>Unsupported components:</strong> ${escapeHtml(row?.unsupportedComponents.join(" | ") ?? "")}</p>
    <p><strong>Notes:</strong> ${escapeHtml(row?.notes ?? "")}</p>
    ${failure ? `<p class="failure"><strong>Quarantine reason:</strong> ${escapeHtml(failure)}</p>` : ""}
    <fieldset><legend>Human review worksheet</legend>
      <p>Does the evidence support that the article presents the proposition? □ yes □ no □ uncertain □ not reviewed</p>
      <p>Is attribution represented correctly? □ yes □ no □ uncertain □ not reviewed</p>
      <p>Is the passage no broader than necessary? □ yes □ no □ uncertain □ not reviewed</p>
    </fieldset>
  </article>`;
}

function statusCards(metrics: CfxGroundingArmMetrics): string {
  return Object.entries(metrics.statusCounts)
    .map(([status, count]) =>
      `<div class="card"><span>${escapeHtml(status)}</span><strong>${count}</strong></div>`)
    .join("");
}

function comparisonRows(input: CfxS2ReportInput): string {
  return input.comparison.perPropositionComparison.map((row) =>
    `<tr>
      <td>${escapeHtml(row.propositionId)}</td>
      <td>${escapeHtml(row.wholeArticleStatus)}</td>
      <td>${escapeHtml(row.perPropositionStatus)}</td>
      <td>${row.statusAgrees ? "yes" : "no"}</td>
      <td>${row.citedUnitSetsAgree ? "yes" : "no"}</td>
      <td>${row.exactQuotationsAgree ? "yes" : "no"}</td>
      <td>not reviewed</td>
    </tr>`).join("");
}

function quarantines(
  armName: string,
  arm: CfxS2ArmResult,
): string[] {
  const qualified = new Set<CfxGroundingStatus>([
    "partial",
    "ambiguous",
    "unsupported",
  ]);
  return [
    ...arm.acceptedRows
      .filter((row) => qualified.has(row.groundingStatus))
      .map((row) =>
        `<li>${escapeHtml(armName)} ${escapeHtml(row.propositionId)}: ${escapeHtml(row.groundingStatus)} — ${escapeHtml(row.notes ?? "mechanical quarantine")}</li>`),
    ...arm.rejectedRows.map((row) =>
      `<li>${escapeHtml(armName)} ${escapeHtml(row.propositionId ?? "unknown")}: ${escapeHtml(row.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; "))}</li>`),
  ];
}

export function buildCfxS2ReportHtml(input: CfxS2ReportInput): string {
  const propositions = [...input.canonicalInventory.propositions]
    .sort((left, right) => left.propositionId.localeCompare(right.propositionId));
  const whole = input.comparison.arms.wholeArticle;
  const per = input.comparison.arms.perProposition;
  const quarantineItems = [
    ...quarantines("Arm A", input.wholeArticle),
    ...quarantines("Arm B", input.perProposition),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CFX S2 Exact Grounding Report</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:24px;color:#18202a;background:#f7f8fa}h1,h2,h3{color:#10243e}code,pre{font-family:ui-monospace,monospace}pre{white-space:pre-wrap;background:#eef1f5;padding:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.card,.proposition{background:white;border:1px solid #ccd3dc;border-radius:8px;padding:14px;margin:12px 0}.card{display:flex;justify-content:space-between}.segment{border-left:4px solid #496a92;padding-left:12px;margin:10px 0}blockquote{white-space:pre-wrap;background:#f1f5f9;padding:12px;margin:8px 0}table{width:100%;border-collapse:collapse;background:white}th,td{border:1px solid #ccd3dc;padding:7px;vertical-align:top}dl{display:grid;grid-template-columns:180px 1fr}dt{font-weight:700}.failure{color:#8b1e1e}.muted{color:#667085}fieldset{margin-top:12px}
</style>
</head>
<body>
<h1>CFX S2 Exact Grounding Report</h1>
<section>
<h2>Run header</h2>
<dl>
<dt>Run ID</dt><dd>${escapeHtml(input.runId)}</dd>
<dt>Fixture</dt><dd>${escapeHtml(input.fixtureId)}</dd>
<dt>Generated at</dt><dd>${escapeHtml(input.generatedAt)}</dd>
<dt>Provider / model</dt><dd>${escapeHtml(input.provider)} / ${escapeHtml(input.model)}</dd>
<dt>Prompt</dt><dd>${escapeHtml(input.promptId)} / ${escapeHtml(input.promptHash)}</dd>
<dt>Schema hash</dt><dd>${escapeHtml(input.schemaHash)}</dd>
<dt>Article hash</dt><dd>${escapeHtml(input.article.articleTextSha256)}</dd>
<dt>Publication status</dt><dd>Arm A: ${escapeHtml(input.wholeArticle.status)}; Arm B: ${escapeHtml(input.perProposition.status)}</dd>
</dl>
</section>
<section><h2>Arm A summary — whole article</h2><div class="cards">${statusCards(whole)}</div>
<p>Requests ${whole.requestCount}; parser failures ${whole.parserFailureCount}; validation failures ${whole.validationFailureCount}; input/output/cached tokens ${whole.inputTokens}/${whole.outputTokens}/${whole.cachedTokens}; total request latency ${whole.latencyMs} ms.</p></section>
<section><h2>Arm B summary — per proposition</h2><div class="cards">${statusCards(per)}</div>
<p>Requests ${per.requestCount}; parser failures ${per.parserFailureCount}; validation failures ${per.validationFailureCount}; input/output/cached tokens ${per.inputTokens}/${per.outputTokens}/${per.cachedTokens}; total request latency ${per.latencyMs} ms.</p></section>
<section><h2>Arm comparison</h2>
<table><thead><tr><th>Proposition</th><th>Arm A status</th><th>Arm B status</th><th>Status agrees</th><th>Units agree</th><th>Quotations agree</th><th>Human review</th></tr></thead>
<tbody>${comparisonRows(input)}</tbody></table>
<p>No automatic semantic winner is declared.</p></section>
<section><h2>Proposition grounding</h2>
${propositions.map((proposition) => [
  propositionSection({ proposition, armName: "Arm A", arm: input.wholeArticle }),
  propositionSection({ proposition, armName: "Arm B", arm: input.perProposition }),
].join("")).join("")}
</section>
<section><h2>Quarantine</h2>${quarantineItems.length ? `<ul>${quarantineItems.join("")}</ul>` : "<p>None.</p>"}</section>
<section><h2>Raw accounting and artifact index</h2>
<ul>${input.artifactPaths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
<table><thead><tr><th>Artifact</th><th>SHA-256</th></tr></thead><tbody>${input.artifactHashes.map((item) => `<tr><td>${escapeHtml(item.path)}</td><td><code>${escapeHtml(item.sha256)}</code></td></tr>`).join("")}</tbody></table>
</section>
</body>
</html>
`;
}
