import { createHash } from "node:crypto";
import {
  buildAttributionPackets,
} from "../attribution.js";
import { repairDiscoveryGrounding } from "../grounding.js";
import {
  attachLocalContext,
  normalizeDiscovery,
  prepareCf2Article,
  selectCf2Portfolio,
  selectCf2PortfolioWithTreatmentFallback,
  transformForEffect,
} from "../pipeline.js";
import {
  buildCf2V6DecompositionPrompt,
  buildCf2V6DiscoveryPrompt,
  buildCf2V6EvidenceAnchorPrompt,
} from "./prompts.js";
import { attachAttributionCues } from "./cues.js";

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validateUnitIds(ids, unitsById, path) {
  if (!Array.isArray(ids) || ids.length === 0) {
    fail("CF2_V6_INVALID_UNITS", `${path} must contain source-unit IDs`);
  }
  const unique = [];
  for (const unitId of ids) {
    if (!unitsById.has(unitId)) {
      fail("CF2_V6_UNKNOWN_UNIT", `${path} contains unavailable ${unitId}`);
    }
    if (!unique.includes(unitId)) unique.push(unitId);
  }
  return unique;
}

const REPORTING_VERBS = [
  "said", "says", "claimed", "claims", "reported", "reports", "revealed",
  "reveals", "alleged", "alleges", "found", "finds", "concluded", "concludes",
  "denied", "denies", "stated", "states", "declared", "declares",
  "proved", "proves", "proven", "showed", "shows", "demonstrated", "demonstrates",
];
const reportingFrame = new RegExp(
  `^(?:according to\\b|(?:[A-Z][\\p{L}.'’–-]*(?:\\s+[A-Z][\\p{L}.'’–-]*){0,7})`
    + `\\s+(?:${REPORTING_VERBS.join("|")})\\b)`,
  "iu",
);

function supplierIsGrounded(layer, unitsById) {
  const supplier = normalizedKey(layer.supplierName);
  const supplierTokens = [...new Set(supplier.split(" ")
    .filter((token) => token.length > 1
      && !["the", "a", "an", "by", "of", "in"].includes(token)))];
  return layer.sourceUnitIds.some((unitId) => {
    const unitKey = normalizedKey(unitsById.get(unitId)?.text);
    if (unitKey.includes(supplier)) return true;
    if (supplierTokens.length === 0) return false;
    const unitTokens = new Set(unitKey.split(" "));
    return supplierTokens.filter((token) => unitTokens.has(token)).length
      / supplierTokens.length >= 0.5;
  });
}

const OPERATOR_PATTERNS = {
  said: /\b(?:said|says)\b/i,
  claimed: /\b(?:claimed|claims)\b/i,
  reported: /\b(?:reported|reports)\b/i,
  revealed: /\b(?:revealed|reveals)\b/i,
  alleged: /\b(?:alleged|alleges)\b/i,
  found: /\b(?:found|finds)\b/i,
  concluded: /\b(?:concluded|concludes)\b/i,
  stated: /\b(?:stated|states)\b/i,
  denied: /\b(?:denied|denies)\b/i,
  wrote: /\b(?:wrote|writes)\b/i,
  testified: /\b(?:testified|testifies)\b/i,
  announced: /\b(?:announced|announces)\b/i,
  declared: /\bdeclare(?:d|s)?\b/i,
  proved: /\b(?:proved|proves|proven)\b/i,
  showed: /\b(?:showed|shows|shown)\b/i,
  demonstrated: /\bdemonstrate(?:d|s)?\b/i,
  according_to: /\baccording to\b/i,
};

function operatorIsGrounded(layer, unitsById) {
  const pattern = OPERATOR_PATTERNS[layer.operator];
  return Boolean(pattern) && layer.sourceUnitIds.some((unitId) =>
    pattern.test(unitsById.get(unitId)?.text ?? ""));
}

