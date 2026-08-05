import {
  projectCfxSuggestedScore,
  type CfxAcceptedLinkSuggestion,
  type CfxPersistableSourceAssertion,
} from "./linkSuggestion.js";

type Query = (sql: string, values?: unknown[]) => Promise<any>;

/**
 * Four find-or-create/ensure persistence primitives this module needs, owned
 * by and implemented in src/services/cfxProductionEvidenceStore.js. Received
 * by dependency injection rather than imported directly: this compiled CFX
 * module (emitted under dist/claimfoundry) must not hold a source-relative
 * import into src/services, since that relative path's meaning changes once
 * TypeScript emits this file to a different directory under dist/. Callers
 * going through defaultRuntime() (cfxProductionEvidencePipeline.js) supply
 * the real implementations from cfxProductionEvidenceStore.js; direct
 * callers/tests supply them explicitly.
 */
export type CfxFinalLinkingPersistenceStore = {
  findOrCreateCanonicalClaim(query: Query, input: { claimText: string; claimType: "task" | "reference" | "snippet" }): Promise<number>;
  ensureContentClaim(query: Query, input: {
    contentId: number;
    claimId: number;
    relationshipType?: string;
    claimRole?: string;
    objectClaimText?: string | null;
    speakerEntity?: string | null;
    articleStance?: string | null;
    visibility?: string;
  }): Promise<number>;
  ensureClaimSource(query: Query, input: { claimId: number; referenceContentId: number }): Promise<number>;
  ensureContentRelation(query: Query, input: { taskContentId: number; referenceContentId: number }): Promise<number>;
};

export type CfxSourceDocumentIdentity = {
  documentId: string;
  referenceContentId: number;
};

export type CfxPersistedSourceAssertion = CfxPersistableSourceAssertion & {
  taskClaimId: number;
  referenceContentId: number;
  evidenceClaimId: number;
  claimSourceId: number;
  persistenceStatus: "inserted" | "reused";
};

function positive(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function exact(value: unknown, name: string): string {
  const text = String(value ?? "");
  if (!text.trim()) throw new TypeError(`${name} is required`);
  return text;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { return []; }
  }
  return [];
}

function assertExistingProvenanceMatches(
  existing: Record<string, unknown>,
  input: CfxPersistableSourceAssertion,
  taskClaimId: number,
  referenceContentId: number,
): void {
  const comparisons: Array<[string, unknown, unknown]> = [
    ["case_assertion_id", existing.case_assertion_id, input.caseAssertionId],
    ["task_claim_id", Number(existing.task_claim_id), taskClaimId],
    ["source_document_id", existing.source_document_id, input.documentId],
    ["reference_content_id", Number(existing.reference_content_id), referenceContentId],
    ["exact_excerpt", existing.exact_excerpt, input.exactExcerpt],
    ["excerpt_start", Number(existing.excerpt_start), input.documentCharStart],
    ["excerpt_end", Number(existing.excerpt_end), input.documentCharEnd],
    ["extraction_run_id", existing.extraction_run_id, input.extractionRunId],
    ["extraction_model_call_id", existing.extraction_model_call_id, input.extractionModelCallId],
    ["extraction_prompt_sha256", existing.extraction_prompt_sha256, input.extractionPromptHash],
    ["extraction_schema_sha256", existing.extraction_schema_sha256, input.extractionSchemaHash],
  ];
  const mismatch = comparisons.find(([, actual, expected]) => actual !== expected);
  if (mismatch) throw new Error(`sourceAssertionId collision: ${mismatch[0]} does not match persisted provenance`);
  const blocks = parseJsonArray(existing.source_block_ids_json);
  const packets = parseJsonArray(existing.source_packet_ids_json);
  if (JSON.stringify(blocks) !== JSON.stringify(input.sourceBlockIds)
    || JSON.stringify(packets) !== JSON.stringify(input.sourcePacketIds)) {
    throw new Error("sourceAssertionId collision: block or packet provenance does not match");
  }
}

