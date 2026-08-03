# CFX S2 Exact Grounding Specification

**Document type:** Build specification
**Module:** CFX Meaning-First ClaimFoundry
**Stage:** S2 — Exact Grounding
**Status:** Ready for implementation
**Date:** 2026-07-31

---

## 1. Purpose

S2 attaches exact article evidence to the immutable canonical propositions produced by S1.

S2 is not a second extraction stage.

S2 must not:

- rewrite a proposition;
- improve a proposition;
- narrow or broaden a proposition;
- split or merge propositions;
- replace a proposition with a nearby sentence;
- determine whether the proposition is true in the world;
- infer article meaning again;
- select a different burden-bearing inventory.

Its only semantic task is:

> Find the smallest exact article passage that most directly supports that the article presents the already-fixed proposition.

The governing rule is:

> Ground meaning without changing it.

---

## 2. Inputs

S2 receives:

1. the unchanged canonical propositions from S1;
2. the complete normalized article;
3. stable source-unit IDs;
4. the exact model-visible article-unit projection;
5. the governed grounding prompt;
6. the structured-output schema;
7. provider configuration.

Each canonical proposition has at minimum:

```json
{
  "propositionId": "P01",
  "assertion": "...",
  "assertionSource": "...",
  "whyItMattersToArticleThesis": "..."
}
```

Each article unit has:

```json
{
  "unitId": "U0001",
  "text": "..."
}
```

S2 must treat the S1 proposition text as immutable.

The model must not be asked to return the proposition text.

---

## 3. Required experiment

Implement and compare two bounded grounding configurations.

### Arm A — One whole-article grounding call

One model request receives:

- all 12 immutable propositions;
- the complete unit-ID-labelled article.

The model returns one grounding result for every proposition.

### Arm B — One independent grounding call per proposition

Twelve independent model requests are made.

Each request receives:

- one immutable proposition;
- the complete unit-ID-labelled article.

The model returns one grounding result for that proposition.

### Comparison scope

The experiment compares only:

- citation reliability;
- grounding completeness;
- exactness;
- surplus citation text;
- cost;
- latency;
- parser reliability.

S1 discovery must remain unchanged.

No retrieval prefilter, chunking, lexical shortlist, or semantic search may be introduced into the first comparison.

---

## 4. Grounding statuses

Use this closed enum:

```text
grounded_direct
grounded_distributed
grounded_attributed
partial
ambiguous
unsupported
```

### `grounded_direct`

A single contiguous passage directly supports the proposition as presented in the article.

### `grounded_distributed`

The proposition is supported only by two or more distinct article passages.

Use separate evidence segments. Never concatenate non-contiguous text into a false quotation.

### `grounded_attributed`

The article clearly reports that a person, institution, document, or study made the assertion, but the passage does not independently establish the embedded proposition as fact.

This status is essential for distinguishing:

- “William Thompson said CDC data were manipulated”

from:

- “CDC data were manipulated.”

### `partial`

The article supports only part of the proposition.

The result must state which components are supported and which are not.

### `ambiguous`

More than one materially different grounding interpretation is plausible, and the article does not clearly resolve which one should be used.

### `unsupported`

No adequate passage in the article supports the proposition.

Unsupported propositions remain in the canonical S1 inventory and are quarantined for review.

They must not be deleted, rewritten, or replaced.

---

## 5. Grounding types

Use this closed enum:

```text
direct
distributed
attributed
partial
ambiguous
none
```

Recommended mapping:

| Grounding status | Grounding type |
|---|---|
| grounded_direct | direct |
| grounded_distributed | distributed |
| grounded_attributed | attributed |
| partial | partial |
| ambiguous | ambiguous |
| unsupported | none |

---

## 6. Output schema

S2 returns:

```json
{
  "groundings": [
    {
      "propositionId": "P01",
      "groundingStatus": "grounded_direct",
      "groundingType": "direct",
      "evidenceSegments": [
        {
          "sourceUnitIds": ["U0123", "U0124"],
          "verbatimEvidence": "Exact article text copied without alteration."
        }
      ],
      "supportedComponents": [],
      "unsupportedComponents": [],
      "notes": null
    }
  ]
}
```

