# CF4 deterministic assertion pipeline

This directory implements the staged pipeline in
`CF4_DETERMINISTIC_PIPELINE_BUILD_PLAN_2026-07-24.md`.

Only Phase 0 (S1 parsing and S2 attribution splitting) exists. Do not begin S3 until the
Phase 0 hand-audit gate passes at 90% or better, including the required F03 U0037 split.

Run:

```bash
node backend/experiments/cf4/run-phase0.mjs
```

The runner writes replayable artifacts under
`artifacts/claim-foundry/cf4/deterministic-phase0/<timestamp>/`.

