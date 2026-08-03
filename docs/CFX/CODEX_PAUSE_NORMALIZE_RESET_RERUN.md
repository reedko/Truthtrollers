# Codex Command: Pause, Normalize Unit IDs, Reset, and Rerun Fixtures

Pause the current validation sequence.

Implement a deterministic unit-ID normalization helper at the S1/S2 host boundary before structural validation.

Required behavior:

```text
U9    -> U0009
U09   -> U0009
U009  -> U0009
U0009 -> U0009
```

Rules:

- accept only the exact shape `U` followed by digits;
- canonicalize to the fixture’s configured unit width;
- accept the normalized ID only if it exists in that fixture’s authoritative S0 inventory;
- require a unique resolution;
- reject malformed, ranged, mixed, or nonexistent IDs;
- preserve the original model-returned value in diagnostics;
- record whether normalization occurred;
- do not repair proposition text, source, stance, or any semantic field.

Add focused tests for:

- already-canonical IDs;
- one-, two-, and three-digit variants;
- nonexistent normalized IDs;
- malformed IDs;
- no cross-fixture leakage;
- exact preservation of the original returned value in diagnostics.

Then:

1. discard the interrupted validation outputs;
2. reset the fixture validation run cleanly;
3. rerun all selected fixtures from the beginning;
4. run each fixture twice as previously specified;
5. regenerate all per-run, comparison, and recommendation reports;
6. continue to conditional promotion only after the full rerun completes.

In the final report, classify this defect as:

```text
structural identifier-formatting defect
deterministically repairable
not a semantic proposition failure
```

Report the exact files changed, tests added, commands run, and paths to the regenerated artifacts.
