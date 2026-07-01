import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_LINK_HEADERS,
  LOAD_HEADERS,
  buildClaimLinkComparisonRows,
  buildLoadComparisonRows,
  rowsToCsv,
} from "../../src/core/evidenceComparisonExport.js";
import { createZipBuffer } from "../../src/utils/simpleZip.js";
import {
  clearEvidenceComparisonRunsForTest,
  getEvidenceComparisonRun,
  recordEvidenceComparisonRun,
} from "../../src/core/evidenceComparisonRegistry.js";
import { normalizeBearingGatingConfig } from "../../src/core/bearingConfig.js";
import {
  GATING_PROJECTION_HEADERS,
  REVIEW_HEADERS,
  SUMMARY_HEADERS,
  buildClaimHingePacket,
  buildEvidenceReviewRows,
  buildEvidenceSummaryRows,
  buildGatingProjectionRows,
} from "../../src/core/evidenceReviewExport.js";

const caseClaims = [{ claim_id: 1, claim_text: "Exposure X increases outcome Y." }];

const snapshot = {
  elapsedMs: 1000,
  flags: {
    enableBearingShadow: true,
    enableSnippetBearingLlm: true,
    enableBearingGating: false,
    enableBearingPacket: false,
  },
  bearingConfig: { version: 1, minBearingToScrape: 0.35 },
  projectedGating: {
    selectedByClaimId: {
      1: [{ url: "https://source-a.example/report" }],
    },
  },
  results: [{
    claim: { id: 1, text: caseClaims[0].claim_text },
    candidates: [
      { url: "https://source-a.example/report", title: "Exposure X outcome Y report", snippet: "Exposure X increases outcome Y.", query: "Exposure X outcome Y", deterministicBearingScore: 0.8 },
      { url: "https://source-b.example/topic", title: "Unrelated entertainment topic", snippet: "Movie trailer and cast.", query: "X", deterministicBearingScore: 0.1, deterministicBearingDecision: "skip" },
      { url: "https://source-c.example/study", title: "Exposure X study", snippet: "Outcome Y increased after Exposure X.", query: "Exposure X study", deterministicBearingScore: 0.75 },
    ],
    selectedCandidates: [],
    evidence: [
      { url: "https://source-a.example/report", quote: "Exposure X increases outcome Y.", bearingScore: 0.82, bearingType: "direct", bearingReason: "Exact claim.", stance: "support" },
      { url: "https://source-b.example/topic", quote: "Exposure X exists.", bearingScore: 0.08, bearingType: "none", bearingReason: "Topic only.", stance: "nuance" },
      { url: "https://source-c.example/study", quote: "A new study found outcome Y increased after Exposure X.", bearingScore: 0.78, bearingType: "direct", bearingReason: "Direct new evidence.", stance: "support" },
    ],
    evidencePacket: {
      items: [
        {
          evidenceId: "packet-a",
          referenceContentId: 201,
          url: "https://source-a.example/report",
          title: "Report A",
          quote: "Exposure X increases outcome Y.",
          stance: "support",
          finalBearing: 0.82,
          bearingType: "direct",
          claimComponentAddressed: "whole_claim",
          causalStrength: "not_applicable",
          inclusionReason: "Exact claim match.",
          packetRole: "data_ground",
          qualityScore: 0.8,
          qualityLabel: "high",
        },
        {
          evidenceId: "packet-c",
          referenceContentId: 203,
          url: "https://source-c.example/study",
          title: "Study C",
          quote: "A new study found outcome Y increased after Exposure X.",
          stance: "support",
          finalBearing: 0.78,
          bearingType: "direct",
          claimComponentAddressed: "whole_claim",
          causalStrength: "causal",
          inclusionReason: "New high-bearing evidence.",
          packetRole: "data_ground",
          qualityScore: 0.7,
          qualityLabel: "high",
        },
      ],
    },
  }],
};

