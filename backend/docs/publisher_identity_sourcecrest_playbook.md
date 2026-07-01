# Publisher Identity and SourceCrest Playbook

This document describes the publisher-identification and SourceCrest path that finally resolved `humanforschung-schweiz.ch`, and provides a repeatable process for other difficult sources.

## Final result for HumRes

The system now represents the source as:

- **Published portal:** Human Research Switzerland (HumRes)
- **Verified operator:** Federal Office of Public Health (FOPH)
- **Source type:** `government`
- **SourceCrest:** `BØ`
- **Alignment sash:** `GOV`

`B` is the publisher/source reliability classification. `Ø` means the truth of a specific claim has not yet been assessed. A government identity is not converted into a fabricated claim-level number.

## Why this was difficult

Several independent failures produced misleading symptoms:

1. The extension originally compacted the page into article text and discarded publisher metadata.
2. The backend fell back to the hostname, producing `humanforschung-schweiz.ch` as the publisher.
3. Later scrapes found `Human Research Switzerland`, but enrichment sometimes continued against an older domain-named publisher record.
4. An earlier curated name used `Federal Office of Public Health FOPH` as the publication name, creating a second publisher record. FOPH is the operator; HumRes is the portal.
5. The own-site scanner recognized industry associations but did not classify explicit government ownership.
6. The government profile save failed because `publisher_profiles.extraction_method` is an enum and `own_site_verified` was not an allowed value.
7. The extension scrape job completed before asynchronous publisher enrichment completed. The modal fetched too early and never followed the second phase.
8. The modal and reference-list API used different data paths, so the `GOV` sash appeared in the modal but not on smaller SourceCrests.

## End-to-end flow

```text
Chrome tab
  -> extension extracts compact text + publisher metadata
  -> POST /api/scrape-reference
  -> scrapeReference chooses canonical publisher identity
  -> publisher row is found/created and linked to content
  -> own-site and external enrichment run
  -> verified source type is stored in publisher_profiles
  -> Admiralty evaluator produces BØ
  -> content and publisher evaluations are stored
  -> APIs return source_type + alignment_marker + admiralty_code
  -> every SourceCrest renders the same GOV sash
```

## 1. Preserve publisher metadata in the extension

File: `extension/src/background.js`

`extractCompactPageForScrape()` now preserves:

- `meta[name="publisher"]`
- `meta[name="citation_publisher"]`
- Dublin Core publisher metadata
- `og:site_name`
- application name
- title suffix and header-logo fallbacks
- canonical URL
- JSON-LD

The compact HTML sent to the backend includes this metadata instead of containing only a `<pre>` block. The extension also sends `publisherName` explicitly in the scrape request.

This matters because backend HTML extraction cannot recover metadata that the extension removed before transmission.

## 2. Route extension metadata into reference scraping

File: `backend/src/routes/content/content.scrape.routes.js`

The scrape route accepts `publisherName` and passes it to `scrapeReference()` as `providedPublisherName`.

Retry scrapes also pass `forcePublisherEnrichment: true`, ensuring that corrected publisher identities are actually enriched instead of being skipped as fresh.

Publisher persistence now happens inside `scrapeReference()` before enrichment starts. The route-level persistence is only a defensive fallback. This prevents two separate persistence paths from clearing or replacing each other's links.

## 3. Publisher extraction precedence

Files:

- `backend/src/core/scrapeReference.js`
- `backend/src/utils/extractPublisher.js`

The effective precedence is:

1. Curated domain mapping
2. Publisher name supplied by the extension
3. Structured HTML metadata through `extractPublisher()`
4. PDF-specific extraction
5. Domain fallback

For HumRes, the curated mapping is:

```js
humanforschung-schweiz.ch -> Human Research Switzerland
```

The curated name is deliberately the portal name, not FOPH. Ownership/operator information belongs in enrichment data.

### Changes in `extractPublisher.js`

High-specificity publisher fields are checked before generic site branding:

1. `meta[name="publisher"]`
2. `meta[name="citation_publisher"]`
3. `meta[name="dc.publisher"]` / `meta[name="DC.publisher"]`
4. `meta[property="og:site_name"]`
5. `meta[name="citation_journal_title"]`

