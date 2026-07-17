# ER1-2A.1 query planner repair

## Status

Implemented and validated offline. ER1-2B remains blocked. A live ER1-2A rerun is
recommended only after review of the generated F01 query plan.

## Failure corrected

ER1 previously copied CF1 `queryLaneSeeds[].query` and attached support, refute, and
qualify labels without changing the query text. F01 had 52 apparent lanes but only 22
unique texts; 15 target-query groups repeated one query across all three bearing goals.

ER1 now treats CF1 seeds as traceable hints. The structured compiler uses target text,
must/should-match criteria, support/refute/qualify conditions, not-enough/reject rules,
source roles/types, scope, claim metadata, related-claim hints, and work identities.

## Query boundaries

- Exact identifiers and the full primary title remain in identity lanes.
- Context-work resolution has its own budget.
- Generic or underspecified works are deferred before provider execution.
- Target-evidence queries use distinct text for requested bearing goals.
- Query diagnostics catch silent regression to duplicated bearing queries.

Implemented lane families include exact identifier, primary-article identity/result,
independent review, systematic/meta review, contrary/reanalysis, methodology/limitation,
definition/scope, official/agency, legal/administrative, opponent provenance, and context
work resolution.

## F01 offline result

- Before: 52 lanes, 22 provider queries, 30 duplicate query texts, 15 duplicated-bearing groups.
- After: 29 lanes, 29 provider queries, 0 duplicate query texts, 0 duplicated-bearing groups.
- After budgets: 3 identity, 2 context-work, and 24 target-evidence queries.
- Deferred: Wakefield et al (provenance hint), Several epidemiologic studies (generic
  phrase), and Institute of Medicine (organization context).

Artifacts: `artifacts/evidence-run/er1-2a1-f01-query-repair/`.

## Safety

No provider, source-body fetch, scrape, PDF extraction, model, database, migration,
projection, assertion, bearing, or stance operation ran while producing the repair artifacts.
