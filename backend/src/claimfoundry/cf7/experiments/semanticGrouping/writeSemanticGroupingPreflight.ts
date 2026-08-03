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
import {
  loadFrozenSemanticGroupingAssertions,
} from "./loadFrozenAssertions.js";
import {
  buildSemanticGroupingUserPrompt,
  SEMANTIC_GROUPING_COMMON_RULES,
  SEMANTIC_GROUPING_PROMPTS,
} from "./prompts.js";
import {
  DEFAULT_SEMANTIC_GROUPING_CONFIG,
  SEMANTIC_GROUPING_PROMPT_IDS,
} from "./runExperiment.js";
import { SEMANTIC_GROUPING_JSON_SCHEMA } from "./schema.js";

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
  const rows = SEMANTIC_GROUPING_PROMPT_IDS.map((promptId) => {
    const promptText = SEMANTIC_GROUPING_PROMPTS[promptId];
    const user = buildSemanticGroupingUserPrompt({
      promptId,
      assertions: frozen.assertions,
    });
    const request = {
      system: SEMANTIC_GROUPING_COMMON_RULES,
      user,
      responseSchema: SEMANTIC_GROUPING_JSON_SCHEMA,
      ...DEFAULT_SEMANTIC_GROUPING_CONFIG,
    };
    return {
      promptId,
      promptText,
      promptHash: canonicalHash(promptText),
      userHash: canonicalHash(user),
      requestHash: canonicalHash(request),
    };
  });
  const authorizationSentence =
    "Authorized: Send the identical frozen CF1-F03 inventory of 267 assertion IDs and assertion texts, with no other article content or provenance, to OpenAI through exactly seven Chat Completions API requests for the governed CF7 Semantic Grouping Experiment prompts A through G using gpt-4o-mini, temperature 0.1, concurrency 4, strict cf7_semantic_grouping_v1 structured output, a 6,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve every raw response and do not make any additional model calls.";
  const preflight = {
    schemaVersion: "cf7.semanticGroupingPreflight.v1",
    experimentPackageVersion: "0.1",
    parentRunId: frozen.parentRunId,
    frozenInventorySha256: frozen.frozenInventorySha256,
    assertionInventoryHash: frozen.assertionInventoryHash,
    assertionCount: frozen.assertions.length,
    promptCount: rows.length,
    expectedProviderCallCount: 7,
    commonRulesHash: canonicalHash(SEMANTIC_GROUPING_COMMON_RULES),
    schemaHash: canonicalHash(SEMANTIC_GROUPING_JSON_SCHEMA),
    configuration: DEFAULT_SEMANTIC_GROUPING_CONFIG,
    promptRequests: rows,
    identicalAssertionOrdering: true,
    modelVisibleInventoryKeys: ["assertionId", "assertionText"],
    articleTextOutsideAssertionsVisible: false,
    sealedEvaluatorVisible: false,
    modelCallsMade: 0,
    authorizationSentence,
  };
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping/preflight",
    `cf7-semantic-grouping-preflight-${stamp()}`,
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
      schemaVersion: "cf7.semanticGroupingPreflightHashes.v1",
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
