# CF4 Phase 2 Spec — Selection + Labeling (v2, post-dry-run)

Date: 2026-07-25
Supersedes the S7/S8 selection design in the CF4 build plan. Phases 0–1 (deterministic
extraction) are UNCHANGED and retained in full.

---

## 0. What changed and why (one paragraph)

The gap-detection dry-run FAILED on all three fixtures: PageRank centrality measures
topical connectedness, not factual load-bearingness. It promoted background description
(F06: reef age/dimensions/biodiversity over every climate/bleaching crux) and referential
rhetorical fragments (F02: "it was shockingly bad" ranked #1). This is not tunable — in
prose, "most connected" is the topic, not the thesis. Deterministic selection is therefore
abandoned. Selection is a judgment about argument structure (semantic) and moves to a
single bounded model call using the one selection pattern with a receipt: Vector B's
comparative-over-the-visible-inventory (pointwise selection scored 0/22; comparative
worked). Everything feeding that call is clean deterministic Phase-1 output, so the model
does ONLY the load-bearingness judgment, on the full inventory, once.

## 1. What Phase 1 keeps (unchanged, not re-litigated)

Deterministic and retained: attribution splitting (S2), coreference (S1), clause
extraction (S3), grounding/lineage, S4 entailment gate. ~83% extraction recall, zero
variance, full traceability. Selection was the only stage that failed the dry-run;
extraction is sound (F03 G10 crux was extracted and present at inventory rank 2 — the
content was there; ranking it was the failure).

## 2. Architecture (Phase 2 portion)

```text
Phase-1 clean inventory (attribution-split, coref-resolved, grounded assertions)
        │
        ├─ S5  stance anchor            [1 model call, bounded]      (unchanged from CF5 S5)
        ├─ S6  SELECTION               [1 model call, comparative]  <-- replaces PageRank
        │        input: stance anchor + full clean inventory
        │        output: load-bearing assertion IDs (emit-fewer-and-flag, ≤15)
        ├─ S7  ambiguity gate          [host, span-scoped]          on survivors only
        ├─ S8  labeling on survivors   [isolated model calls]       one objective each
        │        S8a thesisEffect · S8b articleTreatment · S8c source
        └─ S9  derived + validation + report                       [host]
```

Discipline (the CF3 lesson, binding): selection is ONE call, ONE objective. Labeling is
SEPARATE calls, one objective each. They are not merged even though all are model calls
now. Merging objectives is M2, the failure mode behind every CF3 regression.

## 3. S6 — Selection (the new stage)

Input: stance anchor (from S5) + the complete Phase-1 clean inventory (deduped,
attribution-split, coref-resolved assertion text + assertionId + groundingUnitIds +
challenged flag). Not raw spans — the cleaned assertions, so the model judges real claims,
not fragments.

**SYSTEM**
```text
You identify which assertions an article's argument most depends on.

Use only the supplied position and assertion list. Do not use outside knowledge. Do not
fact-check. Do not rewrite the assertions.
```

**USER**
```text
POSITION

{{STANCE_ANCHOR}}

ASSERTIONS

{{INVENTORY: one line per assertion: assertionId + assertionText}}

TASK

Return the assertionIds of the assertions the article's case most depends on — the ones
whose falsity would most damage its argument, whoever states them and however they are
framed. Include an assertion the article disputes when the case depends on defeating it.

Exclude background, context, and rhetoric that the argument does not rest on. Return
only genuinely load-bearing assertions — fewer is better than padding. Do not return an
assertion you cannot clearly place in the argument.
```

**SCHEMA — `cf4_selection_v1` (strict)**
```json
{
  "name": "cf4_selection_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["selectedAssertionIds"],
    "properties": {
      "selectedAssertionIds": {
        "type": "array",
        "maxItems": 15,
        "items": { "type": "string" }
      }
    }
  }
}
```

Notes:
- Comparative over the full visible inventory — the Vector B receipt. NOT pointwise.
- `maxItems: 15` is the ceiling clamp (product decision), transport-enforced, never a
  target. No floor. Emit-fewer-and-flag: host flags when count < 5 ("thin argument").
- Contract-level language only (Caulfield): states what a load-bearing selection IS,
  no operationalization, no scoring rubric, no count target.
- Abstention is built into the task ("do not return an assertion you cannot clearly
  place") — the Claimify instinct applied to selection.
- Host validates every returned ID exists in the inventory; unknown ID → drop + finding.

## 4. S7 — Ambiguity gate (fixed: span-scoped, runs on survivors)

The dry-run showed the whole-candidate gate is too blunt: it dropped F06 G05 for a
resolved-text pronoun near "1981 bleaching" though the fact was interpretable. Fix:

- Drop a survivor ONLY when an unresolved referent is ESSENTIAL to the assertion's
  meaning — i.e. the assertion cannot be interpreted without resolving it (F03 G09's
  "this cumulative load" — the substance is unidentifiable).
- Do NOT drop when an unresolved mention appears but the substantive fact stands without
  it. Span-scope to the referent's grammatical role, not mere presence.
- Runs AFTER selection, on ~≤15 survivors, so it is cheap and can be careful.
- A dropped survivor is logged (CF4_AMBIGUOUS_DROPPED) and the flagged-thin count
  re-checked after the drop.

## 5. S8 — Labeling on survivors (isolated calls, one objective each)

Unchanged from the CF5 labeling design, applied to survivors only:
- **S8a thesisEffect** — counterfactual NLI-or-model call, premise=assertion,
  hypothesis=stance anchor. No source visible (§8.4 coupling impossible by construction).
- **S8b articleTreatment** — local-window call, single objective (adopted/challenged/
  reported), abstain→`unclear`. No source instruction in the call.
- **S8c source** — from Phase-1 S2 attribution (already deterministic and correct); model
  fallback only where S2 abstained. Named-entity-never-article_voice rule holds.

Each on ≤15 survivors → cheap. Pile-1 finding from Phase 1 (NLI mis-scores challenged/
attributed assertions) means S8a/S8b MUST report minority classes (weakens, challenged)
separately and carry the host discourse-feature cross-check as CF4_TREATMENT_DISPUTED.

## 6. Host derived + validation (S9)
scoreTransform (adopted→normal, challenged→invert, reported→by thesisEffect); grounding
join by ID; structuredForm from S1 parse; citedWorks from NER. Findings incl.
CF4_THIN_PORTFOLIO (<5 selected), CF4_AMBIGUOUS_DROPPED, CF4_TREATMENT_DISPUTED,
CF4_SELECTION_UNKNOWN_ID.

## 7. Eval — the dry-run overlay becomes the gate

The sealed gold overlay that PageRank failed is now S6's eval:
- Run S6 on F02/F03/F06 clean inventories.
- **Gate: every crux-flagged gold appears in `selectedAssertionIds`** on each fixture
  (the exact thing PageRank missed — F06 put 0/5 cruxes above its cut; S6 must get them
  in the set). Report per fixture: cruxes selected / total cruxes, and must-select
  coverage.
- 5 repeats: crux selection stable across runs (≥4/5 per crux). Selection is a model
  call now, so variance is back in scope — measure it.
- Compare against the dead PageRank baseline to confirm the model recovers what centrality
  could not.

## 8. Sequence
1. Fix S7 ambiguity gate (span-scoped) — independent, do first, cheap.
2. Build S6 selection call. Run the §7 overlay eval on all three fixtures.
   GATE: cruxes selected on all three, stable across 5 repeats.
3. Only then build S8 labeling on survivors.
4. Codex builds stance + treatment gold labels for S8 eval (blind, sealed).

Do not build S8 before S6 passes the crux-overlay gate. Selection is the load-bearing
stage; if the model can't float the crux the deterministic graph couldn't, that's known
before labeling is built on it — same discipline as the dry-run.

## 9. Did deterministic preprocessing save anything? (the honest ledger)
KEPT (permanent, no model, previously all live failures): attribution splitting,
coreference, clause extraction, lineage, entailment gating, ~83% traceable extraction.
MOVED TO MODEL (one bounded call each): selection (S6), stance/treatment labeling (S8).
NOT a return to CF3: CF3 was one call doing everything and satisficing. Here the model
does only the semantic judgments, on clean bounded input, one objective per call. The
deterministic layer removed ~80% of the work from the model's plate and eliminated the
failure classes (fusion, invented content, runaway IDs, source→stance coupling) that
prompt engineering never fixed.
