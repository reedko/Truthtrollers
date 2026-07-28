# CF7 — Coverage-First Chunk Factory: Build Specification
Date: 2026-07-28
Status: Governing build spec. Replaces the CF6 whole-article agent as the primary path.
Supersedes: Approach 1 (Structure-first Funnel) and Approach 3 (Dual-lane Reconciliation)
as first experiments — both rejected below with reasons.

---

## 0. The finding this architecture exists to answer

Three CF6 runs, same architecture, F03:

| Run | Theses | Claims | Must-selects laundered | Outcome |
|---|---|---|---|---|
| 1 | 6 | 6 | — | good package, failed terminal control |
| 2 | 1 | 3 | **7 of 12, incl. 2 of 4 cruxes** | completed, hash-clean, gutted |
| 3 | 0 | 0 | — | nothing produced |

Run 2's laundering table is the decisive artifact: gold G02 ("CDC data linking MMR
vaccination to autism were manipulated", crux, grounded U0037) sat in REGION-006, which
the agent dispositioned as "No material independently investigable assertion in this
structural region." `unaccountedMustSelectCount: 0`. Every gold "accounted for." The
package was deterministically clean, hash-verified, immutable — and dropped 7 of 12
must-selects.

Critically, the native `bulkDispositionCount` was **zero**: the agent did not use the bulk
field. It enumerated 24 region IDs individually in one update call — inventing its own
cheap exit. Removing bulk disposition would not have prevented this.

**Structural conclusion (do not re-litigate):** any design where the model declares its
own scope and the host verifies compliance *against that declaration* is blind to
under-production. The mirror counts model-authored links; declare little, comply
perfectly. Close one exit, the next run finds the adjacent one. There is no patch.

**Therefore: coverage must be MECHANICAL, not declared.** The host iterates chunks; every
chunk is processed because the host schedules it, not because the model chose to look
there. A model may produce a poor claim from chunk 6; it cannot make chunk 6 disappear.

Rejected alternatives, briefly: **Approach 1 (thesis-first)** makes the most-failed
judgment the first stage, where its errors are least detectable — this is the S5
anchor-omission failure by construction (F03's anchor dropped the fraud pillar; everything
downstream was faithfully wrong). **Approach 3 (dual-lane)** does not fix a shared blind
spot, and its adjudicator is a new, harder, unvalidated semantic judgment. Both may return
later; neither is the next experiment.

---

## 1. Product contract (unchanged)

Per article: 8–15 (ceiling 15, no floor, flag if thin) independently investigable claims,
each with exact grounding, de-attributed substantive assertion, supplier, article
treatment, polarity, thesis linkage, and verification target — sufficient for a reader's
gut-check and for downstream evidence retrieval (ER1). Emit-fewer-and-flag; abstention is
a first-class outcome.

## 2. Governing principles (carried, non-negotiable)

- **Mechanical coverage.** The host iterates; the model never decides what gets inspected.
- **One semantic judgment per stage.** No stage mixes objectives (M2).
- **Bounded input and output per call.** No stage generates long multi-item output (M1).
- **Contract prompts, not intermediate prompts** (Caulfield): state what a correct output
  IS, never pre-computed operationalization.
- **Model-facing term is "assertion"** — never "proposition"/"claim". Lint-enforced.
- **Lock claim text after atomicity.** Later stages annotate only; relationships are
  edges, never rewrites. (A051 invented content; A100 polarity mangle.)
- **Tiny schemas** (2–4 fields per stage).
- **Deterministic host** owns: chunking, IDs, lineage, dedupe, assembly, validation,
  transforms, budgets. Never semantic judgment.
- **Abstention over forced output** (Claimify): a stage may decline; declines are logged,
  never silent.
- **Sealed blind gold keys**; fix the ruler before trusting the measurement.
- Role separation: Fabicles implements/runs; Codex verifies + evaluates; specs govern.

---

## 3. Architecture

```text
S0  ingest, unit IDs, structural regions                    [host]
S1  mechanical chunking (every chunk scheduled)             [host]
S2  per-chunk harvest — 1 bounded model call PER CHUNK      [model, N calls, parallel]
S3  atomicity pass on compound harvest rows                 [model, triggered only]
S4  host consolidation: dedupe, IDs, lineage, entailment    [host + NLI]
S5  thesis derivation FROM INVENTORY                        [model, 1 call]
S6  supplier + attribution                                  [model, batched, isolated]
S7  article treatment + polarity                            [model, batched, isolated]
S8  portfolio selection over the inventory                  [model, 1 comparative call]
S9  verification targets for selected claims                [model, batched]
S10 deterministic assembly, validation, package, audit      [host]
```

