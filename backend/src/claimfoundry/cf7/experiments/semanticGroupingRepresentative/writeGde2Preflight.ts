import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { SEMANTIC_GROUPING_COMMON_RULES } from "../semanticGrouping/prompts.js";
import {
  loadFrozenSemanticGroupingAssertions,
} from "../semanticGrouping/loadFrozenAssertions.js";
import {
  buildGde2Instruction,
  buildGde2UserPrompt,
  GDE2_REPRESENTATIVE_ADDITIONS,
  getGde2OriginalPrompt,
} from "./prompts.js";
import {
  DEFAULT_GDE2_CONFIG,
  GDE2_EXPERIMENTS,
} from "./runExperiment.js";
import { GDE2_JSON_SCHEMAS } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function main(): Promise<void> {
  const frozen = await loadFrozenSemanticGroupingAssertions({ repositoryRoot });
  const rows = GDE2_EXPERIMENTS.map((experiment) => {
    const originalPromptText = getGde2OriginalPrompt(experiment.promptId);
    const representativeAddition =
      GDE2_REPRESENTATIVE_ADDITIONS[experiment.variantId];
    const combinedInstruction = buildGde2Instruction(experiment);
    const user = buildGde2UserPrompt({
      ...experiment,
      assertions: frozen.assertions,
    });
    const responseSchema = GDE2_JSON_SCHEMAS[experiment.variantId];
    const request = {
      system: SEMANTIC_GROUPING_COMMON_RULES,
      user,
      responseSchema,
      model: DEFAULT_GDE2_CONFIG.model,
      temperature: DEFAULT_GDE2_CONFIG.temperature,
      retryCount: DEFAULT_GDE2_CONFIG.retryCount,
      store: DEFAULT_GDE2_CONFIG.store,
      maxOutputTokens: DEFAULT_GDE2_CONFIG.maxOutputTokens,
      timeoutMs: DEFAULT_GDE2_CONFIG.timeoutMs,
    };
    return {
      ...experiment,
      originalPromptHash: canonicalHash(originalPromptText),
      representativeAdditionHash: canonicalHash(representativeAddition),
      combinedPromptHash: canonicalHash(combinedInstruction),
      userHash: canonicalHash(user),
      schemaName: responseSchema.name,
      schemaHash: canonicalHash(responseSchema),
      requestHash: canonicalHash(request),
    };
  });
  const authorizationSentence =
    "Authorized: Send the identical frozen CF1-F03 inventory of 267 assertion IDs and assertion texts, with no other article content or provenance, to OpenAI through exactly nine Chat Completions API requests for the governed CF7 GDE-2 Semantic Group Representative Assertion Experiment matrix G-A, G-B, G-C, D-A, D-B, D-C, E-A, E-B, and E-C using the byte-stable original G, D, and E grouping prompts plus only the authorized verbatim representative-assertion additions, gpt-4o-mini, temperature 0.1, concurrency 4, the governed strict GDE-2 variant schemas, a 6,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve every raw response and do not make any additional model calls.";
  const preflight = {
    schemaVersion: "cf7.gde2Preflight.v1",
    experimentPackageVersion: "1.0",
    parentRunId: frozen.parentRunId,
    baselineSemanticGroupingRunId:
      "cf7-semantic-grouping-cf1-f03-20260729005359",
    frozenInventorySha256: frozen.frozenInventorySha256,
    assertionInventoryHash: frozen.assertionInventoryHash,
    assertionCount: frozen.assertions.length,
    experimentCount: rows.length,
    expectedProviderCallCount: 9,
    commonRulesHash: canonicalHash(SEMANTIC_GROUPING_COMMON_RULES),
    configuration: DEFAULT_GDE2_CONFIG,
    experimentRequests: rows,
    identicalAssertionOrdering: true,
    originalGroupingPromptsUnchanged: true,
    onlyPerVariantPromptChangeIsAuthorizedAddition: true,
    modelVisibleInventoryKeys: ["assertionId", "assertionText"],
    articleTextOutsideAssertionsVisible: false,
    provenanceOutsideAssertionIdsVisible: false,
    sealedEvaluatorVisible: false,
    modelCallsMade: 0,
    authorizationSentence,
  };
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping-representative/preflight",
    `cf7-gde2-preflight-${stamp()}`,
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
  const preflightText = `${JSON.stringify(preflight, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "preflight_manifest.json"),
    preflightText,
    { encoding: "utf8", flag: "wx" },
  );
  const inventoryText = `${JSON.stringify(frozen.assertions, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "assertion_inventory.json"),
    inventoryText,
    { encoding: "utf8", flag: "wx" },
  );
  const files = await Promise.all([
    "preflight_manifest.json",
    "assertion_inventory.json",
  ].map(async (name) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.gde2PreflightHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      fileCount: files.length,
      files,
      aggregateSha256: sha256(JSON.stringify(files)),
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  for (const name of [
    "preflight_manifest.json",
    "assertion_inventory.json",
    "artifact_hashes.json",
  ]) {
    await chmod(path.join(outputDirectory, name), 0o444);
  }
  await chmod(outputDirectory, 0o555);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...preflight,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
