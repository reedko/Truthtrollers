# TICKET — CF6 Rerun Amendments A/B/C (Corrected Implementation Instruction)

**Date:** 2026-07-28  
**Scope:** `backend/agents/claimFoundry/` only, limited to the whole-article agent’s tools, runner, and instructions  
**Authority:** `CF6_WHOLE_ARTICLE_AGENT_CONFIGURATION_SPEC_V2.1.md` governs. `CF6_CORRECTED_AGENT_BUILD_PLAN_2026-07-28_R2.md` implements it.  
**Status:** This ticket is the complete and only authorized delta from the failed whole-article F03 run that ended `NON_TERMINAL_AGENT_EXIT`.

Do not treat this ticket as an additional design layer. It replaces the earlier draft A/B/C amendment ticket in full.

Codex must diff all changed files and generated hashes against the failed run’s preserved artifacts. Any drift outside Amendments A, B, and C below blocks the rerun.

---

## 0. Context and diagnosis

The failed run succeeded at the central architectural test:

- the one ClaimFoundry agent received the complete 404-unit article in its initial context;
- it produced an article-wide semantic package with six theses, including the manipulation/suppression axis;
- its claims were grounded across early, middle, and late source units;
- server-managed continuation and prompt caching worked;
- the stable-prefix cache gate passed;
- the measured article cost multiplier was 1.324.

The run failed only at terminal control.

After `inspect_working_package` reported 23 unaccounted structural regions and one unaccounted thesis, the model emitted ordinary output rather than:

- updating or dispositioning the remaining state;
- calling `finalize_working_package`; or
- calling `abstain_or_request_review`.

The persisted run therefore remained non-terminal, and the deterministic post-run assertion correctly recorded `NON_TERMINAL_AGENT_EXIT`.

This ticket makes exactly three controlled changes:

- **Amendment A:** make region disposition practical through one explicit model-authored bulk action, without weakening finalization;
- **Amendment B:** require a tool action on every non-terminal model turn and remove ordinary prose as a completion path;
- **Amendment C:** append the terminal and bulk-region contract to the agent instructions.

No semantic authority moves to the host.

---

# Amendment A — model-authored bulk disposition of remaining regions

## A.1 Authorized schema change

In `update_working_package` in `claimFoundryWholeArticleTools.ts`, append exactly one new optional input field:

```text
dispositionRemainingRegions?: {
  reasonCode: string
  optionalNote?: string
  exceptions?: string[]
}
```

Do **not** add `dispositionRemainingTheses`.

Existing fields remain unchanged:

```text
setRegionDispositions[]
setThesisDispositions[]
```

The new field must be appended without renaming or reordering existing schema fields.

## A.2 Semantics

When `dispositionRemainingRegions` is present, the host must:

1. calculate the set of structural regions that, at the moment the mutation is applied, have:
   - no selected-claim grounding; and
   - no existing region disposition;
2. remove every region ID listed in `exceptions`;
3. apply the model-authored `reasonCode` and optional `optionalNote` to every remaining region in that set;
4. persist each expanded region disposition individually through the same persistence/event path used by `setRegionDispositions[]`;
5. mark each expanded disposition with:
   - `dispositionMode: "bulk"`; and
   - the originating tool-call/event ID;
6. increment the package revision exactly once for the successful atomic mutation;
7. recompute the package hash;
8. make the prior inspection stale; and
9. return a compact receipt containing counts and changed IDs, not a full package echo.

The host must not infer or alter the model’s reason.

## A.3 Precedence and validation

If `setRegionDispositions[]` and `dispositionRemainingRegions` occur in the same mutation:

- explicit per-region entries win for the same region ID;
- the bulk action applies only to the remaining eligible regions.

Unknown or foreign exception IDs must fail the entire mutation atomically.

The host must not silently ignore an invalid exception.

## A.4 No automatic disposition

Bulk disposition is a **model action**.

The host must never:

- apply it by default;
- trigger it automatically after inspection;
- trigger it automatically during finalization;
- infer that an unrepresented region is immaterial;
- silently fill missing region dispositions.

