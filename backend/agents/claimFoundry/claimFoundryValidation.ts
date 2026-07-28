import { randomUUID } from "node:crypto";
import type { ArticleDocument } from "./claimFoundryContext.js";
import type { ValidationFinding, ValidationReport, WorkingPackage } from "./claimFoundrySchemas.js";
import { workingPackageSchema } from "./claimFoundrySchemas.js";
import {
  uncoveredRegions,
  type ContentRegionInspection,
} from "./claimFoundryCoverage.js";

const coverage = [
  ["schema and identifier integrity", "deterministic", "passed"],
  ["source authorization and offsets", "deterministic", "passed"],
  ["semantic grounding adequacy", "later_semantic_review", "requires_review"],
  ["atomicity and independent verdictability", "later_semantic_review", "requires_review"],
  ["material omission and treatment correctness", "unavailable", "not_run"],
  ["attribution correctness and polarity", "later_semantic_review", "requires_review"],
] as const;

export function validateWorkingPackage(
  pkg: unknown,
  document: ArticleDocument,
  regions: ContentRegionInspection[] = [],
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const parsed = workingPackageSchema.safeParse(pkg);
  if (!parsed.success) {
    findings.push({
      findingId: `F-${randomUUID()}`, code: "SCHEMA_ERROR", severity: "error",
      itemIds: [], sourceUnitIds: [], explanation: parsed.error.issues.map(x => x.message).join("; "),
      checkMode: "deterministic",
    });
  } else {
    const unitIds = new Set(document.sourceUnits.map(unit => unit.unitId));
    const invalidOffsets = document.sourceUnits.filter(unit =>
      !Number.isInteger(unit.sourceOffsets?.start) || !Number.isInteger(unit.sourceOffsets?.end) ||
      unit.sourceOffsets.start < 0 || unit.sourceOffsets.end <= unit.sourceOffsets.start ||
      unit.sourceOffsets.end > document.canonicalText.length ||
      document.canonicalText.slice(unit.sourceOffsets.start, unit.sourceOffsets.end) !== unit.text);
    if (invalidOffsets.length) findings.push({
      findingId: `F-${randomUUID()}`, code: "SOURCE_LOSS", severity: "error",
      itemIds: [], sourceUnitIds: invalidOffsets.map(unit => unit.unitId),
      explanation: "Authorized source-unit offsets or spans do not match canonical content",
      checkMode: "deterministic",
    });
    const seen = new Set<string>();
    for (const claim of parsed.data.selectedClaims) {
      if (seen.has(claim.claimId)) findings.push({
        findingId: `F-${randomUUID()}`, code: "DUPLICATE", severity: "error",
        itemIds: [claim.claimId], sourceUnitIds: [], explanation: "Duplicate claim ID",
        checkMode: "deterministic",
      });
      seen.add(claim.claimId);
      const referenced = [...claim.attributionUnitIds, ...claim.substantiveGroundingUnitIds,
        ...claim.attributionLayers.flatMap(layer => layer.unitIds)];
      const foreign = referenced.filter(unitId => !unitIds.has(unitId));
      if (foreign.length) findings.push({
        findingId: `F-${randomUUID()}`, code: "INVALID_GROUNDING", severity: "error",
        itemIds: [claim.claimId], sourceUnitIds: foreign,
        explanation: "Claim references source units outside the authorized content",
        checkMode: "deterministic",
      });
    }
    if (parsed.data.runId === "" || parsed.data.contentHash !== document.contentHash) findings.push({
      findingId: `F-${randomUUID()}`, code: "SOURCE_LOSS", severity: "error",
      itemIds: [], sourceUnitIds: [], explanation: "Package identity does not match authorized content",
      checkMode: "deterministic",
    });
    if (parsed.data.selectedClaims.length < 5) findings.push({
      findingId: `F-${randomUUID()}`, code: "THIN_PORTFOLIO", severity: "warning",
      itemIds: parsed.data.selectedClaims.map(x => x.claimId), sourceUnitIds: [],
      explanation: "Portfolio contains fewer than five claims; do not pad",
      checkMode: "heuristic",
    });
  }
  const uncovered = uncoveredRegions(regions);
  if (uncovered.length) findings.push({
    findingId: `F-${randomUUID()}`,
    code: "UNINSPECTED_MAJOR_REGION",
    severity: "error",
    itemIds: uncovered.map(region => region.regionId),
    sourceUnitIds: [],
    explanation: `${uncovered.length} major content region(s) remain unseen or undispositioned`,
    checkMode: "deterministic",
  });
  return {
    reportId: `VR-${randomUUID()}`, createdAt: new Date().toISOString(),
    hardPass: !findings.some(finding => finding.severity === "error"),
    findings, coverage: coverage.map(([check, mode, status]) => ({ check, mode, status })),
  };
}
