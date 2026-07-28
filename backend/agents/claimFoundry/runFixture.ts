import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import { createClaimFoundryAgentDefinition } from "./claimFoundryAgent.js";
import { CLAIM_FOUNDRY_INSTRUCTION_VERSION } from "./claimFoundryInstructions.js";
import {
  hashValue,
  MySqlClaimFoundryPersistence,
  type SqlTransactionPort,
} from "./claimFoundryPersistence.js";
import { runClaimFoundryManager, CLAIM_FOUNDRY_RUNTIME_BUDGET } from "./claimFoundryRunner.js";
import { CF6_TOOL_SCHEMA_VERSION } from "./claimFoundrySchemas.js";
import { createRunState } from "./claimFoundryState.js";
import { readCf6MySqlTestEnvironment } from "../tests/claimFoundry/mysqlEnvironment.js";
import { deriveContentRegions } from "./claimFoundryCoverage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const migrationPath = path.join(backendRoot, "migrations/2026-07-27-01-cf6-agent-state.sql");
const allowedFixtures = new Set(["CF1-F02", "CF1-F03", "CF1-F06"]);
const buildArticleDocument = articleDocumentFromText as unknown as
  (input: { text: string; metadata?: Record<string, unknown>;
    sourceDescriptor?: Record<string, unknown> }) => any;

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function migrationStatements(sql: string) {
  const output: string[] = []; let delimiter = ";"; let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    const directive = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (directive) { delimiter = directive[1]!; continue; }
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trim().slice(0, -delimiter.length).trim();
      if (statement) output.push(statement);
      buffer = "";
    }
  }
  if (buffer.trim()) output.push(buffer.trim());
  return output;
}

async function query(connection: Pool | PoolConnection, sql: string, values: unknown[] = []) {
  const [rows] = await connection.query(sql, values);
  return rows as any[];
}

