# CF6 ClaimFoundry Manager Path

## Failure report and appended architecture recommendation

**Status:** Draft factual postmortem for review  
**Date:** 2026-07-28  
**Scope:** The CF6 work from the Agents SDK scaffold through the Milestone 4C context-economy and coverage repair. This report evaluates the manager path as an architecture, not the effort or intent of the people involved.

## Executive verdict

The CF6 manager path succeeded as an infrastructure and safety-boundary build. It failed as a ClaimFoundry architecture.

The work proved that VeriStrata can run an SDK-managed model/tool loop, constrain it to typed domain actions, persist consequential state in MySQL, enforce idempotency and immutability, record an auditable trajectory, and reload a canonical package. Those are durable assets.

The first real F03 run nevertheless produced the wrong product result:

- it inspected only 22 of 404 source units, or 5.4% of the article;
- it remained anchored to the opening material;
- it finalized three claims with no recorded dispositions;
- it used 135,817 input tokens and 140,080 total tokens over 11 model requests;
- it cost roughly 9.1 times the approximately 15,000-token prior processing baseline;
- it marked the run complete even though semantic grounding, atomicity, verdictability, attribution, and treatment remained unreviewed or unavailable.

The later Milestone 4C repair improved observability, schema exposure, persistence, and procedural coverage. Under the corrected relevance-neutral retention rules, however, the offline F03 projection still reached 62,360 input tokens against the milestone’s 45,000-token gate. No repaired live run was performed.

The failure is not that the implementation ignored its design. The implementation followed the design closely. The failure is that the governing design assigned autonomy, memory, coverage, and budget constraints to the wrong layers.

## Evidence snapshot

| Measure | Observed result |
|---|---|
| Live fixture | CF1-F03, “Public Health’s ‘Truth’ About Vaccines PART 1” |
| Model | `gpt-4.1-mini-2025-04-14` |
| Model requests | 11 |
| Consequential tool events | 10: 9 completed, 1 failed |
| Source units inspected | 22 of 404 |
| Article coverage | 5.4%; last inspected unit `U0022` |
| Selected claims | 3 |
| Dispositions | 0 |
| Validation reports | 1 |
| Repair operations | 0 |
| Input tokens | 135,817 |
| Output tokens | 4,263 |
| Total tokens | 140,080 |
| Wall time | 93.955 seconds SDK time; 93.974 seconds total |
| Prior comparison point | Approximately 15,000 tokens for comparable non-agentic processing |
| Token multiplier | Approximately 9.1× |
| Milestone 4C offline projection | 62,360 cumulative input tokens |
| Milestone 4C live gate | 45,000 input tokens |
| Repaired live F03 run | Not performed because the offline gate failed |

## What was built

### Milestone 1 — SDK runtime scaffold

The first milestone established:

- the OpenAI Agents SDK for TypeScript;
- a provider-neutral runtime boundary;
- environment validation;
- a harmless typed smoke tool;
- an SDK-managed model/tool/model loop;
- structured usage and runtime metadata;
- isolation from CF5 and production routes.

The live smoke result demonstrated a bounded typed tool call and successful completion. This was a valid proof that the selected SDK could execute the required control loop.

### Milestone 2 — Semantic state and domain tools

The second milestone created:

- the versioned `cf6.semanticCore.v1` package;
- typed ClaimFoundry run state;
- legal state transitions and bounded counters;
- inspected-unit and semantic-note state;
- working packages, validation reports, repair history, review state, and final-package identity;
- seven model-free domain tools:
  - `get_content_map`;
  - `read_source_units`;
  - `find_source_units`;
  - `save_working_package`;
  - `validate_working_package`;
  - `apply_package_patch`;
  - `finalize_claim_package`;
- strict source authorization and source-unit validation;
- allow-listed patch verbs rather than generic JSON patching;
- idempotent mutations and append-only event snapshots;
- immutable final-package hashes;
- typed abstention and review boundaries.

The tools correctly separated deterministic checks from semantic checks. The validator did not falsely claim that deterministic code could prove semantic grounding, atomicity, omission, treatment, attribution, polarity, or verdictability.

### Milestone 2B — Real MySQL durability

The MySQL work added and empirically tested:

- durable run-state storage;
- append-only tool-event storage;
- immutable final-package storage;
- later, append-only model-request accounting;
- foreign keys and uniqueness constraints;
- database triggers preventing update or deletion of audit events, final packages, and request records;
- transaction rollback;
- fresh-adapter reload;
- concurrency serialization;
- idempotent duplicate convergence;
- atomic terminal-state and final-package persistence.

This is one of the strongest parts of the build. The durability layer did what it was designed to do.

### Milestone 3 — One manager agent

