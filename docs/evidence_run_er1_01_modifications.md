# ER1-0 and ER1-1 modification summary

**Status:** Implemented and tested; awaiting reviewer approval before ER1-2

## Delivered

ER1 now has a provider-neutral contract and a reproducible offline planning path. It loads
an immutable CF1 package file, verifies package ID/schema/status/hash, builds only selected
claim/Phase 3 target tasks, normalizes supplied identity hints without resolving them,
creates shared identity tasks, and plans deterministic query lanes from CF1 Evidence Need
Cards and exact identifiers.

The implementation performs no provider, search, DOI/PMID resolver, PubMed, OpenAlex,
Crossref, scraper, model, database, or migration operation.

## Runtime files

- `backend/src/evidence-run/contract.js`: versions, enums, budgets, IDs, bearing outcomes.
- `backend/src/evidence-run/schemas/`: request, state, event, result, error, and artifact schemas.
- `backend/src/evidence-run/packageLoader.js`: JSON loading and CF1 identity/hash verification.
- `backend/src/evidence-run/targetPortfolio.js`: selected claims, targets, and cards only.
- `backend/src/evidence-run/identityRegistry.js`: offline DOI/PMID/URL normalization and shared tasks.
- `backend/src/evidence-run/queryPlanner.js`: shared identity and target-specific CF1 seed lanes.
- `backend/src/evidence-run/state.js`: explicit offline state and step trace.
- `backend/src/evidence-run/artifacts.js`: JSON/Markdown artifacts and hash manifest.
- `backend/src/evidence-run/runOfflinePlanning.js`: thin offline coordinator.
- `scripts/dev/er1_run_offline_plan.mjs`: developer runner.

All handwritten ER1 files are below 250 lines. The test enforces the 500-line maximum.

## Frozen inputs and tests

`backend/test/evidence-run/fixtures/manifest.js` freezes package IDs, hashes, paths, and
target counts for CF1-F01 through CF1-F08. Tests prove:

- all eight package hashes and identities verify;
- tampering and expected-identity mismatches fail;
- DOI, PMID, and URL normalization is deterministic and offline;
- selected target tasks, shared identities, and balanced lanes are reproducible;
- the trace records zero prohibited operations;
- artifacts are written and hashed;
- file limits are enforced.

Test command:

```bash
cd backend && node --test test/evidence-run/*.test.js
```

Focused result: **6 passed, 0 failed**. Combined CF1 + ER1 regression result:
**219 passed, 0 failed**.

## F01 review artifact

Command:

```bash
node scripts/dev/er1_run_offline_plan.mjs \
  --package artifacts/claim-foundry/agent-runs/eight-fixture-compact-20260715/CF1-F01/cf1run_019f6500-d609-74c1-9be1-a27071fc8e65/final_cf1_package.json \
  --out artifacts/evidence-run/er1-01-f01-offline \
  --balanced
```

Output: 8 tasks, 8 targets, 6 identity records, and 52 planned lanes. Seven identity lanes
are shared globally; 45 CF1 seed lanes are target-specific across support/refute/qualify.

Artifacts include package verification, target portfolio, identity registry, query-lane
plan, state, trace, request, Markdown summary, and a SHA-256 artifact manifest.

## Review boundary

ER1-2 is not implemented. Nothing searches, resolves, retrieves, scrapes, calls a model,
or writes the database. No migration was added. Reviewer approval is required before any
networked identity or retrieval work begins.
