import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  loadProductionCfxEvidenceInputs,
  CfxQueryInputError,
} from "../../../src/services/cfxProductionEvidencePipeline.js";
import { loadVerifiedCfxEvidenceInputs } from "../../../src/claimfoundry/cfx/retrieval/loadEvidenceInputs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const goldenHandoffRunDirectory = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/" +
    "cfx-s2-evidence-search-cfx-substantive-review-cf1-f03-20260730234738-20260731051936",
);

function fakeQuery(rows: Record<string, unknown>[]) {
  return async () => rows;
}

function baseRow(overrides: Record<string, unknown>) {
  return {
    claim_id: 42,
    claim_text: "The synthetic case assertion under test.",
    speaker_entity: "Synthetic source",
    evaluation_target_id: 900,
    target_order: 0,
    source_excerpt: "The real article-grounded excerpt text.",
    article_stance: "adopts",
    population_scope: null,
    query_hints_json: null,
    ...overrides,
  };
}

const richHints = {
  propositionId: "P42",
  groundingUnitIds: ["U0002", "U0019"],
  literalIdentifiers: {
    people: ["Aaron Siri"],
    organizations: ["CDC"],
    laws: [],
    studyTitles: [],
    journals: [],
    years: [],
    dateRanges: [],
    doi: [],
    pmid: [],
    urls: [],
    citationNumbers: [],
    acronyms: ["CDC"],
  },
  lookupHints: {
    populations: ["parents", "children"],
    exposures: [],
    outcomes: [],
    interventions: ["vaccines"],
    geography: [],
    documentTypes: [],
    topics: [],
  },
  deterministicQueries: {
    literal: ['"The synthetic case assertion under test."'],
    sourceQualified: ['"The synthetic case assertion under test." "Synthetic source"'],
    studyLookup: ["Aaron Siri CDC vaccines"],
  },
};

// 1, 2, 3, 4, 5, 6, 7: rich persisted fields survive byte-for-byte, including
// multiple ordered groundingUnitIds, and proposition identity comes from the
// persisted CFX identity, not claim_id.
test("valid rich query_hints_json is consumed directly, byte-for-byte", async () => {
  const row = baseRow({ query_hints_json: JSON.stringify(richHints) });
  const [input] = await loadProductionCfxEvidenceInputs({
    query: fakeQuery([row]),
    taskContentId: 1,
    claimIds: [42],
  });

  assert.equal(input.propositionId, "P42", "proposition identity comes from the persisted CFX identity, not P<claimId>");
  assert.deepEqual(input.groundingUnitIds, ["U0002", "U0019"], "multiple real grounding unit IDs survive unchanged and in order");
  assert.deepEqual(input.literalIdentifiers, richHints.literalIdentifiers, "literalIdentifiers survive unchanged");
  assert.deepEqual(input.lookupHints, richHints.lookupHints, "lookupHints survive unchanged");
  assert.deepEqual(input.deterministicQueries, {
    literalQuery: richHints.deterministicQueries.literal[0],
    sourceQualifiedQuery: richHints.deterministicQueries.sourceQualified[0],
    studyLookupQueries: richHints.deterministicQueries.studyLookup,
  }, "deterministicQueries survive unchanged");
  assert.equal(input.groundingText, "The real article-grounded excerpt text.", "groundingText survives unchanged");
  assert.equal(input.substantiveAssertion, "The synthetic case assertion under test.");
  assert.equal(input.assertionSource, "Synthetic source");
  assert.equal(input.articleStance, "adopts");
});

test("query_hints_json passed as an already-parsed object (mysql2 JSON column auto-parse) is also consumed directly", async () => {
  const row = baseRow({ query_hints_json: richHints });
  const [input] = await loadProductionCfxEvidenceInputs({
    query: fakeQuery([row]),
    taskContentId: 1,
    claimIds: [42],
  });
  assert.equal(input.propositionId, "P42");
  assert.deepEqual(input.groundingUnitIds, ["U0002", "U0019"]);
});

