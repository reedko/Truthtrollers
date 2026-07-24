# CF3 handoff — argument-call attribution: full prompts, changes, findings

**To:** Fable · **From:** CF3 implementation (Claude) · **Date:** 2026-07-24
**Scope:** `backend/experiments/cf3/` only. No change to CF1, production, evidence, or CF2.
**Status:** Combined candidate revision (corrected §1a + §4 + terminology lint + two
detectors) — merged and green (12/12 tests). **Not yet run** against F03 as the single
coherent-revision run. Prior F03 runs are superseded (see §5).

> Convention: handoff docs include the **full current prompts verbatim**, not just
> diffs. Diffs across several revisions make the live prompt ambiguous.

---

## 1. Full current prompts (live in `prompts.js`)

`{{…}}` marks host-injected slots. Model-facing word is **assertion** throughout
(enforced by the terminology lint, §4-tests).

### 1.1 Discovery call (per chunk) — GPT-4o-mini, Chat Completions, temp 0.2

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

**USER**

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

[
  {
    "assertionId": "{{A…}}",
    "assertionText": "{{inventory assertion}}",
    "groundingUnitIds": ["{{U…}}"],
    "challenged": false
  }
]

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} inventory IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion:

assertionText — the assertion external evidence would test, stated without its
attribution. Who supplies it belongs in assertionSource.

thesisEffect — assume the assertion is true. If that makes the stanceAnchor more
credible, strengthens; less credible, weakens; neither, no_effect. Ignore the
assertion's source, tone, and whether it seems true.

articleTreatment — the article adopts this assertion, challenges it, or reports it.

assertionSource — the originator of the assertion, not whoever repeats or reports
it. Match kind to the named entity; a named ad, report, or document is not
article_voice. Use article_voice only when the article's own narrator originates
the assertion. A work cited as evidence for an assertion is not automatically its
source. Use unknown rather than guess.

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

## 2. What changed since the prior handoff

1. **§4 `assertionSource` line — applied** (terminology-corrected: "assertion" not
   "claim"). Targets A009's reporter-capture and the five JCPH `article_voice` tags.
   Full text is live in §1.2 above.
2. **§1a `assertionText` line — corrected** `proposition → assertion` (3rd instance of
   the known-degrading-term miss; it had merged live and tainted a run — see §5).
3. **Reporting-verb residue detector** added (host, observation-only): `CF3_REPORTING_RESIDUE`.
4. **Terminology lint** added to the test suite (§4).

Note on §4 wording: the replacement drops the prior "and the units that show it"
clause; `sourceUnitIds` remains schema-required, so units are still emitted, but the
prose no longer guides them. Flagging in case you want a units cue restored.

## 3. Finding taxonomy (all non-blocking, rendered in report Findings)

| Finding | Trigger | Purpose |
|---|---|---|
| `CF3_SOURCE_FUSED` | distinctive token of `assertionSource.name` appears in `assertionText` | catches correctly-sourced-but-fused text |
| `CF3_REPORTING_RESIDUE` | reporting verb ("revealed", "according to", …) in `assertionText` | complement of fusion detector; catches residue **even when the source field is wrong** (A009's case) |
| `CF3_CHALLENGED_DROPPED` | inventory `challenged:true` not in portfolio | opponent retention |
| `CF3_POLARITY_FLIP_SUSPECTED` | negation-parity mismatch inventory vs final | polarity guard |
| `CF3_BRANCH_CONCENTRATION` | >½ portfolio one branch | balance |

Structural violations still throw (count, uniqueness, unknown ID, set mismatch, enum).

## 4. Tests — `node --test backend/experiments/cf3/test.mjs` → 12/12

Includes: **terminology lint** (fails if `proposition`/`claim`/`claims` appears in any
model-facing prompt prose — dummy data is term-free so only prose is checked),
fusion-detector, reporting-residue-detector, and the argument-validation/scoreTransform
suite.

## 5. F03 runs

- `cf1-f03-004208` — original (pre-change) reference.
- `cf1-f03-011253` — **tainted / superseded**: measured §1a while it still said
  `proposition`. Not a valid baseline.
- **Combined-revision run: not yet executed.** On go-ahead:
  `node backend/experiments/cf3/run.mjs --fixture CF1-F03`.

## 6. Success criteria + regression watch (this run)

Attribution is preserved despite bundling because the changes have disjoint targets the
diagnostic reads independently:

- **§1a (text residue):** A009's `assertionText` collapses to the object assertion
  ("CDC data linking MMR to autism was manipulated, ~2004"); `CF3_REPORTING_RESIDUE`
  count drops.
- **§4 (source identity + kind):** A009 source resolves to **William Thompson / person**;
  JCPH opponent rows move off `article_voice` to `document`/`institution`.
- **⚠ Coupling watch (§8.4):** the JCPH rows must **keep `challenged` treatment** (and
  host-derived `invert`) after their source kind changes. `§1a` does not touch source
  fields, so a treatment flip here is unambiguously `§4`'s effect via the §8.4 mechanism
  — and is the one outcome that would halt to isolate before anything else. Diagnostic
  table now carries `treatment` / `thesisEffect` / `transform` columns for exactly this.