The manager vertical slice added:

- one versioned ClaimFoundry manager instruction;
- dynamic run/content identity without article text in the instruction;
- all seven accepted tools;
- an SDK-managed multi-turn loop;
- structured terminal output;
- reconciliation with persisted terminal state;
- a fixture runner;
- artifact generation for package, validation, trajectory, usage, latency, trace identity, and review.

Application code did not hard-code an inspect → draft → validate → repair → finalize sequence. The model selected the tools.

The live F03 trajectory was:

1. get the content map;
2. read `U0001–U0015`;
3. save a one-claim package;
4. read `U0008–U0022`;
5. save an expanded package;
6. perform another bounded read;
7. attempt a save that failed;
8. save successfully;
9. validate;
10. finalize;
11. emit the terminal response.

This trajectory proved mechanical agency. It did not prove competent article-level extraction.

### Token-economics audit

The audit established that the high cost was not caused by reading the article. The manager inspected very little of the article.

The runner used client-managed full history. It did not use a session, `conversationId`, `previousResponseId`, or an input filter. The SDK resent the growing transcript on every request.

Repeated payload included:

- approximately 6,162 tool-schema tokens on every request;
- a 3,100-token content-map result;
- exact source-read results;
- four complete package-save arguments;
- prior assistant and tool protocol items.

The largest tool schemas were:

- `apply_package_patch`: approximately 3,604 tokens per request, never called;
- `save_working_package`: approximately 1,801 tokens per request.

Only the final request retained exact request-level details: 16,804 input tokens, including 16,512 cached and 292 uncached, with 184 output tokens. Raw responses and request usage for turns 1–10 had been discarded, so exact per-turn usage could not be recovered. The audit correctly recorded those values as unavailable rather than inventing them.

### Milestone 4C — Context and coverage repair

The repair work added:

- permanent per-request model accounting;
- persisted response/request IDs, cached and uncached usage, tools exposed, selected tool, payload estimates, and input hashes;
- append-only MySQL request records;
- a pre-request cumulative input budget;
- deterministic model-input filtering;
- state-dependent legal tool exposure;
- a shallow semantic-content save contract;
- compact model-facing mutation results;
- a deterministic 33-region article coverage ledger;
- `UNINSPECTED_MAJOR_REGION` as a hard procedural finding;
- finalization blocking for unexplained unseen regions;
- exact-source reread support;
- a narrow article-wide coverage instruction;
- an offline projection based on the actual F03 ArticleDocument and current schemas.

The repaired implementation passed its offline regression suite. It did not pass the product experiment gate: the corrected projection was 62,360 input tokens. No billable rerun was authorized.

## What worked and should be retained

### Authorization and provenance

The source boundary is strong. Tools accept only authorized source units, preserve order and exact IDs, reject foreign grounding, and retain source-manifest identity.

### Persistence and audit

The MySQL state/event/final-package/request design is reusable. It provides the right separation between domain artifacts and infrastructure logs, even though the manager later represented too much of that state to the model.

### Idempotency and immutability

Mutating operations are protected against duplicate replay. Final snapshots are hash-verifiable and database triggers prevent silent mutation or deletion.

### Honest deterministic validation

The validation contract explicitly labels checks as deterministic, heuristic, later semantic review, or unavailable. That honesty should remain. The failure came from allowing a structurally passing report to support semantic completion—not from the validator pretending it had run semantic checks.

### Bounded domain action space

The tools are safer and more intelligible than filesystem, SQL, shell, or generic patch access. The action vocabulary remains useful for a repair agent or operator workflow.

### Request observability

The permanent request accounting added after the first live run is necessary for every future architecture. It should remain independent of trace export.

### CF5 isolation

CF5 remained callable and unchanged. That preserved a comparison path and avoided turning an experiment into an irreversible migration.

## What failed

### 1. Article-level semantic coverage

The manager had access to the complete content map but read only the opening 22 units. It then inferred that three claims constituted a complete package.

This is the central product failure. ClaimFoundry’s purpose is the smallest complete representation of the content. A package cannot be called complete when 94.6% of the source units were never inspected and no semantic inventory or dispositions explain what was omitted.

The failure was not lack of source access. It was lack of reliable article survey.

### 2. Semantic completion was weaker than structural completion

The final validation report had `hardPass: true` because structural checks passed. The same report said:

- semantic grounding adequacy required later review;
- atomicity and independent verdictability required later review;
- material omission and treatment correctness were not run;
- attribution correctness and polarity required later review.

Despite that, the run finalized as `completed`.

This exposed a mismatch between two meanings of completion:

- “the package is structurally legal and persisted”; and
- “the package is substantively complete and ready for product use.”