### Field rules

#### `propositionId`

- required;
- must match one S1 proposition ID;
- must appear exactly once in whole-article mode.

#### `groundingStatus`

- required;
- closed enum only.

#### `groundingType`

- required;
- closed enum only;
- must be consistent with `groundingStatus`.

#### `evidenceSegments`

- required array;
- zero elements only when status is `unsupported`;
- one element for `grounded_direct` or `grounded_attributed`;
- two or more elements for `grounded_distributed`;
- may contain one or more elements for `partial` or `ambiguous`.

Each evidence segment contains:

```json
{
  "sourceUnitIds": ["U0123", "U0124"],
  "verbatimEvidence": "..."
}
```

#### `supportedComponents`

- required array;
- empty for fully grounded propositions;
- non-empty for `partial`;
- concise descriptions only;
- must not rewrite the canonical proposition.

#### `unsupportedComponents`

- required array;
- empty for fully grounded propositions;
- non-empty for `partial`;
- identifies content not adequately supported by the cited passage.

#### `notes`

- nullable string;
- brief diagnostic only;
- no replacement proposition;
- no external truth judgment.

### Explicitly prohibited output fields

The model must not return:

- `assertion`;
- `rewrittenAssertion`;
- `correctedAssertion`;
- `replacementAssertion`;
- `confidence`;
- `truthVerdict`;
- `articleThesis`;
- `newPropositionId`.

This closes the main mutation channels.

---

## 7. Governed grounding prompt

Create a frozen prompt file:

```text
backend/src/claimfoundry/cfx/prompts/exact-grounding-v1.json
```

Recommended prompt value:

> You are grounding already-fixed propositions in an article.
>
> Do not rewrite, improve, narrow, broaden, split, merge, or replace any proposition.
>
> For each proposition, find the smallest exact passage in the article that most directly supports that the article presents the proposition.
>
> Return only grounding results.
>
> Rules:
>
> 1. `verbatimEvidence` must be copied exactly from the cited source units.
> 2. Use the fewest source units needed.
> 3. Preserve attribution. If the article only reports that a person, institution, document, or study made the assertion, classify the grounding as attributed.
> 4. Do not use external knowledge.
> 5. Do not treat thematic similarity as grounding.
> 6. If only part of the proposition is supported, classify it as partial and identify supported and unsupported components.
> 7. If multiple materially different interpretations remain, classify it as ambiguous.
> 8. If no adequate passage exists, classify it as unsupported.
> 9. Do not return proposition text.

The prompt file must contain:

```json
{
  "schemaVersion": "cfx.prompt.v1",
  "promptId": "exact-grounding-v1",
  "prompt": "..."
}
```

Persist and hash the exact prompt used for every run.

---

## 8. Host validation

The host validates mechanically after every model response.

### Proposition coverage

- every expected proposition ID appears;
- no unexpected proposition ID appears;
- no proposition ID appears more than once;
- whole-article mode returns exactly 12 results;
- per-proposition mode returns exactly one result.

### Unit integrity

- every cited unit ID exists;
- unit IDs are in article source order;
- unit IDs within one evidence segment are contiguous;
- non-contiguous evidence must use separate segments;
- duplicate unit IDs within one segment are rejected.

### Verbatim integrity

For every evidence segment:

- `verbatimEvidence` is non-empty;
- it is an exact substring of the concatenated cited unit texts;
- punctuation, capitalization, spacing, and quotation marks are preserved;
- no ellipsis is inserted unless the ellipsis exists in the article;
- no text from separate segments is fused into one quotation.

### Status consistency

- `unsupported` has zero evidence segments and `groundingType = none`;
- `grounded_direct` has exactly one evidence segment;
- `grounded_distributed` has at least two evidence segments;
- `grounded_attributed` has at least one evidence segment and `groundingType = attributed`;
- `partial` has at least one supported component and at least one unsupported component;
- `ambiguous` includes a concise note identifying the unresolved grounding ambiguity.

### Canonical proposition immutability

- compare S1 canonical proposition artifacts before and after S2;
- their hashes must be identical;
- S2 publication fails if any canonical proposition artifact changes.

Validation controls publication only.

