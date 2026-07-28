import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildArticleSourceBlocks } from "../../src/claim-foundry/article-document/sourceBlocks.js";
import type { ClaimFoundryToolContext, SourceUnit } from "./claimFoundryContext.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";
import { applyPatch, patchOperationSchema } from "./claimFoundryPatch.js";
import { hashPackageValue, hashValue } from "./claimFoundryPersistence.js";
import { workingPackageSchema } from "./claimFoundrySchemas.js";
import { transitionState, type ClaimFoundryRunState } from "./claimFoundryState.js";
import { validateWorkingPackage } from "./claimFoundryValidation.js";
import {
  applyCoverageUpdates,
  coverageUpdateSchema,
  deriveContentRegions,
  updateCoverageFromRead,
} from "./claimFoundryCoverage.js";

const idem = z.string().min(8).max(200);
const schemas = {
  getContentMap: z.object({
    idempotencyKey: idem,
    maxBlocks: z.number().int().min(1).max(100).default(50),
    coverageUpdates: z.array(coverageUpdateSchema).max(100).default([]),
  }).strict(),
  readSourceUnits: z.object({ idempotencyKey: idem, unitIds: z.array(z.string()).min(1).max(50),
    adjacent: z.number().int().min(0).max(3).default(0), maxTextChars: z.number().int().min(1).max(20_000).default(10_000) }).strict(),
  findSourceUnits: z.object({ idempotencyKey: idem, query: z.string().min(1).max(200),
    mode: z.enum(["literal", "normalized_tokens"]).default("normalized_tokens"),
    maxResults: z.number().int().min(1).max(25).default(10) }).strict(),
  saveWorkingPackage: z.object({
    idempotencyKey: idem,
    package: workingPackageSchema,
    coverageUpdates: z.array(coverageUpdateSchema).max(100).default([]),
  }).strict(),
  validateWorkingPackage: z.object({ idempotencyKey: idem }).strict(),
  applyPackagePatch: z.object({ idempotencyKey: idem, operation: patchOperationSchema }).strict(),
  finalizeClaimPackage: z.object({ idempotencyKey: idem, mode: z.enum(["complete", "abstain"]),
    abstentionReason: z.string().min(1).optional(), inspectedContextUnitIds: z.array(z.string()).default([]) }).strict(),
};
export const claimFoundryToolSchemas = schemas;

function authorize(ctx: ClaimFoundryToolContext, state: ClaimFoundryRunState) {
  if (state.contentId !== ctx.contentId || state.contentHash !== ctx.articleDocument.contentHash) {
    throw new ClaimFoundryError("CF6_UNAUTHORIZED_CONTENT", "Run is not authorized for this content");
  }
  const manifestHash = hashValue(ctx.articleDocument.sourceUnits.map(unit => ({
    unitId: unit.unitId, text: unit.text, sourceOffsets: unit.sourceOffsets,
  })));
  if (state.sourceUnitManifestHash !== manifestHash) {
    throw new ClaimFoundryError("CF6_UNAUTHORIZED_CONTENT", "Source-unit manifest does not match the authorized run");
  }
  if (["completed", "abstained", "failed"].includes(state.status)) {
    throw new ClaimFoundryError("CF6_INVALID_STATE_TRANSITION", "Terminal runs cannot invoke tools");
  }
  if (state.counters.toolCalls >= state.budgets.maxToolCalls) throw new ClaimFoundryError("CF6_BUDGET_EXCEEDED", "Tool-call budget exceeded");
}
function counted(state: ClaimFoundryRunState, next?: Parameters<typeof transitionState>[1]) {
  const changed = { ...state, counters: { ...state.counters, toolCalls: state.counters.toolCalls + 1 }, updatedAt: new Date().toISOString() };
  return next ? transitionState(changed, next) : changed;
}
function orderedUnique<T>(items: T[]) { return [...new Set(items)]; }
function unitMap(ctx: ClaimFoundryToolContext) { return new Map(ctx.articleDocument.sourceUnits.map(unit => [unit.unitId, unit])); }

