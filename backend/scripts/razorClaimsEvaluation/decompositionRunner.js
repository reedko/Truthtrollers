import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../../src/db/pool.js";
import {
  ALL_MODEL_CONFIGURATIONS,
  runConfiguredModel,
} from "../referenceSemanticInputDiagnostic/models.js";
import {
  CASE_ASSERTION_DECOMPOSITION_PROMPT,
  CASE_ASSERTION_DECOMPOSITION_SCHEMA,
  decomposeCaseAssertions,
} from "./caseAssertionDecomposition.js";

const CASE_CONTENT_ID = 21382;
const WATCHED_ASSERTION_IDS = [59476, 59480, 59481];
const PASS_COUNT = 3;
const MAX_PARALLEL_DECOMPOSITION_CALLS = 15;
const DECOMPOSITION_MODEL_IDS = [
  "gpt-5.4-mini-responses",
  "gpt-4o-mini-chat-completions",
];
const BEARING_SELECTED_DECOMPOSITION_MODEL_ID =
  "gpt-5.4-mini-responses";
const MAX_OUTPUT_TOKENS = 3000;
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIRECTORY = path.join(
  path.dirname(MODULE_DIRECTORY),
  "Razor-claims-evaluations",
);
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_BASENAME = `razor-case-assertion-decomposition-case-${CASE_CONTENT_ID}-${RUN_TIMESTAMP}`;
const JSON_PATH = path.join(RESULTS_DIRECTORY, `${RUN_BASENAME}.json`);
const HTML_PATH = path.join(RESULTS_DIRECTORY, `${RUN_BASENAME}.html`);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadCaseAssertionInventory(caseContentId) {
  const [caseRows, claimRows] = await Promise.all([
    query(
      `SELECT content_id, content_name, media_source, url
         FROM content
        WHERE content_id = ?
        LIMIT 1`,
      [caseContentId],
    ),
    query(
      `SELECT c.claim_id, c.claim_text
         FROM content_claims cc
         JOIN claims c ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ?
          AND cc.relationship_type IN ('task', 'content')
        ORDER BY COALESCE(cc.claim_order, 2147483647), c.claim_id`,
      [caseContentId],
    ),
  ]);
  if (!caseRows[0]) {
    throw new Error(`Case content ${caseContentId} was not found`);
  }
  if (claimRows.length === 0) {
    throw new Error(`Case content ${caseContentId} has no case assertions`);
  }
  return {
    caseContent: {
      contentId: Number(caseRows[0].content_id),
      title: caseRows[0].content_name || null,
      publisher: caseRows[0].media_source || null,
      url: caseRows[0].url || null,
    },
    caseAssertions: claimRows.map((row) => ({
      id: Number(row.claim_id),
      text: row.claim_text,
    })),
  };
}

function summarizeParents(parents) {
  const decomposed = parents.filter(
    (parent) => parent.requiresDecomposition === true,
  );
  const totalChildren = parents.reduce(
    (sum, parent) => sum + parent.children.length,
    0,
  );
  const decomposedChildren = decomposed.reduce(
    (sum, parent) => sum + parent.children.length,
    0,
  );
  return {
    totalParents: parents.length,
    unchangedParents: parents.length - decomposed.length,
    decomposedParents: decomposed.length,
    totalChildren,
    additionalChildrenCreated: totalChildren - parents.length,
    meanChildrenPerParent: parents.length
      ? totalChildren / parents.length
      : null,
    meanChildrenPerDecomposedParent: decomposed.length
      ? decomposedChildren / decomposed.length
      : null,
    maximumChildrenForOneParent: parents.length
      ? Math.max(...parents.map((parent) => parent.children.length))
      : null,
  };
}

function watchedParents(parents) {
  return WATCHED_ASSERTION_IDS.map((id) => ({
    parentAssertionId: id,
    result: parents.find((parent) => parent.parentAssertionId === id) || null,
  }));
}

