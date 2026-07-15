# CF1 Phase 9A-4 Source-Block Results

**Status:** Ready for review
**Live integration:** None

## Implementation judgment

The ArticleDocument-native assembler groups complete ordered atoms using structural
signals only. It does not infer thesis, evidence, opponent position, methodology,
or any other argumentative role.

Implemented boundaries include headings, separators, same-page reviewed visual
gaps, structural runs, and bounded readable sizes. Consecutive display headings are
kept together. A heading stays with following content. Page changes alone do not
create boundaries. Nearby short attribution text can remain with a quotation.
Tables, lists, captions, transcript atoms, and social/thread atoms retain their
identities and exact source-unit references.

Every block records exact text/offsets, atom IDs, source-unit IDs, links, structural
type, heading text, and boundary reason. Verification checks ordered references,
non-overlap, text equality, link equality, and complete atom/unit/text coverage.

## Approved fixture renderings

| Fixture | Characters | Blocks | Minimum | Maximum | Result |
|---|---:|---:|---:|---:|---|
| F01 | 37,451 | 16 | 125 | 3,925 | valid |
| F03 | 51,132 | 33 | 188 | 3,495 | valid |
| F05 | 32,791 | 13 | 1,391 | 3,324 | valid |
| F06 | 7,467 | 3 | 1,644 | 2,991 | valid |

The ArticleDocument canonical character counts exactly match all four frozen
fixture texts. Pasted-text list markers are retained rather than silently removed.

F01's frozen text has lost some original PDF layout, so its text rendering cannot
recover every heading. The supplemental raw-PDF rendering demonstrates the layout
path instead of inventing missing structure.

## Supplemental raw F01 PDF

The raw ten-page PDF produces 49,486 canonical characters, 170 atoms, 551 source
units, 15 links, and 55 valid blocks. The blocks comprise 8 heading sections, 29
paragraph groups, and 18 table groups.

Repeated edge removal now handles alternating journal pages. Compact statistical
cells are retained as table structure instead of display headings. The adapter
still reports `layout_with_column_warning`; multi-column/table order remains a
reviewable diagnostic rather than an unqualified claim of perfect reconstruction.

## Deliberate exclusions

- No model prompt or schema changes.
- No automatic semantic labeling.
- No database profile lookup or activation.
- No live scrape or CF1 runtime wiring.
- No EvidenceRun changes.
- No removal of the old compatibility block builder yet.

## Review artifacts

Full Markdown and JSON renderings plus a manifest are under:

`artifacts/claim-foundry/source-blocks/9a4/`
