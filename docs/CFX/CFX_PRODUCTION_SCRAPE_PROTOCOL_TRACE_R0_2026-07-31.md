# CFX production scrape protocol trace R0

Date: 2026-07-31
Status: implementation prerequisite
Scope: read-only repository audit; no scrape, retrieval, browser, database, or model call was made

> Identifier and live-schema findings in this R0 document are superseded by
> `CFX_CONTENT_AND_EVIDENCE_SCRAPE_IDENTITY_TRACE_R1_2026-07-31.md`. The scoped
> live inspection verified `scrape_job_id` as the sole primary auto-increment
> key; `scrape_jobs_id` is absent from the live table.

## Conclusion

Production already has a live, user-assisted scrape protocol. EvidenceRun must
become a client of it. It must not introduce a second scrape queue, retry
state machine, browser handoff, or Workspace failure surface.

The production transport is smaller than the illustrative state diagram:

```text
pending -> claimed -> completed
                   \-> failed

claimed older than five minutes -> pending
```

A user retry creates a new `pending` job. It does not mutate a `failed` job
back to `pending`.

Scrape progress is currently delivered by HTTP polling. There is no
scrape-specific WebSocket or SSE message. The repository's Socket.IO surface is
for chat, and the scrape SSE route is a different task-evaluation surface.

## End-to-end live path

### 1. Workspace identifies a provisional or failed reference

`GET /api/failed-references/:taskContentId` reads:

- `content.content_id`, `content_name`, and `url`;
- `reference_claim_links.rationale`;
- `reference_claim_links.scrape_status`;
- `content_relations.content_id` as the owning task/workspace content record.

The query treats these values as recoverable:

```text
snippet_only
abstract_only
identity_only
failed
```

It also maps the content topics `AI Evidence (Abstract Only)` and
`AI Evidence (Study Identity)` to `abstract_only` and `identity_only`.

Source:
`backend/src/routes/claims/claims.routes.js:1432`

The dashboard calls this route through `fetchFailedReferences`.

Source:
`dashboard/src/services/useDashboardAPI.ts:1247`

### 2. User opens the source and starts a retry

The current retry action:

1. calls `window.open(url, "_blank")`;
2. opens `ScrapeReferenceModal`;
3. pre-fills the same URL;
4. waits for the user to press the modal's scrape action.

This is the current user-clear-wall/resume gesture: the user opens the ordinary
browser tab, clears CAPTCHA, consent, login, or botwall interaction, returns to
Workspace, and submits the pre-filled retry.

Source:
`dashboard/src/components/modals/ReferenceModal.tsx:141`

`ReferenceList` uses the same pattern for provisional sources.

### 3. Dashboard creates the production scrape job

`POST /api/scrape-request` accepts:

```json
{
  "mode": "scrape_specific_url",
  "url": "https://source.example/document",
  "taskContentId": 123
}
```

Valid `scrape_mode` values are:

```text
scrape_last_viewed
scrape_specific_url
```

The route inserts these fields into `scrape_jobs`:

```text
requested_by_user_id
requested_by_source = 'dashboard'
scrape_mode
target_url
task_content_id
```

It returns:

```json
{
  "ok": true,
  "scrape_job_id": 456
}
```

Source:
`backend/src/routes/content/content.scrape.routes.js:83`

### 4. Extension discovers the pending job

Every ten seconds the extension calls:

```text
GET /api/scrape-jobs/pending
```

The route first resets any job that has remained `claimed` for more than five
minutes:

```text
status = pending
claimed_by_instance_id = NULL
claimed_at = NULL
```

It then returns up to ten jobs ordered by `requested_at`, with:

```text
scrape_job_id
requested_by_user_id
scrape_mode
target_url
task_content_id
requested_at
```

The extension processes only the first returned job.

Sources:

- `backend/src/routes/content/content.scrape.routes.js:123`
- `extension/src/background.js:2252`

### 5. Extension associates a visible tab and claims the job

For `scrape_specific_url`, the extension searches all visible tabs. Its matcher
accepts:

- the same normalized URL;
- a tab URL beginning with the requested URL;
- the same origin and pathname;
- the original URL embedded in the extension PDF viewer URL.

Only after it finds a matching tab does it call:

```text
POST /api/scrape-jobs/:id/claim
```

with:

```json
{
  "instance_id": "ext_<timestamp>_<random>"
}
```

