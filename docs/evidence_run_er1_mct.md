# EvidenceRun ER1 MCT

**Status:** Draft informed by CF1 development; not approved for implementation
**Product boundary:** Provider-neutral evidence agent consuming immutable CF1 packages
**File rule:** Every handwritten implementation file must be 500 lines or fewer; target 250 or fewer

## 1. Purpose

ER1 turns a verified CF1 claim package into auditable, proposition-bearing evidence.
It must find suitable primary and secondary sources, decide what each source actually
bears upon, preserve contrary and qualifying evidence, and return evidence results
without changing the CF1 package.

VeriStrata is one ER1 consumer. ER1 must not assume a dashboard, browser extension,
live scrape route, or VeriStrata-only content ID at its portable boundary.

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

## 11. Budget and efficiency rules

- Set hard ceilings for provider calls, model calls, fetched documents, tokens, and time.
- Do not enrich or search raw CF1 assertions.
- Resolve shared works once per ER1 run and reuse them across routed targets.
- Batch bearing assessment where order and target identity remain explicit.
- Cache provider results and acquired content by canonical identity.
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
- final verdict aggregation policy beyond preserving bearing evidence.

## 15. Readiness

This document captures the current learned ER1 direction. ER1 implementation is not yet
authorized. ER1-0 must reconcile this draft with the live evidence code and database,
produce exact schemas and comparative fixtures, and receive reviewer approval first.
