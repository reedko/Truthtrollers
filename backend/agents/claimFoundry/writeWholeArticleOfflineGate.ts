import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  buildWholeArticleContext,
  supportsExplicitPromptCacheBreakpoint,
} from "./claimFoundryArticleContext.js";
import {
  createWholeArticleClaimFoundryAgentDefinition,
  WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES,
} from "./claimFoundryWholeArticleAgent.js";
import {
  MemoryClaimFoundryPersistence,
  hashValue,
} from "./claimFoundryPersistence.js";
import { deriveContentRegions } from "./claimFoundryCoverage.js";
import { createRunState } from "./claimFoundryState.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const outputPath = path.join(
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
const buildArticleDocument = articleDocumentFromText as unknown as
  (input: {
    text: string;
    metadata?: Record<string, unknown>;
    sourceDescriptor?: Record<string, unknown>;
  }) => ReturnType<typeof articleDocumentFromText>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const raw = JSON.parse(readFileSync(path.join(
    backendRoot,
    "test/claim-foundry/fixtures/CF1-F03/article.json",
  ), "utf8"));
  const source = raw.article ?? raw;
  const articleDocument = buildArticleDocument({
    text: source.text,
    metadata: { title: source.title, language: source.language },
    sourceDescriptor: { url: source.url },
  });
  const manifestHash = hashValue(articleDocument.sourceUnits.map(unit => ({
    unitId: unit.unitId,
    text: unit.text,
    sourceOffsets: unit.sourceOffsets,
  })));
  const persistence = new MemoryClaimFoundryPersistence();
  await persistence.create(createRunState({
    runId: "cf6-offline-gate",
    contentId: "cf1-f03",
    contentHash: articleDocument.contentHash,
    sourceUnitManifestHash: manifestHash,
    contentRegions: deriveContentRegions(articleDocument),
    budgets: {
      maxToolCalls: 30,
      maxUnitsRead: 1,
      maxRepairRounds: 0,
      maxInputTokens: 100_000,
    },
    continuation: {
      strategy: "conversationId",
      id: "conv-offline-gate",
    },
    traceId: null,
    versions: {
      instruction: "cf6.whole-article.instructions.v2.1",
      toolSchema: "cf6.wholeArticle.tools.v2.1",
      model: "offline",
      code: "cf6.whole-article.v2.1",
    },
  }));
  const definition = createWholeArticleClaimFoundryAgentDefinition({
    context: {
      runId: "cf6-offline-gate",
      contentId: "cf1-f03",
      articleDocument,
      persistence,
    },
    model: "gpt-4.1-mini",
  });
  const article = buildWholeArticleContext({
    document: articleDocument,
    metadata: {
      title: source.title,
      url: source.url ?? null,
      language: source.language ?? null,
    },
  });
  const toolSchemas = definition.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
    strict: true,
  }));
  const schemaBytes = Buffer.byteLength(JSON.stringify(toolSchemas));
  const schemaByteLimit = 32_768;
  const runtimeFiles = [
    "backend/agents/claimFoundry/claimFoundryArticleContext.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleAgent.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleRunner.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleTools.ts",
    "backend/agents/claimFoundry/claimFoundryInspection.ts",
    "backend/agents/claimFoundry/claimFoundryWorkingPackage.ts",
    "backend/agents/claimFoundry/claimFoundryRequestAssertions.ts",
    "backend/agents/claimFoundry/claimFoundryInputFilter.ts",
    "backend/agents/claimFoundry/claimFoundryInstructions.ts",
    "backend/agents/claimFoundry/claimFoundryCoverage.ts",
    "backend/agents/claimFoundry/claimFoundryPersistence.ts",
    "backend/agents/claimFoundry/claimFoundryState.ts",
    "backend/agents/claimFoundry/runWholeArticleFixture.ts",
    "backend/agents/shared/agentRuntime.ts",
  ];
  const contaminationMarkers = [
    "fraud",
    "cover-up",
    "expected thesis",
    "expected crux",
  ];
  const contamination = runtimeFiles.flatMap(relative => {
    const text = readFileSync(path.join(repositoryRoot, relative), "utf8");
    return contaminationMarkers
      .filter(marker => text.toLowerCase().includes(marker.toLowerCase()))
      .map(marker => ({ file: relative, marker }));
  });
  const result = {
    version: "cf6.whole-article.offline-gate.v2.1",
    generatedAt: new Date().toISOString(),
    governingHashes: {
      specification: sha256(readFileSync(specificationPath)),
      plan: sha256(readFileSync(planPath)),
    },
    source: {
      contentHash: articleDocument.contentHash,
      sourceUnitManifestHash: manifestHash,
      sourceUnitCount: articleDocument.sourceUnits.length,
      canonicalTextBytes: Buffer.byteLength(articleDocument.canonicalText),
      articleContextBytes: Buffer.byteLength(article.text),
      articleContextHash: article.serializedPayloadHash,
    },
    agent: {
      name: definition.name,
      toolNames: definition.tools.map(tool => tool.name),
      expectedToolNames: [...WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES],
      toolSchemaBytes: schemaBytes,
      toolSchemaByteLimit: schemaByteLimit,
      toolSchemaHash: sha256(JSON.stringify(toolSchemas)),
      instructionHash: sha256(definition.instructions),
      parallelToolCalls: definition.modelSettings?.parallelToolCalls,
      maxFunctionToolConcurrency: 1,
      maxInternalModelTurns: 6,
      explicitCacheBreakpointSupported:
        supportsExplicitPromptCacheBreakpoint("gpt-4.1-mini"),
      cacheMode: "automatic-provider",
      terminalToolUseBehaviorConfigured:
        typeof definition.toolUseBehavior === "function",
    },
    verification: {
      commandsCompletedBeforeGateWrite: [
        "npm run test:agents:claim-foundry-tools",
        "npm run test:agents:claim-foundry-agent",
        "npm run typecheck:agents",
        "npm run test:agents:claim-foundry-mysql",
      ],
      contamination,
      passed:
        articleDocument.sourceUnits.length === 404 &&
        schemaBytes <= schemaByteLimit &&
        JSON.stringify(definition.tools.map(tool => tool.name)) ===
          JSON.stringify(WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES) &&
        definition.modelSettings?.parallelToolCalls === false &&
        typeof definition.toolUseBehavior === "function" &&
        contamination.length === 0,
    },
    runtimeSourceHashes: Object.fromEntries(runtimeFiles.map(relative => [
      relative,
      sha256(readFileSync(path.join(repositoryRoot, relative))),
    ])),
  };
  if (!result.verification.passed) {
    throw new Error(`CF6 offline gate failed: ${JSON.stringify(result.verification)}`);
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, ...result.verification }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