If the model does not submit the bulk action or explicit per-region dispositions, the regions remain unaccounted.

## A.5 Theses remain individually accountable

Do not add bulk thesis disposition.

Every model-declared thesis must be handled by one explicit model-authored action:

- link at least one claim to it;
- revise or remove the thesis; or
- disposition it individually through `setThesisDispositions[]`.

This preserves the failed run’s important `T2` inconsistency as something the agent must consciously resolve.

## A.6 Finalization gates remain unchanged

Do not weaken or remove the existing finalization gates.

`finalize_working_package` must continue to require:

- every structural region is claim-grounded or explicitly dispositioned;
- every declared thesis is claim-linked or individually dispositioned;
- every claim links to a declared thesis;
- a current non-stale inspection;
- no deterministic validation defect;
- valid and authorized grounding;
- matching package revision/hash;
- all existing persistence, budget, identity, and immutability requirements.

Amendment A changes only the transport cost of a model-authored region judgment. It does not change the completion standard.

---

# Amendment B — require tool use and eliminate ordinary prose as a completion path

## B.1 Remove ordinary structured output as a terminal surface

In `claimFoundryWholeArticleRunner.ts`, remove or neutralize the ordinary structured `outputType` surface that allowed the model to produce a final structured response without invoking a terminal tool.

Do not rely on removing `outputType` alone.

The run may reach successful semantic termination only through:

- `finalize_working_package`; or
- `abstain_or_request_review`.

Both remain terminal function tools through the existing `toolUseBehavior`.

## B.2 Require a tool action on every non-terminal model turn

Configure the agent/model settings so every non-terminal model response must select a tool:

```text
modelSettings.toolChoice = "required"
modelSettings.parallelToolCalls = false
resetToolChoice = false
```

`resetToolChoice = false` is required so the SDK does not return tool choice to `auto` after a tool call.

Keep serialized host execution:

```text
toolExecution.maxFunctionToolConcurrency = 1
```

The model remains free to choose which of the four tools to attempt:

- `update_working_package`
- `inspect_working_package`
- `finalize_working_package`
- `abstain_or_request_review`

The host does not choose the next action and does not inject a semantic sequence.

## B.3 Terminal-tool behavior

Keep or configure:

```text
toolUseBehavior.stopAtToolNames = [
  "finalize_working_package",
  "abstain_or_request_review"
]
```

A successful compact receipt from either terminal tool must end the same `Runner.run` without another model request.

A failed terminal tool call returns its compact typed error and does not terminate the run.

## B.4 Do not implement a host re-prompt loop

Do not add the previously proposed state-only host re-prompt.

Do not:

- start another `Runner.run`;
- create an outer direct Responses API loop;
- issue a second host-created model invocation;
- add a custom model call after ordinary output;
- convert ordinary output into a new user message.

The experiment must retain exactly one host invocation of `Runner.run`.

## B.5 Protocol backstop

Retain the existing deterministic post-run assertion.

After `Runner.run` returns, reload persisted state. Accept the run as terminal only when status is one of:

```text
completed
abstained
awaiting_review
budget_exhausted
```

If ordinary non-tool output somehow escapes the required-tool configuration and persisted state remains non-terminal:

- record `TOOL_REQUIRED_PROTOCOL_VIOLATION`;
- record or retain `NON_TERMINAL_AGENT_EXIT`;
- reject the run;
- do not interpret the ordinary text as a package, review request, abstention, or completion;
- do not invoke the model again.

`NON_TERMINAL_AGENT_EXIT` should be unreachable during the corrected path. If it fires, treat that as a runner/protocol defect.

## B.6 Turn-budget exhaustion

Maximum internal model turns remains six.

If the SDK reaches the turn limit, catch the SDK’s max-turn failure and persist an operational terminal result:

```text
status: budget_exhausted
reasonCode: TURN_BUDGET_EXHAUSTED
```

Do not record host-enforced turn exhaustion as `abstained`.

