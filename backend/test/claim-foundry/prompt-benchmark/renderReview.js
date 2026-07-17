// Human-readable blinded review rendering (coder plan §10.6). No producer
// identity, cost, latency, or trace content. Arrays render in full — never
// truncate semantic content to fit a table.
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const bullets = (values) => (values ?? []).map((value) => `  - ${cell(value)}`).join("\n");

export function call1BlindOutput(verifiedInventory) {
  if (!verifiedInventory) return null;
  return { theme: verifiedInventory.theme?.text ?? null,
    thesis: verifiedInventory.thesis?.text ?? null,
    thesisHinge: verifiedInventory.thesisHinge ?? null,
    pillars: (verifiedInventory.pillars ?? []).map(({ label, text, importance }) =>
      ({ label, text, importance })),
    candidateClaims: (verifiedInventory.candidateClaims ?? []).map((claim) => ({
      claimText: claim.claimText, articleRole: claim.articleRole, articleUse: claim.articleUse,
      materiality: claim.materiality, relatedPillarLabels: claim.relatedPillarLabels,
      assertionSource: claim.assertionSource, scope: claim.scope })) };
}

export function call2BlindOutput(verifiedEnrichment) {
  if (!verifiedEnrichment) return null;
  return { enriched: (verifiedEnrichment.selectedClaims ?? []).map((claim) => ({
    claimText: claim.claimText, disputedProposition: claim.disputedQuestion?.disputedProposition,
    verificationTarget: claim.disputedQuestion?.verificationTarget,
    warrant: claim.warrant ?? null,
    supportCriteria: claim.claimTrueIf, refuteCriteria: claim.claimFalseIf,
    qualifyCriteria: claim.claimQualifiedIf, mustMatch: claim.mustMatch,
    rejectIfOnly: claim.rejectIfOnly, sourceStrategy: claim.sourceStrategy,
    origin: claim.origin ?? "model" })) };
}

export function packageBlindOutput(claimPackage) {
  if (!claimPackage) return null;
  const cards = new Map((claimPackage.evidenceNeedCards ?? [])
    .map((card) => [card.targetId, card]));
  return { selected: (claimPackage.selectedEvaluationClaims ?? []).map((claim, index) => {
    const card = cards.get(`T${String(index + 1).padStart(2, "0")}`)
      ?? (claimPackage.evidenceNeedCards ?? [])[index] ?? {};
    return { claimText: claim.claimText, origin: claim.origin ?? "model",
      articleRole: claim.articleRole, materiality: claim.materiality,
      disputedProposition: card.disputedQuestion?.disputedProposition ?? null,
      warrant: card.warrant ?? claim.warrant ?? null,
      mustMatch: card.bearingCriteria?.mustMatch ?? [],
      rejectIfOnly: card.bearingCriteria?.rejectIfOnly ?? [],
      support: card.falsifiability?.wouldSupportIf ?? null,
      refute: card.falsifiability?.wouldRefuteIf ?? null,
      qualify: card.falsifiability?.wouldQualifyIf ?? null,
      strategy: card.bestSourceTypes?.join(", ") ?? null };
  }) };
}

export function renderCall1Review(packets) {
  const sections = packets.map((packet) => {
    const parts = [`## ${packet.subject} — repeat ${packet.repeat}`];
    for (const label of packet.sectionOrder) {
      const entry = packet.outputs[label];
      parts.push(`### ${label}`);
      if (!entry?.output) { parts.push(`_run status: ${entry?.status ?? "missing"}_`); continue; }
      const output = entry.output;
      parts.push(`Theme: ${cell(output.theme)}`, `Thesis: ${cell(output.thesis)}`,
        `Thesis hinge: ${cell(output.thesisHinge)}`,
        `Pillars:\n${bullets(output.pillars.map((pillar) =>
          `${pillar.label} (${pillar.importance}): ${pillar.text}`))}`);
      parts.push("| # | Candidate claim | Role/use | Materiality | Pillar | Assertion source | Scope |",
        "|---|---|---|---|---|---|---|");
      output.candidateClaims.forEach((claim, index) => parts.push(
        `| ${index + 1} | ${cell(claim.claimText)} | ${cell(claim.articleRole)}/${cell(claim.articleUse)} `
        + `| ${cell(claim.materiality)} | ${cell(claim.relatedPillarLabels?.join(", "))} `
        + `| ${cell(claim.assertionSource)} | ${cell(claim.scope)} |`));
    }
    return parts.join("\n");
  });
  return `# Call 1 blinded review\n\n${sections.join("\n\n")}\n`;
}

