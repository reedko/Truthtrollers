// Human-readable HTML report for the Call-1 split arm Stage-2 runs
// (pipeline-y-canonical-relation-split-v1). Pure function over the run records
// produced by runCall1Split — no model call, no I/O — so it can be unit-tested and
// re-rendered from saved artifacts. Style mirrors the existing blinded-review
// report: inline CSS, provenance tags (1A / 1B model vs deterministic HOST).

import { classifyGroundingSpan } from "../../../src/claim-foundry/candidateGroundingSpan.js";

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
// groundingSpan may be absent on raw 1A output; it is fully determined by the
// sourceUnitIds, so recompute rather than show "undefined".
const gsOf = (claim) => claim?.groundingSpan
  ?? (claim?.sourceUnitIds ? classifyGroundingSpan(claim.sourceUnitIds).groundingSpan : null);
const clip = (value, n = 160) => {
  const s = String(value ?? "");
  return esc(s.length > n ? `${s.slice(0, n)}…` : s);
};
const recordsText = (records) => Array.isArray(records)
  ? records.map((item) => `[${item.unitId}] ${item.text}`).join("\n") : String(records ?? "");
const spanTag = (gs) => gs ? `<span class="gs ${esc(gs)}">${esc(gs)}</span>` : "";

function table(headers, rows) {
  if (!rows.length) return `<p class="muted">none</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function orientationBlock(inv = {}) {
  const pillars = (inv.pillars ?? []).map((p) => `<li>${esc(p.label)} <span class="muted">(${esc(p.importance)})</span></li>`).join("");
  return `<div class="orient"><strong>theme:</strong> ${clip(inv.theme?.text, 400)}<br>
    <strong>thesis:</strong> ${clip(inv.thesis?.text, 400)}
    &nbsp;<span class="tag host">hinge</span> ${esc(inv.thesisHinge)}
    <ul>${pillars}</ul></div>`;
}

function claimDetail({ claim, signal = {}, judgment = {}, packet = {}, discovery = {}, selection = {} }) {
  const response = packet.possibleResponse?.text ?? recordsText(packet.localResponseUnits ?? packet.localResponseWindow);
  const sourceCandidates = (packet.sourceCandidates ?? []).map((item) =>
    `${item.sourceCandidateId}: ${item.nameHint ?? "(unparsed)"} · ${item.candidateKind ?? "legacy"} · ${item.trigger} · ${(item.unitIds ?? []).join(", ")} · ${item.basis ?? ""}`).join("; ");
  return `<details class="claim-detail"><summary>${clip(claim.claimText, 240)}</summary>
    <div class="claim-grid">
      <div><h4><span class="tag c1a">1A</span> proposition and grounding</h4>
        <strong>atomicity basis:</strong> ${esc(discovery.atomicityBasis ?? claim.atomicityBasis ?? "not recorded")}<br>
        <strong>atomic repair:</strong> ${esc(discovery._atomicityRepair?.status ?? "not flagged")}${discovery._atomicityRepair?.originalClaimText ? ` · originally: ${esc(discovery._atomicityRepair.originalClaimText)}` : ""}<br>
        <strong>claimText:</strong> ${esc(claim.claimText)}<br>
        <strong>source units:</strong> ${esc((claim.sourceUnitIds ?? []).join(", ") || "none")}<br>
        <strong>grounding text:</strong><blockquote>${clip(recordsText(packet.claimUnits), 1200)}</blockquote>
        <strong>attribution-context units:</strong> ${esc((discovery.attributionContextUnitIds ?? []).join(", ") || "none")}<br>
        <strong>attribution context:</strong><blockquote>${clip(recordsText(packet.attributionContextUnits), 1200) || "none supplied"}</blockquote>
        <strong>scope:</strong> ${esc(discovery.scope ?? claim.scope ?? "")}<br>
        <strong>materiality:</strong> ${esc(claim.materiality)}<br>
        <strong>pillars:</strong> ${esc((discovery.relatedPillarLabels ?? claim.relatedPillarLabels ?? []).join(", ") || "none")}<br>
        <strong>evidence-usefulness hint:</strong> ${esc(discovery.evidenceUsefulnessHint ?? claim.evidenceUsefulnessHint ?? "")}<br>
        <strong>host selection:</strong> ${esc(selection.reason ?? "selected after 1B")}</div>
      <div><h4><span class="tag c1b">1B</span> source and stance</h4>
        <strong>assertion source:</strong> ${esc(judgment.assertionSource ?? claim.assertionSource)}<br>
        <strong>source basis units:</strong> ${esc((judgment.assertionSourceUnitIds ?? signal.assertionSourceUnitIds ?? []).join(", ") || "none")}<br>
        <strong>source resolution:</strong> ${esc(judgment.assertionSourceResolution ?? signal.assertionSourceResolution ?? "legacy/not recorded")}<br>
        <strong>host source-candidate status:</strong> ${esc(packet.sourceCandidateStatus ?? "not_evaluated")}<br>
        <strong>host source candidates:</strong> ${esc(sourceCandidates || "none")}<br>
        <strong>content stance:</strong> <span class="stance ${esc(judgment.contentStance)}">${esc(judgment.contentStance ?? signal.contentStance)}</span><br>
        <span class="field-help">If this proposition is true, does it support, contradict, or leave the article thesis neutral?</span><br>
        <strong>article deployment:</strong> ${esc(judgment.articleDeployment ?? signal.articleDeployment)}<br>
        <span class="field-help">How the article treats it: endorsed, rebutted, or merely reported.</span><br>
        <strong>article role:</strong> ${esc(judgment.articleRole ?? claim.articleRole)}<br>
        <strong>response units:</strong> ${esc((judgment.responseUnitIds ?? signal.responseUnitIds ?? []).join(", ") || "none")}<br>
        <strong>article response/context:</strong><blockquote>${clip(response, 1200) || "none supplied"}</blockquote>
        <strong>split warning:</strong> ${judgment.needsSplit?.split
          ? `<span class="bad">${clip(judgment.needsSplit.reason, 300)}</span>` : "none"}</div>
      <div><h4><span class="tag host">HOST</span> deterministic result</h4>
        <strong>articleUse:</strong> ${esc(claim.articleUse)}<br>
        <strong>scoreTransform:</strong> ${esc(signal.scoreTransform ?? "")}<br>
        <strong>assertion-source class:</strong> ${esc(signal.assertionSourceClass ?? "")}<br>
        <strong>merged candidate IDs:</strong> ${esc((signal.mergedCandidateIds ?? []).join(", ") || signal.candidateId || "none")}<br>
        <strong>grounding span:</strong> ${spanTag(signal.groundingSpan ?? gsOf(claim))}<br>
        <strong>final status:</strong> selected into the CF1 inventory</div>
    </div></details>`;
}

function runSection(run) {
  const { fixtureId, repeat, seed, status, elapsedMs, error, result } = run;
  const head = `<h3>${esc(fixtureId)} · run ${esc(repeat)} <span class="muted">seed ${esc(seed)}</span>
    · <span class="${status === "completed" ? "ok" : "bad"}">${esc(status)}</span>
    · ${esc(Math.round((elapsedMs ?? 0)))}ms
    · ${esc(result?.usage?.totalTokens ?? "?")} tok</h3>`;
  if (status !== "completed" || !result) {
    return `<section class="run failed">${head}<blockquote>${esc(error?.code ?? "")}: ${esc(error?.message ?? "no result")}</blockquote></section>`;
  }
  const inv = result.inventory ?? {};
  const raw1a = result.raw?.call1a ?? {};
  const combined1a = result.raw?.call1aWithRecovery ?? raw1a;
  const raw1b = result.raw?.call1b ?? {};
  const signalsByText = new Map((result.hostSignals ?? []).map((s) => [s.claimText, s]));
  const selector = result.selector ?? {};
  const judgmentsById = new Map((raw1b.candidateJudgments ?? []).map((item) => [item.candidateId, item]));
  const packetsById = new Map((result.raw?.packets ?? []).map((item) => [item.id, item]));
  const tail = result.finalArticleCoverageRange;
  const tailHit = tail?.sourceUnitIds?.some((id) => (raw1a.candidateClaims ?? [])
    .some((claim) => claim.sourceUnitIds?.includes(id)));
  const modelCallRows = Object.entries(result.modelCalls ?? {}).map(([stage, call]) => [
    esc(stage), esc(call.request?.model), esc(call.request?.seed), esc(call.request?.temperature),
    `<code>${esc(call.request?.requestSha256 ?? "—")}</code>`,
    `<code>${esc(call.request?.systemSha256 ?? "—")}</code>`,
    `<code>${esc(call.request?.userSha256 ?? "—")}</code>`,
    `<code>${esc(call.request?.schemaSha256 ?? "—")}</code>`,
    `<code>${esc(call.response?.responseId ?? "—")}</code>`,
    `<code>${esc(call.response?.systemFingerprint ?? "—")}</code>`,
    esc(call.response?.serviceTier ?? "—"), esc(call.response?.cachedInputTokens ?? "—"),
  ]);

  const discoveryRows = (raw1a.candidateClaims ?? []).map((c) => [
    c._occurrenceDerived
      ? `<span class="tag host">HOST occurrence</span> from raw candidate ${esc(c._occurrenceDerived.fromCandidateIndex + 1)}`
      : `<span class="tag c1a">1A model</span>`,
    clip(c.atomicityBasis ?? "not recorded", 220), clip(c.claimText, 220), esc((c.sourceUnitIds ?? []).join(", ")),
    esc((c.attributionContextUnitIds ?? []).join(", ") || "none"), spanTag(gsOf(c)), esc(c.materiality)]);

  const census = result.censusDiagnostic ?? { status: "unavailable", summary: {}, items: [] };
  const censusRows = (census.items ?? []).map((item) => [
    esc(item.censusId), esc(item.semanticChunkId ?? "—"), esc((item.sourceUnitIds ?? []).join(", ")),
    esc(item.trigger), esc((item.signals ?? []).join(", ")), clip(item.snippet, 260),
    item.match
      ? `<span class="ok">Apparently covered by Call 1A</span><br><span class="muted">${esc(item.match.candidateId)}: ${clip(item.match.claimText, 180)}</span>`
      : item.assessment === "probably_not_a_standalone_claim"
        ? `<span class="muted">Probably not a standalone claim</span>`
        : `<span class="bad">No obvious Call 1A match</span>`,
    item.match ? esc(item.match.reason)
      : item.assessment === "probably_not_a_standalone_claim"
        ? "Deterministic signals do not justify sending this passage to recovery"
        : "No sufficiently similar Call 1A claim grounded in this passage",
  ]);
  const recovery = result.censusRecovery ?? { status: "disabled" };
  const acceptedRecovery = new Set((recovery.merge?.accepted ?? []).map((claim) => claim.claimText));
  const rejectedRecovery = new Map((recovery.merge?.rejected ?? [])
    .map((entry) => [entry.claimText, entry.reason]));
  const recoveryRows = (recovery.output?.candidateClaims ?? []).map((claim) => [
    acceptedRecovery.has(claim.claimText) ? `<span class="ok">accepted</span>`
      : `<span class="bad">rejected: ${esc(rejectedRecovery.get(claim.claimText) ?? "not merged")}</span>`,
    esc((claim.censusIds ?? []).join(", ")), clip(claim.claimText, 260),
    esc((claim.sourceUnitIds ?? []).join(", ")), esc(claim.materiality),
    esc((claim.relatedPillarLabels ?? []).join(", ") || "none"),
  ]);
  const atomicRepair = result.atomicRepair ?? { status: "disabled" };
  const atomicRows = (atomicRepair.application?.diagnostics ?? []).map((item) => [
    esc(item.repairId), esc(item.action), clip(item.originalClaimText ?? item.claimText, 260),
    item.originalClaimText ? clip(item.claimText, 260) : "—",
    esc((item.sourceUnitIds ?? []).join(", ") || "—"), esc(item.reason ?? "—"),
  ]);

  const judgmentRows = (raw1b.candidateJudgments ?? []).map((j) => [
    esc(j.candidateId), clip(j.assertionSource, 60), esc((j.assertionSourceUnitIds ?? []).join(", ") || "none"),
    esc(j.assertionSourceResolution ?? "legacy/not recorded"), esc(j.contentStance), esc(j.articleDeployment),
    esc(j.articleRole),
    j.needsSplit?.split ? `<span class="bad">split: ${clip(j.needsSplit.reason, 80)}</span>` : "—"]);

  const finalRows = (inv.candidateClaims ?? []).map((c, finalIndex) => {
    const sig = (result.hostSignals ?? [])[finalIndex] ?? signalsByText.get(c.claimText) ?? {};
    const judgment = judgmentsById.get(sig.candidateId) ?? {};
    const packet = packetsById.get(sig.candidateId) ?? {};
    const candidateOffset = Number.parseInt(String(sig.candidateId ?? "").replace("CAND", ""), 10) - 1;
    const discovery = selector.selectedClaims?.[candidateOffset]
      ?? (raw1a.candidateClaims ?? []).find((item) => item.claimText === c.claimText
        && (item.sourceUnitIds ?? []).join(",") === (packet.sourceUnitIds ?? []).join(",")) ?? {};
    const selection = (selector.selected ?? []).find((item) => {
      const raw = raw1a.candidateClaims?.[item.index];
      return raw?.claimText === discovery.claimText
        && (raw?.sourceUnitIds ?? []).join(",") === (discovery.sourceUnitIds ?? []).join(",");
    }) ?? {};
    return [claimDetail({ claim: c, signal: sig, judgment, packet,
      discovery, selection }),
      `${clip(c.assertionSource, 50)} <span class="cls">${esc(sig.assertionSourceClass ?? "")}</span>`,
      `<span class="stance ${esc(sig.contentStance)}">${esc(sig.contentStance ?? "")}</span>`,
      esc(sig.articleDeployment ?? ""),
      esc(c.articleUse), esc(c.articleRole), esc(sig.scoreTransform ?? ""),
      esc(c.materiality), spanTag(sig.groundingSpan ?? gsOf(c))];
  });

  const d = result.diagnostics ?? {};
  const stanceCounts = (result.hostSignals ?? []).reduce((counts, item) => {
    counts[item.contentStance] = (counts[item.contentStance] ?? 0) + 1;
    return counts;
  }, {});
  const deploymentCounts = (result.hostSignals ?? []).reduce((counts, item) => {
    counts[item.articleDeployment] = (counts[item.articleDeployment] ?? 0) + 1;
    return counts;
  }, {});
  const unknownSourceCount = (result.hostSignals ?? []).filter((item) =>
    !item.assertionSourceResolution || !String(item.assertionSourceResolution).startsWith("resolved_from_")).length;
  const tailStatus = tail
    ? `final range ${esc(tail.firstUnitId)}–${esc(tail.lastUnitId)}: <span class="${tailHit ? "ok" : "bad"}">${tailHit ? "HIT" : "MISSED"}</span>`
    : "final range unavailable";
  const diag = `<div class="diag">1A coverage: <b>${esc(selector.coverage?.sourceRegionCount ?? "?")}</b> source regions
    · <span class="${selector.coverage?.complete === false ? "bad" : "ok"}">${selector.coverage?.complete === false ? "INCOMPLETE" : "complete"}</span>
    · ${tailStatus}
    · selected <b>${esc(d.selectedCount)}</b> · deselected ${esc(d.deselectedCount)}
    · model discovery ${esc(result.raw?.occurrenceExpansion?.originalCount ?? raw1a.candidateClaims?.length ?? "?")}
      → occurrence-expanded ${esc(result.raw?.occurrenceExpansion?.expandedCount ?? raw1a.candidateClaims?.length ?? "?")}
    · duplicate collapses ${esc((d.duplicateCollapses ?? []).length)}
    · stance: supports ${esc(stanceCounts.supports_thesis ?? 0)}, contradicts ${esc(stanceCounts.contradicts_thesis ?? 0)}, neutral ${esc(stanceCounts.neutral ?? 0)}
    · deployment: rebutted ${esc(deploymentCounts.rebutted ?? 0)}, endorsed ${esc(deploymentCounts.endorsed ?? 0)}, reported ${esc(deploymentCounts.reported_neutral ?? 0)}
    · unresolved sources ${esc(unknownSourceCount)}
    · source-resolution issues ${esc((d.sourceResolutionIssues ?? []).length)}
    · <span class="${(d.blockingErrors ?? []).length ? "bad" : "ok"}">blocking ${esc((d.blockingErrors ?? []).length)}</span></div>`;

  return `<section class="run">${head}
    ${orientationBlock(inv)}
    ${diag}
    <details open><summary><span class="tag host">PROVENANCE</span> model-call identity (${modelCallRows.length})</summary>
      ${table(["stage", "model", "seed", "temperature", "request SHA-256", "system SHA-256", "user SHA-256", "schema SHA-256", "OpenAI response ID", "system fingerprint", "service tier", "cached input"], modelCallRows)}</details>
    <details open><summary><span class="tag c1a">1A</span> discovery — canonical propositions (${discoveryRows.length})</summary>
      ${table(["origin", "atomicityBasis", "claimText", "sourceUnitIds", "attributionContextUnitIds", "groundingSpan", "materiality"], discoveryRows)}</details>
    <details open><summary><span class="tag host">HOST</span> pre-1B deterministic selection (${(selector.selected ?? []).length}/${combined1a.candidateClaims?.length ?? discoveryRows.length})</summary>
      ${table(["index", "claimText", "reason", "source region"], (selector.selected ?? []).map((s) => [esc(s.index), clip(s.claimText, 220), esc(s.reason), esc(s.region)]))}
      <p class="muted">deferred: ${(selector.deferred ?? []).map((s) => `${esc(s.index)} (${esc(s.reason)})`).join(", ") || "none"}</p></details>
    <details open><summary><span class="tag c1a">RECOVERY</span> census recovery — ${esc(recovery.status)} (${esc(recovery.merge?.summary?.acceptedRecoveryClaims ?? 0)} accepted)</summary>
      <div class="diag">This is a separate optional experiment. It does not alter the primary 1A prompt. Failure is nonblocking.
        · eligible unmatched ${esc(recovery.packetSelection?.summary?.eligibleUnmatchedPackets ?? "—")}
        · sent ${esc(recovery.packetSelection?.summary?.selectedPackets ?? 0)} passages from ${esc(recovery.packetSelection?.summary?.selectedSemanticChunks ?? 0)} chunks
        · model returned ${esc(recovery.merge?.summary?.modelRecoveryClaims ?? recovery.output?.candidateClaims?.length ?? 0)}
        · accepted ${esc(recovery.merge?.summary?.acceptedRecoveryClaims ?? 0)}
        · rejected ${esc(recovery.merge?.summary?.rejectedRecoveryClaims ?? 0)}
        ${recovery.error ? `· <span class="bad">${esc(recovery.error)}</span>` : ""}</div>
      ${table(["merge result", "census IDs", "recovered claim", "source units", "materiality", "pillars"], recoveryRows)}</details>
    <details open><summary><span class="tag c1a">ATOMIC REPAIR</span> ${esc(atomicRepair.status)} (${esc(atomicRepair.application?.summary?.replaced ?? 0)} replaced, ${esc(atomicRepair.application?.summary?.dropped ?? 0)} dropped)</summary>
      <div class="diag">Separate optional repair after primary 1A and before selection. Census packets are not inputs.
        · flagged ${esc(atomicRepair.packetBuild?.summary?.flaggedClaims ?? 0)}
        · kept ${esc(atomicRepair.application?.summary?.kept ?? 0)}
        · replaced ${esc(atomicRepair.application?.summary?.replaced ?? 0)}
        · dropped ${esc(atomicRepair.application?.summary?.dropped ?? 0)}
        · unresolved/fallback ${esc(atomicRepair.application?.summary?.unresolved ?? 0)}
        ${atomicRepair.error ? `· <span class="bad">${esc(atomicRepair.error)}</span>` : ""}</div>
      ${table(["repair ID", "action", "original claim", "replacement", "source units", "reason"], atomicRows)}</details>
    <details><summary><span class="tag c1b">1B</span> source / posture judgments (${judgmentRows.length})</summary>
      ${table(["candidateId", "assertionSource", "source basis", "source resolution", "contentStance", "articleDeployment", "articleRole", "needsSplit"], judgmentRows)}</details>
    <details open><summary><span class="tag host">HOST</span> merged inventory — selected claims (${finalRows.length})</summary>
      ${table(["claim (click for full detail)", "assertionSource · class", "contentStance (1B)", "deployment (1B)", "articleUse (HOST)", "articleRole", "scoreTransform", "materiality", "groundingSpan"], finalRows)}</details>
    <details open><summary><span class="tag host">HOST</span> Census Diagnostic: Potentially Missed Attributed or Opponent Claims (${esc(census.summary?.totalPackets ?? 0)})</summary>
      <p class="muted">The census is an experimental diagnostic. It identifies passages that may contain attributed, quoted, or opponent assertions and allows reviewers to compare them with the claims independently extracted by Call 1A. Census findings do not affect the CF1 result and do not block the pipeline.</p>
      <div class="diag">${census.status === "available"
        ? `scanned ${esc(census.summary?.semanticChunksScanned ?? "?")} semantic chunks · chunks with packets ${esc(census.summary?.semanticChunksWithPackets ?? "?")} · total ${esc(census.summary?.totalPackets ?? 0)} · recovery-eligible ${esc(census.summary?.recoveryEligiblePackets ?? "?")} · by trigger: ${esc(Object.entries(census.summary?.byTrigger ?? {}).map(([kind, count]) => `${kind} ${count}`).join(", ") || "none")} · <span class="ok">apparently covered ${esc(census.summary?.apparentMatchCount ?? 0)}</span> · <span class="bad">no obvious match ${esc(census.summary?.noObviousMatchCount ?? 0)}</span> · probably not standalone ${esc(census.summary?.probablyNotStandaloneCount ?? 0)} · not evaluated ${esc(census.summary?.notEvaluatedCount ?? 0)}`
        : `<span class="bad">Not evaluated: ${esc(census.error ?? "diagnostic unavailable")}</span>`}</div>
      ${table(["census ID", "semantic chunk", "source unit", "trigger", "signals", "source snippet", "Call 1A comparison", "diagnostic note"], censusRows)}</details>
  </section>`;
}

function summaryTable(runs) {
  const rows = runs.map((r) => {
    const res = r.result;
    const distant = (res?.raw?.call1a?.candidateClaims ?? []).filter((c) => gsOf(c) === "distant").length;
    const border = (res?.raw?.call1a?.candidateClaims ?? []).filter((c) => gsOf(c) === "borderline").length;
    return [esc(r.fixtureId), esc(r.repeat),
      `<span class="${r.status === "completed" ? "ok" : "bad"}">${esc(r.status)}</span>`,
      esc(res?.raw?.call1aModel?.candidateClaims?.length ?? res?.raw?.call1a?.candidateClaims?.length ?? "—"),
      esc(res?.raw?.call1a?.candidateClaims?.length ?? "—"),
      esc(res?.diagnostics?.selectedCount ?? "—"),
      `${distant}d / ${border}b`,
      esc(res?.censusDiagnostic?.summary?.totalPackets ?? "—"),
      `<span class="${(res?.censusDiagnostic?.summary?.noObviousMatchCount ?? 0) ? "bad" : "ok"}">${esc(res?.censusDiagnostic?.summary?.noObviousMatchCount ?? "—")}</span>`,
      esc(res?.usage?.totalTokens ?? "—"), esc(Math.round(r.elapsedMs ?? 0))];
  });
  return table(["fixture", "run", "status", "1A model", "occurrence-expanded", "selected", "span d/b", "census packets", "no obvious match", "tokens", "ms"], rows);
}

export function renderSplitArmHtml({ runId, model, generatedAt, runs = [], note = null }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>CF1 Call-1 split arm — ${esc(runId)}</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;margin:1rem 2rem;line-height:1.4;color:#222}
h1{font-size:1.3rem}h3{margin:1.4rem 0 0.3rem;border-top:2px solid #446;padding-top:0.5rem}
.legend{background:#f7f7e8;border:1px solid #ddc;padding:0.6rem 1rem;font-size:0.9rem;margin-bottom:0.8rem}
table{border-collapse:collapse;width:100%;margin:0.4rem 0}
th,td{border:1px solid #ccc;padding:0.3rem 0.45rem;font-size:0.82rem;text-align:left;vertical-align:top}
th{background:#eee;position:sticky;top:0}
.tag{font-weight:700;font-size:0.72rem;padding:0 0.35rem;border-radius:3px;margin-right:0.3rem}
.c1a{background:#dbeafe}.c1b{background:#ede9fe}.host{background:#fde8c8}
.gs{font-weight:700;font-size:0.72rem;padding:0 0.35rem;border-radius:3px}
.gs.clustered{background:#dcfce7}.gs.borderline{background:#fef3c7}.gs.distant{background:#fee2e2}
.cls{color:#6b21a8;font-size:0.72rem;font-weight:700}
.ok{color:#166534;font-weight:600}.bad{color:#b91c1c;font-weight:600}
.orient{background:#fafaff;border-left:4px solid #446;padding:0.4rem 0.8rem;margin:0.3rem 0;font-size:0.86rem}
.orient ul{margin:0.2rem 0 0 1.2rem}
.diag{background:#f4f4f4;padding:0.3rem 0.7rem;font-size:0.82rem;margin:0.3rem 0;border-radius:4px}
.claim-detail>summary{font-weight:600;color:#153e75}.claim-detail[open]>summary{margin-bottom:.5rem}
.claim-grid{display:grid;grid-template-columns:minmax(260px,1.2fr) minmax(260px,1.2fr) minmax(190px,.7fr);gap:.7rem;min-width:850px}
.claim-grid>div{background:#fafafa;border:1px solid #ddd;padding:.5rem}.claim-grid h4{margin:0 0 .4rem;font-size:.86rem}
.claim-grid blockquote{margin:.3rem 0 .5rem;padding:.35rem .5rem;background:white;border-left:3px solid #bbb;white-space:normal}
.field-help{color:#666;font-size:.75rem}.stance{font-weight:700;font-size:.75rem;padding:.08rem .3rem;border-radius:3px;white-space:nowrap}
.stance.supports_thesis{background:#dcfce7;color:#166534}.stance.contradicts_thesis{background:#fee2e2;color:#991b1b}.stance.neutral{background:#eee;color:#444}
.run.failed{background:#fff2f2}
details{margin:0.35rem 0}summary{cursor:pointer;font-weight:600;font-size:0.9rem}
.muted{color:#777;font-weight:400}
</style></head><body>
<h1>CF1 Call-1 split arm — pipeline-y-canonical-relation-split-v1</h1>
<div class="legend"><strong>Stage-2 ${note ? "report" : "live run"} ${esc(runId)}</strong> · model <code>${esc(model)}</code>
· generated ${esc(generatedAt)}.<br>
${note ? `<strong>Note:</strong> ${esc(note)}<br>` : ""}
Provenance: <span class="tag c1a">1A</span> discovery model call (propositions only)
<span class="tag c1b">1B</span> source/posture model call (from compact packets)
<span class="tag host">HOST</span> deterministic host step.
groundingSpan: <span class="gs clustered">clustered</span> <span class="gs borderline">borderline</span>
<span class="gs distant">distant</span>. Failed runs are results.</div>
<h3>Summary</h3>
${summaryTable(runs)}
${runs.map(runSection).join("\n")}
</body></html>`;
}
