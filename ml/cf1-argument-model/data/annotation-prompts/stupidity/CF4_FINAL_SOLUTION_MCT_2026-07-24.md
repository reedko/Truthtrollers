# CF4 Final Solution MCT — Lossless Discourse Tuples and Bounded Attribution Recursion

**Date:** 2026-07-24  
**Status:** Final implementation specification for the first CF4 candidate. Promotion remains contingent on the staged empirical gates in this document.  
**Supersedes:** `CF4_PLANNING_MCT_2026-07-24.md` and `CF4_PLANNING_MCT_2026-07-24_v2.md`  
**Scope:** New isolated experimental track under `backend/experiments/cf4/`. CF1 live, CF2, CF3, ER1, and production remain untouched.

---

## 0. Governing context and precedence

This specification incorporates:

1. `TM5_Agent_Project_Import.md` for project boundaries, repository safety, ClaimFoundry/EvidenceRun separation, provenance, persistence, and deterministic enforcement.
2. `CF3 Consolidated MCT — Architecture, Principles, Findings, Current State` for chunked discovery, dedicated challenged-assertion census, comparative selection, terminology, contract-prompt discipline, strict schemas, and staged testing.
3. `CF2 V5: Current Chain, Exact Prompts, Code, and Failure Analysis` for the demonstrated assertion/source coupling failure, late-attribution failure, article-voice overuse, and narrow deterministic successes.
4. The 2026-07-24 discussion establishing lossy proposition flattening and bounded attribution recursion as the root architectural issue.

Precedence for CF4 work:

1. TM5 project boundaries and repository prohibitions.
2. Established CF3 empirical receipts.
3. Established CF2 empirical receipts.
4. This final CF4 architecture and test plan.

No part of this document authorizes production changes.

CF4 preserves the project boundary:

> ClaimFoundry determines what the article asserts and what should be tested. EvidenceRun determines what external evidence bears on those tests.

CF4 does not search the web, fetch evidence, score source bearing, determine article truth, or produce article verdicts.

---

## 1. Root cause: lossy representation, not merely model variance

The recurring failure is not fundamentally that the model sometimes chooses the wrong source. The architecture repeatedly stores two different assertions in one string and one source slot.

For the Thompson sentence, the article contains at least two independently representable assertions:

### Attribution event

> William Thompson revealed privately in 2014 that P.

### Embedded substantive assertion P

> The CDC manipulated data linking MMR vaccination to autism.

They have different immediate suppliers:

- the article voice supplies the surface report that Thompson revealed something;
- Thompson supplies the embedded allegation about CDC manipulation.

A schema containing only:

```text
assertionText
assertionSource
```

forces the model to choose which assertion the row represents.

If the row represents:

```text
William Thompson revealed P
```

then the article voice is a reasonable supplier of the complete event assertion.

If the row represents:

```text
The CDC manipulated data
```

then Thompson is the supplier of the embedded substantive assertion.

That produces the recurring inverse relationship:

- preserve attribution and the fact-check assertion remains contaminated;
- clean the assertion and the supplier disappears;
- restore the supplier and the model reinterprets the row as a reporting event;
- change the represented assertion and treatment, thesis effect, and selection can also change.

Model variability determines which interpretation wins in a particular run. It is not the underlying cause. The underlying cause is **information destruction**.

> CF4 must stop flattening discourse structure into one assertion string and later asking another call to reconstruct what was discarded.

---

## 2. Final architectural decision

CF4 will represent every extracted item as a **lossless discourse tuple**.

The tuple preserves:

```text
surfaceStatement
surfaceUnitIds
reportingVoice
attributionLayers[]
substantiveAssertion
substantiveGroundingUnitIds
contentSupplier
primaryVerificationTarget
```

The model exposes a bounded, ordered attribution chain. Deterministic code validates chain continuity and projects the appropriate production fields.

For the Thompson example:

```yaml
surfaceStatement: >
  William Thompson revealed privately in 2014 that data linking the MMR
  vaccine to autism had been manipulated by the CDC.

reportingVoice:
  name: Ana Wolpin
  kind: article_voice

attributionLayers:
  - layerIndex: 0
    speaker:
      name: William Thompson
      kind: person
    predicate: revealed
    operatorType: report
    eventAssertion: >
      William Thompson revealed privately in 2014 that the CDC had
      manipulated data linking the MMR vaccine to autism.
    assertedContent: >
      The CDC manipulated data linking the MMR vaccine to autism.
    attributionUnitIds: [U0037]
    contentGroundingUnitIds: [U0037]

substantiveAssertion: >
  The CDC manipulated data linking the MMR vaccine to autism.

substantiveGroundingUnitIds: [U0037]

contentSupplier:
  name: William Thompson
  kind: person
  sourceUnitIds: [U0037]

primaryVerificationTarget: substantive_content
```

The ordinary fact-check projection is then deterministic:

```text
assertionText   = substantiveAssertion
assertionSource = contentSupplier
```

The attribution event remains available as a separate object. If the article's argument materially depends on whether Thompson made the disclosure, CF4 may deliberately emit an attribution-event target. It will never become the active target accidentally because the substantive content was overwritten.

---

## 3. Bounded attribution recursion

CF4 does not blindly choose the deepest grammatical subordinate clause.

It follows only **attribution or evidential operators** that introduce asserted content, such as:

