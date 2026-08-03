import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { encoding_for_model } from "tiktoken";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  hashArtifactTree,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  buildCfxDocumentBearingRequests,
  cfxDocumentBearingSchemaHash,
  cfxDocumentBearingTargetInventoryHash,
  loadCfxDocumentBearingPrompt,
  type CfxDocumentBearingTarget,
} from "../evidenceBearing/documentExtraction.js";
import type { CfxEvidenceTextAccess } from "../evidenceBearing/types.js";
import {
  prioritizeCfxPhase3Documents,
  type CfxPhase3DocumentCandidate,
} from "../phase3/prioritization.js";
import type { CfxQueryIntent } from "../retrieval/types.js";

const TASK_CONTENT_ID = Number(process.argv[2] ?? 18056);
const MODEL = "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = 8_000;
const TIMEOUT_MS = 180_000;
const CONCURRENCY = 4;
const INPUT_USD_PER_MILLION = 0.15;
const OUTPUT_USD_PER_MILLION = 0.60;
const ARTIFACT_ROOT = path.resolve(process.cwd(), "..", "artifacts", "claim-foundry", "cfx", "document-centric-bearing");
const configuredRetrievalCandidates = process.env.CFX_RETRIEVAL_CANDIDATES_PATH?.trim();
if (!configuredRetrievalCandidates) {
  throw new Error(
    "CFX_RETRIEVAL_CANDIDATES_PATH is required; Phase 3 preflight will not silently " +
    "reuse the historical 2026-07-31 retrieval inventory.",
  );
}
const RETRIEVAL_CANDIDATES = path.resolve(configuredRetrievalCandidates);

