import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  GOnlyFrozenInput,
  GOnlySelection,
} from "./types.js";

type PriorChoice = {
  groupId: string;
  assertionIds: string[];
  selectedAssertionId: string;
  selectedAssertionText: string;
};

export type ClosestChoice = PriorChoice & {
  overlapCount: number;
  comparison:
    | "exact same assertion"
    | "same local topic, different assertion";
};

export type ComparisonRow = {
  groupId: string;
  current: GOnlySelection;
  gA: ClosestChoice | null;
  gBSelectorA: ClosestChoice | null;
  gBSelectorB: ClosestChoice | null;
};

const GDE2_AGGREGATE =
  "59ff0fd9b8a1f4aa3d0945791c397e813947295dcd6c9df61d0b0bac5ca3692b";
const G_A_SHA256 =
  "4ff543bf4be7c990dd6205f3020bb0ee0abceb910eb986b5e4452d79a26170f8";
const SEL1_AGGREGATE =
  "b9ee9391430b73175b183393480c9b257c183a60df952d44b7bf7fe355e46f2a";
const SEL1_A_SHA256 =
  "1f6190c1f854766f81378b34dd87d5d05f74b806f3a10140d6b5a6e5e59e0b81";
const SEL1_B_SHA256 =
  "c7b43d7774362816f7cdd9f98c363eb2243fccd1aff137acd478a01ac4b530be";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function closest(
  current: GOnlySelection,
  choices: PriorChoice[],
): ClosestChoice | null {
  const currentIds = new Set(current.assertionIds);
  const ranked = choices.map((choice) => ({
    choice,
    overlapCount: choice.assertionIds.filter((id) => currentIds.has(id)).length,
  })).sort((left, right) => right.overlapCount - left.overlapCount);
  const best = ranked[0];
  if (
    !best
    || best.overlapCount < 2
    || ranked[1]?.overlapCount === best.overlapCount
  ) {
    return null;
  }
  return {
    ...best.choice,
    overlapCount: best.overlapCount,
    comparison:
      current.selectedAssertionId === best.choice.selectedAssertionId
        ? "exact same assertion"
        : "same local topic, different assertion",
  };
}

export async function buildFrozenComparisons(input: {
  repositoryRoot: string;
  frozen: GOnlyFrozenInput;
  selections: GOnlySelection[];
}): Promise<{
  rows: ComparisonRow[];
  sourceHashes: Record<string, string>;
}> {
  const gde2Directory = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping-representative/CF1-F03",
    "cf7-gde2-cf1-f03-20260729013932",
  );
  const sel1Directory = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/selector-experiment/CF1-F03",
    "cf7-sel1-cf1-f03-20260729021343",
  );
  const gde2Hashes = JSON.parse(await readFile(
    path.join(gde2Directory, "artifact_hashes.json"),
    "utf8",
  )) as { aggregateSha256: string };
  const sel1Hashes = JSON.parse(await readFile(
    path.join(sel1Directory, "artifact_hashes.json"),
    "utf8",
  )) as { aggregateSha256: string };
  if (
    gde2Hashes.aggregateSha256 !== GDE2_AGGREGATE
    || sel1Hashes.aggregateSha256 !== SEL1_AGGREGATE
  ) {
    throw new Error("Prior comparison artifact aggregate changed");
  }
  const gABytes = await readFile(path.join(gde2Directory, "G-A_groups.json"));
  const sel1ABytes = await readFile(
    path.join(sel1Directory, "selector_A_results.json"),
  );
  const sel1BBytes = await readFile(
    path.join(sel1Directory, "selector_B_results.json"),
  );
  if (
    sha256(gABytes) !== G_A_SHA256
    || sha256(sel1ABytes) !== SEL1_A_SHA256
    || sha256(sel1BBytes) !== SEL1_B_SHA256
  ) {
    throw new Error("Prior comparison file hash changed");
  }
  const gAOutput = JSON.parse(gABytes.toString()) as {
    groups: Array<{
      groupId: string;
      assertionIds: string[];
      representativeAssertionId: string;
    }>;
  };
  const sel1A = JSON.parse(sel1ABytes.toString()) as Array<{
    groupId: string;
    output: { selectedAssertionId: string };
  }>;
  const sel1B = JSON.parse(sel1BBytes.toString()) as Array<{
    groupId: string;
    output: { selectedAssertionId: string };
  }>;
  const sel1Frozen = JSON.parse(await readFile(
    path.join(sel1Directory, "frozen_input.json"),
    "utf8",
  )) as {
    groups: Array<{
      groupId: string;
      assertions: Array<{ assertionId: string; assertionText: string }>;
    }>;
  };
  const textById = new Map(
    input.frozen.inventory.map((row) => [row.assertionId, row.assertionText]),
  );
  const gAChoices: PriorChoice[] = gAOutput.groups.map((group) => ({
    groupId: group.groupId,
    assertionIds: group.assertionIds,
    selectedAssertionId: group.representativeAssertionId,
    selectedAssertionText: textById.get(group.representativeAssertionId)!,
  }));
  const sel1GroupById = new Map(
    sel1Frozen.groups.map((group) => [group.groupId, group]),
  );
  const toChoices = (
    rows: Array<{ groupId: string; output: { selectedAssertionId: string } }>,
  ): PriorChoice[] => rows.map((row) => {
    const group = sel1GroupById.get(row.groupId)!;
    return {
      groupId: row.groupId,
      assertionIds: group.assertions.map((assertion) => assertion.assertionId),
      selectedAssertionId: row.output.selectedAssertionId,
      selectedAssertionText: textById.get(row.output.selectedAssertionId)!,
    };
  });
  const aChoices = toChoices(sel1A);
  const bChoices = toChoices(sel1B);
  return {
    rows: input.selections.map((selection) => ({
      groupId: selection.groupId,
      current: selection,
      gA: closest(selection, gAChoices),
      gBSelectorA: closest(selection, aChoices),
      gBSelectorB: closest(selection, bChoices),
    })),
    sourceHashes: {
      gde2ArtifactAggregateSha256: GDE2_AGGREGATE,
      gAFileSha256: G_A_SHA256,
      sel1ArtifactAggregateSha256: SEL1_AGGREGATE,
      sel1SelectorAFileSha256: SEL1_A_SHA256,
      sel1SelectorBFileSha256: SEL1_B_SHA256,
    },
  };
}

export function structuralObservations(text: string): string[] {
  const observations: string[] = [];
  if (
    /^(this|that|these|those|it|they|he|she|its|their|but|and)\b/i.test(
      text.trim(),
    )
  ) {
    observations.push("begins with a potentially unresolved reference");
  }
  if (text.trim().endsWith("?")) observations.push("question form");
  if (/\b(and|but|while|although|because)\b|[;:]/i.test(text)) {
    observations.push("contains a conjunction or multiple-clause marker");
  }
  const words = text.match(/\b[\p{L}\p{N}'’-]+\b/gu) ?? [];
  if (words.length < 8) observations.push("unusually short");
  return observations;
}
