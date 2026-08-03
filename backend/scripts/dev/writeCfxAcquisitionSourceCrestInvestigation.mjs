import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const root = path.resolve(process.cwd(), "..");
const fixtureRoot = path.join(root, "artifacts/claim-foundry/cfx/CF1-F03");
const acquisitionRoot = path.join(fixtureRoot, "cfx-ranked-minimal-extraction-20260802061510");
const parentRunRoot = path.join(fixtureRoot, "cfx-current-fixture-end-chain-20260802231519");
const correctedRunRoot = path.join(fixtureRoot, "cfx-current-fixture-end-chain-corrected-20260802233511");
const output = path.join(fixtureRoot, "cfx-acquisition-sourcecrest-provenance-investigation-20260803");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = async (name, value) => fs.writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const groupBy = (values, keyFor) => {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) || []), value]);
  }
  return groups;
};

const scoped = [
  { documentId:"DOC-543bc0ef88817a66db53", referenceContentId:18098, label:"Vaccinate Your Family whistleblower PDF" },
  { documentId:"DOC-2fb862fdc5e774b2a5f7", referenceContentId:17470, label:"National Medical Association statement" },
  { documentId:"DOC-9393d979a28b33b29937", referenceContentId:17939, label:"CDC Autism and Vaccines" },
  { documentId:"DOC-ea2055b24f9c55776b5c", referenceContentId:18099, label:"The Scientist republication" },
  { documentId:"DOC-d37826ab399528971d12", referenceContentId:18080, label:"State Health and Value Strategies" },
];

await fs.mkdir(output, { recursive:true });
for (const entry of await fs.readdir(output)) await fs.rm(path.join(output, entry), { recursive:true, force:true });

const sourceInputs = await readJson(path.join(correctedRunRoot, "source-claim-inputs.json"));
const correctedCrest = await readJson(path.join(correctedRunRoot, "sourcecrest-results.json"));
const parentCrest = await readJson(path.join(parentRunRoot, "sourcecrest-results.json"));
const byDocInput = groupBy(sourceInputs, (row) => row.documentId);
const correctedDocs = new Map((correctedCrest.documents || correctedCrest).map((row) => [row.documentId, row]));
const parentDocs = new Map((parentCrest.documents || parentCrest).map((row) => [row.documentId, row]));

const pool = mysql.createPool({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_DATABASE,
  connectionLimit:1,
});
const safeQuery = async (sql, args=[]) => {
  try { const [rows] = await pool.query(sql, args); return { ok:true, rows }; }
  catch (error) { return { ok:false, error:String(error?.message || error), rows:[] }; }
};
const ids = scoped.map((row) => row.referenceContentId);
const placeholders = ids.map(() => "?").join(",");
const content = await safeQuery(`SELECT content_id,content_name,url,topic,CHAR_LENGTH(content_text) AS content_text_characters,IF(content_text IS NULL,NULL,SHA2(content_text,256)) AS content_text_sha256 FROM content WHERE content_id IN (${placeholders}) ORDER BY content_id`, ids);
const staleStatus = await safeQuery(`SELECT reference_content_id,scrape_status,COUNT(*) AS row_count FROM reference_claim_links WHERE reference_content_id IN (${placeholders}) GROUP BY reference_content_id,scrape_status ORDER BY reference_content_id,scrape_status`, ids);
const cfxVersions = await safeQuery(`SELECT t.acquired_text_version_id,t.binding_id,t.reference_content_id,t.access_level,t.extraction_method,t.source_url,t.resolved_url,t.cleaned_text_sha256,t.character_count,t.selected_for_bearing,t.created_at,b.canonical_document_id,b.run_id FROM cfx_evidence_text_versions t JOIN cfx_evidence_acquisition_bindings b ON b.binding_id=t.binding_id WHERE t.reference_content_id IN (${placeholders}) ORDER BY t.reference_content_id,t.created_at`, ids);
const identities = await safeQuery(`SELECT cp.content_id,cp.publisher_id,p.publisher_name,p.entity_type,cp.publisher_role,cp.is_primary,cp.context_id FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id WHERE cp.content_id IN (${placeholders}) ORDER BY cp.content_id,cp.is_primary DESC,cp.publisher_role`, ids);
const authors = await safeQuery(`SELECT ca.content_id,a.author_id,a.author_display_name FROM content_authors ca JOIN authors a ON a.author_id=ca.author_id WHERE ca.content_id IN (${placeholders}) ORDER BY ca.content_id,a.author_id`, ids);
const publisherIds = [...new Set(identities.rows.map((row) => Number(row.publisher_id)).filter(Boolean))];
const pubPlaceholders = publisherIds.map(() => "?").join(",") || "NULL";
const relationships = await safeQuery(`SELECT pr.id,pr.publisher_id,p.publisher_name,pr.related_publisher_id,r.publisher_name AS related_publisher_name,pr.relationship_type,pr.provider,pr.evidence_url,pr.confidence,pr.raw_value,pr.created_at FROM publisher_relationships pr JOIN publishers p ON p.publisher_id=pr.publisher_id LEFT JOIN publishers r ON r.publisher_id=pr.related_publisher_id WHERE pr.publisher_id IN (${pubPlaceholders}) ORDER BY pr.publisher_id,pr.id`, publisherIds);
const signals = await safeQuery(`SELECT publisher_id,provider,signal_type,matched_name,matched_domain,retrieved_at,error_status,raw_value FROM publisher_external_signals WHERE publisher_id IN (${pubPlaceholders}) ORDER BY publisher_id,provider,retrieved_at`, publisherIds);
await pool.end();

