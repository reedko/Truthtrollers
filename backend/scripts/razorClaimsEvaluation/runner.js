import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../../src/db/pool.js";
import {
  MODEL_CONFIGURATIONS,
  runConfiguredModel,
} from "../referenceSemanticInputDiagnostic/models.js";
import {
  ASSERTION_CENTRIC_EXTRACTION_PROMPT,
  ASSERTION_CENTRIC_EXTRACTION_SCHEMA,
  BEARING_ADJUDICATION_PROMPT,
  BEARING_ADJUDICATION_SCHEMA,
  assignEvidenceAssertionIds,
  buildAssertionCentricExtractionPrompt,
  buildBearingAdjudicationPrompt,
  parseModelResult,
  validateAssertionCentricExtraction,
  validateBearingAdjudication,
} from "./promptAndSchema.js";

const MAX_PARALLEL_ASSERTION_CALLS = 5;
const EXTRACTION_MAX_OUTPUT_TOKENS = 12000;
const BEARING_MAX_OUTPUT_TOKENS = 1500;
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIRECTORY = path.join(
  path.dirname(MODULE_DIRECTORY),
  "Razor-claims-evaluations",
);

function readTaskClaimIds() {
  const index = process.argv.indexOf("--task-claim-id");
  if (index === -1) throw new Error("--task-claim-id is required");
  const values = [];
  for (let cursor = index + 1; cursor < process.argv.length; cursor += 1) {
    const token = process.argv[cursor];
    if (token.startsWith("--")) break;
    values.push(...token.split(","));
  }
  const ids = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);
  if (
    ids.length === 0 ||
    ids.some((id) => !Number.isInteger(id) || id < 1)
  ) {
    throw new Error(
      "--task-claim-id requires one or more positive integers separated by commas",
    );
  }
  return [...new Set(ids)];
}

function readTopDocumentCount() {
  const index = process.argv.indexOf("--top-n");
  if (index === -1) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--top-n requires a positive integer");
  }
  return value;
}

