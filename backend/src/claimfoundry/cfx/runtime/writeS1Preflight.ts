import path from "node:path";
import {
  CFX_DISCOVERY_JSON_SCHEMA,
} from "../schemas/discoverySchema.js";
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
import { buildCfxDiscoveryRequest } from "../discovery/runDiscovery.js";
import {
  DEFAULT_CFX_DISCOVERY_CONFIG,
} from "../discovery/runDiscovery.js";
import { freezeCfxF03 } from "../input/f03.js";
import { loadCfxDiscoveryPrompt } from "../prompts/governedPrompts.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
} from "./paths.js";

const AUTHORIZATION =
  "Authorized: Send the complete byte-verified frozen CF1-F03 article text to OpenAI through exactly one Chat Completions API request for one governed CFX S1 meaning-discovery run using the byte-verified burden-of-proof-v1 prompt, gpt-4o-mini, temperature 0.1, concurrency 1, strict cfx_burden_of_proof_v1 structured output containing exactly 12 propositions, a 6,000-token output limit, a 180,000 ms timeout, zero retries, and store false; preserve the exact request, raw response, usage, and validation artifacts and do not make any additional model calls.";

async function main(): Promise<void> {
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxDiscoveryPrompt();
  const request = buildCfxDiscoveryRequest({
    article,
    prompt,
    config: { ...DEFAULT_CFX_DISCOVERY_CONFIG },
  });
  const preflightId = `cfx-s1-preflight-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/preflight",
    preflightId,
  );
  await createImmutableDirectory(outputDirectory);
  const manifest = {
    schemaVersion: "cfx.s1Preflight.v1",
    preflightId,
    fixtureId: article.fixtureId,
    fixtureFileSha256: article.fixtureFileSha256,
    articleTextSha256: article.articleTextSha256,
    normalizedArticleHash: article.normalizedArticleHash,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    schemaName: CFX_DISCOVERY_JSON_SCHEMA.name,
    schemaHash: canonicalHash(CFX_DISCOVERY_JSON_SCHEMA),
    requestHash: canonicalHash(request),
    configuration: DEFAULT_CFX_DISCOVERY_CONFIG,
    expectedProviderCallCount: 1,
    modelCallsMade: 0,
    wholeArticleVisible: true,
    oldRuntimeInputsVisible: false,
    authorizationSentence: AUTHORIZATION,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "preflight_manifest.json"),
    manifest,
  );
  await writeImmutableJson(path.join(outputDirectory, "request.json"), request);
  await writeImmutableJson(
    path.join(outputDirectory, "source_units.json"),
    article.sourceUnits,
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
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
