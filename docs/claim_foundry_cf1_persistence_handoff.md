# CF1 Phase 2 — Immutable Persistence and EvidenceRun Handoff

**Status:** Planning decision for review
**Decision:** Create dedicated CF1 persistence tables. Do not reuse TM4 package tables as the CF1 source of truth.

## 1. Schema findings

Live `SHOW CREATE TABLE` inspection confirms:

- `tm4_claim_packages.content_id` is mandatory and cascades with VeriStrata `content` deletion.
- TM4 run IDs and tables encode TM4 names and preview/materialization assumptions.
- `tm4_selected_evaluation_claims` requires VeriStrata `claim_id` and optionally `content_claims.cc_id`.
- TM4 raw/reconciliation tables model the older phase-specific structure rather than the portable CF1 package.
- `claims`, `content_claims`, and `claim_evaluation_targets` are mutable Workspace/EvidenceRun projections.
- `claim_evaluation_targets` still defaults `score_transform` to `review`, which CF1 forbids.
- Evidence results already live separately in `evaluation_target_evidence_links`.
- The current store performs multi-table writes without owning a transaction; CF1 requires a connection-bound transaction.

TM4 tables remain historical/compatibility data. CF1 must not rename, rewrite, or delete them during initial adoption.

## 2. Why dedicated CF1 tables

A dedicated store is required because the CF1 package is:

- consumer-neutral
- immutable and versioned
- valid without a VeriStrata `content_id`
- a complete JSON contract rather than a collection of TM4 phase rows
- the durable handoff to an independently versioned EvidenceRun agent

Reusing TM4 tables would make the portable API depend on VeriStrata content rows, preserve obsolete terminology, and require lossy translation before the source package is stored.

## 3. Proposed tables

### `claim_foundry_runs`

Mutable execution envelope. One row exists from request acceptance through terminal CF1 status.

| Column | Type | Rules |
|---|---|---|
| `run_id` | VARCHAR(48) PK | `cf1run_` + lowercase UUIDv7 |
| `consumer_key` | VARCHAR(64) | authenticated tenant/integration key |
| `idempotency_key` | VARCHAR(200) | required after server derivation |
| `input_hash` | CHAR(64) | normalized portable article input |
| `options_hash` | CHAR(64) | semantic run options only |
| `pipeline_version` | VARCHAR(32) | e.g. `cf1.0.0` |
| `status` | VARCHAR(32) | lifecycle enum below |
| `package_id` | VARCHAR(48) NULL | set only after verified package insert |
| `error_code` | VARCHAR(100) NULL | stable terminal code |
| `error_json` | JSON NULL | bounded structured failure |
| `usage_json` | JSON NULL | calls, tokens, duration, repair count |
| `artifact_root` | VARCHAR(1,000) NULL | opaque relative artifact reference |
| `created_at` | TIMESTAMP | server time |
| `updated_at` | TIMESTAMP | server time |
| `completed_at` | TIMESTAMP NULL | terminal time |

Unique key: `(consumer_key, idempotency_key)`. Index `(status, created_at)` supports recovery/operations.

Run status enum:

```text
submitted, running, verification_failed, ready_for_evidence, failed
```

`ready_for_evidence` means CF1 completed. EvidenceRun status does not update this row.

### `claim_foundry_packages`

Immutable verified package source of truth.

| Column | Type | Rules |
|---|---|---|
| `package_id` | VARCHAR(48) PK | `cf1pkg_` + lowercase UUIDv7 |
| `lineage_id` | VARCHAR(48) | `cf1lin_` + lowercase UUIDv7 |
| `package_version` | INT UNSIGNED | starts at 1 |
| `supersedes_package_id` | VARCHAR(48) NULL | self-reference to immediate predecessor |
| `run_id` | VARCHAR(48) UNIQUE | originating run |
| `schema_version` | VARCHAR(64) | `cf1.claimPackage.v1` |
| `pipeline_version` | VARCHAR(32) | producing implementation version |
| `input_hash` | CHAR(64) | article input identity |
| `package_hash` | CHAR(64) | canonical immutable package hash |
| `package_json` | JSON | complete verified portable package |
| `selected_claim_count` | SMALLINT UNSIGNED | query/diagnostic projection |
| `target_count` | SMALLINT UNSIGNED | query/diagnostic projection |
| `card_count` | SMALLINT UNSIGNED | query/diagnostic projection |
| `created_at` | TIMESTAMP | immutable creation time |
| `verified_at` | TIMESTAMP | verifier time |

Unique keys: `(lineage_id, package_version)` and `package_hash`. Foreign keys link `run_id` and `supersedes_package_id`. A package row is inserted only after deterministic verification succeeds.

Application and database protections must reject updates to package identity, JSON, hashes, versions, counts, and timestamps. Supersession inserts a new row; it never edits the previous package.

### `claim_foundry_package_bindings`

Consumer/adaptor relationships kept outside the portable package.