type Row = RowDataPacket & Record<string, unknown>;
const intentByQuery: Record<string, CfxQueryIntent> = {
  Q1: "canonical", Q2: "entity_predicate", Q3: "source_identity",
  Q4: "independent_evidence", Q5: "counterevidence",
};

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z").toLowerCase();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { return jsonObject(JSON.parse(value)); } catch { return {}; }
  }
  return {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

async function main(): Promise<void> {
  if (!Number.isSafeInteger(TASK_CONTENT_ID) || TASK_CONTENT_ID <= 0) {
    throw new TypeError("task content ID must be a positive integer");
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 1,
  });
  try {
    const [claimRows] = await pool.query<Row[]>(
      `SELECT cc.claim_id,cc.claim_order,COALESCE(cc.object_claim_text,c.claim_text) assertion
         FROM content_claims cc JOIN claims c ON c.claim_id=cc.claim_id
        WHERE cc.content_id=? AND cc.selected_for_evaluation=1
        ORDER BY cc.claim_order,cc.cc_id`, [TASK_CONTENT_ID],
    );
    const targets: CfxDocumentBearingTarget[] = claimRows.map((row, index) => ({
      propositionId: `P${String(Number(row.claim_order ?? index + 1)).padStart(2, "0")}`,
      claimId: Number(row.claim_id), assertion: String(row.assertion),
    }));
    if (targets.length === 0) throw new Error("No immutable selected target inventory found");

    const [phase2TableRows] = await pool.query<Row[]>(
      `SELECT COUNT(*) table_count FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cfx_canonical_documents'`,
    );
    const canonicalPhase2TablesPresent = Number(phase2TableRows[0]?.table_count ?? 0) === 1;

    const [textRows] = await pool.query<Row[]>(
      `SELECT b.binding_id,b.run_id,b.proposition_id,b.candidate_id,b.requested_url,
              b.reference_content_id,
              v.acquired_text_version_id,v.access_level,v.extraction_method,v.source_url,
              v.resolved_url,v.cleaned_text,v.cleaned_text_sha256,v.character_count,v.word_count,
              a.provider,a.response_metadata_json
         FROM cfx_evidence_acquisition_bindings b
         JOIN cfx_evidence_text_versions v ON v.binding_id=b.binding_id
         LEFT JOIN cfx_evidence_acquisition_attempts a
           ON a.acquisition_attempt_id=v.acquisition_attempt_id
        WHERE b.task_content_id=? AND v.selected_for_bearing=1
        ORDER BY v.acquired_text_version_id`, [TASK_CONTENT_ID],
    );
    const candidateArtifact = jsonObject(JSON.parse(await readFile(RETRIEVAL_CANDIDATES, "utf8")));
    const frozenCandidates = Array.isArray(candidateArtifact.candidates)
      ? candidateArtifact.candidates as Row[] : [];
    const candidates: CfxPhase3DocumentCandidate[] = textRows.map((row) => {
      const metadata = jsonObject(row.response_metadata_json);
      const identifiers = jsonObject(metadata.identifiers);
      const frozen = frozenCandidates.find((candidate) => candidate.candidateId === row.candidate_id);
      const paths = frozen && Array.isArray(frozen.discoveryPaths) ? frozen.discoveryPaths as Row[] : [];
      const queryIds = unique(paths.map((value) => String(value.queryId ?? "")));
      const queryIntents = unique(queryIds.map((queryId) => intentByQuery[queryId] ?? "canonical")) as CfxQueryIntent[];
      const providerNames = unique([
        String(row.provider ?? ""), ...paths.map((value) => String(value.provider ?? "")),
      ]);
      const identityKind = identifiers.pmid ? "pmid" as const
        : identifiers.doi ? "doi" as const
          : row.source_url ? "canonical_url" as const : "resolved_url" as const;
      let publisher = "";
      try { publisher = new URL(String(row.resolved_url ?? row.source_url)).hostname; } catch { /* absent */ }
      const identityValue = String(identifiers.pmid ?? identifiers.doi
        ?? row.source_url ?? row.resolved_url ?? "");
      return {
        documentId: `DOC-${identityKind.toUpperCase()}-${identityValue.replace(/[^A-Za-z0-9]+/gu, "-")}`,
        selectedTextVersionId: Number(row.acquired_text_version_id),
        title: frozen ? String(frozen.title ?? "") || null : null,
        canonicalIdentityKind: identityKind,
        canonicalIdentityValue: identityValue,
        sourceUrl: String(row.resolved_url ?? row.source_url ?? "") || null,
        accessLevel: String(row.access_level) as CfxEvidenceTextAccess["accessLevel"],
        textLength: Number(row.character_count ?? String(row.cleaned_text ?? "").length),
        selectedTextVersionHash: String(row.cleaned_text_sha256),
        propositionIds: unique([String(row.proposition_id ?? ""), ...paths.map((value) => String(value.propositionId ?? ""))]),
        queryIds,
        queryIntents,
        providers: providerNames,
        publishers: unique([publisher]),
        documentRoles: ["other"],
      };
    });
    const ranked = prioritizeCfxPhase3Documents({ documents: candidates });
    const tier1 = ranked.filter((document) => document.tier === "tier_1");
    const prompt = await loadCfxDocumentBearingPrompt();
    const requests = tier1.flatMap((document) => {
      const row = textRows.find((value) => Number(value.acquired_text_version_id) === document.selectedTextVersionId)!;
      const access: CfxEvidenceTextAccess = {
        candidateId: String(row.candidate_id), accessLevel: document.accessLevel,
        textSource: row.extraction_method === "pmc" ? "pmc" : "provider",
        text: String(row.cleaned_text), characterCount: Number(row.character_count),
        wordCount: Number(row.word_count), sourceUrl: String(row.source_url ?? "") || null,
        canonicalUrl: String(row.source_url ?? "") || null,
        doi: String(jsonObject(row.response_metadata_json).identifiers
          ? jsonObject(jsonObject(row.response_metadata_json).identifiers).doi ?? "" : "") || null,
        pmid: String(jsonObject(row.response_metadata_json).identifiers
          ? jsonObject(jsonObject(row.response_metadata_json).identifiers).pmid ?? "" : "") || null,
        retrievalAttempts: [], accessDiagnostics: [],
      };
      return buildCfxDocumentBearingRequests({
        documentId: document.documentId, targets, access, prompt, model: MODEL,
        temperature: 0.1, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS,
      }).map((part) => ({ documentId: document.documentId, part }));
    });
    const encoding = encoding_for_model(MODEL);
    const inputTokenEstimate = requests.reduce((sum, { part }) => sum
      + encoding.encode(part.request.system).length
      + encoding.encode(part.request.user).length
      + encoding.encode(JSON.stringify(part.request.responseSchema)).length + 20, 0);
    encoding.free();
    const outputTokenCeiling = requests.length * MAX_OUTPUT_TOKENS;
    const costCeilingUsd = inputTokenEstimate / 1_000_000 * INPUT_USD_PER_MILLION
      + outputTokenCeiling / 1_000_000 * OUTPUT_USD_PER_MILLION;
    const runId = `cfx-phase3-preflight-${timestamp()}`;
    const root = path.join(ARTIFACT_ROOT, runId);
    await createImmutableDirectory(root);
    const manifest = {
      schemaVersion: "cfx.phase3.preflight.v1",
      runId, fixture: "CF1-F03", taskContentId: TASK_CONTENT_ID,
      generatedAt: new Date().toISOString(), modelCallsMade: 0,
      inventorySource: "persisted selected CFX evidence text versions",
      canonicalPhase2TablesPresent,
      inventoryLimitation: tier1.length < 12
        ? `Only ${tier1.length} eligible acquired selected text version(s) currently exist; no unavailable document was promoted.`
        : null,
      targetCount: targets.length,
      targetInventoryHash: cfxDocumentBearingTargetInventoryHash(targets),
      rankedDocumentCount: ranked.length,
      eligibleDocumentCount: ranked.filter((value) => value.eligible).length,
      proposedTier1Count: tier1.length,
      exactMaximumModelCallCount: requests.length,
      configuration: {
        transport: "OpenAI Chat Completions through the existing repository structured provider",
        model: MODEL, temperature: 0.1, responseSchema: "cfx_document_centric_bearing_v2",
        maximumOutputTokensPerRequest: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS,
        retries: 0, concurrency: CONCURRENCY, store: false,
        maximumDocumentCharactersPerRequest: 60_000,
      },
      hashes: { prompt: prompt.promptHash, schema: cfxDocumentBearingSchemaHash() },
      estimatedCeiling: {
        inputTokens: inputTokenEstimate, outputTokens: outputTokenCeiling,
        inputUsdPerMillionTokens: INPUT_USD_PER_MILLION,
        outputUsdPerMillionTokens: OUTPUT_USD_PER_MILLION,
        totalUsd: Number(costCeilingUsd.toFixed(6)),
      },
      selectedTextVersionHashes: tier1.map((value) => ({
        documentId: value.documentId, sha256: value.selectedTextVersionHash,
      })),
    };
    await writeImmutableJson(path.join(root, "ranked_canonical_document_inventory.json"), ranked);
    await writeImmutableJson(path.join(root, "proposed_tier1.json"), tier1);
    await writeImmutableJson(path.join(root, "target_inventory.json"), { targets, sha256: manifest.targetInventoryHash });
    await writeImmutableJson(path.join(root, "preflight_manifest.json"), manifest);
    const report = [
      "# CFX Phase 3 offline gate and preflight", "",
      `- Status: OFFLINE_PHASE_3_PASS`,
      `- Fixture/task: CF1-F03 / ${TASK_CONTENT_ID}`,
      `- Provider calls made: 0`,
      `- Fixed targets: ${targets.length}`,
      `- Target inventory hash: ${manifest.targetInventoryHash}`,
      `- Prompt hash: ${prompt.promptHash}`,
      `- Schema hash: ${manifest.hashes.schema}`, "",
      "## Ranked canonical-document inventory", "",
      ...ranked.map((document) =>
        `${document.rank ?? "-"}. ${document.documentId}${document.title ? ` (${document.title})` : ""} — ${document.accessLevel}, ${document.textLength} chars, ${document.canonicalIdentityKind}:${document.canonicalIdentityValue}, ${document.tier}; ${document.selectionReasons.join("; ") || document.eligibilityReason}`),
      "", "## Proposed Tier 1", "",
      ...(tier1.length ? tier1.map((document) =>
        `- ${document.documentId}: ${document.selectionReasons.join("; ")}; text SHA-256 ${document.selectedTextVersionHash}`)
        : ["- None: no eligible selected evidence text exists."]),
      "", `The requested 12–18 document band is not fabricated: only ${tier1.length} eligible acquired selected text version(s) currently exist.`,
      "", "## Exact prospective live configuration", "",
      `- Calls: at most ${requests.length}`,
      `- Model/transport: ${MODEL}, OpenAI Chat Completions`,
      `- Temperature: 0.1`, `- Strict schema: cfx_document_centric_bearing_v2`,
      `- Output: ${MAX_OUTPUT_TOKENS} tokens/request`, `- Timeout: ${TIMEOUT_MS} ms`,
      `- Retries: 0`, `- Concurrency: ${CONCURRENCY}`, `- store: false`,
      `- Estimated input: ${inputTokenEstimate} tokens`,
      `- Maximum output: ${outputTokenCeiling} tokens`,
      `- Estimated cost ceiling: $${costCeilingUsd.toFixed(6)}`,
      "", "No live semantic extraction was executed.", "",
    ].join("\n");
    await writeImmutableText(path.join(root, "PHASE3_OFFLINE_REPORT.md"), report);
    const files = await hashArtifactTree(root);
    await writeImmutableJson(path.join(root, "artifact_hashes.json"), {
      files, artifactAggregateSha256: aggregateArtifactHash(files),
    });
    process.stdout.write(`${JSON.stringify({ root, ...manifest }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

await main();
