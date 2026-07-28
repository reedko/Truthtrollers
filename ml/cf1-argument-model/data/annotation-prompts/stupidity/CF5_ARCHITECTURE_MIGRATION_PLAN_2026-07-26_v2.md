# CF5 Architecture and Migration Plan — v2 (minimal-baseline revision)

Date: 2026-07-26
Supersedes: `CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26.md`
Status: planning document only — no implementation code included or authorized.

## Correction from v1

v1 treated CF1's existing package structure (`selectedEvaluationClaims` /
`phase3Targets` / `evidenceNeedCards`, pillars, score transforms, identity bundles) as
the presumptive destination for CF5, on the reasoning that it was already built and
tested. That reasoning is invalid on its own terms: CF1 being built and tested proves
CF1 is internally consistent, not that its fields are necessary. This revision starts
over from a minimal baseline and requires every field and stage to justify itself
independent of what already exists.

CF1 is downgraded, in this document, from "architectural skeleton" to **comparison
baseline and source of reusable non-semantic infrastructure only**: model transport,
source-unit segmentation, content hashing, artifact persistence, schema validation,
logging, replay, fixture loading. Nothing about CF1's semantic output shape is assumed
to survive.

---

## The three separated questions

### 1. What does ER1 currently consume? (fact, already researched in v1 — not re-litigated here)

Confirmed from `backend/src/evidence-run/`: a `cf1.claimPackage.v1` package containing
`selectedEvaluationClaims` + `phase3Targets` + `evidenceNeedCards`, joined by ID; the
query planner reads `evidenceNeedCard.bearingCriteria`/`falsifiability`, not raw claim
text; `assertionSource` gates a circularity-kill check (the article's own identity may
only seed a query when the article itself is the asserter); bearing (support/refute/
qualify) is assigned **post-acquisition**, never preset by ClaimFoundry.

This answers what the *current* ER1 implementation happens to read. It does not answer
question 2, and v1's mistake was treating it as if it did.

### 2. What does an evidence retrieval and evaluation system actually need? (first principles)

Strip away ER1's specific implementation and ask what *any* system that retrieves and
weighs external evidence against a claim structurally requires:

- **A proposition specific enough to search for and specific enough that some finding
  could contradict it.** Without this nothing else matters.
- **Where in the source article the proposition came from**, so a human or automated
  check can confirm the system isn't inventing content.
- **Whether the article itself is asserting this, or attributing it to someone/something
  the article merely reports** — without this, evidence that "the article's account
  matches the article" is worthless self-confirmation. This is not an ER1-specific need;
  it's a structural precondition for evidence retrieval to be meaningful at all.
- **What finding would count as support, what would count as refutation, and what would
  count as a meaningful qualification** — without at least a plain-language version of
  this, a retrieval system has no way to know when it has found something relevant, let
  alone something dispositive.
- **A stable identifier**, for the boring but real reason that any of the above needs to
  be addressable, deduplicated, and repaired.

That is five things. Everything else examined below is either derivable from these five,
inferable by a human reading the source article directly, or not needed by *any* named
consumer yet.

### 3. Given 1 and 2: retain / simplify / relocate to ER1 / remove

This is answered field-by-field in the next section, and is the actual deliverable.

---

## 1. Minimal output contract

```json
{
  "claimId": "E001",
  "canonicalProposition": "string — self-contained, uses resolved names, not pronouns",
  "groundingSourceUnitIds": ["U0037", "U0043"],
  "articleTreatment": "adopted | challenged | reported",
  "substantiveAssertionSupplier": "string or null — explicit named external supplier only; null means the article's own voice",
  "citedWorkNames": ["string", "..."],
  "verificationQuestion": "one plain-language question whose answer settles the claim",
  "supportCondition": "plain language — what finding would count as support",
  "refutationCondition": "plain language — what finding would count as refutation",
  "qualificationCondition": "plain language — what finding would meaningfully qualify rather than settle it"
}
```

