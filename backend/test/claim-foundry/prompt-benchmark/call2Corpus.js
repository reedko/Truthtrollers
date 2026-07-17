// Frozen Call 2 packet corpus (coder plan §10.8). Packets are materialized from
// COMPLETE prior run artifacts (never claim-package.json alone, never any prior
// Call 2 output), rebuilt through the shared selected-enrichment context helper,
// hashed, and frozen once in inputs/call2-corpus-manifest.json.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSelectedEnrichmentContext } from "../../../src/claim-foundry/selectedEnrichmentContext.js";
import { readGenerationFile, sha256 } from "./benchmarkConfig.js";
import { prepareArticle } from "./generationRun.js";

function corpusError(message) {
  return Object.assign(new Error(message), { code: "CF1_CALL2_CORPUS_INVALID" });
}

const readJson = (dir, name) => JSON.parse(readGenerationFile(path.join(dir, name)));

// Rebuild the exact Call 2 inputs from a completed run's raw artifacts. Reads
// ONLY generation-side files; selected_enrichment.json (prior Call 2 output) is
// deliberately never opened.
export function materializePacketFromRunDir(runDir, { blockOptions } = {}) {
  const verification = readJson(runDir, "verification.json");
  if (verification?.valid !== true) {
    throw corpusError(`Source run is not a verified package: ${runDir}`);
  }
  const article = readJson(runDir, "article.json");
  const inventory = readJson(runDir, "semantic_inventory.json");
  const orientation = readJson(runDir, "article_orientation.json");
  const critic = readJson(runDir, "critic_report.json");
  const prepared = prepareArticle(article, blockOptions);
  const context = buildSelectedEnrichmentContext({ inventory, orientation, critic,
    sourceUnits: prepared.articleDocument.sourceUnits });
  return {
    schemaVersion: "cf1.call2Packet.v1",
    builderContext: {
      orientation: context.orientation,
      selectedClaims: context.selectedClaims,
      criticReport: context.criticReport,
      sourceUnits: context.sourceUnits,
      namedWorkPool: context.namedWorkPool ?? [],
    },
    verification: {
      inventory,
      article: prepared.article,
      fullSourceUnits: prepared.articleDocument.sourceUnits,
      expectedCandidateIds: context.selectedClaims.map((claim) => claim.candidateId),
      expectedClaimCount: context.selectedClaims.length,
    },
  };
}

// Build and FREEZE the corpus: neutral packet IDs, per-packet hashes, one
// immutable manifest. Source-run references go to private/ so blinded review is
// never cued by them.
export function buildCall2Corpus({ benchmarkDir, sourceRunDirs, blockOptions }) {
  const manifestPath = path.join(benchmarkDir, "inputs", "call2-corpus-manifest.json");
  if (existsSync(manifestPath)) throw corpusError("call2-corpus-manifest.json already exists (frozen)");
  const corpusDir = path.join(benchmarkDir, "inputs", "call2-corpus");
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(path.join(benchmarkDir, "private"), { recursive: true });
  const packets = [];
  const sources = [];
  sourceRunDirs.forEach((runDir, index) => {
    const packetId = `pkt-${String(index + 1).padStart(3, "0")}`;
    const packet = materializePacketFromRunDir(runDir, { blockOptions });
    const body = JSON.stringify(packet, null, 2);
    const packetPath = path.join(corpusDir, `${packetId}.json`);
    if (existsSync(packetPath)) throw corpusError(`${packetId} already exists (frozen)`);
    writeFileSync(packetPath, body);
    packets.push({ packetId, packetSha256: sha256(body),
      claimCount: packet.verification.expectedClaimCount });
    sources.push({ packetId, sourceRunDir: runDir });
  });
  const manifest = { schemaVersion: "cf1.call2CorpusManifest.v1",
    createdAt: new Date().toISOString(), packets };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(benchmarkDir, "private", "call2-corpus-sources.json"),
    JSON.stringify({ sources }, null, 2));
  return manifest;
}
