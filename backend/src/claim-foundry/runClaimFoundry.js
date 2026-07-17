import { assembleCf1Package, finalizeCf1Package } from "./assemblePackage.js";
import { createPackageId, createRunId, isRunId } from "./ids.js";
import { runLongCf1Analysis } from "./longExecution.js";
import { runNormalCf1Analysis } from "./normalExecution.js";
import { runCf1Agent } from "./agentExecution.js";
import { normalizeAgentDraft } from "./normalizeAgentDraft.js";
import { runCf1Repair } from "./repairExecution.js";
import { chooseExecutionPath } from "./tokenBudget.js";
import { validateArticleInput } from "./validateArticleInput.js";
import { classifyRepairability, verifyCf1Package } from "./verifyPackage.js";
import { articleDocumentFromText, buildArticleSourceBlocks,
  verifyArticleSourceBlocks } from "./article-document/index.js";

function safeError(error) {
  return {
    code: error?.code ?? "CF1_INTERNAL_FAILURE",
    message: error?.message ?? "Claim Foundry failed",
    retryable: error?.retryable === true,
    issues: error?.issues ?? [],
  };
}

async function tryArtifacts(writer, state, artifactRoot) {
  if (!writer || !artifactRoot) return { artifactRoot: null, files: [] };
  try {
    return await writer(state, { artifactRoot });
  } catch (error) {
    return { artifactRoot: null, files: [], warning: {
      code: "CF1_ARTIFACT_WRITE_FAILED", message: error.message,
    } };
  }
}

