# CF6 Failure Corpus Manifest

Status: working manifest  
Corpus cutoff: 2026-07-27 (original); addended 2026-07-27 with CF5
PromptCF5-v0005/v0006/v0007 and the v0007 execution-arms comparison, plus
gap-filling from a full CF1(prompt-benchmark)/CF2/CF3/CF4 archive re-audit —
see §4.2, updated AR-07/AH-10, and the new notes marked "addendum" below.  
Scope: Claim Foundry work from the original CF1 agents and prompt arms through
CF2, CF3, CF4, CF5, the bounded-model experiment, and the current CF6 design.

## 1. Purpose

This manifest turns the accumulated failures into a controlled CF6 test corpus.
It does **not** declare every old run to be a regression test. Most old runs are
valuable as evidence about a failed architecture, a validator rule, a repair
case, or infrastructure behavior, but should never be executed in the active
CF6 path.

The corpus has six dispositions:

1. **Active regression fixture** — must be exercised by CF6 before a behavior
   change is accepted.
2. **Validator fixture** — a small fixed object that proves a validator accepts
   or rejects the intended shape.
3. **Repair fixture** — a small before/after case for a deterministic repair.
4. **Architecture history** — immutable evidence of an approach and its
   observed failure; not part of the active suite.
5. **Infrastructure test** — transport, timeout, streaming, fingerprint,
   persistence, or model-availability behavior; not a semantic score.
6. **Obsolete** — a rejected arm, contradictory prompt, fixture-specific hack,
   or superseded mechanism that must not influence CF6.

An archived run has exactly one primary disposition in this manifest. A
normalized case derived from that run may have a different disposition. For
example, the CF2 V5 run is architecture history, while the Thompson
substance/source tuple extracted from it is an active regression fixture.

## 2. Preservation and provenance rules

- Never overwrite an archived run.
- Preserve the original request, schema, response, model, transport, prompt
  fingerprint, system fingerprint, seed, host version, and artifact hashes when
  available.
- An arm label is not proof of prompt identity. Prefer recorded request and
  schema fingerprints.
- A recorded synthetic seed is not proof that an API supported or honored a
  seed. Several Responses API runs were effectively unseeded.
- Stored-packet replays test only the replayed stage and downstream host logic.
  They are not end-to-end discovery tests.
- Historical model output is evidence of observed behavior, not semantic gold.
- Evaluation keys and reviewed adjudications define expected behavior; old
  model outputs do not.
- Model unavailability, network denial, timeout, and malformed transport are
  infrastructure outcomes, never semantic failures.
- Do not reintroduce fixture-specific wording, named F03 answers, or source-name
  hacks into prompts or production code.
- **Addendum:** CF3 and CF4 each maintain an independent `CF1-F03.gold.json`
  with independent row numbering. The Thompson/MMR crux (CDC/MMR-autism data
  manipulation, whistleblower William Thompson, source unit U0037) is
  **G02/G03** in CF4's gold file (`backend/experiments/cf4/gold/`) and **G06**
  in CF3's gold file (`backend/experiments/cf3/gold/`). Same underlying
  content, different IDs — do not conflate them when cross-referencing this
  manifest's AR-03/AR-06/AR-07 against either source's raw scoring output.

The deliberately preserved pre-CF6 archive is documented in
`artifacts/claim-foundry/BENCHMARK_ARCHIVE.md`.

## 3. Failure-class vocabulary

| Code | Failure class | Required CF6 observation |
|---|---|---|
| `DISCOVERY_RECALL` | A material assertion is never emitted. | Expected assertion or reviewed equivalent is present. |
| `DOCUMENT_COVERAGE` | Extraction stops in an early region or ignores a major argument branch. | Selected and candidate assertions cover the reviewed document positions, not merely unit order. |
| `CHALLENGED_DROPPED` | A proposition introduced for rebuttal is omitted. | Original challenged proposition is retained in original polarity. |
| `POLARITY_FLIP` | The article's rebuttal replaces the challenged proposition, or negation is inverted. | `substance` preserves the supplier's proposition. |
| `NON_ATOMIC` | One output combines independently testable propositions. | One externally resolvable assertion per tuple, or an explicit reviewed split. |
| `REPORTING_FRAME_FUSION` | “X said/revealed/found P” becomes the substance when `P` is the verification target. | `source = X`; `substance = P`. |
| `SOURCE_LOSS` | A resolvable supplier becomes `unknown`, `article author`, or article voice. | Innermost defensible supplier is retained with grounding. |
| `SOURCE_EVIDENCE_CONFUSION` | Evidence supporting `P` is treated as the supplier of `P`. | Supplier and cited evidence are represented separately. |
| `SOURCE_STANCE_COUPLING` | Source identity changes treatment or thesis effect. | Source, treatment, and effect remain independent tuple fields. |
| `TREATMENT_ERROR` | Adopted, challenged, or reported use is wrong. | Treatment reflects what the article does with the proposition. |
| `TARGET_EFFECT_ERROR` | Effect is compared with an underspecified or wrong target. | Effect is evaluated against an explicit article position or dependency. |
| `NO_EFFECT_COLLAPSE` | Relevant adopted facts are labeled `no_effect` because the thesis target is too narrow. | Position-specific relevance remains visible. |
| `LABEL_COLLAPSE` | Nearly all assertions receive one treatment/effect/source label. | Reviewed diversity is recovered where the article contains it. |
| `SELECTION_UNDERFILL` | Valid material assertions exist but the final portfolio is too small. | Portfolio fills the requested budget unless the reviewed inventory is genuinely smaller. |
| `SELECTION_NOISE` | Procedural, rhetorical, duplicate, or incidental facts displace argument-bearing assertions. | Selection is position-aware and redundancy-aware. |
| `PILLAR_COLLAPSE` | One broad axis absorbs distinct argument branches, or relevant branches receive no axis. | Distinct article positions remain separately represented. |
| `GROUNDING_MISMATCH` | Assertion text and cited units do not support each other. | Every tuple is independently grounded; repair is auditable. |
| `GROUNDING_ORDER` | Unit IDs are invalid, out of order, or outside their packet. | Deterministic validator rejects or repairs only the ID layer. |
| `DEDUP_ATTRIBUTION_LOSS` | Deduplication removes a named account or merges different suppliers. | Equivalence considers normalized substance and source resolution. |
| `SCHEMA_INVALID` | Required fields, enums, arrays, or cross-field contracts fail. | Validator rejects before semantic packaging. |
| `VALIDATOR_OVERBLOCK` | One bad candidate aborts a usable inventory. | Candidate-level quarantine is explicit; run-level failure is reserved for package-level invalidity. |
| `REPAIR_SEMANTIC_DRIFT` | A deterministic repair changes meaning, stance, or source. | Repair is limited to provable structural transformations. |
| `RUN_VARIANCE` | Byte-identical input produces materially different semantic results. | Repeats and fingerprints expose, rather than conceal, variability. |
| `OUTPUT_LOOP` | Model repeats an item until truncation. | Streaming/repetition guard stops the call and preserves a diagnostic. |
| `BUDGET_FAILURE` | Token, latency, or call count makes the path unusable. | Budget is measured per stage and enforced without semantic coercion. |
| `INFRA_FAILURE` | Network, model availability, SDK, sandbox, or persistence failure. | Classified separately with no semantic score. |

