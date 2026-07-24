import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const csvCell = (value) => {
  const string = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${string.replaceAll('"', '""')}"`;
};

function sourceLabel(assertion) {
  if (assertion.sourceName) {
    const kind = assertion.sourceKind === "unknown"
      ? "unclassified source kind"
      : assertion.sourceKind;
    return `${assertion.sourceName} (${kind})`;
  }
  return "Unknown";
}

function effectLabel(value) {
  if (value === "strengthens") return "If true: strengthens article";
  if (value === "weakens") return "If true: weakens article";
  return "If true: no material effect";
}

export function renderCf2Html(result) {
  const rows = result.assertions.map((assertion) => {
    const className = assertion.effectIfTrue === "weakens" ? "weakens"
      : assertion.effectIfTrue === "strengthens" ? "strengthens" : "neutral";
    const context = result.candidates.find((candidate) =>
      candidate.candidateId === assertion.candidateId)?.contextUnits ?? [];
    return `<tr class="${className}">
      <td>${escapeHtml(assertion.candidateId)}</td>
      <td><strong>${escapeHtml(assertion.assertionText)}</strong></td>
      <td>${escapeHtml(sourceLabel(assertion))}</td>
      <td>${escapeHtml(assertion.articleTreatment)}</td>
      <td>${escapeHtml(effectLabel(assertion.effectIfTrue))}</td>
      <td>${escapeHtml(assertion.scoreTransform)}</td>
    </tr>
    <tr><td></td><td colspan="5"><details>
      <summary>Raw candidate, grounding, and local context</summary>
      <p><strong>Call A:</strong> ${escapeHtml(assertion.rawAssertion)}</p>
      <p><strong>Assertion grounding:</strong> ${escapeHtml(assertion.groundingUnitIds.join(", "))}</p>
      <p><strong>Source grounding:</strong> ${escapeHtml(assertion.sourceUnitIds.join(", ") || "None")}</p>
      <p><strong>Source-name origin:</strong> ${escapeHtml(assertion.sourceNameOrigin || "None")}</p>
      <pre>${escapeHtml(context.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n"))}</pre>
    </details></td></tr>`;
  }).join("\n");
  const call = (name, value) => `<section><h2>${name}</h2>
    <p>${escapeHtml(value.requestedModel)} → ${escapeHtml(value.returnedModel)}
    · ${(value.elapsedMs / 1000).toFixed(1)}s
    · ${escapeHtml(value.usage?.totalTokens ?? value.usage?.total_tokens ?? "unknown")} tokens</p>
    <details><summary>Exact prompt, schema, output, and provenance</summary>
      <h3>System</h3><pre>${escapeHtml(value.prompt.system)}</pre>
      <h3>User</h3><pre>${escapeHtml(value.prompt.user)}</pre>
      <h3>Schema</h3><pre>${escapeHtml(JSON.stringify(value.prompt.responseSchema, null, 2))}</pre>
      <h3>Raw output</h3><pre>${escapeHtml(JSON.stringify(value.rawOutput, null, 2))}</pre>
      <h3>Provenance</h3><pre>${escapeHtml(JSON.stringify({
        requestedModel: value.requestedModel,
        returnedModel: value.returnedModel,
        attempts: value.attempts,
        usage: value.usage,
        responseId: value.responseId,
        systemFingerprint: value.systemFingerprint,
        promptSha256: value.promptSha256,
        schemaSha256: value.schemaSha256,
      }, null, 2))}</pre>
    </details></section>`;
  return `<!doctype html><html><head><meta charset="utf-8">
  <title>CF2 minimal fact-check docket</title>
  <style>
  body{font:14px system-ui;margin:24px;color:#17202a;max-width:1500px}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3d8;padding:8px;vertical-align:top;text-align:left}
  th{background:#edf1f4}.weakens td{background:#fff1e8}.strengthens td{background:#eef8ef}.neutral td{background:#f6f6f6}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f7;padding:12px;max-height:650px;overflow:auto}
  summary{cursor:pointer;font-weight:650}.meta{background:#eef5ff;border:1px solid #9ebce0;padding:12px}
  </style></head><body>
  <h1>CF2 · Minimal fact-check docket</h1>
  <div class="meta"><strong>${escapeHtml(result.article.title)}</strong><br>
  Thesis: ${escapeHtml(result.thesisAssertion)}<br>
  ${result.candidates.length} Call A candidates → ${result.candidateJudgments.length} Call B judgments
  → ${result.assertions.length} host-selected assertions
  · ${(result.elapsedMs / 1000).toFixed(1)}s</div>
  <h2>Final assertions</h2>
  <table><thead><tr><th>ID</th><th>Assertion</th><th>Assertion source</th>
  <th>Article treatment</th><th>Thesis effect</th><th>Host transform</th></tr></thead>
  <tbody>${rows}</tbody></table>
  ${call("Call A · discovery", result.calls.callA)}
  ${call("Call B · finalization", result.calls.callB)}
  </body></html>`;
}

export function writeCf2Artifacts(result, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  const columns = [
    "candidateId", "assertionText", "sourceName", "sourceKind", "sourceNameOrigin", "articleTreatment",
    "effectIfTrue", "scoreTransform", "groundingUnitIds", "sourceUnitIds", "rawAssertion",
  ];
  const csv = [
    columns.join(","),
    ...result.assertions.map((assertion) =>
      columns.map((column) => csvCell(assertion[column])).join(",")),
  ].join("\n");
  writeFileSync(path.join(outDir, "claims.csv"), `${csv}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderCf2Html(result));
}
