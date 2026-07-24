// CF3 host: the deterministic pipeline from the CF1 Synthesis Architecture Proposal
// (2026-07-24) §5. Structural chunking, discovery merge/dedupe/global IDs, argument
// validation, mechanical scoreTransform, grounding join, and non-blocking findings.
// The host may not invent assertions, backfill, relink, run repair calls, or perform
// semantic selection. It only validates, dedupes, assigns IDs, joins by ID, and
// derives scoreTransform.
import { createHash } from "node:crypto";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  CF3_THESIS_EFFECTS,
  CF3_ARTICLE_TREATMENTS,
  CF3_SOURCE_KINDS,
  CF3_CITED_WORK_TYPES,
} from "./schemas.js";
import { buildCf3DiscoveryPrompt, buildCf3ArgumentPrompt } from "./prompts.js";

export const CF3_ARCHITECTURE = "CF3_SYNTHESIS_CHUNKED_ARGUMENT_V1";
export const CF3_DEFAULT_PORTFOLIO_SIZE = 12;
export const CF3_DEFAULT_CHUNK_COUNT = 4;
export const CF3_DEFAULT_CHUNK_OVERLAP = 0.1;

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase();
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function prepareCf3Article(rawArticle) {
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

// Split ordered source units into `count` contiguous core ranges, each extended by
// ~`overlap` of the core size into its neighbors. Returns chunks whose `units` carry
// the overlap (for context) but whose `coreUnitIds` mark the range a discovered
// assertion must ground within.
export function splitStructural(sourceUnits, {
  count = CF3_DEFAULT_CHUNK_COUNT,
  overlap = CF3_DEFAULT_CHUNK_OVERLAP,
} = {}) {
  const total = sourceUnits.length;
  if (total === 0) fail("CF3_EMPTY_ARTICLE", "Article produced no source units");
  const effectiveCount = Math.max(1, Math.min(count, total));
  const coreSize = Math.ceil(total / effectiveCount);
  const overlapSize = Math.round(coreSize * overlap);
  const chunks = [];
  for (let start = 0; start < total; start += coreSize) {
    const coreEnd = Math.min(total, start + coreSize);
    const from = Math.max(0, start - overlapSize);
    const to = Math.min(total, coreEnd + overlapSize);
    const units = sourceUnits.slice(from, to);
    chunks.push({
      chunkIndex: chunks.length + 1,
      coreStart: start,
      coreEnd,
      units,
      unitIds: new Set(units.map((unit) => unit.unitId)),
      coreUnitIds: new Set(sourceUnits.slice(start, coreEnd).map((unit) => unit.unitId)),
    });
  }
  const chunkCount = chunks.length;
  return chunks.map((chunk) => ({ ...chunk, chunkCount }));
}

// Validate one chunk's discovery output. Assertions whose grounding falls outside the
// chunk's unit range are dropped with a finding (never silently reassigned).
export function normalizeChunkDiscovery(output, chunk) {
  if (!output || typeof output !== "object" || Array.isArray(output)
    || !Array.isArray(output.challengedAssertions) || !Array.isArray(output.assertions)) {
    fail("CF3_INVALID_DISCOVERY",
      `Chunk ${chunk.chunkIndex} output must have challengedAssertions and assertions arrays`);
  }
  const findings = [];
  const assertions = [];
  // Challenged status is carried by which array an item is in (v2 schema has no
  // per-item boolean); the host tags it on ingest.
  const ingest = (raw, challenged) => {
    const assertionText = normalized(raw?.assertionText);
    if (!assertionText) {
      findings.push({ code: "CF3_DISCOVERY_EMPTY_ASSERTION", chunkIndex: chunk.chunkIndex });
      return;
    }
    const rawIds = Array.isArray(raw?.groundingUnitIds) ? raw.groundingUnitIds : [];
    const groundingUnitIds = [];
    let outOfRange = false;
    for (const id of rawIds) {
      if (!chunk.unitIds.has(id)) { outOfRange = true; break; }
      if (!groundingUnitIds.includes(id)) groundingUnitIds.push(id);
    }
    if (outOfRange || groundingUnitIds.length === 0) {
      findings.push({
        code: "CF3_GROUNDING_OUT_OF_CHUNK",
        chunkIndex: chunk.chunkIndex,
        assertionText,
        groundingUnitIds: rawIds,
      });
      return;
    }
    assertions.push({ assertionText, groundingUnitIds, challenged });
  };
  for (const raw of output.challengedAssertions) ingest(raw, true);
  for (const raw of output.assertions) ingest(raw, false);
  return { assertions, findings };
}

// Merge chunk assertions, dedupe exact + normalized, keep challenged=true on merge,
// union grounding, and assign stable global inventory IDs A001..A0nn.
export function buildInventory(chunkResults) {
  const byKey = new Map();
  const order = [];
  for (const result of chunkResults) {
    for (const assertion of result.assertions) {
      const key = normalizedKey(assertion.assertionText);
      const existing = byKey.get(key);
      if (existing) {
        existing.challenged = existing.challenged || assertion.challenged;
        for (const id of assertion.groundingUnitIds) {
          if (!existing.groundingUnitIds.includes(id)) existing.groundingUnitIds.push(id);
        }
        continue;
      }
      const entry = {
        assertionText: assertion.assertionText,
        groundingUnitIds: [...assertion.groundingUnitIds],
        challenged: assertion.challenged,
      };
      byKey.set(key, entry);
      order.push(entry);
    }
  }
  return order.map((entry, index) => ({
    assertionId: `A${String(index + 1).padStart(3, "0")}`,
    ...entry,
  }));
}

// adopted -> normal; challenged -> invert; reported -> by thesisEffect. §4 table.
export function deriveScoreTransform(articleTreatment, thesisEffect) {
  if (articleTreatment === "adopted") return "normal";
  if (articleTreatment === "challenged") return "invert";
  if (thesisEffect === "strengthens") return "normal";
  if (thesisEffect === "weakens") return "invert";
  return "none";
}

const NEGATIONS = /\b(?:not|no|never|without|fails?|failed|denies?|denied|refutes?|refuted|rejects?|rejected|disproves?|disproved|false|un\w+|isn't|aren't|wasn't|weren't|didn't|doesn't|don't|cannot|can't|no longer)\b/gi;
function negationCount(text) {
  return (String(text).match(NEGATIONS) ?? []).length;
}

// Generic descriptor words that are not, on their own, an attribution signal.
const GENERIC_SOURCE_WORDS = new Set([
  "author", "byline", "voice", "study", "studies", "report", "reports", "journal",
  "institution", "department", "agency", "office", "team", "group", "senior",
  "scientist", "researcher", "researchers", "doctor", "professor", "official",
  "officials", "whistleblower", "the", "and", "for", "our", "their",
]);

// Fusion detector: the final assertionText should carry no attribution — who supplies
// the claim belongs in assertionSource. When a distinctive token of the resolved
// source name still appears in the assertionText, the frame was fused in. Returns the
// matched token, or null.
export function attributionFusionToken(sourceName, assertionText) {
  if (!sourceName) return null;
  const distinctive = normalized(sourceName)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length >= 4 && !GENERIC_SOURCE_WORDS.has(word.toLowerCase()));
  for (const token of distinctive) {
    if (new RegExp(`\\b${token}\\b`, "i").test(assertionText)) return token;
  }
  return null;
}

