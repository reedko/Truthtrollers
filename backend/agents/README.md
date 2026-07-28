# CF6 agent runtime — Milestone 1

This subtree is a non-production scaffold. It is not imported by a product
route, does not integrate with CF5, and exposes no ClaimFoundry capability.

Milestone 2 adds a non-production ClaimFoundry domain-tool layer under
`claimFoundry/`. It has no manager agent and makes no model calls. It defines
the `cf6.semanticCore.v1` working package, persisted `cf6.runState.v1` state,
bounded content/package tools, deterministic validation, bounded patching, and
an injected transactional MySQL persistence adapter.

## Configuration

The explicitly live and billable smoke test requires:

- `OPENAI_API_KEY`
- `CF6_SMOKE_MODEL`

It never reads production `CF1_*` settings. Missing configuration fails before
any network call with a list of missing variable names.

## Commands

From `backend/`:

```bash
npm run typecheck:agents
npm run test:agents:claim-foundry-tools
OPENAI_API_KEY=... CF6_SMOKE_MODEL=... npm run test:agents:smoke
```

Success prints one JSON result containing a typed final output, one
`normalize_whitespace` tool event with validated arguments, SDK event types,
model/tool counts, token usage, duration, response ID, run ID, and trace ID.
Inspect `sdkEventTypes` for `tool_call_item` and `tool_call_output_item` to
confirm that the SDK-managed loop invoked the tool.

Without credentials, `npm run test:agents:smoke` fails clearly with
`CF6 smoke configuration is missing` before a provider request.

## Compatibility

The repository runtime is Node 18.20.4. The installed SDK can be imported and
can construct this Agent/Runner/tool path under Node 18, and the isolated
TypeScript toolchain supports Node 18. However, `@openai/agents@0.13.5`
documents Node 22 or later as supported. A successful live test is therefore
required evidence for this exact Node 18 path; it does not change the
repository's runtime policy or imply general SDK support on Node 18.

The SDK Runner owns the repeated model/tool loop. The repository boundary in
`shared/` owns all SDK/provider imports and returns normalized output and
metadata rather than raw SDK responses.

## Milestone 2 persistence

Apply `migrations/2026-07-27-01-cf6-agent-state.sql` through the repository's
normal MySQL migration process before wiring the future manager agent. It
creates:

- `cf6_claim_foundry_run_states`
- `cf6_claim_foundry_tool_events`
- `cf6_claim_foundry_final_packages`

Tool events and final packages have database triggers that reject updates;
tool events also reject deletes. Rollback, if required before production
wiring, is manual and destructive: drop the three CF6 tables in final-package,
tool-event, run-state order. No route uses these tables in Milestone 2.

Offline tests use `MemoryClaimFoundryPersistence`. Production wiring must
construct `MySqlClaimFoundryPersistence` with a transaction port backed by the
existing `withTransaction()` helper. No database credentials are required by
the offline suite.

For a configured disposable MySQL database, the migration can be applied with:

```bash
MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -u "$DB_USER" "$DB_DATABASE" \
  < migrations/2026-07-27-01-cf6-agent-state.sql
```

This requires `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_DATABASE` according
to the existing backend database convention. Milestone 2 does not apply the
migration automatically and does not wire the adapter to a production route.

Milestone 2B uses the dedicated ignored file
`backend/.env.cf6-mysql-test`, not the normal backend environment. Its loader
does not fall back to production `DB_*` variables. Fill every
`CF6_MYSQL_TEST_*` value and set `CF6_MYSQL_TEST_DISPOSABLE=true` only after
confirming the named database is empty and disposable. The database name must
contain `test`, `tmp`, `temp`, `disposable`, or `cf6`; otherwise the integration
test refuses to connect.
