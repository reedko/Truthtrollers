# CF2 frozen evaluation apparatus v1

This package evaluates assertion extraction without rerunning discovery.

It freezes representative CF2 V7 Call A inventories for:

- `CF1-F01` — primary research paper;
- `CF1-F03` — long advocacy article with attributed opponent assertions;
- `CF1-F08` — very short straight-news report.

The source runs are all from:

```text
artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724
```

## Files

```text
formats/
  discourse-tuple-review.schema.json
  article-position-map-review.schema.json

frozen/
  manifest.json
  CF1-F01.inventory.json
  CF1-F03.inventory.json
  CF1-F08.inventory.json

observed/
  CF1-F01.observed-prediction.json
  CF1-F03.observed-prediction.json
  CF1-F08.observed-prediction.json

reviews/
  CF1-F01.discourse-tuples.review.json
  CF1-F01.article-position-map.review.json
  ...

traces/
  CF1-F01.trace.json
  CF1-F03.trace.json
  CF1-F08.trace.json
```

`report.html` presents all three fixtures, every frozen candidate, its grounding,
Call B result or rejection, and final selection outcome.

See `REVIEW_GUIDE.md` for the operational definitions used by both review
formats and the scorer.

## Review workflow

1. Do not edit files under `frozen/`, `observed/`, or `traces/`.
2. Review and edit only the two files under `reviews/` for each fixture.
3. In the discourse-tuple review, correct the source-bearing discourse tuple and
   mark each tuple field independently.
4. In the article-position-map review, define the article's atomic positions or
   central factual payloads, then annotate candidate treatment, target-specific
   effect, relevance, and selection separately.
5. Run the scorer. Unreviewed fields are reported as unavailable, never as
   incorrect.

## Commands

Regenerate the freeze from the three named source artifacts:

```bash
node backend/experiments/cf2/evaluation-v1/freeze.mjs
```

This command verifies and preserves compatible existing review files. It refuses
to overwrite a review attached to a different freeze or inventory hash.

Verify contracts, hashes, and trace completeness:

```bash
node --test backend/experiments/cf2/evaluation-v1/test.mjs
```

Score one fixture after review:

```bash
node backend/experiments/cf2/evaluation-v1/score.mjs \
  --fixture CF1-F01
```

The scorer emits separate measurements for:

- tuple correctness;
- position-map quality;
- article treatment;
- target-specific effect;
- portfolio relevance;
- final selection.

It intentionally emits no composite score.
