# CF3: Chunked discovery + argument (synthesis)

CF3 is an isolated benchmark architecture — the "Fable synthesis" from
`ml/cf1-argument-model/data/annotation-prompts/stupidity/CF1_SYNTHESIS_ARCHITECTURE_PROPOSAL_2026-07-24.md`.
It does not modify or participate in CF1, production claim extraction, the evidence
engine, or CF2. It imports only stable read-only utilities (`validateArticleInput`,
`articleDocumentFromText`, the CF1 model runner and OpenAI transports) and fixture data.

## Current state (v2, 2026-07-24)

Evolved from the original synthesis via a doc-loop with Fable. Key deltas from the first
draft below:
- **Discovery schema is two arrays** (`cf3_discovery_v2`): `challengedAssertions` (first)
  + `assertions`, no per-item `challenged` boolean — the host tags challenged by array.
  The `assertions` branch says "worded so it can be checked as written" (a de-attribution
  clause there suppressed reported-statement content like the Thompson cluster; reverted).
- **Argument output field is `testableAssertion`** (fresh field, not an in-place rewrite),
  and `sourceUnitIds` + `citedWorks` were **dropped** from the model — host fills
  `sourceUnitIds` from the grounding join; `citedWorks` is host-derived from the
  ArticleDocument citation structure (empty on plaintext fixtures).
- **De-attribution lives only in the argument call** (`testableAssertion`), never discovery.
- `article_voice` sources use the **byline** as the name.
- Argument model is configurable (`--argument-model`, `--argument-effort`,
  `--argument-max-tokens`). Best run so far uses `gpt-4.1-mini` — see [BEST_RUN.md](./BEST_RUN.md).
- Findings: `CF3_SOURCE_FUSED`, `CF3_REPORTING_RESIDUE`, `CF3_ASSERTION_VERBATIM_COPY`,
  `CF3_CHALLENGED_DROPPED`, `CF3_POLARITY_FLIP_SUSPECTED`, `CF3_BRANCH_CONCENTRATION`.
- Open design gap: no thesis-dependency (crux) axis in selection — see
  [FABLE_HANDOFF_2026-07-24-crux-selection.md](./FABLE_HANDOFF_2026-07-24-crux-selection.md).

The architecture diagram below describes the original shape; the flow is unchanged, only
the field/schema details above differ.

## The three problems it composes a fix for

| Problem (from the record) | Mechanism CF3 uses |
|---|---|
| Discovery coverage (no whole-article single call ever balanced) | **chunked minimal discovery** (V7/V11 evidence) |
| Discovery == selection collapse (misses unrecoverable) | **overcomplete inventory + one comparative batch call** (Vector B) |
| Labeling cost / source→stance coupling | **select-then-label-12-only, stance before source** (8172 crash; §8.4) |

## Architecture

```text
host: inject unit IDs, structural split → 4 chunks (~10% overlap)

DISCOVERY — 4 parallel calls        GPT-4o-mini, Chat Completions, temp 0.2
  per-chunk minimal schema:         { assertionText, groundingUnitIds, challenged }

host: merge, exact + normalized dedupe (keep challenged=true on merge, union
      grounding), validate unit IDs against chunk range, assign global IDs A001..A0nn

ARGUMENT — one batch call           GPT-4.1-mini, Responses, reasoningEffort none
  input: FULL article + complete inventory
  output: stanceAnchor, selected 12 IDs, labels for the 12 only, argument branches

host: validate (count == portfolioSize, uniqueness, ids exist, set equality, enums),
      derive scoreTransform mechanically, join grounding by ID, record findings,
      write result.json, claims.csv, report.html
```

Five model calls total (four small parallel discovery + one argument). Downstream
evidence call is the existing Call 2 / ER1 contract and is out of scope here.

## Host boundary

The host may validate identifiers, reject malformed output, dedupe (exact +
normalized only), assign stable IDs, join grounding by ID, derive `scoreTransform`,
and record non-blocking findings. The host may **not** invent assertions, infer or
backfill a source, rewrite propositions, relink grounding, run repair/census-recovery
calls, or perform semantic selection.

### scoreTransform (host-derived, §4)

`adopted → normal` · `challenged → invert` · `reported →` by `thesisEffect`
(`strengthens → normal`, `weakens → invert`, `no_effect → none`).

### Non-blocking findings

`CF3_GROUNDING_OUT_OF_CHUNK`, `CF3_CHALLENGED_DROPPED`, `CF3_POLARITY_FLIP_SUSPECTED`,
`CF3_BRANCH_CONCENTRATION`, plus the quarter-coverage distribution. Structural
violations (count, uniqueness, unknown ID, set mismatch, invalid enum) throw.

## Deliberately absent

Pillars, theme/fullThesis/thesisHinge, per-item centrality/verifiability/priority/
materiality numbers, model-emitted scoreTransform, searchText at discovery, atomicity
audit fields, atomic-repair call, census recovery, host backfill, pointwise selection,
numeric discovery targets in prose, the fine-tuned adapter (parked).

## Deviation from the proposal

Schema `name` fields use a `cf3_` prefix (`cf3_discovery_v1`, `cf3_argument_v1`)
instead of the doc's `cf1_` so structured-output provenance fingerprints never collide
with a real CF1 schema. All prompt text and schema shapes are otherwise verbatim.

## Run

From the repository root:

```bash
node backend/experiments/cf3/run.mjs --fixture CF1-F03
```

Options:

```text
--discovery-model gpt-4o-mini
--argument-model gpt-4.1-mini
--portfolio-size 12
--chunks 4
--timeout-ms 180000
--seed 3724605090
--out artifacts/claim-foundry/cf3/my-run
```

The seed applies to Chat Completions discovery calls. The Responses argument call
records no seed (that API/model combination is not deterministic).

## Test

Offline, no API key required:

```bash
node --test backend/experiments/cf3/test.mjs
```

## Open risk (from the proposal §8)

The argument call performs selection **and** labeling in one completion — the design's
least-proven element. Mitigation: labeling applies to 12 items only; selection is
input-side comparison over the full inventory. If evaluation shows front-loading or
dropped-but-present opponents, the §7 fallback is a dedicated tiny selection call
(inventory in, 12 IDs out) before labeling — `normalizeArgument` is written so that
split can be introduced without touching discovery or the host join.
