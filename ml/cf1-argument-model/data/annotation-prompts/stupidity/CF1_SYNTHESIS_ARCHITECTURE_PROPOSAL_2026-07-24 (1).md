# CF1 Synthesis Architecture Proposal — 2026-07-24

**Status:** Design candidate. Nothing implemented. Every element below cites the
experiment that supports it. Elements without empirical support are marked as the
design's open risks.

---

## 1. The core diagnosis the record supports

Reading the MCT and the Two Success Vectors packet together, the failures sort into
exactly three unresolved problems. Everything else was either solved or was
scaffolding around these three:

1. **Discovery coverage.** No whole-article single call ever produced balanced
   article-wide extraction (Vector A: 15/2/0/3-style front-loading; GPT-5: 262
   assertions; canonical 20/30 ceilings: no opponent recovery). The only mechanism
   that ever produced balance was chunking (V7: 29/4/14/25; V11: 43/26/33/43).

2. **Discovery == selection collapse.** Vector A's fatal flaw (packet §2.7 #10):
   when one call both discovers and selects, anything missing from the first
   portfolio is unrecoverable. The fix is an overcomplete inventory followed by
   comparative selection — which is exactly what Vector B's batch call demonstrated
   works, except Vector B could not reselect because it inherited A's already-final
   portfolio.

3. **Labeling cost and coupling.** Per-candidate labeling of a large inventory
   explodes output tokens (the 8172-ceiling crash). Source context contaminates
   stance when adjacent (§8.4). Both are solved by the same move: label only the
   selected portfolio, with stance fields ordered before source fields.

The synthesis is therefore a composition of the three proven mechanisms, one per
problem, with nothing else added:

```text
chunked minimal discovery        →  solves coverage        (V7/V11 evidence)
overcomplete inventory + one     →  solves discovery ==    (Vector B batch
  comparative batch call             selection collapse       comparison evidence)
select-then-label-12-only,       →  solves token explosion (8172 crash;
  stance before source               and source→stance        §8.4 coupling)
```

---

## 2. Architecture

```text
                       ┌─ host: unit IDs, structural chunk split (4 chunks, ~10% overlap)
                       │
article ──────────────►│
                       ▼
        ┌──────────────────────────────┐
        │  DISCOVERY: 4 parallel calls │   GPT-4o-mini, Chat Completions
        │  minimal per-chunk schema:   │   strict schema, temp 0.2
        │  assertionText, unitIds,     │   ~1K output tokens each
        │  challenged flag             │   ~25s wall (parallel)
        └──────────────┬───────────────┘
                       │
                       ▼
        host: merge, exact + normalized dedupe, validate unit IDs,
        assign global assertionIds, preserve challenged flags
                       │
                       ▼
        ┌──────────────────────────────┐
        │  ARGUMENT CALL: one batch    │   GPT-4.1-mini, Responses,
        │  input: FULL article +       │   strict Structured Outputs, temp 0
        │  complete inventory          │   ~2K output tokens
        │  output: stanceAnchor,       │   ~30–40s
        │  selected 12 IDs, labels for │
        │  the 12 only, branches       │
        └──────────────┬───────────────┘
                       │
                       ▼
        host: validate (IDs exist, count == PORTFOLIO_SIZE, enums,
        challenged retention check, polarity spot-check vs unit text),
        derive scoreTransform, join grounding from inventory by ID,
        record fingerprints, render report
                       │
                       ▼
        evidence call (existing Call 2 / ER1 contract — unchanged)
```

Five CF1 model calls total: four small parallel discovery calls plus one argument
call. Wall time estimate ~60s. Token estimate ~32K total — comparable to Vector B's
23.9K but with grounding IDs, article-wide coverage, full (untruncated) context in
the mapping stage, and genuine reselection.

---

## 3. Exact prompts

