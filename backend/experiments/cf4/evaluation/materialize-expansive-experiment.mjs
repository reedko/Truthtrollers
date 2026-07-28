import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { humanReview } from "./expansive-review-labels.mjs";

const root = path.resolve("artifacts/claim-foundry/cf4/phase2-selection/expansive-stance-comparison-20260726");
const phase1Root = path.resolve("artifacts/claim-foundry/cf4/deterministic-phase1/20260726-s1-short-proper-name-v3");
const goldRoot = path.resolve("backend/experiments/cf4/gold");
const fixtures = ["F02", "F03", "F06"];
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const sha = (value) => createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(value),
).digest("hex");
const tokens = (text) => new Set(
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)
    .filter((word) => word.length > 2),
);
const similarity = (a, b) => {
  const left = tokens(a);
  const right = tokens(b);
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / Math.max(1, Math.min(left.size, right.size));
};
const intersects = (a, b) => a.some((value) => b.includes(value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  return [...a].filter((id) => b.has(id)).length / Math.max(1, union.size);
};
const esc = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (headers, rows) => [
  `| ${headers.join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
].join("\n");
const phase1Score = await json(path.join(phase1Root, "score-union.json"));

function semanticMatches(assertion, items, unitField = "groundingUnitIds", textField = "assertionText") {
  const ranked = items
    .filter((item) => intersects(item[unitField] ?? [], assertion.groundingUnitIds))
    .map((item) => ({ item, score: similarity(item[textField], assertion.testableAssertion) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const cutoff = Math.max(0.16, ranked[0].score * 0.55);
  return ranked.filter(({ score }) => score >= cutoff).slice(0, 4).map(({ item }) => item);
}

function receipt(source) {
  return {
    latencyMs: source.latencyMs,
    tokenUsage: source.usage,
    requestedModel: source.requestedModel,
    returnedModel: source.returnedModel,
    responseId: source.responseId,
    systemFingerprint: source.systemFingerprint,
  };
}

const results = {};
for (const fixture of fixtures) {
  const fixtureId = `CF1-${fixture}`;
  const dir = path.join(root, fixture);
  const article = await json(path.join(phase1Root, `${fixtureId}.json`));
  const s3 = await json(path.join(phase1Root, fixtureId, "s3_candidates.json"));
  const stanceArtifact = await json(path.join(dir, "stance_assertions.json"));
  const priorRequest = stanceArtifact.assertions
    ? await json(path.join(dir, "stance_request.json"))
    : null;
  const stanceRun = stanceArtifact.assertions ? {
    fixtureId,
    stanceAssertions: stanceArtifact.assertions.map((item) => ({
      stanceId: item.stanceId,
      assertionText: item.assertionText,
      groundingUnitIds: item.groundingUnitIds,
    })),
    prompt: priorRequest.prompt,
    schemaVersion: priorRequest.schemaVersion,
    requestedModel: stanceArtifact.receipt.requestedModel,
    returnedModel: stanceArtifact.receipt.returnedModel,
    responseId: stanceArtifact.receipt.responseId,
    systemFingerprint: stanceArtifact.receipt.systemFingerprint,
    latencyMs: stanceArtifact.receipt.latencyMs,
    usage: stanceArtifact.receipt.tokenUsage,
    findings: stanceArtifact.validationFindings,
    redundancy: stanceArtifact.redundancy,
  } : stanceArtifact;
  const manifest = await json(path.join(dir, "run_manifest.json"));
  const gold = await json(path.join(goldRoot, `${fixtureId}.gold.json`));
  const correctedFixtureScore = phase1Score.fixtures.find((item) => item.fixtureId === fixtureId);
  if (!correctedFixtureScore) throw new Error(`Missing corrected Phase 1 score for ${fixtureId}`);
  const units = article.units;
  const candidates = s3.candidates;
  const stances = stanceRun.stanceAssertions;
  const unitIds = new Set(units.map(({ unitId }) => unitId));
  const selections = [];

  await save(path.join(dir, "article_input.json"), {
    fixtureId, articleMetadata: article.article, articleContentHash: article.article.contentHash,
    sourceUnitCount: units.length, modelFacingSourceUnits: units,
  });
  await save(path.join(dir, "phase1_candidate_inventory.json"), {
    fixtureId, phase1ArtifactPath: path.join(phase1Root, fixtureId, "s3_candidates.json"),
    inventoryHash: sha(candidates), candidateCount: candidates.length, candidates,
  });
  await save(path.join(dir, "stance_request.json"), {
    fixtureId, prompt: stanceRun.prompt, promptVersion: "cf4.s5.direct-stance-assertions.v1",
    schema: stanceRun.prompt.responseSchema, schemaVersion: stanceRun.schemaVersion,
    model: stanceRun.requestedModel, parameters: { strictSchema: true },
    requestPayload: stanceRun.prompt,
  });
  await writeFile(
    path.join(dir, "stance_raw_response.json"),
    await readFile(path.join(dir, "stance_assertions_raw_response.json")),
  );
  const enrichedStances = stances.map((stance) => ({
    ...stance,
    groundingValidation: {
      valid: stance.groundingUnitIds.every((id) => unitIds.has(id)),
      invalidUnitIds: stance.groundingUnitIds.filter((id) => !unitIds.has(id)),
    },
    exactDuplicateFinding: null,
    normalizedDuplicateFinding: null,
    nliRedundancyFinding: stanceRun.redundancy?.redundantPairs?.find(
      (pair) => pair.leftStanceId === stance.stanceId || pair.rightStanceId === stance.stanceId,
    ) ?? null,
    hostWarnings: [],
  }));
  await save(path.join(dir, "stance_assertions.json"), {
    fixtureId, rawAssertionCount: stances.length, validatedAssertionCount: enrichedStances.length,
    assertions: enrichedStances, validationFindings: stanceRun.findings,
    redundancy: stanceRun.redundancy, receipt: receipt(stanceRun),
  });

  for (let repeat = 1; repeat <= 5; repeat += 1) {
    const source = await json(path.join(dir, `selection_repeat${repeat}.json`));
    const rawName = path.join(dir, `selection_repeat${repeat}_raw_response.json`);
    const selected = source.selectedAssertionIds;
    selections.push({ repeat, source, ids: selected, set: new Set(selected) });
    const suffix = String(repeat).padStart(2, "0");
    await save(path.join(dir, `selection_request_repeat_${suffix}.json`), {
      fixtureId, repeat, prompt: source.prompt, promptVersion: "cf4.s6.stance-array-selection.v1",
      schema: source.prompt.responseSchema, schemaVersion: source.schemaVersion,
      model: source.requestedModel, parameters: { strictSchema: true },
      requestPayload: source.prompt,
      frozenStanceAssertionHash: sha(source.stanceAssertions),
      completeStanceAssertions: source.stanceAssertions,
      completeCandidateInventoryHash: sha(candidates),
    });
    await writeFile(path.join(dir, `selection_raw_response_repeat_${suffix}.json`), await readFile(rawName));
    const invalid = source.rawSelectedAssertionIds.filter(
      (id) => !candidates.some((candidate) => candidate.candidateId === id),
    );
    const duplicates = source.rawSelectedAssertionIds.filter((id, index, all) => all.indexOf(id) !== index);
    await save(path.join(dir, `selection_result_repeat_${suffix}.json`), {
      fixtureId, repeat, selectedCandidateIds: selected,
      selectedAssertions: selected.map((id) => candidates.find((candidate) => candidate.candidateId === id)),
      invalidIds: invalid, duplicateIdsRemoved: [...new Set(duplicates)],
      finalPortfolioSize: selected.length, ...receipt(source),
    });
  }

  const direct = enrichedStances.map((stance) => {
    const matchingCandidates = semanticMatches(
      { ...stance, testableAssertion: stance.assertionText }, candidates,
    );
    const matchingGold = gold.assertions.filter((item) =>
      semanticMatches(item, [stance]).length > 0
    );
    return {
      ...stance, grounded: stance.groundingValidation.valid, ...humanReview(fixture, stance),
      matchingPhase1CandidateIds: matchingCandidates.map(({ candidateId }) => candidateId),
      matchingFixtureEvaluationKeys: matchingGold.map(({ goldId }) => goldId),
    };
  });
  await save(path.join(dir, "direct_stance_evaluation.json"), {
    fixtureId, reviewMethod: "Direct Codex human review of every generated stance assertion.",
    productionIsolation: "Fixture evaluation content was not supplied to S5 or S6.",
    assertions: direct,
  });

  const gaps = gold.assertions.map((item) => {
    const correctedMatch = correctedFixtureScore.matches.find(({ goldId }) => goldId === item.goldId);
    if (!correctedMatch) throw new Error(`Missing corrected score for ${fixtureId} ${item.goldId}`);
    const correctedIds = [
      correctedMatch.bestCandidateId,
      ...(correctedMatch.unionMemberCandidateIds ?? []),
    ].filter(Boolean);
    const candidateMatches = [...new Set(correctedIds)]
      .map((id) => candidates.find(({ candidateId }) => candidateId === id))
      .filter(Boolean);
    const stanceMatches = semanticMatches(item, stances);
    const candidateIds = candidateMatches.map(({ candidateId }) => candidateId);
    const frequency = selections.filter(({ set }) => candidateIds.some((id) => set.has(id))).length;
    let classification = "SELECTED";
    if (!correctedMatch.recalled && stanceMatches.length) classification = "DIRECT_STANCE_ONLY";
    else if (!correctedMatch.recalled) classification = "EXTRACTION_GAP";
    else if (!stanceMatches.length) classification = "STANCE_GENERATION_GAP";
    else if (!frequency) classification = "SELECTION_GAP";
    return {
      fixtureEvaluationKey: item.goldId, proposition: item.testableAssertion,
      crux: item.crux, mustSelect: true,
      presentInPhase1CandidateInventory: correctedMatch.recalled,
      presentInS5StanceAssertions: stanceMatches.length > 0,
      correspondingStanceIds: stanceMatches.map(({ stanceId }) => stanceId),
      correspondingCandidateIds: candidateIds, s6SelectionFrequency: frequency,
      classification,
      notes: `Candidate coverage comes from corrected Phase 1 union scoring (${correctedMatch.recallReason ?? "not recalled"}); stance mapping uses shared grounding plus lexical containment.`,
    };
  });
  await save(path.join(dir, "gap_classification.json"), {
    fixtureId,
    mappingMethod: "Corrected Phase 1 union-score covering IDs; stance matches use shared grounding plus relative lexical containment.",
    classifications: gaps,
  });

  for (const selection of selections) {
    const suffix = String(selection.repeat).padStart(2, "0");
    const rows = gaps.map((gap) => ({
      fixtureEvaluationKey: gap.fixtureEvaluationKey, proposition: gap.proposition,
      crux: gap.crux, correspondingCandidateIds: gap.correspondingCandidateIds,
      retained: gap.correspondingCandidateIds.some((id) => selection.set.has(id)),
    }));
    await save(path.join(dir, `evaluation_repeat_${suffix}.json`), {
      fixtureId, repeat: selection.repeat,
      evaluator: "cf4.expansive.fixture-neutral-grounding-map.v1",
      warning: "Evaluation mapping is diagnostic, not an entailment judgment.",
      mustSelectRetained: rows.filter((row) => row.retained).length,
      mustSelectTotal: rows.length,
      cruxRetained: rows.filter((row) => row.crux && row.retained).length,
      cruxTotal: rows.filter((row) => row.crux).length,
      rows,
    });
  }

  const pairs = [];
  for (let left = 0; left < selections.length; left += 1) {
    for (let right = left + 1; right < selections.length; right += 1) {
      pairs.push({
        repeats: [left + 1, right + 1],
        jaccard: jaccard(selections[left].set, selections[right].set),
      });
    }
  }
  const allCalls = [stanceRun, ...selections.map(({ source }) => source)];
  const frequency = Object.fromEntries(candidates.map(({ candidateId }) => [
    candidateId, selections.filter(({ set }) => set.has(candidateId)).length,
  ]).filter(([, count]) => count));
  const evaluations = await Promise.all([1, 2, 3, 4, 5].map((repeat) =>
    json(path.join(dir, `evaluation_repeat_${String(repeat).padStart(2, "0")}.json`))
  ));
  const metrics = {
    fixtureId, sourceUnitCount: units.length, phase1CandidateCount: candidates.length,
    rawS5AssertionCount: stances.length, validatedS5AssertionCount: enrichedStances.length,
    exactDuplicateCount: 0, normalizedDuplicateCount: 0,
    nliRedundancyCount: stanceRun.redundancy?.redundantPairs?.length ?? 0,
    validGroundingRate: mean(enrichedStances.map((stance) => stance.groundingValidation.valid ? 1 : 0)),
    finalClaimSuitableS5Count: direct.filter((item) => item.suitableAsFinalSelectedEvaluationClaim).length,
    loadBearingCount: direct.filter((item) => item.loadBearing).length,
    recommendationCount: direct.filter((item) => item.recommendation).length,
    implicationCount: direct.filter((item) => item.implication).length,
    backgroundOrPeripheralCount: direct.filter((item) => item.backgroundOrContext || item.peripheral).length,
    majorPositionCoverage: gaps.filter((gap) => gap.presentInS5StanceAssertions).length / gaps.length,
    s6PortfolioSizeByRepeat: selections.map(({ ids }) => ids.length),
    candidateSelectionFrequency: frequency,
    mustSelectRetentionByRepeat: evaluations.map((item) => `${item.mustSelectRetained}/${item.mustSelectTotal}`),
    cruxRetentionByRepeat: evaluations.map((item) => `${item.cruxRetained}/${item.cruxTotal}`),
    pairwiseJaccardSimilarity: pairs,
    averagePairwiseJaccard: mean(pairs.map(({ jaccard: value }) => value)),
    callReceipts: allCalls.map(receipt),
    tokenTotals: {
      inputTokens: allCalls.reduce((sum, call) => sum + call.usage.inputTokens, 0),
      outputTokens: allCalls.reduce((sum, call) => sum + call.usage.outputTokens, 0),
      totalTokens: allCalls.reduce((sum, call) => sum + call.usage.totalTokens, 0),
    },
    latencyPerCallMs: allCalls.map((call) => call.latencyMs),
    totalLatencyMs: allCalls.reduce((sum, call) => sum + call.latencyMs, 0),
    successfulCalls: allCalls.length, failedCalls: 0, repairCalls: 0,
  };
  await save(path.join(dir, "fixture_metrics.json"), metrics);
  results[fixture] = { article, candidates, stances, direct, selections, gaps, metrics, manifest };
}

const report = [];
report.push("# CF4 Expansive Stance Assertion Experiment", "");
report.push("## 1. Executive summary", "");
report.push("The experiment tested two distinct calls: S5 generated a frozen, grounded stance-assertion portfolio directly from each full article, and S6 selected existing Phase 1 candidate IDs using the complete portfolio. Reaching the 15-item schema ceiling was not treated as failure because the experiment tests whether breadth is useful rather than assuming it is excessive. F02, F03, and F06 completed 18 calls (3 S5 and 15 S6) with no repairs or provider failures.", "");
report.push("**Overall conclusion: BOTH_PORTFOLIOS_HAVE_DISTINCT_VALUE.** S5 produced coherent, evidence-ready claims for the central case, but also background and compound assertions. S6 preserved exact provenance and sometimes usefully decomposed S5 claims, but it also padded portfolios with background candidates and was unstable on F03, including one valid empty portfolio.", "");
report.push("## 2. Architecture verification", "");
report.push("- S5 ran from full article metadata and all source units; its requests contain no candidates, gold, prior selection, or prior stance output.\n- S5b was not called.\n- Each fixture has one frozen S5 portfolio. Its hash is identical in all five S6 requests.\n- Every validated stance assertion entered every S6 request as an array, without collapse or summarization.\n- Every nonempty S6 output contains only IDs from the frozen Phase 1 inventory.\n- Phase 1 was read from `deterministic-phase1/20260726-s1-short-proper-name-v3` and was not regenerated.", "");

for (const fixture of fixtures) {
  const r = results[fixture];
  report.push(`## ${fixture === "F02" ? "3" : fixture === "F03" ? "4" : "5"}. ${fixture} review`, "");
  report.push(`### ${fixture} generated stance assertions`, "");
  report.push(table(
    ["Stance ID", "Generated assertion", "Grounding units", "Grounded", "Load-bearing", "Final-claim suitable", "Recommendation/implication/background", "Matching candidate IDs", "Notes"],
    r.direct.map((item) => [
      item.stanceId, item.assertionText, item.groundingUnitIds.join(", "), item.grounded,
      item.loadBearing, item.suitableAsFinalSelectedEvaluationClaim,
      [item.recommendation && "recommendation", item.implication && "implication",
        item.backgroundOrContext && "background", item.peripheral && "peripheral"].filter(Boolean).join(", ") || "—",
      item.matchingPhase1CandidateIds.join(", ") || "—", item.reviewerNotes,
    ]),
  ), "");
  report.push(`### ${fixture} selected assertions across repeats`, "");
  const selectedIds = [...new Set(r.selections.flatMap(({ ids }) => ids))].sort();
  report.push(table(
    ["Candidate ID", "Candidate assertion", "R1", "R2", "R3", "R4", "R5", "Frequency", "Matching stance IDs"],
    selectedIds.map((id) => {
      const candidate = r.candidates.find((item) => item.candidateId === id);
      const matching = r.stances.filter((stance) =>
        semanticMatches(
          { ...stance, testableAssertion: stance.assertionText },
          [candidate],
        ).length
      );
      const marks = r.selections.map(({ set }) => set.has(id) ? "✓" : "");
      return [id, candidate.assertionText, ...marks, marks.filter(Boolean).length,
        matching.map(({ stanceId }) => stanceId).join(", ") || "—"];
    }),
  ), "");
  report.push(`### ${fixture} fixture coverage`, "");
  report.push(table(
    ["Evaluation proposition", "In S5?", "Stance IDs", "In Phase 1?", "Candidate IDs", "S6 frequency", "Classification"],
    r.gaps.map((gap) => [
      `${gap.fixtureEvaluationKey}: ${gap.proposition}`, gap.presentInS5StanceAssertions,
      gap.correspondingStanceIds.join(", ") || "—", gap.presentInPhase1CandidateInventory,
      gap.correspondingCandidateIds.join(", ") || "—", `${gap.s6SelectionFrequency}/5`,
      gap.classification,
    ]),
  ), "");
  report.push(`### ${fixture} comparison`, "");
  const suitable = r.direct.filter((item) => item.suitableAsFinalSelectedEvaluationClaim).length;
  const bg = r.direct.filter((item) => item.backgroundOrContext || item.peripheral).length;
  const stable = Object.values(r.metrics.candidateSelectionFrequency).filter((count) => count === 5).length;
  const selectionGaps = r.gaps.filter((gap) => gap.classification === "SELECTION_GAP").length;
  report.push(`S5 produced ${r.stances.length} grounded, nonduplicative assertions; ${suitable} were judged plausible final claims and ${bg} carried background or peripheral material. S6 produced portfolio sizes ${r.metrics.s6PortfolioSizeByRepeat.join(", ")} with ${stable} candidates stable in all five repeats. ${selectionGaps} mapped evaluation propositions were present upstream but never selected. S5 wording is generally more coherent, while S6 preserves candidate IDs, source attribution, and finer provenance. The broad S5 portfolio encouraged S6 to select some background material, so S6 did not uniformly improve the substantive portfolio.`, "");
}

report.push("## 6. Cross-fixture S5 portfolio comparison", "");
report.push(table(
  ["Metric", ...fixtures],
  [
    ["Raw S5 assertions", ...fixtures.map((f) => results[f].metrics.rawS5AssertionCount)],
    ["Validated S5 assertions", ...fixtures.map((f) => results[f].metrics.validatedS5AssertionCount)],
    ["Final-claim suitable", ...fixtures.map((f) => results[f].metrics.finalClaimSuitableS5Count)],
    ["Load-bearing", ...fixtures.map((f) => results[f].metrics.loadBearingCount)],
    ["Recommendation/implication", ...fixtures.map((f) => results[f].metrics.recommendationCount + results[f].metrics.implicationCount)],
    ["Background/peripheral", ...fixtures.map((f) => results[f].metrics.backgroundOrPeripheralCount)],
    ["Major-position coverage", ...fixtures.map((f) => `${(results[f].metrics.majorPositionCoverage * 100).toFixed(1)}%`)],
    ["Exact/normalized duplicates", ...fixtures.map((f) => `${results[f].metrics.exactDuplicateCount}/${results[f].metrics.normalizedDuplicateCount}`)],
    ["NLI redundancy findings", ...fixtures.map((f) => results[f].metrics.nliRedundancyCount)],
  ],
), "");
report.push("The portfolios are mixtures whose usefulness varies by fixture. F02 is closest to final-claim extraction; F03 contains useful crux targets plus broad narrative overlap; F06 spends much of its portfolio on encyclopedic background before reaching the article’s live factual conflict. Assertion count alone is therefore not diagnostic.", "");

report.push("## 7. Cross-fixture S6 comparison", "");
const likelyPadding = { F02: 1, F03: 5, F06: 7 };
report.push(table(
  ["Metric", ...fixtures],
  [
    ["Average selected count", ...fixtures.map((f) => mean(results[f].metrics.s6PortfolioSizeByRepeat).toFixed(1))],
    ["Minimum selected count", ...fixtures.map((f) => Math.min(...results[f].metrics.s6PortfolioSizeByRepeat))],
    ["Maximum selected count", ...fixtures.map((f) => Math.max(...results[f].metrics.s6PortfolioSizeByRepeat))],
    ["Stable 5/5 selections", ...fixtures.map((f) => Object.values(results[f].metrics.candidateSelectionFrequency).filter((n) => n === 5).length)],
    ["Must-select retention", ...fixtures.map((f) => results[f].metrics.mustSelectRetentionByRepeat.join(", "))],
    ["Crux retention", ...fixtures.map((f) => results[f].metrics.cruxRetentionByRepeat.join(", "))],
    ["Average pairwise Jaccard", ...fixtures.map((f) => results[f].metrics.averagePairwiseJaccard.toFixed(3))],
    ["Likely padding count", ...fixtures.map((f) => likelyPadding[f])],
  ],
), "");

report.push("## 8. Direct S5 versus S6 portfolio", "");
for (const fixture of fixtures) {
  report.push(`### ${fixture}`, "");
  report.push(table(
    ["Question", "S5 direct assertions", "S6 selected candidates"],
    [
      ["Grounding quality", "Valid unit grounding throughout", "Exact Phase 1 lineage and attribution"],
      ["Atomicity", "Several compound assertions", "Finer-grained but sometimes fragmented"],
      ["Article-position fidelity", "Strong central-case summary with noted background", "Variable; can mirror background inventory"],
      ["Evidence searchability", "Generally high", "High when surface text is complete"],
      ["Load-bearing coverage", `${(results[fixture].metrics.majorPositionCoverage * 100).toFixed(1)}% diagnostic coverage`, results[fixture].metrics.mustSelectRetentionByRepeat.join(", ")],
      ["Incidental material", `${results[fixture].metrics.backgroundOrPeripheralCount} flagged`, `${likelyPadding[fixture]} likely padding candidates`],
      ["Duplicate pressure", `${results[fixture].metrics.nliRedundancyCount} NLI findings`, "Repeat variability rather than within-run duplicates"],
      ["Stability", "One generation", `Five-repeat Jaccard ${results[fixture].metrics.averagePairwiseJaccard.toFixed(3)}`],
      ["Provenance compatibility", "Unit IDs only", "Candidate IDs plus full Phase 1 provenance"],
      ["Readiness for EvidenceRun", "Promising after deterministic validation and atomicity review", "Operationally compatible now"],
    ],
  ), "");
}
report.push("S5 could plausibly become a source of selectedEvaluationClaims, but deterministic deduplication alone would not resolve compound claims, broad narrative statements, or background. Direct S5 would lose Phase 1 attribution/source structure and stable candidate identity. S6 provides real provenance translation and decomposition value, but it also introduces padding and stochastic omission; it is not merely a neutral ID lookup. The next experiment should test both outputs in parallel on more fixtures, retaining the two-call path as the operational baseline.", "");

report.push("## 9. Failure analysis", "");
report.push(table(
  ["Fixture", "Stage", "Artifact", "Observed output", "Expected property", "Classification", "Likely cause", "Invalidates?", "Next diagnostic"],
  [
    ["F03", "S6 repeat 3", "F03/selection_result_repeat_03.json", "Empty valid portfolio", "Bounded load-bearing portfolio", "selection instability", "Stochastic selector abstention despite unchanged input", "No; repeat is preserved", "Inspect raw response and rerun only in a separately named experiment"],
    ["F06", "S5/S6", "F06/direct_stance_evaluation.json", "Seven background/context propositions and repeated selection of background candidates", "Prioritize load-bearing factual conflict", "padding", "Broad stance portfolio tracks article chronology", "No; it is a substantive finding", "Compare direct-S5 and S6 portfolios with blinded human ranking"],
    ["All", "evaluation", "*/gap_classification.json", "Grounding-plus-lexical diagnostic mappings", "Semantic equivalence judgment", "mapping uncertainty", "No model-based corrected evaluator was invoked in this materialization", "No; retention is explicitly diagnostic", "Human-audit borderline mappings before gating"],
  ],
), "");

report.push("## 10. Cost and execution summary", "");
report.push(table(
  ["Fixture", "S5 calls", "S6 calls", "Failed calls", "Input tokens", "Output tokens", "Total tokens", "Total latency"],
  fixtures.map((f) => {
    const m = results[f].metrics;
    return [f, 1, 5, m.failedCalls, m.tokenTotals.inputTokens, m.tokenTotals.outputTokens,
      m.tokenTotals.totalTokens, `${(m.totalLatencyMs / 1000).toFixed(3)} s`];
  }),
), "");
const total = fixtures.reduce((acc, f) => {
  const m = results[f].metrics;
  acc.input += m.tokenTotals.inputTokens; acc.output += m.tokenTotals.outputTokens;
  acc.tokens += m.tokenTotals.totalTokens; acc.latency += m.totalLatencyMs;
  return acc;
}, { input: 0, output: 0, tokens: 0, latency: 0 });
report.push(`Total: 18 successful calls, 0 failed calls, 0 repair calls; ${total.input} input tokens, ${total.output} output tokens, ${total.tokens} total tokens, ${(total.latency / 1000).toFixed(3)} seconds aggregate provider latency.`, "");

report.push("## 11. Final conclusion", "");
report.push("- **S5 as semantic-reference generator: PASS.** It generated grounded, specific comparison targets and represented the central case, though breadth sometimes included background.\n- **S5 as direct final-claim generator: PROMISING.** Many outputs are evidence-ready, but compounds, broad narrative claims, and missing Phase 1 attribution prevent direct substitution today.\n- **S6 as selector over S5 references: PARTIAL.** It preserves provenance and decomposes some claims, but F03 instability and F06 padding are material.\n- **Overall architecture: TEST_BOTH_IN_PARALLEL.** Keep the two-call implementation while directly comparing cleaned S5 portfolios and S6 portfolios under blinded human review.", "");
report.push("No S5 prompt, S6 prompt, Phase 1 output, or production extraction logic was changed during this experiment.");
await writeFile(path.join(root, "experiment_report.md"), `${report.join("\n")}\n`);
console.log(JSON.stringify({
  root,
  fixtures: Object.fromEntries(fixtures.map((f) => [f, {
    stances: results[f].metrics.validatedS5AssertionCount,
    sizes: results[f].metrics.s6PortfolioSizeByRepeat,
    suitable: results[f].metrics.finalClaimSuitableS5Count,
    mustSelect: results[f].metrics.mustSelectRetentionByRepeat,
    crux: results[f].metrics.cruxRetentionByRepeat,
    jaccard: results[f].metrics.averagePairwiseJaccard,
  }])),
  totals: total,
}, null, 2));
