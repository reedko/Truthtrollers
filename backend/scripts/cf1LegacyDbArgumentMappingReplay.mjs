#!/usr/bin/env node
// Read-only replay of the argument-mapping stage from commit 4714383a.
// Reads a saved legacy extraction, loads active DB prompts, calls the model
// once for the complete claim batch, and writes local artifacts only.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");
const { query, pool } = await import("../src/db/pool.js");
const { openAiLLM } = await import("../src/core/openAiLLM.js");
const { createOpenAiResponsesCf1Transport } = await import(
  "../src/claim-foundry/openAiResponsesTransport.js");
const { default: PromptManager } = await import("../src/core/promptManager.js");
const { prepareArticle } = await import(
  "../test/claim-foundry/prompt-benchmark/generationRun.js");
const {
  buildMappingClaimPacket,
  deriveHostScoreTransform,
} = await import(
  "../test/claim-foundry/prompt-benchmark/legacyDbMappingDeterministic.js");
const {
  assertionMappingSchema,
  restoreMappingClaimKeys,
  toAssertionLanguage,
  toAssertionPacketKeys,
} = await import(
  "../test/claim-foundry/prompt-benchmark/legacyAssertionLanguage.js");

const FALLBACK_SYSTEM = `You map extracted case claims to their function inside the article's argument.

Return strict JSON only. Do not include markdown or commentary.

Decide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.

This is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.

For attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.

scoreTransform controls how evidence about the object claim should affect the article:
- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.
- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.
- none: the claim should not directly affect the article score.
- review: unclear; human review needed before scoring.

Use invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.
Use none for attribution-only, neutral reporting, or background that does not carry the argument.`;

const FALLBACK_USER = `Analyze this article excerpt and extracted claims.

ARTICLE EXCERPT:
{{articleExcerpt}}

EXTRACTED THESIS:
{{articleThesis}}

CLAIMS:
{{claimsJson}}

Return JSON with exactly this structure:
{
  "articleThesis": "",
  "claims": [
    {
      "claimId": 0,
      "objectClaim": "",
      "isAttribution": false,
      "speakerEntity": "",
      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",
      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
      "scoreTransform": "normal|invert|none|review",
      "accountabilityEligible": false,
      "confidence": 0,
      "rationale": ""
    }
  ]
}

Rules:
- Include one output item for every input claim.
- objectClaim is the factual assertion evidence search should evaluate.
- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.
- If the article uses Y as an example of what is wrong or false, use argumentFunction opposing_claim_to_refute and scoreTransform invert.
- If the article uses Y to support its own thesis, use normal.
- If the article merely says who said something and the object claim does not carry the article argument, use none.
- Keep rationales short.`;

const ALLOWED_STANCES = new Set(["endorses", "rejects", "neutral", "unclear"]);
const ALLOWED_FUNCTIONS = new Set(["thesis", "supporting_premise", "evidence",
  "opposing_claim_to_refute", "background", "reported_neutral", "unclear",
  "pillar", "pillar_support", "qualification", "consistency_hinge"]);
const ALLOWED_TRANSFORMS = new Set(["normal", "invert", "none", "review"]);

