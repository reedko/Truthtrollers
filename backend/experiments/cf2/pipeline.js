import { createHash } from "node:crypto";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  applyRecoveredAttributions,
  buildAttributionPackets,
  normalizeAttributions,
} from "./attribution.js";
import {
  buildCf2AttributionPrompt,
  buildCf2DiscoveryPrompt,
  buildCf2FinalizationPrompt,
} from "./prompts.js";
import { repairDiscoveryGrounding } from "./grounding.js";

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase();
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function prepareCf2Article(rawArticle) {
  const article = validateArticleInput(rawArticle);
  const articleDocument = articleDocumentFromText({
    text: article.text,
    metadata: { title: article.title, language: article.language },
  });
  return {
    article: {
      ...article,
      text: articleDocument.canonicalText,
      contentHash: articleDocument.contentHash,
    },
    sourceUnits: articleDocument.sourceUnits,
  };
}

function validateUnitIds(ids, unitsById, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(ids) || (!allowEmpty && ids.length === 0)) {
    fail("CF2_INVALID_GROUNDING", `${path} must contain source-unit IDs`);
  }
  const unique = [];
  for (const id of ids) {
    if (!unitsById.has(id)) fail("CF2_UNKNOWN_SOURCE_UNIT", `${path} contains ${id}`);
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function normalizeDiscovery(output, sourceUnits, maximum = 18) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    fail("CF2_INVALID_DISCOVERY", "Call A output must be an object");
  }
  const thesisAssertion = normalized(output.thesisAssertion);
  if (!thesisAssertion) fail("CF2_INVALID_THESIS", "Call A omitted thesisAssertion");
  if (!Array.isArray(output.candidates) || output.candidates.length > maximum) {
    fail("CF2_INVALID_DISCOVERY",
      `Call A candidates must be an array of at most ${maximum}`);
  }
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const seen = new Set();
  const candidates = [];
  for (const raw of output.candidates) {
    const rawAssertion = normalized(raw?.rawAssertion);
    if (!rawAssertion) fail("CF2_INVALID_ASSERTION", "Call A emitted an empty assertion");
    const groundingUnitIds = validateUnitIds(raw?.groundingUnitIds, unitsById,
      `Call A candidate ${candidates.length + 1}`);
    const key = normalizedKey(rawAssertion);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      candidateId: `C${String(candidates.length + 1).padStart(2, "0")}`,
      rawAssertion,
      groundingUnitIds,
    });
  }
  return { thesisAssertion, candidates };
}

export function attachLocalContext(candidates, sourceUnits, radius = 2) {
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  return candidates.map((candidate) => {
    const indexes = candidate.groundingUnitIds.map((id) => order.get(id))
      .filter(Number.isInteger);
    const selected = new Set();
    for (const index of indexes) {
      for (let i = Math.max(0, index - radius);
        i <= Math.min(sourceUnits.length - 1, index + radius); i += 1) selected.add(i);
    }
    return {
      ...candidate,
      contextUnits: [...selected].sort((a, b) => a - b).map((index) => sourceUnits[index]),
    };
  });
}

export function transformForEffect(effectIfTrue) {
  if (effectIfTrue === "strengthens") return "normal";
  if (effectIfTrue === "weakens") return "invert";
  return "none";
}

