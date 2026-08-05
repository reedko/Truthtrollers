import assert from "node:assert/strict";
import test from "node:test";
import { buildCfxOptionAAliases } from "../../../src/services/cfxOptionAAliases.js";

const EMPTY_LITERAL_IDENTIFIERS = {
  people: [], organizations: [], laws: [], studyTitles: [], journals: [], years: [],
  dateRanges: [], doi: [], pmid: [], urls: [], citationNumbers: [], acronyms: [],
};
const EMPTY_LOOKUP_HINTS = {
  populations: [], exposures: [], outcomes: [], interventions: [], geography: [],
  documentTypes: [], topics: [],
};

test("flattens fields in the exact fixed order: people, organizations, acronyms, studyTitles, then lookupHints populations..topics", () => {
  const aliases = buildCfxOptionAAliases({
    literalIdentifiers: {
      ...EMPTY_LITERAL_IDENTIFIERS,
      people: ["William Thompson"],
      organizations: ["CDC"],
      acronyms: ["CDC", "MMR"],
      studyTitles: ["A Study"],
    },
    lookupHints: {
      ...EMPTY_LOOKUP_HINTS,
      populations: ["children"],
      exposures: ["vaccine exposure"],
      outcomes: ["autism"],
      interventions: ["MMR vaccine"],
      geography: ["U.S."],
      documentTypes: ["study"],
      topics: ["data manipulation"],
    },
  });
  assert.deepEqual(aliases, [
    "William Thompson", "CDC", "MMR", "A Study",
    "children", "vaccine exposure", "autism", "MMR vaccine", "U.S.", "study", "data manipulation",
  ]);
});

test("preserves first occurrence and removes exact duplicates across fields", () => {
  const aliases = buildCfxOptionAAliases({
    literalIdentifiers: { ...EMPTY_LITERAL_IDENTIFIERS, organizations: ["CDC"], acronyms: ["CDC", "MMR"] },
    lookupHints: { ...EMPTY_LOOKUP_HINTS, topics: ["CDC", "MMR"] },
  });
  assert.deepEqual(aliases, ["CDC", "MMR"]);
});

test("normalizes whitespace only -- does not alter casing, generate synonyms, or expand acronyms", () => {
  const aliases = buildCfxOptionAAliases({
    literalIdentifiers: { ...EMPTY_LITERAL_IDENTIFIERS, acronyms: ["  CDC\n", "MMR   vaccine"] },
    lookupHints: EMPTY_LOOKUP_HINTS,
  });
  assert.deepEqual(aliases, ["CDC", "MMR vaccine"]);
  // No expansion of CDC -> "Centers for Disease Control" and no synonym
  // generation anywhere in the output.
  assert.ok(!aliases.includes("Centers for Disease Control"));
});

test("empty query_hints_json fields produce an empty alias list, not invented terms", () => {
  const aliases = buildCfxOptionAAliases({
    literalIdentifiers: EMPTY_LITERAL_IDENTIFIERS,
    lookupHints: EMPTY_LOOKUP_HINTS,
  });
  assert.deepEqual(aliases, []);
});

test("tolerates a missing literalIdentifiers or lookupHints object entirely (skips those fields, invents nothing)", () => {
  assert.deepEqual(buildCfxOptionAAliases({ lookupHints: { ...EMPTY_LOOKUP_HINTS, topics: ["chronic illness"] } }), ["chronic illness"]);
  assert.deepEqual(buildCfxOptionAAliases({ literalIdentifiers: { ...EMPTY_LITERAL_IDENTIFIERS, acronyms: ["U.S."] } }), ["U.S."]);
  assert.deepEqual(buildCfxOptionAAliases({}), []);
});

test("reproduces the exact live P54895 Option-A alias set recovered from production query_hints_json", () => {
  // Verbatim shape of the real claim_evaluation_targets.query_hints_json
  // read for claim_id 54895 (content_id 18056) during the Option-A
  // provenance audit -- not the fixture-only golden expansion_terms.
  const aliases = buildCfxOptionAAliases({
    literalIdentifiers: {
      ...EMPTY_LITERAL_IDENTIFIERS,
      people: ["William Thompson"],
      organizations: ["CDC"],
      acronyms: ["CDC", "MMR"],
      years: ["2014"],
    },
    lookupHints: {
      ...EMPTY_LOOKUP_HINTS,
      outcomes: ["autism"],
      interventions: ["MMR vaccine", "MMR vaccines"],
      documentTypes: ["study"],
      topics: ["data manipulation"],
    },
  });
  assert.deepEqual(aliases, [
    "William Thompson", "CDC", "MMR", "autism", "MMR vaccine", "MMR vaccines", "study", "data manipulation",
  ]);
});