The backend atomically changes:

```text
status: pending -> claimed
claimed_by_instance_id: <extension instance>
claimed_at: NOW()
```

The claim route rejects a non-`pending` job and prevents a different extension
instance from completing or failing it.

Sources:

- `extension/src/background.js:1995`
- `extension/src/background.js:2376`
- `backend/src/routes/content/content.scrape.routes.js:241`

### 6. Extension extracts the visible document

For ordinary HTML, the extension selects the strongest visible article/main
container, captures up to 120,000 text characters, and builds compact HTML
containing:

- title and metadata;
- `rel=canonical`;
- JSON-LD;
- a bounded header;
- a bounded article/main node;
- a bounded footer.

For a PDF it first attempts browser-session PDF download and backend parsing,
then falls back to compact visible-page extraction.

The extension sends the result to:

```text
POST /api/scrape-reference
```

with the visible URL, raw HTML/text, title/author metadata, and
`taskContentId`.

Sources:

- `extension/src/background.js:2263`
- `extension/src/background.js:2437`
- `extension/src/background.js:2755`

### 7. Backend persists the reference

`POST /api/scrape-reference` calls `scrapeReference`, which:

- creates or reuses a `content` reference;
- creates the `content_relations` task-to-reference link;
- extracts and persists publishing identity and authors;
- returns `referenceContentId` and cleaned text.

The route then invokes legacy claim extraction and matching. A successful retry
changes associated `reference_claim_links.scrape_status` values from
`snippet_only`, `abstract_only`, `identity_only`, or `failed` to `full`.

Sources:

- `backend/src/routes/content/content.scrape.routes.js:1108`
- `backend/src/core/scrapeReference.js:382`
- `backend/src/routes/content/content.scrape.routes.js:1450`

Important limitation: this route is not yet a clean acquisition-only endpoint.
It can invoke OpenAI claim extraction and claim matching, which EvidenceRun must
not trigger implicitly.

Important persistence gap: `scrapeReference` passes only the first 500 cleaned
characters as `content.details`; `createContentInternal` does not write the
complete cleaned text to `content.content_text`. The older evidence engine
explicitly performs that additional update, but the ordinary manual
`/api/scrape-reference` route does not. EvidenceRun therefore needs a narrow
acquisition-only persistence seam in this same production path before it can
claim complete evidence-text retention.

### 8. Extension terminates the production job

On successful `/api/scrape-reference`, the extension calls:

```text
POST /api/scrape-jobs/:id/complete
```

with:

```json
{
  "content_id": 789,
  "instance_id": "ext_<timestamp>_<random>"
}
```

The backend atomically changes:

```text
status: claimed -> completed
result_content_id: 789
completed_at: NOW()
```

On failure, the extension calls:

```text
POST /api/scrape-jobs/:id/fail
```

with `error_message` and the same `instance_id`. The backend changes:

```text
status: claimed -> failed
error_message: <diagnostic>
completed_at: NOW()
```

Sources:

- `extension/src/background.js:2776`
- `backend/src/routes/content/content.scrape.routes.js:288`
- `backend/src/routes/content/content.scrape.routes.js:343`

### 9. Workspace receives terminal status

The dashboard polls:

```text
GET /api/scrape-jobs/:id/status
```

The response contains:

```text
scrape_job_id
status
content_id                 <- scrape_jobs.result_content_id
error_message
completed_at
```

`ScrapeReferenceModal` polls every two seconds for up to five minutes. On
`completed`, it adds `content_id` to the task's references and refreshes the
Workspace reference list. On `failed`, it displays `error_message`.

Sources:

- `backend/src/routes/content/content.scrape.routes.js:193`
- `dashboard/src/components/ScrapeReferenceModal.tsx:131`

## Actual identifiers and database fields

The repository does not contain the original `CREATE TABLE scrape_jobs`
migration. The local configured MySQL server was not running during this audit,
so SQL types/defaults could not be verified with `SHOW CREATE TABLE`. The
following column names are exact because the live routes read or write them:

| Record | Exact fields used by production |
|---|---|
| `scrape_jobs` | `scrape_job_id`, `requested_by_user_id`, `requested_by_source`, `scrape_mode`, `target_url`, `task_content_id`, `requested_at`, `status`, `claimed_by_instance_id`, `claimed_at`, `result_content_id`, `error_message`, `completed_at` |
| `content` | `content_id`, `content_name`, `url`, `details`, `content_text`, `topic`, publishing/provenance fields |
| `content_relations` | `content_relation_id`, `content_id`, `reference_content_id`, `added_by_user_id`, `is_system` |
| `reference_claim_links` | `ref_claim_link_id`, `claim_id`, `reference_content_id`, `scrape_status`, `stance`, `rationale`, `evidence_text` |

Current correlation is:

```text
Workspace task
  content.content_id
    -> scrape_jobs.task_content_id
    -> content_relations.content_id

Scrape attempt
  scrape_jobs.scrape_job_id
    -> scrape_jobs.claimed_by_instance_id
    -> scrape_jobs.result_content_id
    -> content.content_id
```

There is no persisted `workspaceId` distinct from `task_content_id`, and there
are no current `runId`, `propositionId`, `candidateId`, `referenceId`, browser
tab ID, requested-to-resolved redirect chain, or acquisition artifact ID fields
on `scrape_jobs`.

## Redirect, summary-page, archive, and mirror audit

### Redirected tabs

The extension currently associates a job by URL rather than by browser tab ID.
A same-document redirect can match, but a cross-domain or materially
different-path redirect can leave the job indefinitely `pending`, even though
the user is looking at the correct redirected tab.

The extension has an existing `checkAndOpenTab` external action that returns a
browser tab ID, but the dashboard does not currently call it. This is the
smallest existing seam for durable tab correlation and redirect-safe scraping.

Source:
`extension/src/background.js:2222`

### Redirected summary and pointer pages

Production already has source-lineage vocabulary:

```text
original
excerpt
repost
syndicated
pointer
archive
unknown
```

`resolveSourceLineage` examines cross-domain canonical URLs, `og:url`,
“originally published,” excerpt/read-more text, pointer/via links, and archive
wrappers. The results persist in `source_lineage_cache`.

Sources:

- `backend/services/sourceLineageResolver.js`
- `backend/migrations/add-source-lineage.sql`
- `GET /api/source-lineage`
- `dashboard/src/components/modals/SourceDetailModal.tsx`

EvidenceRun must use these production lineage names. An `excerpt` or `pointer`
landing page cannot be promoted to document-level `full_text` merely because
the HTTP request succeeded. It can provide only the text actually acquired,
under the applicable access ceiling.

### Public archives and citizen-maintained mirrors

Production already supports a public Wayback fallback and preserves the
snapshot URL. Production identity vocabulary also includes
`archive_snapshot`, and publishing infrastructure recognizes archive and
institutional-repository sources.

Concerned-citizen mirrors of removed public scientific material should enter as
alternate copies, not as silent replacements for the unavailable government
URL:

- `sourceUrl` is the URL actually read;
- requested/original URL remains separately preserved;
- production lineage is `archive`, `repost`, `syndicated`, or `unknown`;
- DOI, PMID, PMCID, title, author, publication date, and content hashes are
  retained as identity evidence;
- the actual mirror/archive operator remains visible;
- the copy may supply text, but it does not silently inherit the original
  publisher's identity;
- a summary, pointer, or partial copy retains the lower access ceiling.

The current `fetchTextWithFallbacks` implementation is useful but not
forensically complete: it returns only the successful terminal method, discards
failed-attempt detail, and does not preserve an HTTP redirect chain. It needs a
small attempt-recording adapter before EvidenceRun reuse.

## Gaps the adapter must close

1. Bind one production `scrape_job_id` to `runId`, `propositionId`, and
   `candidateId` without duplicating `scrape_jobs.status`.
2. Bind the opened browser tab and extension instance so cross-domain redirects
   do not break job discovery.
3. Preserve requested URL, resolved tab URL, canonical URL, and source-lineage
   result separately.
4. Persist complete acquired text and its hash before legacy semantic work.
5. Provide an acquisition-only branch of the existing `/api/scrape-reference`
   path so a browser recovery cannot trigger legacy claim extraction or extra
   model calls.
6. Resume exactly one suspended EvidenceRun candidate after the existing
   `completed` or `failed` transition.
7. Keep sibling candidates running while one production scrape job waits for a
   tab or user action.
8. Add production scrape protocol tests; no focused route/extension tests were
   found for this flow.

These are adapters and missing correlations, not authorization for a second
scrape protocol.
