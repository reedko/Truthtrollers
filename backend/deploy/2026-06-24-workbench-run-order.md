# 2026-06-24 Production DB Workbench Run Order

Run these against the production `truthtrollers` database in MySQL Workbench.

Take a database backup first.

## Scripts

1. `2026-06-24-current-version-schema.sql`
2. `2026-06-24-02-seed-reasoning-stack-prompts.sql`
3. `2026-06-24-03-update-case-stack-prompts-v2.sql`
4. `2026-06-24-04-update-evidence-query-prompts-atomic.sql`
5. `2026-06-24-05-verify-current-version-schema.sql`

## Expected Verification Shape

The verification script should show:

- Six required tables:
  - `admiralty_evaluations`
  - `publisher_domains`
  - `publisher_external_signals`
  - `publisher_relationships`
  - `source_identity_cache`
  - `source_lineage_cache`
- `content_claims.claim_role` includes `fallibility_critical`.
- `content_claims` has the hierarchy and argument-mapping columns.
- `publishers` has the provider-signal summary columns.
- `admiralty_evaluations` has unique index `uq_target`.
- Active prompt rows exist for:
  - `argument_mapping_system`
  - `argument_mapping_user`
  - `claim_extraction_stack_system`
  - `claim_extraction_stack_with_topics`
  - `claim_extraction_stack_no_topics`
  - `evidence_query_generation_system`
  - `evidence_query_generation_user`
  - `evidence_query_generation_user_balanced`

After these pass, deploy app code with `./deploy.sh`.
