# CF6 Whole-Article Agent Configuration Spec v2

**Date:** 2026-07-28  
**Status:** Governing build specification for the next CF6 experiment  
**Replaces:** the frozen content-fetching manager loop and the two-proposal/pre-agent reset path

## 0. Non-negotiable interpretation

There is one ClaimFoundry agent run.

The host invokes the Agents SDK runner once with the complete normalized, source-unit-ID'd article in the initial input. The SDK may invoke the configured model multiple times inside that one agent run as the agent chooses actions and receives tool results. Those internal turns are the agent loop.

There are **no LLM or model calls outside that agent run**:

- no preliminary extraction call;
- no thesis-identification call made by the host;
- no model-based validator;
- no model-based coverage checker;
- no critic, repair, scout, judge, summarizer, or compactor model;
- no subagent, handoff, or agent-as-tool in the first experiment;
- no post-run model evaluation or cleanup call;
- no direct `responses.create()` call from a tool or helper.

All semantic work is performed by the one ClaimFoundry agent from the complete article. Tools are deterministic state actions and mirrors only.

## 1. Diagnosis

The first CF6 manager run did not test whole-article agent reasoning fairly. The article was hidden behind content-fetching tools, and the model was allowed to stop after fetching only a small opening slice. The run also carried a growing transcript and oversized tool schemas.

The corrected experiment changes only the architecture necessary to test the real hypothesis:

> Given the complete article from the first turn, can one agent build, inspect, revise, and finalize a grounded claim package better than a direct one-call baseline?

## 2. Core principle

> The article is given, not fetched. Semantic judgment belongs to the agent. Deterministic code protects integrity and reflects exact state; it does not interpret the article.

The complete article is immediately available to the model without a content-acquisition decision. It is not "free" in token accounting, but it requires no read tool, no host selection, and no additional semantic preprocessing.

## 3. Initial input

The first and only host-started runner invocation contains:

- compact ClaimFoundry instructions;
- run/content identity;
- the complete normalized article;
- stable source-unit IDs and offsets;
- preserved headings, quotations, speakers, citations, links, footnotes, references, and visible structure;
- the minimal tool definitions in Section 6.

The article is authoritative given material. `get_content_map`, `read_source_units`, and `find_source_units` are not part of the primary path.

No semantic inventory, proposed package, thesis list, importance ranking, summary, scout output, or critic output is created before the agent begins.

## 4. Exactly one model-owning component

The ClaimFoundry `Agent` is the only component configured with a model.

### Required code boundary

- Production code has one injected `ModelProvider`/model boundary for this run.
- The host calls `Runner.run(claimFoundryAgent, initialInput, options)` once.
- Tool implementations receive typed run state and deterministic services only. They do not receive an OpenAI client, model provider, runner, agent, or API key.
- No tool implementation may invoke `Runner.run`, `responses.create`, another agent, or any LLM SDK.
- Input/output guardrails used in this experiment must be deterministic. No model-backed guardrails.
- The first experiment has no handoffs and no agents exposed as tools.

### Verification

Add a provider spy and a static boundary test that prove:

1. every model request belongs to the same ClaimFoundry run and agent;
2. no request originates from a tool, validator, coverage service, repair service, or evaluator;
3. the host created exactly one runner invocation;
4. the number of internal model requests equals the agent trajectory recorded by the SDK.

A test named something like `oneAgentRun.noOutOfBandModelCalls` must fail if any helper gains model access.

## 5. Agent control versus host control

### The agent decides

- what the article's central theses are;
- which propositions are material and independently investigable;
- how many claims are needed;
- which surface attribution events differ from substantive verification targets;
- article treatment, polarity, supplier, scope, and thesis effect;
- what to add, split, merge, revise, remove, or disposition;
- whether to inspect its current package;
- whether to revise again;
- when to request finalization, abstention, or review.

### The host may enforce only

- authorized source-unit IDs;
- exact grounding and cross-reference validity;
- unique IDs and schema integrity;
- package version/hash consistency;
- immutable persistence and idempotency;
- turn, token, latency, and cost budgets;
- exact structural region accounting;
- explicit acknowledgement of unresolved non-deterministic warnings;
- typed terminal outcomes.

The host does not choose the next semantic action and does not run a fixed extract-to-validate-to-repair choreography.

## 6. Minimal action surface

Start with three state tools and one terminal alternative. Do not begin with five separate staged tools.

### 6.1 `update_working_package`

A shallow mutation action controlled by the agent.

Possible fields:

- `setTheses[]`;
- `upsertClaims[]`;
- `removeClaimIds[]`;
- `setRegionDispositions[]`;
- `acknowledgeDiagnosticIds[]`.