- said;
- stated;
- claimed;
- reported;
- revealed;
- alleged;
- wrote;
- announced;
- found;
- concluded;
- denied;
- a document or study stating/finding content.

Ordinary causal, temporal, relative, descriptive, purpose, and result clauses do not create attribution layers.

### Example: one layer

```text
William Thompson revealed [P].
```

```text
L0 speaker: William Thompson
L0 assertedContent: P
substantiveAssertion: P
contentSupplier: William Thompson
```

### Example: two layers

```text
A journalist reported that Agency B concluded [P].
```

```text
L0 speaker: journalist
L0 eventAssertion: journalist reported that Agency B concluded P
L0 assertedContent: Agency B concluded P

L1 speaker: Agency B
L1 eventAssertion: Agency B concluded P
L1 assertedContent: P

substantiveAssertion: P
contentSupplier: Agency B
```

### Denial polarity

```text
The CDC denied that vaccines cause autism.
```

The CDC is not represented as asserting the positive complement. The layer's asserted content is the negative assertion it commits to:

```text
Vaccines do not cause autism.
```

Original polarity must survive every layer and every projection.

### Bound

The first CF4 schema permits no more than **four attribution layers**. More deeply nested material is rare, expensive, and difficult to adjudicate. When the model detects additional unresolved nesting, it must preserve the full surface statement and return a blocking diagnostic rather than silently flatten the remainder.

---

## 4. Why CF4 uses two micro-stages inside extraction

CF3 established that adding rewrite and interpretation duties directly to broad discovery can suppress recall. CF4 therefore does not place the entire tuple burden on the first capture call.

The non-negotiable requirement is **no lossy flattening**, not necessarily one API call.

CF4's first extraction phase has two bounded micro-stages:

```text
D0 — surface capture
D1 — discourse parsing
```

D0 preserves every source-bearing surface assertion and its exact source units. Nothing semantic is discarded.

D1 parses the preserved surface assertion into its discourse tuple while the original chunk and source units are still present. D1 does not reconstruct from an already cleaned assertion. It analyzes a lossless source record.

This protects both empirical findings:

- CF3's capture-first recall advantage;
- the new requirement that source-bearing discourse structure never be overwritten.

A later experiment may test a combined D0+D1 call after the two-stage version passes. The combined version is not the first candidate.

---

## 5. Final CF4 architecture

```text
ARTICLE
  → host: canonical source units
  → host: four structural chunks with overlap

  → D0 SURFACE CAPTURE
       four parallel GPT-4o-mini calls
       dedicated challengedAssertions[] first
       assertions[] second
       output only surfaceStatement + surfaceUnitIds

  → D1 DISCOURSE PARSING
       four parallel selected-chunk calls
       input: original chunk + every D0 row from that chunk
       output: bounded attributionLayers[] + substantiveAssertion
               + substantiveGroundingUnitIds
       no stance, selection, source projection, or evidence fields

  → host: assemble lossless discourse tuples
       reportingVoice from article metadata
       contentSupplier projected from deepest attribution layer
       article_voice only when no attribution layer exists
       preserve all raw surfaces and layer provenance

  → host: exact/normalized dedupe and occurrence grouping
       never discard distinct source chains

  → P PORTFOLIO AND TARGET JUDGMENT
       one GPT-4.1-mini full-context comparative call
       input: full article + tuple projections without source instructions
       output: selected IDs, branch, target mode,
               target-specific treatment and thesis effect

  → host: freeze P decisions

  → deterministic projection
       selectedEvaluationClaims
       optional attribution-event Phase 3 targets
       scoreTransform
       source and grounding fields

  → tuple validation
       pass
       OR one selected-row tuple repair using original surface + source context
       OR reject

  → W named-work / identifier hints, only after the core path passes

  → EvidenceRun handoff
```

First-candidate call shape:

- four parallel D0 calls;
- four parallel D1 calls;
- one P call;
- zero source-recovery calls;
- at most one bounded repair call for failed selected tuples.

D0 and D1 run in two parallel waves, not eight serial calls.

---

## 6. Canonical discourse-tuple contract

### 6.1 Stored tuple

```json
{
  "assertionId": "A009",
  "surfaceStatement": "",
  "surfaceUnitIds": [],
  "reportingVoice": {
    "name": null,
    "kind": "article_voice",
    "sourceUnitIds": []
  },
  "attributionLayers": [
    {
      "layerIndex": 0,
      "speaker": {
        "name": null,
        "kind": "unknown",
        "sourceUnitIds": []
      },
      "predicate": "",
      "operatorType": "report",
      "eventAssertion": "",
      "assertedContent": "",
      "attributionUnitIds": [],
      "contentGroundingUnitIds": [],
      "sourceBasis": "direct"
    }
  ],
  "substantiveAssertion": "",
  "substantiveGroundingUnitIds": [],
  "contentSupplier": {
    "name": null,
    "kind": "unknown",
    "sourceUnitIds": []
  },
  "challengedInContext": false,
  "occurrenceIds": [],
  "diagnostics": []
}
```

### 6.2 Allowed kinds

```text
person
institution
study
document
article_voice
unknown
```

### 6.3 Attribution operator types

```text
speech
report
allegation
finding
conclusion
denial
document_statement
other_attribution
```

