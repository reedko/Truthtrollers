#!/usr/bin/env node

/**
 * TM4 RAW LLM PROMPT/RESPONSE DUMP — read-only.
 *
 * Renders a <runId>.rawllm.jsonl capture file (written by
 * tm4_materialize_preview.mjs via the captureRaw hooks) into readable
 * markdown + json artifacts:
 *   artifacts/tm4_rawllm_prompt_response_dump_<timestamp>.{md,json}
 *
 * Usage:
 *   node scripts/testing/tm4_rawllm_dump.mjs --run <previewRunId|latest>
 *   node scripts/testing/tm4_rawllm_dump.mjs --file <path/to/x.rawllm.jsonl>
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const RUNS_DIR = path.join(ROOT, "backend/logs/tm4_preview_runs");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function resolveFile() {
  const explicit = getArg("--file");
  if (explicit) return explicit;
  const run = getArg("--run") || "latest";
  if (run !== "latest") return path.join(RUNS_DIR, `${run}.rawllm.jsonl`);
  const files = (await fs.readdir(RUNS_DIR)).filter((f) => f.endsWith(".rawllm.jsonl")).sort();
  if (!files.length) throw new Error(`No .rawllm.jsonl files in ${RUNS_DIR} — run the materializer (fresh mode) first`);
  return path.join(RUNS_DIR, files[files.length - 1]);
}

const fold = (label, text, open = false) =>
  `<details${open ? " open" : ""}><summary>${label} (${String(text || "").length} chars)</summary>\n\n\`\`\`\n${String(text || "")}\n\`\`\`\n\n</details>`;

async function main() {
  const file = await resolveFile();
  const rows = (await fs.readFile(file, "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
  await fs.mkdir(ARTIFACTS, { recursive: true });

  const jsonPath = path.join(ARTIFACTS, `tm4_rawllm_prompt_response_dump_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify({ source: path.relative(ROOT, file), count: rows.length, rows }, null, 2));

  const fieldCheck = ["phase", "sectionIndex", "model", "temperature", "systemPrompt", "userPrompt", "raw", "parseStatus", "ts"];
  const coverage = fieldCheck.map((f) => `| ${f} | ${rows.filter((r) => r[f] !== undefined || (f === "sectionIndex" && r.phase !== "phase1_atomic_extraction")).length}/${rows.length} |`).join("\n");

  const md = `# TM4 Raw LLM Prompt/Response Dump — ${TS}

Source: \`${path.relative(ROOT, file)}\` · ${rows.length} captured calls

## Field coverage
| field | rows present |
|---|---|
${coverage}

${rows.map((r, i) => `## Call ${i + 1} — ${r.phase}${r.sectionIndex != null ? ` (section ${r.sectionIndex}${r.sectionHeading ? `: ${r.sectionHeading}` : ""})` : ""}
- ts: ${r.ts} · model: ${r.model || "?"} · temperature: ${r.temperature ?? "?"} · parse: **${r.parseStatus || "n/a"}**${r.parseError ? ` (${r.parseError})` : ""}
- accepted claims: ${r.acceptedClaimCount ?? "—"} · rejected/filtered: ${r.rejectedClaimCount ?? "—"}

${fold("system prompt", r.systemPrompt)}
${fold("user prompt", r.userPrompt)}
${fold("raw response (pre-parse)", r.raw, false)}`).join("\n\n")}
`;
  const mdPath = path.join(ARTIFACTS, `tm4_rawllm_prompt_response_dump_${TS}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`✅ Raw LLM dump: ${rows.length} calls\n   ${mdPath}\n   ${jsonPath}`);
  return { mdPath, jsonPath };
}

main().catch((e) => { console.error("❌ FATAL:", e.message || e); process.exit(1); });
