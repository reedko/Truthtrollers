import { z } from "zod";
import { hashPackageValue, type ClaimFoundryPersistence } from "./claimFoundryPersistence.js";
import type { ClaimFoundryRunState } from "./claimFoundryState.js";

export const claimFoundryAgentCompletionSchema = z.object({
  runId: z.string().min(1),
  contentId: z.string().min(1),
  terminalStatus: z.enum([
    "completed", "abstained", "awaiting_review", "budget_exhausted", "failed",
  ]),
  finalPackageId: z.string().nullable(),
  finalPackageHash: z.string().length(64).nullable(),
  abstentionReason: z.string().nullable(),
  reviewReasons: z.array(z.string()),
  summary: z.string().min(1).max(2_000),
}).strict();

export type ClaimFoundryAgentCompletion = z.infer<typeof claimFoundryAgentCompletionSchema>;

function abstentionReason(state: ClaimFoundryRunState): string | null {
  const reason = state.pendingReviewReasons.find(item => item.startsWith("ABSTENTION: "));
  return reason ? reason.slice("ABSTENTION: ".length) : null;
}

export async function reconcileClaimFoundryCompletion(input: {
  proposed: unknown;
  runId: string;
  contentId: string;
  persistence: ClaimFoundryPersistence;
}): Promise<{ completion: ClaimFoundryAgentCompletion; state: ClaimFoundryRunState;
  finalPackage: Awaited<ReturnType<ClaimFoundryPersistence["loadFinalPackage"]>> }> {
  const proposed = claimFoundryAgentCompletionSchema.parse(input.proposed);
  if (proposed.runId !== input.runId || proposed.contentId !== input.contentId) {
    throw new Error("CF6 terminal output identity does not match the authorized run");
  }
  const state = await input.persistence.load(input.runId);
  if (!state) throw new Error("CF6 persisted run state is missing");

  if (state.status === "completed") {
    if (proposed.terminalStatus !== "completed" || !state.finalPackageId) {
      throw new Error("CF6 terminal output does not match completed persisted state");
    }
    const finalPackage = await input.persistence.loadFinalPackage(state.finalPackageId);
    if (!finalPackage || !finalPackage.packageHash ||
      finalPackage.packageHash !== hashPackageValue(finalPackage)) {
      throw new Error("CF6 completed state has no valid immutable final package");
    }
    return {
      state, finalPackage,
      completion: {
        ...proposed,
        finalPackageId: state.finalPackageId,
        finalPackageHash: finalPackage.packageHash,
        abstentionReason: null,
        reviewReasons: [],
      },
    };
  }
  if (state.status === "abstained") {
    if (proposed.terminalStatus !== "abstained") {
      throw new Error("CF6 terminal output does not match abstained persisted state");
    }
    return {
      state, finalPackage: null,
      completion: {
        ...proposed, finalPackageId: null, finalPackageHash: null,
        abstentionReason: abstentionReason(state),
        reviewReasons: [],
      },
    };
  }
  if (state.status === "awaiting_review") {
    if (proposed.terminalStatus !== "awaiting_review") {
      throw new Error("CF6 terminal output does not match awaiting-review persisted state");
    }
    return {
      state, finalPackage: null,
      completion: {
        ...proposed, finalPackageId: null, finalPackageHash: null,
        abstentionReason: null, reviewReasons: [...state.pendingReviewReasons],
      },
    };
  }
  if (!["budget_exhausted", "failed"].includes(proposed.terminalStatus)) {
    throw new Error(`CF6 model declared ${proposed.terminalStatus} while persisted state is ${state.status}`);
  }
  return {
    state, finalPackage: null,
    completion: {
      ...proposed, finalPackageId: null, finalPackageHash: null,
      abstentionReason: null, reviewReasons: [...state.pendingReviewReasons],
    },
  };
}