Coverage is guaranteed at S1/S2 and cannot be revoked downstream. Selection (S8) reduces
the inventory to the portfolio, but the inventory retains everything harvested — omission
at selection is visible against the inventory, unlike CF6 where omission was invisible.

---

## 4. Stage specifications

### S0 — Ingest [host]
Reuse CF6's normalizer. Output `units.json`: `[{unitId, text, charStart, charEnd,
regionId, quarter}]`, plus `regions.json` (structural regions from headings/paragraph
blocks, as CF6 derived them). Content hash + source-unit manifest hash preserved.

### S1 — Mechanical chunking [host]
- Paragraph boundaries; sentence fallback for oversize paragraphs.
- Target 800–1200 tokens per chunk; **10–15% overlap** between adjacent chunks.
- No semantic chunking. No model involvement. No skipping.
- Every chunk carries its unit IDs and region IDs.
- Output `chunks.json`. **The chunk list is the coverage contract**: S2 runs once per
  chunk, always, and the host asserts `harvestCallCount == chunkCount` before proceeding.

### S2 — Per-chunk harvest [model, one bounded call per chunk, parallel]

The coverage guarantee. Every chunk gets a call; a chunk cannot be skipped, and an empty
result is an explicit, logged outcome — not an absence.

**SYSTEM**
```text
You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside knowledge.
Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the text
disputes into the text's rebuttal of it.
```

**USER**
```text
ARTICLE SECTION {{CHUNK_INDEX}} OF {{CHUNK_COUNT}}

{{CHUNK_WITH_SOURCE_UNIT_IDS}}

TASK

First, in disputedAssertions, return the assertions this section presents in order to
dispute — each stated as its original source made it. Return an empty array only if the
section disputes nothing.

Then, in assertions, return every other factual assertion in this section that external
evidence could verify — each worded so it can be checked as written, with the source
units that state it.
```

**SCHEMA `cf7_harvest_v1` (strict)** — `disputedAssertions` FIRST in property order
(committed-census pattern; Set F receipt).
```json
{
  "name": "cf7_harvest_v1",
  "strict": true,
  "schema": {
    "type": "object", "additionalProperties": false,
    "required": ["disputedAssertions", "assertions"],
    "properties": {
      "disputedAssertions": { "type": "array", "maxItems": 20, "items": { "$ref": "#/$defs/row" } },
      "assertions":        { "type": "array", "maxItems": 40, "items": { "$ref": "#/$defs/row" } }
    },
    "$defs": { "row": {
      "type": "object", "additionalProperties": false,
      "required": ["assertionText", "groundingUnitIds"],
      "properties": {
        "assertionText": { "type": "string" },
        "groundingUnitIds": { "type": "array", "items": {"type":"string"}, "minItems": 1, "maxItems": 8 }
      }
    }}
  }
}
```
maxItems are transport brakes, never mentioned in prose. No supplier, no stance, no
materiality at harvest — those fields destabilized extraction across Sets D/E/H/X.

Host validation per chunk: every `groundingUnitId` must be within that chunk's range;
out-of-range rows are dropped with a finding. Empty harvest for a chunk is recorded as
`CF7_EMPTY_CHUNK` (observation, not error).

### S3 — Atomicity [model, triggered only]
Trigger: host detects a compound row (coordinate finite predicates, or multiple distinct
verifiable propositions by a deterministic heuristic). Input: one row + its grounding.
Output: 1–3 atomic rows, each with the same or narrower grounding.

**USER**
```text
ASSERTION

{{ASSERTION_TEXT}}

SOURCE

{{GROUNDING_UNIT_TEXT}}

TASK

If this states more than one separately verifiable fact, return each as its own
assertion. If it states one, return it unchanged.
```
Schema: `{atomicAssertions: [{assertionText, groundingUnitIds}]}`, maxItems 3.
**Claim text is LOCKED after this stage.** No later stage may rewrite assertion text.

### S4 — Host consolidation [host + NLI]
1. Merge all chunk harvests; `disputedAssertions` rows carry `disputed: true`.
2. Dedupe: exact, then lemma-normalized. Cross-boundary duplicates from the 10–15%
   overlap resolve here (keep the row with wider grounding; `disputed` wins on merge).
3. Assign global `assertionId` A001…; attach grounding from the harvest (host-owned
   lineage — the model never emits global IDs).
4. **Entailment gate** (DeBERTa-v3-large-MNLI, local, deterministic): premise = source
   unit text, hypothesis = assertion. Below threshold → drop + `CF7_NOT_ENTAILED`.
   This is Claimify's 99%-source-entailment standard made mechanical; it kills invented
   content (the A051 class) before it can propagate.
5. Polarity parity check vs. source span → `CF7_POLARITY_SUSPECT` (the A100 class).
6. Output `inventory.json` — **the permanent record of what the article contains.**
   Everything downstream is measured against it.

### S5 — Thesis derivation FROM INVENTORY [model, 1 call]
Bottom-up (V9's receipt). Input: the deduped inventory assertion texts (IDs + text only),
NOT the article, NOT a pre-existing anchor.

**USER**
```text
ASSERTIONS

