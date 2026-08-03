import assert from "node:assert/strict";
import test from "node:test";
import {
  articleDocumentFromHtml,
} from "../../../src/claim-foundry/article-document/index.js";
import {
  buildCfxEvidenceSearchHandoff,
} from "../../../src/claimfoundry/cfx/evidenceSearch/buildEvidenceSearchHandoff.js";
import type {
  CfxCitationMetadata,
} from "../../../src/claimfoundry/cfx/evidenceSearch/types.js";
import type {
  CfxUnitAwareProposition,
} from "../../../src/claimfoundry/cfx/discoveryWithUnits/types.js";
import type {
  CfxSubstantiveReviewRow,
} from "../../../src/claimfoundry/cfx/substantiveReview/types.js";

const buildHtmlDocument = articleDocumentFromHtml as unknown as (
  input: {
    html: string;
    url: string;
    metadata: Record<string, unknown>;
  },
) => {
  links: CfxCitationMetadata["links"];
  citationMarkers: CfxCitationMetadata["citationMarkers"];
  references: CfxCitationMetadata["references"];
  sourceUnits: Array<{
    unitId: string;
    text: string;
    sourceOffsets: { start: number; end: number };
  }>;
};

function source(
  groundingUnitIds = ["U0001"],
): CfxUnitAwareProposition {
  return {
    propositionId: "P01",
    assertion: "Earlier selected assertion.",
    assertionSource: "Earlier source",
    whyItMattersToArticleThesis: "It carries the argument.",
    groundingUnitIds,
  };
}

function review(
  substantiveAssertion =
    "Vaccination did NOT reduce the 1990–2010 chronic-disease rate.",
): CfxSubstantiveReviewRow {
  return {
    propositionId: "P01",
    substantiveAssertion,
    assertionSource: "Dr. Jane Smith's 2012 study",
    articleStance: "challenges",
  };
}

test("handoff preserves the canonical assertion and extracts only literal inputs", () => {
  const row = review(
    "Vaccination  did NOT reduce the 1990–2010 chronic-disease rate.",
  );
  const before = structuredClone(row);
  const handoff = buildCfxEvidenceSearchHandoff({
    review: row,
    source: source(),
    article: {
      sourceUnits: [{
        unitId: "U0001",
        text: "In U.S. children, PMID: 14761240 and doi:10.1542/PEDS.113.2.259 reported autism after MMR vaccination. https://Example.org/paper?utm_source=x",
        charStart: 0,
        charEnd: 145,
      }],
    },
  });
  assert.deepEqual(row, before, "canonical S2 row is immutable");
  assert.equal(
    handoff.normalizedAssertion,
    "Vaccination did NOT reduce the 1990–2010 chronic-disease rate.",
  );
  assert.ok(handoff.normalizedAssertion.includes("NOT"));
  assert.ok(handoff.normalizedAssertion.includes("1990–2010"));
  assert.ok(handoff.normalizedAssertion.includes("chronic-disease"));
  assert.deepEqual(handoff.groundingUnitIds, ["U0001"]);
  assert.match(handoff.groundingText, /^\[U0001\]\nIn U\.S\./);
  assert.deepEqual(handoff.literalIdentifiers.doi, [
    "10.1542/peds.113.2.259",
  ]);
  assert.deepEqual(handoff.literalIdentifiers.pmid, ["14761240"]);
  assert.deepEqual(handoff.literalIdentifiers.urls, [
    "https://example.org/paper",
  ]);
  assert.ok(handoff.literalIdentifiers.dateRanges.includes("1990–2010"));
  assert.ok(handoff.literalIdentifiers.acronyms.includes("MMR"));
  assert.ok(handoff.lookupHints.populations.includes("children"));
  assert.ok(handoff.lookupHints.interventions.includes("MMR vaccination"));
  assert.ok(handoff.lookupHints.outcomes.includes("autism"));
  assert.ok(handoff.lookupHints.geography.includes("U.S."));
  assert.deepEqual(handoff.literalIdentifiers.people, ["Dr. Jane Smith"]);
  assert.deepEqual(handoff.queries.literal, [
    "\"Vaccination did NOT reduce the 1990–2010 chronic-disease rate.\"",
  ]);
  assert.equal(handoff.queries.sourceQualified.length, 1);
  assert.ok(handoff.queries.sourceQualified[0]!.includes(
    "\"Dr. Jane Smith's 2012 study\"",
  ));
});

