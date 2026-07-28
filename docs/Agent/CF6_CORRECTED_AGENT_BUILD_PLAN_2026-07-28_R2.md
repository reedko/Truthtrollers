# CF6 Corrected Agent Build Plan R2

**Date:** 2026-07-28  
**Status:** Build plan  
**Governing specification:** `CF6_WHOLE_ARTICLE_AGENT_CONFIGURATION_SPEC_V2.1.md`  
**Authority rule:** V2.1 governs. If this plan is later found to conflict with V2.1,
V2.1 wins.  
**Replaces:** R1 and all earlier CF6 reset/build plans for this experiment

## 0. Purpose

Build and run one whole-article ClaimFoundry agent experiment on F03.

The host invokes `Runner.run(claimFoundryAgent, initialInput, options)` exactly once.
The complete normalized article is in that initial input. All semantic work occurs in
the internal turns of that single agent run. No helper, tool, validator, evaluator,
compactor, or second agent may call a model.

The model-facing action surface is byte-stable throughout the run:

1. `update_working_package`
2. `inspect_working_package`
3. `finalize_working_package`
4. `abstain_or_request_review`

All four schemas are exposed on every internal turn. Tool implementations enforce
legality with compact typed errors.

## 1. Non-negotiable experiment boundaries

### 1.1 One model-owning component

Only the ClaimFoundry `Agent` is configured with a model.

Required:

- one host-created runner invocation;
- one injected provider/model boundary;
- no handoffs;
- no subagents;
- no agent-as-tool;
- no model-backed guardrails;
- no model-backed validation, coverage, repair, evaluation, or compaction;
- no preliminary or post-run model call; and
- no direct `responses.create()` call from CF6 production code or a tool.

Tool implementations receive deterministic services and typed persisted state. They
must not receive an API key, OpenAI client, model provider, runner, or agent.

### 1.2 Whole article is given

The initial input contains:

- compact ClaimFoundry instructions;
- run and content identity;
- the complete normalized article;
- all stable source-unit IDs and offsets;
- visible structure, headings, quotation/speaker signals, citations, links, footnotes,
  and references; and
- no precomputed semantic inventory, thesis list, importance ranking, summary, or
  candidate package.

The model never fetches article content through a tool.

### 1.3 Semantic authority remains with the agent

The agent decides:

- theses;
- claim selection and count;
- materiality and independent verdictability;
- attribution and substantive verification targets;
- supplier, treatment, polarity, scope, and thesis effect;
- revisions, splits, merges, removals, and dispositions;
- whether and when to inspect;
- whether to revise after inspection; and
- whether to finalize, abstain, or request review.

The host performs exact validation and set accounting only. It does not decide what
article content matters.

### 1.4 Runtime contamination is prohibited

Fixture-specific expected theses, named cruxes, expected claim IDs, late-unit targets,
and success criteria are evaluator-only.

They may not appear in:

- instructions;
- tool names, descriptions, or schemas;
- working-package defaults;
- region derivation;
- inspection logic;
- diagnostics;
- runtime tests that construct model-visible input; or
- fixture metadata visible to the agent.

## 2. Runtime architecture

```text
host
  |
  | exactly one Runner.run(...)
  v
ClaimFoundry Agent
  |
  | complete article in initial context
  |
  +--> update_working_package --------> deterministic mutation + persistence
  |
  +--> inspect_working_package -------> deterministic integrity/coverage mirror
  |
  +--> finalize_working_package ------> deterministic gates + immutable package
  |
  +--> abstain_or_request_review -----> typed terminal state
  |
  +--> internal model turn(s), maximum six initially
```

There is no host-coded semantic sequence. The diagram shows legal capabilities, not a
required order.

## 3. Context, continuation, and cache contract

### 3.1 Assume SDK accumulation

Assume the SDK and server-managed conversation retain prior model/tool items unless
measurement proves otherwise.

“SDK-managed” does not mean:

- compact;
- free;
- one-time billed;
- transcript-free; or
- automatically cache-optimal.

### 3.2 Choose one server-managed continuation strategy

The first experiment uses exactly one of:

- `conversationId`; or
- `previousResponseId`.

Implementation preference: `conversationId`, because the first request has no prior
response ID and the same identifier can cover all internal turns.

Do not combine the chosen strategy with:

- `result.history`;
- a client-managed `Session`;
- manually reconstructed message history;
- manually replayed tool calls/results; or
- the other server-managed continuation identifier.