export async function runClaimFoundry({ article: inputArticle, options, dependencies }) {
  const config = options ?? {};
  const deps = dependencies ?? {};
  const runId = (deps.createRunId ?? createRunId)();
  if (!isRunId(runId)) throw new TypeError("createRunId dependency returned an invalid CF1 run ID");
  const startedAt = (deps.clock ?? (() => new Date()))().toISOString();
  const state = {
    run: { runId, status: "submitted", startedAt, executionPath: null, usage: null, error: null },
  };

  try {
    state.run.status = "running";
    state.article = validateArticleInput(inputArticle);
    state.articleDocument = articleDocumentFromText({ text: state.article.text,
      metadata: { title: state.article.title, language: state.article.language },
      sourceDescriptor: { consumerContentRef: state.article.consumerContentRef ?? null } });
    // ArticleDocument owns CF1's canonical source representation. Safe adapter
    // normalization (for example, removing PDF soft hyphens) must therefore be
    // reflected in the article carried into prompts, hashes, and the package.
    state.article = { ...state.article, text: state.articleDocument.canonicalText,
      contentHash: state.articleDocument.contentHash };
    state.structuralBlocks = buildArticleSourceBlocks(state.articleDocument, config.blockOptions);
    const coverage = verifyArticleSourceBlocks(state.articleDocument, state.structuralBlocks,
      config.blockOptions);
    if (!coverage.valid) {
      const error = new Error("Structural block verification failed");
      error.code = "CF1_INVALID_STRUCTURAL_BLOCKS";
      error.issues = coverage.issues;
      throw error;
    }
    state.executionDecision = chooseExecutionPath({
      article: state.article,
      structuralBlocks: state.structuralBlocks,
      sourceUnits: state.articleDocument.sourceUnits,
      modelContextTokens: config.modelContextTokens,
      promptOverheadTokens: config.promptOverheadTokens ?? 0,
      tokenEstimator: deps.tokenEstimator,
    });
    const executionMode = config.executionMode ?? "agent";
    if (!["agent", "baseline"].includes(executionMode)) {
      throw new TypeError("executionMode must be agent or baseline");
    }
    state.run.executionMode = executionMode;
    state.run.executionPath = executionMode === "agent"
      ? "agent" : `baseline_${state.executionDecision.path}`;
    const executionArgs = {
      article: state.article,
      articleDocument: state.articleDocument,
      structuralBlocks: state.structuralBlocks,
      sourceUnits: state.articleDocument.sourceUnits,
      executionDecision: state.executionDecision,
      modelRunner: deps.modelRunner,
      model: config.model,
      temperature: config.temperature ?? 0,
      timeoutMs: config.timeoutMs,
      budgetLimits: config.budgetLimits,
      clockMs: deps.clockMs,
      tokenEstimator: deps.tokenEstimator,
    };
    const execution = executionMode === "agent"
      ? await (deps.runAgent ?? runCf1Agent)({ ...executionArgs, runId, clock: deps.clock })
      : state.executionDecision.path === "normal"
        ? await (deps.runNormal ?? runNormalCf1Analysis)(executionArgs)
        : await (deps.runLong ?? runLongCf1Analysis)({ ...executionArgs, modelContextTokens: config.modelContextTokens });
    state.agentState = execution.state ?? null;
    state.agentDraft = execution.agentDraft;
    state.run.usage = execution.usage;
    state.normalizedDraft = normalizeAgentDraft(state.agentDraft, {
      article: state.article,
      articleDocument: state.articleDocument,
      structuralBlocks: state.structuralBlocks,
    });
    state.packageDraft = assembleCf1Package({
      article: state.article,
      articleDocument: state.articleDocument,
      normalizedDraft: state.normalizedDraft,
      packageId: (deps.createPackageId ?? createPackageId)(),
      runId,
      createdAt: (deps.clock ?? (() => new Date()))().toISOString(),
      diagnostics: {
        executionMode,
        executionPath: state.run.executionPath,
        sourceSizingPath: state.executionDecision.path,
        blockCount: state.structuralBlocks.length,
        usage: state.run.usage,
        ...(state.agentState ? { agentRuntime: {
          status: state.agentState.status,
          stepTrace: state.agentState.stepTrace,
          artifactNames: ["article_orientation.json", "initial_claims.json", "critic_report.json",
            "revision_plan.json", "revised_claims.json", "semantic_inventory.json",
            "selected_enrichment.json", "targets.json", "verifier_report.json",
            "cf1_agent_trace.json", "final_cf1_package.json", "claim-package.md"],
        } } : {}),
      },
    });
    state.verification = verifyCf1Package(state.packageDraft, { clock: deps.clock });
    if (!state.verification.valid && config.allowRepair !== false
      && classifyRepairability(state.verification).repairable) {
      const repaired = await (deps.runRepair ?? runCf1Repair)({
        packageDraft: state.packageDraft,
        verification: state.verification,
        modelRunner: deps.modelRunner,
        usageSoFar: state.run.usage,
        budgetLimits: config.budgetLimits,
        model: config.model,
        temperature: config.temperature ?? 0,
        timeoutMs: config.timeoutMs,
        clockMs: deps.clockMs,
        verificationClock: deps.clock,
      });
      state.packageDraft = repaired.packageDraft;
      state.verification = repaired.verification;
      state.run.usage = repaired.usage;
    }
    if (!state.verification.valid) {
      state.run.status = "verification_failed";
      state.run.error = { code: "CF1_VERIFICATION_FAILED", message: "Package verification failed",
        retryable: false, issues: state.verification.blockingErrors };
    } else {
      state.claimPackage = finalizeCf1Package(state.packageDraft, state.verification);
      state.run.status = "ready_for_evidence";
      state.run.packageId = state.claimPackage.packageId;
    }
  } catch (error) {
    if (error?.agentState) {
      state.agentState = error.agentState;
      state.run.usage = error.agentState.usage ?? state.run.usage;
    }
    state.run.status = error?.code === "CF1_VERIFICATION_FAILED" ? "verification_failed" : "failed";
    state.run.error = safeError(error);
  }
  state.run.completedAt = (deps.clock ?? (() => new Date()))().toISOString();
  state.artifactRefs = await tryArtifacts(deps.artifactWriter, state, config.artifactRoot);
  if (state.artifactRefs.warning) state.run.warnings = [state.artifactRefs.warning];
  return { run: state.run, claimPackage: state.claimPackage ?? null,
    verification: state.verification ?? null, artifactRefs: state.artifactRefs };
}