The request, raw provider response, token usage, parser output, and diagnostics must survive every validation failure.

---

## 9. Attribution rules

S2 grounds how the proposition appears in the article, not whether the underlying proposition is true.

Example:

Canonical proposition:

> The CDC manipulated data linking the MMR vaccine to autism.

Article passage:

> William Thompson revealed privately in 2014 that data linking the MMR vaccine to autism had been manipulated by the agency ten years earlier.

This passage may establish that the article attributes the manipulation allegation to William Thompson.

It does not, by itself, independently establish that the data were manipulated.

The result should therefore use `grounded_attributed` unless additional article text independently supports the embedded proposition.

Attribution must never be silently stripped.

---

## 10. Smallest-passage rule

The model must select the smallest passage that fully supports the proposition as presented.

Do not reward quotation length.

The report must expose:

- cited unit count;
- quoted character count;
- quoted word count;
- evidence-segment count.

Human review should assess:

1. whether the quotation supports the proposition;
2. whether attribution is represented correctly;
3. whether the passage contains avoidable surplus text.

No deterministic semantic score is required for surplus text in the first build.

---

## 11. Distributed grounding

A proposition may genuinely depend on multiple article passages.

Example structure:

```json
{
  "propositionId": "P04",
  "groundingStatus": "grounded_distributed",
  "groundingType": "distributed",
  "evidenceSegments": [
    {
      "sourceUnitIds": ["U0041"],
      "verbatimEvidence": "..."
    },
    {
      "sourceUnitIds": ["U0048", "U0049"],
      "verbatimEvidence": "..."
    }
  ],
  "supportedComponents": [],
  "unsupportedComponents": [],
  "notes": "The proposition is presented across two separate article passages."
}
```

Never create one synthetic quotation from non-contiguous passages.

---

## 12. Partial grounding

When only part of a proposition is supported, preserve the proposition and expose the defect.

Example:

```json
{
  "propositionId": "P06",
  "groundingStatus": "partial",
  "groundingType": "partial",
  "evidenceSegments": [
    {
      "sourceUnitIds": ["U0201", "U0202"],
      "verbatimEvidence": "..."
    }
  ],
  "supportedComponents": [
    "Australia approved the coal mine",
    "Australia pressured the United Nations to remove the reef chapter"
  ],
  "unsupportedComponents": [
    "The mine approval caused or motivated the pressure"
  ],
  "notes": "The article presents the events and timing but does not explicitly establish the causal link."
}
```

S2 must not repair the proposition.

The partial result is quarantined for later human review or S3 evidence-target derivation.

---

## 13. Persistence

Each S2 request receives an immutable directory before validation.

### Whole-article mode

```text
s2-grounding/
  whole-article/
    request-001/
      request.json
      request_hash.txt
      raw_response.json
      raw_response_hash.txt
      response_metadata.json
      parsed_response.json
      validation.json
      accepted_rows.json
      rejected_rows.json
      diagnostics.json
```

### Per-proposition mode

```text
s2-grounding/
  per-proposition/
    P01/
      request-001/
        request.json
        request_hash.txt
        raw_response.json
        raw_response_hash.txt
        response_metadata.json
        parsed_response.json
        validation.json
        accepted_rows.json
        rejected_rows.json
        diagnostics.json
    P02/
      ...
```

### Run-level artifacts

Publish:

```text
grounding_inventory.json
grounding_comparison.json
results_report.md
report.html
run_manifest.json
artifact_hashes.json
```

Validation must never delete provider evidence.

---

## 14. `report.html` generation

S2 must generate a self-contained, human-readable `report.html` for every completed run and for the final comparison between Arm A and Arm B.

The report is a forensic review surface, not a marketing page.

### Technical requirements

- generated deterministically from persisted JSON artifacts;
- no external JavaScript, fonts, stylesheets, images, trackers, or network requests;
- all CSS and optional JavaScript embedded inline;
- readable from a local filesystem;
- stable ordering by proposition ID;
- escapes all article and model text before rendering;
- includes run ID, fixture ID, model, prompt hash, schema hash, article hash, timestamps, token usage, latency, and validation state;
- links to or names the underlying artifact files;
- includes a generated-at timestamp but excludes nondeterministic layout data;
- regeneration from the same artifacts must produce byte-identical HTML except for an explicitly governed generated-at field, or that field must be omitted from hashing.