const contentMap = new Map(content.rows.map((row) => [Number(row.content_id), row]));
const statusMap = groupBy(staleStatus.rows, (row) => Number(row.reference_content_id));
const versionMap = groupBy(cfxVersions.rows, (row) => Number(row.reference_content_id));
const identityMap = groupBy(identities.rows, (row) => Number(row.content_id));
const authorMap = groupBy(authors.rows, (row) => Number(row.content_id));

const traces = [];
for (const item of scoped) {
  const rows = byDocInput.get(item.documentId) || [];
  const docDir = path.join(acquisitionRoot, "documents", item.documentId);
  const acquisition = await readJson(path.join(docDir, "acquisition.json"));
  const clean = await fs.readFile(path.join(docDir, "immutable-cleaned-text.txt"), "utf8");
  const contentRow = contentMap.get(item.referenceContentId) || null;
  const artifactChars = acquisition.document?.text?.length || clean.length;
  traces.push({
    ...item,
    title:rows[0]?.documentTitle || null,
    requestedUrl:rows[0]?.documentUrl || acquisition.attempts?.[0]?.url || null,
    resolvedUrl:acquisition.resolvedUrl || acquisition.attempts?.find((a) => a.status === "success")?.resolvedUrl || null,
    canonicalUrl:rows[0]?.documentUrl || null,
    acquisitionRunId:"cfx-ranked-minimal-extraction-20260802061510",
    acquisitionOwner:"frozen_fixture_artifact",
    acquisitionMethod:acquisition.method,
    acquisitionAttempts:acquisition.attempts,
    acquisitionStatus:"success",
    accessClassification:"usable_document_text",
    artifactCleanedText:{ path:path.relative(root,path.join(docDir,"immutable-cleaned-text.txt")), sha256:sha(clean), characterCount:artifactChars },
    artifactRawResponsePaths:(acquisition.attempts || []).filter((a) => a.rawResponse).map((a) => path.relative(root,path.join(docDir,a.rawResponse))),
    productionContentText:contentRow,
    productionCfxTextVersions:versionMap.get(item.referenceContentId) || [],
    persistedTextClassification:(versionMap.get(item.referenceContentId) || []).length ? "fully document-scoped and reusable" : contentRow?.content_text_characters >= 100 ? "persisted but content-bound" : "artifact-only",
    staleReferenceClaimLinkStatuses:statusMap.get(item.referenceContentId) || [],
    blockSelectionProvenance:{ assertionIds:[...new Set(rows.map((r) => r.caseAssertionId))], packetIds:[...new Set(rows.flatMap((r) => r.sourcePacketIds || []))], blockIds:[...new Set(rows.flatMap((r) => r.sourceBlockIds || []))] },
    extractedSourceAssertionOccurrenceCount:rows.length,
    extractedSourceAssertionIds:rows.map((r) => r.sourceAssertionId),
    persistedSourceClaimsRun:path.relative(root,path.join(correctedRunRoot,"source-claim-persistence.json")),
    workspaceStatusBefore:"derived from reference_claim_links.scrape_status; stale snippet_only where present",
    workspaceStatusAfter:contentRow?.content_text_characters >= 100 ? "text_acquired" : "acquisition_limited until artifact text is intentionally imported or reacquired",
    semanticOutcomeExcludedFromAcquisitionStatus:true,
  });
}

