# CF1 prompt-profile benchmark implementation plan

## Decision

Benchmark three static, server-owned CF1 prompt profiles through the existing two-call runtime.
Each profile contains one Call 1 builder and one Call 2 builder. The experiment does not add model
calls, does not expose prompt choice to public consumers, and does not persist benchmark packages.

The first comparison uses the current enforced schemas unchanged:

- Call 1: `cf1_semantic_inventory_v1`
- Call 2: `cf1_selected_enrichment_v3`

The recall-and-reasoning prompt proposed in this discussion fits those schemas. Earlier candidate
ideas (`recallShape`, `reasoningFunction`, `proofMode`, and `recallAudit`) are deliberately excluded
from the first comparison. Changing prompt and schema together would confound the result, and a
model's self-classification is not an independent recall measurement.

## Profiles

Use three immutable profile IDs. Names are visible only in the producer key and raw manifest; human
review packets use randomized A/B/C labels.

```js
export const CF1_PROMPT_PROFILE_IDS = Object.freeze([
  "current_control_v1",
  "recall_reasoning_v1",
  "third_approach_v1",
]);
```

`current_control_v1` must be a frozen snapshot, not an import whose contents change as another arm
is edited. `recall_reasoning_v1` is the single-call Call 1 prompt proposed in this discussion plus
the epistemic-access additions to the existing single Call 2 prompt. `third_approach_v1` remains a
placeholder until its prompt is agreed.

Every profile declares both prompt builders and both schema identities even when two profiles share
the same Call 2. This makes the experimental unit explicit and allows a later prompt-plus-schema arm
without changing the runner contract.

```js
// backend/src/claim-foundry/prompts/profiles/index.js
import * as current from "./currentControlV1.js";
import * as recallReasoning from "./recallReasoningV1.js";
import * as thirdApproach from "./thirdApproachV1.js";

const profiles = new Map([
  [current.profile.id, current.profile],
  [recallReasoning.profile.id, recallReasoning.profile],
  [thirdApproach.profile.id, thirdApproach.profile],
]);

export const DEFAULT_CF1_PROMPT_PROFILE = current.profile;

export function resolveCf1PromptProfile(value = DEFAULT_CF1_PROMPT_PROFILE) {
  const id = typeof value === "string" ? value : value?.id;
  const profile = profiles.get(id);
  if (!profile) throw new TypeError(`Unknown internal CF1 prompt profile: ${id}`);
  return profile;
}
```

Each profile has the same small interface:

```js
export const profile = Object.freeze({
  id: "recall_reasoning_v1",
  call1Version: "recall_reasoning_call1_v1",
  call2Version: "epistemic_access_call2_v1",
  call1SchemaName: "cf1_semantic_inventory_v1",
  call2SchemaName: "cf1_selected_enrichment_v3",
  buildCall1: buildRecallReasoningInventoryPrompt,
  buildCall2: buildEpistemicAccessEnrichmentPrompt,
});
```

## Runtime wiring

Prompt profiles are injected as an internal dependency. They must not be accepted from API request
bodies or ordinary `options`.

```diff
 // backend/src/claim-foundry/runClaimFoundry.js
 const executionArgs = {
   ...,
+  promptProfile: deps.promptProfile,
 };
```

```diff
 // backend/src/claim-foundry/agentExecution.js
 export async function runCf1Agent({ ..., promptProfile }) {
+  const prompts = resolveCf1PromptProfile(promptProfile);
   ...
-  buildSemanticInventoryPrompt(context)
+  prompts.buildCall1(context)
   ...
-  buildSelectedEnrichmentPrompt(enrichmentContext)
+  prompts.buildCall2(enrichmentContext)
 }
```

Add `promptProfile` to the in-memory agent state and step metadata. Package diagnostics should record
the profile ID and prompt/schema versions so a generated package is attributable, but the profile
must not alter the portable semantic contract.

```js
state.promptProfile = {
  id: prompts.id,
  call1Version: prompts.call1Version,
  call2Version: prompts.call2Version,
  call1SchemaName: prompts.call1SchemaName,
  call2SchemaName: prompts.call2SchemaName,
};
```

The benchmark manifest additionally stores SHA-256 fingerprints of the actual system prompt, user
prompt, and response schema sent for every call. Raw model traces already capture the full requests.

## Host behavior during the experiment

Keep host selection, verification, normalization, named-work detection, query construction, and
package assembly identical across all profiles. Otherwise the benchmark will not isolate prompt
quality.