// Reporting-verb residue: the syntactic complement of the fusion detector. The fusion
// detector keys on the source field, so it is blind exactly when the source is wrong.
// A reporting frame ("revealed", "according to X", …) left in assertionText is caught
// here regardless of what the source field says. Observation-only. Returns the matched
// verb/phrase, or null.
const REPORTING_RESIDUE = /\b(?:revealed|disclosed|claims?|claimed|said|says|according to|reports?|reported|announced|testified|argues?|argued|alleges?|alleged|stated|states|insists?|warned|admits?|admitted|acknowledged|asserts?|asserted)\b/i;
export function reportingResidueVerb(assertionText) {
  return (String(assertionText).match(REPORTING_RESIDUE) ?? [])[0] ?? null;
}

// Validate the single argument call and produce the final portfolio. Structural
// violations throw; the §5 quality checks (challenged retention, polarity, branch and
// quarter coverage) are recorded as non-blocking findings.
export function normalizeArgument(output, inventory, sourceUnits, portfolioSize) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    fail("CF3_INVALID_ARGUMENT", "Argument output must be an object");
  }
  const stanceAnchor = normalized(output.stanceAnchor);
  if (!stanceAnchor) fail("CF3_INVALID_STANCE", "Argument call omitted stanceAnchor");

  const inventoryById = new Map(inventory.map((item) => [item.assertionId, item]));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));

  const selectedIds = Array.isArray(output.selectedAssertionIds) ? output.selectedAssertionIds : [];
  if (selectedIds.length !== portfolioSize) {
    fail("CF3_SELECTION_COUNT",
      `Expected ${portfolioSize} selectedAssertionIds, received ${selectedIds.length}`);
  }
  const uniqueSelected = new Set(selectedIds);
  if (uniqueSelected.size !== selectedIds.length) {
    fail("CF3_SELECTION_DUPLICATE", "selectedAssertionIds contains duplicates");
  }
  for (const id of selectedIds) {
    if (!inventoryById.has(id)) fail("CF3_UNKNOWN_ASSERTION", `selectedAssertionIds references ${id}`);
  }

  const labeled = Array.isArray(output.selectedAssertions) ? output.selectedAssertions : [];
  const labeledIds = new Set(labeled.map((item) => item?.assertionId));
  if (labeledIds.size !== selectedIds.length
    || ![...uniqueSelected].every((id) => labeledIds.has(id))) {
    fail("CF3_SELECTION_MISMATCH", "selectedAssertions ids must equal selectedAssertionIds");
  }

  const findings = [];
  const assertions = [];
  for (const raw of labeled) {
    const inventoryItem = inventoryById.get(raw.assertionId);
    const thesisEffect = raw.thesisEffect;
    const articleTreatment = raw.articleTreatment;
    if (!CF3_THESIS_EFFECTS.includes(thesisEffect)) {
      fail("CF3_INVALID_ENUM", `${raw.assertionId} thesisEffect ${thesisEffect}`);
    }
    if (!CF3_ARTICLE_TREATMENTS.includes(articleTreatment)) {
      fail("CF3_INVALID_ENUM", `${raw.assertionId} articleTreatment ${articleTreatment}`);
    }
    const source = raw.assertionSource ?? {};
    if (!CF3_SOURCE_KINDS.includes(source.kind)) {
      fail("CF3_INVALID_ENUM", `${raw.assertionId} assertionSource.kind ${source.kind}`);
    }
    const citedWorks = Array.isArray(raw.citedWorks) ? raw.citedWorks : [];
    for (const work of citedWorks) {
      if (!CF3_CITED_WORK_TYPES.includes(work?.type)) {
        fail("CF3_INVALID_ENUM", `${raw.assertionId} citedWorks.type ${work?.type}`);
      }
    }
    const finalText = normalized(raw.testableAssertion);
    if (!finalText) fail("CF3_INVALID_ASSERTION", `${raw.assertionId} has empty testableAssertion`);

    // Verbatim-copy spot-check: testableAssertion should be a fresh statement, not the
    // echoed inventory text (the A009 echo failure mode). Whitespace-normalized compare.
    if (normalizedKey(finalText) === normalizedKey(inventoryItem.assertionText)) {
      findings.push({
        code: "CF3_ASSERTION_VERBATIM_COPY",
        assertionId: raw.assertionId,
        inventoryText: inventoryItem.assertionText,
        finalText,
      });
    }

    // Polarity spot-check: heuristic negation-parity mismatch is a review flag only.
    if ((negationCount(inventoryItem.assertionText) % 2) !== (negationCount(finalText) % 2)) {
      findings.push({
        code: "CF3_POLARITY_FLIP_SUSPECTED",
        assertionId: raw.assertionId,
        inventoryText: inventoryItem.assertionText,
        finalText,
      });
    }

    // Fusion spot-check: the resolved source name should not remain inside assertionText.
    const sourceName = source.name === null || source.name === undefined
      ? null : normalized(source.name);
    const fusedToken = source.kind === "unknown"
      ? null : attributionFusionToken(sourceName, finalText);
    if (fusedToken) {
      findings.push({
        code: "CF3_SOURCE_FUSED",
        assertionId: raw.assertionId,
        sourceName,
        matchedToken: fusedToken,
        finalText,
      });
    }

    // Reporting-verb residue: observation-only, independent of the source field.
    const residueVerb = reportingResidueVerb(finalText);
    if (residueVerb) {
      findings.push({
        code: "CF3_REPORTING_RESIDUE",
        assertionId: raw.assertionId,
        matchedVerb: residueVerb,
        finalText,
      });
    }

    assertions.push({
      assertionId: raw.assertionId,
      testableAssertion: finalText,
      thesisEffect,
      articleTreatment,
      assertionSource: {
        name: sourceName,
        kind: source.kind,
        sourceUnitIds: Array.isArray(source.sourceUnitIds) ? source.sourceUnitIds : [],
      },
      argumentBranchId: normalized(raw.argumentBranchId),
      citedWorks: citedWorks.map((work) => ({
        name: normalized(work.name),
        type: work.type,
        sourceUnitIds: Array.isArray(work.sourceUnitIds) ? work.sourceUnitIds : [],
      })),
      scoreTransform: deriveScoreTransform(articleTreatment, thesisEffect),
      // Host join: grounding comes from the inventory by ID; the model does not re-emit it.
      groundingUnitIds: inventoryItem.groundingUnitIds,
      inventoryAssertionText: inventoryItem.assertionText,
      challenged: inventoryItem.challenged,
    });
  }

  // Challenged retention: every inventory item flagged challenged should survive.
  for (const item of inventory) {
    if (item.challenged && !uniqueSelected.has(item.assertionId)) {
      findings.push({ code: "CF3_CHALLENGED_DROPPED", assertionId: item.assertionId,
        assertionText: item.assertionText });
    }
  }

  // Branch concentration: warn when a single branch dominates the portfolio.
  const branchCounts = new Map();
  for (const assertion of assertions) {
    branchCounts.set(assertion.argumentBranchId,
      (branchCounts.get(assertion.argumentBranchId) ?? 0) + 1);
  }
  for (const [branchId, occurrences] of branchCounts) {
    if (occurrences > portfolioSize / 2) {
      findings.push({ code: "CF3_BRANCH_CONCENTRATION", branchId, occurrences });
    }
  }

  // Quarter coverage: distribution of the selected portfolio across article quarters.
  const total = sourceUnits.length;
  const quarters = [0, 0, 0, 0];
  for (const assertion of assertions) {
    const orders = assertion.groundingUnitIds
      .map((id) => unitOrder.get(id)).filter(Number.isInteger);
    if (orders.length === 0) continue;
    const mean = orders.reduce((sum, value) => sum + value, 0) / orders.length;
    const quarter = Math.min(3, Math.floor((mean / total) * 4));
    quarters[quarter] += 1;
  }

  const branches = (Array.isArray(output.argumentBranches) ? output.argumentBranches : [])
    .map((branch) => ({
      branchId: normalized(branch.branchId),
      branchQuestion: normalized(branch.branchQuestion),
    }));

  return { stanceAnchor, assertions, branches, findings, quarterDistribution: quarters };
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

