import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requiredRunFile(optionName, environmentName, fileName) {
  const directory = option(optionName) || process.env[environmentName];
  if (!directory) {
    throw new Error(`${optionName} (or ${environmentName}) is required; refusing to seed stale frozen artifacts`);
  }
  return path.join(path.resolve(directory), fileName);
}

const fixtureId = "CF1-F03";
const userId = Number(process.env.CFX_DEV_FIXTURE_USER_ID || 1);
const fixtureFile = path.join(
  backendRoot,
  "test/claim-foundry/fixtures/CF1-F03/article.json",
);
const handoffFile = requiredRunFile(
  "--evidence-handoff-run-dir",
  "CFX_EVIDENCE_HANDOFF_RUN_DIR",
  "evidence_search_handoffs.json",
);
const retrievalFile = requiredRunFile(
  "--retrieval-run-dir",
  "CFX_RETRIEVAL_RUN_DIR",
  "deduped-candidates.json",
);
const taskUrl = "https://fixture.veristrata.local/cfx/CF1-F03";
const discoveryRationalePrefix = "CFX frozen discovery candidate only;";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function requirePositive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

async function findOrCreateContent(connection, input) {
  const [existing] = await connection.query(
    `SELECT content_id FROM content
      WHERE canonical_url_hash=? OR canonical_url=? OR url=?
      ORDER BY content_id LIMIT 1 FOR UPDATE`,
    [sha256(input.url), input.url, input.url],
  );
  if (existing[0]) {
    const contentId = Number(existing[0].content_id);
    await connection.query(
      `UPDATE content SET content_name=?,media_source=?,url=?,assigned=?,progress=?,
         details=?,topic=?,content_type=?,is_retracted=0,is_active=1,
         canonical_url_hash=?,canonical_url=?,content_text=?
       WHERE content_id=?`,
      [input.title, input.publisher, input.url, input.assigned, input.progress,
        input.details, input.topic, input.contentType, sha256(input.url),
        input.url, input.text, contentId],
    );
    return contentId;
  }
  const [result] = await connection.query(
    `INSERT INTO content
       (content_name,media_source,url,assigned,progress,details,topic,content_type,
        is_retracted,is_active,canonical_url_hash,canonical_url,content_text)
     VALUES (?,?,?,?,?,?,?,?,0,1,?,?,?)`,
    [input.title, input.publisher, input.url, input.assigned, input.progress,
      input.details, input.topic, input.contentType, sha256(input.url),
      input.url, input.text],
  );
  return requirePositive(Number(result.insertId), "contentId");
}

async function findOrCreateClaim(connection, claimText) {
  const [existing] = await connection.query(
    `SELECT claim_id FROM claims
      WHERE claim_type='task' AND claim_text=?
      ORDER BY claim_id LIMIT 1 FOR UPDATE`,
    [claimText],
  );
  if (existing[0]) return Number(existing[0].claim_id);
  const [result] = await connection.query(
    `INSERT INTO claims
       (claim_text,claim_type,triage_status,triaged_by,triage_reasoning,
        veracity_score,confidence_level,last_verified)
     VALUES (?,'task','active_evaluation','rule',
       'Frozen CFX S2 development fixture; no truth judgment has been made.',0,0,NOW())`,
    [claimText],
  );
  return requirePositive(Number(result.insertId), "claimId");
}

function candidatePathForProposition(candidate, propositionId) {
  return (candidate.discoveryPaths || [])
    .filter((row) => row.propositionId === propositionId)
    .sort((left, right) =>
      String(left.queryId).localeCompare(String(right.queryId)) ||
      Number(left.retrievalRank) - Number(right.retrievalRank) ||
      String(left.requestId).localeCompare(String(right.requestId)),
    )[0];
}

function selectWorkspaceCandidates(candidateInventory) {
  const selected = [];
  for (let index = 1; index <= 12; index += 1) {
    const propositionId = `P${String(index).padStart(2, "0")}`;
    const rows = candidateInventory.candidates
      .filter((candidate) => candidatePathForProposition(candidate, propositionId))
      .sort((left, right) => {
        const leftPath = candidatePathForProposition(left, propositionId);
        const rightPath = candidatePathForProposition(right, propositionId);
        return String(leftPath.queryId).localeCompare(String(rightPath.queryId)) ||
          Number(leftPath.retrievalRank) - Number(rightPath.retrievalRank) ||
          String(left.candidateId).localeCompare(String(right.candidateId));
      })
      .slice(0, 5);
    if (rows.length !== 5) {
      throw new Error(`${propositionId} must have exactly five frozen Workspace candidates`);
    }
    selected.push(...rows.map((candidate) => ({
      propositionId,
      candidate,
      discoveryPath: candidatePathForProposition(candidate, propositionId),
    })));
  }
  return selected;
}

