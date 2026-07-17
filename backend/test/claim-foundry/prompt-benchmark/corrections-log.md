# Contract-correction log — prompt transcription (coder plan §4)

Applied 2026-07-17 while transcribing the §§7–9 verbatim prompts into
`promptSets/`. These are the ONLY differences from the printed texts. Carry this
log into `reports/decision-record.md`.

## C1 — retired `verificationTarget: attribution` (enum is substantive | both_needed)

- **Set A:** NO EDIT REQUIRED. Set A's DISPUTED QUESTION section instructs only
  `substantive` and `both_needed`; it never names the retired value. Logged as a no-op.
- **Set B (Call 2 user, THE DISPUTED PROPOSITION AND ITS RUNG):**
  - Before: `Set verificationTarget to attribution\nwhen the dispute is whether the saying/authoring happened; substantive when it is\nwhether the underlying matter is true, recording the stipulated lower rung in\nstipulatedByArticle;`
  - After: `When the dispute is only whether the\nsaying/authoring happened, that is settled by the article-level hinge; still choose\nsubstantive or both_needed here. Set verificationTarget to substantive when it is\nwhether the underlying matter is true, recording the stipulated lower rung in\nstipulatedByArticle;`
- **Set C (Call 2 user, LOCK THE CLAIM CONTRACT bullet list):**
  - Before: `- attribution when the real dispute is whether the statement, authorship,\n  publication, record, or action occurred;`
  - After: `- when the real dispute is only whether the statement, authorship, publication,\n  record, or action occurred, that is settled by the article-level hinge; still\n  choose substantive or both_needed here;`

## C2 — `whyThisTarget` uninstructed

Decision: **leave ALL arms uninstructed** (the only choice consistent with the
control being a frozen copy of the live prompt, which is also uninstructed). The
schema forces emission; `verifySelectedEnrichment` requires it non-empty. Recorded
as a shared latent weakness and a Call 2 review dimension, identical across arms.

## C3 — `relevantNamedWorkId` → `relevantNamedWorkIds` (live field is plural)

- **Set B (SOURCES AND CONCEPTS):** `Reference a named work only via a\nrelevantNamedWorkId from the supplied pool` → `Reference a named work only via a\nrelevantNamedWorkIds entry from the supplied pool`.
- **Set C (CHOOSE THE SOURCE PATH):** `Use relevantNamedWorkId only from the allowed host pool` → `Use relevantNamedWorkIds only from the allowed host pool`.
- **Set A:** out of C3's stated scope (its phrasing "a relevantNamedWorkId supplied
  in the selected claim's allowed named-work IDs" reads as an element reference);
  left verbatim, noted here.

## C4–C7 — note-only (no text changes)

C4 (schema caps incl. searchConcepts min 2), C5 (minItems 8 floor vs "return
fewer" on long articles — filler-count review dimension), C6 (Set A's
stipulatedByArticle description), C7 (`cautions` largely uninstructed): recorded
for reviewers; no wording changed.

## History note — unlogged "C8" applied and reverted (2026-07-17)

An off-log change ("C8") was applied to the working tree after the
full-f03-screen run: the Call 2 schema gained a required `warrant` field
(v3→v4), a WARRANT VISIBILITY instruction block was prepended to the shared
Call 2 context builder for every arm including the frozen control, and the
Set B / Set C rung/warrant sentences were rewritten to instruct emission. The
full-f03-screen provenance shows every arm ran under cf1_selected_enrichment_v3
with `-v1` call2 component versions, so C8 postdated that run. Per owner
decision (baseline-integrity audit, 2026-07-17), C8 was reverted in full:
schema restored to v3, WARRANT VISIBILITY removed, Set B/C restored to the
printed §8/§9 text plus C1/C3 only, and call2 component versions restored to
`-v1`. C1–C7 above are again the ONLY differences from the printed texts.