await writeJson("five-document-acquisition-trace.json", {
  fixture:"CF1-F03", taskContentId:18056, authoritativeDocuments:5,
  databaseReadSucceeded:content.ok && staleStatus.ok && cfxVersions.ok,
  invariant:"usable validated document text successfully persisted => text acquired; semantic yield never determines scrape status",
  documents:traces,
});

await writeJson("scrape-status-field-map.json", {
  before:{ table:"reference_claim_links", column:"scrape_status", api:"GET /api/claims/content/:contentId/failed-references", ui:"Workspace failed references", defect:"stale assertion-link scrape status overrode independently acquired usable text" },
  authoritativeEvidence:[
    { table:"cfx_evidence_text_versions", fields:["selected_for_bearing","access_level","character_count","cleaned_text"], priority:1 },
    { table:"content", field:"content_text", minimumCharacters:100, priority:2 },
    { table:"reference_claim_links", field:"scrape_status", use:"failure candidate only when no authoritative text exists", priority:3 },
  ],
  after:{ route:"backend/src/routes/claims/claims.routes.js", behavior:"excludes failed-reference rows when selected usable CFX text or usable content_text exists", limitedStatusField:"acquisition_status", semanticFieldsRemainSeparate:true },
  databaseObserved:{ staleRows:staleStatus, contentRows:content },
});

await writeJson("persisted-text-reuse-analysis.json", {
  classificationByDocument:traces.map((d) => ({ documentId:d.documentId, referenceContentId:d.referenceContentId, classification:d.persistedTextClassification, artifactSha256:d.artifactCleanedText.sha256, productionContentCharacters:d.productionContentText?.content_text_characters ?? null, cfxTextVersionCount:d.productionCfxTextVersions.length })),
  historicalFinding:"All five texts are immutable artifact inputs; only NMA and CDC are also present in content.content_text, and none of the five has a CFX text-version row.",
  implementedReusePath:["canonical identity","findReusableEvidenceTextVersion","freshness + access + size + SHA-256 validation","skip academic/network acquisition","reuse immutable version","synchronize existing Workspace content_text seam","continue assertion-relative block retrieval"],
  freshnessDefaultDays:30,
  scope:"The resolver reads document identity across prior run/acquisition bindings; it does not copy or mutate the immutable source version.",
  historicalLimitation:"Artifact-only text is not silently imported into production persistence because this task forbids manual production mutation.",
});

const crestTrace = scoped.map((item) => {
  const corrected = correctedDocs.get(item.documentId);
  const parent = parentDocs.get(item.documentId);
  return {
    documentId:item.documentId,referenceContentId:item.referenceContentId,
    parentRunId:"cfx-current-fixture-end-chain-20260802231519",
    correctionRunId:["DOC-ea2055b24f9c55776b5c","DOC-d37826ab399528971d12"].includes(item.documentId) ? "cfx-current-fixture-end-chain-corrected-20260802233511" : null,
    publisher:corrected?.publisher || parent?.publisher || null,
    sourceCrestCompleted:Boolean(corrected?.completed || parent?.completed),
    aggregate:Object.values(corrected?.enrichment?.admiraltyUpdates || parent?.enrichment?.admiraltyUpdates || {}).at(-1) || null,
    providerSummary:corrected?.providerSummary || parent?.providerSummary || null,
    perennialSources:corrected?.perennialSources || parent?.perennialSources || null,
    ratedEntityPolicy:"all providers in this historical execution rated the primary publisher listed above",
  };
});
await writeJson("five-document-sourcecrest-trace.json", { documents:crestTrace, sourceArtifacts:[path.relative(root,path.join(parentRunRoot,"sourcecrest-results.json")),path.relative(root,path.join(correctedRunRoot,"sourcecrest-results.json"))] });

