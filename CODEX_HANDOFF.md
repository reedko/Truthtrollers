# Codex Handoff

Last updated: 2026-07-12

## Project Location

The project was moved from:

```text
/Users/reedko/Desktop/Truthtrollers_root
```

to:

```text
/Users/reedko/VeriStrata/veristrata-platform
```

Open new Codex sessions against the new path.

## Project Shape

VeriStrata / TruthTrollers is a claim extraction, evidence matching, review, and publication platform.

Main areas:

- `backend/`: Express/Node backend, evidence engine, claim extraction, scoring, migrations.
- `dashboard/`: Vite/React dashboard UI.
- `extension/`, `truthtrollers_extension/`: browser extension surfaces.
- `shared/`: shared package.
- `docs/` and root markdown files: implementation logs, architecture notes, deployment notes, product workflow.

Key commands:

```bash
cd /Users/reedko/VeriStrata/veristrata-platform/backend
npm run dev
npm run test:bearing

cd /Users/reedko/VeriStrata/veristrata-platform/dashboard
npm run dev
npm run build
```

Root `package.json` is not the best source of truth for backend scripts. Prefer `backend/package.json` and `dashboard/package.json`.

## First Files To Read

For a new Codex session, read these first:

- `CODEX_HANDOFF.md`
- `IMPLEMENTATION_LOG_TM_V4.md`
- `VERISTRATA_USER_WORKFLOW.md`
- `VERIMETER_SCORING_SOURCE_OF_TRUTH.md`
- `bearing_aware_retrieval_implementation_plan.md`
- `backend/src/core/tm4Phase2bSelector.js`
- `backend/src/core/phase3Targetizer.js`
- `backend/src/core/runEvidenceEngine.js`
- `backend/src/storage/tm4ClaimPackageStore.js`
- `backend/migrations/tm4_claim_package_persistence.sql`

Useful diagnostics and local tools:

- `scripts/testing/tm4_selector_trace.mjs`
- `scripts/testing/tm4_claim_quality_eval.mjs`
- `scripts/testing/tm4_evidence_diagnostic.mjs`
- `scripts/testing/tm4_evidence_regression_test.mjs`
- `scripts/testing/tm4_master_tuning_verification.mjs`
- `scripts/dev/tm4_materialize_preview.mjs`
- `scripts/dev/tm4_run_preview_evidence.mjs`
- `scripts/dev/tm4_verify_persistence.mjs`

## Current Git State

As of this handoff, the worktree is dirty. Do not assume uncommitted changes are disposable.

Modified tracked files:

- `backend/src/core/atomicVisibleClaimsExtractor.js`
- `backend/src/core/evaluationTargetStore.js`
- `backend/src/core/evidenceNeed.js`
- `backend/src/core/localClaimMapSynthesizer.js`
- `backend/src/core/phase3Targetizer.js`
- `backend/src/core/runEvidenceEngine.js`
- `backend/src/utils/logger.js`
- `dashboard/package-lock.json`
- `scripts/audit/tm4_phase3_target_quality_audit.mjs`

Important untracked code/schema/tools:

- `backend/migrations/tm4_claim_package_persistence.sql`
- `backend/src/core/tm4Phase2bSelector.js`
- `backend/src/core/tm4SelectionEvaluator.js`
- `backend/src/core/tm4SelectorFeatures.js`
- `backend/src/core/tm4EvidenceAffordanceExpansion.js`
- `backend/src/storage/tm4ClaimPackageStore.js`
- `scripts/testing/*`
- `scripts/dev/*`
- `artifacts/`

There are also many untracked generated content and author assets under `backend/assets/...`. Treat those as generated project data unless the user says otherwise.

## Current TM4 Direction

TM4 is moving from broad noisy extraction into a staged product-selection and evidence-targeting pipeline.

The important mental model:

1. Phase 1/1b/2 produce a raw/reconciled claim occurrence inventory.
2. Phase 2b selects only the 8-12 product-facing evaluation claims.
3. Phase 3 targetization creates evidence-search targets for those selected claims.
4. Raw occurrences are persisted for audit/provenance, but must not flood Workspace.
5. Evidence retrieval should be gated through selected evaluation claims and their eligible targets.

The newer Phase 2b selector is in `backend/src/core/tm4Phase2bSelector.js`. It uses a staged portfolio selection model:

- canonical duplicate removal only at first;
- order-independent intrinsic scoring;
- reasoning-move / claim-role classification;
- thesis-spine coverage;
- late predicate-aware redundancy pruning;
- evaluator/repair loop;
- persist only after pass or explicit acknowledged failure.