async function findOrCreateCandidateContent(connection, input) {
  const sourceUrl = input.candidate.canonicalUrl || input.candidate.url;
  if (!/^https?:\/\//u.test(sourceUrl || "")) {
    throw new Error(`${input.candidate.candidateId} has no usable source URL`);
  }
  const [existing] = await connection.query(
    `SELECT content_id FROM content
      WHERE canonical_url_hash=? OR canonical_url=? OR url=?
      ORDER BY content_id LIMIT 1 FOR UPDATE`,
    [sha256(sourceUrl), sourceUrl, input.candidate.url || sourceUrl],
  );
  const details = JSON.stringify({
    role: "cfx-frozen-discovery-candidate",
    fixtureId,
    candidateId: input.candidate.candidateId,
    provider: input.candidate.provider,
    sourceType: input.candidate.sourceType,
    abstractOrSnippet: input.candidate.abstractOrSnippet || null,
    frozenRetrievalArtifact: path.relative(repositoryRoot, retrievalFile),
  });
  if (existing[0]) {
    const contentId = Number(existing[0].content_id);
    await connection.query(
      `UPDATE content SET
         content_name=COALESCE(NULLIF(content_name,''),?),
         canonical_url=COALESCE(canonical_url,?),
         canonical_url_hash=COALESCE(canonical_url_hash,?),
         media_source=COALESCE(NULLIF(media_source,''),?),
         details=COALESCE(details,?),
         content_type=COALESCE(content_type,'reference'),
         is_retracted=0,is_active=1
       WHERE content_id=?`,
      [input.candidate.title || "Evidence candidate", sourceUrl, sha256(sourceUrl),
        input.candidate.provider || "web", details, contentId],
    );
    return contentId;
  }
  const [result] = await connection.query(
    `INSERT INTO content
       (content_name,media_source,url,assigned,progress,details,topic,content_type,
        is_retracted,is_active,canonical_url_hash,canonical_url)
     VALUES (?,?,?,'unassigned','unassigned',?,'CFX Evidence Candidate',
       'reference',0,1,?,?)`,
    [input.candidate.title || "Evidence candidate",
      input.candidate.provider || "web", input.candidate.url || sourceUrl,
      details, sha256(sourceUrl), sourceUrl],
  );
  return requirePositive(Number(result.insertId), "candidateContentId");
}

async function ensureContentRelation(connection, input) {
  await connection.query(
    `INSERT INTO content_relations
       (content_id,reference_content_id,globally_removed,added_by_user_id,is_system)
     VALUES (?,?,0,?,1)
     ON DUPLICATE KEY UPDATE globally_removed=0,is_system=1`,
    [input.taskContentId, input.referenceContentId, userId],
  );
  const [rows] = await connection.query(
    `SELECT content_relation_id FROM content_relations
      WHERE content_id=? AND reference_content_id=? LIMIT 1`,
    [input.taskContentId, input.referenceContentId],
  );
  return requirePositive(Number(rows[0]?.content_relation_id), "contentRelationId");
}

async function ensureDiscoveryLink(connection, input) {
  const rationale = `${discoveryRationalePrefix} bearing has not been evaluated. ` +
    `Candidate ${input.candidate.candidateId} was returned for ${input.propositionId} ` +
    `by ${input.discoveryPath.provider} request ${input.discoveryPath.requestId}.`;
  const [existing] = await connection.query(
    `SELECT ref_claim_link_id,rationale FROM reference_claim_links
      WHERE content_relation_id=? AND claim_id=? AND reference_content_id=?
      ORDER BY ref_claim_link_id LIMIT 1 FOR UPDATE`,
    [input.contentRelationId, input.claimId, input.referenceContentId],
  );
  if (existing[0]) {
    if (String(existing[0].rationale || "").startsWith(discoveryRationalePrefix)) {
      await connection.query(
        `UPDATE reference_claim_links SET task_claim_id=?,stance='insufficient',
           score=0,confidence=0,support_level=0,rationale=?,evidence_text=?,
           evidence_offsets=NULL,created_by_ai=1,verified_by_user_id=NULL,
           scrape_status='snippet_only'
         WHERE ref_claim_link_id=?`,
        [input.claimId, rationale, input.candidate.abstractOrSnippet || null,
          existing[0].ref_claim_link_id],
      );
      return { linkId: Number(existing[0].ref_claim_link_id), disposition: "updated" };
    }
    return { linkId: Number(existing[0].ref_claim_link_id), disposition: "preserved_existing" };
  }
  const [result] = await connection.query(
    `INSERT INTO reference_claim_links
       (claim_id,task_claim_id,content_relation_id,reference_content_id,stance,
        score,confidence,support_level,rationale,evidence_text,evidence_offsets,
        created_by_ai,verified_by_user_id,scrape_status)
     VALUES (?,?,?,?, 'insufficient',0,0,0,?,?,NULL,1,NULL,'snippet_only')`,
    [input.claimId, input.claimId, input.contentRelationId,
      input.referenceContentId, rationale, input.candidate.abstractOrSnippet || null],
  );
  return { linkId: requirePositive(Number(result.insertId), "referenceClaimLinkId"), disposition: "inserted" };
}

