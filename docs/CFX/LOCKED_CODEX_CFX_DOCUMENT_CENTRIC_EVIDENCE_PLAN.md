# LOCKED CODEX EXECUTION PLAN
## CFX Document-Centric Evidence Retrieval, Acquisition, Multi-Assertion Extraction, and Target-Relative Bearing

**Status:** LOCKED for implementation
**Date:** 2026-08-01
**Governing source:** `Pasted markdown(3).md`, amended by the decisions below
**Live calls:** NOT AUTHORIZED until the final governed authorization gate

---

## 0. Locked architectural decision

Implement the production correction described in the reviewed plan.

The governing chain is:

```text
fixed CFX task assertions
→ diverse retrieval queries, including counterevidence-oriented queries
→ gray document discovery
→ canonical acquisition once per document per run
→ acquired document evaluated against the complete fixed assertion inventory
→ zero or more explicit evidence assertions extracted
→ each evidence assertion linked to zero or more task assertions
→ target-relative support, challenge, qualification, or mixed relation
→ colored assertion-level links only after local validation
```

The following distinctions are mandatory:

```text
retrieval-lane intent
!= document discovery
!= acquired document text
!= evidence-side assertion
!= target-relative bearing
!= source quality
!= final verdict
```

Do not restore the legacy evidence engine.
Do not implement one-document/one-assertion behavior.
Do not assign one semantic stance to an entire document.
Do not infer evidence stance from the query lane that found the document.

---

## 1. Locked acceptance requirements

The implementation does not pass unless it proves all of the following:

1. One acquired document may contain several distinct evidence assertions.
2. One evidence assertion may link to several task assertions.
3. One document may support one task assertion, challenge another, qualify another, and not bear on the rest.
4. Every relation is classified independently for the specific evidence-assertion/task-assertion pair.
5. A document found through a counterevidence query is not presumed refuting.
6. A document found through a support-oriented query is not presumed supporting.
7. Merely topical material produces no colored bearing link.
8. Gray document-level discovery remains distinct from colored assertion-level bearing.
9. A rejected evidence row does not erase valid sibling rows from the same document.
10. Search, acquisition, extraction, bearing, source quality, and final adjudication remain separate stages.

These are hard gates, not illustrative examples.

---

## 2. Phase 0: Correct the misleading Workspace state

Implement first.

### Required behavior

- `reference_claim_links` representing discovery-only document relationships render gray/dotted.
- `insufficient`, `unassessed`, `snippet_only`, `metadata_only`, and failed/unresolved discovery states never map to `nuance`.
- Gray discovery links do not contribute to support, refute, nuance, confidence, quality, or verdict totals.
- `nuance` is reserved for a validated evidence assertion that materially qualifies a specific task assertion.
- Colored links are published only from accepted assertion-to-assertion bearing rows.
- A source document may retain a gray discovery line while exposing several colored evidence-assertion links beneath it.

### Required tests

- `insufficient` never renders as `nuance`;
- discovery-only rows remain gray;
- gray rows are score-neutral;
- snippet-only results remain gray/provisional;
- multiple assertion-level links can appear beneath one document;
- document display never collapses several target-relative relations into one document stance.

Stop and report Phase 0 tests before continuing.

---

## 3. Phase 1A: Audit legacy support/refute query generation

Before changing the current CFX query planner, audit how the production and legacy evidence paths attempted to find supporting, refuting, and qualifying evidence.

Inspect at minimum:

```text
docs/evidence-query-stance-analysis.md
backend/src/core/runEvidenceEngine.js
backend/src/core/evidenceEngine.js
backend/src/utils/extractQuote.js
backend/src/core/matchClaims.js
all query-planning helpers reached by those paths
all PubMed-specific query builders
all official-source, rebuttal, criticism, replication, and qualification query helpers
```

Search repository-wide for:

```text
support
refute
counter
counterevidence
challenge
contradict
qualify
nuance
alternative explanation
failed replication
systematic review
meta-analysis
criticism
rebuttal
correction
retraction
official response
methodological limitation
```

### Audit questions

For each legacy query family determine:

- exact input fields used;
- exact query text generated;
- whether it sought support, challenge, qualification, source identity, or primary evidence;
- whether it changed population, intervention, comparison, outcome, timing, mechanism, actor, or causal language;
- whether it merely appended words such as `not`, `debunk`, or `false`;
- whether PubMed syntax was valid and productive;
- whether search intent was later incorrectly treated as evidence stance;
- whether the strategy is reusable without restoring legacy orchestration.

