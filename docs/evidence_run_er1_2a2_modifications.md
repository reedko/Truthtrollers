# ER1-2A.2 terminology and strategy repair

## Status

Implemented and validated offline. ER1-2B remains blocked. A bounded ER1-2A live rerun is
the next advisable validation after reviewer approval of the F01 queries.

## Failure corrected

ER1-2A.1 still represented target routes as `bearingGoal: support|refute|qualify`, carried
those values into provider `requestedGoals`, and injected phrases such as “contrary
findings” and “contradictory evidence.” That implied source stance before acquisition.

ER1-2A.2 replaces those fields with:

- `evidenceRole`, describing the kind of potentially useful source;
- `falsifiabilityBasis`, recording which CF1 hypothesis motivated the route;
- `requestedEvidenceRoles`, preserving role intent at the provider boundary.

The compiler uses proposition anchors, scope, source roles, and evidence roles. It does not
insert the prose of CF1's logical opposite into the query.

## Evidence-role families

- `primary_result`
- `independent_corrob_or_review`
- `reanalysis_or_correction`
- `methodology_or_limitation`
- `subgroup_or_scope`
- `definition_or_scope`
- `official_or_legal_context`
- `opponent_or_claim_provenance`

Identity and context-work resolution remain separate query classes and budgets.

## F01 result

- 29 planned lanes and 29 unique provider queries;
- 3 identity, 2 context-work, and 24 target-evidence queries;
- 0 duplicate query texts;
- 0 queries containing literal stance-hunting terms;
- 0 queries detected as mixing a claim with its logical opposite;
- 0 support/refute/qualify provider lane labels;
- 0 `stance` fields and 0 `bearingScore` fields.

T002 now produces:

- primary result: `vaccination before 18 months vaccination before 24 months autism diagnosis early vaccination DeStefano 2004 study results`
- reanalysis/correction: `vaccination before 18 months vaccination before 24 months autism diagnosis early vaccination DeStefano 2004 reanalysis correction`
- subgroup/scope: `vaccination before 18 months vaccination before 24 months autism diagnosis early vaccination overall population subgroup effect modification`

Artifacts: `artifacts/evidence-run/er1-2a2-f01-query-repair/`.

## Files

- `backend/src/evidence-run/queryCompiler.js`
- `backend/src/evidence-run/queryPlanner.js`
- `backend/src/evidence-run/queryQuality.js`
- `backend/src/evidence-run/retrievalCoordinator.js`
- `backend/src/evidence-run/ids.js`
- `backend/src/evidence-run/runQueryPlanningReview.js`
- `backend/test/evidence-run/offlinePlanning.test.js`
- `backend/test/evidence-run/queryPlannerRepair.test.js`
- `scripts/dev/er1_run_query_planning_review.mjs`

## Safety

This was offline planning only. No provider call, source-body fetch, scrape, PDF extraction,
model call, database read/write, migration, assertion extraction, bearing assessment,
stance assignment, evidence link, persistence, projection, API, or UI work occurred.
