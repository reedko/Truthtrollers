#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import {
  CF0_BASIC_SCHEMA,
  CF0_BASIC_SYSTEM_PROMPT,
  buildCf0BasicPrompt,
  claimsToCsv,
  renderCf0ReviewHtml,
  sha256,
} from "../../backend/src/claim-foundry-basic/cf0Basic.js";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixture = option("--fixture", "CF1-F03");
const outputDir = option("--out", path.join("artifacts", "claim-foundry-basic", `cf0-${fixture.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`));
const model = option("--model", "gpt-4o-mini");
const maxTokens = Number(option("--max-tokens", "6000"));

dotenv.config({ path: path.resolve("backend/.env") });
const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required (looked in backend/.env).");

const fixturePath = path.resolve("backend/test/claim-foundry/fixtures", fixture, "article.json");
const article = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const prompt = buildCf0BasicPrompt(article);
const request = {
  model,
  temperature: 0,
  max_tokens: maxTokens,
  response_format: { type: "json_schema", json_schema: CF0_BASIC_SCHEMA },
  messages: [
    { role: "system", content: CF0_BASIC_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ],
};

const startedAt = new Date().toISOString();
const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(request),
});
const responseText = await response.text();
if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${responseText}`);
const envelope = JSON.parse(responseText);
const content = envelope.choices?.[0]?.message?.content;
if (!content) throw new Error("OpenAI response contains no message content.");
const result = JSON.parse(content);
const manifest = {
  experiment: "CF0 basic one-call extraction",
  fixture,
  fixturePath,
  startedAt,
  completedAt: new Date().toISOString(),
  model: envelope.model || model,
  systemFingerprint: envelope.system_fingerprint || null,
  usage: envelope.usage || null,
  promptSha256: sha256(prompt),
  systemPromptSha256: sha256(CF0_BASIC_SYSTEM_PROMPT),
  schemaSha256: sha256(JSON.stringify(CF0_BASIC_SCHEMA)),
  claimCount: result.claims?.length ?? 0,
};

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "cf0-basic.json"), JSON.stringify(result, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "request.json"), JSON.stringify({ ...request, messages: [{ role: "system", content: CF0_BASIC_SYSTEM_PROMPT }, { role: "user", content: "<stored separately in prompt.txt>" }] }, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "prompt.txt"), prompt + "\n"),
  fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "claims.csv"), claimsToCsv(result)),
  fs.writeFile(path.join(outputDir, "review.html"), renderCf0ReviewHtml({ fixture, result, manifest })),
]);

console.log(JSON.stringify({ outputDir, claimCount: manifest.claimCount, model: manifest.model, usage: manifest.usage, review: path.join(outputDir, "review.html") }, null, 2));