test("resolved ArticleDocument citation sidecars contribute only their linked reference", () => {
  const document = buildHtmlDocument({
    html: `<article><h1>Citation test</h1>
      <p>The measured outcome changed<sup><a href="#ref-12">12</a></sup>.</p>
      <h2>References</h2><ol>
      <li id="ref-12">12. "A Literal Trial Title." doi:10.1234/Trial.7
      <a href="https://doi.org/10.1234/Trial.7">DOI</a></li>
      <li id="ref-13">13. Unlinked work. doi:10.9999/unlinked.1</li>
      </ol></article>`,
    url: "https://article.test/item",
    metadata: { title: "Citation test" },
  });
  const marker = document.citationMarkers[0];
  const groundedUnit = document.sourceUnits.find(
    (unit: { unitId: string }) => unit.unitId === marker.sourceUnitId,
  );
  assert.ok(groundedUnit);
  const metadata: CfxCitationMetadata = {
    links: document.links,
    citationMarkers: document.citationMarkers,
    references: document.references,
  };
  const handoff = buildCfxEvidenceSearchHandoff({
    review: review("The measured outcome changed."),
    source: source([groundedUnit.unitId]),
    article: {
      sourceUnits: document.sourceUnits.map(
        (unit: {
          unitId: string;
          text: string;
          sourceOffsets: { start: number; end: number };
        }) => ({
          unitId: unit.unitId,
          text: unit.text,
          charStart: unit.sourceOffsets.start,
          charEnd: unit.sourceOffsets.end,
        }),
      ),
      citationMetadata: metadata,
    },
  });
  assert.deepEqual(handoff.literalIdentifiers.citationNumbers, ["12"]);
  assert.deepEqual(handoff.literalIdentifiers.doi, ["10.1234/trial.7"]);
  assert.ok(handoff.literalIdentifiers.urls.includes(
    "https://doi.org/10.1234/Trial.7",
  ));
  assert.equal(
    handoff.literalIdentifiers.doi.includes("10.9999/unlinked.1"),
    false,
  );
});

test("generic study wording does not invent identity but still emits literal lookup clues", () => {
  const row = review(
    "A study did not find an association in children under five.",
  );
  row.assertionSource = "An unnamed study";
  const handoff = buildCfxEvidenceSearchHandoff({
    review: row,
    source: source(),
    article: {
      sourceUnits: [{
        unitId: "U0001",
        text: "The article refers only to a study without a title, author, identifier, or citation.",
        charStart: 0,
        charEnd: 86,
      }],
    },
  });
  assert.deepEqual(handoff.literalIdentifiers.studyTitles, []);
  assert.deepEqual(handoff.literalIdentifiers.people, []);
  assert.deepEqual(handoff.literalIdentifiers.journals, []);
  assert.deepEqual({
    doi: handoff.literalIdentifiers.doi,
    pmid: handoff.literalIdentifiers.pmid,
    urls: handoff.literalIdentifiers.urls,
    citationNumbers: handoff.literalIdentifiers.citationNumbers,
  }, {
    doi: [],
    pmid: [],
    urls: [],
    citationNumbers: [],
  });
  assert.equal(handoff.explicitStudyIdentityFound, false);
  assert.ok(handoff.lookupHints.populations.includes("children"));
  assert.ok(handoff.lookupHints.documentTypes.includes("study"));
  assert.deepEqual(
    handoff.queries.studyLookup,
    [],
    "two generic tokens alone do not justify a query",
  );
  assert.equal(
    row.substantiveAssertion,
    "A study did not find an association in children under five.",
  );
});