export function normalizeFinalization(output, candidates, sourceUnits, {
  articleAuthors = [],
} = {}) {
  if (!output || typeof output !== "object" || !Array.isArray(output.assertions)
    || output.assertions.length > 18) {
    fail("CF2_INVALID_FINALIZATION", "Call B assertions must be an array of at most 18");
  }
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const seenCandidates = new Set();
  const seenAssertions = new Set();
  const assertions = [];
  for (const raw of output.assertions) {
    const candidate = candidatesById.get(raw?.candidateId);
    if (!candidate) fail("CF2_UNKNOWN_CANDIDATE", `Call B returned ${raw?.candidateId}`);
    if (seenCandidates.has(candidate.candidateId)) {
      fail("CF2_DUPLICATE_CANDIDATE", `Call B returned ${candidate.candidateId} twice`);
    }
    const assertionText = normalized(raw?.assertionText);
    if (!assertionText) fail("CF2_INVALID_ASSERTION", "Call B emitted an empty assertion");
    const assertionKey = normalizedKey(assertionText);
    if (seenAssertions.has(assertionKey)) continue;
    const groundingUnitIds = validateUnitIds(raw?.groundingUnitIds, unitsById,
      `${candidate.candidateId} grounding`);
    const sourceUnitIds = validateUnitIds(raw?.sourceUnitIds, unitsById,
      `${candidate.candidateId} source`, { allowEmpty: true });
    const sourceKind = raw?.sourceKind;
    let sourceName = raw?.sourceName === null ? null : normalized(raw?.sourceName);
    let sourceNameOrigin = sourceName ? "model" : null;
    if (sourceKind === "unknown" && /^(?:unknown|unresolved|unclear)$/i.test(sourceName ?? "")) {
      sourceName = null;
    }
    if (sourceKind === "article_voice" && !sourceName && articleAuthors.length > 0) {
      sourceName = articleAuthors.map(normalized).filter(Boolean).join(", ");
      sourceNameOrigin = "host_materialized_byline";
    }
    if (sourceKind !== "unknown" && !sourceName) {
      fail("CF2_INVALID_SOURCE", `${candidate.candidateId} resolved source needs a name`);
    }
    seenCandidates.add(candidate.candidateId);
    seenAssertions.add(assertionKey);
    assertions.push({
      candidateId: candidate.candidateId,
      assertionText,
      groundingUnitIds,
      articleTreatment: raw.articleTreatment,
      effectIfTrue: raw.effectIfTrue,
      sourceName,
      sourceKind,
      sourceUnitIds,
      sourceNameOrigin,
      scoreTransform: transformForEffect(raw.effectIfTrue),
      rawAssertion: candidate.rawAssertion,
      groundingAudit: candidate.groundingAudit ?? null,
    });
  }
  if (seenCandidates.size !== candidates.length) {
    const missing = candidates
      .map((candidate) => candidate.candidateId)
      .filter((candidateId) => !seenCandidates.has(candidateId));
    fail("CF2_MISSING_CANDIDATE", `Call B omitted ${missing.join(", ")}`);
  }
  return assertions;
}

function groundingOrder(assertion, unitOrder) {
  const positions = assertion.groundingUnitIds
    .map((unitId) => unitOrder.get(unitId))
    .filter(Number.isInteger);
  return positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}

function balancedTake(assertions, count, sourceUnits) {
  if (count <= 0 || assertions.length === 0) return [];
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const denominator = Math.max(1, sourceUnits.length);
  const buckets = [[], [], [], []];
  for (const assertion of assertions) {
    const position = groundingOrder(assertion, unitOrder);
    const quartile = Math.min(3, Math.floor((position / denominator) * 4));
    buckets[quartile].push(assertion);
  }
  const selected = [];
  while (selected.length < count && buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      if (selected.length >= count) break;
      const next = bucket.shift();
      if (next) selected.push(next);
    }
  }
  return selected;
}