Creating the server conversation is state setup, not a model call. It must occur before
the single `Runner.run` invocation and its identifier must be persisted.

### 3.3 Client-boundary invariant

Request one supplies the complete article.

Later client requests may supply only the new internal-turn delta required by the
Agents SDK. The application must not manually insert:

- the article again;
- a prior package snapshot;
- prior inspection reports;
- prior tool receipts;
- prior assistant output; or
- prior input history.

Server-managed continuation may still retain and bill earlier context. R2 does not claim
that client code can delete server-held conversation history.

### 3.4 Input filter role

`callModelInputFilter` is an inspection and fail-fast boundary.

It may:

- record exact client-supplied items;
- count exact duplicates;
- detect prohibited manual replay;
- remove an exact duplicate or exact superseded typed item if it is present in the
  client-side input; and
- preserve the immediate tool-call/result correlation required by the SDK.

It may not:

- summarize;
- select by relevance;
- infer importance;
- alter article text;
- drop a source unit;
- synthesize a semantic workbench;
- conceal an SDK accumulation defect; or
- make a model call.

Do not use the filter to promise removal of history held only on the server.

### 3.5 Stable prompt/cache prefix

The stable logical ordering is:

```text
instructions -> byte-stable tool schemas -> article -> trailing turn delta
```

Requirements:

- all four tool schemas are serialized identically on every turn;
- tool order is fixed;
- instructions are byte-identical;
- no timestamps, counters, request IDs, clocks, or dynamic run data occur in
  instructions/tool descriptions;
- article serialization is byte-identical;
- mutable data is trailing;
- inspection results contain set differences and IDs, not package echoes; and
- turns run back-to-back unless an intentional pause is recorded.

Measure the stable prefix explicitly:

```text
stablePrefixTokens =
  instructionTokens +
  fixedToolSchemaTokens +
  articleTokens
```

When the installed model and Agents SDK support an explicit prompt-cache breakpoint,
place it immediately after the article and before the trailing mutable turn delta.
Record whether the breakpoint was supported, applied, rejected, or unavailable. An
unsupported breakpoint does not authorize a different architecture; the stable-prefix
measurement and cache-coverage assertion still apply.

With server-managed continuation, the later client payload does not contain another
manual article copy. Cache measurements, rather than assumptions about provider prompt
rendering, determine whether the stable prefix is working.

### 3.6 Fail-fast request assertions

Before every internal model request, record:

- runner invocation ID;
- agent identity;
- internal turn number;
- conversation/previous-response identifier;
- instruction bytes and estimated tokens;
- tool-schema bytes, hash, and estimated tokens;
- client-input item types, bytes, hash, and estimated tokens;
- article marker occurrences in the new client payload;
- working-package snapshot occurrences;
- inspection-report occurrences;
- cached and uncached input usage from the preceding request; and
- cumulative cost-equivalent usage.

Abort before the next billable request if:

- a second article copy appears at the client boundary;
- tool schemas drift;
- instructions drift;
- manual history replay appears;
- an old full package or inspection report is replayed;
- request two reports cached input that covers less than 90% of the measured stable
  prefix, after applying the recorded provider reporting/tokenization tolerance;
- an out-of-band model request appears; or
- any configured operational budget would be exceeded.

The cache gate is:

```text
requiredCachedStablePrefixTokens =
  0.90 * stablePrefixTokens

pass when:
  cachedInputTokens + reportingToleranceTokens
    >= requiredCachedStablePrefixTokens
```

Do not divide `cachedInputTokens` by total request input. Mutable trailing workbench
tokens may legitimately be uncached and must not dilute stable-prefix cache coverage.

The request-two stable-prefix assertion is evaluated after request two and can prevent
request three. It cannot retroactively prevent request two.

### 3.7 Token language and controls

Report separately:

- gross input tokens;
- cached input tokens;
- uncached input tokens;
- output tokens;
- tool-schema tokens;
- cost-equivalent input tokens;
- article token estimate;
- article cost multiplier; and
- per-turn and cumulative latency.

Initial controls:

- maximum internal model turns: 6;
- byte-capped stable schema block;
- cumulative uncached input budget;
- separately reported cached input;
- cost-equivalent budget;
- wall-time budget; and
- abort before the next request when a limit is reached.

Target:

```text
article cost multiplier =
  total billed input token-equivalents / article tokens

first-run target <= 1.5
```

Do not use “reading is free” or “the article costs only once.”

