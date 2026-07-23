const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "been", "being", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "if", "in", "into", "is",
  "it", "its", "may", "more", "most", "notably", "of", "on", "or", "s", "said", "says", "should",
  "so", "some", "such", "than", "that", "the", "their", "them", "there", "these", "they", "this",
  "those", "to", "under", "was", "were", "what", "when", "which", "while", "who", "with", "would",
]);

const SYNONYMS = new Map([
  ["vaccination", "vaccin"], ["vaccinations", "vaccin"], ["vaccine", "vaccin"], ["vaccines", "vaccin"],
  ["immunization", "vaccin"], ["immunizations", "vaccin"], ["immunized", "vaccin"],
  ["children", "child"], ["childhood", "child"], ["babies", "infant"], ["baby", "infant"],
  ["claims", "claim"], ["claimed", "claim"], ["argues", "claim"], ["argued", "claim"],
  ["argument", "claim"], ["assertion", "claim"], ["assertions", "claim"], ["position", "claim"],
  ["studies", "study"], ["researchers", "research"], ["analyses", "analysis"],
  ["harmless", "safe"], ["safety", "safe"], ["safer", "safe"],
  ["harmful", "harm"], ["harms", "harm"], ["toxicity", "toxic"], ["risks", "risk"],
  ["caused", "cause"], ["causes", "cause"], ["causal", "cause"],
  ["associated", "associate"], ["association", "associate"], ["associations", "associate"],
  ["linked", "link"], ["links", "link"],
  ["increased", "increase"], ["increases", "increase"], ["rising", "increase"], ["rose", "increase"],
  ["decreased", "decrease"], ["decreases", "decrease"], ["declining", "decrease"], ["reduced", "decrease"],
  ["rebutted", "rebut"], ["rebuts", "rebut"], ["refuted", "rebut"], ["refutes", "rebut"],
  ["disputed", "rebut"], ["disputes", "rebut"], ["contradicted", "contradict"],
  ["authors", "author"], ["article's", "article"],
]);

function stem(token) {
  if (SYNONYMS.has(token)) return SYNONYMS.get(token);
  if (token.length > 6 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 5 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 5 && token.endsWith("es")) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith("s")) token = token.slice(0, -1);
  return SYNONYMS.get(token) ?? token;
}

export function contentTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.%]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))
    .map(stem);
}

function unique(values) {
  return [...new Set(values)];
}

function bigrams(tokens) {
  const output = [];
  for (let index = 0; index < tokens.length - 1; index += 1) output.push(`${tokens[index]} ${tokens[index + 1]}`);
  return unique(output);
}

function overlapRatio(left, right) {
  if (!left.length) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length / left.length;
}

function numberTokens(value) {
  return unique((String(value ?? "").replace(/(?<=\d),(?=\d)/g, "").match(/\b\d+(?:\.\d+)?%?/g) ?? []).map((number) => number.replace(/%$/, "")));
}

function parseSourceUnits(sourceText) {
  const units = [];
  const matcher = /^\[(U\d{4})\]\s*([\s\S]*?)(?=^\[U\d{4}\]\s*|(?![\s\S]))/gm;
  let match;
  while ((match = matcher.exec(String(sourceText ?? "")))) {
    units.push({ unitId: match[1], text: match[2].trim(), ordinal: Number(match[1].slice(1)) });
  }
  return units;
}

