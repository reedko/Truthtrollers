#!/usr/bin/env node
// Fixed-candidate diagnostic for the Set D source-first ordering hypothesis.
// This is deliberately separate from the full-article generator: supplied
// candidates are classified, not discovered, and no evaluation answers are read.
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { assertBilledRunApproved, loadBenchmarkConfig }
  from "../../backend/test/claim-foundry/prompt-benchmark/benchmarkConfig.js";

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const has = (flag) => args.includes(flag);
const benchmarkDir = path.resolve(value("--benchmark-dir") ?? "");
const inputPath = path.resolve(value("--input") ?? "");
const phase = value("--phase");
const model = value("--model");
const repeats = Number(value("--repeats") ?? 1);

if (!value("--benchmark-dir") || !value("--input") || !phase || !model || !has("--openai")) {
  console.error("Usage: cf1_run_posture_order_diagnostic.mjs --benchmark-dir <dir> --input <json> --phase <name> --model <id> --repeats <n> --openai");
  process.exit(2);
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});
const role = { type: "string", enum: ["thesis", "pillar", "pillar_support", "opponent_claim",
  "qualification", "consistency_hinge"] };
const use = { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected", "reported",
  "background", "qualification", "unclear"] };
const effect = { type: "string", enum: ["strengthens", "weakens", "unchanged", "unclear"] };
const transform = { type: "string", enum: ["normal", "invert", "none", "unresolved"] };

function candidateProperties(order) {
  const fields = order === "source-first"
    ? [["candidateId", { type: "string", minLength: 1, maxLength: 30 }],
      ["propositionCore", { type: "string", minLength: 1, maxLength: 500 }],
      ["assertionSource", { type: "string", minLength: 1, maxLength: 300 }],
      ["articleRole", role], ["ifSupportedEffect", effect], ["ifRefutedEffect", effect],
      ["articleUse", use], ["scoreTransformCheck", transform],
      ["briefBasis", { type: "string", minLength: 1, maxLength: 700 }]]
    : [["candidateId", { type: "string", minLength: 1, maxLength: 30 }],
      ["propositionCore", { type: "string", minLength: 1, maxLength: 500 }],
      ["ifSupportedEffect", effect], ["ifRefutedEffect", effect], ["articleUse", use],
      ["articleRole", role], ["scoreTransformCheck", transform],
      ["assertionSource", { type: "string", minLength: 1, maxLength: 300 }],
      ["briefBasis", { type: "string", minLength: 1, maxLength: 700 }]];
  return Object.fromEntries(fields);
}

function schema(order, count) {
  const properties = candidateProperties(order);
  return { name: `cf1_posture_order_diagnostic_${order.replace("-", "_")}_v1`, strict: true,
    schema: { type: "object", additionalProperties: false, required: ["classifiedCandidates"],
      properties: { classifiedCandidates: { type: "array", minItems: count, maxItems: count,
        items: { type: "object", additionalProperties: false,
          required: Object.keys(properties), properties } } } } };
}

const definitions = {
  propositionCore: `propositionCore: State the exact single substantive proposition P. Remove reporting frames such as "S says" or "according to S" unless whether S made the statement is the genuine proposition. Do not append the article's rebuttal.`,
  assertionSource: `assertionSource: Identify who actually supplies P: the article voice, a person, institution, document, study, or quoted source. Do not substitute the person rebutting P, an entity merely mentioned nearby, or a generic topic label.`,
  articleRole: `articleRole: Identify P's job in the article's reasoning. Use opponent_claim only when the article makes evaluation of P a target of rebuttal or rejection.`,
  effects: `ifSupportedEffect and ifRefutedEffect: Using the supplied thesis, decide separately whether independent evidence supporting P would strengthen, weaken, or leave the thesis unchanged, and whether refuting P would strengthen, weaken, or leave it unchanged.`,
  articleUse: `articleUse: Use endorsed when the article advances P; opponent_to_rebut when it intends or attempts to challenge P; rejected when it expressly denies P; reported only for genuinely neutral reporting; and the remaining enum values only as defined by their ordinary argumentative meaning.`,
  transform: `scoreTransformCheck: Emit normal when support strengthens and refutation weakens the thesis; invert when support weakens and refutation strengthens it; none when both are irrelevant; unresolved otherwise.`,
  basis: `briefBasis: Briefly explain the article-relative posture and consequence decisions from the supplied passage.`,
};

