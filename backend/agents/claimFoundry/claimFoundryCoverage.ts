import { z } from "zod";
import { buildArticleSourceBlocks } from "../../src/claim-foundry/article-document/sourceBlocks.js";
import type { ArticleDocument } from "./claimFoundryContext.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";

export const contentRegionInspectionSchema = z.object({
  regionId: z.string().min(1).max(96),
  heading: z.string().nullable(),
  structuralType: z.string().min(1),
  startUnitId: z.string().regex(/^U\d{4,}$/),
  endUnitId: z.string().regex(/^U\d{4,}$/),
  unitCount: z.number().int().positive(),
  status: z.enum(["uninspected", "sampled", "inspected", "excluded"]),
  sampledUnitIds: z.array(z.string().regex(/^U\d{4,}$/)),
  candidateBearing: z.enum(["unknown", "likely", "unlikely"]),
  dispositionReason: z.string().min(1).nullable(),
}).strict();

export type ContentRegionInspection = z.infer<typeof contentRegionInspectionSchema>;

export const coverageUpdateSchema = z.object({
  regionId: z.string().min(1).max(96),
  status: z.enum(["sampled", "inspected", "excluded"]),
  candidateBearing: z.enum(["unknown", "likely", "unlikely"]),
  dispositionReason: z.string().min(1).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.status === "excluded" && !value.dispositionReason?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dispositionReason"],
      message: "Excluded regions require a non-empty disposition reason" });
  }
});

export type CoverageUpdate = z.infer<typeof coverageUpdateSchema>;

export function deriveContentRegions(document: ArticleDocument): ContentRegionInspection[] {
  const blocks = buildArticleSourceBlocks(document as any, { maxBlocks: 100 }) as any[];
  return blocks.filter(block => block.sourceUnitIds.length > 0).map((block, index) => ({
    regionId: `REGION-${String(index + 1).padStart(3, "0")}`,
    heading: block.heading ?? null,
    structuralType: block.structuralType ?? "unknown",
    startUnitId: block.sourceUnitIds[0]!,
    endUnitId: block.sourceUnitIds[block.sourceUnitIds.length - 1]!,
    unitCount: block.sourceUnitIds.length,
    status: "uninspected" as const,
    sampledUnitIds: [],
    candidateBearing: "unknown" as const,
    dispositionReason: null,
  }));
}

export function updateCoverageFromRead(
  regions: ContentRegionInspection[],
  document: ArticleDocument,
  readUnitIds: string[],
): ContentRegionInspection[] {
  const order = new Map(document.sourceUnits.map((unit, index) => [unit.unitId, index]));
  return regions.map(region => {
    const start = order.get(region.startUnitId);
    const end = order.get(region.endUnitId);
    if (start === undefined || end === undefined) {
      throw new ClaimFoundryError("CF6_INVALID_PACKAGE", `Coverage region ${region.regionId} has invalid bounds`);
    }
    const additions = readUnitIds.filter(id => {
      const index = order.get(id);
      return index !== undefined && index >= start && index <= end;
    });
    if (!additions.length || region.status === "excluded") return region;
    const sampledUnitIds = [...new Set([...region.sampledUnitIds, ...additions])]
      .sort((a, b) => order.get(a)! - order.get(b)!);
    return {
      ...region,
      sampledUnitIds,
      status: sampledUnitIds.length >= region.unitCount ? "inspected" as const : "sampled" as const,
    };
  });
}

export function applyCoverageUpdates(
  regions: ContentRegionInspection[],
  rawUpdates: CoverageUpdate[],
): ContentRegionInspection[] {
  const updates = z.array(coverageUpdateSchema).parse(rawUpdates);
  const byId = new Map(updates.map(update => [update.regionId, update]));
  for (const update of updates) {
    if (!regions.some(region => region.regionId === update.regionId)) {
      throw new ClaimFoundryError("CF6_NOT_FOUND", `Unknown coverage region ${update.regionId}`);
    }
  }
  return regions.map(region => {
    const update = byId.get(region.regionId);
    if (!update) return region;
    if (update.status === "inspected" && region.sampledUnitIds.length < region.unitCount) {
      throw new ClaimFoundryError("CF6_INVALID_PACKAGE",
        `Region ${region.regionId} cannot be marked inspected before all units are read`);
    }
    if (update.status !== "excluded" && region.sampledUnitIds.length === 0) {
      throw new ClaimFoundryError("CF6_INVALID_PACKAGE",
        `Region ${region.regionId} must be sampled before it can be dispositioned`);
    }
    return {
      ...region,
      status: update.status,
      candidateBearing: update.candidateBearing,
      dispositionReason: update.dispositionReason,
    };
  });
}

export function uncoveredRegions(regions: ContentRegionInspection[]): ContentRegionInspection[] {
  return regions.filter(region =>
    region.status === "uninspected" ||
    (region.status === "sampled" && region.candidateBearing === "unknown" &&
      !region.dispositionReason?.trim()));
}
