import { readFile } from "node:fs/promises";
import { hashPackage } from "../claim-foundry/canonicalJson.js";
import { er1Fail } from "./errors.js";

const REQUIRED_ARRAYS = ["selectedEvaluationClaims", "phase3Targets", "evidenceNeedCards"];

function verifyShape(packageValue) {
  if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) {
    er1Fail("ER1_PACKAGE_INVALID", "CF1 package must be a JSON object");
  }
  for (const field of REQUIRED_ARRAYS) {
    if (!Array.isArray(packageValue[field])) {
      er1Fail("ER1_PACKAGE_INVALID", `CF1 package requires ${field}[]`, { field });
    }
  }
  if (!packageValue.packageId || !packageValue.packageHash) {
    er1Fail("ER1_PACKAGE_INVALID", "CF1 package identity is incomplete");
  }
}

export function verifyCf1Package(packageValue, expected = {}) {
  verifyShape(packageValue);
  if (packageValue.status !== "ready_for_evidence") {
    er1Fail("ER1_PACKAGE_NOT_READY", "CF1 package is not ready for evidence", {
      actualStatus: packageValue.status,
    });
  }
  const checks = [
    ["packageId", expected.packageId],
    ["schemaVersion", expected.expectedPackageSchemaVersion],
    ["packageHash", expected.expectedPackageHash],
  ];
  for (const [field, wanted] of checks) {
    if (wanted && packageValue[field] !== wanted) {
      er1Fail("ER1_PACKAGE_IDENTITY_MISMATCH", `CF1 ${field} does not match request`, {
        field, expected: wanted, actual: packageValue[field],
      });
    }
  }
  const computedHash = hashPackage(packageValue);
  if (computedHash !== packageValue.packageHash) {
    er1Fail("ER1_PACKAGE_HASH_MISMATCH", "CF1 package content hash is invalid", {
      declared: packageValue.packageHash, computed: computedHash,
    });
  }
  return {
    valid: true, packageId: packageValue.packageId, schemaVersion: packageValue.schemaVersion,
    packageHash: packageValue.packageHash, computedHash, status: packageValue.status,
    selectedClaimCount: packageValue.selectedEvaluationClaims.length,
    targetCount: packageValue.phase3Targets.length,
  };
}

export async function loadCf1PackageFile(filePath, expected = {}) {
  let packageValue;
  try {
    packageValue = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    er1Fail("ER1_PACKAGE_READ_FAILED", "Unable to read CF1 package JSON", {
      filePath, reason: String(error?.message || error),
    }, 400);
  }
  const verification = verifyCf1Package(packageValue, expected);
  return { packageValue, verification, filePath };
}