export function normalizeV6Decomposition(
  output,
  candidates,
  sourceUnits,
  article,
  candidateMaximum = 18,
) {
  if (!output || typeof output !== "object" || !Array.isArray(output.assertions)
    || output.assertions.length > candidateMaximum) {
    fail("CF2_V6_INVALID_DECOMPOSITION",
      `Call B assertions must be an array of at most ${candidateMaximum}`);
  }
  const candidatesById = new Map(candidates
    .map((candidate) => [candidate.candidateId, candidate]));
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const seen = new Set();
  const seenAssertions = new Set();
  const assertions = [];
  for (const raw of output.assertions) {
    const candidate = candidatesById.get(raw?.candidateId);
    if (!candidate || seen.has(raw?.candidateId)) {
      fail("CF2_V6_INVALID_CANDIDATE", `Call B returned invalid ${raw?.candidateId}`);
    }
    const layers = (raw.attributionLayers ?? []).map((layer, layerIndex) => {
      const supplierName = normalized(layer?.supplierName);
      const operator = normalized(layer?.operator);
      const assertedContent = normalized(layer?.assertedContent);
      const sourceUnitIds = validateUnitIds(
        layer?.sourceUnitIds,
        unitsById,
        `${candidate.candidateId} layer ${layerIndex + 1}`,
      );
      if (!supplierName || !operator || !assertedContent) {
        fail("CF2_V6_INVALID_LAYER",
          `${candidate.candidateId} layer ${layerIndex + 1} is incomplete`);
      }
      const normalizedLayer = {
        supplierName,
        supplierKind: layer.supplierKind,
        operator,
        assertedContent,
        sourceUnitIds,
      };
      if (!supplierIsGrounded(normalizedLayer, unitsById)) {
        fail("CF2_V6_UNGROUNDED_SUPPLIER",
          `${candidate.candidateId} layer ${layerIndex + 1} supplier is ungrounded`);
      }
      if (!operatorIsGrounded(normalizedLayer, unitsById)) {
        fail("CF2_V6_UNGROUNDED_OPERATOR",
          `${candidate.candidateId} layer ${layerIndex + 1} operator is ungrounded`);
      }
      return normalizedLayer;
    });
    const substantiveAssertion = normalized(raw?.substantiveAssertion);
    if (!substantiveAssertion) {
      fail("CF2_V6_INVALID_ASSERTION",
        `${candidate.candidateId} omitted substantiveAssertion`);
    }
    let layerTargetAudit = null;
    if (layers.length > 0) {
      const finalLayer = layers.at(-1);
      if (normalizedKey(finalLayer.assertedContent)
        !== normalizedKey(substantiveAssertion)) {
        if (normalizedKey(finalLayer.assertedContent)
          .includes(normalizedKey(substantiveAssertion))) {
          layerTargetAudit = {
            status: "host_accepted_stricter_substantive_content",
            modelLayerContent: finalLayer.assertedContent,
            substantiveAssertion,
          };
          finalLayer.assertedContent = substantiveAssertion;
        } else {
          fail("CF2_V6_LAYER_TARGET_MISMATCH",
            `${candidate.candidateId} substantive assertion differs from final layer`);
        }
      }
      if (/^(?:it|they|he|she|this|that|these|those)\b/i
        .test(substantiveAssertion)) {
        fail("CF2_V6_UNRESOLVED_ANAPHORA",
          `${candidate.candidateId} retained unresolved anaphora`);
      }
      const contaminated = reportingFrame.test(substantiveAssertion)
        || (normalizedKey(substantiveAssertion).startsWith(
          normalizedKey(finalLayer.supplierName))
          && normalizedKey(substantiveAssertion).includes(
            normalizedKey(finalLayer.operator)));
      if (contaminated) {
        fail("CF2_V6_REPORTING_FRAME_RETAINED",
          `${candidate.candidateId} retained an attribution frame`);
      }
    } else if (reportingFrame.test(candidate.rawAssertion)) {
      fail("CF2_V6_ATTRIBUTION_LAYER_MISSING",
        `${candidate.candidateId} contains a reporting frame but returned no layer`);
    }
    for (const cue of candidate.attributionCues ?? []) {
      const represented = layers.some((layer) =>
        layer.operator === cue.operator
        && layer.sourceUnitIds.some((unitId) => cue.sourceUnitIds.includes(unitId)));
      if (!represented) {
        fail("CF2_V6_REQUIRED_CUE_OMITTED",
          `${candidate.candidateId} omitted explicit ${cue.operator} cue`);
      }
    }
    const assertionKey = normalizedKey(substantiveAssertion);
    if (seenAssertions.has(assertionKey)) {
      fail("CF2_V6_DUPLICATE_SUBSTANTIVE_ASSERTION",
        `${candidate.candidateId} duplicates an earlier substantive assertion`);
    }
    const groundingUnitIds = validateUnitIds(
      raw?.groundingUnitIds,
      unitsById,
      `${candidate.candidateId} substantive grounding`,
    );
    const finalLayer = layers.at(-1);
    const articleAuthors = (article.authors ?? []).map(normalized).filter(Boolean);
    const sourceName = finalLayer?.supplierName
      ?? (articleAuthors.join(", ") || null);
    const sourceKind = finalLayer?.supplierKind
      ?? (sourceName ? "article_voice" : "unknown");
    const sourceUnitIds = finalLayer?.sourceUnitIds ?? groundingUnitIds;
    assertions.push({
      candidateId: candidate.candidateId,
      surfaceAssertion: candidate.rawAssertion,
      attributionLayers: layers,
      layerTargetAudit,
      assertionText: substantiveAssertion,
      groundingUnitIds,
      articleTreatment: raw.articleTreatment,
      effectIfTrue: raw.effectIfTrue,
      scoreTransform: transformForEffect(raw.effectIfTrue),
      sourceName,
      sourceKind,
      sourceUnitIds,
      sourceNameOrigin: finalLayer
        ? "call_b_attribution_layer"
        : (sourceName ? "host_article_voice_no_explicit_layer" : null),
      attributionBasis: finalLayer ? "direct_attribution" : "article_voice",
      evidenceAnchors: [],
      rawAssertion: candidate.rawAssertion,
      groundingAudit: candidate.groundingAudit ?? null,
    });
    seen.add(candidate.candidateId);
    seenAssertions.add(assertionKey);
  }
  if (seen.size !== candidates.length) {
    const missing = candidates.map((candidate) => candidate.candidateId)
      .filter((candidateId) => !seen.has(candidateId));
    fail("CF2_V6_MISSING_CANDIDATE", `Call B omitted ${missing.join(", ")}`);
  }
  return assertions;
}

