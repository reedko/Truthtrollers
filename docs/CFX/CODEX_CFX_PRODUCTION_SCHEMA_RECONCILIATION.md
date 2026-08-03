# Codex Task: Reconcile CFX Evidence Pipeline with Production Claim, Evidence, and Link Tables

Use the current validated CFX pipeline and the completed offline-tested acquisition/targeted-bearing adapter slice as governing context.

## Objective

Before applying the pending CFX acquisition migration or wiring the coordinator, audit and reconcile the proposed design against the existing production schema.

The goal is to reuse durable production identities and workflows, avoid duplicating claim/evidence/link concepts, preserve historical data, and introduce only the narrow new records required for acquisition attempts, acquired-text versions and access levels, targeted evidence-side assertion extraction, grounded bearing provenance, and outbox-driven resume after scrape completion.

Do not drop legacy tables in this task. Do not apply the pending CFX migration until the audit and revised migration are complete. Do not assume that similarly named scrape-job IDs or tables are aliases.

## Existing production tables that must be audited

At minimum:

```text
claims
content
content_relations
claim_sources
claim_evaluation_targets
claim_retrieval_evidence
reference_claim_links
reference_claim_task_links
claim_links
claim_link_audit
scrape_jobs
all tm4_* tables
```

Also inspect every table reached by the live content-scrape, evidence/reference-scrape, retry, browser-assisted recovery, Workspace signaling, and claim-link verification flows.

Use the actual live schema where available:

```sql
SHOW CREATE TABLE <table>;
SHOW INDEX FROM <table>;
SHOW TABLE STATUS LIKE '<table>';
```

Do not infer the live primary key or signedness from stale migrations.

## Governing semantic model

Use this as the preferred production mapping unless the audit disproves it:

```text
CFX target assertion
→ canonical claims row

optional legacy/enrichment projection
→ claim_evaluation_targets row

retrieved evidence document
→ content row

evidence-side assertion extracted from that document
→ canonical claims row

evidence assertion provenance
→ claim_sources row linking evidence claim to reference content

AI-suggested grounded bearing relation
→ reference_claim_task_links row

legacy document-level compatibility projection where still required
→ reference_claim_links and/or claim_retrieval_evidence

user-approved/finalized link
→ existing claim_links workflow

immutable finalized audit
→ claim_link_audit
```

The canonical semantic bridge is:

```text
target claim
← bearing relation →
evidence-side claim
← provenance →
evidence document
```

Do not reduce this to a bare document-to-claim support label.

## Table-by-table audit

### `claims`

Determine how case/task assertions and reference/evidence assertions are stored, whether one table supports both roles, how claim type/source/content identity/lifecycle are represented, whether CFX propositions can be safely projected into canonical rows, and whether existing Workspace and link flows require a `claim_id`.

Produce the exact mapping from CFX S1/S2 output to `claims`.

### `claim_evaluation_targets`

Treat this as likely legacy TM4 enrichment or compatibility, not automatically canonical.

Audit all runtime reads and writes of:

```text
evaluation_target_id
source_claim_id
target_key
primary_query_text
query_hints_json
bearing_criteria_json
quality_status
quality_flags_json
weak_bearing
needs_atomic_split
search_eligible
verdict_eligible
article_stance
resolution_status
```

Classify it as:

```text
actively canonical
active compatibility projection
historical only
partially used
safe to stop writing
unknown
```

Recommend whether CFX should continue populating it, populate only a minimal compatibility subset, stop writing it after downstream migration, or retain it unchanged for now.

### `claim_sources`

Confirm whether it can remain the canonical provenance link:

```text
evidence-side claim
→ reference content
```

Check uniqueness, deletion behavior, multiple sources, and primary-source flags.

### `claim_retrieval_evidence`

Audit all reads and writes and determine whether it is a retrieval ledger, semantic bearing store, scoring cache, historical experiment table, or Workspace dependency.

Do not treat `relevance_score` as equivalent to grounded bearing.

Classify it as canonical, compatibility projection, historical, redundant, or unknown.

### `reference_claim_links`

Determine whether it represents a document-to-task-claim AI suggestion, excerpt-bearing link, Workspace display cache, scrape-status record, or user-verification surface.

Inspect the actual use of:

```text
claim_id
task_claim_id
reference_content_id
content_relation_id
stance
score
confidence
support_level
rationale
evidence_text
evidence_offsets
scrape_status
verified_by_user_id
```

Do not overwrite historical rows or silently reinterpret old scores.

Recommend whether it remains a compatibility projection, Workspace-facing summary, or part of the canonical pipeline.

### `reference_claim_task_links`

Treat this as the strongest existing candidate for the new grounded AI-suggested bearing relation.

Audit all creators and consumers, uniqueness assumptions, whether `reference_claim_id` always denotes a claim extracted from the reference document, how quote/rationale/stance/confidence/score/support_level are rendered or recomputed, how user verification is represented, and whether repeated model runs overwrite or append.

Determine whether new provenance should be added as nullable columns, stored in a companion table keyed by `reference_claim_task_links_id`, or represented through an existing run/provenance table.

Prefer a companion provenance table if altering legacy meaning risks regressions.

### `claim_links` and `claim_link_audit`

