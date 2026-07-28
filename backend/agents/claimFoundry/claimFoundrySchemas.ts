import { z } from "zod";

export const CF6_SCHEMA_VERSION = "cf6.semanticCore.v1" as const;
export const CF6_TOOL_SCHEMA_VERSION = "cf6.tools.v1" as const;

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,95}$/);
const unitId = z.string().regex(/^U\d{4,}$/);
const nonempty = z.string().trim().min(1).max(10_000);

export const attributionLayerSchema = z.object({
  supplier: nonempty.or(z.literal("unknown")),
  supplierKind: z.enum(["person", "organization", "study", "document", "article_voice", "unknown"]),
  reportingVoice: nonempty,
  unitIds: z.array(unitId).min(1),
}).strict();

export const selectedClaimSchema = z.object({
  claimId: id,
  surfaceStatement: nonempty,
  substantiveAssertion: nonempty,
  attributionLayers: z.array(attributionLayerSchema).max(3),
  contentSupplier: nonempty.or(z.literal("unknown")),
  contentSupplierKind: z.enum(["person", "organization", "study", "document", "article_voice", "unknown"]),
  reportingVoice: nonempty,
  articleTreatment: z.enum(["adopted", "challenged", "reported"]),
  polarity: z.enum(["positive", "negative", "mixed", "unknown"]),
  scope: nonempty,
  attributionUnitIds: z.array(unitId),
  substantiveGroundingUnitIds: z.array(unitId).min(1),
  verificationTarget: nonempty,
  themeIds: z.array(id),
  materiality: z.enum(["central", "major", "supporting"]),
  selectionRationale: nonempty,
  identityHints: z.array(nonempty).max(20),
}).strict();

export const dispositionSchema = z.object({
  candidateId: id,
  decision: z.enum(["excluded", "abstained", "merged", "deferred"]),
  reason: nonempty,
  sourceUnitIds: z.array(unitId),
  material: z.boolean(),
  humanReviewRequired: z.boolean(),
  mergedIntoClaimId: id.nullable(),
}).strict();

export const validationFindingSchema = z.object({
  findingId: id,
  code: z.enum([
    "INVALID_GROUNDING", "COMPOUND_UNIT", "DUPLICATE", "AMBIGUOUS_REFERENCE",
    "PROVENANCE_CONFLATION", "TREATMENT_CONFLICT", "SOURCE_LOSS",
    "REPORTING_FRAME_FUSION", "POLARITY_FLIP", "CHALLENGED_DROPPED",
    "OVER_SELECTION", "UNDER_SELECTION", "SCHEMA_ERROR", "THIN_PORTFOLIO",
    "UNINSPECTED_MAJOR_REGION",
  ]),
  severity: z.enum(["error", "warning", "review"]),
  itemIds: z.array(id),
  sourceUnitIds: z.array(unitId),
  explanation: nonempty,
  checkMode: z.enum(["deterministic", "heuristic", "later_semantic_review", "unavailable"]),
}).strict();

export const validationReportSchema = z.object({
  reportId: id,
  createdAt: z.string().datetime(),
  hardPass: z.boolean(),
  findings: z.array(validationFindingSchema),
  coverage: z.array(z.object({
    check: nonempty,
    mode: z.enum(["deterministic", "heuristic", "later_semantic_review", "unavailable"]),
    status: z.enum(["passed", "failed", "not_run", "requires_review"]),
  }).strict()),
}).strict();

export const repairRecordSchema = z.object({
  repairId: id,
  findingIds: z.array(id).min(1),
  operation: nonempty,
  beforeHash: z.string().length(64),
  afterHash: z.string().length(64),
  reviewRequired: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();

export const evidenceReadyProjectionSchema = z.object({
  targetId: id,
  canonicalTargetText: nonempty,
  verificationTarget: nonempty,
  scopeAndQualifiers: nonempty,
  contentSupplier: nonempty.or(z.literal("unknown")),
  identityHints: z.array(nonempty),
  mustMatch: z.array(nonempty),
  usefulSourceRoles: z.array(nonempty),
  rejectionBoundaries: z.array(nonempty),
  groundingReferences: z.array(unitId).min(1),
}).strict();

export const workingPackageSchema = z.object({
  schemaVersion: z.literal(CF6_SCHEMA_VERSION),
  runId: id,
  contentId: id,
  contentHash: z.string().length(64),
  sourceUnitManifestHash: z.string().length(64),
  status: z.enum(["working", "final", "abstained"]),
  selectedClaims: z.array(selectedClaimSchema).max(15),
  dispositions: z.array(dispositionSchema),
  validationReports: z.array(validationReportSchema),
  audit: z.object({
    instructionVersion: nonempty,
    toolSchemaVersion: z.literal(CF6_TOOL_SCHEMA_VERSION),
    model: nonempty,
    codeVersion: nonempty,
  }).strict(),
  packageHash: z.string().length(64).nullable(),
}).strict();

export type SelectedClaim = z.infer<typeof selectedClaimSchema>;
export type WorkingPackage = z.infer<typeof workingPackageSchema>;
export type ValidationFinding = z.infer<typeof validationFindingSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type EvidenceReadyProjection = z.infer<typeof evidenceReadyProjectionSchema>;