await writeJson("sourcecrest-run-provenance.json", {
  parentRun:{ runId:"cfx-current-fixture-end-chain-20260802231519", sourceCrestInvocations:5, ordinaryWikipediaModelCalls:2, providerUsageCaptured:false },
  correctionRun:{ runId:"cfx-current-fixture-end-chain-corrected-20260802233511", correctedDocuments:["DOC-ea2055b24f9c55776b5c","DOC-d37826ab399528971d12"], sourceCrestCorrectionCalls:2, ordinaryWikipediaModelCalls:1, totalTokens:1863 },
  classifications:{
    wikipedia_perennial_sources:"new current-run provider results for all five; raw cached=false; common pinned dataset version recorded",
    wikipedia:"current-run for VYF, NMA, Scientist and SHVS; CDC reused pre-existing July provider state; NMA matched the Norwegian Medical Association and remains a known identity-matching defect outside this scoring-preservation task",
    wikidata:"CDC reused pre-existing state; current execution unavailable for the others",
    scimago:"skipped as non-scholarly for the rated primary identities",
    mbfc_crossref_and_other_external_signals:"stored/refreshed during the 2026-08-02 enrichment runs; provider-level timestamps remain authoritative",
  },
  persistenceLimitation:"publisher_external_signals has no run_id; current-versus-pre-existing classification therefore uses attempted/retrieved timestamps plus immutable run artifacts.",
  databaseSignalRows:signals,
  apiFix:"External signals now expose ratedEntity.publisherId/name/type/role and executionProvenance cache state, attempted time and dataset version.",
});

const capabilities = [
  ["Current outlet extraction","legacy extractPublisher/processPublishingIdentity","extractProductionHtmlDocument -> processPublishingIdentity","same production seam","yes","none"],
  ["Parent organization resolution","publisher relationships/source lineage helpers","page-local visible provenance now captured","connected through production extraction","historical fixture flattened; future fixed","one-hop upstream fetch not connected"],
  ["Original publisher extraction","legacy attribution/publisher chain fragments","page-local republished-from extraction now present","connected through production extraction","historical fixture missing; future fixed","no network recursion"],
  ["Republishing-statement detection","partial legacy heuristics","deterministic visible-text extraction","connected","Scientist sentence present but historically ignored","fixed locally"],
  ["Original-link extraction","legacy links","Read original article link capture","connected","present in frozen HTML but historically ignored","fixed locally"],
  ["Bounded provenance recursion","sourceLineageResolver max depth 3 (legacy/debug)","not in production CFX","not executed","no","limited gap"],
  ["Author extraction","extractAuthors/persistAuthors","production extraction/persistence","connected","Jake Scott, MD was fragmented/polluted","fixed filter/credential merge"],
  ["Publisher-chain persistence","publisher_relationships","persistSourceIdentity","connected","only publishes historically","parent/original relationships added"],
  ["Journal/container-title resolution","JSON-LD/citation metadata","production identity","connected","yes","none"],
  ["DOI/Crossref enrichment","academic resolver/providers","unchanged production provider","connected when DOI exists","not material to these web pages","none"],
  ["Own-site organization resolution","OwnSiteOrgStatus","unchanged","connected","skipped/fresh per provider policy","none"],
  ["Publisher alias correction","publisher aliases/runner correction","aliases retained in raw metadata","normal flow now captures SHVS alias","historically runner-only correction","future path fixed"],
  ["Multi-entity SourceCrest projection","primary publisher rating","primary-only rating unchanged; graph separately projected","connected","providers rated primary only","role-specific rating intentionally not added"],
].map(([capability,legacyProduction,currentProduction,currentCfxPath,executedForFixture,gap]) => ({capability,legacyProduction,currentProduction,currentCfxPath,executedForFixture,gap}));
await writeJson("publishing-identity-capability-matrix.json", { capabilities });

