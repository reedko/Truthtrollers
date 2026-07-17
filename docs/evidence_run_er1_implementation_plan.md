# EvidenceRun ER1 implementation plan

**Status:** ER1-0/1 approved; ER1-2A.1 query repair implemented offline; live rerun pending  
**Governing contract:** `docs/evidence_run_er1_mct.md`  
**Boundary:** Provider-neutral ER1 consuming immutable CF1 packages  
**Module root:** `backend/src/evidence-run/`, a peer of `backend/src/claim-foundry/`  
**File rule:** Keep handwritten modules at or below 250 lines; 500 lines is the absolute maximum

## 1. Outcome

ER1 turns one verified CF1 package into proposition-bearing evidence without rewriting
claims. It must emit useful partial results as they become available instead of making the
consumer wait for the entire evidence portfolio.

Success means:

- exact identifiers and named works are resolved before broad discovery;
- every accepted quotation bears on a specific CF1 target;
- direct, qualifying, contextual, provenance, definitional, and non-bearing material stay distinct;
- contrary evidence is preserved;
- unresolved targets have explicit reasons;
- one authoritative assertion path reaches persistence;
- all provider, fetch, model, token, and time costs are traceable and bounded.

### Claim/assertion symmetry

ER1 calls propositions extracted from evidence sources **assertions**, reserving **claims**
for propositions selected from the content currently under evaluation. They may reuse the
same canonical `claims` rows, but their function is content- and run-relative. Assertion
extraction alone must not set evaluation, verdict, or search eligibility and must not start
recursive evidence work. If the source is later evaluated independently, CF1 selection or
an explicit consumer action may enrich its content association with those evaluation flags.
The assertion-to-target link continues to record its original evidence role and bearing.

## 2. Current repository assessment

Reusable infrastructure already exists:

- `evidenceRetrievalGateway.js` and academic providers;
- `academicContentResolver.js` and existing scrape/content acquisition;
- `anchoredQueryPack.js`, `retrievalContext.js`, and `evidenceNeed.js`;
- deterministic and batched snippet bearing in `snippetBearing.js`;
- candidate allocation in `evidenceCandidateSelector.js`;
- source packet selection in `evidencePacketBuilder.js`;
- direct assertion persistence in `evidenceAssertionPersistence.js`;
- Admiralty evaluation/storage in `services/admiraltyEvaluator.js`, normalized provider
  signals in `providerSignalPersistenceService.js`, and existing SourceCrest/verimeter inputs;
- existing content, relation, publisher, author, and cache persistence;
- existing target links in `evaluation_target_evidence_links` and claim links in
  `reference_claim_task_links` / `reference_claim_links`.

The existing orchestration is not the ER1 runtime:

- `runEvidenceEngine.js` is over 2,000 lines and mixes loading, query construction,
  retrieval, scraping, identity persistence, progress, and output assembly;
- a configuration fork can still select legacy provider-order retrieval;
- `shadow` names obscure which bearing code actually controls selection;
- legacy document links and the later source-claim matcher remain competing paths;
- configuration flags, not one contract, determine whether target-level behavior is active;
- existing routes accept VeriStrata content/claim IDs rather than an immutable package identity.

ER1 will reuse components behind adapters, not copy the legacy orchestrator.

## 3. Latency-first runtime

```text
verify package
  -> build target portfolio and shared identity registry
  -> start exact-ID, named-work, and article-primary lanes concurrently
  -> emit resolved-source and candidate events
  -> run bounded broad discovery only for remaining gaps
  -> deterministic candidate triage and global deduplication
  -> fetch the highest-value source-role slots
  -> emit provisional source progress
  -> extract exact source assertions and assess target bearing
  -> emit accepted evidence immediately per target
  -> host critic identifies missing roles, contrary evidence, or drift
  -> one bounded follow-up retrieval pass when expected value is explicit
  -> verify and persist immutable result
```

Initial engineering gates, measured from ER1 start rather than scrape submission:

- identifier-rich targets: first resolved candidate median at or below 5 seconds;
- identifier-rich targets: first grounded evidence median at or below 20 seconds;
- ordinary targets: first grounded evidence median at or below 30 seconds;
- progress events must not wait for run completion;
- standard eight-claim run: initial global fetch budget 20 documents;
- no model call for ordinary query expansion when CF1 seeds and identity fields suffice;
- at most one critic-authorized follow-up wave;
- every ceiling is configuration with a lower hard architectural maximum.

These are acceptance gates, not provider guarantees. Benchmarks report cold and warm runs
separately and use medians plus ranges.

### Plain-English operating requirements

For the standard profile, ER1 must finish a ten-claim run in less than 100 seconds. This
means returning verified evidence found so far plus honest unresolved outcomes; it does
not mean filling every claim with weak links. ER1 stops starting new retrieval or scrape
work before the deadline so deterministic verification and result writing can finish.

ER1 must:

1. Use each CF1 claim, target, falsifiability boundary, identity bundle, named work, and
   Evidence Need Card to create specific search queries.
2. Search query lanes concurrently across claims and reuse one source when it bears on
   multiple targets.
3. Triage titles, URLs, snippets, provider metadata, identifiers, and source roles before
   scraping. A mercury-engine result for a thimerosal claim should fail because its subject,
   predicate, objects, and evidence role do not match—not because `Mercury outboards` was
   placed on a hardcoded blacklist.
4. Scrape only candidates with a defensible retrieval promise: target overlap, identity
   match, requested source role, useful snippet bearing, or a protected exact identifier,
   named work, primary record, or official-record route.
5. Treat snippet bearing as a scrape-allocation signal, not final evidence. Sparse snippets
   may still pass when exact identifiers or authoritative identity make the source valuable.
6. Never scrape a candidate merely because it shares a broad topic, keyword, publisher,
   or high search rank with the claim.
7. Acquire HTML, PDF, and academic/API content through an adaptive source-acquisition
   state machine. Normal fetch and structured APIs run first; one justified alternate
   extraction strategy may follow when the source is valuable but the first extraction is
   empty, truncated, blocked, or structurally unusable.
8. Narrow acquired content to likely bearing passages before model assessment. Do not send
   entire long documents to a model when deterministic headings, identifiers, terms,
   citations, and passage scoring can produce a bounded candidate set.
9. Use the model to decide what a passage means for the proposition. The host owns exact
   quotations, offsets, document identity, deduplication, and persistence.
10. Persist document-level relationships for acquired sources with their exact status and
    role. A relevant source without an accepted assertion may remain contextual,
    provisional, non-bearing, or unresolved; it cannot silently become scoring evidence.
11. Persist assertion-level links only when an exact source assertion has passed
    proposition-level bearing against a specific CF1 target.
12. Preserve source identity for every acquired source: canonical URL, retrieval route,
    content hash, title, authors, publisher/venue, publication date, identifiers, and the
    provenance and confidence of every identity field.
13. Attach the existing Admiralty evaluation and provider-signal snapshot when available.
    Keep source reliability separate from target bearing; missing enrichment cannot block
    completion, and a weak source may still be useful for provenance or an opposing claim.
    Read cached SourceCrest first; refresh a missing/stale rating concurrently only for a
    likely-used publisher and only when the run budget permits.
14. Preserve contrary and qualifying evidence. Search intent never determines final stance.
15. Deduplicate by canonical source identity while preserving every claim, target, query,
    and named-work route that led to the source.
16. Treat all retrieved source text as untrusted data. Source instructions cannot modify
    ER1 policy, prompts, budgets, target identities, or tool behavior.
17. Emit progress and accepted evidence during the run rather than buffering everything
    until the final ten-claim package is complete.
18. When the request asks for broader evidentiary coverage, reserve portfolio lanes and
    initial budget for role-diverse retrieval. Legacy support/refute/qualify inputs remain
    falsifiability hypotheses only. Final stance remains evidence-derived after acquisition;
    missing roles are reported rather than filled with topical results or false equivalence.

To meet the deadline, ER1 must avoid ten serial mini-pipelines. Search runs concurrently;
triage and bearing use bounded batches; scraping uses global and per-host concurrency;
shared works resolve once; failures have short route-specific timeouts; and the critic may
authorize only one small follow-up wave for named missing evidence roles.

