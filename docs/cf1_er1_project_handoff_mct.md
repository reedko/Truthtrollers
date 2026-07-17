# VeriStrata CF1 + ER1 Project Handoff MCT

**Status snapshot:** 2026-07-16  
**Repository:** `/Users/reedko/VeriStrata/veristrata-platform`  
**Purpose:** Governing orientation, constraints, actual implementation status, and review checklist for a new agent  
**Naming:** Claim Foundry is `CF1`; EvidenceRun is `ER1`; do not use TM5  
**File rule:** Target 250 handwritten lines or fewer; 500 is the absolute maximum

This document supersedes stale status statements in older plans. It does not replace the
detailed contracts in `claim_foundry_cf1_mct.md` or `evidence_run_er1_mct.md`.

## 1. Product objective

VeriStrata is one consumer of two portable modules:

```text
source content
  -> CF1: selected, evidence-ready claim package
  -> ER1: proposition-bearing evidence result
  -> consumer projection / UI / verdict systems later
```

CF1 replaces the old deterministic/TM4 claim producer. ER1 replaces the old evidence
pipeline only after controlled acceptance. The final architecture must not retain two
competing live claim or evidence paths.

Both modules use the same eventual VeriStrata database and existing content, publisher,
author, provenance, and source infrastructure where useful. Portable module boundaries
must not depend on a VeriStrata `content_id`, dashboard, extension, or live scrape route.

## 2. Governing documents

- CF1 contract and decision history: `docs/claim_foundry_cf1_mct.md`
- CF1 implementation checklist: `docs/claim_foundry_cf1_implementation_checklist.md`
- CF1 9A plan: `docs/claim_foundry_cf1_milestone_9a_plan.md`
- ER1 contract: `docs/evidence_run_er1_mct.md`
- ER1 implementation plan: `docs/evidence_run_er1_implementation_plan.md`
- ER1 milestone summaries: `docs/evidence_run_er1_*_modifications.md`

When old sections conflict with later sections, the later dated/superseding section wins.
This handoff governs current status, scope boundaries, and the next review stop.

## 3. Repository topology

```text
backend/src/
  claim-foundry/        CF1 portable runtime, host processing, verification, persistence
  evidence-run/         ER1 portable runtime under active construction
  routes/claim-foundry/ CF1 API routes
  core/                 shared legacy/platform services used selectively

backend/test/
  claim-foundry/
  evidence-run/

scripts/dev/
  cf1_*.mjs
  er1_*.mjs

docs/
artifacts/
  claim-foundry/
  evidence-run/

dashboard/              VeriStrata web consumer; not CF1/ER1 product boundary
extension/              browser consumer; not CF1/ER1 product boundary
```

Keep CF1 and ER1 parallel and separately understandable. Shared source normalization,
identity, and provenance utilities are acceptable; do not merge the agents into `core/`.

## 4. Working-tree warning

The working tree is intentionally dirty. Do not clean, reset, stash, reorganize, stage, or
commit unless the user explicitly asks.

Current last commit:

```text
77726bc7 feat: add Claim Foundry CF1 pipeline
```

Current tracked modifications include CF1 runtime/tests/docs and
`backend/src/core/evidenceRetrievalGateway.js`. The entire current ER1 module, its tests,
scripts, plans, and modification summaries are untracked. They are valuable work, not
artifact noise. Run these before every milestone and classify changes:

```bash
git status --short
git log --oneline -5
git diff --name-only
```

Never use `git add .`. Preserve unrelated changes.

## 5. CF1 governing outcome

CF1 receives a source-neutral article representation and returns an immutable portable
package containing a concise portfolio of claims that matter to the article's theme and
give ER1 enough guidance to find evidence that supports, refutes, or qualifies them.

Claims must be:

- material to the thesis or concrete theme pillars;
- compelling and understandable in brief form;
- grounded in exact host-owned source units;
- appropriately attributed;
- falsifiable or explicitly classified otherwise;
- accompanied by useful evidence boundaries, source strategies, and identity hints;
- selected for evidentiary usefulness, not because they are easy sample/method facts.