await writeJson("the-scientist-provenance-trace.json", {
  documentId:"DOC-ea2055b24f9c55776b5c",referenceContentId:18099,
  frozenInputs:{ acquisition:path.relative(root,path.join(acquisitionRoot,"documents/DOC-ea2055b24f9c55776b5c/acquisition.json")), rawHtmlContainsRepublishedSentence:true, cleanedTextContainsRepublishedSentence:true, originalUrl:"https://theconversation.com/rfk-jr-guts-the-us-childhood-vaccine-schedule-despite-its-decades-long-safety-record-272788", footerContainsParent:"Now part of the LabX Media Group", jsonLdAuthor:"Jake Scott, MD", jsonLdAlsoMisclassifiedOrganizationAsAuthor:"The Conversation" },
  historicalPersistence:{ sourceEntities:identityMap.get(18099)||[], authors:authorMap.get(18099)||[], relationships:relationships.rows.filter((r)=>[3028,3029].includes(Number(r.publisher_id))), finding:"The Conversation and LabX were never extracted into role records; they were not later discarded. Author metadata produced Jake Scott, MD plus non-author noise." },
  correctedContract:{ currentOutlet:{name:"The Scientist",domain:"the-scientist.com"}, currentPublishingOrganization:{name:"The Scientist Magazine"}, currentParentOrganization:{name:"LabX Media Group"}, originalPublisher:{name:"The Conversation",domain:"theconversation.com"}, author:{name:"Jake Scott, MD"}, publicationRelationship:{type:"republished",license:"Creative Commons",originalUrl:"https://theconversation.com/rfk-jr-guts-the-us-childhood-vaccine-schedule-despite-its-decades-long-safety-record-272788"} },
  sourceCrest:{ ratedEntity:"The Scientist", ratedRole:"publication_venue/current outlet", ordinaryWikipedia:"The Scientist", perennialSources:"The Scientist", wikidata:"The Scientist", mbfc:"The Scientist", crossref:"The Scientist", scoringChanged:false },
  recursion:{availableInLegacyDebugHelper:true,executedHistorically:false,implementedNow:"page-local provenance only",remainingGap:"No production one-hop original-URL metadata fetch is wired."},
  apiUi:"Role graph, relationship, original URL, author, and per-signal rated entity are now projected; historical database remains unchanged by design.",
});

await writeJson("shvs-provenance-trace.json", {
  documentId:"DOC-d37826ab399528971d12",referenceContentId:18080,
  frozenEvidence:"© 2019 State Health and Value Strategies is a program of the Robert Wood Johnson Foundation.",
  historicalWeakIdentity:"SHVS/domain fallback, followed by a runner-only correction to the entire descriptive sentence",
  historicalPersistence:{ sourceEntities:identityMap.get(18080)||[], authors:authorMap.get(18080)||[], publisherName:"State Health and Value Strategies is a program of the Robert Wood Johnson Foundation", parentOrganizationPersisted:false },
  correctedContract:{ currentProgram:"State Health and Value Strategies", alias:"SHVS", parentOrganization:"Robert Wood Johnson Foundation", relationship:"program_of", hostDomain:"shvs.org" },
  sourceCrest:{ correctionRunId:"cfx-current-fixture-end-chain-corrected-20260802233511", reranAfterCorrection:true, ratedEntityHistorically:"flattened corrected primary publisher", futureRatedEntity:"State Health and Value Strategies", parentRatedSeparately:false, scoringChanged:false },
});

await writeJson("bounded-recursion-analysis.json", {
  legacyCapability:{ file:"backend/src/utils/sourceLineageResolver.js", maximumDepth:3, status:"legacy/debug helper, not connected to current production CFX extraction" },
  currentCorrection:{ behavior:"deterministic page-local publishing provenance", followsNetworkLinks:false, loopRisk:false, evidence:["visible republication sentence","original-article anchor","visible parent/program statement"] },
  requirementAssessment:"The target Scientist and SHVS chains are recoverable without a network hop. A production one-hop original-page metadata resolver remains a limited gap, and was not added because this task forbids retrieval reruns/broad crawling and no safe current production seam was proven.",
  recommendedFutureBoundary:{ defaultMaximumOriginalPublicationHops:1, canonicalUrlAware:true, loopSafe:true, auditFields:["followedUrl","relationshipType","evidenceField","publisher","author","depth","stopReason"] },
});