### Report structure

#### A. Run header

Display:

- CFX run ID;
- article title or fixture ID;
- grounding configuration;
- provider and model;
- prompt ID and prompt hash;
- schema hash;
- article hash;
- request count;
- retry count;
- total input tokens;
- total output tokens;
- cached tokens, when available;
- total latency;
- overall publication status.

#### B. Summary cards

Display counts for:

- total propositions;
- `grounded_direct`;
- `grounded_distributed`;
- `grounded_attributed`;
- `partial`;
- `ambiguous`;
- `unsupported`;
- parser failures;
- host-validation failures;
- exact-substring failures.

#### C. Proposition grounding table

For each proposition, display:

- proposition ID;
- immutable canonical assertion;
- assertion source;
- why it matters to the article thesis;
- grounding status;
- grounding type;
- cited unit IDs;
- exact evidence segments;
- supported components;
- unsupported components;
- notes;
- validation result;
- quoted word count;
- quoted character count;
- evidence-segment count.

The canonical proposition must be loaded from the frozen S1 artifact, not from S2 model output.

#### D. Source evidence display

Each evidence segment must be shown separately.

Display:

- segment number;
- cited unit IDs;
- exact quotation;
- full text snapshot of cited units;
- substring-validation result.

Do not visually join non-contiguous segments into one quotation.

#### E. Quarantine section

Collect every:

- partial result;
- ambiguous result;
- unsupported result;
- parser failure;
- validation failure.

Explain the mechanical reason for quarantine.

Do not generate a replacement proposition.

#### F. Arm comparison

When both grounding configurations have completed, include a side-by-side comparison table:

- grounded proposition count;
- status distribution;
- exact-substring success rate;
- complete proposition coverage;
- average and median cited units;
- average and median quoted words;
- evidence-segment count;
- duplicate passage reuse;
- parser failures;
- validation failures;
- request count;
- retries;
- total input tokens;
- total output tokens;
- cached tokens;
- total latency;
- estimated provider cost, when available.

For each proposition, also display:

- Arm A status and citations;
- Arm B status and citations;
- whether the status agrees;
- whether cited unit sets agree;
- whether exact quotations agree;
- a human-review field left blank or marked `not_reviewed`.

No automatic semantic winner may be declared.

#### G. Human review worksheet

Include three review questions for each arm and proposition:

1. Does the evidence support that the article presents the proposition?
2. Is attribution represented correctly?
3. Is the passage no broader than necessary?

Use static fields or printable checkboxes:

```text
yes / no / uncertain / not reviewed
```

The HTML must not silently persist reviewer answers unless a separate, explicit review artifact is implemented.

#### H. Raw accounting and artifact index

Display:

- request paths;
- raw-response paths;
- validation artifact paths;
- manifest path;
- hashes for all published artifacts.

### HTML implementation location

Recommended:

```text
backend/src/claimfoundry/cfx/grounding/report/
  buildS2ReportHtml.ts
  buildS2ReportModel.ts
  escapeHtml.ts
  reportTypes.ts
```

Recommended run-level output:

```text
<run-directory>/s2-grounding/report.html
```

### Report tests

Add tests proving:

- hostile article text is HTML-escaped;
- hostile model text is HTML-escaped;
- propositions render in stable ID order;
- each evidence segment renders separately;
- unsupported propositions render with no quotation;
- canonical assertions come from S1 artifacts;
- malformed or rejected rows appear in quarantine;
- Arm A and Arm B accounting totals are accurate;
- no external URLs or remote assets are emitted;
- report generation succeeds when one arm contains parser failures;
- identical input artifacts yield identical report HTML under the governed timestamp policy.

---

## 15. Comparison metrics

Generate `grounding_comparison.json` with at minimum:

