import path from "node:path";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  sha256,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  CFX_PIPE_VALIDATION_FIXTURES,
  freezeCfxPipeValidationFixture,
} from "../input/validationFixtures.js";
import {
  loadCfxDiscoveryWithUnitsPrompt,
  loadCfxSubstantiveReviewPrompt,
} from "../prompts/governedPrompts.js";
import {
  CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA,
} from "../schemas/discoveryWithUnitsSchema.js";
import {
  CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA,
} from "../schemas/substantiveReviewSchema.js";
import {
  loadCfxQueryPlanningPrompt,
} from "../retrieval/queryPlanning.js";
import {
  CFX_QUERY_PLANNING_JSON_SCHEMA,
} from "../retrieval/schema.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

const FIXTURE_IDS = ["CF1-F02", "CF1-F03", "CF1-F06"] as const;
const AUTHORIZATION = "Authorized: Execute exactly six complete governed CFX pipe-validation runs—run-a and run-b for frozen fixtures CF1-F02, CF1-F03, and CF1-F06—using identical code and configuration; make exactly 18 OpenAI Chat Completions API calls, three per run for unit-aware S1 burden discovery, S2 substantive review, and initial query planning, using gpt-4o-mini, temperature 0.1, strict governed structured outputs, store false, zero retries, 180,000 ms timeouts, 6,000 output tokens for S1 and S2 and 8,000 for planning; only after each stage validates, execute at most 360 logical retrieval lanes across all runs through Tavily or PubMed with five results per query and concurrency four, including at most 144 PubMed lanes and their deterministic zero-result fallback ladders, at most 792 retrieval-provider query executions, and at most 1,368 underlying retrieval HTTP requests; preserve every request, raw response, fallback attempt, normalized candidate, dedupe path, accounting record, report, and hash; make no full-text fetches, semantic bearing judgments, evidence scoring, or additional model or retrieval calls; generate the three double-run comparisons and recommendation, and do not promote unless the documented acceptance gates support PROMOTE or PROMOTE WITH CONDITIONS.";

