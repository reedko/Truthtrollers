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
- **2026-07-24** — Option A (crux/dependency-first selection, `--selection-mode crux`)
  **shelved**. Frozen-inventory A/B (035004 inventory): specific-crux selection 0/4 vs
  balanced 2/5, +1.5 recall side-effect (7.0→8.5/17), and it **worsened front-loading**
  (selected 9/1/0/2, 11/1/0/0 vs balanced 5/1/3/3). Kept as an off-by-default toggle; do
  not enable as the crux fix. Root cause is hearsay framing + post-selection de-attribution,
  not lack of a centrality axis.
- **2026-07-24** — Front-loading is a **selection** defect, not discovery: candidates span
  all quarters (e.g. 36/20/35/47) yet selection took 12/0/0/0. Needs a host coverage floor,
  not a prompt nudge. Subject-as-source found (F10): "the CDC committed fraud" → source=CDC
  (accused ≠ source). Both captured in FABLE_HANDOFF-synthesis.md with the unified fix.
