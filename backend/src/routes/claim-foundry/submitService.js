import { CF1_PIPELINE_VERSION } from "../../claim-foundry/contract.js";
import { createRunId } from "../../claim-foundry/ids.js";
import { runClaimFoundry } from "../../claim-foundry/runClaimFoundry.js";
import { validateArticleInput } from "../../claim-foundry/validateArticleInput.js";
import { createCf1OptionsHash, deriveCf1IdempotencyKey } from "../../storage/claimFoundryIdentity.js";
import { persistCompletedCf1Run } from "../../storage/claimFoundryPersistence.js";
import { createOrLoadCf1Run, markCf1RunFailed, markCf1RunRunning } from "../../storage/claimFoundryRunStore.js";
import { Cf1Error } from "../../claim-foundry/errors.js";

const PUBLIC_OPTION_KEYS = new Set(["persist", "includePackageInResponse", "allowRepair", "idempotencyKey"]);

function executionOptions(requestOptions, defaults) {
  if (requestOptions != null && (typeof requestOptions !== "object" || Array.isArray(requestOptions))) {
    throw new Cf1Error("CF1_INVALID_OPTIONS", "Options must be an object", { status: 400 });
  }
  const supplied = requestOptions ?? {};
  const unknown = Object.keys(supplied).filter((key) => !PUBLIC_OPTION_KEYS.has(key));
  if (unknown.length) throw new Cf1Error("CF1_INVALID_OPTIONS",
    `Unsupported public option: ${unknown[0]}`, { status: 400 });
  for (const key of ["persist", "includePackageInResponse", "allowRepair"]) {
    if (supplied[key] !== undefined && typeof supplied[key] !== "boolean") {
      throw new Cf1Error("CF1_INVALID_OPTIONS", `${key} must be boolean`, { status: 400 });
    }
  }
  return { ...defaults, ...(supplied.persist === undefined ? {} : { persist: supplied.persist }),
    ...(supplied.allowRepair === undefined ? {} : { allowRepair: supplied.allowRepair }) };
}

function checkedKey(explicitKey, headerKey, identity) {
  if (explicitKey && headerKey && explicitKey !== headerKey) {
    throw new Cf1Error("CF1_IDEMPOTENCY_CONFLICT", "Body and header idempotency keys must match", { status: 409 });
  }
  const key = explicitKey ?? headerKey ?? deriveCf1IdempotencyKey(identity);
  if (typeof key !== "string" || !key || key.length > 200) {
    throw new Cf1Error("CF1_INVALID_IDEMPOTENCY_KEY", "Idempotency key must contain 1 to 200 characters", { status: 400 });
  }
  return key;
}

export async function submitCf1Package(request, dependencies) {
  const normalizedArticle = validateArticleInput(request.article);
  const options = executionOptions(request.options, dependencies.defaultOptions ?? {});
  if (options.persist === false) throw new Cf1Error("CF1_PERSISTENCE_REQUIRED", "Public API packages must be persisted", { status: 400 });
  const optionsHash = createCf1OptionsHash(options);
  const identity = { consumerKey: request.consumerKey,
    consumerContentRef: normalizedArticle.consumerContentRef ?? "",
    inputHash: normalizedArticle.contentHash, optionsHash, pipelineVersion: CF1_PIPELINE_VERSION };
  const idempotencyKey = checkedKey(request.options?.idempotencyKey,
    request.headerIdempotencyKey, identity);
  const runId = (dependencies.createRunId ?? createRunId)();
  const created = await createOrLoadCf1Run(dependencies.query, { ...identity, idempotencyKey, runId });
  if (!created.created) return { existing: true, run: created.run };
  await markCf1RunRunning(dependencies.query, runId);
  try {
    const result = await (dependencies.runClaimFoundry ?? runClaimFoundry)({ article: normalizedArticle,
      options, dependencies: { ...dependencies.runnerDependencies, createRunId: () => runId } });
    if (!result.claimPackage) {
      const failure = result.run.error ?? { code: "CF1_VERIFICATION_FAILED", message: "Package verification failed" };
      throw Object.assign(new Cf1Error(failure.code, failure.message, {
        status: result.run.status === "verification_failed" ? 422 : 500,
        retryable: failure.retryable, issues: failure.issues,
      }), { runStatus: result.run.status });
    }
    await (dependencies.persistCompletedRun ?? persistCompletedCf1Run)({ claimPackage: result.claimPackage,
      consumerKey: request.consumerKey, consumerContentRef: normalizedArticle.consumerContentRef ?? null,
      contentId: request.bindingContentId ?? null, usage: result.run.usage }, { pool: dependencies.pool });
    return { ...result, existing: false, artifactPath: result.artifactRefs?.artifactRoot ?? "" };
  } catch (error) {
    const runStatus = error.runStatus ?? "failed";
    await markCf1RunFailed(dependencies.query, runId, { code: error.code ?? "CF1_INTERNAL_FAILURE",
      message: error.message, retryable: error.retryable === true, issues: error.issues ?? [],
      status: runStatus });
    error.runId = runId;
    error.runStatus = runStatus;
    throw error;
  }
}