The runtime enforced the first while the terminal language implied the second.

### 3. Token economics

The manager used 135,817 input tokens while inspecting 22 units and producing three claims. Output tokens were only 4,263. Necessary semantic reasoning was not the dominant cost.

The cost came from:

- full client-managed transcript replay;
- repeated tool schemas;
- retained content-map output;
- repeated exact source outputs;
- superseded complete package arguments;
- using one conversational context as both workbench and memory.

This was an action/state-boundary defect, not an unavoidable agency premium.

### 4. Agency was assigned to infrastructure decisions

The architecture treated “which legal tool should run next?” as the primary proof of intelligence. This gave the model control over whether later article regions were ever inspected.

The model should own semantic judgments: what a passage means, which representations are material, how themes relate, and how claims should be repaired.

The host should reliably schedule complete bounded survey, provide exact source, persist artifacts, and validate mechanics. Requiring the model to rediscover the need to read the article did not add valuable agency.

### 5. One manager carried incompatible cognitive roles

One context was responsible for:

- exploration;
- memory management;
- semantic extraction;
- thesis discovery;
- portfolio selection;
- self-criticism;
- repair planning;
- stopping.

Long-document recall, global synthesis, and focused criticism compete for context and attention. The opening-section anchoring was a predictable result.

### 6. Durable state and model-visible state remained coupled

The design correctly said that conversation history was not domain state. In practice, the free-running manager still needed a growing representation of domain state and recent source observations on every turn.

Milestone 4C replaced raw history with a typed projection, but strict relevance-neutral retention made the projection itself grow. Lossless persistence was implicitly turned into lossless prompt representation.

### 7. Tool schemas encoded too much of the architecture

The original seven-tool bundle cost approximately 6,162 tokens per request. The unused patch schema alone cost approximately 3,604.

Conditional exposure and shallow save contracts reduced this materially, but they were compensating for a deeper issue: one generic manager was being asked to receive every possible action schema throughout a heterogeneous task.

### 8. Procedural coverage was substituted for semantic coverage

The 33-region ledger is useful operational evidence. It can show which areas were touched, sampled, or excluded.

It cannot show that the model recovered the crux, distinguished challenged material, resolved themes, or found every material candidate. Region status is not a semantic inventory.

### 9. The repair constraints became self-defeating

The user correction rightly prohibited deterministic semantic relevance filtering. Under that rule, older unreferenced source text could not simply be discarded based on host judgment.

The current manager architecture therefore faced an avoidable conflict:

- retain enough unselected source evidence for future model judgment; or
- meet a strict cumulative prompt budget.

The architecture made those objectives compete inside one transcript. A staged artifact design removes the conflict by persisting grounded semantic work and constructing task-specific requests.

### 10. Mechanical milestone success created false confidence

The milestones intentionally focused first on scaffolding, safety, and a vertical slice. Their tests correctly established those properties.

The mistake was allowing “Milestones 1–3 passed” to sound like cumulative evidence that the architecture was becoming good at ClaimFoundry. It was cumulative evidence that the infrastructure was becoming reliable.

Semantic quality had not yet been demonstrated. The first live fixture showed that clearly.

## Root-cause analysis

### Primary cause

The primary cause was selecting a free-running, single-manager conversation as the unit of cognition for article-wide claim extraction.

### Contributing design assumptions

- A model-selected tool trajectory was treated as the defining feature of a real agent.
- Deterministic macro-orchestration was treated as evidence of a non-agentic pipeline.
- Complete reading was left to model initiative.
- Global semantic inventory was deferred in favor of incremental package mutation.
- One model context was expected to explore, remember, synthesize, criticize, and stop.
- Cost constraints were imposed before the architecture had demonstrated semantic quality.
- Structural finalization was allowed to use product-completion language.

### Contributing implementation defects

- Full client-managed history was replayed.
- Request-level usage was not permanently retained in the first live run.
- Large schemas were exposed on every request.
- Tool results returned more state than the next decision required.
- Complete packages were repeatedly transmitted.

The implementation defects explain much of the cost. They do not explain the semantic coverage failure by themselves. Even a cheaper version of the same manager could still stop after the opening section.

## Tests and what they proved

After Milestone 4C, the verified suite included:

- TypeScript agent typecheck: passed;
- manager/context/coverage tests: 15 of 15 passed;
- ClaimFoundry domain-tool tests: 11 of 11 passed;
- real MySQL durability tests: 8 of 8 passed;
- CF5 regression tests: 26 of 26 passed;
- relevant ArticleDocument and grounding tests: 37 of 37 passed;
- `git diff --check`: passed.

### What the suite proves