Semantic blocks are a discovery aid, not a separate product. The host decides where
structural blocks are; CF1 decides their argumentative role. Logical-fallacy or reasoning
findings are a future optional layer and must not be mixed into selected claims.

## 6. CF1 current architecture

CF1 is custom prompt/response orchestration with an agent-like host workflow. It does not
use the OpenAI Agents SDK. Existing project OpenAI transport conventions are reused.

Current normal path:

```text
raw HTML / PDF / text
  -> deterministic ArticleDocument
  -> structure-aware source blocks
  -> Call 1: theme, thesis, pillars, compact candidates
  -> host critic, grounding checks, duplicate/polarity/method filters, selection
  -> Call 2: semantic ER1 enrichment for selected claims only
  -> host IDs, excerpts, offsets, identity, queries, targets, cards, package assembly
  -> deterministic verification
  -> at most one bounded repair
  -> immutable package and artifacts
```

The older one-shot structured call remains a baseline/fast-path artifact and must not be
labeled the normal CF1 agent path.

### Model-owned work

- article theme, thesis, and concrete pillars;
- candidate proposition meaning, article role/use, attribution, scope, and materiality;
- selected-claim wording when revision is needed;
- true/refute/qualification conditions;
- compact source strategy, must-match/reject boundaries, concepts, and cautions.

### Host-owned work

- source ingestion, ArticleDocument, blocks, offsets, excerpts, IDs, hashes;
- grounding validation, candidate rejection, dedupe, polarity and method-detail checks;
- theme-to-claim selection gate and pillar coverage;
- named-work detection, validation, IDs, dedupe, and full pool;
- source identity bundles and citation/reference/link provenance;
- query/routing expansion, score transforms, package assembly and verification;
- artifacts, persistence, idempotency, supersession, and rejection.

Call 2 cannot invent or rewrite named works. It may only select bounded IDs from the
host-provided named-work pool. Empty claim-level named-work IDs do not discard the global
pool; ER1 receives it separately.

## 7. CF1 current status

Implemented and tested:

- portable schemas, canonical hashing, verification, budgets, repair, long path;
- explicit agent state, critic, revision, trace, artifacts, and final package;
- API, immutable persistence, shadow adapter, inactive projection infrastructure;
- ArticleDocument for HTML/PDF/text, extensible structure profiles, source blocks;
- host-owned grounding, named works, source identity bundles, citation-aware v3 sidecars;
- compact two-call selected-enrichment path;
- valid compact packages for fixtures F01-F08 with no evidence search.

Not approved/complete:

- fixture-wide blinded comparative adjudication;
- 9A quality/reliability gate judgment;
- full live scrape integration and persisted canonical retry input;
- controlled 9B activation, rollback proof, and retirement of legacy producers;
- automatic ER1 dispatch.

Do not claim CF1 has replaced the live producer. It has not.

## 8. CF1 measurements and artifacts

TM4 F01 comparison baseline:

```text
about 50 seconds
19 raw claims
12 kept claims
about 27,745 tokens
9 chunked model calls
```

Latest compact eight-fixture CF1 run:

```text
16 calls total
98,038 accepted-run tokens
464.4 seconds model time
estimated accepted-run API cost: $0.0217 at recorded 2026-07-15 rates
all eight final packages valid
no repair calls
```

F01 compact result: 19,342 tokens and 84.8 seconds. Provider latency varied materially;
token reduction did not guarantee lower wall time.

Primary review artifact:

```text
artifacts/claim-foundry/agent-runs/eight-fixture-compact-20260715/
  claim-packages-by-fixture.md
```

Fixture-specific examples supplied during review are coding guidance, not frozen required
claims or preconceived expected answers. Ask the user before converting any such example
into a fixture expectation.

## 9. CF1 acceptance gates before live cutover

- [ ] Blind comparison shows useful theme/pillar claim coverage and better ER1 guidance.
- [ ] Provenance, attribution, polarity, identity, and package verification remain valid.
- [ ] Runtime, token, invalid-package, and repair rates are accepted explicitly.
- [ ] Complete canonical ArticleDocument is persisted before async execution.
- [ ] Retry reloads identical canonical input and never uses the 500-character preview.
- [ ] HTML, PDF, text, short, long, failure, retry, supersession, and rollback pass end to end.
- [ ] Every live claim-production entry point is routed through CF1.
- [ ] Silent fallback to the legacy producer is impossible.
- [ ] Legacy producer call sites are removed only after controlled approval.
- [ ] CF1 remains separate from ER1 execution.

