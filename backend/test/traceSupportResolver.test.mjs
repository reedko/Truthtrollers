import test from "node:test";
import assert from "node:assert/strict";
import { normalizePublicUrl, resolveTraceSource } from "../src/modules/provenance/traceSupport/traceSupportResolver.js";

test("Trace Support rejects private and non-web acquisition URLs", () => {
  assert.equal(normalizePublicUrl("http://127.0.0.1/admin"), null);
  assert.equal(normalizePublicUrl("http://192.168.1.5/report"), null);
  assert.equal(normalizePublicUrl("file:///etc/passwd"), null);
});

test("Trace Support resolves only a URL present in deterministic document context", async () => {
  const url = "https://journal.example/paper";
  const context = {
    references: [{ label: "Paper", citationText: "Paper citation", url }],
    candidatePassages: [],
    identifiers: { dois: [], pmids: [] },
  };
  const resolved = await resolveTraceSource({
    source: { label: "Paper", url, citationText: null, explanation: "The article cites it." },
    context,
  });
  assert.equal(resolved.resolutionStatus, "resolved");
  assert.equal(resolved.url, url);

  const rejected = await resolveTraceSource({
    source: { label: "Invented", url: "https://other.example/invented" },
    context,
  });
  assert.equal(rejected.resolutionStatus, "unresolved");
  assert.equal(rejected.url, null);
});

test("Trace Support resolves DOI and PMID only when present in document context", async () => {
  const context = {
    references: [], candidatePassages: [],
    identifiers: { dois: ["10.5555/abc"], pmids: ["12345678"] },
  };
  const doi = await resolveTraceSource({ source: { label: "Study", doi: "10.5555/abc" }, context });
  assert.equal(doi.url, "https://doi.org/10.5555/abc");
  const pmid = await resolveTraceSource({ source: { label: "Study", pmid: "12345678" }, context });
  assert.equal(pmid.url, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
});
