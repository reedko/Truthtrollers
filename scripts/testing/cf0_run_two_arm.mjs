#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  CF0_BASIC_SCHEMA, CF0_BASIC_SYSTEM_PROMPT, CF0_SUPERBLIND_SCHEMA, CF0_SUPERBLIND_SYSTEM_PROMPT,
  CF0_COMPACT_SOURCE_POSTURE_SCHEMA, CF0_COMPACT_SOURCE_POSTURE_SYSTEM_PROMPT,
  CF0_SUPERBLIND_STANCE_V2_SCHEMA, CF0_SUPERBLIND_STANCE_V2_SYSTEM_PROMPT,
  buildCf0BasicPrompt, buildCf0SuperblindPrompt, buildCf0CompactSourcePosturePrompt, buildCf0SuperblindStanceV2Prompt, claimsToCsv, renderCf0ReviewHtml, sha256,
} from "../../backend/src/claim-foundry-basic/cf0Basic.js";

function option(name, fallback) { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; }
const fixture = option("--fixture", "CF1-F03");
const outputDir = option("--out", "artifacts/claim-foundry-basic/cf0-f03-simple-vs-superblind-20260718");
const model = option("--model", "gpt-4o-mini");
const selectedArm = option("--arm", null);
dotenv.config({ path: path.resolve("backend/.env") });
const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required.");
const article = JSON.parse(await fs.readFile(path.resolve("backend/test/claim-foundry/fixtures", fixture, "article.json"), "utf8"));

const allArms = [
  { id: "simple", label: "Simple", system: CF0_BASIC_SYSTEM_PROMPT, schema: CF0_BASIC_SCHEMA, prompt: buildCf0BasicPrompt(article), normalize: (r) => r },
  { id: "superblind", label: "Superblind", system: CF0_SUPERBLIND_SYSTEM_PROMPT, schema: CF0_SUPERBLIND_SCHEMA, prompt: buildCf0SuperblindPrompt(article), normalize: (r) => ({ thesis: r.thesis, claims: r.claims.map((c) => ({ proposition: c.claimText, assertedBy: c.assertionSource, articleTreatment: "—", groundingExcerpt: c.sourceUnitIds.join(", "), evidenceQuestion: c.whyCentral, supportWouldLookLike: c.supportWouldLookLike, refuteWouldLookLike: c.refutationWouldLookLike })) }) },
  { id: "compact-source-posture", label: "Compact source/posture", system: CF0_COMPACT_SOURCE_POSTURE_SYSTEM_PROMPT, schema: CF0_COMPACT_SOURCE_POSTURE_SCHEMA, prompt: buildCf0CompactSourcePosturePrompt(article), normalize: (r) => ({ thesis: r.thesis, claims: r.claims.map((c) => ({ proposition: c.proposition, assertedBy: c.assertionSource, articleTreatment: c.articleStance, groundingExcerpt: c.sourceUnitIds.join(", "), evidenceQuestion: c.whyCentral, supportWouldLookLike: c.supportWouldLookLike, refuteWouldLookLike: c.refuteWouldLookLike })) }) },
  { id: "superblind-stance-v2", label: "Superblind + stance v2", system: CF0_SUPERBLIND_STANCE_V2_SYSTEM_PROMPT, schema: CF0_SUPERBLIND_STANCE_V2_SCHEMA, prompt: buildCf0SuperblindStanceV2Prompt(article), normalize: (r) => ({ thesis: r.thesis, claims: r.claims.map((c) => ({ proposition: c.claimText, assertedBy: c.assertionSource, articleTreatment: c.articleStance, groundingExcerpt: c.sourceUnitIds.join(", "), evidenceQuestion: c.whyCentral, supportWouldLookLike: c.supportWouldLookLike, refuteWouldLookLike: c.refutationWouldLookLike })) }) },
];
const arms = selectedArm ? allArms.filter((arm) => arm.id === selectedArm) : allArms;
if (!arms.length) throw new Error(`Unknown --arm ${selectedArm}. Choose: ${allArms.map((arm) => arm.id).join(", ")}`);
await fs.mkdir(outputDir, { recursive: true });
const summaries = [];
for (const arm of arms) {
  const request = { model, temperature: 0, max_tokens: 6000, response_format: { type: "json_schema", json_schema: arm.schema }, messages: [{ role: "system", content: arm.system }, { role: "user", content: arm.prompt }] };
  const startedAt = new Date().toISOString();
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${arm.id} failed (${response.status}): ${body}`);
  const envelope = JSON.parse(body); const raw = JSON.parse(envelope.choices?.[0]?.message?.content || ""); const result = arm.normalize(raw);
  const manifest = { experiment: `CF0 ${arm.label}`, fixture, startedAt, completedAt: new Date().toISOString(), model: envelope.model || model, systemFingerprint: envelope.system_fingerprint || null, usage: envelope.usage || null, promptSha256: sha256(arm.prompt), systemPromptSha256: sha256(arm.system), schemaSha256: sha256(JSON.stringify(arm.schema)), claimCount: result.claims.length };
  const armDir = path.join(outputDir, arm.id); await fs.mkdir(armDir, { recursive: true });
  await Promise.all([fs.writeFile(path.join(armDir, "raw.json"), JSON.stringify(raw, null, 2) + "\n"), fs.writeFile(path.join(armDir, "normalized.json"), JSON.stringify(result, null, 2) + "\n"), fs.writeFile(path.join(armDir, "prompt.txt"), arm.prompt + "\n"), fs.writeFile(path.join(armDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"), fs.writeFile(path.join(armDir, "claims.csv"), claimsToCsv(result)), fs.writeFile(path.join(armDir, "review.html"), renderCf0ReviewHtml({ fixture, result, manifest }))]);
  summaries.push({ arm: arm.label, claims: manifest.claimCount, usage: manifest.usage, promptSha256: manifest.promptSha256, review: `${arm.id}/review.html` });
}
const rows = summaries.map((s) => `<tr><td>${s.arm}</td><td>${s.claims}</td><td>${s.usage?.total_tokens ?? "—"}</td><td><a href="${s.review}">review</a></td></tr>`).join("");
await fs.writeFile(path.join(outputDir, "comparison.html"), `<!doctype html><html><body style="font:16px system-ui;margin:32px"><h1>CF0: Simple vs Superblind vs Compact source/posture</h1><p>Fixture: ${fixture} · Model: ${model}</p><table border="1" cellpadding="8" style="border-collapse:collapse"><tr><th>Arm</th><th>Claims</th><th>Total tokens</th><th>Review</th></tr>${rows}</table></body></html>`);
await fs.writeFile(path.join(outputDir, "comparison.json"), JSON.stringify(summaries, null, 2) + "\n");
console.log(JSON.stringify({ outputDir, summaries, comparison: path.join(outputDir, "comparison.html") }, null, 2));
