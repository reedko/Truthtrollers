# CF2 protected best current checkpoint

## CF2 V5 — 2026-07-24

This is the strongest combined CF2 checkpoint from the session. It is protected
as a comparison baseline, not declared production-ready.

- Commit: `a08e2d5d`
- Architecture: `CF2_MINIMAL_FACT_DOCKET_V5_STRUCTURAL_ATTRIBUTION`
- Fixture: `CF1-F03`
- Artifact:
  `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724`
- Report:
  `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724/report.html`
- Result:
  `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724/result.json`
- Full prompts, code, and failure analysis:
  `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724/CF2_V5_CURRENT_CHAIN_FULL_PROMPTS_AND_CODE_2026-07-24.md`

### Frozen runtime identity

| Component | Value |
|---|---|
| Call A model | `gpt-4o-mini-2024-07-18` |
| Call A prompt SHA-256 | `2a9d71acfc2e020d947abab41bf1a78dae475f03df00c3b0436719b2c70a1ec3` |
| Call A schema SHA-256 | `472dd1b8a9efa07ceb851a557d6c5fba405149035e7b252d8783b6c24ee6e790` |
| Call B model | `gpt-4.1-mini-2025-04-14` |
| Call B prompt SHA-256 | `d8d9777d59d48d1064e92be1ddefa387f456dcf58be748fa986a0add8fe8f810` |
| Call B schema SHA-256 | `1ab0c7f995b6da56520ff939f1ad31ae8f9ea905835fb0b5e827ce98f0aae8fc` |
| Call C model | `gpt-4.1-mini-2025-04-14` |
| Call C prompt SHA-256 | `2d0f817c234af1f2656d3bb4b1e13f1c9840eb703a5c016c64d6d45563d97e21` |
| Call C schema SHA-256 | `bf4bc30a9db256b21d60c67e996461b4edff74cc4e3aebc443e7bd7bcbe3d9aa` |

### What V5 did best

- Call A returned 18 useful candidate assertions.
- It retained the three conspicuous Jefferson County Public Health opponent
  assertions.
- Call B assigned all three `weakens`, producing host-derived `invert`.
- The conservative grounding repair corrected two selected grounding errors.
- The explicit-list owner rule assigned the three opponent assertions to
  Jefferson County Public Health.
- End-to-end execution took 35.4 seconds and 30,489 tokens.

### Why V5 is not solved

Call B retained the reporting frame in:

> William Thompson revealed privately in 2014 that data linking the MMR vaccine
> to autism had been manipulated by the CDC.

The intended substantive assertion was:

> The CDC manipulated data linking the MMR vaccine to autism.

The intended content supplier was William Thompson. Because the reporting frame
remained, Call C selected article voice/Ana Wolpin as the supplier of the larger
sentence. Nine of twelve selected assertions ultimately resolved to article
voice, so general attribution remained too coarse.

### Preservation rule

Later CF2 experiments must use separate versioned modules or an explicit
architecture switch. Do not silently rewrite V5 and then call the result V5.
