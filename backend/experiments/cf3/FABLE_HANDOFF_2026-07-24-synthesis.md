# CF3 handoff — the whole knot: attribution × stance × substance

**To:** Fable · **From:** CF3 impl (Claude) · **Date:** 2026-07-24
**Scope:** `backend/experiments/cf3/` only.
**Purpose:** one place that captures every failure mode from this session — solved, failed,
and "worked but broke something else" — and proposes a single architecture for the
deceptively simple task: **extract each claim with its attribution, stance, and substance.**

The recurring lesson: those three axes are not independent. Every fix to one has moved
another. The knot is the point.

> Full current prompts at the end (§7). Schemas: `cf3_discovery_v2` (two arrays),
> `cf3_argument_v2` (per MCT §6.2, `sourceUnitIds` inside source, `citedWorks` last).

---

## 1. The three axes, and why they fight

| axis | field(s) | what "correct" means |
|---|---|---|
| **substance** | `testableAssertion` | the checkable fact, attribution stripped |
| **attribution** | `assertionSource` | who *originates* the claim |
| **stance** | `thesisEffect`, `articleTreatment` | direction + how the article treats it |

They are generated **together, post-selection, in one argument call**, and they leak into
each other. The canonical example is the article's crux —
*"the CDC manipulated the MMR–autism data, revealed by whistleblower William Thompson"* —
which fails on all three axes for interacting reasons.

## 2. Failure-mode catalogue (this session)

| # | failure mode | axis | what we tried | result |
|---|---|---|---|---|
| F1 | source name fused into the assertion text | subst×attr | `CF3_SOURCE_FUSED` detector | **detect-only**; ships anyway |
| F2 | reporter captured instead of speaker (article, not Thompson) | attr | §4 prompt "originator, not whoever repeats/reports" | partial; still fails on hearsay rows |
| F3 | treatment collapsed to all-`reported` | stance | two-array discovery + treatment decoupling sentence | **solved** (mix restored, stable over 3 runs) |
| F4 | discovery de-attribution clause suppressed the whole Thompson cluster | subst | reverted discovery `assertions` branch to "checked as written" | **solved** (inventory 95→135, cluster returns) |
| F5 | `testableAssertion` echoes inventory verbatim | subst | `CF3_ASSERTION_VERBATIM_COPY` detector; `testableAssertion` renamed as a fresh field | mostly solved (echo ~1/12) |
| F6 | `article_voice` name came back as the literal `"article_voice"` | attr | §4 byline clause ("use the byline as the name") | **solved** (0/12 degenerate) |
| F7 | source degeneracy collapse (10/12) on one run | attr | — (byline fix landed after) | variance; byline fix owns the real cure |
| F8 | dropped `sourceUnitIds`+`citedWorks` to lighten the call | attr | schema/prompt/host removal | **no effect on target**; restored per §6.2 (MCT log) |
| F9 | `testableAssertion` REGRESSES to the wrapped form on the whistleblower sentence | subst×attr | §1a "stated as the underlying fact…" wording | **failed**; A023 ships "Thompson revealed that…"; both detectors fire, observation-only |
| F10 | subject-as-source: "the CDC committed fraud" → source=`CDC` | attr | — (new, undocumented) | **open**; accused entity ≠ source |
| F11 | crux not selected / selection buries the load-bearing claim | selection | **Option A** (dependency-first) | **failed for its purpose**: specific crux 0/4 vs balanced 2/5; +1.5 recall side-effect; worsened front-loading |
| F12 | selection front-loads — quarters empty despite candidates | selection | — (new, undocumented) | **open**; candidates 36/20/35/47, selected 12/0/0/0; Option A makes it worse |

## 3. The interaction web (why fixes broke things)

- **De-attribution has no safe layer.** At **discovery** it suppresses reported-statement
  content (F4 — lost the whole crux cluster). At the **argument call** it's inconsistent
  and, crucially, happens **after selection** (F9) — too late to help the crux get
  chosen. So the one transformation that would make the crux selectable can't live where
  it would help.
- **The hearsay framing that makes the crux the crux is what buries it.** Selection scores
  *"someone revealed that X"* lower on "worth verifying with external evidence" than the
  bare fact — so the most important claim is penalized *for being important enough to be
  attributed to a whistleblower* (F11).
- **Attribution instructions bleed into stance.** Source-field emphasis pushed treatment
  toward `reported` (F3, the §8.4 mechanism). Fixed by decoupling — but that coupling is
  latent and will return with any source-side change.
- **Source placement is a bind.** §8.4 puts `assertionSource` *after* stance to stop
  source contaminating stance — but that lateness starves source (tail-field laziness),
  which is why gpt-5-mini (reasoning) resolves source far better than gpt-4.1-mini.
- **"Balanced" selection doesn't balance.** Front-loading (F12) is a selection defect
  independent of discovery; "dependency-first" (F11) makes it worse by pulling to the
  article's front where the thesis is set up.
- **Detectors see everything and fix nothing.** F1/F5/F9 all fire `CF3_*` findings that
  correctly localize the defect — then ship it. We are detecting and not repairing.

## 4. What actually holds (keep these)