const nullableString = { type: ["string", "null"] };
const targetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetType", "targetText", "subjectEntity", "predicateText", "objectText",
    "allegedAction", "studyTitle", "studyAuthors", "studyYear", "studyIdentifier",
    "populationScope", "sourceExcerpt", "articleStance", "scoreTransform",
    "searchEligible", "verdictEligible", "resolutionStatus", "mappingConfidence",
    "mappingRationale"],
  properties: {
    targetType: { type: "string", enum: ["attribution", "substantive", "inference", "study_identity"] },
    targetText: { type: "string" }, subjectEntity: nullableString,
    predicateText: { type: "string" }, objectText: nullableString,
    allegedAction: nullableString, studyTitle: nullableString,
    studyAuthors: { type: ["array", "null"], items: { type: "string" } },
    studyYear: nullableString, studyIdentifier: nullableString, populationScope: nullableString,
    sourceExcerpt: { type: "string" },
    articleStance: { type: "string", enum: ["endorses", "rejects", "neutral", "unclear"] },
    scoreTransform: { type: "string", enum: ["normal", "invert", "none", "review"] },
    searchEligible: { type: "boolean" }, verdictEligible: { type: "boolean" },
    resolutionStatus: { type: "string", enum: ["mapped", "underspecified", "resolved", "unresolved"] },
    mappingConfidence: { type: "number" }, mappingRationale: { type: "string" },
  },
};
const mappingResponseSchema = {
  name: "legacy_argument_mapping_active_db_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claimId", "claimText", "objectClaim", "isAttribution",
            "speakerEntity", "articleStance", "argumentFunction", "scoreTransform",
            "accountabilityEligible", "confidence", "rationale", "targets"],
          properties: {
            claimId: { type: "integer" }, claimText: { type: "string" },
            objectClaim: { type: "string" }, isAttribution: { type: "boolean" },
            speakerEntity: nullableString,
            articleStance: { type: "string", enum: ["endorses", "rejects", "neutral", "unclear"] },
            argumentFunction: { type: "string", enum: ["thesis", "supporting_premise",
              "evidence", "opposing_claim_to_refute", "background", "reported_neutral", "unclear"] },
            scoreTransform: { type: "string", enum: ["normal", "invert", "none", "review"] },
            accountabilityEligible: { type: "boolean" }, confidence: { type: "number" },
            rationale: { type: "string" }, targets: { type: "array", items: targetSchema },
          },
        },
      },
    },
  },
};

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fillTemplate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function deriveTransform(argumentFunction, stance, emitted, deterministicRepairs = false) {
  if (deterministicRepairs) {
    return deriveHostScoreTransform(argumentFunction, stance, emitted);
  }
  if (ALLOWED_TRANSFORMS.has(emitted)) return emitted;
  if (argumentFunction === "opposing_claim_to_refute" || stance === "rejects") return "invert";
  if (argumentFunction === "background" || argumentFunction === "reported_neutral"
    || stance === "neutral") return "none";
  if (argumentFunction === "unclear" || stance === "unclear") return "review";
  return "normal";
}

function normalize(raw, claim, { deterministicRepairs = false } = {}) {
  const argumentFunction = ALLOWED_FUNCTIONS.has(raw?.argumentFunction)
    ? raw.argumentFunction : "unclear";
  const emittedStance = raw?.articleStanceTowardObjectClaim ?? raw?.articleStance;
  const articleStance = ALLOWED_STANCES.has(emittedStance) ? emittedStance : "unclear";
  const emittedTransform = String(raw?.scoreTransform || "").trim();
  return {
    claimId: claim.claimId,
    originalClaim: claim.text,
    originalRole: claim.role,
    objectClaim: String(raw?.objectClaim || claim.text).trim().replace(/\s+/g, " "),
    isAttribution: raw?.isAttribution === true,
    speakerEntity: String(raw?.speakerEntity || "").trim(),
    articleStance,
    argumentFunction,
    emittedScoreTransform: ALLOWED_TRANSFORMS.has(emittedTransform)
      ? emittedTransform : null,
    scoreTransform: deriveTransform(argumentFunction, articleStance, emittedTransform,
      deterministicRepairs),
    accountabilityEligible: raw?.accountabilityEligible === true,
    confidence: Number.isFinite(Number(raw?.confidence))
      ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0,
    rationale: String(raw?.rationale || "").trim(),
    targets: Array.isArray(raw?.targets) ? raw.targets : [],
    modelReturned: Boolean(raw),
  };
}

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

async function closePool() {
  await new Promise((resolve) => pool.end(() => resolve()));
}

