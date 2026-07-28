import type { AgentDefinition, RuntimeTool } from "../shared/agentRuntime.js";
import type { RunBudget } from "../shared/runBudget.js";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import type { ClaimFoundryRunState } from "./claimFoundryState.js";
import { coverageUpdateSchema } from "./claimFoundryCoverage.js";
import {
  claimFoundryAgentCompletionSchema,
  type ClaimFoundryAgentCompletion,
} from "./claimFoundryCompletion.js";
import {
  buildClaimFoundryInstructions,
} from "./claimFoundryInstructions.js";
import { claimFoundryToolSchemas, createClaimFoundryTools } from "./claimFoundryTools.js";
import {
  CF6_SCHEMA_VERSION,
  CF6_TOOL_SCHEMA_VERSION,
  dispositionSchema,
  selectedClaimSchema,
  workingPackageSchema,
} from "./claimFoundrySchemas.js";
import { z } from "zod";

export const CLAIM_FOUNDRY_TOOL_NAMES = [
  "get_content_map",
  "read_source_units",
  "find_source_units",
  "save_working_package",
  "validate_working_package",
  "apply_package_patch",
  "finalize_claim_package",
] as const;

const descriptions: Record<typeof CLAIM_FOUNDRY_TOOL_NAMES[number], string> = {
  get_content_map: "Inspect the authorized content structure without reading article text. Returns ordered blocks and source-unit IDs.",
  read_source_units: "Read bounded authorized source units by ID, optionally with adjacent units. This is the only way to inspect source text directly.",
  find_source_units: "Search only the authorized content's source units for literal or normalized-token matches.",
  save_working_package: "Upsert or remove bounded semantic claim rows and dispositions. Supply JSON arrays in upsertClaimsJson and upsertDispositionsJson. Claim rows require claimId, surfaceStatement, substantiveAssertion, attributionLayers, contentSupplier, contentSupplierKind, reportingVoice, articleTreatment, polarity, scope, attributionUnitIds, substantiveGroundingUnitIds, verificationTarget, themeIds, materiality, selectionRationale, and identityHints. Authorized identity and audit fields are filled by the host.",
  validate_working_package: "Validate the persisted working package without mutating its semantics. Returns all structural and heuristic findings.",
  apply_package_patch: "Apply one allow-listed bounded repair to the persisted package for specified validation findings.",
  finalize_claim_package: "Atomically finalize a validated package as immutable, or record typed abstention with inspected context.",
};

function exposedResult(name: typeof CLAIM_FOUNDRY_TOOL_NAMES[number], value: any) {
  const result = value.result && typeof value.result === "object" && "finalPackage" in value.result
    ? Object.fromEntries(Object.entries(value.result).filter(([key]) => key !== "finalPackage"))
    : value.result;
  const modelResult = name === "get_content_map" && result
    ? {
      runId: result.runId,
      contentId: result.contentId,
      contentHash: result.contentHash,
      sourceUnitManifestHash: result.sourceUnitManifestHash,
      sourceFamily: result.sourceFamily,
      packageAudit: result.packageAudit,
      totalSourceUnits: value.state.contentRegions.reduce(
        (sum: number, region: any) => sum + region.unitCount, 0,
      ),
      totalRegions: value.state.contentRegions.length,
      regions: value.state.contentRegions,
      citationCount: result.citationCount,
      referenceCount: result.referenceCount,
    }
    : result;
  return {
    replayed: value.replayed,
    result: modelResult,
    persistedState: {
      status: value.state.status,
      counters: value.state.counters,
      remainingBudgets: {
        toolCalls: value.state.budgets.maxToolCalls - value.state.counters.toolCalls,
        unitsRead: value.state.budgets.maxUnitsRead - value.state.counters.unitsRead,
        repairRounds: value.state.budgets.maxRepairRounds - value.state.counters.repairRounds,
      },
      pendingReviewReasons: value.state.pendingReviewReasons,
      finalPackageId: value.state.finalPackageId,
    },
  };
}

const managerSaveSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  upsertClaimsJson: z.string().max(100_000).default("[]"),
  removeClaimIds: z.array(z.string()).max(15).default([]),
  upsertDispositionsJson: z.string().max(100_000).default("[]"),
  removeDispositionIds: z.array(z.string()).max(100).default([]),
}).strict();

export const claimFoundryManagerToolSchemas = {
  get_content_map: claimFoundryToolSchemas.getContentMap,
  read_source_units: claimFoundryToolSchemas.readSourceUnits,
  find_source_units: claimFoundryToolSchemas.findSourceUnits,
  save_working_package: managerSaveSchema,
  validate_working_package: claimFoundryToolSchemas.validateWorkingPackage,
  apply_package_patch: claimFoundryToolSchemas.applyPackagePatch,
  finalize_claim_package: claimFoundryToolSchemas.finalizeClaimPackage,
} as const;

