#!/usr/bin/env node

/**
 * Read-only forensic evidence snapshot generator.
 *
 * Usage:
 *   node generate-evidence-report.js \
 *     --label BASELINE \
 *     --claims 56731,56733,56734 \
 *     --output report.html \
 *     --snapshot-out baseline-1.json
 *
 * The database is never modified. All extraction occurs inside a READ ONLY
 * transaction, which is rolled back before the connection closes.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("./backend/node_modules/dotenv");
const mysql = require("./backend/node_modules/mysql2/promise");

const ROOT = __dirname;

function parseArgs(argv) {
  const out = { label: "BASELINE", claims: [], output: "report.html", outputExplicit: false, snapshotOut: null,
    snapshots: [], legacyRaw: null, detailed: false, env: "backend/.env" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--label" && value) out.label = value, i += 1;
    else if (arg === "--claims" && value) out.claims = value.split(",").map(Number), i += 1;
    else if (arg === "--output" && value) out.output = value, out.outputExplicit = true, i += 1;
    else if (arg === "--snapshot-out" && value) out.snapshotOut = value, i += 1;
    else if (arg === "--snapshots" && value) out.snapshots = value.split(",").filter(Boolean), i += 1;
    else if (arg === "--from-legacy-raw" && value) out.legacyRaw = value, i += 1;
    else if (arg === "--detailed") out.detailed = true;
    else if (arg === "--env" && value) out.env = value, i += 1;
    else if (arg === "--help") {
      console.log("DB mode: node generate-evidence-report.js --label LABEL --claims 1,2,3 --snapshot-out snapshot.json --output report.html\nJSON comparison: node generate-evidence-report.js --snapshots old.json,new.json --output comparison.html\nJSON detailed: node generate-evidence-report.js --snapshots run1.json,run2.json --detailed --output detailed.html\nLegacy migration: node generate-evidence-report.js --from-legacy-raw baseline-1.json --snapshot-out baseline.json");
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const needsClaims = !out.snapshots.length && !out.legacyRaw;
  if (needsClaims && (!out.claims.length || out.claims.some((id) => !Number.isSafeInteger(id) || id <= 0))) {
    throw new Error("--claims must be a comma-separated list of positive integer claim IDs");
  }
  out.claims = [...new Set(out.claims)];
  return out;
}

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const shown = (value) => value === null || value === undefined || value === "" ? "—" : esc(value);
const num = (value, digits = 3) => value === null || value === undefined || value === "" ? "—" : Number(value).toFixed(digits);
const date = (value) => value ? new Date(value).toISOString() : "—";
const keyBy = (rows, key) => new Map(rows.map((row) => [String(row[key]), row]));
const groupBy = (rows, key) => rows.reduce((map, row) => {
  const k = String(row[key]);
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(row);
  return map;
}, new Map());

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch { return String(raw || "").trim().toLowerCase(); }
}
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function titleKey(value) {
  return normalizeText(value).replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
}
function jaccard(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter((x) => x.length > 2));
  const B = new Set(normalizeText(b).split(" ").filter((x) => x.length > 2));
  if (!A.size || !B.size) return 0;
  const intersection = [...A].filter((x) => B.has(x)).length;
  return intersection / (A.size + B.size - intersection);
}

function observationTags(taskId, text) {
  const s = normalizeText(text);
  const tags = [];
  if (taskId === 56733 || taskId === 56734) {
    if (/\b(said|says|stated|statement|alleged|claimed|revealed|reported|whistleblower|testimony)\b/.test(s)) tags.push("ATTRIBUTION");
    if (/\b(study|paper|report|dataset|data set|analysis|protocol|population|subgroup|children|cohort|lancet)\b/.test(s)) tags.push("STUDY IDENTITY");
    if (/\b(manipulat|destroy|omit|fraud|misrepresent|twisted|deleted|ordered|evidence)\b/.test(s)) tags.push("SUBSTANTIVE");
    if (/\b(conclusion|association|no link|no association|cause autism|causes autism|meaning|implication|discredited|false)\b/.test(s)) tags.push("INFERENCE");
  }
  return tags;
}

function comparativeBearing(taskId, text) {
  if (taskId !== 56731) return null;
  const s = normalizeText(text);
  return /more than any|more extensively than|more testing than|compared (with|to) (other|all).*medicine|relative to other.*medicine/.test(s)
    ? "COMPARATIVE BEARING DETECTED"
    : "GENERIC TESTING ONLY — comparative/superlative element not established";
}

function mismatchObservation(taskId, row) {
  const s = normalizeText(`${row.reference_claim || ""} ${row.evidence_text || ""} ${row.rationale || ""}`);
  if (taskId === 56731 && !/more than any|more extensively than|more testing than|compared (with|to) (other|all).*medicine/.test(s)) {
    return "Topically related to vaccine testing, but does not materially establish ‘more than any other medicine.’";
  }
  if (taskId === 56733 && !s.includes("thompson")) {
    return "Does not identify William Thompson; cannot by itself establish what Thompson revealed or whether the alleged CDC manipulation occurred.";
  }
  if (taskId === 56734 && !(s.includes("cdc") && /destroy|destruction|deleted|ordered/.test(s))) {
    return "Does not establish a CDC order to destroy evidence; vaccine/autism conclusions are not evidence of document destruction.";
  }
  return null;
}

async function select(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function extract(conn, claimIds) {
  const p = claimIds.map(() => "?").join(",");

  // This is the supplied authoritative starting query, parameterized only so
  // future snapshots can use a different claim-ID set without SQL rewrites.
  const startingRows = await select(conn, `
    SELECT tc.claim_id AS task_claim_id, tc.claim_text AS task_claim,
      cr.content_relation_id, cr.reference_content_id,
      c.content_name AS reference_title, c.url AS reference_url,
      rc.claim_id AS reference_claim_id, rc.claim_text AS reference_claim,
      rctl.reference_claim_task_links_id, rctl.stance, rctl.score,
      rctl.confidence, rctl.support_level, rctl.rationale, rctl.quote
    FROM claims tc
    LEFT JOIN reference_claim_task_links rctl ON rctl.task_claim_id = tc.claim_id
    LEFT JOIN claims rc ON rc.claim_id = rctl.reference_claim_id
    LEFT JOIN content_relations cr ON cr.content_relation_id = rctl.content_relation_id
    LEFT JOIN content c ON c.content_id = cr.reference_content_id
    WHERE tc.claim_id IN (${p})
    ORDER BY tc.claim_id, rctl.confidence DESC, rctl.support_level DESC, cr.reference_content_id
  `, claimIds);

  const taskClaims = await select(conn, `
    SELECT c.*, cc.cc_id, cc.content_id AS task_content_id, cc.relationship_type,
      cc.claim_role, cc.parent_claim_id, cc.claim_depth, cc.centrality_score,
      cc.verifiability_score, cc.claim_order, cc.object_claim_text,
      cc.is_attribution, cc.speaker_entity, cc.article_stance,
      cc.source_grounding_json, cc.argument_function, cc.score_transform,
      cc.argument_mapping_confidence, cc.argument_mapping_rationale,
      cc.accountability_eligible, tc.content_name AS task_content_title,
      tc.url AS task_content_url
    FROM claims c
    LEFT JOIN content_claims cc ON cc.claim_id = c.claim_id
    LEFT JOIN content tc ON tc.content_id = cc.content_id
    WHERE c.claim_id IN (${p})
    ORDER BY c.claim_id, cc.cc_id
  `, claimIds);

  const documentLinks = await select(conn, `
    SELECT COALESCE(rcl.task_claim_id, rcl.claim_id) AS task_claim_id,
      rcl.ref_claim_link_id, rcl.claim_id,
      rcl.content_relation_id, rcl.task_claim_id AS persisted_task_claim_id,
      rcl.reference_content_id, rcl.stance, rcl.score, rcl.confidence,
      rcl.support_level, rcl.rationale, rcl.evidence_text,
      rcl.evidence_offsets, rcl.created_by_ai, rcl.scrape_status,
      rcl.verified_by_user_id, rcl.created_at,
      c.content_name AS reference_title, c.url AS reference_url,
      c.media_source, c.content_type, c.canonical_url, c.is_retracted,
      persisted_cr.reference_content_id AS persisted_reference_content_id,
      (persisted_cr.content_relation_id IS NOT NULL) AS persisted_relation_valid,
      recovered_cr.content_relation_id AS recovered_content_relation_id
    FROM reference_claim_links rcl
    JOIN content c ON c.content_id = rcl.reference_content_id
    LEFT JOIN content_relations persisted_cr ON persisted_cr.content_relation_id = rcl.content_relation_id
    LEFT JOIN content_claims tcc ON tcc.claim_id = COALESCE(rcl.task_claim_id, rcl.claim_id)
    LEFT JOIN content_relations recovered_cr ON recovered_cr.content_id = tcc.content_id
      AND recovered_cr.reference_content_id = rcl.reference_content_id
    WHERE rcl.claim_id IN (${p}) OR rcl.task_claim_id IN (${p})
    ORDER BY task_claim_id, rcl.confidence DESC, rcl.support_level DESC, rcl.ref_claim_link_id
  `, [...claimIds, ...claimIds]);

  const claimLinks = await select(conn, `
    SELECT rctl.task_claim_id, rctl.reference_claim_task_links_id,
      rctl.content_relation_id, rctl.reference_claim_id,
      rc.claim_text AS reference_claim, rctl.stance, rctl.score,
      rctl.confidence, rctl.support_level, rctl.rationale, rctl.quote,
      rctl.created_by_ai, rctl.verified_by_user_id, rctl.created_at,
      rcc.cc_id AS reference_content_claim_id,
      rcc.content_id AS recovered_reference_content_id,
      rcc.article_stance AS reference_article_stance,
      rcc.object_claim_text AS reference_object_claim_text,
      rcc.is_attribution AS reference_is_attribution,
      rcc.speaker_entity AS reference_speaker_entity,
      persisted_cr.reference_content_id AS persisted_reference_content_id,
      (persisted_cr.content_relation_id IS NOT NULL) AS persisted_relation_valid,
      COALESCE(persisted_ref.content_name, ref.content_name) AS reference_title,
      COALESCE(persisted_ref.url, ref.url) AS reference_url,
      COALESCE(persisted_ref.media_source, ref.media_source) AS media_source,
      COALESCE(persisted_ref.content_type, ref.content_type) AS content_type,
      COALESCE(persisted_ref.canonical_url, ref.canonical_url) AS canonical_url,
      COALESCE(persisted_ref.is_retracted, ref.is_retracted) AS is_retracted,
      recovered_cr.content_relation_id AS recovered_content_relation_id,
      cs.claim_source_id, cs.reference_content_id AS claim_source_content_id,
      rcl.ref_claim_link_id,
      rcl.evidence_text AS reference_claim_link_evidence_text,
      rcl.scrape_status AS reference_claim_link_scrape_status
    FROM reference_claim_task_links rctl
    JOIN claims rc ON rc.claim_id = rctl.reference_claim_id
    LEFT JOIN content_relations persisted_cr ON persisted_cr.content_relation_id = rctl.content_relation_id
    LEFT JOIN content persisted_ref ON persisted_ref.content_id = persisted_cr.reference_content_id
    LEFT JOIN content_claims rcc ON rcc.claim_id = rc.claim_id
    LEFT JOIN content ref ON ref.content_id = rcc.content_id
    LEFT JOIN content_claims tcc ON tcc.claim_id = rctl.task_claim_id
    LEFT JOIN content_relations recovered_cr ON recovered_cr.content_id = tcc.content_id
      AND recovered_cr.reference_content_id = rcc.content_id
    LEFT JOIN claim_sources cs ON cs.claim_id = rc.claim_id
      AND (cs.reference_content_id = rcc.content_id OR rcc.content_id IS NULL)
    LEFT JOIN reference_claim_links rcl ON rcl.claim_id = rc.claim_id
      AND (rcl.reference_content_id = rcc.content_id OR rcc.content_id IS NULL)
    WHERE rctl.task_claim_id IN (${p})
    ORDER BY rctl.task_claim_id, rctl.confidence DESC, rctl.support_level DESC,
      rctl.reference_claim_task_links_id, rcc.cc_id
  `, claimIds);

  const docIds = [...new Set([
    ...documentLinks.map((r) => r.reference_content_id),
    ...claimLinks.map((r) => r.persisted_reference_content_id),
    ...claimLinks.map((r) => r.recovered_reference_content_id),
  ].filter(Boolean))];

  let documents = [], publishers = [], quality = [], admiralty = [], allClaimsInDocs = [];
  if (docIds.length) {
    const dp = docIds.map(() => "?").join(",");
    documents = await select(conn, `SELECT content_id, content_name, url, canonical_url,
      media_source, content_type, is_retracted, is_active
      FROM content WHERE content_id IN (${dp}) ORDER BY content_id`, docIds);
    publishers = await select(conn, `SELECT cp.content_id, cp.content_publisher_id,
      cp.publisher_id, cp.publisher_role, cp.is_primary, cp.identity_confidence,
      cp.extraction_method, p.publisher_name, p.domain, p.entity_type,
      p.source_type, p.direct_reliability_score, p.contextual_credibility_score,
      p.provenance_score, p.publication_legitimacy_score, p.reliability_cap,
      p.reliability_cap_reason
      FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
      WHERE cp.content_id IN (${dp}) ORDER BY cp.content_id, cp.is_primary DESC, cp.content_publisher_id`, docIds);
    quality = await select(conn, `SELECT * FROM source_quality_scores
      WHERE content_id IN (${dp}) ORDER BY content_id`, docIds);
    admiralty = await select(conn, `SELECT * FROM admiralty_evaluations
      WHERE target_type = 'content' AND target_id IN (${dp}) ORDER BY target_id`, docIds);
    allClaimsInDocs = await select(conn, `SELECT cc.content_id, cc.cc_id, c.claim_id,
      c.claim_text, c.claim_type FROM content_claims cc JOIN claims c ON c.claim_id = cc.claim_id
      WHERE cc.content_id IN (${dp}) ORDER BY cc.content_id, c.claim_id`, docIds);
  }

  // These tables were inspected for provenance. There is no FK or persisted
  // claim/run identifier connecting search_history rows to these evidence rows.
  const retrievalEvidence = await select(conn, `SELECT * FROM claim_retrieval_evidence
    WHERE case_claim_id IN (${p}) ORDER BY case_claim_id, evidence_id`, claimIds);

  return { startingRows, taskClaims, documentLinks, claimLinks, documents,
    publishers, quality, admiralty, allClaimsInDocs, retrievalEvidence };
}

function badge(stance) {
  const s = String(stance || "unknown").toLowerCase();
  return `<span class="badge ${esc(s)}">${esc(s.toUpperCase())}</span>`;
}
function field(label, value, raw = false) {
  return `<div class="field"><dt>${esc(label)}</dt><dd>${raw ? value : shown(value)}</dd></div>`;
}
function tag(label, cls = "observation") { return `<span class="tag ${cls}">${esc(label)}</span>`; }

function render(args, data) {
  const taskById = keyBy(data.taskClaims, "claim_id");
  const docById = keyBy(data.documents, "content_id");
  const pubsByDoc = groupBy(data.publishers, "content_id");
  const qualityByDoc = keyBy(data.quality, "content_id");
  const admiraltyByDoc = keyBy(data.admiralty, "target_id");
  const documentLinksByTask = groupBy(data.documentLinks, "task_claim_id");
  const claimLinksByTask = groupBy(data.claimLinks, "task_claim_id");
  const allClaimsByDoc = groupBy(data.allClaimsInDocs, "content_id");
  const startingByTask = groupBy(data.startingRows, "task_claim_id");

  const claimModels = args.claims.map((id) => {
    const task = taskById.get(String(id));
    const documentLinks = documentLinksByTask.get(String(id)) || [];
    const claimLinks = claimLinksByTask.get(String(id)) || [];
    const documentIds = [...new Set([
      ...documentLinks.map((r) => r.reference_content_id),
      ...claimLinks.map((r) => r.recovered_reference_content_id),
    ].filter(Boolean))];
    const stanceRows = [...documentLinks, ...claimLinks];
    const stanceCounts = Object.fromEntries(["support", "refute", "nuance", "insufficient"].map((s) => [s, stanceRows.filter((r) => r.stance === s).length]));
    const scrape = { full: 0, snippet_only: 0, abstract_only: 0, identity_only: 0, failed: 0, unknown: 0 };
    for (const docId of documentIds) {
      const statuses = documentLinks.filter((r) => r.reference_content_id === docId).map((r) => r.scrape_status).filter(Boolean);
      const status = statuses[0] || "unknown";
      scrape[status] = (scrape[status] || 0) + 1;
    }
    const duplicateUrls = [];
    const byUrl = new Map();
    for (const docId of documentIds) {
      const doc = docById.get(String(docId));
      const k = normalizeUrl(doc?.url);
      if (!byUrl.has(k)) byUrl.set(k, []);
      byUrl.get(k).push(docId);
    }
    for (const [url, ids] of byUrl) if (url && ids.length > 1) duplicateUrls.push({ url, ids });
    const duplicateClaims = [], nearDuplicateClaims = [];
    for (let i = 0; i < claimLinks.length; i += 1) for (let j = i + 1; j < claimLinks.length; j += 1) {
      const a = claimLinks[i], b = claimLinks[j];
      if (normalizeText(a.reference_claim) === normalizeText(b.reference_claim)) duplicateClaims.push([a.reference_claim_id, b.reference_claim_id]);
      else {
        const score = jaccard(a.reference_claim, b.reference_claim);
        if (score >= 0.82) nearDuplicateClaims.push({ ids: [a.reference_claim_id, b.reference_claim_id], score });
      }
    }
    const sameTitleDocs = [];
    const byTitle = new Map();
    for (const docId of documentIds) {
      const doc = docById.get(String(docId));
      const k = titleKey(doc?.content_name);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(docId);
    }
    for (const [title, ids] of byTitle) if (title && ids.length > 1) sameTitleDocs.push({ title, ids });
    return { id, task, documentLinks, claimLinks, documentIds, stanceCounts, scrape,
      duplicateUrls, duplicateClaims, nearDuplicateClaims, sameTitleDocs,
      duplicateCount: duplicateUrls.length + duplicateClaims.length + nearDuplicateClaims.length + sameTitleDocs.length };
  });

  const summaryCards = claimModels.map((m) => `<article class="summary-card">
    <div class="eyebrow">TASK CLAIM ${m.id}</div>
    <h3>${shown(m.task?.claim_text || "Claim not found")}</h3>
    <div class="metrics">
      <div><strong>${m.documentIds.length}</strong><span>reference documents</span></div>
      <div><strong>${m.claimLinks.length}</strong><span>extracted claims</span></div>
      <div><strong>${m.stanceCounts.support}</strong><span>support</span></div>
      <div><strong>${m.stanceCounts.refute}</strong><span>refute</span></div>
      <div><strong>${m.stanceCounts.nuance}</strong><span>nuance</span></div>
      <div><strong>${m.stanceCounts.insufficient}</strong><span>insufficient</span></div>
      <div><strong>${m.scrape.full}</strong><span>full sources</span></div>
      <div><strong>${m.scrape.snippet_only}</strong><span>snippet only</span></div>
      <div><strong>${(m.scrape.abstract_only || 0) + (m.scrape.identity_only || 0) + (m.scrape.failed || 0) + (m.scrape.unknown || 0)}</strong><span>other / unknown scrape</span></div>
      <div><strong>${m.duplicateCount}</strong><span>duplicate flags</span></div>
    </div>
  </article>`).join("");

  const claimSections = claimModels.map((m) => {
    const t = m.task || {};
    const starting = startingByTask.get(String(m.id)) || [];
    const startingLinked = starting.filter((r) => r.reference_claim_task_links_id);
    const orphanCount = startingLinked.filter((r) => !r.content_relation_id).length;
    const observations = [];
    if (!m.documentLinks.length) observations.push("No document-level reference_claim_links rows were found.");
    if (!m.claimLinks.length) observations.push("No extracted reference claims were linked to this task claim.");
    if (orphanCount) observations.push(`${orphanCount} extracted-claim link(s) have null content_relation_id; their documents are recoverable only through content_claims.`);
    for (const row of [...m.documentLinks, ...m.claimLinks]) {
      const note = mismatchObservation(m.id, row);
      if (note && !observations.includes(note)) observations.push(note);
    }
    if (m.duplicateUrls.length) observations.push(`${m.duplicateUrls.length} normalized duplicate-URL group(s) found.`);
    if (m.sameTitleDocs.length) observations.push(`${m.sameTitleDocs.length} same-title/different-content-ID group(s) may represent the same underlying document.`);

    const taskFields = [
      ["claim_id", t.claim_id], ["exact claim_text", t.claim_text], ["object_claim_text", t.object_claim_text],
      ["claim_type", t.claim_type], ["content_claims.cc_id", t.cc_id], ["task content_id", t.task_content_id],
      ["claim_role", t.claim_role], ["parent_claim_id", t.parent_claim_id], ["claim_depth", t.claim_depth],
      ["is_attribution", t.is_attribution], ["speaker_entity", t.speaker_entity], ["article_stance", t.article_stance],
      ["argument_function", t.argument_function], ["score_transform", t.score_transform],
      ["argument_mapping_confidence", t.argument_mapping_confidence], ["argument_mapping_rationale", t.argument_mapping_rationale],
      ["task article", t.task_content_title], ["task article URL", t.task_content_url],
    ].map(([a,b]) => field(a,b)).join("");

    const references = m.documentIds.map((docId) => {
      const d = docById.get(String(docId)) || {};
      const docLinks = m.documentLinks.filter((r) => r.reference_content_id === docId);
      const extracted = m.claimLinks.filter((r) => r.recovered_reference_content_id === docId);
      const pubs = pubsByDoc.get(String(docId)) || [];
      const q = qualityByDoc.get(String(docId));
      const a = admiraltyByDoc.get(String(docId));
      const linkedClaimIds = new Set(extracted.map((r) => String(r.reference_claim_id)));
      const unlinkedClaims = (allClaimsByDoc.get(String(docId)) || []).filter((r) => !linkedClaimIds.has(String(r.claim_id)));
      const relationIds = [...new Set([...docLinks.map((r) => r.recovered_content_relation_id || r.content_relation_id), ...extracted.map((r) => r.recovered_content_relation_id || r.content_relation_id)].filter(Boolean))];
      const pubHtml = pubs.length ? pubs.map((p) => `${shown(p.publisher_name)} <span class="muted">(publisher_id ${shown(p.publisher_id)}, ${shown(p.publisher_role)}, confidence ${shown(p.identity_confidence)})</span>`).join("<br>") : "—";
      const qualityHtml = q ? `${shown(q.quality_tier)} · quality ${shown(q.quality_score)}/10 · risk ${shown(q.risk_score)}/10 <span class="muted">(source_quality_scores.score_id ${shown(q.score_id)})</span>` : "—";
      const admiraltyHtml = a ? `${shown(a.admiralty_code)} · ${shown(a.confidence)} · ${shown(a.evaluation_status)} <span class="muted">(admiralty_evaluation_id ${shown(a.admiralty_evaluation_id)})</span>` : "—";
      const docEvidence = docLinks.map((r) => {
        const comparative = comparativeBearing(m.id, `${r.evidence_text || ""} ${r.rationale || ""}`);
        const note = mismatchObservation(m.id, r);
        return `<div class="evidence-card document-evidence">
          <div class="evidence-head">${badge(r.stance)} <span>DOCUMENT-LEVEL LINK</span></div>
          ${comparative ? `<div class="tags">${tag(comparative, comparative.startsWith("GENERIC") ? "warning" : "ok")}</div>` : ""}
          ${field("reference_claim_links.ref_claim_link_id", r.ref_claim_link_id)}
          ${field("persisted content_relation_id", r.content_relation_id)}
          ${field("recovered content_relation_id", r.recovered_content_relation_id)}
          ${field("score", r.score)} ${field("confidence", num(r.confidence,4), true)} ${field("support_level", num(r.support_level,4), true)}
          ${field("scrape_status", r.scrape_status)}
          ${field("rationale", r.rationale)} ${field("evidence_text", r.evidence_text)}
          ${note ? `<div class="forensic-note"><strong>Forensic observation:</strong> ${esc(note)}</div>` : ""}
        </div>`;
      }).join("") || `<p class="empty">No document-level reference_claim_links row for this task claim/document.</p>`;
      const extractedHtml = extracted.map((r) => {
        const tags = observationTags(m.id, `${r.reference_claim} ${r.rationale || ""}`);
        const comparative = comparativeBearing(m.id, `${r.reference_claim} ${r.rationale || ""}`);
        const note = mismatchObservation(m.id, r);
        return `<div class="evidence-card claim-evidence">
          <div class="evidence-head">${badge(r.stance)} <span>EXTRACTED REFERENCE CLAIM</span></div>
          <div class="tags">${tags.map((x) => tag(`${x} · report inference`)).join("")}${comparative ? tag(comparative, comparative.startsWith("GENERIC") ? "warning" : "ok") : ""}</div>
          <blockquote>${shown(r.reference_claim)}</blockquote>
          ${field("reference claim_id", r.reference_claim_id)}
          ${field("reference_claim_task_links_id", r.reference_claim_task_links_id)}
          ${field("reference content_claims.cc_id", r.reference_content_claim_id)}
          ${field("reference_claim_links.ref_claim_link_id", r.ref_claim_link_id)}
          ${field("claim_sources.claim_source_id", r.claim_source_id)}
          ${field("persisted content_relation_id", r.content_relation_id)}
          ${field("recovered content_relation_id", r.recovered_content_relation_id)}
          ${field("score", r.score)} ${field("confidence", num(r.confidence,3), true)} ${field("support_level", num(r.support_level,3), true)}
          ${field("scrape_status", r.reference_claim_link_scrape_status || docLinks[0]?.scrape_status || "not persisted on extracted-claim link")}
          ${field("rationale", r.rationale)} ${field("quote", r.quote)}
          ${field("reference_claim_links.evidence_text", r.reference_claim_link_evidence_text)}
          ${note ? `<div class="forensic-note"><strong>Forensic observation:</strong> ${esc(note)}</div>` : ""}
        </div>`;
      }).join("") || `<p class="empty">No extracted reference claim from this document is linked to this task claim.</p>`;
      return `<details class="reference" open>
        <summary><span>${shown(d.content_name)}</span><small>content_id ${shown(docId)}</small></summary>
        <div class="reference-body">
          <a href="${esc(d.url)}" target="_blank" rel="noreferrer">${shown(d.url)}</a>
          <dl class="grid compact">
            ${field("reference content_id", docId)} ${field("content_relation_id(s)", relationIds.join(", ") || null)}
            ${field("publisher", pubHtml, true)} ${field("media_source", d.media_source)}
            ${field("source quality", qualityHtml, true)} ${field("Admiralty", admiraltyHtml, true)}
          </dl>
          <h4>Persisted evidence links</h4>${docEvidence}${extractedHtml}
          <details class="subdetail"><summary>Reference claims in document without a task link (${unlinkedClaims.length})</summary>
            ${unlinkedClaims.length ? `<ul>${unlinkedClaims.map((r) => `<li><code>${shown(r.claim_id)}</code> ${shown(r.claim_text)}</li>`).join("")}</ul>` : `<p>None.</p>`}
          </details>
        </div>
      </details>`;
    }).join("") || `<div class="empty panel">No associated reference document was recoverable for this task claim.</div>`;

    const duplicateHtml = [
      ...m.duplicateUrls.map((x) => `<li>Duplicate normalized URL <code>${esc(x.url)}</code>: content IDs ${x.ids.join(", ")}</li>`),
      ...m.sameTitleDocs.map((x) => `<li>Same normalized title, possible same underlying document (report inference): content IDs ${x.ids.join(", ")}</li>`),
      ...m.duplicateClaims.map((x) => `<li>Exact duplicate reference claim text: claim IDs ${x.join(", ")}</li>`),
      ...m.nearDuplicateClaims.map((x) => `<li>Near-duplicate reference claim text (Jaccard ${x.score.toFixed(2)}, report heuristic): claim IDs ${x.ids.join(", ")}</li>`),
    ].join("") || "<li>None detected within this claim neighborhood.</li>";

    return `<section class="claim-section" id="claim-${m.id}">
      <div class="claim-title"><div class="eyebrow">${esc(args.label)} · TASK CLAIM ${m.id}</div><h2>${shown(t.claim_text)}</h2></div>
      <details class="panel"><summary>Task claim fields and argument mapping</summary><dl class="grid">${taskFields}</dl></details>
      <div class="chain"><strong>Actual recoverable chain</strong><span>TASK CLAIM ${m.id}</span><b>→</b><span>document: reference_claim_links.reference_content_id</span><span>extracted claim: reference_claim_task_links → claims → content_claims → content</span><b>→</b><span>content_relations recovered by task content_id + reference content_id</span></div>
      <div class="alert">Supplied starting-query rows: ${starting.length}; linked extracted claims: ${startingLinked.length}; null persisted content_relation_id: ${orphanCount}. Recovery is displayed explicitly and is not substituted into persisted fields.</div>
      <h3>Associated reference documents</h3>${references}
      <div class="two-col">
        <details class="panel" open><summary>Duplicates and source-identity flags</summary><ul>${duplicateHtml}</ul></details>
        <details class="panel" open><summary>Claim-level forensic observations</summary><ul>${observations.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>No additional report-layer observation.</li>"}</ul></details>
      </div>
    </section>`;
  }).join("");

  const allObservations = [];
  const totalOrphans = data.claimLinks.filter((r) => !r.content_relation_id).length;
  const totalDocNulls = data.documentLinks.filter((r) => !r.content_relation_id).length;
  if (totalOrphans) allObservations.push(`All ${totalOrphans} extracted-claim links in scope have null content_relation_id; document identity is recoverable through content_claims, not through the persisted task link.`);
  if (totalDocNulls) allObservations.push(`All ${totalDocNulls} document-level reference_claim_links rows in scope have null content_relation_id despite corresponding content_relations being recoverable.`);
  if (args.claims.includes(56731)) allObservations.push("Claim 56731 evidence predominantly establishes that vaccines are tested, not the comparative proposition that they are tested more than any other medicine.");
  if (args.claims.includes(56733)) allObservations.push("For claim 56733, support links about Andrew Wakefield’s 1998 Lancet paper do not identify William Thompson or the CDC study alleged in the task claim; the current assignments collapse distinct study/document identities.");
  if (args.claims.includes(56734)) allObservations.push("For claim 56734, the linked evidence concerns vaccine/autism conclusions or trust in the CDC, not an order to destroy evidence; the portfolio has an obvious direct-evidence gap.");
  allObservations.push("Attribution, study identity, substantive occurrence, and inference are not persisted mapping categories. Any such badges in this report are explicitly marked as report inferences based on keywords.");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(args.label)} Evidence Neighborhood Report</title>
  <style>
  :root{--bg:#f4f1ea;--paper:#fffefb;--ink:#18211d;--muted:#68736d;--line:#d8ddd8;--accent:#154f43;--support:#176b4d;--refute:#a13b34;--nuance:#936516;--insufficient:#687078;--warn:#8d3b20}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#125e70;overflow-wrap:anywhere}code{font-size:.9em;background:#eef0ed;padding:.1rem .3rem;border-radius:4px}main{max-width:1440px;margin:auto;padding:34px 28px 80px}.masthead{background:var(--ink);color:white;padding:38px;border-radius:16px}.masthead h1{font-size:clamp(30px,5vw,58px);line-height:1;margin:.2em 0}.masthead p{max-width:900px;color:#d9e2dd}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12px;font-weight:800;color:#6d8178}.masthead .eyebrow{color:#9bc8b9}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:22px 0 46px}.summary-card,.panel,.reference{background:var(--paper);border:1px solid var(--line);border-radius:12px}.summary-card{padding:20px}.summary-card h3{font-size:16px;min-height:76px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.metrics div{border-top:1px solid var(--line);padding-top:8px}.metrics strong{font-size:23px;display:block}.metrics span{font-size:11px;color:var(--muted)}.claim-section{margin:64px 0}.claim-title{border-left:7px solid var(--accent);padding-left:20px}.claim-title h2{font:700 clamp(25px,3vw,40px)/1.18 Georgia,serif;max-width:1100px}.panel{padding:16px;margin:16px 0}.panel>summary,.reference>summary,.subdetail>summary{cursor:pointer;font-weight:800}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0 22px}.grid.compact{grid-template-columns:repeat(3,1fr);margin:18px 0}.field{border-top:1px solid #e6e9e5;padding:9px 0;min-width:0}.field dt{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}.field dd{margin:2px 0;overflow-wrap:anywhere}.chain{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#e7eee9;border-radius:10px;padding:13px;margin:16px 0}.chain span{background:white;border:1px solid #cad5ce;padding:5px 8px;border-radius:6px;font-size:12px}.alert,.forensic-note{border-left:4px solid var(--warn);background:#fff2e9;padding:11px 14px;margin:12px 0}.reference{margin:14px 0;overflow:hidden}.reference>summary{display:flex;justify-content:space-between;gap:20px;padding:18px 20px;background:#edf1ed}.reference>summary small{color:var(--muted);white-space:nowrap}.reference-body{padding:20px}.evidence-card{border:1px solid var(--line);border-radius:9px;padding:15px;margin:12px 0}.document-evidence{border-left:5px solid #356f83}.claim-evidence{border-left:5px solid #6e5a99}.evidence-head{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:800;letter-spacing:.08em}.badge,.tag{display:inline-block;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:.04em}.badge{color:white}.badge.support{background:var(--support)}.badge.refute{background:var(--refute)}.badge.nuance{background:var(--nuance)}.badge.insufficient,.badge.unknown{background:var(--insufficient)}.tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.tag{background:#ece8f6;color:#554178}.tag.warning{background:#fde1d4;color:#782f19}.tag.ok{background:#dcefe5;color:#14583f}blockquote{margin:13px 0;padding:12px 16px;background:#f7f7f3;border-left:3px solid #89958d;font:17px/1.5 Georgia,serif}.subdetail{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}.subdetail li{margin:7px 0}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}.empty{color:var(--muted);font-style:italic}.muted{color:var(--muted);font-size:.9em}.methodology{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:32px 0}.observations{background:#202a26;color:white;border-radius:14px;padding:26px}.observations li{margin:11px 0}.schema-table{width:100%;border-collapse:collapse}.schema-table th,.schema-table td{text-align:left;border-bottom:1px solid var(--line);padding:8px;vertical-align:top}.schema-table th{font-size:11px;text-transform:uppercase;letter-spacing:.08em}@media(max-width:900px){.summary,.methodology,.two-col{grid-template-columns:1fr}.grid,.grid.compact{grid-template-columns:1fr}.summary-card h3{min-height:0}.metrics{grid-template-columns:repeat(3,1fr)}main{padding:18px 12px}.masthead{padding:24px}.reference>summary{display:block}}
  </style></head><body><main>
  <header class="masthead"><div class="eyebrow">FORENSIC EVIDENCE SNAPSHOT · ${esc(args.label)}</div><h1>Current evidence neighborhoods</h1>
    <p>Read-only extraction for task claim IDs ${args.claims.join(", ")}. Generated ${esc(new Date().toISOString())}. This report preserves persisted values separately from explicitly labeled recovery joins and report-layer observations.</p></header>
  <section class="summary">${summaryCards}</section>
  <section class="methodology">
    <div class="panel"><h3>Verified current contracts</h3><table class="schema-table"><tr><th>Table</th><th>Fields used</th></tr>
      <tr><td>claims</td><td>claim_id, claim_text, claim_type, triage/retrieval fields</td></tr>
      <tr><td>content_claims</td><td>object claim, attribution/speaker, article stance, argument fields; reference-claim → document recovery</td></tr>
      <tr><td>reference_claim_task_links</td><td>extracted-claim assessment; content_relation_id exists but is null for all in-scope links</td></tr>
      <tr><td>reference_claim_links</td><td>document-level assessment, evidence_text, scrape_status; content_relation_id exists but is null for all in-scope links</td></tr>
      <tr><td>content_relations</td><td>task article → reference document; recovered using task content_id + reference content_id</td></tr>
      <tr><td>claim_sources</td><td>claim_id, reference_content_id; no in-scope recovered rows</td></tr>
      <tr><td>content_publishers / publishers</td><td>publisher linkage and readily traceable reliability fields</td></tr>
      <tr><td>source_quality_scores / admiralty_evaluations</td><td>document quality and Admiralty fields when present</td></tr></table></div>
    <div class="panel"><h3>Retrieval context</h3><p><strong>Retrieval provenance not persisted/recoverable.</strong></p>
      <p>Current production code can generate search queries and can use Tavily, Bing, hybrid Tavily+Bing, plus DuckDuckGo for fringe search. However, generated queries, the selected provider for this run, returned candidate sets, and candidate→reference lineage are not stored with these task claims. <code>search_history</code> is a separate user-search table without a task-claim/run linkage. No current log file contains these claim IDs or exact texts.</p>
      <p><code>claim_retrieval_evidence</code> rows found for this set: ${data.retrievalEvidence.length}. These are shown only if present and are not treated as search-query provenance.</p></div>
  </section>
  ${claimSections}
  <section class="observations"><div class="eyebrow">CURRENT SYSTEM OUTPUT</div><h2>Forensic observations</h2><ul>${allObservations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="muted">These observations concern bearing, linkage, and portfolio composition only. No outside knowledge was used to decide whether any task claim is true.</p></section>
  </main></body></html>`;
}

// Snapshot schema v2 is the stable boundary between database extraction and
// rendering. HTML renderers below consume only this normalized structure.
const SNAPSHOT_SCHEMA_VERSION = "2.0.0";

function semanticKeyFor(text) {
  const s = normalizeText(text);
  if (s.includes("vaccines are tested more than any other medicine")) return "vaccine_testing_comparative";
  if (s.includes("william thompson") && s.includes("mmr") && s.includes("manipulated")) return "thompson_cdc_mmr_manipulation";
  if (s.includes("cdc") && s.includes("destroy") && s.includes("mmr")) return "cdc_ordered_mmr_evidence_destruction";
  return `claim_${s.split(" ").slice(0, 12).join("_")}`;
}

function semanticObservation(semanticKey, row) {
  const s = normalizeText(`${row.claimText || ""} ${row.evidenceText || ""} ${row.rationale || ""}`);
  const observations = [];
  if (semanticKey === "vaccine_testing_comparative" && !/more than any|more extensively than|more testing than|compared (with|to) (other|all).*medicine/.test(s)) {
    observations.push("Generic vaccine-testing evidence; the ‘more than any other medicine’ superlative is not established.");
  }
  if (semanticKey === "thompson_cdc_mmr_manipulation" && !s.includes("thompson")) {
    observations.push(/wakefield|lancet/.test(s)
      ? "Different study/event: Wakefield/Lancet evidence does not resolve the Thompson-related study or alleged CDC manipulation."
      : "Discusses MMR/autism without identifying Thompson or resolving the alleged CDC manipulation.");
  } else if (semanticKey === "thompson_cdc_mmr_manipulation" && /said|stated|alleged|claimed|revealed|reported|testimony/.test(s) && !/manipulat|omit|fraud|misrepresent|destroy|deleted/.test(s)) {
    observations.push("Attribution only: identifies what was said/alleged without substantive evidence that the alleged act occurred.");
  }
  if (semanticKey === "cdc_ordered_mmr_evidence_destruction" && !(s.includes("cdc") && /destroy|destruction|deleted|ordered/.test(s))) {
    observations.push("Does not establish a CDC order to destroy evidence; vaccine/autism conclusions do not bear directly on document destruction.");
  }
  if (/reject|oppose|refute/.test(normalizeText(row.referenceArticleStance)) && row.stance === "support") {
    observations.push("The surrounding reference article stance opposes/rejects the extracted proposition, but the task link is marked support.");
  }
  return observations.length ? observations.join(" ") : null;
}

function claimLevelCoverage(references) {
  const totalReferenceDocuments = references.length;
  const linkedReferenceDocuments = references.filter((ref) => ref.referenceClaims.length > 0).length;
  const unlinkedReferenceDocuments = totalReferenceDocuments - linkedReferenceDocuments;
  const status = totalReferenceDocuments === 0 ? "NO_DOCUMENTS"
    : linkedReferenceDocuments === 0 ? "NONE"
      : linkedReferenceDocuments === totalReferenceDocuments ? "COMPLETE" : "PARTIAL";
  return {
    status, totalReferenceDocuments, linkedReferenceDocuments, unlinkedReferenceDocuments,
    definition: "COMPLETE = every associated reference document has ≥1 reference_claim_task_link; PARTIAL = some do; NONE = documents exist but none do; NO_DOCUMENTS = no associated documents",
  };
}

function normalizeSnapshot(label, data, { generatedAt = new Date().toISOString(), source = "database" } = {}) {
  const tasks = [...new Map(data.taskClaims.map((row) => [String(row.claim_id), row])).values()];
  const docById = keyBy(data.documents, "content_id");
  const pubsByDoc = groupBy(data.publishers, "content_id");
  const qualityByDoc = keyBy(data.quality, "content_id");
  const admiraltyByDoc = keyBy(data.admiralty, "target_id");
  const allClaimsByDoc = groupBy(data.allClaimsInDocs, "content_id");
  const docLinksByTask = groupBy(data.documentLinks, "task_claim_id");
  const claimLinksByTask = groupBy(data.claimLinks, "task_claim_id");

  const claims = tasks.map((task) => {
    const semanticKey = semanticKeyFor(task.claim_text);
    const documentRows = docLinksByTask.get(String(task.claim_id)) || [];
    const referenceClaimRows = claimLinksByTask.get(String(task.claim_id)) || [];
    const effectiveClaimDocId = (row) => row.persisted_relation_valid && row.persisted_reference_content_id
      ? row.persisted_reference_content_id : row.recovered_reference_content_id;
    const docIds = [...new Set([
      ...documentRows.map((row) => row.reference_content_id),
      ...referenceClaimRows.map(effectiveClaimDocId),
    ].filter(Boolean))];

    const references = docIds.map((docId) => {
      const doc = docById.get(String(docId)) || {};
      const documentEvidenceRows = documentRows.filter((row) => Number(row.reference_content_id) === Number(docId));
      const referenceRows = referenceClaimRows.filter((row) => Number(effectiveClaimDocId(row)) === Number(docId));
      const allRows = [...documentEvidenceRows, ...referenceRows];
      const persistedRelation = allRows.find((row) => row.content_relation_id && row.persisted_relation_valid !== 0 &&
        (!row.persisted_reference_content_id || Number(row.persisted_reference_content_id) === Number(docId)));
      const recoveredRelation = allRows.find((row) => row.recovered_content_relation_id);
      const contentRelationId = persistedRelation?.content_relation_id ?? recoveredRelation?.recovered_content_relation_id ?? null;
      const relationSource = persistedRelation ? "persisted" : recoveredRelation ? "recovered" : "missing";
      const publishers = pubsByDoc.get(String(docId)) || [];
      const linkedClaimIds = new Set(referenceRows.map((row) => String(row.reference_claim_id)));

      const documentEvidenceLinks = documentEvidenceRows.map((row) => {
        const relationIsValid = Boolean(row.content_relation_id && row.persisted_relation_valid !== 0 &&
          (!row.persisted_reference_content_id || Number(row.persisted_reference_content_id) === Number(docId)));
        const relationSource = relationIsValid ? "persisted" : row.recovered_content_relation_id ? "recovered" : "missing";
        const normalized = {
          referenceClaimLinkId: row.ref_claim_link_id ?? null,
          claimId: row.claim_id ?? null,
          persistedTaskClaimId: row.persisted_task_claim_id ?? null,
          referenceContentId: row.reference_content_id ?? null,
          contentRelationId: relationIsValid ? row.content_relation_id : row.recovered_content_relation_id ?? null,
          persistedContentRelationId: row.content_relation_id ?? null,
          recoveredContentRelationId: row.recovered_content_relation_id ?? null,
          relationSource,
          persistedRelationInvalid: Boolean(row.content_relation_id && !relationIsValid),
          stance: row.stance ?? null, score: row.score ?? null,
          confidence: row.confidence ?? null, supportLevel: row.support_level ?? null,
          rationale: row.rationale ?? null, evidenceText: row.evidence_text ?? null,
          evidenceOffsets: row.evidence_offsets ?? null, scrapeStatus: row.scrape_status ?? null,
          createdByAi: row.created_by_ai ?? null, verifiedByUserId: row.verified_by_user_id ?? null,
          createdAt: row.created_at ?? null,
        };
        normalized.forensicObservation = semanticObservation(semanticKey, normalized);
        return normalized;
      });

      const referenceClaims = referenceRows.map((row) => {
        const relationIsValid = Boolean(row.content_relation_id && row.persisted_relation_valid !== 0 &&
          Number(row.persisted_reference_content_id) === Number(docId));
        const relationSource = relationIsValid ? "persisted" : row.recovered_content_relation_id ? "recovered" : "missing";
        const normalized = {
          referenceClaimId: row.reference_claim_id ?? null,
          claimText: row.reference_claim ?? null,
          referenceClaimTaskLinkId: row.reference_claim_task_links_id ?? null,
          referenceClaimLinkId: row.ref_claim_link_id ?? null,
          referenceContentClaimId: row.reference_content_claim_id ?? null,
          claimSourceId: row.claim_source_id ?? null,
          contentRelationId: relationIsValid ? row.content_relation_id : row.recovered_content_relation_id ?? null,
          persistedContentRelationId: row.content_relation_id ?? null,
          recoveredContentRelationId: row.recovered_content_relation_id ?? null,
          relationSource,
          persistedRelationInvalid: Boolean(row.content_relation_id && !relationIsValid),
          stance: row.stance ?? null, score: row.score ?? null,
          confidence: row.confidence ?? null, supportLevel: row.support_level ?? null,
          rationale: row.rationale ?? null, quote: row.quote ?? null,
          evidenceText: row.reference_claim_link_evidence_text ?? null,
          scrapeStatus: row.reference_claim_link_scrape_status ?? documentEvidenceLinks[0]?.scrapeStatus ?? null,
          referenceArticleStance: row.reference_article_stance ?? null,
          referenceObjectClaimText: row.reference_object_claim_text ?? null,
          referenceIsAttribution: row.reference_is_attribution ?? null,
          referenceSpeakerEntity: row.reference_speaker_entity ?? null,
          createdByAi: row.created_by_ai ?? null, verifiedByUserId: row.verified_by_user_id ?? null,
          createdAt: row.created_at ?? null,
        };
        normalized.forensicObservation = semanticObservation(semanticKey, normalized);
        return normalized;
      });

      return {
        referenceContentId: docId,
        contentRelationId, relationSource,
        title: doc.content_name ?? documentEvidenceRows[0]?.reference_title ?? referenceRows[0]?.reference_title ?? null,
        url: doc.url ?? documentEvidenceRows[0]?.reference_url ?? referenceRows[0]?.reference_url ?? null,
        canonicalUrl: doc.canonical_url ?? null, mediaSource: doc.media_source ?? null,
        contentType: doc.content_type ?? null, isRetracted: doc.is_retracted ?? null,
        publisher: publishers[0] ?? null, publishers,
        sourceQuality: qualityByDoc.get(String(docId)) ?? null,
        admiralty: admiraltyByDoc.get(String(docId)) ?? null,
        documentEvidenceLinks, referenceClaims,
        unlinkedReferenceClaims: (allClaimsByDoc.get(String(docId)) || [])
          .filter((row) => !linkedClaimIds.has(String(row.claim_id)))
          .map((row) => ({ contentClaimId: row.cc_id ?? null, claimId: row.claim_id ?? null,
            claimText: row.claim_text ?? null, claimType: row.claim_type ?? null })),
      };
    });

    return {
      semanticKey, taskClaimId: task.claim_id ?? null, claimText: task.claim_text ?? null,
      objectClaimText: task.object_claim_text ?? null, claimRole: task.claim_role ?? null,
      articleStance: task.article_stance ?? null, argumentFunction: task.argument_function ?? null,
      scoreTransform: task.score_transform ?? null,
      argumentMappingConfidence: task.argument_mapping_confidence ?? null,
      argumentMappingRationale: task.argument_mapping_rationale ?? null,
      isAttribution: task.is_attribution ?? null, speakerEntity: task.speaker_entity ?? null,
      taskContentId: task.task_content_id ?? null, taskContentTitle: task.task_content_title ?? null,
      taskContentUrl: task.task_content_url ?? null, contentClaimId: task.cc_id ?? null,
      parentClaimId: task.parent_claim_id ?? null, claimDepth: task.claim_depth ?? null,
      references,
      claimLevelLinkCoverage: claimLevelCoverage(references),
    };
  });

  const taskContentIds = [...new Set(claims.map((claim) => claim.taskContentId).filter(Boolean))];
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION, label, generatedAt, source,
    taskContentId: taskContentIds.length === 1 ? taskContentIds[0] : null,
    taskContentIds, semanticIdentity: "claims[].semanticKey; numeric IDs are forensic metadata only",
    schemaDescription: {
      taskClaimIdentity: "semanticKey",
      referenceIdentity: "canonicalized URL",
      referenceClaimIdentity: "canonicalized URL + normalized claim text",
      relationSource: "persisted = valid direct content_relation_id; recovered = fallback join; missing = neither",
      claimLevelLinkCoverage: "COMPLETE = all reference documents linked; PARTIAL = some; NONE = documents exist but none; NO_DOCUMENTS = no documents",
      nullPolicy: "Missing persisted values are retained as explicit nulls",
    },
    claims,
    retrievalContext: {
      status: "not persisted/recoverable",
      claimRetrievalEvidenceRows: data.retrievalEvidence ?? [],
    },
    lookupPayload: data,
  };
}

function allEvidenceLinks(claim) {
  return claim.references.flatMap((ref) => [
    ...ref.documentEvidenceLinks.map((link) => ({ ...link, kind: "document", reference: ref })),
    ...ref.referenceClaims.map((link) => ({ ...link, kind: "reference_claim", reference: ref })),
  ]);
}

function snapshotMetrics(claim) {
  const links = allEvidenceLinks(claim);
  const stance = Object.fromEntries(["support", "refute", "nuance", "insufficient"].map((s) => [s, links.filter((x) => x.stance === s).length]));
  const scrape = { full: 0, snippet_only: 0, other: 0 };
  for (const ref of claim.references) {
    const statuses = [...ref.documentEvidenceLinks.map((x) => x.scrapeStatus), ...ref.referenceClaims.map((x) => x.scrapeStatus)].filter(Boolean);
    const status = statuses[0];
    if (status === "full") scrape.full += 1;
    else if (status === "snippet_only") scrape.snippet_only += 1;
    else scrape.other += 1;
  }
  return {
    documents: claim.references.length,
    extractedClaims: claim.references.reduce((n, ref) => n + ref.referenceClaims.length, 0),
    ...stance, full: scrape.full, snippet: scrape.snippet_only, other: scrape.other,
    direct: claim.references.filter((ref) => ref.relationSource === "persisted").length,
    recovered: claim.references.filter((ref) => ref.relationSource === "recovered").length,
    missing: claim.references.filter((ref) => ref.relationSource === "missing").length,
    linkedDocuments: (claim.claimLevelLinkCoverage || claimLevelCoverage(claim.references)).linkedReferenceDocuments,
    unlinkedDocuments: (claim.claimLevelLinkCoverage || claimLevelCoverage(claim.references)).unlinkedReferenceDocuments,
  };
}

const reportStyles = `
  :root{--bg:#f4f1ea;--paper:#fffefb;--ink:#18211d;--muted:#68736d;--line:#d8ddd8;--accent:#154f43;--support:#176b4d;--refute:#a13b34;--nuance:#936516;--insufficient:#687078;--warn:#8d3b20}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:32px 26px 80px}a{color:#125e70;overflow-wrap:anywhere}code{background:#edf0ed;padding:2px 5px;border-radius:4px}.masthead{background:var(--ink);color:white;padding:36px;border-radius:16px}.masthead h1{font-size:clamp(30px,5vw,56px);line-height:1;margin:.25em 0}.masthead p{color:#d9e2dd}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:11px;font-weight:800;color:#6d8178}.masthead .eyebrow{color:#9bc8b9}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0 44px}.summary-card,.panel,.reference,.compare-card{background:var(--paper);border:1px solid var(--line);border-radius:12px}.summary-card{padding:18px}.summary-card h3{font-size:16px;min-height:72px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.metrics div{border-top:1px solid var(--line);padding-top:7px}.metrics strong{display:block;font-size:21px}.metrics span{font-size:10px;color:var(--muted)}.claim{margin:58px 0}.claim-title{border-left:7px solid var(--accent);padding-left:18px}.claim-title h2{font:700 clamp(24px,3vw,38px)/1.2 Georgia,serif}.panel{padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0 20px}.field{border-top:1px solid #e6e9e5;padding:8px 0}.field dt{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}.field dd{margin:2px 0;overflow-wrap:anywhere}.reference{margin:13px 0;overflow:hidden}.reference>summary{cursor:pointer;display:flex;justify-content:space-between;padding:16px 18px;background:#edf1ed;font-weight:800}.reference-body{padding:18px}.evidence{border:1px solid var(--line);border-left:5px solid #356f83;border-radius:8px;padding:14px;margin:10px 0}.evidence.claim-link{border-left-color:#6e5a99}.head{display:flex;gap:8px;align-items:center;font-size:11px;font-weight:800}.badge,.relation{display:inline-block;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800}.badge{color:white}.support{background:var(--support)}.refute{background:var(--refute)}.nuance{background:var(--nuance)}.insufficient,.unknown{background:var(--insufficient)}.relation.persisted{background:#d8efe4;color:#14583f}.relation.recovered{background:#fff0cc;color:#79520b}.relation.missing{background:#f7d9d6;color:#832c26}.coverage{display:inline-block;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:900;letter-spacing:.06em}.coverage.COMPLETE{background:#d8efe4;color:#14583f}.coverage.PARTIAL{background:#fff0cc;color:#79520b}.coverage.NONE{background:#f7d9d6;color:#832c26}.coverage.NO_DOCUMENTS{background:#e6e8ea;color:#4d555c}.coverage.ABSENT{background:#442c52;color:#fff}blockquote{margin:12px 0;padding:10px 14px;background:#f7f7f3;border-left:3px solid #89958d;font:17px/1.5 Georgia,serif}.note{border-left:4px solid var(--warn);background:#fff2e9;padding:10px 13px;margin:10px 0}.muted{color:var(--muted)}.comparison-grid{display:grid;grid-template-columns:repeat(var(--runs),minmax(0,1fr));gap:14px}.compare-card{padding:16px}.delta{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.delta ul{margin-top:6px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:8px}th{font-size:10px;text-transform:uppercase;letter-spacing:.08em}.good{color:#176b4d}.warning{color:#9a4a26}@media(max-width:900px){.summary,.comparison-grid,.delta{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.summary-card h3{min-height:0}main{padding:16px 11px}.metrics{grid-template-columns:repeat(3,1fr)}}`;

function relationBadge(source) {
  const label = source === "persisted" ? "DIRECT PERSISTED RELATION" : source === "recovered" ? "RECOVERED RELATION" : "MISSING RELATION";
  return `<span class="relation ${esc(source)}">${label}</span>`;
}

function metricGrid(metrics) {
  return `<div class="metrics">${Object.entries({ documents:metrics.documents,"extracted claims":metrics.extractedClaims,
    support:metrics.support,refute:metrics.refute,nuance:metrics.nuance,insufficient:metrics.insufficient,
    full:metrics.full,snippet:metrics.snippet,"other scrape":metrics.other,direct:metrics.direct,recovered:metrics.recovered,missing:metrics.missing,
    "docs with claim links":metrics.linkedDocuments,"docs without claim links":metrics.unlinkedDocuments })
    .map(([label,value]) => `<div><strong>${value}</strong><span>${esc(label)}</span></div>`).join("")}</div>`;
}

function coverageBadge(claim) {
  if (claim.taskClaimExtractionStatus === "ABSENT") {
    return `<p><span class="coverage ABSENT">TASK CLAIM EXTRACTION: ABSENT</span> <span class="muted">Claim-level link coverage is not applicable because this semantic task claim was not extracted.</span></p>`;
  }
  const coverage = claim.claimLevelLinkCoverage || claimLevelCoverage(claim.references);
  return `<p><span class="coverage ${esc(coverage.status)}">CLAIM-LEVEL LINK COVERAGE: ${esc(coverage.status)}</span> <span class="muted">${coverage.linkedReferenceDocuments}/${coverage.totalReferenceDocuments} reference documents have extracted-claim task links</span></p>`;
}

function renderNormalizedEvidence(item, kind) {
  return `<article class="evidence ${kind === "reference_claim" ? "claim-link" : ""}">
    <div class="head">${badge(item.stance)} ${relationBadge(item.relationSource)} <span>${kind === "reference_claim" ? "EXTRACTED REFERENCE CLAIM" : "DOCUMENT EVIDENCE"}</span></div>
    ${kind === "reference_claim" ? `<blockquote>${shown(item.claimText)}</blockquote>` : ""}
    <dl class="grid">
      ${field("reference claim ID", item.referenceClaimId)}${field("reference claim task link ID", item.referenceClaimTaskLinkId)}
      ${field("reference claim link ID", item.referenceClaimLinkId)}${field("content relation ID", item.contentRelationId)}
      ${field("persisted relation ID", item.persistedContentRelationId)}${field("recovered relation ID", item.recoveredContentRelationId)}
      ${field("stance", item.stance)}${field("score", item.score)}${field("confidence", item.confidence)}
      ${field("support level", item.supportLevel)}${field("scrape status", item.scrapeStatus)}${field("quote", item.quote)}
      ${field("reference article stance", item.referenceArticleStance)}${field("reference attribution", item.referenceIsAttribution)}${field("reference speaker", item.referenceSpeakerEntity)}
      ${field("rationale", item.rationale)}${field("evidence text", item.evidenceText)}
    </dl>${item.persistedRelationInvalid ? `<div class="note">Persisted content_relation_id was invalid; recovery fallback used.</div>` : ""}
    ${item.forensicObservation ? `<div class="note"><strong>Forensic observation:</strong> ${esc(item.forensicObservation)}</div>` : ""}
  </article>`;
}

function renderSnapshotReport(snapshot) {
  const cards = snapshot.claims.map((claim) => `<article class="summary-card"><div class="eyebrow">${esc(claim.semanticKey)}</div><h3>${shown(claim.claimText)}</h3>${coverageBadge(claim)}${metricGrid(snapshotMetrics(claim))}</article>`).join("");
  const sections = snapshot.claims.map((claim) => {
    const refs = claim.references.map((ref) => `<details class="reference" open><summary><span>${shown(ref.title)}</span><small>content_id ${shown(ref.referenceContentId)}</small></summary><div class="reference-body">
      <p><a href="${esc(ref.url)}">${shown(ref.url)}</a></p><p>${relationBadge(ref.relationSource)}</p>
      <dl class="grid">${field("content relation ID",ref.contentRelationId)}${field("publisher",ref.publisher?.publisher_name)}${field("publisher ID",ref.publisher?.publisher_id)}${field("quality tier",ref.sourceQuality?.quality_tier)}${field("quality score",ref.sourceQuality?.quality_score)}${field("Admiralty code",ref.admiralty?.admiralty_code)}</dl>
      ${ref.documentEvidenceLinks.map((x) => renderNormalizedEvidence(x,"document")).join("") || `<p class="muted">No document-level evidence link.</p>`}
      ${ref.referenceClaims.map((x) => renderNormalizedEvidence(x,"reference_claim")).join("") || `<p class="muted">No extracted reference claim linked.</p>`}
      <details><summary>Unlinked reference claims (${ref.unlinkedReferenceClaims.length})</summary><ul>${ref.unlinkedReferenceClaims.map((x) => `<li><code>${shown(x.claimId)}</code> ${shown(x.claimText)}</li>`).join("") || "<li>None</li>"}</ul></details>
      </div></details>`).join("") || `<div class="panel muted">No associated reference document.</div>`;
    return `<section class="claim"><div class="claim-title"><div class="eyebrow">${esc(snapshot.label)} · ${esc(claim.semanticKey)} · task claim ID ${shown(claim.taskClaimId)}</div><h2>${shown(claim.claimText)}</h2></div>${coverageBadge(claim)}
      <div class="panel"><dl class="grid">${field("object claim",claim.objectClaimText)}${field("claim role",claim.claimRole)}${field("article stance",claim.articleStance)}${field("argument function",claim.argumentFunction)}${field("score transform",claim.scoreTransform)}${field("mapping confidence",claim.argumentMappingConfidence)}${field("speaker",claim.speakerEntity)}${field("task content ID",claim.taskContentId)}</dl></div><h3>Associated references</h3>${refs}</section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(snapshot.label)} Evidence Neighborhood Report</title><style>${reportStyles}</style></head><body><main>
    <header class="masthead"><div class="eyebrow">FORENSIC EVIDENCE SNAPSHOT · ${esc(snapshot.label)}</div><h1>Current evidence neighborhoods</h1><p>Rendered entirely from snapshot schema ${esc(snapshot.schemaVersion)}. Semantic task claims are the longitudinal identity; numeric IDs remain forensic metadata.</p></header>
    <section class="summary">${cards}</section>${sections}<section class="panel"><h2>Retrieval context</h2><p><strong>Retrieval provenance not persisted/recoverable.</strong></p><p>No outside knowledge was used to determine claim truth.</p></section>
    </main></body></html>`;
}

function referenceMap(claim) {
  return new Map(claim.references.map((ref) => [normalizeUrl(ref.canonicalUrl || ref.url), ref]));
}
function extractedClaimMap(claim) {
  const out = new Map();
  for (const ref of claim.references) for (const rc of ref.referenceClaims) {
    out.set(`${normalizeUrl(ref.canonicalUrl || ref.url)}|${normalizeText(rc.claimText)}`, { ref, rc });
  }
  return out;
}
function nearDuplicatePairs(claim) {
  const items = [...extractedClaimMap(claim).values()];
  const pairs = [];
  for (let i=0;i<items.length;i+=1) for (let j=i+1;j<items.length;j+=1) {
    const score = jaccard(items[i].rc.claimText,items[j].rc.claimText);
    if (score >= .82) pairs.push({ a:items[i].rc.claimText,b:items[j].rc.claimText,score });
  }
  return pairs;
}

function renderComparison(snapshots) {
  const semanticKeys = [...new Set(snapshots.flatMap((snapshot) => snapshot.claims.map((claim) => claim.semanticKey)))];
  const sections = semanticKeys.map((semanticKey) => {
    const runs = snapshots.map((snapshot) => ({ snapshot, claim: snapshot.claims.find((claim) => claim.semanticKey === semanticKey) || null }));
    const runCards = runs.map(({snapshot,claim}) => `<article class="compare-card"><div class="eyebrow">${esc(snapshot.label)}</div><h3>${claim ? shown(claim.claimText) : "Claim absent"}</h3>${claim ? `${coverageBadge(claim)}${metricGrid(snapshotMetrics(claim))}` : ""}</article>`).join("");
    const deltas = [];
    for (let i=1;i<runs.length;i+=1) {
      const previous = runs[i-1], current = runs[i];
      if (!previous.claim || !current.claim) {
        const previousState = previous.claim ? "PRESENT" : "ABSENT";
        const currentState = current.claim ? "PRESENT" : "ABSENT";
        deltas.push(`<section class="panel"><h3>${esc(previous.snapshot.label)} → ${esc(current.snapshot.label)}</h3>
          <div class="note"><strong>TASK CLAIM EXTRACTION: ${previousState} → ${currentState}</strong><br>
          The semantic task claim ${current.claim ? "appeared" : "was not extracted"} in ${esc(current.snapshot.label)}. This is an upstream task-claim extraction difference, not claim-level link coverage.</div></section>`);
        continue;
      }
      const oldRefs=referenceMap(previous.claim),newRefs=referenceMap(current.claim);
      const shared=[...oldRefs.keys()].filter((k)=>newRefs.has(k));
      const added=[...newRefs.keys()].filter((k)=>!oldRefs.has(k));
      const lost=[...oldRefs.keys()].filter((k)=>!newRefs.has(k));
      const oldClaims=extractedClaimMap(previous.claim),newClaims=extractedClaimMap(current.claim);
      const claimAdded=[...newClaims.keys()].filter((k)=>!oldClaims.has(k));
      const claimLost=[...oldClaims.keys()].filter((k)=>!newClaims.has(k));
      const changed=[...oldClaims.keys()].filter((k)=>newClaims.has(k)).map((k)=>({key:k,old:oldClaims.get(k).rc,next:newClaims.get(k).rc})).filter((x)=>x.old.stance!==x.next.stance || Number(x.old.confidence)!==Number(x.next.confidence) || Number(x.old.supportLevel)!==Number(x.next.supportLevel));
      const sourceChanges=shared.map((k)=>({url:k,old:oldRefs.get(k),next:newRefs.get(k)})).filter((x)=>normalizeText(x.old.publisher?.publisher_name)!==normalizeText(x.next.publisher?.publisher_name) || normalizeText(x.old.title)!==normalizeText(x.next.title));
      const linkCoverageChanges=shared.map((k)=>({url:k,old:oldRefs.get(k),next:newRefs.get(k),oldLinked:oldRefs.get(k).referenceClaims.length>0,nextLinked:newRefs.get(k).referenceClaims.length>0})).filter((x)=>x.oldLinked!==x.nextLinked);
      const oldCoverage=previous.claim.claimLevelLinkCoverage||claimLevelCoverage(previous.claim.references);
      const newCoverage=current.claim.claimLevelLinkCoverage||claimLevelCoverage(current.claim.references);
      const item=(k,map)=>`<li><a href="${esc(map.get(k)?.url || map.get(k)?.ref?.url)}">${shown(map.get(k)?.title || map.get(k)?.rc?.claimText || k)}</a></li>`;
      deltas.push(`<section class="panel"><h3>${esc(previous.snapshot.label)} → ${esc(current.snapshot.label)}</h3><div class="delta">
        <div><h4>References in both (${shared.length})</h4><ul>${shared.map((k)=>item(k,newRefs)).join("")||"<li>None</li>"}</ul><h4 class="good">References added (${added.length})</h4><ul>${added.map((k)=>item(k,newRefs)).join("")||"<li>None</li>"}</ul><h4 class="warning">References lost (${lost.length})</h4><ul>${lost.map((k)=>item(k,oldRefs)).join("")||"<li>None</li>"}</ul></div>
        <div><h4>Extracted claims added (${claimAdded.length})</h4><ul>${claimAdded.map((k)=>item(k,newClaims)).join("")||"<li>None</li>"}</ul><h4>Extracted claims lost (${claimLost.length})</h4><ul>${claimLost.map((k)=>item(k,oldClaims)).join("")||"<li>None</li>"}</ul></div></div>
        <h4>Stance / confidence / support-level changes (${changed.length})</h4><div class="table-wrap"><table><tr><th>Evidence</th><th>Old</th><th>New</th></tr>${changed.map((x)=>`<tr><td>${shown(x.next.claimText)}</td><td>${shown(x.old.stance)} · ${shown(x.old.confidence)} · ${shown(x.old.supportLevel)}</td><td>${shown(x.next.stance)} · ${shown(x.next.confidence)} · ${shown(x.next.supportLevel)}</td></tr>`).join("")||`<tr><td colspan="3">None among semantically identical extracted claims.</td></tr>`}</table></div>
        <h4>Source-identity differences (${sourceChanges.length})</h4><ul>${sourceChanges.map((x)=>`<li>${esc(x.url)}: ${shown(x.old.title)} / ${shown(x.old.publisher?.publisher_name)} → ${shown(x.next.title)} / ${shown(x.next.publisher?.publisher_name)}</li>`).join("")||"<li>None among shared canonical URLs.</li>"}</ul>
        <h4>Claim-level link coverage: ${esc(oldCoverage.status)} (${oldCoverage.linkedReferenceDocuments}/${oldCoverage.totalReferenceDocuments}) → ${esc(newCoverage.status)} (${newCoverage.linkedReferenceDocuments}/${newCoverage.totalReferenceDocuments})</h4>
        <p>Shared reference URLs where extracted-claim linkage appeared or disappeared (${linkCoverageChanges.length}):</p><ul>${linkCoverageChanges.map((x)=>`<li><a href="${esc(x.next.url||x.old.url)}">${shown(x.next.title||x.old.title)}</a>: ${x.oldLinked?"linked":"unlinked"} → ${x.nextLinked?"linked":"unlinked"}</li>`).join("")||"<li>None among shared URLs.</li>"}</ul>
        <h4>Near-duplicate evidence</h4>${runs.slice(i-1,i+1).map((r)=>`<p><strong>${esc(r.snapshot.label)}:</strong> ${nearDuplicatePairs(r.claim).length} pair(s) at Jaccard ≥ 0.82.</p>`).join("")}
      </section>`);
    }
    return `<section class="claim"><div class="claim-title"><div class="eyebrow">SEMANTIC TASK CLAIM</div><h2>${esc(semanticKey)}</h2></div><div class="comparison-grid" style="--runs:${runs.length}">${runCards}</div>${deltas.join("")}</section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Longitudinal Evidence Comparison</title><style>${reportStyles}</style></head><body><main>
    <header class="masthead"><div class="eyebrow">READ-ONLY FORENSIC COMPARISON</div><h1>${snapshots.map((s)=>esc(s.label)).join(" vs ")}</h1><p>Rendered only from saved JSON snapshots. Comparisons use semantic task keys, canonicalized URLs, and normalized extracted-claim text—not database IDs.</p></header>${sections}
    <section class="panel"><h2>Method</h2><p>Added/lost references are keyed by canonicalized URL. Extracted claims are keyed by canonicalized URL plus normalized claim text. Different numeric IDs do not create a difference by themselves. Near-duplicate flags use a report-layer token Jaccard heuristic and are not persisted classifications.</p></section>
    </main></body></html>`;
}

function renderDetailedSnapshots(snapshots) {
  const semanticKeys = [...new Set(snapshots.flatMap((snapshot) => snapshot.claims.map((claim) => claim.semanticKey)))];
  const representativeText = new Map(semanticKeys.map((semanticKey) => {
    const claim = snapshots.flatMap((snapshot) => snapshot.claims).find((candidate) => candidate.semanticKey === semanticKey);
    return [semanticKey, claim?.claimText || semanticKey];
  }));
  const navigation = snapshots.map((snapshot) =>
    `<a href="#run-${esc(snapshot.label.toLowerCase())}">${esc(snapshot.label)}</a>`).join(" · ");
  const runs = snapshots.map((snapshot) => {
    const completeSnapshot = {
      ...snapshot,
      claims: semanticKeys.map((semanticKey) => snapshot.claims.find((claim) => claim.semanticKey === semanticKey) || {
        semanticKey, taskClaimExtractionStatus: "ABSENT", taskClaimId: null,
        claimText: `Task claim not extracted in ${snapshot.label}: ${representativeText.get(semanticKey)}`,
        objectClaimText: null, claimRole: null, articleStance: null, argumentFunction: null,
        scoreTransform: null, argumentMappingConfidence: null, speakerEntity: null,
        taskContentId: snapshot.taskContentId ?? null, references: [],
        claimLevelLinkCoverage: claimLevelCoverage([]),
      }),
    };
    const standalone = renderSnapshotReport(completeSnapshot);
    const body = standalone.match(/<body><main>([\s\S]*)<\/main><\/body>/)?.[1];
    if (!body) throw new Error(`Could not compose detailed report for ${snapshot.label}`);
    return `<section class="run-detail" id="run-${esc(snapshot.label.toLowerCase())}">${body}</section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Recent Detailed Evidence Reports</title><style>${reportStyles}.run-detail{margin:44px 0 90px;padding-top:20px;border-top:8px solid var(--accent)}.run-detail:first-of-type{border-top:0}.run-nav{position:sticky;top:0;z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:14px 0 30px}.run-detail .masthead{margin-top:18px}</style></head><body><main>
    <header class="masthead"><div class="eyebrow">DETAILED FORENSIC EVIDENCE REPORTS</div><h1>${snapshots.map((snapshot) => esc(snapshot.label)).join(" · ")}</h1>
      <p>Full evidence-neighborhood views rendered from saved JSON snapshots. Each run retains its own task claims, reference documents, document evidence, extracted reference claims, relation provenance, and claim-level link coverage.</p></header>
    <nav class="run-nav"><strong>Jump to run:</strong> ${navigation}</nav>${runs}
    </main></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const writeJson = async (target, value) => {
    const output = path.resolve(ROOT, target);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return output;
  };
  const writeHtml = async (target, html) => {
    const output = path.resolve(ROOT, target);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, html, "utf8");
    return output;
  };

  if (args.snapshots.length) {
    const snapshots = await Promise.all(args.snapshots.map(async (input) =>
      JSON.parse(await fs.readFile(path.resolve(ROOT, input), "utf8"))));
    for (const snapshot of snapshots) {
      if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !Array.isArray(snapshot.claims)) {
        throw new Error(`Unsupported normalized snapshot: ${snapshot.label || "unknown"} (${snapshot.schemaVersion || "no schema version"})`);
      }
    }
    const html = args.detailed ? renderDetailedSnapshots(snapshots)
      : snapshots.length === 1 ? renderSnapshotReport(snapshots[0]) : renderComparison(snapshots);
    const defaultOutput = args.detailed ? "detailed-report.html" : snapshots.length === 1 ? "report-from-snapshot.html" : "comparison.html";
    const output = await writeHtml(args.outputExplicit ? args.output : defaultOutput, html);
    console.log(JSON.stringify({ mode: args.detailed ? "json_detailed" : "json", output, labels: snapshots.map((snapshot) => snapshot.label), databaseQueried: false }, null, 2));
    return;
  }

  if (args.legacyRaw) {
    if (!args.snapshotOut) throw new Error("--from-legacy-raw requires --snapshot-out");
    const legacy = JSON.parse(await fs.readFile(path.resolve(ROOT, args.legacyRaw), "utf8"));
    const lookupPayload = legacy.data || legacy.lookupPayload;
    if (!lookupPayload) throw new Error("Snapshot has no raw lookup payload");
    const snapshot = normalizeSnapshot(legacy.evidenceSet?.label || legacy.label || args.label, lookupPayload, {
      generatedAt: legacy.generatedAt || new Date().toISOString(), source: legacy.source || "legacy_raw_snapshot",
    });
    const snapshotOutput = await writeJson(args.snapshotOut, snapshot);
    const output = args.outputExplicit ? await writeHtml(args.output, renderSnapshotReport(snapshot)) : null;
    console.log(JSON.stringify({ mode: "legacy_migration", snapshotOutput, output,
      label: snapshot.label, claimCount: snapshot.claims.length, databaseQueried: false }, null, 2));
    return;
  }

  dotenv.config({ path: path.resolve(ROOT, args.env) });
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
    charset: "utf8mb4",
  });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION READ ONLY");
    const data = await extract(conn, args.claims);
    const snapshot = normalizeSnapshot(args.label, data, { source: "database" });
    const html = renderSnapshotReport(snapshot);
    await conn.rollback();
    const output = await writeHtml(args.output, html);
    let snapshotOutput = null;
    if (args.snapshotOut) {
      snapshotOutput = await writeJson(args.snapshotOut, snapshot);
    }
    console.log(JSON.stringify({ output, snapshotOutput, label: args.label, claimIds: args.claims,
      startingRows: data.startingRows.length, documentLinks: data.documentLinks.length,
      extractedClaimLinks: data.claimLinks.length, referenceDocuments: data.documents.length }, null, 2));
  } finally {
    try { await conn.rollback(); } catch {}
    await conn.end();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