async function main() {
  const sourcePath = path.resolve(argument("--source"));
  const fixtureId = argument("--fixture", "CF1-F03");
  const model = argument("--model", "gpt-4o-mini");
  const apiMode = argument("--api", "chat");
  if (!["chat", "responses"].includes(apiMode)) throw new Error("--api must be chat or responses");
  const seedRaw = argument("--seed");
  const seed = seedRaw === null ? null : Number(seedRaw);
  const savedResponsePath = argument("--saved-response");
  const deterministicRepairs = process.argv.includes("--deterministic-repairs");
  const assertionLanguage = process.argv.includes("--assertion-language");
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const sourceRecord = source.records?.find((record) => record.status === "completed");
  if (!sourceRecord?.claims?.length) throw new Error("Source has no completed claim inventory");

  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", fixtureId, "article.json");
  const fixtureRaw = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { article } = prepareArticle(fixtureRaw.article ?? fixtureRaw);
  const claims = sourceRecord.claims.map((claim, index) => deterministicRepairs
    ? buildMappingClaimPacket(article.text, claim, index + 1) : ({
    claimId: index + 1,
    text: claim.text,
    role: claim.role || null,
    relationshipType: claim.relationshipType || null,
    objectText: claim.objectText || null,
  }));
  const articleThesis = claims.find((claim) => claim.role === "thesis")?.text
    || claims[0].text;

  const promptManager = new PromptManager(query);
  promptManager.clearCache();
  const systemPrompt = await promptManager.getPrompt("argument_mapping_system", {
    system: FALLBACK_SYSTEM, user: "", parameters: {},
  });
  const userPrompt = await promptManager.getPrompt("argument_mapping_user", {
    system: "", user: FALLBACK_USER, parameters: {},
  });
  const articleExcerpt = article.text.slice(0, 16000);
  const baseSystem = systemPrompt.system || FALLBACK_SYSTEM;
  const userTemplate = assertionLanguage
    ? toAssertionLanguage(userPrompt.user || FALLBACK_USER)
    : (userPrompt.user || FALLBACK_USER);
  const modelClaims = assertionLanguage ? toAssertionPacketKeys(claims) : claims;
  const user = fillTemplate(userTemplate, {
    articleExcerpt,
    articleThesis,
    claimsJson: JSON.stringify(claims, null, 2),
    assertionsJson: JSON.stringify(modelClaims, null, 2),
  });
  const system = assertionLanguage ? toAssertionLanguage(baseSystem) : baseSystem;
  const startedAt = new Date();
  const savedResponse = savedResponsePath
    ? JSON.parse(readFileSync(path.resolve(savedResponsePath), "utf8")) : null;
  const response = savedResponse ? {
    output: savedResponse.rawOutput,
    model: savedResponse.provider?.model ?? model,
    usage: savedResponse.provider?.usage ?? null,
    rawResponse: {
      id: savedResponse.provider?.responseId ?? null,
      system_fingerprint: savedResponse.provider?.systemFingerprint ?? null,
      choices: [{ finish_reason: savedResponse.provider?.finishReason ?? null }],
    },
  } : apiMode === "responses"
    ? await createOpenAiResponsesCf1Transport().invoke({
      system,
      user,
      model,
      responseSchema: assertionLanguage
        ? assertionMappingSchema(mappingResponseSchema) : mappingResponseSchema,
      reasoningEffort: "none",
      maxOutputTokens: 12000,
      store: false,
    })
    : await openAiLLM.generate({
    system,
    user,
    schemaHint: "",
    temperature: 0,
    maxRetries: 2,
    timeout: 45000,
    model,
    apiMode,
    ...(seed === null ? {} : { seed }),
    maxOutputTokens: 12000,
    returnMetadata: true,
  });
  const modelItems = Array.isArray(response.output?.assertions) ? response.output.assertions
    : Array.isArray(response.output?.claims) ? response.output.claims
    : Array.isArray(response.output?.items) ? response.output.items : [];
  const rawItems = assertionLanguage ? modelItems.map(restoreMappingClaimKeys) : modelItems;
  const rawById = new Map(rawItems.map((item) => [Number(item.claimId), item]));
  const mappings = claims.map((claim) => normalize(rawById.get(claim.claimId), claim,
    { deterministicRepairs }));
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(argument("--out", path.join(path.dirname(sourcePath),
    `argument-mapping-replay-${stamp}`)));
  mkdirSync(outDir, { recursive: true });

  const artifact = {
    stage: "legacy-db-argument-mapping-4714383a",
    generatedAt,
    sourcePath,
    fixtureId,
    model,
    apiMode,
    seed,
    deterministicRepairs,
    assertionLanguage,
    reusedSavedResponse: Boolean(savedResponse),
    historicalArticleExcerptChars: 16000,
    localClaimContextChars: deterministicRepairs
      ? claims.reduce((sum, claim) => sum + claim.localArticleContext.length, 0) : 0,
    actualArticleExcerptChars: articleExcerpt.length,
    fullArticleChars: article.text.length,
    promptNames: { system: "argument_mapping_system", user: "argument_mapping_user" },
    fingerprints: { systemSha256: sha256(system), userSha256: sha256(user),
      assembledSha256: sha256(`${system}\n${user}`) },
    request: { system, user, temperature: 0 },
    provider: { model: response.model, usage: response.usage,
      responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      finishReason: response.rawResponse?.choices?.[0]?.finish_reason ?? null,
      elapsedMs: savedResponse?.provider?.elapsedMs ?? Date.now() - startedAt.getTime() },
    rawOutput: response.output,
    mappings,
  };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  const headers = ["claimId", "originalClaim", "originalRole", "objectClaim", "isAttribution",
    "speakerEntity", "articleStance", "argumentFunction", "emittedScoreTransform",
    "scoreTransform", "accountabilityEligible", "confidence", "rationale", "targetCount"];
  const csvMappings = mappings.map((item) => ({ ...item, targetCount: item.targets.length }));
  writeFileSync(path.join(outDir, "mappings.csv"), `${headers.map(csv).join(",")}\n${mappings
    .map((_, index) => headers.map((header) => csv(csvMappings[index][header])).join(",")).join("\n")}\n`);
  const rows = mappings.map((item) => `<tr><td>${item.claimId}</td><td>${escapeHtml(item.originalClaim)}</td>
    <td>${escapeHtml(item.objectClaim)}</td><td>${escapeHtml(item.speakerEntity)}</td>
    <td>${escapeHtml(item.articleStance)}</td><td>${escapeHtml(item.argumentFunction)}</td>
    <td>${escapeHtml(item.emittedScoreTransform)}</td><td>${escapeHtml(item.scoreTransform)}</td><td>${item.confidence}</td><td>${item.targets.length}</td></tr>
    <tr><td></td><td colspan="9"><details><summary>Rationale, input packet, and typed targets</summary><pre>${escapeHtml(JSON.stringify({ rationale: item.rationale, inputPacket: claims[item.claimId - 1], targets: item.targets }, null, 2))}</pre></details></td></tr>`).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Legacy argument mapping replay</title>
  <style>body{font:14px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c9d0d6;padding:7px;vertical-align:top;text-align:left}th{background:#edf1f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}.note{background:#fff7d6;border:1px solid #d9c76d;padding:10px}summary{cursor:pointer;font-weight:650}</style></head><body>
  <h1>${escapeHtml(fixtureId)} · Legacy DB argument-mapping replay</h1>
  <p class="note">Read-only replay of commit 4714383a. Call 1 was not rerun. This made one batch model call over the saved claims and the historical first-16,000-character article excerpt. Deterministic repairs: <strong>${deterministicRepairs ? "enabled" : "disabled"}</strong>. No evidence search or database write occurred.</p>
  <p>${mappings.length} claims · ${escapeHtml(model)} · ${escapeHtml(apiMode)} · ${(artifact.provider.elapsedMs / 1000).toFixed(1)}s · ${artifact.provider.usage?.total_tokens ?? artifact.provider.usage?.totalTokens ?? "unknown"} tokens</p>
  <table><thead><tr><th>ID</th><th>Extracted claim</th><th>Object claim</th><th>Speaker</th><th>Article stance</th><th>Argument function</th><th>Model transform</th><th>Host transform</th><th>Confidence</th><th>Targets</th></tr></thead><tbody>${rows}</tbody></table>
  <details><summary>Exact assembled request and fingerprints</summary><pre>${escapeHtml(JSON.stringify({ request: artifact.request, fingerprints: artifact.fingerprints }, null, 2))}</pre></details>
  <details><summary>Raw model output</summary><pre>${escapeHtml(JSON.stringify(response.output, null, 2))}</pre></details>
  </body></html>`;
  writeFileSync(path.join(outDir, "report.html"), html);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`CSV: ${path.join(outDir, "mappings.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closePool);