This avoids allowing a generic Open Graph site name to override a more explicit publisher field.

### Reusing and upgrading publisher records

`ensureReferencePublisherLink()` now:

- prefers an exact canonical publisher-name match;
- reuses a domain-linked publisher only when appropriate;
- upgrades a hostname placeholder to a real human-readable name;
- avoids treating journal proxies like ordinary site publishers;
- returns the actual `publisherLink` so the route does not persist it again.

When changing these rules, watch for duplicate publisher rows representing a portal and its operator. They should normally be modeled as one portal publisher plus operator/ownership metadata.

## 4. Discover ownership and organization type from the source itself

File: `backend/src/services/ownSiteOrgStatusService.js`

The own-site scanner discovers and reads relevant pages such as:

- About / mission
- Contact / Impressum / imprint / legal notice
- Membership
- Governance / board
- Sponsors / funding
- Policy / advocacy

Government classification requires explicit public-authority language such as `federal office`, `ministry`, `government agency`, or `public authority`. A generic mention of “government affairs” is not enough.

For HumRes, the scanner finds the site's statement that the Federal Office of Public Health operates the portal. It produces:

```text
publisher_type: government_organization
ultimate_publisher_or_interest_group: Federal Office of Public Health (FOPH)
default_reliability_letter: B
default_admiralty_code: BØ
alignment marker: GOV
```

Industry ownership continues to produce `IND`; other alignment categories use the same status model.

## 5. Persist verified source identity

File: `backend/src/services/publisherEnrichmentService.js`

When own-site evidence verifies a government organization, enrichment writes an `Own Site` publisher profile containing:

- `source_type = government`
- ownership evidence
- evidence URL
- confidence
- the raw own-site result

The production `extraction_method` column is currently an enum that does not contain an own-site value. The profile therefore uses the schema-safe value `unknown`; provenance remains explicit through `source = "Own Site"`, evidence fields, and the raw payload.

Do not introduce a new extraction-method string without first changing the database enum. The failure signature is:

```text
WARN_DATA_TRUNCATED: Data truncated for column 'extraction_method'
```

After persistence, `reEvaluateAdmiraltyForPublisher()` reloads profiles, ratings, and provider signals, then stores publisher-level and linked-content SourceCrests.

## 6. SourceCrest interpretation

File: `backend/services/admiraltyEvaluator.js`

Relevant source-type bases include:

- `primary -> A`
- `government -> B`
- `academic -> B`
- `journalism -> B`
- `corporate -> C`
- `advocacy -> D`

The first character assesses the source. The second character assesses the claim. Consequently, an official government portal with no claim-level determination receives `BØ`, not an invented `B1` or `B2`.

## 7. Keep the modal synchronized with background enrichment

File: `dashboard/src/components/modals/SourceDetailModal.tsx`

An extension scrape and publisher enrichment are separate phases:

1. The extension completes the scrape job after the publisher link is written.
2. Publisher enrichment continues asynchronously.

The modal now immediately accepts the publisher already committed by `scrapeReference()`, updates the reference list through `onPublisherLinked`, and then polls the content-publisher endpoint while enrichment finishes. When a SourceCrest appears, it refreshes both the modal and parent list.

The modal no longer requires a redundant “Save publisher link” action after the backend has already linked the publisher.

It also avoids running a second source-identity resolution after a successful scrape, because that lookup can select an older duplicate publisher record.

For government sources, the modal prominently displays:

```text
Government source
Operated by
Federal Office of Public Health (FOPH)
```

## 8. Make SourceCrests consistent everywhere

Files include:

- `dashboard/src/components/SourceCrest.tsx`
- `dashboard/src/utils/normalizeSourceProfile.ts`
- `dashboard/src/utils/sourceCrestUri.ts`
- `dashboard/src/components/ReferenceList.tsx`
- evidence-map, graph, task-card, and reference-modal components
- `backend/src/routes/references/references.routes.js`
- `backend/src/routes/publishers/publishers.routes.js`
- `shared/entities/types.ts`

