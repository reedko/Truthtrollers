import { createHash } from "node:crypto";
import type { ClaimFoundryRunState } from "./claimFoundryState.js";
import { claimFoundryRunStateSchema } from "./claimFoundryState.js";
import { workingPackageSchema, type WorkingPackage } from "./claimFoundrySchemas.js";
import {
  hashWholeArticleWorkingPackage,
  wholeArticleWorkingPackageSchema,
  type WholeArticleWorkingPackage,
} from "./claimFoundryWorkingPackage.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
export const hashValue = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const hashPackageValue = (pkg: WorkingPackage): string =>
  hashValue({ ...pkg, packageHash: null });

export type ToolEvent = {
  runId: string; sequence: number; toolName: string; toolSchemaVersion: string;
  argumentsHash: string; resultHash: string | null; beforeStateHash: string;
  afterStateHash: string; durationMs: number; status: "completed" | "failed";
  error: string | null; idempotencyKey: string; createdAt: string;
};
export type MutationResult<T> = { state: ClaimFoundryRunState; result: T; replayed: boolean };
export class PersistedMutationError extends Error {
  readonly name = "PersistedMutationError";

  constructor(
    public readonly state: ClaimFoundryRunState,
    public readonly failure: Error,
  ) {
    super(failure.message, { cause: failure });
  }
}
export type ModelRequestRecord = {
  runId: string;
  turn: number;
  responseId: string | null;
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  toolsExposed: string[];
  toolSelected: string | null;
  modelVisibleInputHash: string;
  estimatedInputTokens: number;
  payloadClassTokens: Record<string, number>;
  createdAt: string;
};

export interface ClaimFoundryPersistence {
  create(state: ClaimFoundryRunState): Promise<void>;
  load(runId: string): Promise<ClaimFoundryRunState | null>;
  events(runId: string): Promise<ToolEvent[]>;
  mutate<T>(runId: string, toolName: string, idempotencyKey: string, args: unknown,
    mutation: (state: ClaimFoundryRunState) => { state: ClaimFoundryRunState; result: T }): Promise<MutationResult<T>>;
  insertFinalPackage(packageId: string, runId: string, packageHash: string, pkg: WorkingPackage): Promise<void>;
  loadFinalPackage(packageId: string): Promise<WorkingPackage | null>;
  insertWholeArticleFinalPackage(
    packageId: string,
    runId: string,
    packageHash: string,
    pkg: WholeArticleWorkingPackage,
  ): Promise<void>;
  loadWholeArticleFinalPackage(
    packageId: string,
  ): Promise<WholeArticleWorkingPackage | null>;
  recordModelRequest(record: ModelRequestRecord): Promise<void>;
  modelRequests(runId: string): Promise<ModelRequestRecord[]>;
}

export class MemoryClaimFoundryPersistence implements ClaimFoundryPersistence {
  private readonly states = new Map<string, ClaimFoundryRunState>();
  private readonly eventRows = new Map<string, ToolEvent[]>();
  private readonly replay = new Map<string, { argsHash: string; value?: MutationResult<unknown>; error?: Error }>();
  private readonly packages = new Map<string, WorkingPackage>();
  private readonly wholeArticlePackages =
    new Map<string, WholeArticleWorkingPackage>();
  private readonly requestRows = new Map<string, ModelRequestRecord[]>();

