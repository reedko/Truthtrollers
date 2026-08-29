import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, query } from "../../src/db/pool.js";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_CONFIGURATIONS,
  runConfiguredModel,
} from "./models.js";
import {
  buildUserPrompt,
  parseModelResult,
  RESULT_SCHEMA,
  validateModelResult,
} from "./promptAndSchema.js";

// Edit these two IDs to select the task/reference pair for the next run.
const TEST_REFERENCE_CONTENT_ID = 20725;
const TEST_TASK_CONTENT_ID = 20716;
const MIN_REFERENCE_TEXT_CHARACTERS = 500;

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIRECTORY = path.dirname(MODULE_DIRECTORY);
const RESULTS_DIRECTORY = path.join(
  SCRIPT_DIRECTORY,
  "referenceSemanticInputDiagnostic-results",
);
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const TIMESTAMPED_RESULT_PATH = path.join(
  RESULTS_DIRECTORY,
  `referenceSemanticInputDiagnostic-${RUN_TIMESTAMP}.txt`,
);
const LAST_RUN_RESULT_PATH = path.join(
  SCRIPT_DIRECTORY,
  "referenceSemanticInputDiagnostic.last-run.txt",
);

function createReporter() {
  let outputBuffer = "";

  return {
    emit(text) {
      process.stdout.write(text);
      outputBuffer += text;
    },
    emitError(text) {
      process.stderr.write(text);
      outputBuffer += text;
    },
    async writeFiles() {
      await fs.mkdir(RESULTS_DIRECTORY, { recursive: true });
      await Promise.all([
        fs.writeFile(LAST_RUN_RESULT_PATH, outputBuffer, "utf8"),
        fs.writeFile(TIMESTAMPED_RESULT_PATH, outputBuffer, "utf8"),
      ]);
    },
  };
}

async function selectReferenceCandidate() {
  const rows = await query(
    `SELECT
       cr.content_relation_id,
       cr.content_id AS task_content_id,
       cr.reference_content_id
     FROM content_relations cr
     JOIN content reference_content
       ON reference_content.content_id = cr.reference_content_id
     WHERE cr.reference_content_id = ?
       AND cr.content_id = ?
       AND reference_content.content_text IS NOT NULL
       AND CHAR_LENGTH(reference_content.content_text) >= ?
       AND EXISTS (
         SELECT 1
         FROM content_claims cc
         WHERE cc.content_id = cr.content_id
           AND cc.relationship_type IN ('task', 'content')
       )
     ORDER BY cr.created_at DESC, cr.content_relation_id DESC
     LIMIT 1`,
    [
      TEST_REFERENCE_CONTENT_ID,
      TEST_TASK_CONTENT_ID,
      MIN_REFERENCE_TEXT_CHARACTERS,
    ],
  );

  return rows[0] || null;
}

async function loadReferenceContent(referenceContentId) {
  const rows = await query(
    `SELECT
       content_id,
       content_name,
       url,
       content_text
     FROM content
     WHERE content_id = ?
     LIMIT 1`,
    [referenceContentId],
  );

  return rows[0] || null;
}

async function loadTaskClaims(taskContentId) {
  return query(
    `SELECT
       c.claim_id,
       c.claim_text
     FROM content_claims cc
     JOIN claims c ON c.claim_id = cc.claim_id
     WHERE cc.content_id = ?
       AND cc.relationship_type IN ('task', 'content')
     ORDER BY COALESCE(cc.claim_order, 2147483647), c.claim_id`,
    [taskContentId],
  );
}

function printableProviderResponse(providerResponse) {
  if (typeof providerResponse === "string") {
    try {
      return JSON.parse(providerResponse);
    } catch {
      return providerResponse;
    }
  }
  return providerResponse;
}

