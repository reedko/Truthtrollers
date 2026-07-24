# CF2 V6 — bounded attribution recursion

V6 is an isolated downstream experiment built on the protected CF2 V5 Call A.
It does not replace V5 as the best current checkpoint.

## Causal hypothesis

A source-preserving sentence may contain both:

- an attribution event, such as `William Thompson revealed P`; and
- the substantive fact-check proposition `P`.

Flattening those into one `assertionText` causes the assertion target and source
to change together. V6 preserves an ordered, bounded attribution path and derives
the final assertion/source pair from its innermost valid layer.

## Architecture

1. Call A is byte-for-byte the existing V5 discovery prompt and schema.
2. The host detects only literal attribution syntax such as:
   - `According to X, P`;
   - `X revealed ... that P`;
   - `Document D declared that P`.
3. Call B returns zero to four ordered attribution layers and one standalone
   substantive assertion.
4. The host:
   - rejects an omitted literal attribution cue;
   - rejects an invented, ungrounded reporting operator;
   - rejects retained reporting frames and unresolved anaphora;
   - derives the source from the innermost layer;
   - derives `scoreTransform` from `effectIfTrue`;
   - retains V5's structural list-owner rule.
5. Call C cannot change the supplier. It only proposes optional evidence anchors.
   Ungrounded optional anchors are discarded rather than blocking the docket.

Before Call B, the host also handles one narrow current-work ambiguity:

- `we/our study/this study found P` is reduced to `P` and sourced to the
  article byline when the cited grounding independently supports `P`;
- an ungrounded Call A prefix such as `the study found P` receives the same
  repair only when the cited grounding independently states `P`;
- a genuinely grounded `the study found P` is preserved so Call B can resolve
  its external-study antecedent;
- weak or ambiguous grounding is left unchanged and remains eligible for
  quarantine.

The untouched Call A surface, normalized Call B input, and repair decision are
all preserved in the report audit.

## Results on F03

### Replay using the protected V5 Call A inventory

Artifact:
`artifacts/claim-foundry/cf2/cf1-f03-v6-replay-ab-bounded-recursion-20260724`

This replay simultaneously produced:

- the three JCPH opponent assertions with `weakens -> invert`;
- `data linking the MMR vaccine to autism had been manipulated by the CDC`
  sourced to William Thompson;
- `MMR vaccines did not cause autism` sourced to the CDC-released study and
  assigned `weakens -> invert`;
- locked suppliers that Call C could not overwrite.

### Genuine live end-to-end run

Artifact:
`artifacts/claim-foundry/cf2/cf1-f03-v6-bounded-recursion-live-20260724`

- 18 candidates;
- 12 selected assertions;
- 3 calls;
- 28.3 seconds;
- 30,022 tokens;
- all three JCPH opponents retained with correct source and transform;
- prefix `According to CDC, P` was correctly decomposed.

The fresh Call A did not emit the Thompson or fraudulent-study candidates, so V6
could not recover them. This confirms that V6 repairs representation after
discovery but does not repair discovery recall.

## Known failures

- `articleTreatment` collapsed to `reported` in the tested V6 outputs.
- Suffix attribution such as `P, according to X` is not yet a mandatory cue.
- Passive wording such as `P is claimed to be Q` can remain contaminated.
- Compound assertions from Call A remain compound.
- Call A candidate recall still varies despite unchanged prompt, schema, and seed.

## C30 capacity ablation

The candidate ceiling can be changed without altering default V6:

```bash
node backend/experiments/cf2/v6/run.mjs \
  --fixture CF1-F03 \
  --candidate-maximum 30 \
  --portfolio-maximum 12 \
  --candidate-failure-mode quarantine \
  --out artifacts/claim-foundry/cf2/my-v6-c30-run
```

See `C30_FINDINGS_2026-07-24.md` for the F01/F02/F03 results. Default V6 remains
C18/P12 with strict candidate validation.

The optional host-only treatment fallback is enabled with:

```bash
--selection-policy treatment_fallback
```

It always admits challenged assertions, then uses adopted `no_effect` assertions
only to fill an otherwise underfull portfolio. It never changes the model's
effect label and never rescues `reported + no_effect`.

## Run

```bash
node backend/experiments/cf2/v6/run.mjs \
  --fixture CF1-F03 \
  --seed 3724605090 \
  --out artifacts/claim-foundry/cf2/my-v6-run
```

Replay saved Calls A or B during downstream debugging:

```bash
node backend/experiments/cf2/v6/run.mjs \
  --fixture CF1-F03 \
  --replay-call-a path/to/result.json \
  --replay-call-b path/to/progress.json \
  --out artifacts/claim-foundry/cf2/my-v6-replay
```

Run Call A alone when measuring discovery recall without paying for Calls B/C:

```bash
node backend/experiments/cf2/v6/run-call-a.mjs \
  --fixture CF1-F03 \
  --model gpt-4o-mini \
  --repeats 2 \
  --seed 3724605090 \
  --out artifacts/claim-foundry/cf2/my-call-a-comparison
```
