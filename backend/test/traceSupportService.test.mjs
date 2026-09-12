import test from "node:test";
import assert from "node:assert/strict";
import { createTraceSupportService, traceSupportEnabled } from "../src/modules/provenance/traceSupport/traceSupportService.js";

test("Trace Support is disabled unless explicitly enabled", () => {
  assert.equal(traceSupportEnabled({}), false);
  assert.equal(traceSupportEnabled({ EVIDENCE_ASSERTION_TRACE_SUPPORT: "true" }), true);
});

test("Trace Support persists a one-hop child without adding a case evidence relation", async () => {
  let inserted = null;
  let latestRun = null;
  const query = async (sql, params = []) => {
    if (sql.includes("SELECT trace_run_id")) return latestRun ? [{ trace_run_id: latestRun }] : [];
    if (sql.includes("JOIN content_claims")) return [{
      content_id: 20, content_name: "Document A", url: "https://example.org/a",
      details: "", content_text: "The passage cites Paper B.",
      claim_id: 30, claim_text: "The measured outcome increased.", claim_type: "reference",
    }];
    if (sql.includes("INSERT INTO provenance_trace_support")) {
      inserted = params;
      latestRun = params[0];
      return { affectedRows: 1 };
    }
    if (sql.includes("FROM provenance_trace_support pts")) return [{
      trace_id: 1, trace_run_id: inserted[0], root_content_id: inserted[1],
      parent_reference_content_id: inserted[2], evidence_claim_id: inserted[3],
      supporting_reference_content_id: inserted[4], source_ordinal: inserted[5], depth: 1,
      resolution_status: inserted[6], source_label: inserted[7], source_url: inserted[8],
      doi: inserted[9], pmid: inserted[10], citation_text: inserted[11], locator_json: inserted[12],
      explanation: inserted[13], publication_status: inserted[14], status_source: inserted[15],
      created_at: new Date(), child_title: "Paper B", child_url: inserted[8],
      child_media_source: "Journal", child_is_retracted: 0, child_publisher: "Journal",
    }];
    throw new Error(`Unexpected query: ${sql}`);
  };

  const service = createTraceSupportService({
    loadContext: async () => ({ contextSource: "stored_text", references: [], candidatePassages: [], identifiers: { dois: [], pmids: [] } }),
    identify: async () => ({ determination: "identified", explanation: "", sources: [{ label: "Paper B", url: "https://journal.example/b", explanation: "Cited for the outcome." }] }),
    resolve: async ({ source }) => ({ ...source, resolutionStatus: "resolved" }),
    acquire: async () => ({ content_id: 40, content_name: "Paper B", url: "https://journal.example/b", is_retracted: 0 }),
    resolveLineage: async () => ({ lineageType: "original", chainDepth: 0 }),
  });

  const sources = await service.run(query, {
    rootContentId: 10, parentReferenceContentId: 20, evidenceClaimId: 30, userId: 5,
  });
  assert.equal(sources[0].supportingReferenceContentId, 40);
  assert.equal(sources[0].depth, 1);
  assert.equal(sources[0].resolutionStatus, "acquired");
  assert.equal(JSON.parse(inserted[12]).sourceLineage.lineageType, "original");
});

test("Trace Support resolves a PDF through PubMed without acquiring the full document", async () => {
  let inserted = null;
  let latestRun = null;
  let acquireCalls = 0;
  const query = async (sql, params = []) => {
    if (sql.includes("SELECT trace_run_id")) return latestRun ? [{ trace_run_id: latestRun }] : [];
    if (sql.includes("JOIN content_claims")) return [{
      content_id: 23112, content_name: "Evidence document", url: "https://example.org/evidence",
      details: "", content_text: "The assertion links to a PDF.",
      claim_id: 63764, claim_text: "An internal study found an association.", claim_type: "reference",
    }];
    if (sql.includes("INSERT INTO provenance_trace_support")) {
      inserted = params;
      latestRun = params[0];
      return { affectedRows: 1 };
    }
    if (sql.includes("FROM provenance_trace_support pts")) return [{
      trace_id: 2, trace_run_id: inserted[0], root_content_id: inserted[1],
      parent_reference_content_id: inserted[2], evidence_claim_id: inserted[3],
      supporting_reference_content_id: inserted[4], source_ordinal: inserted[5], depth: 1,
      resolution_status: inserted[6], source_label: inserted[7], source_url: inserted[8],
      doi: inserted[9], pmid: inserted[10], citation_text: inserted[11], locator_json: inserted[12],
      explanation: inserted[13], publication_status: inserted[14], status_source: inserted[15],
      created_at: new Date(), child_title: null, child_url: null,
      child_media_source: null, child_is_retracted: 0, child_publisher: null,
    }];
    throw new Error(`Unexpected query: ${sql}`);
  };

  const service = createTraceSupportService({
    loadContext: async () => ({ contextSource: "live_document", references: [], candidatePassages: [], identifiers: { dois: [], pmids: [] } }),
    identify: async () => ({ determination: "identified", explanation: "The article links this study.", sources: [{ label: "Hooker reanalysis", url: "https://example.org/hooker.pdf", explanation: "Cited for the assertion." }] }),
    resolve: async ({ source }) => ({ ...source, resolutionStatus: "resolved" }),
    resolveScholarlyIdentity: async () => ({
      identity: { title: "Later reanalysis", author: "Author, Ph.D.", pageCountInspected: 1 },
      title: "Earlier related reanalysis", matchKind: "related", confidence: "high",
      pmid: "25114790", doi: "10.1186/example", canonicalUrl: "https://pubmed.ncbi.nlm.nih.gov/25114790/",
    }),
    acquire: async () => { acquireCalls++; return null; },
    resolveLineage: async () => ({ lineageType: "hosted_copy", chainDepth: 1 }),
    lookupPublicationStatus: async () => ({
      status: "retracted", source: "pubmed_retraction_metadata",
      retractionNotice: { pmid: "25285211", url: "https://pubmed.ncbi.nlm.nih.gov/25285211/", reason: "Methods and statistical analysis concerns." },
    }),
  });

  const sources = await service.run(query, {
    rootContentId: 23016, parentReferenceContentId: 23112, evidenceClaimId: 63764, userId: 1,
  });
  const locator = JSON.parse(inserted[12]);
  assert.equal(acquireCalls, 0);
  assert.equal(sources[0].publicationStatus, "related_work_retracted");
  assert.equal(locator.scholarlyIdentity.matchKind, "related");
  assert.equal(locator.publicationNotice.pmid, "25285211");
});
