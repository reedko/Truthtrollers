import { z } from "zod";
import { workingPackageSchema, validationReportSchema, repairRecordSchema } from "./claimFoundrySchemas.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";
import { contentRegionInspectionSchema } from "./claimFoundryCoverage.js";
import { wholeArticleWorkingPackageSchema } from "./claimFoundryWorkingPackage.js";

export const runStatuses = [
  "created", "inspecting", "drafting", "validating", "repairing",
  "awaiting_review", "completed", "abstained", "budget_exhausted", "failed",
] as const;
export type RunStatus = typeof runStatuses[number];

export const legalTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  created: ["inspecting", "drafting", "awaiting_review", "abstained", "budget_exhausted", "failed"],
  inspecting: ["inspecting", "drafting", "validating", "awaiting_review", "abstained", "budget_exhausted", "failed"],
  drafting: ["inspecting", "drafting", "validating", "awaiting_review", "abstained", "budget_exhausted", "failed"],
  validating: ["inspecting", "drafting", "repairing", "awaiting_review", "completed", "abstained", "budget_exhausted", "failed"],
  repairing: ["validating", "awaiting_review", "abstained", "budget_exhausted", "failed"],
  awaiting_review: ["drafting", "validating", "completed", "abstained", "budget_exhausted", "failed"],
  completed: [], abstained: [], budget_exhausted: [], failed: [],
};

export const runBudgetSchema = z.object({
  maxToolCalls: z.number().int().positive(),
  maxUnitsRead: z.number().int().positive(),
  maxRepairRounds: z.number().int().min(0).max(2),
  maxInputTokens: z.number().int().positive().default(45_000),
}).strict();

export const claimFoundryRunStateSchema = z.object({
  schemaVersion: z.literal("cf6.runState.v1"),
  runId: z.string().min(1),
  contentId: z.string().min(1),
  contentHash: z.string().length(64),
  sourceUnitManifestHash: z.string().length(64),
  status: z.enum(runStatuses),
  budgets: runBudgetSchema,
  counters: z.object({
    toolCalls: z.number().int().nonnegative(),
    unitsRead: z.number().int().nonnegative(),
    repairRounds: z.number().int().nonnegative(),
  }).strict(),
  inspectedUnitIds: z.array(z.string()),
  contentRegions: z.array(contentRegionInspectionSchema),
  semanticNotes: z.array(z.object({
    noteId: z.string(), text: z.string().min(1), groundingUnitIds: z.array(z.string()).min(1),
  }).strict()),
  workingPackage: workingPackageSchema.nullable(),
  validationReports: z.array(validationReportSchema),
  repairHistory: z.array(repairRecordSchema),
  pendingReviewReasons: z.array(z.string()),
  repairedFindingIds: z.array(z.string()),
  finalPackageId: z.string().nullable(),
  wholeArticleWorkingPackage: wholeArticleWorkingPackageSchema.nullable().default(null),
  continuation: z.object({
    strategy: z.enum(["conversationId", "previousResponseId"]),
    id: z.string().min(1),
  }).strict().nullable().default(null),
  terminalReasonCode: z.string().nullable().default(null),
  traceId: z.string().nullable(),
  versions: z.object({
    instruction: z.string(), toolSchema: z.string(), model: z.string(), code: z.string(),
  }).strict(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type ClaimFoundryRunState = z.infer<typeof claimFoundryRunStateSchema>;

export function transitionState(state: ClaimFoundryRunState, next: RunStatus): ClaimFoundryRunState {
  if (state.status === next) return state;
  if (!legalTransitions[state.status].includes(next)) {
    throw new ClaimFoundryError("CF6_INVALID_STATE_TRANSITION", `${state.status} -> ${next} is not legal`);
  }
  return { ...state, status: next, updatedAt: new Date().toISOString() };
}

export function createRunState(input: Omit<ClaimFoundryRunState,
  "schemaVersion" | "status" | "counters" | "inspectedUnitIds" | "semanticNotes" |
  "contentRegions" |
  "workingPackage" | "validationReports" | "repairHistory" | "pendingReviewReasons" |
  "repairedFindingIds" | "finalPackageId" | "wholeArticleWorkingPackage" |
  "continuation" | "terminalReasonCode" | "createdAt" | "updatedAt"> & {
    contentRegions?: ClaimFoundryRunState["contentRegions"];
    continuation?: ClaimFoundryRunState["continuation"];
  }): ClaimFoundryRunState {
  const now = new Date().toISOString();
  return claimFoundryRunStateSchema.parse({
    ...input, schemaVersion: "cf6.runState.v1", status: "created",
    counters: { toolCalls: 0, unitsRead: 0, repairRounds: 0 },
    inspectedUnitIds: [], contentRegions: input.contentRegions ?? [], semanticNotes: [], workingPackage: null,
    validationReports: [], repairHistory: [], pendingReviewReasons: [],
    repairedFindingIds: [], finalPackageId: null, createdAt: now, updatedAt: now,
    wholeArticleWorkingPackage: null,
    continuation: input.continuation ?? null,
    terminalReasonCode: null,
  });
}
