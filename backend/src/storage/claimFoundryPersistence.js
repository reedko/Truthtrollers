import { createLineageId } from "../claim-foundry/ids.js";
import { Cf1Error } from "../claim-foundry/errors.js";
import { withTransaction } from "./dbTransaction.js";
import { createCf1Binding, markPriorBindingsSuperseded } from "./claimFoundryBindingStore.js";
import { insertCf1Package, lockLineageHead } from "./claimFoundryPackageStore.js";
import { completeCf1Run, lockCf1Run } from "./claimFoundryRunStore.js";

function assertRunMatches(run, claimPackage) {
  if (!run || run.status !== "running") {
    throw new Cf1Error("CF1_RUN_NOT_RUNNING", "CF1 run must be running before finalization", { status: 409 });
  }
  if (run.run_id !== claimPackage.runId || run.input_hash !== claimPackage.article.contentHash
    || run.pipeline_version !== claimPackage.pipelineVersion) {
    throw new Cf1Error("CF1_RUN_PACKAGE_MISMATCH", "Run identity does not match package", { status: 409 });
  }
}

export async function persistCompletedCf1Run({ claimPackage, consumerKey,
  consumerContentRef = null, contentId = null, supersedesPackageId = null,
  usage = {}, artifactRoot = null }, dependencies = {}) {
  const transact = dependencies.withTransaction ?? withTransaction;
  const makeLineageId = dependencies.createLineageId ?? createLineageId;
  return transact(async ({ query }) => {
    const run = await lockCf1Run(query, claimPackage.runId);
    assertRunMatches(run, claimPackage);
    const prior = await lockLineageHead(query, supersedesPackageId);
    const lineageId = prior?.lineage_id ?? makeLineageId();
    const packageVersion = prior ? prior.package_version + 1 : 1;
    await insertCf1Package(query, { claimPackage, lineageId, packageVersion, supersedesPackageId });
    const bindingId = await createCf1Binding(query, { packageId: claimPackage.packageId,
      consumerKey, consumerContentRef, contentId });
    if (prior) await markPriorBindingsSuperseded(query, prior.package_id);
    await completeCf1Run(query, { runId: claimPackage.runId, packageId: claimPackage.packageId,
      usage, artifactRoot });
    return { packageId: claimPackage.packageId, lineageId, packageVersion, bindingId };
  }, { pool: dependencies.pool });
}
