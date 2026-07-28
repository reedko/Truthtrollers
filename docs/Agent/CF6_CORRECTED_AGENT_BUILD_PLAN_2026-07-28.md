# CF6 Corrected Agent Build Plan

Date: 2026-07-28  
Status: Implementation plan  
Authority: `CF6 Agent Configuration Spec — corrected design` plus the explicit
SDK-context caution supplied on 2026-07-28  
Replaces: the no-tool/host-correction plan and the manager-loop continuation plan

## 1. Outcome

Build one ClaimFoundry agent that:

1. receives the complete normalized, unit-ID'd article as given context;
2. never fetches article content through tools;
3. identifies the article's theses and proposes grounded claims;
4. receives a deterministic mirror of gaps in its own claim coverage;
5. revises its work until coverage is closed or every gap is explicitly
   dispositioned;
6. finalizes through the existing durable, authorized, immutable persistence
   boundary; and
7. does not accumulate or replay a growing raw transcript between model turns.

The first live experiment is one F03 run. No additional fixture tuning or milestone
tower is authorized before that run is reviewed.

## 2. Governing design

### 2.1 Model responsibilities

The model decides:

- the article's distinct central theses;
- which representations are material;
- the number and boundaries of claims;
- attribution, supplier, treatment, polarity, and thesis effect;
- which diagnostics require revision;
- whether a coverage gap needs another claim or an explicit disposition;
- which legal tool to call next; and
- when to request finalization.

### 2.2 Host responsibilities

The host:

- supplies the whole authorized article;
- validates exact source-unit identity and foreign-grounding rejection;
- persists theses, claims, dispositions, diagnostics, events, and final packages;
- computes region coverage from persisted grounding IDs;
- computes thesis-support coverage from persisted thesis IDs;
- labels deterministic, heuristic, and semantic-review checks honestly;
- exposes only tools legal in the current state;
- blocks finalization until deterministic gates are satisfied;
- enforces operational budgets and immutability; and
- measures the actual model-visible context and token behavior.

The host does not decide that a source unit, passage, thesis, supplier, or claim is
semantically unimportant.

### 2.3 Tool boundary

Start with exactly five model-facing tools:

1. `identify_theses`
2. `propose_claims`
3. `validate`
4. `check_coverage`
5. `finalize`

Tools perform actions or return host-computed feedback. No tool returns article text.

### 2.4 Application boundary

CF6 remains an OpenAI Agents SDK workflow. The application invokes the SDK runner;
it does not implement a host-orchestrated sequence of direct Responses API calls.
Provider transport details remain below the CF6 workflow boundary.

## 3. Context contract

Compact context is a correctness requirement, not an expected SDK default.

Assume the Agents SDK accumulates the complete message/tool transcript unless the
implementation proves otherwise. Do not interpret "SDK-managed session" as evidence
that context is compact.

### 3.1 Immutable article anchor

The initial agent context contains:

- content ID;
- content hash;
- source-unit manifest hash;
- title and relevant source metadata; and
- every source unit, in canonical order, with exact unit ID, structural type, and
  normalized text.

The article serializer is lossless with respect to model-visible article content.
It performs no selection, summarization, relevance ranking, or truncation.

### 3.2 Typed workbench

The only mutable semantic state carried forward is:

```text
run:
  runId
  contentId
  status
  remaining operational budget

theses:
  thesisId
  statement
  groundingUnitIds

claims:
  claimId
  compact claim fields
  groundingUnitIds
  thesisIds

coverage:
  latest region gaps
  latest thesis-support gaps
  current explicit dispositions

validation:
  latest diagnostics only
```

Audit history remains in MySQL and artifacts. It is not model context.

### 3.3 Explicit context assembly

Implement a CF6-specific context assembler/session boundary. On every internal model
turn it must construct the intended workbench deliberately.

Allowed model input:

- the immutable article anchor through the selected SDK state/cache mechanism;
- the latest typed workbench snapshot;
- the minimum immediately pending tool-call/result correlation required by the SDK;
  and
- the currently legal tool schemas.

Forbidden model input:

- the accumulated raw transcript;
- superseded workbench snapshots;
- prior validation reports;
- prior coverage reports;
- repeated mutation receipts;
- prior full tool outputs;
- repeated article copies in flowing state; or
- retired tool schemas.

No rule may remove content based on semantic relevance. Compaction is structural:
replace superseded typed state with its latest canonical persisted form.

### 3.4 Context proof gate

Before implementing the domain loop, construct a synthetic six-turn SDK run and record
the exact `ModelRequest` presented to the provider on each turn.

The proof must show:

1. the unmodified SDK default accumulates history, or explicitly demonstrate if the
   installed version does not;
2. the CF6 override prevents that accumulation;
3. the article anchor is complete and stable;
4. later mutable input contains only the latest typed workbench and required immediate
   tool correlation;
5. superseded tool envelopes are absent;
6. tool schemas are conditional; and
7. request accounting detects any regression.

Do not proceed to a billable F03 run until this proof passes.

If the installed SDK cannot simultaneously preserve the article anchor and replace
turn history with compact typed state, stop and document the exact limitation. Do not
silently fall back to full-history replay and do not disguise a replay as a session.

## 4. Domain contracts

### 4.1 `identify_theses`

Input:

- idempotency key;
- one to three model-identified theses;
- for each thesis: stable ID, concise statement, and grounding unit IDs.

Host behavior:

- reject unknown or foreign unit IDs;
- upsert the thesis set atomically;
- persist an append-only event;
- return only a compact receipt and current thesis IDs.

The host does not generate, merge, rank, or rewrite theses.

### 4.2 `propose_claims`

Input:

- idempotency key;
- bounded batch of claim upserts;
- optional claim IDs retired or superseded by the batch.

Each claim includes the semantic fields required by the corrected spec:

- claim ID;
- assertion;
- grounding unit IDs;
- content supplier and attribution;
- article treatment;
- polarity/scope where applicable;
- thesis IDs;
- thesis effect; and
- selection rationale.

Host behavior:

- reject foreign grounding and unknown thesis IDs;
- enforce schema and referential integrity;
- upsert/retire atomically;
- preserve model wording and judgment;
- persist an append-only event; and
- return a compact receipt, not the full package.

Batch bounds protect transport and transactions. They must not impose a semantic ceiling
on the total number of claims.

### 4.3 `validate`

Input:

- idempotency key only.

Output:

- latest diagnostics only;
- every diagnostic labeled `deterministic`, `heuristic`, or
  `semantic-review-pending`; and
- no `hardPass` wording that can be mistaken for semantic completion.

Deterministic blocking checks include:

- schema validity;
- authorized content identity;
- valid grounding IDs;
- unique and valid object IDs;
- valid thesis references;
- exact source-unit offsets/spans; and
- valid package references.

Heuristics such as thin portfolio, compound-claim suspicion, polarity mismatch, or
possible omission are feedback. They are not secretly deterministic gates.

Validation never mutates claims.

### 4.4 `check_coverage`

Input:

- idempotency key only.

The host computes a mirror from persisted state:

- article regions with one or more grounded claims;
- article regions with no grounded claim;
- theses with one or more linked claims;
- theses with no linked claim;
- late-article coverage, including the U0380+ area for F03; and
- current explicit dispositions.

Region coverage is a mechanical relation between region unit ranges and claim grounding
IDs. Thesis support is a mechanical relation between model-authored thesis IDs and
model-authored claim thesis IDs.

The mirror may say that a region or thesis has zero linked claims. It may not decide
that the gap is semantically unimportant or invent a claim to close it.

### 4.5 `finalize`

Input:

- idempotency key;
- explicit dispositions for every remaining region gap;
- explicit dispositions for every remaining thesis-support gap; and
- optional typed abstention information.

The finalize gate requires:

- a persisted thesis set;
- a persisted claim set;
- no deterministic validation error;
- every region covered by grounding or explicitly dispositioned;
- every thesis supported by a claim or explicitly dispositioned;
- no unknown unit/thesis/claim references; and
- no pending required review.

