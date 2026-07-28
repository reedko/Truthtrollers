# CF5 Architecture and Migration Plan

Date: 2026-07-26
Status: planning document only — no implementation code included or authorized by this
document. Produced per the "CF5 Architecture and Migration Plan" request; governed by
`CF5_PROTOTYPE_DIRECT_CLAIM_GENERATION_2026-07-26.md` and the CF1/ER1 handoff docs cited
throughout.

---

## 0. A finding that changes the shape of this plan

Before Part 1, one fact has to be stated up front because it changes what "migration"
means: **a mature, tested, not-yet-live ClaimFoundry implementation already exists** at
`backend/src/claim-foundry/`, referred to as CF1 in this repo's own docs
(`docs/cf1_er1_project_handoff_mct.md`). This is a different thing from
`backend/experiments/cf1/` and the numbered experiment tracks (CF2/CF3/CF4) this session
has been debugging.

CF1 (the production candidate, not the experiment) already has:

- a **compact two-call selected-enrichment path** — Call 1 generates core claims, Call 2
  enriches only the selected ones (identity, cited works, etc.) — this is exactly "Option
  B" from Part 6 of the requested plan, already built (`oneCallAgentOutput.js`,
  `twoCallAgentOutput.js`, `agentDraftSchema.js`);
- full package assembly, canonical hashing, and verification (`assemblePackage.js`,
  `verifyPackage.js`, `verifyTargetCards.js`, `verifySourceIdentity.js`,
  `verifyProvenance.js`, `verifyFieldShapes.js`) against the exact package format ER1
  actually consumes (`cf1.claimPackage.v1`);
- a working repair contract (`applyRepair.js`, `repairContract.js`);
- a pillar/thesis-hinge/target-type contract (`contract.js`) — notably, this is the same
  "pillar" architecture the CF5 spec explicitly rejects ("No pillar assignment... No
  thesis-to-candidate mapping"), but built and validated, not abandoned mid-experiment;
- clean runs on **all 8 fixtures (F01-F08)**, zero repair calls, $0.0217 total API cost,
  464 seconds model time, 98,038 tokens (per
  `artifacts/claim-foundry/agent-runs/eight-fixture-compact-20260715/`).

CF1 is **not yet live** — the handoff doc is explicit: *"Do not claim CF1 has replaced
the live producer. It has not."* Acceptance gates (blind comparison, quality/reliability
judgment, live scrape integration, controlled cutover) are unchecked.

**This means the real decision is not "should CF5 replace CF4."** CF4 was already a
dead-end experiment track (this session spent all day proving its selection stage
fails). The real decision is: **does CF5's one-call direct-generation hypothesis beat
CF1's already-working two-call compact path enough to justify rebuilding CF1's
substantial, tested package/verification/repair/ER1-integration infrastructure around
it — or should CF5's generation *strategy* be validated as a replacement for CF1's Call-1
prompt specifically, reusing everything CF1 already built downstream of claim
generation?**

This plan is written with that reframing. Part 16 makes the recommendation explicit.

---

## Part 1: Desired output contracts

### A. EvidenceRun (ER1) — confirmed from `backend/src/evidence-run/`

ER1 does not consume a flat claim object or raw claim text. It consumes an **immutable,
hash-verified CF1 package** referenced by ID (`requestSchema.js`: `packageId` matching
`^cf1pkg_`, `expectedPackageSchemaVersion: "cf1.claimPackage.v1"`,
`expectedPackageHash`). The package must contain three joined arrays, not one:

```text
selectedEvaluationClaims   — the claim itself
phase3Targets              — 1+ evaluation targets per claim (targetId, targetType,
                              targetText, scoreTransform, verdictEligible, sourceUnitIds,
                              identityBundleIds, namedWorkIds)
evidenceNeedCards          — 1 per searchable target (bearingCriteria.mustMatch/
                              shouldMatch/rejectIfOnly, falsifiability.wouldSupportIf/
                              wouldRefuteIf/wouldQualifyIf/verificationQuestion/
                              notEnoughIfOnly, scope, evidenceRolesNeeded,
                              bestSourceTypes, queryLaneSeeds)
```

**Required for ER1 execution:**
- `claimText` / `canonicalProposition` — used as a fallback term source only, not the
  primary search input;
- `sourceUnitIds` — on both claim and target, used for context-work routing;
- `assertionSource` — used by the query compiler's circularity-kill logic: the article's
  own identity may only seed a query when the article itself is the asserter
  (attribution-graded target); this field must cleanly distinguish "article voice" from
  "external named source" or the circularity-kill logic breaks;
- `articleRole` / `articleUse`, `materiality`, `themeBearing`, `relatedPillarIds` — used
  to build the target portfolio and prioritize;
- **`evidenceNeedCard`** (per target) — this is what actually drives query generation.
  `bearingCriteria` and `falsifiability` here are a different, richer object than
  anything CF5 currently produces (see Part 2).
- `identityBundleIds`, `namedWorkIds` — referenced by ID, resolved elsewhere (identity
  registry), not embedded per-claim.