async function toolEnabled(
  context: ClaimFoundryToolContext,
  name: typeof CLAIM_FOUNDRY_TOOL_NAMES[number],
) {
  const state = await context.persistence.load(context.runId);
  if (!state || ["completed", "abstained", "failed"].includes(state.status)) return false;
  if (name === "validate_working_package") return state.workingPackage !== null;
  if (name === "apply_package_patch") {
    const latest = state.validationReports.at(-1);
    return state.workingPackage !== null &&
      state.counters.repairRounds < state.budgets.maxRepairRounds &&
      Boolean(latest?.findings.some(finding =>
        ["error", "review"].includes(finding.severity) &&
        finding.code !== "UNINSPECTED_MAJOR_REGION"));
  }
  return true;
}

export function createClaimFoundryAgentDefinition(input: {
  context: ClaimFoundryToolContext;
  model: string;
  runtimeBudget: RunBudget;
  persistedBudget: ClaimFoundryRunState["budgets"];
}): AgentDefinition<ClaimFoundryAgentCompletion> {
  const domain = createClaimFoundryTools(input.context);
  const bindings = [
    ["get_content_map", claimFoundryToolSchemas.getContentMap, domain.get_content_map],
    ["read_source_units", claimFoundryToolSchemas.readSourceUnits, domain.read_source_units],
    ["find_source_units", claimFoundryToolSchemas.findSourceUnits, domain.find_source_units],
    ["save_working_package", managerSaveSchema, async (args: z.infer<typeof managerSaveSchema>) => {
      const state = await input.context.persistence.load(input.context.runId);
      if (!state) throw new Error("CF6 persisted run state is missing");
      const claims = new Map((state.workingPackage?.selectedClaims ?? [])
        .map(claim => [claim.claimId, claim]));
      args.removeClaimIds.forEach(id => claims.delete(id));
      const upsertClaims = z.array(selectedClaimSchema).max(15).parse(
        JSON.parse(args.upsertClaimsJson),
      );
      upsertClaims.forEach(claim => claims.set(claim.claimId, claim));
      const dispositions = new Map((state.workingPackage?.dispositions ?? [])
        .map(item => [item.candidateId, item]));
      args.removeDispositionIds.forEach(id => dispositions.delete(id));
      const upsertDispositions = z.array(dispositionSchema).max(100).parse(
        JSON.parse(args.upsertDispositionsJson),
      );
      upsertDispositions.forEach(item => dispositions.set(item.candidateId, item));
      const packageValue = workingPackageSchema.parse({
        schemaVersion: CF6_SCHEMA_VERSION,
        runId: state.runId,
        contentId: state.contentId,
        contentHash: state.contentHash,
        sourceUnitManifestHash: state.sourceUnitManifestHash,
        status: "working",
        selectedClaims: [...claims.values()],
        dispositions: [...dispositions.values()],
        validationReports: state.workingPackage?.validationReports ?? [],
        audit: {
          instructionVersion: state.versions.instruction,
          toolSchemaVersion: CF6_TOOL_SCHEMA_VERSION,
          model: state.versions.model,
          codeVersion: state.versions.code,
        },
        packageHash: null,
      });
      return domain.save_working_package({
        idempotencyKey: args.idempotencyKey,
        package: packageValue,
        coverageUpdates: [],
      });
    }],
    ["validate_working_package", claimFoundryToolSchemas.validateWorkingPackage, domain.validate_working_package],
    ["apply_package_patch", claimFoundryToolSchemas.applyPackagePatch, domain.apply_package_patch],
    ["finalize_claim_package", claimFoundryToolSchemas.finalizeClaimPackage, domain.finalize_claim_package],
  ] as const;
  const tools = bindings.map(([name, parameters, execute]) => ({
    name,
    description: descriptions[name],
    parameters,
    execute: async (args: any) => exposedResult(name, await execute(args)),
    isEnabled: () => toolEnabled(input.context, name),
  })) as RuntimeTool<any, any>[];

  return {
    name: "ClaimFoundry",
    instructions: buildClaimFoundryInstructions({
      runId: input.context.runId,
      contentId: input.context.contentId,
      model: input.model,
      maxModelTurns: input.runtimeBudget.maxModelTurns,
      maxToolCalls: input.runtimeBudget.maxToolCalls,
      maxUnitsRead: input.persistedBudget.maxUnitsRead,
      maxRepairRounds: input.persistedBudget.maxRepairRounds,
    }),
    outputType: claimFoundryAgentCompletionSchema,
    tools,
  };
}