function buildPrompt(order, input) {
  const sequence = order === "source-first"
    ? [definitions.propositionCore, definitions.assertionSource, definitions.articleRole,
      definitions.effects, definitions.articleUse, definitions.transform, definitions.basis]
    : [definitions.propositionCore, definitions.effects, definitions.articleUse,
      definitions.articleRole, definitions.transform, definitions.assertionSource, definitions.basis];
  const system = `You are classifying a fixed set of already-discovered article claims.

Use only the supplied thesis and source passages. Do not fact-check the article. Return exactly one item for every candidateId, in input order. Complete each item's fields in the order listed below and keep them mutually consistent.

${sequence.map((entry, index) => `${index + 1}. ${entry}`).join("\n\n")}

Emit only the enforced structured output.`;
  const user = `THESIS:\n${input.thesis}\n\nFIXED CANDIDATES:\n${input.candidatePackets
    .map((candidate) => `${candidate.candidateId}\nCANDIDATE TEXT: ${candidate.candidateText}\nSOURCE PASSAGE:\n${candidate.sourceText}`)
    .join("\n\n---\n\n")}`;
  return { system, user, responseSchema: schema(order, input.candidatePackets.length) };
}

try {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("--repeats must be 1..10");
  const config = loadBenchmarkConfig(benchmarkDir);
  if (model !== config.model) throw new Error(`--model ${model} differs from frozen config model ${config.model}`);
  assertBilledRunApproved(config);
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!Array.isArray(input.candidatePackets) || !input.candidatePackets.length) {
    throw new Error("Diagnostic input has no candidatePackets");
  }
  const outputDir = path.join(benchmarkDir, "diagnostics", phase);
  if (existsSync(outputDir)) throw new Error(`Diagnostic output is immutable and already exists: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true });
  dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
  const modelRunner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
  const runs = [];
  for (const order of ["source-first", "posture-first"]) {
    const prompt = buildPrompt(order, input);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const startedAt = new Date().toISOString();
      let response; let status = "completed"; let error;
      try {
        response = await modelRunner.invokeStructured({ ...prompt, model, temperature: 0,
          timeoutMs: config.timeoutMs, maximumAttempts: 1,
          maxOutputTokens: config.budgetLimits.maxOutputTokensPerCall,
          usageContext: { component: "claim_foundry", path: "benchmark_diagnostic",
            stage: `posture_order_${order}` } });
      } catch (caught) { status = "failed"; error = caught; }
      const finishedAt = new Date().toISOString();
      const body = { diagnosticId: input.diagnosticId, order, repeat, status, model,
        startedAt, finishedAt, elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt),
        promptFingerprints: { systemSha256: sha256(prompt.system), userSha256: sha256(prompt.user),
          schemaSha256: sha256(JSON.stringify(prompt.responseSchema)) },
        usage: response?.usage ?? null, output: response?.output ?? null,
        ...(error ? { error: { code: error.code ?? null, message: String(error.message).slice(0, 500) } } : {}) };
      writeFileSync(path.join(outputDir, `${order}-repeat-${repeat}.json`), JSON.stringify(body, null, 2));
      runs.push({ order, repeat, status, usage: body.usage, elapsedMs: body.elapsedMs });
      console.log(JSON.stringify(runs.at(-1)));
    }
  }
  writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({ diagnosticId: input.diagnosticId,
    phase, inputSha256: sha256(readFileSync(inputPath)), model, repeats, runs }, null, 2));
  process.exitCode = runs.every((run) => run.status === "completed") ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_POSTURE_DIAGNOSTIC_FAILED",
    message: error.message }));
  process.exitCode = 2;
}