Do not raise the selected-claim ceiling from 10 to 12 in the first prompt comparison. The Call 2
schema currently caps enrichment at 10, and changing selection changes both Call 2 cost and package
composition. The Call 1 candidate ceiling remains 12. A separate host-cap experiment can follow.

Do fix host-authored pillar backfill provenance independently before relying on candidate-recall
metrics, or report model candidates separately from host-added candidates. The primary benchmark
metric must use the raw, verified Call 1 candidate inventory before host backfill.

## Dedicated benchmark runner

Add a benchmark path alongside the existing baseline-versus-CF1 comparison code:

```text
backend/src/claim-foundry/prompt-benchmark/
  runPromptBenchmark.js
  blindPackets.js
  metrics.js
  renderMarkdown.js
  reviewTemplate.js
scripts/testing/
  cf1_run_prompt_benchmark.mjs
  cf1_render_prompt_benchmark.mjs
backend/test/claim-foundry/
  promptProfileRegistry.test.js
  promptBenchmark.test.js
  promptBenchmarkBlindness.test.js
  promptBenchmarkMetrics.test.js
```

Do not generalize `comparison/runComparison.js` first. It is coupled to the legacy baseline adapter,
two producers, A/B ordering, and the existing release-gate report. Changing it would risk the trusted
release comparison while adding conditionals for an experiment with different metrics.

The new runner supports two modes:

```text
--mode call1   Run only semantic inventory; cheapest recall/atomicity/variance screen.
--mode full    Run the unchanged two-call CF1 path and produce verified claim packages.
```

Example interface:

```text
node scripts/testing/cf1_run_prompt_benchmark.mjs \
  --mode call1 \
  --profile current_control_v1 \
  --profile recall_reasoning_v1 \
  --profile third_approach_v1 \
  --fixture CF1-F01 --fixture CF1-F03 --fixture CF1-F05 \
  --fixture CF1-F07 --fixture CF1-F08 \
  --repeats 3 --seed cf1-prompt-2026-07
```

For a canary fixture, permit a fixture-specific repeat override so F03 can run five times without
requiring five repetitions for every article.

```text
--fixture-repeats CF1-F03=5
```

## Output artifacts

Write one immutable directory per benchmark:

```text
artifacts/claim-foundry/prompt-benchmarks/<benchmark-id>/
  manifest.json
  raw/<fixture>/<profile>/<repeat>/
    request-fingerprints.json
    semantic-inventory.raw.json
    semantic-inventory.verified.json
    critic-report.json                 # full mode
    selected-enrichment.json           # full mode
    claim-package.json                 # full mode
    verification.json                  # full mode
    usage.json
  blind/
    review-packets.json
    review-packets.md
    review-score-template.json
  private/
    producer-key.json
  reports/
    run-metrics.csv
    concept-emissions.csv
    category-recall.csv
    profile-summary.md
    claims-by-fixture.md
    packages-by-fixture.md
```

`claims-by-fixture.md` renders, for each blinded output:

| # | Candidate claim | Role / use | Materiality | Pillar | Assertion source | Scope |
|---|---|---|---|---|---|---|

`packages-by-fixture.md` renders selected claim and evidence-task values together:

| Selected claim | Disputed proposition | Support | Refute | Qualify | Must match | Reject if only | Strategy |
|---|---|---|---|---|---|---|---|

Long values should be rendered as bullets beneath the row rather than truncated. Raw JSON remains
available, but reviewers should not need to diff it.

## Sealed evaluation keys and human scoring

The model-running process must never read `expectations.json`, desired claim phrases, required
concepts, prohibited interpretations, reviewer notes, or benchmark targets. Those values are
evaluation keys, not fixture inputs. Keeping an answer key beside `article.json` is an avoidable
contamination risk, so new benchmark keys live outside the article-fixture tree:

```text
backend/test/claim-foundry/prompt-benchmark-keys/CF1-F03.json
```

Generation and evaluation are separate commands and separate modules:

```text
cf1_run_prompt_benchmark.mjs       reads article.json + static prompt profiles only
cf1_evaluate_prompt_benchmark.mjs  reads frozen run artifacts + sealed evaluation keys
```

The generator API accepts an article value, never a fixture directory or combined fixture object.
It must not import an evaluation-key loader. After generation finishes, write and hash the immutable
run manifest before the evaluation command is allowed to load an answer key.

The existing `expectations.json` files remain legacy fixture-integrity/reviewer manifests. The current
repository reads them only in `acceptanceFixtures.test.js` to check article hashes, approval state,
required excerpts actually occur in the frozen article, and execution-path choice. Neither the CF1
runtime nor the existing comparison runner reads them. The new benchmark must preserve that boundary
rather than turn those files into generation inputs.