Ten fields. Justified individually, applying the five questions from the prompt
(downstream decision / ER1-derivable-later / human-inferable / observed-failure /
would-we-invent-it-today) to each:

| Field | Downstream decision | ER1 could derive later? | Human could infer from simpler fields? | Observed failure requiring it | Would we invent it today? | Verdict |
|---|---|---|---|---|---|---|
| `claimId` | Addressing, dedup, repair targeting | No — needs to exist at generation time | No | None yet, but structurally necessary for any array of distinct items | Yes, trivially | **Keep** |
| `canonicalProposition` | The thing being evaluated | No | No — this *is* the thing to be inferred | N/A — this is the core output | Yes | **Keep** |
| `groundingSourceUnitIds` | Traceability, grounding verification | No — ER1 doesn't re-read the whole article per claim | Only by re-reading the entire article, defeating the point | Already caught real defects this session (unknown-unit-id checks) | Yes | **Keep** |
| `articleTreatment` | Determines what "refuted" *means* — refuting an opponent claim the article disputes is good news for the article, refuting the article's own claim is bad news | No — requires reading the article's rhetorical stance around the claim, which is exactly what generation already has full context for; re-deriving it means re-reading the article | Yes, but only by reading the source excerpt every time — defeats having a structured field | Without it, an evidence result cannot be interpreted at all (a "refute" finding is ambiguous in direction) | Yes | **Keep** |
| `substantiveAssertionSupplier` | Circularity check — is the article confirming its own claim, or reporting an independently-checkable external claim | Not without re-reading the article | Yes, from the source excerpt, but again defeats the purpose of a structured flag | This is a genuine structural precondition (§Q2), not an ER1-implementation artifact — needed by *any* evidence system to avoid self-confirmation | Yes | **Keep, simplified** — plain name-or-null, no kind/institution/person taxonomy (see §2, removed fields) |
| `citedWorkNames` | Lets a search know a specific document exists to look for | Partially — ER1 could in principle re-scan the claim text for capitalized document-like phrases, but that's strictly worse than the generation call already having read the article once | Yes, from grounding + article text | Named-work fields existed in every prior design (CF3, CF4, CF1) without controversy — the risk isn't whether to have names, it's over-structuring them (see §2) | Yes, as bare names | **Keep, simplified** — plain string array, no `type` classification, no separate `sourceUnitIds` sub-structure |
| `verificationQuestion` | Gives a retrieval system (or a human) a single, unambiguous target instead of having to infer one from the proposition | Yes, arguably — a capable retrieval system could formulate its own question from `canonicalProposition` alone | Yes, a human can formulate this themselves from the proposition | No observed failure yet — this is the most genuinely provisional field in this list | **Uncertain** — this is the one field where "would we invent it today" is a real toss-up | **Keep, provisionally** — cheap to produce alongside the proposition, easy to drop later if Part 5's test shows it adds nothing beyond the proposition itself |
| `supportCondition` / `refutationCondition` / `qualificationCondition` | Gives retrieval a falsifiability target — without at least a plain-language version, there is no way to know when a finding is dispositive versus merely related | Not reliably — inferring what would refute a claim requires understanding the claim's specific mechanism, which the generation call already has to reason through to produce the claim at all; asking ER1 to redo this from bare `canonicalProposition` risks a shallower, more generic result | Yes, a human can reason this out from the proposition, but that reintroduces manual judgment into every single claim | Directly derived from the CF1/ER1 contract's own confirmed need for `falsifiability` structure (§Q1) — the *existence* of this need is fact, not assumption; only its exact shape (four ER1-specific sub-fields vs. three plain-language conditions) is being simplified here | Yes | **Keep, as three separate plain-language fields rather than one free-text `evidenceWarrant` sentence** — this directly fixes the concrete v1 defect (evidenceWarrant was one vague boilerplate-risk sentence) without inventing ER1-specific structure (`notEnoughIfOnly`, `scope`, `evidenceRolesNeeded`, `bestSourceTypes`, `queryLaneSeeds`) this document has no evidence is needed yet |

