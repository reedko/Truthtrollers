# CFX EvidenceRun acquisition implementation plan R1

Date: 2026-07-31
Governing inputs:

- `CODEX_EVIDENCE_TEXT_ACQUISITION_AND_TARGETED_BEARING_EXTRACTION.md`
- `CFX_PRODUCTION_SCRAPE_PROTOCOL_TRACE_R0_2026-07-31.md`

Status: implementation draft exists; live-schema correction required before migration or promotion

Live-schema amendment: `scrape_jobs.scrape_job_id` is the sole primary,
auto-increment key and is a signed `BIGINT`. `scrape_jobs_id` is not a live
column. Any sidecar binding must match signed `BIGINT` and target
`scrape_job_id`; the existing unapplied unsigned draft migration is not ready
for promotion.

## Design rule

EvidenceRun is a client of the production scrape organism.

```text
EvidenceRun acquisition coordinator
  -> existing production scrape job
  -> existing extension/browser/user-assisted flow
  -> existing completed/failed transition
  -> EvidenceRun resumes one candidate
```

No CFX scrape queue, browser retry protocol, duplicate retry button, or shadow
transport status enum will be created.

## Boundaries

### Reuse unchanged

- production route names:
  - `POST /api/scrape-request`
  - `GET /api/scrape-jobs/pending`
  - `POST /api/scrape-jobs/:id/claim`
  - `POST /api/scrape-jobs/:id/complete`
  - `POST /api/scrape-jobs/:id/fail`
  - `GET /api/scrape-jobs/:id/status`
- production transport states:
  - `pending`
  - `claimed`
  - `completed`
  - `failed`
- stale-claim recovery from `claimed` to `pending`;
- extension `INSTANCE_ID` ownership checks;
- extension compact HTML/text and PDF extraction;
- Workspace provisional-source display and retry modal;
- `content`, `content_relations`, and publishing-identity persistence;
- `resolveSourceLineage` vocabulary and `source_lineage_cache`;
- PubMed, PMC, DOI, and Crossref structured acquisition;
- Wayback and headless-browser fallback after forensic adaptation;
- the already-implemented CFX targeted-bearing extraction stage.

### Add only correlation and forensic acquisition data

Use a sidecar binding keyed by the existing `scrape_job_id`. It must not copy
or own production job status.

Proposed logical binding:

```ts
type EvidenceScrapeBinding = {
  scrapeJobId: number;
  taskContentId: number | null;   // production Workspace identity
  runId: string;
  propositionId: string;
  candidateId: string;
  priorReferenceContentId: number | null;
  acquisitionArtifactId: string;
  requestedUrl: string;
  openedTabId: number | null;
  extensionInstanceId: string | null;
  resolvedUrl: string | null;
};
```

The exact SQL migration must use repository naming conventions and foreign keys
after `SHOW CREATE TABLE scrape_jobs` is captured from a running development
database. It must not add an independent status column.

## Implementation sequence

### P0. Freeze protocol tests before adaptation

Add focused offline tests proving the current production behavior:

1. job insert returns `scrape_job_id`;
2. only `pending` can be claimed;
3. only the claiming `instance_id` can complete or fail;
4. stale `claimed` returns to `pending`;
5. terminal jobs cannot race;
6. a user retry creates a new job;
7. legacy URL-only extension matching remains supported.

Do not change behavior in this step.

### P1. Extract the existing scrape-job transitions into one service

Move the SQL already present in the route handlers behind a small production
service. Routes retain the same paths, request fields, response fields, and
status names.

This service becomes the single place that:

- creates;
- claims;
- completes;
- fails;
- resets abandoned claims.

EvidenceRun does not call SQL directly.

### P2. Add a correlation-only EvidenceRun binding

When EvidenceRun requests browser recovery:

1. create the normal production scrape job;
2. atomically create its sidecar binding;
3. preserve `task_content_id`, run, proposition, candidate, and prior reference
   identity;
4. return the existing `scrape_job_id`.

The authoritative transport state remains `scrape_jobs.status`.

Do not invent `ACQUISITION_QUEUED`, `USER_BROWSER_ACTIVE`, or
`RESUME_REQUESTED` database states. EvidenceRun may render a user-facing
interpretation, but it must derive it from the production job plus acquisition
artifacts.

### P3. Activate the existing browser-tab handoff

Replace the retry flow's uncorrelated `window.open` only where the extension is
available:

1. use the existing extension `checkAndOpenTab` action;
2. receive its browser tab ID and extension instance ID;
3. associate them with the existing `scrape_job_id`;
4. make the extension choose that exact tab, even after redirects;
5. keep current URL matching as the legacy fallback.

If extension handoff is unavailable, keep the current normal-tab/manual retry
behavior and report the missing tab correlation explicitly.

The extension must capture both:

```text
requested target_url
resolved targetTab.url
```

It must not replace one with the other.

### P4. Add acquisition-only persistence inside the current scrape path

The extension will include `scrape_job_id` when posting the already-existing
`/api/scrape-reference` request.

If that job has an EvidenceRun binding:

1. preserve exact compact HTML/raw text before parsing;
2. calculate immutable hashes;
3. derive cleaned text with the same production extraction;
4. write full cleaned text to the production content record and the governed
   acquisition artifact;
5. persist requested, resolved, canonical, and lineage URLs;
6. persist content type, title, author/publisher metadata, character count, and
   extraction diagnostics;
