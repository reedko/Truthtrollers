import path from "node:path";
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
import { freezeCfxF03 } from "../input/f03.js";
import {
  loadCfxSubstantiveReviewPrompt,
} from "../prompts/governedPrompts.js";
import {
  CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA,
} from "../schemas/substantiveReviewSchema.js";
import {
  buildCfxSubstantiveReviewRequest,
  DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG,
} from "../substantiveReview/runSubstantiveReview.js";
import { loadVerifiedUnitAwareInventory } from "./loadUnitAwareInventory.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

const AUTHORIZATION =
  "Authorized: Send the 12 byte-verified fixed propositions from the frozen CFX unit-aware CF1-F03 inventory, their associated source-unit IDs, and the complete 398-unit labelled article to OpenAI through exactly one Chat Completions API request for one governed CFX S2 substantive-review experiment using the byte-verified substantive-review-v1 prompt, gpt-4o-mini, temperature 0.1, concurrency 1, strict cfx_substantive_review_v1 structured output containing exactly one substantiveAssertion, assertionSource, and articleStance result for every supplied propositionId, a 6,000-token output limit, a 180,000 ms timeout, zero retries, and store false; preserve the exact request, raw response, parsed response, usage, validation artifacts, and source inventory and do not make any additional model calls.";

async function main(): Promise<void> {
  const sourceRun = option("--unit-aware-run-dir");
  if (!sourceRun) throw new Error("--unit-aware-run-dir is required");
  const verified = await loadVerifiedUnitAwareInventory(path.resolve(sourceRun));
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxSubstantiveReviewPrompt();
  const request = buildCfxSubstantiveReviewRequest({
    article,
    inventory: verified.inventory,
    prompt,
  });
  const preflightId = `cfx-substantive-review-preflight-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/preflight",
    preflightId,
  );
  await createImmutableDirectory(outputDirectory);
  const manifest = {
    schemaVersion: "cfx.substantiveReviewPreflight.v1",
    preflightId,
    fixtureId: article.fixtureId,
    sourceUnitAwareRunDirectory: path.resolve(sourceRun),
    sourceInventoryHash: verified.inventoryHash,
    propositionCount: verified.inventory.propositions.length,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    schemaName: CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA.name,
    schemaHash: canonicalHash(CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA),
    requestHash: canonicalHash(request),
    configuration: DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG,
    expectedProviderCallCount: 1,
    completeArticleVisible: true,
    modelCallsMade: 0,
    authorizationSentence: AUTHORIZATION,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "preflight_manifest.json"),
    manifest,
  );
  await writeImmutableJson(path.join(outputDirectory, "request.json"), request);
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