async function upsertWorkspaceClaim(connection, input) {
  const [rows] = await connection.query(
    "SELECT cc_id FROM content_claims WHERE content_id=? AND claim_id=? ORDER BY cc_id LIMIT 1 FOR UPDATE",
    [input.contentId, input.claimId],
  );
  if (rows[0]) {
    await connection.query(
      `UPDATE content_claims SET relationship_type='contains',claim_role='pillar',
         claim_order=?,object_claim_text=?,speaker_entity=?,article_stance=?,
         selected_for_evaluation=1,evaluation_eligible=1,search_eligible=1,
         verdict_eligible=1,source_eligible=0,visibility='workspace_eval'
       WHERE cc_id=?`,
      [input.order, input.assertion, input.assertionSource, input.articleStance,
        rows[0].cc_id],
    );
    return Number(rows[0].cc_id);
  }
  const [result] = await connection.query(
    `INSERT INTO content_claims
       (content_id,claim_id,relationship_type,claim_role,claim_order,
        object_claim_text,speaker_entity,article_stance,selected_for_evaluation,
        evaluation_eligible,search_eligible,verdict_eligible,source_eligible,visibility)
     VALUES (?,?,'contains','pillar',?,?,?,?,1,1,1,1,0,'workspace_eval')`,
    [input.contentId, input.claimId, input.order, input.assertion,
      input.assertionSource, input.articleStance],
  );
  return requirePositive(Number(result.insertId), "contentClaimId");
}

async function upsertEvaluationTarget(connection, input) {
  const queryHints = {
    fixtureId,
    propositionId: input.proposition.propositionId,
    whyItMattersToArticleThesis:
      input.proposition.whyItMattersToArticleThesis ?? null,
    groundingUnitIds:
      input.proposition.evidenceSearchHandoff.groundingUnitIds,
    literalIdentifiers:
      input.proposition.evidenceSearchHandoff.literalIdentifiers,
    lookupHints: input.proposition.evidenceSearchHandoff.lookupHints,
    deterministicQueries: input.proposition.evidenceSearchHandoff.queries,
  };
  await connection.query(
    `INSERT INTO claim_evaluation_targets
       (content_id,claim_id,target_type,target_text,subject_entity,object_text,
        source_excerpt,article_stance,score_transform,search_eligible,
        verdict_eligible,resolution_status,target_order,mapping_confidence,
        mapping_rationale,source_claim_id,target_key,query_hints_json)
     VALUES (?,?,'assertion',?,?,?,? ,?,'review',1,1,'unresolved',?,1.0000,
       'Frozen CFX S2 substantive-review proposition.',?,?,?)
     ON DUPLICATE KEY UPDATE target_type=VALUES(target_type),
       target_text=VALUES(target_text),subject_entity=VALUES(subject_entity),
       object_text=VALUES(object_text),source_excerpt=VALUES(source_excerpt),
       article_stance=VALUES(article_stance),score_transform=VALUES(score_transform),
       search_eligible=1,verdict_eligible=1,resolution_status='unresolved',
       mapping_confidence=VALUES(mapping_confidence),
       mapping_rationale=VALUES(mapping_rationale),source_claim_id=VALUES(source_claim_id),
       target_key=VALUES(target_key),query_hints_json=VALUES(query_hints_json)`,
    [input.contentId, input.claimId, input.proposition.substantiveAssertion,
      input.proposition.assertionSource, input.proposition.substantiveAssertion,
      input.proposition.evidenceSearchHandoff.groundingText,
      input.proposition.articleStance, input.order,
      input.proposition.propositionId, `CFX-${input.proposition.propositionId}`,
      JSON.stringify(queryHints)],
  );
}