  async create(state: ClaimFoundryRunState) {
    if (this.states.has(state.runId)) throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Run already exists");
    this.states.set(state.runId, structuredClone(claimFoundryRunStateSchema.parse(state)));
  }
  async load(runId: string) { return structuredClone(this.states.get(runId) ?? null); }
  async events(runId: string) { return structuredClone(this.eventRows.get(runId) ?? []); }
  async mutate<T>(runId: string, toolName: string, idempotencyKey: string, args: unknown,
    mutation: (state: ClaimFoundryRunState) => { state: ClaimFoundryRunState; result: T }): Promise<MutationResult<T>> {
    const key = `${runId}:${toolName}:${idempotencyKey}`;
    const argsHash = hashValue(args);
    const prior = this.replay.get(key);
    if (prior) {
      if (prior.argsHash !== argsHash) throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Idempotency key arguments differ");
      if (prior.error) throw prior.error;
      return { ...(structuredClone(prior.value) as MutationResult<T>), replayed: true };
    }
    const current = this.states.get(runId);
    if (!current) throw new ClaimFoundryError("CF6_NOT_FOUND", "Run not found");
    const beforeHash = hashValue(current);
    const started = performance.now();
    let changed: { state: ClaimFoundryRunState; result: T };
    try {
      changed = mutation(structuredClone(current));
    } catch (error) {
      const persistedFailure = error instanceof PersistedMutationError
        ? claimFoundryRunStateSchema.parse(error.state)
        : null;
      const normalized = error instanceof PersistedMutationError
        ? error.failure
        : error instanceof Error
          ? error
          : new Error(String(error));
      const rows = this.eventRows.get(runId) ?? [];
      rows.push({
        runId, sequence: rows.length + 1, toolName, toolSchemaVersion: "cf6.tools.v1",
        argumentsHash: argsHash, resultHash: null, beforeStateHash: beforeHash,
        afterStateHash: persistedFailure
          ? hashValue(persistedFailure)
          : beforeHash,
        durationMs: Math.round(performance.now() - started),
        status: "failed", error: normalized.message,
        idempotencyKey, createdAt: new Date().toISOString(),
      });
      if (persistedFailure) {
        this.states.set(runId, structuredClone(persistedFailure));
      }
      this.eventRows.set(runId, rows);
      this.replay.set(key, { argsHash, error: normalized });
      throw normalized;
    }
    const { state, result } = changed;
    const parsed = claimFoundryRunStateSchema.parse(state);
    if (toolName === "finalize_claim_package" && result && typeof result === "object"
      && "finalPackage" in result && "packageId" in result && "packageHash" in result) {
      const finalResult = result as { packageId: string; packageHash: string; finalPackage: WorkingPackage };
      await this.insertFinalPackage(finalResult.packageId, runId, finalResult.packageHash, finalResult.finalPackage);
    }
    if (toolName === "finalize_working_package" &&
      parsed.wholeArticleWorkingPackage?.status === "final" &&
      parsed.wholeArticleWorkingPackage.finalPackageId) {
      await this.insertWholeArticleFinalPackage(
        parsed.wholeArticleWorkingPackage.finalPackageId,
        runId,
        parsed.wholeArticleWorkingPackage.packageHash,
        parsed.wholeArticleWorkingPackage,
      );
    }
    const rows = this.eventRows.get(runId) ?? [];
    const event: ToolEvent = {
      runId, sequence: rows.length + 1, toolName, toolSchemaVersion: "cf6.tools.v1",
      argumentsHash: argsHash, resultHash: hashValue(result), beforeStateHash: beforeHash,
      afterStateHash: hashValue(parsed), durationMs: Math.round(performance.now() - started),
      status: "completed", error: null, idempotencyKey, createdAt: new Date().toISOString(),
    };
    this.states.set(runId, structuredClone(parsed)); rows.push(event); this.eventRows.set(runId, rows);
    const value = { state: parsed, result, replayed: false };
    this.replay.set(key, { argsHash, value: structuredClone(value) });
    return value;
  }
  async insertFinalPackage(packageId: string, runId: string, packageHash: string, pkg: WorkingPackage) {
    const prior = this.packages.get(packageId);
    if (prior && prior.packageHash !== packageHash) throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Final package identity conflict");
    if (!prior) this.packages.set(packageId, structuredClone(pkg));
  }
  async loadFinalPackage(packageId: string) { return structuredClone(this.packages.get(packageId) ?? null); }
  async insertWholeArticleFinalPackage(
    packageId: string,
    _runId: string,
    packageHash: string,
    pkg: WholeArticleWorkingPackage,
  ) {
    const prior = this.wholeArticlePackages.get(packageId);
    if (prior && prior.packageHash !== packageHash) {
      throw new ClaimFoundryError(
        "CF6_IDEMPOTENCY_CONFLICT",
        "Whole-article final package identity conflict",
      );
    }
    if (!prior) this.wholeArticlePackages.set(packageId, structuredClone(pkg));
  }
  async loadWholeArticleFinalPackage(packageId: string) {
    return structuredClone(this.wholeArticlePackages.get(packageId) ?? null);
  }
  async recordModelRequest(record: ModelRequestRecord) {
    const rows = this.requestRows.get(record.runId) ?? [];
    const prior = rows.find(row => row.turn === record.turn);
    if (prior) {
      if (hashValue(prior) !== hashValue(record)) {
        throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Model-request record conflict");
      }
      return;
    }
    rows.push(structuredClone(record));
    rows.sort((a, b) => a.turn - b.turn);
    this.requestRows.set(record.runId, rows);
  }
  async modelRequests(runId: string) {
    return structuredClone(this.requestRows.get(runId) ?? []);
  }
}

