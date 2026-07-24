import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const csvCell = (value) => {
  const string = Array.isArray(value)
    ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : item).join(" | ")
    : value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
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

function callBSourceLabel(assertion) {
  if (!assertion.callBSourceName) return "Unknown";
  return `${assertion.callBSourceName} (${assertion.callBSourceKind})`;
}

function evidenceAnchorLabel(assertion) {
  if (!assertion.evidenceAnchors?.length) return "None";
  return assertion.evidenceAnchors
    .map((anchor) => `${anchor.name} (${anchor.kind})`).join("; ");
}

function effectLabel(value) {
  if (value === "strengthens") return "If true: strengthens article";
  if (value === "weakens") return "If true: weakens article";
  return "If true: no material effect";
}

export function renderCf2Html(result) {
  const candidateRejections = result.candidateRejections ?? [];
  const rows = result.assertions.map((assertion) => {
    const className = assertion.effectIfTrue === "weakens" ? "weakens"
      : assertion.effectIfTrue === "strengthens" ? "strengthens" : "neutral";
    const context = result.candidates.find((candidate) =>
      candidate.candidateId === assertion.candidateId)?.contextUnits ?? [];
    const attributionPacket = result.attributionPackets.find((packet) =>
      packet.candidateId === assertion.candidateId);
    return `<tr class="${className}">
      <td>${escapeHtml(assertion.candidateId)}</td>
      <td><strong>${escapeHtml(assertion.assertionText)}</strong></td>
      <td>${escapeHtml(callBSourceLabel(assertion))}</td>
      <td>${escapeHtml(sourceLabel(assertion))}</td>
      <td>${escapeHtml(evidenceAnchorLabel(assertion))}</td>
      <td>${escapeHtml(assertion.articleTreatment)}</td>
      <td>${escapeHtml(effectLabel(assertion.effectIfTrue))}</td>
      <td>${escapeHtml(assertion.scoreTransform)}</td>
      <td>${escapeHtml(assertion.selectionBasis ?? "thesis_effect")}</td>
    </tr>
    <tr><td></td><td colspan="9"><details>
      <summary>Raw candidate, grounding, and local context</summary>
      <p><strong>Call A:</strong> ${escapeHtml(assertion.rawAssertion)}</p>
      <p><strong>Surface assertion:</strong> ${escapeHtml(assertion.surfaceAssertion ?? assertion.rawAssertion)}</p>
      <p><strong>Attribution layers:</strong> ${escapeHtml(JSON.stringify(assertion.attributionLayers ?? []))}</p>
      <p><strong>Layer-target audit:</strong> ${escapeHtml(JSON.stringify(assertion.layerTargetAudit ?? null))}</p>
      <p><strong>Assertion grounding:</strong> ${escapeHtml(assertion.groundingUnitIds.join(", "))}</p>
      <p><strong>Grounding audit:</strong> ${escapeHtml(JSON.stringify(assertion.groundingAudit ?? null))}</p>
      <p><strong>Source grounding:</strong> ${escapeHtml(assertion.sourceUnitIds.join(", ") || "None")}</p>
      <p><strong>Source-name origin:</strong> ${escapeHtml(assertion.sourceNameOrigin || "None")}</p>
      <p><strong>Attribution basis:</strong> ${escapeHtml(assertion.attributionBasis || "None")}</p>
      <p><strong>Evidence anchors:</strong> ${escapeHtml(JSON.stringify(assertion.evidenceAnchors ?? []))}</p>
      <p><strong>Evidence-anchor audit:</strong> ${escapeHtml(JSON.stringify(assertion.evidenceAnchorAudit ?? null))}</p>
      <pre>${escapeHtml(context.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n"))}</pre>
      <details><summary>Call C expanded attribution packet</summary>
        <p><strong>Host-found candidates:</strong></p>
        <pre>${escapeHtml(JSON.stringify(attributionPacket?.sourceCandidates ?? [], null, 2))}</pre>
        <p><strong>Expanded occurrence context:</strong></p>
        <pre>${escapeHtml((attributionPacket?.contextUnits ?? [])
          .map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n"))}</pre>
      </details>
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
  const callRows = [
    ["Call A", result.calls.callA, result.article.sourceUnitCount, result.candidates.length],
    ["Call B", result.calls.callB, result.candidates.length, result.candidateJudgments.length],
    ["Call C", result.calls.callC, result.assertions.length, result.recoveredAttributions.length],
  ].map(([label, value, inputs, outputs]) => {
    const usage = value.usage ?? {};
    return `<tr><td>${label}</td><td>${escapeHtml(value.returnedModel)}</td>
      <td>${inputs}</td><td>${outputs}</td><td>${(value.elapsedMs / 1000).toFixed(1)}s</td>
      <td>${escapeHtml(usage.inputTokens ?? usage.input_tokens ?? "unknown")}</td>
      <td>${escapeHtml(usage.outputTokens ?? usage.output_tokens ?? "unknown")}</td>
      <td>${escapeHtml(usage.cachedInputTokens ?? usage.cached_input_tokens ?? 0)}</td>
      <td>${escapeHtml(usage.totalTokens ?? usage.total_tokens ?? "unknown")}</td></tr>`;
  }).join("\n");
  const totalTokens = Object.values(result.calls).reduce((sum, value) =>
    sum + (value.usage?.totalTokens ?? value.usage?.total_tokens ?? 0), 0);
  const rejectionRows = candidateRejections.map((rejection) => `<tr>
    <td>${escapeHtml(rejection.candidateId ?? "Unknown")}</td>
    <td>${escapeHtml(rejection.code)}</td>
    <td>${escapeHtml(rejection.message)}</td>
    <td>${escapeHtml(rejection.rawAssertion ?? "")}</td>
  </tr>`).join("\n");
  const rejectionSection = candidateRejections.length > 0
    ? `<h2>Quarantined Call B candidate judgments</h2>
      <p>These candidate-level failures were excluded before portfolio selection.
      They did not invalidate otherwise usable judgments from the same batch.</p>
      <table><thead><tr><th>ID</th><th>Code</th><th>Reason</th><th>Call A assertion</th>
      </tr></thead><tbody>${rejectionRows}</tbody></table>`
    : "";
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
  ${candidateRejections.length ? `(${candidateRejections.length} quarantined)` : ""}
  → ${result.assertions.length} host-selected assertions
  → ${result.recoveredAttributions.length} Call C attributions<br>
  ${Object.keys(result.calls).length} calls · ${(result.elapsedMs / 1000).toFixed(1)}s
  · ${totalTokens.toLocaleString()} total tokens</div>
  <h2>Call measurements</h2>
  <table><thead><tr><th>Call</th><th>Model</th><th>Input work items</th>
  <th>Output work items</th><th>Time</th><th>Input tokens</th><th>Output tokens</th>
  <th>Cached input tokens</th><th>Total tokens</th></tr></thead>
  <tbody>${callRows}</tbody></table>
  ${rejectionSection}
  <h2>Final assertions</h2>
  <table><thead><tr><th>ID</th><th>Assertion</th><th>Call B source</th>
  <th>Recovered supplier</th><th>Evidence anchors</th><th>Article treatment</th>
  <th>Thesis effect</th><th>Host transform</th><th>Selection basis</th></tr></thead>
  <tbody>${rows}</tbody></table>
  ${call("Call A · discovery", result.calls.callA)}
  ${call("Call B · finalization", result.calls.callB)}
  ${call("Call C · attribution recovery", result.calls.callC)}
  </body></html>`;
}

export function writeCf2Artifacts(result, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  const columns = [
    "candidateId", "surfaceAssertion", "assertionText", "attributionLayers",
    "layerTargetAudit", "callBSourceName", "callBSourceKind",
    "sourceName", "sourceKind", "sourceNameOrigin", "attributionBasis", "evidenceAnchors",
    "evidenceAnchorAudit",
    "articleTreatment", "effectIfTrue", "scoreTransform", "selectionBasis",
    "groundingUnitIds",
    "groundingAudit", "sourceUnitIds", "rawAssertion",
  ];
  const csv = [
    columns.join(","),
    ...result.assertions.map((assertion) =>
      columns.map((column) => csvCell(assertion[column])).join(",")),
  ].join("\n");
  writeFileSync(path.join(outDir, "claims.csv"), `${csv}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderCf2Html(result));
}
