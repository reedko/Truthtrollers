# F03 split-arm validation run — terminal output + report (2026-07-19)

## Command run (from backend/)

```
node scripts/cf1SplitStage2.mjs --fixture CF1-F03 --repeats 1 --model gpt-4o-mini
```

## Raw terminal output

```
Stage-2 split run split-20260719-083401-1bbe47 · model gpt-4o-mini · fixtures CF1-F03 · 1 repeats each
  CF1-F03 run 1 (seed 3724605090) … FAILED · CF1_SPLIT_CENSUS_INCOMPLETE Every census packet must have exactly one outcome

Done: 0/1 completed.
Report: /Users/reedko/VeriStrata/veristrata-platform/artifacts/claim-foundry/split-arm/split-20260719-083401-1bbe47/report.html
=== TERMINAL EXIT CODE: 0 ===
```

## Pre-run facts confirmed (read-only)

- F03 article length: 51,132 chars (>= 5,000).
- Host budget (>=5,000): `{ discoveryMinimum: 20, discoveryMaximum: 24, call1bCandidateMaximum: 16, finalPortfolioMinimum: 10, finalPortfolioMaximum: 12 }`.
- 1A discovery schema realized: `minItems=20 maxItems=24`.
- 1A prompt renders: `CLAIM BUDGET FOR THIS ARTICLE: return at least 20 and at most 24 candidateClaims.`
- cf1SplitStage2.mjs writes a timestamped dir: `split-YYYYMMDD-HHMMSS-<hash>` with report.html + runs.json.

## Reported answers (8 items)

1. **Exit code / error.** Process exit code **0** (runner writes artifacts even on per-run
   failure). Run-level failure line above. Persisted error:
   `{ code: "CF1_SPLIT_CENSUS_INCOMPLETE", message: "Every census packet must have exactly one outcome" }`.
2. **Output directory.**
   `/Users/reedko/VeriStrata/veristrata-platform/artifacts/claim-foundry/split-arm/split-20260719-083401-1bbe47`
3. **report.html.**
   `/Users/reedko/VeriStrata/veristrata-platform/artifacts/claim-foundry/split-arm/split-20260719-083401-1bbe47/report.html`
   (2,858 bytes — failed-run section only)
4. **Files exist?** Yes — `CF1-F03-run1.json` (237 B) and `runs.json` (415 B) both present.
5. **Raw 1A candidate count.** NOT captured — runCall1Split threw at the post-1B census guard
   before returning; cf1SplitStage2 stores no `result` on a failed run.
6. **Selector coverage / selected-for-1B / deferred.** NOT captured (same reason — lives on the
   discarded `result.selector`).
7. **1B outcome / failure stage.** Both model calls ran (1A returned candidates; 1B returned
   output — the guard `assertCensusOutcomeCoverage(censusItems, call1b.output)` runs AFTER 1B).
   Failure stage = host census-coverage validation, post-1B: 1B's `censusOutcomes` did not
   contain exactly one outcome per census packet. Granular missing ids are in
   `error.details.missing`, but the runner persists only `code`+`message`, not `details`.
8. **Final claim count / unresolved census.** NOT produced — run failed before
   finalizeSplitInventory, so no final inventory and no censusResolution.

## Failure classification

Application exception — Codex's deterministic host guard `CF1_SPLIT_CENSUS_INCOMPLETE`
(`assertCensusOutcomeCoverage`). NOT DNS/network (both calls reached OpenAI; 1B ran), NOT an
OpenAI HTTP/schema rejection (20/24 1A schema accepted, 1A produced candidates, 1B returned
structured output), NOT a timeout, NOT a process kill (clean exit 0).

Meaning: same census-stream weakness as before (gpt-4o-mini not emitting an outcome for every
census packet — likely dozens on a 51k-char article), but the new guard converts the earlier
SILENT "0 outcomes / N unresolved" into a HARD, loud, repairable failure. Guard is working as
designed; the underlying gap is 1B not covering the full census surface.

Artifact-quality note: because the runner drops `result` and `error.details` on failure, a
census-incomplete run shows THAT it failed but not WHICH census ids or the 1A/selector numbers —
this failure mode is currently hard to diagnose from artifacts alone.
