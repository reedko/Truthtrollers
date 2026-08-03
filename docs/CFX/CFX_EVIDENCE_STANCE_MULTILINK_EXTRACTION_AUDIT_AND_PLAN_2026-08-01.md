# CFX Evidence Stance, Multi-Link, and Evidence-Assertion Extraction

Date: 2026-08-01
Status: Proposed implementation plan; no model or retrieval calls authorized by this document

## Executive conclusion

The current Workspace result is not showing a collection of nuanced evidence. It is showing unassessed discovery links as though they were nuance links.

For task `18056`, the current seeded fixture state contains:

- 54 unique discovered reference documents;
- 60 document-to-task-assertion discovery links;
- 60 links persisted as `stance = insufficient` and `source_type = snippet_only`;
- zero accepted `reference_claim_task_links` produced from assertions extracted from acquired evidence text.

Workspace currently maps `insufficient` to `nuance`, so those discovery links appear blue. They should be gray and explicitly mean: **candidate document discovered; substantive bearing not yet established**.

The current CFX implementation also evaluates each document only against the proposition whose query returned it. It does not yet ask whether an acquired document bears on any of the other fixed case assertions. It can create multiple links only when the same URL happens to be independently retrieved for multiple propositions.

The recommended correction is a document-centric bearing stage after acquisition:

1. canonicalize and acquire each document once;
2. preserve every proposition/query that discovered it;
3. present the acquired document and the complete fixed case-assertion inventory to one governed extraction call;
4. extract exact, locally verifiable evidence assertions and classify their relationship separately for every case assertion they bear on;
5. persist one evidence assertion once and link it to one or more task assertions through `reference_claim_task_links`;
6. leave document-level discovery links gray; use colored links only for validated assertion-to-assertion bearing.

This extends the existing CFX acquisition and bearing stages. It does not redesign S0, S1, S2, query planning, or retrieval.

## What is active production code

`POST /api/run-evidence` in `backend/src/routes/evidence/evidence.routes.js` selects the CFX production pipeline by default. The older `runEvidenceEngine` path is entered only when:

```text
CFX_LEGACY_EVIDENCE_ENABLED=true
```

Therefore:

- `backend/src/services/cfxProductionEvidencePipeline.js` is the active production orchestration path;
- `backend/src/core/runEvidenceEngine.js` and `backend/src/core/evidenceEngine.js` are legacy rollback/reference code;
- the legacy code is useful as an implementation audit, but it should not be reactivated or imported wholesale into CFX.

## Current Workspace display defect

### Two different link meanings already exist

The production schema has two distinct relationship levels:

| Table | Meaning | Appropriate display |
|---|---|---|
| `reference_claim_links` | A document was discovered in connection with a task assertion | Gray/dotted until evidence bearing is established |
| `reference_claim_task_links` | An assertion extracted from a reference bears on a particular task assertion | Target-relative support/refute/qualify color |

The code itself describes `reference_claim_links` as document-level dotted lines. `reference_claim_task_links` contains the claim-to-claim AI assessment.

### Why gray links appear blue

`dashboard/src/components/Workspace.tsx` currently narrows the relationship type to:

```text
support | refute | nuance
```

When it maps AI document links, every fallback—including `insufficient`—becomes `nuance`. That is a semantic UI error. `dashboard/src/pages/EvidenceMapPage.tsx` already defines `insufficient` separately with a gray style, proving the UI already has the desired vocabulary elsewhere.

### Required UI rule

- `insufficient`, `unassessed`, `snippet_only`, and discovery-only document relationships render gray/dotted.
- They do not contribute to support, refute, nuance, confidence, or quality totals.
- `nuance` is reserved for a validated evidence assertion that materially qualifies a specific task assertion.
- A document may remain gray at document level while displaying multiple colored assertion-level links underneath it.

## What the legacy evidence engine teaches us

### 1. Search intent is not evidence stance

The repository’s prior stance audit, `docs/evidence-query-stance-analysis.md`, correctly distinguishes query intent from result stance. Search-provider calls receive query strings, not a binding semantic stance. Result stance is assessed later from retrieved content relative to a claim.

CFX should retain this principle:

```text
retrieval lane intent != document stance != evidence-assertion bearing
```

Stance is target-relative. The same document can support one task assertion, challenge another, qualify a third, and fail to bear on the rest.

### 2. The old engine assesses bearing from source text against a target

`backend/src/utils/extractQuote.js` exports:

- `extractQuotesAndScoreQuality`;
- `applyQuantitativeGuardToQuote`;
- `applyEvaluationTargetGuard`.

The old extraction prompt asks for verbatim source passages and classifies them as:

- support;
- refute;
- nuance;
- insufficient.

It also records bearing score, bearing type, the claim component addressed, causal strength, and a bearing explanation. The quantitative and evaluation-target guards then deterministically downgrade material mismatches.

Useful lesson: classify bearing after reading the source, validate exactness locally, and preserve `insufficient` as distinct from `nuance`.

Not recommended: copying the combined legacy quality-and-bearing prompt or its final verdict adjudication. CFX should keep source quality separate from semantic bearing.

### 3. The old engine reuses an acquired URL

`backend/src/core/evidenceEngine.js` keeps a canonical-source cache and single-flight acquisition behavior. `backend/src/core/runEvidenceEngine.js` also maintains `referenceCache`, remembers multiple claim indices for a URL, and groups final results in `evidenceByUrl`.

Useful lesson: a canonical document is a shared run resource. It should be acquired, cleaned, hashed, and persisted once, regardless of how many propositions found it.

Limitation: the legacy loop generally tests a URL against another claim only when that URL also appeared in that claim’s candidate pool. It is not a complete all-claims cross-check.

### 4. The old claim matcher can create multiple target links

`backend/src/core/matchClaims.js` exports `matchClaimsToTaskClaims`. It receives all extracted reference claims and all task claims and may return many reference-claim/task-claim pairs. Stance is relative to each pair.

`backend/src/core/evidenceAssertionPersistence.js` then:

- preserves extracted evidence assertions;
- deduplicates link pairs;
- persists `reference_claim_task_links`;
- scopes each link through `content_relation_id`.

Useful lesson: one extracted reference assertion can legitimately link to more than one task assertion, and one reference document can contain several different evidence assertions.

### 5. The old broad reference extractor is retired

`backend/src/routes/content/content.scrape.routes.js` sets:

```text
LEGACY_REFERENCE_CLAIM_EXTRACTION_RETIRED = true
```

The historical path was:

```text
reference full text
  -> processTaskClaims
  -> extracted reference claims
  -> matchClaimsToTaskClaims against all task claims
  -> reference_claim_task_links
```

This pattern found multi-links, but it also introduced a broad intermediate assertion inventory and an additional semantic matching stage. That is exactly the kind of expansion CFX was created to avoid. We should reuse the relationship model, not resurrect the entire extractor/matcher pipeline.

### 6. Successful work is persisted incrementally

The old engine’s `onSourceProcessed` callback persists completed source/target findings immediately. A later timeout does not erase earlier accepted evidence.

Useful lesson: every acquired document and every provider response must be an independent forensic unit. Validation controls publication, never evidence retention.

## What CFX does today

### Acquisition and binding

`backend/src/services/cfxProductionEvidencePipeline.js`:

1. loads the fixed canonical assertions;
2. plans and executes retrieval per proposition;
3. takes up to five candidates per proposition;
4. creates one `cfx_evidence_acquisition_bindings` row per proposition/candidate;
5. acquires or records the best available text;
6. invokes bearing processing for that one binding.

The existing binding contains one `target_claim_id` and one `proposition_id`. Text versions are children of that target-specific binding. This makes acquisition target-specific even when two bindings resolve to the same document.

### Targeted bearing extraction

`backend/src/claimfoundry/cfx/evidenceBearing/targetedExtraction.ts` is a sound target-document primitive. It:

- receives one immutable target assertion;
- receives one acquired evidence document;
- asks for every explicit assertion in that document that bears on the target;
- classifies `supports`, `challenges`, `qualifies`, or `mixed`;
- requires exact excerpts and source locations;
- validates excerpts and offsets locally;
- does not rewrite the task assertion.

`backend/src/services/cfxEvidenceCoordinator.js::processCfxEvidenceBinding` loads exactly one target and one selected text version, calls that primitive, and persists the forensic request/response/validation record.

`backend/src/services/cfxProductionEvidenceStore.js::persistAcceptedBearingAssertions` persists each accepted evidence assertion and creates its `reference_claim_task_links` row. Current mappings are:

| CFX relationship | Workspace stance |
|---|---|
| `supports` | `support` |
| `challenges` | `refute` |
| `qualifies` | `nuance` |
| `mixed` | `nuance` |

### Current gaps

