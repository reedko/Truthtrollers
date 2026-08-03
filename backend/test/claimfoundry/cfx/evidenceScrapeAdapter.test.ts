import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  getEvidenceScrapeBinding,
  findReusableEvidenceTextVersion,
  insertEvidenceScrapeBinding,
  normalizeEvidenceScrapeContext,
  persistEvidenceScrapeCapture,
  persistEvidenceTextVersion,
  persistRawEvidenceScrapeReceipt,
  publishEvidenceScrapeTerminal,
} from "../../../src/services/cfxEvidenceScrapeAdapter.js";

type QueryCall = { sql: string; values: unknown[] };

function context() {
  return {
    runId: "cfx-run-1",
    canonicalDocumentId: 9,
    propositionId: "P05",
    candidateId: "candidate-9",
    acquisitionArtifactId: "acq-9",
    taskContentId: 100,
    targetClaimId: 300,
    referenceContentId: 200,
    s2ArtifactPath: "frozen/s2.json",
    s2ArtifactSha256: "a".repeat(64),
    groundingUnitIds: ["U0001"],
    requestedUrl: "https://example.test/original",
    openedTabId: 33,
    extensionInstanceId: "ext_test",
  };
}

test("binding validation preserves production and EvidenceRun identities", () => {
  assert.deepEqual(normalizeEvidenceScrapeContext(context()), context());
  assert.throws(
    () => normalizeEvidenceScrapeContext({
      ...context(),
      requestedUrl: "file:///tmp/private",
    }),
    /http or https/,
  );
  assert.throws(
    () => normalizeEvidenceScrapeContext({ ...context(), candidateId: "" }),
    /candidateId/,
  );
  assert.throws(
    () => normalizeEvidenceScrapeContext({
      ...context(),
      extensionInstanceId: null,
    }),
    /extensionInstanceId is required/,
  );
});

test("binding persists correlation without a shadow status", async () => {
  const calls: QueryCall[] = [];
  const result = await insertEvidenceScrapeBinding(
    async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT acquired_text_version_id")) return [];
      if (sql.startsWith("INSERT INTO cfx_evidence_text_versions")) return { affectedRows: 1, insertId: 11 };
      return { affectedRows: 1 };
    },
    { scrapeJobId: 42, context: context() },
  );
  assert.equal(result.scrapeJobId, 42);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /cfx_evidence_acquisition_bindings/);
  assert.doesNotMatch(calls[0]!.sql, /\bstatus\b/i);
});

test("capture is append-only evidence with exact text hashes", async () => {
  const calls: QueryCall[] = [];
  const capture = await persistEvidenceScrapeCapture(
    async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return { affectedRows: 1 };
    },
    {
      binding: { bindingId: 7, canonicalDocumentId: 9, runId: "cfx-run-1", scrapeJobId: 42, acquisitionArtifactId: "acq-9", requestedUrl: "https://example.test/original" },
      referenceContentId: 200,
      requestedUrl: "https://example.test/original",
      resolvedUrl: "https://mirror.test/document",
      canonicalUrl: "https://example.test/original",
      browserTabId: 33,
      extensionInstanceId: "ext_test",
      rawHtml: "<article>Exact raw</article>",
      rawText: "Exact raw",
      cleanedText: "Exact raw cleaned",
    },
  );
  assert.equal(capture.characterCount, "Exact raw cleaned".length);
  assert.equal(calls.length, 6);
  assert.match(calls[0]!.sql, /^SELECT acquired_text_version_id/m);
  assert.match(calls[1]!.sql, /^INSERT INTO cfx_evidence_text_versions/m);
  assert.equal(calls[1]!.values[4], "snippet");
  assert.match(calls[2]!.sql, /selected_for_bearing=0/);
  assert.match(calls[3]!.sql, /^UPDATE cfx_evidence_acquisition_bindings/m);
  assert.match(calls[4]!.sql, /^UPDATE cfx_canonical_documents/m);
  assert.match(calls[5]!.sql, /^INSERT INTO cfx_canonical_document_identities/m);
  assert.equal(capture.cleanedTextSha256.length, 64);
  assert.notEqual(capture.rawTextSha256, capture.cleanedTextSha256);
});

test("raw provider/browser payload is inserted before derived capture", async () => {
  const calls: QueryCall[] = [];
  const receipt = await persistRawEvidenceScrapeReceipt(
    async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return { affectedRows: 1 };
    },
    {
      binding: { bindingId: 7, scrapeJobId: 42, acquisitionArtifactId: "acq-9", requestedUrl: "https://example.test/original" },
      requestedUrl: "https://example.test/original",
      resolvedUrl: "https://mirror.test/document",
      browserTabId: 33,
      extensionInstanceId: "ext_test",
      rawHtml: "<article>Exact raw</article>",
      rawText: "Exact raw",
    },
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.sql, /^SELECT COALESCE\(MAX\(attempt_ordinal\)/m);
  assert.match(calls[1]!.sql, /^INSERT INTO cfx_evidence_acquisition_attempts/m);
  assert.equal(receipt.rawResponseSha256?.length, 64);
});