## 4. Persisted working-package state

Create a new versioned working-package state for this experiment. It contains:

```text
identity:
  runId
  contentId
  contentHash
  sourceUnitManifestHash
  packageRevision
  packageHash

theses:
  thesisId
  statement
  groundingUnitIds

claims:
  claimId
  surfaceStatement
  substantiveAssertion
  attribution fields
  supplier fields
  articleTreatment
  polarity
  scope
  verificationTarget
  groundingUnitIds
  thesisIds
  thesisEffect
  materiality
  selectionRationale
  identityHints

regionDispositions:
  regionId
  reasonCode
  optionalNote

thesisDispositions:
  thesisId
  reasonCode
  optionalNote

acknowledgedDiagnosticIds:
  diagnosticId[]

latestInspection:
  inspectionId
  inspectedPackageRevision
  inspectedPackageHash
  deterministicDiagnostics
  nonBlockingHeuristics
  regionCoverage
  thesisLinkCoverage
```

Every successful package mutation:

- increments `packageRevision`;
- recomputes `packageHash`;
- makes the prior inspection stale;
- persists an append-only event; and
- returns a compact receipt only.

### Explicit interface completion: thesis dispositions

V2.1 requires a model-declared thesis to have either a linked claim or an explicit
thesis disposition before finalization. Its example `update_working_package` fields name
region dispositions but do not name the storage location for thesis dispositions.

R2 makes this requirement explicit with:

```text
setThesisDispositions[]
```

inside `update_working_package`.

This does not add a tool or a semantic host decision. It supplies the missing typed
mutation needed to satisfy V2.1’s finalization rule. If the governing author rejects
this field, implementation must stop and choose another explicit storage/input location;
it must not silently invent one.

## 5. Native tool contracts

All schemas are strict, minimal, bounded, and byte-identical throughout the run.

### 5.1 `update_working_package`

Purpose: apply a shallow, model-authored mutation.

Input:

```text
idempotencyKey
expectedPackageRevision
setTheses[]
upsertClaims[]
removeClaimIds[]
setRegionDispositions[]
setThesisDispositions[]
acknowledgeDiagnosticIds[]
```

All mutation arrays default to empty and are batch-bounded. The total persisted thesis,
claim, and disposition sets are not constrained by a hidden semantic ceiling.

Host checks:

- legal non-terminal state;
- expected revision;
- authorized run/content identity;
- valid source-unit IDs;
- valid claim-to-thesis IDs;
- unique object IDs;
- referential integrity after removals;
- acknowledgement IDs exist in the latest inspection; and
- at least one actual mutation.

Host does not:

- create or rewrite theses;
- create or rewrite claims;
- determine semantic duplication;
- infer treatment, polarity, supplier, or thesis effect;
- decide whether a disposition is substantively correct; or
- return article text.

Output:

```text
status
packageRevision
packageHash
changedThesisIds
changedClaimIds
removedClaimIds
changedRegionDispositionIds
changedThesisDispositionIds
acknowledgedDiagnosticIds
```

Do not return the full working package.

### 5.2 `inspect_working_package`

Purpose: return one deterministic integrity and coverage mirror.

Input:

```text
idempotencyKey
expectedPackageRevision
```

Deterministic checks:

- package schema and required fields;
- authorized hashes and source-unit IDs;
- unique thesis/claim/disposition IDs;
- valid claim-to-thesis links;
- claims with no thesis link;
- exact duplicate records;
- structural region IDs represented by claim grounding;
- structural region IDs explicitly dispositioned;
- structural region IDs with neither;
- thesis IDs linked by claims;
- thesis IDs explicitly dispositioned;
- thesis IDs with neither;
- invalid/stale acknowledgements; and
- source offset/span integrity.

Optional heuristics:

- disabled for the first F03 runtime unless already proven;
- always labeled `nonBlockingHeuristic`;
- never included in deterministic completion status.

Output:

```text
inspectionId
packageRevision
packageHash
deterministicClean
deterministicDiagnostics[]
nonBlockingHeuristics[]
coveredRegionIds[]
dispositionedRegionIds[]
unaccountedRegionIds[]
linkedThesisIds[]
dispositionedThesisIds[]
unaccountedThesisIds[]
claimIdsWithoutThesis[]
```

Do not return:

- article text;
- the full package;
- a semantic summary;
- model-inferred theses;
- model-inferred claim support; or
- a semantic completion verdict.

