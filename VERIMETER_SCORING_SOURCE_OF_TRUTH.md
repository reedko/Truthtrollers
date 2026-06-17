# Verimeter Scoring Source Of Truth

Canonical user-link Verimeter scoring lives in:

- `backend/src/services/verimeterScoringService.js`

Do not calculate user Verimeter scores directly from `content_scores`, `claim_scores`, or stored procedures. Those are legacy cache/procedure paths and should not be treated as authoritative.

## Active Backend Callers

- Content/case score: `GET /api/content/:contentId/scores/user`
- Combined score user side: `GET /api/content/:contentId/scores/combined`
- Legacy content score route: `GET /api/verimeter/:contentId`
- Claim score: `GET /api/live-verimeter-score/:claimId`
- Claim score map: `GET /api/content/:contentId/claim-scores`
- TT Live content score enrichment
- Admin preview: `GET /api/admin/verimeter-policy/preview`

AI-only scoring remains separate in `backend/src/modules/aiRatings.js`; when combined mode is used, the user side is still supplied by `verimeterScoringService.js`.

## Current User-Link Formula

Only enabled, non-AI claim links with non-zero `support_level` are included. Extracted but unlinked claims do not average in as zeroes.

For each link:

```text
link_weight =
  source_crest_factor
  * reviewer_reputation_factor
  * publisher_rating_factor
  * author_rating_factor

weighted_link_score = support_level * link_weight
```

The content or claim Verimeter is:

```text
sum(weighted_link_score) / sum(link_weight)
```

Missing ratings are neutral. They do not punish the score.

## Config

Weights and toggles are stored in:

- `verimeter_weighting_config`

Migration:

- `backend/migrations/create_verimeter_weighting_config.sql`

Admin UI:

- Admin Panel -> Verimeter Algorithm

Publisher and author rating factors start disabled because those ratings can be user-applied and need rater-reputation weighting before they should affect production scores.
