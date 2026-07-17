import { ER1_REQUEST_SCHEMA_VERSION } from "./contract.js";
import { er1RunId } from "./ids.js";
import { loadCf1PackageFile } from "./packageLoader.js";
import { buildTargetPortfolio } from "./targetPortfolio.js";
import { buildIdentityRegistry } from "./identityRegistry.js";
import { buildQueryLanePlan } from "./queryPlanner.js";
import { buildOfflineState } from "./state.js";
import { offlineSummary, writeOfflineArtifacts } from "./artifacts.js";

export async function runOfflinePlanning({ packagePath, outputDir, expected = {}, options = {},
  idempotencyKey = "er1-offline-planning-v1" }) {
  const { packageValue, verification } = await loadCf1PackageFile(packagePath, expected);
  const request = {
    schemaVersion: ER1_REQUEST_SCHEMA_VERSION,
    packageId: packageValue.packageId,
    expectedPackageSchemaVersion: packageValue.schemaVersion,
    expectedPackageHash: packageValue.packageHash,
    idempotencyKey,
    options: { profile: options.profile || "standard", ...options },
  };
  const runId = er1RunId(packageValue.packageId, idempotencyKey);
  const portfolio = buildTargetPortfolio(packageValue);
  const identityRegistry = buildIdentityRegistry(packageValue);
  const lanePlan = buildQueryLanePlan({ packageValue, portfolio, identityRegistry, options: request.options });
  const state = buildOfflineState({ runId, packageValue, portfolio, identityRegistry,
    lanePlan, options: request.options });
  const trace = { schemaVersion: "er1.trace.v1", runId, packageId: packageValue.packageId,
    steps: state.steps, prohibitedOperations: {
      providerCalls: 0, searchCalls: 0, resolverCalls: 0, scraperCalls: 0,
      modelCalls: 0, databaseCalls: 0, migrations: 0,
    } };
  const artifacts = [
    ["request", "request.json", "request", request],
    ["package_verification", "package-verification.json", "load_package", verification],
    ["target_portfolio", "target-portfolio.json", "build_target_portfolio", portfolio],
    ["identity_registry", "identity-registry.json", "normalize_identity_registry", identityRegistry],
    ["query_lane_plan", "query-lane-plan.json", "plan_query_lanes", lanePlan],
    ["er1_state", "er1-state.json", "offline_complete", state],
    ["er1_trace", "er1-trace.json", "offline_complete", trace],
  ].map(([name, fileName, stage, value]) => ({ name, fileName, stage, value,
    mediaType: "application/json" }));
  artifacts.push({ name: "offline_summary", fileName: "offline-summary.md", stage: "offline_complete",
    value: offlineSummary({ verification, portfolio, identityRegistry, lanePlan, runId }),
    mediaType: "text/markdown" });
  const manifest = await writeOfflineArtifacts({ outputDir, runId,
    packageId: packageValue.packageId, artifacts });
  return { runId, request, verification, portfolio, identityRegistry, lanePlan, state, trace,
    manifest, outputDir };
}