Claims contain the compact semantic fields needed for the experiment, including exact grounding IDs and model-authored thesis links. The tool validates authorization and persists the mutation. It does not judge meaning.

The initial call may submit a complete working package. Later calls send only changes, not the entire recursive package again.

### 6.2 `inspect_working_package`

One deterministic mirror combining structural validation and exact coverage accounting.

It may return:

- invalid or foreign grounding IDs;
- duplicate IDs and exact duplicate records;
- missing required fields;
- source-unit/structural-region grounding distribution;
- structural regions with no claim grounding and no disposition;
- model-declared theses with zero model-linked claims;
- claims with no model-declared thesis link;
- stale inspection/package hash mismatch;
- optional heuristics clearly labeled `nonBlockingHeuristic`.

It may not:

- discover theses;
- decide that a claim supports a thesis;
- infer that an uncovered region contains a material assertion;
- infer treatment, polarity, attribution, materiality, or semantic duplication;
- produce a semantic summary;
- call a model.

A report such as “fraud/cover-up has zero linked claims” is legal only when the agent itself created a thesis with that label and linked no claims to its thesis ID. The host is counting model-authored links, not interpreting the article.

For the first F03 run, disable semantic-looking heuristics unless they are already proven and strictly non-blocking. The cleanest test begins with deterministic diagnostics only.

### 6.3 `finalize_working_package`

The host may block finalization only for deterministic defects:

- invalid/foreign grounding;
- malformed required fields;
- duplicate IDs;
- missing structural-region accounting;
- a model-declared thesis with neither a linked claim nor an explicit thesis disposition;
- stale inspection after the latest package mutation;
- budget or persistence failure.

Heuristic warnings do not become hidden semantic vetoes. The agent may resolve them or explicitly acknowledge/disposition them.

The host cannot reject a region disposition because it believes the explanation is semantically wrong. That would require a second semantic authority. Semantic correctness is evaluated after the run by the acceptance harness/human review, not by an undisclosed helper model or brittle host rule.

### 6.4 `abstain_or_request_review`

A typed terminal action for unresolved ambiguity, inadequate source quality, or exhausted budget. This is an alternative to finalization, not a mandatory stage.

## 7. No hard-coded tool sequence

The following is an example trajectory, not a programmed pipeline:

```text
[whole article in initial context]
  agent -> update_working_package
  agent -> inspect_working_package
  agent -> update_working_package
  agent -> finalize_working_package
```

The agent may instead inspect after multiple updates, revise theses late, request inspection more than once, finalize after one inspection, or abstain. Legal-state constraints may hide impossible actions, but the host must not select the next semantic action.

Do not require a separate `identify_theses()` call. Theses are model-authored working-package state. Requiring a thesis tool before claims would recreate a staged pipeline and add an unnecessary model turn.

Do not require separate `validate()` and `check_coverage()` calls. One compact mirror avoids forced turns and prevents the host from masquerading as two semantic judges.

## 8. Coverage mirror, precisely bounded

Coverage is a reflection of model-authored state against source structure.

The host may compute exact set operations such as:

- which structural region IDs occur in any claim's grounding;
- which structural region IDs have an explicit agent disposition;
- which agent-declared thesis IDs are linked by at least one claim;
- which claims refer to no thesis ID;
- which source units are cited by selected claims.

The host may not decide whether ungrounded regions are important or whether a linked claim truly supports a thesis.

At finalization, each major structural region must be either:

- represented by claim grounding; or
- explicitly dispositioned by the agent with a compact reason code and optional note.

Use coarse, lossless structural regions derived from headings/paragraph blocks. Do not demand a prose disposition for every individual source unit. That would create bureaucratic output without improving semantic judgment.

## 9. Context and session policy

### 9.1 Do not trust SDK defaults

Assume the SDK accumulates conversation and tool history unless verified otherwise. Official SDK behavior appends history by default when a session is used. Server-managed continuation also retains earlier conversation state even when the client sends only a delta.

Therefore, “the SDK manages it” is not an acceptance criterion.

### 9.2 Choose one continuation strategy

For the first experiment, use one server-managed strategy:

- `previousResponseId`; or
- `conversationId`.

Do not also pass:

- `result.history`;
- a client-managed session for the same conversation;
- manually reconstructed prior input/tool history.

The first request includes the complete article. Later requests contain only the new tool output or agent-turn delta at the client boundary. Prior server-managed context may still be present and billed as cached input.

### 9.3 Input inspection and fail-fast assertions

Install `callModelInputFilter` as an **inspection/assertion boundary first**, not as a semantic filter. Before every model request, record:

- serialized instructions tokens;
- serialized tool-schema tokens;
- client-supplied input items and token estimate;
- whether the article text appears in the new client payload;
- repeated package/tool-output payloads;
- response/conversation identifiers.

The filter may remove only exact duplicates or exact superseded typed state if the chosen continuation mode exposes those items client-side. It may not decide semantic relevance or summarize source content.

Fail before a billable live run if:

- the article is manually included again after request one;
- `result.history` or a session is combined with server-managed continuation;
- old full package snapshots or audit ledgers are replayed;
- tool schemas exceed the agreed bound;
- a model-generated compaction call appears;
- any out-of-band model request appears.

### 9.4 Token accounting language

Do not say “reading is free” or “the article costs only once.” Say:

> The article is supplied once at the client boundary and remains available through server-managed context. Subsequent requests may include billed cached input. Cached, uncached, output, and cost-equivalent usage are measured separately.

A gross-input ceiling below two copies of the article would accidentally prohibit a multi-turn agent even when repeated context is cached. Use these first-run controls instead:

- maximum internal model turns: 4 initially;
- total tool-schema size: measured and capped before live execution;
- cumulative uncached input budget;
- cumulative cached input budget reported separately;
- actual cost-equivalent budget using the active model's cached/uncached prices;
- hard abort before the next request when any budget is exceeded.

Keep the old 135K gross input as a failure comparison, but do not mislabel gross cached context as identical to uncached retransmission.

## 10. Runtime acceptance contamination rule

F03's expected toxins thesis, fraud thesis, Thompson crux, target claim IDs, and success criteria are evaluator-only information.

They must never appear in:

- the agent instructions;
- tool descriptions or schemas;
- coverage mirror logic;
- host-generated diagnostics;
- source packaging beyond what is actually present in the article;
- model-visible fixture metadata.

The runtime agent must discover them from the whole article. The post-run evaluator may then score whether they were recovered.

## 11. First F03 experiment

Build only:

1. the existing complete normalized F03 article with all source-unit IDs;
2. one ClaimFoundry agent;
3. one host call to `Runner.run`;
4. the tools in Section 6;
5. server-managed continuation with no competing history mechanism;
6. permanent per-request usage and model-input accounting;
7. immutable package/audit persistence already preserved from the manager build.

Run once before tuning.

### Required evidence preserved

- exact initial input hash and article unit count;
- every internal model request and response ID;
- tool call trajectory and compact arguments/results;
- working-package versions and hashes;
- inspection reports;
- final package or typed non-completion;
- cached, uncached, output, latency, and cost-equivalent usage per request;
- proof of no out-of-band model calls.

### Success criteria

Evaluator-only, not model-visible:

- the final package represents both major F03 theses;
- material Thompson/fraud crux claims are present;
- final grounding reaches materially relevant late article units, including the late region where appropriate;
- claims are independently investigable and verdictable;
- attribution and article treatment are preserved;
- every major structural region is claim-grounded or explicitly dispositioned;
- the agent's revisions after its mirror materially improve its first working package;
- total cost is commercially plausible and dramatically below the failed manager design.

### Honest kill criteria

- the whole-article agent still omits a major thesis or crux after seeing its exact mirror;
- the mirror adds no material improvement over the first package;
- the agent repeatedly acknowledges gaps without fixing or honestly dispositioning them;
- multiple turns cost substantially more than a direct call without quality gain;
- the design needs a hidden semantic model, deterministic relevance selector, or fixture-specific hint to pass;
- the direct one-call baseline equals or beats final quality at materially lower cost.

A failure may identify a component defect, but the result is allowed to reject the architecture. Do not pre-commit to “fix the stage, never abandon the architecture.”

## 12. Preserved infrastructure

Keep:

- authorization/provenance boundaries;
- exact source-unit IDs and foreign-grounding rejection;
- MySQL run, event, package, and request persistence;
- idempotency, immutable finalization, and package hashes;
- permanent request accounting;
- typed terminal outcomes;
- provider boundary and CF5 isolation.

Retire from the primary path:

- article content behind read/search tools;
- manual/full-history replay;
- always-on giant schema bundles;
- structural pass presented as semantic completion;
- pre-agent semantic calls;
- model-backed validation, coverage, repair, or compaction;
- fixture-specific runtime guidance.

## 13. Governing build instruction

> Invoke one ClaimFoundry agent once with the complete normalized article in its initial context. Allow only that agent's SDK-managed internal turns to use the model. Give it deterministic state actions and an exact mirror of its own model-authored coverage. Do not make any other model call, do not ration or pre-interpret the article, do not force a staged tool sequence, and do not trust SDK context defaults without inspecting every request and measuring cached and uncached input.