## 10. ER1 governing outcome

ER1 consumes an immutable CF1 package by package ID, schema version, and expected hash.
For each selected Phase 3 target, it should find, acquire, and evaluate sources that bear
on the exact proposition while preserving support, refutation, qualification, context,
definitions, and provenance without treating topical relevance as evidence.

An assertion is a proposition extracted from an evidence source with respect to a target.
It is propositionally fungible with a claim but does not automatically become an
evaluation claim. If its content is later evaluated independently, its content-relative
association can acquire claim-evaluation flags.

Standard target: a verified result for about ten claims in under 100 seconds, including
explicit unresolved outcomes rather than fabricated evidence.

## 11. ER1 intended architecture

```text
verify immutable CF1 package
  -> target portfolio and identity registry
  -> deterministic role-diverse query lanes
  -> provider candidate discovery
  -> normalize, dedupe, cheap pre-fetch fit
  -> fair candidate allocation
  -> role/target-diverse acquisition portfolio
  -> ER1-2B source acquisition (not implemented)
  -> target-conditioned source assertion extraction
  -> proposition-level bearing assessment
  -> critic for coverage, balance, drift, source roles, weak evidence
  -> bounded follow-up only for an explicit gap
  -> deterministic verification
  -> immutable ER1 result and later projection
```

CF1 claims are selected for bearing on the article theme. ER1 assertions are extracted
for bearing on a specific selected claim. They may share normalization and grounding
utilities but require different prompts and selection policies.

## 12. ER1 non-negotiable rules

- ER1 never rewrites or reselects the CF1 claims.
- Search raw assertions only after source acquisition and only against selected targets.
- Search local stored sources before and alongside external providers when that phase exists.
- URL is a locator; canonical work identity uses normalized aliases, DOI/PMID/etc., and
  a versioned normalized-text hash.
- Do not scrape a candidate that fails cheap triage and has no plausible target relation.
- Context/provenance candidates cannot become scoring evidence without later bearing proof.
- Discovery roles are not source stances.
- No `bearingScore` or source stance exists before post-acquisition bearing assessment.
- Preserve all target/query/provider route provenance through dedupe.
- Resolve useful global named works selectively; never compare every work to every claim.
- Cap primary-paper clones and same-domain domination.
- Advocacy/provenance sources are labeled preliminarily and cannot masquerade as science.
- Balanced retrieval means seeking useful source roles capable of support, refutation, and
  qualification; never append literal stance-hunting terms to every query.
- Admiralty, SourceCrest, publisher, author, and provenance features must be reused later.
- SourceCrest is presently API/formula driven; agentification is deferred and optional.
- No automatic learned rule activation, social ingestion expansion, or RAG activation now.

## 13. ER1 actual implementation status

### Complete through pre-fetch portfolio planning

- [x] ER1-0 portable contracts and offline fixtures
- [x] ER1-1 immutable package verification, target portfolio, identity registry, query plan
- [x] ER1-2A mock-provider candidate discovery
- [x] ER1-2A live-provider smoke validation
- [x] ER1-2A.1 falsifiability-driven query planner repair
- [x] ER1-2A.2 role terminology and strategy repair
- [x] ER1-2A fair allocation after normalization/dedupe/cheap score
- [x] Soft DSM-IV/IDEA context-to-target routing
- [x] ER1-2A.3 bounded acquisition-portfolio selector

### Not implemented

- [ ] ER1-2B source acquisition
- [ ] body fetch, scrape, PDF extraction, or source-version persistence
- [ ] source assertion extraction
- [ ] proposition bearing, source stance, or evidence links
- [ ] critic/revision/follow-up retrieval loop
- [ ] database reads/writes or migrations for ER1
- [ ] immutable ER1 result persistence or VeriStrata projection
- [ ] API, queue, UI, live route, or automatic dispatch

