# CFX Deterministic Snippet Pre-Bearing Selection Proposal

Date: 2026-08-02
Status: **PROPOSED — NOT IMPLEMENTED**
Scope: Restore the bounded candidate-selection gate between CFX retrieval and Phase 2 canonical-document acquisition.
External calls authorized by this document: **none**

## 1. Executive decision proposed

Restore the missing **maximum five promoted evidence documents per case assertion** boundary, but do not restore the old first-five ordering as the final policy.

Use a deterministic, target-relative snippet pre-bearing score to decide which documents occupy those five positions. Preserve the governed query-lane diversity and exact source identities. Provider rank becomes a tie-breaker rather than the primary selection rule.

The deterministic score answers only:

> Does this document title, snippet, or abstract contain literal signals suggesting that the document may bear on this exact assertion?

It must not decide:

- whether the assertion is true or false;
- whether the document supports, refutes, or qualifies the assertion;
- whether the source is authoritative or high quality;
- whether a query's intended purpose is the document's actual stance;
- whether an acquired document ultimately deserves publication as evidence.

Actual evidence bearing remains a document-text operation after acquisition.

## 2. Confirmed regression: what happened to the former top-five selector

### 2.1 It was not deleted

The former bounded selector still exists in:

`backend/scripts/dev/seedCfxWorkspaceFixture.mjs::selectWorkspaceCandidates()`

For each of `P01` through `P12`, it:

1. finds candidates having a discovery path for the proposition;
2. chooses the candidate's earliest proposition-specific discovery path;
3. sorts by `queryId`, then `retrievalRank`, then `candidateId`;
4. takes `.slice(0, 5)`;
5. rejects the fixture seed if a proposition does not have exactly five candidates.

The seeder then creates `content`, `content_relations`, and discovery-link rows only for those selected candidates.

This produced the observed development fixture:

- 12 case assertions;
- 60 assertion-document discovery assignments;
- 54 unique evidence documents after cross-assertion reuse;
- later, one additional production vertical-slice document, producing the currently observed 55 Workspace documents.

### 2.2 The production path routed around it

`backend/src/services/cfxProductionEvidencePipeline.js` does not call `selectWorkspaceCandidates()` and contains no equivalent per-assertion selection step.

The current path:

1. appends every returned provider candidate to `candidateRows`;
2. aggregates all rows into exact canonical documents;
3. persists the full canonical inventory and its discovery assignments;
4. applies a separate global `selectCfxCanonicalDocumentsForRun()` limit;
5. defaults that global execution limit to one document.

The current global selector scores a canonical document using:

- canonical identity kind (`PMID`, `DOI`, canonical URL, or resolved URL);
- number of propositions that discovered it;
- number of queries that discovered it;
- number of providers that returned it;
- presence of a counterevidence or qualification discovery lane.

It does not score the title or snippet against each target assertion.

### 2.3 This contradicts the already-written CFX acquisition requirement

`docs/CFX/CODEX_EVIDENCE_TEXT_ACQUISITION_AND_TARGETED_BEARING_EXTRACTION.md` explicitly says:

- triage title, metadata, and snippet before fetching/model-reading candidates;
- process up to five candidates per fixture assertion;
- preserve diversity across query lanes and providers;
- retain strong primary-source or source-identity candidates;
- use triage only to prioritize acquisition, not as final bearing adjudication.

`docs/CFX/CFX_EVIDENCE_STANCE_MULTILINK_EXTRACTION_AUDIT_AND_PLAN_2026-08-01.md` also describes the then-current behavior as taking up to five candidates per proposition.

The implemented production code no longer matches those descriptions.

### 2.4 Best-supported reconstruction

The top-five selector was **left behind in the development fixture seeder when target-specific acquisition was rewritten as Phase 2 canonical-document aggregation**. It was not consciously removed from its original file. Its behavioral boundary was omitted from the new production path.

Both relevant source files are currently untracked in Git, so repository history cannot identify an author or commit that performed the change. The conclusion above is based on the surviving source, file timestamps, governing documents, generated reports, and current database state—not on unavailable commit history.

## 3. How the pipeline reaches the large candidate pool

### Stage A — CFX S1 meaning discovery

The complete article is read once and twelve burden-of-proof propositions are frozen.

### Stage B — CFX S2 substantive review

Each fixed proposition receives:

- `substantiveAssertion`;
- `assertionSource`;
- `articleStance`;
- `groundingUnitIds`;
- bounded grounding text.

