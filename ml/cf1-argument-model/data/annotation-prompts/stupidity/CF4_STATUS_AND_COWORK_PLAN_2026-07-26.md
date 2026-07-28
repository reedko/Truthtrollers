# CF4 — Current Status and Cowork Plan
Date: 2026-07-26

This is the single orientation doc for coworking CF4. It says where the pipeline stands,
what each open ticket does, the exact run order, and the decisions that are yours.

---

## 1. What CF4 is

A mostly-deterministic claim-extraction pipeline that turns an article into ~8–15
load-bearing, sourced, stance-labeled assertions for a "gut check" reliability read
(handed downstream to evidence retrieval / ER1). Born after CF1–CF3 (single/few large
model calls) kept failing on attribution fusion, invented content, source->stance
coupling, and non-deterministic extraction. CF4's bet: do the SYNTACTIC work
deterministically (attribution split, coref, clause extraction, lineage, entailment
gate) and use bounded model calls ONLY for the SEMANTIC judgments (stance, selection,
labeling), one objective per call.

## 2. Governing principles (do not violate)

- **Contract prompts, not intermediate prompts** (Caulfield): prompts state what a
  correct output IS, never pre-computed operationalization.
- **Model-facing term is "assertion"** — never "proposition"/"claim". Enforced by lint.
- **One objective per model call.** Merging objectives = the CF3 failure mode.
- **Deterministic layer owns repair; model owns judgment; never in the same call.**
- **Sealed gold keys, built blind by Codex, never from run output.** Fix the ruler before
  trusting the measurement.
- **One change at a time between candidate configs; full-state specs, never fragments.**
- **Abstention/emit-fewer over forced output** (Claimify).
- Role separation: Fabicles implements/runs; Codex verifies + builds/seals keys; Fable
  (this seat) analyzes + writes tickets/specs.

## 3. Pipeline stages

```
S0 ingest + unit segmentation            [host]           DONE
S1 parse + coreference                   [local models]   DONE (repr-selection fixed; run-once guard open)
S2 attribution split                     [host rules]     DONE
S3 clause/candidate generation           [host rules]     DONE (root-selection fixed)
S4 entailment gate                       [NLI]            in place
S5 stance anchor                         [1 model call]   BROKEN — drops a major thesis (open ticket)
S5b decompose anchor -> sub-theses       [1 model call]   works (on whatever S5 gives it)
S6 selection (comparative, sub-thesis-aware) [1 model call] works (tracks its target faithfully)
S7 ambiguity gate (span-scoped)          [host]           spec'd, on survivors
S8 labeling: stance/treatment/source     [isolated calls] spec'd, not built
S9 derived fields + validation + report  [host]           partial
```

## 4. Phase status

- **Phase 1 (extraction/inventory): effectively passing.** Recall ~83% on F02/F03/F06 with
  documented, defensible gaps (cap-bound multi-unit assertions; one unsafe demonstrative,
  F03 G09). Reed confirmed 83%-with-documented-gaps clears the product bar. Deterministic,
  zero variance, full lineage. Extraction recalls the crux content cleanly (Thompson
  C0101/C0107 present and clean after coref).
- **Phase 2 (selection + labeling): selection blocked on S5.** The current blocker is fully
  diagnosed (section 6).

## 5. The just-closed diagnosis (why selection was failing)

Read directly from raw F03 selection files, no scoring involved:
- The F03 stance anchor covers toxins + suppression but OMITS the article's second major
  pillar — the CDC fraud/data-manipulation (Thompson) story.
- S5b faithfully decomposed the incomplete anchor; no fraud sub-thesis exists to decompose.
- S6 faithfully selected ingredient claims matching the sub-theses it was given; Thompson
  had no sharp sub-thesis to be central to, so it lost 0/5.
- Every stage worked correctly on a bad input. The single broken link is **S5 compressing a
  two-thesis article into a one-thesis anchor.**