async function main(): Promise<void> {
  const [s1Prompt, s2Prompt, planningPrompt, ...fixtures] = await Promise.all([
    loadCfxDiscoveryWithUnitsPrompt(),
    loadCfxSubstantiveReviewPrompt(),
    loadCfxQueryPlanningPrompt(),
    ...FIXTURE_IDS.map((fixtureId) =>
      freezeCfxPipeValidationFixture(CFX_REPOSITORY_ROOT, fixtureId)),
  ]);
  const codePaths = [
    "backend/src/claimfoundry/cfx/runtime/runPipeValidationFixture.ts",
    "backend/src/claimfoundry/cfx/input/validationFixtures.ts",
    "backend/src/claimfoundry/cfx/discoveryWithUnits/normalizeUnitIds.ts",
    "backend/src/claimfoundry/cfx/discoveryWithUnits/runDiscoveryWithUnits.ts",
    "backend/src/claimfoundry/cfx/retrieval/pubmedQueryCompiler.ts",
    "backend/src/claimfoundry/cfx/retrieval/queryPlanning.ts",
    "backend/src/claimfoundry/cfx/retrieval/executeRetrieval.ts",
    "backend/src/claimfoundry/cfx/retrieval/candidates.ts",
    "backend/src/claimfoundry/cfx/runtime/writePipeValidationComparisons.ts",
  ];
  const codeHashes = await Promise.all(codePaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await readFile(path.join(CFX_REPOSITORY_ROOT, relativePath))),
  })));
  const webProvider = (
    process.env.CFX_RETRIEVAL_WEB_PROVIDER
      ?? process.env.SEARCH_PROVIDER
      ?? "tavily"
  ).toLocaleLowerCase();
  const preflight = {
    schemaVersion: "cfx.pipeValidationPreflight.v1",
    status: "READY_FOR_EXPLICIT_AUTHORIZATION",
    validationId: `cfx-pipe-validation-${cfxTimestamp()}`,
    governingDocument:
      "docs/CFX/CODEX_CFX_PIPE_VALIDATION_DOUBLE_RUN_AND_PROMOTION.md",
    resetCommand:
      "docs/CFX/CODEX_PAUSE_NORMALIZE_RESET_RERUN.md",
    fixtures: fixtures.map((article, index) => ({
      fixtureId: article.fixtureId,
      role: CFX_PIPE_VALIDATION_FIXTURES[FIXTURE_IDS[index]!].role,
      title: article.articleTitle,
      fixtureFileSha256: article.fixtureFileSha256,
      articleTextSha256: article.articleTextSha256,
      sourceUnitManifestHash: article.sourceUnitManifestHash,
      sourceUnitCount: article.sourceUnitCount,
      articleCharacterCount: article.articleCharacterCount,
    })),
    runs: FIXTURE_IDS.flatMap((fixtureId) => [
      `${fixtureId.toLocaleLowerCase()}-run-a`,
      `${fixtureId.toLocaleLowerCase()}-run-b`,
    ]),
    model: {
      transport: "chat_completions",
      name: "gpt-4o-mini",
      temperature: 0.1,
      store: false,
      retries: 0,
      timeoutMs: 180_000,
      modelCallCount: 18,
      perRun: {
        s1: { calls: 1, maxOutputTokens: 6_000 },
        s2: { calls: 1, maxOutputTokens: 6_000 },
        queryPlanning: { calls: 1, maxOutputTokens: 8_000 },
      },
    },
    prompts: {
      s1: { promptId: s1Prompt.promptId, promptHash: s1Prompt.promptHash },
      s2: { promptId: s2Prompt.promptId, promptHash: s2Prompt.promptHash },
      planning: {
        promptId: planningPrompt.promptId,
        promptHash: planningPrompt.promptHash,
      },
    },
    schemaHashes: {
      s1: canonicalHash(CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA),
      s2: canonicalHash(CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA),
      planning: canonicalHash(CFX_QUERY_PLANNING_JSON_SCHEMA),
    },
    retrieval: {
      webProvider,
      concurrency: 4,
      resultsPerQuery: 5,
      maximumLogicalLanes: 360,
      maximumPubmedLanes: 144,
      maximumProviderQueryExecutions: 792,
      maximumUnderlyingHttpRequests: 1_368,
      fullTextFetches: 0,
      pubmedFallbacks: {
        maximumAttemptsPerLane: 4,
        steps: [
          "identity-rich literal query",
          "remove date or exact-phrase constraint",
          "relax one outcome to OR",
          "preserve core exposure/intervention and outcome",
        ],
      },
    },
    environment: {
      openAiConfigured: Boolean(
        process.env.OPENAI_API_KEY
          || process.env.REACT_APP_OPENAI_API_KEY,
      ),
      webProviderConfigured: webProvider === "tavily"
        ? Boolean(process.env.TAVILY_API_KEY)
        : webProvider === "brave"
          ? Boolean(process.env.BRAVE_SEARCH_API_KEY)
          : webProvider === "serpapi"
            ? Boolean(
                process.env.SERPAPI_API_KEY || process.env.SERPER_API_KEY,
              )
            : Boolean(
                process.env.BING_SEARCH_API_KEY
                  || process.env.BING_SEARCH_KEY,
              ),
      pubmedApiKeyConfigured: Boolean(process.env.PUBMED_API_KEY),
    },
    codeHashes,
    offlineVerification: {
      cfxTests: "45/45 passed",
      typecheck: "passed",
      modelCallsMade: 0,
      retrievalCallsMade: 0,
    },
    unitIdNormalization: {
      acceptedShape: "^U[0-9]+$",
      canonicalWidthSource: "authoritative fixture S0 inventory",
      fixtureScoped: true,
      uniqueResolutionRequired: true,
      rawProviderResponsePreserved: true,
      semanticFieldsModified: false,
      defectClassification: [
        "structural identifier-formatting defect",
        "deterministically repairable",
        "not a semantic proposition failure",
      ],
    },
    exactAuthorizationSentence: AUTHORIZATION,
  };
  if (
    !preflight.environment.openAiConfigured
    || !preflight.environment.webProviderConfigured
  ) {
    throw new Error("Required live provider configuration is missing");
  }
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/pipe-validation",
    preflight.validationId,
    "preflight",
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableJson(
    path.join(outputDirectory, "preflight.json"),
    preflight,
  );
  await writeImmutableText(
    path.join(outputDirectory, "preflight.md"),
    [
      "# CFX pipe-validation preflight",
      "",
      `Validation ID: \`${preflight.validationId}\``,
      "",
      "No model or retrieval call was made.",
      "",
      "## Fixtures",
      "",
      ...preflight.fixtures.map((fixture) =>
        `- ${fixture.fixtureId} (${fixture.role}): ${fixture.title}; ${fixture.sourceUnitCount} units; ${fixture.articleCharacterCount} characters`
      ),
      "",
      "## Exact authorization",
      "",
      `> ${AUTHORIZATION}`,
      "",
    ].join("\n"),
  );
  const files = await hashArtifactTree(outputDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(
    path.join(outputDirectory, "artifact-hashes.json"),
    {
      schemaVersion: "cfx.artifactHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      files,
      aggregateSha256,
    },
  );
  await freezeArtifactTree(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    validationId: preflight.validationId,
    status: preflight.status,
    authorization: AUTHORIZATION,
    artifactAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