test("same hash is idempotent and changed content creates an immutable successor", async () => {
  let selected: { acquired_text_version_id:number; cleaned_text_sha256:string } | null = null;
  let nextId = 10;
  const rows: Array<{ id:number; supersedes:number|null; hash:string }> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    if (sql.startsWith("SELECT acquired_text_version_id")) return selected ? [selected] : [];
    if (sql.startsWith("INSERT INTO cfx_evidence_text_versions")) {
      const contentHash = String(values[10]);
      const duplicate = rows.find((row) => row.hash === contentHash);
      const id = duplicate?.id ?? ++nextId;
      if (!duplicate) rows.push({id,supersedes:values[0] == null ? null : Number(values[0]),hash:contentHash});
      selected = {acquired_text_version_id:id,cleaned_text_sha256:contentHash};
      return {insertId:id,affectedRows:duplicate ? 2 : 1};
    }
    return {affectedRows:1};
  };
  const base = {
    binding:{bindingId:7,requestedUrl:"https://example.test"},
    referenceContentId:200,
    accessLevel:"full_text",
    extractionMethod:"test",
    sourceUrl:"https://example.test",
    resolvedUrl:"https://example.test/final",
    selectedForBearing:true,
  };
  const first = await persistEvidenceTextVersion(query, {...base,cleanedText:"version one"});
  const replay = await persistEvidenceTextVersion(query, {...base,cleanedText:"version one"});
  const changed = await persistEvidenceTextVersion(query, {...base,cleanedText:"version two"});
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.acquiredTextVersionId, first.acquiredTextVersionId);
  assert.equal(changed.created, true);
  assert.equal(changed.supersedesTextVersionId, first.acquiredTextVersionId);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.supersedes, first.acquiredTextVersionId);
});

test("terminal outbox publishes only for a bound production job", async () => {
  const calls: QueryCall[] = [];
  const row = {
    binding_id: 7,
    canonical_document_id: 9,
    scrape_job_id: 42,
    task_content_id: 100,
    target_claim_id: 300,
    reference_content_id: 200,
    run_id: "cfx-run-1",
    proposition_id: "P05",
    candidate_id: "candidate-9",
    acquisition_artifact_id: "acq-9",
    s2_artifact_path: "frozen/s2.json",
    s2_artifact_sha256: "a".repeat(64),
    grounding_unit_ids_json: JSON.stringify(["U0001"]),
    requested_url: "https://example.test/original",
    opened_tab_id: 33,
    extension_instance_id: "ext_test",
  };
  const published = await publishEvidenceScrapeTerminal(
    async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (/SELECT binding_id/.test(sql)) return [row];
      return { affectedRows: 1 };
    },
    {
      scrapeJobId: 42,
      terminalStatus: "completed",
      resultContentId: 200,
    },
  );
  assert.equal(published?.candidateId, "candidate-9");
  assert.match(calls[1]!.sql, /cfx_evidence_terminal_outbox/);
  assert.match(calls[1]!.sql, /ON DUPLICATE KEY/);

  const missing = await publishEvidenceScrapeTerminal(
    async (sql: string) => /SELECT binding_id/.test(sql) ? [] : null,
    { scrapeJobId: 99, terminalStatus: "failed", errorMessage: "blocked" },
  );
  assert.equal(missing, null);
});

test("binding reader returns null for an unbound legacy job", async () => {
  assert.equal(
    await getEvidenceScrapeBinding(async () => [], 77),
    null,
  );
});

test("document-scoped reuse returns a fresh hash-verified selected text version", async () => {
  const cleanedText = "A".repeat(200);
  const cleanedTextSha256 = createHash("sha256").update(cleanedText).digest("hex");
  const now = new Date("2026-08-03T00:00:00.000Z");
  const value = await findReusableEvidenceTextVersion(
    async (sql:string, values:unknown[]) => {
      assert.match(sql, /JOIN cfx_canonical_documents/u);
      assert.equal(values[5], "12345");
      return [{
        acquired_text_version_id: 77,
        binding_id: 66,
        reference_content_id: 55,
        canonical_document_id: 44,
        run_id: "earlier-run",
        access_level: "full_text",
        extraction_method: "publisher_html",
        source_url: "https://example.test/article",
        resolved_url: "https://example.test/article",
        cleaned_text: cleanedText,
        cleaned_text_sha256: cleanedTextSha256,
        character_count: cleanedText.length,
        word_count: 1,
        created_at: "2026-08-02T00:00:00.000Z",
      }];
    },
    { pmid:"12345", maximumAgeMs:2 * 24 * 60 * 60 * 1000, now },
  );
  assert.equal(value?.acquiredTextVersionId, 77);
  assert.equal(value?.sourceRunId, "earlier-run");
  assert.equal(value?.cacheState, "persisted_text_reuse");
});

test("persisted text reuse rejects stale or hash-corrupted rows", async () => {
  const row = {
    acquired_text_version_id: 77,binding_id:66,reference_content_id:55,
    canonical_document_id:44,run_id:"earlier-run",access_level:"full_text",
    extraction_method:"publisher_html",source_url:"https://example.test/article",
    resolved_url:"https://example.test/article",cleaned_text:"B".repeat(200),
    cleaned_text_sha256:"0".repeat(64),character_count:200,word_count:1,
    created_at:"2026-07-01T00:00:00.000Z",
  };
  assert.equal(await findReusableEvidenceTextVersion(async () => [row], {
    canonicalDocumentId:44,maximumAgeMs:1_000,now:new Date("2026-08-03T00:00:00Z"),
  }), null);
  assert.equal(await findReusableEvidenceTextVersion(async () => [{...row,created_at:"2026-08-03T00:00:00Z"}], {
    canonicalDocumentId:44,maximumAgeMs:1_000,now:new Date("2026-08-03T00:00:00Z"),
  }), null);
});
