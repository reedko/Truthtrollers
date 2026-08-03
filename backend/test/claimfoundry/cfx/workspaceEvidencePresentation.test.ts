import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mapAssertionLinkForWorkspace,
  mapDocumentDiscoveryLinkForWorkspace,
  normalizeAssertionBearingRelation,
  relationPresentation,
} from "../../../../dashboard/src/components/evidenceLinkPresentation.js";
import {
  calculateAIClaimScore,
  calculateAIContentScore,
} from "../../../src/modules/aiRatings.js";

const discovery = (overrides: Record<string, unknown> = {}) => ({
  link_id: 17,
  task_claim_id: 101,
  reference_content_id: 501,
  stance: "insufficient" as const,
  score: 80,
  confidence: 0.9,
  support_level: 0.72,
  rationale: "Candidate returned by retrieval",
  quote: "Search-result snippet",
  evidence_offsets: null,
  created_by_ai: true,
  task_claim_text: "Task assertion",
  reference_title: "Candidate document",
  reference_url: "https://example.test/evidence",
  reference_topic: "Evidence",
  scrape_status: "snippet_only",
  ...overrides,
});

test("insufficient, unresolved, and unknown states never normalize to nuance", () => {
  assert.equal(normalizeAssertionBearingRelation("insufficient"), "unassessed");
  assert.equal(normalizeAssertionBearingRelation("snippet_only"), "unassessed");
  assert.equal(normalizeAssertionBearingRelation("metadata_only"), "unassessed");
  assert.equal(normalizeAssertionBearingRelation("unexpected"), "unassessed");
  assert.equal(normalizeAssertionBearingRelation("nuance"), "nuance");
});

test("all document discovery rows are gray, dotted, provisional, and score-neutral", () => {
  for (const stance of ["support", "refute", "nuance", "insufficient"] as const) {
    const link = mapDocumentDiscoveryLinkForWorkspace(discovery({
      stance, score:null, confidence:null, support_level:null,
    }) as any);
    const presentation = relationPresentation(link.relation, link.linkKind);
    assert.equal(link.relation, "unassessed");
    assert.equal(link.linkKind, "document-discovery");
    assert.equal(link.provisional, true);
    assert.equal(link.scoreEligible, false);
    assert.equal(link.confidence, 0);
    assert.equal(presentation.baseColor, "#718096");
    assert.equal(presentation.dotted, true);
    assert.equal(presentation.scoreEligible, false);
    assert.equal(presentation.label, "Unassessed evidence candidate");
  }
});

test("assessed document rows retain legacy metrics and reach the colored Workspace presentation", () => {
  const link = mapDocumentDiscoveryLinkForWorkspace(discovery({
    stance:"refute",score:82,confidence:0.84,support_level:-0.6888,
    scrape_status:"full",
  }));
  const presentation = relationPresentation(link.relation, link.linkKind);
  assert.equal(link.relation, "refute");
  assert.equal(link.linkKind, "document-bearing");
  assert.equal(link.provisional, false);
  assert.equal(link.scoreEligible, true);
  assert.equal(link.confidence, 0.84);
  assert.equal(link.score, 82);
  assert.equal(link.pairConfidence, 0.84);
  assert.equal(link.supportLevel, -0.6888);
  assert.equal(link.verimeter_score, -0.6888);
  assert.equal(presentation.baseColor, "red");
  assert.equal(presentation.dotted, true);
  assert.equal(presentation.scoreEligible, true);
});

test("existing Workspace APIs expose assertion and document metric columns", async () => {
  const referenceRoutes = await readFile(new URL(
    "../../../src/routes/claims/referenceClaimTask.routes.js",
    import.meta.url,
  ), "utf8");
  assert.match(referenceRoutes, /rcl\.score,/u);
  assert.match(referenceRoutes, /rcl\.confidence,/u);
  assert.match(referenceRoutes, /rcl\.support_level,/u);

  const claimRoutes = await readFile(new URL(
    "../../../src/routes/claims/claims.routes.js",
    import.meta.url,
  ), "utf8");
  assert.match(claimRoutes, /rctl\.stance AS relationship/u);
  assert.match(claimRoutes, /rctl\.score AS score/u);
  assert.match(claimRoutes, /rctl\.confidence AS pair_confidence/u);
  assert.match(claimRoutes, /rctl\.support_level AS support_level/u);
});

