import { hashPackage } from "../claim-foundry/canonicalJson.js";
import { CF1_SCHEMA_VERSION } from "../claim-foundry/contract.js";
import { Cf1Error } from "../claim-foundry/errors.js";
import { verifyCf1Package } from "../claim-foundry/verifyPackage.js";

function assertPersistable(pkg) {
  const verification = verifyCf1Package(pkg, { requireFinalHash: true });
  if (!verification.valid || hashPackage(pkg) !== pkg.packageHash) {
    throw new Cf1Error("CF1_INVALID_PERSISTED_PACKAGE", "Only a verified hash-matching package may be persisted", { status: 422, issues: verification.blockingErrors });
  }
}

export async function insertCf1Package(query, { claimPackage, lineageId, packageVersion,
  supersedesPackageId = null }) {
  assertPersistable(claimPackage);
  if (claimPackage.packageVersion !== packageVersion
    || claimPackage.supersedesPackageId !== supersedesPackageId) {
    throw new Cf1Error("CF1_LINEAGE_MISMATCH", "Portable package version and supersession must match persistence lineage", { status: 409 });
  }
  const values = [claimPackage.packageId, lineageId, packageVersion, supersedesPackageId,
    claimPackage.runId, claimPackage.schemaVersion, claimPackage.pipelineVersion,
    claimPackage.article.contentHash, claimPackage.packageHash, JSON.stringify(claimPackage),
    claimPackage.selectedEvaluationClaims.length, claimPackage.phase3Targets.length,
    claimPackage.evidenceNeedCards.length, claimPackage.createdAt, claimPackage.verification.verifiedAt];
  await query(`INSERT INTO claim_foundry_packages
    (package_id, lineage_id, package_version, supersedes_package_id, run_id, schema_version,
     pipeline_version, input_hash, package_hash, package_json, selected_claim_count,
     target_count, card_count, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
}

export async function loadCf1Package(query, packageId, { forUpdate = false } = {}) {
  const rows = await query(`SELECT * FROM claim_foundry_packages WHERE package_id = ?${forUpdate ? " FOR UPDATE" : ""}`, [packageId]);
  if (!rows[0]) return null;
  const pkg = typeof rows[0].package_json === "string" ? JSON.parse(rows[0].package_json) : rows[0].package_json;
  if (pkg.packageId !== rows[0].package_id || pkg.packageHash !== rows[0].package_hash
    || hashPackage(pkg) !== rows[0].package_hash) {
    throw new Cf1Error("CF1_STORED_PACKAGE_HASH_MISMATCH", "Stored package identity or hash is invalid", { status: 500 });
  }
  return { record: rows[0], claimPackage: pkg };
}

export async function loadReadyCf1Package(query, packageId, expectedHash) {
  const loaded = await loadCf1Package(query, packageId);
  if (!loaded || loaded.claimPackage.status !== "ready_for_evidence"
    || loaded.claimPackage.schemaVersion !== CF1_SCHEMA_VERSION
    || (expectedHash && loaded.claimPackage.packageHash !== expectedHash)) {
    throw new Cf1Error("CF1_PACKAGE_NOT_READY", "Package is missing, incompatible, or not ready", { status: 409 });
  }
  return loaded;
}

export async function loadCf1PackageForConsumer(query, packageId, consumerKey) {
  const rows = await query(`SELECT p.* FROM claim_foundry_packages p
    INNER JOIN claim_foundry_package_bindings b ON b.package_id = p.package_id
    WHERE p.package_id = ? AND b.consumer_key = ? LIMIT 1`, [packageId, consumerKey]);
  if (!rows[0]) return null;
  const pkg = typeof rows[0].package_json === "string" ? JSON.parse(rows[0].package_json) : rows[0].package_json;
  if (pkg.packageHash !== rows[0].package_hash || hashPackage(pkg) !== rows[0].package_hash) {
    throw new Cf1Error("CF1_STORED_PACKAGE_HASH_MISMATCH", "Stored package hash is invalid", { status: 500 });
  }
  return { record: rows[0], claimPackage: pkg };
}

export async function lockLineageHead(query, packageId) {
  if (!packageId) return null;
  const prior = await loadCf1Package(query, packageId, { forUpdate: true });
  if (!prior) throw new Cf1Error("CF1_SUPERSEDED_PACKAGE_NOT_FOUND", "Superseded package does not exist", { status: 409 });
  const newer = await query("SELECT package_id FROM claim_foundry_packages WHERE supersedes_package_id = ? LIMIT 1 FOR UPDATE", [packageId]);
  if (newer[0]) throw new Cf1Error("CF1_LINEAGE_NOT_HEAD", "Package has already been superseded", { status: 409 });
  return prior.record;
}
