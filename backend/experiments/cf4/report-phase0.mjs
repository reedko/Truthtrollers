import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve(process.argv[2]);
const s1 = JSON.parse(readFileSync(path.join(outDir, "s1_parse.json"), "utf8"));
const s2 = JSON.parse(readFileSync(path.join(outDir, "s2_attribution.json"), "utf8"));
const input = JSON.parse(readFileSync(path.join(outDir, "input.json"), "utf8"));
const auditPath = path.join(outDir, "hand_audit.json");
const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, "utf8")) : null;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const expected = input.requiredReceipt;
const required = s2.rows.find((row) => row.itemId === expected.itemId);
const antecedent = s1.coreference.unambiguousReplacements[expected.resolvedMention];
const automatedGate = Boolean(required?.split?.source?.name?.includes(expected.sourceName)
  && required.split.source.kind === expected.sourceKind
  && expected.contentPatterns.every((pattern) =>
    new RegExp(pattern, "i").test(required.split.content))
  && antecedent === expected.expectedAntecedent);
const correct = audit?.decisions.filter((row) => row.correct).length ?? 0;
const rate = audit ? correct / audit.decisions.length : null;
const requiredAudit = audit?.decisions.find((row) => row.itemId === "U0037");
const handGate = Boolean(audit && rate >= audit.threshold && requiredAudit?.correct);
const decision = automatedGate && handGate ? "PROCEED_TO_PHASE_1" : (
  audit ? "STOP_PHASE_0_GATE_FAILED" : "PENDING_HAND_AUDIT");
const decisions = new Map(audit?.decisions.map((row) => [row.itemId, row]) ?? []);
const auditRows = s2.rows.map((row) => `<tr><td>${esc(row.group)}</td><td>${esc(row.itemId)}</td>
<td>${esc(row.inputText)}</td><td>${esc(row.split.pattern)}</td>
<td>${esc(row.split.source.name)} (${esc(row.split.source.kind)})</td>
<td>${esc(row.split.content)}</td><td>${decisions.has(row.itemId)
    ? `${decisions.get(row.itemId).correct ? "✓ correct" : "✗ incorrect"} — `
      + esc(decisions.get(row.itemId).note)
    : "□ correct&nbsp; □ incorrect"}</td></tr>`).join("");
const report = `<!doctype html><html><head><meta charset="utf-8"><title>CF4 Phase 0</title>
<style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}th{background:#eee}
.pass{color:#087830}.stop{color:#a00}</style></head><body><h1>CF4 Phase 0 — S1/S2 spike</h1>
<p>Automated prerequisite: <strong class="${automatedGate ? "pass" : "stop"}">
${automatedGate ? "PASS" : "STOP"}</strong>. Hand audit:
<strong class="${handGate ? "pass" : "stop"}">${audit ? `${correct}/${audit.decisions.length}
(${(rate * 100).toFixed(1)}%)` : "PENDING"}</strong>. Decision: <strong>${decision}</strong>.</p>
<h2>Required U0037 receipt</h2><pre>${esc(JSON.stringify(required, null, 2))}</pre>
<h2>Coreference receipt</h2><pre>${esc(JSON.stringify(s1.coreference, null, 2))}</pre>
<h2>Hand-audit queue</h2><table><thead><tr><th>Group</th><th>ID</th><th>Input</th>
<th>Pattern</th><th>Source</th><th>Content</th><th>Decision</th></tr></thead>
<tbody>${auditRows}</tbody></table></body></html>`;
writeFileSync(path.join(outDir, "report.html"), report);
writeFileSync(path.join(outDir, "gate.json"), `${JSON.stringify({
  schemaVersion: "cf4.phase0Gate.v1",
  automatedPrerequisitePassed: automatedGate,
  requiredU0037: required?.split ?? null,
  requiredResolution: antecedent ?? null,
  handAudit: {
    status: audit ? "complete" : "pending",
    threshold: audit?.threshold ?? 0.9,
    totalRows: s2.rows.length,
    correctRows: audit ? correct : null,
    accuracy: rate,
    requiredU0037Correct: requiredAudit?.correct ?? null,
  },
  decision,
}, null, 2)}\n`);
