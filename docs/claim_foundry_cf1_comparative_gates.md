# CF1 Comparative Success Gates

Status: Phase 6 planning contract
Comparison: CF1 versus the current deterministic/LLM claim pipeline

## Comparison protocol

The comparison ends at claim-package production. It excludes scraping, EvidenceRun,
evidence retrieval, and evidence scoring. Both producers receive the same frozen
title, author, publisher, URL, and article text. Neither producer may fetch the URL.

For each of the eight fixtures:

1. Run the current pipeline and CF1 three times using pinned model identifiers,
   prompts, configuration, and temperature.
2. Capture full outputs, validation results, model calls, input/output/cached tokens,
   wall-clock duration, failures, and repair use.
3. Normalize only presentation: randomly label outputs A/B, hide producer names,
   and retain provenance references for checking.
4. Have two reviewers independently score each run. A third reviewer adjudicates
   score differences greater than one point and pass/fail disagreements.
5. Report per-fixture values, median across repeats, and aggregate results. Never
   hide failed runs or average them away.

The current pipeline may emit a different structure. A read-only comparison adapter
may expose its selected claims, targets, and provenance to reviewers, but it may not
repair or enrich the baseline. Baseline and CF1 run in the same environment during
the same comparison window. Model/provider errors are reported separately and the
paired run is repeated once.

## Human scoring rubric

Reviewers assign integer scores from 1 to 5 for each dimension:

| Score | Meaning |
|---|---|
| 1 | Harmfully wrong, largely unusable, or central meaning inverted |
| 2 | Major omissions or ambiguity require substantial rewriting |
| 3 | Usable with material edits; central idea is mostly preserved |
| 4 | Strong and directly useful with only minor edits |
| 5 | Excellent: precise, complete, economical, and immediately useful |

Each run receives four dimension scores:

- **Claim usefulness:** selected claims are material, evidence-ready, non-duplicative,
  and useful for supporting or refuting the article's central case.
- **Theme and pillar coverage:** theme/thesis and material pillars are faithfully
  represented; selection is balanced by importance rather than section count.
- **Claim wording:** a reader immediately sees the assertion, its qualifiers and
  attribution, and what kinds of findings would support or refute it.
- **Target quality:** Phase 3 targets and Evidence Need Cards identify a tractable
  proposition, appropriate evidence class, and clear bearing relationship.

A run passes human quality when every dimension is at least 3 and the four-dimension
mean is at least 4.0. CF1 release passes when at least 7 of 8 fixture medians pass,
CF1's aggregate mean is at least 4.0, and no fixture dimension median is below 3.

## Comparative quality gate

CF1 must outperform, not merely restructure, the existing producer:

- CF1's aggregate score must exceed baseline by at least 0.40 points;
- CF1 must equal or exceed baseline on at least 6 of 8 fixtures for each dimension;
- no CF1 fixture/dimension median may trail baseline by more than 0.50 points;
- CF1-F02 must pass author-versus-opponent stance, and CF1-F06 must pass planted
  contradiction versus nuance, regardless of aggregate scores.

These thresholds are release gates, not prompt-tuning objectives. Review comments
and individual scores remain in the artifact so aggregate numbers are auditable.

## Deterministic package gates

Every successfully persisted CF1 package must satisfy all of these:

- schema validation and invariant validation pass;
- every block, raw assertion, consistency finding, selected claim, and target
  reference resolves within the package;
- every selected claim has valid source provenance and at least one Phase 3 target;
- every Phase 3 target has one Evidence Need Card;
- raw assertions produce no projection rows or EvidenceRun handoff targets directly;
- claim and target IDs are unique and package hash verification succeeds;
- F06 identifies the required contradiction and does not flag the planted nuance;
- F07 and F08 are accepted without minimum-count padding.

Any invalid package must be rejected before immutable package persistence. Therefore
the invalid-persisted-package rate is exactly 0%.

## Efficiency gates

Measurements use the existing OpenAI usage-capture concepts: calls, input tokens,
output tokens, cached input tokens, total tokens, model breakdown, and elapsed time.
Non-model deterministic work is included in wall-clock duration.

### Typical articles

F01, F02, F04, F05, F06, F07, and F08 must use:

- one primary semantic model call;
- at most one repair call, and therefore no more than two semantic calls total;
- repair on no more than 10% of successful typical-article runs in the release suite.

Across typical fixtures, CF1 median total tokens must be at most 70% of the paired
current-pipeline median. CF1 median wall-clock duration must not exceed the paired
baseline median; its 95th percentile may not exceed baseline by more than 20%.

### Long article

F03 must use no more than six batch calls, one synthesis call, and one repair call.
It must stay within the token budget defined by the Phase 4 execution contract.
Its total tokens and duration are reported separately; it passes efficiency when
tokens do not exceed the paired baseline and duration is no more than 120% of it.

Provider-side cached tokens are reported but total-token comparison uses provider
reported total tokens, so caching does not conceal prompt size.

## Reliability gates

Across the 24 planned CF1 runs:

- at least 95% must produce a valid package after zero or one repair;
- 100% must terminate within the Phase 4 call ceilings;
- 0% may persist an invalid or partial package;
- any repeated provider-independent failure is a release blocker;
- a post-repair validation failure remains a failed run and is never silently
  converted into a smaller package.

Because 24 runs are a small sample, one failure does not establish a stable rate.
Before live integration, run an additional 100-input shadow corpus: valid-package
rate must be at least 95%, invalid persisted packages must remain zero, and no single
failure mode may exceed 2% without an explicit remediation decision.

## Required comparison artifact

Planned output root:

```text
artifacts/claim-foundry/comparisons/<comparison-run-id>/
```

It contains the frozen configuration, fixture digests, raw producer outputs,
validation reports, usage and timing JSON, blinded score sheets, adjudication notes,
per-fixture summaries, and a final `gate-report.json`. The report lists each gate as
`pass`, `fail`, or `not_measured`; `not_measured` never counts as pass.

No Phase 6 threshold may be weakened after viewing release results without a written
MCT revision and a fresh full comparison run.
