import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../artifacts/immutableArtifacts.js";
import {
  cfxUnitAwareInventorySchema,
} from "../schemas/unitAwareInventorySchema.js";

export async function loadVerifiedUnitAwareInventory(
  runDirectory: string,
) {
  const inventoryPath = path.join(
    runDirectory,
    "canonical_propositions_with_units.json",
  );
  const inventoryBytes = await readFile(inventoryPath);
  const hashes = JSON.parse(
    await readFile(path.join(runDirectory, "artifact_hashes.json"), "utf8"),
  ) as {
    files?: Array<{ path?: unknown; sha256?: unknown }>;
  };
  const recordedHash = hashes.files?.find(
    (file) => file.path === "canonical_propositions_with_units.json",
  )?.sha256;
  const inventoryHash = sha256(inventoryBytes);
  if (recordedHash !== inventoryHash) {
    throw new Error("Frozen unit-aware inventory hash mismatch");
  }
  return {
    inventory: cfxUnitAwareInventorySchema.parse(
      JSON.parse(inventoryBytes.toString()),
    ),
    inventoryBytes,
    inventoryHash,
    inventoryPath,
  };
}
