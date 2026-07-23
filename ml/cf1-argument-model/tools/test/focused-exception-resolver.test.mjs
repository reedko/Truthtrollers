import assert from "node:assert/strict";
import test from "node:test";
import { contentTokens, resolveFocusedExceptions, semanticSimilarity } from "../lib/focused-exception-resolver.mjs";

test("semantic similarity normalizes common task vocabulary", () => {
  assert.equal(contentTokens("Vaccinations and vaccines").every((token) => token === "vaccin"), true);
  assert.ok(semanticSimilarity("vaccination safety in children", "vaccines are safe for children") > 0.5);
});

test("semantic similarity rewards exact substantive overlap", () => {
  const exact = semanticSimilarity("vaccination before 18 months was not associated with autism", "vaccination before 18 months was not associated with autism");
  const unrelated = semanticSimilarity("vaccination before 18 months was not associated with autism", "the earthquake occurred near Hokkaido");
  assert.ok(exact > 0.9);
  assert.ok(unrelated < 0.2);
});

test("resolver auto-applies exact split children and uniquely mapped graph endpoints", () => {
  const treatment = { contentStance: "supports_thesis", deployment: "endorsed", role: "pillar_support", basis: "accepted" };
  const source = { kind: "study", name: "Study A", sourceUnitIds: ["U1"], basis: "named" };
  const portfolio = { include: false, basis: "supporting detail" };
  const child = {
    fixtureId: "CF1-F00", argumentUnitId: "AU1-S01", sourceArgumentUnitId: "AU1", childOrdinal: 1, childCount: 2,
    proposition: "Study A found treatment reduced mortality.",
    grounding: { sourceUnitIds: ["U1"], verbatimExcerpt: "Study A found treatment reduced mortality, but did not reduce pain." },
    assertionSource: source, articleTreatment: treatment, portfolio,
  };
  const second = {
    argumentUnitId: "AU1-S02", canonicalAtomicProposition: "Study A found treatment did not reduce pain.",
    grounding: child.grounding, assertionSource: source, articleTreatment: treatment, portfolio,
  };
  const first = { ...second, argumentUnitId: "AU1-S01", canonicalAtomicProposition: child.proposition };
  const anchor = { ...second, argumentUnitId: "AU2", canonicalAtomicProposition: "Mortality was the primary outcome." };
  const fixture = {
    fixtureId: "CF1-F00",
    sourceText: "Study A found treatment reduced mortality, but did not reduce pain.",
    draft: { argumentUnits: [
      { argumentUnitId: "AU1", canonicalAtomicProposition: "Study A found treatment reduced mortality and did not reduce pain." },
      anchor,
    ] },
    candidate: {
      argumentUnits: [first, second, anchor], relations: [],
      compilation: { lineageByArgumentUnitId: { "AU1-S01": { reviewDecisionKey: "CF1-F00:argument:AU1", childOrdinal: 1 } } },
    },
  };
  const queue = {
    splitChildren: [child],
    relations: [{ fixtureId: "CF1-F00", relation: { relationId: "R1", fromArgumentUnitId: "AU1", toArgumentUnitId: "AU2", type: "supports", basis: "Study A found treatment reduced mortality.", sourceUnitIds: ["U1"] }, candidateFromArgumentUnitIds: ["AU1-S01", "AU1-S02"], candidateToArgumentUnitIds: ["AU2"] }],
    consistencyFindings: [], passageCoverage: [], attributionSpotChecks: [], excludedTrainingTasks: [],
    rubricCoverage: [{ fixtureId: "CF1-F00", targets: [{ targetId: "T1", category: "required_concept", description: "Treatment reduced mortality." }], prohibitedInterpretations: [], inheritedReviewNotes: [] }],
  };
  const reviewedDecisions = { decisions: { "CF1-F00:argument:AU1": { correctedProposition: "Study A found treatment reduced mortality.\nStudy A found treatment did not reduce pain." } } };
  const result = resolveFocusedExceptions({ fixtures: [fixture], queue, reviewedDecisions, generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(result.autoApplied.counts.splitChildren, 1);
  assert.equal(result.autoApplied.counts.relations, 1);
  assert.equal(result.exceptions.splitChildren.length, 0);
  assert.deepEqual(result.autoApplied.decisions["CF1-F00:relation:R1"].mappings, [{ fromArgumentUnitId: "AU1-S01", type: "supports", toArgumentUnitId: "AU2" }]);
});