## 4. Portable contracts to freeze in ER1-0

### Request

```json
{
  "packageId": "cf1pkg_...",
  "expectedSchemaVersion": "cf1.claimPackage.v1",
  "expectedPackageHash": "...",
  "idempotencyKey": "consumer-owned-key",
  "options": {
    "profile": "standard",
    "balancePolicy": {
      "mode": "seek_multiple_bearings",
      "desiredBearing": ["support", "refute", "qualify"],
      "minimumIndependentSourcesPerBearing": 1
    }
  }
}
```

### State

`ER1AgentState` owns package identity, target tasks, work identities, query lanes,
candidates, acquired sources, evidence assertions, critic findings, budgets, step trace,
and terminal status. IDs, hashes, offsets, dedupe, budgets, and persistence are host-owned.

### Progressive event

Events include `run_started`, `target_planned`, `identity_resolved`, `candidate_found`,
`source_acquired`, `evidence_accepted`, `target_unresolved`, `run_completed`, and
`run_failed`. Every event carries run ID, sequence, timestamp, package ID, and relevant
target/source IDs.

### Result

The immutable result contains run/package identity, per-target status, resolved works,
accepted evidence assertions, rejected/non-bearing diagnostics, unresolved reasons,
coverage/critic findings, usage, timings, artifact references, result hash, and projection
status. Full JSON schemas are the first ER1-0 deliverable.

## 5. Persistence decision

Use the same database with two dedicated portable tables:

- `evidence_run_er1_runs`: request identity, idempotency, status, budgets, usage, error,
  artifact root, and result ID;
- `evidence_run_er1_results`: immutable result JSON, schema version, result hash, package
  ID/hash, creation time, and optional supersession identity.

Fetched sources continue using existing `content`, content relations, publishers, authors,
and publishing identity tables. A later projection transaction writes accepted assertions
to existing claim/target link tables. The immutable ER1 result is authoritative; projection
rows are consumer views and must be rebuildable.

Source reuse requires explicit identity and version separation. `content_id` remains the
stable internal source identity. Normalized URLs and redirect/canonical aliases provide the
pre-fetch cache lookup; DOI, PMID, PMCID, and similar identifiers consolidate the same work
across different hosts; a content-version hash binds assertions and exact grounding to the
normalized text actually analyzed. ER1 retains usable normalized full text so a new target
can trigger additional assertion extraction without another download. Existing assertions
are retrieval hints; prior bearing is reused only after target and scope compatibility.

ER1-0 must audit whether current tables already represent URL aliases and immutable content
versions before proposing new schema. Do not overload `content.url` as all four identities.
Any smallest migration must preserve existing `content` IDs and remain inert until ER1
activation.

## 6. Module plan

```text
backend/src/evidence-run/
  contract.js                 portable enums and schema versions
  ids.js                      run/result/task/candidate/assertion IDs
  state.js                    ER1AgentState and step/event trace
  packageLoader.js            load and verify CF1 ID/hash/schema/status
  targetPortfolio.js          selected targets and evidence-role slots
  balancePolicy.js            requested bearing lanes, allocation, and gap status
  identityRegistry.js         named-work and source-identity resolution state
  localSourceRepository.js    local URL/identifier/assertion/full-text retrieval adapter
  sourceIdentity.js           URL aliases, work identifiers, and version-hash resolution
  queryPlanner.js             deterministic lanes from CF1 guidance
  retrievalCoordinator.js     provider calls, concurrency, provenance
  candidateTriage.js          target fit, dedupe, role allocation
  sourceAcquisition.js        existing scraper/academic resolver adapter
  passageExtractor.js         bounded passages and exact quote provenance
  bearingEvaluator.js         proposition-level bearing assessment
  sourceQuality.js            provider-neutral rating orchestration and snapshots
  sourceQualityProviders/
    sourceCrestProvider.js    existing API signals plus audited formula adapter
  critic.js                   coverage, balance, drift, and weak-source gaps
  revision.js                 one bounded follow-up plan
  verifier.js                 deterministic result verification
  resultBuilder.js            immutable portable result
  artifacts.js                inspectable JSON and Markdown artifacts
  runEvidenceRun.js           thin runtime coordinator only
backend/src/routes/evidence-run/
  public.routes.js            explicit submit/status/result/events API
  runtime.js                  dependency composition
backend/src/storage/
  evidenceRunStore.js         run lifecycle and idempotency
  evidenceRunResultStore.js   immutable result persistence
  evidenceRunProjection.js    later VeriStrata projection transaction
backend/test/evidence-run/
scripts/dev/er1_run_evidence.mjs
```

