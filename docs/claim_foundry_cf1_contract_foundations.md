# CF1 Portable Contract — Foundations

**Schema:** `cf1.claimPackage.v1`
**Status:** Phase 1 planning contract
**Scope:** Consumer-neutral article input, ArticleDocument provenance, source/semantic blocks, assertions, article map, and consistency findings.

The Milestone 9A grounding correction in
`claim_foundry_cf1_article_document_contract.md` governs source ownership: model
drafts reference host-created source units and never produce exact excerpts or
offsets. Final packages contain host-derived excerpts and offsets.

## Contract notation

| Mark | Meaning |
|---|---|
| R / O | Required / optional |
| D | Deterministic producer or validator |
| A | Claim Foundry agent producer |
| C | Consumer-supplied |
| P / X | Portable contract / diagnostic-only |

All strings are UTF-8. Unknown values use `null` or an explicit enum; never magic strings. IDs are package-local stable strings unless described otherwise. Arrays default to `[]`, not `null`.

## 1. Article input

`CF1ArticleInput` is the portable request payload. A consumer may provide its own reference, but no VeriStrata database field is required.

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `consumerContentRef` | O | string | 200 | C; consumer identity only | P |
| `title` | R | string | 1,000 | C; persisted/visible title | P |
| `text` | R | string | 500,000 chars | C; article body | P |
| `url` | O | absolute URL string | 4,000 | C; canonical input URL | P |
| `publisher` | O | string | 500 | C; persisted metadata | P |
| `authors` | R | string[] | 20 × 300 | C; persisted metadata | P |
| `publishedAt` | O | ISO-8601 string | 40 | C; persisted metadata | P |
| `language` | O | BCP-47 string | 35 | C or D detection | P |
| `observedHeadline` | O | string | 1,000 | C/D; visible headline | P |
| `metadataWarnings` | R | string[] | 20 × 500 | C/D; never silent correction | P |
| `contentHash` | R | lowercase SHA-256 | 64 | D; normalized `title + text` | P |

Rules:

- CF1 consumes metadata but does not overwrite consumer metadata.
- Empty/boilerplate text is a blocking validation error.
- CF1 performs no URL fetch during package creation.

## 2. Semantic block

`CF1SemanticBlock` preserves structural grounding and agent interpretation.

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `blockId` | R | `B` + 3 digits | 4 | D; article order | P |
| `order` | R | integer ≥ 0 | 10,000 | D; article order | P |
| `heading` | O | string | 500 | D; source structure | P |
| `text` | R | string | 30,000 | D; exact article span | P |
| `structuralType` | R | `heading_section`, `paragraph_group`, `quotation`, `list`, `caption`, `other` | — | D | P |
| `semanticFunction` | R | `thesis_framing`, `background`, `chronology`, `endorsed_assertion`, `opponent_position`, `rebuttal`, `evidence_example`, `study_document_description`, `methodology_criticism`, `causal_explanation`, `qualification`, `policy_conclusion`, `anecdote`, `call_to_action`, `mixed`, `unclear` | — | A; article interpretation | P |
| `articleStance` | R | `endorses`, `opposes`, `reports`, `mixed`, `unclear` | — | A | P |
| `speakerEntities` | R | string[] | 20 × 300 | A, grounded in block | P |
| `sourceAtomIds` | R | atom ID[] | 100 | D; structural membership | P |
| `sourceUnitIds` | R | unit ID[] | 200 | D; exact grounding membership | P |
| `sourceOffsets` | R | `{start,end}` integers | within text | D; original article text | P |
| `relatedBlockIds` | R | block ID[] | 30 | A; package references | P |
| `confidence` | R | number 0–1 | — | A | X |

Rules:

- Concatenated block text must be traceable to the supplied article.
- Structural fields are deterministic; semantic fields are agent-produced.
- Later analysis may revise semantic labels but never offsets or source text.

## 3. Raw assertion

