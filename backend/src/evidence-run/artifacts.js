import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "../claim-foundry/canonicalJson.js";
import { ER1_ARTIFACT_SCHEMA_VERSION } from "./contract.js";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function writeOfflineArtifacts({ outputDir, runId, packageId, artifacts }) {
  await mkdir(outputDir, { recursive: true });
  const entries = [];
  for (const artifact of artifacts) {
    const relativePath = artifact.fileName;
    const content = artifact.mediaType === "text/markdown" ? artifact.value : json(artifact.value);
    await writeFile(path.join(outputDir, relativePath), content, "utf8");
    entries.push({
      name: artifact.name, relativePath, sha256: sha256Hex(content),
      mediaType: artifact.mediaType || "application/json", stage: artifact.stage,
    });
  }
  const manifest = {
    schemaVersion: ER1_ARTIFACT_SCHEMA_VERSION, runId, packageId,
    createdAt: new Date().toISOString(), artifacts: entries,
  };
  await writeFile(path.join(outputDir, "artifact_manifest.json"), json(manifest), "utf8");
  return manifest;
}

export function offlineSummary({ verification, portfolio, identityRegistry, lanePlan, runId }) {
  return `# ER1 offline plan\n\n` +
    `- Run: ${runId}\n- CF1 package: ${verification.packageId}\n` +
    `- Package hash verified: yes\n- Selected tasks: ${portfolio.taskCount}\n` +
    `- Phase 3 targets: ${portfolio.targetCount}\n- Identity records: ${identityRegistry.entryCount}\n` +
    `- Planned query lanes: ${lanePlan.laneCount}\n\n` +
    `No provider, search, resolver, scraper, model, database, or migration operation ran.\n`;
}