async function main() {
  requirePositive(userId, "CFX_DEV_FIXTURE_USER_ID");
  const articleBytes = await readFile(fixtureFile, "utf8");
  const handoffBytes = await readFile(handoffFile, "utf8");
  const retrievalBytes = await readFile(retrievalFile, "utf8");
  const article = JSON.parse(articleBytes);
  const handoff = JSON.parse(handoffBytes);
  const candidateInventory = JSON.parse(retrievalBytes);
  if (!Array.isArray(handoff.results) || handoff.results.length !== 12) {
    throw new Error("The frozen CFX S2 handoff must contain exactly 12 propositions");
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      "SELECT user_id,username FROM users WHERE user_id=? AND enabled=1 FOR UPDATE",
      [userId],
    );
    if (!users[0]) throw new Error(`Enabled development user ${userId} not found`);
    const taskContentId = await findOrCreateContent(connection, {
      title: `[CFX DEV FIXTURE] ${fixtureId} — ${article.title}`,
      publisher: "CFX frozen fixture",
      url: taskUrl,
      assigned: "assigned",
      progress: "Awaiting Evaluation",
      details: JSON.stringify({
        fixtureId,
        fixtureArticleSha256: sha256(articleBytes),
        articleContentHash: article.contentHash,
        s2HandoffSha256: sha256(handoffBytes),
        sourceArtifact: path.relative(repositoryRoot, handoffFile),
      }),
      topic: "CFX Development",
      contentType: "task",
      text: article.text,
    });
    await connection.query(
      `INSERT INTO content_users(content_id,user_id)
       VALUES (?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)`,
      [taskContentId, userId],
    );
    const [removedOriginalArticleRelations] = await connection.query(
      `DELETE cr FROM content_relations cr
       JOIN content original_article ON original_article.content_id=cr.reference_content_id
       LEFT JOIN reference_claim_links rcl
         ON rcl.content_relation_id=cr.content_relation_id
       LEFT JOIN reference_claim_task_links rctl
         ON rctl.content_relation_id=cr.content_relation_id
       WHERE cr.content_id=?
         AND (original_article.canonical_url=? OR original_article.url=?)
         AND rcl.ref_claim_link_id IS NULL
         AND rctl.reference_claim_task_links_id IS NULL`,
      [taskContentId, article.url, article.url],
    );
    const claims = [];
    const claimIdByProposition = new Map();
    for (const [index, proposition] of handoff.results.entries()) {
      const claimId = await findOrCreateClaim(
        connection,
        proposition.substantiveAssertion,
      );
      await upsertWorkspaceClaim(connection, {
        contentId: taskContentId,
        claimId,
        order: index + 1,
        assertion: proposition.substantiveAssertion,
        assertionSource: proposition.assertionSource,
        articleStance: proposition.articleStance,
      });
      await upsertEvaluationTarget(connection, {
        contentId: taskContentId,
        claimId,
        order: index,
        proposition,
      });
      claims.push({
        propositionId: proposition.propositionId,
        claimId,
        assertion: proposition.substantiveAssertion,
      });
      claimIdByProposition.set(proposition.propositionId, claimId);
    }
    const selectedCandidates = selectWorkspaceCandidates(candidateInventory);
    const candidateContentIds = new Set();
    const candidateLinks = [];
    for (const selection of selectedCandidates) {
      const claimId = requirePositive(
        Number(claimIdByProposition.get(selection.propositionId)),
        `${selection.propositionId} claimId`,
      );
      const candidateContentId = await findOrCreateCandidateContent(connection, selection);
      const contentRelationId = await ensureContentRelation(connection, {
        taskContentId,
        referenceContentId: candidateContentId,
      });
      const link = await ensureDiscoveryLink(connection, {
        ...selection,
        claimId,
        referenceContentId: candidateContentId,
        contentRelationId,
      });
      candidateContentIds.add(candidateContentId);
      candidateLinks.push({
        propositionId: selection.propositionId,
        candidateId: selection.candidate.candidateId,
        referenceContentId: candidateContentId,
        contentRelationId,
        referenceClaimLinkId: link.linkId,
        disposition: link.disposition,
      });
    }
    await connection.commit();
    console.log(JSON.stringify({
      status: "ready_for_workspace_review",
      fixtureId,
      userId,
      username: users[0].username,
      taskContentId,
      propositionCount: claims.length,
      removedOriginalArticleEvidenceRelationCount:
        Number(removedOriginalArticleRelations.affectedRows || 0),
      discoveryCandidateDocumentCount: candidateContentIds.size,
      discoveryCandidateLinkCount: candidateLinks.length,
      discoveryCandidateSemantics: "insufficient/snippet_only; bearing not evaluated",
      taskUrl,
      originalArticleUrl: article.url,
      claimIds: claims.map((row) => row.claimId),
      sourceArtifact: path.relative(repositoryRoot, handoffFile),
      retrievalArtifact: path.relative(repositoryRoot, retrievalFile),
    }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

await main();