1. **No evidence extraction has run for task 18056.** The database contains no accepted `reference_claim_task_links` for the fixture.
2. **No cross-claim evaluation.** A source is evaluated only against the proposition that retrieved it.
3. **Acquisition is bound to a proposition.** The same canonical URL may be represented by multiple bindings and text versions.
4. **No document-level semantic reuse.** Acquired text is not automatically considered against the other fixed case assertions.
5. **Discovery is displayed as nuance.** `insufficient` is collapsed into blue `nuance` in Workspace.
6. **Tests cover only one source and one target.** There is no regression proving one document can create links to several task assertions.

### Existing accidental multi-document overlap

The current F03 candidate set does already contain six URLs retrieved under two propositions each. Examples include:

- FDA, “Thimerosal and Vaccines” for P02 and P09;
- CHOP, “Vaccine Ingredients: Thimerosal” for P02 and P09;
- a Senate-hosted birth-cohort document for P03 and P07;
- WHO, “Vaccines and immunization” for P07 and P11;
- CIDRAP, “Aluminum in our diets…” for P08 and P10;
- CHOP, “Vaccine Ingredients: Aluminum” for P08 and P10.

Those pairs show that documents naturally span propositions. They do not prove the current runtime discovers all applicable task assertions; they only reflect retrieval overlap.

## Proposed CFX architecture

### Governing separation

```text
Document discovered
  -> gray document-level relation
  -> acquire canonical text once
  -> evaluate document against fixed case assertions
  -> extract exact evidence assertions
  -> validate locally
  -> persist assertion-to-assertion links
  -> colored target-relative relations
```

Document discovery and evidence bearing must remain separate facts.

### A. Canonical document work item

Before acquisition, group retrieved candidates by canonical URL, DOI, PMID, or other exact identity. Produce one document work item containing:

```json
{
  "runId": "...",
  "referenceContentId": 123,
  "canonicalUrl": "https://...",
  "candidateIds": ["..."],
  "discoveredFor": [
    {
      "propositionId": "P02",
      "targetClaimId": 1002,
      "queryId": "...",
      "provider": "pubmed"
    },
    {
      "propositionId": "P09",
      "targetClaimId": 1009,
      "queryId": "...",
      "provider": "tavily"
    }
  ]
}
```

Acquire and clean that document once. Preserve every discovery path for audit, but do not infer bearing from any path.

### B. Schema adjustment

The current schema places `target_claim_id` and `proposition_id` on `cfx_evidence_acquisition_bindings`, and places text versions under that binding. This prevents clean sharing.

Make acquisition document-scoped and assignments target-scoped. The exact migration should be selected only after a live `SHOW CREATE TABLE` audit, but conceptually it needs:

- one document acquisition record per run and canonical reference;
- one or more discovery/target assignment rows pointing to that document;
- text versions owned by the document acquisition record;
- bearing runs owned by the acquired text version, with their evaluated target set recorded immutably.

Do not overload one target-specific binding with a JSON list and silently change its meaning. Add a scoped migration with explicit foreign keys and uniqueness rules.

Recommended invariants:

- one active acquisition per `(run_id, canonical_document_identity)`;
- one assignment per `(document_acquisition_id, target_claim_id, candidate_id)`;
- one selected text version per document acquisition;
- zero duplicate provider acquisition calls for the same canonical document in one run.

### C. Document-centric, multi-target bearing call

Because a CFX case contains only 12 fixed assertions, the safest completeness design is one governed model call per acquired document containing:

- the acquired document text;
- the immutable inventory of all 12 case assertions and IDs;
- access-level and source metadata;
- no search-lane stance labels;
- no evaluator materials.

The response should be grouped by proposition ID:

```json
{
  "documentId": "...",
  "targets": [
    {
      "propositionId": "P02",
      "noBearingAssertionsFound": false,
      "assertions": [
        {
          "evidenceAssertion": "...",
          "bearingRelation": "supports",
          "exactExcerpt": "...",
          "sourceLocation": {
            "blockId": "E0007",
            "charStart": 812,
            "charEnd": 947
          },
          "whyItBears": "...",
          "limitations": "..."
        }
      ]
    }
  ]
}
```

Rules:

- return exactly one target envelope for each fixed proposition;
- zero or more bearing assertions per target;
- do not create, rewrite, merge, split, broaden, or narrow task assertions;
- do not judge truth;
- do not copy search intent;
- extract only explicit assertions supported by literal document text;
- require exact excerpts;
- permit the same evidence assertion/excerpt to bear on several task assertions;
- classify the relationship independently for every target pair.