function readDocumentIndex() {
  const names = ["--doc-index", "--doc_index", "--doc_id"];
  const name = names.find((candidate) => process.argv.includes(candidate));
  if (!name) return null;
  const index = process.argv.indexOf(name);
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} requires a zero-based non-negative integer`);
  }
  return value;
}

function readReferenceContentId() {
  const index = process.argv.indexOf("--doc");
  if (index === -1) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--doc requires a positive reference_content_id");
  }
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function documentMetadata(row, rank) {
  const supportLevel =
    row.support_level === null || row.support_level === undefined
      ? null
      : Number(row.support_level);
  return {
    rank,
    referenceContentId: Number(row.reference_content_id),
    referenceClaimLinkId: Number(row.ref_claim_link_id),
    title: row.content_name || null,
    url: row.url || null,
    publisher:
      row.linked_publisher || row.media_source || null,
    supportLevel,
    absoluteSupportLevel:
      supportLevel === null ? 0 : Math.abs(supportLevel),
    fullTextCharacterCount: row.content_text.length,
    fullTextSha256: createHash("sha256")
      .update(row.content_text, "utf8")
      .digest("hex"),
  };
}

function modelMetadata(modelRun) {
  if (!modelRun) return null;
  return {
    responseId: modelRun.responseId,
    responseStatus: modelRun.responseStatus,
    incompleteDetails: modelRun.incompleteDetails,
    finishReason: modelRun.finishReason,
    usage: modelRun.usage,
    responseFormat: modelRun.responseFormat,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index], index);
      }
    });
  await Promise.all(workers);
  return results;
}

async function loadTaskClaim(taskClaimId) {
  const rows = await query(
    `SELECT
       c.claim_id,
       c.claim_text,
       GROUP_CONCAT(DISTINCT cc.content_id ORDER BY cc.content_id) AS case_content_ids
     FROM claims c
     LEFT JOIN content_claims cc
       ON cc.claim_id = c.claim_id
      AND cc.relationship_type IN ('task', 'content')
     WHERE c.claim_id = ?
     GROUP BY c.claim_id, c.claim_text
     LIMIT 1`,
    [taskClaimId],
  );
  return rows[0] || null;
}

async function loadRankedEligibleDocuments(taskClaimId) {
  return query(
    `SELECT
       rcl.ref_claim_link_id,
       rcl.reference_content_id,
       rcl.support_level,
       reference_content.content_name,
       reference_content.media_source,
       reference_content.linked_publisher,
       reference_content.url,
       reference_content.content_text
     FROM reference_claim_links rcl
     JOIN content reference_content
       ON reference_content.content_id = rcl.reference_content_id
     WHERE rcl.claim_id = ?
       AND reference_content.content_text IS NOT NULL
       AND CHAR_LENGTH(reference_content.content_text) > 0
     ORDER BY
       ABS(COALESCE(rcl.support_level, 0)) DESC,
       rcl.ref_claim_link_id DESC`,
    [taskClaimId],
  );
}

function rankUniqueDocuments(rankedRows) {
  const ranked = [];
  const seen = new Set();
  for (const row of rankedRows) {
    const id = Number(row.reference_content_id);
    if (seen.has(id)) continue;
    seen.add(id);
    ranked.push({
      ...row,
      diagnostic_document_rank: ranked.length + 1,
    });
  }
  return ranked;
}

function selectDocuments(
  rankedRows,
  topN,
  documentIndex,
  referenceContentId,
) {
  const uniqueRankedRows = rankUniqueDocuments(rankedRows);
  if (referenceContentId !== null) {
    const selected = uniqueRankedRows.find(
      (row) => Number(row.reference_content_id) === referenceContentId,
    );
    return {
      uniqueRankedRows,
      selectedRows: selected ? [selected] : [],
    };
  }
  if (documentIndex !== null) {
    return {
      uniqueRankedRows,
      selectedRows: uniqueRankedRows[documentIndex]
        ? [uniqueRankedRows[documentIndex]]
        : [],
    };
  }
  return {
    uniqueRankedRows,
    selectedRows:
      topN === null ? uniqueRankedRows : uniqueRankedRows.slice(0, topN),
  };
}

function modelRequestContract(
  modelConfiguration,
  userPrompt,
  resultSchema,
  maxOutputTokens,
) {
  const format = modelConfiguration.strictJsonSchema
    ? {
        type: "json_schema",
        name: "reference_semantic_bearing_result",
        strict: true,
        schema: resultSchema,
      }
    : { type: "json_object" };
  const body = {
    model: modelConfiguration.model,
    input: userPrompt,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: { format },
  };
  if (modelConfiguration.reasoning) {
    body.reasoning = modelConfiguration.reasoning;
  }
  return {
    api: modelConfiguration.api,
    endpoint:
      modelConfiguration.api === "responses"
        ? "https://api.openai.com/v1/responses"
        : null,
    body,
  };
}

function groupAssertionsByDocument(
  selectedRows,
  evidenceAssertions,
  acceptedBearingResults,
) {
  const resultByAssertionId = new Map(
    acceptedBearingResults.map((result) => [
      result.evidenceAssertionId,
      result.bearingScore,
    ]),
  );
  return selectedRows.map((row, index) => {
    const referenceContentId = Number(row.reference_content_id);
    return {
      ...documentMetadata(
        row,
        Number(row.diagnostic_document_rank || index + 1),
      ),
      extractedAssertions: evidenceAssertions
        .filter(
          (assertion) =>
            assertion.referenceContentId === referenceContentId,
        )
        .map((assertion) => ({
          evidenceAssertionId: assertion.evidenceAssertionId,
          evidenceAssertion: assertion.evidenceAssertion,
          bearingResultAccepted: resultByAssertionId.has(
            assertion.evidenceAssertionId,
          ),
          bearingScore: resultByAssertionId.has(assertion.evidenceAssertionId)
            ? resultByAssertionId.get(assertion.evidenceAssertionId)
            : null,
        })),
    };
  });
}

async function runOneAssertion(
  taskClaimId,
  topN,
  documentIndex,
  referenceContentId,
  modelConfiguration,
) {
  const [taskClaim, rankedRows] = await Promise.all([
    loadTaskClaim(taskClaimId),
    loadRankedEligibleDocuments(taskClaimId),
  ]);
  if (!taskClaim) {
    return {
      taskClaimId,
      status: "claim_not_found",
      error: `Task claim ${taskClaimId} was not found`,
    };
  }
  const { uniqueRankedRows, selectedRows } = selectDocuments(
    rankedRows,
    topN,
    documentIndex,
    referenceContentId,
  );
  const selectedDocuments = selectedRows.map((row, index) =>
    documentMetadata(
      row,
      Number(row.diagnostic_document_rank || index + 1),
    ),
  );
  const common = {
    taskClaimId,
    caseAssertion: taskClaim.claim_text,
    associatedCaseContentIds: taskClaim.case_content_ids
      ? String(taskClaim.case_content_ids).split(",").map(Number)
      : [],
    eligibleEvidenceDocumentCount: uniqueRankedRows.length,
    requestedDocumentIndex: documentIndex,
    requestedReferenceContentId: referenceContentId,
    selectedDocuments,
  };
  if (selectedRows.length === 0) {
    return {
      ...common,
      status: "no_eligible_documents",
      error:
        referenceContentId !== null
          ? `Reference content ${referenceContentId} is not an eligible persisted document link for this claim`
          : documentIndex === null
            ? "No persisted reference_claim_links documents with full text"
            : `No ranked evidence document exists at zero-based index ${documentIndex}`,
      extractedEvidenceAssertionsByDocument: [],
      modelRequest: null,
      modelResponse: null,
      bearingAdjudication: null,
    };
  }

  const userPrompt = buildAssertionCentricExtractionPrompt(
    taskClaim,
    selectedRows,
  );
  const startedAt = new Date();
  const startedAtMs = performance.now();
  let modelRun = null;
  let parsedResult = null;
  let validation = null;
  let parseError = null;
  try {
    modelRun = await runConfiguredModel(
      modelConfiguration,
      userPrompt,
      ASSERTION_CENTRIC_EXTRACTION_SCHEMA,
      {
        maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
        systemPrompt: null,
      },
    );
    if (modelRun.responseStatus === "incomplete") {
      parseError = `Provider returned incomplete response: ${modelRun.finishReason || "unknown reason"}`;
    } else {
      try {
        parsedResult = parseModelResult(modelRun.rawModelResult);
        validation = validateAssertionCentricExtraction(
          parsedResult,
          selectedRows,
        );
        if (validation.fatalErrors.length > 0) {
          parseError = validation.fatalErrors.join("; ");
        }
      } catch (error) {
        parseError = `JSON parse failure: ${error.message}`;
      }
    }
  } catch (error) {
    parseError = error.message;
    if (error.providerResponse) {
      modelRun = {
        rawModelResult: null,
        providerResponse: error.providerResponse,
      };
    }
  }
  const completedAt = new Date();
  const acceptedAssertions = validation?.acceptedAssertions || [];
  const evidenceAssertions = parseError
    ? []
    : assignEvidenceAssertionIds(taskClaimId, acceptedAssertions);

  let bearingModelRun = null;
  let bearingParsedResult = null;
  let bearingValidation = null;
  let bearingError = null;
  let bearingUserPrompt = null;
  let bearingStartedAt = null;
  let bearingCompletedAt = null;
  let bearingDurationMs = null;

  if (!parseError) {
    bearingUserPrompt = buildBearingAdjudicationPrompt(
      taskClaimId,
      taskClaim.claim_text,
      evidenceAssertions,
    );
    bearingStartedAt = new Date();
    const bearingStartedAtMs = performance.now();
    try {
      bearingModelRun = await runConfiguredModel(
        modelConfiguration,
        bearingUserPrompt,
        BEARING_ADJUDICATION_SCHEMA,
        {
          maxOutputTokens: BEARING_MAX_OUTPUT_TOKENS,
          systemPrompt: null,
        },
      );
      if (bearingModelRun.responseStatus === "incomplete") {
        bearingError = `Provider returned incomplete response: ${bearingModelRun.finishReason || "unknown reason"}`;
      } else {
        try {
          bearingParsedResult = parseModelResult(
            bearingModelRun.rawModelResult,
          );
          bearingValidation = validateBearingAdjudication(
            bearingParsedResult,
            evidenceAssertions,
          );
          if (bearingValidation.fatalErrors.length > 0) {
            bearingError = bearingValidation.fatalErrors.join("; ");
          }
        } catch (error) {
          bearingError = `JSON parse failure: ${error.message}`;
        }
      }
    } catch (error) {
      bearingError = error.message;
      if (error.providerResponse) {
        bearingModelRun = {
          rawModelResult: null,
          providerResponse: error.providerResponse,
        };
      }
    }
    bearingCompletedAt = new Date();
    bearingDurationMs = Math.round(performance.now() - bearingStartedAtMs);
  }

  const acceptedBearingResults =
    bearingValidation?.acceptedResults || [];
  const status = parseError
    ? "quarantined_call_1"
    : bearingError
      ? "quarantined_call_2"
      : "accepted";
  return {
    ...common,
    status,
    error: parseError || bearingError,
    call1Status: parseError ? "quarantined" : "accepted",
    assignedEvidenceAssertions: evidenceAssertions,
    extractedEvidenceAssertionsByDocument: groupAssertionsByDocument(
      selectedRows,
      evidenceAssertions,
      acceptedBearingResults,
    ),
    modelRequest: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.round(performance.now() - startedAtMs),
      userPrompt,
      promptCharacterCount: userPrompt.length,
      providerRequest: modelRequestContract(
        modelConfiguration,
        userPrompt,
        ASSERTION_CENTRIC_EXTRACTION_SCHEMA,
        EXTRACTION_MAX_OUTPUT_TOKENS,
      ),
    },
    modelResponse: {
      rawModelResult: modelRun?.rawModelResult || null,
      parsedResult,
      validation,
      metadata: modelMetadata(modelRun),
      providerResponse: modelRun?.providerResponse || null,
    },
    bearingAdjudication: parseError
      ? {
          status: "skipped_call_1_quarantined",
          error: "Call 2 was not made because Call 1 was quarantined",
          promptTemplate: BEARING_ADJUDICATION_PROMPT,
          resultSchema: BEARING_ADJUDICATION_SCHEMA,
          modelRequest: null,
          modelResponse: null,
          counts: { null: 0, negative: 0, zero: 0, positive: 0 },
        }
      : {
          status: bearingError ? "quarantined" : "accepted",
          error: bearingError,
          promptTemplate: BEARING_ADJUDICATION_PROMPT,
          resultSchema: BEARING_ADJUDICATION_SCHEMA,
          modelRequest: {
            startedAt: bearingStartedAt.toISOString(),
            completedAt: bearingCompletedAt.toISOString(),
            durationMs: bearingDurationMs,
            userPrompt: bearingUserPrompt,
            promptCharacterCount: bearingUserPrompt.length,
            providerRequest: modelRequestContract(
              modelConfiguration,
              bearingUserPrompt,
              BEARING_ADJUDICATION_SCHEMA,
              BEARING_MAX_OUTPUT_TOKENS,
            ),
          },
          modelResponse: {
            rawModelResult: bearingModelRun?.rawModelResult || null,
            parsedResult: bearingParsedResult,
            validation: bearingValidation,
            metadata: modelMetadata(bearingModelRun),
            providerResponse:
              bearingModelRun?.providerResponse || null,
          },
          counts:
            bearingValidation?.counts || {
              null: 0,
              negative: 0,
              zero: 0,
              positive: 0,
            },
        },
  };
}

function renderAssertionRun(run) {
  const documents = (run.extractedEvidenceAssertionsByDocument || [])
    .map(
      (document) => `<section><h3>${document.rank}. Reference ${document.referenceContentId}</h3><p>${escapeHtml(document.title || document.url || "Untitled")}</p><p>document selection support_level ${escapeHtml(document.supportLevel)} · |support_level| ${escapeHtml(document.absoluteSupportLevel)}</p>${document.extractedAssertions.length ? `<ol>${document.extractedAssertions.map((assertion) => {
        const score = assertion.bearingResultAccepted
          ? assertion.bearingScore === null
            ? "NO BEARING"
            : assertion.bearingScore
          : "Call 2 result unavailable";
        return `<li><code>${escapeHtml(assertion.evidenceAssertionId)}</code><p>${escapeHtml(assertion.evidenceAssertion)}</p><p><b>bearingScore:</b> ${escapeHtml(score)}</p></li>`;
      }).join("")}</ol>` : "<p>No accepted assertions.</p>"}</section>`,
    )
    .join("");
  return `<article><h2>Task assertion ${run.taskClaimId} · ${escapeHtml(run.status)}</h2><blockquote>${escapeHtml(run.caseAssertion || run.error || "Unknown assertion")}</blockquote>${run.error ? `<p><b>Error:</b> ${escapeHtml(run.error)}</p>` : ""}<p><b>Call 2 distribution:</b> ${escapeHtml(JSON.stringify(run.bearingAdjudication?.counts || {}))}</p>${documents}<details><summary>Call 1 extraction audit</summary><h3>Exact request</h3><pre>${escapeHtml(JSON.stringify(run.modelRequest || null, null, 2))}</pre><h3>Raw response</h3><pre>${escapeHtml(run.modelResponse?.rawModelResult || "")}</pre><h3>Parsed, validation, metadata, and provider response</h3><pre>${escapeHtml(JSON.stringify(run.modelResponse || null, null, 2))}</pre></details><details><summary>Call 2 bearing adjudication audit</summary><h3>Prompt template and schema</h3><pre>${escapeHtml(JSON.stringify({ promptTemplate: run.bearingAdjudication?.promptTemplate, resultSchema: run.bearingAdjudication?.resultSchema }, null, 2))}</pre><h3>Exact request</h3><pre>${escapeHtml(JSON.stringify(run.bearingAdjudication?.modelRequest || null, null, 2))}</pre><h3>Raw response</h3><pre>${escapeHtml(run.bearingAdjudication?.modelResponse?.rawModelResult || "")}</pre><h3>Parsed, validation, metadata, and provider response</h3><pre>${escapeHtml(JSON.stringify(run.bearingAdjudication?.modelResponse || null, null, 2))}</pre></details></article>`;
}

function renderHtml(report) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Razor two-stage assertion evaluation</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:1400px;margin:auto;padding:24px;background:#f5f7fb;color:#17202a}article,section,details{background:white;border:1px solid #ccd5df;border-radius:8px;margin:16px 0;padding:16px}section{background:#f8fbff}pre{white-space:pre-wrap;word-break:break-word;background:#111923;color:#e6edf5;padding:14px;border-radius:6px}summary{cursor:pointer;font-weight:700}code{word-break:break-all}</style></head><body><h1>Razor Call 1 extraction + Call 2 bearing adjudication</h1><p>${report.taskClaimIds.length} requested assertions · Call 1 accepted ${report.summary.call1AcceptedRuns} · Call 2 accepted ${report.summary.call2AcceptedRuns} · fully accepted ${report.summary.acceptedRuns}</p>${report.assertionRuns.map(renderAssertionRun).join("")}</body></html>`;
}