Trace the user-approved and finalization workflow.

Confirm that AI-generated bearing suggestions must not be inserted directly as finalized links or audited records.

Document the exact promotion path:

```text
AI suggestion
→ user review/verification
→ canonical claim link
→ immutable audit
```

### `scrape_jobs` and scrape workflows

Trace content scrape and evidence/reference scrape independently.

For each process document:

- frontend trigger;
- backend route;
- job creation;
- table and identifiers;
- queue and worker;
- retry behavior;
- redirect handling;
- browser-tab correlation;
- user-assisted resume;
- terminal event or outbox;
- persisted raw response;
- cleaned text;
- Workspace status signaling.

Explicitly resolve:

```text
scrape_jobs_id
vs
scrape_job_id
```

Possible outcomes include internal row key versus public workflow identifier, two independent scrape processes, stale migration naming, or environment drift.

Use `SHOW CREATE TABLE scrape_jobs` as a hard migration gate.

### `tm4_*` tables

Inventory every `tm4_*` table.

For each produce:

```text
table name
row count
earliest timestamp
latest timestamp
last update timestamp if available
repository reads
repository writes
frontend dependencies
worker dependencies
test-only references
foreign keys into or out of active tables
classification
recommended action
```

Classification:

```text
actively read
actively written
compatibility only
historical archive
migration source
dead
unknown
```

Do not drop any `tm4_*` table in this task.

## Repository-wide usage audit

Search all SQL strings, query builders, ORM/model files, API routes, services, workers, queues, migrations, frontend API calls, Workspace components, retry UI, browser-extension/background flows, scheduled jobs, reporting scripts, tests, database views, procedures, triggers, and deployment scripts.

For every relevant table and field, record concrete file and line references.

Do not conclude a table is unused from name searches alone. Check dynamic SQL and shared query helpers.

## Required design decision

For every proposed CFX acquisition table or column, classify it as:

```text
reuse existing
extend existing
new required semantic object
legacy compatibility only
duplicate and remove from proposed migration
blocked pending live-schema verification
```

The revised design should minimize new schema.

Expected genuinely new concepts may include:

```text
acquisition job binding
acquisition attempts
acquired text version / access-level record
targeted-bearing extraction run
grounded-bearing provenance companion record
terminal outbox/resume state
```

Do not create a parallel CFX copy of claims, content, reference documents, claim provenance, claim-to-claim bearing links, finalized claim links, or audit records unless the audit proves the production tables cannot safely represent them.

## Signedness and key compatibility

The pending migration currently uses unsigned `BIGINT`, while production reportedly uses signed `BIGINT`.

For every foreign key:

1. inspect the live parent-column type;
2. match exact type, width, signedness, and collation where applicable;
3. confirm index compatibility;
4. confirm delete/update behavior;
5. add a real-MySQL migration test.

Do not apply a migration with guessed key types.

## Revised coordinator flow

After schema reconciliation, the intended runtime should be:

```text
CFX target assertion persisted as canonical claim
→ candidate selected
→ evidence/reference content row resolved or created
→ acquisition binding created
→ production scrape/retry/browser-assisted system invoked
→ terminal outbox event consumed
→ correct candidate resumed
→ best acquired text classified
→ one governed targeted-bearing model call
→ evidence-side assertion persisted as canonical claim
→ claim_sources links evidence assertion to evidence document
→ reference_claim_task_links stores AI-suggested bearing
→ provenance companion record stores run, excerpt location, access level, acquired-text version, and validation status
→ Workspace displays suggestion
→ user may verify/finalize through existing claim_links workflow
```

Blocked candidates must not block sibling candidates. Snippet- and abstract-level evidence must retain their access ceilings.

## Required deliverables

```text
artifacts/claim-foundry/cfx/schema-reconciliation/
  production-schema-audit.md
  production-schema-audit.json
  table-usage-matrix.md
  table-usage-matrix.json
  scrape-workflow-trace.md
  scrape-workflow-trace.json
  tm4-table-inventory.md
  tm4-table-inventory.json
  proposed-to-existing-schema-map.md
  proposed-to-existing-schema-map.json
  revised-canonical-data-model.md
  revised-coordinator-flow.md
  revised-migration.sql
  migration-rollback.sql
  migration-verification.md
  real-mysql-test-plan.md
  implementation-plan.md
  unresolved-gates.md
```

The audit must cite concrete repository files and live-schema output.

## Implementation gate

Do not code the coordinator or apply the migration until the audit establishes:

- canonical target-claim storage;
- canonical evidence-document storage;
- canonical evidence-side-claim storage;
- the intended claim-to-claim bearing table;
- compatibility obligations for legacy tables;
- exact scrape-job identifiers and lifecycle;
- exact parent key signedness and types;
- whether a provenance companion table is required.

After the audit, revise the migration and implementation plan.

Then stop and report:

1. what will be reused;
2. what will be extended;
3. what genuinely new tables remain;
4. which legacy tables remain compatibility-only;
5. whether any `tm4_*` tables appear safe for later retirement;
6. unresolved production-schema gates;
7. exact next implementation sequence.

Do not drop tables. Do not migrate historical rows yet. Do not authorize a live bearing model call yet.