The model also returns the exact surface predicate, such as `revealed`, `found`, or `denied`.

### 6.4 Source-basis values

```text
direct
quotation
structural_list_owner
discourse_continuation
explicit_document
unresolved
```

These values describe why the layer exists. They do not substitute for source-unit grounding.

---

## 7. Deterministic projection rules

### 7.1 Reporting voice

The host materializes `reportingVoice` from article metadata when the byline is known:

```text
name = exact byline
kind = article_voice
```

This field records who presents the surface statement in the article. It is not automatically the supplier of the embedded content.

### 7.2 Content supplier

If `attributionLayers.length > 0`:

```text
contentSupplier = speaker of the deepest attribution layer
```

If `attributionLayers.length == 0`:

```text
contentSupplier = reportingVoice
```

Exception:

- if the text explicitly attributes the content but the speaker cannot be resolved, the deepest layer uses `unknown`;
- the host must not replace that unresolved external source with article voice.

### 7.3 Substantive projection

For a substantive target:

```text
assertionText       = substantiveAssertion
assertionSource     = contentSupplier
assertionGrounding  = substantiveGroundingUnitIds
sourceGrounding     = contentSupplier.sourceUnitIds
```

### 7.4 Attribution-event projection

Each attribution layer preserves an `eventAssertion`.

When P deliberately requests an attribution-event target:

```text
assertionText   = selected attribution layer.eventAssertion
assertionSource = reporting voice or immediately enclosing layer speaker
```

The target receives its own treatment, thesis effect, and score transform. It does not overwrite the substantive target.

### 7.5 Both targets

When both the embedded content and the fact of attribution are material, CF4 emits two linked Phase 3 targets:

```text
substantive_content
attribution_event
```

They share a tuple ID but retain separate text, source, grounding, treatment, effect, and transform.

### 7.6 Score transform

The model never emits `scoreTransform`.

For every projected target:

```text
strengthens → normal
weakens    → invert
no_effect  → none
```

Article treatment remains separately stored as adopted, challenged, or reported.

---

## 8. D0 exact executable contract

The first candidate reuses the successful CF3 capture shape with terminology updated only where required by the tuple pipeline.

### D0 system prompt

```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
text disputes into the text's rebuttal of it.
```

### D0 user prompt

```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

{{CHUNK_WITH_SOURCE_UNIT_IDS}}

TASK

First, in challengedAssertions, return the assertions this section presents in
order to dispute. Preserve the complete source-bearing surface statement and the
source units that express it. Return an empty array only if the section disputes
nothing.

Then, in assertions, return every other factual assertion in this section that
external evidence could evaluate. Preserve the complete source-bearing surface
statement and the source units that express it.
```

### D0 schema

```json
{
  "name": "cf4_surface_capture_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["challengedAssertions", "assertions"],
    "properties": {
      "challengedAssertions": {
        "type": "array",
        "maxItems": 24,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["surfaceStatement", "surfaceUnitIds"],
          "properties": {
            "surfaceStatement": {"type": "string"},
            "surfaceUnitIds": {
              "type": "array",
              "minItems": 1,
              "maxItems": 8,
              "items": {"type": "string"}
            }
          }
        }
      },
      "assertions": {
        "type": "array",
        "maxItems": 60,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["surfaceStatement", "surfaceUnitIds"],
          "properties": {
            "surfaceStatement": {"type": "string"},
            "surfaceUnitIds": {
              "type": "array",
              "minItems": 1,
              "maxItems": 8,
              "items": {"type": "string"}
            }
          }
        }
      }
    }
  }
}
```

D0 performs no rewrite, source identification, stance judgment, selection, or evidence planning.

---

## 9. D1 exact executable contract

D1 parses every preserved D0 row while the original chunk remains visible.

### D1 system prompt

```text
You map the attribution structure of preserved article assertions.

Use only the supplied article section, assertion records, and source-unit
identifiers. Do not use outside knowledge. Do not fact-check, select, rank, or
judge the article's position.

Preserve original polarity at every layer.
```

### D1 user prompt

```text
ARTICLE SECTION

{{CHUNK_WITH_SOURCE_UNIT_IDS}}

PRESERVED ASSERTION RECORDS

{{SURFACE_RECORDS_JSON}}

TASK

Return one discourse record for every supplied assertionId, in assertionId order.

attributionLayers contains the ordered outermost-to-innermost attribution or
evidential layers expressed by the article section. A layer exists when a person,
institution, study, document, or quoted speaker supplies asserted content through
speech, reporting, allegation, finding, conclusion, denial, or a document
statement. Ordinary grammatical subordination is not an attribution layer.

For every layer:
- speaker identifies who supplies that layer's asserted content;
- predicate preserves the article's attribution wording;
- eventAssertion states the complete attribution event represented by that layer;
- assertedContent states the content that speaker commits to;
- attributionUnitIds ground the speaker and attribution relationship;
- contentGroundingUnitIds ground the asserted content;
- sourceBasis states how the attribution is expressed.

For denial, assertedContent is the negative assertion the speaker commits to, not
the positive wording inside the denied complement.

substantiveAssertion is the deepest independently evaluable asserted content
reached through the returned attribution layers. If there is no attribution
layer, it is the independently evaluable factual content of the preserved surface
statement.

substantiveGroundingUnitIds ground substantiveAssertion.

Do not emit article treatment, thesis effect, branch, selection, score transform,
evidence strategy, or named-work hints.
```

