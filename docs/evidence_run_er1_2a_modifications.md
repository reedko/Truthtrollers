# ER1-2A modification summary

**Status:** Mock and live-provider validation complete; awaiting review before source acquisition

## Scope delivered

ER1 now converts its reviewed query-lane plan into bounded provider query requests,
prioritizes exact identity lanes, invokes an injected search adapter, normalizes results
into an ER1-owned candidate contract, deduplicates by layered identity, assigns inspectable
pre-fetch retrieval-promise signals, records progress/timings, and writes review artifacts.

This milestone does not fetch source bodies. It performs no scrape, PDF extraction,
assertion extraction, model call, post-fetch bearing, stance classification, database read
or write, migration, projection, API route, UI work, SourceCrest refresh, or Admiralty refresh.

## Baseline working tree classification

Before ER1-2A, `git status --short`, `git log --oneline -5`, and `git diff --name-only`
were recorded.

1. **Pre-existing tracked changes:** eleven CF1 runtime/prompt files, five CF1 tests,
   `docs/claim_foundry_cf1_mct.md`, and `docs/evidence_run_er1_mct.md`.
2. **Pre-existing untracked work/noise:** the ER1-0/1 module/tests/docs/runner and four CF1
   development scripts. Existing generated artifacts were ignored and not deleted.
3. **ER1-2A intentional changes:** the candidate contract/limits, source identity helpers,
   no-DB local repository boundary, retrieval adapter/coordinator, candidate triage,
   candidate-discovery runner, tests, ER1 docs, and developer command.
4. **New task artifacts:** `artifacts/evidence-run/er1-2a-f01-candidates/` and
   `artifacts/evidence-run/er1-2a-f01-live-candidates/`.

No pre-existing CF1 source or test file was edited by ER1-2A.

## Implementation files

New ER1-2A files:

- `backend/src/evidence-run/sourceIdentity.js`
- `backend/src/evidence-run/localSourceRepository.js`
- `backend/src/evidence-run/retrievalAdapter.js`
- `backend/src/evidence-run/retrievalCoordinator.js`
- `backend/src/evidence-run/candidateTriage.js`
- `backend/src/evidence-run/runCandidateDiscovery.js`
- `backend/src/evidence-run/schemas/candidateSchema.js`
- `backend/test/evidence-run/candidateDiscovery.test.js`
- `scripts/dev/er1_run_candidate_discovery.mjs`

Existing ER1-0/1 files extended: `contract.js`, `ids.js`, request schema/index, contract and
file-size tests, README, MCT, and implementation plan. No dependency or package file changed.
Every handwritten ER1 file remains below 250 lines.

Live-smoke additions are deliberately small: opt-in timing/error diagnostics in
`backend/src/core/evidenceRetrievalGateway.js`, `providerTiming.js`, live runner configuration,
and normalization for provider author fields returned as arrays, objects, or comma/semicolon
delimited strings. The gateway's default array response remains unchanged.

## Reuse boundary

The live adapter wraps only `createEvidenceRetrievalGateway().web()`. Academic identifier
detection reuses the existing offline parser. ER1 does not import the legacy evidence
orchestrator, academic body acquisition, scraper, snippet model scorer, evidence packet
builder, or persistence path.

Pre-fetch scores are named `retrievalPromiseScore` and `preFetchTargetFit`. They allocate
future fetch attention only. Candidate output contains neither `bearingScore` nor `stance`.

## Tests and review run

Focused command:

```bash
cd backend && node --test test/evidence-run/*.test.js
```

Result: **12 passed, 0 failed**.

Combined regression:

```bash
cd backend && node --test test/claim-foundry/*.test.js test/evidence-run/*.test.js
```

Result: **225 passed, 0 failed**.

The F01 review run used mock providers: 22 provider query requests, 23 raw candidates,
23 normalized candidates, 15 globally deduplicated candidates, and 2 promising candidates.
The low promising count reflects intentionally generic mock data, not a live quality result.

The bounded F01 live-provider run completed in **11.2 seconds**: 22 request queries all
returned at least one successful provider call; 65 provider calls were attempted, 62
succeeded, and 3 PubMed calls failed with HTTP 429 responses. It produced 172 raw results,
normalized the first 150 under the global ceiling, merged 47 duplicates into 103 candidates,
and marked 3 as promising. Tavily averaged 590 ms, PubMed 2,694 ms, and OpenAlex 738 ms.

The first live attempt exposed an expected provider-shape gap: PubMed/OpenAlex author lists
were strings rather than arrays. That attempt produced no final artifacts. Candidate
normalization now accepts that shape, and a network-free regression test covers it.
No provider returned an otherwise malformed candidate envelope.

## Review boundary

ER1-2B is not implemented. No candidate is evidence. No candidate has been fetched,
scraped, scored for bearing, assigned stance, persisted, or projected. Reviewer approval is
required before source acquisition or proposition-bearing assessment begins.