Design rule: prompts are **contract-level** — they state what a correct output is,
not how to produce it. Operational detail the model can derive (reporting-frame
handling, entity preservation, atomicity mechanics) is deliberately absent from
prose; structural constraints live in the schema, where they are enforced rather
than suggested. The only operational content retained in prose is content with a
direct experimental receipt: the counterfactual stance rule (§8.3), polarity
preservation, the challenged-first scan (Set F), and the evidence-vs-source guard.

Terminology rule: model-facing word is **assertion** (§9.4/§11.1: "proposition" and
"claim" both measurably degraded output). No fixture-specific terms. No numeric
discovery targets in prose — transport ceilings live in the schema only.
Stance-before-source ordering (§8.4) is carried by schema property order and the
task listing order, not by prose narration.

### 3.1 Discovery call (per chunk)

**System:**

```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Return every assertion in its original polarity. When the text introduces an
assertion in order to dispute it, preserve the assertion as the original source
stated it — not as the text's rebuttal.
```

**User:**

```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

{{CHUNK_WITH_SOURCE_UNIT_IDS}}

TASK

First, find any assertions this section presents in order to dispute them. Mark
these challenged: true and state them as their original source made them.

Then return every factual assertion in this section that external evidence could
verify — each worded so it can be checked as written, with the source units that
state it.
```

**Schema (strict):**

```json
{
  "name": "cf1_discovery_v1",
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
            "groundingUnitIds": {
              "type": "array",
              "items": { "type": "string" },
              "minItems": 1,
              "maxItems": 8
            },
            "challenged": { "type": "boolean" }
          }
        }
      }
    }
  }
}
```

`maxItems: 60` is a transport brake, not a target; it is never mentioned in prose.
`maxItems: 8` on groundingUnitIds is the runaway-ID brake (the U0001→U01170 failure
mode).

Design notes:
- The challenged-first scan is the Set F census pattern (found 4/5 target opponents)
  as a committed output obligation, placed at discovery where the failure actually
  occurs — not as selection-time preference prose, which never worked.
- The `challenged` flag is a *hint*, judged from chunk-local context. The argument
  call makes the authoritative `articleTreatment` judgment with the full article.
- No source, no stance, no materiality, no pillars at discovery. Those were the
  fields whose presence destabilized extraction across Sets D/E/H/X.

### 3.2 Argument call (one batch)

**System:**

```text
You map the factual argument of an article and select the assertions most worth
verifying with external evidence.

Use only the supplied article, its source-unit identifiers, and the supplied
assertion inventory. Do not use outside knowledge. Do not fact-check.

Return every assertion in its original polarity. When the article introduces an
assertion in order to dispute it, preserve the assertion as the original source
stated it — not as the article's rebuttal.
```

**User:**

```text
ARTICLE METADATA

Title: {{ARTICLE_TITLE}}
Author or byline: {{ARTICLE_AUTHOR}}
Publication: {{PUBLICATION}}
Publication date: {{PUBLICATION_DATE}}

PORTFOLIO SIZE

Select exactly {{PORTFOLIO_SIZE}} assertions.

ARTICLE

{{FULL_ARTICLE_WITH_SOURCE_UNIT_IDS}}

ASSERTION INVENTORY

{{INVENTORY_JSON}}

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly {{PORTFOLIO_SIZE}} inventory IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion:

assertionText — the assertion itself, checkable as written.

thesisEffect — assume the assertion is true. If that makes the stanceAnchor more
credible, strengthens; less credible, weakens; neither, no_effect. Ignore the
assertion's source, tone, and whether it seems true.

articleTreatment — the article adopts this assertion, challenges it, or reports it.

assertionSource — who supplies this assertion in the article, and the units that
show it. A work cited as evidence for an assertion is not automatically its
source. Use unknown rather than guess.

argumentBranchId — the distinct part of the argument this assertion belongs to.

citedWorks — studies, documents, laws, or researchers the article ties to this
assertion, if any.

4. argumentBranches — for each branch ID used, the factual question it represents.
```

