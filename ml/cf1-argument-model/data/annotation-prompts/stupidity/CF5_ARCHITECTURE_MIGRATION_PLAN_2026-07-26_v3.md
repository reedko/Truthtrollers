# CF5 Architecture and Migration Plan — v3 (governing principle + minimal nucleus)

Date: 2026-07-26
Supersedes: `CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v2.md`
Status: planning document only — no implementation code included or authorized.

## Governing principle

> ClaimFoundry discovers what reality must look like for the article to be true. Its
> output is the minimal set of externally gradable propositions whose truth values
> determine the article's success.

Not "ClaimFoundry extracts claims." Not "summarizes assertions." Not "identifies
important sentences." Every field and every stage in this document must answer: **does
this help identify or evaluate one of those propositions?** If not, it doesn't belong,
regardless of what any prior system (CF1-CF4, or this document's own v1/v2) already
built.

This should also become the system-prompt framing for CF5's generation call once
implementation resumes — it's a stronger instruction than "which propositions would an
investigator need to verify" (the current prototype's framing), because it captures the
*determinative* character (these specific propositions' truth values decide the
article's success or failure) and the *minimal-set* character (not everything checkable
— the smallest set that decides it) that "would need to verify" doesn't.

---

## Correction from v2

v2 corrected v1's assumption that CF1's package structure was the destination. This
revision goes further: several fields v2 kept as "provisional but justified" don't
survive re-application of the governing principle once tested against concrete
examples rather than argued for in the abstract.

- `verificationQuestion` is usually a grammatical transformation of the proposition,
  not new information ("CDC omitted data" → "Did CDC omit data?"). Removed.
- `supportCondition`/`refutationCondition`/`qualificationCondition` are often
  tautological restatements of the proposition itself ("exceeds FDA limits" /
  "evidence shows exceeds FDA limits" / "evidence shows does not exceed"). Their real
  value, if any, is for causal/mechanistic claims where the proposition doesn't trivially
  imply its own falsification condition — untested, so not mandatory. Moved from
  "included field" to "explicit empirical question in §5."
- `substantiveAssertionSupplier` forced every claim's origin into a supplier/agent
  shape. Many claims don't have one — observational facts, consensus statements,
  government reports, anonymous sources. Renamed `provenance`, free-text-or-null, no
  imposed taxonomy.

---

## The minimal semantic nucleus

```json
{
  "claim": "string — self-contained, uses resolved names, not pronouns",
  "grounding": ["U0037", "U0043"],
  "articleTreatment": "adopted | challenged | reported",
  "provenance": "string or null — free text; null means the article's own voice; no imposed taxonomy (not forced into person/institution/study/document)"
}
```

Four fields. Plus one addressing field, kept separate because it isn't semantic
content:

```json
"claimId": "E001"
```

`claimId` is infrastructure — needed for dedup and repair-targeting — the same way a
database row's primary key isn't part of the row's meaning. It doesn't count against
the four-field nucleus and doesn't need to justify itself against the governing
principle the way a semantic field does.

Everything else examined in v1 and v2 — `attributionChain`, `identityBundle`,
`citedWorks` (as a structured object), `searchHints`, `evidenceWarrant`,
`bearingCriteria`/`thesisEffect`, `confidence`, `repairDiagnostics`,
`verificationQuestion`, and the three falsifiability conditions — is removed from the
mandatory schema. Every one of them must re-earn a place by proving it helps identify
or evaluate a governing-principle proposition, via the empirical procedure in §5, not
by argument.

### Field-by-field against the governing principle

| Field | Does this help identify or evaluate an externally gradable, determinative proposition? |
|---|---|
| `claimId` | N/A — addressing, not semantic content |
| `claim` | This *is* the proposition |
| `grounding` | Without it, "externally gradable" can't be checked against the article at all — a claim with no traceable origin isn't gradable, it's asserted by ClaimFoundry itself |
| `articleTreatment` | Determines what a later "refuted" finding *means* for the article's success — without it, a refutation is directionally ambiguous |
| `provenance` | Determines whether "the article confirms itself" is a live risk for this specific claim — a structural precondition for the claim being *externally* gradable rather than self-referentially gradable |

`citedWorkNames` from v2 is dropped from the mandatory nucleus too, on the same
standard applied to `verificationQuestion`: a named work is very often already present
in `claim` or recoverable from `grounding` text directly (the article's own citation is
in the source units). Move it to §5's empirical question list rather than assume it
earns a place — if claims routinely reference specific studies/documents by name in a
way `grounding` alone doesn't capture, that's a concrete, checkable defect to test for,
not an assumption to build in up front.

---

## 5. Test plan for determining whether any additional field or stage is necessary

Unchanged in structure from v2's §5 (minimal pipeline → catalog defects → prompt/schema
fix first → threshold-gated targeted fix only), re-scoped to the four-field nucleus
plus `claimId`, with three fields now explicit empirical questions rather than
removed-and-forgotten:

1. **`verificationQuestion`**: generate claims without it. Does any downstream check
   (human review, a later ER1-projection design) demonstrably need a separate question
   form, or does `claim` alone suffice? Test by having a reviewer attempt evidence
   search from `claim` alone vs. `claim` + a generated question, on the same sample,
   and check whether the question changed what was searched for.
2. **Support/refute/qualify conditions**: generate a held-out sample *with* these
   fields present (schema includes them, not mandatory in the nucleus but available for
   this test) and inspect whether GPT produces genuinely new information beyond the
   proposition's negation, specifically on causal/mechanistic claims vs. simple
   comparison/threshold claims (the aluminum-exposure example). If the tautology rate is
   high across claim types, drop permanently. If it's low specifically for
   causal/mechanistic claims, consider a conditional field (only requested/populated
   when the claim is causal) rather than a universal one.
3. **`citedWorkNames`**: catalog how often a claim references a specific named work in
   a way `grounding`'s source-unit text doesn't already make retrievable. If rare,
   confirmed unnecessary. If common, add back as a simple string array, not the v2
   structured object.
4. Everything else from v2's defect catalog (ungrounded IDs, mislabeled provenance,
   unresolved pronouns in `claim`, compound claims via the evidence-trails test,
   duplicates) — unchanged, still tested the same way, still gated by two failed
   prompt/schema-tightening attempts before any new stage or deterministic pass is
   considered, still requiring the specific observed defect to match what any reused
   CF4 code is specifically proven to fix.

---

## What's unchanged from v2

- CF1 as source of non-semantic infrastructure only (transport, source units, hashing,
  persistence, schema validation, logging, replay, fixture loading) — not the
  architectural skeleton.
- The atomicity test (split only when two halves require different evidence trails, not
  word/conjunction counting).
- No deterministic semantic enrichment stage authorized by default; existing code (CF4's
  coreference/attribution/candidate machinery) has no presumption of value and is only
  reconsidered for a named, recurring, prompt-tightening-resistant defect.
- Package structure, EvidenceRun projection design, and second-stage architecture remain
  deliberately undesigned until §5 produces results.

## Immediate next step

Unchanged: run §5 step 1 (minimal pipeline, four-field nucleus + `claimId`, no
enrichment stage, full fixture set, 5 repeats) and produce the defect catalog,
including the three explicit empirical questions above. Nothing past that point should
be acted on until the catalog exists.
