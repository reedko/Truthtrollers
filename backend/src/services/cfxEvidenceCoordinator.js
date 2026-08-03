import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAiLLM } from "../core/openAiLLM.js";
import { withTransaction } from "../storage/dbTransaction.js";
import {
  persistCfxAssessedDocumentRelation,
  persistAcceptedBearingAssertions,
  persistTargetedBearingRun,
} from "./cfxProductionEvidenceStore.js";
import { ensureCfxSourceQuality } from "./cfxSourceQualityCompatibility.js";
import { ensureCfxSourceCrest } from "./cfxSourceCrestCompatibility.js";
import {
  claimCfxDocumentSemanticExecution,
  finishCfxDocumentSemanticExecution,
} from "./cfxDocumentSemanticExecutionStore.js";

let consumerRunning = false;
let recoveryTimer = null;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Durable, immediate write of a raw provider response before any
// validation or DB persistence runs. A paid bearing call that succeeds but
// is then lost to a validation bug or a DB error (e.g. a missing table)
// must still leave the actual model output on disk -- otherwise the only
// way to recover it is to pay for the call again.
async function preserveRawBearingResponse({ runId, taskContentId, bindingId, part, rawResponse }) {
  try {
    const directory = path.join(
      repoRoot, "artifacts/claim-foundry/cfx/production",
      String(taskContentId), String(runId), "document-bearing-raw",
    );
    await mkdir(directory, { recursive: true });
    const fileName = `binding-${bindingId}-part-${String(part).padStart(3, "0")}-${Date.now()}.json`;
    await writeFile(path.join(directory, fileName), JSON.stringify(rawResponse, null, 2));
  } catch (error) {
    console.error(`[CFX] Failed to durably preserve raw bearing response for binding ${bindingId}:`, error);
  }
}