The selector intentionally keeps some slack: target count around 10, hard max 12. Repairs should prefer growing 10 to 11 or 12 over zero-sum swaps when that preserves central claims.

## Evidence Affordance Expansion

`backend/src/core/tm4EvidenceAffordanceExpansion.js` is a generic sidecar. It lets a selected display claim inherit search hints from related unselected sibling claims when the sibling has stronger document/evidence affordance.

This is important: the sibling is not promoted into Workspace. Its document hints only enrich query hints and bearing criteria for the selected claim.

The expansion is intentionally generic. Avoid article-specific names, fixtures, or one-off rules in production logic.

## Phase 3 Targetization Notes

`backend/src/core/phase3Targetizer.js` has active changes for:

- allegation/provenance attribution targets;
- unnamed study/document disambiguation targets;
- sibling-sourced document identity targets;
- query/bearing enrichment from evidence-affordance expansion.

Important guardrail: expansion must not alter `scoreTransform`, `verdictEligible`, or article posture. It enriches search and bearing only.

## TM4 Persistence Model

`backend/migrations/tm4_claim_package_persistence.sql` adds schema for full TM4 package persistence:

- `tm4_claim_packages`
- `tm4_raw_claim_occurrences`
- `tm4_claim_reconciliations`
- `tm4_selected_evaluation_claims`

It also additively extends `claim_evaluation_targets` with TM4 metadata fields such as:

- `source_claim_id`
- `target_key`
- `primary_query_text`
- `query_hints_json`
- `bearing_criteria_json`
- `quality_status`
- `quality_flags_json`
- `weak_bearing`
- `needs_atomic_split`

`backend/src/storage/tm4ClaimPackageStore.js` persists the full package and stamps target metadata onto existing engine-facing `claim_evaluation_targets`.

Critical rule:

```text
PERSISTED does not mean WORKSPACE-VISIBLE.
```

Raw TM4 occurrences may be persisted for audit/provenance, but only selected evaluation claims should be materialized into `content_claims` for Workspace.

## Evidence Gating Rule

Evidence retrieval should only run against selected evaluation claims and eligible targets.

The intended source of candidates is:

```text
tm4_selected_evaluation_claims
  -> claim_evaluation_targets(search_eligible = 1)
```

Raw occurrences and non-selected claims should never enter the evidence run just because they were persisted.

`loadTm4EvidenceCandidates()` in `backend/src/storage/tm4ClaimPackageStore.js` is the key helper for this model.

## VeriMeter Source Of Truth

Canonical user-link VeriMeter scoring lives in:

```text
backend/src/services/verimeterScoringService.js
```

Do not calculate user VeriMeter scores directly from `content_scores`, `claim_scores`, or stored procedures. Those are legacy cache/procedure paths.

AI-only scoring remains separate in:

```text
backend/src/modules/aiRatings.js
```

## Bearing-Aware Retrieval Plan

The retrieval plan is documented in `bearing_aware_retrieval_implementation_plan.md`.

Core idea: add a bearing-aware funnel between search and scraping. Score whether a search result title/snippet actually bears on the claim before spending scrape/evidence budget.

Current intended staging:

- deterministic `EvidenceNeed` and snippet-bearing scoring first;
- shadow logging before live gating;
- optional LLM snippet triage later;
- only after calibration should candidate ordering/scraping change;
- keep bearing separate from source quality, authority, or political valence.

Do not conflate bearing with source quality. A low-quality source can directly bear on a claim; a prestigious source can be merely topical.

## Product Workflow

`VERISTRATA_USER_WORKFLOW.md` describes the end-to-end intended workflow:

1. capture content via extension;
2. automated claim extraction;
3. evidence discovery and matching;
4. Workspace review;
5. claim-level evidence analysis in Relevance Scan;
6. source navigation and verification;
7. human evidence rating;
8. evaluation submission;
9. community review;
10. VeriMeter aggregation;
11. evidence maps / knowledge graph;
12. publication and reporting.

Be careful in product copy: some pieces may be configurable or still evolving, especially source claim extraction, video/social capture, community approval, and report generation.

## Working Style For Next Session

Before editing, run:

```bash
git status --short
git diff --stat
```

Then inspect the specific files involved. There are user/Codex changes in flight, so do not reset, checkout, or clean generated files unless explicitly asked.

When making TM4 changes:

- preserve the selected-claims-only Workspace invariant;
- keep raw occurrence persistence audit-only;
- keep evidence retrieval gated to selected evaluation targets;
- avoid article-specific production rules;
- keep expansion generic and provenance-rich;
- use existing Node/ESM style;
- prefer focused `node:test` scripts or existing `scripts/testing/*` diagnostics over inventing a broad test harness.

