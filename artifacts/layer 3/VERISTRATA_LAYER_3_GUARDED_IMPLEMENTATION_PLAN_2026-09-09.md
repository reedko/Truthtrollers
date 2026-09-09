# VeriStrata Layer 3 guarded implementation plan

**Status:** Governing planning document. Not authorization to implement the full Layer 3 architecture.

**Date:** September 9, 2026

**Purpose:** Add a durable history and provenance layer to VeriStrata without destabilizing the existing content, ClaimFoundry, evidence-search, evidence-bearing, SourceCrest, Workspace, or production ingestion paths.

---

## 1. Decision

Layer 3 will be built as a separate, optional provenance module connected to existing VeriStrata content by `content_id`.

It will not be built by expanding ClaimFoundry, reinterpreting `content_relations`, replacing the current author system, or merging provenance judgments into evidentiary judgments.

The two graphs remain distinct but connectable:

1. **Evidence graph:** What evidence bears on an assertion?
2. **History graph:** Where was an assertion or content item observed, who transmitted it, how did it change, and what earlier item is it related to?

Layer 3 gives an assertion a memory. It does not decide whether the assertion is true.

---

## 2. Why this plan is deliberately smaller than the architecture report

The September 8-9 architecture investigation correctly identified the missing concepts:

- stable platform accounts;
- platform content identifiers;
- account-to-content actions;
- immutable observations;
- durable content-to-content lineage;
- identity assertions that do not conflate an account with a person;
- assertion occurrences across content and time.

But the architecture report also described a near-complete system: multiple new tables, recursive resolution, downstream discovery, backfill, five endpoints, review controls, and a new UI.

That is a destination, not a safe first implementation.

The governing lesson from the TM4-to-ClaimFoundry work is that a stable path must not be redesigned while a replacement is still being discovered. Layer 3 therefore proceeds through narrow, reversible vertical slices. Every slice must work independently before it is allowed to touch the next subsystem.

---

## 3. Non-negotiable boundaries

### 3.1 Existing systems remain authoritative

Layer 3 must not change the current meaning or behavior of:

- `content`;
- `content_claims`;
- `content_relations`;
- `reference_claim_links`;
- `reference_claim_task_links`;
- ClaimFoundry or any CF prompt, schema, selection, or persistence path;
- EvidenceRun, evidence search, retrieval quotas, source-assertion extraction, or bearing judgments;
- `authors`, `content_authors`, or `persistAuthors()`;
- `publishers`, `content_publishers`, SourceCrest, or publisher resolution;
- the current Workspace;
- the existing source-detail display;
- the existing deletion pipeline until a separately approved integration slice.

Existing code may be read and called through a narrow adapter. It must not be refactored merely to make Layer 3 cleaner.

### 3.2 Separate module ownership

All new application code belongs under a dedicated provenance boundary, conceptually:

```text
backend/src/modules/provenance/
dashboard/src/modules/provenance/
shared/provenance/
```

Use the repository's actual module conventions after inspection, but preserve one recognizable ownership boundary.

The module owns:

- provenance contracts;
- platform-account observations;
- content observations;
- account actions;
- lineage suggestions and reviewed lineage relations;
- history reads;
- provenance-specific tests and fixtures.

The module does not own:

- assertion extraction;
- evidence retrieval;
- evidentiary stance;
- truth scoring;
- publisher reliability;
- author biographies;
- unrestricted social-network crawling.

### 3.3 Database separation

The first Layer 3 migration must be additive.

- Do not alter existing tables in the first implementation slice.
- Do not add startup auto-DDL.
- Do not repurpose empty or partially used tables merely because their names seem close.
- Do not use `authors` for platform accounts.
- Do not use `publishers` for platform accounts.
- Do not use `content_relations` for provenance or lineage.
- Do not turn `source_lineage_cache` into authoritative history.
- Use explicit `_up.sql` and `_down.sql` migrations following the repository's current timestamped convention.
- Every new foreign key to existing data must point inward from the provenance module. Existing tables must not depend on Layer 3.