## 4. Corpus inventory at the cutoff

The inventory is intentionally grouped by experiment family. Directory counts
are snapshots, not promises that every directory is a complete run.

| Family | Observed corpus | Primary disposition |
|---|---:|---|
| Original CF1 `agent-runs` | 100 run summaries; 47 `failed` and 1 `verification_failed` | Validator fixtures plus architecture history |
| CF1 prompt-set benchmark | 58 summaries; 15 `failed` and 6 `verification_failed` | Validator fixtures plus architecture history |
| Split Call 1A/1B archive | 43 run directories | Architecture history; selected active cases |
| CF2 | 52 run/replay directories | Current predecessor history; primary active-case source |
| CF3 | 6 principal F03 runs | Architecture history; challenged/source failure cases |
| CF4 | deterministic and selection phases | Architecture history; selection and evaluator fixtures |
| CF5 direct-generation prototype | prototype plus prompt experiments and version arms | Active direct-generation cases plus history |
| P1a V7–V13 | chunking, pillar, orientation, and schema experiments | Architecture history |
| Legacy DB whole-article | 10 benchmark families | Architecture history |
| CF0 simple/superblind | 4 baseline families | Architecture history |
| Bounded adapter / public-data ML | training and F03 evaluation artifacts | Architecture and training infrastructure history |

### 4.1 Original CF1 recorded failures

The original 100 agent summaries contain 48 non-ready outcomes: 47 with status
`failed` and one with status `verification_failed`.

| Recorded class | Count | Disposition |
|---|---:|---|
| `CF1_INVALID_ONE_CALL_AGENT_OUTPUT` | 21 | Extract validator fixtures; archive runs |
| `CF1_MODEL_UNAVAILABLE` | 10 | Infrastructure tests |
| `CF1_AGENT_SEMANTIC_INVALID` | 6 | Validator and regression cases |
| `CF1_MISSING_PILLAR_COVERAGE` | 3 | Validator fixtures |
| `CF1_GROUNDING_UNIT_ORDER` | 3 | Validator fixtures |
| `CF1_INSUFFICIENT_SELECTED_CLAIMS` | 2 | Selection regression cases |
| `CF1_BUDGET_EXCEEDED` | 2 | Infrastructure/budget tests |
| `CF1_VERIFICATION_FAILED` | 1 | Validator fixture |

The 58 prompt-set summaries contain 21 non-ready outcomes: 15 with status
`failed` and six with status `verification_failed`.

| Recorded class | Count | Disposition |
|---|---:|---|
| `CF1_MODEL_UNAVAILABLE` | 7 | Infrastructure tests |
| `CF1_AGENT_SEMANTIC_INVALID` | 6 | Validator fixtures and prompt history |
| `CF1_VERIFICATION_FAILED` | 6 | Validator fixtures; all from the H arm |
| `CF1_MISSING_PILLAR_COVERAGE` | 2 | Validator fixtures |

These counts are useful for corpus accounting, not as an endorsement of the old
failure taxonomy. Several original “semantic invalid” outcomes now separate
into polarity, source, treatment, grounding, and selection failures.

### 4.2 CF5 prompt-version arms added since the original cutoff

| Version | Framing | Repeats (F02/F03/F06) | Crux recall vs v0001 | Disposition |
|---|---|---|---|---|
| PromptCF5-v0002 | Nonsense-token ablation ("proposition"→gibberish) | 3/3/3 | Statistically indistinguishable | Architecture history — null result |
| PromptCF5-v0003 | "Basis" ontology | 1/1/1 | F06 5/5 (best single run this cycle at the time) | Architecture history — promising, not pursued |
| PromptCF5-v0004 | "Evidence Questions" ontology | 1/1/1 | F03 partial G03 gain, F06 compound-claim regression | Architecture history — rejected |
| PromptCF5-v0005 | Maximize atomicity, no count ceiling | 1/1/1 | Best single-run recall of the cycle; F02 4/4, F06 5/5 | Architecture history — not promoted, flagged for follow-up |
| PromptCF5-v0006 | Thematic minimum-coverage ("fewest assertions per theme") | 2/2/2 | F06 10/10 across both repeats; F03 partial | Architecture history — not promoted; `LABEL_COLLAPSE` measured (see AR-07) |
| PromptCF5-v0007 | MISSION/TASK/OUTPUT hybrid + worked atomicity examples | 1/1/1 (+ execution-arms comparison) | F06 5/5; F03 partial | Architecture history — not promoted |

All six are isolated candidate-prompt files under `backend/experiments/cf5/`,
never merged into production `prompts.js` (still `PromptCF5-v0001`). None
reused v0001's evaluation infrastructure incorrectly — each ran the
unmodified `validateClaims()`/`runGenerationPipeline()`/`targetMatching.js`
path per the CF5 Reporting Standard
(`ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_REPORTING_STANDARD_2026-07-27.md`).
See the AR-07/AH-10 addenda above for the semantic findings.

## 5. Active CF6 regression fixtures

This is the suite CF6 should actually run. It is small enough to diagnose and
broad enough to cover the recurring failures. The source artifacts are frozen;
CF6 should consume normalized fixture inputs and reviewed expectations derived
from them.

### AR-01 — CF1-F01 research-article discourse tuple

