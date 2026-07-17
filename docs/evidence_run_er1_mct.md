# EvidenceRun ER1 MCT

**Status:** ER1-0/1 approved; ER1-2A.2 query repair implemented offline; live rerun pending
**Product boundary:** Provider-neutral evidence agent consuming immutable CF1 packages
**Module root:** `backend/src/evidence-run/`, parallel to `backend/src/claim-foundry/`
**File rule:** Keep handwritten modules at or below 250 lines; 500 lines is the absolute maximum
**Implementation checklist:** `docs/evidence_run_er1_implementation_plan.md`

## 1. Purpose

ER1 turns a verified CF1 claim package into auditable, proposition-bearing evidence.
It must find suitable primary and secondary sources, decide what each source actually
bears upon, preserve contrary and qualifying evidence, and return evidence results
without changing the CF1 package.

VeriStrata is one ER1 consumer. ER1 must not assume a dashboard, browser extension,
live scrape route, or VeriStrata-only content ID at its portable boundary.

### Claim and assertion roles

- A **claim** is a proposition selected from the content currently being evaluated.
- An **assertion** is a proposition extracted from a source acquired as evidence.
- Claims and assertions are propositionally fungible and may reuse the same canonical
  `claims` representation. Their names describe roles in the current evaluation, not
  permanently different kinds of proposition.
- An ER1 assertion does not automatically become an evaluation claim. If its source is
  later independently evaluated, CF1 selection or an explicit consumer action may enrich
  that content relationship with evaluation, verdict, and search eligibility flags.
- Promotion changes the content-relative association and evaluation package; it does not
  create a globally permanent evaluation role for the proposition.

## 2. Governing outcomes

For every eligible CF1 target, ER1 should answer:

- What evidence directly supports, refutes, or qualifies the proposition?
- Is the source authoritative for the specific fact being tested?
- Does the source address the proposition, or merely discuss the same topic?
- Which named studies, reports, laws, datasets, standards, or records should be resolved?
- What remains unresolved, and why?

ER1 succeeds by returning useful bearing evidence, not by filling a fixed number of
links or manufacturing a verdict from weak material.

## 3. Non-negotiable boundaries

- CF1 produces claims and evidence instructions; ER1 does not rewrite or reselect them.
- ER1 loads an immutable package by package ID, schema version, and expected hash.
- Raw assertions and semantic blocks are audit context, not independent search targets.
- ER1 never updates the CF1 package.
- No automatic dispatch, queue, or live-scrape integration before explicit approval.
- Reuse existing acquisition, publisher, author, content persistence, provider, cache,
  bearing, and evidence-link infrastructure where it satisfies this contract.
- Do not preserve competing evidence paths at final cutover. One authoritative result
  must travel from retrieval through bearing assessment to persistence.
- No source is bearing merely because it shares entities, keywords, citations, or topic.
- An unresolved target is an acceptable explicit outcome; invented evidence is not.

## 4. Portable ER1 input

Initial handoff identity:

```json
{
  "packageId": "cf1pkg_...",
  "expectedSchemaVersion": "cf1.claimPackage.v1",
  "expectedPackageHash": "..."
}
```

After hash and status verification, ER1 reads:

- article identity and source metadata;
- `selectedEvaluationClaims`;
- `phase3Targets`;
- `evidenceNeedCards`;
- the complete host-validated `namedWorkPool` / `articleMap.contextWorks`;
- claim-level `relevantNamedWorkIds` and full host-owned `namedWorkHints`;
- only the grounding needed to interpret those selected targets.

## 5. ER1 agent state and control loop

ER1 must maintain explicit state and an inspectable trace. The intended loop is:

```text
load and verify CF1 package
  -> build target portfolio and source-resolution tasks
  -> resolve primary article and useful named works
  -> plan bounded query lanes
  -> retrieve and deduplicate candidates
  -> assess pre-fetch target fit
  -> acquire selected full sources
  -> extract grounded source assertions
  -> assess proposition-level bearing and source role
  -> critic checks coverage, balance, drift, and weak evidence
  -> bounded revision or follow-up retrieval when justified
  -> deterministic verification
  -> persist immutable ER1 result and evidence links
```