7. return `contentId`;
8. skip legacy claim extraction, claim matching, quote extraction, and all
   model calls.

Unbound legacy jobs continue through the existing route unchanged.

This is an acquisition-only branch of the live production endpoint, not a new
scrape endpoint or queue.

### P5. Resume from the production terminal transition

After the existing `claimed -> completed` update:

1. look up a sidecar binding by `scrape_job_id`;
2. if none exists, preserve legacy behavior;
3. if one exists, finalize its access record from the persisted acquisition
   artifact;
4. enqueue targeted bearing extraction for exactly that candidate;
5. mark the binding consumed idempotently.

After `claimed -> failed`:

1. preserve the production `error_message`;
2. append the failed retrieval attempt;
3. expose the same Workspace recovery actions;
4. leave the candidate suspended without blocking siblings.

For crash safety, add one bounded startup reconciliation over terminal
production jobs whose bindings have not been consumed. Do not create a
per-candidate polling loop.

### P6. Extend the current Workspace recovery surface

Reuse the current provisional-source list and `ScrapeReferenceModal`. When a
row has EvidenceRun context, add proposition/candidate labels and these actions:

- `Retry` — create a new production scrape job bound to the same candidate;
- `Open source and continue` — use the correlated normal-tab flow;
- `Use available snippet` — tell the EvidenceRun coordinator to retain the
  existing snippet access ceiling;
- `Skip` — record a candidate-level terminal diagnostic.

Do not add a CFX-only retry modal elsewhere.

### P7. Structured scholarly acquisition before browser recovery

Reuse tested structured paths in this order where identifiers permit:

1. provider text;
2. DOI identity resolution;
3. PubMed abstract;
4. PMC full text;
5. publisher or repository URL;
6. only then the production browser scrape flow.

Every attempt is persisted even when a later method succeeds.

### P8. Redirected summaries, removed databases, and public mirrors

For every network/browser attempt preserve:

```ts
{
  requestedUrl,
  resolvedUrl,
  sourceUrlActuallyRead,
  canonicalUrl,
  lineageType,
  upstreamUrl,
  archiveTimestamp,
  contentHash,
  identitySignals
}
```

Rules:

1. `excerpt` and `pointer` never become `full_text`.
2. A redirect success is not evidence that the landing page is the requested
   document.
3. A Wayback snapshot uses production lineage `archive`.
4. A public mirror uses the existing best-fitting production lineage
   (`repost`, `syndicated`, `archive`, or `unknown`).
5. The actual mirror/archive URL remains the acquired `sourceUrl`.
6. The unavailable government or publisher URL remains requested/upstream
   provenance only.
7. DOI, PMID, PMCID, title, authors, dates, and content hashes may establish
   document identity; domain resemblance alone may not.
8. Citizen-maintained repositories are configurable acquisition providers, not
   automatically trusted publishers.
9. A copy's access level is based on text actually present.
10. No access control, authentication, or CAPTCHA is bypassed.

Add a configurable alternate-copy provider interface so new public preservation
projects can be added without hard-coding them into EvidenceRun orchestration.
Provider output must always include the actual URL and operator identity.

### P9. Targeted bearing extraction

Only after acquisition validation:

```text
immutable proposition
  x one acquired candidate text
  -> existing cfx-targeted-bearing-extraction-v1 runner
```

The stage already enforces literal excerpts, source locations, access ceilings,
immutable target/candidate IDs, raw-response retention, and zero retry. Do not
change its prompt or semantics as part of the acquisition adapter.

## Required regression tests

### Production protocol

- exact current state transitions;
- ownership/race rejection;
- stale claim recovery;
- new-job retry behavior;
- legacy route compatibility.

### Browser handoff

- exact tab binding survives same-domain redirect;
- exact tab binding survives cross-domain redirect;
- a different tab cannot claim the bound job;
- legacy URL match still works;
- credentials, cookies, CAPTCHA answers, and page form values are never
  persisted.

### EvidenceRun binding

- one job maps to exactly one run/proposition/candidate;
- binding has no shadow status;
- completion resumes exactly one candidate;
- failure suspends only one candidate;
- sibling candidates continue;
- restart reconciliation is idempotent.

### Acquisition persistence

- raw response exists before parsing;
- full cleaned text and hash survive;
- failed attempts survive;
- acquisition-only browser recovery makes zero model calls;
- existing legacy scrape behavior is unchanged for unbound jobs.

### Redirects and alternate copies

- requested and resolved URLs remain distinct;
- an intentional summary page is classified `excerpt` or `pointer`;
- an archive retains snapshot and upstream URLs;
- a mirror never impersonates the original publisher;
- an incomplete mirror cannot receive `full_text`;
- matching DOI/PMID/title signals remain auditable.

### Workspace

- failed EvidenceRun candidate appears in the existing recovery UI;
- Retry and Open/Continue use production jobs;
- snippet and skip decisions affect only the bound candidate;
- terminal production result refreshes the existing Workspace display.

## Stop gates

Do not run targeted extraction or any live model call until:

1. production protocol tests pass;
2. the sidecar has no shadow status;
3. redirect-safe tab correlation passes;
4. exact acquired text is durably retained;
5. acquisition-only scraping proves zero model calls;
6. summary/mirror access ceilings pass;
7. sibling-candidate suspension/resume passes;
8. reports expose every acquisition attempt and lineage hop.

At that point, request a separately bounded authorization for acquisition and
targeted extraction over frozen candidates.