**Purpose:** distinguish study results, article voice, study authorship, and
procedural context without turning “the study found” into the verification
target.

**Must catch**

- `REPORTING_FRAME_FUSION`
- `SOURCE_LOSS`
- `NO_EFFECT_COLLAPSE`
- `SELECTION_UNDERFILL`
- `SELECTION_NOISE`

**Required behaviors**

- Substantive findings remain the assertions.
- A generic model-added frame such as “The study found that” does not become
  the supplier.
- Nearby named external work is used only when the grounding supports that
  attribution.
- Adopted results are not discarded merely because one atomic thesis assertion
  is narrower than the article's full position.
- Sample sizes, methods, and enrollment details do not displace the principal
  findings unless they are themselves material to a reviewed position.

**Frozen source**

- `backend/experiments/cf2/evaluation-v1/frozen/CF1-F01.inventory.json`
- `backend/experiments/cf2/evaluation-v1/traces/CF1-F01.trace.json`
- `artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724`

### AR-02 — CF1-F02 contradictory/qualified article

**Purpose:** preserve separate article positions and named sources when the
document contains internally conflicting, qualifying, or differently deployed
assertions.

**Must catch**

- `SOURCE_LOSS`
- `VALIDATOR_OVERBLOCK`
- `TREATMENT_ERROR`
- `TARGET_EFFECT_ERROR`
- `SELECTION_UNDERFILL`

**Required behaviors**

- One invalid source layer does not abort the entire inventory.
- Named-source assertions are not silently lost to quarantine.
- Qualification is not flattened into support or opposition.
- Selection preserves assertions needed to expose the article's internal
  contradiction.

**Frozen sources**

- `artifacts/claim-foundry/cf2/cf1-f02-v6-c30-p12-20260724`
- `artifacts/claim-foundry/cf2/cf1-f02-v6-c30-p12-quarantine-20260724`
- `artifacts/claim-foundry/cf2/v6-c30-f01-f02-f03-comparison-20260724`
- CF2 C30 report: `backend/experiments/cf2/v6/C30_FINDINGS_2026-07-24.md`

### AR-03 — CF1-F03 challenged public-health propositions

**Purpose:** retain opponent assertions in original polarity and keep their
source, treatment, and thesis effect independent.

**Must catch**

- `CHALLENGED_DROPPED`
- `POLARITY_FLIP`
- `SOURCE_STANCE_COUPLING`
- `GROUNDING_MISMATCH`
- `REPORTING_FRAME_FUSION`

**Required challenged assertions include reviewed equivalents of**

- outdoor immune challenges compared with vaccination;
- tomato/aluminum exposure compared with vaccines;
- ethylmercury harmlessness or rapid clearance;
- no credible studies linking vaccination to chronic disease;
- vaccines tested more rigorously than other medicines.

CF6 need not select every challenged proposition in every bounded portfolio,
but it must discover the reviewed material ones, retain original polarity, and
mark challenged treatment without using source identity as a stance shortcut.

**Required named-source case**

- Substance: the CDC data underlying the MMR/autism analysis were manipulated
  or improperly handled.
- Supplier: William Thompson when grounded by the Thompson passage.
- The output must not change the substance to “William Thompson revealed …”
  merely to preserve the source.

**Frozen sources**

- `backend/experiments/cf2/evaluation-v1/frozen/CF1-F03.inventory.json`
- `backend/experiments/cf2/evaluation-v1/traces/CF1-F03.trace.json`
- `artifacts/claim-foundry/cf2/cf1-f03-v5-structural-attribution-20260724`
- `artifacts/claim-foundry/cf2/cf1-f03-v7-explicit-attribution-only-e2e-r1-20260724`
- `artifacts/claim-foundry/split-arm/split-20260719-113836-182bd9`

### AR-04 — CF1-F06 causal-mechanism retention

**Purpose:** prevent a concise extraction prompt or deduplicator from collapsing
distinct mechanisms into one vague conclusion.

**Must catch**

- `NON_ATOMIC`
- `DISCOVERY_RECALL`
- `DEDUP_ATTRIBUTION_LOSS`
- `SELECTION_NOISE`

**Required behaviors**

- Separate independently testable mechanisms remain separate.
- Repeated conclusions with different mechanisms are not treated as exact
  duplicates.
- The final portfolio retains the principal mechanism-bearing assertions rather
  than only the article's broad conclusion.

**Frozen sources**

- `artifacts/claim-foundry/cf5-experiment1/CF1-F06`
- `artifacts/claim-foundry/legacy-db-whole-article/cf1-f06-frozen-hybrid-20260722`

### AR-05 — CF1-F08 short straight-news selection

**Purpose:** prevent a short article with many ordinary factual details from
collapsing to a two-assertion portfolio.

**Must catch**

- `NO_EFFECT_COLLAPSE`
- `TREATMENT_ERROR`
- `SELECTION_UNDERFILL`

**Required behaviors**

- A short article is not assumed to contain only its headline facts.
- Material location, magnitude, depth, warning/status, and relevant advisory
  facts remain eligible when grounded.
- `reported + no_effect` is not used as a blanket disposal class when the thesis
  target is too narrow.
- The expected portfolio size is reviewed from the valid inventory; historical
  evidence suggests roughly 5–7 useful assertions rather than 2.

**Frozen source**

- `backend/experiments/cf2/evaluation-v1/frozen/CF1-F08.inventory.json`
- `backend/experiments/cf2/evaluation-v1/traces/CF1-F08.trace.json`
- `artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724`

### AR-06 — CF4 Thompson crux selection

**Purpose:** prove that an assertion present in the inventory is not lost
because a single thesis/stance anchor omits its argument branch.

**Must catch**

- `PILLAR_COLLAPSE`
- `TARGET_EFFECT_ERROR`
- `SELECTION_UNDERFILL`

**Required behavior**

- The Thompson/CDC manipulation assertion remains relevant to a reviewed article
  position even if it has weak or no effect on a different atomic thesis
  assertion.

**Frozen source**

- `artifacts/claim-foundry/cf4/phase2-selection/r2-subtheses-cf1-f03/THOMPSON_CRUX_RAW_REPORT.md`

### AR-07 — CF5 direct-generation compound and label collapse

**Purpose:** preserve the principal advantage of direct generation while
rejecting its first-run tendency to emit compound assertions and uniform
labels.