export function selectCf2Portfolio(assertions, sourceUnits, maximum = 12) {
  const relevant = assertions.filter((assertion) => assertion.effectIfTrue !== "no_effect");
  const opponent = relevant.filter((assertion) =>
    assertion.articleTreatment === "challenged" || assertion.effectIfTrue === "weakens");
  const other = relevant.filter((assertion) =>
    assertion.articleTreatment !== "challenged" && assertion.effectIfTrue !== "weakens");
  const selectedOpponent = balancedTake(opponent, maximum, sourceUnits);
  const selectedOther = balancedTake(other, maximum - selectedOpponent.length, sourceUnits);
  const selectedIds = new Set([...selectedOpponent, ...selectedOther]
    .map((assertion) => assertion.candidateId));
  return assertions.filter((assertion) => selectedIds.has(assertion.candidateId));
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

export async function runCf2({
  rawArticle,
  callARunner,
  callBRunner,
  callCRunner = callBRunner,
  callAModel = "gpt-4o-mini",
  callBModel = "gpt-4.1-mini",
  callCModel = "gpt-4.1-mini",
  timeoutMs = 180_000,
  seed = undefined,
  clock = () => new Date(),
  onProgress = () => {},
}) {
  const startedAt = clock();
  const { article, sourceUnits } = prepareCf2Article(rawArticle);
  const callAPrompt = buildCf2DiscoveryPrompt({ article, sourceUnits });
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
  const rawDiscovery = normalizeDiscovery(callAResult.output, sourceUnits);
  const discovery = repairDiscoveryGrounding(rawDiscovery, sourceUnits);
  onProgress({
    stage: "call_a_completed",
    workItems: discovery.candidates.length,
    discovery,
    call: {
      ...callMetadata(callAPrompt, callAResult, callAModel),
      elapsedMs: callAFinished.getTime() - callAStarted.getTime(),
      rawOutput: callAResult.output,
    },
  });
  const candidates = attachLocalContext(discovery.candidates, sourceUnits);
  const callBPrompt = buildCf2FinalizationPrompt({
    article,
    thesisAssertion: discovery.thesisAssertion,
    candidates,
  });
  const callBStarted = clock();
  const callBResult = await callBRunner.invokeStructured({
    ...callBPrompt,
    model: callBModel,
    reasoningEffort: "none",
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 4_000,
    store: false,
  });
  const callBFinished = clock();
  onProgress({
    stage: "call_b_completed",
    workItems: callBResult.output?.assertions?.length ?? null,
    call: {
      ...callMetadata(callBPrompt, callBResult, callBModel),
      elapsedMs: callBFinished.getTime() - callBStarted.getTime(),
      rawOutput: callBResult.output,
    },
  });
  const candidateJudgments = normalizeFinalization(callBResult.output, candidates, sourceUnits, {
    articleAuthors: article.authors ?? [],
  });
  const selectedAssertions = selectCf2Portfolio(candidateJudgments, sourceUnits);
  const attributionPackets = buildAttributionPackets(
    selectedAssertions,
    candidates,
    sourceUnits,
    article,
  );
  const callCPrompt = buildCf2AttributionPrompt({ article, packets: attributionPackets });
  const callCStarted = clock();
  const callCResult = await callCRunner.invokeStructured({
    ...callCPrompt,
    model: callCModel,
    reasoningEffort: "none",
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 5_000,
    store: false,
  });
  const callCFinished = clock();
  onProgress({
    stage: "call_c_completed",
    workItems: callCResult.output?.attributions?.length ?? null,
    call: {
      ...callMetadata(callCPrompt, callCResult, callCModel),
      elapsedMs: callCFinished.getTime() - callCStarted.getTime(),
      rawOutput: callCResult.output,
    },
  });
  const recoveredAttributions = normalizeAttributions(
    callCResult.output,
    attributionPackets,
    article,
  );
  const assertions = applyRecoveredAttributions(selectedAssertions, recoveredAttributions);
  const finishedAt = clock();
  return {
    architecture: "CF2_MINIMAL_FACT_DOCKET_V5_STRUCTURAL_ATTRIBUTION",
    article: {
      title: article.title,
      authors: article.authors ?? [],
      publisher: article.publisher ?? null,
      publishedAt: article.publishedAt ?? null,
      contentHash: article.contentHash,
      sourceUnitCount: sourceUnits.length,
    },
    thesisAssertion: discovery.thesisAssertion,
    candidates,
    candidateJudgments,
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
