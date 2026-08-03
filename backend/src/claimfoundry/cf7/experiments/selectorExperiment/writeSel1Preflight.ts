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
import { loadFrozenSel1Input } from "./loadFrozenGde2Gb.js";
import {
  buildSel1UserPrompt,
  SEL1_SELECTOR_PROMPTS,
  SEL1_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  DEFAULT_SEL1_CONFIG,
  SEL1_SELECTOR_IDS,
} from "./runExperiment.js";
import { SEL1_JSON_SCHEMA } from "./schema.js";

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
  const frozen = await loadFrozenSel1Input({ repositoryRoot });
  const requestRows = SEL1_SELECTOR_IDS.flatMap((selectorId) =>
    frozen.groups.map((group) => {
      const user = buildSel1UserPrompt({ selectorId, group });
      const request = {
        system: SEL1_SYSTEM_PROMPT,
        user,
        responseSchema: SEL1_JSON_SCHEMA,
        model: DEFAULT_SEL1_CONFIG.model,
        temperature: DEFAULT_SEL1_CONFIG.temperature,
        retryCount: DEFAULT_SEL1_CONFIG.retryCount,
        store: DEFAULT_SEL1_CONFIG.store,
        maxOutputTokens: DEFAULT_SEL1_CONFIG.maxOutputTokens,
        timeoutMs: DEFAULT_SEL1_CONFIG.timeoutMs,
      };
      return {
        selectorId,
        groupId: group.groupId,
        groupIndex: group.groupIndex,
        assertionCount: group.assertions.length,
        subThesisVisible: selectorId === "B",
        userHash: canonicalHash(user),
        requestHash: canonicalHash(request),
      };
    }));
  const authorizationSentence =
    "Authorized: Send the 24 frozen CF1-F03 GDE-2 G-B semantic groups to OpenAI through exactly 48 Chat Completions API requests for one governed CF7 SEL-1 experiment, with 24 Selector A requests containing only each group ID and its assertion IDs/texts and 24 Selector B requests containing the identical group data plus its frozen synthesized G-B semantic sub-thesis, using gpt-4o-mini, temperature 0.1, concurrency 4, strict cf7_sel1_selector_v1 structured output, a 1,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve every raw response and do not make any additional model calls.";
  const preflight = {
    schemaVersion: "cf7.sel1Preflight.v1",
    experimentPackageVersion: "1.0",
    sourceRunId: frozen.sourceRunId,
    sourceArtifactAggregateSha256:
      frozen.sourceArtifactAggregateSha256,
    sourceGde2InventoryHash: frozen.sourceGde2InventoryHash,
    sourceGde2GroupFileSha256: frozen.sourceGde2GroupFileSha256,
    sourceInputHash: frozen.sourceInputHash,
    groupCount: frozen.groupCount,
    assertionAssignmentCount: frozen.assertionAssignmentCount,
    uniqueAssertionCount: frozen.uniqueAssertionCount,
    duplicateAssertionIds: frozen.duplicateAssertionIds,
    selectorCount: 2,
    expectedProviderCallCount: requestRows.length,
    systemPromptHash: canonicalHash(SEL1_SYSTEM_PROMPT),
    promptHashes: {
      A: canonicalHash(SEL1_SELECTOR_PROMPTS.A),
      B: canonicalHash(SEL1_SELECTOR_PROMPTS.B),
    },
    schemaName: SEL1_JSON_SCHEMA.name,
    schemaHash: canonicalHash(SEL1_JSON_SCHEMA),
    configuration: DEFAULT_SEL1_CONFIG,
    requestRows,
    selectorASeesSubThesis: false,
    selectorBSeesSubThesis: true,
    bothSelectorsSeeIdenticalGroupAssertions: true,
    onlyControlledDifferenceIsSubThesisGuidanceAndField: true,
    articleTextVisible: false,
    provenanceOutsideAssertionIdsVisible: false,
    sealedEvaluatorVisible: false,
    modelCallsMade: 0,
    authorizationSentence,
  };
  if (requestRows.length !== 48) {
    throw new Error(`SEL-1 preflight planned ${requestRows.length} requests`);
  }
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/selector-experiment/preflight",
    `cf7-sel1-preflight-${stamp()}`,
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
  const preflightText = `${JSON.stringify(preflight, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "preflight_manifest.json"),
    preflightText,
    { encoding: "utf8", flag: "wx" },
  );
  const frozenInputText = `${JSON.stringify(frozen, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "frozen_input.json"),
    frozenInputText,
    { encoding: "utf8", flag: "wx" },
  );
  const files = await Promise.all([
    "preflight_manifest.json",
    "frozen_input.json",
  ].map(async (name) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.sel1PreflightHashes.v1",
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
    "frozen_input.json",
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
