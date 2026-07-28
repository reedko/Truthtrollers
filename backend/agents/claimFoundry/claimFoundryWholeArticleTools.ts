import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import { deriveContentRegions } from "./claimFoundryCoverage.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";
import { inspectWholeArticleWorkingPackage } from "./claimFoundryInspection.js";
import {
  hashValue,
  PersistedMutationError,
} from "./claimFoundryPersistence.js";
import {
  transitionState,
  type ClaimFoundryRunState,
  type RunStatus,
} from "./claimFoundryState.js";
import {
  createWholeArticleWorkingPackage,
  hashWholeArticleWorkingPackage,
  regionDispositionSchema,
  thesisDispositionSchema,
  thesisSchema,
  wholeArticleClaimSchema,
  wholeArticleWorkingPackageSchema,
} from "./claimFoundryWorkingPackage.js";

const idem = z.string().min(8).max(200);
const objectId = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,95}$/);

export const wholeArticleToolSchemas = {
  updateWorkingPackage: z.object({
    idempotencyKey: idem,
    expectedPackageRevision: z.number().int().nonnegative(),
    setTheses: z.array(thesisSchema).max(10).default([]),
    upsertClaims: z.array(wholeArticleClaimSchema).max(20).default([]),
    removeClaimIds: z.array(objectId).max(20).default([]),
    setRegionDispositions: z.array(regionDispositionSchema).max(100).default([]),
    setThesisDispositions: z.array(thesisDispositionSchema).max(20).default([]),
    acknowledgeDiagnosticIds: z.array(objectId).max(100).default([]),
    dispositionRemainingRegions: z.object({
      reasonCode: objectId,
      optionalNote: z.string().trim().min(1).max(10_000).optional(),
      exceptions: z.array(objectId).max(100).optional(),
    }).strict().optional(),
  }).strict(),
  inspectWorkingPackage: z.object({
    idempotencyKey: idem,
    expectedPackageRevision: z.number().int().nonnegative(),
  }).strict(),
  finalizeWorkingPackage: z.object({
    idempotencyKey: idem,
    expectedPackageRevision: z.number().int().nonnegative(),
    expectedPackageHash: z.string().length(64),
    inspectionId: objectId,
    acknowledgeDiagnosticIds: z.array(objectId).max(100).default([]),
  }).strict(),
  abstainOrRequestReview: z.object({
    idempotencyKey: idem,
    mode: z.enum(["abstain", "request_review"]),
    reasonCode: objectId,
    reason: z.string().trim().min(1).max(10_000),
    relatedClaimIds: z.array(objectId).max(100).default([]),
    relatedThesisIds: z.array(objectId).max(20).default([]),
    relatedUnitIds: z.array(z.string().regex(/^U\d{4,}$/)).max(200).default([]),
  }).strict(),
} as const;

function authorize(ctx: ClaimFoundryToolContext, state: ClaimFoundryRunState) {
  if (state.contentId !== ctx.contentId ||
    state.contentHash !== ctx.articleDocument.contentHash) {
    throw new ClaimFoundryError(
      "CF6_UNAUTHORIZED_CONTENT",
      "Run is not authorized for this content",
    );
  }
  const manifestHash = hashValue(ctx.articleDocument.sourceUnits.map(unit => ({
    unitId: unit.unitId,
    text: unit.text,
    sourceOffsets: unit.sourceOffsets,
  })));
  if (state.sourceUnitManifestHash !== manifestHash) {
    throw new ClaimFoundryError(
      "CF6_UNAUTHORIZED_CONTENT",
      "Source-unit manifest does not match the authorized run",
    );
  }
  if ([
    "completed",
    "abstained",
    "budget_exhausted",
    "failed",
    "awaiting_review",
  ].includes(state.status)) {
    throw new ClaimFoundryError(
      "CF6_INVALID_STATE_TRANSITION",
      "TERMINAL_RUN",
    );
  }
  if (state.counters.toolCalls >= state.budgets.maxToolCalls) {
    throw new ClaimFoundryError("CF6_BUDGET_EXCEEDED", "BUDGET_EXCEEDED");
  }
}

