# CF6 Architecture Reset

## Quality-first, artifact-centered ClaimFoundry

**Status:** Draft for review — not governing until approved  
**Date:** 2026-07-28  
**Decision scope:** Replace the constraint-shaped Milestone 4C design with an architecture that protects product correctness while treating implementation preferences and cost targets as adjustable.

## Executive decision

Pause further optimization of the current free-running ClaimFoundry manager loop. Preserve its tools, persistence, schemas, request accounting, and test assets, but do not treat its control loop as the architecture that CF6 must save.

Build an artifact-centered ClaimFoundry with a deterministic macro-workflow and model-owned semantic decisions:

1. deterministically normalize and partition the complete article;
2. conduct a bounded model survey of every partition;
3. persist a grounded semantic inventory;
4. let a global synthesis agent discover the thesis, themes, candidates, and portfolio from that inventory;
5. hydrate proposed claims with exact source text;
6. run focused critics and bounded repairs;
7. finalize only after product-level quality gates pass.

This is intentionally a hybrid. Code reliably performs scheduling, access control, persistence, provenance, and validation. Models perform semantic discovery, interpretation, selection, rewriting, criticism, and repair.

The architecture should be judged first on whether it recovers the crux, avoids material omissions, produces independently investigable claims, preserves treatment and provenance, and never corrupts grounding. Token use and latency remain important, but they are optimization targets—not preconditions that prevent us from learning whether an idea works.

## What “iterate offline until it passes” meant

The earlier statement meant:

> Simulate the exact model requests without paying for model calls, reduce repeated payload, and run live only if the estimated total falls below the predetermined token threshold.

That is useful as a cost-control technique. It becomes harmful when the threshold is treated as a law of the product and the architecture is distorted to satisfy it before semantic quality has been established.

A “lower-bound proof” would calculate the smallest possible request payload under every existing constraint and show that even the theoretical minimum exceeds the budget. That exercise can diagnose conflicting requirements, but it does not establish that the requirements are worth preserving. In CF6, it placed too much authority in constraints that were created for one implementation experiment.

The corrected policy is:

> Estimate before spending, observe every request, and stop genuine runaways. Do not require an unvalidated offline simulation to approve the experiment that would tell us whether the architecture works.

## Why the current design failed

The current loop made one model act simultaneously as reader, planner, memory manager, extractor, validator, repair coordinator, and finisher. It then attempted to preserve agency by refusing to give the host a reliable macro-workflow.

That produced four predictable failures.

### Agency was assigned to the wrong decisions

It is valuable for a model to decide which representation is material, what the article adopts or challenges, which supplier originated a statement, and whether a claim is independently verifiable.

It is not valuable for a model to decide whether the system should ever inspect the second half of the article. Reading coverage is infrastructure, not semantic autonomy.

### Conversation history became application state

Although typed state was persisted, the manager still depended on a repeated model-visible representation of coverage, packages, findings, tools, and source outputs. The accepted F03 run used 135,817 input tokens across 11 requests. The relevance-neutral 4C projection still reached 62,360 tokens.

The attempted “compact state” reached roughly 5,400 tokens on later turns. This is not evidence that article-wide reasoning is unaffordable. It is evidence that a growing conversational loop is the wrong container for the work.

### Procedural coverage substituted for semantic coverage

A 33-region status ledger can prove that the manager touched regions. It cannot prove that the model recovered the article’s substantive inventory, crux, challenged material, or evidence-bearing propositions.

Coverage should be demonstrated by a persisted, grounded semantic survey and measured against material omissions—not principally by status fields.

### Experiment constraints became product doctrine

The 45,000-token ceiling, seven-tool bundle, one-manager restriction, prohibition on macro-phases, prohibition on model-authored semantic condensation, and single live run were useful experimental controls. They were not product truths.

Together they prevented the system from using the architecture most naturally suited to long-document semantic work.

## Proposed architecture

### Architectural flow

```text
Authorized content
      ↓
Deterministic normalization and structural partitioning
      ↓
Bounded semantic survey of every partition
      ↓
Persisted grounded semantic inventory
      ↓
Global thesis, theme, candidate, and portfolio synthesis
      ↓
Exact-source hydration of proposed claims
      ↓
Focused grounding, attribution, treatment, and atomicity critics
      ↓
Agent-selected bounded repair
      ↓
Immutable canonical package and evidence-ready projection
```

The workflow is deterministic at the macro level. It is semantic and model-directed inside the stages where judgment matters.