Prefer a `provenance_` table prefix during the isolated phase so ownership is visible and rollback is tractable. Codex may recommend different final names, but it must justify any loss of namespacing before implementation.

### 3.4 Runtime isolation

Layer 3 must be disabled by default.

Required controls:

- one dedicated feature flag;
- no behavior change when the flag is off;
- no implicit execution from existing scrape, task creation, ClaimFoundry, or EvidenceRun paths;
- no background traversal;
- no automatic backfill;
- no production UI navigation until explicitly enabled;
- no silent fallback that writes Layer 3 data when an existing path fails.

### 3.5 Human judgment and uncertainty

- “Earliest located appearance” must never silently become “original source.”
- A missing relationship means “not established,” not “unrelated.”
- A displayed account name must not become a verified identity.
- An AI or rule-produced edge remains a suggestion until reviewed.
- Provenance relations must not use support/refute colors or imply truth.
- Account reliability must not be collapsed into publisher reliability or an evidentiary score.

---

## 4. Conceptual model

The conceptual destination remains:

```text
real-world identity
        ^
        | account claims / is assessed to represent
platform account
        |
        | posted / reposted / quoted / shared / uploaded
        v
existing VeriStrata content
        |
        | repost of / quote of / excerpt of / altered from / corrects
        v
earlier existing VeriStrata content
```

Three concepts must remain separate:

1. **Observed fact:** A platform account performed an exposed platform action.
2. **Suggested relationship:** A rule or model detected possible derivation or identity correspondence.
3. **Reviewed conclusion:** A person accepted, rejected, or revised the suggestion with a rationale.

The first vertical slice does not need the full real-world identity layer. It needs only observable accounts, observable content, immutable captures, and one explicit content relationship.

---

## 5. Initial vertical slice

### 5.1 Exact objective

Prove that an isolated Layer 3 module can represent and return this fixture:

- one existing `content_id` representing an original social post;
- one platform account that posted it;
- one immutable observation of that account;
- one immutable observation of the content;
- one second existing `content_id` representing a quote-post or repost;
- one second platform account that transmitted it;
- one explicit relation from the later content to the earlier content;
- one existing assertion attached to both content records through the current assertion system;
- one read-only history response showing the two items in time and lineage order.

### 5.2 Fixture-first constraint

The first slice uses checked-in deterministic fixtures only.

It must not:

- scrape Facebook, X, Bluesky, or any live website;
- call Tavily, Firecrawl, an LLM, or any external service;
- write to production;
- backfill existing rows;
- modify the browser extension;
- add UI controls;
- perform recursive discovery;
- classify an account as fake or coordinated.

The fixture should be modeled on the Clemson Matryoshka use case but contain synthetic data. It should include mutable handles, stable platform IDs, a repost/quote relationship, timestamps, and an account that merely claims a displayed identity.

### 5.3 Minimal owned concepts

Codex must determine the smallest schema that supports the fixture. The first slice should normally require only equivalents of:

- platform;
- platform account;
- account observation;
- platform-content binding to existing `content_id`;
- content observation;
- account action;
- content lineage relation.

Do not add `identities`, identity resolution, assertion mutation, recursive history, lineage evidence collections, or generalized coordination scoring in Slice 1 unless the fixture cannot be represented without them. If Codex believes one is necessary, it must stop and explain why before adding it.

### 5.4 Minimal read surface

Slice 1 may add one read-only internal service or test endpoint that returns:

```text
account -> action -> content -> lineage relation -> earlier content
```

It must not add the full public API proposed in the architecture report.

---

## 6. Delivery phases and approval gates

No phase authorizes the next phase. Codex must stop at every gate and present the listed evidence.

### Phase 0: freeze and baseline

**Work permitted**

- Read governing instructions and inspect the repository.
- Record the current branch, commit, worktree status, migration state, and relevant test commands.
- Identify unrelated user changes and leave them untouched.
- Run existing targeted tests without changing code.
- Confirm current production defaults and feature flags.