**Must catch**

- `NON_ATOMIC`
- `LABEL_COLLAPSE`
- `SOURCE_LOSS`

**Required behaviors**

- The model may generate an assertion directly, but independently testable
  clauses must not be fused.
- An advocacy article must not automatically yield all
  `adopted + strengthens`.
- Named suppliers survive without being prepended to the substance.

**Addendum (PromptCF5-v0005/v0006/v0007, 2026-07-27):** three later prompt
variants — v0005 (maximize atomicity, drop the count ceiling), v0006
(thematic "minimum single-predication assertions per theme" coverage), and
v0007 (hybrid MISSION/TASK/OUTPUT framing with worked GOOD/BAD atomicity
examples) — each independently beat the production v0001 prompt's crux
recall on F02/F03/F06, via three different mechanisms, none yet promoted
(each tested at n=1 or n=2 per fixture only). They also newly evidence both
sides of this fixture's failure pair on the same crux family:

- `LABEL_COLLAPSE`, directly measured, not inferred: across v0006's 6 fresh
  runs, 132 of 134 claims returned `articleTreatment: "adopted"`, 2
  `"challenged"`, 0 `"reported"` — despite the v0006 prompt explicitly
  instructing the model to reason in four stance categories (support,
  oppose, qualify, rebut) that the schema cannot record (see §2 addendum
  note below on `articleTreatment` vs richer CF1 `articleUse`).
- `NON_ATOMIC`, directly verified by inspection, not just the heuristic
  count: v0005 tripled claim count (12–15 → 45–47 per fixture) and,
  conversely, v0006/v0007 show a real compound-claim tradeoff in the
  opposite direction — e.g. v0006 F06 bundles five independently-verifiable
  species counts into one 19-word claim, the "minimum assertions per theme"
  framing's direct, expected cost.
