// A minimal in-memory stand-in for the mysql2 pool/connection surface that
// cfxCaseAssertionPersistence.js and storage/persistClaims.js issue queries
// against. Matches on the stable SQL fragments those two files actually use
// (SELECT/INSERT/UPDATE/DELETE against claims, content_claims, and
// claim_evaluation_targets) rather than parsing arbitrary SQL. No real
// database is touched. Supports transaction commit/rollback semantics so
// tests can prove atomicity, not just row shape.

export type FakeClaimRow = {
  claim_id: number;
  claim_text: string;
  claim_type: string;
};

export type FakeContentClaimRow = {
  cc_id: number;
  content_id: number;
  claim_id: number;
  relationship_type: string;
  claim_role: string | null;
  claim_order: number | null;
  object_claim_text: string | null;
  speaker_entity: string | null;
  article_stance: string | null;
  selected_for_evaluation: number;
  evaluation_eligible: number;
  search_eligible: number;
  verdict_eligible: number;
  source_eligible: number;
  visibility: string;
};

export type FakeEvaluationTargetRow = {
  target_id: number;
  content_id: number;
  claim_id: number;
  target_type: string;
  target_text: string;
  subject_entity: string;
  object_text: string;
  source_excerpt: string;
  article_stance: string;
  score_transform: string;
  search_eligible: number;
  verdict_eligible: number;
  resolution_status: string;
  target_order: number;
  mapping_confidence: number;
  mapping_rationale: string;
  source_claim_id: string;
  target_key: string;
  query_hints_json: string;
};

export type FakeWorkspaceState = {
  claims: FakeClaimRow[];
  content_claims: FakeContentClaimRow[];
  claim_evaluation_targets: FakeEvaluationTargetRow[];
  nextClaimId: number;
  nextContentClaimId: number;
  nextTargetId: number;
};

export function emptyFakeWorkspaceState(): FakeWorkspaceState {
  return {
    claims: [],
    content_claims: [],
    claim_evaluation_targets: [],
    nextClaimId: 1,
    nextContentClaimId: 1,
    nextTargetId: 1,
  };
}

