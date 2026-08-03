# CFX evidence-text acquisition reuse audit R0

No model, retrieval, scrape, browser, PDF, DOI, PubMed, PMC, or Wayback call
was made during this audit.

## Safe to reuse unchanged

| File | Export | Existing tests | Decision |
|---|---|---|---|
| `backend/src/core/academicContentResolver.js` | `detectAcademicIdentifiers` | `backend/test/bearing/academicContentResolver.test.js` | Reuse for literal DOI, PMID, and PMCID detection. |
| `backend/src/core/academicContentResolver.js` | `parsePubmedArticleXml` | `backend/test/bearing/academicContentResolver.test.js` | Reuse for PubMed abstract parsing. |
| `backend/src/core/academicContentResolver.js` | `parsePmcFullTextXml` | `backend/test/bearing/academicContentResolver.test.js` | Reuse for PMC full-text parsing. |
| `backend/src/core/academicContentResolver.js` | `fetchAcademicApiContent` | `backend/test/bearing/academicContentResolver.test.js` | Reuse behind a CFX adapter for DOI → PMID, PubMed, PMC, and Crossref acquisition. |
| `backend/src/claimfoundry/cfx/artifacts/immutableArtifacts.ts` | immutable writers, tree hashing, tree freezing | exercised throughout `backend/test/claimfoundry/cfx` | Reuse unchanged for forensic artifacts. |
| `backend/src/claimfoundry/shared/provider/index.ts` | `createOpenAiCf7StructuredProvider` and structured-provider types | exercised by CF7/CFX runner tests | Reuse unchanged for the eventual governed targeted-extraction calls. |

## Requires a small forensic adapter

| File | Existing behavior | Required adapter |
|---|---|---|
| `backend/src/utils/fetchWithFallbacks.js` | Axios → headless Puppeteer → Wayback | Add per-attempt hooks/results. The current return value records only the successful terminal method and discards failed-attempt detail. |
| `backend/src/utils/fetchExternalPageContent.js` | PDF parsing and HTML fallback | Return exact extracted text, content type, status, character count, and every lower-level attempt without invoking claim extraction. |
| `backend/src/services/publisherEnrichmentService.js` | Internal Readability extraction | Extract the Readability text function into neutral shared infrastructure; it is not currently exported. |
| `backend/src/core/scrapeReference.js` and the production scrape-job routes | Botwall detection, extension/browser recovery, content persistence, and live retry transitions | EvidenceRun must become a bound client of this production flow. Add an acquisition-only persistence branch so EvidenceRun does not trigger legacy claim extraction or model calls. |
| `backend/services/sourceLineageResolver.js` | Detects `original`, `excerpt`, `repost`, `syndicated`, `pointer`, and `archive`; persists `source_lineage_cache` | Reuse the vocabulary and persistence. Add focused tests and preserve requested/resolved URLs because current redirect handling is incomplete. |
| `extension/src/background.js` | Polls and claims production scrape jobs, extracts the visible tab/PDF, and completes or fails the job | Reuse the job worker. Add job-to-tab correlation and carry requested plus redirect-resolved URLs. |
| `dashboard/src/components/ScrapeReferenceModal.tsx` and `ReferenceModal.tsx` | Existing failed-source UI, normal-tab handoff, retry submission, and terminal-status display | Extend minimally with EvidenceRun context and candidate-local snippet/skip actions; do not add another CFX recovery modal. |

## Do not reuse for this stage

| File | Reason |
|---|---|
| `backend/src/evidence-run/candidateTriage.js` | Performs token-overlap scoring and semantic pre-fetch ranking shaped for the older EvidenceRun contract. |
| `backend/src/evidence-run/candidatePortfolioSelector.js` | Imports old EvidenceRun selection state and utility scoring; CFX must not inherit that orchestration. |
| `backend/src/core/evidenceEngine.js` | Mixes acquisition with legacy selection, scoring, bearing, and orchestration. |
| `backend/src/core/postScrapeBearing.js` and related bearing scorers | Perform the semantic judgment that the new targeted, excerpt-grounded stage is intended to govern explicitly. |
| `backend/src/core/scrapeReference.js` as a whole | Includes database persistence and downstream extraction; only narrow read-only detection/extraction utilities are candidates for adaptation. |

## Corrected production-protocol finding

The initial audit understated the existing capability. Production already has
a live user-assisted flow:

```text
Workspace provisional/failed source
-> open ordinary source tab
-> user clears wall
-> POST /api/scrape-request
-> extension polls, claims, and scrapes the visible tab
-> POST /api/scrape-reference
-> POST /api/scrape-jobs/:id/complete or /fail
-> Workspace polls status and refreshes
```

EvidenceRun must not build a parallel protocol. The exact trace and the smallest
adapter are documented in:

- `CFX_PRODUCTION_SCRAPE_PROTOCOL_TRACE_R0_2026-07-31.md`;
- `CFX_EVIDENCE_ACQUISITION_IMPLEMENTATION_PLAN_R1_2026-07-31.md`.

The missing pieces are candidate correlation, redirect-safe browser-tab
identity, complete acquired-text retention, attempt forensics, and an
acquisition-only branch that does not invoke legacy semantic work.

## Targeted extraction implemented offline

The new isolated CFX surface now provides:

- byte-stable `cfx-targeted-bearing-extraction-v1` prompt;
- strict `cfx_targeted_bearing_extraction_v1` schema;
- one immutable target assertion × one candidate × supplied evidence text;
- deterministic evidence block IDs and offsets;
- access-level enforcement;
- exact excerpt, block, and character-range validation;
- immutable proposition and candidate ID validation;
- consistent `noBearingAssertionsFound` validation;
- raw-response capture before validation;
- zero-retry, one-call runner semantics.

The acquisition ladder remains deliberately unclaimed until those adapters are
implemented and tested. User-assisted recovery will reuse production rather
than be reimplemented.