`CF1RawAssertion` is a grounded working assertion. It is never a direct EvidenceRun input or Workspace-visible claim.

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `rawAssertionId` | R | `R` + 3 digits | 4 | D after agent output | P |
| `text` | R | string | 2,000 | A; faithful proposition | P |
| `sourceUnitIds` | R | unit ID[] | 20 | A reference, validated D | P |
| `sourceBlockIds` | R | block ID[] | 10 | D; derived from source units | P |
| `sourceSpans` | R | grounded span[] | 20 | D; exact contiguous unit groups | P |
| `sourceExcerpt` | R | string | 3,000 | D; first-span compatibility display | P |
| `sourceOffsets` | R | `{start,end}`[] | 20 | D; one range per source span | P |
| `speakerEntity` | O | string | 300 | A; grounded in source | P |
| `assertionForm` | R | `direct`, `attributed`, `quoted`, `statistical`, `causal`, `comparison`, `study_document`, `legal_policy`, `inference`, `background`, `other` | — | A | P |
| `articleUse` | R | `endorsed`, `opponent_to_rebut`, `rejected`, `reported`, `background`, `qualification`, `unclear` | — | A | P |
| `namedEntities` | R | string[] | 30 × 300 | A; article-grounded | P |
| `namedWorks` | R | string[] | 20 × 500 | A; article-grounded | P |
| `numbersAndDates` | R | string[] | 20 × 100 | A; article-grounded | P |
| `reconciliation` | R | object | one | A proposal + D validation | P |

`reconciliation`:

```json
{
  "canonicalRawAssertionId": "R004",
  "relationship": "unique|same_proposition|restatement|narrower|broader|qualifies|contradicts|context_differs",
  "relatedRawAssertionIds": [],
  "rationale": ""
}
```

`rationale` is limited to 1,000 characters. Reconciliation never deletes an occurrence.

The agent draft contains `sourceUnitIds` but omits `sourceBlockIds`,
`sourceSpans`, `sourceExcerpt`, and `sourceOffsets`. Package assembly adds them
deterministically. A grounded span contains `sourceUnitIds`, exact `text`, `start`,
and `end`; nonadjacent units remain separate spans. Unknown, cross-document, or
incompatible unit references are blocking errors.

## 4. Article map

`CF1ArticleMap` is the final, revisable interpretation used for claim selection.

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `theme` | R | string | 1,000 | A; whole article | P |
| `thesis` | R | mapped proposition | one | A; grounded references | P |
| `pillars` | R | pillar[] | 12 | A | P |
| `clusters` | R | cluster[] | 30 | A | P |
| `opponentPositions` | R | mapped proposition[] | 12 | A | P |
| `qualifications` | R | mapped proposition[] | 12 | A | P |
| `mapWarnings` | R | string[] | 20 × 500 | A/D | X |

Mapped proposition:

```json
{
  "text": "",
  "sourceBlockIds": [],
  "rawAssertionIds": []
}
```

Pillar extends mapped proposition with `pillarId` (`P01`–`P12`), `label` (200 chars), and `importance` (`load_bearing`, `major`, `supporting`). Cluster has `clusterId`, `label`, `rawAssertionIds`, and `relationship` (`same_event`, `same_proposition_family`, `reasoning_chain`, `source_family`, `other`). Every referenced ID must resolve.

## 5. Internal-consistency finding

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `findingId` | R | `IC` + 2 digits | 4 | D after agent output | P |
| `type` | R | `direct_contradiction`, `scope_shift`, `association_causation_shift`, `attribution_fact_shift`, `numeric_conflict`, `identity_conflict`, `chronology_conflict`, `qualification_loss`, `standard_inconsistency`, `thesis_pillar_conflict`, `apparent_resolved` | — | A | P |
| `blockIds` | R | block ID[] | 12 | A, validated D | P |
| `rawAssertionIds` | R | raw ID[] | 12 | A, validated D | P |
| `description` | R | string | 2,000 | A | P |
| `materiality` | R | `high`, `medium`, `low` | — | A | P |
| `resolution` | R | `unresolved`, `resolved_by_context`, `unclear` | — | A | P |
| `resolutionRationale` | R | string | 1,000 | A | P |
| `selectionRelevance` | R | `hinge`, `supporting`, `none` | — | A | P |

Deterministic code may flag number, date, scope, or polarity candidates, but only the agent produces a semantic finding.