async function runProcess(reporter) {
  const selected = await selectReferenceCandidate();
  if (!selected) {
    throw new Error(
      `Reference ${TEST_REFERENCE_CONTENT_ID} is not linked to task ${TEST_TASK_CONTENT_ID}, lacks at least ${MIN_REFERENCE_TEXT_CHARACTERS} stored content_text characters, or the task has no claims.`,
    );
  }

  const [reference, taskClaims] = await Promise.all([
    loadReferenceContent(selected.reference_content_id),
    loadTaskClaims(selected.task_content_id),
  ]);
  if (!reference) {
    throw new Error(
      `Selected reference content_id=${selected.reference_content_id} no longer exists.`,
    );
  }

  const fullText = reference.content_text || "";
  const userPrompt = buildUserPrompt(fullText, taskClaims);
  const payload = {
    reference_content_id: reference.content_id,
    task_content_id: selected.task_content_id,
    url: reference.url || null,
    title: reference.content_name || null,
    full_text_character_count: fullText.length,
    task_claim_count: taskClaims.length,
    task_claims: taskClaims.map((claim) => ({
      claim_id: claim.claim_id,
      claim_text: claim.claim_text,
    })),
  };
  reporter.emit(
    `=== EXPERIMENT CONFIGURATION ===\n${JSON.stringify(
      {
        model_count: MODEL_CONFIGURATIONS.length,
        models: MODEL_CONFIGURATIONS,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      },
      null,
      2,
    )}\n`,
  );
  reporter.emit(
    `=== DIAGNOSTIC INPUT ===\n${JSON.stringify(payload, null, 2)}\n`,
  );

  const failedConfigurations = [];
  for (const configuration of MODEL_CONFIGURATIONS) {
    reporter.emit(`\n=== MODEL CONFIGURATION: ${configuration.id} ===\n`);
    const modelStartedAt = new Date();
    const modelStartedAtMs = performance.now();
    let modelCallDurationMs = null;
    let modelRun = null;

    try {
      modelRun = await runConfiguredModel(
        configuration,
        userPrompt,
        RESULT_SCHEMA,
      );
      modelCallDurationMs = Math.round(performance.now() - modelStartedAtMs);
      reporter.emit(`=== RAW MODEL RESULT ===\n${modelRun.rawModelResult}\n`);
      reporter.emit(
        `=== MODEL RUN METADATA ===\n${JSON.stringify(
          {
            configuration_id: configuration.id,
            model: configuration.model,
            api: configuration.api,
            reasoning: configuration.reasoning ?? null,
            temperature: configuration.temperature ?? null,
            thinking: configuration.thinking ?? null,
            reasoning_effort: configuration.reasoningEffort ?? null,
            response_format: modelRun.responseFormat,
            response_id: modelRun.responseId,
            response_status: modelRun.responseStatus,
            incomplete_details: modelRun.incompleteDetails,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            prompt_character_count: userPrompt.length,
            evidence_character_count: fullText.length,
            started_at: modelStartedAt.toISOString(),
            duration_ms: modelCallDurationMs,
            duration_seconds: Number((modelCallDurationMs / 1000).toFixed(3)),
            finish_reason: modelRun.finishReason,
            usage: modelRun.usage,
          },
          null,
          2,
        )}\n`,
      );

      const parsedResult = parseModelResult(modelRun.rawModelResult);
      reporter.emit(
        `=== PARSED MODEL RESULT ===\n${JSON.stringify(parsedResult, null, 2)}\n`,
      );
      const validationErrors = validateModelResult(
        parsedResult,
        fullText,
        taskClaims,
      );
      reporter.emit(
        `=== VALIDATION RESULT ===\n${JSON.stringify(
          {
            valid: validationErrors.length === 0,
            errors: validationErrors,
          },
          null,
          2,
        )}\n`,
      );
      if (validationErrors.length > 0) {
        failedConfigurations.push(configuration.id);
      }
    } catch (error) {
      failedConfigurations.push(configuration.id);
      const durationMs =
        modelCallDurationMs ?? Math.round(performance.now() - modelStartedAtMs);
      reporter.emitError(
        `[reference-semantic-input-diagnostic:${configuration.id}] ${error.message}\n`,
      );
      const providerResponse =
        error.providerResponse ?? modelRun?.providerResponse;
      if (providerResponse !== undefined) {
        reporter.emitError(
          `=== PROVIDER RESPONSE ===\n${JSON.stringify(
            printableProviderResponse(providerResponse),
            null,
            2,
          )}\n`,
        );
      }
      reporter.emitError(
        `=== MODEL RUN TIMING ===\n${JSON.stringify(
          {
            configuration_id: configuration.id,
            model: configuration.model,
            api: configuration.api,
            reasoning: configuration.reasoning ?? null,
            temperature: configuration.temperature ?? null,
            thinking: configuration.thinking ?? null,
            reasoning_effort: configuration.reasoningEffort ?? null,
            started_at: modelStartedAt.toISOString(),
            duration_ms: durationMs,
            duration_seconds: Number((durationMs / 1000).toFixed(3)),
            failed: true,
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  if (failedConfigurations.length > 0) {
    throw new Error(
      `Failed model configurations: ${failedConfigurations.join(", ")}`,
    );
  }
}

export async function runReferenceSemanticInputDiagnostic() {
  const reporter = createReporter();
  let success = true;

  try {
    await runProcess(reporter);
  } catch (error) {
    success = false;
    reporter.emitError(
      `[reference-semantic-input-diagnostic] ${error.message}\n`,
    );
  } finally {
    await new Promise((resolve) => pool.end(resolve));
    reporter.emit(
      `=== OUTPUT FILES ===\n${JSON.stringify(
        {
          last_run: LAST_RUN_RESULT_PATH,
          timestamped_run: TIMESTAMPED_RESULT_PATH,
        },
        null,
        2,
      )}\n`,
    );
    await reporter.writeFiles();
  }

  return {
    success,
    lastRunResultPath: LAST_RUN_RESULT_PATH,
    timestampedResultPath: TIMESTAMPED_RESULT_PATH,
  };
}
