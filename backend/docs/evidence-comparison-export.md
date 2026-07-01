# Evidence comparison export

This developer export compares persisted legacy claim links with the most recent
in-memory bearing evaluation for the same task content.

## Endpoint

```text
GET /api/dev/evidence-comparison/export?content_id=123&format=csv
```

`content_id` is the case/task row's `content.content_id`.

The default response is `evidence_comparison_<content_id>.zip`, containing:

- `evidence_comparison_links_<content_id>.csv`
- `evidence_comparison_load_<content_id>.csv`

For an individual CSV, add `sheet=links` or `sheet=load`. XLSX is not currently
offered because the backend has no workbook library installed.

Founder/product review sheets are available separately and do not change the
existing debug ZIP:

- `sheet=review` → `evidence_comparison_review_<content_id>.csv` (mirrors **Focused Review**)
- `sheet=summary` → `evidence_comparison_summary_<content_id>.csv` (mirrors **By Case**)
- `sheet=metrics` → `evidence_comparison_token_summary_<content_id>.csv` (mirrors **Token Summary**)
- `sheet=gating` → `evidence_comparison_gating_projection_<content_id>.csv` (mirrors **Gating Projection**)

The review sheet contains accepted legacy and bearing matches with a compact
comparison bucket. The summary separates current-run actual estimates from a
conservative snippet-gate projection. The gating sheet explains every candidate
projection; only candidates marked `reject` that were actually scraped may
contribute projected downstream savings.

In production, set `ENABLE_DEV_EVIDENCE_EXPORT=true` to expose the route. It is
enabled automatically outside production.

## Data availability

Legacy links come from `reference_claim_task_links` and
`reference_claim_links`. Bearing packets and candidate/load measurements are
kept in a bounded in-memory registry for 24 hours after an evidence run, up to
50 contents. Restarting the backend clears this registry. Historical exports
still contain legacy DB rows but mark unavailable bearing/load cells as
`not_available`.

Packet items are currently quote/document-level. They do not have durable source
claim IDs, so `bearing_source_claim_id` is `not_available`; the selected quote is
exported in `bearing_source_claim_text`. The smallest later improvement is to
attach the matched `reference_claim_id` to packet items after reference claim
extraction, then persist that ID only after the bearing-link migration is
approved.

OpenAI usage metadata is not retained by the current wrapper. Token columns use
conservative character/4 estimates and set `token_usage_is_estimated=true`.
Costs remain `not_available` unless `OPENAI_INPUT_COST_PER_1M` and
`OPENAI_OUTPUT_COST_PER_1M` are configured.

Token figures remain character-count estimates. Projected deltas are not actual
savings unless live bearing gating was enabled for that run.

This export does not alter adjudication, link persistence, retrieval, or UI
behavior. Projected savings are labeled separately from actual shadow work.