function modelMetadata(modelResult) {
  return {
    responseId: modelResult.responseId || null,
    responseStatus: modelResult.responseStatus || null,
    incompleteDetails: modelResult.incompleteDetails || null,
    finishReason: modelResult.finishReason || null,
    usage: modelResult.usage || null,
    responseFormat: modelResult.responseFormat || null,
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

async function runAssertionCall(caseAssertion, callNumber, modelConfiguration) {
  const startedAt = new Date();
  const startedAtMs = performance.now();
  try {
    const result = await decomposeCaseAssertions({
      caseAssertions: [caseAssertion],
      invokeStructuredModel: ({ userPrompt, schema }) =>
        runConfiguredModel(modelConfiguration, userPrompt, schema, {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        }),
    });
    return {
      callNumber,
      parentAssertionId: caseAssertion.id,
      parentAssertion: caseAssertion.text,
      status: result.validation.valid
        ? "accepted"
        : "quarantined_validation_failure",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAtMs),
      promptCharacterCount: result.userPrompt.length,
      rawModelResponse: result.rawModelResult,
      parsedModelResponse: result.parsedResult,
      validation: result.validation,
      parents: result.parents,
      modelMetadata: modelMetadata(result.modelResult),
    };
  } catch (error) {
    return {
      callNumber,
      parentAssertionId: caseAssertion.id,
      parentAssertion: caseAssertion.text,
      status: "model_or_parse_failure",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAtMs),
      error: error.message,
      rawModelResponse: error.rawModelResult || null,
      parsedModelResponse: null,
      validation: null,
      parents: [],
      modelMetadata: null,
    };
  }
}

function aggregateCallUsage(calls) {
  return calls.reduce(
    (usage, call) => {
      const callUsage = call.modelMetadata?.usage;
      if (!callUsage) return usage;
      usage.input_tokens += Number(
        callUsage.input_tokens || callUsage.prompt_tokens || 0,
      );
      usage.output_tokens += Number(
        callUsage.output_tokens || callUsage.completion_tokens || 0,
      );
      usage.total_tokens += Number(
        callUsage.total_tokens ||
          Number(callUsage.input_tokens || callUsage.prompt_tokens || 0) +
            Number(callUsage.output_tokens || callUsage.completion_tokens || 0),
      );
      usage.calls_with_usage += 1;
      return usage;
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      calls_with_usage: 0,
    },
  );
}

async function runPass(passNumber, caseAssertions, modelConfiguration) {
  const startedAt = new Date();
  const startedAtMs = performance.now();
  const modelCalls = await mapWithConcurrency(
    caseAssertions,
    MAX_PARALLEL_DECOMPOSITION_CALLS,
    async (caseAssertion, index) => {
      process.stdout.write(
        `[razor-decomposition] Assertion ${index + 1}/${caseAssertions.length}: ${caseAssertion.id}\n`,
      );
      return runAssertionCall(caseAssertion, index + 1, modelConfiguration);
    },
  );
  const parents = modelCalls.flatMap((call) => call.parents);
  const validationErrors = modelCalls.flatMap(
    (call) =>
      call.validation?.errors?.map(
        (error) => `Assertion ${call.parentAssertionId}: ${error}`,
      ) || [],
  );
  const failedCalls = modelCalls.filter((call) => call.status !== "accepted");
  return {
    passNumber,
    status: failedCalls.length === 0 ? "accepted" : "calls_quarantined",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAtMs),
    assertionModelCallCount: modelCalls.length,
    successfulAssertionModelCalls: modelCalls.length - failedCalls.length,
    failedAssertionModelCalls: failedCalls.length,
    modelCalls,
    parsedModelResponse: {
      decompositions: modelCalls.flatMap(
        (call) => call.parsedModelResponse?.decompositions || [],
      ),
    },
    validation: {
      valid: failedCalls.length === 0,
      errors: validationErrors,
    },
    parents,
    aggregateDiagnostics: summarizeParents(parents),
    watchedAssertions: watchedParents(parents),
    modelMetadata: {
      usage: aggregateCallUsage(modelCalls),
    },
  };
}

function buildStability(passes, caseAssertions) {
  return caseAssertions.map((assertion) => {
    const observations = passes
      .map((pass) => {
        const parent = pass.parents.find(
          (candidate) => candidate.parentAssertionId === assertion.id,
        );
        return parent
          ? {
              passNumber: pass.passNumber,
              requiresDecomposition: parent.requiresDecomposition,
              children: parent.children.map((child) => child.childAssertion),
            }
          : null;
      })
      .filter(Boolean);
    const signatures = new Set(
      observations.map((observation) =>
        JSON.stringify([
          observation.requiresDecomposition,
          observation.children,
        ]),
      ),
    );
    return {
      parentAssertionId: assertion.id,
      parentAssertion: assertion.text,
      validObservations: observations.length,
      stableAcrossValidPasses:
        observations.length === passes.length && signatures.size === 1,
      distinctOutputs: signatures.size,
      observations,
    };
  });
}