export function normalizeV6DecompositionWithQuarantine(
  output,
  candidates,
  sourceUnits,
  article,
  candidateMaximum = 18,
) {
  if (!output || typeof output !== "object" || !Array.isArray(output.assertions)
    || output.assertions.length > candidateMaximum) {
    fail("CF2_V6_INVALID_DECOMPOSITION",
      `Call B assertions must be an array of at most ${candidateMaximum}`);
  }
  const candidatesById = new Map(candidates
    .map((candidate) => [candidate.candidateId, candidate]));
  const rawById = new Map();
  const rejections = [];
  for (const raw of output.assertions) {
    const candidateId = raw?.candidateId ?? null;
    if (!candidatesById.has(candidateId) || rawById.has(candidateId)) {
      rejections.push({
        candidateId,
        code: "CF2_V6_INVALID_CANDIDATE",
        message: `Call B returned invalid or duplicate ${candidateId}`,
        rawOutput: raw,
      });
      continue;
    }
    rawById.set(candidateId, raw);
  }
  const assertions = [];
  const seenAssertions = new Set();
  for (const candidate of candidates) {
    const raw = rawById.get(candidate.candidateId);
    if (!raw) {
      rejections.push({
        candidateId: candidate.candidateId,
        code: "CF2_V6_MISSING_CANDIDATE",
        message: `Call B omitted ${candidate.candidateId}`,
        rawAssertion: candidate.rawAssertion,
        rawOutput: null,
      });
      continue;
    }
    try {
      const [assertion] = normalizeV6Decomposition(
        { assertions: [raw] },
        [candidate],
        sourceUnits,
        article,
        1,
      );
      const key = normalizedKey(assertion.assertionText);
      if (seenAssertions.has(key)) {
        rejections.push({
          candidateId: candidate.candidateId,
          code: "CF2_V6_DUPLICATE_SUBSTANTIVE_ASSERTION",
          message: `${candidate.candidateId} duplicates an accepted assertion`,
          rawAssertion: candidate.rawAssertion,
          rawOutput: raw,
        });
        continue;
      }
      seenAssertions.add(key);
      assertions.push(assertion);
    } catch (error) {
      rejections.push({
        candidateId: candidate.candidateId,
        code: error.code ?? "CF2_V6_INVALID_CANDIDATE_JUDGMENT",
        message: error.message,
        rawAssertion: candidate.rawAssertion,
        rawOutput: raw,
      });
    }
  }
  return { assertions, rejections };
}

