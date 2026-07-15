# CF1 Implementation Checklist

**Rule:** Complete one milestone, report it, and wait for approval.
**File limit:** 500 handwritten lines maximum; target 250 or fewer.
**ER1:** Requires its own reviewed MCT before implementation.

Status values: `[ ]` pending, `[~]` in progress, `[R]` ready for review,
`[x]` approved.

## Milestone 1A — Deterministic foundations

- [x] Contract constants, enums, versions, and limits
- [x] Typed CF1 errors with stable codes
- [x] Prefixed UUIDv7 run, package, and lineage IDs
- [x] Canonical JSON and SHA-256 utilities
- [x] Portable article validation and normalization
- [x] Focused `node:test` coverage
- [x] CF1 handwritten-file line gate
- [x] Modification summary reviewed by user

Excluded: models, prompts, package assembly, database, routes, scraping, EvidenceRun.

## Milestone 1B — Package verification

- [x] Normalize agent drafts and assign package-local IDs
- [x] Normalize and source-check identifier hints
- [x] Assemble the portable package
- [x] Verify schema, references, provenance, postures, targets, and cards
- [x] Classify repairable versus terminal failures
- [x] Valid and invalid package fixtures
- [x] Modification summary reviewed by user

## Milestone 2 — Structure and budgets

- [x] Propose source-only structural blocks
- [x] Verify offsets, ordering, and coverage
- [x] Estimate token use
- [x] Select normal or long execution path
- [x] Enforce path, call, and token ceilings
- [x] Modification summary reviewed by user

## Milestone 3 — One-shot baseline infrastructure

- [x] Primary Claim Foundry prompt
- [x] Injectable structured-model boundary
- [x] One-call baseline execution, explicitly labeled `baseline`
- [x] Fake-model tests without network access
- [x] Usage telemetry integration
- [x] Modification summary reviewed by user

This milestone did not implement the CF1 agent and must not be cited as agent completion.

## Superseding milestone — CF1 bounded agent runtime

- [x] Explicit `CF1AgentState` and ordered step trace
- [x] Orientation and initial semantic work product
- [x] Semantic claim-quality critic
- [x] Critic-derived revision plan
- [x] Revision and selected-claim pass after critique
- [x] Selected-claim-only Phase 3 targets and Evidence Need Cards
- [x] Deterministic package verification and at most one repair
- [x] Inspectable per-stage artifacts and final package
- [x] One-shot path labeled baseline, not agent
- [x] Focused automated tests of stage ordering and boundaries
- [x] Retained F01 model-run artifacts prove critique changed selected claims

The agent-runtime implementation milestone is complete. This does not pass the
separate 9A comparative-quality, runtime, fixture-wide, or live-activation gates.

## Milestone 4A — Repair

- [x] Repair request and response validation
- [x] Allowlisted atomic repair operations
- [x] Exactly one repair maximum
- [x] Reverification and terminal failure behavior
- [x] Modification summary reviewed by user

## Milestone 4B — Long articles

- [x] Bounded block batching
- [x] Compact block observation prompt
- [x] Whole-article synthesis prompt
- [x] Six batch + one synthesis + one repair ceilings
- [x] Cross-block and late-article coverage tests
- [x] Modification summary reviewed by user

## Milestone 4C — Orchestration and local tools

- [x] Top-level `runClaimFoundry` state machine
- [x] JSON and Markdown artifacts
- [x] Offline package validator
- [x] Local development runner
- [x] No-persistence end-to-end fixture run
- [x] Modification summary reviewed by user

## Milestone 5 — Immutable persistence

- [x] Review deployed MySQL compatibility
- [x] Add CF1 runs, packages, and bindings migration
- [x] Transaction helper and stores
- [x] Idempotency, lineage, supersession, and hash checks
- [x] Apply-twice and immutability tests
- [x] Modification summary reviewed by user

## Milestone 6 — Public API

- [x] Resolve production authentication/consumer keys
- [x] Submit portable article endpoint
- [x] Run status endpoint
- [x] Immutable package load endpoint
- [x] Request/response and idempotency tests
- [x] Modification summary reviewed by user

## Milestone 7 — VeriStrata shadow adapter

- [R] Load persisted VeriStrata article without scraping
- [R] Bind package to `content_id`
- [R] Run CF1 in shadow mode
- [R] Keep current claims and Workspace reads unchanged
- [x] Modification summary reviewed by user

## Milestone 8 — Inactive projection

- [R] Add package-scoped projection columns/indexes
- [R] Map selected claims only
- [R] Map Phase 3 targets and Evidence Need Cards
- [R] Preserve all prior TM4 and CF1 projections
- [R] Project transactionally and remain inactive
- [x] Modification summary reviewed by user

## Milestone 9A — Comparison stabilization and completion

Governing plan: `docs/claim_foundry_cf1_milestone_9a_plan.md`

### 9A-1 — ArticleDocument and grounding contract

- [R] Define raw source → ArticleDocument → source blocks → CF1 ownership
- [R] Define canonical text, atoms, source units, links, offsets, and diagnostics
- [R] Remove exact excerpts and offsets from model ownership
- [R] Define assertion grounding by deterministic `sourceUnitIds`
- [R] Preserve frozen comparison article text and hashes
- [x] Phase modification summary reviewed by user

### 9A-2 — Existing-wheel reuse map