export function renderCall2Review(packets) {
  const sections = packets.map((packet) => {
    const parts = [`## ${packet.subject} — repeat ${packet.repeat}`];
    for (const label of packet.sectionOrder) {
      const entry = packet.outputs[label];
      parts.push(`### ${label}`);
      if (!entry?.output) { parts.push(`_run status: ${entry?.status ?? "missing"}_`); continue; }
      for (const item of entry.output.enriched ?? entry.output.selected ?? []) {
        parts.push(`**Claim:** ${cell(item.claimText)}${item.origin === "host_pillar_backfill"
          ? " _(host pillar backfill — not model recall)_" : ""}`,
        `- Disputed proposition: ${cell(item.disputedProposition)}`,
        `- Warrant: ${cell(item.warrant) || "None — direct claim"}`,
        `- Support: ${cell(item.support ?? item.supportCriteria)}`,
        `- Refute: ${cell(item.refute ?? item.refuteCriteria)}`,
        `- Qualify: ${cell(item.qualify ?? item.qualifyCriteria)}`,
        `- Must match:\n${bullets(item.mustMatch)}`,
        `- Reject if only:\n${bullets(item.rejectIfOnly)}`,
        `- Strategy: ${cell(item.sourceStrategy ?? item.strategy)}`, "");
      }
    }
    return parts.join("\n");
  });
  return `# Call 2 / package blinded review\n\n${sections.join("\n\n")}\n`;
}

// Dependency-free HTML rendering of the review markdown we emit (headings,
// tables, bullets, bold/italic). Content is entity-escaped before markup.
const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>");
}

export function markdownToHtml(markdown, title = "CF1 blinded review") {
  const lines = markdown.split("\n");
  const body = [];
  let table = null;
  let list = null;
  const closeBlocks = () => {
    if (table) { body.push("</tbody></table>"); table = null; }
    if (list) { body.push("</ul>"); list = null; }
  };
  for (const line of lines) {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const row = /^\|(.+)\|$/.exec(line);
    const bullet = /^\s*- (.*)$/.exec(line);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      body.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
    } else if (row) {
      const cells = row[1].split(/(?<!\\)\|/).map((value) => value.replace(/\\\|/g, "|").trim());
      if (cells.every((value) => /^-{3,}$/.test(value))) continue;
      if (!table) {
        if (list) { body.push("</ul>"); list = null; }
        table = true;
        body.push("<table><thead><tr>"
          + cells.map((value) => `<th>${inlineHtml(value)}</th>`).join("") + "</tr></thead><tbody>");
      } else {
        body.push(`<tr>${cells.map((value) => `<td>${inlineHtml(value)}</td>`).join("")}</tr>`);
      }
    } else if (bullet) {
      if (table) { body.push("</tbody></table>"); table = null; }
      if (!list) { list = true; body.push("<ul>"); }
      body.push(`<li>${inlineHtml(bullet[1])}</li>`);
    } else {
      closeBlocks();
      if (line.trim()) body.push(`<p>${inlineHtml(line)}</p>`);
    }
  }
  closeBlocks();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:960px;margin:2rem auto;
padding:0 1rem;line-height:1.45}table{border-collapse:collapse;width:100%;margin:0.75rem 0}
th,td{border:1px solid #ccc;padding:0.35rem 0.5rem;text-align:left;vertical-align:top;
font-size:0.9rem}th{background:#f2f2f2}h2{border-bottom:2px solid #444;padding-bottom:0.2rem;
margin-top:2.5rem}h3{background:#eef;padding:0.3rem 0.5rem;margin-top:1.5rem}</style>
</head><body>
${body.join("\n")}
</body></html>\n`;
}

export function scoreTemplate({ packets, dimensions }) {
  return { schemaVersion: "cf1.benchmarkScores.v1", instructions:
    "Mark evaluation-key targets present|partial|absent per profile; score each dimension 1-5.",
  packets: packets.map((packet) => ({ subject: packet.subject, repeat: packet.repeat,
    profiles: Object.fromEntries(packet.sectionOrder.map((label) => [label, {
      targetJudgments: {}, dimensions: Object.fromEntries(dimensions.map((d) => [d, null])),
      notes: "" }])) })) };
}