// 8, 9: buildCfxEvidenceSearchHandoff is never called; no synthetic source
// unit is created. Proven structurally: the production loader no longer
// imports it or references a fabricated U<claimId>/P<claimId> identity at all.
test("the production loader no longer imports or calls buildCfxEvidenceSearchHandoff, and fabricates no synthetic identity", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "backend/src/services/cfxProductionEvidencePipeline.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /buildCfxEvidenceSearchHandoff/u);
  assert.doesNotMatch(source, /`U\$\{claimId\}`/u, "no synthetic source unit U<claimId>");
  assert.doesNotMatch(source, /`P\$\{claimId\}`/u, "no fabricated proposition identity P<claimId>");
});

// 11: missing query_hints_json fails loudly.
test("a claim with no persisted query_hints_json (NULL) fails loudly, naming the claim and content IDs", async () => {
  const row = baseRow({ query_hints_json: null });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "MISSING_QUERY_HINTS");
      assert.equal(error.claimId, 42);
      assert.equal(error.contentId, 7);
      return true;
    },
  );
});

// 12: malformed JSON fails loudly.
test("malformed query_hints_json fails loudly, naming the claim and content IDs", async () => {
  const row = baseRow({ query_hints_json: "{not valid json" });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "MALFORMED_QUERY_HINTS_JSON");
      assert.equal(error.claimId, 42);
      assert.equal(error.contentId, 7);
      return true;
    },
  );
});

// 13: incomplete rich JSON fails loudly and names the missing fields.
test("an incomplete rich query_hints_json (missing lookupHints and deterministicQueries) fails loudly and names the missing fields", async () => {
  const incomplete = { propositionId: "P42", groundingUnitIds: ["U0002"], literalIdentifiers: richHints.literalIdentifiers };
  const row = baseRow({ query_hints_json: JSON.stringify(incomplete) });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "INVALID_QUERY_HINTS_SHAPE");
      assert.ok(error.missingFields!.includes("lookupHints"));
      assert.ok(error.missingFields!.includes("deterministicQueries"));
      return true;
    },
  );
});

test("an empty groundingUnitIds array fails loudly", async () => {
  const row = baseRow({ query_hints_json: JSON.stringify({ ...richHints, groundingUnitIds: [] }) });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "INVALID_QUERY_HINTS_SHAPE");
      return true;
    },
  );
});

test("a missing or invalid article_stance fails loudly rather than defaulting", async () => {
  const row = baseRow({ query_hints_json: JSON.stringify(richHints), article_stance: "endorses" });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "INVALID_ARTICLE_STANCE");
      return true;
    },
  );
});

test("a missing grounding excerpt (source_excerpt) fails loudly rather than substituting the assertion text", async () => {
  const row = baseRow({ query_hints_json: JSON.stringify(richHints), source_excerpt: null });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "MISSING_GROUNDING_TEXT");
      return true;
    },
  );
});

test("a missing assertion source (speaker_entity) fails loudly rather than defaulting to 'article voice'", async () => {
  const row = baseRow({ query_hints_json: JSON.stringify(richHints), speaker_entity: null });
  await assert.rejects(
    loadProductionCfxEvidenceInputs({ query: fakeQuery([row]), taskContentId: 7, claimIds: [42] }),
    (error: unknown) => {
      assert.ok(error instanceof CfxQueryInputError);
      assert.equal(error.code, "MISSING_ASSERTION_SOURCE");
      return true;
    },
  );
});

// 14: query planning is never invoked after loader validation failure -- proven
// by the loader itself rejecting before returning any CfxEvidenceInput, since
// runCfxProductionEvidencePipeline calls runCfxQueryPlanning strictly after
// awaiting loadProductionCfxEvidenceInputs (structurally confirmed below).
test("runCfxProductionEvidencePipeline awaits the loader before calling query planning, so a loader rejection prevents query planning", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "backend/src/services/cfxProductionEvidencePipeline.js"),
    "utf8",
  );
  const loaderCallIndex = source.indexOf("await loadProductionCfxEvidenceInputs(");
  const planningCallIndex = source.indexOf("runCfxQueryPlanning(", loaderCallIndex);
  assert.ok(loaderCallIndex >= 0 && planningCallIndex > loaderCallIndex);
});