Agentic behavior means state changes after criticism. It does not mean unlimited model
calls. Host processing should own IDs, hashes, deduplication, budgets, exact quotations,
offsets, caching, persistence, and contract verification.

## 6. Named-work resolution and selective bearing

ER1 receives the full global named-work pool even when selected claims have empty
`relevantNamedWorkIds`. Empty claim-level IDs mean CF1 did not establish a direct
association; they do not authorize ER1 to discard the work inventory.

ER1 should:

1. Prioritize claim-linked work IDs as strong routing hints.
2. Attempt to resolve other useful global works when they may bear on a selected claim,
   pillar, thesis, source identity, definition, explanation, or opponent provenance.
3. Avoid the Cartesian product: do not compare every work with every claim.
4. Record why a work was routed, deferred, unresolved, or rejected.
5. Require proposition-level bearing before attaching evidence to a selected target.

Required relationship classes:

```text
direct_support
direct_refutation
direct_qualification
contextual_or_corroborating
opponent_or_claim_provenance
definition_or_scope
non_bearing
unresolved_identity
```

The spelling of the final enum may change during contract review, but the distinctions
must survive. Context and provenance must not silently become scoring evidence.

F01 illustrates routing, not frozen fixture expectations:

- the primary F01 article verifies its reported statistical results;
- the Danish cohort and IOM review may bear on the broader MMR-autism thesis;
- Wakefield may establish provenance for the opposing hypothesis;
- DSM-IV and IDEA may support definitions or the proposed 36-month explanation.

## 7. Structured identity hints

ER1 should consume and progressively resolve compact host-owned identity records rather
than repeating free text in every query or target:

```json
{
  "identityId": "WI001",
  "assertionSource": "CDC",
  "workAuthors": ["Frank DeStefano"],
  "namedWorkId": "NW001",
  "workLabel": "Metropolitan Atlanta study",
  "publicationVenue": "Pediatrics",
  "publicationYear": 2004,
  "identifiers": {
    "doi": "10.1542/peds.113.2.259",
    "pmid": null,
    "canonicalUrl": null
  },
  "institutions": ["CDC"],
  "resolutionStatus": "partially_resolved",
  "grounding": {
    "sourceUnitIds": [],
    "citationCallout": null
  }
}
```

Identity roles must remain distinct:

- `assertionSource`: person or organization presented as making the assertion;
- `workAuthors`: authors of the work, kept separate from the assertion source;
- `publicationVenue`: journal, publisher, archive, court, or issuing body;
- `institutions`: affiliations, funders, agencies, or custodians;
- external identifiers: DOI, PMID, registry ID, docket number, ISBN, or canonical URL;
- `namedWorkId`: CF1 package-local handle, not an external identifier.

ER1 may add externally resolved identity fields with provenance. It must never overwrite
the original CF1 mention or claim that an inferred affiliation authored a proposition.

## 8. Query and routing design

Query planning operates per target and source-resolution task. It should combine:

- exact proposition and falsifiability conditions;
- assertion source and author identities;
- work label, venue, year, institutions, citation callout, and identifiers;
- `mustMatch`, useful `shouldMatch`, and `rejectIfOnly` criteria;
- the evidence roles requested by the Evidence Need Card.

The host should deterministically expand exact identifiers and reviewed identity fields.
Model judgment is reserved for semantic query variation, missing-evidence strategy, and
choosing which route can materially change the result.

Identifier resolution should precede broad web search when DOI, PMID, title, author-year,
or a strong citation bundle is available. Metadata-only search results may resolve a
work identity but cannot by themselves support or refute a substantive claim.

## 9. Evidence and bearing contract

Every accepted evidence assertion must retain:

- ER1 run ID, CF1 package ID/hash, selected claim ID, and target ID;
- source content identity and canonical URL;
- source role and resolved work identity when applicable;
- exact quotation with host-derived location/provenance;
- stance: support, refute, qualify, or insufficient;
- bearing class, score/confidence, and concise rationale;
- the claim component addressed;
- source-quality and authority signals kept separate from bearing;
- provisional/full-text status and all rejection or qualification warnings.

