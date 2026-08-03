import assert from "node:assert/strict";
import test from "node:test";
import * as productionEvidenceStore from "../../../src/services/cfxProductionEvidenceStore.js";

const {
  persistAcceptedBearingAssertions,
  persistCanonicalCfxTarget,
  projectCfxBearingMetrics,
  adjudicateLegacyEvidence,
  ensureCfxDocumentDiscoveryLink,
  persistCfxAssessedDocumentRelation,
} = productionEvidenceStore as typeof productionEvidenceStore & {
  projectCfxBearingMetrics(row: {
    bearingRelation: string;
    confidence: number;
    quality: number;
  }): {
    stance: string;
    confidence: number;
    quality: number;
    score: number;
    supportLevel: number;
  };
  adjudicateLegacyEvidence(items:unknown[], now?:number):any;
  ensureCfxDocumentDiscoveryLink(query:any,input:any):Promise<number>;
  persistCfxAssessedDocumentRelation(query:any,input:any):Promise<any>;
};

test("legacy metric projection preserves direction and keeps confidence separate", () => {
  assert.deepEqual(projectCfxBearingMetrics({
    bearingRelation: "supports", confidence: 0.8, quality: 0.9,
  }), {stance:"support", confidence:0.8, quality:0.9, score:90, supportLevel:0.72});
  assert.equal(projectCfxBearingMetrics({
    bearingRelation: "challenges", confidence: 0.8, quality: 0.9,
  }).supportLevel, -0.72);
  assert.equal(projectCfxBearingMetrics({
    bearingRelation: "qualifies", confidence: 0.8, quality: 0.9,
  }).supportLevel, 0.36);
  assert.throws(() => projectCfxBearingMetrics({
    bearingRelation: "supports", confidence: 1.1, quality: 0.9,
  }), /confidence must be between 0 and 1/u);
});

test("legacy document adjudication reproduces the production confidence formula", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const result = adjudicateLegacyEvidence([
    {stance:"support",quality:0.8,publishedAt:null},
    {stance:"refute",quality:0.5,publishedAt:null},
  ], now);
  assert.equal(result.finalVerdict, "support");
  assert.ok(Math.abs(result.confidence - 0.8461538461538461) < 1e-12);
});

test("document links progress from neutral discovery to legacy-compatible assessed metrics", async () => {
  const calls:Array<{sql:string;values:unknown[]}> = [];
  let documentExists = false;
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql,values});
    if (sql.startsWith("SELECT content_relation_id")) return [{content_relation_id:5}];
    if (sql.startsWith("SELECT ref_claim_link_id FROM reference_claim_links")) {
      return documentExists ? [{ref_claim_link_id:80}] : [];
    }
    if (sql.startsWith("INSERT INTO reference_claim_links")) {
      documentExists = true;
      return {insertId:80,affectedRows:1};
    }
    if (sql.startsWith("SELECT ref_claim_link_id,verified_by_user_id")) {
      return [{ref_claim_link_id:80,verified_by_user_id:null}];
    }
    if (sql.startsWith("UPDATE reference_claim_links") && sql.includes("stance=IF")) return {affectedRows:1};
    if (sql.startsWith("SELECT ref_claim_link_id,stance,score")) return [{
      ref_claim_link_id:80,stance:"refute",score:80,confidence:null,
      support_level:null,verified_by_user_id:null,
      evidence_offsets:JSON.stringify({
        producer:"cfx_document_bearing_v1",retrievalQuality:0.8,publicationDate:null,
        bearingContributions:[{stance:"refute"}],
      }),
    }];
    if (sql.startsWith("UPDATE reference_claim_links SET confidence=")) return {affectedRows:1};
    throw new Error(`unexpected SQL ${sql}`);
  };
  await ensureCfxDocumentDiscoveryLink(query, {
    taskContentId:10,targetClaimId:30,referenceContentId:20,
    rationale:"Discovered",scrapeStatus:"snippet_only",
  });
  const discoveryInsert = calls.find(({sql}) => sql.startsWith("INSERT INTO reference_claim_links"));
  assert.match(discoveryInsert?.sql || "", /'insufficient',NULL,NULL,NULL/u);

  const assessed = await persistCfxAssessedDocumentRelation(query, {
    taskContentId:10,targetClaimId:30,referenceContentId:20,
    retrievalQuality:0.8,publicationDate:null,scrapeStatus:"full",
    assertions:[{
      bearingRelation:"challenges",quality:0.9,
      exactExcerpt:"The measured result was negative.",
    }],
  });
  assert.deepEqual(assessed, {
    documentLinkId:80,metricWriteStatus:"cfx_written",stance:"refute",
    score:80,confidence:0.784,supportLevel:-0.6272,aggregateConfidence:0.784,
  });
});