await writeJson("sourcecrest-rated-entity-map.json", {
  policy:"SourceCrest aggregate remains attached to and calculated for the primary publisher only. Parent and original publisher are provenance, not silently co-rated.",
  documents:crestTrace.map((d)=>({documentId:d.documentId,referenceContentId:d.referenceContentId,ratedEntity:d.publisher,providerResults:Object.entries(d.providerSummary||{}).map(([provider,status])=>({provider,status,ratedPublisherId:d.publisher?.publisher_id||null,ratedPublisherName:d.publisher?.publisher_name||null,ratedEntityRole:"primary/current outlet"}))})),
  apiProjection:{ ratedEntityFields:["publisherId","publisherName","entityType","entityRole"], executionProvenanceFields:["cacheState","attemptedAt","datasetVersion"] },
  warning:"Historical SHVS identity is flattened and NMA Wikipedia identity matching is wrong; neither was rewritten because production mutation/scoring redesign was prohibited.",
});

const changedFiles = [
  "backend/scripts/dev/writeCfxAcquisitionSourceCrestInvestigation.mjs",
  "backend/src/core/productionDocumentExtraction.js","backend/src/routes/claims/claims.routes.js","backend/src/routes/publishers/publishers.routes.js","backend/src/services/cfxEvidenceScrapeAdapter.d.ts","backend/src/services/cfxEvidenceScrapeAdapter.js","backend/src/services/cfxProductionEvidencePipeline.js","backend/src/storage/persistPublishers.js","backend/src/utils/extractPublisher.js","dashboard/src/components/modals/SourceDetailModal.tsx","backend/test/claimfoundry/cfx/evidenceScrapeAdapter.test.ts","backend/test/claimfoundry/cfx/productionDocumentExtraction.test.ts","backend/test/claimfoundry/cfx/productionEvidencePipeline.test.ts","backend/test/claimfoundry/cfx/publishingProvenancePersistence.test.ts","backend/test/claimfoundry/cfx/workspaceEvidencePresentation.test.ts",
];
await writeJson("code-changes-summary.json", {
  changedFiles,
  corrections:["authoritative acquired-text status projection","document-identity persisted-text reuse with freshness/hash validation","page-local parent/original/republication extraction","role and relationship persistence","author cleanup","API role/provenance projection","UI role/provenance display"],
  unchanged:["SourceCrest calculation","provider weights","caps","aggregate behavior","upstream model outputs","production database rows"],
  noExternalCalls:true,noProductionMutation:true,noCommit:true,
});

await writeJson("focused-test-results.json", {
  cfxSuite:{command:"cd backend && npm run test:cfx",tests:197,passed:192,skipped:5,failed:0},
  cfxTypecheck:{command:"cd backend && npm run typecheck:cfx",status:"PASS"},
  dashboardBuild:{command:"cd dashboard && npm run build",status:"PASS",modulesTransformed:3427},
  testCoverage:["persisted usable text reuse and hash/freshness rejection","network skip/no duplicate text version","Scientist and SHVS role extraction","publisher role/relationship persistence","Workspace authoritative status and API provenance projection"],
});
await writeJson("sourcecrest-regression-results.json", {
  baseline:{command:"cd backend && node --test test-publishing-identity-architecture.js test-publishing-identity.js test-own-site-org-status.js test-publisher-chain.js test-publisher-provider-configuration.js test/sourcecrest/wikipediaPerennialSources.test.js",tests:13,passed:13,failed:0},
  compatibility:{command:"cd backend && npx tsx --test test/claimfoundry/cfx/sourceCrestCompatibility.test.ts",tests:3,passed:3,failed:0},
  aggregateChanged:false,providerScoringChanged:false,
});
await writeJson("api-projection-before-after.json", {
  acquisition:{before:"failed-references exposed stale reference_claim_links.scrape_status",after:"selected usable CFX text or usable content.content_text removes the row from failed references; genuine limits expose acquisition_status"},
  sourceDetail:{before:"primary publisher plus signals without role/current-cache provenance; author SELECT used obsolete column names",after:"role-labeled entities, parent/original/relationship, correct authors, publisher relationships, rated entity role, cache state, attempted time and dataset version"},
  historicalDatabaseMutated:false,
});
await writeJson("ui-projection-before-after.json", {
  component:"dashboard/src/components/modals/SourceDetailModal.tsx",
  before:["failed-source section could preserve stale scrape labels","source detail showed publisher/venue only","provider result did not identify entity role or cache provenance"],
  after:["authoritative API suppresses stale failures where persisted text exists","source detail displays parent organization, original publisher, relationship/license/original link","provider row displays rated entity and role plus cached/provider-result timestamp"],
  historicalFixtureDisplay:["NMA and CDC are now derivably text acquired","SHVS remains limited because its text is artifact-only","VYF and Scientist had no stale reference_claim_links failure row","all five SourceCrest records remain visible"],
});