Publisher reputation cannot substitute for bearing. A low-reputation source may provide
claim provenance; a prestigious but merely topical paper may still be non-bearing.

### 9.1 Requested evidentiary coverage

The ER1 request may contain the legacy `balancePolicy` vocabulary (`support`, `refute`,
and `qualify`). Those values are falsifiability hypotheses supplied by the consumer, not
known source stances and not provider-query lane types. The discovery planner translates
them into role-diverse routes such as primary result, independent review, reanalysis or
correction, methodology or limitation, subgroup or scope, definition, official/legal
context, and claim provenance.

When broader coverage is requested, ER1 must:

- create distinct evidence-role routes from proposition components and CF1 falsifiability;
- allocate initial retrieval and fetch budget across targets and evidence roles;
- never add stance-hunting words or a claim's logical opposite to manufacture diversity;
- classify final bearing only after source acquisition and proposition assessment;
- keep `qualify` for evidence that materially narrows scope, population, conditions,
  magnitude, certainty, or causal interpretation;
- keep merely topical/contextual material out of the qualifying lane;
- prefer independent sources and avoid counting syndications, citations of one underlying
  study, or publisher-family duplicates as independent corroboration;
- have the critic identify missing requested lanes and permit the one bounded follow-up
  wave to target a specific missing bearing direction;
- report `requested_bearing_not_found` when a lane remains empty rather than relabel weak
  evidence or infer that absence proves the opposite stance.

Role diversity must not become false equivalence. ER1 reports the strength, directness, authority,
and independence of each lane even when the counts look symmetric. A well-supported
consensus and a weak dissenting source remain visibly unequal. User-facing “nuance” maps
to material `qualify` findings; generic contextual relevance does not score as nuance.

### 9.2 Admiralty, SourceCrest, and provenance

ER1 must reuse VeriStrata's existing Admiralty and provenance features rather than create
a competing credibility score. For every acquired or locally reused source, ER1 should:

- load existing content- and publisher-level `admiralty_evaluations` when available;
- preserve the Admiralty source-reliability letter, information-credibility number,
  evaluation status, contributing signals, caps, reasons, and evaluation timestamp;
- reuse publisher identity/enrichment and normalized provider signals, including their
  match confidence and evidence URLs;
- retain the complete retrieval lineage from CF1 target and query lane through provider
  result, requested/final/canonical URL, identity resolution, acquisition method, content
  version/hash, passage, extracted assertion, bearing decision, and persistence IDs;
- distinguish observed metadata, provider-supplied metadata, deterministic inference,
  model extraction, and human-confirmed identity fields, each with provenance/confidence;
- expose the stored Admiralty snapshot and provenance references in the immutable ER1
  result so later SourceCrest/verimeter processing can reproduce its inputs.

Admiralty and bearing remain orthogonal. Admiralty may influence source-role allocation,
corroboration needs, evidence weighting, and warnings, but it cannot turn topical material
into bearing evidence or suppress a low-reliability source needed for provenance, opposing
position, or contradiction analysis. ER1 must not double-count the same publisher/provider
signal as both reliability and independent corroboration. Missing Admiralty enrichment
must not block the standard runtime deadline; ER1 records `not_assessed` and may schedule
separate enrichment through the existing feature boundary.

SourceCrest currently remains the audited deterministic path: call the existing external
signal providers, preserve their responses/provenance, and apply the existing formula. ER1
must place that behavior behind a `sourceQualityProvider` boundary rather than embed the
formula or provider calls in its coordinator. It reads a current cached rating first. For a
publisher likely to contribute accepted evidence, a missing or stale rating may be refreshed
concurrently when budgets and the completion deadline permit. The result records
`assessed`, `pending`, or `not_assessed`; evidence extraction never waits for it.

The same boundary may later support an agentic publisher-assessment provider. Such an agent
must produce an inspectable evidence bundle: resolved publisher identity, claims about the
publisher, exact supporting sources/passages, conflicts, uncertainty, and a provisional
rating with policy version. It must not silently replace the deterministic SourceCrest,
invent reputation facts, use the evidence source's own self-description as independent
corroboration, or share an opaque score with the bearing judgment. Human-confirmed and
formula-derived ratings remain distinguishable from provisional agent assessments.