Do not describe candidate discovery or portfolio selection as evidence evaluation.

## 14. Latest ER1 live and offline results

Fair-allocation live F01 candidate discovery:

```text
29 provider queries
79 provider calls succeeded / 3 failed
232 raw
232 normalized
115 deduplicated
80 cheap-fit allocated
1 old-threshold promising
T001-T008 all survived normalization
DSM-IV and IDEA each: 8 raw -> 8 normalized
```

Artifacts:

```text
artifacts/evidence-run/er1-2a-fair-allocation-live-f01-candidates/
```

Offline ER1-2A.3 portfolio over the same 115 deduplicated candidates:

```text
12 selected for possible acquisition
all T001-T008 covered
all 8 lane families represented
2 primary-paper copies
2 context candidates
11 distinct domains
0 advocacy/provenance candidates selected in this portfolio
```

Artifacts:

```text
artifacts/evidence-run/er1-2a3-f01-candidate-portfolio/
  candidate_portfolio_plan.md
  candidate_portfolio_plan.json
  candidate_quality_review.md
  candidate_quality_review.json
```

The portfolio is a spending plan, not a bearing judgment. Reviewer attention is still
needed for the generic case-control methodology source and the CHOP overview; a more
target-specific regression source may be a better use of acquisition budget.

## 15. ER1-2B authorization gate

ER1-2B remains blocked until the user reviews the 12-source portfolio.

Before authorization:

- [ ] Review all selected titles, roles, planned targets, and selection reasons.
- [ ] Approve or replace generic methodology/context candidates.
- [ ] Confirm primary-copy cap and context allocation.
- [ ] Confirm no target is covered only by primary-paper clones.
- [ ] Confirm acquisition budget, domain caps, deadlines, and failure behavior.
- [ ] Record approval explicitly.

When approved, ER1-2B must remain limited to bounded source acquisition. Do not begin
assertion extraction, bearing, persistence, projection, or UI work in that milestone.

## 16. Current tests and commands

Latest passing results:

```text
ER1 suite: 28 passed, 0 failed
combined CF1 + ER1 suite: 241 passed, 0 failed
```

Run:

```bash
cd backend
node --test test/evidence-run/*.test.js
node --test test/claim-foundry/*.test.js test/evidence-run/*.test.js
```

Reproduce the ER1 portfolio without live calls:

```bash
node scripts/dev/er1_select_candidate_portfolio.mjs \
  --input artifacts/evidence-run/er1-2a-fair-allocation-live-f01-candidates \
  --out artifacts/evidence-run/er1-2a3-f01-candidate-portfolio
```

Do not rerun paid CF1 model calls or live ER1 providers merely to inspect existing output.

## 17. Required working method for the next agent

1. Read this file and the relevant detailed MCT section before acting.
2. Inspect repo status and preserve the dirty tree.
3. State the exact milestone and hard exclusions.
4. Make the smallest understandable module changes; keep files under the line limit.
5. Reuse working platform infrastructure without preserving harmful legacy architecture.
6. Write inspectable JSON plus human-readable Markdown artifacts.
7. Test without live network unless a reviewed milestone explicitly requires it.
8. Report files, behavior, tests, line counts, side effects, departures, and dirty state.
9. Stop for user review after every milestone or requested phase.
10. Never mark a milestone complete without an artifact proving its required behavior.

## 18. Exact next recommendation

Do not write more code first. Review:

```text
artifacts/evidence-run/er1-2a3-f01-candidate-portfolio/candidate_portfolio_plan.md
```

Ask the user to approve the portfolio or identify replacements. After explicit approval,
prepare an ER1-2B implementation prompt limited to:

- acquisition of only portfolio-selected sources;
- existing cache/repository lookup before network fetch;
- canonical URL/identifier/version tracking;
- publisher, author, SourceCrest, Admiralty, and acquisition provenance capture;
- strict fetch/scrape/PDF/time/domain budgets;
- acquisition artifacts and failure diagnostics;
- no assertion extraction, bearing, stance, evidence links, database projection, or UI.

Separately, CF1's next major gate remains 9A comparative review and judgment. Do not let
ER1 progress imply that CF1 live cutover has been approved.
