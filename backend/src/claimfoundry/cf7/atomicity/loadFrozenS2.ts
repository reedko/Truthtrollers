import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import type { Cf7SourceUnit } from "../types/index.js";
import type { Cf7S3ParentRow } from "./types.js";

export const CF7_F03_S2_RUN_ID = "cf7-s2-cf1-f03-20260728113253";
export const CF7_F03_S2_INVENTORY_SHA256 =
  "4412811a5ddedc05d0c347f9d972ff880a688a14a670585a240503249a53df1f";
export const CF7_F03_S2_INVENTORY_COUNT = 267;

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isParentRow(value: unknown): value is Cf7S3ParentRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.harvestRowId === "string"
    && typeof row.chunkId === "string"
    && Number.isInteger(row.chunkIndex)
    && (row.rowKind === "assertion" || row.rowKind === "disputed")
    && typeof row.assertionText === "string"
    && Array.isArray(row.groundingUnitIds)
    && row.groundingUnitIds.every((unitId) => typeof unitId === "string");
}

export async function loadCf7F03S2Input(input: {
  repositoryRoot: string;
}): Promise<{
  runId: string;
  runDirectory: string;
  inventoryPath: string;
  inventorySha256: string;
  inventoryBytes: number;
  parents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
}> {
  const runDirectory = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/s2/CF1-F03",
    CF7_F03_S2_RUN_ID,
  );
  const inventoryPath = path.join(runDirectory, "harvest_inventory.json");
  const inventoryContent = await readFile(inventoryPath);
  const inventorySha256 = sha256(inventoryContent);
  if (inventorySha256 !== CF7_F03_S2_INVENTORY_SHA256) {
    throw new Cf7Error(
      "CF7_S3_FROZEN_INVENTORY_HASH_MISMATCH",
      `Expected ${CF7_F03_S2_INVENTORY_SHA256}, found ${inventorySha256}`,
    );
  }
  const parsed: unknown = JSON.parse(inventoryContent.toString("utf8"));
  if (
    !Array.isArray(parsed)
    || parsed.length !== CF7_F03_S2_INVENTORY_COUNT
    || !parsed.every(isParentRow)
  ) {
    throw new Cf7Error(
      "CF7_S3_INVALID_FROZEN_INVENTORY",
      "Frozen S2 inventory shape or count is invalid",
    );
  }
  const unitsPath = path.join(
    input.repositoryRoot,
    "artifacts/claim-foundry/cf7/phase1/CF1-F03/units.json",
  );
  const units = JSON.parse(
    await readFile(unitsPath, "utf8"),
  ) as Cf7SourceUnit[];
  return {
    runId: CF7_F03_S2_RUN_ID,
    runDirectory,
    inventoryPath,
    inventorySha256,
    inventoryBytes: inventoryContent.length,
    parents: parsed,
    units,
  };
}
