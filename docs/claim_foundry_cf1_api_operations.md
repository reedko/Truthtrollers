# CF1 Public API Operations

**Milestone:** 6
**Activation default:** disabled

## Endpoints

All endpoints require a configured consumer API key using either `X-API-Key` or
`Authorization: Bearer <key>`.

```text
POST /v1/claim-packages
GET  /v1/claim-packages/runs/:runId
GET  /v1/claim-packages/:packageId
```

Package and run reads are scoped through the authenticated `consumer_key`.
Another consumer receives the same not-found response as a missing record.

The submit endpoint accepts only the portable options defined by the CF1 contract:

```text
persist, includePackageInResponse, allowRepair, idempotencyKey
```

Consumers cannot select the model, token budgets, timeout, artifact filesystem,
or model transport. Public persistence cannot be disabled in v1.

## Required server configuration

The API is mounted before the repository's legacy `/api` path-rewrite middleware
only when `CF1_API_ENABLED=true`.

```text
CF1_API_ENABLED=true
CF1_CONSUMER_KEYS_JSON={"secret-api-key":"consumer-key"}
CF1_MODEL=<deployment-selected-model>
```

Optional positive-integer limits:

```text
CF1_MODEL_CONTEXT_TOKENS
CF1_MODEL_TIMEOUT_MS
CF1_MAX_TOTAL_TOKENS
CF1_MAX_OUTPUT_TOKENS
CF1_MAX_DURATION_MS
```

Production composition adapts the repository's existing `openAiLLM.generate`
convention. It uses `OPENAI_API_KEY`, falling back to
`REACT_APP_OPENAI_API_KEY`, JSON-object response mode, existing OpenAI usage
telemetry, and the deployment-selected `CF1_MODEL`. CF1 disables wrapper-level
retries so its own bounded retry policy remains the sole retry owner.

Enabling the API without a model or at least one consumer credential fails during
server startup instead of exposing a partial API.

## Deployment order

1. Review and apply `backend/migrations/2026-07-13-01-claim-foundry-core.sql`.
2. Apply it a second time and inspect all three tables, foreign keys, and the
   immutable-package trigger.
3. Confirm the existing OpenAI API key environment is available.
4. Configure consumer credentials, `CF1_MODEL`, and server-owned budgets.
5. Enable CF1 and verify unauthorized, submit, status, and package-load requests.

No scrape route, Workspace projection, EvidenceRun dispatch, or legacy claim read
is changed by enabling this API.

## VeriStrata shadow endpoint

When CF1 is enabled, authenticated VeriStrata users may submit content they can
access through:

```text
POST /api/claim-foundry/run
{"contentId": 123, "allowRepair": true, "includePackageInResponse": false}
```

The route uses the existing JWT middleware and requires either a `content_users`
assignment or the `super_admin` role. It loads full text only from
`content.content_text` or the exact persisted TextPad document
`assets/documents/tasks/content_id_<id>.txt`. It never fetches the content URL,
re-scrapes, or substitutes the truncated `details` field.

The result is persisted as an immutable package with a binding to `content_id`.
Shadow mode does not write `claims`, `content_claims`, or
`claim_evaluation_targets`, does not alter Workspace reads, and does not dispatch
EvidenceRun.

## Inactive projection

Milestone 8 provides the internal `projectCf1Package({ bindingId })` adapter. It
transactionally maps only selected claims, their Phase 3 targets, and complete
Evidence Need Cards into package-scoped compatibility rows. Raw assertions and
all other audit structures remain only in the immutable package.

Projection is deliberately inactive: it sets the binding status to `projected`
but does not alter current Workspace reads, select an active binding, dispatch
EvidenceRun, or add a public route. Historical TM4, manual, and earlier CF1 rows
are retained. The projection migration must be reviewed and applied manually
before invoking the adapter.

## Controlled activation

Activation requires the core, projection, and activation migrations in order, plus
all three feature flags: `CF1_API_ENABLED=true`, `CF1_ACTIVATION_ENABLED=true`, and
`CF1_WORKSPACE_READS_ENABLED=true`. The activation route is super-admin-only:

```text
POST /api/claim-foundry/activate
{"bindingId": 123}
```

The transaction disables the current binding for the same consumer/content and
activates the requested projected binding. Its response returns
`previousBindingId`; activating that binding performs rollback without deleting
either projection. The database uniqueness key enforces one active binding per
consumer/content.

With Workspace reads disabled, the existing claim endpoint is unchanged and does
not require activation columns. With reads enabled, no active binding means all CF1
projection rows are hidden. An active binding exposes only its selected claims plus
legacy user-created claims. Other legacy read paths remain outside this first
controlled activation surface and must be audited before broader release.

The comparison reporter consumes completed blinded-review measurements; it does not
run models or invent reviewer scores:

```text
node scripts/testing/cf1_compare_current.mjs \
  --input comparison-runs.json --output gate-report.json
```

Missing measurements are emitted as `not_measured`, which never counts as passing.
