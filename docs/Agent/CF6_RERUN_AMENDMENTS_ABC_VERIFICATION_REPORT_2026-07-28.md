# CF6 Rerun Amendments A/B/C — Implementation and Verification Report

Date: 2026-07-28  
Authority: `CF6_WHOLE_ARTICLE_AGENT_CONFIGURATION_SPEC_V2.1.md` governs; `CF6_CORRECTED_AGENT_BUILD_PLAN_2026-07-28_R2.md` implements; `CF6_RERUN_AMENDMENTS_ABC_CORRECTED_CODEX_TICKET_2026-07-28.md` is the only authorized failed-run delta.  
Execution boundary: implementation, corrected-protocol Part 1 verification, and Part 2 contamination audit only. No live F03 rerun was started. The sealed evaluator key was not opened.

## Result

Amendments A, B, and C are **CONFIRMED AS AUTHORIZED** by the corrected ticket.

The older verifier protocol contains superseded draft requirements for bulk thesis disposition, a host re-prompt, and forced abstention. Those requirements conflict with the corrected ticket and were not implemented. The corrected behavior has no bulk thesis action, no host re-prompt or second runner invocation, and records host turn exhaustion as `budget_exhausted`, never as model-authored abstention.

The failed-run `offline-gate.json` and failed-run instruction artifacts remain unchanged as the comparison baseline. No fresh live-run gate was written and no live provider call was made.

## Hash and byte comparison

### Agent instruction

The failed artifact contains one trailing newline. Both the executable instruction-body hash and file-style hash are reported to avoid newline ambiguity.

| Measurement | Failed run | Amended |
|---|---:|---:|
| Executable instruction bytes | 2,103 | 2,593 |
| Executable instruction SHA-256 | `aba3862ffe45fb40418930faee0d1355a37412f26f470e32565da977150f9099` | `2f0edb861c65c0341f3438371540d93eced8adcacbe3528af6dff34f25cbbd82` |
| File-style bytes, including final newline | 2,104 | 2,594 |
| File-style SHA-256 | `3e9621859f8fe596dddfe2d9509b0ca4a28eb67e64ee5bbd8d4ea393e06a8ee7` | `46a748de539496f48e344b2fd2f38af9158864501e98d9031ed8859fa0687d4b` |

The exact append, including the separating blank line, is 490 bytes. A byte-equality test proves the amended executable instruction equals the failed executable instruction plus only the exact Amendment C block.

### Four-tool schema

| Measurement | Failed run | Amended |
|---|---:|---:|
| Serialized bytes | 7,209 | 7,582 |
| SHA-256 | `0b5ea5729079d1f41940867d816825fede297ac7c4e8b1fe2eec708196c65cde` | `22625bb754ec7d9401eeb46f66fad2317b9dbcaf60b469c0a1625a3d4b6c6920` |

The tool names and order remain:

1. `update_working_package`
2. `inspect_working_package`
3. `finalize_working_package`
4. `abstain_or_request_review`

The existing `update_working_package` fields retain their order. `dispositionRemainingRegions` is the sole appended model-facing field. No `dispositionRemainingTheses` field exists.

## Corrected-protocol Part 1 — amendment verification

### Amendment A — confirmed

- The model may explicitly submit one `dispositionRemainingRegions` action with a reason, optional note, and exceptions.
- Eligibility is calculated atomically against the post-mutation claim and explicit-disposition state.
- Explicit per-region dispositions take precedence.
- Unknown and duplicate exceptions reject the complete mutation without changing package state.
- Each expanded row is persisted with `dispositionMode: "bulk"` and the SDK’s originating function-call ID. Direct non-SDK callers fall back to the event’s idempotency identity.
- One successful mutation produces one event, one revision increment, one hash recomputation, and a stale inspection.
- The receipt contains counts and changed IDs rather than article or package text.
- Inspection and failed finalization do not create dispositions.
- Region and thesis finalization gates remain active and are tested independently.
- Theses remain individually accountable.

### Amendment B — confirmed

- `modelSettings.toolChoice = "required"`.
- `modelSettings.parallelToolCalls = false`.
- `resetToolChoice = false` is passed to the SDK `Agent` constructor.
- `toolExecution.maxFunctionToolConcurrency = 1`.
- Maximum model turns remains six.
- The existing `toolUseBehavior` ends the same run only after a successful compact receipt from `finalize_working_package` or `abstain_or_request_review`.
- A failed terminal call is persisted as a typed failed event and the same SDK run continues.
- Ordinary structured output is neutralized by required tool choice. The retained backstop records `TOOL_REQUIRED_PROTOCOL_VIOLATION` and retains `NON_TERMINAL_AGENT_EXIT`, rejects the result, and makes no additional model request.
- SDK max-turn exhaustion persists one idempotent `record_turn_budget_exhaustion` event with status `budget_exhausted` and reason `TURN_BUDGET_EXHAUSTED`. It preserves the reloadable working package, produces no additional model call, and cannot be mutated through a later state tool.
- Static and runtime tests prove one host-created `runAgent`/`Runner.run` boundary and no direct Responses API call or host re-prompt loop.
- A four-call concurrency probe proves update, inspect, finalize, and terminal action execution cannot overlap.

The only source change outside `backend/agents/claimFoundry/` is minimal shared SDK wiring in `backend/agents/shared/agentRuntime.ts`: an optional `resetToolChoice` definition field passed to the SDK `Agent` constructor, plus propagation of the SDK function-call ID to the domain tool for Amendment A’s audit row. This avoids duplicating the runner or creating a second model boundary.

### Amendment C — confirmed