### 1. Deterministic article preparation

The host:

- verifies the authorized ArticleDocument and source-unit manifest;
- preserves citation sidecars and exact source lineage;
- partitions the article by structural boundaries and bounded token size;
- creates a complete survey manifest covering every source unit;
- records stable partition and source-unit IDs.

Partitioning is not a relevance judgment. It is equivalent to pagination: it determines how content can be read, not what it means.

### 2. Complete bounded semantic survey

Every partition receives a focused model call with exact source text. Calls may run sequentially or in bounded parallel batches.

Each survey produces a typed artifact containing:

- grounded substantive representations;
- attribution events and candidate suppliers;
- treatment signals;
- named works, studies, people, organizations, quantities, and referents;
- locally apparent themes and thesis contributions;
- candidate verification targets;
- uncertainty and unresolved references;
- exact supporting source-unit IDs;
- an explicit “no material representation found” outcome when appropriate.

The survey artifact is model-authored semantic work, not a host-authored summary used to discard inconvenient material. Exact source remains durable and rereadable.

The host does not determine which findings are important. It only ensures that every partition receives a survey result or an explicit recorded failure.

### 3. Grounded semantic inventory

Survey artifacts are combined into a persisted inventory. Nothing is selected for the final portfolio yet.

The inventory is allowed to be redundant. It is an audit and recall artifact whose purpose is to prevent silent omission. Each row retains its grounding and the survey call that produced it.

Deterministic code may:

- validate schemas and source IDs;
- reject fabricated or foreign grounding;
- normalize identifiers;
- group exact duplicates;
- construct indexes;
- flag possible duplicates for semantic review.

It may not silently remove distinct semantic rows because a heuristic considers them unimportant.

### 4. Global semantic synthesis

A synthesis agent receives the complete compact inventory—not the full article and not a replayed conversation transcript.

It decides:

- the central thesis or theses;
- major themes;
- which inventory rows express the crux;
- which rows are candidates for independently investigable claims;
- which rows are duplicates, context, attribution-only, rebutted, decorative, or immaterial;
- which referents or source regions require exact rereading;
- the smallest complete portfolio;
- explicit dispositions for every material omission or merge.

If the inventory is too large for one call, synthesis can be hierarchical: theme-level synthesis followed by one global portfolio call. Every condensation remains a typed, grounded, versioned semantic artifact and can be audited against its inputs.

### 5. Exact-source hydration

Before a proposed claim can be accepted, the host fetches its cited source units and appropriate structural neighbors. The model sees exact text for the claim under review.

This prevents a semantic inventory paraphrase from becoming authoritative evidence. The inventory helps the model find and organize candidates; exact source governs final wording, scope, attribution, treatment, and polarity.

### 6. Focused critics

Criticism is divided by cognitive task instead of asking one manager to self-review everything in the same context.

Focused critic calls may evaluate:

- central representation and material omission;
- independent verdictability and atomicity;
- attribution depth and supplier identity;
- adopted, challenged, and reported treatment;
- grounding adequacy and scope preservation;
- redundancy and portfolio economy.

Deterministic validators continue to own exact schema, authorized IDs, lineage, immutable fields, counts, hashes, and repair integrity.

Critic findings are advisory or blocking according to the product acceptance rubric, not according to whether they are easy to encode deterministically.

### 7. Agentic repair and finalization

A repair agent receives the current package, exact source text for affected claims, and focused findings. It chooses among bounded legal repairs and may request additional source hydration.

Meaning-changing repairs require explicit review. Every before/after value and grounding set is persisted.

Finalization produces:

- the canonical semantic package;
- the evidence-ready projection;
- the inventory and disposition trail;
- critic and repair history;
- exact source lineage;
- request-level cost and latency;
- a human-readable explanation of limitations and abstentions.

## What remains genuinely agentic

Agency is not measured by whether a model controls the loop counter.

The model continues to decide:

- what each region says;
- which representations are substantive;
- the article’s thesis and themes;
- which claims form the smallest complete portfolio;
- attribution, supplier, treatment, polarity, and scope;
- when exact source must be reread;
- how to respond to semantic criticism;
- which legal repair to apply;
- whether uncertainty requires abstention or human review.

The host may decide:

- that every partition must be surveyed;
- which task runs next in the macro-workflow;
- how content is partitioned for bounded access;
- which exact source units correspond to requested IDs;
- whether schemas, IDs, hashes, budgets, and state transitions are valid;
- whether blocking product gates are satisfied.