- The F03 Thompson/MMR pair (this AR's crux target, CF4 gold IDs G02/G03)
  was cleanly recovered in a single claim under v0005 repeat 1, v0006 repeat
  2, and v0007 repeat 1 — the first clean single-claim recoveries of this
  crux across the entire CF2→CF5 history — but not reliably (v0006 repeat 1
  and v0007 both still show partial/ambiguous recovery on the destroy-
  evidence half, and none of the three has more than 1–2 repeats).

**Frozen source**

- `artifacts/claim-foundry/cf5/CF5_PROTOTYPE_REPORT_2026-07-26.md`
- `artifacts/claim-foundry/cf5-experiment1/CF5_PROMPT_EXPERIMENT1_REPORT_2026-07-26.md`
- `artifacts/claim-foundry/cf5-promptcf5-v005/review.html` (+ `analysis.json`, `run_config.json`)
- `artifacts/claim-foundry/cf5-promptcf5-v006/review.html` (+ `analysis.json`, `run_config.json`)
- `artifacts/claim-foundry/cf5-promptcf5-v007/review.html` (+ `analysis.json`, `run_config.json`)

### AR-08 — F01–F09 end-to-end smoke matrix

**Purpose:** expose catastrophic fixture-specific regressions after the deep
fixtures pass.

**Rules**

- Run every fixture F01–F09.
- Require a valid package and a nonempty portfolio.
- Record discovery, tuple, treatment, relevance, and selection separately.
- Do not use the old locked outputs as semantic gold.
- Do not average the matrix into one score that can hide an F03 opposition
  failure or an F08 underfill.

**Frozen source**

- `artifacts/claim-foundry/cf2/v6-c30-p12-locked-f01-f09-20260724`
- `backend/experiments/cf2/LOCKED_BASELINE_2026-07-24.md`

## 6. Validator fixtures

Validator fixtures contain fixed input and expected accept/reject outcomes.
They should not call a model.

### VF-01 — Original one-call semantic contract

Derive compact cases from the 21
`CF1_INVALID_ONE_CALL_AGENT_OUTPUT` failures:

- candidate ID outside the allowed range;
- generic `wouldSupportIf`;
- reversed support/refute conditions;
- polarity reversal on a negative target;
- incomplete falsifiable assertion;
- required `rejectIfOnly` omitted;
- non-bearing assertion retained;
- valid assertion dropped;
- ungrounded theme wording;
- theme/topic/causal-bearing contract failure.

### VF-02 — Source contract

Cases:

- `article_voice` with an external source name;
- `unknown` with a concrete name;
- a generic evidence category such as “statistical data” used as supplier;
- named work repeated or invented;
- proposition changed merely to encode the source;
- H source-contract violations;
- attribution layer omitted when the selected schema requires it.

Expected result: reject the invalid tuple, not necessarily the entire inventory.

### VF-03 — Grounding contract

Cases:

- unit outside the supplied packet;
- unit order reversed;
- duplicate unit;
- nonexistent unit;
- assertion not entailed by its grounding;
- source unit supports evidence but not attribution;
- grounding independently supports one split child but not the other.

### VF-04 — Portfolio and position coverage

Cases:

- missing required article-position branch;
- duplicate pillar/position labels;
- selected ID absent from extraction;
- selected assertion quarantined without an explicit trace;
- valid inventory below requested portfolio size;
- portfolio underfill that is legitimate because the reviewed valid inventory is
  smaller.

### VF-05 — Candidate-level quarantine

Use the CF2 C30 failures where one Call B candidate omitted a required source
layer. Prove:

- the invalid candidate is quarantined with a reason;
- other valid candidates survive;
- the package records candidate count before and after quarantine;
- a package-level invariant still blocks a truly unusable result.

### VF-06 — Evaluator consistency

Use the CF4 “selected but not extracted” grader inconsistency. A scorer must not
simultaneously report an item as absent from extraction and selected without
raising an evaluator-integrity error.

### VF-07 — Schema feasibility

Reject before API submission:

- `minItems > maxItems`;
- impossible required-per-block objects;
- literal template placeholders such as `"..."` in enums or `required`;
- an unbounded generation array when the transport requires a ceiling;
- a schema/request pair whose allowed IDs do not match the supplied units.

## 7. Deterministic repair fixtures

A repair is permitted only when the host can prove the transformation from the
supplied text. Repairs must preserve the original model output, repaired output,
rule ID, and evidence.

### RF-01 — Assertion/grounding realignment

**Observed failure:** Call A emitted a plausible opponent assertion but attached
units from the article's rebuttal or a nearby passage.

**Allowed repair:** search only the supplied occurrence/local-unit index for an
exact or high-confidence proposition occurrence and replace the grounding IDs
when the match is unique.

**Not allowed:** manufacture a missing assertion or infer stance from the new
source.

Sources include CF2 F03 JCPH grounding repairs and the source-unit mismatch
ablation documented in the CF2 reports.

### RF-02 — Reporting-frame de-fusion

**Before**

`William Thompson revealed privately in 2014 that data linking the MMR vaccine
to autism had been manipulated by the CDC.`

**After tuple**

- `substance`: `Data linking the MMR vaccine to autism had been manipulated by
  the CDC.`
- `source`: `William Thompson`

Apply only when the grounding explicitly contains the speech/source relation
and independently grounds the inner proposition.

### RF-03 — Model-invented generic frame

**Observed failure:** Call A added “The study found that” although the grounding
directly stated the proposition and supplied no distinct named antecedent.

**Allowed repair:** strip the generic frame when:

- no named external antecedent occurs in the attribution window;
- grounding uses direct article narrative, `we/our`, or `this study` in the
  document's own study voice;
- the inner proposition is independently grounded.

Do not convert every occurrence of “found” into article voice.

### RF-04 — Source-aware deduplication

Two candidates may merge when:

- normalized substances match and sources match; or
- normalized substances match, one source is genuinely unresolved, and the
  other candidate supplies a uniquely grounded concrete source.

They must not merge merely because they share a topic. Distinct named accounts,
mechanisms, studies, or polarity remain separate.

### RF-05 — Atomic clause salvage

Historical accepted first-clause salvage cases:

- “Thimerosal is toxic **and** may cause decreased offspring survival **and**
  nervous-system effects.” → keep `Thimerosal is toxic` only when independently
  grounded and material.
- “The CDC stopped funding research **and** claimed the science was settled.” →
  keep the first independently grounded clause.
- “Infants receiving the most vaccines had the worst hospitalization **and**
  death rates.” → split or retain only the independently grounded primary
  endpoint.
- “Polysorbate 80 is linked to infertility **and** banned from injectables in
  Europe.” → keep the first independently grounded assertion.

Rejected salvage:

- “Parents were highly educated **and** scientifically literate.” The first
  clause alone is not automatically material merely because it is grammatical.

The model should perform semantic splitting when possible. Deterministic salvage
is a conservative last resort, not general conjunction parsing.

### RF-06 — Occurrence expansion for attribution

When an assertion is grounded in one unit but a contiguous occurrence of the
same proposition includes the supplier in an adjacent unit, add the attribution
unit to the candidate packet. This was useful for the Thompson sequence around
the F03 U0037/U0038/U0041 region.

The repair adds context; it does not prefill the final source judgment.

### RF-07 — Output-loop abort

From streaming deltas, normalize completed candidate objects by case and
punctuation. Abort and preserve the partial diagnostic after a configured exact
repetition threshold.

This repair protects infrastructure only. It does not detect semantic
paraphrases and must not be represented as a semantic deduplicator.

## 8. Architecture history

These runs explain why CF6 exists. Preserve them, but do not run their prompts
or host paths as part of CF6.

### AH-01 — CF0 simple/superblind baseline

Paths:

- `artifacts/claim-foundry-basic/cf0-f03-first-pass-20260718`
- `artifacts/claim-foundry-basic/cf0-f03-simple-vs-superblind-20260718`
- `artifacts/claim-foundry-basic/cf0-f03-three-arm-*`

Learned:

- simple prompts produced concise assertions;
- superblind sometimes improved supplier detection;
- neither reliably modeled assertion opposition to the article.

### AH-02 — Original CF1 one-call agent and prompt-set arms

Paths:

- `artifacts/claim-foundry/agent-runs`
- `artifacts/claim-foundry/prompt-sets/cf1pb-20260717-01`

Includes Sets B, C, D, E, E2, F, H, X, ordering ablations, schema-field
experiments, warrant restoration, and Call 2 packaging.

Learned:

- field order and enum/default presentation can affect outputs;
- source identity, role, and transform became coupled;
- one prompt could approach the desired package but was brittle;
- prompt accumulation and contradictory source instructions invalidated several
  comparisons;
- report layers sometimes concealed fields produced and later stripped;
- **addendum:** an undocumented, off-log schema change (nicknamed "C8",
  2026-07-17) added a required `warrant` field plus an instruction block that
  silently contaminated even the frozen control arm used for baseline
  comparison — fully reverted; schema restored to v3; C1–C7 remain the only
  retained corrections (`backend/test/claim-foundry/prompt-benchmark/corrections-log.md`).
  Lesson for CF6: a "frozen" comparison arm is only as frozen as its actual
  assembled prompt bytes — verify by hash, not by label;
- **addendum:** the manual human-review adjudication loop (448 focused
  decisions) became unsustainable and was closed by reclassifying outcomes as
  `assistant_adjudicated` with `independentHumanGold: false`
  (`ml/cf1-argument-model/data/annotation-prompts/stupidity/CF1_ASSISTANT_ADJUDICATION_REPORT.md`).
  Any CF6 fixture sourced from this era's "gold" should carry that
  provenance flag forward, not be treated as independently human-verified.

### AH-03 — Split Call 1A/1B architecture

Path:

- `artifacts/claim-foundry/split-arm`

Landmark runs:

- `split-20260719-113836-182bd9` — best early 20-candidate F03 inventory and
  frozen 1B replay source;
- `split-20260719-123330-1966cb` — atomic-looking F03 extraction;
- `split-20260719-124930-7252c4` — article-voice candidate experiment exposing
  source input effects on stance;
- `split-20260719-130729-9fa19d` — stored-packet replays and source suppression;
- `split-20260719-163509-920c10` — three GPT-4.1-mini full repeats; opponent
  recall varied;
- `split-20260719-170832-7e8e4b` — GPT-5-mini discovery found broad opponent
  coverage but was slow and token-heavy.

Learned:

- splitting reduced per-call duties but did not make source, stance, and
  selection independent;
- frozen replays are useful for stage isolation but cannot establish production
  reliability;
- source candidates can improve attribution while changing stance;
- “article author” and byline fallbacks caused unstable or overbroad sourcing.

### AH-04 — Census and atomic-repair experiments

Paths:

- `artifacts/claim-foundry/split-arm/census-f03-archived-1a-preview-20260719`
- `artifacts/claim-foundry/split-arm/split-20260721-021208-c5070c/atomic-repair-*`

Learned:

- the original census reconciler reported 0/60 matches and blocked valid runs;
- census passages are useful as diagnostics, not as automatic claims or Call 1B
  inputs;
- repair calls often rejected candidates or added new selection/materiality
  failures;
- deterministic atomic salvage is only safe for narrow, provable cases.

### AH-05 — P1a chunking, orientation, and pillar experiments

Paths:

- `artifacts/claim-foundry/p1a-v7-*`
- `artifacts/claim-foundry/p1a-v8-*`
- `artifacts/claim-foundry/p1a-v9-local-pillars`
- `artifacts/claim-foundry/p1a-v10-*`
- `artifacts/claim-foundry/p1a-v11-*`
- `artifacts/claim-foundry/p1a-v12-*`
- `artifacts/claim-foundry/p1a-v13-*`

Learned:

- chunking materially improved article-wide recall and could emit roughly 72
  assertions;
- assertion-first, backward pillar induction produced more coherent local
  pillars than theme-first assignment;
- cost rose to multiple extraction/orientation calls;
- large keyed schemas and required-per-block outputs forced filler, collapse,
  latency, and loops;
- output order alone did not enforce genuine bottom-up reasoning.

### AH-06 — Legacy DB whole-article extraction

Path:

- `artifacts/claim-foundry/legacy-db-whole-article`

Learned:

- the old scrape/database prompt produced comparable assertions in one call;
- per-assertion follow-up calls added evidence-search fields;
- fixture-specific and parasitic wording contaminated some prompts;
- changing `claim` to `assertion` and changing the follow-up model produced
  apparent improvements that did not hold across repeats;
- it remains a useful architecture comparator, not a production candidate.

### AH-07 — CF2 recursive discourse tuples

Paths:

- `backend/experiments/cf2`
- `artifacts/claim-foundry/cf2`

Landmarks:

- V5 checkpoint: `backend/experiments/cf2/BEST_CURRENT_CHECKPOINT.md`
- V6 locked baseline: `backend/experiments/cf2/LOCKED_BASELINE_2026-07-24.md`
- C30 findings: `backend/experiments/cf2/v6/C30_FINDINGS_2026-07-24.md`
- synthesized failures:
  `backend/experiments/cf2/RECENT_FAILURE_AND_REPAIR_SYNTHESIS_2026-07-24.md`
- frozen evaluator: `backend/experiments/cf2/evaluation-v1`

Learned:

- substance and source are nested discourse layers;
- bounded-recursion treatment can preserve both, but Call A omissions remain;
- increasing candidates improves recall but exposes Call B validation and
  selection collapse;
- a single atomic thesis is too narrow to score every relevant article fact;
- article treatment cannot safely substitute for thesis effect;
- candidate-level trace and separate scoring are mandatory.

### AH-08 — CF3 chunked discovery plus argument mapping

Paths:

- `backend/experiments/cf3`
- `artifacts/claim-foundry/cf3`

Learned:

- chunked discovery improved coverage;
- batch argument mapping still produced `CF3_SOURCE_FUSED`,
  `CF3_REPORTING_RESIDUE`, `CF3_ASSERTION_VERBATIM_COPY`,
  `CF3_CHALLENGED_DROPPED`, `CF3_POLARITY_FLIP_SUSPECTED`, and
  `CF3_BRANCH_CONCENTRATION`;
- it lacked a reliable thesis-dependency/crux selector;
- **addendum**, two open items from CF3's own numbered failure catalogue
  (`FABLE_HANDOFF_2026-07-24-*.md`) map directly onto this manifest's
  vocabulary and remain unresolved anywhere in CF2/CF3/CF4/CF5: **F10**,
  subject-as-source confusion — "the CDC committed fraud" resolves
  `source = CDC` (the accused party) instead of Thompson (the alleger), a
  `SOURCE_EVIDENCE_CONFUSION` variant not yet named in §3's vocabulary; and
  **F11/F12**, selection front-loading — candidates are evenly distributed
  across an article's quarters but selection concentrates almost entirely
  into the first quarter (F01: candidates 33/38/3/21 by quarter → selected
  7/0/0/5), and the one fix attempted ("dependency-first" reordering) made
  front-loading worse while only partially helping crux recall — both
  `PILLAR_COLLAPSE`/`SELECTION_NOISE` in this manifest's terms, still open.

### AH-09 — CF4 deterministic branches and backward positions

Paths:

- `artifacts/claim-foundry/cf4/deterministic-phase1`
- `artifacts/claim-foundry/cf4/phase2-selection`
- `ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_STATUS_AND_COWORK_PLAN_2026-07-26.md`

Learned:

- deterministic branch generation achieved high material-passage recall and
  lineage;
- a single stance anchor omitted the F03 fraud/Thompson branch;
- downstream selection behaved consistently with an incomplete anchor;
- deterministic recall alone does not solve semantic position mapping;
- **addendum:** CF4's own Phase 1 recall gate never passed, even at its final
  tuning iteration — the last scored run
  (`artifacts/claim-foundry/cf4/deterministic-phase1/20260726-s1-short-proper-name-v3/score.json`)
  recorded `"decision": "PHASE_1_GATE_FAIL"` at recall 0.75/0.83/0.92 on
  F02/F03/F06 against a required 0.9 gate on every fixture. CF4 was abandoned
  for CF5 with its own foundational recall gate still failing, not only its
  downstream selection stage — a caution against treating CF4's raw
  extraction as a settled "recall is solved, only selection failed" baseline.

### AH-10 — CF5 direct generation

Paths:

- `artifacts/claim-foundry/cf5`
- `artifacts/claim-foundry/cf5-experiment1`
- `artifacts/claim-foundry/cf5-experiment2`
- `artifacts/claim-foundry/cf5-promptcf5-v002`
- `artifacts/claim-foundry/cf5-promptcf5-v003-v004`
- `artifacts/claim-foundry/cf5-promptcf5-v005`
- `artifacts/claim-foundry/cf5-promptcf5-v006`
- `artifacts/claim-foundry/cf5-promptcf5-v007`
- `artifacts/claim-foundry/cf5-promptcf5-v007-arms`

Learned:

- direct generation can recover a strong thesis-bearing inventory with clean
  grounding;
- first prototype recovered the Thompson crux but 8/11 outputs were compound
  and labels collapsed to adopted/strengthens;
- the Experiment 1 clarification helped F02/F06 and only slightly helped F03;
- Experiment 2's counterfactual-independence sentence caused mixed regressions
  and was rejected;
- the production v0001 45-run F01–F09 sweep (`cf5-minimal-defect-catalog.md`)
  found the *same* Thompson/MMR crux missed 0/5 on F03, root-caused there to
  the model over-applying the "avoid duplicative paraphrases" instruction to
  two genuinely distinct CDC-manipulation allegations (MMR/Thompson vs.
  thimerosal/Verstraeten) under one broad shared theme — this independently
  corroborates, rather than resolves, the same crux-loss pattern CF4's S5
  stance-anchor compression produced by a completely different mechanism;
- v002 (nonsense-token ablation, swapping "proposition" for a nonsense word)
  was a genuine null result, not a rejection — performance was statistically
  indistinguishable from v0001, indicating the specific word carries little
  independent weight versus the surrounding field definitions; not promoted
  because a deliberately unreadable production prompt isn't justified by a
  null result;
- v0003 ("Basis" ontology) and v0004 ("Evidence Questions" ontology) were
  each tested once per fixture; v0003 hit a rare perfect 5/5 F06 crux
  recovery and was flagged promising but not pursued further; v0004 showed a
  directly-verified compound-claim regression on F06;
- v0005/v0006/v0007 (addended 2026-07-27) each independently beat v0001 on
  crux recall via different mechanisms — see the AR-07 addendum for the
  concrete `LABEL_COLLAPSE`/`NON_ATOMIC` evidence; none promoted, all
  flagged for a matched-repeat-count follow-up regression;
- a same-day execution-arm comparison (`cf5-promptcf5-v007-arms`) attempted
  to hold PromptCF5-v0007's text fixed and vary only the execution path: the
  original Responses-API/gpt-4.1-mini baseline, a gpt-5-mini
  reasoning-effort=high Responses arm, and a gpt-4.1-mini Chat Completions
  arm (a genuinely different API surface from every other CF5 run this
  cycle, `openAiTransport.js`/`openAiLLM.js` vs.
  `openAiResponsesTransport.js`). **Cancelled, inconclusive on F03** — the
  reasoning arm needed a much larger `max_output_tokens` budget than a
  non-reasoning call (reasoning tokens count against the same budget; the
  largest fixture, F03 at 404 source units, exhausted 22,561 reasoning
  tokens alone before any output token was emitted at a 25,000 budget and
  returned `CF1_MODEL_OUTPUT_INCOMPLETE`); raising the budget to 60,000 and
  the timeout to 8 minutes still was not enough — the retry timed out
  (`CF1_MODEL_TIMEOUT`) without completing. F02's reasoning/completions arms
  did complete successfully before F03 blocked the run; that partial data
  was not scored or reported, since the experiment was abandoned rather than
  reduced in scope. This is itself useful `BUDGET_FAILURE`/`INFRA_FAILURE`
  evidence: `gpt-5-mini` reasoning=high may simply not be viable within
  ordinary timeout/budget bounds on CF5's largest fixture, independent of
  any semantic question the arm comparison was meant to answer.

### AH-11 — Public-data LoRA and bounded adapter

Paths:

- `ml/cf1-argument-model`
- `ml/cf1-argument-model/work/evaluation/CF1-F03/from-public`
- `ml/cf1-argument-model/work/evaluation/CF1-F03/adapter-original-bounded-v11-host-run1`
- `ml/cf1-argument-model/work/evaluation/CF1-F03/adapter-original-bounded-openai-v11-host-run1`

Observed F03 score snapshot:

- extraction precision: approximately `0.153`;
- extraction recall: approximately `0.192`;
- extraction F1: approximately `0.170`;
- attribution kind: approximately `0.717`;
- attribution name: approximately `0.033`;
- deployment stance: approximately `0.933`;
- source-unit grounding: approximately `0.987`.

Learned:

- the adapter learned bounded passage extraction, not full-article argument
  mapping;
- public data helped generic relation competence but did not supply the CF
  source/selection task;
- applying the bounded adapter across 91 passages created a slow candidate
  explosion;
- pairwise relation success does not imply article-relative stance or portfolio
  success.

## 9. Infrastructure tests

These tests remain runnable, but their outcomes never enter semantic quality
scores.

### IT-01 — Model/network availability

Representative archived failures:

- `artifacts/claim-foundry/split-arm/split-20260719-163206-636924`
- `artifacts/claim-foundry/split-arm/split-20260719-163442-b7ae04`
- `artifacts/claim-foundry/split-arm/split-20260719-170423-2059dc`
- `artifacts/claim-foundry/split-arm/split-20260719-170447-84e7b5`

Expected classification: model unavailable, network/sandbox denial, or timeout;
never “bad claims.”

### IT-02 — Prompt and request fingerprints

Verify:

- identical assembled prompt bytes yield the same prompt hash;
- schema and input hashes are recorded separately;
- model, transport, service tier, and API response ID are recorded;
- system fingerprint is recorded when the API returns it;
- missing fingerprint is explicit rather than an empty success value.

### IT-03 — Seed observability

Verify whether the selected endpoint/model actually accepts a seed. Record:

- requested seed;
- whether it was submitted;
- whether the API acknowledged it;
- repeated-output differences.

Do not label an unsupported seed as deterministic.

### IT-04 — Streaming repetition guard

Reference:

- `artifacts/claim-foundry/streaming-probe/call1a-stream-probe-20260720-115633-573b7f/result.json`

The preserved successful probe observed 15 assertions with no exact repetition.
The test exists to prove streaming instrumentation and exact-normalized
repetition detection, not to claim that every output loop is solved.

### IT-05 — Budget enforcement

Cover:

- output-token ceiling;
- wall-clock ceiling;
- per-stage token and latency accounting;
- parallel-call concurrency;
- partial artifact preservation after abort.

Use the two original `CF1_BUDGET_EXCEEDED` summaries and the slow GPT-5-mini,
chunked, and adapter runs as historical measurements.

### IT-06 — Artifact persistence and report integrity

Verify:

- raw response, normalized output, trace, CSV, and HTML use the same run ID;
- report fields are not silently stripped;
- Call A and Call B values are both visible when a host transformation changes
  a field;
- report links resolve;
- archived runs are not overwritten.

### IT-07 — Training/inference infrastructure

RunPod, LoRA packaging, network-volume persistence, adapter loading, and
OpenAI/local inference comparisons belong here. Training loss or GPU success is
not a CF6 semantic pass.

## 10. Obsolete experiments and mechanisms

These are retained only so they are not accidentally reinvented.

| Obsolete item | Reason |
|---|---|
| Fixture-specific vaccine/source wording and hardcoded CDC, DeStefano, Thompson, JCPH, or Ana Wolpin answers | Contaminates evaluation and does not generalize. |
| Set H source contract | Conflicting source instructions; produced unknowns and schema-invalid runs. |
| Set X canonical-proposition arm | Added complexity, duplicate output, article-author fallback, and worse behavior. |
| Author/byline candidate injected into every unresolved Call 1B packet | Improved some attribution while changing stance and overproducing article voice. |
| Ad hoc CDC candidate suppression | Diagnostic hack, not a general source rule. |
| Census packets passed into Call 1B | Built a second extraction system around 1A and blocked the main flow. |
| Blocking `assertCensusOutcomeCoverage` / `CF1_SPLIT_CENSUS_INCOMPLETE` | Census is diagnostic only. |
| Census-generated claims merged into the live inventory | No reviewed authority; caused intervention rather than observation. |
| Source-order or reverse-source-order selection | Materiality and argument relevance are not unit position. |
| Model materiality labels where every item becomes high | No discriminative value. |
| Host selection that removes every `no_effect` item before considering treatment | Caused F01 and F08 portfolio collapse. |
| Broad adopted-underfill fallback as a semantic repair | Restored counts but admitted procedural noise. |
| V8 broad treatment prompt | Labeled almost everything adopted, including opponents. |
| CF5 Experiment 2 counterfactual-independence wording | Mixed regression; explicitly rejected. |
| Required output for every structural block | Forces filler and pillar collapse. |
| Giant schema keyed by block ID with unit enums | Slow, brittle, and attention-heavy; validate IDs in host code. |
| Schema-order “scratchpad” or atomicity-audit fields as a cure | Did not reliably restore atomicity and sometimes reduced recall. |
| Unbounded full-article adapter inference | The adapter was trained for bounded passages and looped/exploded outside that task. |
| Full-article semantic selection by deterministic keyword logic | Cannot reliably determine meaning, treatment, or thesis dependence. |
| Treating a frozen lucky model response as production behavior | Useful for stage isolation only; not an end-to-end reliability claim. |

## 11. Promotion and retirement rules

### Promote a historical failure to an active regression fixture only when

- the failure represents a current CF6 contract;
- the fixture input and expected behavior are immutable and reviewed;
- the expected behavior is phrased independently of the old model's wording;
- the failure can be scored separately from unrelated stages;
- the case is not already covered by a smaller, clearer fixture.

### Promote a case to a validator fixture only when

- no model judgment is required;
- expected accept/reject behavior is deterministic;
- the fixture contains the smallest object that reproduces the issue.

### Promote a case to a repair fixture only when

- the transformation is provable from supplied text or identifiers;
- it cannot change stance, treatment, source, or substance by inference;
- before, after, rule, and evidence are all retained.

### Move an active fixture to architecture history when

- its contract is no longer part of CF6;
- a smaller reviewed fixture covers the same failure;
- it depends on a retired architecture rather than a semantic requirement.

### Mark an experiment obsolete when

- it contains contradictory instructions;
- it depends on fixture-specific answers;
- it was explicitly rejected by controlled comparison;
- it mutates semantic outputs through a deterministic heuristic that cannot
  justify the meaning change.

## 12. Minimum CF6 acceptance report

Every CF6 evaluation report must expose these layers separately:

1. discovered assertion substance;
2. source and source grounding;
3. article treatment;
4. article-position membership;
5. effect on the specific position;
6. relevance;
7. selection decision and basis;
8. validator outcome;
9. repair history;
10. final package.

For each rejected or missing final assertion, the trace must say where it was
lost:

```text
not discovered
discovered but invalid
quarantined
deduplicated into <id>
irrelevant to every reviewed position
eligible but outranked
selected
```

No composite score may conceal:

- zero challenged assertions on F03;
- source-name collapse;
- all-adopted/all-strengthens label collapse;
- F01/F08 selection underfill;
- a candidate present in discovery but lost without a trace;
- a model/network failure reported as semantic failure.

## 13. Recommended physical layout for the normalized CF6 corpus

The archived artifacts should remain where they are. CF6 should materialize only
small normalized fixtures:

```text
backend/agents/cf6/failure-corpus/
  manifest.json
  active-regressions/
    AR-01-CF1-F01/
    AR-02-CF1-F02/
    AR-03-CF1-F03/
    AR-04-CF1-F06/
    AR-05-CF1-F08/
    AR-06-CF4-THOMPSON-CRUX/
    AR-07-CF5-DIRECT-GENERATION/
    AR-08-F01-F09-SMOKE/
  validators/
    VF-01-one-call-contract/
    ...
  repairs/
    RF-01-grounding-realignment/
    ...
  infrastructure/
    IT-01-model-availability/
    ...
```

Each normalized fixture should contain:

```text
fixture.json
expected.json
source-artifacts.json
README.md
```

`source-artifacts.json` must point back to the immutable run(s) listed in this
manifest. The normalized corpus should copy only the minimum article units,
candidate objects, reviewed targets, and expected trace necessary to reproduce
the failure.

## 14. Bottom line

The active CF6 corpus is not “all the old runs.” It is:

- five deep document fixtures: F01, F02, F03, F06, and F08;
- one inventory-present/selection-missed crux;
- one direct-generation atomicity/label-collapse case;
- one F01–F09 smoke matrix;
- compact validator and deterministic-repair suites;
- independent infrastructure tests.

Everything else remains searchable architecture history or is explicitly
obsolete. This preserves the weeks of evidence without making CF6 carry the
prompts, schemas, host heuristics, and accidental contradictions that produced
the failures.