### D1 schema

```json
{
  "name": "cf4_discourse_parse_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["records"],
    "properties": {
      "records": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "assertionId",
            "attributionLayers",
            "substantiveAssertion",
            "substantiveGroundingUnitIds"
          ],
          "properties": {
            "assertionId": {"type": "string"},
            "attributionLayers": {
              "type": "array",
              "maxItems": 4,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "layerIndex",
                  "speaker",
                  "predicate",
                  "operatorType",
                  "eventAssertion",
                  "assertedContent",
                  "attributionUnitIds",
                  "contentGroundingUnitIds",
                  "sourceBasis"
                ],
                "properties": {
                  "layerIndex": {"type": "integer", "minimum": 0, "maximum": 3},
                  "speaker": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["name", "kind", "sourceUnitIds"],
                    "properties": {
                      "name": {"type": ["string", "null"]},
                      "kind": {
                        "type": "string",
                        "enum": [
                          "person",
                          "institution",
                          "study",
                          "document",
                          "unknown"
                        ]
                      },
                      "sourceUnitIds": {
                        "type": "array",
                        "maxItems": 8,
                        "items": {"type": "string"}
                      }
                    }
                  },
                  "predicate": {"type": "string"},
                  "operatorType": {
                    "type": "string",
                    "enum": [
                      "speech",
                      "report",
                      "allegation",
                      "finding",
                      "conclusion",
                      "denial",
                      "document_statement",
                      "other_attribution"
                    ]
                  },
                  "eventAssertion": {"type": "string"},
                  "assertedContent": {"type": "string"},
                  "attributionUnitIds": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 8,
                    "items": {"type": "string"}
                  },
                  "contentGroundingUnitIds": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 8,
                    "items": {"type": "string"}
                  },
                  "sourceBasis": {
                    "type": "string",
                    "enum": [
                      "direct",
                      "quotation",
                      "structural_list_owner",
                      "discourse_continuation",
                      "explicit_document",
                      "unresolved"
                    ]
                  }
                }
              }
            },
            "substantiveAssertion": {"type": "string"},
            "substantiveGroundingUnitIds": {
              "type": "array",
              "minItems": 1,
              "maxItems": 8,
              "items": {"type": "string"}
            }
          }
        }
      }
    }
  }
}
```

The runtime schema should enumerate the supplied assertion IDs and require exact set equality.

---

## 10. P portfolio and target judgment

P performs comparative semantic judgment only after the tuple inventory exists.

### P input projection

P receives:

- full article and source-unit IDs;
- assertion ID;
- substantive assertion;
- surface event assertion when attribution exists;
- challenged-census membership;
- article position;
- no content-supplier field;
- no source kind;
- no source instructions;
- no named works;
- no evidence strategy.

The full article naturally contains names. The prompt does not foreground or request source reasoning.

### P output per selected item

```json
{
  "assertionId": "A009",
  "argumentBranchId": "B02",
  "targets": [
    {
      "targetType": "substantive_content",
      "articleTreatment": "adopted",
      "thesisEffect": "strengthens"
    }
  ]
}
```

Allowed target types:

```text
substantive_content
attribution_event
```

Most selected items should emit only `substantive_content`. `attribution_event` is included only when whether the attribution occurred is independently material to evaluating the article. When both matter, P emits both target rows.

P may not rewrite the tuple, identify a source, emit grounding, or modify layer structure.

### P exact system prompt

```text
You map the factual argument of an article and select the assertions most worth
evaluating with external evidence.

Use only the supplied article, source-unit identifiers, and assertion inventory.
Do not use outside knowledge. Do not fact-check.

Preserve every assertion's original polarity. Treat an attribution event and its
embedded substantive content as separate possible evaluation targets.
```

### P exact user prompt

```text
ARTICLE METADATA

Title: {{TITLE}}
Author or byline: {{AUTHOR}}
Publication: {{PUBLICATION}}
Publication date: {{DATE}}

PORTFOLIO SIZE

Select exactly {{PORTFOLIO_SIZE}} assertion IDs.

ARTICLE

{{FULL_ARTICLE_WITH_SOURCE_UNIT_IDS}}

ASSERTION INVENTORY

{{PORTFOLIO_INPUT_JSON}}

TASK

1. stanceAnchor — the article's central position, stated as one assertion.

2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} assertion IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion ID:

argumentBranchId — the distinct factual branch of the article's argument to which
this assertion belongs.

targets — the evaluation targets needed for this assertion record.

Use substantive_content when the embedded factual content itself should be
evaluated. Use attribution_event only when whether the attribution event occurred
is independently material to evaluating the article. Return both only when each is
independently material.

For every returned target:

articleTreatment — adopted when the article uses the target as part of its factual
case; challenged when the article presents the target to dispute or reject it;
reported when it presents the target without clearly adopting or challenging it.

thesisEffect — assume the target is true. If that makes stanceAnchor more credible,
strengthens; less credible, weakens; neither, no_effect. Ignore presumed real-world
truth.

4. argumentBranches — for every branch ID used, state the factual question that
branch represents.

Do not rewrite assertion text. Do not identify a supplier. Do not emit grounding,
score transforms, named works, evidence strategy, or search terms.
```

