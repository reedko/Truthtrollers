# Claim Foundry CF1: Planning Completion Brief

**Purpose:** Finish the unresolved Claim Foundry CF1 contracts before implementation.

**Output:** An implementation-ready plan. This pass may update planning documents only; it must not edit application code, install dependencies, stage files, or commit.

**Naming:** Use **Claim Foundry**, **ClaimFoundry**, and **CF1** for all new modules, routes, scripts, artifacts, schemas, and documents. Do not use TM5. TM4 names may appear only when describing legacy code or compatibility.

## Governing constraints

- Claim Foundry decides what should be tested; EvidenceRun later determines what evidence bears on those tests.
- Do not design or implement EvidenceRun in this pass. Define only its package-consumption boundary.
- Treat `backend/src/core/claimPackageAgent.js` as draft-only, not an architecture baseline.
- Inspect actual migrations and database schemas before making persistence decisions.
- Every proposed handwritten file must be 500 lines or fewer and should target fewer than 250 lines.
- Preserve existing dirty-tree work and generated artifacts.
- The immutable portable CF1 package is the source of truth.
- VeriStrata projection tables are compatibility/product views, not the portable API contract.
- EvidenceRun results are separate downstream records, not mutations of the CF1 package.

---

## Phase 1: Portable CF1 contract

Define exact JSON schemas for:

1. Article input
2. Semantic block
3. Raw assertion
4. Article map
5. Internal-consistency finding
6. Selected evaluation claim
7. Phase 3 target
8. Evidence Need Card
9. Verification result
10. Final CF1 package
11. API request
12. API response

The contract must be consumer-neutral. VeriStrata is one consumer, not the product boundary.

For every field specify:

- required or optional
- data type and allowed enum values
- maximum practical size or cardinality
- source of truth
- agent-produced or deterministic
- portable, VeriStrata-only, or diagnostic-only

Preserve clear separation among claim wording, target wording, attribution, substantive truth, identity, inference, bearing, stance, `scoreTransform`, `searchEligible`, and `verdictEligible`.

**Phase output:** Versioned CF1 schema contract and representative valid package.

---

## Phase 2: Immutable persistence and handoff

Decide whether CF1 should:

- create a dedicated immutable `claim_packages` table, or
- temporarily reuse existing TM4 package/evaluation tables.

Evaluate seriously the recommended dedicated CF1 package table keyed by package ID.

Define:

- package ID format
- schema and pipeline versioning
- optional consumer and VeriStrata content relationships
- immutable package versions
- supersession behavior
- idempotency keys and collision behavior
- package hash and input hash
- artifact path relationship
- package lifecycle states
- database handoff to EvidenceRun
- transaction and failure boundaries

Explicitly distinguish:

1. Immutable portable CF1 package
2. VeriStrata Workspace projection
3. Later EvidenceRun results

**Phase output:** Persistence decision, proposed schema/migration, state machine, and handoff contract.

---

## Phase 3: VeriStrata projection

Define exact mapping from the portable CF1 package into:

- `claims`
- `content_claims`
- `claim_evaluation_targets`

Specify:

- create versus replace behavior
- package supersession behavior
- idempotency and retry rules
- coexistence with prior TM4 or CF1 outputs
- how selected claims become Workspace-visible
- how raw assertions remain audit/debug-only
- how Phase 3 targets become EvidenceRun inputs
- how Evidence Need Card fields project into existing target JSON columns
- rollback behavior for partial projection failure

**Phase output:** Field-level projection map and transactional write algorithm.

---

## Phase 4: Agent execution

Finalize:

- normal-article execution path
- long-article fallback
- deterministic structural-block proposal
- semantic-block interpretation
- theme, thesis, and pillar construction
- cross-block internal-consistency review
- selected-claim portfolio construction
- compelling and bearing-legible claim wording
- Phase 3 target and Evidence Need Card construction
- typical one-primary-call policy
- exact tools available to CF1
- model-call and token budgets
- repair request/response contract
- terminal failure behavior after one repair pass

**Phase output:** Runner state machine, tool contracts, call budgets, and failure taxonomy.

---

## Phase 5: Module and file plan

Use CF1 naming. Likely roots:

```text
backend/src/claim-foundry/
backend/src/routes/claim-foundry/
backend/src/storage/
scripts/dev/cf1_run_claim_foundry.mjs
backend/test/claim-foundry/
docs/claim_foundry_cf1_mct.md
```

For every proposed file state:

- new or modified
- single responsibility
- exported functions
- dependencies
- test coverage
- expected line count

No proposed file may exceed 500 lines. Most should remain below 250.

**Phase output:** Exact implementation manifest in dependency order.

---

## Phase 6: Fixtures and comparative gates

Define fixtures for:

- straightforward argument
- rebuttal article
- long article
- heavy quotation and attribution
- multiple named studies/documents
- internal contradiction
- weak or absent thesis
- short factual report

For every fixture define what CF1 must prove.

Compare CF1 with the current pipeline on:

- claim usefulness
- theme and pillar coverage
- compelling, faithful wording
- Phase 3 target quality
- provenance completeness
- token use
- model-call count
- runtime
- invalid-package rate

Define scoring rubrics, minimum gates, comparison commands, and artifacts.

**Phase output:** Fixture matrix and pass/fail evaluation protocol.

---

## Phase 7: Final readiness judgment

End the planning pass with:

- what is implementation-ready
- what remains unresolved
- explicit go/no-go judgment
- smallest safe first implementation milestone
- exact next implementation prompt
- hard prohibitions and final-report requirements

Planning is complete only when another engineer or agent can implement the first milestone without rediscovering contracts or making architectural decisions.