| Column | Type | Rules |
|---|---|---|
| `binding_id` | BIGINT UNSIGNED PK | auto increment |
| `package_id` | VARCHAR(48) | package FK; cascade with package |
| `consumer_key` | VARCHAR(64) | integration/tenant |
| `consumer_content_ref` | VARCHAR(200) NULL | consumer-owned reference |
| `content_id` | INT NULL | VeriStrata adapter only; `ON DELETE SET NULL` |
| `projection_status` | VARCHAR(32) | `not_requested`, `pending`, `projected`, `failed`, `superseded` |
| `projection_error_json` | JSON NULL | bounded adapter failure |
| `projected_at` | TIMESTAMP NULL | adapter completion |
| `created_at` | TIMESTAMP | binding creation |

Unique key: `(package_id, consumer_key, consumer_content_ref)`. Index `(content_id, projection_status)` supports VeriStrata reads. Deleting VeriStrata content must not delete the portable package.

## 4. Identity and hashing

- IDs use UUIDv7 from the repository's existing direct `uuid` dependency. Prefixes
  identify their type while UUIDv7 supplies opaque, time-sortable identity without
  introducing another package.
- `run_id`, `package_id`, and `lineage_id` are different identities.
- `input_hash` hashes canonical normalized `{title, text}`, excluding consumer
  references, metadata warnings, and all other metadata.
- `options_hash` hashes only options that can change semantic output.
- `package_hash` hashes canonical verified package content excluding its own hash and volatile timestamps/diagnostics.
- Canonical JSON requires recursively sorted object keys, preserved array order, UTF-8, and no insignificant whitespace.

Do not derive public IDs from content or hashes; hashes may reveal equality across consumers.

## 5. Idempotency

The server requires or derives an idempotency key before creating a run.

On `(consumer_key, idempotency_key)` collision:

1. Same `input_hash`, `options_hash`, and `pipeline_version`: return the existing run/package and do no model work.
2. Any mismatch: return HTTP 409 `CF1_IDEMPOTENCY_CONFLICT`.
3. A retryable failed run may be retried only through an explicit retry operation that creates a new run ID and idempotency key while recording the prior run ID in diagnostics.

Default derived key:

```text
sha256(consumer_key | consumer_content_ref | input_hash | options_hash | pipeline_version)
```

An explicit `forceNewVersion` must not bypass lineage rules; it requires the package being superseded.

## 6. Versioning and supersession

- First verified package in a lineage is version 1.
- A materially changed interpretation, human correction, changed article input, or intentional rerun creates a new package.
- Same lineage is used only when the new package is intended to replace the earlier package for the same consumer article.
- The new row sets `supersedesPackageId`; version is previous version + 1 under a row/lineage lock.
- Previous packages and artifacts remain readable and evidence results remain linked to their original package.
- Supersession marks bindings/projections, not the immutable prior package body.
- EvidenceRun must reject a superseded package for a new run by default, while historical evidence runs remain valid.

## 7. Artifact relationship

Database `package_json` is authoritative. Artifacts are reproducible audit/readability copies under:

```text
artifacts/claim_foundry/<packageId>/
```

The final artifact hash must equal `package_hash`. Artifact write failure does not invalidate the database package; it records a warning and may be retried without model work. An artifact may never be treated as newer than its database package.

## 8. Transaction boundary

Use one acquired MySQL connection and connection-bound promisified query.

Finalization transaction:

1. Lock run row and confirm `running`.
2. Recheck idempotency and lineage/version constraints.
3. Insert immutable package.
4. Create consumer binding.
5. Set run `package_id`, status `ready_for_evidence`, usage, and completion time.
6. Commit.

Rollback all five database actions on failure. Write artifacts only after commit. VeriStrata projection is a separate Phase 3 transaction and cannot corrupt or remove the portable package.

## 9. EvidenceRun handoff

EvidenceRun receives only:

```json
{
  "packageId": "cf1pkg_...",
  "expectedSchemaVersion": "cf1.claimPackage.v1",
  "expectedPackageHash": "..."
}
```

The consumer loads `package_json`, verifies hash/schema/status, and reads only:

- `selectedEvaluationClaims`
- `phase3Targets`
- `evidenceNeedCards`
- required article metadata

Raw assertions, semantic blocks, and diagnostics are available for audit but are not direct EvidenceRun targets. EvidenceRun writes its own run and evidence records; it never updates `package_json`.

No queue or broker is added in CF1. Initial dispatch is an explicit later API call. A future worker may claim ready package IDs without changing this contract.

## 10. Phase 2 acceptance

- Dedicated CF1 store chosen and justified.
- Portable packages survive deletion of a VeriStrata content binding.
- Verified package bodies are immutable.
- Retries cannot duplicate model work for the same idempotency identity.
- Supersession preserves historical packages and evidence provenance.
- Artifact failure is recoverable without regenerating claims.
- EvidenceRun consumes a package ID/hash and cannot target raw assertions.
- TM4 tables remain untouched historical data.
