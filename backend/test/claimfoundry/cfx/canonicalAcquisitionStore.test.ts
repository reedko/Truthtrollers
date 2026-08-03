import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureCfxCanonicalAcquisition,
  persistCfxDiscoveryAssignments,
  retryCfxCanonicalAcquisition,
} from "../../../src/services/cfxCanonicalDocumentStore.js";

function poolFor(query: Function) {
  return {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        query,
      };
    },
  };
}

test("discovery assignments retain query intent as provenance only", async () => {
  const calls: Array<{sql:string;values:unknown[]}> = [];
  const result = await persistCfxDiscoveryAssignments(
    async (sql:string, values:unknown[]) => {
      calls.push({sql,values});
      return {insertId:1,affectedRows:1};
    },
    {
      runId:"run-1",canonicalDocumentId:9,
      assignments:[{
        propositionId:"P01",targetClaimId:101,candidateId:"C1",queryId:"Q5",
        queryIntent:"counterevidence",query:"claim-specific replication query",
        provider:"pubmed",rank:2,requestId:"REQ-1",assignmentHash:"a".repeat(64),
      }],
    },
  );
  assert.equal(result.assignmentCount, 1);
  assert.equal(calls[0]!.values[6], "counterevidence");
  assert.doesNotMatch(calls[0]!.sql, /\bstance\b|\bbearing\b/iu);
});

test("one canonical acquisition reuses its existing binding and queues no second job", async () => {
  let scrapeJobInserts = 0;
  const query = async (sql:string) => {
    if (sql.startsWith("SELECT canonical_document_id")) return [{canonical_document_id:9}];
    if (sql.startsWith("SELECT binding_id,scrape_job_id,reference_content_id")) {
      return [{binding_id:7,scrape_job_id:42,reference_content_id:200}];
    }
    if (sql.startsWith("INSERT INTO scrape_jobs")) {
      scrapeJobInserts += 1;
      return {insertId:43};
    }
    throw new Error(`unexpected SQL ${sql}`);
  };
  const result = await ensureCfxCanonicalAcquisition({
    pool:poolFor(query),runId:"run-1",canonicalDocumentId:9,
    taskContentId:100,targetClaimId:101,referenceContentId:200,
    sourceUrl:"https://example.test",representative:{candidateId:"C1",propositionId:"P01"},
    sourceArtifactPath:"frozen.json",sourceArtifactSha256:"a".repeat(64),
    groundingUnitIds:["U0001"],queueScrape:true,
  });
  assert.equal(result.created, false);
  assert.equal(result.binding.bindingId, 7);
  assert.equal(scrapeJobInserts, 0);
});

test("retry/resume reuses an active job and replaces only a terminal job", async () => {
  let status = "pending";
  let currentJob = 42;
  let jobInserts = 0;
  const query = async (sql:string, values:unknown[] = []) => {
    if (sql.startsWith("SELECT b.binding_id")) return [{
      binding_id:7,scrape_job_id:currentJob,requested_url:"https://example.test",
      task_content_id:100,status,
    }];
    if (sql.startsWith("INSERT INTO scrape_jobs")) {
      jobInserts += 1;
      return {insertId:43};
    }
    if (sql.startsWith("UPDATE cfx_evidence_acquisition_bindings")) {
      currentJob = Number(values[0]);
      return {affectedRows:1};
    }
    throw new Error(`unexpected SQL ${sql}`);
  };
  const pool = poolFor(query);
  const active = await retryCfxCanonicalAcquisition({pool,bindingId:7});
  assert.equal(active.created, false);
  assert.equal(active.scrapeJobId, 42);
  status = "failed";
  const retry = await retryCfxCanonicalAcquisition({
    pool,bindingId:7,openedTabId:99,extensionInstanceId:"ext-one",
  });
  assert.equal(retry.created, true);
  assert.equal(retry.scrapeJobId, 43);
  assert.equal(jobInserts, 1);
});