export function createClaimFoundryTools(ctx: ClaimFoundryToolContext) {
  return {
    async get_content_map(input: unknown) {
      const args = schemas.getContentMap.parse(input);
      return ctx.persistence.mutate(ctx.runId, "get_content_map", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        const blocks = buildArticleSourceBlocks(ctx.articleDocument as any, { maxBlocks: args.maxBlocks });
        let changed = counted(state, "inspecting");
        if (!changed.contentRegions.length) changed.contentRegions = deriveContentRegions(ctx.articleDocument);
        if (args.coverageUpdates.length) {
          changed.contentRegions = applyCoverageUpdates(changed.contentRegions, args.coverageUpdates);
        }
        return { state: changed, result: {
          runId: state.runId, contentId: ctx.contentId,
          contentHash: state.contentHash,
          sourceUnitManifestHash: state.sourceUnitManifestHash,
          sourceFamily: ctx.articleDocument.sourceFamily,
          packageAudit: {
            instructionVersion: state.versions.instruction,
            toolSchemaVersion: state.versions.toolSchema,
            model: state.versions.model,
            codeVersion: state.versions.code,
          },
          blocks: blocks.map((block: any) => ({ blockId: block.blockId, heading: block.heading,
            structuralType: block.structuralType, sourceOffsets: block.sourceOffsets,
            sourceUnitIds: block.sourceUnitIds })),
          speakers: orderedUnique(ctx.articleDocument.atoms.map(atom => atom.layoutSignals?.transcriptSpeaker).filter(Boolean)),
          citationCount: ctx.articleDocument.citationMarkers.length,
          referenceCount: ctx.articleDocument.references.length,
          regions: changed.contentRegions,
        }};
      });
    },
    async read_source_units(input: unknown) {
      const args = schemas.readSourceUnits.parse(input);
      return ctx.persistence.mutate(ctx.runId, "read_source_units", args.idempotencyKey, args, state => {
        authorize(ctx, state); const map = unitMap(ctx);
        const requested = args.unitIds.map(id => map.get(id) ?? (() => { throw new ClaimFoundryError("CF6_NOT_FOUND", `Unknown source unit ${id}`); })());
        const indexes = requested.flatMap(unit => {
          const i = ctx.articleDocument.sourceUnits.findIndex(x => x.unitId === unit.unitId);
          return Array.from({ length: args.adjacent * 2 + 1 }, (_, n) => i - args.adjacent + n);
        }).filter(i => i >= 0 && i < ctx.articleDocument.sourceUnits.length);
        const units = orderedUnique(indexes).sort((a, b) => a - b).map(i => ctx.articleDocument.sourceUnits[i]!) as SourceUnit[];
        if (units.reduce((n, unit) => n + unit.text.length, 0) > args.maxTextChars) throw new ClaimFoundryError("CF6_BUDGET_EXCEEDED", "Source text limit exceeded");
        if (state.counters.unitsRead + units.length > state.budgets.maxUnitsRead) throw new ClaimFoundryError("CF6_BUDGET_EXCEEDED", "Unit-read budget exceeded");
        const changed = counted(state, "inspecting");
        changed.counters.unitsRead += units.length;
        changed.inspectedUnitIds = orderedUnique([...changed.inspectedUnitIds, ...units.map(unit => unit.unitId)]);
        if (!changed.contentRegions.length) changed.contentRegions = deriveContentRegions(ctx.articleDocument);
        changed.contentRegions = updateCoverageFromRead(
          changed.contentRegions, ctx.articleDocument, units.map(unit => unit.unitId),
        );
        return { state: changed, result: {
          units,
          coverageDelta: changed.contentRegions.filter(region =>
            region.sampledUnitIds.some(id => units.some(unit => unit.unitId === id))),
        } };
      });
    },
    async find_source_units(input: unknown) {
      const args = schemas.findSourceUnits.parse(input);
      return ctx.persistence.mutate(ctx.runId, "find_source_units", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        const norm = (s: string): string[] =>
          s.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
        const queryTokens = norm(args.query);
        const matches = ctx.articleDocument.sourceUnits.map(unit => {
          const hay = unit.text.toLocaleLowerCase(); const tokens = norm(unit.text);
          const score = args.mode === "literal" ? (hay.includes(args.query.toLocaleLowerCase()) ? 1 : 0)
            : queryTokens.filter(token => tokens.includes(token)).length / queryTokens.length;
          return { unitId: unit.unitId, order: unit.order, type: unit.type, text: unit.text,
            sourceOffsets: unit.sourceOffsets, score };
        }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, args.maxResults);
        return { state: counted(state, "inspecting"), result: { matches } };
      });
    },
    async save_working_package(input: unknown) {
      const args = schemas.saveWorkingPackage.parse(input);
      return ctx.persistence.mutate(ctx.runId, "save_working_package", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        if (args.coverageUpdates.length) {
          if (!state.contentRegions.length) {
            throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "Coverage ledger is not initialized");
          }
          state.contentRegions = applyCoverageUpdates(state.contentRegions, args.coverageUpdates);
        }
        if (args.package.runId !== state.runId || args.package.contentId !== state.contentId ||
          args.package.contentHash !== state.contentHash || args.package.sourceUnitManifestHash !== state.sourceUnitManifestHash) {
          throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "Package identity is not authorized");
        }
        const report = validateWorkingPackage(args.package, ctx.articleDocument);
        if (!report.hardPass) throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "Structurally invalid package", { findings: report.findings });
        const changed = counted(state, "drafting"); changed.workingPackage = structuredClone(args.package);
        return { state: changed, result: { packageHash: hashPackageValue(args.package) } };
      });
    },
    async validate_working_package(input: unknown) {
      const args = schemas.validateWorkingPackage.parse(input);
      return ctx.persistence.mutate(ctx.runId, "validate_working_package", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        if (!state.workingPackage) throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "No working package");
        const report = validateWorkingPackage(
          state.workingPackage, ctx.articleDocument, state.contentRegions,
        );
        const changed = counted(state, "validating"); changed.validationReports.push(report);
        changed.workingPackage!.validationReports.push(report);
        return { state: changed, result: report };
      });
    },
    async apply_package_patch(input: unknown) {
      const args = schemas.applyPackagePatch.parse(input);
      return ctx.persistence.mutate(ctx.runId, "apply_package_patch", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        if (!state.workingPackage) throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "No working package");
        const findingIds = args.operation.findingIds;
        if (findingIds.some(id => state.repairedFindingIds.includes(id))) throw new ClaimFoundryError("CF6_INVALID_PATCH", "A defect may be repaired only once");
        if (state.counters.repairRounds >= state.budgets.maxRepairRounds) throw new ClaimFoundryError("CF6_BUDGET_EXCEEDED", "Repair-round budget exceeded");
        const beforeHash = hashPackageValue(state.workingPackage);
        const patched = applyPatch(state.workingPackage, args.operation);
        const structuralReport = validateWorkingPackage(patched.package, ctx.articleDocument);
        if (!structuralReport.hardPass) throw new ClaimFoundryError("CF6_INVALID_PATCH", "Patch failed structural validation", { findings: structuralReport.findings });
        const report = validateWorkingPackage(
          patched.package, ctx.articleDocument, state.contentRegions,
        );
        let changed = counted(state, "repairing"); changed.workingPackage = patched.package;
        changed.counters.repairRounds += 1; changed.repairedFindingIds.push(...findingIds);
        changed.repairHistory.push({ repairId: `R-${randomUUID()}`, findingIds,
          operation: args.operation.type, beforeHash, afterHash: hashPackageValue(patched.package),
          reviewRequired: patched.reviewRequired, createdAt: new Date().toISOString() });
        if (patched.reviewRequired) {
          changed.pendingReviewReasons.push(`${args.operation.type}: ${args.operation.reason}`);
          changed = transitionState(changed, "awaiting_review");
        }
        return { state: changed, result: { packageHash: hashPackageValue(patched.package), reviewRequired: patched.reviewRequired, validation: report } };
      });
    },
    async finalize_claim_package(input: unknown) {
      const args = schemas.finalizeClaimPackage.parse(input);
      type FinalizeResult =
        | { status: "abstained"; packageId: null }
        | { status: "completed"; packageId: string; packageHash: string;
          finalPackage: z.infer<typeof workingPackageSchema> };
      const mutation = await ctx.persistence.mutate<FinalizeResult>(
        ctx.runId, "finalize_claim_package", args.idempotencyKey, args, state => {
        authorize(ctx, state);
        if (args.mode === "abstain") {
          if (!args.abstentionReason) throw new ClaimFoundryError("CF6_FINALIZATION_BLOCKED", "Abstention reason is required");
          const foreign = args.inspectedContextUnitIds.filter(id => !unitMap(ctx).has(id));
          if (foreign.length) throw new ClaimFoundryError("CF6_NOT_FOUND", "Abstention context contains unknown units");
          const changed = transitionState(counted(state), "abstained");
          changed.pendingReviewReasons = [`ABSTENTION: ${args.abstentionReason}`];
          return { state: changed, result: { status: "abstained" as const, packageId: null } };
        }
        if (!state.workingPackage) throw new ClaimFoundryError("CF6_FINALIZATION_BLOCKED", "No working package");
        if (state.pendingReviewReasons.length) throw new ClaimFoundryError("CF6_REVIEW_REQUIRED", "Human review is pending");
        const report = validateWorkingPackage(
          state.workingPackage, ctx.articleDocument, state.contentRegions,
        );
        if (!report.hardPass) throw new ClaimFoundryError("CF6_FINALIZATION_BLOCKED", "Structural hard errors remain");
        const packageId = `CF6P-${randomUUID()}`;
        const finalDraft = workingPackageSchema.parse({ ...state.workingPackage, status: "final", packageHash: null });
        const packageHash = hashPackageValue(finalDraft);
        const finalPackage = workingPackageSchema.parse({ ...finalDraft, packageHash });
        const changed = transitionState(counted(state), "completed"); changed.finalPackageId = packageId;
        changed.workingPackage = finalPackage;
        return { state: changed, result: { status: "completed" as const, packageId, packageHash, finalPackage } };
        },
      );
      return mutation;
    },
  };
}
