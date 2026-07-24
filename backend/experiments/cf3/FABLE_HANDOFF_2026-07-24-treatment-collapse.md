# CF3 handoff — F03 combined-revision run: source fix worked, treatment + opposition collapsed

**To:** Fable · **From:** CF3 implementation (Claude) · **Date:** 2026-07-24
**Scope:** `backend/experiments/cf3/` only. No change to CF1, production, evidence, CF2.
**Run:** `artifacts/claim-foundry/cf3/cf1-f03-20260724-012618` (§1a + §4 + lint, one run).
**For Fable to process:** the attribution fix landed, but the same change set coincides
with a portfolio-wide collapse of `articleTreatment` to `reported` and disappearance of
all opposition. Reed's hypothesis: §1a and §4 embody a contradiction. My analysis
below supports a §8.4-class coupling, with one important confound isolated.

---

## 1. The prompts under test (full verbatim)

Model-facing word is **assertion** throughout (terminology lint enforces it). `{{…}}` =
host-injected slot. Schemas are unchanged from `FABLE_HANDOFF_2026-07-24-attribution.md`
§1 (`cf3_discovery_v1`, `cf3_argument_v1`) — not repeated here.

### 1.1 Discovery call (per chunk) — GPT-4o-mini, Chat, temp 0.2 — UNCHANGED this round

**SYSTEM**

```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Return every assertion in its original polarity. When the text introduces an
assertion in order to dispute it, preserve the assertion as the original source
stated it — not as the text's rebuttal.
```

**USER**

```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

[{{U…}}] {{chunk source-unit text}}

TASK

First, find any assertions this section presents in order to dispute them. Mark
these challenged: true and state them as their original source made them.

Then return every factual assertion in this section that external evidence could
verify — each worded so it can be checked as written, with the source units that
state it.
```

**SCHEMA** (`cf3_discovery_v1`, strict). `maxItems: 60` = transport brake (never in
prose); `maxItems: 8` on groundingUnitIds = runaway-ID brake.

```json
{
  "name": "cf3_discovery_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["assertions"],
    "properties": {
      "assertions": {
        "type": "array",
        "maxItems": 60,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["assertionText", "groundingUnitIds", "challenged"],
          "properties": {
            "assertionText": { "type": "string" },
            "groundingUnitIds": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 8 },
            "challenged": { "type": "boolean" }
          }
        }
      }
    }
  }
}
```

### 1.2 Argument call (one batch) — GPT-4.1-mini, Responses, reasoningEffort none

**SYSTEM**

```text
You map the factual argument of an article and select the assertions most worth
verifying with external evidence.

Use only the supplied article, its source-unit identifiers, and the supplied
assertion inventory. Do not use outside knowledge. Do not fact-check.

Return every assertion in its original polarity. When the article introduces an
assertion in order to dispute it, preserve the assertion as the original source
stated it — not as the article's rebuttal.
```

**USER** — the two lines under test are marked `◀ §1a` and `◀ §4`.

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

[ { "assertionId": "{{A…}}", "assertionText": "{{inventory assertion}}",
    "groundingUnitIds": ["{{U…}}"], "challenged": false } ]

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} inventory IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion:

assertionText — the assertion external evidence would test, stated without its      ◀ §1a
attribution. Who supplies it belongs in assertionSource.                            ◀ §1a

thesisEffect — assume the assertion is true. If that makes the stanceAnchor more
credible, strengthens; less credible, weakens; neither, no_effect. Ignore the
assertion's source, tone, and whether it seems true.

articleTreatment — the article adopts this assertion, challenges it, or reports it.

assertionSource — the originator of the assertion, not whoever repeats or reports   ◀ §4
it. Match kind to the named entity; a named ad, report, or document is not          ◀ §4
article_voice. Use article_voice only when the article's own narrator originates    ◀ §4
the assertion. A work cited as evidence for an assertion is not automatically its   ◀ §4
source. Use unknown rather than guess.                                             ◀ §4

argumentBranchId — the distinct part of the argument this assertion belongs to.

citedWorks — studies, documents, laws, or researchers the article ties to this
assertion, if any.