### Stage C — deterministic evidence-search handoff

Literal information is extracted without changing the canonical assertion:

- people and organizations;
- laws and document names;
- acronyms;
- years and date ranges;
- DOI, PMID, URLs, and citation numbers;
- population, exposure, intervention, outcome, geography, and document-type hints;
- literal, source-qualified, and study-lookup queries.

### Stage D — governed query planning

Up to five meaningfully distinct discovery lanes are planned for each assertion:

1. `canonical`;
2. `entity_predicate`;
3. `source_identity`;
4. `independent_evidence`;
5. `counterevidence` or `qualification`.

Query intent is discovery provenance only.

### Stage E — retrieval

Each query can return up to five results. The theoretical ceiling is therefore:

`12 assertions × 5 query lanes × 5 results = 300 assertion-result occurrences`

The recent live attempt produced:

- 48 logical retrieval queries;
- 231 normalized candidate occurrences;
- 169 exact canonical documents.

### Stage F — exact identity aggregation

Results are combined by governed literal identity:

1. PMID;
2. DOI;
3. canonical URL;
4. normalized resolved URL.

No semantic title merging is performed.

### Stage G — missing bounded target-relative promotion

At this point the pipeline should select up to five documents per assertion. The current production implementation skips this step and moves directly to global canonical-document execution selection.

## 4. Problems with the former first-five rule

The former rule was bounded and reproducible, but not evidence-aware.

It could:

- fill all five positions from the lexicographically earliest query lane;
- favor a provider's ordering without checking the assertion predicate;
- retain generic topic pages over a lower-ranked exact study or statement;
- miss useful counterevidence or qualification results;
- mistake repeated allegation language for independent evidence;
- give no auditable explanation beyond query order and retrieval rank.

The old rule is therefore a valuable volume boundary, not a sufficient ranking policy.

## 5. Existing deterministic code suitable for reuse

The repository already contains a tested, pure target-relative scorer:

`backend/src/core/snippetBearing.js::scoreSnippetBearingDeterministic()`

It evaluates title plus snippet/bearing text against a structured evidence need using:

- subject/entity overlap;
- relation or predicate overlap;
- object/outcome overlap;
- scope alignment;
- required literal terms;
- attribution or causal language;
- evidence-target fit;
- topic-only penalty;
- generic-page penalty;
- no-substantive-claim penalty.

Important existing properties:

- deterministic;
- non-mutating;
- no provider call;
- no publisher/domain-authority contribution to bearing;
- returns component-level diagnostics;
- treats snippet scoring as pre-acquisition likelihood rather than final adjudication.

Relevant tests include:

- `backend/test/bearing/snippetBearingDeterministic.test.js`;
- `backend/test/bearing/snippetBearingRobustness54064.test.js`;
- `backend/test/bearing/bearingGating.test.js`;
- `backend/test/bearing/identityBearing.test.js`.

The regression suite already includes William Thompson, CDC, MMR, autism, attribution, topic-only, generic-page, and verified-identity cases.

## 6. Proposed CFX adapter

Add a narrow CFX adapter rather than importing legacy orchestration or the legacy candidate selector.

Conceptual input:

```ts
type CfxSnippetPreBearingInput = {
  propositionId: string;
  substantiveAssertion: string;
  assertionSource: string;
  articleStance: "adopts" | "challenges" | "reports";
  literalIdentifiers: CfxLiteralIdentifiers;
  lookupHints: CfxLookupHints;
  document: CfxCanonicalDocument;
  title: string;
  snippetOrAbstract: string | null;
  discoveryAssignments: CfxDiscoveryAssignment[];
};
```

Conceptual output:

```ts
type CfxSnippetPreBearingResult = {
  propositionId: string;
  documentKey: string;
  score: number;
  confidence: number;
  decision: "likely" | "possible" | "unlikely";
  components: {
    subject: number;
    relation: number;
    object: number;
    scope: number;
    mustInclude: number;
    attributionOrCausal: number;
    targetFit: number;
    topicOnlyPenalty: number;
    genericPagePenalty: number;
    noClaimPenalty: number;
  };
  reasons: string[];
  exactIdentitySignals: string[];
  availableQueryIntents: string[];
};
```

The adapter must map only existing literal CFX data into the scorer:

- `subjectTerms`: named people, organizations, source identity, and literal assertion subjects;
- `relationTerms`: literal predicate/action terms from the immutable assertion and existing lookup hints;
- `objectTerms`: outcomes, exposures, interventions, laws, studies, and literal assertion objects;
- `scopeTerms`: populations, geography, dates, quantities, and date ranges;
- `mustIncludeTerms`: exact PMID/DOI/study/source/name anchors when present;
- attribution indicators: only when the assertion itself is attributional;
- causal indicators: only when the assertion itself contains causal language.

It must not paraphrase the assertion or infer a study identity.

Implementation should either:

1. extract the pure deterministic scorer into a neutral shared module and leave a legacy re-export; or
2. invoke the pure scorer through a narrow adapter with a structural test proving that no legacy engine, agent loop, LLM snippet scorer, or candidate-selection orchestration is imported.

The first option gives the cleaner long-term boundary. The second is the smaller immediate patch.

## 7. Proposed target-relative five-slot allocation

### 7.1 Candidate universe

For each case assertion:

1. collect every exact canonical document having at least one discovery assignment to that assertion;
2. retain all of that document's discovery paths for audit;
3. score the document separately for this assertion using title plus snippet/abstract;
4. never copy a score from one assertion-document pair to another pair.

### 7.2 Structural exclusions

Only structurally invalid candidates may be excluded before scoring:

- no usable URL or literal document identifier;
- the evaluated article itself when it is merely the search target rather than external evidence;
- exact duplicate canonical identity;
- an explicit search-results page or generic portal with no document endpoint;
- an already-resolved wrapper when a verified canonical target for the same literal identity is present.

Low lexical score alone must not permanently erase a candidate from the forensic retrieval artifact.

### 7.3 Protected literal-identity candidates

Documents matching an explicit article or S2 identifier receive protected consideration:

- exact PMID;
- exact DOI;
- exact URL or citation target;
- explicit study title;
- explicit named source or official statement page;
- verified canonical version of an archive/redirect wrapper.

Protection means the candidate cannot be displaced solely by provider rank or generic lexical overlap. It does not mean the document supports the assertion.

### 7.4 Lane-aware slot filling

Maximum: five unique documents per assertion.

First pass:

1. choose the best eligible `canonical` candidate;
2. choose the best eligible `entity_predicate` candidate;
3. choose the best eligible `source_identity` candidate;
4. choose the best eligible `independent_evidence` candidate;
5. choose the best eligible `counterevidence` or `qualification` candidate.

Within each lane, order by:

1. protected exact identity applicable to that lane;
2. deterministic snippet pre-bearing score;
3. deterministic score confidence;
4. presence of substantive title/snippet text;
5. provider retrieval score;
6. provider rank;
7. stable canonical document key.

If one document wins multiple lanes, select it once and retain all of its lane assignments. Backfill the empty slot with the highest remaining target-relative candidate while preferring a still-unrepresented lane or provider.

If fewer than five credible documents exist, return fewer than five. Do not manufacture filler.

### 7.5 Cross-assertion union

After each assertion has at most five selections:

1. union the selected canonical document identities;
2. preserve every selected assertion-document assignment;
3. preserve every discovery path for each selected pair;
4. create one acquisition per canonical document, not one acquisition per assertion;
5. run the later document-centric extraction against the complete immutable target inventory.

Expected bound for the twelve-assertion fixture:

- no more than 60 selected assertion-document pairs before duplicates;
- approximately 40–55 unique canonical documents after cross-assertion reuse;
- one acquisition per unique canonical document;
- no duplicate semantic extraction for the same governed execution identity.

## 8. Persistence and forensic evidence

The following inventories must be distinguished explicitly.

### Raw retrieval inventory

Contains every provider-returned result and response. It is immutable forensic evidence and remains in run artifacts.

### Canonical retrieval inventory

Contains exact-identity aggregation and every discovery path. This may remain a forensic artifact or sidecar inventory. Its size is not a Workspace evidence-document count.

### Promoted candidate inventory

Contains only the at-most-five target-relative selections per assertion after cross-assertion canonical deduplication. These are the documents eligible for Workspace relation creation and acquisition.

### Acquired/evaluated inventory

Contains promoted documents actually processed under the configured execution budget.

Reports and APIs must stop calling the full canonical retrieval inventory simply “candidate documents.” Use explicit names:

- `rawRetrievalOccurrenceCount`;
- `canonicalRetrievalDocumentCount`;
- `promotedAssertionDocumentPairCount`;
- `promotedCanonicalDocumentCount`;
- `acquisitionAttemptedDocumentCount`;
- `acquiredDocumentCount`;
- `bearingEvaluatedDocumentCount`.

