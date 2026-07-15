# CF1 Implementation Readiness and Handoff

**Decision:** GO for the smallest isolated implementation milestone.
**Decision date:** 2026-07-13
**Scope:** Claim Foundry CF1 only; EvidenceRun and live scrape integration excluded.

## 1. What is implementation-ready

The planning contract now fixes:

- the consumer-neutral article, semantic analysis, selected claim, Phase 3 target,
  Evidence Need Card, verification, package, request, and response contracts;
- one normal full-article model call, a bounded long-article fallback, and no more
  than one repair pass;
- immutable dedicated CF1 persistence, idempotency, lineage, supersession, hashes,
  artifacts, and package-ID database handoff;
- additive, package-scoped VeriStrata projection into `claims`, `content_claims`, and
  `claim_evaluation_targets`, with raw assertions remaining package-only;
- module boundaries, dependency direction, file ownership, tests, and a sequence of
  ten approval-gated implementation milestones;
- eight acceptance fixture classes and measurable quality, provenance, efficiency,
  validity, and reliability gates.

Identity is no longer an open choice. CF1 uses the installed `uuid` package's UUIDv7
with type prefixes: `cf1run_`, `cf1pkg_`, and `cf1lin_`. Database identity columns
are `VARCHAR(48)`.

No architectural decision needs to be rediscovered to implement Milestone 1A.

## 2. Remaining decisions and their gates

These are not blockers for Milestone 1A:

| Decision | Must be resolved before |
|---|---|
| exact primary and fallback model identifiers | model-boundary Milestone 3 |
| provider structured-output syntax and deployed token prices | model-boundary Milestone 3 |
| final text, licensing, and expectation approval for eight acceptance articles | comparison implementation and release gate |
| production public-API authentication/consumer-key issuance | public API Milestone 6 |
| migration compatibility on the deployed MySQL version | persistence Milestone 5 |
| Workspace activation policy and rollback operator | activation Milestone 9 |
| EvidenceRun request/status contract beyond package ID/hash/schema | separate Milestone 10 |

Each decision is made in its named phase and reported for review. None permits CF1
to reach into scraping or evidence gathering.

## 3. Go/no-go judgment

**GO:** implement Milestone 1A as pure, deterministic, dependency-light core code.

**NO-GO:** model calls, persistence, routes, projection, Workspace visibility, live
scrape wiring, or EvidenceRun work until their later approved milestones.

The old deterministic/LLM pipeline is a comparison baseline and compatibility
surface, not a source architecture. Reuse is allowed only for a narrow utility that
satisfies the CF1 contract and dependency rules; reuse is never presumed.

## 4. Smallest safe first milestone — 1A

Implement only these new files:

```text
backend/src/claim-foundry/contract.js
backend/src/claim-foundry/errors.js
backend/src/claim-foundry/ids.js
backend/src/claim-foundry/canonicalJson.js
backend/src/claim-foundry/validateArticleInput.js
backend/test/claim-foundry/contract.test.js
backend/test/claim-foundry/ids.test.js
backend/test/claim-foundry/canonicalJson.test.js
backend/test/claim-foundry/validateArticleInput.test.js
backend/test/claim-foundry/fileSize.test.js
```

Milestone 1A proves that portable input and identity foundations work before any
semantic behavior is introduced. It includes no package verifier, model prompt,
runner, database migration, store, route, artifact writer, or adapter.

Acceptance for 1A:

- enums, limits, schema version, and validation rules match the Phase 1 contract;
- UUIDv7 IDs have the correct prefix, validate, and remain unique in a stress test;
- canonicalization is recursively key-stable, preserves array order, and yields
  repeatable SHA-256 hashes;
- content hash excludes consumer-only fields exactly as planned;
- valid portable inputs normalize deterministically; malformed and boilerplate
  inputs fail with stable typed error codes;
- tests pass without network, database, environment secrets, or model calls;
- every handwritten file is at most 500 lines and the test warns above 250.

## 5. Exact implementation prompt

```text
Implement Claim Foundry CF1 Milestone 1A only in
/Users/reedko/VeriStrata/veristrata-platform.

Read and follow these planning contracts first:
- docs/claim_foundry_cf1_contract_foundations.md
- docs/claim_foundry_cf1_contract_package_api.md
- docs/claim_foundry_cf1_persistence_handoff.md sections 4–5
- docs/claim_foundry_cf1_module_plan_core.md section 1
- docs/claim_foundry_cf1_implementation_readiness.md sections 4 and 6

Create only the ten Milestone 1A files listed in the readiness document. Implement
the portable constants, typed errors, prefixed UUIDv7 identities using the existing
uuid dependency, canonical JSON/SHA-256 utilities, article-input validation and
normalization, focused node:test coverage, and CF1 handwritten-file line checking.

Do not install dependencies. Do not change database schemas, routes, server startup,
scrape tasks, the existing claim pipeline, EvidenceRun, Workspace reads, or any live
integration. Do not add model calls, prompts, persistence, package assembly, or a
package verifier yet.

Keep every handwritten file <=500 lines and target <250. Run focused tests and
git diff --check. Then provide a per-file modification summary, test results, line
counts, forbidden-scope verification, and wait for review before Milestone 1B.
```

## 6. Hard prohibitions

Until separately approved, implementation must not:

- modify or delete TM4/current-pipeline code or treat it as the CF1 framework;
- restore or build on the former draft `backend/src/core/claimPackageAgent.js`;
- invoke scraping, URL retrieval, search, EvidenceRun, or evidence gathering;
- mount routes, wire live scrape tasks, or make claims Workspace-visible;
- write database migrations or production rows during core milestones;
- create targets from raw assertions; only selected claims may own targets;
- silently repair semantic meaning with deterministic heuristics;
- add a queue, broker, scheduler, automatic ER dispatch, or Agents SDK;
- introduce fixture-specific entities or answers into production code or prompts;
- add a dependency without an explicit reviewed reason;
- exceed 500 handwritten lines in any file or allow a >250-line file without a
  stated split decision.

## 7. Required report after every implementation milestone

Stop for review and report:

1. files created, modified, or deleted and why;
2. behavior implemented and explicitly deferred;
3. tests and static checks run, with exact pass/fail results;
4. handwritten line counts and every file above 250 lines;
5. database, network, model, and external side effects, including confirmation when
   there were none;
6. departures from the MCT or newly discovered decisions;
7. working-tree status and any pre-existing changes preserved;
8. the proposed scope of the next milestone, without beginning it.

## 8. Implementation sequence after 1A

After review, continue the ten milestones in the Phase 5 adapter manifest. Split the
original first milestone so review remains small:

1. **1A:** contracts, identity, canonicalization, article input, line gate.
2. **1B:** draft normalization, package assembly, full verifier, focused fixtures.
3. **2:** structural blocks and token budgets.
4. **3:** prompt/model interface and fake-model normal runner.
5. **4:** long path, repair, telemetry, artifacts, and dev runner.
6. **5–10:** persistence, API, VeriStrata shadow projection/activation, then the
   separately reviewed EvidenceRun handoff.

Planning is complete. Implementation remains approval-gated one milestone at a time.