{{INVENTORY: assertionId + assertionText, one per line}}

TASK

State the distinct central positions this set of assertions is used to support. If the
set supports more than one distinct position, state each as its own concise assertion.
Include every position the set centrally depends on; do not merge distinct positions into
a single summary, and do not drop one for brevity.
```
Schema: `{theses: [{thesisId, statement}]}`, maxItems 4.

Guard (the R1 lesson from the failed S5-v2 attempt): a *conclusion plus its supporting
mechanisms* is ONE position, not three. Host runs mutual-entailment on the returned set
and flags `CF7_THESES_REDUNDANT`; Codex reviews independence on the first runs. Expect 1
for focused articles, 2 for F03 (toxins axis AND fraud/concealment axis).

### S6 — Supplier + attribution [model, batched ~20 assertions/call, isolated]
Input: assertion text + its grounding unit text. Output per assertion: supplier name,
kind, attribution unit IDs. Contract-level prose:
```text
Identify the originator of each assertion — not whoever repeats or reports it. Match kind
to the named entity; a named ad, report, or document is not article_voice. Use
article_voice only when the article's own narrator originates the assertion. A work cited
as evidence for an assertion is not automatically its source. Use unknown rather than
guess.
```
Hard host rule: **a named entity never receives `article_voice`**. Supplier names must be
substrings of the supplied unit text (no invented sources — the "Vaccine study group"
class). This call never sees stance or treatment.

### S7 — Article treatment + polarity [model, batched, isolated]
Input: assertion + its source sentence + 2 following units (local window). Output:
`adopted | challenged | reported | unclear`. **This call never sees supplier** — §8.4
source→stance coupling is impossible by construction, not by field ordering.
`unclear` is a legitimate abstention. Host cross-checks with discourse features
(contrastive markers, disputed flag from S2) → `CF7_TREATMENT_DISPUTED` where they differ.
Minority class (`challenged`) reported separately, always.

### S8 — Portfolio selection [model, 1 comparative call over the inventory]
Comparative over the full visible inventory (Vector B receipt; pointwise scored 0/22).
Input: theses (S5) + inventory (IDs + text + disputed flag). Output: selected IDs only.
```text
Return the assertionIds the article's case most depends on — the ones whose falsity would
most damage its argument, whoever states them and however they are framed. An assertion
is load-bearing if it strongly supports any one of the positions below, even if it does
not bear on the others. Cover the distinct positions rather than piling onto one. Include
an assertion the article disputes when the case depends on defeating it.

