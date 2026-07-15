# CF1 ArticleDocument and Grounding Contract

**Milestone:** 9A-1
**Status:** Implemented through Phase 9A-3 amendment
**Schema name:** `cf1.articleDocument.v3`

## Purpose

`ArticleDocument` is the deterministic boundary between acquired source material
and Claim Foundry reasoning. It preserves readable content, document structure,
links, and exact provenance without assigning argumentative meaning.

CF1 receives structure-aware source blocks built from this document. CF1 decides
what the blocks mean. The host derives exact excerpts and offsets.

## Input variants

One of these source descriptors is required:

| Kind | Required material | Optional material |
|---|---|---|
| `html` | captured or fetched HTML | source URL, response metadata |
| `pdf` | PDF bytes or layout-aware extraction | PDF metadata, source URL |
| `text` | pasted or previously canonical text | title and origin warning |

`sourceKind` describes mechanics, not editorial form. A provider-neutral
`sourceFamily` separately records `article`, `document`, `plain_text`, `transcript`,
`social_post`, `social_thread`, or a validated future namespaced family. YouTube, X,
and Facebook are scopes/providers, not source families.

Acquisition, publisher, author, and title detection remain shared upstream platform
responsibilities. The ArticleDocument adapter consumes their output and does not
fetch or persist anything.

## ArticleDocument

```json
{
  "schemaVersion": "cf1.articleDocument.v3",
  "sourceKind": "html",
  "sourceFamily": "article",
  "adapterIdentity": {
    "adapterId": "cf1.adapter.html-dom",
    "adapterVersion": "2"
  },
  "structureProfile": {
    "profileId": "cf1sp-default-article",
    "version": 1,
    "profileHash": "lowercase-sha256"
  },
  "canonicalText": "Section title\n\nThe first paragraph.",
  "atoms": [],
  "sourceUnits": [],
  "links": [],
  "citationMarkers": [],
  "references": [],
  "metadata": {},
  "diagnostics": {},
  "contentHash": "lowercase-sha256"
}
```

| Field | Owner | Rule |
|---|---|---|
| `schemaVersion` | host | Exact supported version |
| `sourceKind` | host | `html`, `pdf`, or `text` |
| `sourceFamily` | host/caller | Provider-neutral content shape; extensible identifier |
| `adapterIdentity` | host | Exact deterministic adapter ID and version |
| `structureProfile` | host | Exact reviewed profile ID, version, and payload hash |
| `canonicalText` | host | Built from ordered atoms |
| `atoms` | host | Complete structural atom inventory |
| `sourceUnits` | host | Addressable grounding units within atoms |
| `links` | host | Content-scoped outbound link inventory |
| `citationMarkers` | host | Text-visible citation occurrences and deterministic resolution |
| `references` | host | Footnote, endnote, and bibliography entries preserved as sidecars |
| `metadata` | upstream/host | Supplied metadata; never agent-corrected |
| `diagnostics` | host | Transformations, warnings, and degraded modes |
| `contentHash` | host | Hash of canonical title and canonical text |

## Atom

An atom is the smallest source structure preserved before argumentative analysis.

```json
{
  "atomId": "A0017",
  "order": 16,
  "type": "paragraph",
  "text": "The first paragraph.",
  "sourceOffsets": { "start": 15, "end": 35 },
  "layoutSignals": {},
  "linkIds": [],
  "diagnosticFlags": []
}
```

Allowed initial types:

- `heading`
- `paragraph`
- `quotation`
- `list_item`
- `table`
- `table_row`
- `caption`
- `code_or_preformatted`
- `speaker_turn`
- `timestamp`
- `social_post`
- `social_reply`
- `thread_separator`
- `separator`
- `unknown`

`layoutSignals` may contain deterministic observations such as HTML tag,
heading level, bold/emphasis proportion, PDF page, font-size ratio, indentation,
alignment, vertical gap before/after, and repeated-header/footer candidacy. Missing
layout information is `null` or absent; it is never invented.