Inspection persists the report against the exact package revision/hash but does not
mutate semantic package content.

### 5.3 `finalize_working_package`

Purpose: atomically persist the immutable final package.

Input:

```text
idempotencyKey
expectedPackageRevision
expectedPackageHash
inspectionId
acknowledgedDiagnosticIds[]
```

Deterministic finalization gates:

- non-terminal run;
- working package exists;
- inspection exists;
- inspection revision/hash equals current package revision/hash;
- no deterministic inspection defect;
- every structural region is claim-grounded or explicitly dispositioned;
- every model-declared thesis is claim-linked or explicitly dispositioned;
- every claim links to a model-declared thesis;
- every required non-deterministic warning is explicitly acknowledged;
- no foreign grounding;
- authorized identity/hashes match; and
- operational/persistence budgets permit finalization.

The host may validate that disposition fields are present and refer to valid IDs. It may
not reject a disposition because it disagrees with the model’s semantic reason.

Output:

```text
status: completed
finalPackageId
finalPackageHash
packageRevision
```

Do not return the full final package to the model. The canonical package remains in
durable storage.

### 5.4 `abstain_or_request_review`

Purpose: enter a typed terminal alternative.

Input:

```text
idempotencyKey
mode: abstain | request_review
reasonCode
reason
relatedClaimIds[]
relatedThesisIds[]
relatedUnitIds[]
```

Host checks identity and references only. It persists the typed terminal state and a
compact receipt.

Output:

```text
status: abstained | awaiting_review
reasonCode
```

## 6. Tool legality with byte-stable exposure

All four tools remain exposed every turn in a fixed order with identical descriptions
and schemas.

State tools execute serially:

```text
modelSettings.parallelToolCalls = false
toolExecution.maxFunctionToolConcurrency = 1
```

Both settings are required. Disabling parallel tool generation is not a substitute for
serial host execution, because a model response may still contain multiple function
calls. Serial host execution is not a substitute for disabling parallel tool calls,
because the model should not plan concurrent mutations against one package revision.

If one model response nevertheless contains multiple state-tool calls, execute them in
their emitted order with concurrency one. Each call observes the persisted result and
package revision produced by the preceding call. No update, inspection, finalization,
or terminal mutation may overlap another state action.

Configure `finalize_working_package` and `abstain_or_request_review` as terminal function
tools through `toolUseBehavior`. A successful compact receipt from either tool becomes
the agent run's terminal output without an additional model request. Failed terminal
tool calls remain ordinary typed tool errors and do not terminate the run.

Illegal actions return compact typed errors from the tool implementation:

```text
ILLEGAL_IN_STATE
STALE_PACKAGE_REVISION
STALE_INSPECTION
DETERMINISTIC_DEFECTS_REMAIN
UNACCOUNTED_REGIONS
UNACCOUNTED_THESES
INVALID_REFERENCE
BUDGET_EXCEEDED
TERMINAL_RUN
```

The agent chooses what to do next after seeing an error. The host does not translate an
error into a prescribed semantic action.

After `Runner.run` returns, reload persisted run state deterministically. An ordinary
agent final response is not completion unless persisted status is one of:

```text
completed
abstained
awaiting_review
```

If the SDK run exits without a successful terminal tool and persisted state is not
terminal, record `NON_TERMINAL_AGENT_EXIT`, reject the experiment result, and do not
interpret text from the ordinary final response as a package or completion.

## 7. Structural coverage contract

### 7.1 Region derivation

Derive coarse, lossless structural regions deterministically from existing article
headings/paragraph blocks.

Each region has:

- stable region ID;
- start and end unit IDs;
- ordered unit IDs;
- heading if present;
- structural type; and
- unit count.

Do not derive regions from semantic topics, relevance, claim likelihood, named entities,
or fixture expectations.

### 7.2 Exact mirror operations

For each claim, map its model-authored grounding IDs to structural region IDs.

Compute sets:

```text
covered regions =
  regions containing at least one selected-claim grounding ID

dispositioned regions =
  regions with a model-authored region disposition

unaccounted regions =
  all regions - covered regions - dispositioned regions

linked theses =
  model-authored thesis IDs referenced by at least one model-authored claim

dispositioned theses =
  model-authored thesis IDs with a model-authored thesis disposition

unaccounted theses =
  declared theses - linked theses - dispositioned theses
```

The host does not decide whether the claim really supports the thesis or whether an
uncovered region matters.

## 8. Agent instructions

Instructions are compact and fixture-neutral.