Return only genuinely load-bearing assertions — fewer is better than padding.
```
Schema: `{selectedAssertionIds: [string]}`, maxItems 15. No floor; host flags `< 5` as
`CF7_THIN_PORTFOLIO`. **Selection cannot hide an omission**: everything harvested remains
in `inventory.json`, so unselected material is visible and measurable — the exact
property CF6 lacked.

### S9 — Verification targets [model, batched, selected claims only]
Per selected claim: `verificationTarget` (what evidence would settle it) and
`targetType: attribution | substantive | mixed`. Bounded, annotate-only, no rewrite.

### S10 — Assembly, validation, package [host]
Deterministic. `scoreTransform` derived (adopted→normal; challenged→invert;
reported→by thesis effect). Grounding joined by ID. Structural violations throw
(unknown/duplicate IDs, out-of-range units, enum violations, missing thesis link).
Findings (non-blocking, rendered): `CF7_EMPTY_CHUNK`, `CF7_NOT_ENTAILED`,
`CF7_POLARITY_SUSPECT`, `CF7_THESES_REDUNDANT`, `CF7_TREATMENT_DISPUTED`,
`CF7_THIN_PORTFOLIO`, `CF7_SOURCE_FUSED`, `CF7_UNSELECTED_DISPUTED` (a disputed assertion
present in inventory but not selected — the opponent-retention signal).

Immutable timestamped artifact dir; package hash; per-stage artifacts replayable; the
CF6 provenance/idempotency/persistence layer carried over unchanged.

---

## 5. Why each historical failure is structurally prevented

| Failure | CF7 mechanism |
|---|---|
| **Must-select laundering (CF6 run 2: 7/12, 2 cruxes)** | No disposition mechanism exists. Coverage is host-scheduled; the model cannot declare a region immaterial. |
| **Under-production collapse (CF6 6→1→0)** | Output volume is a function of chunk count, not model willingness. `harvestCallCount == chunkCount` asserted. |
| Top-of-article gravity / front-loading | Per-chunk harvest; the model never sees a whole article to front-load. |
| Crux omission at selection | Crux remains in `inventory.json` whether selected or not; omission is measurable, and S5's multi-thesis derivation gives it a target. |
| Thesis omission (S5 anchor dropped fraud pillar) | Thesis derived bottom-up FROM the inventory, which already contains the fraud assertions. |
| Attribution fusion / invented sources | S6 substring validation + named-entity-never-article_voice. |
| Invented content (A051) | S4 entailment gate. |
| Polarity mangle (A100) | Text locked after S3; polarity parity check. |
| Source→stance coupling (§8.4) | S7 never sees supplier. |
| Treatment collapse to `reported` | S7 single objective, no competing instruction. |
| Compound claims | S3 dedicated atomicity stage, triggered. |
| Runaway grounding IDs | Host owns lineage; chunk-range validation. |
| Token ceiling / M1 | No call exceeds ~1K output; harvest calls are small and parallel. |

## 6. Explicitly not built
No region dispositions (the laundering vector). No model-declared coverage. No agent loop.
No manager. No whole-article single-pass extraction. No pointwise selection. No
model-emitted global IDs, lineage, or transforms. No fixture-specific content in any
prompt, threshold, or lexicon. No importance scores or per-item materiality numbers
(§10.3: non-discriminative). No pillar-membership machinery.

## 7. Evaluation

Fixtures F02, F03, F06 (sealed blind keys; F03 is the canary, never sole promotion
evidence). 5 repeats. All metrics per the CF6 acceptance rubric's guardrails: one-
directional entailment for recall, cap-3 union unchanged, minority classes reported
separately, abstention scored as first-class.

**Gate 1 — coverage (the point of this architecture):**
- `harvestCallCount == chunkCount` on every run (hard);
- every gold must-select present in `inventory.json` (recall ≥ 90% per fixture);
- **laundering table: 0 must-selects unaccounted-and-absent.** Retained permanently as
  the standard artifact — it caught CF6 and it applies to any architecture.

**Gate 2 — theses:** F03 yields BOTH the toxins axis and the fraud/concealment axis;
F02/F06 yield one each (no over-splitting); redundancy check clean.

**Gate 3 — portfolio:** every crux-flagged gold selected in ≥ 4/5 repeats; disputed
assertions retained where the key requires; `CF7_UNSELECTED_DISPUTED` reviewed.

**Gate 4 — quality:** verdictability ≥ 90% (surface, not latent meaning); grounding 100%;
`challenged` precision/recall ≥ 0.80; zero confirmed polarity rewrites; no
mutual-entailment duplicates in the portfolio.

**Gate 5 — economics:** report total tokens, call count, wall time. Expect ~N+8 calls for
N chunks (F03 ≈ 30–40 chunks → ~40 calls, small and parallel). Subordinate to Gates 1–3:
never trade coverage for cost.

## 8. Build order (each gated; do not proceed on a failed gate)

1. **S0/S1 + the coverage assertion.** Prove `harvestCallCount == chunkCount` and chunk
   coverage of all 404 F03 units, deterministically, before any model call.
2. **S2 harvest on F03, one pass.** Gate: inventory recall ≥ 90% vs sealed key;
   laundering table shows zero must-selects absent. **This is the make-or-break gate** —
   if mechanical chunking doesn't recover what CF6 laundered, the premise is wrong.
3. **S3 + S4** (atomicity, dedupe, entailment gate). Gate: false-drop rate < 5%.
4. **S5 thesis derivation.** Gate 2.
5. **S6/S7** isolated annotation. Gate 4 partial.
6. **S8/S9 + S10 assembly.** Gate 3, Gate 4 full.
7. F02/F06, 5 repeats, full rubric.

Do not tune against F03 alone. Report whatever the numbers are.

## 9. What carries over from CF6 unchanged
Provenance and authorization boundaries; exact source-unit IDs and foreign-grounding
rejection; MySQL run/event/package persistence; idempotency, immutable finalization,
package hashes; permanent per-request accounting; typed terminal outcomes; the sealed-key
evaluation harness and the laundering table. That infrastructure was never the problem and
is not rebuilt.

## 10. The one rule
The host decides what gets looked at. The model decides what it means. Never the reverse.
