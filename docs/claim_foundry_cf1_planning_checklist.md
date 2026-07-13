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

- [ ] Article input schema
- [ ] Semantic block schema
- [ ] Raw assertion schema
- [ ] Article map schema: theme, thesis, pillars, clusters, opponents, qualifications
- [ ] Internal-consistency finding schema
- [ ] Selected claim schema
- [ ] Phase 3 target schema
- [ ] Evidence Need Card schema
- [ ] Verification schema
- [ ] Final package schema
- [ ] API request and response schemas
- [ ] Field provenance/ownership/cardinality matrix
- [ ] Representative valid package

Evidence:

```text
Pending
```

## Phase 2 — Persistence and handoff

- [ ] Inspect actual package, claim, link, and target migrations/tables.
- [ ] Decide dedicated CF1 table versus TM4 reuse.
- [ ] Define package ID, version, hashes, and lifecycle.
- [ ] Define immutable supersession.
- [ ] Define idempotency and retries.
- [ ] Define artifact/database relationship.
- [ ] Define EvidenceRun package-ID handoff only.
- [ ] Keep EvidenceRun results separate.

Evidence:

```text
Pending
```

## Phase 3 — VeriStrata projection

- [ ] Map selected claims to `claims`.
- [ ] Map visibility/provenance to `content_claims`.
- [ ] Map Phase 3 targets to `claim_evaluation_targets`.
- [ ] Map Evidence Need Card compatibility fields.
- [ ] Keep raw assertions audit-only.
- [ ] Define prior TM4/CF1 coexistence.
- [ ] Define create, replace, supersede, rollback, and retry behavior.

Evidence:

```text
Pending
```

## Phase 4 — Agent execution

- [ ] Normal one-primary-call path
- [ ] Long-article bounded fallback
- [ ] Structural and semantic block strategy
- [ ] Theme/thesis/pillar workflow
- [ ] Internal-consistency workflow
- [ ] Compelling claim wording requirements
- [ ] Target/Card construction workflow
- [ ] Exact CF1 tool interfaces
- [ ] Token/model-call budget
- [ ] One repair request/response contract
- [ ] Terminal failure taxonomy

Evidence:

```text
Pending
```

## Phase 5 — Files and tests

- [ ] Exact CF1 file manifest
- [ ] Exported functions per file
- [ ] Dependencies per file
- [ ] Tests per file
- [ ] Expected line counts
- [ ] Dependency-ordered milestones

Evidence:

```text
Pending
```

## Phase 6 — Fixtures and gates

- [ ] Eight required fixture classes
- [ ] Expected proof for each fixture
- [ ] Human claim-usefulness rubric
- [ ] Theme/pillar coverage gate
- [ ] Wording and target-quality gate
- [ ] Provenance gate
- [ ] Token/call/runtime gates
- [ ] Invalid-package-rate gate
- [ ] Current-pipeline comparison protocol

Evidence:

```text
Pending
```

## Phase 7 — Readiness

- [ ] Remaining blockers listed
- [ ] Go/no-go judgment
- [ ] Smallest safe milestone
- [ ] Exact implementation prompt
- [ ] Hard prohibitions
- [ ] Required final report

Final status:

```text
NOT READY — planning completion pass in progress
```