function cloneState(state: FakeWorkspaceState): FakeWorkspaceState {
  return JSON.parse(JSON.stringify(state)) as FakeWorkspaceState;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function fakeQuery(state: FakeWorkspaceState, sql: string, values: unknown[] = []): unknown {
  const text = normalizeSql(sql);

  if (text.startsWith("SELECT claim_id FROM claims")) {
    const [claimText] = values as [string];
    const row = state.claims.find((claim) => claim.claim_type === "task" && claim.claim_text === claimText);
    return row ? [{ claim_id: row.claim_id }] : [];
  }

  if (text.startsWith("INSERT INTO claims")) {
    const [claimText] = values as [string];
    const claim_id = state.nextClaimId;
    state.nextClaimId += 1;
    state.claims.push({ claim_id, claim_text: claimText, claim_type: "task" });
    return { insertId: claim_id, affectedRows: 1 };
  }

  if (text.startsWith("SELECT cc_id FROM content_claims")) {
    const [contentId, claimId] = values as [number, number];
    const row = state.content_claims.find((row_) => row_.content_id === contentId && row_.claim_id === claimId);
    return row ? [{ cc_id: row.cc_id }] : [];
  }

  if (text.startsWith("UPDATE content_claims SET")) {
    const [order, assertion, assertionSource, articleStance, ccId] = values as
      [number, string, string, string, number];
    const row = state.content_claims.find((row_) => row_.cc_id === ccId);
    if (!row) throw new Error(`fake DB: no content_claims row ${ccId}`);
    row.relationship_type = "contains";
    row.claim_role = "pillar";
    row.claim_order = order;
    row.object_claim_text = assertion;
    row.speaker_entity = assertionSource;
    row.article_stance = articleStance;
    row.selected_for_evaluation = 1;
    row.evaluation_eligible = 1;
    row.search_eligible = 1;
    row.verdict_eligible = 1;
    row.source_eligible = 0;
    row.visibility = "workspace_eval";
    return { affectedRows: 1 };
  }

  if (text.startsWith("INSERT INTO content_claims")) {
    const [contentId, claimId, order, assertion, assertionSource, articleStance] = values as
      [number, number, number, string, string, string];
    const cc_id = state.nextContentClaimId;
    state.nextContentClaimId += 1;
    state.content_claims.push({
      cc_id, content_id: contentId, claim_id: claimId, relationship_type: "contains",
      claim_role: "pillar", claim_order: order, object_claim_text: assertion,
      speaker_entity: assertionSource, article_stance: articleStance,
      selected_for_evaluation: 1, evaluation_eligible: 1, search_eligible: 1,
      verdict_eligible: 1, source_eligible: 0, visibility: "workspace_eval",
    });
    return { insertId: cc_id, affectedRows: 1 };
  }

  if (text.startsWith("INSERT INTO claim_evaluation_targets")) {
    const [
      contentId, claimId, targetText, subjectEntity, objectText, sourceExcerpt,
      articleStance, order, sourceClaimId, targetKey, queryHintsJson,
    ] = values as [number, number, string, string, string, string, string, number, string, string, string];
    const existing = state.claim_evaluation_targets.find(
      (row) => row.content_id === contentId && row.claim_id === claimId && row.target_type === "assertion",
    );
    if (existing) {
      existing.target_text = targetText;
      existing.subject_entity = subjectEntity;
      existing.object_text = objectText;
      existing.source_excerpt = sourceExcerpt;
      existing.article_stance = articleStance;
      existing.search_eligible = 1;
      existing.verdict_eligible = 1;
      existing.resolution_status = "unresolved";
      existing.mapping_confidence = 1;
      existing.mapping_rationale = "CFX S2 substantive-review case assertion from a live scrape.";
      existing.source_claim_id = sourceClaimId;
      existing.target_key = targetKey;
      existing.query_hints_json = queryHintsJson;
      return { affectedRows: 2 };
    }
    const target_id = state.nextTargetId;
    state.nextTargetId += 1;
    state.claim_evaluation_targets.push({
      target_id, content_id: contentId, claim_id: claimId, target_type: "assertion",
      target_text: targetText, subject_entity: subjectEntity, object_text: objectText,
      source_excerpt: sourceExcerpt, article_stance: articleStance, score_transform: "review",
      search_eligible: 1, verdict_eligible: 1, resolution_status: "unresolved", target_order: order,
      mapping_confidence: 1, mapping_rationale: "CFX S2 substantive-review case assertion from a live scrape.",
      source_claim_id: sourceClaimId, target_key: targetKey, query_hints_json: queryHintsJson,
    });
    return { insertId: target_id, affectedRows: 1 };
  }

  if (text.startsWith("DELETE FROM content_claims")) {
    const [contentId, relationshipTypes] = values as [number, string[]];
    const types = new Set(relationshipTypes);
    const before = state.content_claims.length;
    const survivors = state.content_claims.filter(
      (row) => !(row.content_id === contentId && types.has(row.relationship_type)),
    );
    const removedIds = new Set(
      state.content_claims.filter((row) => !survivors.includes(row)).map((row) => row.cc_id),
    );
    state.content_claims = survivors;
    state.claim_evaluation_targets = state.claim_evaluation_targets.filter((target) => {
      const stillLinked = state.content_claims.some(
        (row) => row.content_id === target.content_id && row.claim_id === target.claim_id,
      );
      return stillLinked || !(target.content_id === contentId && removedIds.size > 0
        && !state.content_claims.some((row) => row.content_id === target.content_id && row.claim_id === target.claim_id));
    });
    return { affectedRows: before - survivors.length };
  }

  throw new Error(`fake DB: unrecognized query: ${text}`);
}

export type FakeCfxWorkspacePool = {
  committed: FakeWorkspaceState;
  transactionLog: Array<"begin" | "commit" | "rollback">;
  getConnection(): Promise<{
    query(sql: string, values?: unknown[]): Promise<unknown>;
    beginTransaction(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    release(): void;
  }>;
};

export function createFakeCfxWorkspacePool(initial: FakeWorkspaceState = emptyFakeWorkspaceState()): FakeCfxWorkspacePool {
  const pool: FakeCfxWorkspacePool = {
    committed: initial,
    transactionLog: [],
    async getConnection() {
      let working = cloneState(pool.committed);
      return {
        async query(sql: string, values: unknown[] = []) {
          return fakeQuery(working, sql, values);
        },
        async beginTransaction() {
          working = cloneState(pool.committed);
          pool.transactionLog.push("begin");
        },
        async commit() {
          pool.committed = working;
          pool.transactionLog.push("commit");
        },
        async rollback() {
          pool.transactionLog.push("rollback");
        },
        release() {},
      };
    },
  };
  return pool;
}
