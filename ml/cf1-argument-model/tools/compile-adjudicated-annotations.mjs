#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileAdjudication,
  compilationSummary,
  sha256,
} from "./lib/adjudication-compiler.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolDir, "..");
const defaultDecisions = path.join(
  projectDir,
  "data",
  "annotation-prompts",
  "CF1-argument-drafts-v1-review-decisions-normalized.json",
);
const defaultOutput = path.join(projectDir, "data", "adjudication-candidates", "argument-drafts-v1");

function parseArgs(argv) {
  const args = {
    decisions: defaultDecisions,
    output: defaultOutput,
    resolutions: null,
    validateOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--decisions") args.decisions = path.resolve(argv[++index]);
    else if (token === "--output") args.output = path.resolve(argv[++index]);
    else if (token === "--resolutions") args.resolutions = path.resolve(argv[++index]);
    else if (token === "--validate-only") args.validateOnly = true;
    else if (token === "--help") {
      console.log(`Usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} [options]

Options:
  --decisions FILE    Reviewed decision export
  --resolutions FILE  Explicit human resolution overlay
  --output DIR        Candidate output directory
  --validate-only     Validate without writing candidate annotations
  --help              Show this message

The compiler is fail-closed. It never overwrites an existing output directory and
never marks an annotation approved.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function readRawJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { raw, value: JSON.parse(raw), sha256: sha256(raw) };
}

function loadFixtures(reviewSha256) {
  return Array.from({ length: 9 }, (_, index) => {
    const fixtureId = `CF1-F${String(index + 1).padStart(2, "0")}`;
    const draftPath = path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.argumentDraft.v1.json`);
    const formPath = path.join(projectDir, "data", "annotation-forms", `${fixtureId}.annotation.json`);
    const draft = readRawJson(draftPath);
    const form = readRawJson(formPath);
    return {
      draft: draft.value,
      form: form.value,
      draftPath,
      formPath,
      draftSha256: draft.sha256,
      formSha256: form.sha256,
      reviewSha256,
    };
  });
}

function markdownReport({ summary, blockers, warnings, decisionsPath, resolutionsPath }) {
  const rows = [
    "# CF1 Adjudication Compilation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Decisions: \`${decisionsPath}\``,
    `Resolutions: ${resolutionsPath ? `\`${resolutionsPath}\`` : "none"}`,
    "",
    "## Summary",
    "",
    ...Object.entries(summary).map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`),
    "",
    "## Blockers",
    "",
    ...(blockers.length
      ? blockers.map((blocker) => `- **${blocker.code}** — \`${blocker.key}\`: ${blocker.message}`)
      : ["None."]),
    "",
    "## Warnings",
    "",
    ...(warnings.length
      ? warnings.map((warning) => `- **${warning.code}** — \`${warning.key}\`: ${warning.message}`)
      : ["None."]),
    "",
  ];
  return rows.join("\n");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const decisionsFile = readRawJson(args.decisions);
const resolutionFile = args.resolutions ? readRawJson(args.resolutions) : null;
const fixtures = loadFixtures(decisionsFile.sha256);
const result = compileAdjudication({
  fixtures,
  review: decisionsFile.value,
  resolutionOverlay: resolutionFile?.value ?? null,
});
const summary = compilationSummary(result);
const report = {
  schemaVersion: "cf1.adjudicationCompilationReport.v1",
  generatedAt: new Date().toISOString(),
  decisionsPath: path.relative(projectDir, args.decisions),
  decisionsSha256: decisionsFile.sha256,
  resolutionsPath: args.resolutions ? path.relative(projectDir, args.resolutions) : null,
  resolutionsSha256: resolutionFile?.sha256 ?? null,
  summary,
  blockers: result.blockers,
  warnings: result.warnings,
};

if (args.validateOnly || result.blockers.length) {
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = result.blockers.length ? 2 : 0;
} else {
  if (fs.existsSync(args.output)) {
    throw new Error(`Refusing to overwrite existing output directory: ${args.output}`);
  }
  fs.mkdirSync(args.output, { recursive: true });
  for (const fixture of result.compiledFixtures) {
    writeJson(path.join(args.output, `${fixture.fixtureId}.annotation.candidate.v1.json`), fixture.candidate);
  }
  writeJson(path.join(args.output, "review-queue.json"), result.reviewQueue);
  writeJson(path.join(args.output, "compilation-report.json"), report);
  fs.writeFileSync(
    path.join(args.output, "COMPILATION_REPORT.md"),
    `${markdownReport({
      summary,
      blockers: result.blockers,
      warnings: result.warnings,
      decisionsPath: report.decisionsPath,
      resolutionsPath: report.resolutionsPath,
    })}\n`,
  );
  console.log(JSON.stringify({ output: args.output, summary }, null, 2));
}