test("failed-reference projection lets authoritative persisted text override stale snippet labels", async () => {
  const claimRoutes = await readFile(new URL(
    "../../../src/routes/claims/claims.routes.js",
    import.meta.url,
  ), "utf8");
  const endpoint = claimRoutes.slice(
    claimRoutes.indexOf('router.get("/api/failed-references/:taskContentId"'),
    claimRoutes.indexOf("// Hide claim for current user"),
  );
  assert.match(endpoint, /cfx_evidence_text_versions/u);
  assert.match(endpoint, /selected_for_bearing\s*=\s*1/u);
  assert.match(endpoint, /access_level IN \('full_text', 'substantial_excerpt', 'abstract'\)/u);
  assert.match(endpoint, /acquired\.reference_content_id IS NULL/u);
  assert.match(endpoint, /CHAR_LENGTH\(TRIM\(COALESCE\(ref\.content_text, ''\)\)\) < 100/u);
  assert.doesNotMatch(endpoint, /no bearing/u);
});

test("source enrichment API projects provenance roles and rated-entity execution provenance", async () => {
  const publisherRoutes = await readFile(new URL(
    "../../../src/routes/publishers/publishers.routes.js",
    import.meta.url,
  ), "utf8");
  assert.match(publisherRoutes, /parentOrganization: byRole\("parent_organization"\)/u);
  assert.match(publisherRoutes, /originalPublisher: byRole\("original_publisher"\)/u);
  assert.match(publisherRoutes, /publicationRelationship:/u);
  assert.match(publisherRoutes, /entityRole: ratedSourceEntity\?\.publisher_role/u);
  assert.match(publisherRoutes, /cacheState: raw\?\.cached === true/u);
});

test("multiple assertion-level links beneath one document remain independent", () => {
  const rows = [
    { id: "bearing-1", left_claim_id: 101, source_claim_id: 701, relationship: "support" },
    { id: "bearing-2", left_claim_id: 102, source_claim_id: 701, relationship: "refute" },
    { id: "bearing-3", left_claim_id: 103, source_claim_id: 702, relationship: "nuance" },
  ].map((row) => mapAssertionLinkForWorkspace({
    ...row,
    task_content_id: 44,
    right_reference_id: 501,
    confidence: 1,
    score: 90,
    pair_confidence: 0.8,
    support_level: 0.72,
    notes: "validated assertion bearing",
    created_by_ai: 1,
  }));

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.referenceId), [501, 501, 501]);
  assert.deepEqual(rows.map((row) => row.claimId), [101, 102, 103]);
  assert.deepEqual(rows.map((row) => row.sourceClaimId), [701, 701, 702]);
  assert.deepEqual(rows.map((row) => row.relation), ["support", "refute", "nuance"]);
  assert.ok(rows.every((row) => row.linkKind === "assertion-bearing"));
  assert.deepEqual(rows.map((row) => row.confidence), [1, 1, 1]);
  assert.deepEqual(rows.map((row) => row.score), [90, 90, 90]);
  assert.deepEqual(rows.map((row) => row.pairConfidence), [0.8, 0.8, 0.8]);
  assert.deepEqual(rows.map((row) => row.supportLevel), [0.72, 0.72, 0.72]);
  assert.equal(new Set(rows.map((row) => row.id)).size, 3);
});

test("claim AI scoring excludes document-discovery reference_claim_links", async () => {
  let sql = "";
  const score = await calculateAIClaimScore(async (statement: string) => {
    sql = statement;
    return [{ ai_score: 0.25 }];
  }, 101);

  assert.equal(score, 0.25);
  assert.match(sql, /FROM reference_claim_task_links/);
  assert.doesNotMatch(sql, /FROM reference_claim_links(?:\s|$)/);
});

test("content AI scoring uses accepted assertion bearing and not document discovery", async () => {
  let sql = "";
  let params: unknown[] = [];
  const score = await calculateAIContentScore(async (
    statement: string,
    values: unknown[],
  ) => {
    sql = statement;
    params = values;
    return [{ avg_score: -0.5, pro_ratio: 0.25, con_ratio: 0.75 }];
  }, 44);

  assert.deepEqual(params, [44, 44]);
  assert.match(sql, /FROM reference_claim_task_links/);
  assert.doesNotMatch(sql, /FROM reference_claim_links(?:\s|$)/);
  assert.deepEqual(score, {
    verimeter_score: -0.5,
    pro_score: 0.25,
    con_score: 0.75,
  });
});
