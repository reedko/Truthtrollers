# CF1 Bounded Agent Runtime — Superseding Milestone

**Status:** Agent-runtime implementation gate passed on retained F01 artifacts.
Comparative quality, runtime, and fixture-wide activation gates remain open.

This document supersedes the earlier one-shot execution plan. The one-shot
structured LLM pipeline remains useful infrastructure and an explicit baseline,
but it is not Claim Foundry CF1.

## Governing completion definition

CF1 is agentic only when a run contains all of the following in order:

```text
prepare ArticleDocument and source blocks
→ orientation / argument map
→ initial raw claim work product
→ independent semantic critic
→ critic-derived revision plan
→ revised raw inventory and selectedEvaluationClaims
→ Phase 3 targets and Evidence Need Cards
→ deterministic verification
→ at most one allowlisted repair
→ final package and inspectable artifacts
```

CF1 does not search for evidence and does not call EvidenceRun.

## Implemented runtime

The default `runClaimFoundry` mode is `agent`. Normal execution makes one bounded
whole-article model request that exposes orientation, an initial claim inventory,
semantic criticism, drop/add revision decisions, and revised selected claims.
The runtime materializes those products into explicit state and an ordered trace.
`baseline` is the only name for the prior one-shot normal/long execution.

The semantic critic reports these failure types:

- missing central claims;
- weak thesis or pillar coverage;
- duplicate or fragmented claims;
- ungrounded claims;
- trivial over-selection;
- missing attribution;
- weak evidence targets;
- an unrepresentative selected portfolio.

Every critic finding type must cause an auditable drop or add. Rewording is
represented as drop-old plus add-new. Target construction receives only the
revised selected claims. IDs, excerpts, offsets, queries, routing, evidence roles,
match criteria, rejection rules, transforms, and diagnostics are host-owned.

## Inspectable artifacts

Each retained agent run writes:

- `article_orientation.json`
- `initial_claims.json`
- `critic_report.json`
- `revision_plan.json`
- `revised_claims.json`
- `targets.json`
- `verifier_report.json`
- `cf1_agent_trace.json`
- `final_cf1_package.json`

The final package diagnostics contain the ordered step trace and logical artifact
names. The returned run result contains the actual artifact paths.

## Completion evidence

Automated tests must prove stage order, critic production, post-critic revision,
raw/selected separation, selected-only target boundaries, absence of evidence
search, trace/artifact references, and explicit baseline labeling.

The decisive integration gate is stronger: a retained F01 model run must show an
initial selected portfolio, concrete critic findings, a corresponding revision
plan, and changed revised/final selected claims. Passing mechanics alone is not
enough. That gate passed at
`artifacts/claim-foundry/agent-runs/f01-one-call-v1q-final/cf1run_019f6082-5858-74e8-92d6-b436f3b77214/`.
The paid response used one transport attempt, 16,695 tokens, 37.579 seconds, and
no repair. The current host verification passed and produced eight final claims.
Human comparison and fixture-wide reliability remain unresolved.

## Scope boundaries

No live scrape activation, EvidenceRun, retrieval, UI, branch, commit, staging,
or unrelated refactor belongs to this milestone. Long-article agent quality is
not claimed by the initial F01 gate and must be evaluated separately.
