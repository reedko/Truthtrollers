# CF1 One-Call Agent Runtime — Implementation Results

## Outcome

CF1 now has a separate real agent execution path. Normal F01 execution sends the
prepared article once, receives an exposed semantic work loop, materializes explicit
state, deterministically builds the package, verifies it, and writes proof artifacts.
The legacy one-shot pipeline remains labeled `baseline` and is not the normal agent.

No live scrape activation, EvidenceRun search, UI work, commit, staging, branch, or
stash operation was performed.

## Agent work in the single response

```text
orientation
initialCandidates
critic
revisionTrace (drop/add only)
selectedClaims
```

The selected claim fields are limited to claim wording, source-unit grounding,
assertion source, article use/role, materiality, claim mode, scope, named-work hints,
and support/refute/qualification tests.

## Deterministic host work

The host owns IDs, exact excerpts, offsets, hashes, target/card construction, evidence
roles, match and non-bearing rules, query rendering, routing boundaries, score
transforms, identifier normalization, verification, persistence fields, and artifacts.
Normal agent execution disables the model runner's hidden full-request retry.

## F01 proof

Paid model response:

```text
artifacts/claim-foundry/agent-runs/f01-one-call-v1q/
  cf1run_019f607f-5b0f-765f-bc53-5e66af274364/
```

Current-code final package and proof artifacts from that exact response:

```text
artifacts/claim-foundry/agent-runs/f01-one-call-v1q-final/
  cf1run_019f6082-5858-74e8-92d6-b436f3b77214/
```

The proof directory contains `initial_claims.json`, `critic_report.json`,
`revision_plan.json`, `revised_claims.json`, `targets.json`, `verifier_report.json`,
`cf1_agent_trace.json`, and `final_cf1_package.json`. The verifier report is valid with
zero blocking errors. The trace records one model call and four deterministic
materialization steps. The critic caused redundant and non-central candidates to be
dropped and the IOM claim to be replaced by drop-plus-add.

## Baseline comparison

| Metric | TM4 F01 | CF1 F01 |
|---|---:|---:|
| Provider calls | 9 | 1 |
| Input tokens | 20,576 | 14,280 |
| Output tokens | 7,169 | 2,415 |
| Total tokens | 27,745 | 16,695 |
| Runtime | 50.350 s | 37.579 s |
| Final claims | 19 low-quality duplicates | 8 selected |
| Targets | 0 usable | 8 verified |

CF1 reduced total tokens by 11,050 (39.8%), output tokens by 4,754 (66.3%),
and runtime by 12.771 seconds (25.4%) on F01.

## Commands

Real one-call agent run:

```sh
node scripts/dev/cf1_run_claim_foundry.mjs \
  --article backend/test/claim-foundry/fixtures/CF1-F01/article.json \
  --openai --model gpt-4o-mini \
  --artifacts artifacts/claim-foundry/agent-runs/f01-one-call \
  --context-tokens 128000 --max-total-tokens 27744 \
  --max-output-tokens 6000 --max-duration-ms 90000 \
  --timeout-ms 90000 --no-repair
```

All CF1 tests:

```sh
cd backend
node --test test/claim-foundry/*.test.js
```

Current result: 182 tests passed, 0 failed.

## Remaining work

- Human-review the eight F01 claims and Evidence Need Cards against TM4.
- Confirm token and runtime gains across F02–F08.
- Run and review F02–F08; measure invalid-package rate.
- Keep live scrape activation and EvidenceRun integration blocked until 9A passes.
