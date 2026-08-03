import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const TASK_CONTENT_ID = 18056;
const REFERENCE_CONTENT_ID = 18017;
const TARGET_CLAIM_ID = 54895;
const URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC6768751";
const CANDIDATE_ID = "CAND-e4db980a3a38e30a17d2";
const RETRIEVAL_SCORE = 0.65676886;
if (process.env.CFX_ALLOW_FROZEN_ONE_DOCUMENT_MILESTONE !== "true") {
  throw new Error(
    "This July frozen-pilot command is quarantined because it contains historical " +
    "content IDs and artifact lineage. Use /api/run-evidence or " +
    "scripts/dev/runCfxFullPipelineLive.mjs. To inspect the historical pilot only, " +
    "set CFX_ALLOW_FROZEN_ONE_DOCUMENT_MILESTONE=true explicitly.",
  );
}
const sourceArtifactPath = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-substantive-review-cf1-f03-20260730234738/source_unit_aware_inventory.json",
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
let runId = `cfx-one-document-18017-${timestamp}`;
let artifactRoot = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03",
  runId,
);

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;",
  })[char]);
}

async function closePool(pool) {
  await promisify(pool.end).bind(pool)();
}

async function main() {
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required");
  }
  const sourceArtifactBytes = await readFile(sourceArtifactPath);
  const pool = mysql.createPool({
    connectionLimit: 4,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    charset: "utf8mb4",
  });
  const query = promisify(pool.query).bind(pool);
  try {
    const [
      { fetchAcademicApiContent },
      { insertEvidenceScrapeBinding, publishEvidenceScrapeTerminal },
      { persistCfxAcquiredText },
      { processCfxDocumentEvidenceBinding },
      { ensureCfxSourceQuality },
      { ensureCfxSourceCrest },
      { processPublishingIdentity },
      { withTransaction },
    ] = await Promise.all([
      import("../../src/core/academicContentResolver.js"),
      import("../../src/services/cfxEvidenceScrapeAdapter.js"),
      import("../../src/services/cfxProductionEvidencePipeline.js"),
      import("../../src/services/cfxEvidenceCoordinator.js"),
      import("../../src/services/cfxSourceQualityCompatibility.js"),
      import("../../src/services/cfxSourceCrestCompatibility.js"),
      import("../../src/services/publishingIdentityPipeline.js"),
      import("../../src/storage/dbTransaction.js"),
    ]);

    const resumeBindingId = Number(process.env.CFX_RESUME_BINDING_ID || 0) || null;
    let resumeBinding = null;
    if (resumeBindingId) {
      const rows = await query(
        `SELECT b.binding_id,b.run_id,b.scrape_job_id,b.requested_url,
                b.reference_content_id,t.acquired_text_version_id
           FROM cfx_evidence_acquisition_bindings b
           JOIN cfx_evidence_text_versions t ON t.binding_id=b.binding_id
          WHERE b.binding_id=? AND b.task_content_id=? AND b.reference_content_id=?
            AND t.selected_for_bearing=1
            AND NOT EXISTS (
              SELECT 1 FROM cfx_targeted_bearing_runs r
               WHERE r.binding_id=b.binding_id
                 AND (r.validation_status<>'provider_failed'
                   OR r.raw_response_json IS NOT NULL
                   OR COALESCE(r.input_tokens,0)>0 OR COALESCE(r.output_tokens,0)>0)
            )
          ORDER BY t.acquired_text_version_id DESC LIMIT 1`,
        [resumeBindingId, TASK_CONTENT_ID, REFERENCE_CONTENT_ID],
      );
      resumeBinding = rows[0] || null;
      if (!resumeBinding) throw new Error("Requested binding is not a resumable pre-model pilot binding");
      runId = resumeBinding.run_id;
      artifactRoot = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
    }
    await mkdir(artifactRoot, { recursive: true });
    const content = await query(
      "SELECT content_id,content_name,url FROM content WHERE content_id=? AND url=? LIMIT 1",
      [REFERENCE_CONTENT_ID, URL],
    );
    if (!content[0]) throw new Error("Frozen pilot document identity does not match production content");
    const target = await query(
      `SELECT c.claim_id,c.claim_text FROM content_claims cc
       JOIN claims c ON c.claim_id=cc.claim_id
       WHERE cc.content_id=? AND c.claim_id=? AND cc.selected_for_evaluation=1 LIMIT 1`,
      [TASK_CONTENT_ID, TARGET_CLAIM_ID],
    );
    if (!target[0]) throw new Error("Frozen P05 target is not an active task assertion");

    const candidate = {
      candidateId:CANDIDATE_ID,propositionId:"P05",queryId:"Q1",provider:"tavily",
      title:"The MMR Vaccine and Autism",authors:[],publication:null,publicationDate:null,
      doi:null,pmid:null,url:URL,canonicalUrl:URL,abstractOrSnippet:null,
      sourceType:"web_search",retrievalRank:5,retrievalScore:RETRIEVAL_SCORE,
      rawArtifactPath:"raw-provider-responses/REQ-P05-Q1.json",discoveryPaths:[],
    };
    let bindingRecord;
    let acquired;
    if (resumeBinding) {
      bindingRecord = {
        binding: {
          bindingId:Number(resumeBinding.binding_id),
          scrapeJobId:Number(resumeBinding.scrape_job_id),
          requestedUrl:resumeBinding.requested_url,
        },
        referenceContentId:REFERENCE_CONTENT_ID,
        sourceUrl:URL,
      };
      acquired = {
        sourceQualityProcessed:false,
        sourceCrestAttempted:true,
        sourceCrestProcessed:false,
      };
    } else {
      // Resolve exactly one governed document before creating mutable scrape
      // state, so an acquisition failure leaves production untouched.
      const academic = await fetchAcademicApiContent(candidate, { disableCache: true });
      if (!academic?.cleanText || academic.retrievalMode !== "full_text") {
        throw new Error("The selected PMC document did not resolve to full text");
      }
      await writeFile(path.join(artifactRoot, "acquisition_response.json"), `${JSON.stringify({
        retrievalMode:academic.retrievalMode,
        title:academic.title,
        identifiers:academic.identifiers,
        characterCount:academic.cleanText.length,
        textSha256:sha256(academic.cleanText),
      }, null, 2)}\n`);
      bindingRecord = await withTransaction(async ({ query: tx }) => {
      const job = await tx(
        `INSERT INTO scrape_jobs
          (requested_by_user_id,requested_by_source,scrape_mode,target_url,
           task_content_id,status,claimed_by_instance_id,claimed_at)
         VALUES (NULL,'api','scrape_specific_url',?,?,'claimed',?,NOW())`,
        [URL, TASK_CONTENT_ID, "cfx-one-document-milestone"],
      );
      const binding = await insertEvidenceScrapeBinding(tx, {
        scrapeJobId: job.insertId,
        context: {
          runId,
          propositionId:"P05",
          candidateId:CANDIDATE_ID,
          acquisitionArtifactId:`ACQ-${runId}`,
          taskContentId:TASK_CONTENT_ID,
          targetClaimId:TARGET_CLAIM_ID,
          referenceContentId:REFERENCE_CONTENT_ID,
          s2ArtifactPath:path.relative(repositoryRoot, sourceArtifactPath),
          s2ArtifactSha256:sha256(sourceArtifactBytes),
          groundingUnitIds:["U0036","U0040"],
          requestedUrl:URL,
        },
      });
      return { binding, referenceContentId:REFERENCE_CONTENT_ID, sourceUrl:URL };
      }, { pool });
      acquired = await persistCfxAcquiredText({
        query,
        bindingRecord,
        candidate,
        academic,
        sourceQualityEnricher:ensureCfxSourceQuality,
        publishingIdentityProcessor:processPublishingIdentity,
        sourceCrestProcessor:ensureCfxSourceCrest,
      });
      if (!acquired) throw new Error("Production acquisition path did not persist text");
    }

    const bearing = await processCfxDocumentEvidenceBinding({
      bindingId:bindingRecord.binding.bindingId,
      resultContentId:REFERENCE_CONTENT_ID,
      query,
      pool,
      sourceQualityAlreadyProcessed:acquired.sourceQualityProcessed,
      sourceCrestAlreadyProcessed:acquired.sourceCrestAttempted === true,
    });
    if (bearing.providerCalls !== 1) {
      throw new Error(`Expected exactly one bearing provider call; observed ${bearing.providerCalls}`);
    }

    await withTransaction(async ({ query: tx }) => {
      await tx(
        `UPDATE scrape_jobs SET status='completed',result_content_id=?,completed_at=NOW()
          WHERE scrape_job_id=? AND status='claimed'`,
        [REFERENCE_CONTENT_ID, bindingRecord.binding.scrapeJobId],
      );
      await publishEvidenceScrapeTerminal(tx, {
        scrapeJobId:bindingRecord.binding.scrapeJobId,
        terminalStatus:"completed",
        resultContentId:REFERENCE_CONTENT_ID,
      });
      await tx(
        `UPDATE cfx_evidence_terminal_outbox
            SET consumed_at=NOW(6),processing_token=NULL,last_consumer_error=NULL
          WHERE binding_id=? AND consumed_at IS NULL`,
        [bindingRecord.binding.bindingId],
      );
    }, { pool });

    const bearingRuns = await query(
      `SELECT targeted_bearing_run_id,run_id,prompt_sha256,schema_sha256,model,
              exact_request_json,raw_response_json,parsed_response_json,
              provider_response_id,validation_status,validation_diagnostics_json,
              input_tokens,output_tokens,latency_ms
         FROM cfx_targeted_bearing_runs WHERE binding_id=? ORDER BY targeted_bearing_run_id`,
      [bindingRecord.binding.bindingId],
    );
    const links = await query(
      `SELECT rctl.reference_claim_task_links_id,rctl.task_claim_id,
              target.claim_text AS target_assertion,rctl.reference_claim_id,
              evidence.claim_text AS evidence_assertion,rctl.stance,rctl.score,
              rctl.confidence,rctl.support_level,rctl.rationale,rctl.quote
         FROM reference_claim_task_links rctl
         JOIN content_relations cr ON cr.content_relation_id=rctl.content_relation_id
         JOIN claims target ON target.claim_id=rctl.task_claim_id
         JOIN claims evidence ON evidence.claim_id=rctl.reference_claim_id
        WHERE cr.content_id=? AND cr.reference_content_id=?
        ORDER BY rctl.task_claim_id,rctl.reference_claim_task_links_id`,
      [TASK_CONTENT_ID, REFERENCE_CONTENT_ID],
    );
    const documentLinks = await query(
      `SELECT ref_claim_link_id,task_claim_id,stance,score,confidence,
              support_level,rationale,scrape_status
         FROM reference_claim_links
        WHERE content_relation_id=(SELECT content_relation_id FROM content_relations
          WHERE content_id=? AND reference_content_id=? LIMIT 1)
        ORDER BY task_claim_id,ref_claim_link_id`,
      [TASK_CONTENT_ID, REFERENCE_CONTENT_ID],
    );
    const textVersions = await query(
      `SELECT acquired_text_version_id,access_level,extraction_method,
              character_count,word_count,cleaned_text_sha256,selected_for_bearing
         FROM cfx_evidence_text_versions WHERE binding_id=?`,
      [bindingRecord.binding.bindingId],
    );
    const sourceQuality = await query(
      `SELECT quality_score,risk_score,quality_tier,scored_by,scoring_model
         FROM source_quality_scores WHERE content_id=?`,
      [REFERENCE_CONTENT_ID],
    );
    const sourceCrest = await query(
      `SELECT admiralty_code,evaluation_status
         FROM admiralty_evaluations
        WHERE target_type='content' AND target_id=? ORDER BY updated_at DESC LIMIT 1`,
      [REFERENCE_CONTENT_ID],
    );
    const result = {
      status:bearing.status,
      runId,
      taskContentId:TASK_CONTENT_ID,
      referenceContentId:REFERENCE_CONTENT_ID,
      referenceTitle:content[0].content_name,
      url:URL,
      scrapeJobId:bindingRecord.binding.scrapeJobId,
      bindingId:bindingRecord.binding.bindingId,
      modelCalls:bearing.providerCalls,
      targetCount:bearing.targetCount,
      targetsWithBearing:bearing.acceptedTargetCount,
      assertionLinkCount:links.length,
      assessedDocumentLinkCount:documentLinks.filter((row) => row.stance !== "insufficient" && row.score != null && row.confidence != null && row.support_level != null).length,
      bearing,
      textVersions,
      sourceQuality,
      sourceCrest,
      links,
      documentLinks,
      bearingRuns:bearingRuns.map((row) => ({
        ...row,
        exact_request_json:typeof row.exact_request_json === "string" ? JSON.parse(row.exact_request_json) : row.exact_request_json,
        raw_response_json:typeof row.raw_response_json === "string" ? JSON.parse(row.raw_response_json) : row.raw_response_json,
        parsed_response_json:typeof row.parsed_response_json === "string" ? JSON.parse(row.parsed_response_json) : row.parsed_response_json,
        validation_diagnostics_json:typeof row.validation_diagnostics_json === "string" ? JSON.parse(row.validation_diagnostics_json) : row.validation_diagnostics_json,
      })),
    };
    const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(path.join(artifactRoot, "result.json"), resultBytes);
    const report = `<!doctype html><meta charset="utf-8"><title>CFX one-document milestone</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 20px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd4df;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f8}pre{white-space:pre-wrap;background:#f6f8fa;padding:16px;border-radius:8px}.ok{color:#087f23}</style><h1>CFX one-document Workspace milestone</h1><p class="ok"><strong>${htmlEscape(result.status)}</strong> — ${result.modelCalls} model call, ${result.assertionLinkCount} assertion link(s), ${result.assessedDocumentLinkCount} assessed document link(s).</p><h2>Document</h2><p><a href="${htmlEscape(URL)}">${htmlEscape(result.referenceTitle)}</a><br>content_id ${REFERENCE_CONTENT_ID}; task ${TASK_CONTENT_ID}; binding ${result.bindingId}; scrape job ${result.scrapeJobId}</p><h2>Persisted assertion links</h2><table><thead><tr><th>Target</th><th>Evidence assertion</th><th>Relation</th><th>Score</th><th>Confidence</th><th>Support</th></tr></thead><tbody>${links.map((row) => `<tr><td>${htmlEscape(row.target_assertion)}</td><td>${htmlEscape(row.evidence_assertion)}</td><td>${htmlEscape(row.stance)}</td><td>${htmlEscape(row.score)}</td><td>${htmlEscape(row.confidence)}</td><td>${htmlEscape(row.support_level)}</td></tr>`).join("")}</tbody></table><h2>Accounting and validation</h2><pre>${htmlEscape(JSON.stringify({textVersions,sourceQuality,sourceCrest,bearing:bearingRuns.map((row) => ({id:row.targeted_bearing_run_id,status:row.validation_status,model:row.model,inputTokens:row.input_tokens,outputTokens:row.output_tokens,latencyMs:row.latency_ms,promptHash:row.prompt_sha256,schemaHash:row.schema_sha256}))}, null, 2))}</pre>`;
    await writeFile(path.join(artifactRoot, "report.html"), report);
    await writeFile(path.join(artifactRoot, "artifact_sha256.txt"), `${sha256(resultBytes)}  result.json\n`);
    console.log(JSON.stringify({
      status:result.status,runId,artifactRoot,modelCalls:result.modelCalls,
      targetCount:result.targetCount,targetsWithBearing:result.targetsWithBearing,
      assertionLinkCount:result.assertionLinkCount,
      assessedDocumentLinkCount:result.assessedDocumentLinkCount,
    }, null, 2));
  } finally {
    await closePool(pool);
  }
}

await main();
