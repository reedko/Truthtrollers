import { z } from "zod";
import type {
  AgentDefinition,
  RuntimeTool,
} from "../shared/agentRuntime.js";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import {
  buildWholeArticleClaimFoundryInstructions,
} from "./claimFoundryInstructions.js";
import {
  createWholeArticleClaimFoundryTools,
  wholeArticleToolSchemas,
} from "./claimFoundryWholeArticleTools.js";
import {
  supportsExplicitPromptCacheBreakpoint,
} from "./claimFoundryArticleContext.js";

export const WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES = [
  "update_working_package",
  "inspect_working_package",
  "finalize_working_package",
  "abstain_or_request_review",
] as const;

export const wholeArticleAgentCompletionSchema = z.object({
  status: z.enum(["completed", "abstained", "awaiting_review"]),
  finalPackageId: z.string().nullable(),
  finalPackageHash: z.string().length(64).nullable(),
  packageRevision: z.number().int().nonnegative().nullable(),
  reasonCode: z.string().nullable(),
}).strict();

export type WholeArticleAgentCompletion =
  z.infer<typeof wholeArticleAgentCompletionSchema>;
export type WholeArticleOperationalCompletion = {
  status: "budget_exhausted";
  finalPackageId: null;
  finalPackageHash: null;
  packageRevision: number | null;
  reasonCode:
    | "TURN_BUDGET_EXHAUSTED"
    | "OPERATIONAL_UNCACHED_INPUT_BUDGET_EXHAUSTED"
    | "OPERATIONAL_COST_EQUIVALENT_BUDGET_EXHAUSTED";
};
export type WholeArticleRunCompletion =
  WholeArticleAgentCompletion | WholeArticleOperationalCompletion;

const descriptions: Record<
  typeof WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES[number],
  string
> = {
  update_working_package:
    "Apply one shallow model-authored mutation to theses, claims, structural-region dispositions, thesis dispositions, or diagnostic acknowledgements. Returns only a revision receipt.",
  inspect_working_package:
    "Persist and return an exact deterministic integrity and coverage mirror for the current package revision. It does not make semantic judgments.",
  finalize_working_package:
    "Atomically finalize the current inspected package when deterministic integrity and model-authored region/thesis accounting are complete.",
  abstain_or_request_review:
    "Persist a typed terminal abstention or human-review request for unresolved ambiguity, inadequate source quality, or exhausted budget.",
};

function terminalReceipt(
  result: Record<string, unknown>,
  packageRevision: number | null,
): WholeArticleAgentCompletion {
  if (result.status === "completed") {
    return wholeArticleAgentCompletionSchema.parse({
      status: "completed",
      finalPackageId: result.finalPackageId,
      finalPackageHash: result.finalPackageHash,
      packageRevision: result.packageRevision,
      reasonCode: null,
    });
  }
  return wholeArticleAgentCompletionSchema.parse({
    status: result.status,
    finalPackageId: null,
    finalPackageHash: null,
    packageRevision,
    reasonCode: result.reasonCode,
  });
}

export function createWholeArticleClaimFoundryAgentDefinition(input: {
  context: ClaimFoundryToolContext;
  model?: string;
}): AgentDefinition<WholeArticleAgentCompletion> {
  const domain = createWholeArticleClaimFoundryTools(input.context);
  const bindings = [
    [
      "update_working_package",
      wholeArticleToolSchemas.updateWorkingPackage,
      domain.update_working_package,
    ],
    [
      "inspect_working_package",
      wholeArticleToolSchemas.inspectWorkingPackage,
      domain.inspect_working_package,
    ],
    [
      "finalize_working_package",
      wholeArticleToolSchemas.finalizeWorkingPackage,
      domain.finalize_working_package,
    ],
    [
      "abstain_or_request_review",
      wholeArticleToolSchemas.abstainOrRequestReview,
      domain.abstain_or_request_review,
    ],
  ] as const;

  const tools = bindings.map(([name, parameters, execute]) => ({
    name,
    description: descriptions[name],
    parameters,
    execute: async (
      args: any,
      invocation?: { toolCallId: string | null },
    ) => {
      const value = name === "update_working_package"
        ? await domain.update_working_package(args, invocation)
        : await execute(args);
      if (name === "finalize_working_package" ||
        name === "abstain_or_request_review") {
        return terminalReceipt(
          value.result as Record<string, unknown>,
          value.state.wholeArticleWorkingPackage?.packageRevision ?? null,
        );
      }
      return {
        replayed: value.replayed,
        result: value.result,
        persistedStatus: value.state.status,
      };
    },
  })) as RuntimeTool<any, any>[];

  return {
    name: "ClaimFoundryWholeArticle",
    instructions: buildWholeArticleClaimFoundryInstructions(),
    outputType: wholeArticleAgentCompletionSchema,
    tools,
    modelSettings: {
      toolChoice: "required",
      parallelToolCalls: false,
      ...(input.model && supportsExplicitPromptCacheBreakpoint(input.model)
        ? { promptCacheOptions: { mode: "explicit" as const } }
        : {}),
    },
    resetToolChoice: false,
    toolUseBehavior: (_context, toolResults) => {
      for (const toolResult of toolResults) {
        if (toolResult.type !== "function_output" ||
          !["finalize_working_package", "abstain_or_request_review"]
            .includes(toolResult.tool.name)) {
          continue;
        }
        const parsed = wholeArticleAgentCompletionSchema.safeParse(
          toolResult.output,
        );
        if (parsed.success) {
          return {
            isFinalOutput: true,
            isInterrupted: undefined,
            finalOutput: JSON.stringify(parsed.data),
          };
        }
      }
      return { isFinalOutput: false, isInterrupted: undefined };
    },
  };
}