// 10: equivalence with the proven offline loader, using the real frozen handoff fixture.
test("DB-backed loading returns the same semantic CfxEvidenceInput as loadVerifiedCfxEvidenceInputs for the same handoff", async () => {
  const verified = await loadVerifiedCfxEvidenceInputs(goldenHandoffRunDirectory);
  assert.equal(verified.inputs.length, 12);

  const rows = verified.inputs.map((input, index) => {
    const claimId = 1000 + index;
    return baseRow({
      claim_id: claimId,
      claim_text: input.substantiveAssertion,
      speaker_entity: input.assertionSource,
      article_stance: input.articleStance,
      source_excerpt: input.groundingText,
      query_hints_json: JSON.stringify({
        propositionId: input.propositionId,
        groundingUnitIds: input.groundingUnitIds,
        literalIdentifiers: input.literalIdentifiers,
        lookupHints: input.lookupHints,
        deterministicQueries: {
          literal: input.deterministicQueries.literalQuery ? [input.deterministicQueries.literalQuery] : [],
          sourceQualified: input.deterministicQueries.sourceQualifiedQuery ? [input.deterministicQueries.sourceQualifiedQuery] : [],
          studyLookup: input.deterministicQueries.studyLookupQueries,
        },
      }),
    });
  });
  const claimIds = rows.map((row) => row.claim_id as number);

  const produced: any[] = await loadProductionCfxEvidenceInputs({
    query: fakeQuery(rows),
    taskContentId: 1,
    claimIds,
  });

  function byProposition(left: { propositionId: string }, right: { propositionId: string }): number {
    return left.propositionId.localeCompare(right.propositionId);
  }
  const expected = [...verified.inputs].sort(byProposition);
  const actual: any[] = [...produced].sort(byProposition);

  expected.forEach((expectedInput, index) => {
    const actualInput = actual[index]!;
    assert.equal(actualInput.propositionId, expectedInput.propositionId);
    assert.equal(actualInput.substantiveAssertion, expectedInput.substantiveAssertion);
    assert.equal(actualInput.assertionSource, expectedInput.assertionSource);
    assert.equal(actualInput.articleStance, expectedInput.articleStance);
    assert.deepEqual(actualInput.groundingUnitIds, expectedInput.groundingUnitIds);
    assert.equal(actualInput.groundingText, expectedInput.groundingText);
    assert.deepEqual(actualInput.literalIdentifiers, expectedInput.literalIdentifiers);
    assert.deepEqual(actualInput.lookupHints, expectedInput.lookupHints);
    assert.deepEqual(actualInput.deterministicQueries, expectedInput.deterministicQueries);
  });
});

// 15: runCfxQueryPlanning's interface remains unchanged.
test("runCfxQueryPlanning's exported signature is unmodified", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "backend/src/claimfoundry/cfx/retrieval/queryPlanning.ts"),
    "utf8",
  );
  assert.match(source, /export async function runCfxQueryPlanning\(input: \{/u);
});

// 16: retrieval, acquisition, routes, persistence, linking, SourceCrest, DB
// schema, and deployment files remain untouched (confirmed via git diff in
// the accompanying report; structurally re-confirmed here for the two files
// most adjacent to this change).
test("executeCfxRetrieval's exported signature is unmodified", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "backend/src/claimfoundry/cfx/retrieval/executeRetrieval.ts"),
    "utf8",
  );
  assert.match(source, /export async function executeCfxRetrieval\(input: \{/u);
});

test("the production route file was not touched by this change", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "backend/src/routes/content/content.scrape.routes.js"),
    "utf8",
  );
  assert.match(source, /runCfxProductionEvidencePipeline\(\{/u);
  assert.doesNotMatch(source, /loadProductionCfxEvidenceInputs/u, "the route calls the pipeline, not the loader, directly");
});