## 9. Offline comparison required before production wiring

Use the frozen recent F03 retrieval inventory. Make no model or retrieval calls.

Run three deterministic projections:

1. former first-five selector;
2. current global canonical selector;
3. proposed lane-aware deterministic snippet selector.

Produce, for every assertion:

- all candidate document keys;
- title and bounded snippet;
- query lanes and providers;
- exact identity signals;
- deterministic score and components;
- former-selector position;
- proposed-selector position;
- selected/rejected disposition and reason.

Aggregate report:

- assertion-document pair count;
- unique canonical-document count;
- per-lane representation;
- per-provider representation;
- exact PMID/DOI/source-identity retention;
- topic-only and generic-page displacement;
- overlap with the former 54-document fixture set;
- documents added and removed;
- known useful PubMed/PMC documents retained, including PMC6768751;
- frozen known-good and known-poor PubMed comparison outcomes;
- order-invariance and repeated-run hash.

## 10. Required focused tests

### Boundary and determinism

- never select more than five unique documents per assertion;
- repeated execution is byte-stable;
- input order does not change selection;
- canonical duplicate documents occupy one slot;
- one document may retain multiple assertion and query-lane assignments;
- twelve assertions produce at most sixty selected pairs before cross-assertion dedupe.

### Semantic safety

- canonical `substantiveAssertion` remains byte-identical;
- query intent never becomes stance or bearing;
- deterministic score never publishes support/refute/qualification;
- publisher quality and SourceCrest do not affect pre-bearing likelihood;
- low snippet score does not destroy raw retrieval evidence;
- no outside information or inferred study identity is introduced.

### Selection quality

- exact PMID and DOI candidates survive provider-rank displacement;
- source-identity candidates retain a lane opportunity;
- independent-evidence and qualification/counterevidence lanes remain represented when available;
- topic-only pages rank below predicate/object-bearing snippets;
- generic portals rank below document endpoints;
- empty snippets fall back deterministically without being mislabeled as non-bearing;
- known PMC6768751 path remains available and selected where applicable;
- William Thompson/CDC/MMR regression remains selected over generic vaccine pages.

### Architecture and accounting

- no OpenAI call is made;
- no retrieval call is made during replay;
- no legacy agent, evidence-engine orchestration, semantic selector, or repair loop is imported;
- raw, canonical, promoted, acquired, and evaluated counts are reported separately;
- only promoted documents create new Workspace `content_relations` rows;
- acquisition remains one-per-canonical-document.

## 11. Implementation sequence after approval

1. Freeze the current 169-document run artifacts and the existing 55-document Workspace baseline.
2. Write the CFX-to-deterministic-scorer adapter and focused unit tests.
3. Implement the pure per-assertion scoring projection without persistence.
4. Implement lane-aware five-slot allocation.
5. Generate the three-way offline comparison report.
6. Review known-good retention and known-poor displacement.
7. Only after explicit approval, insert the promoted-candidate boundary between exact aggregation and Phase 2 materialization.
8. Preserve the complete raw retrieval inventory in immutable artifacts.
9. Create Workspace relations and acquisition bindings only for promoted canonical documents.
10. Run offline and disposable-MySQL regression tests.
11. Stop before any live model, retrieval, scrape, or bearing call.

## 12. Acceptance criteria

This proposal is ready for production wiring only when:

- the missing per-assertion gate is restored;
- no assertion receives more than five promoted documents;
- F03 produces no more than sixty assertion-document pairs before dedupe;
- query-lane diversity is measured and preserved;
- literal study/source identities are not lost;
- deterministic scoring is target-relative and auditable;
- provider rank is only a tie-breaker;
- no deterministic result is represented as actual support/refute/qualification;
- raw retrieval evidence remains immutable;
- Workspace receives only promoted documents;
- acquisition and Phase 3 semantic execution remain canonical-document-scoped;
- the offline comparison is reviewed before any paid run.

## 13. Non-goals

This proposal does not authorize:

- another query-planning call;
- another retrieval run;
- scraping or browser-assisted acquisition;
- document-centric semantic extraction;
- source-quality or SourceCrest redesign;
- support/refute/qualification inference from query intent;
- semantic title deduplication;
- final evidence portfolio selection;
- deletion or backfill of existing Workspace evidence rows;
- modification of the immutable S1 or S2 assertions.