test("canonical target preserves the exact S2 assertion and uses production identities", async () => {
  const calls: Array<{sql:string; values:unknown[]}> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql, values});
    if (sql.startsWith("SELECT claim_id")) return [];
    if (sql.startsWith("INSERT INTO claims")) return {insertId: 41};
    if (sql.startsWith("SELECT cc_id")) return [];
    if (sql.startsWith("INSERT INTO content_claims")) return {insertId: 51};
    throw new Error(`unexpected SQL ${sql}`);
  };
  const assertion = "The CDC manipulated data linking the MMR vaccine to autism.";
  const claimId = await persistCanonicalCfxTarget(query, {
    taskContentId: 10,
    substantiveAssertion: assertion,
    assertionSource: "William Thompson",
    articleStance: "adopts",
  });
  assert.equal(claimId, 41);
  assert.equal(calls[1]!.values[0], assertion);
  assert.equal(calls[3]!.values[4], assertion);
});

test("accepted extraction creates evidence claims, provenance, and AI suggestions but never final links", async () => {
  const calls: Array<{sql:string; values:unknown[]}> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql, values});
    if (sql.startsWith("SELECT content_relation_id")) return [{content_relation_id: 5}];
    if (sql.startsWith("SELECT claim_id")) return [];
    if (sql.startsWith("INSERT INTO claims")) return {insertId: 70};
    if (sql.startsWith("SELECT cc_id")) return [];
    if (sql.startsWith("INSERT INTO content_claims")) return {insertId: 71};
    if (sql.startsWith("SELECT claim_source_id")) return [];
    if (sql.startsWith("INSERT INTO claim_sources")) return {insertId: 72};
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) return {affectedRows: 1};
    if (sql.startsWith("SELECT reference_claim_task_links_id")) return [{
      reference_claim_task_links_id: 73, verified_by_user_id: null,
      stance: "refute", score: 90, confidence: 0.8, support_level: -0.72,
    }];
    if (sql.startsWith("INSERT INTO reference_claim_task_link_provenance")) return {insertId: 74};
    throw new Error(`unexpected SQL ${sql}`);
  };
  const result = await persistAcceptedBearingAssertions(query, {
    taskContentId: 10, referenceContentId: 20, targetClaimId: 30,
    targetedBearingRunId: 40, acquiredTextVersionId: 50, accessLevel: "abstract",
    assertions: [{
      evidenceAssertion: "The study reported no association.",
      bearingRelation: "challenges",
      exactExcerpt: "reported no association",
      whyItBears: "It directly reports the measured relationship.",
      confidence: 0.8,
      quality: 0.9,
      sourceLocation: {charStart: 12, charEnd: 35, blockId: "E0001"},
    }],
  });
  assert.deepEqual(result, [{
    evidenceClaimId:70, claimSourceId:72, referenceClaimTaskLinkId:73,
    metrics:{stance:"refute",score:90,confidence:0.8,supportLevel:-0.72},
    metricWriteStatus:"cfx_written",
  }]);
  const linkWrite = calls.find(({sql}) => sql.startsWith("INSERT INTO reference_claim_task_links"));
  assert.deepEqual(linkWrite?.values.slice(3, 7), ["refute", 90, 0.8, -0.72]);
  assert.equal(calls.some(({sql}) => /INSERT INTO claim_links\b/.test(sql)), false);
  assert.equal(calls.some(({sql}) => /claim_link_audit/.test(sql)), false);
});

