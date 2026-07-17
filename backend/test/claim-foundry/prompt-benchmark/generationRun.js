// Generation executor for the CF1 prompt benchmark (coder plan §10.2/§10.5).
// Modes: call1 (single model call), call2 (frozen-packet replay), full (normal
// two-call CF1 with injected builders, allowRepair:false). Writes immutable
// per-run artifacts and returns manifest entries; never reads evaluation keys.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { validateArticleInput } from "../../../src/claim-foundry/validateArticleInput.js";
import { articleDocumentFromText, buildArticleSourceBlocks }
  from "../../../src/claim-foundry/article-document/index.js";
import { runClaimFoundry } from "../../../src/claim-foundry/runClaimFoundry.js";
import { verifySemanticInventory, verifySelectedEnrichment }
  from "../../../src/claim-foundry/twoCallAgentVerification.js";
import { writeCf1Artifacts } from "../../../src/claim-foundry/artifacts.js";
import { getPairProfile, profilePromptBuilders, promptFingerprints } from "./promptSets/index.js";
import { readGenerationFile, sha256 } from "./benchmarkConfig.js";

function runError(message) {
  return Object.assign(new Error(message), { code: "CF1_BENCHMARK_RUN_INVALID" });
}

export function prepareArticle(rawArticle, blockOptions) {
  const article = validateArticleInput(rawArticle);
  const articleDocument = articleDocumentFromText({ text: article.text,
    metadata: { title: article.title, language: article.language } });
  const prepared = { ...article, text: articleDocument.canonicalText,
    contentHash: articleDocument.contentHash };
  const structuralBlocks = buildArticleSourceBlocks(articleDocument, blockOptions);
  return { article: prepared, articleDocument, structuralBlocks };
}