## 10. Retrieval and persistence rules

- Deduplicate by canonical source identity while preserving every query/target route.
- A source may bear on multiple targets; do not collapse target provenance to one winner.
- Persist already-evaluated bearing assertions directly through one authoritative path.
- Additional full-source extraction may discover new assertions but cannot delete,
  downgrade, or replace stronger directly evaluated evidence.
- Writes must be idempotent and package/run scoped.
- Evidence from a superseded CF1 package remains historical but is not silently reused
  for a new package without an explicit compatibility decision.
- Failed fetches, unresolved works, rejected candidates, and non-bearing sources receive
  bounded diagnostic outcomes instead of disappearing.

### 10.1 Local source repository and document identity

ER1 must search VeriStrata's accumulated source repository before and alongside external
discovery. Local records are candidates, not automatically valid evidence, and enter the
same target-bearing triage as web results.

Document identity has four distinct layers:

- internal `content_id`: stable VeriStrata source identity;
- normalized URL plus URL aliases: fast pre-fetch lookup and redirect/canonical history;
- external work identifiers such as DOI, PMID, PMCID, docket number, or ISBN: consolidation
  across different URLs and repositories;
- content-version hash: identity of the exact normalized text used for assertion grounding.

The URL is a locator, not the permanent unique identity. ER1 normalizes a returned search
URL and checks its aliases before fetching. If a usable current full-text version exists,
ER1 reuses it. Metadata-only, snippet-only, truncated, broken, or policy-stale records may
be reacquired after candidate triage. Fetching records the requested URL, final URL,
declared canonical URL, discovered identifiers, acquisition method, and content hash.

Normalized full text must be retained by version. Assertions bind to the exact version/hash
and grounding from which they were extracted. A later content change does not silently
move old assertions into new text.

Prior extraction is target-conditioned and therefore intentionally incomplete. For a new
target, ER1 first searches existing grounded assertions, then searches the stored full text
and may extract additional target-bearing assertions without downloading the document
again. Prior bearing may be reused only after target equivalence and compatible polarity,
population, scope, time, and definitions are established; otherwise bearing is reassessed.

This identity and version boundary must support a future vector/RAG retrieval adapter over
sources, claims, assertions, and passages. Vector similarity will nominate candidates; it
will never replace exact grounding, source identity, target-specific bearing assessment,
or deterministic verification.

## 11. Budget and efficiency rules

- The standard ten-claim profile must return a verified result in less than 100 seconds,
  including explicit unresolved outcomes for work that cannot finish within the deadline.
- Stop launching new retrieval and scrape work early enough to verify and write the result.
- Set hard ceilings for provider calls, model calls, fetched documents, tokens, and time.
- Do not enrich or search raw CF1 assertions.
- Resolve shared works once per ER1 run and reuse them across routed targets.
- Batch bearing assessment where order and target identity remain explicit.
- Cache provider results and acquired content by canonical identity.
- Reuse cached Admiralty/provider-signal evaluations and record their snapshot identity;
  do not repeat external credibility enrichment inside the critical path when it is stale
  or missing.
- Critic-driven follow-up retrieval must identify the missing role or bearing gap first.
- Never run a second generic claim-matching pipeline over sources already evaluated
  against explicit targets.

## 12. Implementation phases

### ER1-0 — Contract and baseline

- [ ] Audit current evidence entry points, tables, provider calls, and persistence paths.
- [ ] Freeze representative CF1 packages and current evidence-run cost/quality baselines.
- [ ] Finalize ER1 request, run, result, error, and artifact schemas.
- [ ] Finalize named-work identity and bearing enums.
- [ ] Obtain reviewer approval before code implementation.

### ER1-1 — Offline package loader and identity resolver

- [ ] Load and verify immutable CF1 packages by ID/hash/schema.
- [ ] Build the target portfolio and host-owned work-identity registry.
- [ ] Resolve DOI/PMID/canonical identities without running general evidence search.
- [ ] Produce inspectable identity-resolution artifacts and tests.

### ER1-2 — Bounded retrieval and routing