function counted(state: ClaimFoundryRunState, next: RunStatus) {
  const changed = {
    ...state,
    counters: {
      ...state.counters,
      toolCalls: state.counters.toolCalls + 1,
    },
    updatedAt: new Date().toISOString(),
  };
  return transitionState(changed, next);
}

function uniqueIds(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new ClaimFoundryError(
      "CF6_INVALID_PACKAGE",
      `DUPLICATE_ID: ${label}`,
    );
  }
}

function unitIds(ctx: ClaimFoundryToolContext) {
  return new Set(ctx.articleDocument.sourceUnits.map(unit => unit.unitId));
}

function assertGrounding(
  allowed: Set<string>,
  ids: string[],
  itemId: string,
) {
  const foreign = ids.filter(id => !allowed.has(id));
  if (foreign.length) {
    throw new ClaimFoundryError(
      "CF6_INVALID_PACKAGE",
      `INVALID_GROUNDING: ${itemId}: ${foreign.join(",")}`,
    );
  }
}

export function createWholeArticleClaimFoundryTools(ctx: ClaimFoundryToolContext) {
  return {
    async update_working_package(
      input: unknown,
      invocation?: { toolCallId?: string | null },
    ) {
      const args = wholeArticleToolSchemas.updateWorkingPackage.parse(input);
      return ctx.persistence.mutate(
        ctx.runId,
        "update_working_package",
        args.idempotencyKey,
        args,
        state => {
          authorize(ctx, state);
          const current = state.wholeArticleWorkingPackage ??
            createWholeArticleWorkingPackage({
              runId: state.runId,
              contentId: state.contentId,
              contentHash: state.contentHash,
              sourceUnitManifestHash: state.sourceUnitManifestHash,
            });
          if (current.packageRevision !== args.expectedPackageRevision) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              `STALE_PACKAGE_REVISION: expected ${current.packageRevision}`,
            );
          }
          uniqueIds(args.setTheses.map(item => item.thesisId), "setTheses");
          uniqueIds(args.upsertClaims.map(item => item.claimId), "upsertClaims");
          uniqueIds(args.removeClaimIds, "removeClaimIds");
          uniqueIds(
            args.setRegionDispositions.map(item => item.regionId),
            "setRegionDispositions",
          );
          uniqueIds(
            args.setThesisDispositions.map(item => item.thesisId),
            "setThesisDispositions",
          );
          const allowedUnits = unitIds(ctx);
          args.setTheses.forEach(thesis =>
            assertGrounding(allowedUnits, thesis.groundingUnitIds, thesis.thesisId));
          args.upsertClaims.forEach(claim => assertGrounding(
            allowedUnits,
            [
              ...claim.attributionUnitIds,
              ...claim.substantiveGroundingUnitIds,
              ...claim.attributionLayers.flatMap(layer => layer.unitIds),
            ],
            claim.claimId,
          ));

          const theses = args.setTheses.length
            ? [...args.setTheses]
            : [...current.theses];
          const thesisIds = new Set(theses.map(item => item.thesisId));
          const claims = new Map(current.claims.map(item => [item.claimId, item]));
          args.removeClaimIds.forEach(id => claims.delete(id));
          args.upsertClaims.forEach(claim => claims.set(claim.claimId, claim));
          for (const claim of claims.values()) {
            const invalid = claim.thesisIds.filter(id => !thesisIds.has(id));
            if (invalid.length) {
              throw new ClaimFoundryError(
                "CF6_INVALID_PACKAGE",
                `INVALID_REFERENCE: ${claim.claimId}: ${invalid.join(",")}`,
              );
            }
          }

          const validRegions = new Set(
            deriveContentRegions(ctx.articleDocument).map(region => region.regionId),
          );
          const bulkExceptions =
            args.dispositionRemainingRegions?.exceptions ?? [];
          uniqueIds(bulkExceptions, "dispositionRemainingRegions.exceptions");
          const invalidExceptions = bulkExceptions
            .filter(regionId => !validRegions.has(regionId));
          if (invalidExceptions.length) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              `INVALID_REFERENCE: ${invalidExceptions.join(",")}`,
            );
          }
          const regionDispositions = new Map(
            current.regionDispositions.map(item => [item.regionId, item]),
          );
          for (const disposition of args.setRegionDispositions) {
            if (!validRegions.has(disposition.regionId)) {
              throw new ClaimFoundryError(
                "CF6_INVALID_PACKAGE",
                `INVALID_REFERENCE: ${disposition.regionId}`,
              );
            }
            regionDispositions.set(disposition.regionId, disposition);
          }
          const coveredRegionIds = new Set<string>();
          const regions = deriveContentRegions(ctx.articleDocument);
          const sourceOrder = new Map(
            ctx.articleDocument.sourceUnits.map((unit, index) => [unit.unitId, index]),
          );
          const unitToRegion = new Map<string, string>();
          for (const region of regions) {
            const start = sourceOrder.get(region.startUnitId)!;
            const end = sourceOrder.get(region.endUnitId)!;
            for (let index = start; index <= end; index += 1) {
              const sourceUnitId =
                ctx.articleDocument.sourceUnits[index]?.unitId;
              if (sourceUnitId) unitToRegion.set(sourceUnitId, region.regionId);
            }
          }
          for (const claim of claims.values()) {
            for (const sourceUnitId of claim.substantiveGroundingUnitIds) {
              const regionId = unitToRegion.get(sourceUnitId);
              if (regionId) coveredRegionIds.add(regionId);
            }
          }
          const exceptionSet = new Set(bulkExceptions);
          const bulkDispositionRegionIds = args.dispositionRemainingRegions
            ? regions
              .map(region => region.regionId)
              .filter(regionId =>
                !coveredRegionIds.has(regionId) &&
                !regionDispositions.has(regionId) &&
                !exceptionSet.has(regionId))
            : [];
          for (const regionId of bulkDispositionRegionIds) {
            regionDispositions.set(regionId, {
              regionId,
              reasonCode: args.dispositionRemainingRegions!.reasonCode,
              ...(args.dispositionRemainingRegions!.optionalNote
                ? { note: args.dispositionRemainingRegions!.optionalNote }
                : {}),
              dispositionMode: "bulk",
              originatingToolCallId:
                invocation?.toolCallId ?? args.idempotencyKey,
            });
          }
          const mutationCount = args.setTheses.length + args.upsertClaims.length +
            args.removeClaimIds.length + args.setRegionDispositions.length +
            args.setThesisDispositions.length + args.acknowledgeDiagnosticIds.length +
            bulkDispositionRegionIds.length;
          if (mutationCount === 0) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              "EMPTY_MUTATION",
            );
          }
          const thesisDispositions = new Map(
            current.thesisDispositions.map(item => [item.thesisId, item]),
          );
          for (const disposition of args.setThesisDispositions) {
            if (!thesisIds.has(disposition.thesisId)) {
              throw new ClaimFoundryError(
                "CF6_INVALID_PACKAGE",
                `INVALID_REFERENCE: ${disposition.thesisId}`,
              );
            }
            thesisDispositions.set(disposition.thesisId, disposition);
          }

          const knownDiagnostics = new Set(
            current.latestInspection?.deterministicDiagnostics
              .map(item => item.diagnosticId) ?? [],
          );
          const invalidAcknowledgements = args.acknowledgeDiagnosticIds
            .filter(id => !knownDiagnostics.has(id));
          if (invalidAcknowledgements.length) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              `INVALID_REFERENCE: ${invalidAcknowledgements.join(",")}`,
            );
          }
          const acknowledgedDiagnosticIds = [
            ...new Set([
              ...current.acknowledgedDiagnosticIds,
              ...args.acknowledgeDiagnosticIds,
            ]),
          ];

          const revision = current.packageRevision + 1;
          const draft = {
            ...current,
            status: "working" as const,
            packageRevision: revision,
            packageHash: "0".repeat(64),
            theses,
            claims: [...claims.values()],
            regionDispositions: [...regionDispositions.values()],
            thesisDispositions: [...thesisDispositions.values()],
            acknowledgedDiagnosticIds,
            latestInspection: null,
            finalPackageId: null,
          };
          const pkg = wholeArticleWorkingPackageSchema.parse({
            ...draft,
            packageHash: hashWholeArticleWorkingPackage(draft),
          });
          const changed = counted(state, "drafting");
          changed.wholeArticleWorkingPackage = pkg;
          return {
            state: changed,
            result: {
              status: "updated" as const,
              packageRevision: pkg.packageRevision,
              packageHash: pkg.packageHash,
              changedThesisIds: args.setTheses.map(item => item.thesisId),
              changedClaimIds: args.upsertClaims.map(item => item.claimId),
              removedClaimIds: args.removeClaimIds,
              changedRegionDispositionIds:
                [
                  ...args.setRegionDispositions.map(item => item.regionId),
                  ...bulkDispositionRegionIds,
                ],
              bulkDispositionCount: bulkDispositionRegionIds.length,
              bulkDispositionRegionIds,
              changedThesisDispositionIds:
                args.setThesisDispositions.map(item => item.thesisId),
              acknowledgedDiagnosticIds: args.acknowledgeDiagnosticIds,
            },
          };
        },
      );
    },

    async inspect_working_package(input: unknown) {
      const args = wholeArticleToolSchemas.inspectWorkingPackage.parse(input);
      return ctx.persistence.mutate(
        ctx.runId,
        "inspect_working_package",
        args.idempotencyKey,
        args,
        state => {
          authorize(ctx, state);
          const pkg = state.wholeArticleWorkingPackage;
          if (!pkg) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              "ILLEGAL_IN_STATE: no working package",
            );
          }
          if (pkg.packageRevision !== args.expectedPackageRevision) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              `STALE_PACKAGE_REVISION: expected ${pkg.packageRevision}`,
            );
          }
          const report = inspectWholeArticleWorkingPackage({
            pkg,
            document: ctx.articleDocument,
            inspectionId: `I-${randomUUID()}`,
          });
          const changed = counted(state, "validating");
          changed.wholeArticleWorkingPackage = {
            ...pkg,
            latestInspection: report,
          };
          return {
            state: changed,
            result: report,
          };
        },
      );
    },

    async finalize_working_package(input: unknown) {
      const args = wholeArticleToolSchemas.finalizeWorkingPackage.parse(input);
      return ctx.persistence.mutate(
        ctx.runId,
        "finalize_working_package",
        args.idempotencyKey,
        args,
        state => {
          authorize(ctx, state);
          const pkg = state.wholeArticleWorkingPackage;
          if (!pkg) {
            throw new ClaimFoundryError(
              "CF6_FINALIZATION_BLOCKED",
              "ILLEGAL_IN_STATE: no working package",
            );
          }
          if (pkg.packageRevision !== args.expectedPackageRevision ||
            pkg.packageHash !== args.expectedPackageHash) {
            throw new ClaimFoundryError(
              "CF6_FINALIZATION_BLOCKED",
              "STALE_PACKAGE_REVISION",
            );
          }
          const inspection = inspectWholeArticleWorkingPackage({
            pkg,
            document: ctx.articleDocument,
            inspectionId: `I-${randomUUID()}`,
          });
          const inspectedPackage = {
            ...pkg,
            latestInspection: inspection,
          };
          const block = (message: string): never => {
            const changed = counted(state, "validating");
            changed.wholeArticleWorkingPackage = inspectedPackage;
            throw new PersistedMutationError(
              changed,
              new ClaimFoundryError("CF6_FINALIZATION_BLOCKED", message),
            );
          };
          if (!inspection.deterministicClean) {
            block("DETERMINISTIC_DEFECTS_REMAIN");
          }
          if (inspection.unaccountedRegionIds.length) {
            block("UNACCOUNTED_REGIONS");
          }
          if (inspection.unaccountedThesisIds.length) {
            block("UNACCOUNTED_THESES");
          }
          if (inspection.claimIdsWithoutThesis.length) {
            block("INVALID_REFERENCE");
          }
          const knownDiagnostics = new Set([
            ...inspection.deterministicDiagnostics.map(item => item.diagnosticId),
            ...inspection.nonBlockingHeuristics.map(item => item.diagnosticId),
          ]);
          const invalidAcknowledgements = args.acknowledgeDiagnosticIds
            .filter(id => !knownDiagnostics.has(id));
          if (invalidAcknowledgements.length) {
            block("INVALID_REFERENCE");
          }
          const packageId = `CF6P-${randomUUID()}`;
          const draft = {
            ...inspectedPackage,
            status: "final" as const,
            finalPackageId: packageId,
            packageHash: "0".repeat(64),
          };
          const finalPackage = wholeArticleWorkingPackageSchema.parse({
            ...draft,
            packageHash: hashWholeArticleWorkingPackage(draft),
          });
          const validated = transitionState(
            {
              ...state,
              wholeArticleWorkingPackage: inspectedPackage,
              updatedAt: new Date().toISOString(),
            },
            "validating",
          );
          const changed = transitionState(
            {
              ...validated,
              counters: {
                ...validated.counters,
                toolCalls: validated.counters.toolCalls + 1,
              },
              finalPackageId: packageId,
              wholeArticleWorkingPackage: finalPackage,
              updatedAt: new Date().toISOString(),
            },
            "completed",
          );
          return {
            state: changed,
            result: {
              status: "completed" as const,
              finalPackageId: packageId,
              finalPackageHash: finalPackage.packageHash,
              packageRevision: finalPackage.packageRevision,
            },
          };
        },
      );
    },

    async abstain_or_request_review(input: unknown) {
      const args = wholeArticleToolSchemas.abstainOrRequestReview.parse(input);
      return ctx.persistence.mutate(
        ctx.runId,
        "abstain_or_request_review",
        args.idempotencyKey,
        args,
        state => {
          authorize(ctx, state);
          const pkg = state.wholeArticleWorkingPackage;
          const claimIds = new Set(pkg?.claims.map(item => item.claimId) ?? []);
          const thesisIds = new Set(pkg?.theses.map(item => item.thesisId) ?? []);
          const allowedUnits = unitIds(ctx);
          if (args.relatedClaimIds.some(id => !claimIds.has(id)) ||
            args.relatedThesisIds.some(id => !thesisIds.has(id)) ||
            args.relatedUnitIds.some(id => !allowedUnits.has(id))) {
            throw new ClaimFoundryError(
              "CF6_INVALID_PACKAGE",
              "INVALID_REFERENCE",
            );
          }
          const next = args.mode === "abstain" ? "abstained" : "awaiting_review";
          const changed = transitionState(
            {
              ...state,
              counters: {
                ...state.counters,
                toolCalls: state.counters.toolCalls + 1,
              },
              terminalReasonCode: args.reasonCode,
              pendingReviewReasons: args.mode === "request_review"
                ? [`${args.reasonCode}: ${args.reason}`]
                : [`ABSTENTION: ${args.reasonCode}: ${args.reason}`],
              updatedAt: new Date().toISOString(),
            },
            next,
          );
          return {
            state: changed,
            result: {
              status: args.mode === "abstain"
                ? "abstained" as const
                : "awaiting_review" as const,
              reasonCode: args.reasonCode,
            },
          };
        },
      );
    },
  };
}
