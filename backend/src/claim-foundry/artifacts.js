import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRunId } from "./ids.js";
import { buildClaimPackageMarkdown } from "./claimPackageMarkdown.js";

async function writeAtomic(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildRunSummary(state) {
  const run = state.run;
  const pkg = state.claimPackage;
  const verification = state.verification;
  return [
    "# Claim Foundry CF1 Run",
    "",
    `- Run: ${run.runId}`,
    `- Status: ${run.status}`,
    `- Path: ${run.executionPath ?? "not_selected"}`,
    `- Mode: ${run.executionMode ?? "unknown"}`,
    `- Package: ${pkg?.packageId ?? "none"}`,
    `- Valid: ${verification?.valid ?? false}`,
    `- Selected claims: ${pkg?.selectedEvaluationClaims?.length ?? 0}`,
    `- Targets: ${pkg?.phase3Targets?.length ?? 0}`,
    `- Evidence Need Cards: ${pkg?.evidenceNeedCards?.length ?? 0}`,
    `- Semantic calls: ${run.usage?.semanticCalls ?? 0}`,
    `- Total tokens: ${run.usage?.totalTokens ?? 0}`,
    `- Repair attempted: ${verification?.repairAttempted ?? false}`,
    ...(run.error ? ["", "## Failure", "", `- ${run.error.code}: ${run.error.message}`] : []),
    ...(verification?.blockingErrors?.length ? ["", "## Blocking errors", "",
      ...verification.blockingErrors.map((item) => `- ${item.code} ${item.path}: ${item.message}`)] : []),
    "",
  ].join("\n");
}

export async function writeCf1Artifacts(state, { artifactRoot }) {
  if (!artifactRoot) return { artifactRoot: null, files: [] };
  if (!isRunId(state.run?.runId)) throw new TypeError("A valid CF1 run ID is required for artifacts");
  const root = path.resolve(artifactRoot, state.run.runId);
  await mkdir(root, { recursive: true });
  const artifacts = [
    ["run.json", state.run],
    ["article.json", state.article],
    ["structural-blocks.json", state.structuralBlocks],
    ["agent-draft.json", state.agentDraft],
    ["one-call-agent-output.json", state.agentState?.oneCallOutput],
    ["semantic_inventory.json", state.agentState?.semanticInventoryOutput],
    ["selected_enrichment.json", state.agentState?.selectedEnrichmentOutput],
    ["package-draft.json", state.packageDraft],
    ["verification.json", state.verification],
    ["claim-package.json", state.claimPackage],
    ["article_orientation.json", state.agentState?.orientation],
    ["initial_claims.json", state.agentState?.initialWorkProduct],
    ["critic_report.json", state.agentState?.criticReport],
    ["revision_plan.json", state.agentState?.revisionPlan],
    ["revised_claims.json", state.agentState?.revisedWorkProduct],
    ["targets.json", state.agentState?.targetWorkProduct],
    ["verifier_report.json", state.verification],
    ["cf1_agent_trace.json", state.agentState ? {
      runId: state.agentState.runId, status: state.agentState.status,
      steps: state.agentState.stepTrace,
    } : null],
    ["final_cf1_package.json", state.claimPackage],
  ].filter(([, value]) => value !== undefined && value !== null);
  for (const [name, value] of artifacts) await writeAtomic(path.join(root, name), json(value));
  if (state.claimPackage) await writeAtomic(path.join(root, "claim-package.md"),
    buildClaimPackageMarkdown(state.claimPackage));
  await writeAtomic(path.join(root, "summary.md"), buildRunSummary(state));
  return { artifactRoot: root, files: [...artifacts.map(([name]) => path.join(root, name)),
    ...(state.claimPackage ? [path.join(root, "claim-package.md")] : []), path.join(root, "summary.md")] };
}
