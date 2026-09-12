import test from "node:test";
import assert from "node:assert/strict";
import { buildTraceContextFromDocument, collectRelevantPdfCandidates, collectTraceCandidates } from "../src/modules/provenance/traceSupport/traceSupportContext.js";

test("Trace Support ranks assertion-bearing context and preserves deterministic links", () => {
  const context = buildTraceContextFromDocument({
    assertion: "Including previously excluded data produced an association.",
    sourceUrl: "https://example.org/article",
    title: "Review article",
    documentText: "Full document",
    paragraphs: [
      { index: 0, text: "This is unrelated background material about the broader controversy.", links: [] },
      { index: 1, text: "When the previously excluded data were included, the analysis produced an association.", links: [{ anchorText: "the reanalysis", url: "https://doi.org/10.1000/example" }] },
      { index: 2, text: "The authors cited the reanalysis for that statement.", links: [] },
    ],
    referenceEntries: [{ label: "the reanalysis", citationText: "Example et al.", url: "https://doi.org/10.1000/example" }],
  });

  assert.ok(context.candidatePassages.some((passage) => passage.index === 1));
  assert.deepEqual(context.identifiers.dois, ["10.1000/example"]);
  assert.equal(collectTraceCandidates(context)[0].url, "https://doi.org/10.1000/example");
});

test("Trace Support uses stored text as bounded fallback when structure is unavailable", () => {
  const context = buildTraceContextFromDocument({
    assertion: "A claim",
    sourceUrl: "https://example.org/article",
    documentText: "Stored document text",
  });
  assert.equal(context.fallbackText, "Stored document text");
  assert.deepEqual(context.candidatePassages, []);
});

test("Trace Support retains an assertion-relevant PDF outside the top passages", () => {
  const url = "https://example.org/reanalysis.pdf";
  const candidates = collectRelevantPdfCandidates(
    {
      references: [{
        label: "286% greater chance",
        citationText: "The author reviewed CDC data and reported an association between the MMR vaccine and autism.",
        url,
      }],
    },
    "Internal studies confirmed a link between the MMR vaccine and autism.",
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, url);
});
