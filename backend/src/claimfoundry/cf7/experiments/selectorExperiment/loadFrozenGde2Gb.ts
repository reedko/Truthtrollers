import {
  createHash,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import type { Sel1FrozenInput } from "./types.js";

export const SEL1_SOURCE_RUN_ID = "cf7-gde2-cf1-f03-20260729013932";
export const SEL1_SOURCE_ARTIFACT_AGGREGATE_SHA256 =
  "59ff0fd9b8a1f4aa3d0945791c397e813947295dcd6c9df61d0b0bac5ca3692b";
export const SEL1_SOURCE_INVENTORY_HASH =
  "b45f92cecf8bd4a3a7b1d5404f4f81796dcdadfbf7d375603345385d234ee6bd";
export const SEL1_EXPECTED_GROUP_COUNT = 24;

const assertionSchema = z.object({
  assertionId: z.string().regex(/^H\d{4,}$/),
  assertionText: z.string().min(1),
}).strict();

const inventorySchema = z.array(assertionSchema).length(267);
const groupOutputSchema = z.object({
  groups: z.array(z.object({
    groupId: z.string().min(1),
    assertionIds: z.array(z.string().regex(/^H\d{4,}$/)).min(1),
    representativeAssertion: z.string().min(1),
  }).strict()).length(SEL1_EXPECTED_GROUP_COUNT),
}).strict();

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadFrozenSel1Input(input: {
  repositoryRoot: string;
}): Promise<Sel1FrozenInput> {
  const runDirectory = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping-representative/CF1-F03",
    SEL1_SOURCE_RUN_ID,
  );
  const artifactManifest = JSON.parse(await readFile(
    path.join(runDirectory, "artifact_hashes.json"),
    "utf8",
  )) as {
    aggregateSha256: string;
    files: Array<{ name: string; sha256: string }>;
  };
  if (
    artifactManifest.aggregateSha256
      !== SEL1_SOURCE_ARTIFACT_AGGREGATE_SHA256
  ) {
    throw new Error("Frozen GDE-2 artifact aggregate hash changed");
  }
  const inventoryBuffer = await readFile(
    path.join(runDirectory, "assertion_inventory.json"),
  );
  const groupsBuffer = await readFile(path.join(runDirectory, "G-B_groups.json"));
  const expectedGroupFileHash = artifactManifest.files.find(
    (row) => row.name === "G-B_groups.json",
  )?.sha256;
  if (!expectedGroupFileHash || sha256(groupsBuffer) !== expectedGroupFileHash) {
    throw new Error("Frozen G-B group file hash changed");
  }
  const inventory = inventorySchema.parse(JSON.parse(inventoryBuffer.toString()));
  if (canonicalHash(inventory) !== SEL1_SOURCE_INVENTORY_HASH) {
    throw new Error("Frozen GDE-2 assertion inventory hash changed");
  }
  const sourceOutput = groupOutputSchema.parse(
    JSON.parse(groupsBuffer.toString()),
  );
  const assertionById = new Map(
    inventory.map((row) => [row.assertionId, row.assertionText]),
  );
  const groups = sourceOutput.groups.map((group, index) => ({
    groupId: group.groupId,
    groupIndex: index + 1,
    semanticSubThesis: group.representativeAssertion,
    assertions: group.assertionIds.map((assertionId) => {
      const assertionText = assertionById.get(assertionId);
      if (!assertionText) {
        throw new Error(`G-B group references unknown assertion ${assertionId}`);
      }
      return { assertionId, assertionText };
    }),
  }));
  const allAssertionIds = groups.flatMap((group) =>
    group.assertions.map((row) => row.assertionId));
  const counts = new Map<string, number>();
  for (const assertionId of allAssertionIds) {
    counts.set(assertionId, (counts.get(assertionId) ?? 0) + 1);
  }
  const duplicateAssertionIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([assertionId]) => assertionId)
    .sort();
  const sourceInputHash = canonicalHash(groups);
  return {
    sourceRunId: SEL1_SOURCE_RUN_ID,
    sourceArtifactAggregateSha256:
      SEL1_SOURCE_ARTIFACT_AGGREGATE_SHA256,
    sourceGde2InventoryHash: SEL1_SOURCE_INVENTORY_HASH,
    sourceGde2GroupFileSha256: expectedGroupFileHash,
    groupCount: SEL1_EXPECTED_GROUP_COUNT,
    assertionAssignmentCount: allAssertionIds.length,
    uniqueAssertionCount: counts.size,
    duplicateAssertionIds,
    sourceInputHash,
    groups,
  };
}