**Even this list is provisional per the instruction.** The weakest justification in the
table is `verificationQuestion` — it may turn out to be redundant with
`canonicalProposition` once tested. Part 5 below is designed specifically to answer
that, empirically, rather than deciding it here by argument.

---

## 2. Fields to remove from the current CF5 prototype

| Field (v1/prototype) | Why it's removed, applying the five questions |
|---|---|
| `attributionChain` | No downstream decision identified that requires the *full ordered* reporting chain rather than just the substantive supplier. The one F03 run never populated it even for a claim (Thompson) that clearly has one — either the model can't reliably produce it, or nothing was checking for it, and either way it caused zero observed validation failures while empty. A human reviewer can read the grounding excerpt directly if they need the full chain. Remove from the required object entirely; if a specific future defect demonstrates a need (e.g., a claim's supplier is ambiguous without the chain), reconsider then, narrowly, for that defect only. |
| `identityBundle` (aliases/canonical name object) | The actual problem this was solving — "the agency" needing to resolve to "CDC" — is a symptom of an under-specified `canonicalProposition`, not a missing field. A proposition instructed to be self-contained and to use resolved names doesn't need a side-channel alias map; the resolution belongs *in the proposition text itself*. Remove the field; fix it by requiring self-contained naming in the generation prompt (Part 5's test will show whether the model can do this reliably without a deterministic assist). |
| `citedWorks` (rich `{name, type, sourceUnitIds}` object) | The `type` enum (study/dataset/report/law/document/researcher) answers a question no named consumer asks yet — a retrieval system can classify a document type once it locates the document; pre-classifying it doesn't save real work and adds a taxonomy the model has to get right with no way to verify it deterministically. The separate `sourceUnitIds` per work is redundant with the claim's own `groundingSourceUnitIds` in the one test case examined. Simplify to a bare name array (`citedWorkNames`, §1). |
| `searchHints` | Confirmed (v1 research) that ER1's actual query planner does not read this field. No other consumer identified. Remove outright, not just deprioritize. |
| `evidenceWarrant` | One free-text sentence, genuine boilerplate risk (v1 noted this defect without fully removing the field). Replaced by the three plain-language conditions + verification question (§1), which is a stricter, more falsifiable contract without inventing ER1-specific structure. |
| `bearingCriteria` (`thesisEffect` + `rationale`) | This answers "does this claim, if true, help or hurt the *article's argument*" — a question about the article's rhetorical structure, not about the claim's own verifiability. No consumer for it has been identified yet (not ER1, which doesn't care about the article's thesis; arguably a future scoring/aggregation stage that doesn't exist and isn't in scope — see §3). Remove from the core claim object. If a consumer is later identified, this is cheap to compute in a *separate* pass from `articleTreatment` plus the eventual evidence outcome — it doesn't need to be generated up front. |
| `confidence` | No consumer reads it (confirmed in v1 research — not used anywhere in the ER1 code inspected). An unvalidated model self-report with no way to check whether it's calibrated. Remove as a required field; if retained at all, human-view-only and explicitly labeled as an unvalidated model self-report, not a signal anything should act on. |
| `repairDiagnostics` | Already correctly host-populated, not model-generated, in the v1 implementation. Confirmed it belongs in a run-level audit sidecar, not the claim object itself — this was right in v1 and stays removed from the *semantic* package, unchanged by this revision. |

---

## 3. Fields that should move to EvidenceRun (i.e., CF5 should not attempt to produce them)

None of the following appear in the minimal contract (§1) at all — they are ER1's job,
not deferred CF5 work:

- **Query lanes, evidence roles needed, best source types, scope** — these are entirely
  about *how to search*, which is squarely ER1's problem once it has a proposition and
  falsifiability conditions. Producing them in ClaimFoundry duplicates reasoning ER1 has
  to redo anyway once it sees what sources actually exist.
- **Source-type classification for cited works** (see §2, `citedWorks.type` removed) —
  ER1 can classify a document once it retrieves it; pre-classifying from claim text
  alone is guesswork ClaimFoundry has no way to verify.