export function lockStructuralSources(assertions, packets) {
  const packetsById = new Map(packets.map((packet) =>
    [packet.candidateId, packet]));
  return assertions.map((assertion) => {
    const structural = packetsById.get(assertion.candidateId)?.sourceCandidates
      ?.filter((candidate) => candidate.candidateKind === "structural_list_owner")
      ?? [];
    const callB = {
      callBSourceName: assertion.sourceName,
      callBSourceKind: assertion.sourceKind,
      callBSourceUnitIds: assertion.sourceUnitIds,
      callBSourceNameOrigin: assertion.sourceNameOrigin,
    };
    if (structural.length !== 1) return { ...assertion, ...callB };
    return {
      ...assertion,
      ...callB,
      sourceName: structural[0].nameHint,
      sourceKind: "institution",
      sourceUnitIds: structural[0].unitIds,
      sourceNameOrigin: "host_structural_list_owner",
      attributionBasis: "direct_attribution",
    };
  });
}

function anchorNameIsGrounded(name, packet, articleAuthors) {
  const key = normalizedKey(name);
  if (!key) return false;
  if ((articleAuthors ?? []).some((author) =>
    normalizedKey(author).includes(key) || key.includes(normalizedKey(author)))) {
    return true;
  }
  if (packet.sourceCandidates.some((candidate) => {
    const candidateKey = normalizedKey(candidate.nameHint);
    return candidateKey.includes(key) || key.includes(candidateKey);
  })) return true;
  return packet.contextUnits.some((unit) =>
    normalizedKey(unit.text).includes(key));
}

export function normalizeEvidenceAnchors(output, assertions, packets, article) {
  const rawRows = Array.isArray(output?.attributions) ? output.attributions : [];
  const rowsById = new Map();
  for (const raw of rawRows) {
    if (raw?.candidateId && !rowsById.has(raw.candidateId)) {
      rowsById.set(raw.candidateId, raw);
    }
  }
  const packetsById = new Map(packets
    .map((packet) => [packet.candidateId, packet]));
  return assertions.map((assertion) => {
    const packet = packetsById.get(assertion.candidateId);
    const allowedIds = new Set(packet.contextUnits.map((unit) => unit.unitId));
    const rawAnchors = rowsById.get(assertion.candidateId)?.evidenceAnchors ?? [];
    const evidenceAnchors = [];
    const discardedEvidenceAnchors = [];
    for (const anchor of rawAnchors) {
      const name = normalized(anchor?.name);
      const unitIds = [...new Set((anchor?.unitIds ?? [])
        .filter((unitId) => allowedIds.has(unitId)))];
      if (!name || unitIds.length === 0
        || !anchorNameIsGrounded(name, packet, article.authors)) {
        discardedEvidenceAnchors.push(anchor);
        continue;
      }
      evidenceAnchors.push({ name, kind: anchor.kind, unitIds });
    }
    return {
      candidateId: assertion.candidateId,
      supplierName: assertion.sourceName,
      supplierKind: assertion.sourceKind,
      supplierUnitIds: assertion.sourceUnitIds,
      supplierBasis: assertion.attributionBasis,
      supplierNameOrigin: assertion.sourceNameOrigin,
      evidenceAnchors,
      evidenceAnchorAudit: {
        returned: rawAnchors.length,
        accepted: evidenceAnchors.length,
        discarded: discardedEvidenceAnchors,
      },
    };
  });
}

