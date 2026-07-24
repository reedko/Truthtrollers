# CF3 frozen evaluation apparatus

Compare CF2 and CF3 on a **fixed** candidate inventory, and score six dimensions
independently with full candidate lineage. Reads either system's `result.json`.

## The six scored dimensions
1. **tuple correctness** — is the discourse tuple (substance · attribution · treatment ·
   effect) right? (per selected tuple: ok / frame-residue / source-wrong / substance-wrong / multi)
2. **position-map quality** — coverage across the article (per run)
3. **treatment** — `articleTreatment` accuracy (per tuple)
4. **target-specific effect** — `thesisEffect`/`effectIfTrue` vs the stance anchor (per tuple)
5. **relevance** — per tuple
6. **selection** — did the portfolio pick the right candidates? (per run)

Scores auto-save to `localStorage` (keyed by system+fixture+candidate) and export to JSON.

## Three review views (per run)
- **Discourse tuples** — each selected assertion decomposed, with its raw candidate.
- **Article-position map** — every candidate placed by quarter; ● selected / ○ rejected /
  orange challenged. Front-loading and empty quarters are visible at a glance.
- **Candidate lineage** — every candidate traced discovery → selection or rejection.

## Frozen candidate inventories (committed)
`frozen/CF3-CF1-F0{1,3,8}/repeat1-inventory.json` and `frozen/CF2-CF1-F0{1,3,8}-frozen.json`
are the reusable frozen candidate sets for F01, F03, F08. The bulky labeled selection runs
and full CF2 outputs are gitignored (regenerable).

## Regenerate

```bash
# Freeze CF3 discovery inventory (4 calls/fixture)
node backend/experiments/cf3/run-discovery.mjs --fixture CF1-F03 --repeats 1 \
  --out backend/experiments/cf3/eval/frozen/CF3-CF1-F03

# Run selection on the frozen inventory
node backend/experiments/cf3/run-argument.mjs --fixture CF1-F03 \
  --inventory backend/experiments/cf3/eval/frozen/CF3-CF1-F03/repeat1-inventory.json \
  --repeats 1 --argument-model gpt-4.1-mini --out .../labeled

# Freeze CF2 (its candidates + labels come from one full run)
node backend/experiments/cf2/run.mjs --fixture CF1-F03 --out .../CF2-CF1-F03

# Build a review page
node backend/experiments/cf3/eval/review.mjs <result.json> --system CF3 --fixture CF1-F03 --out review.html
```

## First observations (F01/F03/F08, one selection each)

| run | candidates | selected | candidates/quarter | selected/quarter |
|---|---|---|---|---|
| CF2 F01 | 18 | 8 | 9/3/0/6 | 4/3/0/1 |
| CF2 F03 | 18 | 12 | 12/0/4/2 | 6/0/4/2 |
| CF2 F08 | 10 | 2 | 3/2/3/2 | 2/0/0/0 |
| CF3 F01 | 95 | 12 | 33/38/3/21 | 7/0/0/5 |
| CF3 F03 | 117 | 12 | 36/19/38/24 | 9/1/1/1 |
| CF3 F08 | 8 | 5 | 3/1/2/2 | 3/1/1/0 |

- **CF3 discovery finds ~5–6× more candidates** than CF2 (overcomplete inventory by design).
- **CF3 selection front-loads and wastes that breadth** — F01 selected 7/0/0/5 despite 38
  candidates in Q2; F03 selected 9/1/1/1. CF2's thinner inventory distributes more evenly.
- **F08 is a control, not a failure.** It is a 131-word earthquake news brief with ~8 plain
  facts, no argument/attribution/stance. Both systems extract it cleanly (8 candidates =
  complete). It cannot discriminate the systems — every failure mode needs an argumentative
  article. Only difference of note: CF2 under-selected hard (2 of 10) vs CF3 (5 of 8).
  **Judge the systems on F03/F01, not F08.**
