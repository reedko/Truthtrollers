# CF1 Phase 3 — VeriStrata Projection Contract

**Status:** Planning decision for review
**Boundary:** The immutable CF1 package is authoritative. `claims`, `content_claims`, and `claim_evaluation_targets` are a reversible VeriStrata projection.

## 1. Live read/write findings

- `claims` stores globally reusable claim text and mutable scoring fields.
- `content_claims` is the per-content Workspace occurrence and eligibility record.
- Current claim reads usually return every `content_claims` row for a content item; they are not package-scoped.
- `runEvidenceEngine` gates through `content_claims.selected_for_evaluation`, but defaults missing eligibility rows to selected.
- `claim_evaluation_targets` is keyed by content, claim, and target order, not package identity.
- `replaceClaimEvaluationTargets` deletes all targets for a content/claim pair before inserting replacements.
- Existing `persistClaims` may clear broad relationship lanes and globally reuses claims by exact text.

CF1 must not call either broad-clear behavior. Projection needs explicit package provenance and package-scoped reads.

## 2. Minimal additive projection columns

Add columns through an idempotent migration; do not rename or remove legacy columns.

### `content_claims`

| Column | Type | Purpose |
|---|---|---|
| `claim_foundry_package_id` | VARCHAR(48) NULL | immutable source package |
| `claim_foundry_selected_claim_id` | VARCHAR(16) NULL | portable `selectedClaimId` |
| `claim_foundry_binding_id` | BIGINT UNSIGNED NULL | consumer projection binding |

Indexes:

```text
UNIQUE (claim_foundry_package_id, claim_foundry_selected_claim_id)
INDEX  (content_id, claim_foundry_package_id, selected_for_evaluation)
```

Legacy rows remain null in these columns.

### `claim_evaluation_targets`

| Column | Type | Purpose |
|---|---|---|
| `claim_foundry_package_id` | VARCHAR(48) NULL | immutable source package |
| `claim_foundry_target_id` | VARCHAR(16) NULL | portable `targetId` |
| `claim_foundry_card_id` | VARCHAR(24) NULL | portable Evidence Need Card ID |
| `evidence_need_card_json` | JSON NULL | complete card compatibility copy |
| `projection_scope_key` | VARCHAR(48) generated stored | `COALESCE(claim_foundry_package_id, 'legacy')` |

Indexes:

```text
UNIQUE (claim_foundry_package_id, claim_foundry_target_id)
INDEX  (claim_foundry_package_id, search_eligible, verdict_eligible)
UNIQUE (content_id, claim_id, projection_scope_key, target_order)
```

Foreign keys to string package IDs are optional in projection tables. The package binding owns lifecycle; avoiding new cascading FKs prevents historical evidence links from being deleted accidentally.

## 3. Selected claim → `claims`

For each `selectedEvaluationClaim`:

1. Normalize whitespace for lookup only; never rewrite `claimText`.
2. Reuse an existing `claims` row only on exact stored text equality after whitespace normalization.
3. Otherwise insert:

| `claims` column | Value |
|---|---|
| `claim_text` | `claimText` |
| `claim_type` | `task` |
| `veracity_score` | `0` |
| `confidence_level` | `0` |
| `last_verified` | projection time |

Do not update an existing global claim’s text, triage fields, scores, confidence, or verification timestamp during projection. A shared `claims` row does not imply shared article stance or target posture; those remain occurrence/package-specific.

Concurrent duplicate text insertion is tolerable under the current schema. Adding a global unique text/hash constraint is out of CF1 scope because it could merge historically distinct claims.

## 4. Selected claim → `content_claims`

Insert one row per selected claim. Exact field mapping:

| Portable field | `content_claims` column / value |
|---|---|
| bound VeriStrata content | `content_id` |
| resolved global claim | `claim_id` |
| package/binding IDs | additive CF1 columns |
| `selectedClaimId` | `claim_foundry_selected_claim_id` |
| — | `relationship_type = 'task'` |
| `articleRole` | mapped `claim_role` below |
| selection order | `claim_order` zero-based |
| `scoreTransform` | `score_transform` |
| transform `normal` | `article_stance = 'endorses'` |
| transform `invert` | `article_stance = 'opposes'` |
| transform `none` | `article_stance = 'reports'` |
| `articleRole` | `argument_function` exact portable enum |
| `searchEligible` | `search_eligible` |
| `verdictEligible` | `verdict_eligible` |
| selected status | `selected_for_evaluation = 1`, `evaluation_eligible = 1` |
| product visibility | `visibility = 'workspace_eval'` |
| package provenance | `argument_mapping_rationale` bounded JSON summary |
| agent confidence | `argument_mapping_confidence` |

Role compatibility mapping:

| Portable role | Existing `claim_role` |
|---|---|
| `thesis` | `thesis` |
| `pillar` | `pillar` |
| `pillar_support` | `pillar_support` |
| `opponent_claim` | `evidence` |
| `qualification` | `evidence` |
| `consistency_hinge` | `fallibility_critical` |

`argument_mapping_rationale` stores only compact projection provenance: package ID, selected ID, source raw IDs, source block IDs, selection rationale, materiality, and related pillar IDs. The full data remains in `package_json`.

