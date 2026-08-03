# CFX Meaning-First Build Plan — R0

Date: 2026-07-30
Status: Draft for review
Architecture: CFX Meaning-First ClaimFoundry

## 1. Decision

CFX starts from the article, not from hundreds of extracted assertions.

The first semantic operation receives the complete article and directly
identifies the 12 propositions carrying its burden of proof. Those propositions
become the canonical semantic inventory for the run.

Later stages may attach exact evidence, diagnose defects, or derive narrower
evidence targets. They must not attempt to reconstruct the article's meaning
from a flattened assertion inventory.

The governing rule is:

> Discover meaning while the whole article is visible. Ground and normalize
> afterward.

## 2. Evidence for the architecture

The CF1-F03 baseline used the complete 51,132-character article and the
manifestly simple prompt now frozen at:

`backend/src/claimfoundry/cfx/prompts/burden-of-proof-v1.json`

It completed with:

| Metric | Result |
|---|---:|
| Model requests | 1 |
| Retries | 0 |
| Propositions | 12 |
| Input tokens | 10,651 |
| Output tokens | 737 |
| Latency | 14.07 seconds |
| Schema defects | 0 |

The result recovered a coherent argumentative backbone without chunking,
grouping, centroids, selector passes, agent loops, or meaning reconstruction.

The observed weakness was source precision: only one of the 12 source strings
was an exact article substring. CFX treats this as a grounding problem after
successful semantic discovery, not as evidence that discovery should begin
from hundreds of fragments.

## 3. Fixed discovery prompt

The value of the `prompt` field in the governed prompt file is exactly:

> Read the article.
>
> Return the 12 propositions that carry the burden of proof for the article.
>
> These are the assertions that, if shown false, would most undermine the
> article's overall argument.
>
> For each provide:
>
> - Assertion
> - Assertion source
> - Why it matters to the article's thesis

No hidden rubric, taxonomy, article map, region-disposition system, or
model-authored coverage declaration is added to this discovery instruction.

## 4. CFX module boundary

Create the implementation under:

```text
backend/src/claimfoundry/cfx/
  input/
  discovery/
  grounding/
  evidenceTargets/
  prompts/
  schemas/
  artifacts/
  accounting/
  types/
  runCfx.ts
```

CFX may import only neutral utilities from
`backend/src/claimfoundry/shared/`:

- provider transport;
- article normalization and source-unit projection;
- structured-output parsing;
- token, request, latency, and cost accounting;
- immutable artifact persistence;
- content and manifest hashing;
- shared error types.

CFX must not import:

- CF1 through CF7 orchestration;
- agent or manager loops;
- chunk-harvest pipelines;
- semantic grouping or selector experiments;
- working packages or region dispositions;
- atomicity or repair pipelines;
- prior experiment outputs as runtime inputs;
- EvidenceRun.

A structural import-boundary test will enforce this rule.

## 5. Runtime architecture

### S0 — Freeze the article

The host loads and byte-verifies the complete article.

Persist before any model call:

- exact source fixture;
- fixture hash;
- exact model-visible request;
- prompt value and prompt hash;
- structured-output schema and schema hash;
- provider configuration.

No semantic preprocessing, filtering, chunking, or summarization occurs.

### S1 — Whole-article meaning discovery

Make one structured model request containing:

1. the governed prompt;
2. the complete article text.

Return exactly 12 records:

```json
{
  "propositions": [
    {
      "assertion": "...",
      "assertionSource": "...",
      "whyItMattersToArticleThesis": "..."
    }
  ]
}
```

The 12 returned propositions are persisted unchanged as the canonical semantic
inventory. The raw provider response is immutable evidence and is written
before validation.

Validation at this stage is structural only:

- exactly 12 records;
- required fields are non-empty;
- no unknown fields;
- no duplicate byte-normalized assertions.

Structural failure prevents publication but never deletes the request, raw
response, usage, or diagnostics.

### S2 — Exact grounding

Grounding is a separate operation. It receives:

- the unchanged 12 canonical propositions;
- the complete unit-ID-labelled article.

Its only job is to attach evidence:

```json
{
  "propositionId": "P01",
  "sourceUnitIds": ["U0123", "U0124"],
  "verbatimEvidence": "...",
  "groundingStatus": "grounded"
}
```

The host validates mechanically:

- every unit ID exists;
- units appear in source order;
- the quotation is an exact substring of the cited units;
- every proposition receives a grounding result;
- no proposition text is rewritten.