The host enforces presence, identity, and referential completeness of dispositions. It
does not deterministically certify the semantic truth of a disposition reason.

On success, reuse the existing atomic immutable final-package snapshot and hash.

## 5. State-dependent tool exposure

Tool exposure enforces legality without prescribing one fixed sequence.

| State | Legal tools |
|---|---|
| Created, no theses or claims | `identify_theses`, `propose_claims` |
| Theses only | `identify_theses`, `propose_claims`, `check_coverage` |
| Claims exist | `identify_theses`, `propose_claims`, `validate`, `check_coverage` |
| Diagnostics or gaps exist | `identify_theses`, `propose_claims`, `validate`, `check_coverage` |
| Deterministic validation clean | all five; `finalize` still enforces coverage/dispositions |
| Terminal | none |

Multiple legal actions remain available wherever the state permits them. The runner does
not hard-code `identify → propose → validate → coverage → finalize`.

## 6. Repository change map

### 6.1 Add

- `backend/agents/claimFoundry/claimFoundryArticleContext.ts`
  - lossless article serialization and completeness verification.
- `backend/agents/claimFoundry/claimFoundryWorkbench.ts`
  - typed compact mutable state and canonical projection.
- `backend/agents/claimFoundry/claimFoundryContextAssembler.ts`
  - explicit per-turn SDK input construction.
- `backend/agents/claimFoundry/claimFoundryCoverageMirror.ts`
  - region/thesis mechanical coverage computation.
- focused unit and integration tests for each new boundary.

### 6.2 Replace or substantially revise

- `backend/agents/claimFoundry/claimFoundryAgent.ts`
  - expose only the five corrected tools and conditional legality.
- `backend/agents/claimFoundry/claimFoundryInstructions.ts`
  - state that the complete article is already present;
  - remove all content-acquisition language;
  - explain the coverage mirror without prescribing tool order.
- `backend/agents/claimFoundry/claimFoundryRunner.ts`
  - provide the full article context;
  - install the explicit context assembler;
  - retain operational circuit breakers;
  - remove the 45K projection veto.
- `backend/agents/claimFoundry/claimFoundryInputFilter.ts`
  - replace the manager transcript filter with the structural workbench assembler;
  - no semantic relevance logic.
- `backend/agents/claimFoundry/claimFoundryTools.ts`
  - implement the five action/mirror tools;
  - retain authorization, idempotency, atomic mutation, and immutable finalization.
- `backend/agents/claimFoundry/claimFoundryCoverage.ts`
  - retire read-based inspection;
  - derive coverage from persisted grounding and explicit dispositions.
- `backend/agents/claimFoundry/claimFoundryValidation.ts`
  - separate deterministic blockers from honest heuristics;
  - remove structural-pass-as-semantic-completion behavior.
- `backend/agents/claimFoundry/claimFoundryState.ts`
  - add theses, dispositions, compact workbench version, and session/context metadata;
  - remove units-read as a semantic progress measure.
- `backend/agents/shared/agentRuntime.ts`
  - expose the SDK session/context configuration required by the assembler;
  - record exact per-turn input composition and cache usage.
- `backend/agents/claimFoundry/runFixture.ts`
  - remove the offline projection gate;
  - emit corrected artifacts and acceptance evidence.

### 6.3 Retire from the model-facing path

- `get_content_map`
- `read_source_units`
- `find_source_units`
- `save_working_package`
- `apply_package_patch`
- the current manager-only finalization schema
- read-count-based coverage
- the current 45K offline projection gate
- the always-on seven-tool schema bundle

Retirement means frozen for comparison, not deleted from historical evidence.

### 6.4 Preserve

- `ClaimFoundryToolContext` authorization boundary;
- `ArticleDocument`;
- source-unit manifest hashing;
- MySQL transaction and persistence ports;
- append-only events and model-request rows;
- idempotent replay/conflict behavior;
- foreign-grounding rejection;
- final package hash and immutable snapshot;
- deterministic-versus-semantic validation labels;
- normalized tracing and artifact conventions; and
- CF5 and the manager run as comparison evidence.

## 7. Build steps

