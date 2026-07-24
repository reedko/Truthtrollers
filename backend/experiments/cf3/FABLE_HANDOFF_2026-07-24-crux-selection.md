# CF3 handoff — the missing axis: thesis-dependency (crux) selection

**To:** Fable · **From:** CF3 implementation (Claude) · **Date:** 2026-07-24
**Scope:** `backend/experiments/cf3/` only.
**Problem:** the single most thesis-load-bearing claim in F03 — "the CDC manipulated the
MMR–autism data (~2004)" — is reliably **in the candidate pool** but **not reliably
selected**. A human fact-checker picks it first; CF3 has no pathway to.

> Convention: full current prompts below, verbatim (schemas unchanged from the v2 spec:
> two-array `cf3_discovery_v2`; `cf3_argument_v2` minus `sourceUnitIds` and `citedWorks`).

---

## 1. Full current prompts

### 1.1 Discovery SYSTEM
```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
text disputes into the text's rebuttal of it.
```

### 1.2 Discovery USER
```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

[{{U…}}] {{chunk source-unit text}}

TASK

First, in challengedAssertions, return the assertions this section presents in
order to dispute — each stated as its original source made it. Return an empty
array only if the section disputes nothing.

Then, in assertions, return every other factual assertion in this section that
external evidence could verify — each worded so it can be checked as written,
with the source units that state it.
```

### 1.3 Argument SYSTEM
```text
You map the factual argument of an article and select the assertions most worth
verifying with external evidence.

Use only the supplied article, its source-unit identifiers, and the supplied
assertion inventory. Do not use outside knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
article disputes into the article's rebuttal of it.
```

### 1.4 Argument USER
```text
ARTICLE METADATA

Title: {{TITLE}}
Author or byline: {{AUTHOR}}
Publication: {{PUBLICATION}}
Publication date: {{DATE}}

PORTFOLIO SIZE

Select exactly {{PORTFOLIO_SIZE}} assertions.

ARTICLE

[{{U…}}] {{full-article source-unit text}}

ASSERTION INVENTORY

{{INVENTORY_JSON}}

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} inventory IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion:

testableAssertion — the assertion external evidence would test, stated as the
underlying fact rather than as a report that someone stated it.

thesisEffect — assume the assertion is true. If that makes the stanceAnchor more
credible, strengthens; less credible, weakens; neither, no_effect. Ignore the
assertion's source, tone, and whether it seems true.

articleTreatment — the article adopts this assertion, challenges it, or reports
it. An assertion with an external originator can still be adopted or challenged.

assertionSource — the originator of the assertion, not whoever repeats or reports
it. Match kind to the named entity; a named ad, report, or document is not
article_voice. Use article_voice only when the article's own narrator originates
the assertion, and in that case use the byline as the name. A work cited as
evidence for an assertion is not automatically its source. Use unknown rather
than guess.

argumentBranchId — the distinct part of the argument this assertion belongs to.

4. argumentBranches — for each branch ID used, the factual question it represents.
```

---

## 2. Evidence

Across F03 runs, the Thompson/CDC-manipulation cluster (U0037–U0044) is present in the
inventory (e.g. best 4.1 run: `A023 "William Thompson revealed privately in 2014 that
data … had been manipulated"`) but **not selected**. Selection instead takes a plainer
sibling from the same over-full branch (5-mini kept the fact via `A121 "the CDC massaged
the data and in 2003 released a reworked, fraudulent version"`; the 4.1 run kept only the
adjacent thimerosal claim and dropped the MMR-manipulation core entirely).

## 3. Why the crux loses — two stacked forces

1. **No centrality axis exists.** The only assertion↔thesis field is `thesisEffect`
   (`strengthens`/`weakens`/`no_effect`) — **direction, not magnitude**. "Aluminum occurs
   in soil" and "the CDC manipulated the MMR–autism data" are both `strengthens`; nothing
   says the second is the load-bearing beam. Centrality/materiality/verifiability were all
   deleted in synthesis §6 ("non-discriminative, §10.3").
2. **Selection optimizes the opposite.** The criterion is "the most complete and
   **balanced** basis." Balance caps the CDC-fraud branch to ~1–2 of 12 slots, so the crux
   competes with 8–11 siblings — and loses, because its "someone **revealed** X" framing
   scores lower on "worth **verifying with external evidence**" than the bare-fact
   siblings. The article's bombshell framing (a named whistleblower) is exactly what makes
   selection treat it as hearsay and route around it.

## 4. Why past attempts don't refute the idea

- **Keyword tagging** ("whistleblower") — brittle surface feature; correctly abandoned.
- **Numeric materiality (1–5)** — non-discriminative because models cluster self-scored
  importance at the top. This is **pointwise** scoring.

CF3's one proven mechanism is **comparative batch judgment** (Vector B beat pointwise
0/22). Centrality was only ever tried **pointwise**. It was never asked **comparatively**
— and the dependency seed already exists in the prompt: line 2 says include assertions
*"when its case depends on defeating them,"* but only for challenged items and never as a
first-class, rankable axis.

## 5. Proposal — a comparative thesis-dependency (crux) axis in selection

**Not** a per-item materiality number. A comparative, counterfactual judgment made the way
selection already works. Two forms, cheapest first:

**Option A — reframe the selection criterion (one call, no new fields).** Replace the
balance-only instruction with a dependency-first, then-balance instruction:

```text
2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} inventory IDs. First include the
few assertions the article's central position most depends on — the ones whose falsity
would most damage its argument, whoever states them and however they are framed. Then
fill the remaining slots for the most complete and balanced basis across the argument,
including assertions the article disputes when its case depends on defeating them.
```

**Option B — a `thesisDependency` rank as an emitted field** (per selected assertion:
`load_bearing` | `supporting` | `peripheral`), reported and used by the host to order the
portfolio. Categorical, not numeric — three buckets resist the 4–5 clustering that sank
the 1–5 score. Emit it **before** stance fields so it frames the selection, not after.

Recommendation: **A first** (it's the smallest change and directly targets "float the
crux"), measured against a gold key that lists the F03 must-selects (Thompson/CDC-
manipulation included). If A doesn't reliably promote the crux, B makes centrality an
explicit, inspectable output.

**Risk to watch:** dependency-first pushes against "balanced" and against the
verifiability preference — so it must be measured for *regression* (does the portfolio
lose branch coverage, or over-index on one dramatic claim?), not just for whether Thompson
appears. That regression check is the whole point of doing it comparatively and gated.

## 6. What this needs to be measurable

A gold key for F03 does not exist yet. Without it, "did the crux get selected" stays
anecdotal. Building the F03 must-select key (the ~12–15 claims a fact-checker must cover,
crux flagged) is the prerequisite for evaluating any version of §5 — and for finally
adjudicating "empty quarter: miss or justified?" from earlier.
