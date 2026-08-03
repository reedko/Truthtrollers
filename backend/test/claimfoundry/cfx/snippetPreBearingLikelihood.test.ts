import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreCfxSnippetPreBearing,
  selectCfxFormerSearchRankBaseline,
  selectCfxSnippetPreBearing,
  type CfxCanonicalCandidate,
} from "../../../src/claimfoundry/cfx/retrieval/snippetPreBearingLikelihood.js";
import type { CfxEvidenceInput } from "../../../src/claimfoundry/cfx/retrieval/types.js";

const input: CfxEvidenceInput = {
  propositionId: "P05",
  substantiveAssertion: "The CDC manipulated data linking the MMR vaccine to autism.",
  assertionSource: "William Thompson's whistleblower account",
  articleStance: "adopts",
  groundingUnitIds: ["U0036"],
  groundingText: "William Thompson revealed in 2014 that CDC MMR autism data were manipulated.",
  literalIdentifiers: {
    people: ["William Thompson"], organizations: ["CDC"], laws: [], studyTitles: [],
    journals: [], years: ["2014"], dateRanges: [], doi: [], pmid: [], urls: [],
    citationNumbers: [], acronyms: ["CDC", "MMR"],
  },
  lookupHints: {
    populations: [], exposures: [], outcomes: ["autism"], interventions: ["MMR vaccine"],
    geography: [], documentTypes: ["study"], topics: ["data manipulation"],
  },
  deterministicQueries: { literalQuery: null, sourceQualifiedQuery: null, studyLookupQueries: [] },
};

function doc(id: string, queryId: string, rank: number, intent: string, title: string, snippet: string): CfxCanonicalCandidate {
  return {
    documentKey: id,
    representative: { candidateId: `C-${id}`, title, abstractOrSnippet: snippet, retrievalRank: rank },
    discoveryAssignments: [{ propositionId: "P05", queryId, queryIntent: intent, rank }],
  };
}

test("former baseline preserves query-id then rank ordering", () => {
  const rows = [
    doc("late", "Q2", 1, "entity_predicate", "CDC", "MMR autism"),
    doc("q1-r2", "Q1", 2, "canonical", "William Thompson", "CDC MMR autism"),
    doc("q1-r1", "Q1", 1, "canonical", "Unrelated", "topic page"),
  ];
  assert.deepEqual(
    selectCfxFormerSearchRankBaseline(input, rows, 3).map((row) => row.documentKey),
    ["q1-r1", "q1-r2", "late"],
  );
});

test("pre-bearing scoring is deterministic, immutable, and rewards literal identity", () => {
  const relevant = doc(
    "relevant", "Q2", 4, "entity_predicate", "William Thompson and the CDC",
    "The CDC scientist discussed MMR vaccine autism data manipulation in 2014.",
  );
  const generic = doc("generic", "Q2", 1, "entity_predicate", "Vaccine research", "Home About Search News");
  const frozenInput = structuredClone(input);
  const first = scoreCfxSnippetPreBearing(input, relevant);
  const second = scoreCfxSnippetPreBearing(input, relevant);
  assert.deepEqual(first, second);
  assert.ok(first.snippetPreBearingLikelihood > scoreCfxSnippetPreBearing(input, generic).snippetPreBearingLikelihood);
  assert.ok(first.components.exactIdentity > 0);
  assert.deepEqual(input, frozenInput);
});

test("selector retains lane diversity and never exceeds five", () => {
  const rows = [
    doc("q1", "Q1", 1, "canonical", "CDC MMR", "CDC MMR autism"),
    doc("q2", "Q2", 2, "entity_predicate", "William Thompson", "CDC data manipulation"),
    doc("q3", "Q3", 3, "source_identity", "William Thompson", "whistleblower CDC"),
    doc("q4", "Q4", 4, "independent_evidence", "MMR study", "MMR autism study data"),
    doc("q5", "Q5", 5, "counterevidence", "CDC response", "CDC disputed MMR data claims"),
    doc("extra", "Q2", 1, "entity_predicate", "CDC", "CDC MMR autism manipulation"),
  ];
  const selected = selectCfxSnippetPreBearing(input, rows, 5);
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map((row) => row.discoveryAssignments[0]!.queryIntent)), new Set([
    "canonical", "entity_predicate", "source_identity", "independent_evidence", "counterevidence",
  ]));
});