4. argumentBranches — for each branch ID used, the factual question it represents.
```

**SCHEMA** (`cf3_argument_v1`, strict). Property order carries stance-before-source
(§8.4): thesisEffect and articleTreatment precede assertionSource.

```json
{
  "name": "cf3_argument_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["stanceAnchor", "selectedAssertionIds", "selectedAssertions", "argumentBranches"],
    "properties": {
      "stanceAnchor": { "type": "string" },
      "selectedAssertionIds": { "type": "array", "items": { "type": "string" } },
      "selectedAssertions": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["assertionId", "assertionText", "thesisEffect", "articleTreatment", "assertionSource", "argumentBranchId", "citedWorks"],
          "properties": {
            "assertionId": { "type": "string" },
            "assertionText": { "type": "string" },
            "thesisEffect": { "type": "string", "enum": ["strengthens", "weakens", "no_effect"] },
            "articleTreatment": { "type": "string", "enum": ["adopted", "challenged", "reported"] },
            "assertionSource": {
              "type": "object",
              "additionalProperties": false,
              "required": ["name", "kind", "sourceUnitIds"],
              "properties": {
                "name": { "type": "string" },
                "kind": { "type": "string", "enum": ["article_voice", "person", "institution", "study", "document", "unknown"] },
                "sourceUnitIds": { "type": "array", "items": { "type": "string" } }
              }
            },
            "argumentBranchId": { "type": "string" },
            "citedWorks": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["name", "type", "sourceUnitIds"],
                "properties": {
                  "name": { "type": "string" },
                  "type": { "type": "string", "enum": ["study", "dataset", "report", "law", "document", "researcher"] },
                  "sourceUnitIds": { "type": "array", "items": { "type": "string" } }
                }
              }
            }
          }
        }
      },
      "argumentBranches": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["branchId", "branchQuestion"],
          "properties": {
            "branchId": { "type": "string" },
            "branchQuestion": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

## 2. Three-run comparison (F03, unseeded, temp 0.2 discovery)

| run | argument `assertionText` line | §4 | inv | invChallenged (discovery) | articleTreatment | thesisEffect |
|---|---|---|---|---|---|---|
| **004208** | "the assertion itself, checkable as written" | no | 119 | **3** | adopted 9 / challenged 2 / reported 1 | strengthens 7 / **weakens 4** / no_effect 1 |
| 011253 *(tainted: "proposition")* | "the **proposition** … without its attribution" | no | 96 | **0** | **reported 12** | strengthens 11 / weakens 1 |
| **012618** *(this run)* | "the **assertion** … without its attribution" | **yes** | 136 | **0** | **reported 12** | **strengthens 12** |

---

## 3. What worked — §4 (source identity + kind)

Decisive improvement in the source dimension. A009's source moved from
`author Ana Wolpin / article_voice` → **`William Thompson / person`**. Portfolio-wide,
kinds now match named entities: person (Thompson, Neil Z. Miller), document (1986
National Childhood Vaccine Act), study (2011 study), institution (Physicians for
Informed Consent, CDC). No "named ad tagged article_voice." Keep §4's identity/kind win.

---

## 4. What broke

### 4a. §1a did not strip A009 — the model echoed the inventory text verbatim

Not a host bug. The **argument model's own raw output** for A009 is byte-identical to
the discovery inventory text (`model==inventory: true`; `host-final==model: true`):

```
assertionText (model output):
  "Senior CDC scientist turned whistleblower William Thompson revealed privately in
   2014 that data linking the MMR vaccine (measles/mumps/rubella) to autism had been
   manipulated by the agency ten years earlier."
assertionSource (model output): { "name": "William Thompson", "kind": "person" }
```

The model treated attribution as **additive** (also name Thompson in `assertionSource`)
instead of a **move** (remove him from `assertionText`). It parked the source correctly
and left the frame in the text. Detectors now both fire correctly: `CF3_SOURCE_FUSED`
(William) and `CF3_REPORTING_RESIDUE` (revealed).

Why: the argument call is **copying the inventory `assertionText`** it is handed rather
than rewriting it. §1a states a goal ("without its attribution") but never instructs a
rewrite/transform; with the framed sentence present in the input JSON, the model echoes
it. The original prompt Fable trimmed carried the operational verb ("with reporting
frames removed"; "Remove 'X said' / 'according to X'"); v1 dropped it.

### 4b. articleTreatment collapsed to all-`reported`

`adopted 9 → 0`; all 12 rows `reported`. For an article that plainly *adopts* its
anti-vaccine assertions and *challenges* the JCPH ad, "all reported" is mislabeling. It
also zeroes the thesisEffect minority classes (weakens/no_effect = 0), a §7 stop/go
dimension.

### 4c. Opposition disappeared entirely

`invChallenged 3 → 0` (discovery flagged **no** opposition), `challenged` treatment = 0,
no JCPH-ad rows selected, `CF3_CHALLENGED_DROPPED` did not even fire (nothing was flagged
to drop). On the opponent-heavy canary, the portfolio contains zero opposition.

---

## 5. Analysis — Reed's contradiction hypothesis, and the confound

**Reed's hypothesis:** §1a and §4 embody a contradiction that changed the response in
unintended ways.

**Supported, as a §8.4-class coupling.** The signature is `adopted → reported`. §1a
introduces a supplier/reporter frame ("**who supplies it** belongs in assertionSource"),
and §4 sharpens it ("the originator, **not whoever repeats or reports it**"). Both push
the model to read every assertion as *something an external source supplied and the
article reports* — which collapses `articleTreatment` onto `reported` even where the
article adopts or challenges. That is precisely the §8.4 finding (source-field
instructions shifting the stance judgment), reappearing at the treatment level. The
run-level evidence fits: the mixed→collapsed transition coincides exactly with the §1a
attribution rewrite (004208 mixed; both post-rewrite runs collapsed), and §4 compounds
the same frame.

**The confound I must flag: two of the three collapse symptoms are not attributable to
§1a/§4 at all.** `invChallenged` is a **discovery**-stage flag, and the discovery prompt
(§1.1) is byte-identical across all three runs. Its 3 → 0 → 0 drop is therefore
discovery variance / discovery-stage weakness, **not** the argument-prompt changes. So:

- **Discovery not reliably flagging opposition (3/0/0)** — independent discovery problem;
  the bigger long-run risk, orthogonal to attribution. Needs its own look.
- **Argument `adopted → reported` collapse** — tracks §1a, plausibly §8.4 coupling, but
  n=1 per condition and unseeded, and partly downstream of an inventory that arrived
  with zero challenged hints. Cannot be cleanly attributed without a controlled A/B.

---

## 6. What A009 should have been

```
assertionText:    "The CDC manipulated data showing a link between the MMR vaccine
                   and autism, around 2004."   (the object assertion; frame removed)
assertionSource:  { name: "William Thompson", kind: "person" }   ← already correct (§4)
articleTreatment: "adopted"                                       ← got "reported"
thesisEffect:     "strengthens"                                   ← plausibly right
```
The stored text also fuses two separately-checkable facts — (a) did Thompson say this in
2014, (b) was the data actually manipulated ~2004 — and carries unverifiable framing
("privately").

---

## 7. Open questions for Fable

1. **Is `adopted → reported` a §1a/§4 coupling or variance?** Cleanest test: seeded A/B
   on the argument call — one arm with §1a/§4, one with the pre-attribution
   `assertionText` line and the old `assertionSource` line — same inventory fixed as
   input. If treatment re-mixes when the attribution lines revert, the coupling is real.
2. **Make `assertionText` an explicit rewrite, not a goal?** e.g. "Rewrite the inventory
   assertion as the single fact external evidence would test, removing any 'X said /
   revealed / according to X' frame; the speaker goes only in assertionSource." Does an
   explicit transform verb restore stripping without re-triggering the coupling?
2b. **Does the reporter/originator frame need to be decoupled from treatment?** e.g. an
   explicit note that identifying an external originator does not make the treatment
   `reported`.
3. **Discovery challenged-detection reliability (3/0/0)** — separate track. Do we need
   the challenged-first scan strengthened, or seeded discovery, before any argument-call
   conclusions are trustworthy on the opponent canary?

I have not changed any prompt since this run. Proposed host addition available on your
word: a `CF3_ASSERTION_VERBATIM_COPY` finding when final `assertionText ===`
inventory text, so the echo failure mode (4a) is visible every run.