**Schema (strict):**

```json
{
  "name": "cf1_argument_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["stanceAnchor", "selectedAssertionIds", "selectedAssertions", "argumentBranches"],
    "properties": {
      "stanceAnchor": { "type": "string" },
      "selectedAssertionIds": {
        "type": "array",
        "items": { "type": "string" }
      },
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

## 4. Field-level data flow

| Final field | Origin | Justification |
|---|---|---|
| unit IDs, chunk boundaries | host | syntactic |
| assertionText (inventory) | discovery model | models good at grounded passage extraction (§15.1, adapter 97.1% detection recall) |
| groundingUnitIds | discovery model, host-validated against chunk range | model supplies, host verifies lineage |
| challenged hint | discovery model | Set F census evidence; local judgment |
| assertionId | host | syntactic |
| dedupe | host, exact + normalized only | sanctioned host operation (packet §5.3) |
| stanceAnchor | argument model | concise thesis repeatedly successful (packet, adapter, all arms) |
| selectedAssertionIds | argument model, comparative over full inventory | Vector B batch comparison; pointwise rejected (0/22) |
| assertionText (final) | argument model, polarity-locked by prompt + host spot-check | Vector B objectClaim recovery worked |
| thesisEffect | argument model, counterfactual rule verbatim | landmark split-1B result (§8.3) |
| articleTreatment | argument model, full-article context | Vector B mapped all 3 JCPH opponents correctly with only 16K context; full context strictly better |
| assertionSource | argument model, ordered after stance fields | §8.4 coupling evidence; Vector B partial success |
| argumentBranchId / branchQuestion | argument model, derived from assertions | V9 bottom-up pillar evidence; top-down rejected |
| scoreTransform | **host**, derived | adopted→normal; challenged→invert; reported→ by thesisEffect (strengthens→normal, weakens→invert, no_effect→none) |
| grounding join | host, by assertionId from inventory | model does not re-emit inventory data |
| citedWorks | argument model | article-supplied study preservation repeatedly successful |

## 5. Deterministic host pseudocode

```text
run(article, portfolioSize):
  units      = injectUnitIds(article)
  chunks     = splitStructural(units, n=4, overlap≈0.10)
  results    = parallel(chunks.map(c => discoveryCall(c)))     # 4 calls
  inventory  = []
  for r in results:
    for a in r.assertions:
      assert allUnitsInChunkRange(a.groundingUnitIds, r.chunk) # else drop + finding
      inventory.push(a)
  inventory  = dedupeExactAndNormalized(inventory)             # keep challenged=true on merge
  inventory  = assignGlobalIds(inventory)                      # A001..A0nn

  out = argumentCall(fullArticle=units, inventory, portfolioSize)   # 1 call

  validate:
    out.selectedAssertionIds.length == portfolioSize
    unique(out.selectedAssertionIds)
    every id ∈ inventory
    selectedAssertions ids == selectedAssertionIds (set equality)
    enums valid (schema-enforced, re-checked)
    challengedRetention: for each inventory item with challenged=true,
      if absent from portfolio → finding CF1_CHALLENGED_DROPPED (non-blocking, reported)
    polaritySpotCheck: for each selected, final assertionText vs inventory text —
      flag negation-flip heuristics for review (non-blocking finding)
    branchCoverage: warn if > portfolioSize/2 selected share one branch
    quarterCoverage: compute selected distribution from unit IDs; report

  for each selected:
    scoreTransform = derive(articleTreatment, thesisEffect)    # table above
    grounding      = inventory[id].groundingUnitIds            # host join

  record fingerprints (prompts, schemas, models, transport, hashes)
  render report; write immutable timestamped artifact dir
