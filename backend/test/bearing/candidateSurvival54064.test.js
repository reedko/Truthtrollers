import assert from "node:assert/strict";
import test from "node:test";

import logger from "../../src/utils/logger.js";
import {
  DROP_STAGES,
  boundCandidateUnion,
  deriveVerifiedDocumentRole,
  logCandidateDrop,
  mergeCanonicalOccurrence,
  orderForLlmBearing,
  resolveSurvivalBounds,
} from "../../src/core/candidateSurvival.js";
import { scoreCandidatesInBearingShadow } from "../../src/core/snippetBearing.js";
import { buildEvidenceNeedV1 } from "../../src/core/evidenceNeed.js";
import {
  claim54064,
  evidenceNeed54064,
  rawProviderResults54064,
  MUST_SURVIVE_54064,
} from "../fixtures/candidates-54064.js";

// §7 executable regression for claim 54064, replayed through a CAPTURED fixture:
//   raw_result -> canonical_merge -> deterministic bearing pre-score
//   -> pre_bearing_pool -> deterministic_bearing_gate -> candidate drop audit
// No live provider calls.

const VALID_STAGES = new Set(Object.values(DROP_STAGES));
const REQUIRED_DROP_FIELDS = [
  "droppedAtStage", "droppedReason", "verifiedDocumentRole",
  "deterministicBearingScore", "bearingTextLength", "selectedCanonicalTextSource",
];

// Capture [CANDIDATE_DROP_AUDIT] records emitted during a replay.
function withDropAuditCapture(fn) {
  const captured = [];
  const originalLog = logger.log;
  logger.log = (...args) => {
    const line = String(args[0] ?? "");
    if (line.startsWith("[CANDIDATE_DROP_AUDIT]")) {
      captured.push(JSON.parse(line.replace("[CANDIDATE_DROP_AUDIT] ", "")));
    }
    // swallow other logs during the test to keep output clean
  };
  try {
    fn(captured);
  } finally {
    logger.log = originalLog;
  }
  return captured;
}

// Replay raw fixture -> canonical merge -> deterministic pre-score -> pool.
function replayToPool(bounds) {
  // canonical_merge: collapse duplicate URLs with richness-preserving merge.
  const byUrl = new Map();
  for (const raw of rawProviderResults54064) {
    const occurrence = { query: raw.query, provider: raw.provider, providerScore: raw.score, purposeLane: raw.purposeLane };
    const prev = byUrl.get(raw.url);
    if (!prev) byUrl.set(raw.url, { ...raw, targetProvenance: [occurrence], retrievalProvenance: [occurrence] });
    else byUrl.set(raw.url, mergeCanonicalOccurrence(prev, { ...raw, targetProvenance: [occurrence], retrievalProvenance: [occurrence] }));
  }
  const merged = [...byUrl.values()];

  // deterministic bearing pre-score.
  const need = { ...buildEvidenceNeedV1(claim54064), ...evidenceNeed54064 };
  const scored = scoreCandidatesInBearingShadow(need, merged, { minBearingToScrape: 0.35 });

  // pre_bearing_pool coarse union.
  const { kept, dropped } = boundCandidateUnion({ candidates: scored, bounds });
  return { scored, kept, dropped };
}

test("54064: key MMR/CDC documents are never dropped at canonical_merge or pre_bearing_pool", () => {
  const bounds = resolveSurvivalBounds({});
  let poolResult;
  const drops = withDropAuditCapture(() => {
    poolResult = replayToPool(bounds);
    for (const { candidate, reason } of poolResult.dropped) {
      logCandidateDrop({ claim: claim54064, taskContentId: 16833, stage: DROP_STAGES.PRE_BEARING_POOL, candidate, reason });
    }
  });

  const keptUrls = new Set(poolResult.kept.map((c) => c.url));
  const droppedAtPoolUrls = new Set(
    drops.filter((d) => d.droppedAtStage === DROP_STAGES.PRE_BEARING_POOL).map((d) => d.url),
  );

  for (const url of MUST_SURVIVE_54064) {
    assert.ok(keptUrls.has(url), `${url} must survive the pre-bearing pool`);
    assert.ok(!droppedAtPoolUrls.has(url), `${url} must not be dropped at pre_bearing_pool`);
  }

  // Every emitted drop uses a canonical stage enum and carries required fields.
  for (const drop of drops) {
    assert.ok(VALID_STAGES.has(drop.droppedAtStage), `invalid stage ${drop.droppedAtStage}`);
    for (const field of REQUIRED_DROP_FIELDS) {
      assert.ok(field in drop, `drop audit missing field ${field}`);
    }
  }
});

test("54064: verified docs bypass the deterministic bearing gate (not excluded from the LLM batch)", () => {
  const bounds = resolveSurvivalBounds({});
  const { kept } = replayToPool(bounds);

  const drops = withDropAuditCapture(() => {
    const { excludedFromLlm } = orderForLlmBearing({ candidates: kept, bounds });
    for (const candidate of excludedFromLlm) {
      logCandidateDrop({ claim: claim54064, taskContentId: 16833, stage: DROP_STAGES.DETERMINISTIC_BEARING_GATE, candidate, reason: "beyond_llm_bearing_cap" });
    }
  });

  const gateDropUrls = new Set(
    drops.filter((d) => d.droppedAtStage === DROP_STAGES.DETERMINISTIC_BEARING_GATE).map((d) => d.url),
  );
  for (const url of MUST_SURVIVE_54064) {
    assert.ok(!gateDropUrls.has(url), `${url} must not be cut at the deterministic bearing gate`);
  }
});

test("54064: GlobeNewswire is classified only as advocacy/press release, never a study/official/primary doc", () => {
  const pr = rawProviderResults54064.find((c) => c.url.includes("globenewswire"));
  const role = deriveVerifiedDocumentRole(pr);
  assert.ok(["advocacy_or_press_release_candidate", "news_or_commentary_candidate"].includes(role.role));
  assert.ok(![
    "original_study_candidate",
    "official_study_page_candidate",
    "primary_statement_candidate",
  ].includes(role.role));
  assert.equal(role.verified, false);
});

test("54064: a verified original study with a thin snippet outranks a loud press release", () => {
  const bounds = resolveSurvivalBounds({ maxLlmBearingCandidatesPerClaim: 3, maxVerifiedDocumentCandidates: 3 });
  const { kept } = replayToPool(bounds);
  const { ordered, llmBatchSize } = orderForLlmBearing({ candidates: kept, bounds });
  const batchUrls = ordered.slice(0, llmBatchSize).map((c) => c.url);
  // The loud (0.55) press release never displaces verified documents.
  assert.ok(!batchUrls.some((u) => u.includes("globenewswire")));
  assert.ok(batchUrls.includes("https://pubmed.ncbi.nlm.nih.gov/14754936/"));
});