### Deliverable

Create:

```text
artifacts/claim-foundry/cfx/document-centric-bearing/
  legacy-query-strategy-audit.md
  legacy-query-strategy-audit.json
  query-strategy-reuse-decision.md
```

Classify every legacy strategy as:

```text
reuse unchanged
reuse through narrow adapter
adapt concept only
reject as noisy
reject as semantic leakage
unknown pending test
```

Do not reactivate legacy orchestration.

---

## 4. Phase 1B: Lock the retrieval-query policy

After the audit, retain or improve the current CFX query families.

Every task assertion must receive diverse retrieval opportunities, not one generic “related documents” query.

The default families remain:

```text
Q1 canonical assertion formulation
Q2 predicate/entity formulation
Q3 source-identity or primary-document query, only when materially useful
Q4 independent evidence query
Q5 counterevidence / contrary findings / material qualification query
```

Biomedical assertions may route one or more appropriate lanes through PubMed using the tested fielded-query compiler and fallback ladder.

### Counterevidence query requirements

Q5 must seek genuine contrary or qualifying material through claim-specific transformations such as:

- contrary measured outcome;
- failed replication;
- systematic review or meta-analysis;
- alternative mechanism;
- alternative causal explanation;
- population mismatch;
- intervention or exposure mismatch;
- timing mismatch;
- methodological criticism;
- correction, retraction, or official response;
- evidence of absence where the assertion predicts presence;
- primary records that contradict a historical or institutional allegation.

Do not generate counterevidence queries merely by adding:

```text
not
false
debunk
myth
```

unless the underlying query remains precise and useful.

### Query-lane semantics

Persist `queryIntent`, but never publish it as evidence stance.

Allowed query intent labels may include:

```text
canonical
entity_predicate
source_identity
independent_evidence
counterevidence
qualification
primary_source
```

The retrieval result begins semantically as:

```text
candidate document discovered
bearing unassessed
```

### Query verification

Add offline tests showing:

- support-oriented and counterevidence-oriented query families are materially distinct;
- Q5 is claim-specific;
- Q5 does not merely negate the canonical query;
- PubMed counterqueries use valid syntax and fallback;
- query intent does not populate assertion-level stance;
- documents from any lane may later support, challenge, qualify, or fail to bear.

---

## 5. Phase 2: Canonical document aggregation and one-time acquisition

Group retrieved candidates by strongest exact identity:

```text
PMID
→ DOI
→ canonical URL
→ normalized resolved URL
```

Preserve every discovery occurrence:

```ts
type DocumentDiscoveryAssignment = {
  propositionId: string;
  targetClaimId: number;
  candidateId: string;
  queryId: string;
  queryIntent: string;
  provider: string;
  rank: number | null;
};
```

One document may have many discovery assignments.

Discovery assignments do not constrain which task assertions the document may ultimately bear on.

### Required document identity and versioning

Preserve:

- canonical identity;
- reference content ID;
- acquisition timestamp;
- acquired content hash;
- selected text-version ID;
- access level;
- raw browser-response pointer;
- cleaned-text pointer;
- every discovery path.

Use one active acquisition per:

```text
(run_id, canonical_document_identity)
```

Changed content at the same URL creates a new immutable text version.

### Production scraping

Reuse the existing production:

- scrape queue;
- normal retry;
- redirect-safe tab correlation;
- headless-browser route;
- browser-assisted recovery;
- terminal outbox;
- raw response retention;
- cleaned-text retention;
- Workspace signaling.

Do not build a parallel scraping protocol.

Blocked documents suspend only themselves. Sibling documents continue.

### Gate

Before semantic implementation, pass:

- live schema audit;
- real-MySQL migration test;
- signedness and foreign-key verification;
- one-acquisition-per-document test;
- redirect test;
- retry/resume test;
- browser-assisted correlation test;
- changed-content-version test;
- idempotent rerun test;
- no lost discovery provenance.

---

## 6. Phase 3: Document-centric, multi-target evidence extraction

Build an isolated CFX module adjacent to the current one-target targeted extraction primitive.

Retain the one-target primitive for repair and focused review. It is not the primary document pass.