```json
{
  "schemaVersion": "cf1.promptBenchmarkTargets.v1",
  "targets": [
    {
      "targetId": "F03-MISCONDUCT-01",
      "category": "material_misconduct",
      "description": "The named insider alleges concrete manipulation or omission of data.",
      "sourceRegionLabels": ["..."],
      "required": true
    }
  ]
}
```

Do not use a model's `recallShape` label as proof that a target was recalled. Reviewers mark each
target `present`, `partial`, or `absent` against the actual candidate claims. The renderer converts
those judgments into the concept-by-run grid required by the MCT.

Add a negative integration test that runs generation with a filesystem loader which throws on any
attempt to open `expectations.json`, `prompt-benchmark-keys`, or another evaluation-key path. Add a
static import-boundary test ensuring production and generation modules cannot import the evaluation
package. Prompt contamination tests continue to scan static production prompt text for fixture/topic
terms, while the article body remains the only document-specific text permitted in a model request.

Human review dimensions for Call 1:

- required-concept and mandatory-category recall;
- atomicity by independent falsifiability;
- preservation of names, numbers, dates, comparison, uncertainty, and scope;
- attribution and article-stance fidelity;
- pillar/evidence-chain coverage, including necessary bridges;
- duplicate, incidental, or filler claim count.

Human review dimensions for full packages:

- usefulness of the selected portfolio;
- correctness of the disputed proposition and verification target;
- support/refute polarity;
- concreteness of qualification outcomes;
- specificity of `mustMatch` and `rejectIfOnly`;
- source-strategy fit and absence of article-self-confirmation;
- package validity.

Machine metrics are diagnostic, not substitutes for review:

- candidate and selected counts;
- verified-package and stage-failure rates;
- input/output/total tokens, duration, and repair rate;
- exact duplicate rate;
- compound-connector flags (`and`, `which`, `while`, `coinciding`) for review queues;
- per-target human-coded emission rate and across-run variance.

## Blind A/B/C packets

Replace pairwise ordering only in the new benchmark module. For each fixture and repeat, derive a
stable seeded permutation of the three profile IDs and expose them as A, B, and C. The public packet
contains no profile ID, prompt version, token count, timing, or raw prompt. The private key contains
the mapping. Reviewers score claims before seeing performance/cost data.

## Execution sequence

1. Freeze the current working Call 1 and Call 2 texts as `current_control_v1`; record hashes.
2. Add the prompt-profile registry and internal dependency injection.
3. Add `recall_reasoning_v1` using the proposed single Call 1 and revised single Call 2 prompts.
4. Add the agreed third profile.
5. Add registry, schema-identity, public-option rejection, and contamination tests.
6. Build Call 1 benchmark mode, raw artifacts, A/B/C blinding, and Markdown/CSV rendering.
7. Add sealed evaluation keys outside the article-fixture tree, starting with the F03 canary and
   known concepts in F01/F05/F07; keep their loader out of the generation dependency graph.
8. Run a smoke test with one repeat and no production persistence.
9. Run the Call 1 screen: F03 five times; four diverse fixtures three times per profile.
10. Complete blind recall/atomicity/stance review before opening the producer key.
11. Run full mode once per fixture/profile to inspect claim-package values and deterministic validity.
12. Advance viable profiles to a three-repeat full-package comparison.
13. Only after a prompt winner is identified, consider a shared schema-v2 experiment.

## Optional later schema experiment

If human review shows that argument bridges are consistently useful but not observable enough, test a
shared Call 1 schema v2 adding `reasoningFunction` to every candidate. If ER1 planning still chooses
sources without claim-specific access, test a Call 2 schema v4 adding `proofMode`. Apply the same new
schema to every arm in that experiment.

Do not add `recallAudit` as an acceptance measure. It is a model attestation, costs output tokens, and
can claim completeness even when the canary is absent. Ground-truth recall remains fixture- and
reviewer-owned.

## Acceptance gates

The recall-and-reasoning profile advances only if:

- every mandatory target improves or holds relative to control, with the F03 canary approaching 5/5;
- no fixture regresses materially on required concepts or prohibited interpretations;
- compound claims decrease without loss of scope or numerical detail;
- pillar and reasoning-chain coverage improves or holds;
- stance/attribution errors do not increase;
- full packages remain deterministically valid;
- median tokens and duration remain within an agreed bound of control;
- the result is visible across repeats, not dependent on one attractive run.