test("claim-link export separates overlap, rejected legacy, and upgraded bearing rows", () => {
  const rows = buildClaimLinkComparisonRows({
    caseClaims,
    snapshot,
    legacyLinks: [
      {
        link_id: 11,
        task_claim_id: 1,
        reference_claim_id: 101,
        reference_content_id: 201,
        reference_claim_text: "Exposure X increases outcome Y.",
        source_url: "https://source-a.example/report?utm_source=test",
        source_title: "Report A",
        stance: "support",
        confidence: 0.9,
        support_level: 0.8,
        veracity: 85,
      },
      {
        link_id: 12,
        task_claim_id: 1,
        reference_claim_id: 102,
        reference_content_id: 202,
        reference_claim_text: "Exposure X is a public-health topic.",
        source_url: "https://source-b.example/topic",
        source_title: "Topic B",
        stance: "nuance",
      },
    ],
    sourceMetadataByContentId: {
      203: { publisher_name: "Publisher C", publication_venue: "Journal C", source_type: "academic" },
    },
  });

  assert.deepEqual(rows.map((row) => row.comparison_bucket), ["both", "legacy_rejected", "bearing_upgraded"]);
  assert.equal(rows[0].bearing_source_claim_id, "not_available");
  assert.equal(rows[0].legacy_source_claim_id, 101);
  assert.equal(rows[1].legacy_link_bearing_decision, "reject");
  assert.equal(rows[2].publisher_name, "Publisher C");
  assert.match(rows[0].debug_ids, /match=url_text_similarity/);
  assert.ok(rows.every((row) => row.case_claim_text === caseClaims[0].claim_text));
});

test("load export distinguishes shadow actual from projected gated savings", () => {
  const [row] = buildLoadComparisonRows({
    contentId: 123,
    caseClaims,
    snapshot,
    legacyStatsByClaimId: {
      1: { distinct_reference_contents: 3, source_content_chars: 12000, source_claim_chars: 900 },
    },
  });

  assert.equal(row.bearing_candidates_skipped_actual, 0);
  assert.equal(row.bearing_urls_scraped_actual, 3);
  assert.equal(row.projected_urls_scraped, 1);
  assert.equal(row.urls_scraped_saved, 2);
  assert.equal(row.token_usage_is_estimated, true);
  assert.equal(row.legacy_estimated_cost_usd, "not_available");
  assert.match(row.notes, /Shadow actual skipped work is zero/);
});

test("missing run telemetry is explicitly marked not_available", () => {
  const [row] = buildLoadComparisonRows({ contentId: 123, caseClaims, snapshot: null });
  assert.equal(row.legacy_total_tokens, "not_available");
  assert.equal(row.bearing_total_tokens_actual, "not_available");
  assert.match(row.notes, /not persisted/);
});

test("review export mirrors the readable focused-review workbook", () => {
  const legacyLinks = [
    {
      task_claim_id: 1, reference_claim_id: 101, reference_content_id: 201,
      reference_claim_text: "Exposure X increases outcome Y.", source_url: "https://source-a.example/report",
      source_title: "Report A", stance: "support", support_level: 0.8, confidence: 0.9,
      veracity: 90, rationale: "Direct legacy match.",
    },
    {
      task_claim_id: 1, reference_claim_id: 102, reference_content_id: 202,
      reference_claim_text: "Exposure X is a topic.", source_url: "https://source-b.example/topic",
      source_title: "Unrelated entertainment topic", stance: "nuance", support_level: 0.1,
      veracity: 55, rationale: "Broad topic overlap.",
    },
  ];
  const rows = buildEvidenceReviewRows({ caseClaims, legacyLinks, snapshot });
  assert.deepEqual(REVIEW_HEADERS, [
    "Case ID", "Case claim", "Source", "Quality", "Bucket",
    "Legacy claim", "Legacy stance", "Legacy rel.", "Legacy rationale",
    "Bearing claim", "Bearing stance", "Bearing score", "Bearing level",
    "Bearing rationale", "Human hint",
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]["Case claim"], caseClaims[0].claim_text);
  assert.equal(rows[0]["Legacy claim"], "Exposure X increases outcome Y.");
  assert.equal(rows[0]["Bearing claim"], "Exposure X increases outcome Y.");
  assert.equal(rows[0]["Legacy rel."], 90);
  assert.equal(rows[0]["Bearing score"], 0.82);
  assert.equal(rows[0]["Bearing level"], "direct");
  assert.match(rows[0]["Legacy rationale"], /Direct legacy/);
  assert.match(rows[0]["Bearing rationale"], /Exact claim/);
  assert.equal(rows[1]["Bucket"], "bearing_rejected_legacy");
  assert.equal(rows[2]["Bucket"], "bearing_only");
  const csv = rowsToCsv({ title: "Review", headers: REVIEW_HEADERS, rows });
  assert.equal(csv.split("\r\n")[1], REVIEW_HEADERS.join(","));
  assert.doesNotMatch(csv, /candidate_quality_flag|comparison_bucket|not_available/);
});

