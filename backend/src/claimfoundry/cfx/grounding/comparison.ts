import {
  CFX_GROUNDING_STATUSES,
} from "../types/index.js";
import type {
  CfxGroundingArmMetrics,
  CfxGroundingComparison,
  CfxGroundingStatus,
  CfxS2ArmResult,
} from "../types/index.js";

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length)
      .toFixed(3),
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Number(((sorted[middle - 1]! + sorted[middle]!) / 2).toFixed(3));
}

export function metricsForCfxGroundingArm(
  arm: CfxS2ArmResult,
): CfxGroundingArmMetrics {
  const statusCounts = Object.fromEntries(
    CFX_GROUNDING_STATUSES.map((status) => [status, 0]),
  ) as Record<CfxGroundingStatus, number>;
  for (const row of arm.acceptedRows) statusCounts[row.groundingStatus] += 1;
  const passageKeys = arm.acceptedRows.flatMap((row) =>
    row.evidenceSegments.map((segment) => segment.sourceUnitIds.join(",")));
  const seenPassages = new Set<string>();
  let duplicatePassageReuseCount = 0;
  for (const passage of passageKeys) {
    if (seenPassages.has(passage)) duplicatePassageReuseCount += 1;
    seenPassages.add(passage);
  }
  return {
    requestCount: arm.providerCallCount,
    propositionCount: 12,
    statusCounts,
    exactSubstringPassCount: arm.acceptedRows.filter(
      (row) =>
        row.evidenceSegments.length > 0
        && row.sourceSnapshots.length === row.evidenceSegments.length,
    ).length,
    parserFailureCount: arm.outcomes.filter((outcome) =>
      outcome.validation.diagnostics.some((item) =>
        item.code.includes("SCHEMA") || item.code.includes("ROOT"))).length,
    validationFailureCount: arm.rejectedRows.length,
    averageCitedUnitCount: mean(
      arm.acceptedRows.map((row) => row.citedUnitCount),
    ),
    medianCitedUnitCount: median(
      arm.acceptedRows.map((row) => row.citedUnitCount),
    ),
    averageQuotedWordCount: mean(
      arm.acceptedRows.map((row) => row.quotedWordCount),
    ),
    medianQuotedWordCount: median(
      arm.acceptedRows.map((row) => row.quotedWordCount),
    ),
    evidenceSegmentCount: arm.acceptedRows.reduce(
      (sum, row) => sum + row.evidenceSegmentCount,
      0,
    ),
    duplicatePassageReuseCount,
    inputTokens: arm.outcomes.reduce(
      (sum, outcome) => sum + outcome.usage.inputTokens,
      0,
    ),
    outputTokens: arm.outcomes.reduce(
      (sum, outcome) => sum + outcome.usage.outputTokens,
      0,
    ),
    cachedTokens: arm.outcomes.reduce(
      (sum, outcome) => sum + outcome.usage.cachedInputTokens,
      0,
    ),
    latencyMs: arm.outcomes.reduce(
      (sum, outcome) => sum + outcome.latencyMs,
      0,
    ),
    estimatedCost: null,
  };
}

function statusFor(
  arm: CfxS2ArmResult,
  propositionId: string,
): CfxGroundingStatus | "rejected" | "missing" {
  const accepted = arm.acceptedRows.find(
    (row) => row.propositionId === propositionId,
  );
  if (accepted) return accepted.groundingStatus;
  if (arm.rejectedRows.some((row) => row.propositionId === propositionId)) {
    return "rejected";
  }
  return "missing";
}

function unitSetsFor(
  arm: CfxS2ArmResult,
  propositionId: string,
): string[] {
  const row = arm.acceptedRows.find(
    (item) => item.propositionId === propositionId,
  );
  return row
    ? row.evidenceSegments.map(
        (segment) => [...segment.sourceUnitIds].sort().join(","),
      ).sort()
    : [];
}

function quotationsFor(
  arm: CfxS2ArmResult,
  propositionId: string,
): string[] {
  const row = arm.acceptedRows.find(
    (item) => item.propositionId === propositionId,
  );
  return row
    ? row.evidenceSegments.map((segment) => segment.verbatimEvidence)
    : [];
}

export function compareCfxGroundingArms(input: {
  wholeArticle: CfxS2ArmResult;
  perProposition: CfxS2ArmResult;
  propositionIds: string[];
}): CfxGroundingComparison {
  return {
    arms: {
      wholeArticle: metricsForCfxGroundingArm(input.wholeArticle),
      perProposition: metricsForCfxGroundingArm(input.perProposition),
    },
    perPropositionComparison: [...input.propositionIds]
      .sort()
      .map((propositionId) => {
        const wholeArticleStatus = statusFor(
          input.wholeArticle,
          propositionId,
        );
        const perPropositionStatus = statusFor(
          input.perProposition,
          propositionId,
        );
        return {
          propositionId,
          wholeArticleStatus,
          perPropositionStatus,
          statusAgrees: wholeArticleStatus === perPropositionStatus,
          citedUnitSetsAgree:
            JSON.stringify(unitSetsFor(input.wholeArticle, propositionId))
            === JSON.stringify(unitSetsFor(input.perProposition, propositionId)),
          exactQuotationsAgree:
            JSON.stringify(quotationsFor(input.wholeArticle, propositionId))
            === JSON.stringify(
              quotationsFor(input.perProposition, propositionId),
            ),
          humanReview: "not_reviewed" as const,
        };
      }),
  };
}
