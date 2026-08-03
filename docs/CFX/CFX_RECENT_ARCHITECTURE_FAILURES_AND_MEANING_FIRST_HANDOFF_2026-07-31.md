# ClaimFoundry Recent Architecture History and Current CFX Direction

**Purpose:** Fast handoff for a new chat
**Date:** 2026-07-31
**Current governing architecture:** CFX
**Status:** Working summary of recent failed approaches and the simpler meaning-first baseline that outperformed them

---

## 1. Product objective

ClaimFoundry should take an article and produce a compact set of grounded, independently investigable propositions representing the article’s substantive case.

The target is not every factual sentence. The useful output is closer to an investigative portfolio:

- central externally testable assertions;
- factual pillars and mechanisms carrying the argument;
- material qualifications or contradictions;
- consequential claims the article adopts, challenges, or relies upon;
- propositions whose support or refutation would materially strengthen or weaken the article.

EvidenceRun is the downstream consumer.

---

## 2. Durable lessons

### Reporting events and substantive assertions differ

“William Thompson said CDC data were manipulated” contains at least two possible verification targets:

1. whether Thompson made the statement;
2. whether CDC data were manipulated.

Flattening those into one claim and source repeatedly caused attribution, stance, and verification-target errors.

### Atomicity is evidential, not grammatical

A proposition is acceptably atomic when it can receive one meaningful evidence verdict. Mechanical conjunction splitting can destroy the relationship the article asks the reader to believe.

### Coverage and selection are different

A large inventory can show that the system encountered much of the article. It cannot prove that the final package preserves the article’s burden-bearing case.

### Validation cannot certify meaning

Code can validate IDs, enums, quotations, counts, JSON, and hashes. It cannot prove that the central claim was selected or the article’s meaning was preserved.

### Agenticity is not semantic intelligence

Tool use, persistence, repair loops, and legal state transitions can all work while the claim package remains semantically weak.

---

## 3. Recent architectures

## 3.1 CF4: deterministic stance-driven selection

CF4 derived stance assertions, mapped them to article structure, and selected from a candidate inventory.

It failed because the stance layer expanded rather than compressed the article. Selection recreated the original semantic problem:

> To know which claims match the thesis, the system already has to understand the thesis and claims correctly.

Observed problems:

- proliferating stance assertions;
- central claims omitted or broadened;
- unstable source and treatment;
- deterministic rules unable to decide portfolio relevance reliably.

**Decision:** abandon CF4.

---

## 3.2 CF5: minimal one-call package

CF5 stripped away most machinery:

```text
one generation call
→ deterministic validation
→ optional one repair call
→ persist artifacts
```

Approximate contract:

```json
{
  "claimId": "...",
  "claim": "...",
  "grounding": "...",
  "articleTreatment": "...",
  "provenance": "..."
}
```

It improved execution simplicity, stability, and cost. But one call still had to perform article understanding, selection, exact grounding, attribution, treatment, formulation, and schema completion simultaneously.

**Lesson:** the simple call was promising, but meaning discovery and grounding should not necessarily be fused.

---

## 3.3 CF6: manager-agent architecture

CF6 built a genuine tool-using agent with:

- SDK-managed multi-turn execution;
- persisted state;
- source-inspection tools;
- working-package updates;
- validation and bounded patching;
- repair budgets;
- finalization;
- tracing and accounting.

### What worked

- tools and state transitions;
- MySQL durability;
- source authorization;
- token and budget tracking;
- full-article initial context;
- provider caching;
- package inspection and diagnostics.

### What failed

The early vertical slice produced a thin three-claim portfolio, overrepresented early material, omitted major later claims, and confused an advertisement’s existence with its substantive assertions.

A whole-article reset fixed under-reading. The F03 agent then captured major early, middle, and late semantic axes, including:

- public-health advertising claims;
- alleged SIDS history;
- aluminum exposure;
- thimerosal toxicity;
- alleged CDC manipulation of vaccine-safety evidence;
- schedule growth without adequate combined-effects testing.

But after inspection the model exited with ordinary text rather than a legal terminal tool call:

```text
NON_TERMINAL_AGENT_EXIT
```

It still faced 23 region dispositions and one thesis disposition.

**Conclusion:** CF6 worked as agent engineering but did not reliably improve semantic selection. The loop added bookkeeping and terminal-control failure surfaces.

**Decision:** do not extend CF6 as the primary semantic architecture.

---

## 3.4 CF7: coverage-first pipeline

CF7 rejected the manager loop and proposed:

```text
article
→ chunks
→ local claims
→ atomicity
→ deduplication
→ thesis/subthesis derivation
→ claim-to-thesis mapping
→ supplier and treatment
→ final selection
→ deterministic assembly
```

The theory was to extract broadly first and select from a complete inventory.

The problem was that it again destroyed the intact article before asking for its meaning. It risked or produced:

- hundreds of assertions;
- over-decomposition;
- duplicate inventories;
- grouping and selection burden;
- thesis reconstruction from fragments;
- attribution and treatment flips;
- large prompt and token surfaces.

**Conclusion:** coverage-first solved the wrong first problem. It created a meaning-reconstruction task that did not exist while the article was whole.

---

## 4. The simple burden-of-proof baseline

A much simpler whole-article experiment produced the strongest recent result.

### Exact prompt

```text
Read the article.

Return the 12 propositions that carry the burden of proof for the article.

These are the assertions that, if shown false, would most undermine the article's overall argument.

For each provide:

- Assertion
- Assertion source
- Why it matters to the article's thesis
```

Governed prompt file:

```text
backend/src/claimfoundry/cfx/prompts/burden-of-proof-v1.json
```