### P schema

```json
{
  "name": "cf4_portfolio_judgment_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "stanceAnchor",
      "selectedAssertionIds",
      "selectedAssertions",
      "argumentBranches"
    ],
    "properties": {
      "stanceAnchor": {"type": "string"},
      "selectedAssertionIds": {
        "type": "array",
        "items": {"type": "string"}
      },
      "selectedAssertions": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["assertionId", "argumentBranchId", "targets"],
          "properties": {
            "assertionId": {"type": "string"},
            "argumentBranchId": {"type": "string"},
            "targets": {
              "type": "array",
              "minItems": 1,
              "maxItems": 2,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "targetType",
                  "articleTreatment",
                  "thesisEffect"
                ],
                "properties": {
                  "targetType": {
                    "type": "string",
                    "enum": [
                      "substantive_content",
                      "attribution_event"
                    ]
                  },
                  "articleTreatment": {
                    "type": "string",
                    "enum": ["adopted", "challenged", "reported"]
                  },
                  "thesisEffect": {
                    "type": "string",
                    "enum": ["strengthens", "weakens", "no_effect"]
                  }
                }
              }
            }
          }
        }
      },
      "argumentBranches": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["branchId", "branchQuestion"],
          "properties": {
            "branchId": {"type": "string"},
            "branchQuestion": {"type": "string"}
          }
        }
      }
    }
  }
}
```

The runtime schema enumerates all available assertion IDs. The host requires exact
portfolio count, unique IDs, selected-ID/object set equality, unique target types per
row, and valid branch references.

### P selection rule

P selects exactly the configured portfolio size from the complete article-wide inventory. Selection is comparative, not pointwise and not deterministic quartile balancing.

The counterfactual thesis-effect rule remains:

> Assume the target assertion is true. Does that make the article's central position more credible, less credible, or neither? Ignore presumed real-world truth.

Treatment and effect are target-specific. The attribution event and substantive content may legitimately receive different judgments.

---

## 11. Host assembly and invariants

### 11.1 Structural invariants

The host rejects when:

1. D1 omits or duplicates an assertion ID.
2. Any source-unit ID is unavailable to that chunk.
3. layer indices are not contiguous from zero.
4. attribution depth exceeds four.
5. a resolved speaker has no name.
6. name and kind are structurally incoherent.
7. an unresolved externally attributed speaker is replaced with article voice.
8. `substantiveAssertion` is empty.
9. substantive grounding is empty.
10. P changes the selected ID set after freezing.
11. P emits a target type not available from the tuple.
12. a later stage modifies a frozen surface, layer, source, treatment, effect, or branch.

### 11.2 Chain-continuity invariant

For adjacent layers:

```text
layer[i].assertedContent
```

must represent the event assertion of:

```text
layer[i + 1]
```

The first candidate asks the model to use matching text where feasible. Exact normalized equality is preferred and tested. Non-exact continuity is a blocking review item until adjudicated.

### 11.3 Deepest-content invariant

When layers exist:

```text
substantiveAssertion == final layer.assertedContent
```

under whitespace and punctuation normalization.

When no layers exist, `substantiveAssertion` remains the D1 factual rendering of the preserved surface statement.

### 11.4 Supplier invariant

When layers exist:

```text
contentSupplier == final layer.speaker
```

When no layers exist:

```text
contentSupplier == reportingVoice
```

No model call separately re-decides `contentSupplier`.

### 11.5 Reporting-residue rule

Reporting verbs are permitted in:

- `surfaceStatement`;
- `eventAssertion`;
- intermediate `assertedContent` that leads to another attribution layer.

They are blocking in `substantiveAssertion` when the final object is still an attribution event that should have been represented as another layer.

This is no longer a crude name-plus-verb detector applied to all text. It is a structural invariant tied to the layer chain.

### 11.6 Polarity rule

The host records negation and denial diagnostics for every surface, layer content, and substantive assertion. Any suspected polarity change blocks promotion pending adjudication. Confirmed polarity changes reject the row.

---

## 12. Repair policy

There is no late attribution-recovery call.

A failed selected tuple receives at most one **whole-tuple repair**.

Repair input contains:

- original D0 surface statement;
- original chunk and source units;
- original D1 tuple;
- exact blocking invariants;
- frozen P target judgments as read-only context.

Repair output regenerates:

- all attribution layers;
- substantive assertion;
- substantive grounding.

The host then recomputes:

- content supplier;
- projected assertion text/source;
- target projections.

Repair may not independently patch the assertion string, speaker, or source units. It regenerates the complete discourse structure so internal consistency can be revalidated.

One failed repair rejects the row or run according to the configured experiment gate. There is no third attempt.

### Exact tuple-repair system prompt

```text
You repair an invalid discourse tuple for a preserved article assertion.

Use only the supplied article context, source-unit identifiers, preserved surface
statement, failed tuple, and validation failures. Do not use outside knowledge. Do
not fact-check, select, rank, or change frozen portfolio judgments.

Preserve original polarity and regenerate the complete discourse structure.
```

### Exact tuple-repair user prompt

