# CF1 Milestone 9A Completion and Live-Cutover Plan

**Status:** Active plan; Phase 9A-4 ready for review
**Current milestone:** 9A — comparison stabilization and completion
**Next major milestone:** 9B — controlled live cutover and legacy-producer retirement

## Outcome

CF1 becomes the only live producer of selected claim packages after it passes the
comparison and cutover gates. Shadow execution is temporary. The completed system
must not retain two live claim-production paths or silently fall back to the old
deterministic/LLM producer.

Evidence gathering and automatic EvidenceRun dispatch remain out of scope.

## Architecture

```text
Raw source
HTML / PDF / pasted text
        |
        v
Deterministic ArticleDocument
canonicalText + atoms + sourceUnits + links + offsets + diagnostics
        |
        v
Deterministic CF1 source blocks
larger readable groups assembled from source structure
        |
        v
Claim Foundry
argument roles + article map + assertions + selected claims + targets + cards
        |
        v
Deterministic package assembly and verification
exact excerpts + offsets + IDs + hashes + persistence
```

The host decides where source boundaries are. CF1 decides what the resulting blocks
mean in the argument. The host, not the model, owns exact excerpts and offsets.

## Ownership and reuse

Existing platform services remain authoritative for source acquisition, browser
capture, HTML/PDF retrieval, publisher/author/title detection, content persistence,
and raw link discovery. CF1 must call or consume those services; it must not copy
them into a parallel scrape stack.

CF1 owns the single claim-production input boundary:

```text
backend/src/claim-foundry/article-document/
backend/src/claim-foundry/source-blocks/
```

Useful TM4 body/sectioning logic may be moved or refactored into that boundary.
There must not be a TM4 implementation and a CF1 copy serving the same purpose.
Vaccine-specific clusters, fixed claim chunks, and deterministic argumentative
labels are not reusable general rules.

All new handwritten files must remain at or below 500 lines and should remain below
250 lines whenever practical.

## Corrected grounding contract

The model must no longer return `sourceExcerpt` or `sourceOffsets`. Before the model
call, the host assigns exact IDs and offsets to addressable source units. The model
returns `sourceUnitIds` and argumentative relationships. The host derives exact
excerpts, block IDs, and offsets from those references.

Selected claims and targets inherit grounding through `sourceRawAssertionIds`.
They do not repeat source quotations. Repair corrects references or interpretation;
it does not repair PDF punctuation or line wrapping.

## Phase 9A-1 — ArticleDocument and grounding contract

Define, without implementation:

- the portable `ArticleDocument` shape;
- atom, source-unit, link, offset, and diagnostic contracts;
- canonical-text assembly and coverage invariants;
- host/model ownership boundaries;
- model-output changes removing exact excerpts;
- compatibility with frozen comparison fixtures.

Exit gate: contract reviewed and approved.

## Phase 9A-2 — Existing-wheel reuse map

Inventory every current HTML, PDF, pasted-text, Readability, body-selection,
reference-extraction, and TM4 sectioning component. For each, decide:

- reuse unchanged;
- refactor into the CF1 input boundary;
- retain as a shared upstream service;
- retire after cutover; or
- reject as article-specific or lossy.

Also record current truncation, link caps, structural-data loss, and PDF-layout
limitations.

Exit gate: reuse/retirement matrix reviewed and approved.

## Phase 9A-3 — ArticleDocument implementation

Implement source-neutral HTML, PDF, and pasted-text adapters without changing live
scrape behavior. Canonical text must be assembled from ordered atoms. Each atom and
source unit must have exact canonical offsets. Links must remain attached to their
containing source units.

Initial callers are tests, fixtures, local tools, and the CF1 comparison adapter.
Live scrape integration is deliberately deferred to 9B.

Exit gate: modification summary plus representative HTML, PDF, and text artifacts.

### Approved 9A-3 amendment

Add an extensible provider-neutral source-family and StructureProfile boundary.
Every ArticleDocument records its adapter and exact reviewed profile identity/hash.
Static reviewed defaults cover article, document, plain text, transcript, social
post, and social thread structure. The additive profile table is inert.

No automatic learning, automatic activation, live scrape lookup, transcript/social
acquisition adapter, or alternative scraper/parser framework is permitted here.

## Phase 9A-4 — Structure-aware source blocks

Replace blank-line-only grouping with deterministic candidate boundaries using:

- HTML `h1`–`h6`;
- paragraph and vertical gaps;
- bold, larger, short, or centered PDF text when layout data exists;
- headings and common document section labels;
- lists, tables, captions, and blockquotes;
- repeated headers and footers;
- link proximity; and
- bounded readable block sizes.

Headings stay with following content. Quotes stay with nearby attribution. Page
breaks alone are not semantic boundaries. Every block retains atom and source-unit
IDs and exact canonical coverage.

Exit gate: block renderings for F01, F03, F05, and F06 reviewed and approved.

## Phase 9A-5 — Host-owned provenance implementation

Change the agent schema and package assembly so raw assertions return
`sourceUnitIds`, while selected claims and targets inherit provenance from raw
assertions. The host derives exact excerpts and offsets. Unknown, ambiguous, or
cross-article references remain blocking errors.

Exit gate: reproduce the F01 provenance failure and show that it is resolved without
accepting changed entities, numbers, qualifiers, or attribution.

## Phase 9A-6 — Prompt/schema/budget reduction

Remove repeated excerpts, deterministic fields, redundant target/card fields, and
unnecessary block annotations from model output. Preserve theme, thesis, pillars,
opponent positions, qualifications, internal consistency, selected claims, targets,
cards, attribution, and scope.

Typical articles continue to use one whole-article primary call and at most one
repair. The long path remains bounded.

Exit gate: exact old/new prompt and schema comparison reviewed before a model run.

## Phase 9A-7 — Deterministic and smoke validation

Run unit, coverage, offset, source-block, provenance, package, and line-count tests,
then smoke-test:

- F08 short factual report;
- F01 PDF-derived study;
- F06 internal contradiction;
- F03 long article.

No invalid package may persist. Every model attempt, response, repair, verifier
result, token count, and terminal error must remain inspectable.

Exit gate: exact results and modification summary reviewed and approved.

## Phase 9A-8 — Full blind comparison

Run the eight frozen fixtures three times per producer with pinned configuration.
Both producers receive the same frozen canonical article content. Raw-source
ArticleDocument tests remain separate so ingestion changes cannot silently alter the
approved comparison corpus.

Capture blinded outputs, human scoring, adjudication, package validity, provenance,
tokens, calls, repairs, duration, and failures.

Exit gate: complete comparison artifact reviewed.

## Phase 9A-9 — Gate judgment

Produce the final quality, comparative, provenance, efficiency, and reliability
report. The result is `pass`, `fail-remediable`, or `fail-architectural`.

Only `pass` permits 9B. Threshold changes require an MCT amendment and a new full
comparison run.

Exit gate: Milestone 9A modification summary approved.

## Milestone 9B — Controlled live cutover

Before activation, inventory every live task-claim entry point, including URL,
extension HTML, PDF blob, raw text, background job, force/retry, existing-content,
and incremental routes.

The complete canonical ArticleDocument must be durable before asynchronous CF1
execution. Retries reload that exact input without re-scraping, and the truncated
`content.details` preview is never treated as an article.

For each entry point prove that it:

- constructs or loads the canonical ArticleDocument;
- invokes CF1 exactly once;
- binds the immutable package to the correct `content_id`;
- projects only selected claims and Phase 3 targets;
- makes the activated CF1 package Workspace-visible;
- keeps raw assertions audit-only;
- does not dispatch EvidenceRun automatically;
- reports CF1 failure without silent legacy fallback; and
- cannot reach the old claim producer after final cutover.

Cutover stages are shadow, controlled activation with an explicit rollback drill,
and final legacy-producer retirement. Parallelism is allowed only during shadow and
controlled evaluation. The final acceptance gate removes old live call sites and
adds a static test preventing their return.

Milestone 9B requires end-to-end HTML, PDF, pasted-text, short, long, failure,
idempotent-retry, supersession, activation, and rollback tests. It is not complete
merely because routes or feature flags exist.

## Milestone 10 boundary

After 9B, ER1 receives its own reviewed MCT. CF1 may expose package ID, package hash,
schema version, selected claims, targets, and Evidence Need Cards, but no queue or
automatic dispatch is introduced before ER1 approval.

## Review rule

Every phase ends with a modification summary covering files, behavior, tests, line
counts, side effects, departures, working-tree preservation, and the next proposed
phase. Work stops for user approval before the next phase begins.