This boundary gives the model freedom where judgment creates product value and removes freedom where variability only creates omissions, cost, or operational failure.

## Constraint policy reset

Constraints should be classified by why they exist. They should not all have equal authority.

### Tier 1 — Product invariants

These remain hard unless the product contract itself changes:

- the agent may inspect only authorized content;
- all grounding IDs and lineage must be exact;
- no fabricated quotations, sources, studies, or identifiers;
- downstream retrieval cannot mutate canonical target text;
- final packages are immutable and hash-verifiable;
- mutating tools are idempotent and auditable;
- no silent repair corruption;
- abstentions and material omissions are inspectable;
- ClaimFoundry does not search external evidence.

### Tier 2 — Promotion gates

These block promotion, not experimentation:

- crux recovery;
- material omission rate;
- independent verdictability;
- challenged-class treatment performance;
- semantic grounding adequacy;
- repair effectiveness;
- stability across frozen repeats.

A prototype may fail these gates. The purpose of an experiment is to reveal that failure before promotion.

### Tier 3 — Operating targets

These trigger investigation and optimization but do not automatically invalidate semantic results:

- approximately 40,000 end-to-end input tokens;
- latency target;
- preferred call count;
- preferred schema size;
- preferred number of repair rounds;
- cost per completed package.

A run over target must explain the quality gained and identify the expensive stage. It is not discarded solely because it crossed a round number.

### Tier 4 — Design hypotheses

These may be changed whenever evidence supports a better design:

- one manager agent;
- seven tools;
- no deterministic macro-phases;
- no model-authored semantic summaries;
- full lossless state in every model request;
- one model for every cognitive task;
- no bounded parallel survey workers;
- a specific turn count;
- a 45,000-token offline authorization gate;
- conditional tool exposure as a primary architecture mechanism.

These are implementation choices, not moral commitments.

## Specific constraints to release

| Current constraint | Replacement |
|---|---|
| Projected input must be ≤45,000 before any live F03 run | Estimate and report cost; enforce a configurable runaway ceiling. Do not make an unvalidated simulation the arbiter of semantic experiments. |
| One free-running manager controls inspection through finalization | Use a deterministic macro-workflow with model-owned semantic stages. |
| No model-generated summaries | Allow grounded, typed, versioned semantic inventory and synthesis artifacts; exact source remains authoritative. |
| Active model input must be a lossless projection of all current typed state | Persistence is lossless. Each call receives the smallest sufficient task packet with references to durable artifacts. |
| Host logic may enforce legality only | Host logic may schedule complete survey, hydrate exact source, validate mechanics, and advance macro-stages. It still may not decide semantic importance. |
| Region ledger is the main completeness gate | Use complete survey coverage plus semantic inventory, explicit dispositions, and blind omission measurement. |
| Fixed tool choreography is inherently non-agentic | Fixed infrastructure choreography is acceptable. Semantic choices and repair decisions must remain model-owned. |
| No parallel workers or specialized calls | Permit bounded survey and critic calls when they reduce context interference and improve coverage. |
| Cost gate precedes quality evidence | Establish quality and failure modes first, then optimize the measured quality–cost frontier. |

## Context and memory policy

The durable database is the memory. A model request is a workbench.

Each request should contain only:

- the stage goal and output contract;
- the exact artifact rows needed for that task;
- exact source text when wording or grounding is being judged;
- active findings relevant to the object under review;
- bounded references to other durable artifacts.

Requests should not contain:

- an accumulated assistant/tool transcript;
- superseded package versions;
- full audit envelopes;
- unchanged coverage tables;
- tool schemas unrelated to the task;
- every prior failure and success event;
- source text unrelated to the object currently being judged.

No semantic information is destroyed by omission from a request. It remains in durable artifacts and can be loaded by ID.

This is not a claim that the model has conventional human memory. It is an explicit design for the model’s actual cognitive profile: strong local semantic judgment, limited working context, sensitivity to recency and framing, and no need to pretend one conversation is one continuous mind.

## Budget and experimental policy

### Observe permanently

Keep the request-accounting work already implemented:

- exact per-request input, cached, uncached, and output tokens;
- model and response identifiers;
- artifact and schema payload classes;
- tool exposure and selection;
- latency, retries, and terminal reason.

### Use configurable safeguards

Every run has:

- a warning target;
- a configurable safety ceiling for genuine runaway protection;
- a dollar estimate;
- a human override for experiments;
- stage-level accounting.

The existing 40,000-token rubric value becomes the initial optimization target. The 45,000 Milestone 4C value no longer blocks learning. A prototype that costs more must justify its semantic gain; a prototype that is cheap but misses the crux still fails.

### Optimize after attribution

Cost is optimized by identifying the expensive stage:

- survey payload;
- inventory size;
- synthesis;
- exact-source hydration;
- critics;
- repairs.

Then optimize that stage without changing unrelated semantic behavior. Do not redesign the ontology merely because a transcript replay was expensive.

## Evaluation policy

Evaluation proceeds in two layers.

### Layer A — Architecture learning

Use visible development fixtures to answer:

- Did every partition produce a survey artifact?
- Did the inventory contain the crux and later article material?
- Did global synthesis recover material themes?
- Did exact-source hydration prevent unsupported paraphrase?
- Which critic found real defects?
- Which stage dominates cost?

Failures are allowed and studied. Prompt, schemas, and stage boundaries may change between explicitly versioned experiments.

### Layer B — Frozen acceptance

Once an architecture version is frozen:

- run sealed fixtures and required repeats;
- make no mid-run tuning;
- report all twelve CF6 dimensions;
- compare with CF5;
- inspect raw artifacts before accepting computed verdicts;
- require the blocking product gates;
- report cost and latency as measured tradeoffs.

The project should not spend blind-evaluation credibility on an architecture whose visible artifacts are still obviously wrong.

## Migration from the current implementation

### Preserve

- ArticleDocument normalization and exact source-unit access;
- semantic-core and compatibility schemas;
- MySQL state, events, idempotency, and immutable finalization;
- request-level usage accounting;
- domain validation and grounding checks;
- existing CF5 comparison path;
- current test fixtures and failure corpus;
- provider-neutral runtime boundary.

### Retire from architectural authority

- the single manager transcript as the working memory;
- the 33-region ledger as the primary semantic completeness test;
- the requirement that every stage be reachable through one seven-tool menu;
- the 45,000-token projection as a live-run authorization law;
- the idea that deterministic macro-orchestration makes the system non-agentic.

### Build next

1. Define the survey, inventory, synthesis, portfolio, and critic schemas.
2. Implement deterministic structural partitioning and a complete survey manifest.
3. Survey every F03 partition and inspect the inventory before building selection.
4. Implement global synthesis over the inventory.
5. Add exact-source hydration for every proposed selected claim.
6. Add focused critics, starting with crux/omission and verdictability.
7. Reuse bounded repair and immutable finalization.
8. Compare with CF5 only after freezing a version whose visible artifacts are credible.

## Initial experiment

The first experiment should answer one question:

> Can a complete grounded survey plus global synthesis recover F03’s central and later-region representations more reliably than the free-running manager?

It should not attempt to prove the entire production architecture.

Inputs:

- the actual F03 ArticleDocument;
- deterministic partitions covering all 404 source units;
- exact source text per partition.

Outputs:

- one survey artifact per partition;
- one combined semantic inventory;
- one global thesis/theme/candidate synthesis;
- cost by stage;
- a human-readable comparison with the accepted free-running manager package.

No final package promotion is required. If the inventory itself misses the crux, stop and repair the survey task. If the inventory contains the crux but synthesis drops it, repair synthesis. This stage attribution is the principal advantage of the architecture.

## Review decisions

Approval of this proposal would mean:

1. CF6 quality goals and grounding integrity remain firm.
2. Milestone 4C’s implementation constraints stop governing the architecture.
3. Deterministic macro-orchestration is explicitly permitted.
4. Grounded model-authored semantic artifacts are explicitly permitted.
5. Losslessness applies to persistence and provenance, not every prompt.
6. Keep 40,000 as a target; retire 45,000 as a live-experiment gate.
7. Complete article survey is infrastructure; semantic importance remains model-owned.
8. Build survey-and-synthesis next; stop compacting the current manager.

## Recommendation

Approve the reset as the working direction without declaring the staged design correct in advance. Build the smallest F03 survey-and-synthesis experiment, inspect its artifacts, and let evidence determine the next stage. Preserve the durable engineering already completed; stop optimizing one long manager conversation against constraints unrelated to output quality.

CF6 is not an elegant agent trace. It is the smallest complete, grounded, independently investigable representation of the content. Architecture should serve that outcome.