- [ ] Build target-specific and named-work-resolution query plans.
- [ ] Reuse existing provider gateway, acquisition, content, publisher, author, and cache.
- [ ] Preserve all target/query provenance through deduplication.
- [ ] Add hard call, token, fetch, and runtime budgets.

### ER1-3 — Bearing agent and critic loop

- [ ] Extract exact grounded source assertions.
- [ ] Classify direct, contextual, provenance, definitional, non-bearing, and unresolved roles.
- [ ] Critique coverage, polarity, topical drift, source-role gaps, and contrary evidence.
- [ ] Permit only bounded, justified follow-up retrieval.
- [ ] Verify that context/provenance cannot become scoring evidence accidentally.

### ER1-4 — Immutable result and projection

- [ ] Define dedicated ER1 run/result persistence and idempotency.
- [ ] Persist authoritative evidence assertions and target links once.
- [ ] Project into existing VeriStrata evidence structures without parallel final paths.
- [ ] Prove retry, supersession, partial failure, and provenance behavior.

### ER1-5 — Controlled integration

- [ ] Add an explicit ER1 API invocation; no automatic dispatch initially.
- [ ] Compare against frozen baselines for evidence usefulness, bearing precision, cost,
  runtime, unresolved rate, source diversity, and invalid-result rate.
- [ ] Activate only after reviewed fixture and live shadow acceptance.
- [ ] Retire superseded evidence entry and duplicate matching paths after cutover.

## 13. Initial acceptance gates

- Every accepted evidence item addresses a specific selected target or is explicitly
  labeled context/provenance/definition rather than scoring evidence.
- Every global named work receives a recorded routing, resolution, deferral, or rejection
  outcome when it is materially relevant to the portfolio.
- Empty claim-level named-work IDs do not cause useful global works to disappear.
- Identifier-rich tasks use those identifiers before broad discovery queries.
- No every-work-by-every-claim comparison occurs.
- No evidence search targets raw assertions.
- No already-evaluated bearing assertion is lost in a second matching pipeline.
- Costs and runtime are bounded and fully reported.
- Final results are reproducible from the CF1 package identity and ER1 run artifacts.

## 14. Explicitly deferred

- automatic ER1 dispatch from CF1;
- UI changes;
- logical-fallacy/reasoning findings;
- automatic learning or activation of retrieval rules;
- social/transcript-specific retrieval behavior;
- replacing publisher or author persistence;
- vector database selection, embedding generation, and RAG activation;
- agentic SourceCrest replacement or automatic activation of provisional publisher ratings;
- final verdict aggregation policy beyond preserving bearing evidence.

## 15. Readiness

This document captures the current learned ER1 direction. ER1-0 and ER1-1 now provide
portable schemas, frozen CF1 inputs, offline package verification, target/identity planning,
deterministic query lanes, and inspectable artifacts. They perform no retrieval, resolution,
scraping, model, database, or migration work. ER1-2A adds bounded network-capable provider
search and pre-fetch candidate triage only. No source body fetch, assertion extraction,
bearing, stance, database write, migration, or projection is implemented. ER1-2B remains
blocked pending reviewer approval.

### ER1-2A.1 query-planning correction

CF1 query seeds are audit hints, not executable provider queries. ER1 compiles target
queries from the proposition, falsifiability outcomes, must/should/reject boundaries,
source roles/types, scope, and related-claim guidance. Its discovery-time bearing labels
are superseded by ER1-2A.2 below. Exact identity, context-work resolution, and
target-evidence discovery have separate lane classes and budgets. Generic or
underspecified context phrases are deferred without consuming target-evidence budget.

### ER1-2A.2 terminology and strategy correction

Candidate discovery is role-diverse and falsifiability-driven. CF1 `wouldSupportIf`,
`wouldRefuteIf`, and `wouldQualifyIf` select useful evidence roles, but those terms never
become source stance, provider lane types, or literal search instructions. Provider queries
are compiled from proposition anchors, scope, source roles, and evidence roles. Literal
stance-hunting terms and mixed logical opposites are diagnosed as planner errors. Stance
and `bearingScore` remain prohibited before acquisition and post-fetch bearing assessment.