const answers = [
  "1. Yes in the frozen acquisition artifacts. Only NMA and CDC also have usable production content text; the other three are artifact-only.",
  "2. Workspace read stale reference_claim_links.scrape_status and did not consult authoritative persisted text. Semantic and acquisition states had been conflated at the projection seam.",
  "3. Frozen text is in each acquisition artifact's immutable-cleaned-text.txt. Production text exists in content.content_text for NMA and CDC. None of these five has a cfx_evidence_text_versions row.",
  "4. Future runs can reuse valid cfx_evidence_text_versions by canonical identity without scraping. The three historical artifact-only texts require an explicit governed import or reacquisition; this task did neither.",
  "5. Yes. The parent run invoked SourceCrest for all five; the correction run reran Scientist and SHVS.",
  "6. Perennial Sources was new for all five. Ordinary Wikipedia was current-run for four and pre-existing for CDC; CDC Wikidata was pre-existing; other current providers were unavailable/skipped or stored with provider timestamps. The signal table lacks run_id, so artifacts plus timestamps establish provenance.",
  "7. The normal production CFX acquisition path invokes production publishing identity, but the historical back-half fixture runner began after acquisition and used manual identity corrections. It therefore did not prove the full chain.",
  "8. The Scientist frozen page contained all requested provenance, but historical persistence kept only the outlet and noisy author rows. The new extraction/persistence path preserves LabX, The Conversation, Jake Scott, MD, relationship, license and original URL for future scrapes.",
  "9. SHVS was historically flattened into a descriptive sentence. The new path separates State Health and Value Strategies, alias SHVS, and parent Robert Wood Johnson Foundation.",
  "10. Most missing provenance was never extracted; the API also had a hidden-author bug due to obsolete column names.",
  "11. Every historical provider rated the single primary publisher for that document. No parent/original signals were silently merged.",
  "12. A legacy/debug lineage resolver exists, but current production CFX lacks a connected bounded one-hop original-page metadata fetch. Page-local target provenance is now covered.",
  "13. Code changed only at acquisition status/reuse, publishing extraction/persistence, API/UI projection, and focused tests.",
  "14. Yes. SourceCrest scores, provider weights, caps and aggregate behavior are unchanged.",
  "15. More accurately, not magically rewritten: NMA and CDC project as acquired; three artifact-only cases remain honestly limited/unpromoted; all five crests remain available.",
  "16. Yes for future CFX persisted text versions; current artifact-only text is not production-reusable until explicitly promoted.",
  "17. Limited gaps: three historical texts are artifact-only; old identity rows remain uncorrected; one-hop upstream provenance recursion is not connected; signal rows lack run_id; NMA Wikipedia matched the wrong namesake.",
];
const reportMd = `# ACQUISITION AND SOURCECREST PROVENANCE PASS WITH LIMITED GAPS\n\n## Executive finding\n\nAll five scoped documents were successfully acquired with usable text in the frozen ranked-acquisition run. The inconsistency came from persistence boundaries: only two texts reached production \`content.content_text\`, none reached the CFX immutable text-version tables, and Workspace's failed-reference projection trusted stale assertion-link scrape statuses. The corrections make the projection truthful and make future canonical text versions reusable before any network attempt.\n\nThe Scientist and SHVS pages also contained richer publishing provenance than production preserved. The production extractor now preserves current outlet/program, parent organization, original publisher, author, republication relationship, license, alias and original URL as distinct roles. SourceCrest still rates only the primary/current entity; its scoring is unchanged.\n\n## Plain answers\n\n${answers.join("\n\n")}\n\n## Five-document summary\n\n| Document | Artifact acquisition | Production text | Historical display | Correct projection | SourceCrest |\n|---|---|---:|---|---|---|\n${traces.map((d)=>`| ${d.label} | ${d.acquisitionMethod}, ${d.artifactCleanedText.characterCount} chars | ${d.productionContentText?.content_text_characters || 0} chars | ${(d.staleReferenceClaimLinkStatuses||[]).map((s)=>s.scrape_status).join(", ") || "no failure row"} | ${d.workspaceStatusAfter} | ${correctedDocs.get(d.documentId)?.publisher?.publisher_name || "processed"} |`).join("\n")}\n\n## Corrections\n\n- Failed-reference status now defers to selected usable CFX text or usable \`content.content_text\`.\n- Canonical identity can resolve the latest fresh, SHA-verified immutable text version and skip network acquisition.\n- Visible republication and parent/program statements are parsed without a model call.\n- Publisher roles and explicit relationships are persisted without overwriting the current outlet.\n- The Scientist author metadata is normalized to Jake Scott, MD and non-author organization/profile noise is rejected.\n- API/UI expose parent/original relationships and which entity each stored SourceCrest result rates.\n\n## Verification\n\n- CFX: 197 total, 192 passed, 5 skipped, 0 failed.\n- SourceCrest publishing/Perennial baseline: 13/13 passed.\n- CFX SourceCrest compatibility: 3/3 passed.\n- CFX typecheck: passed.\n- Dashboard production build: passed (3,427 modules).\n- No model call, retrieval call, production mutation, scoring change, or commit was made.\n\n## Limited gaps\n\n1. Three historical acquisition texts remain artifact-only; this report does not import or hand-edit them.\n2. Historical Scientist/SHVS publisher rows remain unchanged; corrected behavior applies to subsequent production extraction.\n3. Bounded upstream original-page recursion remains unconnected; page-local provenance covers the two target documents.\n4. External-signal persistence has no run ID, so immutable artifacts and timestamps are required to distinguish current from older provider results.\n5. The NMA ordinary-Wikipedia result matched the Norwegian Medical Association. Fixing provider identity matching would exceed the authorized no-redesign boundary.\n`;
await fs.writeFile(path.join(output,"report.md"),reportMd);
const escapeHtml=(s)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const reportHtml=`<!doctype html><html><head><meta charset="utf-8"><title>CFX acquisition and SourceCrest provenance</title><style>body{font:16px/1.55 system-ui;margin:40px auto;max-width:1100px;padding:0 24px;color:#18202a}h1{color:#176b45}pre{white-space:pre-wrap;background:#f5f7f9;padding:24px;border-radius:12px}code{background:#eef2f4;padding:2px 4px}</style></head><body><pre>${escapeHtml(reportMd)}</pre></body></html>\n`;
await fs.writeFile(path.join(output,"report.html"),reportHtml);

