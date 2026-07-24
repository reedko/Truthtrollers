# CF2: Minimal fact-check docket

CF2 is an isolated benchmark architecture. It does not modify or participate in
CF1, production claim extraction, the evidence engine, or CF3.

> **PROTECTED BEST CURRENT CHECKPOINT — CF2 V5**
>
> Commit: `a08e2d5d`
> F03 artifact:
> `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724`
> Call A prompt SHA-256:
> `2a9d71acfc2e020d947abab41bf1a78dae475f03df00c3b0436719b2c70a1ec3`
>
> V5 is the strongest combined checkpoint from the 2026-07-24 session, not a
> solved architecture. Preserve it while testing later CF2 versions. See
> `BEST_CURRENT_CHECKPOINT.md`.

CF2 V6 is an isolated bounded-attribution-recursion experiment. It preserves the
V5 Call A contract and is documented in `v6/README.md`.

## Architecture

```text
Call A: complete article
  -> one thesis assertion
  -> at most 18 grounded, source-preserving factual candidates

Call B: thesis + candidates + deterministic local context
  -> one clean fact-check assertion and judgment per candidate
  -> article treatment
  -> effect if true
  -> preliminary assertion source

Host
  -> validates lineage and uniqueness
  -> derives scoreTransform mechanically
  -> retains challenged or thesis-weakening assertions
  -> fills the remaining 12-item portfolio across article position
  -> gathers repeated occurrences, wider context, byline, and named source candidates

Call C: selected frozen assertions + attribution packets
  -> assertion supplier
  -> separately named evidence anchors

Host
  -> validates that names and unit IDs exist in each supplied packet
  -> resolves an explicit list owner when an assertion is structurally nested under
     a named advertisement or other owned assertion list
  -> cannot change assertion, stance, treatment, transform, or selection
  -> writes result.json, claims.csv, and report.html
```

Call A uses GPT-4o-mini Chat Completions by default. Call B uses GPT-4.1-mini
Responses by default. Call C uses GPT-4.1-mini Responses by default.

## Deliberately absent

CF2 has no theme, thesis hinge, pillars, centrality, materiality score, priority
score, article role, model-generated score transform, confidence, rationale,
atomicity audit, split trace, search query, evidence-target array, census
intervention, or normal-path repair call.

## Host boundary

The host may validate identifiers, reject malformed output, remove normalized
exact duplicates, attach local context, assign stable candidate IDs, and derive a
transform from `effectIfTrue`. If the model explicitly chooses `article_voice`,
the host may copy the already-supplied byline into an empty source-name slot.
When a source unit explicitly names the owner of a following assertion list, the
host may carry that owner onto assertions structurally contained in that list.
This resolution is recorded as `host_structural_list_owner`.

Outside that explicit structural-list case, the host may not invent assertions,
choose the final attribution supplier, infer stance from keywords, rewrite
propositions, or create semantic backfills.

## Run

From the repository root:

```bash
node backend/experiments/cf2/run.mjs --fixture CF1-F03
```

Useful options:

```text
--call-a-model gpt-4o-mini
--call-b-model gpt-4.1-mini
--call-c-model gpt-4.1-mini
--timeout-ms 180000
--seed 3724605090
--out artifacts/claim-foundry/cf2/my-run
```

The seed applies to Chat Completions Call A. Responses Call B records no seed
because that API/model combination does not provide deterministic sampling.

## Test

```bash
node --test backend/experiments/cf2/test.mjs
```

## Compare completed runs

```bash
node backend/experiments/cf2/compare.mjs \
  --out artifacts/claim-foundry/cf2/my-comparison \
  artifacts/claim-foundry/cf2/run-1/result.json \
  artifacts/claim-foundry/cf2/run-2/result.json
```

The comparison report distinguishes named external suppliers, article-voice
attributions, and unresolved sources. These are coverage categories only; a named
source can still be supporting evidence rather than the actual assertion supplier.
