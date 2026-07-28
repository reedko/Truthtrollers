# CF2 evaluation-v1 review guide

This apparatus separates errors that earlier CF2 reports collapsed together.
Reviewers should judge only the supplied article and frozen source units. Do not
use outside evidence to decide whether an assertion is true.

## 1. Discourse tuple

Review the complete source-bearing structure:

```text
reporting voice
  → zero or more attribution events
    → substantive assertion P
      → content supplier
      → primary verification target
```

The `surfaceStatement` is what Call A handed downstream. It may contain a
reporting frame. The `substantiveAssertion` is the innermost externally testable
content after removing frames such as “X said” when the important question is
whether P is true. The `contentSupplier` is whoever supplies P in the article,
not merely evidence cited for P.

Review each tuple field independently. A correct substantive assertion does not
make an incorrect supplier correct, and vice versa.

## 2. Article-position map

Review the observed position map before correcting it. A position is an atomic
factual commitment or central factual payload against which candidate effects
can be evaluated. It is not required to be a single universal thesis sentence.

Use the article mode:

- `argument`: the article advances a case;
- `primary_study`: the central payload is a study result or set of results;
- `straight_news`: the central payload is the reported event and its core facts;
- `explanatory`: the article chiefly explains a subject;
- `hybrid`: more than one mode is indispensable.

Score map quality on four axes:

- `coverage`: important positions or payloads are represented;
- `atomicity`: each position supports one interpretable comparison;
- `direction`: the article’s commitment is stated in its actual polarity;
- `genreFit`: the map represents what matters for this article type.

Then enter the corrected position map. Position IDs must be stable within the
fixture (`POS01`, `POS02`, and so on).

## 3. Candidate labels

Review these dimensions independently:

- `articleTreatmentGold`
  - `adopted`: used as part of the article’s own case or factual payload;
  - `challenged`: introduced to dispute, reject, or discredit it;
  - `reported`: presented without clear adoption or challenge.
- `targetRelationsGold`: for each relevant position, assume the candidate is
  true and judge whether it `strengthens`, `weakens`, or has `no_effect` on that
  named position.
- `relevanceGold`
  - `essential`: omitting it materially distorts the article’s case or payload;
  - `supporting`: useful evidence for an important position;
  - `contextual`: helps interpret the article but is not a core fact-check target;
  - `incidental`: true or testable but peripheral;
  - `exclude`: malformed, redundant, unsupported, or not useful for evaluation.
- `selectionGold`: whether this candidate belongs in the bounded final
  portfolio. This is not identical to relevance: selection also accounts for
  redundancy and balanced coverage.

## 4. Scoring

The scorer reports six separate dimensions:

1. discourse-tuple correctness;
2. article-position-map quality;
3. article treatment;
4. target-specific effect;
5. relevance;
6. selection.

It never calculates an overall score. A missing gold review or missing
prediction is reported as unavailable or uncovered, rather than silently
counted as correct.