Prompt modules, if needed, remain separate and bounded. No runtime file imports UI or live
scrape routes. `runEvidenceRun.js` must remain under 250 lines.

ER1-0 must add a file-size test covering the ER1 module, routes, storage adapters, tests,
and dev runner. Any file above 250 lines requires an explicit split assessment in that
phase's modification summary; no handwritten file may exceed 500 lines.

## 7. Implementation phases and review stops

### ER1-0 — Contracts, fixtures, and baseline

**Implementation status:** Complete for review. Exact schemas and the frozen eight-package
manifest are implemented. No migration was added; database work remains out of scope.

- freeze approved CF1 F01-F08 packages as ER1 inputs without importing old expectations;
- define exact request/state/event/result/error/artifact schemas;
- audit current tables and freeze legacy evidence cost, runtime, and usefulness baselines;
- define source-role, bearing, unresolved, and rejection enums;
- define cold-run latency and budget measurement.

**Review deliverable:** schemas, fixture matrix, baseline report, and smallest migration.

### ER1-1 — Offline loader, portfolio, and trace

**Implementation status:** Complete for review. The F01 offline artifact set is at
`artifacts/evidence-run/er1-01-f01-offline/`. ER1-2 remains blocked.

- load and hash-verify package files without network or DB writes;
- build only selected target tasks and shared identity-resolution tasks;
- produce deterministic query lanes and budget plan;
- write state/trace/plan artifacts.

**Review deliverable:** F01 offline target portfolio and exact generated lanes.

### ER1-2 — Identity fast lane and bounded retrieval

**ER1-2A status:** Candidate discovery is implemented. ER1-2A.1 replaces verbatim CF1 seed
execution with a structured deterministic query compiler. ER1-2A.2 replaces discovery-time
stance labels with role-diverse, falsifiability-driven routes and is complete offline for review.
Bounded provider search, candidate normalization,
global layered deduplication, deterministic retrieval-promise triage, progress trace, and
candidate artifacts are implemented. No source body was fetched. ER1-2B acquisition and
all proposition-bearing work remain blocked.

- compile CF1 seeds as hints alongside falsifiability, target, scope, source-role, and
  bearing-boundary fields;
- translate CF1 falsifiability into evidence-role routes without assigning source stance;
- prohibit literal stance-hunting terms and claim/opposite mixtures in provider queries;
- separate exact identity, context-work, and target-evidence budgets;
- defer generic context phrases before provider execution;
- emit query-quality and before/after diversity diagnostics;

- adapt the academic resolver and retrieval gateway;
- search local URL aliases, identifiers, assertions, and retained full text concurrently
  with external exact-identity resolution;
- reuse an unchanged usable local content version instead of scraping it again;
- resolve DOI, PMID, canonical URL, title/author/year, and named-work identities first;
- run remaining search lanes concurrently with global dedupe and provenance;
- allocate initial candidate/fetch opportunity across requested bearing lanes and targets;
- emit progressive events; fetch nothing outside the reviewed budget.

**Review deliverable:** candidate/identity artifacts, provider timing, and no-bearing-yet proof.

### ER1-3 — Acquisition and proposition bearing

- acquire selected full sources through existing persistence-aware acquisition;
- retain normalized text by version/hash and bind assertion grounding to that version;
- search stored text and extract additional assertions when previous target-conditioned
  extraction does not adequately bear on the current target;
- select bounded passages, then host-resolve exact quotations and offsets;
- assess assertion-to-target bearing and source role;
- attach existing content/publisher Admiralty evaluations and provider-signal provenance
  without performing blocking credibility enrichment in the run's critical path;
- optionally run the existing SourceCrest provider concurrently for likely accepted sources
  when cached evaluation is missing/stale and sufficient budget remains;
