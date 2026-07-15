# CF1 Existing-Wheel Reuse and Retirement Map

**Milestone:** 9A-2
**Status:** Ready for review
**Scope:** Source acquisition through CF1 ArticleDocument input; EvidenceRun excluded

## Decision

VeriStrata already acquires HTML/PDF/text, extracts metadata and links, and converts
content to text. CF1 will reuse that acquisition infrastructure but replace the
point where structure is flattened. There will be one CF1 ArticleDocument builder
and one source-block assembler. Existing competing cleaners and sectioners are
either inputs to that implementation or retirement candidates.

Final live flow:

```text
extension/fetch/PDF parser
        -> shared acquired source + metadata
        -> CF1 ArticleDocument
        -> durable canonical source
        -> CF1 source blocks
        -> Claim Foundry package
```

## Disposition labels

- **SHARED:** authoritative upstream service; CF1 consumes it without copying.
- **REFACTOR:** useful behavior moves behind the one CF1 input boundary.
- **ADAPT:** keep the component but change its output to preserve structure.
- **RETIRE:** remove from live use after CF1 cutover.
- **REJECT:** do not carry the behavior into general CF1 logic.
- **EVIDENCE:** outside CF1 task-article production; leave untouched now.

## Browser and acquisition inventory

| Component | Current behavior | Disposition | Required action |
|---|---|---|---|
| `extension/src/services/scrapeContent.ts` | Sends the current page DOM to `/api/scrape-task` | SHARED | Keep as the primary browser acquisition path; pass captured HTML intact |
| `extension/src/background.js:extractCompactPageForScrape` | Selects a large body-like node; returns 120k text but only 30k article HTML | ADAPT | Stop losing late-page structure; use explicit payload/budget failure rather than mismatched text/HTML truncation |
| PDF blob handling in `extension/src/background.js` | Fetches PDF bytes and calls `/api/parse-pdf-blob` | SHARED | Keep byte acquisition; consume one canonical PDF extraction result |
| `backend/src/utils/fetchPageContent.js` and fetch fallbacks | Fetch HTML when browser DOM is unavailable | SHARED | Keep transport/fallback behavior |
| `backend/src/utils/fetchExternalPageContent.js` | Fetches HTML; for PDFs also parses and wraps flattened text in HTML | REFACTOR | Keep fetch and metadata behavior; stop disguising PDF text as HTML; return typed source material |
| YouTube transcript acquisition | Produces transcript text | SHARED | Use `sourceKind: text`, `sourceFamily: transcript`, and an exact reviewed StructureProfile; platform acquisition stays upstream |
| Facebook post capture | Captures post HTML/text and source provenance | SHARED | Preserve as social-source acquisition; use the text adapter for a post, not article-body rules |

The older `orchestrateScrapingExtension.ts` and
`orchestrateScrapingDashboard.ts` contain another complete cleaning/Readability
stack. Current task scraping uses `scrapeContent.ts`; no active call site to either
orchestrator was found. Mark both as RETIRE candidates after a build/import audit.

## HTML extraction inventory

| Component | Useful behavior | Problem | Disposition |
|---|---|---|---|
| `scrapeTask.js:cleanForReadability` | Removes scripts, ads, overlays, navigation, and recirculation | Private duplicate; later `.text()` erases tags and boundaries | REFACTOR cleanup rules into CF1 HTML adapter |
| `scrapeTask.js` selector cascade | Site-aware Substack/journal selectors plus generic article roots | First acceptable selector wins; `.text()` flattens headings, links, paragraphs, tables, and quotes; 60k truncation | REFACTOR root candidates and diagnostics; RETIRE its text flattener |
| `/api/extract-readable-text` | Mozilla Readability body selection and text | Returns only `textContent`; loses the parsed article HTML | ADAPT internally or retire once CF1 HTML root selection is proven |
| `/api/extractText` | Second Mozilla Readability route returning HTML and text | Duplicates the other route and may fetch independently | RETIRE after callers move to the canonical acquisition/input path |
| `ArticleBodyExtractor` | Scores roots, removes junk, retains `bodyHtml`, reports diagnostics | Coarse scoring; audit-only; duplicates live cleaning | REFACTOR useful root scoring and diagnostics into CF1 HTML adapter |
| `smartCleanHTMLForReadability` | Removes scripts/styles | Removes figures and captions, which CF1 must preserve | REJECT figure/caption removal; retire duplicate cleaner |
| `extractArticleRootHTML` | Scores selectors by paragraph count and characters | Separate extension-side body decision; fallback truncates HTML at 64k | RETIRE as claim-input authority after backend CF1 root selection is live |

CF1 HTML output must preserve headings, paragraphs, emphasis, lists, blockquotes,
tables, captions, and content links before canonical text is assembled.

## PDF extraction inventory

| Component | Current behavior | Disposition | Required action |
|---|---|---|---|
| `pdf-parse` 1.1.1 | Produces text, page count, metadata | SHARED dependency | Use a custom page renderer to retain text-item layout side data |
| `/api/parse-pdf-blob` | Parses browser-provided bytes; strips XMP; collapses excess newlines; extracts identity | ADAPT | Return one typed PDF extraction containing text items/layout plus metadata |
| `/api/fetch-pdf-text` | Fetches and independently performs nearly the same parse/cleanup | REFACTOR | Share the same PDF extraction function; retain transport-only distinction |
| `fetchExternalPageContent` PDF branch | Third PDF parse path with less cleanup | RETIRE parser duplication | Delegate to the canonical PDF extractor |
| `pdfIdentityExtractor` and publishing identity pipeline | Extract title, authors, venue, DOI/ISSN, publisher | SHARED | Keep authoritative identity behavior; attach results as metadata |

