#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { articleDocumentFromText, buildArticleSourceBlocks } from
  "../../backend/src/claim-foundry/article-document/index.js";
import { validateArticleInput } from "../../backend/src/claim-foundry/validateArticleInput.js";
import { normalizeAgentDraft } from "../../backend/src/claim-foundry/normalizeAgentDraft.js";
import { assembleCf1Package, finalizeCf1Package } from
  "../../backend/src/claim-foundry/assemblePackage.js";
import { verifyCf1Package } from "../../backend/src/claim-foundry/verifyPackage.js";
import { writeCf1Artifacts } from "../../backend/src/claim-foundry/artifacts.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function json(root, name) {
  return JSON.parse(await readFile(path.join(root, name), "utf8"));
}

const runRoot = path.resolve(argument("--run") ?? "");
if (!argument("--run")) throw new Error("--run <artifact run directory> is required");
let article = validateArticleInput(await json(runRoot, "article.json"));
const oldRun = await json(runRoot, "run.json");
const oldDraft = await json(runRoot, "package-draft.json");
const agentDraft = await json(runRoot, "agent-draft.json");
const articleDocument = articleDocumentFromText({ text: article.text,
  metadata: { title: article.title, language: article.language } });
article = { ...article, text: articleDocument.canonicalText,
  contentHash: articleDocument.contentHash };
const structuralBlocks = buildArticleSourceBlocks(articleDocument);
const normalizedDraft = normalizeAgentDraft(agentDraft,
  { article, articleDocument, structuralBlocks });
const packageDraft = assembleCf1Package({ article, articleDocument, normalizedDraft,
  packageId: oldDraft.packageId, runId: oldRun.runId,
  packageVersion: oldDraft.packageVersion, supersedesPackageId: oldDraft.supersedesPackageId,
  createdAt: oldDraft.createdAt, diagnostics: oldDraft.diagnostics });
const verification = verifyCf1Package(packageDraft);
if (!verification.valid) {
  console.error(JSON.stringify(verification, null, 2));
  process.exitCode = 1;
} else {
  const claimPackage = finalizeCf1Package(packageDraft, verification);
  const completedAt = new Date().toISOString();
  const run = { ...oldRun, status: "ready_for_evidence", error: null,
    packageId: claimPackage.packageId, completedAt };
  const trace = await json(runRoot, "cf1_agent_trace.json");
  const agentState = { runId: run.runId, status: "completed", stepTrace: trace.steps,
    semanticInventoryOutput: await json(runRoot, "semantic_inventory.json"),
    selectedEnrichmentOutput: await json(runRoot, "selected_enrichment.json"),
    orientation: await json(runRoot, "article_orientation.json"),
    initialWorkProduct: await json(runRoot, "initial_claims.json"),
    criticReport: await json(runRoot, "critic_report.json"),
    revisionPlan: await json(runRoot, "revision_plan.json"),
    revisedWorkProduct: await json(runRoot, "revised_claims.json"),
    targetWorkProduct: await json(runRoot, "targets.json") };
  const result = await writeCf1Artifacts({ run, article, structuralBlocks, agentDraft,
    agentState, packageDraft, verification, claimPackage },
  { artifactRoot: path.dirname(runRoot) });
  console.log(JSON.stringify({ run, verification, artifactRoot: result.artifactRoot }, null, 2));
}