- **`notEnoughIfOnly` and similar refinement-of-refinement falsifiability structure** —
  this is a real ER1 need per the v1 contract research, but it is *derivable* from the
  three plain-language conditions in §1 once ER1 actually starts searching and
  discovers what "not quite enough evidence" looks like in practice for this specific
  claim. Building it into CF5's output before any real search has happened is
  premature — ClaimFoundry doesn't have the information to answer it yet.
- **Actual support/refute/qualify verdicts** — already confirmed (v1) to be assigned
  post-acquisition by ER1, never preset by ClaimFoundry. Not moved in this revision
  because it was never proposed as a CF5 field.

---

## 4. Fields that should be human-view-only

- **`confidence`**, if retained at all — an unvalidated model self-report, useful only
  as a triage signal for a human deciding how much scrutiny to apply, never as an input
  to automated logic.
- **The full attribution chain / reporting structure**, if a human wants it — not
  stored as a field; derivable on demand by a human reading `groundingSourceUnitIds`
  against the source article directly. No value in persisting it for every claim when
  it's needed rarely and is trivially re-derivable by reading the cited excerpt.
- **`bearingCriteria`/`thesisEffect`** (§2) — if a human reviewer wants to know whether
  a claim helps or hurts the article's case, that's a legitimate human-review question,
  just not one that needs to be pre-computed and stored on every claim before anyone's
  asked it. Compute on demand for the human-review projection, not at generation time.

---

## 5. Test plan for determining whether any additional semantic stage is necessary

The default assumption is **no additional stage**. The minimal pipeline is:

```text
article source units
→ direct evaluation-claim generation  (§1 schema)
→ structural and grounding validation (hard checks only, §6 below)
→ one targeted repair pass if needed
→ minimal canonical claim package
```

No deterministic semantic enrichment stage is authorized by default, per the
instruction. The procedure for deciding whether one becomes justified:

1. **Run the minimal pipeline across the full fixture set** (F01-F09, reusing sealed
   CF4 gold where it exists for F02/F03/F06), 5 repeats per fixture, no enrichment
   stage present.
2. **Catalog every defect observed** against the §1 fields specifically — not against
   fields that no longer exist (v1's atomicity heuristic, `identityBundle` gaps, etc.
   are moot once those fields are gone). Defects to watch for: ungrounded
   `groundingSourceUnitIds`, a `substantiveAssertionSupplier` that's actually the
   article's own voice mislabeled as external (or vice versa), a `canonicalProposition`
   that still contains an unresolved pronoun/definite description despite the
   self-contained-naming instruction, compound claims (two independently-verifiable
   propositions fused — reuse the evidence-trails test from v1's Part 5, which remains
   valid reasoning independent of the package-structure correction), duplicate claims,
   a `verificationQuestion` that's redundant with `canonicalProposition` (i.e., adds no
   information — if this shows up consistently, drop the field per §1's caveat).
3. **For every defect category, first ask: can a prompt or schema change in the
   generation call fix this, with no new stage?** This must be attempted and
   documented before any new stage is considered. Most candidate defects (unresolved
   pronouns, vague verification questions, fused supplier/work names) are plausibly
   fixable this way — tightening instructions and adding schema constraints costs
   nothing architecturally.
4. **Only if a defect (a) recurs above a set threshold (proposed: >15% of claims,
   consistent across at least 2 fixtures) and (b) is not resolved by two independent
   attempts at prompt/schema tightening**, consider a targeted deterministic fix for
   that *specific* defect — never a general "enrichment stage." A targeted fix must be
   scoped to exactly the failure observed (e.g., "resolve unresolved definite
   descriptions in `canonicalProposition`" is a valid scope; "improve semantic quality"
   is not).
5. **Reusing CF4 machinery (coreference.py, attribution.py, candidates.py) requires the
   specific observed defect to match what that specific module is proven to fix** —
   e.g., only reconsider `coreference.py` if the defect is precisely "unresolved
   definite-description mention in `canonicalProposition`," which is the exact,
   narrow thing that module's `DEFINITE_DESCRIPTION` rule addresses, and only after
   step 3 has failed for that defect specifically. Existing code has no presumption of
   value; it is a candidate fix for a named defect, evaluated like any other candidate
   fix, not a default.
