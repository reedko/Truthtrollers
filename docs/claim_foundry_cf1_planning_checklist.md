# Claim Foundry CF1: Internal Planning Checklist

**Status:** Active
**Rule:** Check an item only when its evidence is recorded in the completion plan.
**No application code during this checklist.**

## Phase 0 — Safety and baseline

- [ ] Capture `git status --short`, recent log, and tracked diff.
- [ ] Classify tracked work, generated noise, CF1-relevant drafts, and no-touch files.
- [ ] Confirm `claimPackageAgent.js` remains draft-only.
- [ ] Confirm all proposed files obey ≤500 lines, target <250.

Evidence:

```text
Pending
```

## Phase 1 — Portable contract

- [x] Article input schema
- [x] Semantic block schema
- [x] Raw assertion schema
- [x] Article map schema: theme, thesis, pillars, clusters, opponents, qualifications
- [x] Internal-consistency finding schema
- [x] Selected claim schema
- [x] Phase 3 target schema
- [x] Evidence Need Card schema
- [x] Verification schema
- [x] Final package schema
- [x] API request and response schemas
- [x] Field provenance/ownership/cardinality matrix
- [x] Representative valid package

Evidence:

```text
docs/claim_foundry_cf1_contract_foundations.md
docs/claim_foundry_cf1_contract_package_api.md
docs/claim_foundry_cf1_contract_example.json

Validation: example parses as JSON; documents are 140, 224, and 191 lines;
git diff --check passes. Phase 2 identity/version semantics remain explicitly
deferred rather than being guessed inside the portable representation.
```

## Phase 2 — Persistence and handoff

- [x] Inspect actual package, claim, link, and target migrations/tables.
- [x] Decide dedicated CF1 table versus TM4 reuse.
- [x] Define package ID, version, hashes, and lifecycle.
- [x] Define immutable supersession.
- [x] Define idempotency and retries.
- [x] Define artifact/database relationship.
- [x] Define EvidenceRun package-ID handoff only.
- [x] Keep EvidenceRun results separate.

Evidence:

```text
docs/claim_foundry_cf1_persistence_handoff.md

Evidence: inspected migrations and live SHOW CREATE TABLE output for content,
claims, content_claims, claim_evaluation_targets,
evaluation_target_evidence_links, tm4_claim_packages, and
tm4_selected_evaluation_claims. Decision: dedicated immutable CF1 package
store plus mutable run envelope and consumer bindings. TM4 remains historical.
```

## Phase 3 — VeriStrata projection

- [x] Map selected claims to `claims`.
- [x] Map visibility/provenance to `content_claims`.
- [x] Map Phase 3 targets to `claim_evaluation_targets`.
- [x] Map Evidence Need Card compatibility fields.
- [x] Keep raw assertions audit-only.
- [x] Define prior TM4/CF1 coexistence.
- [x] Define create, replace, supersede, rollback, and retry behavior.

Evidence:

```text
docs/claim_foundry_cf1_veristrata_projection.md

Evidence: inspected live read paths and current broad-clear/target-replacement
behavior. Decision: additive package provenance columns, package-scoped writes,
explicit shadow/project/activate modes, and active-binding read selection.
Historical TM4/CF1 rows remain stored and inactive rather than deleted.
```

## Phase 4 — Agent execution

- [x] Normal one-primary-call path
- [x] Long-article bounded fallback
- [x] Structural and semantic block strategy
- [x] Theme/thesis/pillar workflow
- [x] Internal-consistency workflow
- [x] Compelling claim wording requirements
- [x] Target/Card construction workflow
- [x] Exact CF1 tool interfaces
- [x] Token/model-call budget
- [x] One repair request/response contract
- [x] Terminal failure taxonomy

Evidence:

```text
docs/claim_foundry_cf1_agent_execution.md
docs/claim_foundry_cf1_repair_failure_contract.md

Decision: one coherent full-article call for normal inputs, bounded compact
batch observations plus one synthesis for long inputs, and at most one
allowlisted repair. Deterministic services own structure, IDs, verification,
hashing, persistence, and budgets. No evidence/search/fetch tools are exposed.
```

## Phase 5 — Files and tests

- [x] Exact CF1 file manifest
- [x] Exported functions per file
- [x] Dependencies per file
- [x] Tests per file
- [x] Expected line counts
- [x] Dependency-ordered milestones

Evidence:

```text
docs/claim_foundry_cf1_module_plan_core.md
docs/claim_foundry_cf1_module_plan_adapters.md

Manifest covers core deterministic modules, prompt/model boundary, repair,
artifacts, persistence migrations/stores, public API, VeriStrata adapter,
scripts, focused tests, expected line counts, and dependency-ordered work.
Every proposed file is ≤500 lines and targets <250.
```

## Phase 6 — Fixtures and gates

- [x] Eight required fixture classes
- [x] Expected proof for each fixture
- [x] Human claim-usefulness rubric
- [x] Theme/pillar coverage gate
- [x] Wording and target-quality gate
- [x] Provenance gate
- [x] Token/call/runtime gates
- [x] Invalid-package-rate gate
- [x] Current-pipeline comparison protocol

Evidence:

```text
Complete. See `claim_foundry_cf1_fixture_matrix.md` and
`claim_foundry_cf1_comparative_gates.md`. Phase 6 defines frozen fixture policy,
eight proof obligations, blind paired review, deterministic integrity gates,
quality thresholds, bounded call/token/runtime gates, reliability thresholds,
and auditable comparison artifacts. Fixture prose is intentionally deferred to
implementation; its classes and acceptance obligations are now fixed.
```

## Phase 7 — Readiness

- [x] Remaining blockers listed
- [x] Go/no-go judgment
- [x] Smallest safe milestone
- [x] Exact implementation prompt
- [x] Hard prohibitions
- [x] Required final report

Final status:

```text
READY — CF1 planning completion pass is complete. GO is limited to deterministic
Milestone 1A in `claim_foundry_cf1_implementation_readiness.md`; all later work
remains separately approval-gated.
```