The reference and publisher APIs now expose:

- `source_type`
- `alignment_marker`
- `alignment_risk_score`
- `admiralty_code`

`SourceCrest` treats alignment as part of the shared rendering contract, but renders a sash only from an explicit `alignment_marker`. It does not infer `GOV` from `sourceType` alone, because legacy content can contain multiple publisher links and source type can also be heuristic. APIs must bind the marker, publisher ID, publisher name, and profile to the same selected publisher link.

The SVG data-URI renderer used by Cytoscape accepts the same marker and risk score, so graph shields do not silently diverge from React-rendered shields.

## 9. Logging and debugging

Files:

- `backend/src/utils/logger.js`
- `backend/server.js`

The daily evidence log is cleared unconditionally on each backend restart. This makes a new test run easy to isolate. Restarting MySQL alone does not execute backend startup code and therefore does not clear the log.

The `/api/content/:id` route no longer prints the full content row and `content_text`; it logs only a concise content identifier and type.

Useful success messages include:

```text
[enrichment] Starting for "Human Research Switzerland" ...
[enrichment] Own-site org status ... found
[enrichment] Admiralty re-evaluated ... code=BØ
[scrapeReference] Admiralty BØ stored ...
```

Useful failure signatures:

| Symptom | Likely cause |
|---|---|
| Enrichment runs against a hostname | Extension metadata was lost or domain placeholder was reused |
| Correct name appears only after closing the modal | Modal did not propagate the committed publisher link |
| Scrape job completes but crest remains `ØØ` | Enrichment is still running, failed persistence, or source type was not stored |
| `WARN_DATA_TRUNCATED` | An unsupported enum value was written |
| Modal shows sash but list does not | List API omitted `source_type` or `alignment_marker` |
| Two different names alternate | Duplicate publisher records or stale source-identity cache |
| Old activity appears after restart | Startup log clearing is disabled or only the database was restarted |

## Repeatable procedure for a difficult publisher

1. **Inspect the live page metadata.** Check explicit publisher tags, `og:site_name`, JSON-LD, canonical URL, title suffix, and logo name.
2. **Inspect About and legal pages.** Identify the publication name, legal operator, funding, membership, governance, and sponsorship.
3. **Separate brand from operator.** Store the publication/portal as the publisher and the parent body as ownership/operator metadata.
4. **Run one clean rescrape.** Restart the backend first so the evidence log contains only the new run.
5. **Verify extension payload.** Confirm the log identifies the publisher metadata rather than only a hostname.
6. **Verify the content link.** Query `/api/publishers/for-content/:contentId` or inspect `content_publishers`.
7. **Verify the profile.** Confirm `publisher_profiles.source_type` and its evidence URL.
8. **Verify the evaluation.** Confirm both publisher and content rows in `admiralty_evaluations` use the expected publisher ID.
9. **Check for duplicates.** Search publishers by name and domain before adding another curated mapping.
10. **Check every UI surface.** Modal, workspace reference list, cards, evidence map, and graph must display the same code and sash.

## Verification commands

These are safe local checks and do not run a production build:

```bash
node --check backend/src/core/scrapeReference.js
node --check backend/src/services/ownSiteOrgStatusService.js
node --check backend/src/services/publisherEnrichmentService.js
node backend/test-own-site-org-status.js
./dashboard/node_modules/.bin/tsc -p dashboard/tsconfig.app.json --noEmit --incremental false --pretty false
git diff --check
```

## Design rule to retain

Publisher identity, operator identity, source reliability, claim credibility, and institutional alignment are related but distinct fields. Do not solve a missing field by overloading another one:

- **Publisher:** the publication, portal, or outlet the user sees
- **Operator/owner:** the controlling institution
- **Source type:** government, academic, journalism, corporate, etc.
- **Reliability letter:** the SourceCrest's first character
- **Claim number:** the SourceCrest's second character
- **Alignment sash:** disclosed institutional interest or provenance context

Keeping those distinctions is what made the HumRes/FOPH result both accurate and visually useful.