They state:

- the entire authorized article follows in the initial context;
- no content tool exists because no content fetch is needed;
- use only the supplied article;
- do not determine external truth;
- build the smallest complete set of independently investigable evidentiary targets;
- preserve attribution, supplier, treatment, polarity, scope, qualification, and exact
  grounding;
- theses and claims are editable working-package state;
- inspection reflects exact integrity/coverage relations but does not make semantic
  judgments;
- every region and declared thesis must be claim-grounded/linked or explicitly
  dispositioned before finalization;
- the agent controls tool order; and
- terminal output must reference persisted state, not reproduce package content.

Instructions do not contain:

- fixture names;
- expected thesis language;
- expected crux language;
- expected unit ranges;
- a required tool sequence;
- dynamic timestamps/counters;
- article summaries; or
- hidden evaluation criteria.

## 9. Repository change map

### 9.1 Add

- `backend/agents/claimFoundry/claimFoundryArticleContext.ts`
  - lossless whole-article serialization and verification.
- `backend/agents/claimFoundry/claimFoundryWorkingPackage.ts`
  - V2.1 working-package schemas and shallow mutation logic.
- `backend/agents/claimFoundry/claimFoundryInspection.ts`
  - deterministic validation and structural/thesis set mirror.
- `backend/agents/claimFoundry/claimFoundryRequestAssertions.ts`
  - client-input, schema-stability, cache, and budget assertions.
- focused tests for each boundary.

### 9.2 Revise

- `backend/agents/claimFoundry/claimFoundryAgent.ts`
  - bind the four native tools in fixed order;
  - remove conditional exposure;
  - disable parallel tool calls;
  - configure successful finalization and abstention/review receipts as terminal
    function-tool outputs through `toolUseBehavior`.
- `backend/agents/claimFoundry/claimFoundryInstructions.ts`
  - whole-article, fixture-neutral instructions.
- `backend/agents/claimFoundry/claimFoundryRunner.ts`
  - one runner invocation;
  - whole article initial input;
  - one server-managed continuation strategy;
  - maximum six internal turns;
  - function-tool concurrency of one;
  - fail-fast stable-prefix cache/cost assertions;
  - deterministic rejection of `NON_TERMINAL_AGENT_EXIT`.
- `backend/agents/claimFoundry/claimFoundryInputFilter.ts`
  - inspection/assertion boundary only;
  - no semantic projection.
- `backend/agents/claimFoundry/claimFoundryState.ts`
  - V2.1 package revision, theses, claims, dispositions, inspection, terminal state,
    continuation metadata, and budgets.
- `backend/agents/claimFoundry/claimFoundryTools.ts`
  - replace the manager surface with the four native implementations.
- `backend/agents/claimFoundry/claimFoundryCoverage.ts`
  - structural region derivation only, with no read-state semantics.
- `backend/agents/claimFoundry/claimFoundryPersistence.ts`
  - persist new state/events/inspection/final package and expanded request metrics.
- `backend/agents/shared/agentRuntime.ts`
  - injectable provider boundary;
  - continuation option validation;
  - exact request observations;
  - explicit cache-breakpoint capability/application recording;
  - serialized function-tool execution;
  - no extra runner invocation.
- `backend/agents/claimFoundry/runFixture.ts`
  - V2.1 run config/artifacts;
  - no old projection gate;
  - no runtime acceptance contamination.

### 9.3 Retire from the primary path

- all content-fetch/search tools;
- recursive full-package save tool;
- patch tool;
- separate thesis action;
- separate validation action;
- separate coverage action;
- read-count inspection state;
- conditional tool exposure;
- full-history/manual replay;
- semantic input projection;
- old projected gross-input gate;
- structural `hardPass` presented as semantic completion; and
- fixture-specific runtime assertions.

Historical code and artifacts remain frozen for comparison until the corrected path is
accepted.

### 9.4 Preserve

- `ArticleDocument`;
- authorization/provenance boundary;
- source-unit manifest hashing;
- foreign-grounding rejection;
- MySQL transaction/persistence ports;
- append-only tool events;
- append-only request observations;
- idempotency conflict behavior;
- atomic immutable final package;
- package hash verification;
- typed terminal outcomes;
- trace/artifact conventions; and
- existing comparison artifacts.

## 10. Build sequence and gates

### Step 0 — Freeze authority and baseline

