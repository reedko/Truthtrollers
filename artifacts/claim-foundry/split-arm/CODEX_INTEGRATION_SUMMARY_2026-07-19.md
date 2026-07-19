# What Codex did — split-arm integration review (2026-07-19)

Read-only review by Claude. Suite: 328/328 green. This is a deeper integration than a prompt tweak.

## What Codex built

**1. A single budget policy — `splitClaimBudget.js` (new)**
`deriveSplitClaimBudgets(article)` centralizes every count limit in one place, keyed on article
length. For a **long** article (>=5,000 chars): discovery 10-24, 1B sees <=16, and **final
portfolio min 10 / max 12** — i.e. it hard-wires the "10-12 claims" requirement into the host,
not just prompt wording. Medium (>=2,000) and short articles get scaled-down budgets.

**2. A new pre-1B deterministic selection layer — `splitCandidateSelector.js` (new)**
`selectSplitCandidates` runs *between* 1A and 1B. It takes 1A's broad discovery output, dedups
(same text + same span), drops ungrounded claims, then selects up to the 1B budget by
**coverage-first ranking**: claims that add a *new pillar* or a *new source region* (document
split into thirds) win first, then it fills by materiality -> document order. It emits a
per-claim **selection reason** (`pillar_coverage` / `source_region_coverage` /
`materiality_then_source_order`), a **deferred list** with reasons, and a coverage report. So 1B
now judges a curated, coverage-balanced subset with a full audit trail.

**3. Census-coverage enforcement — `assertCensusOutcomeCoverage` in `splitCensusValidation.js` (new)**
Every census packet must have **exactly one** outcome; missing/duplicate/unknown ->
`CF1_SPLIT_CENSUS_INCOMPLETE` (retryable). This directly targets the **census-zero regression**
(the run where 1B returned 0 outcomes for 60 packets): it would now **fail loudly as a repairable
error** instead of silently producing 60 unresolved recall-misses.

**4. Orchestrator rewiring — `runCall1Split.js`**
`derive budget -> selector -> build packets from selector.selectedClaims -> 1B ->
assertCensusMintConsistency + assertCensusOutcomeCoverage -> finalize with budget's min 10 /
max 12`. Returns `budget` and `selector` in the result.

**5. Report — `splitArmHtml.js`**
Added a "pre-1B deterministic selection" section (selected-with-reasons + deferred) and a 1A
**coverage** line (source-region count, complete/incomplete flag).

**6. 1B prompt — the neutral/context-setting fix (defect 2)**
`splitCall1bSourcePosturePromptV1.js` now says context-setting facts are neutral, and *don't*
mark `contradicts_thesis` just because the source is a criticized authority — the CDC-stat
correction.

## Loose ends flagged (honest)

- **The budget isn't fully propagated to 1A.** `runCall1Split` passes `budget` into
  `buildSplitCall1aPrompt`, but the 1A prompt (unchanged) doesn't consume it, and the 1A
  **schema still caps `maxItems` at 12 with `minItems` 8**. So the budget's `discoveryMaximum:
  24` / `discoveryMinimum: 10` can't actually be realized at discovery — the real lever that
  bites is the **final portfolio floor (10)**, which yields 10-12 *only if 1A emits >=10*. The
  24/16 discovery numbers are currently aspirational.
- **No unit tests for the three new functions.** Suite is 328/328 — but that's the *same count*
  as before; Codex updated the `runCall1Split` integration test (census stubbing) but added no
  dedicated tests for `deriveSplitClaimBudgets`, `selectSplitCandidates`, or
  `assertCensusOutcomeCoverage`. Untested new logic.
- **`claim-foundry-basic/cf0Basic.js`** is unrelated — an unreferenced pre-existing file (from
  the cf0 dev scripts), not part of this integration.

## Net

Codex turned the prompt-level count fix and the census-regression finding into a proper
host-side architecture (central budget + coverage-aware selector + hard census-coverage gate),
but the discovery-stage caps and test coverage haven't caught up to it yet.
