import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import OpenAI from "openai";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  createWholeArticleClaimFoundryAgentDefinition,
} from "./claimFoundryWholeArticleAgent.js";
import {
  runWholeArticleClaimFoundry,
  WHOLE_ARTICLE_CLAIM_FOUNDRY_RUNTIME_BUDGET,
  WHOLE_ARTICLE_OPERATIONAL_BUDGET,
} from "./claimFoundryWholeArticleRunner.js";
import {
  WHOLE_ARTICLE_CLAIM_FOUNDRY_INSTRUCTION_VERSION,
} from "./claimFoundryInstructions.js";
import {
  CF6_WHOLE_ARTICLE_TOOL_SCHEMA_VERSION,
} from "./claimFoundryWorkingPackage.js";
import {
  hashValue,
  MySqlClaimFoundryPersistence,
  type SqlTransactionPort,
} from "./claimFoundryPersistence.js";
import { deriveContentRegions } from "./claimFoundryCoverage.js";
import { createRunState } from "./claimFoundryState.js";
import { readCf6MySqlTestEnvironment } from "../tests/claimFoundry/mysqlEnvironment.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const migrationPath = path.join(
  backendRoot,
  "migrations/2026-07-27-01-cf6-agent-state.sql",
);
const offlineGatePath = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cf6-agent/whole-article-v2.1/offline-gate.json",
);
const specificationPath = path.join(
  repositoryRoot,
  "docs/Agent/CF6_WHOLE_ARTICLE_AGENT_CONFIGURATION_SPEC_V2.1.md",
);
const planPath = path.join(
  repositoryRoot,
  "docs/Agent/CF6_CORRECTED_AGENT_BUILD_PLAN_2026-07-28_R2.md",
);
const allowedFixtures = new Set(["CF1-F03"]);
const buildArticleDocument = articleDocumentFromText as unknown as
  (input: {
    text: string;
    metadata?: Record<string, unknown>;
    sourceDescriptor?: Record<string, unknown>;
  }) => ReturnType<typeof articleDocumentFromText>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function migrationStatements(sql: string) {
  const output: string[] = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    const directive = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (directive) {
      delimiter = directive[1]!;
      continue;
    }
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

async function query(
  connection: Pool | PoolConnection,
  sql: string,
  values: unknown[] = [],
) {
  const [rows] = await connection.query(sql, values);
  return rows as any[];
}

function transactionPort(pool: Pool): SqlTransactionPort {
  return {
    async transaction<T>(
      work: (q: (sql: string, values?: unknown[]) => Promise<any[]>) =>
        Promise<T>,
    ) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(
          (sql, values = []) => query(connection, sql, values),
        );
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
  const apiKey = (
    process.env.OPENAI_API_KEY ??
    process.env.REACT_APP_OPENAI_API_KEY ??
    envFile.OPENAI_API_KEY ??
    envFile.REACT_APP_OPENAI_API_KEY
  )?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required in backend/.env",
    );
  }
  const model = option(
    "--model",
    process.env.CF6_AGENT_MODEL ??
      envFile.CF6_AGENT_MODEL ??
      "gpt-4.1-mini",
  );
  return { apiKey, model };
}

function assertOfflineGate() {
  if (!existsSync(offlineGatePath)) {
    throw new Error(
      "CF6 live run blocked: offline gate artifact is missing; run " +
      "npm run verify:agents:claim-foundry-whole first",
    );
  }
  const gate = JSON.parse(readFileSync(offlineGatePath, "utf8"));
  const specificationHash = sha256(readFileSync(specificationPath));
  const planHash = sha256(readFileSync(planPath));
  if (gate.verification?.passed !== true ||
    gate.governingHashes?.specification !== specificationHash ||
    gate.governingHashes?.plan !== planHash) {
    throw new Error(
      "CF6 live run blocked: offline gate failed or governing documents changed",
    );
  }
  for (const [relative, expectedHash] of Object.entries(
    gate.runtimeSourceHashes ?? {},
  )) {
    const actualHash = sha256(
      readFileSync(path.join(repositoryRoot, relative)),
    );
    if (actualHash !== expectedHash) {
      throw new Error(
        `CF6 live run blocked: gated runtime source changed (${relative})`,
      );
    }
  }
  return gate;
}

