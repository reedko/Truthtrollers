import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../artifacts/immutableArtifacts.js";
import {
  cfxCanonicalInventorySchema,
} from "../schemas/canonicalInventorySchema.js";

export async function loadVerifiedCfxS1Inventory(s1RunDirectory: string) {
  const inventoryPath = path.join(
    s1RunDirectory,
    "canonical_propositions.json",
  );
  const manifestPath = path.join(s1RunDirectory, "run_manifest.json");
  const inventoryBytes = await readFile(inventoryPath);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as { canonicalInventoryHash?: unknown; fixtureId?: unknown };
  const inventoryHash = sha256(inventoryBytes);
  if (manifest.canonicalInventoryHash !== inventoryHash) {
    throw new Error("Frozen CFX S1 canonical inventory hash mismatch");
  }
  const inventory = cfxCanonicalInventorySchema.parse(
    JSON.parse(inventoryBytes.toString()),
  );
  if (manifest.fixtureId !== inventory.fixtureId) {
    throw new Error("Frozen CFX S1 fixture identity mismatch");
  }
  return {
    inventory,
    inventoryBytes,
    inventoryHash,
    inventoryPath,
    manifestPath,
  };
}