The instruction delta is exactly the fixture-neutral block supplied by the corrected ticket. Prior instruction bytes are unchanged and no selection guidance, fixture facts, thesis names, source-unit ranges, or tool sequence was added.

## Authorized-delta audit

Runtime file hashes changed from the failed-run gate only at these paths:

| Path | Failed SHA-256 | Amended SHA-256 | Amendment |
|---|---|---|---|
| `backend/agents/claimFoundry/claimFoundryInstructions.ts` | `5b9be938fd4b6cf17843f038be365d881c1cee44069e8d87cc6ddbf17f7bb318` | `46f86eb025fd4c9663a26a33543e0067f9dc247a17aaec0a35e5d26b35279dc4` | C |
| `backend/agents/claimFoundry/claimFoundryState.ts` | `c8253800edc68bcda2f7a08a9fd6575c20413ce4d1e591c037dac523f6b6c845` | `eab6c9ec110cd57caec5d32055f1e17b370513ecd6d34f112251fc47c9cbef4a` | B operational status |
| `backend/agents/claimFoundry/claimFoundryWholeArticleAgent.ts` | `09298b4bca95e7e0b81bbe883fb8f69134d07854b5f31d9ba547059f85808f4b` | `d6e3fe039cc3ba683f7565cf38d76e297f5109dc82d3b08721bdfa9f8191d2b5` | B |
| `backend/agents/claimFoundry/claimFoundryWholeArticleRunner.ts` | `cdb038b5a4ab9e8d8afa70e94e57ffa61a8eb20b80353739ed284d940b8b82fc` | `26c7be46753615287bd179593c0238331ac6d3a07117a2e150258ba05079b10c` | B |
| `backend/agents/claimFoundry/claimFoundryWholeArticleTools.ts` | `d55b7f4a1fffc50b3e2bc60292b76d8f96637ac24ba84280b1efcc5dea39c2e1` | `259cc95b2db529dbbb0bcd0fa88cde147705ae58f45b99a1dd5ceaff4613189b` | A |
| `backend/agents/claimFoundry/claimFoundryWorkingPackage.ts` | `08251d0a497ce7ced7536a3056f9d891b09071af3c4cce9612999bfc2e5f638b` | `2f2746d8b1908ca021cb59da3137d5427b2040407480e9a41824662d0cae9785` | A audit metadata |
| `backend/agents/shared/agentRuntime.ts` | `ef772a462640a9d4d095fca5cf9617b9101391eb21844c78df1065b9d19a497a` | `54048873c5b392a343d1d259892c54d1cff04d5cf8b00a2daf86c198ef028926` | A/B SDK metadata and setting pass-through |

These failed-run runtime surfaces retain their exact hashes:

- `claimFoundryArticleContext.ts`
- `claimFoundryCoverage.ts`
- `claimFoundryInputFilter.ts`
- `claimFoundryInspection.ts`
- `claimFoundryPersistence.ts`
- `claimFoundryRequestAssertions.ts`
- `runWholeArticleFixture.ts`

Verification test changes:

| Path | SHA-256 |
|---|---|
| `backend/agents/tests/claimFoundry/wholeArticleTools.test.ts` | `d98fdc260b48a6809cf0d805506f96d22f13fc38c8dcefcc6e6e2df72604a313` |
| `backend/agents/tests/claimFoundryAgent/amendmentAudit.test.ts` | `f34742496c5eda8074a8b2f02d99259f978a44db372257eb5a95a22a050bd236` |
| `backend/agents/tests/claimFoundryAgent/oneAgentRun.test.ts` | `cba61deaee65e3eb7aa54cd29ebc78d14cd76f2ac4581afb89504dc4dbe9bf58` |
| `backend/agents/tests/claimFoundryAgent/serializedToolExecution.test.ts` | `f8736304974fbe8799a0dac352be6fc71f68aa5fef9f7718ce20de590621288e` |
| `backend/agents/tests/claimFoundryAgent/wholeArticleAgent.test.ts` | `6a0bcd72d9ab53575fcba64f5a3e43b95dad8fb44310d91e09f4ac3fb90f69c4` |

No model, fixture, article serialization, structural-region derivation, inspection calculation, input-filter, request-accounting, cache, continuation, persistence-adapter, migration, evaluator, or live-run code changed.

## Corrected-protocol Part 2 — contamination audit

Result: **PASS**.

The audit covered:

- agent instructions;
- all four tool schemas and descriptions;
- working-package mirror and inspection logic;
- host diagnostics and runner;
- input filter and article-context serialization;
- model-visible fixture runner metadata;
- amendment tests; and
- the absence of a re-prompt template.

The forbidden fixture/evaluator marker sweep returned zero matches across the amended runtime and tests. No host re-prompt surface exists. The unchanged hash checks additionally prove that article serialization, structural coverage, input filtering, inspection, request assertions, persistence, and fixture-runner code are byte-identical to the failed-run baseline.

## Verification commands

| Command | Result |
|---|---|
| `npm run test:agents:claim-foundry-tools` | PASS — 18/18 |
| `npm run test:agents:claim-foundry-agent` | PASS — 36/36 |
| `npm run typecheck:agents` | PASS |
| `npm run test:agents:claim-foundry-mysql` | PASS — 9/9 |
| Direct amendment byte/hash/drift audit | PASS — 4/4 |

## Boundary

Implementation, Part 1 verification, and Part 2 contamination audit are complete. Part 3 sealed-key evaluation was not performed because there is no authorized new live run to evaluate. The next action requires explicit authorization to issue a fresh amended offline gate and start the one permitted live rerun.