```text
ARTICLE CONTEXT

{{RELEVANT_ARTICLE_UNITS}}

PRESERVED SURFACE RECORD

{{SURFACE_RECORD_JSON}}

FAILED DISCOURSE TUPLE

{{FAILED_TUPLE_JSON}}

VALIDATION FAILURES

{{FAILURES_JSON}}

FROZEN PORTFOLIO JUDGMENTS — READ ONLY

{{FROZEN_P_JSON}}

TASK

Return one complete repaired discourse record for the supplied assertionId.
Regenerate attributionLayers, substantiveAssertion, and
substantiveGroundingUnitIds together.

The repaired record must satisfy the same field meanings and polarity rules as the
original discourse-parse contract. Do not emit or change selection, target type,
article treatment, thesis effect, branch, score transform, named works, evidence
strategy, or search terms.
```

The repair uses the D1 record schema restricted to exactly one enumerated assertion
ID. It does not accept partial patches.

---

## 13. Dedupe and occurrence grouping

CF4 must not dedupe away distinct discourse provenance.

Host behavior:

1. exact and normalized duplicate surface rows inside chunk overlap are merged;
2. rows with the same substantive assertion but different attribution chains become one assertion family with multiple occurrences;
3. every occurrence retains:
   - surface statement;
   - source units;
   - attribution layers;
   - reporting voice;
   - content supplier;
4. challenged membership wins only for the occurrence where the article presents that surface in order to dispute it;
5. P selects assertion-family IDs but can inspect occurrence treatment in the full article;
6. production projection records the selected occurrence or consolidated source set explicitly.

This prevents “same P” from erasing who supplied it, where it appeared, or whether one occurrence was challenged while another was adopted.

---

## 14. Deterministic CF2 techniques retained within bounds

### 14.1 Grounding repair

High-confidence lexical grounding repair remains permitted as an audited diagnostic. It may mutate grounding only when:

- original overlap is extremely weak;
- one replacement is overwhelmingly stronger;
- original and replacement IDs and scores are persisted.

It may not rewrite semantic content or infer source.

### 14.2 Structural-list ownership

The JCPH explicit-list rule is reinterpreted as a deterministic attribution layer:

```text
speaker: Jefferson County Public Health
sourceBasis: structural_list_owner
```

First-candidate behavior:

- host detects the unambiguous structural owner;
- D1 output is compared against it;
- disagreement is blocking or reviewable;
- automatic insertion is tested as a separately configured deterministic candidate, not silently enabled from the start.

### 14.3 Coreference replacement boundary

Demonstrative and definite-NP anaphora resolve safely only when (a) a coref model
supplies the link and (b) the linked antecedent is itself the complete substantive
NP. When resolution requires composing a modifier from the antecedent into the
anaphor, it is semantic reconstruction, not replacement, and is out of scope for
deterministic S1.

Applied decisions:

- **Ticket A ships:** model-linked definite-description replacement remains
  enabled. F03 G02 `the agency` → `the CDC` has a model-supplied cluster link to
  the correct complete substantive antecedent.
- **Ticket B closes without implementation:** F03 G09 `this cumulative load`
  does not have a safe link to a complete aluminum NP. The Maverick spike linked
  it to `1000 mcg`; the hand-audited three-fixture rule simulation found unsafe
  rewrites. G09 remains a `REAL_GAP`.

### 14.4 Prohibited host semantics

The host may not:

- infer ordinary-prose speakers from capitalization;
- select semantically central assertions;
- rewrite atomic meaning;
- backfill treatment or thesis effect;
- turn a named work into a content supplier;
- replace unknown with article voice when an unresolved external layer exists;
- choose a deeper ordinary subordinate clause merely because it is grammatically nested.

---

## 15. W named-work and identifier hints

Named works remain downstream of the validated tuple and portfolio.

Preferred order:

1. citation-aware ArticleDocument sidecars;
2. exact deterministic extraction of DOI, PMID, law, report title, study title, quoted document, author/year, or URL already present;
3. optional selected-only read-only model association.

W receives frozen selected tuples and may emit:

- cited works;
- evidence anchors;
- DOI/PMID/title hints;
- source-unit-to-reference links.

W may not change:

- surface statement;
- attribution layers;
- substantive assertion;
- content supplier;
- target type;
- treatment;
- thesis effect;
- branch;
- selected ID.

---

## 16. Required artifacts

```text
backend/experiments/cf4/
  prompts.js
  schemas.js
  pipeline.js
  discourseTuple.js
  tupleValidation.js
  projection.js
  diagnostics.js
  report.js
  frozenReplay.js
  run.mjs
  test.mjs
```

Generated artifacts:

```text
artifacts/claim-foundry/cf4/<fixture>-<timestamp>/
  run_config.json
  article_units.json
  chunks.json
  surface_capture.json
  discourse_parse.json
  discourse_tuples.json
  assertion_families.json
  portfolio_judgment.json
  projected_targets.json
  tuple_validation.json
  tuple_repairs.json
  final_assertion_package.json
  diagnostics.json
  run_report.md
  review_packet.json
  review.html
```

The review interface must show separate editable fields for:

- surface statement;
- each attribution layer;
- substantive assertion;
- reporting voice;
- content supplier;
- target type;
- treatment/effect;
- grounding;
- diagnostics.

A reviewer must never have to infer which assertion a single flattened string represents.

---

## 17. Training and regression use of CF2/CF3 records

The CF2 and CF3 records are design and evaluation data, not hidden generation labels.

### Positive receipts to preserve