Do not use `parent_claim_id` for portable pillar IDs; it is an integer FK-like legacy field. Pillar relationships remain in the package/provenance JSON until a separate hierarchy projection is designed.

## 5. Phase 3 target → `claim_evaluation_targets`

Insert package-scoped rows without deleting legacy or earlier-package rows.

| Portable field | Target column / value |
|---|---|
| package/target/card IDs | additive CF1 columns |
| projected content/claim | `content_id`, `claim_id` |
| target order within selected claim | `target_order` |
| `targetText` | `target_text` and normally `object_text` for substantive targets |
| `sourceExcerpt` | `source_excerpt` |
| `scoreTransform` | `score_transform` |
| `searchEligible` | `search_eligible` |
| `verdictEligible` | `verdict_eligible` |
| `mappingStatus` | `resolved`, `needs_review`, `unresolved` in `resolution_status` |
| `mappingRationale` | `mapping_rationale` plus portable type |
| agent confidence | `mapping_confidence` |
| card criteria | `bearing_criteria_json` |
| card query seeds and identifiers | `query_hints_json` |
| first target-primary/identifier seed | `primary_query_text` |
| card | `evidence_need_card_json` |

Target compatibility mapping:

| Portable target type | Existing target type |
|---|---|
| `article_endorsed_substantive` | `substantive` |
| `opponent_substantive` | `substantive` |
| `attribution_provenance` | `attribution` |
| `source_identity` | `study_identity` initially; preserve portable type in card/rationale |
| `inference_warrant` | `inference` |
| `context_scope` | `substantive`, forced non-verdict unless package explicitly resolves otherwise |

The migration replaces the existing uniqueness key `(content_id, claim_id, target_order)` with the generated-scope uniqueness key above. `projection_scope_key = 'legacy'` preserves the current uniqueness rule for legacy rows, while each CF1 package receives an independent target-order namespace. Migration preflight must prove existing legacy rows satisfy the replacement key before the old key is dropped.

## 6. Raw assertions and other package data

Never project these into `claims` or `content_claims`:

- raw assertions
- non-selected assertions
- semantic blocks
- article-map-only propositions
- internal-consistency findings not selected as claims
- diagnostics

They remain in immutable `package_json` and generated artifacts. This prevents Workspace and EvidenceRun claim inflation.

## 7. Projection modes

The adapter supports explicit modes:

- `shadow`: create package and binding; write no Workspace rows.
- `project`: create package-scoped rows but do not make them active in reads.
- `activate`: project and atomically select this binding as the active CF1 view for the content.

CF1 development begins with `shadow`, then `project`. `activate` requires read-path tests and explicit operator action; it is not implied by package creation.

## 8. Active projection and coexistence

`claim_foundry_package_bindings.projection_status = 'projected'` does not alone identify the active view. Add `is_active_projection TINYINT(1) NOT NULL DEFAULT 0` and enforce one active CF1 binding per `(consumer_key, content_id)` transactionally.

Workspace reads:

1. If an active CF1 binding exists, return only `content_claims` rows for that package plus separately user-created claims explicitly allowed by the route.
2. Otherwise preserve the current legacy/TM4 read behavior.

EvidenceRun reads:

1. Preferred: consume the immutable package by `packageId`.
2. VeriStrata compatibility: query targets by `claim_foundry_package_id` and selected claim IDs.
3. Never default a missing CF1 eligibility row to selected.

Prior TM4 rows remain untouched. First CF1 activation changes the read selector, not historical rows. Prior CF1 projections remain stored but become inactive. This avoids deleting evidence-linked targets or mutating historical claims.

## 9. Idempotency, supersession, and failure

Projection identity is `(binding_id, package_id)`.

- Repeating a completed projection verifies row counts/IDs and returns success without inserts.
- A pending/failed retry deletes only rows bearing that same package and binding provenance, then retries inside one transaction.
- It never calls broad `clearOldLinks` or deletes all targets for a content/claim pair.
- Superseding package projection inserts new rows first, validates them, changes the active binding, and marks the previous binding `superseded` in the same transaction.
- Previous projection rows stay queryable but inactive.
- If activation fails, rollback leaves the prior active binding and rows unchanged.
- If package projection fails, the immutable package remains `ready_for_evidence`; only the binding records projection failure.

Projection transaction:

```text
lock binding + active binding for content
→ validate package hash/schema/status
→ resolve/insert claims
→ insert package-scoped content_claims
→ insert package-scoped targets/cards
→ verify counts and cross-references
→ optionally switch active binding
→ update binding status
→ commit
```

## 10. Phase 3 acceptance

- Portable package remains authoritative and survives projection failure.
- Raw assertions never enter Workspace tables.
- Only selected claims become `workspace_eval` rows.
- Every projected target is traceable to package, selected claim, and card IDs.
- Existing TM4 and manual/user claims are not deleted.
- Reprojection is idempotent and package-scoped.
- Activation is atomic and reversible by selecting an earlier package binding.
- Workspace and EvidenceRun reads are package-aware when CF1 is active.