```json
{
  "arms": {
    "wholeArticle": {
      "requestCount": 1,
      "propositionCount": 12,
      "statusCounts": {},
      "exactSubstringPassCount": 0,
      "parserFailureCount": 0,
      "validationFailureCount": 0,
      "averageCitedUnitCount": 0,
      "averageQuotedWordCount": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "cachedTokens": 0,
      "latencyMs": 0,
      "estimatedCost": null
    },
    "perProposition": {
      "requestCount": 12,
      "propositionCount": 12,
      "statusCounts": {},
      "exactSubstringPassCount": 0,
      "parserFailureCount": 0,
      "validationFailureCount": 0,
      "averageCitedUnitCount": 0,
      "averageQuotedWordCount": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "cachedTokens": 0,
      "latencyMs": 0,
      "estimatedCost": null
    }
  },
  "perPropositionComparison": []
}
```

Do not calculate a single overall quality score in the first build.

---

## 16. Tests

### Unit tests

Test:

- enum validation;
- status/type consistency;
- exact-substring validation;
- unit ordering;
- contiguous segment enforcement;
- distributed segment handling;
- unsupported-result handling;
- duplicate proposition IDs;
- missing proposition IDs;
- unexpected proposition IDs;
- canonical proposition hash immutability;
- artifact hashing;
- HTML escaping;
- stable report ordering.

### Integration tests

Test:

1. a direct one-unit grounding;
2. a direct multi-unit contiguous grounding;
3. distributed grounding;
4. attributed grounding;
5. partial grounding;
6. ambiguous grounding;
7. unsupported grounding;
8. malformed provider output;
9. exact quotation mismatch;
10. a whole-article response missing one proposition;
11. one failed request within per-proposition mode;
12. report generation with mixed accepted and quarantined results.

### Structural boundary test

S2 must not import:

- CF1–CF7 orchestration;
- agent or manager loops;
- chunk-harvest pipelines;
- semantic grouping;
- selector experiments;
- repair pipelines;
- region-disposition machinery;
- EvidenceRun.

---

## 17. Build sequence

### Milestone S2.1 — Schema and artifacts

- add grounding types and schemas;
- freeze `exact-grounding-v1.json`;
- implement immutable request directories;
- implement parser and structural validation;
- implement exact-substring validation.

### Milestone S2.2 — Whole-article arm

- implement Arm A;
- persist all artifacts before validation;
- publish `grounding_inventory.json`;
- generate `results_report.md`;
- generate `report.html`.

### Milestone S2.3 — Per-proposition arm

- implement Arm B;
- isolate failures by proposition;
- aggregate accounting;
- publish its grounding inventory;
- regenerate `report.html` with both arms.

### Milestone S2.4 — Comparison

- generate `grounding_comparison.json`;
- add side-by-side HTML comparison;
- add printable human-review worksheet;
- freeze run artifacts before semantic review.

Stop after the comparison artifacts are complete.

Do not add retrieval assistance, semantic repair, dynamic prompting, or S3 logic during S2.

---

## 18. Acceptance criteria

S2 is accepted when:

- S1 canonical proposition hashes remain unchanged;
- both grounding arms can be run independently;
- every proposition receives a result or an explicit quarantined failure;
- every accepted quotation passes exact-substring validation;
- non-contiguous passages remain separate evidence segments;
- attribution-only support is distinguishable from direct substantive support;
- partial and unsupported results do not erase propositions;
- every request and raw response survives validation failure;
- accounting is complete;
- `results_report.md` is generated;
- a self-contained, deterministic `report.html` is generated;
- the HTML exposes every proposition, citation, quarantine, validation result, and arm comparison;
- the implementation has no runtime dependency on CF1–CF7 or EvidenceRun.

---

## 19. Non-goals

S2 will not:

- judge external truth;
- revise S1 meaning;
- repair propositions;
- select substitute propositions;
- derive final evidence-search targets;
- perform article chunking;
- add retrieval prefilters;
- search the web;
- call EvidenceRun;
- introduce an agent loop;
- declare a semantic winner automatically.

---

## 20. Final implementation instruction

Build S2 as a narrow grounding instrument.

When the article does not support a proposition cleanly, expose the defect.

Do not make the proposition look better by changing it.

The required product of S2 is not a cosmetically complete claim package. It is a precise, inspectable record of where each preserved proposition is, or is not, grounded in the article.