**Useful but optional for ER1:** `searchHints` (only if they demonstrably beat query
terms ER1 can derive itself from `evidenceNeedCard` — no evidence yet that they do;
ER1's actual query planner does not read a `searchHints` field at all today).

**Not needed by ER1:** `confidence` (not read anywhere in the query/portfolio code
inspected), free-text `evidenceWarrant` (superseded by the structured
`falsifiability`/`bearingCriteria` shape ER1 actually consumes).

**Confirmed NOT determined by ClaimFoundry:** support/refute/qualify bearing itself.
`ER1_BEARING_TYPES` (`support/refute/qualify/context/provenance/non_bearing/unclear`) is
assigned **post-acquisition**, after real evidence is read. ClaimFoundry supplies
falsifiability *criteria* (what would count as support/refute/qualification), never a
preset verdict.

### B. Human review

Minimum: `canonicalProposition` (what), `assertionSource` (who), `articleTreatment`
(how the article uses it — adopted/opponent/reported), `groundingSourceUnitIds` +
excerpt (where), `evidenceWarrant`/`falsifiability` in plain language (what would
settle it), and a one-line "why it matters" (materiality/bearing rationale). Everything
else (schema version, prompt hash, token usage, repair history) is audit noise for a
human reviewer and should be hidden by default, not deleted.

### C. Audit and provenance

Minimum: model name + version, prompt hash, schema hash, request/response IDs, token
usage, article content hash, source-unit ID set the article actually has (for grounding
verification), validation findings, repair attempt record (what changed and why). CF1's
existing `verifyProvenance.js` and canonical-hashing infrastructure already does this —
reuse it rather than rebuild it. This should live in a **run-level sidecar**, not be
duplicated onto every claim object.

---

## Part 2: Assessment of the current CF5 prototype schema

| Field | Classification | Notes |
|---|---|---|
| `claimId` | essential | Stable ID needed for dedup, repair addressing, and cross-run identity. Keep at claim level. |
| `canonicalProposition` | essential | The claim itself. Model-generated; this is the one field that must remain semantic. |
| `groundingSourceUnitIds` | essential | Required by ER1 for context routing and by human review for "where." Model-generated but host-verifiable (unit IDs must exist — already checked). |
| `assertionSource` | **incorrectly modeled** | Confirmed load-bearing for ER1's circularity-kill logic, but the F03 test fused a person + a document category into one name string (`"William Thompson (CDC whistleblower) and FOIA obtained documents"`, `kind: "study"`). This is a real defect, not a cosmetic one — it breaks the exact mechanism ER1 uses this field for. See §2.1. |
| `attributionChain` | useful but derivable | F03 test never populated it (always empty array) even for a claim that clearly *has* an attribution chain (Thompson revealing CDC's action). Either the prompt isn't eliciting it or the model is folding attribution into `assertionSource` instead — same root cause as the assertionSource defect. Should be **derived deterministically from `assertionSource` + article text** where possible (reuse CF4's attribution-split logic as a **verification/enrichment pass**, not as upstream extraction) rather than trusted as freely model-generated. |
| `articleTreatment` | essential | Required for `scoreTransform` derivation and human review. Zero label diversity in the one test run so far — untested against gold, flag as open risk, not yet a defect. |
| `identityBundle` | useful only for humans (as currently modeled) | ER1 consumes `identityBundleIds` — references into a separate identity registry, not an inline bundle. Current CF5 field is a nice human-readable aliasing note but does not match what ER1 needs. Should move to a **sidecar produced by a bounded enrichment pass**, keyed and referenced by ID, not embedded per-claim. See §2.2. |
| `citedWorks` | useful but derivable | ER1 wants `namedWorkIds` (registry references), not embedded work objects. Deterministic NER/document-pattern extraction (already built in CF4's `candidates.py` as `cited_works()`) is a better source of truth than free-text model generation for this field — cheaper, auditable, and doesn't need a model call at all. |
| `searchHints` | **premature** | Not consumed by ER1's actual query planner today (confirmed — `queryPlanner.js`/`queryCompiler.js` build queries from `evidenceNeedCard`, not a `searchHints` array). Retain only if a specific test shows ER1 retrieval quality improves with it; otherwise drop it rather than carry an unused field indefinitely. |
| `evidenceWarrant` | **redundant / needs a stricter contract if retained** | One free-text sentence. ER1 needs `falsifiability.{wouldSupportIf, wouldRefuteIf, wouldQualifyIf, verificationQuestion, notEnoughIfOnly}` — four to five distinct, structured fields, not one sentence. Either replace this field with that structure, or drop it and let a later enrichment pass produce the real `evidenceNeedCard`. |
| `bearingCriteria` (`thesisEffect`/`rationale`) | **useful but answering a different question than its name implies** | This is the CF3-style counterfactual ("if true, does it strengthen/weaken the article's thesis") — a real, useful field for human review and `scoreTransform`, genuinely different from ER1's falsifiability criteria (what evidence outcome would confirm/refute the claim itself, independent of the article's argument). Both are needed; they should not share one field name. Rename this one `thesisEffect` plainly and add falsifiability separately. |
| `confidence` | useful only for humans | Not read by ER1. Keep as a lightweight human-review triage signal only; do not let it gate anything downstream. |
| `repairDiagnostics` | **audit metadata, mixed into the semantic object** | Already correctly host-populated, not model-generated. Should live in the audit sidecar (Part 1C), not inline on the semantic claim, per the spec's own instruction not to mix these. |

### 2.1 `assertionSource` — the fix

Use the discourse-provenance distinction already designed (and partially built) in this
codebase's CF4 history (`CF4_FINAL_SOLUTION_MCT_2026-07-24.md`): separate

```text
reportingVoice        — who presents the surface statement (often article_voice)
contentSupplier       — who actually supplies the substantive content (deepest
                         attribution layer's speaker, or reportingVoice if none)
citedWorks            — named studies/documents/datasets referenced, kept distinct
                         from both of the above
```

`assertionSource` as currently modeled conflates all three into one name string. The
fix is not a bigger free-text field — it's requiring the model (or a deterministic
enrichment pass) to keep these three separate, matching what ER1's circularity-kill
logic actually branches on (is the article itself the asserter, yes/no).

### 2.2 `identityBundle` — where it belongs

Recommendation: **derived from article preprocessing + a bounded enrichment pass, not
generated in the core semantic call.** Entity/alias resolution ("the agency" → "CDC")
is exactly the kind of task CF4's deterministic coreference work already does
reasonably well (`coreference.py`'s definite-description resolution) — do not make core
claim generation depend on the model getting entity resolution right in the same call
where it's also doing the harder job of deciding what the claims are. Store as a
sidecar, keyed by canonical entity, referenced from claims by ID once resolved.

### 2.3 `searchHints` — recommendation

Drop from the core schema. If ER1's query planner is later found to benefit from
model-supplied hints, add them as an ER1-side enrichment of `evidenceNeedCard`, not a
CF5 claim field — that keeps the boundary "ClaimFoundry decides what to test, ER1
decides how to search" intact.

### 2.4 `evidenceWarrant` — recommendation

Replace with the actual `falsifiability` structure ER1 needs
(`wouldSupportIf`/`wouldRefuteIf`/`wouldQualifyIf`/`verificationQuestion`/
`notEnoughIfOnly`). This is a stricter, more useful contract than one free sentence, and
it's the field ER1 is already built to consume — there is no reason to invent a
different shape.

### 2.5 `bearingCriteria` — recommendation

Split into two distinct fields: `thesisEffect` (strengthens/weakens/no_effect + one-line
rationale — the counterfactual-argument-mapping question) and the `falsifiability`
structure from §2.4 (the evidence-outcome question). Do not let one field answer both.

---

## Part 3: CF4 preserve / simplify / remove / archive matrix

| Component | Disposition | Notes |
|---|---|---|
| `backend/src/claim-foundry/article-document/*` | **preserve unchanged** | Shared, already reused by CF3/CF4/CF5. Ingestion, HTML/PDF handling, source-unit segmentation/IDs, content hashing. |
| `backend/src/claim-foundry/modelRunner.js`, `openAiResponsesTransport.js` | **preserve unchanged** | Shared model transport, strict schema handling. Already reused by CF5. |
| `backend/experiments/cf4/coreference.py` | **preserve, repurpose** | Currently used as upstream extraction input. Repurpose as a **deterministic enrichment/verification pass** on model-generated claims (identity bundle resolution, per §2.2) rather than removing it. |
| `backend/experiments/cf4/attribution.py` | **preserve, repurpose** | Same repurposing as coreference.py — verify/derive `attributionChain` and disambiguate `assertionSource` against the article text, post-generation, rather than feeding a candidate pool. |
| `backend/experiments/cf4/candidates.py` (`cited_works()` only) | **preserve, repurpose** | Deterministic NER/document-pattern citation extraction is a better source of truth for `citedWorks` than model free-text generation. The rest of `candidates.py` (clause extraction, `testable()`, span pruning) is obsolete under CF5. |
| `backend/experiments/cf4/parser.py` | **preserve** | spaCy wrapper, still needed by the repurposed coref/attribution/citation passes. |
| `backend/experiments/cf4/ambiguity_gate.py` | **archive** | Built for a selection-survivor gate that no longer exists under direct generation. The span-scoped essential-referent logic could be repurposed as a claim-level check ("does this claim depend on an unresolved referent"), but nothing currently calls it that way — do not keep it silently wired to nothing. |
| `backend/experiments/cf4/phase1.py`, `run-phase1.mjs`, `prepare-phase1.mjs` | **remove from active path, archive** | This *is* "deterministic assertion generation" — the exact thing the CF5 spec instructs to remove. Keep for regression comparison per Part 3's archive rule. |
| `backend/experiments/cf4/score_phase1.py`, `score-phase1.mjs` | **archive** | Scores the candidate-pool recall gate that no longer applies once there's no candidate pool. Keep for historical fixture comparison only. |
| `backend/experiments/cf4/run-s6-selection.mjs`, `prompts.js` (S5/S5b/S6 portions), `schemas.js` (selection/subtheses portions), `score-s6.mjs`, `subtheses_redundancy.py`, `semantic_redundancy.py`, `phase2-host.mjs` | **remove from active path, archive** | This is the selection-from-inventory machinery this entire session's debugging thread was built around, and it never passed its own gate (Thompson crux 0/5 across three prompt variants). Direct evidence it should not carry forward. Keep artifacts for the regression-comparison record; do not keep the code live. |
| `backend/experiments/cf4/gold/*`, `test/claim-foundry/fixtures/*` | **preserve unchanged** | Sealed gold keys and fixtures are fixture-framework infrastructure, reusable by CF5's own test matrix (Part 8). |
| `backend/src/claim-foundry/{contract.js, assemblePackage.js, verify*.js, applyRepair.js, repairContract.js, oneCallAgentOutput.js, twoCallAgentOutput.js}` | **preserve unchanged, target for reconciliation** | This is CF1 proper (§0). Not CF4 at all, but the single largest reason this plan cannot recommend a green-field CF5 buildout: replacing this outright would discard tested package assembly, verification, and a two-call generation path that may already do most of what CF5 is trying to prove. |

**Deletion condition for archived code:** delete only after (a) Part 8's fixture test
matrix has run to completion on the promoted architecture and (b) the archived module's
artifacts have been referenced at least once in the go/no-go writeup, so there is a
record of what was compared against. Until then, archived modules move to
`backend/experiments/cf4/_archive/` (or equivalent) — physically moved, not merely
unreferenced, so nothing in the active path can silently still import them.

---

## Part 4: Proposed primary pipeline

```text
S0  article ingestion + source-unit segmentation      [deterministic, unchanged]
S1  direct evaluation-claim generation                [1 model call — see Part 6]
S2  deterministic validation                           [host, see Part 7]
S3  deterministic enrichment                            [host: coref/attribution-derived
                                                         identityBundle, attributionChain
                                                         verification, NER-derived
                                                         citedWorks — see §2.1-2.3]
S4  repair pass (only for hard failures from S2)        [bounded model call, ≤1]
S5  package assembly + verification                     [host — reuse CF1's
                                                         assemblePackage.js/verify*.js]
S6  human projection                                    [host — Part 1B fields only]
S7  EvidenceRun projection                              [host — Part 1A fields only]
```

| Stage | Purpose | In | Out | Owner | Mandatory? | Evidence it's needed |
|---|---|---|---|---|---|---|
| S0 | Canonical text, source units | raw article | units + IDs | deterministic | yes | Every downstream stage needs stable unit IDs; already proven across CF1-CF4. |
| S1 | Generate claims directly | article + units | raw claims | semantic (1 call) | yes | This is the entire CF5 hypothesis; F03 test result is the evidence (Thompson crux recovered on first try). |
| S2 | Grounding/duplicate/schema checks | raw claims | validated claims + findings | deterministic | yes | Prevents ungrounded claims reaching ER1; already built and exercised (zero false negatives in the one F03 run — no unknown-unit-id claims slipped through). |
| S3 | Fix `assertionSource`/`attributionChain`/`citedWorks` deterministically | validated claims + article | enriched claims | deterministic | **contested — see Part 5/6** | Directly addresses the observed §2.1 defect (E006's fused source name). Alternative: fix via prompt/schema tightening in S1 instead (Option A in Part 6) rather than adding a stage. |
| S4 | Fix hard failures only | failed claims + findings | corrected claims | semantic (≤1 call) | yes, but rare | Already built and specified; never triggered in the one F03 run (0 hard failures) — needs a test that actually forces it before calling it validated. |
| S5 | Assemble immutable package | enriched claims | `cf1.claimPackage.v1` | deterministic | yes | This is the literal ER1 handoff contract (§0, Part 1A) — reuse, do not rebuild. |
| S6 | Human-readable projection | package | review view | deterministic | yes | Part 1B. |
| S7 | ER1-facing projection | package | `selectedEvaluationClaims` + `phase3Targets` + `evidenceNeedCards` | deterministic | yes | This is the gap CF5's current schema doesn't close yet (Part 2) — the three-array package shape does not exist in CF5 today and must be built before ER1 can consume anything from this path. |

No stage exists here "to improve quality in the abstract" — S3 is the one genuinely
debatable addition, and it's included only because the F03 test produced a concrete,
observed defect (fused source identity) that a stage can deterministically fix. Part 5
and Part 6 examine whether S3 should be a separate stage or folded into S1's own
prompt/schema design instead.

---

## Part 5: Atomicity strategy

The F03 result: 8 of 11 claims flagged `CF5_CLAIM_POSSIBLY_COMPOUND` by a crude
word-count/conjunction heuristic. The spec is explicit that word/conjunction counting
must not be the final judgment. Distinguish:

| Category | Example from F03 | Should split? |
|---|---|---|
| Compound: two independently gradable claims | E006 — MMR-autism data manipulation AND thimerosal-autism data manipulation are two separately verifiable propositions, fused by "and" | **Yes** |
| Complex but one gradable proposition | E003 — dose count rose 5→73 *and* chronic conditions rose 12.8%→54% "correlating with" — this is one claim (a correlation), not two | **No** — splitting destroys the claim being made, which is the correlation itself |
| Claim + its evidence basis | E001 — "78.3% of deaths... occurred within seven days" is the claim; "reported to VAERS" is the evidence basis, not a second claim | **No** |
| Claim + consequence | (not clearly present in the F03 set, but general case) — "X happened, causing Y" | **Depends**: if Y is independently gradable and load-bearing on its own, split; if Y is just characterizing X's severity, keep together |
| Comparison requiring both sides | E004 — "exceeds the 25mcg/day limit... and can surpass 1000mcg... without safety testing" — the comparison *is* the claim | **No** |

**Decision rule:** split only when the two halves would need **different evidence
searches** to verify (different `falsifiability` criteria) — that is a directly testable
proxy for "independently gradable" and avoids re-deriving atomicity from syntax. A
claim like E006 fails this test cleanly: verifying the MMR-autism manipulation and the
thimerosal-autism manipulation genuinely requires two different evidence trails. E003
passes (one correlation, one evidence trail) despite being syntactically compound.

**Where this check belongs:** in S2 (deterministic validation) as an
`CF5_CLAIM_COMPOUND_EVIDENCE_TRAILS` finding, computed by checking whether the claim's
grounding spans multiple distinct source-unit clusters that don't share a topic/entity
(a cheap deterministic proxy, not NLI) — informational by default, escalated to a
repair-triggering hard failure only once the "same entity/different-verification-path"
heuristic has been validated against gold on the Part 8 fixture set. **Do not silently
promote this to a hard gate before that validation** — it directly restages the
CF4-style mechanical-conjunction-splitting failure mode the spec warns against if done
carelessly.

**Repair behavior for a confirmed compound claim:** the repair call (S4) should be
instructed to split it into N claims that each remain independently meaningful,
inheriting a shared `groundingSourceUnitIds` union but distinct
`canonicalProposition`/`falsifiability`, and to record a `CF5_SPLIT_FROM: <original
claimId>` provenance note — not silently discard the original.

---

## Part 6: Semantic call strategy

CF1 already answers most of this empirically (§0): the compact two-call path is real,
tested, and clean across 8 fixtures. CF5 has one call, tested on one fixture.

| | Option A (CF5 today: 1 call) | Option B (CF1 today: 2 calls, generate + enrich) | Option C (1 call + claim-level repair only) |
|---|---|---|---|
| Semantic coherence | High on the one test (Thompson crux recovered) | Unknown — not yet compared head-to-head on the same fixture with the same gold | Same as A for generation; repair scope is narrower than B's enrichment |
| Output size / token cost | 16,232 tokens, F03 (largest fixture) | 98,038 tokens / 8 fixtures ≈ 12,255 tokens/fixture average — **lower per-fixture cost than A's single F03 sample**, though not a controlled comparison | Between A and B, depends on repair frequency |
| Variance | Untested — only one run so far | Untested at the repeat level in the artifacts reviewed | Untested |
| Attribution accuracy | **Confirmed defective** (§2.1, fused source) | Unknown — needs direct check against CF1's `verifySourceIdentity.js` output | Same defect as A unless S3 (Part 4) fixes it deterministically |
| Repairability | 1 bounded pass, untriggered so far (no forcing test yet) | Already has `applyRepair.js`/`repairContract.js` battle-tested at 0 repairs/8 fixtures | Same mechanism as A |
| Schema complexity | 12 required fields, flat | Two schemas (draft + enrichment), more moving parts | Same as A |
| Testability | New harness, one fixture so far | Existing fixture harness, 8 fixtures already passing | New harness needed |

**Recommendation: do not decide this in the abstract.** Run CF5's Option A prompt
against the **same 8 fixtures CF1 already has clean runs for**, using the same gold
comparison infrastructure CF1's handoff doc references (§0's "fixture-wide blinded
comparative adjudication" — itself still an open CF1 gate, not just a CF5 one). If
Option A matches or beats Option B's attribution/grounding accuracy at lower or equal
cost, adopt Option A and treat Option B's `twoCallAgentOutput.js` as the fallback
enrichment path for the specific fields Option A is measured to handle worse (most
likely `assertionSource`/`identityBundle`, per the one F03 defect already observed) —
which is effectively Part 4's contested S3 becoming a **model-based** enrichment call
rather than a deterministic one, if the deterministic version (coref/attribution reuse)
turns out insufficient. This is a decision to make after Part 8's test matrix, not
before.

---

## Part 7: Validation and repair boundaries

### Hard failures (block, trigger S4 repair)
- `groundingSourceUnitIds` / `assertionSource.sourceUnitIds` / `citedWorks[].sourceUnitIds` reference a non-existent unit ID (`CF5_UNKNOWN_UNIT_ID` — already built).
- Schema violation (strict JSON schema — already enforced at the transport level).
- Duplicate `claimId` (already built, currently auto-dropped rather than repaired — reconsider: silently dropping loses a claim rather than fixing an ID collision; should probably repair the ID, not the content).
- Claim not externally gradable — no observable evidence outcome could confirm or refute it (needs a new check once `falsifiability` replaces `evidenceWarrant`, §2.4; not built yet).
- Missing required claim content (already enforced by strict schema `minLength`/`minItems`).

### Repairable semantic defects (send to S4, not a hard block on their own unless combined with a hard failure above)
- Confirmed compound claim (different evidence trails, Part 5) — `CF5_CLAIM_COMPOUND_EVIDENCE_TRAILS`.
- Fused source identity — person/institution/document conflated in one `assertionSource` (§2.1) — needs a new deterministic check (does `assertionSource.name` contain a personal name pattern *and* a document/report pattern together) before this can be auto-detected; not built yet.
- Generic/boilerplate `evidenceWarrant` or `falsifiability` (needs a specificity check — e.g., flag if `wouldRefuteIf` is a near-negation of `wouldSupportIf` with no added information, or if the text is short/generic relative to the claim's specificity) — not built yet.
- Bearing criteria that don't actually specify distinct support/refute/qualify conditions (same specificity check as above, applied to `bearingCriteria`).

### Informational only (never gate, never trigger repair)
- `CF5_CLAIM_POSSIBLY_COMPOUND` (the current crude heuristic) — demoted from its current de facto role once the evidence-trails check (Part 5) exists; keep as a cheap first-pass flag feeding a human review queue, not a repair trigger.
- Low `confidence`.
- Unusually broad `groundingSourceUnitIds` span.
- Missing `searchHints` (if the field survives Part 2's recommendation to drop it, this becomes moot).

Word count and conjunction count, as the spec instructs, may **trigger a look** —
routing to the `CF5_CLAIM_POSSIBLY_COMPOUND` informational bucket above — but must never
be the final atomicity judgment on their own; Part 5's evidence-trails check is that
judgment once built and validated.

---

## Part 8: Test plan before implementation

### Fixture coverage
Reuse the existing fixture set at `backend/test/claim-foundry/fixtures/` (F01-F09
confirmed present) plus the sealed CF4 gold keys (F02/F03/F06) already built this
session. Explicitly select or confirm coverage for: advocacy article (F03, already
tested), neutral reporting, an article containing opponent claims the article rebuts,
an internally contradictory article, an article relying on named studies (F03 partially
covers this), an article relying on laws/documents/datasets/whistleblowers (F03 covers
whistleblower), an article with a weak/unclear central case, and a case where
abstention (fewer than 8 claims, or explicit non-gradable content) is the correct
answer — this last category has **zero coverage today**; F03 alone cannot validate it.

### Claim-set quality metrics
- Central-case/crux recall — reuse the exact crux-overlay methodology built this session
  (`score-s6.mjs`'s consistency-fixed matching logic), pointed at CF5 output instead of
  a selection output. This machinery already exists; it needs its input source swapped,
  not rebuilding.
- Omission of rhetoric/anecdote — spot-check against `justifiedOmissions` already present
  in the sealed gold files (`backend/experiments/cf4/gold/*.gold.json`).
- Proposition distinctness — the evidence-trails duplicate/compound check (Part 5).
- External gradability, source-unit grounding, attribution correctness, article-treatment
  correctness — direct field checks against gold's `expectedSource`/`crux`/
  `groundingUnitIds` fields, already-built comparison infrastructure.
- Bearing usefulness — no existing gold coverage; needs new adjudicated labels (the CF1
  handoff doc's own open gate — do not duplicate that adjudication effort, coordinate
  with whoever owns it).

### Reliability
- Repeated-run stability: run 5x per fixture (matching this session's established
  methodology), track claim-set overlap and per-crux stability.
- Claim identity stability across runs: not currently testable — `claimId` is
  freshly assigned each run with no cross-run linkage; if EvidenceRun needs to
  re-verify the "same" claim later, this needs a stable-identity scheme (likely a
  content-hash-derived ID, not a sequential one) before production use.
- Repair frequency/success: needs a fixture that actually forces `CF5_UNKNOWN_UNIT_ID`
  (none observed yet) — construct one deliberately (e.g., a synthetic bad-grounding
  test) rather than waiting for it to occur naturally.
- Token/latency cost: already measured once (16,232 tokens, F03). Needs the same
  measurement across the full fixture set for a fair comparison against CF1's existing
  98,038-token/8-fixture baseline.

### Comparison against CF4 and CF1
Compare against **both**, not just CF4: CF4's selection-from-inventory failure mode
(this session's whole record) is now well-established evidence and doesn't need
re-litigating. The comparison that actually matters is CF5 vs. CF1's compact two-call
path (Part 6) — same fixtures, same gold, same cost accounting.

### Acceptance thresholds (explicit, not "looks better")
- Crux recall: 100% of gold-flagged cruxes present in the claim set, stable ≥4/5 repeats, on every fixture in the test matrix — this mirrors the exact gate CF4's selection stage was held to and failed.
- Zero confirmed fused-identity defects (§2.1 class) on a held-out fixture sample after the S3 fix (Part 4) is in place.
- Compound-claim rate (using the evidence-trails check, not word count) below a to-be-set ceiling — propose starting at ≤15% of claims, revisit after real data from the full fixture set (8/11 = 73% under the crude heuristic is not usable evidence for this threshold; it used the wrong test).
- Token/latency cost at or below CF1's existing 8-fixture baseline, or an explicit written justification for exceeding it.
- Package validity (schema + hash + grounding verification) at 100% before any repair pass, or 100% after at most one repair pass.

---

## Part 9: Migration phases

### Phase 1 — output contract
Finalize the claim/target/evidenceNeedCard three-layer shape from Part 1A and Part 2
(§2.1-2.5 field corrections). Files: `backend/experiments/cf5/schemas.js`,
`backend/experiments/cf5/prompts.js`. Deliverable: a schema that actually matches what
`backend/src/evidence-run/schemas/requestSchema.js` and `targetPortfolio.js` consume —
today it does not.

### Phase 2 — semantic prototype refinement
Fix only the defects Part 2/5 identified with concrete evidence: `assertionSource`
fusion (§2.1), `evidenceWarrant`→`falsifiability` restructure (§2.4),
`bearingCriteria` split (§2.5). Do not add speculative fields. Files:
`backend/experiments/cf5/prompts.js`, `schemas.js`, `validation.js`.

### Phase 3 — fixture validation
Execute Part 8's test matrix, including the CF1 head-to-head comparison (Part 6).
Files: new `backend/experiments/cf5/score-cf5.mjs` (reusing `score-s6.mjs`'s
consistency-fixed matching logic, retargeted), fixture runs across F01-F09.
Deliverable: the go/no-go data Part 8's acceptance thresholds are checked against.

### Phase 4 — production integration
Only after Phase 3's thresholds pass. Route through **CF1's existing package assembly
and ER1 integration** (`assemblePackage.js`, `verify*.js`) with CF5's prompt/schema as
the new Call-1 semantic source, rather than building parallel package infrastructure.
This is the direct consequence of §0's finding — do not duplicate what already works.
Keep CF1's own current generation path (whichever of one-call/two-call Part 6 doesn't
select) as a documented fallback/comparison path, not a silent alternate route. Files:
wherever CF1's agent-stage dispatch currently selects `oneCallAgentOutput.js` vs.
`twoCallAgentOutput.js` — add CF5's approach as a third selectable path there, not a new
parallel pipeline.

### Phase 5 — removal
Archive CF4's extraction/selection modules (Part 3's remove-list) to
`backend/experiments/cf4/_archive/` once Phase 3's comparison data is captured in a
written record referencing them. Do not delete outright — CF1's own acceptance gates
(§0) require "rollback proof" before any producer is retired; the same discipline
applies here.

For each phase: rollback is "the previous phase's routing/files are untouched until
this phase's completion criteria are met" — nothing in Phases 1-3 touches the live path
at all, since neither CF1 nor CF4 is currently live-cut-over (§0).

---

## Part 10: Attribution and identity model (summary — full detail in §2.1-2.2)

Three distinct roles, never collapsed into one field:
`reportingVoice` (article_voice, almost always), `contentSupplier` (deepest attribution
layer's speaker — may equal reportingVoice), `citedWorks` (named studies/documents,
never treated as a speaker). Identity resolution (aliases, canonical naming) lives in a
sidecar keyed by canonical entity, produced by a bounded deterministic or enrichment
pass, referenced from claims by ID — never generated inline as free text in the core
semantic call, per §2.2's reasoning (don't make claim generation depend on getting
entity resolution right in the same breath as the harder judgment call).

---

## Part 11: Exact repository files likely affected

**New/modified (CF5):**
`backend/experiments/cf5/schemas.js`, `prompts.js`, `validation.js`, `run-cf5.mjs`
(all four already exist from this session's prototype; Phase 1-2 modify them in place),
new `backend/experiments/cf5/enrichment.js` (Part 4's S3, if built deterministically),
new `backend/experiments/cf5/score-cf5.mjs` (Phase 3).

**Reused unchanged:**
`backend/src/claim-foundry/article-document/*`, `modelRunner.js`,
`openAiResponsesTransport.js`, `contract.js`, `assemblePackage.js`, `verify*.js`,
`applyRepair.js`, `repairContract.js`.

**Repurposed (from CF4 experiment to CF5 enrichment):**
`backend/experiments/cf4/coreference.py`, `attribution.py`, `parser.py`,
`candidates.py` (citedWorks function only).

**Archived (Phase 5, not deleted):**
`backend/experiments/cf4/phase1.py`, `run-phase1.mjs`, `prepare-phase1.mjs`,
`score_phase1.py`, `score-phase1.mjs`, `run-s6-selection.mjs`, the S5/S5b/S6 portions of
`prompts.js`/`schemas.js`, `score-s6.mjs`, `subtheses_redundancy.py`,
`semantic_redundancy.py`, `phase2-host.mjs`, `ambiguity_gate.py` (unless repurposed per
Part 3's note).

**Downstream integration point (Phase 4, not yet touched):**
Wherever CF1's agent-stage dispatch selects between `oneCallAgentOutput.js` and
`twoCallAgentOutput.js` — exact call site not yet located in this research pass; find
and confirm before Phase 4 begins.

---

## Part 12: Risks and anti-patterns

- **Rebuilding the assertion-first pipeline under a new name.** The clearest version of
  this risk is Part 4's contested S3: if "deterministic enrichment" quietly grows into
  "deterministic candidate generation that the model's claims get matched against," that
  *is* CF4 again with extra steps. Guard: S3 may only ever operate on claims the model
  already committed to, never generate new candidate claims of its own.
- **Duplicating CF1's package infrastructure.** Building a second, CF5-flavored package
  assembler because it's easier than reading `assemblePackage.js` closely. Guard: Phase
  4 is written specifically to prevent this.
- **Treating one fixture's result as proof.** The Thompson-crux recovery on F03 is a
  strong, real signal, but it is one fixture, one run, no repeats, no repair-path
  exercise, and no gold comparison on the label-diversity dimension. Guard: Part 8's
  test matrix exists precisely because of this risk.
- **Silent fallback.** CF1's own acceptance gates explicitly ban "silent fallback to the
  legacy producer." The same discipline must apply to CF5 vs. CF1 vs. legacy — Phase 4's
  routing must be explicit and logged, never a quiet try/catch.
- **Re-deriving atomicity from syntax.** Already addressed in Part 5; flagged again here
  because it's the single most explicitly-warned-against failure mode in the governing
  spec, and the crude heuristic currently in `validation.js` is exactly that pattern
  left un-escalated.
- **Confusing "not yet built" with "rejected."** CF1's pillar/thesis-hinge architecture
  is the thing the CF5 spec's framing implicitly argues against, but CF1 hasn't
  actually been blind-compared against a direct-generation alternative yet either (§0)
  — its own acceptance gates say so. Don't treat CF5's F03 result as having already won
  that comparison; it hasn't been run.

---

## Part 13: Open decisions requiring adjudication

1. **Does CF5 replace CF1's Call 1, or does it replace CF1 entirely?** This is the
   central question this plan cannot answer alone (§0). Recommend: replace Call 1 only,
   pending Part 6/Phase 3's head-to-head data — reuse everything CF1 built downstream.
2. **Is CF1's pillar/thesis-hinge model actually the same failure CF4's pillar-adjacent
   selection stage exhibited, or a different, better-tested design that happens to share
   vocabulary?** Needs direct inspection of CF1's actual pillar-assignment prompt/logic
   before assuming they're the same failure mode — not done in this research pass.
3. **Where does the evidence-trails compound-claim check (Part 5) get validated before
   it's trusted as a hard gate?** Needs gold-labeled compound/non-compound examples that
   don't currently exist in the sealed gold format.
4. **Claim identity stability across runs** (Part 8) — no scheme proposed yet beyond
   "probably needs to be content-hash-derived." Needs a decision before Phase 4.
5. **Who owns the "fixture-wide blinded comparative adjudication" gate** referenced in
   both CF1's handoff doc and this plan's Part 8 — is this the same adjudication effort
   for both CF1-vs-legacy and CF5-vs-CF1, or two separate efforts? Coordinate before
   Phase 3 starts, not after.
6. **Is `searchHints` truly unused by ER1 today, or does the live-provider path
   (ER1-2A, referenced in the handoff doc but not inspected in this research pass) use
   it differently from the query-planner code inspected here?** Verify before finalizing
   Part 2's drop recommendation.

---

## Part 14: Executive conclusion (restated, for the top-line read)

CF5's direct-generation hypothesis has one strong, real data point in its favor: it
recovered the Thompson/CDC crux that CF4's extraction-then-selection architecture never
surfaced across three prompt variants and roughly a dozen repeats. That result is real
and worth acting on.

But "promote CF5 to primary" is not a green-field decision. A more mature, tested,
not-yet-live implementation (CF1, `backend/src/claim-foundry/`) already exists, already
has a working two-call generate-then-enrich path, already assembles and verifies the
exact package format ER1 consumes, and has run clean across all 8 fixtures with zero
repairs. The responsible migration is not "build CF5's own package/verification/ER1
integration from scratch" — it's "prove CF5's one-call generation approach beats CF1's
existing two-call approach on the same fixtures and gold, then swap the generation
stage inside CF1's already-working pipeline." Everything in Parts 4-9 above is written
to make that comparison possible without throwing away tested infrastructure to get
there.

---

## Proposed architecture diagram

```text
                         ┌─────────────────────────────┐
                         │  Article ingestion (S0)      │
                         │  unchanged, shared            │
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │  S1: direct claim generation   │
                         │  (CF5 prompt — Part 6 decides  │
                         │   1-call vs CF1's 2-call path) │
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │  S2: deterministic validation   │
                         │  hard / repairable / info       │
                         │  (Part 7)                       │
                         └──────┬───────────────┬─────────┘
                       hard fail│               │clean
                         ┌──────▼──────┐         │
                         │ S4: repair   │         │
                         │ (≤1 pass)    │         │
                         └──────┬──────┘         │
                                └────────┬────────┘
                         ┌───────────────▼───────────────┐
                         │  S3: deterministic enrichment    │
                         │  identity / attribution / cited  │
                         │  works (reuse coref/attribution) │
                         └───────────────┬───────────────┘
                                        │
                         ┌───────────────▼───────────────┐
                         │  S5: package assembly + verify   │
                         │  (REUSE CF1's assemblePackage.js,│
                         │   verify*.js — do not rebuild)   │
                         └──────┬────────────────┬─────────┘
                                │                │
                    ┌───────────▼──────┐  ┌───────▼────────────┐
                    │ S6: human         │  │ S7: ER1 projection  │
                    │ projection        │  │ selectedEvaluation-  │
                    │ (Part 1B fields)  │  │ Claims + phase3Tar-  │
                    │                   │  │ gets + evidenceNeed- │
                    │                   │  │ Cards (Part 1A)      │
                    └───────────────────┘  └──────────────────────┘
```