1. Record V2.1 and R2 hashes in build metadata.
2. Preserve manager code and artifacts unchanged.
3. Record baseline unit count, package size, gross/cached/uncached usage where available,
   trajectory length, and terminal result.
4. Assign new instruction, state, schema, and code versions.

Gate: new and historical paths have distinct versions and artifact roots.

### Step 1 — Lossless article packaging

1. Implement canonical whole-article serialization.
2. Verify every source unit occurs exactly once and in order.
3. Verify unit text and source offsets against canonical content.
4. Preserve structural/citation/reference signals.
5. Add stable article boundary markers and hash.
6. Measure article bytes and token estimate.

Gate: complete fixture article passes without truncation or semantic filtering.

### Step 2 — One-run/provider boundary proof

1. Make the model provider injectable at the shared runtime boundary.
2. Add a provider spy.
3. Add a runner-invocation counter.
4. Add a static dependency test proving tools/services cannot import or receive model
   capabilities.
5. Execute an offline scripted multi-turn trajectory.
6. Prove every request belongs to the same agent run.
7. Prove exactly one `Runner.run` invocation.
8. Prove no request originates outside that invocation.

Gate: `oneAgentRun.noOutOfBandModelCalls` passes.

### Step 3 — Continuation and request assertions

1. Select and wire `conversationId`.
2. Prohibit competing history/session options at runtime.
3. Install the assertion-only input filter.
4. Record request item classifications and stable-prefix hashes.
5. Prove request one contains the article once.
6. Prove later client payloads do not manually include it.
7. Prove tool schemas/instructions are byte-identical.
8. Prove full package/inspection snapshots are not replayed.
9. Measure `stablePrefixTokens` as instructions + fixed schemas + article.
10. Add an explicit cache breakpoint immediately after the article when supported by
    the installed model and SDK, and record capability/application status.
11. Implement request-two stable-prefix cache-coverage and cost fail-fast logic,
    including explicit reporting/tokenization tolerance.

Gate: offline request-shape tests pass; live execution remains blocked until usage
assertions are wired.

### Step 4 — Versioned working package and shallow mutation

1. Add thesis, claim, region-disposition, thesis-disposition, acknowledgement, revision,
   and inspection schemas.
2. Implement atomic shallow updates.
3. Implement revision/hash optimistic concurrency.
4. Mark inspections stale after mutation.
5. Implement compact mutation receipts.
6. Add authorization, replay, conflict, rollback, revision, split, merge, removal, and
   invalid-reference tests.

Gate: state mutations are durable and package echoes never enter tool results.

### Step 5 — Deterministic inspection mirror

1. Derive coarse structural regions.
2. Implement exact claim-grounding-to-region set accounting.
3. Implement exact claim-to-model-authored-thesis link accounting.
4. Implement deterministic schema/identity/reference diagnostics.
5. Disable unproven runtime heuristics.
6. Persist inspection revision/hash.
7. Return only compact IDs and set differences.
8. Add non-contaminating fixtures for covered, dispositioned, unaccounted, stale, and
   invalid states.

Gate: code inspection and tests show no semantic relevance or fixture-target rule.

### Step 6 — Finalization and terminal alternative

1. Implement stale-inspection rejection.
2. Implement deterministic region/thesis accounting gates.
3. Implement acknowledgement checks.
4. Reuse atomic immutable final-package storage and hash verification.
5. Implement typed abstention/review.
6. Configure successful finalization and abstention/review receipts as terminal
   function-tool outputs through `toolUseBehavior`.
7. Add the deterministic post-run persisted-state assertion and
   `NON_TERMINAL_AGENT_EXIT`.
8. Test illegal state, stale revision, deterministic defect, missing accounting,
   idempotent replay, immutable terminal state, and successful finalization.

Gate: deterministic integrity is enforced without a semantic host veto.

### Step 7 — Assemble the four-tool agent

1. Rewrite compact fixture-neutral instructions.
2. Bind all four tools in fixed byte-stable order.
3. Remove `isEnabled`/conditional schema behavior.
4. Supply the whole article in the initial input.
5. Set maximum internal turns to six.
6. Set `modelSettings.parallelToolCalls = false`.
7. Set `toolExecution.maxFunctionToolConcurrency = 1`.
8. Wire conversation identity and assertions.
9. Add scripted trajectories using different legal action orders.
10. Add a scripted response containing multiple state-tool calls and prove update,
    inspection, finalization, and terminal actions execute serially without overlap.
11. Prove the runner contains no fixed semantic choreography.

