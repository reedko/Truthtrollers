# CFX content- and evidence-scrape identity trace R1

Date: 2026-07-31
Status: complete; code trace and scoped live-schema inspection verified
Scope: production workflow identity only; read-only database inspection; no model, retrieval, scrape, or data-mutation call

## Conclusion

The identifiers are not aliases and do not identify separate live processes.

`scrape_job_id` is the sole live primary key of `scrape_jobs`. It is a signed
`BIGINT NOT NULL AUTO_INCREMENT`, and the runtime's `insertId` is therefore the
same value returned as `scrape_job_id` and used by every queue route.

`scrape_jobs_id` is absent from the live table. It exists only in the generated,
unapplied `add-missing-primary-keys.sql` proposal. That generator proposed a
`<table>_id` replacement for any primary key whose name did not follow its
naming convention; it did not establish a second runtime identity.

The processes are separate at a higher level:

- direct case-content scraping is keyed by `content_id` and never enters
  `scrape_jobs`;
- automatic EvidenceRun acquisition is also direct and never enters
  `scrape_jobs`;
- only manual, user-assisted source scraping uses `scrape_job_id`.

## Workflow A: case-content scrape

### Frontend and browser action

The extension's `useTaskScraper` calls `scrapeContent` for the current page.
For ordinary HTML, `scrapeContent` reads the already-open document DOM and sends
the payload to the extension background process as:

```text
scrapeTaskOnServer
```

The background process posts it directly to:

```text
POST /api/scrape-task
```

There is no `scrape_jobs` row, queue claim, retry job, or queue identifier in
this path.

Sources:

- `extension/src/hooks/useTaskScraper.ts:10`
- `extension/src/services/scrapeContent.ts:39`
- `extension/src/background.js:1218`
- `backend/src/routes/content/content.scrape.routes.js:496`

### Database writes

The acquisition portion calls `scrapeTask`, then `persistTaskContent`, then
`createContentInternal`. `createContentInternal` invokes
`InsertContentAndTopics`.

The current repository definition of that procedure reaches:

```text
content
topics
content_topics
content_relations only when a parent taskContentId is supplied
```

Publishing identity persistence can additionally reach:

```text
authors
content_authors
publishers
content_publishers
publisher_domains
publisher_relationships
content_publishing_context
content_publishing_identifiers
source_identity_cache
```

After the content response, background semantic evaluation reaches claim and
evidence tables. That later evaluation is not the acquisition transport and
does not turn the content scrape into a `scrape_jobs` workflow.

### State and completion

The durable identity is `content.content_id`.

Evaluation state is held in the in-process `scrapeEvaluationRegistry`:

```text
running -> complete
        \-> failed
```

It is keyed by `contentId`, retained for one hour after a terminal result, and
read through:

```text
GET /api/scrape-evaluation-status/:contentId
```

The extension messages are:

```text
scrapingStarted
scrapeEvaluationPending
scrapeCompleted
taskcard:update
```

This path has no browser handoff because it begins in the already-active source
tab. A content-scrape failure is surfaced to the extension; it does not enter
the manual evidence retry queue automatically.

Sources:

- `backend/src/core/scrapeEvaluationRegistry.js`
- `backend/src/routes/content/content.scrape.routes.js:793`
- `extension/src/background.js:505`

## Workflow B1: automatic evidence acquisition

### Frontend and backend entry

Evidence acquisition starts either inside `/api/scrape-task` after task claims
are persisted or from:

```text
POST /api/run-evidence
```

Both call `runEvidenceEngine` directly.

Sources:

- `backend/src/routes/content/content.scrape.routes.js:853`
- `dashboard/src/services/evidenceEngineClient.ts:29`
- `backend/src/routes/evidence/evidence.routes.js:176`

### Acquisition and persistence

`runEvidenceEngine` uses server-side retrieval and scraping directly:

- structured PubMed/PMC acquisition when available;
- an ordinary HTTP fetch;
- bounded PDF/HTML extraction;
- the existing Wayback branch for protected document identities.

It creates or reuses a reference `content` row, establishes
`content_relations`, writes `content.content_text` when text is acquired, and
ultimately persists `reference_claim_links`.

When full acquisition fails, it preserves a reference stub and a provisional
link such as `snippet_only`, `abstract_only`, `identity_only`, or `failed`.

This automatic path does not create or claim a `scrape_jobs` row. It has no
browser-tab handoff and no queue completion event.

Core acquisition-state tables:

```text
content
content_relations
reference_claim_links
```

The same publishing-identity tables used by Workflow A can also be reached.

## Workflow B2: manual, user-assisted evidence retry

This is the production flow that uses `scrape_jobs`.

### Workspace failure signal

Workspace calls:

```text
GET /api/failed-references/:taskContentId
```