- [R] Inventory HTML, PDF, pasted-text, Readability, link, and TM4 sectioning paths
- [R] Classify each component as shared, reused, refactored, retired, or rejected
- [R] Record truncation, link caps, structure loss, and PDF-layout limitations
- [R] Confirm one canonical CF1 claim-production input boundary
- [R] Record full canonical persistence/retry as a live-cutover blocker
- [x] Phase modification summary reviewed by user

### 9A-3 — ArticleDocument implementation

- [x] Implement HTML, PDF, and pasted-text adapters outside the live scrape path
- [x] Assemble canonical text from ordered atoms with exact offsets
- [x] Attach content links to source atoms/units
- [x] Verify coverage, order, non-overlap, and diagnostics
- [x] Keep every handwritten file at or below 500 lines, target below 250
- [x] Initial phase modification summary reviewed with amendment

### 9A-3 amendment — Extensible source structure

- [R] Define provider-neutral, extensible source-family identifiers
- [R] Define hashed, versioned `StructureProfile` contract
- [R] Add a small reviewed static default-profile provider
- [R] Record adapter and exact profile identity in every ArticleDocument
- [R] Reserve transcript, social-post, reply, and thread atoms/signals
- [R] Add an inert additive `cf1_structure_profiles` migration
- [R] Prohibit automatic learning, activation, live wiring, and parser duplication
- [x] Amendment modification summary reviewed by user

### 9A-4 — Structure-aware source blocks

- [R] Assemble blocks from structural signals rather than argumentative guesses
- [R] Preserve headings, gaps, emphasis, lists, tables, captions, quotes, and links
- [R] Keep headings with content and ignore page breaks as standalone boundaries
- [R] Verify atom/unit/block coverage and exact canonical offsets
- [R] Review rendered blocks for F01, F03, F05, and F06
- [x] Phase modification summary reviewed by user

### 9A-5 — Host-owned provenance

- [R] Replace model-produced `sourceExcerpt` with `sourceUnitIds`
- [R] Derive raw-assertion excerpts and offsets deterministically
- [R] Make selected claims and targets inherit raw-assertion provenance
- [R] Reject ambiguous, missing, or semantically changed grounding
- [R] Reproduce and resolve the F01 provenance failure
- [ ] Phase modification summary reviewed by user

### 9A-6 — Prompt/schema/budget reduction

- [x] Remove repeated and deterministically derivable model-output fields
- [x] Preserve orientation, claims, targets, cards, attribution, named works, and scope
- [x] Retain one whole-article agent call for typical articles
- [x] Record exact implemented schema, ownership, and F01 cost in the MCT
- [ ] Phase modification summary reviewed by user

### 9A-7 — Deterministic and smoke validation

- [x] Pass unit, coverage, offset, source-block, provenance, package, and line gates
- [ ] Pass F08, F01, F06, and F03 smoke runs
- [x] Persist no invalid or partial package
- [x] Capture complete F01 model and verifier diagnostics
- [ ] Phase modification summary reviewed by user

### 9A-8 — Blind paired comparison

- [x] Freeze and approve eight acceptance fixtures
- [~] Run three pinned current-versus-CF1 pairs per fixture
- [ ] Complete blinded review and adjudication
- [ ] Capture quality, provenance, tokens, calls, repairs, runtime, and failures
- [ ] Phase modification summary reviewed by user

### 9A-9 — Gate judgment

- [ ] Pass quality, comparative, provenance, efficiency, and reliability gates
- [ ] Classify result as pass, fail-remediable, or fail-architectural
- [ ] Permit 9B only after a full pass
- [ ] Milestone 9A modification summary reviewed by user

## Milestone 9B — Controlled live cutover and retirement

- [R] Add package-aware Workspace reads
- [R] Add controlled activation and rollback
- [ ] Inventory every live task-claim production entry point
- [ ] Persist the complete canonical ArticleDocument before asynchronous CF1 execution
- [ ] Reload retries from the identical persisted canonical input without re-scraping
- [ ] Never use the 500-character `content.details` preview as CF1 article text
- [ ] Route URL, extension HTML, PDF, raw text, jobs, retries, and incremental paths through CF1
- [ ] Bind and activate exactly one immutable CF1 package per selected lineage
- [ ] Prohibit silent fallback to the old claim producer
- [ ] Prove no automatic EvidenceRun dispatch
- [ ] Pass end-to-end HTML, PDF, text, short, long, failure, retry, supersession, and rollback tests
- [ ] Remove old live claim-producer call sites after the controlled cutover
- [ ] Add a static regression gate preventing legacy live imports/calls
- [ ] End with CF1 as the only live selected-claim-package producer
- [ ] Milestone 9B modification summary reviewed by user

## Milestone 10 — ER1 boundary

- [ ] Write and approve the ER1 MCT
- [ ] Finalize ER1 request/status/result contracts
- [ ] Implement package-ID/hash/schema handoff only after approval
- [ ] No queue or automatic dispatch in the first ER1 milestone
- [ ] Modification summary reviewed by user

## Required report for every milestone

- [ ] Files created, modified, and deleted
- [ ] Behavior implemented and deferred
- [ ] Exact test/check results
- [ ] Line counts and explanation for files above 250
- [ ] Network, model, database, and external side effects
- [ ] MCT departures or newly discovered decisions
- [ ] Working-tree status and preservation of earlier work
- [ ] Proposed next milestone without beginning it