test("P05-style grounding extracts literal actors, topics, and useful lookup queries", () => {
  const row: CfxSubstantiveReviewRow = {
    propositionId: "P05",
    substantiveAssertion:
      "The CDC manipulated data linking the MMR vaccine to autism.",
    assertionSource: "William Thompson's whistleblower account",
    articleStance: "adopts",
  };
  const selected: CfxUnitAwareProposition = {
    propositionId: "P05",
    assertion: row.substantiveAssertion,
    assertionSource: row.assertionSource,
    whyItMattersToArticleThesis: "It alleges institutional misconduct.",
    groundingUnitIds: ["U0036", "U0040"],
  };
  const handoff = buildCfxEvidenceSearchHandoff({
    review: row,
    source: selected,
    article: {
      sourceUnits: [{
        unitId: "U0036",
        text: "In 2014, senior CDC scientist William Thompson revealed that the CDC manipulated data linking the MMR vaccine to autism.",
        charStart: 0,
        charEnd: 123,
      }, {
        unitId: "U0040",
        text: "William Thompson's whistleblower account described the omitted data.",
        charStart: 124,
        charEnd: 193,
      }],
    },
  });
  assert.deepEqual(row.substantiveAssertion,
    "The CDC manipulated data linking the MMR vaccine to autism.");
  assert.ok(handoff.literalIdentifiers.organizations.includes("CDC"));
  assert.ok(handoff.literalIdentifiers.people.includes("William Thompson"));
  assert.ok(handoff.literalIdentifiers.acronyms.includes("CDC"));
  assert.ok(handoff.literalIdentifiers.acronyms.includes("MMR"));
  assert.ok(handoff.literalIdentifiers.years.includes("2014"));
  assert.ok(handoff.lookupHints.topics.includes("data manipulation"));
  assert.ok(handoff.lookupHints.interventions.includes("MMR vaccine"));
  assert.ok(handoff.lookupHints.outcomes.includes("autism"));
  assert.ok(handoff.queries.studyLookup.includes(
    "CDC MMR autism data manipulation William Thompson",
  ));
  assert.ok(handoff.queries.studyLookup.includes(
    "William Thompson CDC MMR autism study",
  ));
  assert.ok(handoff.queries.studyLookup.includes(
    "CDC MMR vaccine autism data manipulation 2014",
  ));
});

test("P07-style grounding emits lookup hints and queries without an explicit study identity", () => {
  const row: CfxSubstantiveReviewRow = {
    propositionId: "P07",
    substantiveAssertion:
      "Infants who received the most vaccines had the worst hospitalization and death rates.",
    assertionSource: "Statistical data presented in the article",
    articleStance: "adopts",
  };
  const selected: CfxUnitAwareProposition = {
    propositionId: "P07",
    assertion: row.substantiveAssertion,
    assertionSource: row.assertionSource,
    whyItMattersToArticleThesis: "It supports the article's safety argument.",
    groundingUnitIds: ["U0085", "U0090"],
  };
  const handoff = buildCfxEvidenceSearchHandoff({
    review: row,
    source: selected,
    article: {
      sourceUnits: [{
        unitId: "U0085",
        text: "The proportion of U.S. children with chronic illness increased from 12.8% in the 1980s to 54% by 2011.",
        charStart: 0,
        charEnd: 107,
      }, {
        unitId: "U0090",
        text: "An analysis of two decades of U.S. data (1990-2010) showed that infants who received the most vaccines had the worst hospitalization and death rates.",
        charStart: 108,
        charEnd: 254,
      }],
    },
  });
  assert.equal(handoff.explicitStudyIdentityFound, false);
  assert.ok(handoff.literalIdentifiers.dateRanges.includes("1990-2010"));
  assert.ok(handoff.lookupHints.populations.includes("infants"));
  assert.ok(handoff.lookupHints.exposures.includes(
    "received the most vaccines",
  ));
  assert.ok(handoff.lookupHints.outcomes.includes("hospitalization"));
  assert.ok(handoff.lookupHints.outcomes.includes("death rates"));
  assert.ok(handoff.lookupHints.geography.includes("U.S."));
  assert.ok(handoff.lookupHints.documentTypes.includes("analysis"));
  assert.ok(handoff.queries.studyLookup.includes(
    "\"1990-2010\" infants vaccines hospitalization death rates",
  ));
  assert.ok(handoff.queries.studyLookup.includes(
    "U.S. infants vaccine doses hospitalization mortality study",
  ));
  assert.ok(handoff.queries.studyLookup.includes(
    "infants received the most vaccines worst hospitalization death rates analysis",
  ));
});
