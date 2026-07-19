# CF1 Claim-Foundry Benchmark Archive

This directory contains deliberately preserved benchmark artifacts. Most other files under
`artifacts/` remain ignored. These records are committed because prompt/model behavior cannot be
reconstructed reliably from source code alone.

## What is preserved

- `split-arm/`: the complete July 18–19 split-Call-1 development history, including raw JSON,
  interactive reports, replay inputs and outputs, and failed-run diagnostics.
- `prompt-sets/cf1pb-20260717-01/blind/full-f03-screen/`: the original blinded four-arm F03 screen.
- `prompt-sets/cf1pb-20260717-01/reports/`: selected B/C/D/E/F/H/X/E2 comparison reports and CSVs.
- `../claim-foundry-basic/`: the isolated CF0 simple/superblind baseline experiments.

Generated benchmark directories are immutable records. Do not overwrite an existing run; create a
new timestamped run.

## Landmark split runs

| Run | Why it matters |
| --- | --- |
| `split-20260719-113836-182bd9` | Best early 20-candidate F03 inventory; source of many frozen 1B replays. Older runner did not record prompt fingerprints or arm identity, so exact prompt provenance is not proven. |
| `split-20260719-123330-1966cb` | Later atomic-looking F03 extraction used while developing attribution context and reports. |
| `split-20260719-124930-7252c4` | Article-voice candidate experiment that exposed source-input effects on stance. |
| `split-20260719-130729-9fa19d` | Parent run for stored-packet 1B replays and source-candidate suppression tests. |
| `split-20260719-163509-920c10` | Three full GPT-4.1-mini repeats with Simple V2 1A and attribution-host V4. Raw 1A counts were 15, 13, and 15; opponent recall varied. |
| `split-20260719-170832-7e8e4b` | GPT-5-mini 1A / GPT-4.1-mini 1B. Produced 56 raw candidates and recovered all five JCPH opponent propositions, but was slow and token-heavy. |

Directories such as `split-20260719-163206-636924`, `split-20260719-163442-b7ae04`,
`split-20260719-170423-2059dc`, and `split-20260719-170447-84e7b5` preserve failed attempts and
are useful for distinguishing sandbox/network failures and timeouts from semantic model failures.

## Provenance rules

1. Prefer `modelCalls.call1a.request` and `modelCalls.call1b.request` fingerprints when present.
2. Treat an old directory name, report title, or remembered arm label as descriptive—not proof of
   the exact assembled prompt.
3. Responses API runs are unseeded. Older artifacts may contain a synthetic `seed` recorded by the
   harness even though the Responses transport did not send it.
4. Compare raw 1A output before deterministic selection when evaluating recall or atomicity.
5. Compare stored-packet 1B replays only for 1B/host behavior; they do not measure fresh 1A variance.

## Recommended next comparisons

- V1 1A with GPT-4.1-mini versus Simple V2 1A with GPT-4.1-mini.
- One diagnostic V1 1A run with GPT-5-mini, with cost and latency recorded.
- Add an atomicity diagnostic to reports before selecting a production 1A configuration.
- Restore grounded named-study hints only after the 1A configuration is selected.