### Step 0 — Freeze and baseline

1. Do not modify or overwrite the existing manager-run artifacts.
2. Record the manager baseline: 404 total units, 22 inspected units, three claims,
   135,817 input tokens, and failed F03 crux recovery.
3. Assign new instruction, state, tool-schema, and code versions.
4. Add the corrected spec and this plan to the run manifest inputs.

Exit: historical baseline is immutable and the new path has distinct version IDs.

### Step 1 — Prove the context spine offline

1. Add the lossless F03 article serializer.
2. Add the typed workbench schema.
3. Instrument `ModelRequest` composition in the shared runtime.
4. Write a fake-provider six-turn agent test using representative tool calls/results.
5. Capture the SDK default behavior.
6. Implement the explicit session/input override.
7. Prove that only the article anchor, latest workbench, required immediate correlation,
   and legal tools are model-visible.
8. Add a regression test that intentionally re-enables accumulation and must fail.

Exit: the compact-context proof passes with no live model call.

### Step 2 — Build thesis and claim persistence

1. Add thesis schemas and persisted state.
2. Adapt the existing selected-claim schema to include thesis IDs and thesis effect.
3. Implement `identify_theses`.
4. Implement `propose_claims` as atomic upsert/retire.
5. Reuse authorization, manifest verification, idempotency, and event hashing.
6. Test invalid unit IDs, unknown thesis IDs, replay, conflict, rollback, revision, split,
   retirement, and terminal immutability.

Exit: model-authored theses and claims persist safely without content tools.

### Step 3 — Build the coverage mirror

1. Reuse deterministic article region derivation.
2. Map every region to its canonical unit range.
3. Compute region coverage from persisted claim grounding IDs.
4. Compute thesis support from persisted claim thesis IDs.
5. Persist explicit region/thesis dispositions separately from computed coverage.
6. Implement `check_coverage`.
7. Add F03 fixtures proving opening, middle, Thompson, and U0380+ gaps are reported.
8. Prove the mirror contains no semantic relevance rule.

Exit: missing grounded support is visible without the host deciding what matters.

### Step 4 — Rebuild validation and finalization gates

1. Split validation output into deterministic blockers, heuristics, and pending semantic
   review.
2. Implement compact `validate` output.
3. Remove `hardPass` as a semantic-completion signal.
4. Implement `finalize` dispositions and deterministic gate checks.
5. Reuse atomic final-package hashing and immutable persistence.
6. Test rejection of uncovered/undispositioned regions and unsupported/undispositioned
   theses.
7. Test successful finalization and terminal immutability.

Exit: a 22/404-style package cannot finalize silently.

### Step 5 — Assemble the corrected agent

1. Rewrite instructions around whole-article reasoning and the coverage mirror.
2. Bind exactly the five tools.
3. Implement state-dependent tool exposure.
4. Supply the full F03 article in initial context.
5. Install the proven compact context assembler/session.
6. Keep only operational max-turn, max-tool, wall-time, and emergency token circuit
   breakers.
7. Do not encode a mandatory tool order in host code or prompt text.
8. Add a scripted fake-model trajectory with a non-default order to prove agency.

Exit: the SDK runs a bounded, model-driven loop over whole-article context.

### Step 6 — Complete offline verification

Run:

- ClaimFoundry domain-tool tests;
- corrected agent-manager tests;
- context-spine and accumulation-regression tests;
- MySQL durability tests;
- agent TypeScript typecheck; and
- a zero-model-call F03 artifact projection.

All must pass before live execution.

### Step 7 — Run one live F03 experiment

Run exactly one corrected-agent F03 execution.

Persist:

- run configuration and version IDs;
- article/manifest hashes;
- exact initial context manifest;
- per-turn model-visible input classification;
- exposed tools per turn;
- tool trajectory and validated arguments;
- theses and claim versions;
- every coverage report;
- every validation report;
- dispositions;
- final package or typed terminal failure;
- gross, cached, and uncached input tokens per turn;
- output tokens;
- latency per model turn and tool;
- response/session identifiers; and
- final review Markdown.

Do not tune during the run.