An ungrounded proposition is quarantined for review. It is not silently
discarded, rewritten, or replaced by a different assertion.

The first experiment should compare two bounded grounding forms:

1. one whole-article grounding call for all 12 propositions;
2. one independent grounding call per proposition.

This comparison concerns citation reliability and cost only. S1 discovery
remains identical.

### S3 — Evidence-target derivation

Only after meaning and grounding are frozen may CFX derive independently
verdictable evidence targets.

This stage may split a proposition when verification genuinely requires
multiple targets, but it must preserve:

- proposition lineage;
- exact grounding;
- attribution;
- polarity;
- modality and certainty;
- the original canonical proposition.

Atomic targets are children of meaning-bearing propositions. They are not
substitutes for them.

### S4 — Review package

Publish a compact human-readable package containing:

- the article thesis;
- the 12 canonical propositions;
- why each proposition matters;
- exact evidence and unit IDs;
- any derived evidence targets;
- all quarantines and validation diagnostics;
- complete request and token accounting;
- artifact hashes.

No agent loop is required for the initial CFX implementation.

## 6. Persistence and observability

Each request receives an immutable directory before validation:

```text
request-001/
  request.json
  request_hash.txt
  raw_response.json
  raw_response_hash.txt
  response_metadata.json
  validation.json
  accepted_rows.json
  rejected_rows.json
  diagnostics.json
```

Validation controls publication, never evidence retention.

Every run also publishes:

- `canonical_propositions.json`;
- `grounding_inventory.json`;
- `evidence_targets.json`, when S3 runs;
- `results_report.md`;
- `run_manifest.json`;
- `artifact_hashes.json`.

## 7. Fast build sequence

### Milestone 1 — Isolated discovery runner

- establish the CFX import boundary;
- load the governed prompt from its frozen file;
- extract the existing whole-article baseline runner into CFX without importing
  CF7;
- persist the exact request and raw response;
- add focused structural and zero-retry tests;
- reproduce the F03 baseline once after authorization.

Stop when one whole-article request reliably publishes 12 unchanged canonical
propositions.

### Milestone 2 — Grounding experiment

- project the article into stable source units deterministically;
- implement the two grounding configurations;
- validate exact quotations and unit IDs;
- compare grounding completeness, precision, token cost, and latency;
- select the simpler reliable configuration.

Stop when all grounding successes and failures are forensically inspectable.

### Milestone 3 — Evidence targets

- derive bounded atomic verification targets only from grounded propositions;
- retain immutable parent lineage;
- add polarity, attribution, and protected-content validation;
- never invalidate or erase the canonical semantic inventory.

### Milestone 4 — Fixture evaluation

- freeze code, prompts, schemas, models, and configurations;
- run a small diverse fixture set;
- open semantic evaluator material only after run artifacts are frozen;
- compare meaning recovery, grounding accuracy, atomicity, cost, and variance.

## 8. Success criteria

CFX succeeds when:

- the complete article is visible during meaning discovery;
- discovery requires one model request;
- exactly 12 canonical propositions are preserved unchanged;
- the propositions capture the article's burden-bearing argument;
- every provider response survives validation failure;
- exact grounding is attached without semantic rewriting;
- grounding failures quarantine evidence links rather than erase propositions;
- evidence targets retain explicit lineage to canonical propositions;
- the implementation has no runtime dependency on CF1–CF7;
- results are reproducible, hashable, and reviewable.

The central evaluation question is not whether CFX can regenerate a large
assertion inventory. It is:

> Did CFX preserve the article's meaning and attach precise, inspectable
> evidence to it?

## 9. Explicit non-goals

The first CFX build will not:

- create hundreds of candidate assertions;
- chunk the article for semantic discovery;
- group assertions to recover themes;
- synthesize semantic centroids;
- run selector tournaments;
- use model-authored coverage declarations;
- add a manager or autonomous repair loop;
- use region dispositions;
- modify production routes or EvidenceRun;
- delete historical implementations or artifacts.

## 10. Review decisions before implementation

Confirm or revise:

1. Keep the architecture name `CFX`.
2. Keep 12 as the fixed discovery count for the first fixture series.
3. Treat S1 propositions as immutable canonical meaning, even when grounding
   later fails.
4. Test both one-call and per-proposition grounding before choosing.
5. Keep atomic evidence targets downstream of grounding.
6. Start with `gpt-4o-mini` for direct comparability to the successful baseline.

Once these decisions are approved, Milestone 1 is small enough to build and
verify immediately.