function writeJson(directory: string, name: string, value: unknown) {
  writeFileSync(
    path.join(directory, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function reviewMarkdown(input: {
  fixture: string;
  source: any;
  result: Awaited<ReturnType<typeof runWholeArticleClaimFoundry>>;
  events: any[];
}) {
  const pkg = input.result.finalPackage;
  const claims = pkg?.claims ?? [];
  const theses = pkg?.theses ?? [];
  return `# CF6 Whole-Article ClaimFoundry Review

- Fixture: ${input.fixture}
- Source: ${input.source.title}
- Persisted terminal status: ${input.result.state.status}
- Model requests: ${input.result.sdkResult.metadata.modelTurns}
- Tool calls: ${input.result.sdkResult.metadata.toolCalls}
- Gross input tokens: ${input.result.usageEvidence.grossInputTokens}
- Cached input tokens: ${input.result.usageEvidence.cachedInputTokens}
- Uncached input tokens: ${input.result.usageEvidence.uncachedInputTokens}
- Cost-equivalent input tokens: ${input.result.usageEvidence.costEquivalentInputTokens}
- Article cost multiplier: ${input.result.usageEvidence.articleCostMultiplier}
- Trace ID: ${input.result.sdkResult.metadata.traceId}

## Model-authored theses

${theses.length
    ? theses.map(thesis =>
      `- ${thesis.thesisId}: ${thesis.statement} (${thesis.groundingUnitIds.join(", ")})`,
    ).join("\n")
    : "_No finalized theses._"}

## Selected evidentiary targets

${claims.length
    ? claims.map(claim => `### ${claim.claimId}

- Surface statement: ${claim.surfaceStatement}
- Substantive assertion: ${claim.substantiveAssertion}
- Verification target: ${claim.verificationTarget}
- Thesis links: ${claim.thesisIds.join(", ")}
- Grounding: ${claim.substantiveGroundingUnitIds.join(", ")}`).join("\n\n")
    : "_No finalized claims._"}

## Structural-region dispositions

${pkg?.regionDispositions.length
    ? pkg.regionDispositions.map(item =>
      `- ${item.regionId}: ${item.reasonCode}${item.note ? ` — ${item.note}` : ""}`,
    ).join("\n")
    : "_None._"}

## Tool trajectory

\`\`\`json
${JSON.stringify(input.events, null, 2)}
\`\`\`
`;
}

async function main() {
  const offlineGate = assertOfflineGate();
  const fixture = option("--fixture", "CF1-F03").toUpperCase();
  if (!allowedFixtures.has(fixture)) {
    throw new Error("The governed first experiment permits only CF1-F03");
  }
  const { apiKey, model } = readApiEnvironment();
  const mysqlConfig = readCf6MySqlTestEnvironment();
  const pool = mysql.createPool({ ...mysqlConfig, connectionLimit: 4 });
  try {
    const connection = await pool.getConnection();
    try {
      for (const statement of migrationStatements(
        readFileSync(migrationPath, "utf8"),
      )) {
        await query(connection, statement);
      }
    } finally {
      connection.release();
    }

    const raw = JSON.parse(readFileSync(path.join(
      backendRoot,
      "test/claim-foundry/fixtures",
      fixture,
      "article.json",
    ), "utf8"));
    const source = raw.article ?? raw;
    const articleDocument = buildArticleDocument({
      text: source.text,
      metadata: { title: source.title, language: source.language },
      sourceDescriptor: { url: source.url },
    });
    if (articleDocument.sourceUnits.length !==
      offlineGate.source.sourceUnitCount ||
      articleDocument.contentHash !== offlineGate.source.contentHash) {
      throw new Error("CF6 live source differs from the offline-gated source");
    }

    const contentId = fixture.toLowerCase();
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const runId = `cf6-whole-${contentId}-${stamp}`;
    const sourceUnitManifestHash = hashValue(
      articleDocument.sourceUnits.map(unit => ({
        unitId: unit.unitId,
        text: unit.text,
        sourceOffsets: unit.sourceOffsets,
      })),
    );
    const client = new OpenAI({ apiKey });
    const conversation = await client.conversations.create({
      metadata: {
        workflow: "cf6-whole-article-v2.1",
        run_id: runId,
        content_id: contentId,
      },
    });
    const persistence = new MySqlClaimFoundryPersistence(transactionPort(pool));
    await persistence.create(createRunState({
      runId,
      contentId,
      contentHash: articleDocument.contentHash,
      sourceUnitManifestHash,
      contentRegions: deriveContentRegions(articleDocument),
      budgets: {
        maxToolCalls: 30,
        maxUnitsRead: 1,
        maxRepairRounds: 0,
        maxInputTokens: 100_000,
      },
      continuation: {
        strategy: "conversationId",
        id: conversation.id,
      },
      traceId: null,
      versions: {
        instruction: WHOLE_ARTICLE_CLAIM_FOUNDRY_INSTRUCTION_VERSION,
        toolSchema: CF6_WHOLE_ARTICLE_TOOL_SCHEMA_VERSION,
        model,
        code: "cf6.whole-article.v2.1",
      },
    }));
    const context = {
      runId,
      contentId,
      articleDocument,
      persistence,
    };
    const definition = createWholeArticleClaimFoundryAgentDefinition({
      context,
      model,
    });
    const outputDirectory = path.join(
      repositoryRoot,
      "artifacts/claim-foundry/cf6-agent/whole-article-v2.1",
      `${fixture.toLowerCase()}-${stamp}`,
    );
    if (existsSync(outputDirectory)) {
      throw new Error(`Refusing to overwrite ${outputDirectory}`);
    }
    mkdirSync(outputDirectory, { recursive: true });
    writeJson(outputDirectory, "run-config.json", {
      fixture,
      runId,
      contentId,
      model,
      conversationId: conversation.id,
      governingHashes: offlineGate.governingHashes,
      instructionVersion: WHOLE_ARTICLE_CLAIM_FOUNDRY_INSTRUCTION_VERSION,
      toolSchemaVersion: CF6_WHOLE_ARTICLE_TOOL_SCHEMA_VERSION,
      runtimeBudget: WHOLE_ARTICLE_CLAIM_FOUNDRY_RUNTIME_BUDGET,
      operationalBudget: WHOLE_ARTICLE_OPERATIONAL_BUDGET,
      database: mysqlConfig.database,
    });
    writeJson(outputDirectory, "source-manifest.json", {
      fixture,
      title: source.title,
      url: source.url ?? null,
      contentHash: articleDocument.contentHash,
      sourceUnitManifestHash,
      sourceFamily: articleDocument.sourceFamily,
      sourceUnitCount: articleDocument.sourceUnits.length,
    });
    writeFileSync(
      path.join(outputDirectory, "instruction.txt"),
      `${definition.instructions}\n`,
    );
    writeJson(outputDirectory, "tool-schema-summary.json",
      definition.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
      })));

    const startedAt = Date.now();
    const result = await runWholeArticleClaimFoundry({
      context,
      model,
      apiKey,
      conversationId: conversation.id,
      articleMetadata: {
        title: source.title,
        url: source.url ?? null,
        language: source.language ?? null,
      },
    });
    const events = await persistence.events(runId);
    const requests = await persistence.modelRequests(runId);
    writeJson(outputDirectory, "tool-trajectory.json", events);
    writeJson(outputDirectory, "per-request-usage.json", requests);
    writeJson(outputDirectory, "request-evidence.json", result.requestEvidence);
    writeJson(outputDirectory, "usage-evidence.json", result.usageEvidence);
    writeJson(outputDirectory, "terminal-output.json", result.sdkResult.finalOutput);
    writeJson(outputDirectory, "persisted-state.json", result.state);
    if (result.finalPackage) {
      writeJson(outputDirectory, "final-package.json", result.finalPackage);
    }
    writeJson(outputDirectory, "trace.json", {
      traceId: result.sdkResult.metadata.traceId,
      lastResponseId: result.sdkResult.metadata.lastResponseId,
      sdkEventTypes: result.sdkResult.sdkEventTypes,
      runtimeEvidence: result.sdkResult.runtimeEvidence,
      durationMs: result.sdkResult.metadata.durationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    writeFileSync(
      path.join(outputDirectory, "review.md"),
      reviewMarkdown({ fixture, source, result, events }),
    );
    writeJson(outputDirectory, "run-manifest.json", {
      fixture,
      runId,
      status: result.state.status,
      artifactDirectory: path.relative(repositoryRoot, outputDirectory),
      files: [
        "run-config.json",
        "source-manifest.json",
        "instruction.txt",
        "tool-schema-summary.json",
        "tool-trajectory.json",
        "per-request-usage.json",
        "request-evidence.json",
        "usage-evidence.json",
        "terminal-output.json",
        "persisted-state.json",
        ...(result.finalPackage ? ["final-package.json"] : []),
        "trace.json",
        "review.md",
      ],
    });
    console.log(JSON.stringify({
      artifactDirectory: outputDirectory,
      terminalOutput: result.sdkResult.finalOutput,
      usageEvidence: result.usageEvidence,
      metadata: result.sdkResult.metadata,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  process.exitCode = 1;
});