This preserves the strength of the current targeted prompt while eliminating 12 calls per document and avoiding a free-floating inventory of hundreds of reference assertions.

If a document cannot fit with all 12 targets within the governed context limit, split only the document into deterministic blocks while keeping the complete target inventory on every block. Merge rows by exact excerpt fingerprint afterward. Do not semantically select which targets are allowed to see a block.

### D. Validation

Validate every returned target and assertion independently:

- proposition ID exists in the frozen case inventory;
- every proposition appears exactly once in the target envelopes;
- task assertion text remains byte-identical outside the provider request;
- exact excerpt occurs in the acquired text;
- block and character offsets resolve exactly;
- no unknown document or target ID;
- relationship is one of the governed values;
- no duplicate row for the same target/excerpt/relation;
- `noBearingAssertionsFound` cannot coexist with assertions;
- quantitative, named-actor, negation, and evaluation-target mismatches produce explicit diagnostics.

Reuse the current CFX exact-excerpt validation. Evaluate whether the small deterministic guards in `backend/src/utils/extractQuote.js` can be extracted behind a CFX adapter with focused tests. Do not import `EvidenceEngine`, `runEvidenceEngine`, adjudication, query generation, or old orchestration.

Validation is per row. One rejected row must not erase accepted rows from the same document response.

### E. Persistence and multi-links

For every unique accepted evidence assertion:

1. persist or reuse one canonical `claims` row with `claim_type = reference`;
2. attach it to the reference document through `content_claims`;
3. preserve its source through `claim_sources`;
4. create one `reference_claim_task_links` row for each task assertion it bears on;
5. attach the same acquired-text and provider-run provenance to every link;
6. deduplicate by the scoped tuple `(content_relation_id, reference_claim_id, task_claim_id)`.

Do not assign a single semantic stance to the whole document. A document’s bearing is a property of each evidence-assertion/task-assertion pair.

Keep the gray `reference_claim_links` discovery row even after colored links exist; it records how the document entered the case. Workspace should visually subordinate or hide that gray line when the user expands validated claim-level links, but must not rewrite it into one document stance.

### F. Access-level policy

Use the existing production scrape/retry/browser-assist state machine and CFX coordinator. Sibling documents continue while one is blocked.

Publication policy:

| Access level | Extraction behavior | Workspace bearing |
|---|---|---|
| Full text | Eligible | Colored after validation |
| Substantial excerpt | Eligible with scope limitation | Colored after validation |
| Abstract | Eligible with abstract-level limitation | Colored after validation |
| Snippet | Provisional extraction only | Gray until upgraded or explicitly shown as provisional |
| Metadata only | No semantic extraction | Gray |
| Unavailable | No semantic extraction | Gray |

This prevents a search snippet from becoming a document-level conclusion.

### G. Source quality remains separate

The multi-target call answers only: **what explicit assertion does this acquired text make, and how does it bear on this fixed case assertion?**

Source quality should be a separate deterministic/metadata and later governed assessment covering matters such as source type, authorship, publication venue, study design, retraction status, access level, and provenance. Quality must not change the extracted stance. Bearing determines relevance; quality determines how much evidentiary weight a relevant item may later receive.

No final verdict aggregation, evidence scoring, or portfolio selection is part of this change.

## Implementation plan

### Phase 0 — Correct the gray state

1. Extend the Workspace relationship type to include `insufficient` or a clearer `unassessed` presentation state.
2. Map discovery-only `reference_claim_links` to gray/dotted.
3. Ensure gray links do not affect stance or confidence totals.
4. Add a UI test proving `insufficient` never renders as `nuance`.

No model, retrieval, acquisition, or persistence change is required for this phase.

### Phase 1 — Canonical document aggregation

1. Add deterministic candidate grouping by canonical URL/DOI/PMID.
2. Preserve all candidate, query, provider, proposition, and target provenance.
3. Add the scoped migration separating document acquisition from target assignments.
4. Acquire and persist each canonical document once per run.
5. Keep the existing production scrape adapter, retry, browser handoff, and terminal outbox.

Stop and run real-MySQL migration and duplicate-acquisition tests before semantic work.

### Phase 2 — Multi-target exact-bearing module

Create an isolated CFX module, adjacent to the current targeted extraction code, containing:

- a governed byte-stable prompt;
- a strict schema;
- request construction;
- immutable target-inventory hashing;
- exact block construction;
- row-level validation;
- forensic response artifacts.