### Run result

- Fixture: `CF1-F03`
- Article length: `51,132 characters`
- Model: `gpt-4o-mini-2024-07-18`
- Temperature: `0.1`

| Metric | Result |
|---|---:|
| Model requests | 1 |
| Retries | 0 |
| Propositions | 12 |
| Input tokens | 10,651 |
| Output tokens | 737 |
| Latency | 14.07 seconds |
| Schema defects | 0 |

The result recovered a coherent article-wide argumentative backbone without:

- chunking;
- candidate harvesting;
- semantic inventories;
- grouping;
- centroids;
- stance layers;
- selector passes;
- agent loops;
- repair loops;
- region dispositions;
- article-meaning reconstruction.

Examples included claims about:

- the education and scientific literacy of parents who do not vaccinate;
- numbers of incompletely vaccinated children;
- alleged absence of credible studies connecting vaccination to chronic disease;
- comparative vaccine testing;
- ethylmercury safety;
- aluminum exposure;
- alleged CDC manipulation of MMR-autism data.

The important result was not perfection. It was that one short prompt recovered the burden-bearing structure more coherently and cheaply than recent procedural and agent architectures.

---

## 5. What the baseline did not solve

Its main weakness was exact source precision.

Only one of the twelve returned source strings was an exact article substring.

This is now treated as a grounding defect after successful semantic discovery, not evidence that discovery should start from fragments.

That produced the governing principle:

> Discover meaning while the whole article is visible. Ground and normalize afterward.

---

## 6. Current architecture: CFX

CFX is the final governing architecture name.

```text
S0 — freeze the complete article and request
S1 — whole-article burden-of-proof discovery
S2 — attach exact article grounding
S3 — derive narrower evidence targets only when needed
S4 — publish a compact review package
```

### S1

The complete article is visible in one request. The model returns exactly twelve canonical burden-bearing propositions. Those propositions remain unchanged.

### S2

S2 should attach exact source passages and stable unit IDs without rewriting propositions.

Planned statuses:

```text
grounded_direct
grounded_distributed
grounded_attributed
partial
ambiguous
unsupported
```

Two configurations were proposed:

1. one whole-article grounding call for all twelve propositions;
2. one independent full-article grounding call per proposition.

### Latest result

The first S2 implementation failed across all propositions.

The common cause has not yet been diagnosed.

Do not assume twelve independent semantic failures. Likely shared causes include:

- exact-substring validation against normalized text;
- model paraphrase in `verbatimEvidence`;
- whitespace or quotation-mark normalization;
- unit-boundary handling;
- schema/status inconsistency;
- malformed structured output;
- mismatch between the model-visible article and validator-visible source text.

The next task is failure forensics, not twelve separate repairs.

---

## 7. Current hypothesis

The project repeatedly asked models to execute procedural pseudo-algorithms:

```text
infer theme
→ infer thesis
→ create pillars
→ generate candidates
→ classify stance
→ assign supplier
→ determine treatment
→ score materiality
→ select
→ ground
→ repair
→ finalize
```

This may encourage schema completion rather than better semantic judgment.

The burden-of-proof prompt asks directly for the desired judgment.

> Modern language models may already possess enough discourse competence to identify load-bearing propositions directly. Elaborate decomposition can consume context, multiply failure surfaces, and force the system to reconstruct meaning that was available in the intact article.

Engineering rule:

> Use prompts to request semantic judgments. Use deterministic code to enforce mechanics. Do not ask code to simulate article understanding, and do not burden the model with unnecessary procedural ceremony.

---

## 8. Immediate next step

Inspect the failed S2 artifacts:

```text
report.html
results_report.md
grounding_inventory.json
raw provider response
parsed response
validation diagnostics
exact model-visible source-unit projection
```

First answer:

> Did the model find the right passages but fail the mechanical contract, or did it fail to identify grounding?

Do not yet add:

- another agent;
- semantic repair loops;
- article maps;
- chunk fallback;
- retrieval prefilters;
- new claim generation;
- proposition rewriting;
- fixture-specific hacks.

---

## 9. One-paragraph handoff

ClaimFoundry recently moved through deterministic stance selection, a minimal one-call package, a full manager-agent architecture, and a coverage-first chunk pipeline. Each added structure and auditability, but none reliably solved article-level burden selection. The agent architecture worked mechanically while remaining semantically weak and introduced terminal-control bureaucracy. A one-request whole-article prompt then returned twelve coherent burden-bearing propositions from the 51,132-character F03 article in 14.07 seconds, using 10,651 input tokens and 737 output tokens with no retries or schema defects. Its weakness was exact source grounding, so CFX separates meaning discovery from grounding: S1 freezes the twelve propositions as canonical meaning, and S2 attaches exact article evidence without rewriting them. The first S2 implementation failed across all propositions. The immediate task is to determine whether this was one shared mechanical validation failure or a genuine semantic grounding failure.

---

## 10. Files for the next chat

```text
CFX_MEANING_FIRST_BUILD_PLAN_R0_2026-07-30.md
burden-of-proof-v1.json
CFX_S2_EXACT_GROUNDING_SPEC_R0_2026-07-31.md
S2 report.html
S2 results_report.md
S2 grounding_inventory.json
S2 raw response and validation diagnostics
```

Historical context only when needed:

```text
CF6_REAL_AGENT_BUILD_MCT_2026-07-27.docx
CF7_COVERAGE_FIRST_FINAL_BUILD_SPEC.md
CLAIMFOUNDRY_AI_PROMPT_AGENT_EXPERIMENTS_INFORMATIONAL.md
```
