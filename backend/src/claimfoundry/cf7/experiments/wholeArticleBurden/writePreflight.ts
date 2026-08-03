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
  aggregateWholeArticleBurdenHash,
  sha256,
} from "./artifacts.js";
import { loadFrozenWholeArticleFixture } from "./loadFrozenFixture.js";
import {
  buildWholeArticleBurdenUserPrompt,
  WHOLE_ARTICLE_BURDEN_PROMPT,
} from "./prompt.js";
import {
  DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG,
} from "./runExperiment.js";
import {
  WHOLE_ARTICLE_BURDEN_JSON_SCHEMA,
} from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

async function main(): Promise<void> {
  const frozen = await loadFrozenWholeArticleFixture({ repositoryRoot });
  const request = {
    system: "",
    user: buildWholeArticleBurdenUserPrompt(frozen.article.text),
    responseSchema: WHOLE_ARTICLE_BURDEN_JSON_SCHEMA,
    model: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.model,
    temperature: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.temperature,
    retryCount: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.retryCount,
    store: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.store,
    maxOutputTokens: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.maxOutputTokens,
    timeoutMs: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG.timeoutMs,
  };
  const authorizationSentence =
    "Authorized: Send the complete byte-verified frozen CF1-F03 article text to OpenAI through exactly one Chat Completions API request for one governed CF7 whole-article burden-of-proof baseline using the verbatim simple prompt, gpt-4o-mini, temperature 0.1, concurrency 1, strict cf7_whole_article_burden_v1 structured output containing exactly 12 propositions with assertion, assertion source, and why-it-matters fields, a 6,000-token output limit, a 180,000 ms timeout, zero retries, and store false; do not expose grouping, sub-theses, selector outputs, source-unit metadata, or evaluator materials; preserve the raw response and do not make any additional model calls.";
  const preflight = {
    schemaVersion: "cf7.wholeArticleBurdenPreflight.v1",
    fixture: frozen.fixture,
    fixturePath: frozen.fixturePath,
    fixtureFileSha256: frozen.fixtureFileSha256,
    articleTextSha256: frozen.articleTextSha256,
    articleCharacterCount: frozen.articleCharacterCount,
    expectedProviderCallCount: 1,
    promptText: WHOLE_ARTICLE_BURDEN_PROMPT,
    promptHash: canonicalHash(WHOLE_ARTICLE_BURDEN_PROMPT),
    schemaName: WHOLE_ARTICLE_BURDEN_JSON_SCHEMA.name,
    schemaHash: canonicalHash(WHOLE_ARTICLE_BURDEN_JSON_SCHEMA),
    requestHash: canonicalHash(request),
    configuration: DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG,
    fullArticleVisible: true,
    groupingVisible: false,
    subThesisVisible: false,
    selectorOutputsVisible: false,
    sourceUnitMetadataVisible: false,
    evaluatorMaterialsVisible: false,
    modelCallsMade: 0,
    authorizationSentence,
  };
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/whole-article-burden/preflight",
    `cf7-whole-article-burden-preflight-${stamp()}`,
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
    path.join(outputDirectory, "source_article.json"),
    await readFile(frozen.fixturePath),
    { flag: "wx" },
  );
  const files = await Promise.all([
    "preflight_manifest.json",
    "source_article.json",
  ].map(async (name) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.wholeArticleBurdenPreflightHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      files,
      aggregateSha256: aggregateWholeArticleBurdenHash(files),
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  for (const name of [
    "preflight_manifest.json",
    "source_article.json",
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
