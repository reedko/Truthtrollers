# CFX production extraction and ranked acquisition repair

Date: 2026-08-02
Status: implemented offline; governed live validation awaiting exact authorization

## What production already did

The existing scrape system was not a single generic HTML fetch.

1. Extension Add/Scrape (`extension/src/services/orchestrateScrapingExtension.ts`)
   detects PDFs and YouTube, captures the current DOM for ordinary pages, runs
   Readability/manual fallbacks, and sends text plus metadata to the backend.
2. Extension retry/browser assist (`extension/src/background.js`) detects PDF
   viewer/download URLs, parses browser-accessible PDF blobs through
   `/api/parse-pdf-blob`, extracts Facebook post/container/source provenance,
   captures compact article HTML for ordinary pages, and submits the result to
   `/api/scrape-reference`.
3. Backend task scraping (`backend/src/core/scrapeTask.js`) resolves readable
   text, title, authors, publisher identity, thumbnail, DOM references, and
   inline references before claim extraction.
4. Backend reference scraping (`backend/src/core/scrapeReference.js`) resolves
   the corresponding evidence-document metadata and text before reference
   claim extraction or the CFX acquisition-only return.
5. Academic evidence already has a structured resolver
   (`backend/src/core/academicContentResolver.js`) for PMID, DOI, PubMed, and PMC.
6. Existing PDF extraction exists in the extension blob route,
   `fetchExternalPageContent.js`, and the legacy Evidence Engine's
   `extractPdfTextWithFallback()` path.

The defect was that `cfxAutomaticAcquisition.js` had become a parallel,
Readability-only extraction path and `fetchWithFallbacks.js` could reject raw
HTML by keyword before production extraction ran.

## Implemented repair

### Shared production extraction seam

`backend/src/core/productionDocumentExtraction.js` now composes the existing
production utilities:

- Readability;
- the task scraper's Substack, journal, article, post, entry, main, and content
  selector cascade;
- `getMainHeadline()`;
- `extractAuthors()` and `mergeAuthors()`;
- `processPublishingIdentity()`;
- `getBestImage()`;
- `extractInlineRefs()`;
- `extractPdfTextWithFallback()` and the production PDF metadata pipeline.

It does not fetch URLs and is not a replacement scraper. Task scraping,
reference scraping, `fetchExternalPageContent()` PDF parsing, and CFX automatic
acquisition now use this shared seam.

Raw HTML is retained and passed to extraction before validation. Challenge
detection now requires structural challenge markup or a small page with no
article/main structure; a legitimate article containing words such as
"CAPTCHA" or "are you a robot" is not rejected.

### Acquisition ladder

The connected CFX automatic order is:

Scholarly:

1. provider-supplied full text, when present;
2. academic resolver (PMID/DOI/PubMed/PMC);
3. publisher HTML or content-type-detected PDF;
4. alternate canonical, repository, accepted-manuscript, and preprint URLs;
5. Wayback;
6. one bounded headless attempt;
7. production extension/browser-assist queue only after automatic failure;
8. snippet/metadata state when no better text exists.

General web:

1. provider-supplied full text, when present;
2. ordinary direct fetch and production extraction;
3. bounded direct retry;
4. alternate canonical URLs;
5. Wayback;
6. one bounded headless attempt;
7. production extension/browser-assist queue only after automatic failure;
8. snippet/metadata state when no better text exists.

`page.waitForTimeout()` was replaced with a supported bounded delay. Wayback
and headless remain separate, forensically recorded tiers.

### Active candidate selection

The production selector is again assertion-specific search rank:

1. find each canonical document's earliest discovery assignment for the case
   assertion;
2. order by `queryId`, then retrieval rank, then stable canonical document key;
3. select the first five unique canonical documents for that assertion;
4. preserve every discovery assignment;
5. canonical-deduplicate only the cross-assertion acquisition union.

The snippet pre-bearing score remains an offline diagnostic artifact. It does
not remove, substitute, reorder, block, or assign bearing to candidates.

## Frozen two-assertion preflight

Frozen pool: 169 canonical CF1-F03 documents.
Targets: P54895 and P54897.
Selected: five per assertion.
Canonical union: 10 documents.

P54895 retains the known-good PMC article as ranked candidate five:

- `https://pmc.ncbi.nlm.nih.gov/articles/PMC6768751`

Preflight artifacts:

- `artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-acquisition-20260802035425/preflight.json`
- `artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-acquisition-20260802035425/ranked_selection.json`
- `artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-acquisition-20260802035425/prebearing_diagnostics_only.json`

The preflight made no external or model calls and changed no production data.

## Offline verification

- `npm run verify:cfx`: 155 tests; 151 passed; 4 real-MySQL tests skipped by
  their explicit environment gate; 0 failed.
- `node --test test/utils/fetchWithFallbacks.test.js`: 6/6 passed.
- `npm run build:cfx`: passed.

The governed execution runner is:

```bash
npm run run:cfx:ranked-acquisition
```

It refuses `--execute` unless `CFX_LIVE_AUTHORIZATION` exactly equals the
authorization sentence embedded in the runner. The artifact-only run excludes
SourceCrest/publisher enrichment and records those model-call and token totals
as zero. Production SourceCrest remains in the production pipeline; its current
evaluation is deterministic/provider-signal based rather than an OpenAI call.