export function semanticSimilarity(query, candidate) {
  const queryTokens = unique(contentTokens(query));
  const candidateTokens = unique(contentTokens(candidate));
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const queryCoverage = overlapRatio(queryTokens, candidateTokens);
  const candidateCoverage = overlapRatio(candidateTokens, queryTokens);
  const queryBigrams = bigrams(queryTokens);
  const candidateBigrams = bigrams(candidateTokens);
  const bigramCoverage = queryBigrams.length ? overlapRatio(queryBigrams, candidateBigrams) : 0;
  const queryNumbers = numberTokens(query);
  const candidateNumbers = numberTokens(candidate);
  const numberScore = queryNumbers.length ? overlapRatio(queryNumbers, candidateNumbers) : 1;
  const score = 0.48 * queryCoverage + 0.32 * candidateCoverage + 0.15 * bigramCoverage + 0.05 * numberScore;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function normalizedExact(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function splitLines(value) {
  return String(value ?? "").split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
}

function inheritedCompatibility(child) {
  const reasons = [];
  const treatment = child.articleTreatment;
  const source = child.assertionSource;
  if (
    treatment.role === "opponent_claim" &&
    treatment.contentStance !== "contradicts_thesis"
  ) reasons.push("opponent_role_stance_mismatch");
  if (
    treatment.role === "opponent_claim" &&
    !["opponent_to_rebut", "rebutted"].includes(treatment.deployment)
  ) reasons.push("opponent_role_deployment_mismatch");
  if (
    treatment.role === "rebuttal" &&
    treatment.contentStance !== "supports_thesis"
  ) reasons.push("rebuttal_role_stance_mismatch");
  if (child.portfolio.include && treatment.role === "context") {
    reasons.push("context_child_included_in_portfolio");
  }
  const attributionCue = child.proposition.match(/^([^,]{2,80}?)\s+(?:said|says|argued|argues|reported|reports|found|finds|claimed|claims)\b/i);
  const attributedSupplier = attributionCue?.[1]?.trim().toLowerCase() ?? "";
  const narrativeVoiceCue = /^(?:the\s+)?(?:article|author|writer|article author)$/.test(attributedSupplier);
  if (source.kind === "article_voice" && attributionCue && !narrativeVoiceCue) {
    reasons.push("child_text_contains_external_attribution_but_source_is_article_voice");
  }
  return reasons;
}

function chooseSupportingUnit(child, missingNumber, sourceUnits) {
  const currentOrdinals = child.grounding.sourceUnitIds.map((unitId) => Number(String(unitId).slice(1))).filter(Number.isFinite);
  const candidates = sourceUnits.filter((unit) => numberTokens(unit.text).includes(missingNumber)).map((unit) => ({
    ...unit,
    distance: currentOrdinals.length ? Math.min(...currentOrdinals.map((ordinal) => Math.abs(unit.ordinal - ordinal))) : Number.POSITIVE_INFINITY,
    score: semanticSimilarity(child.proposition, unit.text),
  })).sort((left, right) => left.distance - right.distance || right.score - left.score || left.unitId.localeCompare(right.unitId));
  if (!candidates.length) return null;
  const top = candidates[0];
  const second = candidates[1];
  const uniquelyAdjacent = top.distance <= 2 && (!second || second.distance > top.distance);
  const uniquelySemantic = top.score >= 0.18 && (!second || top.score - second.score >= 0.08);
  return uniquelyAdjacent || uniquelySemantic ? top : null;
}

function groundingSupport(child, sourceUnits) {
  const propositionTokens = unique(contentTokens(child.proposition));
  const propositionNumbers = numberTokens(child.proposition);
  const initialExcerptNumbers = numberTokens(child.grounding?.verbatimExcerpt);
  const initiallyMissingNumbers = propositionNumbers.filter((number) => !initialExcerptNumbers.includes(number));
  const additions = unique(initiallyMissingNumbers.map((number) => chooseSupportingUnit(child, number, sourceUnits)?.unitId).filter(Boolean)).map((unitId) => sourceUnits.find((unit) => unit.unitId === unitId));
  const augmentedExcerpt = [child.grounding?.verbatimExcerpt, ...additions.map((unit) => unit.text)].filter(Boolean).join("\n");
  const excerptTokens = unique(contentTokens(augmentedExcerpt));
  const overlap = overlapRatio(propositionTokens, excerptTokens);
  const augmentedNumbers = numberTokens(augmentedExcerpt);
  const missingNumbers = propositionNumbers.filter((number) => !augmentedNumbers.includes(number));
  const reasons = [];
  if (overlap < 0.28) reasons.push("low_independent_grounding_overlap");
  if (missingNumbers.length) reasons.push("proposition_number_absent_from_grounding");
  return {
    overlap: Number(overlap.toFixed(4)),
    initiallyMissingNumbers,
    missingNumbers,
    groundingAugmentation: additions.map((unit) => ({ unitId: unit.unitId, verbatimExcerpt: unit.text })),
    reasons,
  };
}

function chooseEndpoint(candidateIds, basis, argumentMap, sourceProposition = "") {
  const candidates = candidateIds.map((argumentUnitId) => {
    const argument = argumentMap.get(argumentUnitId);
    const proposition = argument?.canonicalAtomicProposition ?? "";
    const basisScore = semanticSimilarity(basis, proposition);
    const sourceScore = semanticSimilarity(sourceProposition, proposition);
    return {
      argumentUnitId,
      proposition,
      basisScore,
      sourceScore,
      score: Number((0.68 * basisScore + 0.32 * sourceScore).toFixed(4)),
    };
  }).sort((left, right) => right.score - left.score || left.argumentUnitId.localeCompare(right.argumentUnitId));
  if (candidates.length === 0) return { status: "ambiguous", selected: [], candidates, reason: "endpoint_removed" };
  if (candidates.length === 1) return { status: "clear", selected: [candidates[0].argumentUnitId], candidates, reason: "single_candidate" };
  const top = candidates[0];
  const second = candidates[1];
  const margin = top.score - second.score;
  if (top.score >= 0.34 && margin >= 0.1) {
    return { status: "clear", selected: [top.argumentUnitId], candidates, reason: "unique_basis_match" };
  }
  return { status: "ambiguous", selected: [], candidates, reason: "no_unique_basis_match" };
}

function propositionPolarity(value) {
  const tokens = new Set(contentTokens(value));
  const negations = ["no", "not", "never", "without", "lack", "failed", "absent"];
  return negations.some((token) => tokens.has(token)) ? "negative" : "positive";
}

function targetCandidates(target, candidate, relations, max = 6) {
  const query = [target.description, target.excerpt].filter(Boolean).join(" ");
  const assertionScores = candidate.argumentUnits.map((argument) => ({
    kind: "argument",
    id: argument.argumentUnitId,
    text: argument.canonicalAtomicProposition,
    score: semanticSimilarity(query, argument.canonicalAtomicProposition),
    treatment: argument.articleTreatment,
    portfolioInclude: argument.portfolio.include,
  }));
  const argumentMap = new Map(candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
  const relationScores = relations.map((relation) => {
    const from = argumentMap.get(relation.fromArgumentUnitId)?.canonicalAtomicProposition ?? "";
    const to = argumentMap.get(relation.toArgumentUnitId)?.canonicalAtomicProposition ?? "";
    const text = `${from} ${relation.type} ${to} ${relation.basis}`;
    return { kind: "relation", id: relation.relationId, text, score: semanticSimilarity(query, text) };
  });
  return [...assertionScores, ...relationScores]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, max);
}

function sourceRegionMatches(target, candidate) {
  const excerpt = normalizedExact(target.excerpt).toLowerCase();
  if (!excerpt) return [];
  return candidate.argumentUnits.filter((argument) => {
    const grounding = normalizedExact(argument.grounding?.verbatimExcerpt).toLowerCase();
    if (grounding.includes(excerpt)) return true;
    return semanticSimilarity(target.excerpt, argument.grounding?.verbatimExcerpt) >= 0.72;
  }).map((argument) => argument.argumentUnitId);
}

function sourceContainsExcerpt(sourceText, excerpt) {
  const normalizedSource = normalizedExact(sourceText).toLowerCase();
  const normalizedExcerpt = normalizedExact(excerpt).toLowerCase();
  return Boolean(normalizedExcerpt) && normalizedSource.includes(normalizedExcerpt);
}

function resolveTarget(target, candidate, relations, sourceText) {
  if (target.category === "required_source_region") {
    const matches = sourceRegionMatches(target, candidate);
    if (matches.length) {
      return {
        status: "matched",
        argumentUnitIds: matches,
        relationIds: [],
        basis: "Required source excerpt matched compiled grounding.",
        candidates: matches.map((id) => ({ kind: "argument", id, score: 1 })),
      };
    }
    const status = sourceContainsExcerpt(sourceText, target.excerpt)
      ? "missing"
      : "apparent_key_error";
    return {
      status,
      argumentUnitIds: [],
      relationIds: [],
      basis: status === "missing"
        ? "The excerpt exists in the immutable source prompt, but no compiled grounding matched it."
        : "The required excerpt does not appear in the immutable source prompt and may be an evaluation-key error.",
      candidates: targetCandidates(target, candidate, relations),
    };
  }
  const candidates = targetCandidates(target, candidate, relations);
  const top = candidates[0];
  if (!top || top.score < 0.28) {
    return { status: "missing", argumentUnitIds: [], relationIds: [], basis: "No candidate cleared the minimum semantic-overlap threshold.", candidates };
  }
  if (top.score < 0.4) {
    return { status: "ambiguous", argumentUnitIds: [], relationIds: [], basis: "Best match was plausible but below the automatic-match threshold.", candidates };
  }
  const matches = candidates.filter((item) => item.score >= Math.max(0.36, top.score - 0.09));
  return {
    status: "matched",
    argumentUnitIds: matches.filter((item) => item.kind === "argument").map((item) => item.id),
    relationIds: matches.filter((item) => item.kind === "relation").map((item) => item.id),
    basis: "One or more compiled records cleared the automatic semantic-overlap threshold.",
    candidates,
  };
}

function resolveProhibition(prohibition, candidate, relations) {
  const candidates = targetCandidates({ description: prohibition.description }, candidate, relations, 5);
  const top = candidates[0];
  if (!top || top.score < 0.48) {
    return { status: "not_violated", basis: "No compiled assertion closely expressed the prohibited interpretation.", candidates };
  }
  if (top.kind === "relation") {
    return { status: "uncertain", basis: "A close relation-level match exists and requires human interpretation.", candidates };
  }
  const argument = candidate.argumentUnits.find((item) => item.argumentUnitId === top.id);
  const samePolarity = propositionPolarity(prohibition.description) === propositionPolarity(argument.canonicalAtomicProposition);
  if (!samePolarity) {
    return { status: "not_violated", basis: "Closest assertion had opposite explicit polarity.", candidates };
  }
  if (["opponent_to_rebut", "rebutted"].includes(argument.articleTreatment.deployment)) {
    return { status: "not_violated", basis: "Closest assertion is preserved as an opponent proposition rather than endorsed.", candidates };
  }
  if (["reported_neutral", "unclear"].includes(argument.articleTreatment.deployment)) {
    return { status: "uncertain", basis: "A close match exists but its article deployment is neutral or unclear.", candidates };
  }
  return { status: "apparent_violation", basis: "A closely matching assertion is represented as article-endorsed or qualified.", candidates };
}

export function resolveFocusedExceptions({ fixtures, queue, reviewedDecisions, generatedAt = new Date().toISOString(), provenance = {} }) {
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  const autoDecisions = {};
  const exceptions = {
    schemaVersion: "cf1.focusedExceptionReviewQueue.v1",
    generatedAt,
    splitChildren: [],
    relations: [],
    consistencyFindings: [],
    passageCoverage: structuredClone(queue.passageCoverage),
    attributionSpotChecks: structuredClone(queue.attributionSpotChecks),
    rubricTargets: [],
    prohibitedInterpretations: [],
    excludedTrainingTasks: structuredClone(queue.excludedTrainingTasks),
    provenance,
  };
  const resolvedRelationsByFixture = new Map(fixtures.map((fixture) => [
    fixture.fixtureId,
    fixture.candidate.relations.map((relation) => structuredClone(relation)),
  ]));
  const sourceUnitsByFixture = new Map(fixtures.map((fixture) => [fixture.fixtureId, parseSourceUnits(fixture.sourceText)]));

  for (const child of queue.splitChildren) {
    const fixture = fixtureMap.get(child.fixtureId);
    const lineage = fixture.candidate.compilation.lineageByArgumentUnitId[child.argumentUnitId];
    const decision = reviewedDecisions.decisions[lineage.reviewDecisionKey];
    const expectedLines = splitLines(decision.correctedProposition);
    const expected = expectedLines[lineage.childOrdinal - 1] ?? "";
    const reasons = [];
    if (normalizedExact(child.proposition) !== normalizedExact(expected)) reasons.push("split_line_mismatch");
    const grounding = groundingSupport(child, sourceUnitsByFixture.get(child.fixtureId));
    reasons.push(...grounding.reasons);
    reasons.push(...inheritedCompatibility(child));
    const key = `${child.fixtureId}:splitChild:${child.argumentUnitId}`;
    const assessment = {
      lineage: structuredClone(lineage),
      exactApprovedSplitLine: normalizedExact(child.proposition) === normalizedExact(expected),
      groundingOverlap: grounding.overlap,
      initiallyMissingNumbers: grounding.initiallyMissingNumbers,
      missingNumbers: grounding.missingNumbers,
      groundingAugmentation: grounding.groundingAugmentation,
      inheritedSource: structuredClone(child.assertionSource),
      inheritedTreatment: structuredClone(child.articleTreatment),
      inheritedPortfolio: structuredClone(child.portfolio),
    };
    if (reasons.length) exceptions.splitChildren.push({ ...structuredClone(child), reasons, assessment, expectedApprovedLine: expected });
    else autoDecisions[key] = { decision: "accept", basis: "Exact approved split line with independently supporting grounding and no detected inherited-field incompatibility.", assessment };
  }

  for (const item of queue.relations) {
    const fixture = fixtureMap.get(item.fixtureId);
    const argumentMap = new Map(fixture.candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
    const sourceArgumentMap = new Map(fixture.draft.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
    const fromSource = sourceArgumentMap.get(item.relation.fromArgumentUnitId)?.canonicalAtomicProposition ?? "";
    const toSource = sourceArgumentMap.get(item.relation.toArgumentUnitId)?.canonicalAtomicProposition ?? "";
    const from = chooseEndpoint(item.candidateFromArgumentUnitIds, item.relation.basis, argumentMap, fromSource);
    const to = chooseEndpoint(item.candidateToArgumentUnitIds, item.relation.basis, argumentMap, toSource);
    const key = `${item.fixtureId}:relation:${item.relation.relationId}`;
    if (from.status === "clear" && to.status === "clear") {
      const mappings = from.selected.flatMap((fromId) => to.selected.map((toId) => ({
        fromArgumentUnitId: fromId,
        type: item.relation.type,
        toArgumentUnitId: toId,
      })));
      autoDecisions[key] = {
        decision: "remap",
        mappings,
        basis: "Each affected endpoint had a single or uniquely basis-matched candidate.",
        endpointAssessment: { from, to },
      };
      resolvedRelationsByFixture.get(item.fixtureId).push(...mappings.map((mapping, index) => ({
        relationId: mappings.length === 1 ? item.relation.relationId : `${item.relation.relationId}-AUTO${index + 1}`,
        ...mapping,
        sourceUnitIds: structuredClone(item.relation.sourceUnitIds ?? []),
        basis: item.relation.basis,
        autoResolvedFromRelationId: item.relation.relationId,
      })));
    } else exceptions.relations.push({ ...structuredClone(item), endpointAssessment: { from, to }, reasons: [from.reason, to.reason].filter((reason) => reason !== "single_candidate") });
  }

  for (const item of queue.consistencyFindings) {
    const fixture = fixtureMap.get(item.fixtureId);
    const argumentMap = new Map(fixture.candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
    const sourceArgumentMap = new Map(fixture.draft.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
    const endpointAssessment = item.endpointReplacements.map((replacement) => ({
      sourceArgumentUnitId: replacement.sourceArgumentUnitId,
      ...chooseEndpoint(
        replacement.candidateArgumentUnitIds,
        item.finding.basis,
        argumentMap,
        sourceArgumentMap.get(replacement.sourceArgumentUnitId)?.canonicalAtomicProposition ?? "",
      ),
    }));
    const key = `${item.fixtureId}:finding:${item.finding.findingId}`;
    if (endpointAssessment.every((endpoint) => endpoint.status === "clear")) {
      autoDecisions[key] = {
        decision: "remap",
        argumentUnitIds: endpointAssessment.flatMap((endpoint) => endpoint.selected),
        findingType: item.finding.type,
        basis: "Every affected endpoint had a single or uniquely basis-matched candidate.",
        endpointAssessment,
      };
    } else exceptions.consistencyFindings.push({ ...structuredClone(item), endpointAssessment, reasons: endpointAssessment.filter((endpoint) => endpoint.status !== "clear").map((endpoint) => endpoint.reason) });
  }

  for (const rubric of queue.rubricCoverage) {
    const fixture = fixtureMap.get(rubric.fixtureId);
    const relations = resolvedRelationsByFixture.get(rubric.fixtureId);
    for (const target of rubric.targets) {
      const resolution = resolveTarget(target, fixture.candidate, relations, fixture.sourceText);
      const key = `${rubric.fixtureId}:rubric:${target.targetId}`;
      if (resolution.status === "matched") autoDecisions[key] = { decision: "matched", ...resolution };
      else exceptions.rubricTargets.push({ fixtureId: rubric.fixtureId, target: structuredClone(target), resolution });
    }
    for (const prohibition of rubric.prohibitedInterpretations) {
      const resolution = resolveProhibition(prohibition, fixture.candidate, relations);
      const key = `${rubric.fixtureId}:prohibition:${prohibition.prohibitionId}`;
      if (resolution.status === "not_violated") autoDecisions[key] = { decision: "not_violated", ...resolution };
      else exceptions.prohibitedInterpretations.push({ fixtureId: rubric.fixtureId, prohibition: structuredClone(prohibition), resolution });
    }
  }

  const autoCounts = {
    splitChildren: Object.keys(autoDecisions).filter((key) => key.includes(":splitChild:") && autoDecisions[key].decision === "accept").length,
    relations: Object.keys(autoDecisions).filter((key) => key.includes(":relation:") && autoDecisions[key].decision === "remap").length,
    consistencyFindings: Object.keys(autoDecisions).filter((key) => key.includes(":finding:") && autoDecisions[key].decision === "remap").length,
    rubricTargets: Object.keys(autoDecisions).filter((key) => key.includes(":rubric:") && autoDecisions[key].decision === "matched").length,
    prohibitedInterpretations: Object.keys(autoDecisions).filter((key) => key.includes(":prohibition:") && autoDecisions[key].decision === "not_violated").length,
  };
  const exceptionCounts = {
    splitChildren: exceptions.splitChildren.length,
    relations: exceptions.relations.length,
    consistencyFindings: exceptions.consistencyFindings.length,
    passageCoverage: exceptions.passageCoverage.length,
    attributionSpotChecks: exceptions.attributionSpotChecks.length,
    rubricTargets: exceptions.rubricTargets.length,
    prohibitedInterpretations: exceptions.prohibitedInterpretations.length,
  };
  return {
    autoApplied: {
      schemaVersion: "cf1.automaticallyAppliedFocusedDecisions.v1",
      generatedAt,
      provenance,
      rulesVersion: "cf1.focusedExceptionRules.v1",
      decisions: autoDecisions,
      counts: autoCounts,
      fixtureApprovalChanged: false,
      trainingRowsGenerated: false,
    },
    exceptions,
    report: {
      schemaVersion: "cf1.focusedExceptionResolutionReport.v1",
      generatedAt,
      rulesVersion: "cf1.focusedExceptionRules.v1",
      provenance,
      autoResolved: autoCounts,
      requiringReview: exceptionCounts,
      evidenceTargetsExcluded: true,
      fixturesApproved: false,
      trainingRowsGenerated: false,
    },
  };
}