export async function runCf3({
  rawArticle,
  discoveryRunner,
  argumentRunner,
  discoveryModel = "gpt-4o-mini",
  argumentModel = "gpt-4.1-mini",
  argumentReasoningEffort = "none",
  argumentMaxOutputTokens = 4_000,
  selectionMode = "balanced",
  portfolioSize = CF3_DEFAULT_PORTFOLIO_SIZE,
  chunkCount = CF3_DEFAULT_CHUNK_COUNT,
  chunkOverlap = CF3_DEFAULT_CHUNK_OVERLAP,
  timeoutMs = 180_000,
  seed = undefined,
  clock = () => new Date(),
}) {
  const startedAt = clock();
  const { article, sourceUnits } = prepareCf3Article(rawArticle);
  const chunks = splitStructural(sourceUnits, { count: chunkCount, overlap: chunkOverlap });

  // Four parallel discovery calls, one per chunk.
  const discoveryPrompts = chunks.map((chunk) => buildCf3DiscoveryPrompt({ chunk }));
  const discoveryStarted = clock();
  const discoveryResults = await Promise.all(discoveryPrompts.map((prompt) =>
    discoveryRunner.invokeStructured({
      ...prompt,
      model: discoveryModel,
      temperature: 0.2,
      ...(Number.isInteger(seed) ? { seed } : {}),
      timeoutMs,
      maximumAttempts: 1,
      maxOutputTokens: 5_000,
    })));
  const discoveryFinished = clock();

  const chunkResults = chunks.map((chunk, index) =>
    normalizeChunkDiscovery(discoveryResults[index].output, chunk));
  const discoveryFindings = chunkResults.flatMap((result) => result.findings);
  const inventory = buildInventory(chunkResults);
  if (inventory.length < portfolioSize) {
    fail("CF3_INVENTORY_TOO_SMALL",
      `Inventory has ${inventory.length} assertions; need at least ${portfolioSize}`);
  }

  // One batch argument call: full article + complete inventory.
  const argumentPrompt = buildCf3ArgumentPrompt({ article, sourceUnits, inventory, portfolioSize, selectionMode });
  const argumentStarted = clock();
  const argumentResult = await argumentRunner.invokeStructured({
    ...argumentPrompt,
    model: argumentModel,
    reasoningEffort: argumentReasoningEffort,
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: argumentMaxOutputTokens,
    store: false,
  });
  const argumentFinished = clock();

  const mapped = normalizeArgument(argumentResult.output, inventory, sourceUnits, portfolioSize);
  const finishedAt = clock();

  return {
    architecture: CF3_ARCHITECTURE,
    portfolioSize,
    article: {
      title: article.title,
      authors: article.authors ?? [],
      publisher: article.publisher ?? null,
      publishedAt: article.publishedAt ?? null,
      contentHash: article.contentHash,
      sourceUnitCount: sourceUnits.length,
    },
    chunking: {
      chunkCount: chunks.length,
      overlap: chunkOverlap,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        unitCount: chunk.units.length,
        coreRange: [chunk.coreStart, chunk.coreEnd],
      })),
    },
    stanceAnchor: mapped.stanceAnchor,
    inventory,
    assertions: mapped.assertions,
    argumentBranches: mapped.branches,
    findings: [...discoveryFindings, ...mapped.findings],
    quarterDistribution: mapped.quarterDistribution,
    calls: {
      discovery: chunks.map((chunk, index) => ({
        chunkIndex: chunk.chunkIndex,
        ...callMetadata(discoveryPrompts[index], discoveryResults[index], discoveryModel),
        prompt: discoveryPrompts[index],
        rawOutput: discoveryResults[index].output,
      })),
      discoveryElapsedMs: discoveryFinished.getTime() - discoveryStarted.getTime(),
      argument: {
        ...callMetadata(argumentPrompt, argumentResult, argumentModel),
        elapsedMs: argumentFinished.getTime() - argumentStarted.getTime(),
        prompt: argumentPrompt,
        rawOutput: argumentResult.output,
      },
    },
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    generatedAt: finishedAt.toISOString(),
  };
}