export async function persistCfxSourceAssertions(input: {
  query: Query;
  store: CfxFinalLinkingPersistenceStore;
  taskClaimIds: ReadonlyMap<string, number>;
  documents: ReadonlyMap<string, CfxSourceDocumentIdentity>;
  rows: CfxPersistableSourceAssertion[];
}): Promise<CfxPersistedSourceAssertion[]> {
  const persisted: CfxPersistedSourceAssertion[] = [];
  for (const row of input.rows) {
    const taskClaimId = positive(input.taskClaimIds.get(row.caseAssertionId), "taskClaimId");
    const document = input.documents.get(row.documentId);
    if (!document) throw new Error(`missing source document ${row.documentId}`);
    const referenceContentId = positive(document.referenceContentId, "referenceContentId");
    const existing = await input.query(
      `SELECT source_assertion_id,claim_id,claim_source_id,case_assertion_id,
              task_claim_id,source_document_id,reference_content_id,exact_excerpt,
              excerpt_start,excerpt_end,source_block_ids_json,source_packet_ids_json,
              extraction_run_id,extraction_model_call_id,extraction_prompt_sha256,
              extraction_schema_sha256
         FROM cfx_source_assertion_provenance
        WHERE source_assertion_id=? FOR UPDATE`,
      [row.sourceAssertionId],
    );
    if (existing?.[0]) {
      assertExistingProvenanceMatches(existing[0], row, taskClaimId, referenceContentId);
      persisted.push({
        ...row,
        taskClaimId,
        referenceContentId,
        evidenceClaimId: positive(existing[0].claim_id, "existing claimId"),
        claimSourceId: positive(existing[0].claim_source_id, "existing claimSourceId"),
        persistenceStatus: "reused",
      });
      continue;
    }

    const evidenceClaimId = await input.store.findOrCreateCanonicalClaim(input.query, {
      claimText: exact(row.sourceAssertion, "sourceAssertion"),
      claimType: "reference",
    });
    await input.store.ensureContentClaim(input.query, {
      contentId: referenceContentId,
      claimId: evidenceClaimId,
      relationshipType: "contains",
      claimRole: "evidence",
      objectClaimText: row.sourceAssertion,
      visibility: "source_only",
    });
    const claimSourceId = await input.store.ensureClaimSource(input.query, {
      claimId: evidenceClaimId,
      referenceContentId,
    });
    await input.query(
      `INSERT INTO cfx_source_assertion_provenance
       (source_assertion_id,claim_id,claim_source_id,case_assertion_id,
        task_claim_id,source_document_id,reference_content_id,exact_excerpt,
        excerpt_start,excerpt_end,source_block_ids_json,source_packet_ids_json,
        extraction_run_id,extraction_model_call_id,extraction_prompt_sha256,
        extraction_schema_sha256,suggestion_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
      [row.sourceAssertionId, evidenceClaimId, claimSourceId, row.caseAssertionId,
        taskClaimId, row.documentId, referenceContentId, row.exactExcerpt,
        row.documentCharStart, row.documentCharEnd, JSON.stringify(row.sourceBlockIds),
        JSON.stringify(row.sourcePacketIds), row.extractionRunId,
        row.extractionModelCallId, row.extractionPromptHash, row.extractionSchemaHash],
    );
    persisted.push({
      ...row,
      taskClaimId,
      referenceContentId,
      evidenceClaimId,
      claimSourceId,
      persistenceStatus: "inserted",
    });
  }
  return persisted;
}

export type CfxPersistedLinkSuggestion = {
  sourceAssertionId: string;
  referenceClaimTaskLinkId: number;
  evidenceClaimId: number;
  taskClaimId: number;
  referenceContentId: number;
  suggestedStance: CfxAcceptedLinkSuggestion["suggestedStance"];
  suggestedScore: number;
  supportLevel: number;
  persistenceStatus: "inserted" | "updated" | "verified_value_preserved";
};

export async function persistCfxLinkSuggestions(input: {
  query: Query;
  store: CfxFinalLinkingPersistenceStore;
  taskContentId: number;
  rows: CfxPersistedSourceAssertion[];
  suggestions: CfxAcceptedLinkSuggestion[];
  suggestionRunId: string;
  suggestionModelCallIds: ReadonlyMap<string, string>;
  suggestionPromptHash: string;
  suggestionSchemaHash: string;
  model: string;
}): Promise<CfxPersistedLinkSuggestion[]> {
  const sourceById = new Map(input.rows.map((row) => [row.sourceAssertionId, row]));
  const persisted: CfxPersistedLinkSuggestion[] = [];
  for (const suggestion of input.suggestions) {
    const row = sourceById.get(suggestion.sourceAssertionId);
    if (!row) throw new Error(`accepted suggestion references unknown ${suggestion.sourceAssertionId}`);
    if (row.caseAssertionId !== suggestion.caseAssertionId) {
      throw new Error(`case assertion mismatch for ${suggestion.sourceAssertionId}`);
    }
    const relationId = await input.store.ensureContentRelation(input.query, {
      taskContentId: input.taskContentId,
      referenceContentId: row.referenceContentId,
    });
    const supportLevel = projectCfxSuggestedScore(suggestion);
    const existing = await input.query(
      `SELECT reference_claim_task_links_id,verified_by_user_id
         FROM reference_claim_task_links
        WHERE content_relation_id=? AND reference_claim_id=? AND task_claim_id=?
        LIMIT 1 FOR UPDATE`,
      [relationId, row.evidenceClaimId, row.taskClaimId],
    );
    let linkId: number;
    let status: CfxPersistedLinkSuggestion["persistenceStatus"];
    if (existing?.[0]) {
      linkId = positive(existing[0].reference_claim_task_links_id, "referenceClaimTaskLinkId");
      if (existing[0].verified_by_user_id != null) {
        status = "verified_value_preserved";
      } else {
        await input.query(
          `UPDATE reference_claim_task_links
              SET stance=?,score=NULL,confidence=NULL,support_level=?,rationale=?,
                  quote=COALESCE(NULLIF(quote,''),?),created_by_ai=1
            WHERE reference_claim_task_links_id=? AND verified_by_user_id IS NULL`,
          [suggestion.suggestedStance, supportLevel, suggestion.rationale,
            row.exactExcerpt, linkId],
        );
        status = "updated";
      }
    } else {
      const result = await input.query(
        `INSERT INTO reference_claim_task_links
         (content_relation_id,reference_claim_id,task_claim_id,stance,score,
          confidence,support_level,rationale,quote,created_by_ai,verified_by_user_id)
         VALUES (?,?,?,?,NULL,NULL,?,?,?,1,NULL)`,
        [relationId, row.evidenceClaimId, row.taskClaimId,
          suggestion.suggestedStance, supportLevel, suggestion.rationale, row.exactExcerpt],
      );
      linkId = positive(result.insertId, "referenceClaimTaskLinkId");
      status = "inserted";
    }
    await input.query(
      `UPDATE cfx_source_assertion_provenance
          SET reference_claim_task_links_id=?,suggestion_run_id=?,
              suggestion_model_call_id=?,suggestion_prompt_sha256=?,
              suggestion_schema_sha256=?,suggestion_model=?,
              suggested_stance=?,suggested_score=?,suggestion_rationale=?,
              suggestion_status='accepted',updated_at=CURRENT_TIMESTAMP(6)
        WHERE source_assertion_id=?`,
      [linkId, input.suggestionRunId,
        exact(input.suggestionModelCallIds.get(row.caseAssertionId), "suggestionModelCallId"),
        input.suggestionPromptHash, input.suggestionSchemaHash, input.model,
        suggestion.suggestedStance, suggestion.suggestedScore, suggestion.rationale,
        suggestion.sourceAssertionId],
    );
    persisted.push({
      sourceAssertionId: suggestion.sourceAssertionId,
      referenceClaimTaskLinkId: linkId,
      evidenceClaimId: row.evidenceClaimId,
      taskClaimId: row.taskClaimId,
      referenceContentId: row.referenceContentId,
      suggestedStance: suggestion.suggestedStance,
      suggestedScore: suggestion.suggestedScore,
      supportLevel,
      persistenceStatus: status,
    });
  }
  return persisted;
}
