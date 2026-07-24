# CF3 best run so far — 2026-07-24

**Run:** `cf1-f03-BEST-4p1mini-035004` (artifacts are gitignored; this is the tracked record).
**Config:** v2 prompts (two-array discovery, `testableAssertion`), `sourceUnitIds`/`citedWorks`
dropped (host-filled), `article_voice`→byline fix applied.

```bash
node backend/experiments/cf3/run.mjs --fixture CF1-F03 --argument-model gpt-4.1-mini
```

- discovery: 4× `gpt-4o-mini` Chat Completions, temp 0.2
- argument: `gpt-4.1-mini` Responses, effort none, max_output 4000

**Why it's the best yet (F03):**
- **34.6s** (fast — the reason for the 4.1 arm).
- **Source: 0/12 degenerate names**, kinds `document 5 / person 4 / study 2 / institution 1` — no `article_voice` fallback at all (the byline fix pushed it to resolve real originators).
- **Treatment `challenged 5 / adopted 7`** (zero `reported` — the honest read), **effect `weakens 5 / strengthens 7`**. No collapse.
- 133 inventory → 12 selected.

Companion for comparison: `cf1-f03-20260724-035041` = same config, `gpt-5-mini` argument
(also 0/12 degenerate, richer `study` kinds, but ~50s and leaned more `reported`).

**Caveat:** n=1, unseeded. gpt-4.1-mini source quality was historically high-variance
(0/12 most runs, 10/12 in one collapse); this run is a clean sweep but not proof of
stability. Known open gap: the thesis-central "CDC manipulated the MMR–autism data"
claim is in the candidate pool but not reliably selected — see
[FABLE_HANDOFF_2026-07-24-crux-selection.md](./FABLE_HANDOFF_2026-07-24-crux-selection.md).
