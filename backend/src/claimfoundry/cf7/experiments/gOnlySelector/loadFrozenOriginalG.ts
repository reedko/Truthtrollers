import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import type { GOnlyFrozenInput } from "./types.js";

export const G_ONLY_SOURCE_RUN =
  "cf7-semantic-grouping-cf1-f03-20260729005359" as const;
export const G_ONLY_SOURCE_ARTIFACT_AGGREGATE =
  "79ea8a9d575ca9d9eb0ef3aab1f1f6186f6bf7215856c347ab48ea97b90730e7";
export const G_ONLY_GROUP_SHA256 =
  "0feb74bef8194f62a801ddb114918dca88f83c0a5adac68b11ebfd525d55f832";
export const G_ONLY_INVENTORY_SHA256 =
  "6c96bb36205fe6f2323226b398fcbabbffe395ccf6c34c2827208f73186ab69a";
export const G_ONLY_MISSING_ASSERTIONS = [
  "H0046", "H0047", "H0048", "H0049", "H0267",
] as const;

const assertionSchema = z.object({
  assertionId: z.string().regex(/^H\d{4,}$/),
  assertionText: z.string().min(1),
}).strict();
const groupFileSchema = z.object({
  groups: z.array(z.object({
    groupId: z.string().min(1),
    assertionIds: z.array(z.string().regex(/^H\d{4,}$/)).min(1),
  }).strict()).length(21),
}).strict();

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadFrozenOriginalG(input: {
  repositoryRoot: string;
}): Promise<GOnlyFrozenInput> {
  const runDirectory = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping/CF1-F03",
    G_ONLY_SOURCE_RUN,
  );
  const sourceGroupPath = path.join(runDirectory, "prompt_G_groups.json");
  const sourceInventoryPath = path.join(
    runDirectory,
    "assertion_inventory.json",
  );
  const artifactManifest = JSON.parse(await readFile(
    path.join(runDirectory, "artifact_hashes.json"),
    "utf8",
  )) as {
    aggregateSha256: string;
    files: Array<{ name: string; sha256: string }>;
  };
  if (
    artifactManifest.aggregateSha256 !== G_ONLY_SOURCE_ARTIFACT_AGGREGATE
  ) {
    throw new Error("Original semantic-grouping artifact aggregate changed");
  }
  const groupBytes = await readFile(sourceGroupPath);
  const inventoryBytes = await readFile(sourceInventoryPath);
  if (
    sha256(groupBytes) !== G_ONLY_GROUP_SHA256
    || artifactManifest.files.find(
      (row) => row.name === "prompt_G_groups.json",
    )?.sha256 !== G_ONLY_GROUP_SHA256
  ) {
    throw new Error("Original Prompt G artifact cannot be verified");
  }
  if (
    sha256(inventoryBytes) !== G_ONLY_INVENTORY_SHA256
    || artifactManifest.files.find(
      (row) => row.name === "assertion_inventory.json",
    )?.sha256 !== G_ONLY_INVENTORY_SHA256
  ) {
    throw new Error("Original Prompt G assertion inventory cannot be verified");
  }
  const inventory = z.array(assertionSchema).length(267).parse(
    JSON.parse(inventoryBytes.toString()),
  );
  const sourceGroups = groupFileSchema.parse(JSON.parse(groupBytes.toString()));
  const assertionById = new Map(
    inventory.map((row) => [row.assertionId, row.assertionText]),
  );
  const groups = sourceGroups.groups.map((group, index) => ({
    groupId: group.groupId,
    groupIndex: index + 1,
    assertionIds: [...group.assertionIds],
    assertions: group.assertionIds.map((assertionId) => {
      const assertionText = assertionById.get(assertionId);
      if (!assertionText) {
        throw new Error(`Original Prompt G references unknown ${assertionId}`);
      }
      return { assertionId, assertionText };
    }),
  }));
  const assignedIds = groups.flatMap((group) => group.assertionIds);
  const counts = new Map<string, number>();
  for (const assertionId of assignedIds) {
    counts.set(assertionId, (counts.get(assertionId) ?? 0) + 1);
  }
  const duplicateAssertionIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([assertionId]) => assertionId)
    .sort();
  const missingAssertionIds = inventory
    .map((row) => row.assertionId)
    .filter((assertionId) => !counts.has(assertionId));
  if (
    assignedIds.length !== 262
    || duplicateAssertionIds.length !== 0
    || JSON.stringify(missingAssertionIds)
      !== JSON.stringify(G_ONLY_MISSING_ASSERTIONS)
  ) {
    throw new Error("Original Prompt G accounting does not match governance");
  }
  return {
    sourceGroupingRun: G_ONLY_SOURCE_RUN,
    sourceGroupPath,
    sourceGroupSha256: G_ONLY_GROUP_SHA256,
    sourceInventoryPath,
    sourceInventorySha256: G_ONLY_INVENTORY_SHA256,
    sourceArtifactAggregateSha256: G_ONLY_SOURCE_ARTIFACT_AGGREGATE,
    groupMembershipHash: canonicalHash(sourceGroups),
    groupCount: 21,
    assignedAssertionCount: 262,
    duplicateAssertionIds,
    missingAssertionIds,
    groups,
    inventory,
  };
}