The route derives the provisional-source list from:

```text
content
content_relations
reference_claim_links
```

There is no separate evidence-acquisition job table behind the failure list.

Source:

- `backend/src/routes/claims/claims.routes.js:1432`

### User clears the wall and resumes

The current action:

1. opens the source with `window.open(url, "_blank")`;
2. opens `ScrapeReferenceModal`;
3. pre-fills the source URL;
4. waits for the user to clear the page and press the scrape action.

That final button press is the current resume signal.

Sources:

- `dashboard/src/components/modals/ReferenceModal.tsx:141`
- `dashboard/src/components/ScrapeReferenceModal.tsx:85`

### Queue creation and state

`POST /api/scrape-request` inserts one `scrape_jobs` row and returns the
driver's `insertId` under the API field:

```text
scrape_job_id
```

Every runtime route reads, claims, completes, fails, and reports the job using
the `scrape_job_id` database column:

```text
pending -> claimed -> completed
                   \-> failed

claimed older than five minutes -> pending
```

The live column permits one additional value, `expired`. No transition to
`expired` was found in the traced production routes, so it is a schema-supported
state outside this manual-retry path rather than a state this path currently
emits.

A user retry creates a new row; it does not reopen a failed row.

### Browser handoff

The extension polls `GET /api/scrape-jobs/pending`, locates the visible tab,
then calls:

```text
POST /api/scrape-jobs/:id/claim
```

After visible-page extraction it posts to:

```text
POST /api/scrape-reference
```

and finally calls either:

```text
POST /api/scrape-jobs/:id/complete
POST /api/scrape-jobs/:id/fail
```

Workspace receives terminal state by polling:

```text
GET /api/scrape-jobs/:id/status
```

There is no scrape-specific WebSocket or SSE completion event.

### Database writes

The manual transport reaches:

```text
scrape_jobs
```

The reference persistence and retry-validation branch reaches:

```text
content
content_relations
reference_claim_links
claims
content_claims
reference_claim_task_links when claim-level matching is requested
```

It can also reach the shared publishing-identity tables.

## Identifier classification

| Identifier | Code evidence | Classification now |
|---|---|---|
| `content_id` | Case content, evidence stubs, acquired references, and evaluation progress | Content identity |
| `scrape_job_id` | Returned by `/api/scrape-request`; used by every manual queue route and extension call | Runtime manual-scrape transport identity |
| `scrape_jobs_id` | Appears only in the generated `add-missing-primary-keys.sql` migration and is absent from the live table | Unapplied naming-convention proposal; not a live identifier |

The migration generator classified any primary key whose name did not equal
`<table>_id` as needing replacement. It used the same “composite primary key”
wording even for a single-column primary key with a different name. The live
schema proves that proposal was not applied to `scrape_jobs`.

## Scoped live-schema inspection performed

Only tables reached by the workflows above were inspected:

```sql
SHOW CREATE TABLE content;
SHOW CREATE TABLE content_relations;
SHOW CREATE TABLE reference_claim_links;
SHOW CREATE TABLE scrape_jobs;
SHOW CREATE PROCEDURE InsertContentAndTopics;
```

Live `scrape_jobs` key and status definition:

```sql
`scrape_job_id` bigint NOT NULL AUTO_INCREMENT,
`status` enum('pending','claimed','completed','failed','expired')
  NOT NULL DEFAULT 'pending',
PRIMARY KEY (`scrape_job_id`)
```

No `scrape_jobs_id` column, alternate primary key, unique alias, or foreign key
was present. The table's current `AUTO_INCREMENT` value was `271` at inspection
time.

The other inspected identities were also conventional and distinct:

```text
content.content_id                         INT primary key, auto-increment
content_relations.content_relation_id      INT primary key, auto-increment
reference_claim_links.ref_claim_link_id    INT primary key, auto-increment
```

`content_relations` has foreign keys to `content.content_id` for both the task
and reference sides. `reference_claim_links` has foreign keys to
`content_relations`, `content`, and `claims`. `scrape_jobs` has no declared
foreign keys.

The live `InsertContentAndTopics` procedure matches the guarded reference-link
path: it writes `content`, `topics`, and `content_topics`, and writes
`content_relations` only when `contentType = 'reference'`, `taskContentId` is
present, and the parent and child content IDs differ.

No CFX sidecar table belongs in this inspection: those tables are new,
unapplied adapter work, not evidence about the pre-existing production
identifiers.

## Migration consequence

Any CFX binding foreign key must target live `scrape_jobs.scrape_job_id` and
match its signed `BIGINT` type. The current unapplied CFX sidecar migration uses
`BIGINT UNSIGNED`; it must not be promoted or applied in that form. This trace
does not modify that migration.