function usage(raw = {}) {
  const inputTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
  const outputTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0;
  return {
    inputTokens,
    cachedInputTokens: Number(raw.prompt_tokens_details?.cached_tokens ?? 0) || 0,
    outputTokens,
    totalTokens: Number(raw.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens,
  };
}

export function createProductionCfxStructuredProvider(llm = openAiLLM) {
  return {
    async invokeStructured(request) {
      const response = await llm.generate({
        system: request.system,
        user: request.user,
        jsonSchema: request.responseSchema,
        schemaHint: JSON.stringify(request.responseSchema.schema),
        temperature: request.temperature,
        store: false,
        model: request.model,
        maxOutputTokens: request.maxOutputTokens,
        timeout: request.timeoutMs,
        // openAiLLM names this option maxRetries, but interprets it as total
        // attempts. One initial attempt plus the governed retry count preserves
        // zero-retry semantics without suppressing the request entirely.
        maxRetries: request.retryCount + 1,
        returnMetadata: true,
      });
      return {
        output: response.output,
        rawResponse: response.rawResponse,
        model: response.model || request.model,
        usage: usage(response.usage),
        responseId: response.rawResponse?.id ?? null,
        requestId: response.rawResponse?.request_id ?? null,
      };
    },
  };
}

async function runtime() {
  return import("../../dist/claimfoundry/cfx/evidenceBearing/targetedExtraction.js");
}

async function documentRuntime() {
  return import("../../dist/claimfoundry/cfx/evidenceBearing/documentExtraction.js");
}

async function claimOutbox(pool) {
  const token = randomUUID();
  return withTransaction(async ({ query }) => {
    await query(
      `UPDATE cfx_evidence_terminal_outbox
          SET processing_started_at=NULL,processing_token=NULL
        WHERE consumed_at IS NULL AND processing_started_at < DATE_SUB(NOW(6),INTERVAL 10 MINUTE)`,
    );
    const rows = await query(
      `SELECT outbox_id,binding_id,scrape_job_id,terminal_status,
              result_content_id,error_message,payload_json
         FROM cfx_evidence_terminal_outbox
        WHERE consumed_at IS NULL AND processing_token IS NULL
        ORDER BY created_at,outbox_id LIMIT 1 FOR UPDATE`,
    );
    if (!rows?.[0]) return null;
    await query(
      `UPDATE cfx_evidence_terminal_outbox
          SET processing_started_at=NOW(6),processing_token=?,consumer_attempts=consumer_attempts+1
        WHERE outbox_id=? AND consumed_at IS NULL AND processing_token IS NULL`,
      [token, rows[0].outbox_id],
    );
    return { ...rows[0], processingToken: token };
  }, { pool });
}

async function finishOutbox(query, event, error = null) {
  await query(
    `UPDATE cfx_evidence_terminal_outbox
        SET consumed_at=NOW(6),last_consumer_error=?,processing_token=NULL
      WHERE outbox_id=? AND processing_token=?`,
    [error, event.outbox_id, event.processingToken],
  );
}

export async function processCfxEvidenceBinding({
  bindingId,
  resultContentId = null,
  query,
  pool,
  provider = createProductionCfxStructuredProvider(),
  model = process.env.CFX_TARGETED_BEARING_MODEL || "gpt-4o-mini",
  runtimeLoader = runtime,
  sourceQualityEnricher = ensureCfxSourceQuality,
  sourceCrestProcessor = ensureCfxSourceCrest,
  sourceQualityAlreadyProcessed = false,
  sourceCrestAlreadyProcessed = false,
  retrievalQuality = null,
  publicationDate = null,
} = {}) {
  if (!pool) throw new TypeError("pool is required");
  const canonicalBindingId = Number(bindingId);
  if (!Number.isSafeInteger(canonicalBindingId) || canonicalBindingId <= 0) {
    throw new TypeError("bindingId must be a positive integer");
  }

  const rows = await query(
    `SELECT b.binding_id,b.run_id,b.proposition_id,b.candidate_id,
            b.task_content_id,b.target_claim_id,b.reference_content_id,
            c.claim_text AS target_assertion,t.acquired_text_version_id,
            t.access_level,t.extraction_method,t.source_url,t.resolved_url,
            t.cleaned_text,t.character_count,t.word_count
            ,(SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality'))
                FROM cfx_evidence_acquisition_attempts a
               WHERE a.binding_id=b.binding_id
                 AND JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality') IS NOT NULL
               ORDER BY a.attempt_ordinal LIMIT 1) AS retrieval_quality
            ,(SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.publicationDate'))
                FROM cfx_evidence_acquisition_attempts a
               WHERE a.binding_id=b.binding_id
                 AND JSON_EXTRACT(a.response_metadata_json,'$.publicationDate') IS NOT NULL
               ORDER BY a.attempt_ordinal LIMIT 1) AS publication_date
       FROM cfx_evidence_acquisition_bindings b
       JOIN claims c ON c.claim_id=b.target_claim_id
       JOIN cfx_evidence_text_versions t ON t.binding_id=b.binding_id
      WHERE b.binding_id=? AND t.selected_for_bearing=1
      ORDER BY t.created_at DESC,t.acquired_text_version_id DESC LIMIT 1`,
    [canonicalBindingId],
  );
  const row = rows?.[0];
  if (!row) return { status: "pending_text", bindingId: canonicalBindingId, providerCalls: 0 };
  if (row.access_level === "metadata_only") {
    return { status: "metadata_only", bindingId: canonicalBindingId, providerCalls: 0 };
  }

  if (!sourceQualityAlreadyProcessed) {
    await sourceQualityEnricher({
      query,
      referenceContentId: row.reference_content_id || resultContentId,
      contentText: row.cleaned_text,
      url: row.resolved_url || row.source_url,
      metadata: {},
    });
  }
  if (!sourceCrestAlreadyProcessed) {
    await sourceCrestProcessor({
      query,
      referenceContentId: row.reference_content_id || resultContentId,
    });
  }

  const module = await runtimeLoader();
  const prompt = await module.loadCfxTargetedBearingPrompt();
  let exactRequest = null;
  let rawResponse = null;
  let responseMetadata = null;
  const startedAt = new Date();
  const result = await module.runCfxTargetedBearingExtraction({
    candidateId: row.candidate_id,
    propositionId: row.proposition_id,
    targetAssertion: row.target_assertion,
    access: {
      candidateId: row.candidate_id,
      accessLevel: row.access_level,
      textSource: row.extraction_method,
      text: row.cleaned_text,
      characterCount: Number(row.character_count),
      wordCount: Number(row.word_count),
      sourceUrl: row.source_url,
      canonicalUrl: row.resolved_url,
      doi: null,
      pmid: null,
      retrievalAttempts: [],
      accessDiagnostics: [],
    },
    prompt,
    provider,
    model,
    temperature: 0.1,
    maxOutputTokens: 6_000,
    timeoutMs: 180_000,
    async beforeInvoke(request) { exactRequest = request; },
    async afterResponse(value) {
      rawResponse = value.rawResponse;
      responseMetadata = value.metadata;
    },
  });
  const completedAt = new Date();
  const persisted = await withTransaction(async ({ query: tx }) => {
    const bearingRunId = await persistTargetedBearingRun(tx, {
      bindingId: row.binding_id,
      acquiredTextVersionId: row.acquired_text_version_id,
      targetClaimId: row.target_claim_id,
      runId: `cfx-bearing-${row.run_id}-${row.candidate_id}-${Date.now()}`,
      promptHash: result.promptHash,
      schemaHash: result.schemaHash,
      model: result.model || model,
      exactRequest,
      rawResponse,
      parsedResponse: result.rawOutput,
      providerResponseId: result.responseId || responseMetadata?.responseId,
      validationStatus: result.extraction ? "accepted" : rawResponse ? "rejected" : "provider_failed",
      validationDiagnostics: result.diagnostics,
      usage: result.usage,
      latencyMs: result.latencyMs,
      startedAt,
      completedAt,
    });
    const assertions = result.extraction
      ? await persistAcceptedBearingAssertions(tx, {
          taskContentId: row.task_content_id,
          referenceContentId: row.reference_content_id || resultContentId,
          targetClaimId: row.target_claim_id,
          targetedBearingRunId: bearingRunId,
          acquiredTextVersionId: row.acquired_text_version_id,
          accessLevel: row.access_level,
          assertions: result.extraction.assertions,
        })
      : [];
    const effectiveRetrievalQuality = retrievalQuality !== null
      && retrievalQuality !== undefined
      && Number.isFinite(Number(retrievalQuality))
      ? Number(retrievalQuality)
      : row.retrieval_quality !== null
        && row.retrieval_quality !== undefined
        && Number.isFinite(Number(row.retrieval_quality))
        ? Number(row.retrieval_quality)
        : null;
    const documentRelation = result.extraction && effectiveRetrievalQuality !== null
      ? await persistCfxAssessedDocumentRelation(tx, {
          taskContentId: row.task_content_id,
          referenceContentId: row.reference_content_id || resultContentId,
          targetClaimId: row.target_claim_id,
          retrievalQuality: effectiveRetrievalQuality,
          publicationDate: publicationDate || row.publication_date || null,
          assertions: result.extraction.assertions,
          rationale: `CFX accepted ${result.extraction.assertions.length} assertion-level bearing result(s).`,
          evidenceText: result.extraction.assertions[0]?.exactExcerpt || null,
          scrapeStatus: row.access_level === "abstract"
            ? "abstract_only"
            : row.access_level === "snippet"
              ? "snippet_only"
              : "full",
        })
      : null;
    return { bearingRunId, assertions, documentRelation };
  }, { pool });
  return {
    status: result.extraction ? "completed" : "rejected",
    bindingId: canonicalBindingId,
    providerCalls: result.providerCallCount,
    bearingRunId: persisted.bearingRunId,
    evidenceAssertionCount: persisted.assertions.length,
    documentRelation: persisted.documentRelation,
  };
}

/**
 * Consume one selected acquired document with one model request containing the
 * complete fixed case-assertion inventory. This is the production scrape
 * outbox path; it replaces the prior one-target-per-binding behavior without
 * introducing another semantic pass.
 */
export async function processCfxDocumentEvidenceBinding({
  bindingId,
  resultContentId = null,
  query,
  pool,
  provider = createProductionCfxStructuredProvider(),
  model = process.env.CFX_DOCUMENT_BEARING_MODEL || "gpt-4o-mini",
  runtimeLoader = documentRuntime,
  sourceQualityEnricher = ensureCfxSourceQuality,
  sourceCrestProcessor = ensureCfxSourceCrest,
  sourceQualityAlreadyProcessed = false,
  sourceCrestAlreadyProcessed = false,
  executionClaimer = claimCfxDocumentSemanticExecution,
  executionFinisher = finishCfxDocumentSemanticExecution,
  maximumProviderCalls = Number(process.env.CFX_MAX_DOCUMENT_BEARING_CALLS || 1),
} = {}) {
  if (!pool) throw new TypeError("pool is required");
  const canonicalBindingId = Number(bindingId);
  if (!Number.isSafeInteger(canonicalBindingId) || canonicalBindingId <= 0) {
    throw new TypeError("bindingId must be a positive integer");
  }
  const rows = await query(
    `SELECT b.binding_id,b.run_id,b.canonical_document_id,b.candidate_id,b.task_content_id,
            b.target_claim_id,b.reference_content_id,t.acquired_text_version_id,
            t.access_level,t.extraction_method,t.source_url,t.resolved_url,
            t.cleaned_text,t.character_count,t.word_count,
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality'))
               FROM cfx_evidence_acquisition_attempts a
              WHERE a.binding_id=b.binding_id
                AND JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality') IS NOT NULL
              ORDER BY a.attempt_ordinal LIMIT 1) AS retrieval_quality,
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.publicationDate'))
               FROM cfx_evidence_acquisition_attempts a
              WHERE a.binding_id=b.binding_id
                AND JSON_EXTRACT(a.response_metadata_json,'$.publicationDate') IS NOT NULL
              ORDER BY a.attempt_ordinal LIMIT 1) AS publication_date
       FROM cfx_evidence_acquisition_bindings b
       JOIN cfx_evidence_text_versions t ON t.binding_id=b.binding_id
      WHERE b.binding_id=? AND t.selected_for_bearing=1
      ORDER BY t.created_at DESC,t.acquired_text_version_id DESC LIMIT 1`,
    [canonicalBindingId],
  );
  const row = rows?.[0];
  if (!row) return { status: "pending_text", bindingId: canonicalBindingId, providerCalls: 0 };
  if (!["full_text", "substantial_excerpt", "abstract"].includes(row.access_level)) {
    return { status: row.access_level, bindingId: canonicalBindingId, providerCalls: 0 };
  }
  const targetRows = await query(
    `SELECT cc.claim_id,cc.claim_order,c.claim_text
       FROM content_claims cc
       JOIN claims c ON c.claim_id=cc.claim_id
      WHERE cc.content_id=? AND cc.selected_for_evaluation=1
        AND cc.evaluation_eligible=1
      ORDER BY cc.claim_order,cc.cc_id`,
    [row.task_content_id],
  );
  if (!targetRows?.length) {
    throw new Error(`No fixed evaluation assertions found for task ${row.task_content_id}`);
  }
  const targets = targetRows.map((target, index) => ({
    propositionId: `P${String(Number(target.claim_order) || index + 1).padStart(2, "0")}`,
    claimId: Number(target.claim_id),
    assertion: target.claim_text,
  }));

  const referenceContentId = Number(row.reference_content_id || resultContentId);
  const module = await runtimeLoader();
  const prompt = await module.loadCfxDocumentBearingPrompt();
  const access = {
    candidateId: row.candidate_id,
    accessLevel: row.access_level,
    textSource: row.extraction_method,
    text: row.cleaned_text,
    characterCount: Number(row.character_count),
    wordCount: Number(row.word_count),
    sourceUrl: row.source_url,
    canonicalUrl: row.resolved_url,
    doi: null,
    pmid: null,
    retrievalAttempts: [],
    accessDiagnostics: [],
  };
  const providerCallLimit = Number(maximumProviderCalls);
  if (!Number.isSafeInteger(providerCallLimit) || providerCallLimit < 1 || providerCallLimit > 8) {
    throw new TypeError("maximumProviderCalls must be an integer from 1 through 8");
  }
  const requestPartCount = typeof module.buildCfxDocumentBearingRequests === "function"
    ? module.buildCfxDocumentBearingRequests({
        documentId: row.candidate_id,
        targets,
        access,
        prompt,
        model,
        temperature: 0.1,
        maxOutputTokens: 8_000,
        timeoutMs: 180_000,
      }).length
    : 1;
  if (requestPartCount > providerCallLimit) {
    return {
      status: "multipart_authorization_required",
      bindingId: canonicalBindingId,
      providerCalls: 0,
      requestPartCount,
      maximumProviderCalls: providerCallLimit,
      targetCount: targets.length,
    };
  }
  const execution = await executionClaimer({
    pool,
    identity: {
      runId: row.run_id,
      canonicalDocumentId: Number(row.canonical_document_id),
      selectedTextVersionId: Number(row.acquired_text_version_id),
      targetInventoryHash: module.cfxDocumentBearingTargetInventoryHash(targets),
      promptHash: prompt.promptHash,
      schemaHash: module.cfxDocumentBearingSchemaHash(),
    },
  });
  if (execution.status !== "claimed") {
    return {
      status: execution.status,
      bindingId: canonicalBindingId,
      providerCalls: 0,
      documentSemanticExecutionId: execution.executionId,
      bearingRunId: execution.acceptedTargetedBearingRunId,
      targetCount: targets.length,
    };
  }
  let executionFinished = false;
  try {
    if (!sourceQualityAlreadyProcessed) {
      await sourceQualityEnricher({
        query,
        referenceContentId,
        contentText: row.cleaned_text,
        url: row.resolved_url || row.source_url,
        metadata: {},
      });
    }
    if (!sourceCrestAlreadyProcessed) {
      await sourceCrestProcessor({ query, referenceContentId });
    }

    const exactRequests = [];
    const rawResponses = [];
    const responseMetadata = [];
    const startedAt = new Date();
    const result = await module.runCfxDocumentBearingExtraction({
      documentId: row.candidate_id,
      targets,
      access,
      prompt,
      provider,
      model,
      temperature: 0.1,
      maxOutputTokens: 8_000,
      timeoutMs: 180_000,
      async beforeInvoke(request, part) {
        exactRequests.push({ partId: part?.partId || null, request });
      },
      async afterResponse(value) {
        await preserveRawBearingResponse({
          runId: row.run_id,
          taskContentId: row.task_content_id,
          bindingId: row.binding_id,
          part: rawResponses.length,
          rawResponse: value.rawResponse,
        });
        rawResponses.push(value.rawResponse);
        responseMetadata.push(value.metadata);
      },
    });
    const completedAt = new Date();
    const persisted = await withTransaction(async ({ query: tx }) => {
    const bearingRunId = await persistTargetedBearingRun(tx, {
      bindingId: row.binding_id,
      acquiredTextVersionId: row.acquired_text_version_id,
      targetClaimId: row.target_claim_id,
      runId: `cfx-document-bearing-${row.run_id}-${row.candidate_id}-${Date.now()}`,
      promptHash: result.promptHash,
      schemaHash: result.schemaHash,
      model: result.model || model,
      exactRequest: exactRequests,
      rawResponse: rawResponses,
      parsedResponse: result.rawOutput,
      providerResponseId: result.responseId || responseMetadata[0]?.responseId,
      validationStatus: result.structurallyValid ? "accepted" : rawResponses.length ? "rejected" : "provider_failed",
      validationDiagnostics: result.diagnostics,
      usage: result.usage,
      latencyMs: result.latencyMs,
      startedAt,
      completedAt,
    });
    const links = [];
    const documents = [];
    const retrievalQuality = Number(row.retrieval_quality);
    for (const target of result.acceptedTargets || []) {
      if (!target.assertions.length) continue;
      const persistedAssertions = await persistAcceptedBearingAssertions(tx, {
        taskContentId: row.task_content_id,
        referenceContentId,
        targetClaimId: target.claimId,
        targetedBearingRunId: bearingRunId,
        acquiredTextVersionId: row.acquired_text_version_id,
        accessLevel: row.access_level,
        assertions: target.assertions,
      });
      links.push(...persistedAssertions.map((link) => ({
        propositionId: target.propositionId,
        targetClaimId: target.claimId,
        ...link,
      })));
      if (Number.isFinite(retrievalQuality)) {
        const document = await persistCfxAssessedDocumentRelation(tx, {
          taskContentId: row.task_content_id,
          referenceContentId,
          targetClaimId: target.claimId,
          retrievalQuality,
          publicationDate: row.publication_date || null,
          assertions: target.assertions,
          rationale: `CFX accepted ${target.assertions.length} assertion-level bearing result(s).`,
          evidenceText: target.assertions[0]?.exactExcerpt || null,
          scrapeStatus: row.access_level === "abstract" ? "abstract_only" : "full",
        });
        if (document) documents.push({ propositionId: target.propositionId, ...document });
      }
    }
    const terminalStatus = result.structurallyValid
      ? "accepted"
      : result.error ? "provider_failed" : "rejected";
    await executionFinisher(tx, {
      executionId: execution.executionId,
      processingToken: execution.processingToken,
      status: terminalStatus,
      acceptedTargetedBearingRunId: terminalStatus === "accepted" ? bearingRunId : null,
      error: terminalStatus === "accepted" ? null : JSON.stringify(result.error || result.diagnostics),
    });
    return { bearingRunId, links, documents, terminalStatus };
    }, { pool });
    executionFinished = true;
    return {
      status: result.structurallyValid ? "completed" : "rejected",
      bindingId: canonicalBindingId,
      providerCalls: result.providerCallCount,
      bearingRunId: persisted.bearingRunId,
      documentSemanticExecutionId: execution.executionId,
      targetCount: targets.length,
      acceptedTargetCount: result.acceptedTargets?.filter((target) => target.assertions.length > 0).length || 0,
      evidenceAssertionLinkCount: persisted.links.length,
      assessedDocumentLinkCount: persisted.documents.length,
      diagnostics: result.diagnostics,
      usage: result.usage,
      links: persisted.links,
      documents: persisted.documents,
    };
  } catch (error) {
    if (!executionFinished) {
      try {
        await executionFinisher(query, {
          executionId: execution.executionId,
          processingToken: execution.processingToken,
          status: "provider_failed",
          acceptedTargetedBearingRunId: null,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (finishError) {
        console.error(
          `[CFX] Failed to release semantic execution ${execution.executionId}:`,
          finishError,
        );
      }
    }
    throw error;
  }
}

function parsedJson(value) {
  if (value == null || typeof value === "object") return value;
  return JSON.parse(value);
}

/**
 * Re-run only deterministic grounding validation and persistence for an
 * already-frozen document-bearing response. This never invokes a provider and
 * never rewrites the exact request or raw provider response.
 */
export async function replayCfxDocumentBearingValidation({
  bindingId,
  targetedBearingRunId,
  query,
  pool,
  runtimeLoader = documentRuntime,
} = {}) {
  if (!pool) throw new TypeError("pool is required");
  const canonicalBindingId = Number(bindingId);
  const canonicalBearingRunId = Number(targetedBearingRunId);
  if (!Number.isSafeInteger(canonicalBindingId) || canonicalBindingId <= 0) {
    throw new TypeError("bindingId must be a positive integer");
  }
  if (!Number.isSafeInteger(canonicalBearingRunId) || canonicalBearingRunId <= 0) {
    throw new TypeError("targetedBearingRunId must be a positive integer");
  }
  const rows = await query(
    `SELECT b.binding_id,b.candidate_id,b.task_content_id,b.reference_content_id,
            t.acquired_text_version_id,t.access_level,t.extraction_method,
            t.source_url,t.resolved_url,t.cleaned_text,t.character_count,t.word_count,
            r.targeted_bearing_run_id,r.parsed_response_json,r.raw_response_json,
            r.provider_response_id,r.input_tokens,r.output_tokens,
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality'))
               FROM cfx_evidence_acquisition_attempts a
              WHERE a.binding_id=b.binding_id
                AND JSON_EXTRACT(a.response_metadata_json,'$.retrievalQuality') IS NOT NULL
              ORDER BY a.attempt_ordinal LIMIT 1) AS retrieval_quality,
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.response_metadata_json,'$.publicationDate'))
               FROM cfx_evidence_acquisition_attempts a
              WHERE a.binding_id=b.binding_id
                AND JSON_EXTRACT(a.response_metadata_json,'$.publicationDate') IS NOT NULL
              ORDER BY a.attempt_ordinal LIMIT 1) AS publication_date
       FROM cfx_evidence_acquisition_bindings b
       JOIN cfx_evidence_text_versions t ON t.binding_id=b.binding_id
        AND t.selected_for_bearing=1
       JOIN cfx_targeted_bearing_runs r ON r.binding_id=b.binding_id
      WHERE b.binding_id=? AND r.targeted_bearing_run_id=?
      ORDER BY t.acquired_text_version_id DESC LIMIT 1`,
    [canonicalBindingId, canonicalBearingRunId],
  );
  const row = rows?.[0];
  if (!row) throw new Error("Frozen bearing response or selected acquired text not found");
  if (!row.raw_response_json || !row.provider_response_id
    || Number(row.input_tokens) <= 0 || Number(row.output_tokens) <= 0) {
    throw new Error("Only a completed frozen provider response may be replayed");
  }
  const targetRows = await query(
    `SELECT cc.claim_id,cc.claim_order,c.claim_text
       FROM content_claims cc JOIN claims c ON c.claim_id=cc.claim_id
      WHERE cc.content_id=? AND cc.selected_for_evaluation=1
        AND cc.evaluation_eligible=1
      ORDER BY cc.claim_order,cc.cc_id`,
    [row.task_content_id],
  );
  const targets = targetRows.map((target, index) => ({
    propositionId: `P${String(Number(target.claim_order) || index + 1).padStart(2, "0")}`,
    claimId: Number(target.claim_id),
    assertion: target.claim_text,
  }));
  const module = await runtimeLoader();
  const access = {
    candidateId: row.candidate_id,
    accessLevel: row.access_level,
    textSource: row.extraction_method,
    text: row.cleaned_text,
    characterCount: Number(row.character_count),
    wordCount: Number(row.word_count),
    sourceUrl: row.source_url,
    canonicalUrl: row.resolved_url,
    doi: null,
    pmid: null,
    retrievalAttempts: [],
    accessDiagnostics: [],
  };
  const validation = module.validateCfxDocumentBearingExtraction({
    rawOutput: parsedJson(row.parsed_response_json),
    documentId: row.candidate_id,
    targets,
    access,
    blocks: module.buildCfxDocumentBearingRequest({
      documentId: row.candidate_id,
      targets,
      access,
      prompt: await module.loadCfxDocumentBearingPrompt(),
      model: "grounding-replay-only",
      temperature: 0,
      maxOutputTokens: 1,
      timeoutMs: 1,
    }).blocks,
  });
  const referenceContentId = Number(row.reference_content_id);
  const persisted = await withTransaction(async ({ query: tx }) => {
    await tx(
      `UPDATE cfx_targeted_bearing_runs
          SET validation_status=?,validation_diagnostics_json=?
        WHERE targeted_bearing_run_id=? AND binding_id=?`,
      [validation.structurallyValid ? "accepted" : "rejected",
        JSON.stringify(validation.diagnostics), canonicalBearingRunId, canonicalBindingId],
    );
    const links = [];
    const documents = [];
    const retrievalQuality = Number(row.retrieval_quality);
    for (const target of validation.acceptedTargets || []) {
      if (!target.assertions.length) continue;
      const assertionLinks = await persistAcceptedBearingAssertions(tx, {
        taskContentId: row.task_content_id,
        referenceContentId,
        targetClaimId: target.claimId,
        targetedBearingRunId: canonicalBearingRunId,
        acquiredTextVersionId: row.acquired_text_version_id,
        accessLevel: row.access_level,
        assertions: target.assertions,
      });
      links.push(...assertionLinks.map((link) => ({
        propositionId: target.propositionId,
        targetClaimId: target.claimId,
        ...link,
      })));
      if (Number.isFinite(retrievalQuality)) {
        const document = await persistCfxAssessedDocumentRelation(tx, {
          taskContentId: row.task_content_id,
          referenceContentId,
          targetClaimId: target.claimId,
          retrievalQuality,
          publicationDate: row.publication_date || null,
          assertions: target.assertions,
          rationale: `CFX accepted ${target.assertions.length} assertion-level bearing result(s).`,
          evidenceText: target.assertions[0]?.exactExcerpt || null,
          scrapeStatus: row.access_level === "abstract" ? "abstract_only" : "full",
        });
        if (document) documents.push({ propositionId: target.propositionId, ...document });
      }
    }
    return { links, documents };
  }, { pool });
  return {
    status: validation.structurallyValid ? "completed" : "rejected",
    providerCalls: 0,
    bindingId: canonicalBindingId,
    bearingRunId: canonicalBearingRunId,
    targetCount: targets.length,
    acceptedTargetCount: validation.acceptedTargets
      .filter((target) => target.assertions.length > 0).length,
    evidenceAssertionLinkCount: persisted.links.length,
    assessedDocumentLinkCount: persisted.documents.length,
    diagnostics: validation.diagnostics,
    links: persisted.links,
    documents: persisted.documents,
  };
}

export async function processCfxEvidenceOutboxOnce({
  query,
  pool,
  provider = createProductionCfxStructuredProvider(),
  model = process.env.CFX_DOCUMENT_BEARING_MODEL || "gpt-4o-mini",
  runtimeLoader = documentRuntime,
  sourceQualityEnricher = ensureCfxSourceQuality,
  sourceCrestProcessor = ensureCfxSourceCrest,
  executionClaimer = claimCfxDocumentSemanticExecution,
  executionFinisher = finishCfxDocumentSemanticExecution,
} = {}) {
  if (!pool) throw new TypeError("pool is required");
  const event = await claimOutbox(pool);
  if (!event) return { status: "idle" };

  if (event.terminal_status !== "completed") {
    await finishOutbox(query, event, event.error_message || `scrape_${event.terminal_status}`);
    return { status: "suspended", outboxId: Number(event.outbox_id), terminalStatus: event.terminal_status };
  }

  const result = await processCfxDocumentEvidenceBinding({
    bindingId: event.binding_id,
    resultContentId: event.result_content_id,
    query,
    pool,
    provider,
    model,
    runtimeLoader,
    sourceQualityEnricher,
    sourceCrestProcessor,
    executionClaimer,
    executionFinisher,
  });
  if (result.status === "pending_text") {
    await query(
      `UPDATE cfx_evidence_terminal_outbox
          SET last_consumer_error='NO_SELECTED_ACQUIRED_TEXT',processing_token=NULL,processing_started_at=NULL
        WHERE outbox_id=? AND processing_token=?`,
      [event.outbox_id, event.processingToken],
    );
    return { ...result, outboxId: Number(event.outbox_id) };
  }
  if (result.status === "multipart_authorization_required") {
    await finishOutbox(query, event, "MULTIPART_AUTHORIZATION_REQUIRED");
    return { ...result, outboxId: Number(event.outbox_id) };
  }
  await finishOutbox(
    query,
    event,
    result.status === "completed"
      ? null
      : result.status === "metadata_only"
        ? "METADATA_ONLY_NO_MODEL_CALL"
        : "TARGETED_BEARING_REJECTED",
  );
  return { ...result, outboxId: Number(event.outbox_id) };
}

export function kickCfxEvidenceOutboxConsumer(dependencies) {
  if (consumerRunning) return;
  consumerRunning = true;
  setImmediate(async () => {
    try {
      while (true) {
        const result = await processCfxEvidenceOutboxOnce(dependencies);
        if (result.status === "idle" || result.status === "pending_text") break;
      }
    } catch (error) {
      console.error("[CFX evidence outbox]", error);
    } finally {
      consumerRunning = false;
    }
  });
}

export function startCfxEvidenceOutboxRecovery(dependencies, intervalMs = 60_000) {
  if (recoveryTimer) return recoveryTimer;
  kickCfxEvidenceOutboxConsumer(dependencies);
  recoveryTimer = setInterval(() => kickCfxEvidenceOutboxConsumer(dependencies), intervalMs);
  recoveryTimer.unref?.();
  return recoveryTimer;
}
