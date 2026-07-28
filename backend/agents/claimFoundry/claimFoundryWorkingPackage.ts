import { createHash } from "node:crypto";
import { z } from "zod";
import { selectedClaimSchema } from "./claimFoundrySchemas.js";

export const CF6_WHOLE_ARTICLE_STATE_VERSION =
  "cf6.wholeArticle.workingPackage.v2.1" as const;
export const CF6_WHOLE_ARTICLE_TOOL_SCHEMA_VERSION =
  "cf6.wholeArticle.tools.v2.1" as const;

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,95}$/);
const unitId = z.string().regex(/^U\d{4,}$/);
const nonempty = z.string().trim().min(1).max(10_000);

export const thesisSchema = z.object({
  thesisId: id,
  statement: nonempty,
  groundingUnitIds: z.array(unitId).min(1),
}).strict();

export const wholeArticleClaimSchema = selectedClaimSchema.extend({
  thesisIds: z.array(id),
  thesisEffect: nonempty,
}).strict();

export const regionDispositionSchema = z.object({
  regionId: id,
  reasonCode: id,
  note: nonempty.optional(),
}).strict();

export const persistedRegionDispositionSchema = regionDispositionSchema.extend({
  dispositionMode: z.literal("bulk").optional(),
  originatingToolCallId: z.string().min(8).max(200).optional(),
}).strict();

export const thesisDispositionSchema = z.object({
  thesisId: id,
  reasonCode: id,
  note: nonempty.optional(),
}).strict();

export const deterministicDiagnosticSchema = z.object({
  diagnosticId: id,
  code: z.enum([
    "INVALID_GROUNDING",
    "DUPLICATE_ID",
    "INVALID_REFERENCE",
    "UNACCOUNTED_REGION",
    "UNACCOUNTED_THESIS",
    "CLAIM_WITHOUT_THESIS",
    "SOURCE_INTEGRITY",
    "SCHEMA_ERROR",
  ]),
  itemIds: z.array(id),
  sourceUnitIds: z.array(unitId),
  explanation: nonempty,
  blocking: z.literal(true),
}).strict();

export const inspectionSchema = z.object({
  inspectionId: id,
  packageRevision: z.number().int().nonnegative(),
  packageHash: z.string().length(64),
  deterministicClean: z.boolean(),
  deterministicDiagnostics: z.array(deterministicDiagnosticSchema),
  nonBlockingHeuristics: z.array(z.object({
    diagnosticId: id,
    code: id,
    explanation: nonempty,
  }).strict()),
  coveredRegionIds: z.array(id),
  dispositionedRegionIds: z.array(id),
  unaccountedRegionIds: z.array(id),
  linkedThesisIds: z.array(id),
  dispositionedThesisIds: z.array(id),
  unaccountedThesisIds: z.array(id),
  claimIdsWithoutThesis: z.array(id),
  createdAt: z.string().datetime(),
}).strict();

export const wholeArticleWorkingPackageSchema = z.object({
  version: z.literal(CF6_WHOLE_ARTICLE_STATE_VERSION),
  status: z.enum(["working", "final"]),
  runId: id,
  contentId: id,
  contentHash: z.string().length(64),
  sourceUnitManifestHash: z.string().length(64),
  packageRevision: z.number().int().nonnegative(),
  packageHash: z.string().length(64),
  theses: z.array(thesisSchema),
  claims: z.array(wholeArticleClaimSchema),
  regionDispositions: z.array(persistedRegionDispositionSchema),
  thesisDispositions: z.array(thesisDispositionSchema),
  acknowledgedDiagnosticIds: z.array(id),
  latestInspection: inspectionSchema.nullable(),
  finalPackageId: id.nullable(),
}).strict();

export type Thesis = z.infer<typeof thesisSchema>;
export type WholeArticleClaim = z.infer<typeof wholeArticleClaimSchema>;
export type RegionDisposition =
  z.infer<typeof persistedRegionDispositionSchema>;
export type ThesisDisposition = z.infer<typeof thesisDispositionSchema>;
export type WholeArticleInspection = z.infer<typeof inspectionSchema>;
export type WholeArticleWorkingPackage =
  z.infer<typeof wholeArticleWorkingPackageSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function hashWholeArticleWorkingPackage(
  value: Omit<WholeArticleWorkingPackage, "packageHash"> & { packageHash?: string },
) {
  const { latestInspection: _latestInspection, ...hashable } = value;
  return createHash("sha256")
    .update(canonical({ ...hashable, packageHash: null }))
    .digest("hex");
}

export function createWholeArticleWorkingPackage(input: {
  runId: string;
  contentId: string;
  contentHash: string;
  sourceUnitManifestHash: string;
}): WholeArticleWorkingPackage {
  const draft = {
    version: CF6_WHOLE_ARTICLE_STATE_VERSION,
    status: "working" as const,
    ...input,
    packageRevision: 0,
    packageHash: "0".repeat(64),
    theses: [],
    claims: [],
    regionDispositions: [],
    thesisDispositions: [],
    acknowledgedDiagnosticIds: [],
    latestInspection: null,
    finalPackageId: null,
  };
  return wholeArticleWorkingPackageSchema.parse({
    ...draft,
    packageHash: hashWholeArticleWorkingPackage(draft),
  });
}
