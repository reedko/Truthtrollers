# TM4 Preview Materialization (dev-only)

Materializes the TM4 claim-extraction pipeline output into the existing
platform data model so it can be inspected in the Workspace UI. Nothing here
is wired into production routes; all rows are marked and removable per run.

**Product shape (Phase 2b selection gate):** the full pipeline extracts ~60
raw claim occurrences, but Workspace only receives the 8–12 claims selected by
`backend/src/core/tm4Phase2bSelector.js` (which reuses the original
`selectedEvaluationClaims` reducer in `claimsSelectionReducers.js` for scoring,
plus TM4 structural rules: claim-form preference, duplicate-group dedup,
one-per-cluster caps, invert caps). Phase 3 targets are generated for selected
claims only; evidence runs on selected claims only, budgeted to ~3 strong
references per claim and ~27 total. The raw inventory, non-selected claims
with suppression reasons, and the selection summary all live in the sidecar.

## Commands

```bash
# 0. One-time: apply the TM4 persistence migration (review first; additive only)
mysql -u root -p truthtrollers < backend/migrations/tm4_claim_package_persistence.sql

# 1. Create preview (full TM4 pipeline on the vaccine fixture; Phase 1/2 use LLM)
node scripts/dev/tm4_materialize_preview.mjs
#    …or skip the LLM re-run and reuse the latest audit readiness package:
node scripts/dev/tm4_materialize_preview.mjs --reuse-latest

# 2. Run evidence on the TM4 targets (existing evidence engine; live search + LLM)
node scripts/dev/tm4_run_preview_evidence.mjs --run latest --limit 5   # dev cap
node scripts/dev/tm4_run_preview_evidence.mjs --run latest             # all evaluation claims

# 3. View (backend on https://localhost:5001, dashboard `npm run dev` → 5173)
#    URL is printed by both scripts:
#    https://localhost:5173/workspace/<contentId>

# 3b. Verify persistence + gating (read-only acceptance checks)
node scripts/dev/tm4_verify_persistence.mjs --run latest

# 4. Clean up (dry-run by default)
node scripts/dev/tm4_cleanup_preview.mjs --run latest          # shows what would be deleted
node scripts/dev/tm4_cleanup_preview.mjs --run latest --apply  # deletes this run only
```

MySQL must be running (System Settings → MySQL, or
`sudo launchctl bootstrap system /Library/LaunchDaemons/com.oracle.oss.mysql.mysqld.plist`).

## What is persisted (and where)

| TM4 output | Platform home |
|---|---|
| Preview task | `content` row: `topic='tm4-preview'`, `media_source='TM4 Preview'`, `details` JSON has `tm4PreviewRunId`; article text saved to `assets/documents/tasks/` + `content.content_text` |
| **Selected** claims only (8–12, Phase 2b gate) | `claims` + `content_claims` (`relationship_type='task'`, evaluation lane, `claim_order` = selection rank; selection rank/score/rationale in the `tm4:{…}` metadata) |
| Raw ~60-claim inventory + non-selected claims + suppression reasons | Sidecar only (`backend/logs/tm4_preview_runs/<runId>.json` → `tm4.rawClaims`, `tm4.nonSelectedClaims`, `selectionSummary`) — never the Workspace |
| claimForm / articleUse / scoreTransform / speakerOrSource / embeddedSubstantiveClaim | `content_claims` columns: `argument_function`, `article_stance`, `score_transform`, `speaker_entity`, `object_claim_text`, `is_attribution` |
| sourceClaimId / sourceSentenceIds / canonicalExcerpt / pillar / cluster / lane | `content_claims.argument_mapping_rationale` = `tm4:{…}` JSON (returned by `/api/claims/:content_id`) |
| Phase 3 targets | `claim_evaluation_targets` (existing table; the evidence engine already consumes it). `evidence_landscape` type is stored as `substantive` (enum limit) with the original type in `mapping_rationale` |
| queryHints / bearingCriteria / tm4TargetId | `claim_evaluation_targets.mapping_rationale` = `tm4:{…}` JSON; `queryHints.primaryQueryText` also passed to the engine as `searchText` |
| Evidence references | `content` (type `reference`) + `content_relations` — created by `runEvidenceEngine` itself |
| Evidence links | `reference_claim_links` (Workspace “AI evidence links”), `evaluation_target_evidence_links` (per-target), reference claims via `persistDirectEvidenceAssertions` |
| Full run manifest | `backend/logs/tm4_preview_runs/<runId>.json` (complete TM4 claims + targets + DB id map; used by evidence/cleanup) |

## What is NOT persisted / not run

- No production route was added or changed; scripts call the same internal
  functions `/api/submit-text` uses (`createContentInternal`, `persistClaims`,
  `replaceClaimEvaluationTargets`, `runEvidenceEngine`, `persistAIResults`,
  `persistDirectEvidenceAssertions`).
- The final reducer is not run — Workspace displays claims/evidence from
  `reference_claim_links` and `claims-and-linked-references` without it.
- No publishers/authors rows are created for the preview task.
- TM4 intermediate diagnostics stay in `backend/logs` (gitignored), not the DB.

## Cleanup guarantees

- Refuses to touch any `content` row not marked `topic='tm4-preview'` AND
  `media_source='TM4 Preview'`.
- References are cascade-deleted only when linked exclusively to the preview
  task AND created after it (`reference_content_id > task content_id`);
  shared or pre-existing references are unlinked, never deleted.
- Claims are deleted only when orphaned (existing `delete_content_cascade`
  stored procedure semantics); claim text reused by other content survives.