Gate: the complete offline agent suite passes with one runner invocation.

### Step 8 — Durability and full offline verification

Run:

- article packaging tests;
- one-run/provider-boundary tests;
- continuation/request-shape tests;
- tool schema stability tests;
- domain mutation tests;
- inspection/finalization tests;
- agent trajectory tests;
- MySQL durability tests; and
- `npm run typecheck:agents`.

Also run static contamination scans against instructions, schemas, tools, mirror code,
and runtime fixture metadata.

Gate: all tests pass and no billable call has occurred.

### Step 9 — One live F03 run

Run exactly once with no tuning during execution.

Preserve:

- V2.1/R2 hashes;
- instruction/tool/state/code versions;
- article hash, unit count, byte size, and token estimate;
- initial input hash;
- conversation ID;
- every internal request/response ID;
- exact client-input classifications;
- schema/instruction hashes per turn;
- tool calls and compact results;
- package revisions/hashes;
- inspection reports;
- terminal package or typed non-completion;
- gross/cached/uncached/output usage;
- stable-prefix tokens, required cached stable-prefix tokens, reporting tolerance, and
  measured cache coverage;
- cache-breakpoint support/application status;
- price inputs and cost-equivalent usage;
- article cost multiplier;
- latency; and
- proof of one runner invocation/no out-of-band model call.

Hard behavior:

- abort before request three if request two cached input, plus recorded tolerance, covers
  less than 90% of measured stable-prefix tokens;
- abort before any request that would exceed the configured uncached/cost/wall budget;
- reject the run as `NON_TERMINAL_AGENT_EXIT` if the SDK returns without successful
  terminal-tool persistence; and
- do not tune or retry under the same experiment identity.

### Step 10 — Separate evaluator/human review

After the agent run has ended, evaluate the frozen artifacts without making another
model call.

Score the V2.1 success and kill criteria. Evaluator expectations remain outside all
runtime artifacts visible to the agent.

The result may:

- support the architecture;
- identify a bounded component defect; or
- reject the architecture.

Do not pre-commit to repair rather than rejection.

## 11. Required test inventory

### 11.1 Article

- complete unit count;
- canonical ordering;
- exact text/offsets;
- stable serialization/hash;
- preserved structure/references;
- no truncation;
- no semantic filtering.

### 11.2 Model boundary

- one runner invocation;
- one agent identity;
- all requests attributable to that run;
- no model capability in tools/services;
- no direct model call from helpers;
- no handoffs/subagents/model guardrails.

### 11.3 Continuation/cache

- exactly one continuation strategy;
- no client session/history combination;
- article only in first client payload;
- stable instructions and four schemas;
- measured stable-prefix tokens equal instructions + fixed schemas + article;
- explicit cache breakpoint immediately after the article when supported;
- no package/report replay;
- request-two cached tokens cover at least 90% of the stable prefix within recorded
  provider reporting/tokenization tolerance;
- cached tokens are not divided by total request input;
- separate cached/uncached/cost accounting.

### 11.4 Tools

- exact fixed tool names/order;
- byte-identical schemas each turn;
- parallel tool calls disabled in model settings;
- maximum function-tool concurrency equals one;
- a response emitting `update_working_package`, `inspect_working_package`,
  `finalize_working_package`, and `abstain_or_request_review` cannot make any pair race;
  calls execute serially in emitted order without overlap;
- legal behavior and typed illegal-state errors;
- authorization and foreign-grounding rejection;
- idempotency/replay conflict;
- atomic rollback;
- compact outputs without article/package echoes;
- no model calls.

### 11.5 Working package

- shallow set/upsert/remove/disposition/acknowledgement mutations;
- optimistic revision/hash checks;
- model wording preserved;
- no total semantic claim ceiling;
- inspection staleness after mutation;
- terminal immutability.

### 11.6 Inspection

- deterministic diagnostics only for the first runtime;
- exact region set accounting;
- exact model-authored thesis-link accounting;
- no host-inferred support;
- no importance/relevance logic;
- compact report;
- no semantic completion verdict.

### 11.7 Finalization

- current inspection required;
- deterministic-clean requirement;
- all regions accounted;
- all theses accounted;
- all claims thesis-linked;
- acknowledgement integrity;
- disposition reason not semantically judged;
- successful finalization receipt terminates without another model call;
- successful abstention/review receipt terminates without another model call;
- ordinary final response with non-terminal persisted state becomes
  `NON_TERMINAL_AGENT_EXIT`;
