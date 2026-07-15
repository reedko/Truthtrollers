import { CF1_PIPELINE_VERSION, CF1_SCHEMA_VERSION } from "./contract.js";
import { hashPackage } from "./canonicalJson.js";
import { isPackageId, isRunId } from "./ids.js";
import { Cf1Error } from "./errors.js";

function requireIdentity(condition, message, path) {
  if (!condition) throw new Cf1Error("CF1_INVALID_PACKAGE_IDENTITY", message, { status: 422, path });
}

export function assembleCf1Package({
  article,
  articleDocument,
  normalizedDraft,
  packageId,
  runId,
  packageVersion = 1,
  supersedesPackageId = null,
  createdAt = new Date().toISOString(),
  diagnostics = {},
}) {
  requireIdentity(isPackageId(packageId), "Invalid CF1 package ID", "/packageId");
  requireIdentity(isRunId(runId), "Invalid CF1 run ID", "/runId");
  requireIdentity(Number.isInteger(packageVersion) && packageVersion > 0, "Invalid package version", "/packageVersion");

  return {
    schemaVersion: CF1_SCHEMA_VERSION,
    pipelineVersion: CF1_PIPELINE_VERSION,
    packageId,
    packageVersion,
    supersedesPackageId,
    runId,
    status: "verification_failed",
    createdAt,
    article: structuredClone(article),
    sourceDocument: {
      schemaVersion: articleDocument.schemaVersion,
      sourceKind: articleDocument.sourceKind,
      sourceFamily: articleDocument.sourceFamily,
      adapterIdentity: structuredClone(articleDocument.adapterIdentity),
      structureProfile: structuredClone(articleDocument.structureProfile),
      contentHash: articleDocument.contentHash,
      metadata: {
        bibliographicMetadata: structuredClone(
          articleDocument.metadata?.bibliographicMetadata ?? {}),
      },
      sourceDescriptor: structuredClone(articleDocument.sourceDescriptor),
      diagnostics: structuredClone(articleDocument.diagnostics),
    },
    sourceAtoms: structuredClone(articleDocument.atoms),
    sourceUnits: structuredClone(articleDocument.sourceUnits),
    sourceLinks: structuredClone(articleDocument.links),
    sourceCitationMarkers: structuredClone(articleDocument.citationMarkers ?? []),
    sourceReferences: structuredClone(articleDocument.references ?? []),
    sourceIdentityBundles: structuredClone(normalizedDraft.sourceIdentityBundles ?? []),
    semanticBlocks: structuredClone(normalizedDraft.semanticBlocks),
    rawAssertions: structuredClone(normalizedDraft.rawAssertions),
    articleMap: structuredClone(normalizedDraft.articleMap),
    internalConsistencyFindings: structuredClone(normalizedDraft.internalConsistencyFindings),
    selectedEvaluationClaims: structuredClone(normalizedDraft.selectedEvaluationClaims),
    phase3Targets: structuredClone(normalizedDraft.phase3Targets),
    evidenceNeedCards: structuredClone(normalizedDraft.evidenceNeedCards),
    diagnostics: {
      ...structuredClone(diagnostics),
      selectionCountException: normalizedDraft.selectionCountException ?? null,
      agentWarnings: [...normalizedDraft.agentWarnings],
    },
    verification: null,
    packageHash: "",
  };
}

export function finalizeCf1Package(packageDraft, verification) {
  if (!verification?.valid || verification.blockingErrors?.length) {
    throw new Cf1Error("CF1_VERIFICATION_FAILED", "Only a valid package can be finalized", {
      status: 422,
      issues: verification?.blockingErrors,
    });
  }
  const finalized = structuredClone(packageDraft);
  finalized.status = "ready_for_evidence";
  finalized.verification = structuredClone(verification);
  finalized.packageHash = hashPackage(finalized);
  return finalized;
}
