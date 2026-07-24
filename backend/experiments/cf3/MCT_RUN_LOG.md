# CF3 MCT run log

One line per decision that a future session would otherwise re-litigate. Newest last.

- **2026-07-24** — `assertionSource.sourceUnitIds` + `citedWorks` removed from the argument
  schema in runs `035004`/`035041` (and pre-byline `034145`/`034224`); **no effect on the
  target defect** (source-name degeneracy stayed 0/12 both with-fields and without —
  owned by the `article_voice` byline clause, not the removal). Removal also proved
  model-dependent: `gpt-5-mini` populates `citedWorks` 8/12 and diverges `sourceUnitIds`
  from grounding 3/12, while `gpt-4.1-mini` treats both as dead weight. **Restored per
  MCT §6.2** (commits `97d4373a`/`4608d977`); frozen-inventory replay `062906` green
  (treatment `challenged 4 / adopted 7 / reported 1`, source `1/12` degenerate). Removal
  was not meaningful to the target defect — do not re-attempt as a source fix.