Do not delete the current one-target primitive until the new module passes offline comparison tests. It remains useful for repair/review of one target, but is not the primary document pass.

### Phase 3 — Multi-link persistence

1. Deduplicate accepted evidence assertions within the reference document by exact assertion/excerpt fingerprint.
2. Persist one reference assertion and N target links.
3. Preserve target-relative stance, rationale, exact quote, access level, and extraction provenance for every link.
4. Make publication row-granular: accepted rows publish; rejected rows quarantine with diagnostics.
5. Make reruns idempotent.

### Phase 4 — Workspace integration

Display:

- gray document-discovery relations;
- evidence assertions nested under their source document;
- colored assertion-to-assertion links;
- a visible badge when one document bears on multiple case assertions;
- provisional/snippet and abstract/full-text access distinctions;
- validation and acquisition failure diagnostics without hiding successful siblings.

### Phase 5 — Offline fixture verification

Run deterministic and mocked-provider tests only. Required cases:

1. one document supports one claim, challenges another, and qualifies a third;
2. one exact evidence assertion links to two task assertions;
3. one document contains different assertions for different targets;
4. the same URL retrieved by several propositions is acquired once;
5. off-topic targets produce no colored links;
6. a bad excerpt is quarantined without discarding valid siblings;
7. unknown target IDs are rejected;
8. snippet results stay gray/provisional;
9. discovery-only rows remain gray and score-neutral;
10. task content is never linked as evidence to itself;
11. retries resume exactly the suspended document;
12. repeated runs produce no duplicate claims, acquisitions, or links.

Generate an offline F03 report showing document sharing and multi-link behavior with fixture provider responses. Do not use the sealed semantic key.

### Phase 6 — Governed live authorization

Only after the offline gate passes, prepare an authorization sentence stating:

- exact document count;
- exact maximum model-call count;
- model and transport configuration;
- prompt and schema hashes;
- maximum output tokens, timeout, retries, concurrency, and store setting;
- immutable fixture and case-assertion hashes;
- acquisition/retrieval call limits, if any new acquisition is authorized.

Do not make a live call without that separate authorization.

## Acceptance report

Every governed run should report at least:

| Metric | Required |
|---|---:|
| Unique documents discovered | yes |
| Discovery candidate occurrences | yes |
| Gray/unassessed document links | yes |
| Unique documents acquired | yes |
| Duplicate acquisitions prevented | yes |
| Documents evaluated | yes |
| Provider calls | yes |
| Accepted evidence assertions | yes |
| Rejected evidence rows | yes |
| Task assertions with accepted evidence | yes |
| Documents bearing on 2+ task assertions | yes |
| Support/refute/qualify/mixed distribution | yes |
| Full/excerpt/abstract/snippet distribution | yes |
| Exact-excerpt validation failures | yes |
| Unknown IDs | must be zero |
| Self-reference links | must be zero |
| Lost raw responses | must be zero |

The primary success signal is not the number of blue, red, or green lines. It is:

```text
validated evidence assertions with exact source text
  + correct target-relative links
  + transparent gray state for everything not yet established
```

## Code reuse decision

### Reuse unchanged

- CFX acquisition coordinator and production scrape adapter;
- CFX selected text-version persistence;
- CFX exact evidence-block and excerpt validation;
- `content_relations`, `content_claims`, `claim_sources`, and `reference_claim_task_links` as the production publication model;
- CFX forensic request/response/usage persistence principles.

### Reuse through a small adapter after tests

- canonical URL/single-flight concepts from `EvidenceEngine`;
- exact pair deduplication ideas from `evidenceAssertionPersistence.js`;
- quantitative and evaluation-target guards from `extractQuote.js`;
- the all-task-claims comparison concept from `matchClaims.js`.

### Do not reuse

- legacy `runEvidenceEngine` orchestration;
- broad `processTaskClaims` extraction over every reference;
- the retired scrape-route claim-extraction branch;
- query-intent stance as an evidence judgment;
- final adjudication/verdict aggregation;
- combined source-quality and bearing scoring;
- semantic pruning that decides in host code which case assertions a document is allowed to bear on.

## Recommended next action

Implement Phase 0 first because the current visualization is misleading even before bearing extraction runs. Then implement Phase 1 and stop at the real-MySQL and duplicate-acquisition gate. The first semantic change should not begin until a canonical document can be acquired once and safely associated with every proposition that discovered it.