- immutable final package.

### 11.8 Agency

- no required tool order;
- update may contain theses and claims together;
- multiple updates allowed;
- inspection may occur more than once;
- thesis revision allowed late;
- finalization may be attempted and rejected with typed error;
- terminal alternative available at any legal non-terminal point.

### 11.9 Contamination

- expected fixture outcomes absent from model-visible runtime code/data;
- evaluator criteria stored outside runtime input construction;
- runtime diagnostics contain only exact state relations;
- no fixture-specific branch.

## 12. Explicit disposition of R1 carryovers

This section identifies R1 content that cannot be carried forward literally.

### 12.1 Separate semantic action contracts

R1 described separate thesis, proposal, validation, and coverage actions.

V2.1 does not permit that staged surface. R2 expresses:

- thesis/claim/disposition/acknowledgement mutation through
  `update_working_package`; and
- deterministic integrity plus coverage reflection through
  `inspect_working_package`.

No separate action or forced turn remains.

### 12.2 State-dependent schema exposure

R1 required conditional tool exposure.

That conflicts with V2.1’s cache-prefix contract and cannot be retained. R2 exposes all
four schemas in fixed order and enforces legality in tool implementations.

### 12.3 Strong “no accumulated transcript” promise

R1 required the implementation to replace accumulated history with only an article
anchor and latest workbench.

That cannot be promised while also using V2.1’s server-managed continuation: the server
retains prior conversation state even when the client sends only a delta.

R2 therefore enforces what the application can prove:

- no manual/client-side replay;
- no repeated article in later client payloads;
- compact tool arguments/results;
- stable schemas/instructions;
- measured cache behavior; and
- honest gross/cached/uncached accounting.

If eliminating server-held history later becomes necessary, it requires a separately
governed continuation experiment. It must not be silently simulated by a semantic
filter.

### 12.4 Context assembler as transcript rewriter

R1 proposed a context assembler that could replace old envelopes.

Under V2.1 it may only inspect/assert and remove exact client-side duplicates or
superseded typed items. It cannot rewrite server-held history and must not break
function-call/result correlation. Any stronger rewrite requires a dedicated offline
proof and a V2.1 amendment.

### 12.5 Thesis-disposition storage

R1 assumed explicit thesis dispositions but did not define their native location in the
consolidated action surface.

R2 flags and resolves this with `setThesisDispositions[]` inside
`update_working_package`. This resolution remains visible and reviewable; it is not a
silent adaptation.

### 12.6 Runtime fixture-target assertions

R1 included runtime test language tied to expected fixture outcomes and named regions.

V2.1 prohibits those expectations from becoming model-visible or influencing runtime
logic. R2 moves them entirely to the separate post-run evaluator/human review.

### 12.7 Conditional-schema savings test

R1 treated smaller state-dependent tool bundles as an optimization.

That test is invalid for V2.1. R2 instead tests byte-identical schemas and measures the
fixed schema block against the cache-prefix target.

### 12.8 Single gross-input ceiling

R1 retained a simple end-to-end input target.

That cannot distinguish cached server-held context from uncached retransmission. R2
uses gross, cached, uncached, and price-weighted input plus the article cost multiplier.

## 13. Stop conditions before the live run

Do not make a billable F03 request if:

- V2.1 or R2 hashes are missing;
- whole-article serialization is incomplete;
- more than one runner invocation exists;
- any helper/tool can access a model capability;
- continuation strategies are mixed;
- article text is manually replayed;
- instructions or tool schemas drift;
- any tool returns article text or a full package;
- runtime logic contains fixture-target expectations;
- inspection contains semantic inference;
- finalization applies a semantic host veto;
- request accounting is incomplete;
- stable-prefix measurement or request-two cache-coverage abort logic is absent;
- a supported explicit post-article cache breakpoint is not applied;
- parallel tool calls are enabled or function-tool concurrency exceeds one;
- terminal function tools require another model call after successful persistence;
- non-terminal ordinary agent exit is accepted as completion;
- MySQL durability tests fail; or
- typecheck fails.

## 14. Definition of done

R2 is complete when:

1. all offline gates pass;
2. one live F03 agent run executes or terminates under the declared fail-fast rules;
3. all required request, trajectory, state, package, usage, and boundary evidence is
   preserved;
4. a separate non-model evaluator/human review scores the frozen result; and
5. the result is accepted, diagnosed, or rejected without hidden semantic assistance.