`abstained` is reserved for a model-authored call to `abstain_or_request_review` with mode `abstain`.

Budget exhaustion must:

- produce no extra model call;
- preserve the current working package and inspection state;
- persist a typed terminal event;
- remain distinguishable from semantic abstention and review request.

## B.7 No other runner changes

Do not change:

- the one-run provider boundary;
- server-managed continuation strategy;
- article initial-context behavior;
- stable-prefix ordering;
- cache key/breakpoint behavior;
- request accounting;
- token or cost formulas;
- serialized tool execution;
- six-turn limit;
- tool names or tool order;
- model choice;
- fixture identity;
- claim schema;
- semantic instructions except Amendment C.

---

# Amendment C — exact fixture-neutral instruction append

Append the following block to the existing agent instructions and make no other instruction change:

```text
Finishing requires a terminal action: finalize_working_package or
abstain_or_request_review. Every nonterminal turn must select one of the
available tools. Ordinary replies are not a completion path.

Unrepresented structural regions may be dispositioned in bulk only when, after
considering the complete article, they contain no material independently
investigable assertion.

Every declared thesis must be linked to a claim, revised or removed, or
explicitly dispositioned individually.
```

The instruction diff against the failed run’s preserved instruction version must be exactly this appended block:

- no other wording changes;
- no reordering;
- no reformatting of prior text;
- no fixture language;
- no expected thesis names;
- no named cruxes;
- no unit ranges;
- no hidden tool sequence.

Codex must verify the byte-level diff and report the old and new SHA-256 hashes.

---

# Cross-amendment constraints

The following remain mandatory.

## Stable schemas and cache prefix

Within the rerun:

- instructions are byte-identical on every turn;
- all four tool schemas are byte-identical on every turn;
- tool order remains fixed;
- the new `dispositionRemainingRegions` field is appended once and remains stable;
- stable-prefix ordering remains:

```text
instructions -> four fixed tool schemas -> complete article -> trailing turn delta
```

The amended prefix differs from the failed run and therefore requires a fresh cache write on request one. That is authorized.

## No new semantic component

Do not add:

- any model call outside the one ClaimFoundry run;
- another agent;
- a helper model;
- a critic;
- a validator model;
- a semantic coverage checker;
- a semantic filter;
- a model-generated summary or compaction step;
- deterministic relevance or materiality logic.

## No new tools

The model-facing tool surface remains exactly:

1. `update_working_package`
2. `inspect_working_package`
3. `finalize_working_package`
4. `abstain_or_request_review`

## No fixture contamination

The amendments, tests, instructions, schemas, tool outputs, runtime diagnostics, and model-visible fixture metadata must not contain:

- fixture names;
- expected thesis language;
- expected crux language;
- expected claim IDs;
- expected source-unit ranges;
- evaluator success criteria.

## Preserve existing mechanics

Do not alter:

- whole-article serialization;
- source-unit IDs or hashes;
- structural region derivation;
- inspection calculations;
- claim/thesis contracts;
- persistence schema except where the bulk disposition audit metadata genuinely requires an authorized additive field;
- final package format;
- authorization and foreign-grounding rejection;
- optimistic revision/hash concurrency;
- immutable finalization;
- request accounting;
- continuation configuration;
- prompt-cache configuration;
- contamination boundary;
- evaluator isolation.

---

# Required tests

## T-A1 — bulk disposition set behavior

Prove that `dispositionRemainingRegions`:

- calculates the exact unaccounted region set at tool-call time;
- excludes every valid ID listed in `exceptions`;
- fails atomically on an unknown or foreign exception ID;
- allows explicit `setRegionDispositions[]` entries in the same mutation;
- gives explicit entries precedence over the bulk value;
- expands and persists individual region dispositions;
- marks expanded entries `dispositionMode: "bulk"` with the originating event/tool-call ID;
- increments package revision once;
- returns counts and IDs only.

## T-A2 — finalization gate regression

Retain the existing gate behavior:

- finalization fails when any region remains neither grounded nor dispositioned;
- finalization fails when any declared thesis remains neither claim-linked nor individually dispositioned.

This test must prove Amendment A did not weaken finalization.

## T-A3 — no host auto-disposition

Prove that:

- inspection does not create dispositions;
- failed finalization does not create dispositions;
- the host does not invoke the bulk action;
- a package with unaccounted regions remains blocked until the model submits an explicit disposition mutation.

## T-A4 — no bulk thesis disposition

Prove that:

- no `dispositionRemainingTheses` schema field exists;
- unsupported theses cannot be cleared through a bulk action;
- each unsupported thesis requires a linked claim, thesis revision/removal, or explicit per-thesis disposition.

## T-B1 — required tool choice persists

Prove that:

- `toolChoice` is `required`;
- `resetToolChoice` is `false`;
- every non-terminal model turn requires a tool action;
- the SDK does not silently reset tool choice to `auto` after a tool call.

## T-B2 — terminal tool completion

Prove that successful calls to:

- `finalize_working_package`; and
- `abstain_or_request_review`

end the run through `toolUseBehavior` without an additional model request.

Failed terminal calls must return typed errors and allow the same run to continue.

## T-B3 — no host re-prompt or second run

Prove that:

- there is exactly one host-created `Runner.run` invocation;
- ordinary output does not trigger another runner invocation;
- no direct Responses API call is introduced;
- no host-generated semantic or state-only re-prompt loop exists.

## T-B4 — protocol backstop

Inject or simulate a non-tool ordinary response despite required-tool configuration.

Prove that:

- persisted non-terminal state is not accepted as completion;
- `TOOL_REQUIRED_PROTOCOL_VIOLATION` and/or `NON_TERMINAL_AGENT_EXIT` is recorded;
- ordinary text is not persisted as the final package;
- no additional model call occurs.

## T-B5 — budget exhaustion is operational

Force max-turn exhaustion.

Prove that the host persists:

```text
status: budget_exhausted
reasonCode: TURN_BUDGET_EXHAUSTED
```

and does not persist model-authored `abstained`.

Also prove:

- no extra model call occurs;
- working state remains inspectable;
- terminal status is immutable/idempotent under replay.

## T-B6 — serialized state actions remain in force

Prove:

```text
modelSettings.parallelToolCalls = false
toolExecution.maxFunctionToolConcurrency = 1
```

and that no pair of package mutation, inspection, finalization, or terminal actions overlaps.

## T-C1 — exact instruction append

Prove that the instruction diff from the failed run is exactly the Amendment C block.

Report:

- prior instruction SHA-256;
- amended instruction SHA-256;
- byte count of the appended block;
- zero other instruction changes.

## T-X1 — authorized-delta audit

Produce a path-level and hash-level diff against the failed run.

The diff must contain only:

- the appended `dispositionRemainingRegions` schema/implementation and necessary audit metadata;
- required-tool and terminal/budget runner configuration;
- Amendment C’s instruction append;
- tests and test fixtures needed to verify these deltas.

Any unrelated source, schema, prompt, model, fixture, coverage, persistence, or evaluator change blocks the rerun.

---

# Handoff and execution boundary

On implementation completion, Codex must report:

1. old and new instruction SHA-256 hashes;
2. old and new tool-schema SHA-256 hashes;
3. the exact changed-file list;
4. a concise diff summary mapped to Amendments A, B, and C;
5. all required test results;
6. proof of one runner invocation and no out-of-band model call;
7. proof that no runtime contamination was introduced;
8. proof that finalization gates remain unchanged;
9. proof that budget exhaustion is not recorded as model abstention.

Then execute:

- `CODEX-CF6-F03-RERUN-PROTOCOL Part 1` — verification;
- `CODEX-CF6-F03-RERUN-PROTOCOL Part 2` — contamination audit.

Do **not** start the live F03 rerun as part of this ticket.

The sequence remains:

```text
implement -> verify -> contamination audit -> authorize live rerun -> run once -> evaluate
```