- CF3 chunked coverage;
- CF3 dedicated challenged census;
- CF3 comparative portfolio selection;
- CF3 fresh-field separation insight;
- CF2 broad candidate docket;
- CF2 correct JCPH opponent transforms;
- CF2 explicit structural-list ownership;
- CF2 grounding provenance.

### Negative receipts to prevent

- whole-article front-loading;
- discovery rewrite suppression;
- all-reported stance collapse;
- deterministic semantic selection;
- contaminated Thompson surface frozen as the fact-check object;
- article voice selected because the row represented the reporting event;
- source recovery after the embedded assertion had been discarded;
- named-work/source conflation;
- capitalization-based source fishing;
- separate text-only and source-only repairs.

### Required frozen discourse benchmarks

Build an adjudicated benchmark with at least:

1. single-layer reporting;
2. two-layer nested attribution;
3. denial with polarity normalization;
4. explicit quotation speaker;
5. study/document finding;
6. structural list owner;
7. article-voice assertion with no external layer;
8. unresolved external attribution;
9. same substantive assertion from different suppliers;
10. a case where the attribution event, not embedded content, is the primary target;
11. a case where both targets are material;
12. ordinary subordinate clauses that must not become attribution layers.

Fixture-specific names may appear only in benchmark packets and adjudication, never executable prompts.

---

## 18. Staged test plan

### Gate 0 — Static contract

Required:

- model-facing prompt prose contains no `claim`, `claims`, or `proposition`;
- no fixture-specific names or examples in executable prompts;
- D0 challenged array remains first;
- D0 contains no rewrite, source, stance, or selection fields;
- D1 contains no stance, selection, target, evidence, or score fields;
- P cannot modify tuple fields;
- strict schemas reject additional properties;
- no source-only recovery call exists;
- host alone projects content supplier and transform.

Stop on failure.

### Gate 1 — D0 recall parity

Run F03 three times with the authoritative chunking.

Required:

- opponent assertions appear in challenged capture in at least two of three repeats;
- Thompson-section adopted material is not mis-filed as challenged;
- late-article coverage remains broad;
- inventory size does not materially collapse against healthy CF3 runs;
- surface statements preserve source-bearing wording and units.

No D0 prompt changes during this gate.

### Gate 2 — Frozen D0 tuple parsing

Freeze one passing D0 inventory. Run D1 five times.

Primary metrics:

- attribution-layer precision and recall;
- layer-order accuracy;
- chain continuity;
- deepest-content exactness;
- substantive-grounding accuracy;
- content-supplier projection accuracy;
- denial polarity accuracy;
- article-voice fallback accuracy;
- correct unresolved attribution;
- reporting residue in final substantive assertion;
- tuple stability across repeats.

Required:

- Thompson-class rows preserve both surface event and embedded content;
- projected supplier is correct without a later source call;
- JCPH list rows preserve structural owner;
- denial cases preserve the speaker's negative commitment;
- ordinary subordinate clauses are not recursively descended;
- no confirmed polarity loss;
- central benchmark tuples pass as complete tuples, not field averages.

### Gate 3 — Deterministic projection

Using adjudicated tuples, test projection without model calls.

Required:

- substantive target maps to deepest content and deepest speaker;
- attribution-event target maps to the selected event and its immediately enclosing voice;
- both-target mode produces two linked targets;
- unresolved external source never becomes article voice;
- score transforms derive correctly;
- no field is overwritten.

This gate must be 100% deterministic and 100% passing.

### Gate 4 — Frozen portfolio judgment

Freeze an accepted tuple inventory. Run P five times.

Required:

- model selects comparatively across the article;
- materially important opponents are retained;
- treatment/effect minority classes do not collapse;
- target type is deliberate;
- attribution-event targets are rare and justified;
- both-target mode appears only when independently material;
- branch and quarter coverage are broad;
- no tuple field changes;
- no confirmed polarity change.

Report selection Jaccard, minority-class metrics, opponent retention, branch/quarter coverage, filler, duplicates, tokens, and latency.

### Gate 5 — End-to-end without repair

Run D0 → D1 → P → projection five times on F03.

Required:

- all prior gates remain satisfied;
- no late source call;
- at least eight selected rows are fully usable when the article supplies enough material;
- source-bearing discourse remains inspectable;
- total wall time ≤120 seconds;
- total tokens are reported, with a target ≤45,000 for the first candidate;
- complete provenance exists.

The token ceiling is initially 45,000 because CF4 deliberately buys lossless structure. Optimization occurs only after semantic success.

### Gate 6 — Whole-tuple repair

Enable one repair only after the unrepaired baseline is recorded.

Required:

- only failed selected tuples are sent;
- full tuple is regenerated;
- frozen P output remains byte-identical;
- repaired projection passes all invariants;
- repair does not create new source, grounding, or polarity defects;
- repair frequency and success are reported.

### Gate 7 — Cross-fixture promotion

Run at least five repeats each on:

- F02;
- F03;
- F06;
- a short factual report;
- an opponent-to-rebut fixture;
- an attribution-heavy article;
- a sparse/unresolved-source article;
- a nested-attribution fixture;
- a denial fixture.

Promotion requires:

- no fixture-specific prompt changes;
- stable article-wide capture;
- opponent retention;
- zero confirmed polarity rewrites;
- no systematic treatment/effect collapse;
- no systematic article-voice overuse;
- usable-source-or-correct-abstain ≥70%;
- strong complete-tuple accuracy on central selected items;
- acceptable latency/cost;
- human adjudication confirms a small, legible, non-duplicative portfolio.

Aggregate accuracy alone is never sufficient.

---

## 19. Diagnostics

Required tuple diagnostics:

```text
CF4_LAYER_MISSING
CF4_LAYER_ORDER_INVALID
CF4_LAYER_CHAIN_DISCONTINUITY
CF4_DEPTH_LIMIT_REACHED
CF4_SUBSTANTIVE_NOT_DEEPEST_CONTENT
CF4_REPORTING_RESIDUE_IN_SUBSTANTIVE
CF4_DENIAL_POLARITY_SUSPECTED
CF4_CONTENT_SUPPLIER_MISMATCH
CF4_EXTERNAL_SOURCE_REPLACED_BY_ARTICLE_VOICE
CF4_SOURCE_NAME_KIND_INCOHERENT
CF4_SOURCE_GROUNDING_MISSING
CF4_SUBSTANTIVE_GROUNDING_MISSING
CF4_STRUCTURAL_OWNER_CONFLICT
CF4_ORDINARY_CLAUSE_FALSE_RECURSION
CF4_SELECTED_ID_MUTATED
CF4_FROZEN_FIELD_MUTATED
CF4_TARGET_PROJECTION_INVALID
CF4_TUPLE_UNSTABLE
```

Retain useful CF3 diagnostics for:

- challenged item dropped;
- suspected polarity flip;
- branch concentration;
- near-duplicate portfolio;
- article-quarter concentration.

The old generic source-fusion detector is replaced by structural layer validation. Names and reporting verbs are expected in surface/event fields and forbidden only when the final substantive layer is incomplete.

---

## 20. Explicit prohibitions

Do not reintroduce:

- one assertion string and one source slot as the canonical representation;
- late attribution recovery;
- text cleanup followed by separate source recovery;
- source recovery followed by text reinterpretation;
- whole-article single-pass discovery as the primary path;
- rewrite obligations in D0;
- deterministic semantic portfolio selection;
- pointwise selection;
- per-item challenged boolean replacing a committed challenged section;
- source instructions inside P;
- model-emitted score transform;
- automatic article-voice fallback for unresolved external attribution;
- capitalization candidate fishing on the critical path;
- evidence-anchor extraction in D0, D1, or P;
- cited work treated as content supplier merely because it is evidence;
- blind recursion through arbitrary subordinate clauses;
- unbounded recursive JSON;
- separate assertion-only and source-only repairs;
- fixture-specific examples in executable prompts;
- evidence retrieval inside ClaimFoundry;
- production changes before cross-fixture promotion.

---

## 21. Final success definition

CF4 succeeds only if artifacts prove that it:

1. preserves article-wide capture and opponent recall;
2. preserves the complete surface statement and source units;
3. represents nested attribution as a bounded ordered chain;
4. distinguishes reporting voice from content supplier;
5. preserves the deepest independently evaluable asserted content;
6. preserves denial and original polarity;
7. projects assertion text and source deterministically from the tuple;
8. can deliberately emit substantive, attribution-event, or both targets;
9. never needs a late source-recovery call;
10. never silently collapses incomplete tuples;
11. retains separate substantive and source grounding;
12. selects a small, balanced portfolio comparatively;
13. preserves minority treatment/effect classes;
14. produces reviewable provenance and diagnostics;
15. hands EvidenceRun clean targets without performing evidence search.

The final principle:

> Preserve the discourse structure first. Choose the evaluation target second. Project the production fields last.

This is the causal repair. Everything else is tuning.

---

## 22. First coding-assistant instruction

Implement the first CF4 candidate exactly as specified here.

1. Create `backend/experiments/cf4/` only.
2. Do not modify CF1, CF2, CF3, ER1, or production.
3. Reuse CF3 article preparation, chunking, and D0 merge behavior where compatible.
4. Implement D0 surface capture with the complete prompt/schema in §8.
5. Implement D1 discourse parsing with the complete prompt/schema in §9.
6. Materialize reporting voice from exact article metadata.
7. Compute content supplier only from the deepest attribution layer or, when no layer exists, reporting voice.
8. Preserve unresolved external attribution as unknown.
9. Implement assertion-family grouping without erasing distinct discourse occurrences.
10. Implement P as comparative selection and target judgment only.
11. Implement deterministic substantive and attribution-event projections.
12. Implement all structural tuple invariants and diagnostics.
13. Add frozen D0, tuple, and P replay modes.
14. Record the unrepaired baseline before enabling repair.
15. Implement at most one whole-tuple selected-row repair.
16. Do not implement a source-only call.
17. Keep grounding repair and structural-list ownership separately configurable and fully audited.
18. Do not implement W until the core path passes Gates 0–5.
19. Write immutable artifacts and an editable review packet.
20. Report commands, files changed, artifacts, prompts, schema hashes, model/transport, usage, latency, gate results, complete-tuple metrics, and remaining blockers.

Do not call the architecture solved because it runs. Call it solved only when the staged artifacts demonstrate that the discourse tuple remains lossless and the projected assertion/source pair is correct across fixtures and repeats.