Reserved transcript/social signals include speaker, timestamp milliseconds, post
ID, author, reply target, thread position, and thread depth. These are deterministic
source observations, not assertions about argumentative meaning.

## Source unit

A source unit is the exact address the model may cite. It belongs to one atom and
one eventual source block.

```json
{
  "unitId": "U0042",
  "atomId": "A0017",
  "order": 41,
  "type": "sentence",
  "text": "The first paragraph.",
  "sourceOffsets": { "start": 15, "end": 35 }
}
```

Allowed initial unit types are `sentence`, `heading`, `quotation`, `list_item`,
`table_row`, `caption`, `paragraph`, and `other`. Sentence splitting is not forced
for tables, malformed PDF text, abbreviations with unsafe boundaries, or other cases
where a larger exact unit is safer.

Unit text must equal `canonicalText.slice(start, end)`. Units are ordered,
non-overlapping within an atom, and must cover its meaningful text. Whitespace
between units remains host-owned and need not become a unit.

## Link

```json
{
  "linkId": "L0012",
  "url": "https://example.org/study",
  "normalizedUrl": "https://example.org/study",
  "originalHref": "https://example.org/study",
  "anchorText": "the published study",
  "atomId": "A0017",
  "unitId": "U0042",
  "startOffset": 4,
  "endOffset": 23,
  "relation": "inline_link",
  "classification": "content_link",
  "diagnosticFlags": []
}
```

The ArticleDocument inventory retains content-body links before downstream citation
filtering. Navigation, advertising, and document-chrome links may be excluded with a
recorded diagnostic rule. Link classification does not claim evidentiary value.
Visible URL text remains part of canonical text; an HTML `href` need not be inserted
into prose.

## Citation and reference sidecars

HTML adapters preserve text-visible citation structure without injecting markup or
URLs into `canonicalText`:

```json
{
  "markerId": "CM012",
  "displayText": "12",
  "kind": "superscript",
  "atomId": "A0017",
  "unitId": "U0042",
  "startOffset": 23,
  "endOffset": 25,
  "targetFragment": "ref-12",
  "resolvedReferenceId": "REF012",
  "diagnosticFlags": []
}
```

```json
{
  "referenceId": "REF012",
  "label": "12",
  "text": "DeStefano F, et al. ...",
  "atomId": "A0198",
  "sourceUnitId": "U0312",
  "elementKeys": ["ref-12"],
  "backlinkTargets": [],
  "linkIds": ["L0017"],
  "markerIds": ["CM012"],
  "diagnosticFlags": []
}
```

Atoms contain `citationMarkerIds` and `referenceIds`. Source units contain
`linkIds`, `citationMarkerIds`, and `articleReferenceIds`. Fragment IDs and
superscript/numeric markers are resolved structurally. Author-year markers without
a structural target and broken fragments remain visible with diagnostics rather
than being guessed. Citation meta tags and article JSON-LD are retained in
`metadata.bibliographicMetadata`; malformed JSON-LD is non-blocking.

Navigation, sharing, login, advertisement, mail, script, and other non-retrieval
links are excluded or classified before package retrieval leads are created.

## Canonical-text rules

1. Canonical text is assembled once from atoms in source order.
2. Atom text and offsets are assigned during that assembly.
3. Source units are segmented only after atom offsets are final.
4. Safe normalization includes line endings, Unicode normalization, soft hyphens,
   and deterministic whitespace between structural atoms.
5. PDF dehyphenation or wrapped-line joining requires an explicit deterministic
   rule and diagnostic count.
6. No normalization may paraphrase, summarize, change numbers, change entities,
   remove qualifiers, or alter attribution.
7. Page headers/footers may be removed only through repeatable document-level rules
   and must be reported in diagnostics.
8. Tables and captions remain identifiable even when their readable text is also
   present in canonical text.

## Source blocks

Source blocks are ordered groups of complete atoms. They are not deterministically
declared thesis, background, methodology, or conclusion.

Each source block contains:

- `blockId`;
- order;
- exact canonical text and offsets;
- contributing `atomIds`;
- contributing `sourceUnitIds`;
- structural type and boundary reason;
- heading text when structurally present; and
- link IDs in or adjacent to the block.

Implemented Phase 9A-4 blocks use this exact deterministic shape:

```json
{
  "blockId": "B001",
  "order": 0,
  "heading": "Methods",
  "text": "Methods\n\nThe study compared...",
  "structuralType": "heading_section",
  "sourceOffsets": { "start": 0, "end": 31 },
  "atomIds": ["A0001", "A0002"],
  "sourceUnitIds": ["U0001", "U0002"],
  "linkIds": [],
  "boundaryReasons": ["document_start"]
}
```

Allowed structural types are `heading_section`, `paragraph_group`, `quotation`,
`list`, `table`, `caption`, `transcript`, `social_thread`, `mixed`, and `other`.
Boundary reasons are host observations, not argumentative classifications.

The host may use headings, paragraph gaps, emphasis, font size, section labels,
lists, tables, captions, quotations, repeated headers/footers, link proximity, and
size ceilings as boundary signals. The host does not use article-specific entities
or infer argumentative roles.

The ArticleDocument-native implementation lives beside the old normalized-text
block builder during 9A. It is not yet wired into prompts or live execution. That
consumer switch is explicit later work; silent mixed use is prohibited.

## Model input and output ownership

The model receives source blocks containing atom/unit IDs and readable text. It may
produce semantic block annotations, assertions, the article map, consistency
findings, selected claims, targets, and Evidence Need Cards.

A raw assertion returns `sourceUnitIds`. It does not return `sourceExcerpt` or
`sourceOffsets`. It may also reference containing `sourceBlockIds`, but the host
validates or derives those IDs from the units.

Selected claims and Phase 3 targets return `sourceRawAssertionIds`. Their block,
unit, excerpt, and offset provenance is inherited deterministically. A selected
claim that combines assertions inherits the ordered union of their source units.

The final package represents complete grounding as `sourceSpans`. Each span is a
contiguous ordered group of source units with exact text and offsets. Adjacent units
may be coalesced; nonadjacent units remain separate spans. `sourceExcerpt` is a
compatibility/display field derived from the first span, never the complete source
of truth when multiple spans exist.

## Package assembly

After model output:

1. Validate every returned unit and assertion reference.
2. Derive containing atom and block IDs.
3. Derive exact `sourceSpans` from canonical units.
4. Derive compatibility excerpts and offsets from those spans.
5. Assign canonical package-local IDs.
6. Verify attribution, target posture, cards, references, and package invariants.
7. Permit at most one semantic repair.
8. Persist only a fully valid immutable package.

Unknown, ambiguous, cross-document, reordered, or incompatible unit references are
blocking errors. The verifier never substitutes a semantically similar passage.

## Fixture compatibility

The eight approved `article.json` texts and hashes remain frozen. For comparison,
their ArticleDocuments are derived deterministically from that canonical text; the
approved article content is not rewritten.

Separate raw-source fixtures test HTML/PDF/text adapters and may include expected
atoms, units, links, offsets, and diagnostics. Those ingestion fixtures do not alter
the blind comparison corpus.

## Final live-path requirement

This contract is initially implemented outside live scrape calls for controlled
testing. That isolation is temporary. Milestone 9B must route every live task-claim
entry point through this one CF1 boundary, prove the complete end-to-end path, and
remove old live claim-producer call sites. Silent legacy fallback is prohibited.

## Phase 9A-1 acceptance

- ArticleDocument and every child object have a deterministic owner.
- Canonical text is built from atoms and fully traceable.
- Source units provide exact model-addressable provenance.
- The model owns neither excerpts nor offsets.
- Selected claims and targets inherit raw-assertion grounding.
- Frozen comparison content remains unchanged.
- Shared acquisition/metadata services are reused rather than copied.
- Final CF1-only live cutover is an explicit Milestone 9B gate.
