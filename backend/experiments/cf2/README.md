# CF2: Minimal fact-check docket

CF2 is an isolated benchmark architecture. It does not modify or participate in
CF1, production claim extraction, the evidence engine, or CF3.

## Architecture

```text
Call A: complete article
  -> one thesis assertion
  -> at most 18 grounded, source-preserving factual candidates

Call B: thesis + candidates + deterministic local context
  -> one clean fact-check assertion and judgment per candidate
  -> article treatment
  -> effect if true
  -> assertion source

Host
  -> validates lineage and uniqueness
  -> derives scoreTransform mechanically
  -> retains challenged or thesis-weakening assertions
  -> fills the remaining 12-item portfolio across article position
  -> writes result.json, claims.csv, and report.html
```

Call A uses GPT-4o-mini Chat Completions by default. Call B uses GPT-4.1-mini
Responses by default.

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

The host may not invent assertions, infer a source, infer stance from keywords,
rewrite propositions, or create semantic backfills.

## Run

From the repository root:

```bash
node backend/experiments/cf2/run.mjs --fixture CF1-F03
```

Useful options:

```text
--call-a-model gpt-4o-mini
--call-b-model gpt-4.1-mini
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
