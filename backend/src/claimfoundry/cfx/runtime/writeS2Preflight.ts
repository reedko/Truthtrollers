import path from "node:path";
import {
  CFX_GROUNDING_JSON_SCHEMA,
} from "../schemas/groundingSchema.js";
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
import { buildCfxGroundingRequest } from "../grounding/buildGroundingRequest.js";
import {
  DEFAULT_CFX_GROUNDING_CONFIG,
} from "../grounding/runGrounding.js";
import { freezeCfxF03 } from "../input/f03.js";
import { loadCfxExactGroundingPrompt } from "../prompts/governedPrompts.js";
import { loadVerifiedCfxS1Inventory } from "./loadS1Inventory.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

const AUTHORIZATION =
  "Authorized: Send the 12 byte-verified immutable CFX S1 propositions and the complete unit-ID-labelled frozen CF1-F03 article to OpenAI through exactly 13 Chat Completions API requests for one governed CFX S2 exact-grounding comparison, comprising one whole-article request for Arm A and 12 independent per-proposition requests for Arm B, using the byte-verified exact-grounding-v1 prompt, gpt-4o-mini, temperature 0.1, Arm B concurrency 4, strict cfx_exact_grounding_v1 structured output, a 6,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve every exact request, raw response, parsed response, usage record, accepted row, rejected row, and validation diagnostic and do not make any additional model calls.";

async function main(): Promise<void> {
  const s1RunDirectory = option("--s1-run-dir");
  if (!s1RunDirectory) {
    throw new Error("--s1-run-dir is required");
  }
  const verified = await loadVerifiedCfxS1Inventory(
    path.resolve(s1RunDirectory),
  );
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxExactGroundingPrompt();
  const config = { ...DEFAULT_CFX_GROUNDING_CONFIG };
  const wholeRequest = buildCfxGroundingRequest({
    article,
    propositions: verified.inventory.propositions,
    prompt,
    config,
  });
  const perRequests = verified.inventory.propositions.map((proposition) =>
    buildCfxGroundingRequest({
      article,
      propositions: [proposition],
      prompt,
      config,
    }));
  const preflightId = `cfx-s2-preflight-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/preflight",
    preflightId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableJson(
    path.join(outputDirectory, "requests/whole-article/request-001.json"),
    wholeRequest,
  );
  for (let index = 0; index < perRequests.length; index += 1) {
    const propositionId =
      verified.inventory.propositions[index]!.propositionId;
    await writeImmutableJson(
      path.join(
        outputDirectory,
        "requests/per-proposition",
        propositionId,
        "request-001.json",
      ),
      perRequests[index],
    );
  }
  const manifest = {
    schemaVersion: "cfx.s2Preflight.v1",
    preflightId,
    fixtureId: article.fixtureId,
    sourceS1RunDirectory: path.resolve(s1RunDirectory),
    canonicalInventoryHash: verified.inventoryHash,
    canonicalPropositionCount: verified.inventory.propositions.length,
    articleTextSha256: article.articleTextSha256,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    schemaName: CFX_GROUNDING_JSON_SCHEMA.name,
    schemaHash: canonicalHash(CFX_GROUNDING_JSON_SCHEMA),
    configuration: config,
    expectedProviderCallCount: 13,
    armARequestCount: 1,
    armBRequestCount: 12,
    requestHashes: {
      wholeArticle: canonicalHash(wholeRequest),
      perProposition: perRequests.map((request, index) => ({
        propositionId:
          verified.inventory.propositions[index]!.propositionId,
        requestHash: canonicalHash(request),
      })),
    },
    retrievalPrefilterUsed: false,
    chunkingUsed: false,
    semanticSearchUsed: false,
    modelCallsMade: 0,
    authorizationSentence: AUTHORIZATION,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "preflight_manifest.json"),
    manifest,
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
