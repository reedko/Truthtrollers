import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const envFile = readFlag("--env-file", ".env");
dotenv.config({ path: envFile, override: true });
const { query, pool } = await import("../src/db/pool.js");

function readIntegerFlag(name, { required = true } = {}) {
  const raw = readFlag(name);
  if (!required && raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function tableExists(tableName) {
  const rows = await query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

async function main() {
  const contentId = readIntegerFlag("--content-id");
  const taskClaimId = readIntegerFlag("--task-claim-id", { required: false });
  const viewerId = readIntegerFlag("--viewer-id", { required: false });
  const exportedAt = new Date();

  const rootContent = await query("SELECT * FROM content WHERE content_id = ?", [contentId]);
  if (rootContent.length !== 1) {
    throw new Error(`Expected content ${contentId} to exist exactly once; found ${rootContent.length}`);
  }

  const contentRelations = await query(
    `SELECT *
       FROM content_relations
      WHERE content_id = ? OR reference_content_id = ?
      ORDER BY content_relation_id`,
    [contentId, contentId],
  );

  const relatedContentIds = [...new Set([
    contentId,
    ...contentRelations.flatMap((row) => [row.content_id, row.reference_content_id]),
  ].map(Number).filter(Number.isInteger))];
  const relationIds = contentRelations.map((row) => Number(row.content_relation_id)).filter(Number.isInteger);

  const content = await query(
    "SELECT * FROM content WHERE content_id IN (?) ORDER BY content_id",
    [relatedContentIds],
  );
  const contentClaims = await query(
    "SELECT * FROM content_claims WHERE content_id IN (?) ORDER BY content_id, claim_id",
    [relatedContentIds],
  );
  const allClaimIds = [...new Set(contentClaims.map((row) => Number(row.claim_id)).filter(Number.isInteger))];
  const taskClaimIds = [...new Set(contentClaims
    .filter((row) => Number(row.content_id) === contentId)
    .map((row) => Number(row.claim_id))
    .filter(Number.isInteger))];

  const claims = allClaimIds.length
    ? await query("SELECT * FROM claims WHERE claim_id IN (?) ORDER BY claim_id", [allClaimIds])
    : [];

  const referenceClaimLinks = relationIds.length || taskClaimIds.length
    ? await query(
      `SELECT *
         FROM reference_claim_links
        WHERE ${relationIds.length ? "content_relation_id IN (?)" : "FALSE"}
           OR (${taskClaimIds.length ? "COALESCE(task_claim_id, claim_id) IN (?)" : "FALSE"})
        ORDER BY ref_claim_link_id`,
      [
        ...(relationIds.length ? [relationIds] : []),
        ...(taskClaimIds.length ? [taskClaimIds] : []),
      ],
    )
    : [];

  const referenceClaimTaskLinks = relationIds.length || taskClaimIds.length
    ? await query(
      `SELECT *
         FROM reference_claim_task_links
        WHERE ${relationIds.length ? "content_relation_id IN (?)" : "FALSE"}
           OR (${taskClaimIds.length ? "task_claim_id IN (?)" : "FALSE"})
        ORDER BY reference_claim_task_links_id`,
      [
        ...(relationIds.length ? [relationIds] : []),
        ...(taskClaimIds.length ? [taskClaimIds] : []),
      ],
    )
    : [];

  let contentUsers = [];
  if (viewerId && await tableExists("content_users")) {
    contentUsers = await query(
      "SELECT * FROM content_users WHERE content_id IN (?) AND user_id = ? ORDER BY content_id",
      [relatedContentIds, viewerId],
    );
  }

  const tables = {
    content,
    content_relations: contentRelations,
    content_claims: contentClaims,
    claims,
    reference_claim_links: referenceClaimLinks,
    reference_claim_task_links: referenceClaimTaskLinks,
    content_users: contentUsers,
  };
  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));

  const snapshot = {
    metadata: {
      snapshot_version: 1,
      exported_at: exportedAt.toISOString(),
      database: process.env.DB_DATABASE || null,
      root_content_id: contentId,
      requested_task_claim_id: taskClaimId,
      viewer_id: viewerId,
      requested_task_claim_present: taskClaimId == null ? null : taskClaimIds.includes(taskClaimId),
      environment_file: path.basename(envFile),
      scope: "Root content, every relation touching it, all related content and claims, and evidence links selected by those relation IDs or the root task's claim IDs.",
      counts,
    },
    tables,
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const outputDirectory = path.join(repoRoot, "artifacts", "debug-snapshots");
  const outputPath = path.join(
    outputDirectory,
    `content-${contentId}-before-rescrape-${timestampForFilename(exportedAt)}.json`,
  );
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ output_path: outputPath, ...snapshot.metadata }, null, 2));
}

try {
  await main();
} finally {
  await new Promise((resolve) => pool.end(resolve));
}