function runDirectory({ benchmarkDir, phase, subject, profileId, repeat }) {
  const dir = path.join(benchmarkDir, "raw", phase, subject, profileId, String(repeat));
  if (existsSync(dir)) throw runError(`Run directory already exists (immutable): ${dir}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRunFiles(dir, files) {
  const hashes = [];
  for (const [name, value] of Object.entries(files)) {
    if (value === undefined) continue;
    const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    writeFileSync(path.join(dir, name), body);
    hashes.push(`${sha256(body)}  ${name}`);
  }
  writeFileSync(path.join(dir, "files.sha256"), `${hashes.join("\n")}\n`);
}

function provenance({ config, phase, mode, subjectKey, subjectHash, profile, repeat, seed,
  fingerprints, startedAt, finishedAt, usage, attempts, status, error }) {
  return { benchmarkId: config.benchmarkId, phase, mode, [mode === "call2" ? "packetId" : "fixtureId"]: subjectKey,
    repeat, seed, pairProfileId: profile.id,
    call1: { version: profile.call1.version, schemaName: profile.call1.schemaName },
    call2: { version: profile.call2.version, schemaName: profile.call2.schemaName },
    fingerprints, model: config.model, temperature: config.temperature ?? 0,
    timeoutMs: config.timeoutMs, budgetLimits: config.budgetLimits, allowRepair: false,
    subjectSha256: subjectHash, startedAt, finishedAt,
    elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt),
    usage: usage ?? null, transportAttempts: attempts ?? null, status,
    ...(error ? { error: { code: error.code ?? null, message: String(error.message).slice(0, 500) } } : {}) };
}

export async function runCall1Generation({ config, benchmarkDir, phase, profileId, fixture,
  repeat, seed, modelRunner, clock = () => new Date() }) {
  const profile = getPairProfile(profileId);
  const dir = runDirectory({ benchmarkDir, phase, subject: fixture.fixtureId, profileId, repeat });
  const { article, articleDocument, structuralBlocks } = prepareArticle(fixture.article, config.blockOptions);
  const prompt = profile.call1.build({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits });
  const fingerprints = { call1: promptFingerprints(prompt) };
  const startedAt = clock().toISOString();
  let status = "completed"; let error; let response; let verified;
  try {
    response = await modelRunner.invokeStructured({ ...prompt, model: config.model,
      temperature: config.temperature ?? 0, timeoutMs: config.timeoutMs, maximumAttempts: 1,
      maxOutputTokens: config.budgetLimits.maxOutputTokensPerCall,
      usageContext: { component: "claim_foundry", path: "benchmark", stage: "semantic_inventory" } });
    const adapted = profile.call1.adaptOutput
      ? profile.call1.adaptOutput(response.output) : structuredClone(response.output);
    verified = verifySemanticInventory(adapted,
      { sourceUnits: articleDocument.sourceUnits, article,
        minimumCandidates: article.text.length >= 5_000 ? 8 : 1 });
  } catch (caught) { status = "failed"; error = caught; }
  const finishedAt = clock().toISOString();
  const entry = provenance({ config, phase, mode: "call1", subjectKey: fixture.fixtureId,
    subjectHash: article.contentHash, profile, repeat, seed, fingerprints, startedAt,
    finishedAt, usage: response?.usage, attempts: response?.attempts, status, error });
  writeRunFiles(dir, {
    "request-provenance.json": entry,
    "prompt-fingerprints.json": fingerprints,
    "semantic-inventory.model-raw.json": response?.output,
    "semantic-inventory.verified-pre-host.json": verified,
    "usage.json": response?.usage,
  });
  return { entry, dir, status };
}

export async function runFullGeneration({ config, benchmarkDir, phase, profileId, fixture,
  repeat, seed, modelRunner, clock = () => new Date() }) {
  const profile = getPairProfile(profileId);
  const dir = runDirectory({ benchmarkDir, phase, subject: fixture.fixtureId, profileId, repeat });
  const startedAt = clock().toISOString();
  const result = await runClaimFoundry({ article: fixture.article,
    options: { model: config.model, temperature: config.temperature ?? 0,
      seed: Number.parseInt(createHash("sha256").update(`${seed}:${profileId}:${fixture.fixtureId}`).digest("hex").slice(0, 8), 16),
      timeoutMs: config.timeoutMs, budgetLimits: config.budgetLimits,
      modelContextTokens: config.modelContextTokens ?? 128_000,
      blockOptions: config.blockOptions, allowRepair: false, artifactRoot: dir },
    dependencies: { modelRunner, promptBuilders: profilePromptBuilders(profileId),
      artifactWriter: writeCf1Artifacts } });
  const finishedAt = clock().toISOString();
  if ((result.run.usage?.repairCalls ?? 0) > 0) {
    throw runError("Configuration error: a benchmark run attempted repair");
  }
  const status = result.run.status === "ready_for_evidence" ? "completed" : result.run.status;
  const entry = provenance({ config, phase, mode: "full", subjectKey: fixture.fixtureId,
    subjectHash: result.articleContentHash ?? null, profile, repeat, seed,
    fingerprints: result.agentState?.promptFingerprints ?? null,
    startedAt, finishedAt, usage: result.run.usage, attempts: null,
    status, error: result.run.error ?? undefined });
  writeRunFiles(dir, {
    "request-provenance.json": entry,
    "claim-package.json": result.claimPackage ?? undefined,
    "verification.json": result.verification ?? undefined,
    "usage.json": result.run.usage ?? undefined,
  });
  return { entry, dir, status, result };
}

export function loadCall2Packet({ benchmarkDir, packetId }) {
  const manifestRaw = readGenerationFile(path.join(benchmarkDir, "inputs", "call2-corpus-manifest.json"));
  const manifest = JSON.parse(manifestRaw);
  const meta = manifest.packets.find((item) => item.packetId === packetId);
  if (!meta) throw runError(`Unknown Call 2 packet: ${packetId}`);
  const raw = readGenerationFile(path.join(benchmarkDir, "inputs", "call2-corpus", `${packetId}.json`));
  if (sha256(raw) !== meta.packetSha256) throw runError(`Packet ${packetId} no longer matches its frozen hash`);
  return { packet: JSON.parse(raw), packetSha256: meta.packetSha256 };
}

export async function runCall2Generation({ config, benchmarkDir, phase, profileId, packetId,
  repeat, seed, modelRunner, clock = () => new Date() }) {
  const profile = getPairProfile(profileId);
  const dir = runDirectory({ benchmarkDir, phase, subject: packetId, profileId, repeat });
  const { packet, packetSha256 } = loadCall2Packet({ benchmarkDir, packetId });
  const context = packet.builderContext;
  const prompt = profile.call2.build(context);
  const fingerprints = { call2: promptFingerprints(prompt) };
  const startedAt = clock().toISOString();
  let status = "completed"; let error; let response; let verified;
  try {
    response = await modelRunner.invokeStructured({ ...prompt, model: config.model,
      temperature: config.temperature ?? 0, timeoutMs: config.timeoutMs, maximumAttempts: 1,
      maxOutputTokens: config.budgetLimits.maxOutputTokensPerCall,
      usageContext: { component: "claim_foundry", path: "benchmark", stage: "selected_claim_enrichment" } });
    const expected = packet.verification.expectedCandidateIds;
    const returned = (response.output?.enrichedClaims ?? []).map((item) => item.candidateId);
    if (returned.length !== expected.length || expected.some((id) => !returned.includes(id))) {
      throw runError("Call 2 output does not cover the expected candidate IDs exactly once");
    }
    verified = verifySelectedEnrichment(structuredClone(response.output), {
      selectedClaims: context.selectedClaims, inventory: packet.verification.inventory,
      sourceUnits: packet.verification.fullSourceUnits, criticReport: context.criticReport,
      article: packet.verification.article });
  } catch (caught) { status = "failed"; error = caught; }
  const finishedAt = clock().toISOString();
  const entry = provenance({ config, phase, mode: "call2", subjectKey: packetId,
    subjectHash: packetSha256, profile, repeat, seed, fingerprints, startedAt, finishedAt,
    usage: response?.usage, attempts: response?.attempts, status, error });
  writeRunFiles(dir, {
    "request-provenance.json": entry,
    "prompt-fingerprints.json": fingerprints,
    "selected-enrichment.model-raw.json": response?.output,
    "selected-enrichment.verified.json": verified ? { selectedClaims: verified.selectedClaims } : undefined,
    "usage.json": response?.usage,
  });
  return { entry, dir, status };
}

// One immutable manifest per generation invocation (a phase can only gain a
// second manifest under an explicitly different phase name, e.g. "-pass2").
export function finalizeManifest({ benchmarkDir, manifest, phase }) {
  const name = `manifest-${phase}.json`;
  const manifestPath = path.join(benchmarkDir, name);
  if (existsSync(manifestPath)) throw runError(`${name} already exists (immutable)`);
  const body = JSON.stringify(manifest, null, 2);
  writeFileSync(manifestPath, body);
  writeFileSync(`${manifestPath.replace(/\.json$/, "")}.sha256`, `${sha256(body)}\n`);
  return { manifestPath, manifestSha256: sha256(body) };
}