### Governed input

One selected acquired text version plus:

- document ID;
- access level;
- exact evidence blocks;
- the complete immutable inventory of fixed task assertions;
- proposition IDs;
- byte-stable task assertion texts;
- no query-intent stance;
- no source-quality score;
- no final verdict material.

### Governed model task

The model must inspect the document against every fixed task assertion.

It must:

- extract every explicit evidence-side assertion that materially bears on one or more task assertions;
- permit several different evidence assertions from one document;
- permit one evidence assertion to bear on several task assertions;
- classify each evidence-assertion/task-assertion relation independently;
- return no bearing for topical-only overlap;
- use only supplied text;
- preserve exact excerpts;
- avoid truth adjudication;
- avoid rewriting task assertions.

### Strict output shape

Return exactly one target envelope for every fixed proposition:

```json
{
  "documentId": "...",
  "targets": [
    {
      "propositionId": "P01",
      "noBearingAssertionsFound": true,
      "assertions": []
    },
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
          "limitationsVisibleInText": []
        }
      ]
    }
  ]
}
```

Allowed relations:

```text
supports
challenges
qualifies
mixed
```

Do not collapse `mixed` into `qualifies` in the governed result.

### Long-document fallback

If the document plus the complete assertion inventory exceeds context:

- split only the document into deterministic blocks;
- include the full task-assertion inventory with every block;
- never preselect which targets may see a block;
- validate each returned row locally;
- merge by scoped exact-excerpt fingerprint;
- preserve block provenance.

---

## 7. Phase 4: Validation and semantic guards

Validate per row:

- known proposition ID;
- exactly one envelope per fixed proposition;
- immutable task assertion;
- literal exact excerpt;
- resolvable block and offsets;
- valid relation;
- no duplicate scoped row;
- no `noBearingAssertionsFound=true` with assertions;
- no self-reference;
- no unknown document or claim;
- no query-intent leakage.

Evaluate narrow deterministic guards from `extractQuote.js` for:

- quantitative mismatch;
- named-actor mismatch;
- negation mismatch;
- population mismatch;
- intervention/exposure mismatch;
- outcome mismatch;
- timing mismatch;
- evaluation-target mismatch.

Reuse only through a small tested CFX adapter.

Do not import legacy query orchestration, source-quality scoring, broad reference extraction, adjudication, or verdict aggregation.

Validation is row-granular:

```text
accepted rows publish
rejected rows quarantine
valid siblings survive
raw response is retained
```

---

## 8. Phase 5: Persistence and multi-assertion links

For every unique accepted evidence assertion:

1. persist or reuse one canonical evidence-side `claims` row;
2. attach it to the evidence document using the confirmed production provenance table;
3. preserve `claim_sources` where appropriate;
4. create one `reference_claim_task_links` row for every task assertion it bears on;
5. preserve the original governed relation;
6. preserve exact quote, rationale, access level, selected text-version ID, provider-run ID, prompt hash, schema hash, target-inventory hash, and validation state;
7. preserve rejected rows and diagnostics;
8. make reruns idempotent;
9. never overwrite user-verified links.

### Deduplication scope

Do not deduplicate globally by normalized assertion text.

At minimum scope by:

```text
reference_content_id
selected_text_version_id or acquired content hash
exact excerpt fingerprint
normalized evidence assertion
```

The same evidence assertion may generate several target links.

### Compatibility mapping

If production publication still requires:

```text
support | refute | nuance | insufficient
```

map only at the compatibility boundary:

```text
supports   → support
challenges → refute
qualifies  → nuance
mixed      → compatibility value plus preserved governed relation
```

Do not lose the original `mixed` relation.

Do not assign a single stance to the evidence document.

---

## 9. Phase 6: Workspace integration

Display:

- gray discovery-only document relation;
- source document;
- nested evidence assertions;
- one or more colored target-relative links per evidence assertion;
- badge when one document bears on multiple task assertions;
- badge when one evidence assertion bears on multiple task assertions;
- full-text, excerpt, abstract, snippet, metadata-only, or unavailable access state;
- provisional status;
- acquisition and validation diagnostics;
- valid sibling findings when another row fails.

Do not count gray document links in evidence totals.

---

## 10. Phase 7: Hard offline acceptance suite

Use deterministic and mocked-provider tests only.

Required fixtures:

1. one document supports P01, challenges P02, qualifies P03, and does not bear on P04;
2. one exact evidence assertion supports two different task assertions;
3. one document contains three distinct evidence assertions for three targets;
4. one document contains both supporting and challenging evidence for one target and returns `mixed` or properly separated rows;
5. the same URL discovered through support and counterevidence lanes is acquired once;
6. a counterevidence query returns a supporting document and is correctly classified from text;
7. a support-oriented query returns challenging evidence and is correctly classified from text;
8. off-topic documents produce no colored links;
9. one malformed excerpt is rejected without losing valid sibling rows;
10. unknown target IDs are rejected;
11. snippet-only results remain gray/provisional;
12. discovery-only rows remain gray and score-neutral;
13. task content is never linked as evidence to itself;
14. retry resumes only the suspended document;
15. reruns create no duplicate acquisitions, text versions, claims, or links;
16. changed content at the same URL creates a new text version;
17. user-verified links are not overwritten;
18. raw provider responses and acquired text are never lost;
19. query intent never becomes evidence stance;
20. all 12 fixed assertions are evaluated for every acquired document.

These tests are mandatory promotion gates.

Generate an offline F03 report showing:

- query families and query intents;
- support/counterevidence query diversity;
- unique documents discovered;
- duplicate discovery occurrences;
- duplicate acquisitions prevented;
- documents evaluated against all targets;
- evidence assertions extracted per document;
- task assertions linked per evidence assertion;
- documents bearing on two or more task assertions;
- support/challenge/qualify/mixed distribution;
- no-bearing results;
- access-level distribution;
- gray versus colored links;
- row-level validation failures;
- raw-artifact retention.

Do not use the sealed semantic key.

---

## 11. Phase 8: Governed live authorization

No live calls during implementation.

After every offline gate passes, stop and produce a live authorization request containing:

- fixture and task ID;
- exact unique document count;
- exact maximum acquisition calls;
- exact maximum model calls;
- exact model;
- temperature;
- transport;
- timeout;
- retries;
- concurrency;
- output-token ceiling;
- `store` setting;
- prompt hash;
- schema hash;
- task-assertion inventory hash;
- selected text-version hashes;
- query-plan hash;
- estimated token ceiling;
- estimated cost ceiling.

Do not make a live retrieval, acquisition, or bearing call without separate authorization.

---

## Required artifacts

```text
artifacts/claim-foundry/cfx/document-centric-bearing/
  LOCKED_PLAN.md
  implementation-plan.md
  legacy-query-strategy-audit.md
  legacy-query-strategy-audit.json
  query-strategy-reuse-decision.md
  production-table-mapping.md
  schema-diff.md
  migration.sql
  rollback.sql
  phase-0-ui-report.md
  phase-1-query-report.md
  phase-2-acquisition-report.md
  phase-3-bearing-module-report.md
  phase-4-validation-report.md
  phase-5-persistence-report.md
  phase-6-workspace-report.md
  offline-f03-report.html
  offline-f03-report.md
  offline-f03-report.json
  test-accounting.json
  artifact-hashes.json
  unresolved-gates.md
  live-authorization-request.md
```

---

## Stop conditions

Stop and report before proceeding if:

- production schema contradicts the intended claim/evidence/link model;
- an assumed production table is not canonical;
- key signedness or foreign-key types do not match;
- the correct evidence scrape workflow remains unresolved;
- the migration duplicates an active production concept;
- user-verified links could be overwritten;
- all fixed assertions cannot be evaluated per document within the governed context and deterministic document blocking is insufficient;
- `mixed`, `qualifies`, and `insufficient` collapse semantically;
- query intent leaks into evidence stance;
- implementation regresses to one document → one assertion;
- implementation restricts a document to only the assertion whose query found it.

---

## Final report

Report:

1. exact files changed;
2. migrations added but not applied;
3. production tables reused;
4. new tables or companion provenance records introduced;
5. legacy query strategies reused or rejected;
6. legacy code adapted;
7. legacy code explicitly not reused;
8. all commands and tests run;
9. every acceptance-gate result;
10. remaining gates;
11. exact live-call authorization sentence.

Do not reactivate `runEvidenceEngine`.
Do not perform source-quality scoring in this slice.
Do not aggregate a verdict.
Do not drop legacy or `tm4_*` tables.