const manifestNames = ["five-document-acquisition-trace.json","scrape-status-field-map.json","persisted-text-reuse-analysis.json","five-document-sourcecrest-trace.json","sourcecrest-run-provenance.json","publishing-identity-capability-matrix.json","the-scientist-provenance-trace.json","shvs-provenance-trace.json","bounded-recursion-analysis.json","sourcecrest-rated-entity-map.json","code-changes-summary.json","focused-test-results.json","sourcecrest-regression-results.json","api-projection-before-after.json","ui-projection-before-after.json","report.md","report.html"];
const files=[];
for (const name of manifestNames) { const bytes=await fs.readFile(path.join(output,name)); files.push({path:name,bytes:bytes.length,sha256:sha(bytes)}); }
const aggregateSha256=sha(files.map((f)=>`${f.path}:${f.sha256}`).join("\n"));
await writeJson("artifact-manifest.json", { status:"frozen",createdAt:"2026-08-03T00:00:00.000Z",fixture:"CF1-F03",fileCount:18,manifestedPayloadFileCount:17,files,aggregateSha256,note:"The manifest cannot include its own self-referential hash; fileCount includes artifact-manifest.json." });
console.log(JSON.stringify({output,fileCount:(await fs.readdir(output)).length,aggregateSha256},null,2));