- reject merely topical material and preserve contrary/qualifying evidence;
- stream accepted evidence per target.

**Review deliverable:** F01 evidence assertions with exact provenance and rejection audit.

### ER1-4 — Critic and bounded revision

- critic checks missing target coverage, requested source roles, polarity, topical drift,
  overreliance on one source, and missing contrary evidence;
- when balance was requested, distinguish a genuinely missing support/refute/qualify lane
  from a lane populated only by topical, derivative, or non-independent material;
- create a follow-up plan only for an explicit material gap;
- permit one bounded retrieval wave; reverify the complete result.

**Review deliverable:** artifact proving critique changed retrieval or explicitly ended it.

### ER1-5 — Immutable persistence and projection

- add inert run/result migrations and transactional stores;
- persist immutable ER1 result before consumer projection;
- project accepted assertions through one existing authoritative target-link path;
- preserve Admiralty evaluation IDs/snapshots and complete source-to-assertion provenance
  without inventing a second credibility store;
- prove idempotency, retry, supersession, partial failure, and rebuild behavior.

**Review deliverable:** database reconciliation with zero duplicate evidence paths.

### ER1-6 — Explicit API and shadow comparison

- add submit/status/result/event endpoints; no CF1 automatic dispatch;
- run F01/F08, then F03/F06, then all eight fixtures;
- compare usefulness, direct-bearing precision, unresolved rate, first-evidence latency,
  full runtime, fetches, provider calls, model calls, tokens, and cost.

**Review deliverable:** human-readable evidence packages and comparison report.

### ER1-7 — Controlled cutover and retirement

- wire an explicit VeriStrata consumer only after approval;
- shadow against the live path without dual final writes;
- activate one authoritative ER1 result/projection path;
- remove legacy provider-order selection, duplicate post-evidence matching, and misleading
  shadow configuration after acceptance and rollback proof.

**Review deliverable:** cutover map, rollback test, and deletion list.

Each phase ends with a modification summary and waits for reviewer approval before the
next phase begins.

## 8. Acceptance fixtures

Use the eight approved CF1 article packages as input diversity. ER1 review must evaluate
the package actually produced, not impose frozen article-specific evidence conclusions.
Add controlled retrieval fixtures for exact DOI resolution, ambiguous named work,
official record, inaccessible source, metadata-only record, contrary evidence, topical
non-bearing result, duplicate canonical source, URL alias hit, unchanged local full-text
reuse, changed content version, prior non-bearing assertion with a newly bearing passage,
Admiralty-assessed source, unassessed source, low-reliability provenance source, and
unresolved target. Include balanced-retrieval fixtures for support/refute/qualify evidence,
no contrary source found, derivative sources masquerading as independence, and a consensus
case where forced numerical symmetry would create false balance.

The repository interfaces must allow a later vector/RAG adapter to retrieve source,
claim, assertion, and passage candidates. Vector database selection, embeddings, and live
RAG are deferred; semantic similarity never bypasses ER1 triage or bearing verification.

The `sourceQualityProvider` interface must also permit a future agentic publisher-rating
provider without changing ER1 orchestration. The current provider remains the existing
external-API signals plus deterministic SourceCrest formula. A future agent provider must
return evidence-backed observations, citations, uncertainty, policy/model identity, and a
provisional rating distinct from formula-derived or human-confirmed ratings. Its activation
and comparison gates are deferred and require explicit review.

## 9. Smallest safe first milestone

Implement ER1-0 and ER1-1 only: exact schemas plus an offline runner that loads one F01
package, verifies identity, creates target/identity/query plans, and writes artifacts.
It performs no search, scrape, model call, persistence, projection, or live integration.

## 10. Exact next implementation prompt

> Implement ER1-0 and ER1-1 only from `docs/evidence_run_er1_implementation_plan.md`.
> Do not retrieve evidence, call a model, write the database, modify live scrape routes,
> or project evidence. Freeze exact portable schemas, load and verify an immutable CF1
> package, build selected-target and shared-identity tasks, deterministically plan bounded
> query lanes, write inspectable artifacts, add tests, report modifications, and stop for review.