function totalUsage(passes) {
  return passes.reduce(
    (total, pass) => {
      const usage = pass.modelMetadata?.usage;
      if (!usage) return total;
      total.callsWithUsage += Number(usage.calls_with_usage || 1);
      total.inputTokens += Number(
        usage.input_tokens || usage.prompt_tokens || 0,
      );
      total.outputTokens += Number(
        usage.output_tokens || usage.completion_tokens || 0,
      );
      total.totalTokens += Number(
        usage.total_tokens ||
          Number(usage.input_tokens || usage.prompt_tokens || 0) +
            Number(usage.output_tokens || usage.completion_tokens || 0),
      );
      return total;
    },
    { callsWithUsage: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function renderParent(parent) {
  return `<article><h4>${parent.parentAssertionId} · ${parent.requiresDecomposition ? "DECOMPOSED" : "UNCHANGED"}</h4><p>${escapeHtml(parent.parentAssertion)}</p><ol>${parent.children.map((child) => `<li>${escapeHtml(child.childAssertion)}</li>`).join("")}</ol></article>`;
}

function renderHtml(report) {
  const decomposition = report.caseAssertionDecomposition;
  const modelEvaluations = decomposition.modelEvaluations
    .map(
      (evaluation) =>
        `<section><h2>${escapeHtml(evaluation.modelConfiguration.id)}${evaluation.selectedForBearing ? " · BEARING SELECTED" : " · COMPARISON ONLY"}</h2><h3>Stability</h3><pre>${escapeHtml(JSON.stringify(evaluation.stability, null, 2))}</pre>${evaluation.passes.map((pass) => `<section><h3>Pass ${pass.passNumber}: ${escapeHtml(pass.status)}</h3><p>${pass.assertionModelCallCount} assertion-level model calls · ${pass.successfulAssertionModelCalls} accepted · ${pass.failedAssertionModelCalls} failed</p><pre>${escapeHtml(JSON.stringify(pass.aggregateDiagnostics, null, 2))}</pre><h4>Watched assertions</h4>${pass.watchedAssertions.map((watched) => (watched.result ? renderParent(watched.result) : `<p>${watched.parentAssertionId}: no accepted result</p>`)).join("")}<h4>All parents</h4>${pass.parents.map(renderParent).join("")}<h4>Per-assertion raw model audit</h4>${pass.modelCalls.map((call) => `<details><summary>Assertion ${call.parentAssertionId} · ${escapeHtml(call.status)}</summary><p>${escapeHtml(call.parentAssertion)}</p><h5>Raw</h5><pre>${escapeHtml(call.rawModelResponse || "")}</pre><h5>Parsed and validation</h5><pre>${escapeHtml(JSON.stringify({ parsedModelResponse: call.parsedModelResponse, validation: call.validation }, null, 2))}</pre><h5>Model metadata</h5><pre>${escapeHtml(JSON.stringify(call.modelMetadata, null, 2))}</pre></details>`).join("")}</section>`).join("")}</section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case assertion decomposition diagnostic</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:auto;max-width:1300px;padding:24px;background:#f5f7fb;color:#17202a}section,article,details{background:white;border:1px solid #ccd5df;border-radius:8px;margin:16px 0;padding:16px}article{background:#f8fbff}pre{white-space:pre-wrap;word-break:break-word;background:#111923;color:#e6edf5;padding:14px;border-radius:6px}summary{cursor:pointer;font-weight:700}</style></head><body><h1>caseAssertionDecomposition</h1><p>Case ${decomposition.case.contentId} · read-only · no persistence · no bearing/retrieval changes</p><h2>Bearing selection</h2><pre>${escapeHtml(JSON.stringify(decomposition.selectedForBearing, null, 2))}</pre>${modelEvaluations}</body></html>`;
}

export async function runCaseAssertionDecompositionDiagnostic() {
  let success = false;
  try {
    const modelConfigurations = DECOMPOSITION_MODEL_IDS.map((id) => {
      const configuration = ALL_MODEL_CONFIGURATIONS.find(
        (candidate) => candidate.id === id,
      );
      if (!configuration) {
        throw new Error(`Decomposition model configuration ${id} was not found`);
      }
      return configuration;
    });
    const loaded = await loadCaseAssertionInventory(CASE_CONTENT_ID);
    const modelEvaluations = [];
    for (const modelConfiguration of modelConfigurations) {
      const passes = [];
      for (let passNumber = 1; passNumber <= PASS_COUNT; passNumber += 1) {
        process.stdout.write(
          `[razor-decomposition:${modelConfiguration.id}] Pass ${passNumber}/${PASS_COUNT}: ${loaded.caseAssertions.length} case assertions\n`,
        );
        passes.push(
          await runPass(passNumber, loaded.caseAssertions, modelConfiguration),
        );
      }
      const stability = buildStability(passes, loaded.caseAssertions);
      const selectedPass = passes.at(-1);
      modelEvaluations.push({
        modelConfiguration: {
          ...modelConfiguration,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          systemPrompt: null,
          oneAssertionPerModelCall: true,
          maximumParallelCalls: MAX_PARALLEL_DECOMPOSITION_CALLS,
        },
        selectedForBearing:
          modelConfiguration.id === BEARING_SELECTED_DECOMPOSITION_MODEL_ID,
        tokenUsage: totalUsage(passes),
        passes,
        finalPassSelection: {
          strategy: PASS_COUNT === 1 ? "sole_pass" : "final_pass",
          selectedPassNumber: selectedPass.passNumber,
          eligible: selectedPass.status === "accepted",
          blockingStatus:
            selectedPass.status === "accepted" ? null : selectedPass.status,
          adjudicationInventory:
            selectedPass.status === "accepted" ? selectedPass.parents : [],
        },
        stability,
        unstableParentAssertionIds: stability
          .filter((item) => !item.stableAcrossValidPasses)
          .map((item) => item.parentAssertionId),
      });
    }
    const bearingSelectedEvaluation = modelEvaluations.find(
      (evaluation) => evaluation.selectedForBearing,
    );
    if (!bearingSelectedEvaluation) {
      throw new Error(
        `Bearing-selected decomposition model ${BEARING_SELECTED_DECOMPOSITION_MODEL_ID} was not evaluated`,
      );
    }
    const selectedForBearing = {
      modelId: BEARING_SELECTED_DECOMPOSITION_MODEL_ID,
      ...bearingSelectedEvaluation.finalPassSelection,
    };
    const report = {
      diagnostic: "case-assertion-atomic-decomposition",
      generatedAt: new Date().toISOString(),
      readOnly: true,
      databaseWrites: false,
      productionPersistence: false,
      productionBearingChanges: false,
      productionRetrievalChanges: false,
      futureProductionContract: {
        persistenceIsIntendedDesign: true,
        implementedNow: false,
        authoritativeParentRemainsUnchanged: true,
        persistedChildrenRequireRealDatabaseIds: true,
        persistedChildrenRequireExplicitParentLineage: true,
        decompositionVersionMustBeRecorded: true,
        bearingLinksEventuallyTargetPersistedChildIds: true,
        diagnosticSyntheticIdsAreNeverProductionIds: true,
        parentScoresMustNotBlindlyAverageChildScores: true,
        designDocument:
          "backend/scripts/razorClaimsEvaluation/CASE_ASSERTION_DECOMPOSITION_DESIGN.md",
      },
      caseAssertionDecomposition: {
        case: loaded.caseContent,
        inputCaseAssertions: loaded.caseAssertions,
        watchedAssertionIds: WATCHED_ASSERTION_IDS,
        passCount: PASS_COUNT,
        decompositionModelIds: DECOMPOSITION_MODEL_IDS,
        bearingSelectedDecompositionModelId:
          BEARING_SELECTED_DECOMPOSITION_MODEL_ID,
        executableUserPromptTemplate: CASE_ASSERTION_DECOMPOSITION_PROMPT,
        strictOutputSchema: CASE_ASSERTION_DECOMPOSITION_SCHEMA,
        inputFieldsOnly: ["oneCaseAssertion"],
        modelEvaluations,
        selectedForBearing,
      },
    };
    await fs.mkdir(RESULTS_DIRECTORY, { recursive: true });
    await Promise.all([
      fs.writeFile(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      fs.writeFile(HTML_PATH, renderHtml(report), "utf8"),
    ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          success: modelEvaluations.every((evaluation) =>
            evaluation.passes.every((pass) => pass.status === "accepted"),
          ),
          modelEvaluations: modelEvaluations.map((evaluation) => ({
            modelId: evaluation.modelConfiguration.id,
            selectedForBearing: evaluation.selectedForBearing,
            passSummaries: evaluation.passes.map((pass) => ({
              passNumber: pass.passNumber,
              status: pass.status,
              aggregateDiagnostics: pass.aggregateDiagnostics,
            })),
            unstableParentAssertionIds:
              evaluation.unstableParentAssertionIds,
            tokenUsage: evaluation.tokenUsage,
          })),
          selectedForBearing,
          timestampedJson: JSON_PATH,
          timestampedHtml: HTML_PATH,
        },
        null,
        2,
      )}\n`,
    );
    success = modelEvaluations.every((evaluation) =>
      evaluation.passes.every((pass) => pass.status === "accepted"),
    );
  } catch (error) {
    process.stderr.write(
      `[razor-decomposition] ${error.stack || error.message}\n`,
    );
  } finally {
    await new Promise((resolve) => pool.end(resolve));
  }
  return {
    success,
    timestampedJsonPath: JSON_PATH,
    timestampedHtmlPath: HTML_PATH,
  };
}
