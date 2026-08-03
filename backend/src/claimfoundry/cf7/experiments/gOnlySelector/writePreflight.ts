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
import { buildFrozenComparisons } from "./comparison.js";
import { loadFrozenOriginalG } from "./loadFrozenOriginalG.js";
import {
  buildGOnlySelectorUserPrompt,
} from "./prompt.js";
import {
  DEFAULT_G_ONLY_SELECTOR_CONFIG,
  G_ONLY_PROMPT_HASH,
  G_ONLY_SCHEMA_HASH,
} from "./runExperiment.js";
import { G_ONLY_SELECTOR_JSON_SCHEMA } from "./schema.js";

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
  const frozen = await loadFrozenOriginalG({ repositoryRoot });
  const verificationSelections = frozen.groups.map((group) => ({
    groupId: group.groupId,
    assertionIds: [...group.assertionIds],
    selectedAssertionId: null,
    selectedAssertionText: null,
    structurallyValid: false,
  }));
  const comparisons = await buildFrozenComparisons({
    repositoryRoot,
    frozen,
    selections: verificationSelections,
  });
  const requests = frozen.groups.map((group) => {
    const request = {
      system: "",
      user: buildGOnlySelectorUserPrompt(group),
      responseSchema: G_ONLY_SELECTOR_JSON_SCHEMA,
      model: DEFAULT_G_ONLY_SELECTOR_CONFIG.model,
      temperature: DEFAULT_G_ONLY_SELECTOR_CONFIG.temperature,
      retryCount: DEFAULT_G_ONLY_SELECTOR_CONFIG.retryCount,
      store: DEFAULT_G_ONLY_SELECTOR_CONFIG.store,
      maxOutputTokens: DEFAULT_G_ONLY_SELECTOR_CONFIG.maxOutputTokens,
      timeoutMs: DEFAULT_G_ONLY_SELECTOR_CONFIG.timeoutMs,
    };
    return {
      groupId: group.groupId,
      groupIndex: group.groupIndex,
      assertionCount: group.assertionIds.length,
      assertionIds: group.assertionIds,
      requestHash: canonicalHash(request),
    };
  });
  const authorizationSentence =
    "Authorized: Send each of the 21 byte-verified original CF1-F03 Prompt G semantic groups to OpenAI through exactly 21 independent Chat Completions API requests for one governed CF7 G-Only Selector A experiment, with each request containing only its frozen group ID and exact assertion IDs/texts, using the verbatim governed selector prompt, gpt-4o-mini, temperature 0.1, concurrency 4, strict cf7_g_only_selector_a_v1 structured output, a 1,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; do not expose article text, sub-theses, prior selector outputs, atomicity instructions, or evaluator materials; preserve every raw response and do not make any additional model calls.";
  const preflight = {
    schemaVersion: "cf7.gOnlySelectorPreflight.v1",
    sourceGroupingRun: frozen.sourceGroupingRun,
    sourceGroupPath: frozen.sourceGroupPath,
    sourceGroupSha256: frozen.sourceGroupSha256,
    sourceInventoryPath: frozen.sourceInventoryPath,
    sourceInventorySha256: frozen.sourceInventorySha256,
    sourceArtifactAggregateSha256:
      frozen.sourceArtifactAggregateSha256,
    groupMembershipHash: frozen.groupMembershipHash,
    groupCount: frozen.groupCount,
    assignedAssertionCount: frozen.assignedAssertionCount,
    duplicateAssertionIds: frozen.duplicateAssertionIds,
    missingAssertionIds: frozen.missingAssertionIds,
    missingAssertionsRepaired: false,
    expectedProviderCallCount: requests.length,
    promptHash: G_ONLY_PROMPT_HASH,
    schemaHash: G_ONLY_SCHEMA_HASH,
    configuration: DEFAULT_G_ONLY_SELECTOR_CONFIG,
    requests,
    comparisonSourceHashes: comparisons.sourceHashes,
    articleTextVisible: false,
    subThesisVisible: false,
    priorSelectorOutputsVisible: false,
    atomicityInstructionsVisible: false,
    evaluatorMaterialsVisible: false,
    modelCallsMade: 0,
    authorizationSentence,
  };
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/g-only-selector/preflight",
    `cf7-g-only-selector-preflight-${stamp()}`,
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
  const preflightText = `${JSON.stringify(preflight, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "preflight_manifest.json"),
    preflightText,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "source_g_groups.json"),
    await readFile(frozen.sourceGroupPath),
    { flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "source_assertion_inventory.json"),
    await readFile(frozen.sourceInventoryPath),
    { flag: "wx" },
  );
  const files = await Promise.all([
    "preflight_manifest.json",
    "source_g_groups.json",
    "source_assertion_inventory.json",
  ].map(async (name) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.gOnlySelectorPreflightHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      files,
      aggregateSha256: sha256(JSON.stringify(files)),
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  for (const name of [
    "preflight_manifest.json",
    "source_g_groups.json",
    "source_assertion_inventory.json",
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