function mergeEvidenceAnchors(assertions, attributions) {
  const byId = new Map(attributions
    .map((attribution) => [attribution.candidateId, attribution]));
  return assertions.map((assertion) => ({
    ...assertion,
    evidenceAnchors: byId.get(assertion.candidateId)?.evidenceAnchors ?? [],
    evidenceAnchorAudit: byId.get(assertion.candidateId)?.evidenceAnchorAudit ?? null,
  }));
}

function callMetadata(prompt, result, requestedModel) {
  const raw = result.rawResponse ?? {};
  return {
    requestedModel,
    returnedModel: result.model ?? requestedModel,
    attempts: result.attempts ?? null,
    usage: result.usage ?? null,
    responseId: raw.id ?? raw.responseId ?? null,
    systemFingerprint: raw.system_fingerprint ?? raw.systemFingerprint ?? null,
    promptSha256: sha256(`${prompt.system}\n${prompt.user}`),
    schemaSha256: sha256(JSON.stringify(prompt.responseSchema)),
  };
}

export async function runCf2V6({
  rawArticle,
  callARunner,
  callBRunner,
  callCRunner = callBRunner,
  callAModel = "gpt-4o-mini",
  callBModel = "gpt-4.1-mini",
  callCModel = "gpt-4.1-mini",
  candidateMaximum = 18,
  portfolioMaximum = 12,
  candidateFailureMode = "strict",
  selectionPolicy = "effect_only",
  timeoutMs = 180_000,
  seed = undefined,
  clock = () => new Date(),
  onProgress = () => {},
}) {
  const startedAt = clock();
  const { article, sourceUnits } = prepareCf2Article(rawArticle);
  const callAPrompt = buildCf2V6DiscoveryPrompt({
    article,
    sourceUnits,
    candidateMaximum,
  });
  const callAStarted = clock();
  const callAResult = await callARunner.invokeStructured({
    ...callAPrompt,
    model: callAModel,
    temperature: 0.2,
    ...(Number.isInteger(seed) ? { seed } : {}),
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 5_000,
  });
  const callAFinished = clock();
  const rawDiscovery = normalizeDiscovery(
    callAResult.output,
    sourceUnits,
    candidateMaximum,
  );
  const discovery = repairDiscoveryGrounding(rawDiscovery, sourceUnits);
  onProgress({
    stage: "call_a_completed",
    workItems: discovery.candidates.length,
    call: {
      ...callMetadata(callAPrompt, callAResult, callAModel),
      elapsedMs: callAFinished.getTime() - callAStarted.getTime(),
      rawOutput: callAResult.output,
    },
  });
  const candidates = attachAttributionCues(
    attachLocalContext(discovery.candidates, sourceUnits),
  );
  const callBPrompt = buildCf2V6DecompositionPrompt({
    article,
    thesisAssertion: discovery.thesisAssertion,
    candidates,
    candidateMaximum,
  });
  const callBStarted = clock();
  const callBResult = await callBRunner.invokeStructured({
    ...callBPrompt,
    model: callBModel,
    reasoningEffort: "none",
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 6_000 + Math.max(0, candidateMaximum - 18) * 200,
    store: false,
  });
  const callBFinished = clock();
  let candidateJudgments;
  let candidateRejections = [];
  try {
    if (candidateFailureMode === "quarantine") {
      const normalizedResult = normalizeV6DecompositionWithQuarantine(
        callBResult.output,
        candidates,
        sourceUnits,
        article,
        candidateMaximum,
      );
      candidateJudgments = normalizedResult.assertions;
      candidateRejections = normalizedResult.rejections;
    } else {
      candidateJudgments = normalizeV6Decomposition(
        callBResult.output,
        candidates,
        sourceUnits,
        article,
        candidateMaximum,
      );
    }
  } catch (error) {
    onProgress({
      stage: "call_b_invalid",
      workItems: callBResult.output?.assertions?.length ?? null,
      error: { code: error.code ?? null, message: error.message },
      call: {
        ...callMetadata(callBPrompt, callBResult, callBModel),
        elapsedMs: callBFinished.getTime() - callBStarted.getTime(),
        rawOutput: callBResult.output,
      },
    });
    throw error;
  }
  onProgress({
    stage: "call_b_completed",
    workItems: candidateJudgments.length,
    rejections: candidateRejections,
    call: {
      ...callMetadata(callBPrompt, callBResult, callBModel),
      elapsedMs: callBFinished.getTime() - callBStarted.getTime(),
      rawOutput: callBResult.output,
    },
  });
  const selectedAssertions = selectionPolicy === "treatment_fallback"
    ? selectCf2PortfolioWithTreatmentFallback(
      candidateJudgments,
      sourceUnits,
      portfolioMaximum,
    )
    : selectCf2Portfolio(
      candidateJudgments,
      sourceUnits,
      portfolioMaximum,
    );
  const attributionPackets = buildAttributionPackets(
    selectedAssertions,
    candidates,
    sourceUnits,
    article,
  );
  const lockedAssertions = lockStructuralSources(
    selectedAssertions,
    attributionPackets,
  );
  const callCPrompt = buildCf2V6EvidenceAnchorPrompt({
    article,
    packets: attributionPackets,
    assertions: lockedAssertions,
  });
  const callCStarted = clock();
  const callCResult = await callCRunner.invokeStructured({
    ...callCPrompt,
    model: callCModel,
    reasoningEffort: "none",
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 3_000,
    store: false,
  });
  const callCFinished = clock();
  const recoveredAttributions = normalizeEvidenceAnchors(
    callCResult.output,
    lockedAssertions,
    attributionPackets,
    article,
  );
  const assertions = mergeEvidenceAnchors(
    lockedAssertions,
    recoveredAttributions,
  );
  onProgress({
    stage: "call_c_completed",
    workItems: recoveredAttributions.length,
    call: {
      ...callMetadata(callCPrompt, callCResult, callCModel),
      elapsedMs: callCFinished.getTime() - callCStarted.getTime(),
      rawOutput: callCResult.output,
    },
  });
  const finishedAt = clock();
  return {
    architecture: candidateMaximum === 18 && portfolioMaximum === 12
      ? "CF2_V6_BOUNDED_ATTRIBUTION_RECURSION"
      : `CF2_V6_BOUNDED_ATTRIBUTION_RECURSION_C${candidateMaximum}`
        + `_P${portfolioMaximum}`,
    protectedBaseline: {
      architecture: "CF2_MINIMAL_FACT_DOCKET_V5_STRUCTURAL_ATTRIBUTION",
      commit: "a08e2d5d",
      callAPromptSha256:
        "2a9d71acfc2e020d947abab41bf1a78dae475f03df00c3b0436719b2c70a1ec3",
    },
    article: {
      title: article.title,
      authors: article.authors ?? [],
      publisher: article.publisher ?? null,
      publishedAt: article.publishedAt ?? null,
      contentHash: article.contentHash,
      sourceUnitCount: sourceUnits.length,
    },
    thesisAssertion: discovery.thesisAssertion,
    budgets: {
      candidateMaximum,
      portfolioMaximum,
      articleLengthDependent: false,
      candidateFailureMode,
      selectionPolicy,
    },
    candidates,
    candidateJudgments,
    candidateRejections,
    attributionPackets,
    recoveredAttributions,
    assertions,
    calls: {
      callA: {
        ...callMetadata(callAPrompt, callAResult, callAModel),
        elapsedMs: callAFinished.getTime() - callAStarted.getTime(),
        prompt: callAPrompt,
        rawOutput: callAResult.output,
      },
      callB: {
        ...callMetadata(callBPrompt, callBResult, callBModel),
        elapsedMs: callBFinished.getTime() - callBStarted.getTime(),
        prompt: callBPrompt,
        rawOutput: callBResult.output,
      },
      callC: {
        ...callMetadata(callCPrompt, callCResult, callCModel),
        elapsedMs: callCFinished.getTime() - callCStarted.getTime(),
        prompt: callCPrompt,
        rawOutput: callCResult.output,
      },
    },
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    generatedAt: finishedAt.toISOString(),
  };
}
