# CF1 Phase 5 — Persistence, API, and Adapter Manifest

**Status:** Planning decision for review

## 1. Database migrations

| File | State | Responsibility | Tests/verification | Lines |
|---|---|---|---|---:|
| `backend/migrations/2026-07-13-01-claim-foundry-core.sql` | new | Runs, immutable packages, bindings, indexes/FKs | replay-safety contract test; deployment verification remains manual | <250 |
| `backend/migrations/2026-07-13-02-claim-foundry-projection.sql` | new | Add CF provenance/card columns and scoped target uniqueness | static preservation/replay contract; deployment verification remains manual | <150 |

Dates are assigned when implementation begins. Migrations are additive and idempotent; no TM4 table mutation.

## 2. Persistence ports and stores

| File | State | Responsibility and exports | Dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `backend/src/storage/dbTransaction.js` | new | Connection-bound transaction helper; `withTransaction`, `connectionQuery` | existing pool | `dbTransaction.test.js` | 130 |
| `backend/src/storage/claimFoundryRunStore.js` | new | Idempotent run lifecycle; `createOrLoadCf1Run`, `markCf1RunFailed`, `completeCf1Run` | injected query | `claimFoundryRunStore.test.js` | 220 |
| `backend/src/storage/claimFoundryPackageStore.js` | new | Immutable insert/load/hash checks; `insertCf1Package`, `loadCf1Package`, `loadReadyCf1Package` | transaction, canonical hash | `claimFoundryPackageStore.test.js` | 240 |
| `backend/src/storage/claimFoundryBindingStore.js` | new | Consumer/content bindings and active selection; `createCf1Binding`, `setProjectionStatus`, `activateCf1Binding` | transaction | `claimFoundryBindingStore.test.js` | 210 |
| `backend/src/storage/claimFoundryIdentity.js` | new | Semantic options hash and derived idempotency identity | canonical hash | `persistenceIdentity.test.js` | 80 |
| `backend/src/storage/claimFoundryPersistence.js` | new | Atomic package, binding, supersession, and run finalization | stores, transaction | `persistenceStores.test.js` | 120 |

Store modules accept a query/connection port and never import the global pool except `dbTransaction.js`.

## 3. VeriStrata projection adapter

| File | State | Responsibility and exports | Dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `backend/src/claim-foundry/veristrata/loadVeriStrataArticle.js` | new | Load database or allowlisted persisted TextPad text and metadata without scraping | injected query, safe filesystem reader | `loadVeriStrataArticle.test.js` | <150 |
| `backend/src/claim-foundry/veristrata/mapSelectedClaim.js` | new | Portable selected claim → claim/link fields; `mapCf1SelectedClaim` | contract | `mapSelectedClaim.test.js` | <50 |
| `backend/src/claim-foundry/veristrata/mapTargetCard.js` | new | Target/Card → target fields; `mapCf1TargetCard` | contract | `mapTargetCard.test.js` | <50 |
| `backend/src/claim-foundry/veristrata/projectionStore.js` | new | Package-scoped claim/link/target SQL ports | injected query | `projectionStore.test.js` | <100 |
| `backend/src/claim-foundry/veristrata/projectPackage.js` | new | Package-scoped transactional inactive projection; `projectCf1Package` | stores, mappers, transaction | `projectPackage.test.js` | <100 |
| `backend/src/claim-foundry/veristrata/loadActiveProjection.js` | new | Package-aware Workspace selector; `loadActiveCf1Projection`, `contentClaimReadScope` | injected query | `loadActiveProjection.test.js` | <50 |
| `backend/src/claim-foundry/veristrata/activateProjection.js` | new | Atomic activation/rollback by binding ID | transaction | `activateProjection.test.js` | <75 |
| `backend/src/claim-foundry/comparison/report.js` | new | Evaluate frozen comparison measurements without model work | none | `comparisonReport.test.js` | <150 |

The adapter never calls `persistClaims(...clearOldLinks=true)` or `replaceClaimEvaluationTargets` because both are broader than CF1 package scope.

## 4. Public and VeriStrata APIs

| File | State | Responsibility and exports | Dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `backend/src/routes/claim-foundry/index.js` | new | Compose portable CF1 router | route modules | route contract tests | <50 |
| `backend/src/routes/claim-foundry/public.routes.js` | new | `POST /v1/claim-packages`, status/load endpoints | auth, submit service, stores | `publicRoutes.test.js` | <150 |
| `backend/src/routes/claim-foundry/consumerAuth.js` | new | Environment-configured API-key consumer boundary | Node crypto | `consumerAuth.test.js` | <100 |
| `backend/src/routes/claim-foundry/submitService.js` | new | Idempotent run, model orchestration, persistence | runner and stores | `submitService.test.js` | <150 |
| `backend/src/routes/claim-foundry/runtime.js` | new | Disabled-by-default composition over the repository OpenAI convention | CF1 OpenAI adapter | `runtime.test.js` | <100 |
| `backend/src/routes/claim-foundry/veristrata.routes.js` | new | Protected `/api/claim-foundry/run` adapter | auth, article loader, runner | `veristrataRoutes.test.js` | 200 |
| `backend/server.js` | modified | Mount CF1 before legacy path rewriting only when explicitly enabled | router/runtime factories | syntax + runtime tests | +7 |

Public API authentication mechanism is deployment configuration; VeriStrata route uses existing `authenticateToken` plus content access validation.

## 5. Dev and audit scripts

| File | State | Responsibility | Dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `scripts/dev/cf1_run_claim_foundry.mjs` | new | CLI over shared runner; `--article`, `--content-id`, `--no-persist`, `--path` | runner/adapters | CLI smoke | 170 |
| `scripts/testing/cf1_validate_package.mjs` | new | Offline verifier for artifact/package JSON | verifier | valid/invalid fixtures | 120 |
| `scripts/testing/cf1_compare_current.mjs` | new later | Phase 6 comparison report, no production writes | fixture runner/metrics | report smoke | 220 |

Scripts contain argument parsing and reporting only; they do not duplicate pipeline logic.

## 6. Existing files deliberately unchanged initially

- `backend/src/core/processTaskClaims.js`
- `backend/src/core/runEvidenceEngine.js`
- `backend/src/core/phase3Targetizer.js`
- `backend/src/core/evidenceNeed.js`
- TM4 selectors, prompts, package stores, migrations, and preview scripts
- live scrape routes

CF1 shadow execution can be built and evaluated without changing these files. Package-aware Workspace read changes and controlled activation occur only in a later approved milestone.

## 7. Dependency-ordered implementation milestones

1. Contract, IDs/hashes, validators, verifier, fixtures.
2. Structural blocks and token budgets.
3. Prompt/model interface and fake-model normal runner.
4. Long path, repair, telemetry, artifacts, dev runner.
5. Core persistence migration and stores.
6. Public API with portable article input.
7. VeriStrata article loader and shadow adapter.
8. Projection migration and inactive projection.
9. Package-aware reads and controlled activation.
10. Separate EvidenceRun package-ID handoff.

Each milestone runs focused tests, reports line counts and forbidden imports, summarizes modifications, and waits for approval.

## 8. File-size enforcement

Add a test/script that scans handwritten CF1 files and fails above 500 lines. It warns at 251 lines. Prompt templates count toward their source-file line totals. Generated artifacts, fixture article text, lockfiles, and migrations are reported separately; migrations still target <250.