### Step 8 — Review against decisive criteria

Success requires all of:

1. `identify_theses` records both the toxins thesis and the fraud/cover-up thesis.
2. Coverage moves beyond the opening and includes the U0380+ area.
3. Thompson-crux equivalents to C0101/C0107 are in the final package.
4. Every uncovered region is explicitly dispositioned before finalization.
5. Every identified thesis has linked claims or an explicit disposition.
6. No foreign grounding or deterministic validation error survives.
7. Context instrumentation proves no growing raw transcript.
8. Token economics materially beat the manager run.
9. Crux recovery and verdictability materially beat the manager package.

Kill/diagnostic outcomes:

- Missing fraud thesis: isolate thesis identification.
- Fraud thesis present but unsupported after mirror: isolate coverage-mirror efficacy.
- Transcript grows: context/session override failed.
- Article or tools repeat unexpectedly: caching/context assembly failed.
- Structural gate finalizes semantic incompleteness: finalization contract failed.
- Direct one-shot baseline equals or beats the agent at lower cost: mirror has not yet
  justified its complexity.

## 8. Token-accounting rule

Never report one undifferentiated "input tokens" number.

For every turn report:

- model-visible input tokens;
- physically serialized input bytes/items where observable;
- cached input tokens;
- uncached input tokens;
- tool-schema tokens;
- mutable-workbench tokens;
- output tokens; and
- cumulative totals for each category.

The target from the corrected spec is under 45K end-to-end input relative to the
manager's 135,817. Because providers may include cached context in gross input-token
reporting, acceptance must show both:

1. no growing raw transcript or repeated uncached article processing; and
2. under 45K uncached input tokens unless the provider's reported semantics demonstrate
   a stricter directly comparable measure.

Do not call a run economical merely because cache hits occurred. Do not call a correct
compact run a replay solely because gross usage includes cached context. Preserve the
raw per-turn records so the distinction is reviewable.

## 9. Required test inventory

### Article context

- all 404 F03 units exactly once;
- canonical order;
- exact text;
- stable hash;
- no semantic filtering;
- no truncation.

### Context/session

- default SDK accumulation is detected;
- explicit override prevents accumulation;
- latest typed state supersedes old versions;
- article does not enter mutable workbench;
- latest required tool correlation is retained;
- orphan tool calls/results cannot be produced;
- conditional schemas match legal state;
- token accounting classifies every payload component.

### Domain tools

- all five tools authorized and idempotent;
- no content-returning tool exists;
- atomic rollback on invalid thesis/claim;
- foreign grounding rejected;
- revision and split supported through `propose_claims`;
- validation non-mutating;
- coverage mirror deterministic;
- finalization blocked by undispositioned gaps;
- final package immutable.

### Agency

- at least two legal actions are available where state permits;
- no host-coded fixed sequence;
- model can revisit thesis identification;
- model can propose before validation;
- model can validate or check coverage in either order;
- model can revise after either diagnostic source.

### F03 acceptance

- toxins thesis detected;
- fraud thesis detected;
- Thompson region appears in coverage feedback;
- Thompson claims survive finalization;
- U0380+ is covered or dispositioned;
- all gaps explicitly closed;
- no raw transcript growth.

## 10. Stop conditions before live execution

Do not make a billable F03 call if any of these is true:

- article serialization is incomplete;
- the SDK context proof is missing;
- later turns accumulate raw history;
- tool outputs contain article text;
- all five schemas are exposed regardless of state;
- coverage depends on a semantic relevance rule;
- finalization can pass an undispositioned region or thesis;
- per-turn cache/usage accounting is unavailable;
- MySQL durability tests fail; or
- typecheck fails.

## 11. Definition of done

This plan is complete when one corrected F03 run has produced a reviewable artifact
showing:

- whole-article context;
- an explicitly compact SDK workbench;
- model-driven thesis and claim judgment;
- deterministic coverage reflection;
- gap-closing behavior;
- exact grounding;
- durable state;
- immutable finalization;
- transparent token economics; and
- recovery or clear stage-attributed failure of the Thompson crux.