- This DISPROVED the scale hypothesis (772 items overwhelming the model). Selection was
  coherent and on-target; the target was missing a pillar.

## 6. Open tickets (run in this order)

1. **TICKET-S1-run-once-guard** (write/ля close): correct T4 to single-pass determinism +
   add resolved=true guard so S1 can't run twice. Closes the coref blocker. Trivial.
   *(Representative-selection fix already landed and is green.)*
2. **TICKET-eval-overlay-consistency**: make "extracted" and "selected" use ONE match, so
   "selected-but-not-extracted" (the G10 contradiction) is impossible. Grader-only. Needed
   so the F03 gate number is trustworthy. Can run in parallel with #3.
3. **TICKET-S5-multi-thesis-anchor**: THE fix. S5 emits the article's distinct central
   claims (1–3), not one compressed sentence, so F03 carries both the toxins thesis AND the
   fraud thesis. Then S5b makes a fraud sub-thesis and S6 can float Thompson.
4. After #3 passes R2 (Thompson floats >=4/5): re-run the crux overlay on the CONSISTENT
   grader (from #2) to confirm on all three fixtures.
5. Then build **S7 span-scoped ambiguity gate** and **S8 labeling** (isolated
   stance/treatment/source calls) on survivors — per CF4_PHASE2_SPEC_v2.

Not blocking, clean up before Phase 2 closes:
- Stale `test_nli_scorer.union_members()` missing `gold_text` arg — its own tiny ticket.

## 7. Decisions that are YOURS (not Fabicles', not mine)

- **S5 multi-thesis shape**: approve emitting 1–3 central claims (recommended) vs. keeping
  one anchor and just sharpening the prompt (collapses back to compound — not recommended).
- **Portfolio sizing**: confirmed — emit-fewer-and-flag, ceiling 15, no floor, flag if thin.
- **Gate policy**: 83% Phase-1 with documented gaps accepted. For Phase-2 selection, the
  gate is crux-floats->=4/5 per fixture on the consistent grader.
- **If S5 fix still doesn't float Thompson** (R3): decide between surfacing multi-pillar
  structure harder in S5 vs. per-sub-thesis selection passes. Do not pre-commit.

## 8. What each bundled file is

- `CF4_STATUS_AND_COWORK_PLAN_2026-07-26.md` — this file.
- `CF4_PHASE2_SPEC_v2_2026-07-25.md` — selection+labeling architecture (S6 replaced
  PageRank; S7/S8 design).
- `CF4_DETERMINISTIC_PIPELINE_BUILD_PLAN_2026-07-24.md` — original S0–S9 deterministic plan.
- `CF5_SPECIFICATION_2026-07-24.md` — bounded-output hybrid spec; source of the
  isolated-call + abstention labeling design folded into CF4 Phase 2.
- `MCT_AMENDMENT_PROMPT_DESIGN_PRINCIPLES_2026-07-24.md` — Caulfield contract-prompt rule +
  terminology lint + run discipline. Governing.
- `TICKET-S5-multi-thesis-anchor.md` — THE current fix.
- `TICKET-eval-overlay-consistency.md` — grader fix, needed for a trustworthy gate.
- `TICKET-S1-coref-representative-tiebreak.md` — landed green; kept for the record + the
  run-once guard note.
- `TICKET-S5b-stance-decomposition.md` — works; kept for wiring reference (S5b consumes S5).
- `TICKET-S3-root-selection.md` — landed; result: 2 of its targets were scoring artifacts,
  cross-unit; kept for record.
- `CODEX-AUDIT-cap-seal-substance.md` — the integrity audit (cap=3 held, seals intact,
  substance ruling refused to manufacture a gate pass).

Superseded/context (not CF4-current, included only if you want lineage): CF3 MCT, CF3
revision spec, CF1 synthesis proposal — omitted from this bundle to keep it CF4-focused;
ask if you want them.