```

No host relinking, no backfill, no semantic selection, no repair calls, no census
recovery. Census stays observation-only if kept at all.

---

## 6. Explicitly discarded

Pillar objects with importance/summaries/membership; theme, fullThesis, thesisHinge;
per-item centrality/verifiability/priority/materiality numbers (proven
non-discriminative, §10.3); searchText at Call 1 (belongs to the evidence call);
testimonials; atomicity audit fields; atomic repair call; census recovery; host
pillar backfill; pointwise selection in any form; model-emitted scoreTransform;
numeric discovery floors/ceilings in prose; the fine-tuned adapter (parked — it is a
chunk-level extractor and could later be re-benchmarked against GPT-4o-mini on the
discovery task only, but it is not on the critical path); separated per-candidate
label arrays (the 8172-crash design).

---

## 7. Evaluation plan and stop/go

Fixtures: F02 (internal tension), F03 (opponent-heavy canary — debugging only, not
sole promotion evidence), F06 (different structure). 5 repeats each, identical
requests, all fingerprints recorded.

| Metric | Measured where | Stop/go threshold |
|---|---|---|
| Material assertion recall vs gold keys | inventory (post-dedupe) | ≥ 85% of key assertions present in inventory on every fixture |
| Quarter distribution (inventory) | inventory | no quarter < 10% of assertions on a long fixture |
| Challenged/opponent presence in inventory | inventory | every gold challenged assertion present in ≥ 4/5 repeats |
| Opponent retention in portfolio | portfolio | every gold challenged assertion selected in ≥ 4/5 repeats |
| Polarity | portfolio vs unit text | zero confirmed polarity rewrites |
| Atomicity | portfolio, human-scored | ≤ 2 compound of 12, no worse than Vector B |
| thesisEffect minority classes | portfolio | weakens/no_effect reported separately; ≥ 7/10 correct on gold weakens rows |
| articleTreatment | portfolio | challenged class ≥ 8/10 correct on gold |
| Source exact usable name or explicit unknown | portfolio | ≥ 70% usable-or-abstain; overinterpretation counted as failure |
| Branch/coverage | portfolio | every gold major branch represented when a viable candidate exists |
| Repeat variance | portfolio | ≥ 8 of 12 selections stable across repeats |
| Latency / tokens | end-to-end | ≤ 120s, ≤ 40K tokens |

Aggregate accuracy is never reported without the minority-class breakdown.

**Rejection evidence.** The architecture is rejected if, across repeats: (a) chunked
discovery still misses gold challenged assertions (would falsify the census-at-
discovery mechanism), or (b) the argument call's selection remains front-loaded or
drops retained opponents despite them being present and flagged in its input (would
falsify the batch-comparative-selection mechanism). Fallback for (b) only: move
selection to a dedicated tiny call (inventory in, 12 IDs out) before a labeling
call — still batch, still comparative, never pointwise.

---

## 8. Why this should outperform both vectors

Against Vector A: discovery is no longer selection, so misses are recoverable;
coverage comes from the only mechanism that ever produced it; grounding IDs exist;
stance/treatment/source exist; the portfolio contains 12 substantive assertions
rather than 9 plus a thesis, a generic pillar, and a nonclaim; and the prompt is
uncontaminated.

Against Vector B: the mapping stage sees the full article, not 16K characters; it
reselects from an overcomplete inventory instead of interpreting a frozen and
front-loaded one; the schema is a fraction of the size (no targets array, no
backward-compatibility fields, no confidence numbers); and stance-before-source
field order addresses the coupling Vector B never controlled.

The open risks, stated plainly: the argument call performing selection and labeling
in one completion is a smaller version of the overload that sank V0 — the mitigation
is that labeling applies to 12 items only and selection is input-side comparison,
but this is the design's least-proven element and it is exactly what Stage-2 smoke
plus the rejection criteria above are built to test. Second, chunk-local challenged
hints may misfire when a rebuttal spans chunk boundaries; the ~10% overlap and the
argument call's authoritative full-context treatment judgment are the mitigations.