**Required output**

- Baseline report.
- Exact files proposed for Slice 1.
- Exact tests that protect current behavior.
- Confirmation that no files were modified.

**Gate 0**

Stop for approval.

### Phase 1: contract and fixture, no database

**Work permitted**

- Create the isolated module directory.
- Define small platform-neutral types/contracts.
- Add synthetic Clemson-style fixtures.
- Add validation tests for stable IDs, mutable handles, action types, lineage direction, timestamps, and provenance status.
- Build an in-memory history assembler sufficient for the fixture.

**Forbidden**

- Database migrations.
- Existing pipeline integration.
- Existing file refactors.
- Network calls.
- UI.

**Acceptance evidence**

- New tests pass.
- Existing targeted tests remain unchanged and pass.
- Build/typecheck passes without broad configuration changes.
- A fixture report clearly shows the later-to-earlier lineage direction.

**Gate 1**

Stop for review of the contract. Do not create tables.

### Phase 2: isolated persistence

**Work permitted after Gate 1 approval**

- Add the minimal namespaced provenance tables.
- Add one provenance repository.
- Persist and read the synthetic fixture against a local or disposable test database.
- Add migration up/down tests, idempotency checks, uniqueness checks, cycle/self-link rejection, and deletion-order tests for the new module.

**Forbidden**

- Changes to existing tables.
- Production migration.
- Backfill.
- Scraper integration.
- ClaimFoundry or EvidenceRun integration.
- UI.

**Acceptance evidence**

- Exact migration diff.
- Successful up, verification, down, and re-up on a disposable database.
- No changes to existing table definitions.
- Repository tests and existing regression tests pass.
- Feature flag remains off by default.

**Gate 2**

Stop for migration review. Do not deploy.

### Phase 3: one read-only history surface

**Work permitted after Gate 2 approval**

- Add one internal read service or endpoint for the two-node fixture.
- Add a minimal read-only history component behind the Layer 3 flag, or produce a harness report if UI is not yet warranted.
- Show observed facts, suggestions, and reviewed conclusions distinctly.

**Forbidden**

- Review/write controls in the UI.
- Existing navigation changes when the flag is off.
- Automatic resolution or discovery.
- Scraping.

**Acceptance evidence**

- API contract and sample response.
- Screenshot or harness output.
- Flag-off regression proof.
- No existing content, evidence, or Workspace UI behavior changed.

**Gate 3**

Stop for product review.

### Phase 4: one ingestion adapter

**Work permitted after Gate 3 approval**

- Choose exactly one existing acquisition path.
- Prefer an already normalized social-post object over rewriting a scraper.
- Add a thin adapter from that object into the approved provenance contract.
- Process one new, isolated test `content_id` exactly once.
- Preserve all logs and resulting rows.

**Required live-run protections**

- New content only.
- Feature flag scoped to the process or request.
- Legacy behavior remains available and unchanged.
- One run only; no automatic retry.
- Stop on first unexpected result.
- No automatic cleanup.
- Cleanup, if approved, uses an explicit script with exact IDs.

**Forbidden**

- More than one platform.
- Recursive thread traversal.
- Downstream search.
- Backfill.
- Modifying ClaimFoundry input or output.

**Gate 4**

Stop and inspect the captured data before adding any second content item or platform.

### Phase 5: explicit parent relation

**Work permitted after Gate 4 approval**

- Ingest one quote-post or native repost with an explicit platform-provided parent identifier.
- Persist one typed relation to the earlier content.
- Return both in the history read model.

**Forbidden**

- Inferred cross-platform copying.
- Text-similarity derivation.
- “Original source” labeling.
- Recursive traversal.

**Gate 5**

Stop. This completes the first production-shaped vertical slice.

### Later phases, not presently authorized

The following remain separate proposals:

- account-to-real-world-identity assertions;
- reuse of `source_lineage_cache` through a read-only suggestion adapter;
- lineage evidence and review controls;
- assertion-occurrence and mutation tracking;
- bounded upstream resolution;
- sibling/downstream discovery;
- additional platforms;
- coordination signals;
- media fingerprinting;
- historical backfill;
- unrestricted investigation workflows.

Each requires its own scoped plan and approval.

---

## 7. Module interfaces

Layer 3 should integrate through narrow contracts rather than imports scattered through the existing application.

### 7.1 Inbound contract

The provenance module may accept a normalized capture resembling:

```json
{
  "contentId": 123,
  "platform": {
    "key": "example",
    "stableContentId": "post-456",
    "uri": "platform://post-456"
  },
  "account": {
    "stableAccountId": "account-789",
    "handleObserved": "example.handle",
    "displayNameObserved": "Example Name"
  },
  "action": "POSTED",
  "publishedAtObserved": "2026-09-09T00:00:00Z",
  "capturedAt": "2026-09-09T00:01:00Z",
  "textObserved": "Fixture text",
  "parent": null,
  "provenance": {
    "type": "platform_observed",
    "captureSource": "fixture"
  }
}
```

This is illustrative, not a frozen implementation schema. The approved Phase 1 contract becomes authoritative.

### 7.2 Existing-system adapter

Layer 3 may read:

- `content_id` and minimal content metadata;
- current assertion links for history display;
- publisher attribution for display only;
- cached lineage signals as unreviewed suggestions in a later phase.

Layer 3 must not write through existing author, publisher, ClaimFoundry, or evidence repositories.

### 7.3 Outbound contract

The first history read model should be independent of the Workspace data model. It should return only the nodes, observations, actions, edges, timestamps, and provenance status needed by a history display.

---

## 8. Relationship rules for the first slice

Only these action types are required initially:

- `POSTED`
- `REPOSTED`
- `QUOTED`

Only these lineage relations are required initially:

- `REPOST_OF`
- `QUOTE_OF`

Direction is always:

```text
later or derived content -> earlier or source content
```

`REPLIED`, `SHARED`, `UPLOADED`, `PUBLISHED`, `CROSS_PLATFORM_COPY_OF`, `EXCERPT_OF`, `SYNDICATED_FROM`, `POINTER_TO`, `ARCHIVE_OF`, `REVISION_OF`, `MATERIALLY_ALTERED_FROM`, `CORRECTS`, `WITHDRAWS`, and unclassified derivation are deferred.

Deferring a type does not authorize mapping it to the nearest available type. Unsupported relationships remain unrepresented.

---

## 9. Testing contract

### 9.1 Isolation tests

- Flag off produces current behavior and no provenance writes.
- Existing task ingestion succeeds without loading the provenance module.
- Existing ClaimFoundry input and output snapshots do not change.
- Existing evidence search and bearing tests do not change.
- Existing author and publisher outputs do not change.
- No existing TypeScript, Node, loader, root directory, or build configuration is broadened to accommodate Layer 3.

### 9.2 Provenance tests

- Re-ingesting one stable platform content ID is idempotent.
- Changing a handle or display name creates a new observation, not a new stable account.
- Old observations remain immutable.
- A displayed name does not create a real-world identity conclusion.
- A quote-post is a distinct content node.
- A native repost follows the approved platform rule and does not fabricate a content node when none exists.
- The later item points to the earlier item.
- Self-links and duplicate edges are rejected.
- Cycles are rejected or explicitly flagged.
- Impossible timestamp ordering is flagged, not silently corrected.
- Unreviewed suggestions remain visibly unreviewed.

### 9.3 Migration tests

- Migration applies cleanly to a production-like schema snapshot.
- Migration rollback removes only Layer 3 structures.
- Re-applying the migration is safe under the repository's migration convention.
- Existing row counts and schemas remain unchanged.
- No backfill occurs during migration.

### 9.4 Live-run protections

When a live run is eventually approved:

- use a newly created isolated content record;
- record all exact IDs before execution;
- run exactly once;
- disable automatic retries;
- stop at the first failed assertion or unexpected write;
- preserve logs and artifacts;
- never perform broad or automatic cleanup.

---

## 10. Change-budget rules

Each approved phase must declare a change budget before editing:

- exact new files;
- exact existing files, if any;
- maximum number of existing integration points;
- database objects created;
- tests added;
- tests expected to remain byte-for-byte unchanged.

If implementation requires a file outside the approved budget, Codex must stop and request approval. “While here” refactors are prohibited.

For the first two phases, the target is:

- mostly new files inside the provenance module;
- zero changes to ClaimFoundry and EvidenceRun;
- zero changes to existing database tables;
- at most one existing route-registration or module-registration file after persistence is approved;
- no extension or dashboard changes before their dedicated phases.

---

## 11. Rollback and recovery

Every phase must be independently reversible.

- Code rollback removes the isolated module and its single registration point.
- Flag off must restore the pre-Layer 3 runtime path without data migration.
- Database rollback removes only namespaced Layer 3 tables after verifying they contain no user-approved retained data.
- No existing content, author, publisher, assertion, evidence, or relation rows may be deleted during rollback.
- Test or live data cleanup must identify exact rows by exact IDs and run only after explicit approval.

The ability to roll back is an acceptance criterion, not cleanup work deferred until later.

---

## 12. Codex operating instructions

For every Layer 3 task:

1. Read this plan and all higher-priority repository instructions.
2. State the currently authorized phase.
3. Inspect before editing.
4. Show the proposed change budget.
5. Confirm prohibited systems that will remain untouched.
6. Stop if the requested work crosses a gate.
7. Use fixtures before databases, disposable databases before production-like snapshots, and production-like snapshots before any live run.
8. Keep defaults off.
9. Do not infer approval from the existence of later phases in this document.
10. End each phase with files changed, tests run, results, unresolved risks, and rollback instructions.

Codex must not interpret “continue,” “implement Layer 3,” or “finish the plan” as authorization for all phases. The prompt must name the exact phase being authorized.

---

## 13. First Codex execution prompt

Use this prompt after placing this file in the repository:

```text
Read VERISTRATA_LAYER_3_GUARDED_IMPLEMENTATION_PLAN_2026-09-09.md and all higher-priority repository instructions.

You are authorized for Phase 0 only: freeze and baseline.

Do not edit code, create files, create migrations, change configuration, access production data, or implement any Layer 3 component.

Return:

1. The current branch, commit, and worktree state.
2. The governing instructions and handoffs that apply.
3. The existing tests that protect task ingestion, ClaimFoundry, EvidenceRun, authors, publishers, content relations, and source lineage.
4. The exact proposed new files for Phase 1.
5. Any existing files Phase 1 would need to modify. The preferred answer is none.
6. A Phase 1 change budget.
7. Any conflict between this plan and the actual repository.

Stop after the Phase 0 report. Do not begin Phase 1.
```

---

## 14. Definition of success

The first success is not a complete misinformation-tracking platform.

The first success is much smaller:

> VeriStrata can represent one observed post, the account that posted it, one later quote or repost, and the explicit relationship between them, then return that history without changing any existing assertion or evidence behavior.

Only after that works, remains isolated, and survives rollback should VeriStrata attempt identity assessment, assertion mutation, automated lineage discovery, campaign clustering, or large-scale investigation support.

---

## 15. Parked product destination

The larger product direction remains valid and is intentionally parked rather than discarded:

- archive disappearing posts and account profiles;
- track original posters, reposters, quoters, and sharers;
- distinguish platform accounts from claimed and actual identities;
- show the earliest located appearance of an assertion;
- show repetition, mutation, laundering, correction, and spread;
- connect history nodes to the existing evidence map;
- support investigative-journalism and information-security workflows;
- permit human review of AI- or rule-suggested relationships;
- generate inspectable reporting from the combined evidence and history graphs.

Those capabilities are the roadmap. They are not the first commit.