test("gating and by-case summary mirror the readable workbook", () => {
  const shadowOnlySnapshot = {
    ...snapshot,
    flags: { ...snapshot.flags, enableSnippetBearingLlm: false, enableBearingGating: false },
  };
  const loadRows = buildLoadComparisonRows({
    contentId: 123,
    caseClaims,
    snapshot: shadowOnlySnapshot,
    legacyStatsByClaimId: { 1: { distinct_reference_contents: 3, source_content_chars: 12000, source_claim_chars: 900 } },
  });
  const reviewRows = buildEvidenceReviewRows({ caseClaims, legacyLinks: [], snapshot: shadowOnlySnapshot });
  const gatingRows = buildGatingProjectionRows({ caseClaims, snapshot: shadowOnlySnapshot, loadRows });
  const junk = gatingRows.find((row) => row.URL === "https://source-b.example/topic");
  assert.equal(GATING_PROJECTION_HEADERS.length, 9);
  assert.equal(junk.gate_decision, "reject");
  assert.equal(junk.estimated_downstream_calls_avoided, 3);
  assert.ok(junk.estimated_tokens_avoided > 0);

  const [summary] = buildEvidenceSummaryRows({
    contentId: 123, caseClaims, snapshot: shadowOnlySnapshot, reviewRows, gatingRows, loadRows,
  });
  assert.deepEqual(SUMMARY_HEADERS, [
    "Case ID", "Case claim", "Rows", "Legacy accepted", "Bearing accepted",
    "Both accepted", "Bearing rejected legacy", "Bearing only", "Legacy only",
    "Legacy better", "Bearing better", "Non-good candidates",
    "Avg legacy rel.", "Avg bearing score",
  ]);
  assert.equal(summary["Case ID"], 1);
  assert.equal(summary["Rows"], 2);
  assert.equal(summary["Legacy accepted"], 0);
  assert.equal(summary["Bearing accepted"], 2);
  assert.equal(summary["Bearing only"], 2);
});

test("claim hinge packet blocks misleading standalone query fragments", () => {
  const packet = buildClaimHingePacket({
    claim_text: "Each year, about 1 out of every 100 babies born has a congenital heart defect.",
  });
  assert.equal(packet.claim_type, "incidence_statistic");
  assert.ok(packet.required_terms.includes("congenital"));
  assert.ok(packet.required_terms.includes("heart"));
  assert.ok(packet.forbidden_standalone_terms.includes("each"));
});

test("CSV row 2 is the exact header row and ZIP contains two entries", () => {
  const csv = rowsToCsv({
    title: "VeriStrata Evidence Comparison Export",
    metadata: { content_id: 123 },
    headers: CLAIM_LINK_HEADERS,
    rows: [],
  });
  assert.equal(csv.split("\r\n")[1], CLAIM_LINK_HEADERS.join(","));
  assert.equal(LOAD_HEADERS.length, 59);

  const zip = createZipBuffer([
    { name: "links.csv", data: csv },
    { name: "load.csv", data: "title\r\nheader" },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
});

test("run registry retains a bounded comparison packet even when live packet mode is off", () => {
  clearEvidenceComparisonRunsForTest();
  const config = normalizeBearingGatingConfig({}, {});
  const completedAtMs = Date.now();
  recordEvidenceComparisonRun({
    contentId: 123,
    startedAtMs: completedAtMs - 100,
    completedAtMs,
    bearingConfig: config,
    flags: { enableBearingShadow: true, enableBearingPacket: false },
    aiReferences: [{ url: "https://source.example/report", referenceContentId: 900 }],
    results: [{
      claim: { id: 1, text: "Exact claim", role: "thesis", evidenceNeed: { claimType: "factual" } },
      candidates: [{ url: "https://source.example/report", deterministicBearingScore: 0.8, bearingPreScore: 0.8 }],
      evidence: [{
        id: "ev-1",
        url: "https://source.example/report",
        quote: "Exact claim",
        stance: "support",
        bearingScore: 0.8,
        bearingType: "direct",
        claimComponentAddressed: "whole_claim",
        quality: 0.7,
      }],
    }],
  });

  const stored = getEvidenceComparisonRun(123);
  assert.equal(stored.elapsedMs, 100);
  assert.equal(stored.results[0].evidencePacket.itemCount, 1);
  assert.equal(stored.results[0].evidencePacket.items[0].referenceContentId, 900);
  assert.deepEqual(stored.projectedGating.uniqueUrls, ["https://source.example/report"]);
});
