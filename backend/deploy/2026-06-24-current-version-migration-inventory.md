# Current Version Production Migration Inventory

Generated from local code and read-only production checks on 2026-06-24.

No production migrations have been run.

## Production State Observed

Production database: `truthtrollers`

Present tables checked:

- `claim_retrieval_evidence`
- `content_claims`
- `content_publishers`
- `publisher_profiles`
- `publisher_ratings`
- `source_quality_scores`

Missing tables required by current code:

- `admiralty_evaluations`
- `publisher_domains`
- `source_identity_cache`
- `source_lineage_cache`
- `publisher_external_signals`
- `publisher_relationships`

`content_claims` currently has only:

- `cc_id`
- `content_id`
- `claim_id`
- `relationship_type`
- `created_at`
- `user_id`

`publishers` currently has only the older base columns through `domain`; it is missing the provider-signal summary columns used by the current publisher enrichment flow.

Prompt rows found from the checked current set:

- `evidence_query_generation_system`
- `evidence_query_generation_user`
- `evidence_query_generation_user_balanced`

Prompt rows not found from the checked current set:

- `argument_mapping_system`
- `argument_mapping_user`
- `claim_extraction_stack_system`
- `claim_extraction_stack_with_topics`

Note: `claimsEngine` can fall back to legacy extraction prompts if they exist, but the current preferred prompt family is `claim_extraction_stack_*`.

## Migration Bundle

Primary review file:

- `backend/deploy/2026-06-24-current-version-schema.sql`

This file consolidates the schema work needed before the current app code runs on production.

It covers:

- Create `admiralty_evaluations`, including `uq_target (target_type, target_id)` for current `storeEvaluation(...)` upserts.
- Normalize any old Admiralty `F` / `6` values to the current `Ø` / `NULL` representation.
- Create `publisher_domains`.
- Create `source_identity_cache`.
- Create `source_lineage_cache`.
- Create `publisher_external_signals`.
- Create `publisher_relationships`.
- Add hierarchy columns to `content_claims`.
- Widen `content_claims.claim_role` to include `fallibility_critical`.
- Add argument-mapping columns to `content_claims`.
- Add provider-signal summary columns to `publishers`.
- Insert active `argument_mapping_system` and `argument_mapping_user` prompts.

## Existing Local Migration Sources Folded Into The Bundle

- `backend/migrations/create-admiralty-evaluations.sql`
- `backend/migrations/admiralty-unique-target.sql`
- `backend/migrations/admiralty-f6-to-null.sql`
- `backend/migrations/add-source-identity.sql`
- `backend/migrations/add-source-lineage.sql`
- `backend/migrations/add_claim_hierarchy_to_content_claims.sql`
- `backend/migrations/add_argument_mapping_to_claims.js`
- `backend/migrations/add_publisher_external_signals.js`

## Prompt/Data Migrations Still To Decide

These are not included in the consolidated SQL because they are large prompt text updates already expressed as JS scripts:

- `backend/migrations/seed_reasoning_stack_prompts.js`
- `backend/migrations/update_case_stack_prompts_v2.js`
- `backend/migrations/update_evidence_query_prompts_atomic.js`

`seed_reasoning_stack_prompts.js` reads `backend/.env`.

```bash
node migrations/seed_reasoning_stack_prompts.js
```

Recommended order after schema testing:

1. Run `2026-06-24-current-version-schema.sql`.
2. Run `node migrations/seed_reasoning_stack_prompts.js`.
3. Run `node migrations/update_case_stack_prompts_v2.js`.
4. Run `node migrations/update_evidence_query_prompts_atomic.js` to update the three existing evidence-query prompt rows.
5. Verify prompt presence and active versions before deploying app code.

## Test Plan Before Production

Use a production-like database snapshot or a local database with production-compatible MariaDB behavior.

1. Restore/copy a schema snapshot.
2. Run `backend/deploy/2026-06-24-current-version-schema.sql`.
3. Re-run the same SQL to verify idempotency.
4. Verify the following:
   - required tables exist
   - required `content_claims` columns exist
   - required `publishers` columns exist
   - `admiralty_evaluations.uq_target` exists
   - active `argument_mapping_system` and `argument_mapping_user` prompts exist
5. Run the prompt JS migrations selected above.
6. Start the backend against the migrated test database and hit:
   - publisher enrichment endpoints
   - reference list / source crest paths
   - claim extraction / evidence engine path that uses argument mapping

## Deploy Script Decision Point

Do not wire this into `deploy.sh` until after the schema file has passed the test plan.

After approval, the deploy options are:

- Manual DB step before deploy: run SQL and prompt scripts on production, then run `deploy.sh`.
- Deploy-script step: sync backend, install dependencies, run SQL/prompt migrations, then restart PM2.

The deploy-script option should run migrations before `pm2 restart truthtrollers --update-env`.