test("accepted extraction never overwrites a user-verified metric row", async () => {
  const calls: Array<{sql:string; values:unknown[]}> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql, values});
    if (sql.startsWith("SELECT content_relation_id")) return [{content_relation_id: 5}];
    if (sql.startsWith("SELECT claim_id")) return [{claim_id: 70}];
    if (sql.startsWith("SELECT cc_id")) return [{cc_id: 71}];
    if (sql.startsWith("SELECT claim_source_id")) return [{claim_source_id: 72}];
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) return {affectedRows: 0};
    if (sql.startsWith("SELECT reference_claim_task_links_id")) return [{
      reference_claim_task_links_id: 73, verified_by_user_id: 9,
      stance: "support", score: 110, confidence: 0.95, support_level: 1.045,
    }];
    if (sql.startsWith("INSERT INTO reference_claim_task_link_provenance")) return {insertId: 74};
    throw new Error(`unexpected SQL ${sql}`);
  };
  const result = await persistAcceptedBearingAssertions(query, {
    taskContentId:10,referenceContentId:20,targetClaimId:30,
    targetedBearingRunId:40,acquiredTextVersionId:50,accessLevel:"full_text",
    assertions:[{
      evidenceAssertion:"The study reported no association.",
      bearingRelation:"challenges",exactExcerpt:"reported no association",
      whyItBears:"Direct result.",confidence:0.8,quality:0.9,
      sourceLocation:{charStart:12,charEnd:35,blockId:"E0001"},
    }],
  });
  assert.equal(result[0]?.metricWriteStatus, "verified_value_preserved");
  assert.deepEqual(result[0]?.metrics, {
    stance:"support",score:110,confidence:0.95,supportLevel:1.045,
  });
  const upsert = calls.find(({sql}) => sql.startsWith("INSERT INTO reference_claim_task_links"));
  assert.match(upsert?.sql || "", /verified_by_user_id IS NULL/u);
  const provenance = calls.find(({sql}) => sql.startsWith("INSERT INTO reference_claim_task_link_provenance"));
  assert.match(String(provenance?.values[7]), /historical_verified_value_preserved/u);
});

test("accepted Phase 3 pair retains reference_claim_task_links and conditional target dual-write", async () => {
  const prior = process.env.ENABLE_MULTI_TARGET_EVIDENCE;
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const calls:Array<{sql:string;values:unknown[]}> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql,values});
    if (sql.startsWith("SELECT content_relation_id")) return [{content_relation_id:5}];
    if (sql.startsWith("SELECT claim_id")) return [];
    if (sql.startsWith("INSERT INTO claims")) return {insertId:70};
    if (sql.startsWith("SELECT cc_id")) return [];
    if (sql.startsWith("INSERT INTO content_claims")) return {insertId:71};
    if (sql.startsWith("SELECT claim_source_id")) return [];
    if (sql.startsWith("INSERT INTO claim_sources")) return {insertId:72};
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) return {affectedRows:1};
    if (sql.startsWith("SELECT reference_claim_task_links_id")) return [{
      reference_claim_task_links_id:73,verified_by_user_id:null,
      stance:"support",score:80,confidence:0.75,support_level:0.6,
    }];
    if (sql.startsWith("INSERT INTO reference_claim_task_link_provenance")) return {insertId:74};
    if (sql.includes("FROM claim_evaluation_targets")) return [{
      evaluation_target_id:90,claim_id:30,target_type:"substantive",
    }];
    if (sql.startsWith("INSERT INTO evaluation_target_evidence_links")) return {insertId:91};
    throw new Error(`unexpected SQL ${sql}`);
  };
  try {
    await persistAcceptedBearingAssertions(query, {
      taskContentId:10,referenceContentId:20,targetClaimId:30,
      targetedBearingRunId:40,acquiredTextVersionId:50,accessLevel:"full_text",
      assertions:[{
        evidenceAssertion:"The measured result supports the target.",
        bearingRelation:"supports",exactExcerpt:"measured result supports",
        whyItBears:"Direct measured result.",confidence:0.75,quality:0.8,
        sourceLocation:{charStart:4,charEnd:28,blockId:"E0001"},
      }],
    });
  } finally {
    if (prior === undefined) delete process.env.ENABLE_MULTI_TARGET_EVIDENCE;
    else process.env.ENABLE_MULTI_TARGET_EVIDENCE = prior;
  }
  assert.equal(calls.some(({sql}) => sql.startsWith("INSERT INTO reference_claim_task_links")), true);
  const targetWrite = calls.find(({sql}) => sql.startsWith("INSERT INTO evaluation_target_evidence_links"));
  assert.deepEqual(targetWrite?.values.slice(0, 5), [90,20,70,"support",0.8]);
});