export async function runRazorClaimsEvaluation() {
  let success = false;
  let jsonPath = null;
  let htmlPath = null;
  try {
    const taskClaimIds = readTaskClaimIds();
    const topN = readTopDocumentCount();
    const documentIndex = readDocumentIndex();
    const referenceContentId = readReferenceContentId();
    const selectorCount = [topN, documentIndex, referenceContentId].filter(
      (value) => value !== null,
    ).length;
    if (selectorCount > 1) {
      throw new Error("Use only one of --top-n, --doc, or --doc-index");
    }
    if (MODEL_CONFIGURATIONS.length !== 1) {
      throw new Error(
        `Expected exactly one selected Razor model; found ${MODEL_CONFIGURATIONS.length}`,
      );
    }
    const modelConfiguration = MODEL_CONFIGURATIONS[0];
    const assertionRuns = await mapWithConcurrency(
      taskClaimIds,
      MAX_PARALLEL_ASSERTION_CALLS,
      async (taskClaimId, index) => {
        process.stdout.write(
          `[razor-assertion-centric-extraction] Assertion ${index + 1}/${taskClaimIds.length}: ${taskClaimId}\n`,
        );
        return runOneAssertion(
          taskClaimId,
          topN,
          documentIndex,
          referenceContentId,
          modelConfiguration,
        );
      },
    );
    const acceptedRuns = assertionRuns.filter(
      (run) => run.status === "accepted",
    ).length;
    const call1AcceptedRuns = assertionRuns.filter(
      (run) => run.call1Status === "accepted",
    ).length;
    const call2AcceptedRuns = assertionRuns.filter(
      (run) => run.bearingAdjudication?.status === "accepted",
    ).length;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basename = `razor-assertion-centric-extraction-claims-${taskClaimIds.join("-")}-${timestamp}`;
    jsonPath = path.join(RESULTS_DIRECTORY, `${basename}.json`);
    htmlPath = path.join(RESULTS_DIRECTORY, `${basename}.html`);
    const report = {
      diagnostic:
        "razor-assertion-centric-extraction-and-bearing-adjudication",
      generatedAt: new Date().toISOString(),
      readOnly: true,
      databaseWrites: false,
      productionCodeChanges: false,
      secondBearingRatingCall: true,
      taskClaimIds,
      eligibleEvidenceDocumentSource: "reference_claim_links",
      rankingContract: "ABS(reference_claim_links.support_level) DESC",
      requestedTopDocumentCount: topN,
      documentSelection: {
        mode:
          referenceContentId !== null
            ? "reference_content_id"
            : documentIndex !== null
              ? "zero_based_rank_index"
              : topN !== null
                ? "top_n"
                : "all_eligible_documents",
        zeroBasedDocumentIndex: documentIndex,
        referenceContentId,
        note:
          "No selector sends all eligible documents in one call per claim; --top-n limits the set; --doc selects an exact reference_content_id; --doc-index, --doc_index, and --doc_id select a zero-based rank index",
      },
      modelConfiguration,
      maximumParallelAssertionCalls: MAX_PARALLEL_ASSERTION_CALLS,
      systemPrompt: null,
      strictJsonSchema: true,
      call1Contract: {
        maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
        promptTemplate: ASSERTION_CENTRIC_EXTRACTION_PROMPT,
        resultSchema: ASSERTION_CENTRIC_EXTRACTION_SCHEMA,
      },
      call2Contract: {
        oneCallPerTaskClaimId: true,
        completeCall1AssertionPacket: true,
        maxOutputTokens: BEARING_MAX_OUTPUT_TOKENS,
        promptTemplate: BEARING_ADJUDICATION_PROMPT,
        resultSchema: BEARING_ADJUDICATION_SCHEMA,
        databaseWrites: false,
      },
      summary: {
        requestedRuns: assertionRuns.length,
        call1AcceptedRuns,
        call1FailedRuns: assertionRuns.length - call1AcceptedRuns,
        call2AcceptedRuns,
        call2FailedOrSkippedRuns:
          assertionRuns.length - call2AcceptedRuns,
        acceptedRuns,
        failedRuns: assertionRuns.length - acceptedRuns,
      },
      assertionRuns,
    };
    await fs.mkdir(RESULTS_DIRECTORY, { recursive: true });
    await Promise.all([
      fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      fs.writeFile(htmlPath, renderHtml(report), "utf8"),
    ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          success: acceptedRuns === assertionRuns.length,
          taskClaimIds,
          summary: report.summary,
          runs: assertionRuns.map((run) => ({
            taskClaimId: run.taskClaimId,
            status: run.status,
            error: run.error || null,
            call1Status: run.call1Status || null,
            call2Status:
              run.bearingAdjudication?.status || null,
            eligibleEvidenceDocumentCount:
              run.eligibleEvidenceDocumentCount || 0,
            selectedDocumentCount: run.selectedDocuments?.length || 0,
            acceptedExtractedAssertionCount:
              run.modelResponse?.validation?.acceptedAssertions?.length || 0,
            bearingCounts:
              run.bearingAdjudication?.counts || null,
          })),
          timestampedJson: jsonPath,
          timestampedHtml: htmlPath,
        },
        null,
        2,
      )}\n`,
    );
    success = acceptedRuns === assertionRuns.length;
  } catch (error) {
    process.stderr.write(
      `[razor-assertion-centric-extraction] ${error.stack || error.message}\n`,
    );
  } finally {
    await new Promise((resolve) => pool.end(resolve));
  }
  return {
    success,
    timestampedJsonPath: jsonPath,
    timestampedHtmlPath: htmlPath,
    runDirectory: RESULTS_DIRECTORY,
  };
}