6. **Report format:** for each fixture, defect catalog with counts, whether
   prompt/schema tightening resolved it (yes/no, with the before/after claims shown),
   and — only for defects that survive step 4's threshold — a specific proposal for a
   narrowly-scoped fix, not a stage.

This procedure is the actual answer to "is a semantic enrichment stage necessary" — it
is answered by evidence gathered against the minimal pipeline, not decided in advance.

---

## 6. Structural and grounding validation (hard checks only, unchanged in spirit from v1, re-scoped to the minimal §1 fields)

- `groundingSourceUnitIds` references a real source-unit ID.
- Duplicate `claimId`.
- Near-duplicate `canonicalProposition` (normalized-text match).
- Required field missing or empty (schema-enforced).
- Claim count outside an 8-15 band (informational, not a hard failure — matches the
  original spec's "approximately").

Explicitly **not** validated deterministically in this minimal version: atomicity
(handled empirically per §5, not as a standing rule), supplier/work-name correctness
(no ground truth to check against without re-reading the article, which is exactly the
re-derivation problem this whole revision is trying to avoid building by default).

---

## 7. What changes from v1's recommendations

- v1 recommended reusing CF1's `assemblePackage.js`/`verify*.js` as the package-assembly
  skeleton. This revision does not repeat that recommendation — package assembly design
  is deferred until the minimal claim contract (§1) is validated (§5), at which point
  package structure should be designed from what ER1 actually needs *given the
  validated minimal fields*, not backfilled to match CF1's existing shape.
- v1 recommended repurposing CF4's coreference/attribution/citation code as a default
  enrichment stage (Part 3/Part 4's "S3"). This revision removes that recommendation
  entirely; §5 replaces it with an evidence-gated procedure that may or may not
  conclude any of that code is needed.
- v1's Part 6 (semantic call strategy) framed the decision as "CF5's one call vs. CF1's
  two calls, pick whichever wins." This revision does not carry that framing forward —
  the call-count question is now downstream of §5's test plan (a second call is a
  candidate fix for a specific observed defect, evaluated the same way any other fix
  would be, not a pre-selected alternative architecture).
- v1's field-by-field table (Part 2) is superseded by §1/§2 above, which apply a
  stricter, uniform justification standard (all five questions, for every field,
  independent of ER1's current shape) rather than starting from "does ER1 currently use
  this."
- v1's Parts 9-13 (migration phases built around CF1 integration, file-by-file
  disposition built around CF1 reuse, risks framed around duplicating CF1) are not
  carried forward as written. They are premature until §5's test plan produces results
  — a migration plan for package/integration work should be written after the minimal
  contract is validated, not before.

---

## 8. What is retained from v1 without change

- The reasoning in v1's Part 5 (atomicity: split only when two halves require different
  evidence trails, not word/conjunction counting) — this is independent of package
  structure and remains the right test, now applied inside §5's procedure.
- CF1 as a source of **non-semantic** infrastructure (model transport, source-unit
  segmentation, hashing, artifact persistence, schema validation, logging, replay,
  fixture loading) — explicitly requested to remain reusable, and nothing in v1's
  research contradicts that; only the *semantic* shape (package fields, pillars, score
  transforms, identity registries) is now treated as unproven rather than presumptive.
- The confirmed facts about ER1's current implementation (§Q1) — these remain accurate
  as a record of what exists today; they are just no longer treated as normative for
  what CF5 should produce.

---

## 9. Immediate next step

Run §5 step 1 (minimal pipeline, §1 schema, no enrichment stage, full fixture set, 5
repeats) and produce the defect catalog from step 2. Nothing past that point in this
document should be acted on until that catalog exists — this document is deliberately
silent on package structure, EvidenceRun projection design, and any second-stage
architecture because those are premature per the instruction, not because they don't
matter eventually.
