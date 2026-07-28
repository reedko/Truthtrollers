import { articleDocumentFromText } from "../../../src/claim-foundry/article-document/fromText.js";
import { createClaimFoundryTools } from "../../claimFoundry/claimFoundryTools.js";
import { hashValue, MemoryClaimFoundryPersistence } from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import type { SelectedClaim, WorkingPackage } from "../../claimFoundry/claimFoundrySchemas.js";

export const document = articleDocumentFromText({
  text: "Main finding\n\nAlice reported that rainfall increased by 20 percent in 2025.\n\nA cited study challenged that conclusion.",
  metadata: { title: "Fixture" },
});
export const manifestHash = hashValue(document.sourceUnits.map((unit: any) => ({
  unitId: unit.unitId, text: unit.text, sourceOffsets: unit.sourceOffsets,
})));

export function claim(claimId = "C1", unitId = document.sourceUnits[1].unitId): SelectedClaim {
  return {
    claimId, surfaceStatement: "Alice reported that rainfall increased by 20 percent in 2025.",
    substantiveAssertion: "Rainfall increased by 20 percent in 2025.",
    attributionLayers: [{ supplier: "Alice", supplierKind: "person",
      reportingVoice: "reported", unitIds: [unitId] }],
    contentSupplier: "Alice", contentSupplierKind: "person", reportingVoice: "reported",
    articleTreatment: "reported", polarity: "positive", scope: "Rainfall in 2025",
    attributionUnitIds: [unitId], substantiveGroundingUnitIds: [unitId],
    verificationTarget: "Rainfall increased by 20 percent in 2025.",
    themeIds: ["T1"], materiality: "central", selectionRationale: "Load-bearing quantified finding",
    identityHints: ["Alice", "2025"],
  };
}

export function pkg(runId = "run-1", contentId = "content-1", claims = [claim()]): WorkingPackage {
  return {
    schemaVersion: "cf6.semanticCore.v1", runId, contentId,
    contentHash: document.contentHash, sourceUnitManifestHash: manifestHash,
    status: "working", selectedClaims: claims, dispositions: [], validationReports: [],
    audit: { instructionVersion: "test", toolSchemaVersion: "cf6.tools.v1",
      model: "none", codeVersion: "test" }, packageHash: null,
  };
}

export async function harness(runId = "run-1", budgets = { maxToolCalls: 100, maxUnitsRead: 100, maxRepairRounds: 2 }) {
  const persistence = new MemoryClaimFoundryPersistence();
  await persistence.create(createRunState({
    runId, contentId: "content-1", contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash, budgets, traceId: null,
    versions: { instruction: "test", toolSchema: "cf6.tools.v1", model: "none", code: "test" },
  }));
  const tools = createClaimFoundryTools({
    runId, contentId: "content-1", articleDocument: document, persistence,
  });
  return { persistence, tools };
}