function transactionPort(pool: Pool): SqlTransactionPort {
  return {
    async transaction<T>(work: (q: (sql: string, values?: unknown[]) => Promise<any[]>) => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work((sql, values = []) => query(connection, sql, values));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

function readApiEnvironment() {
  const envFile = parse(readFileSync(path.join(backendRoot, ".env")));
  const apiKey = (process.env.OPENAI_API_KEY ?? process.env.REACT_APP_OPENAI_API_KEY ??
    envFile.OPENAI_API_KEY ?? envFile.REACT_APP_OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required in backend/.env");
  const model = option("--model", process.env.CF6_AGENT_MODEL ?? envFile.CF6_AGENT_MODEL ??
    process.env.CF6_SMOKE_MODEL ?? envFile.CF6_SMOKE_MODEL ?? "gpt-4.1-mini");
  return { apiKey, model };
}

function writeJson(directory: string, name: string, value: unknown) {
  writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function assertLiveProjectionGate() {
  const projectionPath = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf6-agent/m4c-offline-projection/projection.json",
  );
  const projection = JSON.parse(readFileSync(projectionPath, "utf8"));
  if (projection.instructionVersion !== CLAIM_FOUNDRY_INSTRUCTION_VERSION ||
    projection.projectedCumulativeInputTokens > 45_000 ||
    projection.projectedCumulativeInputTokens > 35_000 ||
    projection.gatePassed !== true) {
    throw new Error(
      `CF6 live run blocked by offline token gate: ` +
      `${projection.projectedCumulativeInputTokens} projected input tokens`,
    );
  }
}

function reviewMarkdown(input: {
  fixture: string; source: any; completion: any; state: any; finalPackage: any;
  events: any[]; metadata: any; validationReports: any[]; repairHistory: any[];
}) {
  const claims = input.finalPackage?.selectedClaims ?? [];
  const claimRows = claims.length
    ? claims.map((claim: any) => `### ${claim.claimId}

- Surface statement: ${claim.surfaceStatement}
- Substantive assertion: ${claim.substantiveAssertion}
- Supplier: ${claim.contentSupplier}
- Article treatment: ${claim.articleTreatment}
- Verification target: ${claim.verificationTarget}
- Substantive grounding: ${claim.substantiveGroundingUnitIds.join(", ")}`).join("\n\n")
    : "_No finalized selected claims._";
  return `# CF6 ClaimFoundry Manager Review

- Fixture: ${input.fixture}
- Source: ${input.source.title}
- Content ID: ${input.completion.contentId}
- Terminal status: ${input.completion.terminalStatus}
- Terminal cause: ${input.completion.summary}
- Model calls: ${input.metadata.modelTurns}
- Tool calls: ${input.metadata.toolCalls}
- Tokens: ${input.metadata.usage.totalTokens ?? "unavailable"}
- Wall time: ${input.metadata.durationMs} ms
- Trace ID: ${input.metadata.traceId}

## Selected claims

${claimRows}

## Exclusions and abstentions

${input.finalPackage?.dispositions?.length
    ? input.finalPackage.dispositions.map((item: any) => `- ${item.candidateId}: ${item.decision} — ${item.reason}`).join("\n")
    : input.completion.abstentionReason ?? "_None recorded._"}

## Validation history

\`\`\`json
${JSON.stringify(input.validationReports, null, 2)}
\`\`\`

## Repair history

\`\`\`json
${JSON.stringify(input.repairHistory, null, 2)}
\`\`\`

## Tool trajectory

\`\`\`json
${JSON.stringify(input.events, null, 2)}
\`\`\`
`;
}

async function main() {
  assertLiveProjectionGate();
  const fixture = option("--fixture", "CF1-F03").toUpperCase();
  if (!allowedFixtures.has(fixture)) {
    throw new Error(`Fixture must be one of ${[...allowedFixtures].join(", ")}`);
  }
  const { apiKey, model } = readApiEnvironment();
  const mysqlConfig = readCf6MySqlTestEnvironment();
  const pool = mysql.createPool({ ...mysqlConfig, connectionLimit: 4 });
  try {
    const connection = await pool.getConnection();
    try {
      for (const statement of migrationStatements(readFileSync(migrationPath, "utf8"))) {
        await query(connection, statement);
      }
    } finally {
      connection.release();
    }

    const raw = JSON.parse(readFileSync(path.join(
      backendRoot, "test/claim-foundry/fixtures", fixture, "article.json",
    ), "utf8"));
    const source = raw.article ?? raw;
    const articleDocument = buildArticleDocument({
      text: source.text,
      metadata: { title: source.title, language: source.language },
      sourceDescriptor: { url: source.url },
    });
    const contentId = fixture.toLowerCase();
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const runId = `cf6-${contentId}-${stamp}`;
    const sourceUnitManifestHash = hashValue(articleDocument.sourceUnits.map((unit: any) => ({
      unitId: unit.unitId, text: unit.text, sourceOffsets: unit.sourceOffsets,
    })));
    const persistedBudget = {
      maxToolCalls: 30, maxUnitsRead: 250, maxRepairRounds: 2, maxInputTokens: 45_000,
    };
    const persistence = new MySqlClaimFoundryPersistence(transactionPort(pool));
    await persistence.create(createRunState({
      runId, contentId, contentHash: articleDocument.contentHash,
      sourceUnitManifestHash, budgets: persistedBudget,
      contentRegions: deriveContentRegions(articleDocument),
      traceId: null,
      versions: {
        instruction: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
        toolSchema: CF6_TOOL_SCHEMA_VERSION,
        model,
        code: "cf6.milestone3.vertical-slice.v1",
      },
    }));
    const context = { runId, contentId, articleDocument, persistence };
    const definition = createClaimFoundryAgentDefinition({
      context, model, runtimeBudget: CLAIM_FOUNDRY_RUNTIME_BUDGET, persistedBudget,
    });
    const outputDirectory = path.join(
      repositoryRoot, "artifacts/claim-foundry/cf6-agent", `${fixture.toLowerCase()}-${stamp}`,
    );
    if (existsSync(outputDirectory)) throw new Error(`Refusing to overwrite artifact directory ${outputDirectory}`);
    mkdirSync(outputDirectory, { recursive: true });
    writeJson(outputDirectory, "run-config.json", {
      fixture, runId, contentId, model,
      instructionVersion: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
      toolSchemaVersion: CF6_TOOL_SCHEMA_VERSION,
      runtimeBudget: CLAIM_FOUNDRY_RUNTIME_BUDGET,
      persistedBudget,
      database: mysqlConfig.database,
    });
    writeJson(outputDirectory, "source-manifest.json", {
      fixture, title: source.title, url: source.url ?? null,
      contentHash: articleDocument.contentHash, sourceUnitManifestHash,
      sourceFamily: articleDocument.sourceFamily,
      sourceUnitCount: articleDocument.sourceUnits.length,
    });
    writeFileSync(path.join(outputDirectory, "instruction.txt"), `${definition.instructions}\n`);
    writeJson(outputDirectory, "tool-schema-summary.json", definition.tools.map(tool => ({
      name: tool.name, description: tool.description,
    })));

    const startedAt = Date.now();
    const result = await runClaimFoundryManager({ context, model, apiKey });
    const events = await persistence.events(runId);
    const modelRequests = await persistence.modelRequests(runId);
    let sdkToolIndex = 0;
    const trajectory = events.map(event => {
      const sdkEvent = event.status === "completed"
        ? result.sdkResult.toolEvents[sdkToolIndex++]
        : undefined;
      return {
        sequence: event.sequence,
        modelDecision: {
          toolSelected: event.toolName,
          validatedArguments: sdkEvent?.validatedArguments ?? null,
        },
        deterministicEnforcement: {
          status: event.status,
          error: event.error,
          argumentsHash: event.argumentsHash,
          resultHash: event.resultHash,
          beforeStateHash: event.beforeStateHash,
          afterStateHash: event.afterStateHash,
          validationFindings: event.toolName === "validate_working_package"
            ? (sdkEvent?.output as any)?.result?.findings ?? []
            : [],
        },
        infrastructure: {
          persistedDurationMs: event.durationMs,
          sdkDurationMs: sdkEvent?.durationMs ?? null,
          createdAt: event.createdAt,
        },
      };
    });
    writeJson(outputDirectory, "tool-trajectory.json", trajectory);
    writeJson(outputDirectory, "validation-reports.json", result.state.validationReports);
    writeJson(outputDirectory, "repair-history.json", result.state.repairHistory);
    writeJson(outputDirectory, "coverage.json", result.state.contentRegions);
    writeJson(outputDirectory, "per-request-usage.json", modelRequests);
    writeJson(outputDirectory, "terminal-output.json", result.completion);
    if (result.finalPackage) writeJson(outputDirectory, "final-package.json", result.finalPackage);
    if (result.completion.terminalStatus === "abstained") {
      writeJson(outputDirectory, "abstention.json", {
        reason: result.completion.abstentionReason,
        inspectedUnitIds: result.state.inspectedUnitIds,
      });
    }
    writeJson(outputDirectory, "usage.json", result.sdkResult.metadata.usage);
    writeJson(outputDirectory, "latency.json", {
      sdkDurationMs: result.sdkResult.metadata.durationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    writeJson(outputDirectory, "trace.json", {
      traceId: result.sdkResult.metadata.traceId,
      lastResponseId: result.sdkResult.metadata.lastResponseId,
      sdkEventTypes: result.sdkResult.sdkEventTypes,
    });
    writeJson(outputDirectory, "run-manifest.json", {
      fixture, runId, status: result.completion.terminalStatus,
      artifactDirectory: path.relative(repositoryRoot, outputDirectory),
      files: [
        "run-config.json", "source-manifest.json", "instruction.txt",
        "tool-schema-summary.json", "tool-trajectory.json", "validation-reports.json",
        "repair-history.json", "coverage.json", "per-request-usage.json", "terminal-output.json",
        ...(result.finalPackage ? ["final-package.json"] : []),
        ...(result.completion.terminalStatus === "abstained" ? ["abstention.json"] : []),
        "usage.json", "latency.json", "trace.json", "review.md",
      ],
    });
    writeFileSync(path.join(outputDirectory, "review.md"), reviewMarkdown({
      fixture, source, completion: result.completion, state: result.state,
      finalPackage: result.finalPackage, events: trajectory,
      metadata: result.sdkResult.metadata,
      validationReports: result.state.validationReports,
      repairHistory: result.state.repairHistory,
    }));
    console.log(JSON.stringify({
      artifactDirectory: outputDirectory,
      terminalOutput: result.completion,
      metadata: result.sdkResult.metadata,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