- schema integrity;
- authorization;
- state transitions;
- idempotency;
- patch restrictions;
- persistence;
- database immutability;
- request accounting;
- procedural coverage gates;
- conditional tool legality;
- regression isolation.

### What the suite does not prove

- crux recovery;
- material omission performance;
- independent verdictability;
- challenged-class treatment;
- semantic grounding adequacy;
- attribution correctness;
- package stability;
- superiority to CF5.

The test suite is valuable. Its scope must not be confused with semantic acceptance.

## Current disposition

### Preserve

- ArticleDocument and exact source-unit access;
- CF6 semantic-core and compatibility types;
- MySQL state, events, request records, triggers, and final packages;
- authorization, hashes, state transitions, and idempotency;
- request-level usage accounting;
- bounded repair operations;
- deterministic validators;
- fixture and report infrastructure;
- CF5 comparison path;
- provider-neutral runtime boundary.

### Stop treating as governing architecture

- the single free-running manager transcript;
- the requirement that all work occur through one seven-tool menu;
- model discretion over whether the whole article is surveyed;
- region status as the primary completeness measure;
- lossless active-prompt projection;
- the 45,000-token offline threshold as permission to run a semantic experiment;
- the idea that deterministic macro-workflow is inherently non-agentic.

### Do not claim

- that a repaired live F03 run passed;
- that exact per-turn usage for the original turns 1–10 is known;
- that CF6 passed its semantic acceptance rubric;
- that the current final package is complete;
- that the architecture reset is proven before its first survey-and-synthesis experiment.

## Appended recommendation — architecture reset

### Decision

Pause further optimization of the current manager loop. Preserve the durable engineering, but replace the manager path with a quality-first, artifact-centered ClaimFoundry.

### Recommended flow

> Authorized ArticleDocument → structural partitioning → complete bounded survey → grounded semantic inventory → global synthesis → exact-source hydration → focused critics → bounded repair → immutable canonical package

The macro-workflow may be deterministic. Semantic decisions remain model-owned.

### Constraint reset

### Keep hard

- authorized content only;
- exact grounding and provenance;
- no fabricated source material;
- idempotent and auditable mutation;
- immutable final packages;
- no repair corruption;
- explicit abstention and omission records;
- no external evidence search in ClaimFoundry.

### Promotion gates, not experiment blockers

- crux recovery;
- material omission;
- verdictability;
- challenged treatment;
- semantic grounding;
- repair effectiveness;
- repeat stability.

### Adjustable operating targets

- approximately 40,000 input tokens;
- latency;
- model-call count;
- schema size;
- repair count;
- cost per package.

### Release as design hypotheses

- one manager;
- seven tools;
- no deterministic macro-phases;
- no model-authored semantic inventory;
- lossless state in every prompt;
- one model/context for every cognitive task;
- no bounded parallel survey;
- the 45,000-token live-experiment gate.

### Context policy

The database is memory. A model request is a task-specific workbench.

Every call should receive:

- one semantic task;
- its typed output contract;
- the artifact rows required for that task;
- exact source text whenever wording or grounding is judged;
- active findings relevant to the object under review.

It should not receive the accumulated manager transcript or every durable state field.

Grounded semantic inventory and synthesis artifacts are permitted. They are model-authored work products, not host-authored relevance filters. Exact source remains durable and authoritative.

### First experiment

#### Experiment question

> Can complete grounded survey plus global synthesis recover F03’s crux and later-region representations more reliably than the free-running manager?

Build only:

1. deterministic F03 partitions covering all 404 source units;
2. one typed semantic survey artifact per partition;
3. one combined grounded inventory;
4. one global thesis/theme/candidate synthesis;
5. stage-level token, latency, and error accounting;
6. a human-readable comparison with the accepted manager output.

Do not require final package promotion in this experiment.

If the inventory misses the crux, repair the survey task. If the inventory contains the crux but synthesis drops it, repair synthesis. This stage attribution is the principal reason to change architectures.

### Budget policy

Estimate before spending and retain a configurable runaway ceiling. Do not allow an unvalidated offline approximation to veto the live experiment needed to measure semantic quality.

The approximately 40,000-token value remains an optimization target. A more expensive prototype must demonstrate a meaningful semantic gain and identify its expensive stage. A cheap prototype that misses the crux still fails.

### Final recommendation

Approve the reset as the working direction without declaring it correct in advance. Preserve the source, schema, persistence, audit, validation, and repair assets. Stop treating transcript compaction as the main path. Build the smallest complete-survey and global-synthesis experiment, inspect its artifacts, and let semantic quality determine whether to proceed.

Evaluate CF6 by the package it recovers, not by how convincingly its runtime resembles an autonomous conversation.