The installed `pdf-parse` exposes PDF.js text items through a custom `pagerender`.
Those items include coordinates, dimensions, transforms, and font identifiers. CF1
can derive line grouping, relative font size, indentation, alignment, vertical gaps,
and repeated header/footer candidates. Font weight is not guaranteed and must be a
nullable observation. PDF annotations must be inspected separately for embedded
links; visible URLs in text alone are insufficient.

Column order, tables, scanned/image-only pages, and ambiguous font metadata must
produce diagnostics. No adapter may claim layout fidelity it did not obtain.

## Pasted and persisted text

| Component/path | Current behavior | Disposition |
|---|---|---|
| `/api/scrape-task` `raw_text` mode | Uses text directly and begins old claim production | ADAPT to CF1 text ArticleDocument; RETIRE old producer call |
| `/api/submit-text` | Saves the full text file; stores only a 500-character `details` preview | SHARED file persistence temporarily; ADAPT to canonical ArticleDocument |
| `validateArticleInput` | Normalizes line endings and outer whitespace; hashes title/text | SHARED CF1 validation concept; hash the finalized canonical text |
| Frozen `article.json` fixtures | Approved canonical text without raw layout | SHARED comparison inputs; build deterministic text atoms without changing hashes |

Pasted text must preserve intentional paragraph gaps, headings, lists, and quoted
blocks when visible. It must not receive invented HTML or PDF layout signals.

## Structure and block inventory

| Component | Reuse | Retirement/rejection |
|---|---|---|
| `ArticleSectioning.extractBlocks` | Tag inventory; heading/bold/quote/list/caption observations; heading-with-content and quote-cluster principles | Move useful atom logic into CF1; retire audit class after replacement |
| `ArticleSectioning.buildSections` | Minimum/target/maximum sizes and boundary reasons | Reject vaccine-specific entities and transition phrases; reject overlapping blocks for one-call CF1 |
| CF1 `structuralBlocks.js` | Sequential IDs, exact offset coverage, hard maximum, verification | Replace blank-line/type-only proposal with atom-based source blocks; retain verification principles |
| TM4 section extraction calls | None | RETIRE as a live claim-production strategy; CF1 typical path remains one full-article call |

The host proposes structural source blocks only. CF1 assigns argumentative roles.

## Link inventory

| Component | Current behavior | Disposition |
|---|---|---|
| `extractReferences.js` | Content-scoped DOM and JSON-LD references; requires citation cues; excludes hosts; caps at 30 | Keep as downstream filtered-reference compatibility; refactor common URL resolution |
| `extractInlineRefs.js` | Finds selected academic URL patterns in text; caps at 20 | Keep compatibility output; use a broader ArticleDocument inventory not subject to this citation cap |
| HTML anchors | Available before `.text()` flattening | CF1 adapter records every content-body anchor with atom/unit proximity |
| PDF links | Only visible URLs currently survive | Canonical PDF adapter also inspects link annotations and records page/unit proximity |

ArticleDocument link capture does not declare evidence value. Existing citation
filters may consume the inventory later; EvidenceRun behavior is unchanged now. The
inventory remains bounded by reviewed ArticleDocument safety limits, with explicit
input rejection rather than silent first-N loss.

## Critical persistence gap

Ordinary `scrapeTask` persists only `rawText.slice(0, 500)` in `content.details` and
passes the full article transiently to `processTaskClaims`. It does not persist the
task's full `content_text`. The existing CF1 shadow loader correctly refuses to use
`details` and therefore cannot reload many ordinary task articles.

`content.content_text` is currently `TEXT` with an approximately 65KB capacity,
while the CF1 article contract allows 500,000 characters. This is not a safe durable
source for every CF1 input without a reviewed schema/persistence decision.

Before live cutover, VeriStrata must durably store the complete canonical
ArticleDocument (or an immutable database-backed canonical representation) before
asynchronous CF1 execution. A failed run and an idempotent retry must reload exactly
the same canonical input without re-scraping and without using `details`.

## Old claim producer and route inventory

`processTaskClaims` is the old live producer. It performs frame detection, fixed
6,000-character survey chunks, theme fusion, clustering, reduction, repair, and
persistence. After final cutover no task-article route may call it.

Confirmed task-claim callers requiring 9B treatment:

- `/api/scrape-task`;
- `/api/submit-text`;
- Facebook task-post processing;
- TTL/live thread text processing; and
- any incremental route that creates task claims.

Calls used only to extract claims from evidence references are EvidenceRun concerns
and are not modified in CF1 9A/9B. They must be separately classified during ER1;
they cannot justify retaining `processTaskClaims` on the task-article live path.

## Phase 9A-2 acceptance judgment

- One CF1 ArticleDocument boundary is confirmed; no new scraper stack is planned.
- Useful HTML/TM4 structural ideas are assigned to refactoring, not duplication.
- PDF layout can be captured through the existing dependency with explicit limits.
- Link capture is separated from later evidence filtering.
- All known truncation and structure-loss points are recorded.
- Full canonical persistence and retry are explicit cutover blockers.
- Old task-claim callers are identified for removal in 9B.
- No EvidenceRun behavior or live production code changes in this phase.