export type SqlTransactionPort = {
  transaction<T>(work: (query: (sql: string, values?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T>;
};

export class MySqlClaimFoundryPersistence implements ClaimFoundryPersistence {
  constructor(private readonly db: SqlTransactionPort) {}
  async create(state: ClaimFoundryRunState) {
    await this.db.transaction(async q => { await q(`INSERT INTO cf6_claim_foundry_run_states
      (run_id, content_id, content_hash, source_unit_manifest_hash, status, state_version, state_json)
      VALUES (?, ?, ?, ?, ?, 1, ?)`, [state.runId, state.contentId, state.contentHash,
      state.sourceUnitManifestHash, state.status, JSON.stringify(state)]); });
  }
  async load(runId: string) {
    return this.db.transaction(async q => {
      const row = (await q("SELECT state_json FROM cf6_claim_foundry_run_states WHERE run_id = ?", [runId]))[0];
      return row ? claimFoundryRunStateSchema.parse(typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json) : null;
    });
  }
  async events(runId: string) {
    return this.db.transaction(async q => (await q("SELECT * FROM cf6_claim_foundry_tool_events WHERE run_id = ? ORDER BY sequence", [runId]))
      .map(row => ({
        runId: row.run_id, sequence: Number(row.sequence), toolName: row.tool_name,
        toolSchemaVersion: row.tool_schema_version, argumentsHash: row.arguments_hash,
        resultHash: row.result_hash, beforeStateHash: row.before_state_hash,
        afterStateHash: row.after_state_hash, durationMs: Number(row.duration_ms),
        status: row.event_status, error: row.error_json
          ? JSON.stringify(typeof row.error_json === "string" ? JSON.parse(row.error_json) : row.error_json)
          : null,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })) as ToolEvent[]);
  }
  async mutate<T>(runId: string, toolName: string, idempotencyKey: string, args: unknown,
    mutation: (state: ClaimFoundryRunState) => { state: ClaimFoundryRunState; result: T }): Promise<MutationResult<T>> {
    const outcome = await this.db.transaction(async q => {
      const argsHash = hashValue(args);
      const row = (await q(`SELECT state_version, next_event_sequence, state_json
        FROM cf6_claim_foundry_run_states WHERE run_id = ? FOR UPDATE`, [runId]))[0];
      if (!row) throw new ClaimFoundryError("CF6_NOT_FOUND", "Run not found");
      const existing = (await q(`SELECT arguments_hash, result_json, event_status, error_json
        FROM cf6_claim_foundry_tool_events
        WHERE run_id = ? AND tool_name = ? AND idempotency_key = ? FOR UPDATE`,
        [runId, toolName, idempotencyKey]))[0];
      if (existing) {
        if (existing.arguments_hash !== argsHash) throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Idempotency conflict");
        if (existing.event_status === "failed") {
          const failure = typeof existing.error_json === "string" ? JSON.parse(existing.error_json) : existing.error_json;
          throw new ClaimFoundryError("CF6_INVALID_PATCH", failure?.message ?? "Prior idempotent tool call failed");
        }
        const current = (await q("SELECT state_json FROM cf6_claim_foundry_run_states WHERE run_id = ?", [runId]))[0];
        const state = current ? claimFoundryRunStateSchema.parse(
          typeof current.state_json === "string" ? JSON.parse(current.state_json) : current.state_json) : null;
        return { state: state!, result: typeof existing.result_json === "string" ? JSON.parse(existing.result_json) : existing.result_json, replayed: true };
      }
      const before = claimFoundryRunStateSchema.parse(typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json);
      const seq = Number(row.next_event_sequence);
      let changed: { state: ClaimFoundryRunState; result: T };
      try {
        changed = mutation(structuredClone(before));
      } catch (error) {
        const persistedFailure = error instanceof PersistedMutationError
          ? claimFoundryRunStateSchema.parse(error.state)
          : null;
        const normalized = error instanceof PersistedMutationError
          ? error.failure
          : error instanceof Error
            ? error
            : new Error(String(error));
        if (persistedFailure) {
          await q(`UPDATE cf6_claim_foundry_run_states SET status=?,
            state_version=state_version+1, next_event_sequence=next_event_sequence+1,
            state_json=? WHERE run_id=?`,
            [
              persistedFailure.status,
              JSON.stringify(persistedFailure),
              runId,
            ]);
        }
        await q(`INSERT INTO cf6_claim_foundry_tool_events
          (run_id, sequence, tool_name, tool_schema_version, arguments_hash, before_state_hash,
           after_state_hash, duration_ms, event_status, error_json, idempotency_key)
          VALUES (?, ?, ?, 'cf6.tools.v1', ?, ?, ?, 0, 'failed', ?, ?)`,
          [
            runId,
            seq,
            toolName,
            argsHash,
            hashValue(before),
            persistedFailure ? hashValue(persistedFailure) : hashValue(before),
            JSON.stringify({ message: normalized.message }),
            idempotencyKey,
          ]);
        if (!persistedFailure) {
          await q(`UPDATE cf6_claim_foundry_run_states
            SET next_event_sequence = next_event_sequence + 1 WHERE run_id = ?`,
            [runId]);
        }
        return { failure: normalized };
      }
      const state = claimFoundryRunStateSchema.parse(changed.state);
      await q(`UPDATE cf6_claim_foundry_run_states SET status=?, state_version=state_version+1,
        next_event_sequence=next_event_sequence+1, state_json=? WHERE run_id=?`,
        [state.status, JSON.stringify(state), runId]);
      if (toolName === "finalize_claim_package" && changed.result && typeof changed.result === "object"
        && "finalPackage" in changed.result && "packageId" in changed.result && "packageHash" in changed.result) {
        const finalResult = changed.result as { packageId: string; packageHash: string; finalPackage: WorkingPackage };
        await q(`INSERT INTO cf6_claim_foundry_final_packages
          (package_id, run_id, package_hash, package_json) VALUES (?, ?, ?, ?)`,
          [finalResult.packageId, runId, finalResult.packageHash, JSON.stringify(finalResult.finalPackage)]);
      }
      if (toolName === "finalize_working_package" &&
        state.wholeArticleWorkingPackage?.status === "final" &&
        state.wholeArticleWorkingPackage.finalPackageId) {
        await q(`INSERT INTO cf6_claim_foundry_final_packages
          (package_id, run_id, package_hash, package_json) VALUES (?, ?, ?, ?)`,
          [
            state.wholeArticleWorkingPackage.finalPackageId,
            runId,
            state.wholeArticleWorkingPackage.packageHash,
            JSON.stringify(state.wholeArticleWorkingPackage),
          ]);
      }
      await q(`INSERT INTO cf6_claim_foundry_tool_events
        (run_id, sequence, tool_name, tool_schema_version, arguments_hash, result_hash,
         result_json, before_state_hash, after_state_hash, duration_ms, event_status,
         idempotency_key) VALUES (?, ?, ?, 'cf6.tools.v1', ?, ?, ?, ?, ?, 0, 'completed', ?)`,
        [runId, seq, toolName, argsHash, hashValue(changed.result), JSON.stringify(changed.result),
        hashValue(before), hashValue(state), idempotencyKey]);
      return { state, result: changed.result, replayed: false };
    });
    if ("failure" in outcome) throw outcome.failure;
    return outcome;
  }
  async insertFinalPackage(packageId: string, runId: string, packageHash: string, pkg: WorkingPackage) {
    await this.db.transaction(async q => {
      const prior = (await q(`SELECT package_id, run_id, package_hash FROM cf6_claim_foundry_final_packages
        WHERE package_id = ? OR run_id = ? FOR UPDATE`, [packageId, runId]))[0];
      if (prior) {
        if (prior.package_id !== packageId || prior.run_id !== runId || prior.package_hash !== packageHash) {
          throw new ClaimFoundryError("CF6_IDEMPOTENCY_CONFLICT", "Final package identity conflict");
        }
        return;
      }
      await q(`INSERT INTO cf6_claim_foundry_final_packages
        (package_id, run_id, package_hash, package_json) VALUES (?, ?, ?, ?)`,
        [packageId, runId, packageHash, JSON.stringify(pkg)]);
    });
  }
  async loadFinalPackage(packageId: string) {
    return this.db.transaction(async q => {
      const row = (await q("SELECT package_hash, package_json FROM cf6_claim_foundry_final_packages WHERE package_id=?", [packageId]))[0];
      if (!row) return null;
      const pkg = workingPackageSchema.parse(typeof row.package_json === "string" ? JSON.parse(row.package_json) : row.package_json);
      if (pkg.packageHash !== row.package_hash || hashPackageValue(pkg) !== row.package_hash) {
        throw new ClaimFoundryError("CF6_INVALID_PACKAGE", "Stored final package hash mismatch");
      }
      return pkg;
    });
  }
  async insertWholeArticleFinalPackage(
    packageId: string,
    runId: string,
    packageHash: string,
    pkg: WholeArticleWorkingPackage,
  ) {
    await this.db.transaction(async q => {
      const prior = (await q(`SELECT package_id, run_id, package_hash
        FROM cf6_claim_foundry_final_packages
        WHERE package_id = ? OR run_id = ? FOR UPDATE`, [packageId, runId]))[0];
      if (prior) {
        if (prior.package_id !== packageId ||
          prior.run_id !== runId ||
          prior.package_hash !== packageHash) {
          throw new ClaimFoundryError(
            "CF6_IDEMPOTENCY_CONFLICT",
            "Whole-article final package identity conflict",
          );
        }
        return;
      }
      await q(`INSERT INTO cf6_claim_foundry_final_packages
        (package_id, run_id, package_hash, package_json) VALUES (?, ?, ?, ?)`,
        [packageId, runId, packageHash, JSON.stringify(pkg)]);
    });
  }
  async loadWholeArticleFinalPackage(packageId: string) {
    return this.db.transaction(async q => {
      const row = (await q(
        "SELECT package_hash, package_json FROM cf6_claim_foundry_final_packages WHERE package_id=?",
        [packageId],
      ))[0];
      if (!row) return null;
      const pkg = wholeArticleWorkingPackageSchema.parse(
        typeof row.package_json === "string"
          ? JSON.parse(row.package_json)
          : row.package_json,
      );
      if (pkg.packageHash !== row.package_hash ||
        hashWholeArticleWorkingPackage(pkg) !== row.package_hash) {
        throw new ClaimFoundryError(
          "CF6_INVALID_PACKAGE",
          "Stored whole-article final package hash mismatch",
        );
      }
      return pkg;
    });
  }
  async recordModelRequest(record: ModelRequestRecord) {
    await this.db.transaction(async q => {
      await q(`INSERT INTO cf6_claim_foundry_model_requests
        (run_id, model_turn, response_id, request_id, input_tokens, cached_input_tokens,
         uncached_input_tokens, output_tokens, total_tokens, model, tools_exposed_json,
         tool_selected, model_visible_input_hash, estimated_input_tokens,
        payload_class_tokens_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        record.runId, record.turn, record.responseId, record.requestId,
        record.inputTokens, record.cachedInputTokens, record.uncachedInputTokens,
        record.outputTokens, record.totalTokens, record.model,
        JSON.stringify(record.toolsExposed), record.toolSelected,
        record.modelVisibleInputHash, record.estimatedInputTokens,
        JSON.stringify(record.payloadClassTokens), new Date(record.createdAt),
      ]);
    });
  }
  async modelRequests(runId: string) {
    return this.db.transaction(async q => (await q(
      "SELECT * FROM cf6_claim_foundry_model_requests WHERE run_id=? ORDER BY model_turn",
      [runId],
    )).map(row => ({
      runId: row.run_id,
      turn: Number(row.model_turn),
      responseId: row.response_id,
      requestId: row.request_id,
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      uncachedInputTokens: Number(row.uncached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      model: row.model,
      toolsExposed: typeof row.tools_exposed_json === "string"
        ? JSON.parse(row.tools_exposed_json) : row.tools_exposed_json,
      toolSelected: row.tool_selected,
      modelVisibleInputHash: row.model_visible_input_hash,
      estimatedInputTokens: Number(row.estimated_input_tokens),
      payloadClassTokens: typeof row.payload_class_tokens_json === "string"
        ? JSON.parse(row.payload_class_tokens_json) : row.payload_class_tokens_json,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    })) as ModelRequestRecord[]);
  }
}
