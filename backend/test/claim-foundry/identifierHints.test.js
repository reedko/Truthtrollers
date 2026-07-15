import test from "node:test";
import assert from "node:assert/strict";
import { findUngroundedIdentifierHints, identifierOccursInSource, normalizeIdentifierHints } from "../../src/claim-foundry/identifierHints.js";

test("identifier hints normalize DOI/PMID forms and remove duplicates", () => {
  const hints = normalizeIdentifierHints({
    doi: ["https://doi.org/10.1234/ABC", "doi:10.1234/abc"],
    pmid: ["PMID: 12345"],
  });
  assert.deepEqual(hints.doi, ["10.1234/abc"]);
  assert.deepEqual(hints.pmid, ["12345"]);
  assert.deepEqual(hints.titleExact, []);
});

test("identifier grounding accepts source forms and reports invented hints", () => {
  const source = "The paper is DOI:10.1234/ABC and PMID 12345.";
  assert.equal(identifierOccursInSource("10.1234/abc", "doi", source), true);
  assert.equal(identifierOccursInSource("12345", "pmid", source), true);
  assert.deepEqual(findUngroundedIdentifierHints({ doi: ["10.9999/missing"] }, source), [
    { field: "doi", value: "10.9999/missing" },
  ]);
});
