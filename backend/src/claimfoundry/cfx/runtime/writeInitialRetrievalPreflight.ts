import path from "node:path";
import dotenv from "dotenv";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  writeImmutableJson,
} from "../artifacts/immutableArtifacts.js";
import {
  loadVerifiedCfxEvidenceInputs,
} from "../retrieval/loadEvidenceInputs.js";
import {
  buildCfxQueryPlanningRequest,
  DEFAULT_CFX_QUERY_PLANNING_CONFIG,
  deterministicQuerySlots,
  loadCfxQueryPlanningPrompt,
} from "../retrieval/queryPlanning.js";
import {
  CFX_QUERY_PLANNING_JSON_SCHEMA,
} from "../retrieval/schema.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

const AUTHORIZATION =
  "Authorized: Send the 12 byte-verified immutable CFX evidence inputs, including their substantive assertions, assertion sources, article stances, literal identifiers, lookup hints, and bounded grounding-unit text, to OpenAI through exactly one Chat Completions API request for one governed CFX initial query-planning run using the byte-verified cfx-initial-query-planning-v2 prompt, gpt-4o-mini, temperature 0.1, strict cfx_initial_query_planning_v2 structured output, an 8,000-token output limit, a 180,000 ms timeout, zero retries, and store false; if and only if the plan validates, execute each non-missing query exactly once against its planned Tavily or PubMed provider, with five results requested per query, no more than 56 logical retrieval-query executions, no more than 24 PubMed query executions, and no more than 80 retrieval-provider HTTP requests because each PubMed execution uses eSearch and may conditionally use eSummary; preserve every request, raw provider response, normalized candidate, failure, accounting record, query-intent provenance, and dedupe path; treat query intent only as retrieval purpose and never as evidence stance; do not fetch full text and do not make any additional model or retrieval calls.";

async function main(): Promise<void> {
  const sourceRun = option("--evidence-handoff-run-dir");
  if (!sourceRun) {
    throw new Error("--evidence-handoff-run-dir is required");
  }
  const verified = await loadVerifiedCfxEvidenceInputs(sourceRun);
  const prompt = await loadCfxQueryPlanningPrompt();
  const request = buildCfxQueryPlanningRequest({
    inputs: verified.inputs,
    prompt,
  });
  const slots = deterministicQuerySlots(verified.inputs);
  const q3Count = slots.filter((slot) => slot.q3.query).length;
  const maximumRetrievalRequestCount =
    verified.inputs.length * 4 + q3Count;
  const maximumPubmedQueryCount = verified.inputs.length * 2;
  const maximumRetrievalProviderHttpRequestCount =
    maximumRetrievalRequestCount + maximumPubmedQueryCount;
  const webProvider = (
    process.env.CFX_RETRIEVAL_WEB_PROVIDER
      ?? process.env.SEARCH_PROVIDER
      ?? "tavily"
  ).toLocaleLowerCase();
  const preflightId = `cfx-initial-retrieval-preflight-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/preflight",
    preflightId,
  );
  await createImmutableDirectory(outputDirectory);
  const manifest = {
    schemaVersion: "cfx.initialRetrievalPreflight.v1",
    preflightId,
    sourceEvidenceHandoffRunDirectory: path.resolve(sourceRun),
    sourceEvidenceInputHash: verified.inputHash,
    sourceArtifactAggregateSha256: verified.artifactAggregateSha256,
    propositionCount: verified.inputs.length,
    deterministicQ1Count: slots.filter((slot) => slot.q1.query).length,
    deterministicQ3Count: q3Count,
    modelPlannedQueryCount: verified.inputs.length * 3,
    maximumRetrievalRequestCount,
    maximumPubmedQueryCount,
    maximumRetrievalProviderHttpRequestCount,
    maximumRawCandidateSlots: maximumRetrievalRequestCount * 5,
    modelCallsMade: 0,
    retrievalCallsMade: 0,
    webProvider,
    planningPromptId: prompt.promptId,
    planningPromptHash: prompt.promptHash,
    planningSchemaName: CFX_QUERY_PLANNING_JSON_SCHEMA.name,
    planningSchemaHash: canonicalHash(CFX_QUERY_PLANNING_JSON_SCHEMA),
    planningRequestHash: canonicalHash(request),
    planningConfiguration: DEFAULT_CFX_QUERY_PLANNING_CONFIG,
    fullTextFetchAuthorized: false,
    bearingOrStanceAdjudicationAuthorized: false,
    authorizationSentence: AUTHORIZATION,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "preflight_manifest.json"),
    manifest,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "planning_request.json"),
    request,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "deterministic_query_slots.json"),
    slots,
  );
  const files = await hashArtifactTree(outputDirectory);
  await writeImmutableJson(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cfx.artifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    files,
    aggregateSha256: aggregateArtifactHash(files),
  });
  await freezeArtifactTree(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