- Two-array discovery census (F3/F4): treatment mix + opponent capture, stable.
- `article_voice`→byline (F6): source names clean.
- Host-derived `scoreTransform`, host grounding join, host-filled `sourceUnitIds`.
- The `CF3_*` detectors — as **triggers for deterministic repair** (they localize precisely).
- Best config: gpt-4.1-mini, balanced, byline — see `BEST_RUN.md`.

## 5. Proposed all-encompassing solution — decompose once, at the right layer

The through-line of every failure is that **substance, attribution, and stance are tangled
in one text and one pass.** Untangle them deterministically, in this order:

1. **Discovery — capture FRAMED, never de-attribute.** (F4 is decisive.) Keep the raw
   "X revealed that Y." Candidates already span all quarters — discovery is not the
   problem.

2. **Host decomposition pass (NEW, deterministic, pre-selection).** For each inventory
   assertion, use the *already-firing* reporting-frame detectors to split:
   - `substance` = the object clause after the frame ("…that **Y**" → **Y**),
   - `attributionHint` = the frame's subject (X).
   This is syntactic surgery on the "X [reporting verb] (privately )?that Y" pattern —
   the exact pattern `CF3_REPORTING_RESIDUE` matches. Verified feasible on A023/A011.
   Where there's no frame, `substance` = text. **This repairs F1, F5, F9 mechanically**
   (no model, no extra call — you rejected extra calls) and gives selection a clean fact.

3. **Selection operates on `substance`, with a coverage constraint.** Feed the argument
   call the de-attributed `substance` — so the crux presents as a bare fact, not hearsay,
   removing the verifiability penalty (F11's root). Add a deterministic **coverage
   quota** (≥1 pick per quarter / per major branch) enforced by the host, killing
   front-loading (F12). Drop "dependency-first" — it backfired.

4. **Attribution as its own resolution, with two explicit rules.** `assertionSource`
   still model-judged, but the prompt must name **both** confusions:
   - reporter ≠ speaker (F2 — already present),
   - **subject/accused ≠ source** (F10 — NEW): "the party a claim accuses or describes is
     not its source; a claim that an institution did wrong is sourced to whoever alleges
     it, not the institution." Plus: cluster claims sharing one originator (the whole
     CDC-fraud branch → Thompson) should resolve to that originator, not the salient noun
     in each sentence.
   `attributionHint` from step 2 seeds this; article_voice→byline stays.

5. **Stance judged on `substance`, decoupled from source.** `thesisEffect`/
   `articleTreatment` on the clean fact vs `stanceAnchor`, keeping the decoupling
   sentence (F3) so treatment doesn't recollapse to `reported`.

6. **Host derives `scoreTransform`, joins grounding, records fingerprints** (unchanged).

### Why this resolves the knot
- Substance is de-attributed **deterministically** and **before selection** — the only
  place that is simultaneously safe (no discovery suppression) and useful (helps the crux
  get picked). Model reliability on de-attribution stops mattering.
- Attribution gets the two rules it's missing (reporter≠speaker, subject≠source) and a
  seed (`attributionHint`), instead of grabbing the salient noun.
- Stance sees clean substance, so it neither fuses nor collapses.
- Selection sees clean substance + a coverage floor, so the crux isn't penalized as
  hearsay and no quarter is starved.

## 6. Open risks / what's unproven
- The deterministic frame-strip must not mangle non-"that" frames ("according to X, Y";
  appositives). Needs a conservative pattern + a `CF3_DEATTRIB_UNCERTAIN` finding that
  leaves the text untouched rather than guessing.
- Coverage quota vs. genuinely empty quarters (some articles front-load real substance):
  quota should be "≥1 *if a viable candidate exists*," measured against a gold key.
- Subject≠source is semantic; the rule helps but won't be perfect — measure against the
  F03 gold key (sealed) with a **tightened crux matcher** (require `Thompson|whistleblower`),
  which is a sealed-v2 decision.
- Reasoning-model dependence: source quality is markedly better on gpt-5-mini; decomposing
  substance out may narrow that gap for gpt-4.1-mini (fast arm) — to be measured.

## 7. Full current prompts (verbatim)

### Discovery SYSTEM
```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
text disputes into the text's rebuttal of it.
```

### Discovery USER
```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

[{{U…}}] {{chunk text}}

TASK

First, in challengedAssertions, return the assertions this section presents in
order to dispute — each stated as its original source made it. Return an empty
array only if the section disputes nothing.

Then, in assertions, return every other factual assertion in this section that
external evidence could verify — each worded so it can be checked as written,
with the source units that state it.
```

### Argument SYSTEM
```text
You map the factual argument of an article and select the assertions most worth
verifying with external evidence.

Use only the supplied article, its source-unit identifiers, and the supplied
assertion inventory. Do not use outside knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
article disputes into the article's rebuttal of it.
```

### Argument USER (default selectionMode=balanced; "crux" variant is the shelved Option A)
```text
ARTICLE METADATA

Title: {{TITLE}}
Author or byline: {{AUTHOR}}
Publication: {{PUB}}
Publication date: {{DATE}}

PORTFOLIO SIZE

Select exactly {{N}} assertions.

ARTICLE

[{{U…}}] {{article text}}

ASSERTION INVENTORY

{{INVENTORY_JSON}}

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly {{N}} inventory IDs that together
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

citedWorks — studies, documents, laws, or researchers the article ties to this
assertion, if any.

4. argumentBranches — for each branch ID used, the factual question it represents.
```
