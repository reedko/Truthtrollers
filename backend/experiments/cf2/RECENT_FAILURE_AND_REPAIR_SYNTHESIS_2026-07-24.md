# CF2 recent failure and repair synthesis

**Date:** 2026-07-24  
**Status:** Diagnostic synthesis; not a production specification  
**Scope:** CF2 V5 through the rejected V8 treatment experiment, with emphasis on
findings that occurred after the locked V6 baseline was documented

## 1. Purpose

The apparently simple product requirement is:

> Extract the article's important factual assertions in testable form, preserve
> who supplied each assertion, determine how each assertion relates to the
> article, and produce a compact portfolio suitable for evidence search.

The repeated failure is not one bug. Four judgments have been coupled together:

1. **Substance:** What independently testable proposition should be checked?
2. **Attribution:** Who supplies that complete proposition?
3. **Relationship:** Does the proposition strengthen or weaken the article's
   position, and does the article adopt, challenge, or merely report it?
4. **Portfolio relevance:** Is the proposition important enough to retain?

Prompt and host repairs have repeatedly improved one judgment while changing or
destroying another. This document records those interactions so a subsequent
architecture cannot mistake a local improvement for an end-to-end solution.

## 2. Related records

This document supplements rather than replaces:

- `backend/experiments/cf2/BEST_CURRENT_CHECKPOINT.md`
- `backend/experiments/cf2/LOCKED_BASELINE_2026-07-24.md`
- `backend/experiments/cf2/v6/C30_FINDINGS_2026-07-24.md`
- `backend/experiments/cf2/v6/README.md`
- `ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_FINAL_SOLUTION_MCT_2026-07-24.md`

The CF4 MCT primarily addresses loss of source-bearing discourse structure. The
new findings here show an additional independent failure: a single atomic thesis
is too narrow to determine portfolio relevance across many article genres.

## 3. CF2 architecture under test

The tested CF2 V6/V7 flow is:

```text
Call A, whole article
    -> one atomic thesisAssertion
    -> up to 30 source-grounded candidate assertions

Host
    -> grounding repair
    -> local-context expansion
    -> current-work frame repair
    -> literal attribution-cue detection

Call B, all candidates plus local context
    -> attributionLayers
    -> substantiveAssertion
    -> groundingUnitIds
    -> articleTreatment
    -> effectIfTrue

Host
    -> validate/quarantine
    -> derive source from innermost valid attribution layer
    -> apply structural source locks
    -> select up to 12 assertions

Call C
    -> named evidence anchors only
```

Call A currently receives the whole article. CF2 is **not** using chunked
extraction. Call B receives all candidate packets in one call; each packet
contains local and expanded occurrence context.

Models in the latest tests:

- Call A: `gpt-4o-mini` Chat
- Call B: `gpt-4.1-mini`
- Call C: `gpt-4.1-mini`

Nominal budgets:

- candidate maximum: 30
- final portfolio maximum: 12
- candidate validation: quarantine
- portfolio policy: treatment fallback

## 4. Required output, stripped to essentials

The minimum useful assertion package is:

```json
{
  "assertionText": "One atomic, independently testable substantive proposition",
  "groundingUnitIds": ["U####"],
  "sourceName": "Exact person, institution, study, document, or article byline",
  "sourceKind": "person | institution | study | document | article_voice | unknown",
  "sourceUnitIds": ["U####"],
  "articleTreatment": "adopted | challenged | reported",
  "effectIfTrue": "strengthens | weakens | no_effect",
  "scoreTransform": "normal | invert | none",
  "selectionBasis": "Why this assertion entered the final portfolio",
  "evidenceAnchors": []
}
```

Named studies, documents, datasets, regulations, and other search anchors are
useful downstream, but they must not be confused with the assertion supplier.

## 5. Chronology of the latest experiments

| Experiment | Controlled change | Improvement | Failure or regression |
|---|---|---|---|
| V5 | Structural attribution after a minimal two-call docket | Strong F03 candidates; three weakening JCPH assertions; useful grounding repair | Thompson assertion retained its reporting event and lost the intended content supplier |
| V6 | Bounded attribution recursion | Correctly separated `William Thompson revealed P` from substantive `P` when the source frame survived | Live Call A sometimes omitted Thompson or changed assertion phrasing; article treatment remained weak |
| V6 C30 | Candidate ceiling 18 to 30 | Better article coverage and stronger F03 portfolio | More invalid candidates; strict batch validation became unusable |
| Quarantine | Reject invalid candidates individually | Preserved valid work when one candidate failed | Can silently remove important named-source assertions |
| Treatment fallback | Admit `adopted + no_effect` only when underfilled | Restored F01 from 4 to 12 in a saved replay | Depends completely on unstable `articleTreatment` |
| Current-work frame repair | Deterministically unwrap `the study found P` when it is the current article's own study | Prevented F01 attribution-layer quarantine and restored byline attribution | Did not repair treatment or thesis relevance |
| V7 | Forbid Call A from synthesizing absent attribution frames | Restored three clean F03 opponent propositions and `weakens -> invert` | Treatment still `reported`; F01/F08 treatment collapsed; Call A filled F08 to 30 |
| V8, rejected | Broaden `adopted` and narrow `reported` in Call B prose | F01 rose 3 to 12; F08 rose 2 to 12 | Almost everything became adopted, including all three F03 opponent propositions |

## 6. Failure mode: substance and attribution are nested

The Thompson example contains two assertions:

```text
Surface reporting event:
William Thompson revealed privately in 2014 that P.

Embedded substantive proposition P:
The CDC manipulated data linking MMR vaccination to autism.
```

The surface event is supplied by article voice. The embedded proposition is
supplied by Thompson. Flattening both into:

```text
assertionText
assertionSource
```

forces a choice:

- retain `William Thompson revealed P`, and the fact-check target is contaminated
  by an attribution event;
- reduce it to `P`, and the source often disappears;
- add the source back, and the model may reinterpret the row as the reporting
  event again.

### Bounded recursion repair

V6 introduced:

```text
attributionLayers[]
substantiveAssertion
```

Each layer contains:

```text
supplierName
supplierKind
operator
assertedContent
sourceUnitIds
```

The host validates:

- supplier grounding;
- literal operator grounding;
- layer-to-substance continuity;
- absence of retained reporting frames;
- absence of unresolved anaphora;
- representation of mandatory literal cues.

When Call A preserves a real reporting frame, this works. The replay that began
from a good saved Call A correctly produced:

```text
assertionText: The CDC manipulated data linking MMR vaccination to autism.
sourceName: William Thompson
```

### Boundary

The repair cannot reconstruct a source-bearing frame that Call A omitted. It
also cannot safely infer an attribution operator that is absent from the
grounding. This is why lossless surface capture remains necessary.

## 7. Failure mode: Call A invents attribution language

V6's Call A prompt said:

```text
Preserve a reporting frame in rawAssertion when it identifies who supplied the
assertion. A later call will separate source from substance.
```

In one failed F03 run, the article units contained bare JCPH ad propositions, but
Call A emitted:

```text
The type of mercury in vaccines, ethylmercury, is claimed to be not harmful to
us according to public health authorities.

There have been no credible studies that link vaccination to chronic disease
according to public health claims.

Vaccines are tested more than any other medicine you could give your kid
according to public health claims.
```

The generic suffixes did not appear in the cited units. Call A synthesized them
from surrounding context.

Call B then returned all three as:

```text
articleTreatment: reported
effectIfTrue: no_effect
scoreTransform: none
```

The Call A prompt and schema in this failed run were identical to earlier runs
that returned the three propositions without suffixes. The change was in the
model response, not a hidden prompt mutation.

## 8. V7 prompt ablation: explicit attribution only

### Exact Call A change

Old:

```text
Preserve a reporting frame in rawAssertion when it identifies who supplied the
assertion. A later call will separate source from substance.

groundingUnitIds must independently support the assertion. For an attributed
assertion, include the local unit that identifies its supplier.
```

V7:

```text
Preserve an attribution frame only when that frame is explicitly present in the
cited article units. Never append or synthesize "according to X" or another
supplier label absent from those units. A later call will separate an explicit
frame from the substantive assertion.

groundingUnitIds must independently support the assertion. When a neighboring
unit identifies the supplier, include that unit in groundingUnitIds without
adding new attribution language to rawAssertion.
```

Regression tests prove that:

- the Call A system message is unchanged;
- the Call A schema is unchanged;
- replacing the V7 paragraph with the old paragraph reconstructs the complete
  V6 user prompt exactly.

### F03 result

V7 returned:

```text
The type of mercury in vaccines – ethylmercury – is NOT harmful to us.
There have been no credible studies that link vaccination to chronic disease.
Vaccines are tested more than any other medicine you could give your kid.
```

Call B returned all three:

```text
articleTreatment: reported
effectIfTrue: weakens
scoreTransform: invert
```

The host's structural-list rule recovered:

```text
sourceName: Jefferson County Public Health
sourceKind: institution
sourceNameOrigin: host_structural_list_owner
```

### What V7 established

The source-bearing suffix was not harmless prose. Its presence changed Call B's
effect judgment. Preventing absent attribution language restored the intended
substantive comparison.

### What V7 did not establish

- It did not produce `articleTreatment: challenged`.
- It did not recover the outdoor immune-system or tomato/aluminum JCPH
  propositions in that run.
- One successful run does not prove removal of model variability.
- It did not solve portfolio relevance outside F03.

### Artifact

`artifacts/claim-foundry/cf2/cf1-f03-v7-explicit-attribution-only-e2e-r1-20260724`

Measurements:

- 30 Call A candidates
- 27 valid Call B judgments
- 3 quarantined
- 12 selected
- 42.6 seconds
- 34,020 tokens across Calls A, B, and C

## 9. Deterministic repair ledger

### 9.1 Grounding repair

**Purpose:** Correct obviously wrong source-unit IDs when candidate text clearly
matches another article unit.

**What worked:** Recovered candidate-to-unit alignment without asking the model
again.

**Boundary:** Text overlap can validate or relocate a proposition; it cannot
decide who supplies it or whether the article endorses it.

### 9.2 Literal attribution-cue detection

**Purpose:** Detect explicit syntax such as:

```text
According to X, P
X revealed that P
X found that P
```

**What worked:** Forced Call B to represent grounded prefix reporting frames.

**Boundary:** The detector historically did not cover suffix frames such as
`P, according to X`. More importantly, a model-synthesized suffix should not be
treated as article evidence at all.

### 9.3 Current-work frame repair

**Purpose:** Handle Call A output such as:

```text
The study found that P.
We found that P.
Our study showed that P.
```

The host checks:

1. whether the cited grounding independently supports `P`;
2. whether a named external study antecedent appears nearby;
3. whether the grounding actually contains the current-work frame;
4. whether the article has a usable byline.

When the frame is generic, belongs to the current article, and grounding
independently supports `P`, the host reduces it to:

```text
P
```

and records article voice/byline as the source basis.

**What worked:** F01 assertions no longer failed merely because Call B omitted a
layer for an invented `The study found` wrapper.

**Boundary:** This fixed validation and attribution. It did not decide whether a
study result was adopted or whether it mattered to the thesis.

### 9.4 Structural-list ownership

**Purpose:** Resolve assertions in quoted or enumerated lists whose owner is
named in an earlier unit.

Example:

```text
U0005: Jefferson County Public Health published an advertisement.
U0007: Among the statements made:
U0011: No credible studies link vaccination to chronic disease.
```

**What worked:** Recovered JCPH as the source after the assertion itself was
properly stripped of attribution.

**Boundary:** This is safe only for structurally bounded lists. It cannot become
a generic nearest-name rule.

### 9.5 Candidate quarantine

**Purpose:** Prevent one invalid candidate from invalidating a 30-candidate
batch.

**What worked:** Preserved otherwise valid Call B work.

**Boundary:** Quarantine can remove precisely the difficult named-source or
opponent assertion the portfolio needs. Every quarantine remains a recall loss
and must be visible in reports.

### 9.6 Treatment fallback

The current selector implements:

```text
Always eligible:
- effectIfTrue = strengthens or weakens
- articleTreatment = challenged

Fallback only when underfilled:
- articleTreatment = adopted
- effectIfTrue = no_effect

Never automatically rescued:
- reported + no_effect
```

Original labels remain unchanged. The selected row records:

```json
{
  "effectIfTrue": "no_effect",
  "articleTreatment": "adopted",
  "selectionBasis": "adopted_underfill_fallback"
}
```

**What worked:** On a saved F01 replay, the selector expanded the portfolio from
4 to 12 without rerunning either model call.

**Boundary:** It treats `adopted` as an alternate relevance signal. When Call B
changes the same assertion from `adopted` to `reported`, the fallback disappears.

### 9.7 Balanced source-order selection

**Purpose:** Avoid selecting every assertion from one article region.

**What worked:** Improved document-wide distribution among assertions already
deemed eligible.

**Boundary:** It cannot repair semantic eligibility. If later assertions are
`reported + no_effect`, balancing never sees them.

## 10. V7 eight-fixture Call A/B suite

Call C was bypassed. The suite measured discovery and Call B judgments only.

| Fixture | Call A | Valid B | Quarantined | Adopted | Challenged | Reported | Strengthens | Weakens | No effect | Selected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F01 | 30 | 28 | 2 | 2 | 0 | 26 | 3 | 0 | 25 | 3 |
| F02 | 30 | 20 | 10 | 19 | 0 | 1 | 16 | 0 | 4 | 12 |
| F03 | 30 | 29 | 1 | 0 | 0 | 29 | 24 | 3 | 2 | 12 |
| F04 | 30 | 26 | 4 | 6 | 1 | 19 | 9 | 1 | 16 | 10 |
| F05 | 30 | 30 | 0 | 6 | 0 | 24 | 13 | 0 | 17 | 12 |
| F06 | 28 | 27 | 1 | 27 | 0 | 0 | 10 | 0 | 17 | 12 |
| F07 | 29 | 26 | 3 | 5 | 0 | 21 | 6 | 3 | 17 | 9 |
| F08 | 30 | 27 | 3 | 2 | 0 | 25 | 2 | 0 | 25 | 2 |

Totals:

- 237 Call A candidates
- 213 valid Call B judgments
- 24 quarantined
- only 1 `challenged` judgment
- 7 `weakens` judgments
- 72 final selected assertions
- 127,616 Call A/B tokens
- 295.3 seconds of summed Call A/B model latency

Combined report:

`artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724/report.html`

## 11. F01 failure: useful assertions survived Call A and died in Call B

Earlier F01:

- 30 candidates
- 26 `adopted`
- 6 `strengthens`
- 1 `weakens`
- 12 selected under treatment fallback

V7 F01:

- 30 candidates
- 2 `adopted`
- 26 `reported`
- 25 `no_effect`
- 3 selected

At least nine assertions that had previously been selected remained in the new
Call A inventory, including:

- MADDSP case identification;
- the 987-child prevalence population;
- 70.5% versus 67.5% vaccination timing;
- subgroup non-association findings;
- the stronger 36-month association among children aged 3–5;
- the IOM population-level finding;
- delayed development among children vaccinated after 36 months;
- the overall similar MMR timing result.

Call B changed most of them to:

```text
articleTreatment: reported
effectIfTrue: no_effect
```

The collapse was therefore primarily downstream classification, not Call A
recall.

## 12. F08 failure: a descriptive article does not fit one-thesis relevance

F08 contains 131 words and 7 source units.

V7 Call A emitted 30 candidates, not the 10 seen in an earlier run. Several were
duplicates or unsupported extrapolations:

- 18 kilometers west and 11 miles west as separate assertions;
- no tsunami advisory and no tsunami as separate assertions;
- `USGS is an authoritative source`;
- `the earthquake was classified as an inland quake`;
- `the earthquake was part of a series of seismic events`;
- `JMA monitors seismic activity`.

Call B returned:

- 2 `adopted + strengthens`;
- 25 `reported + no_effect`;
- 3 quarantined;
- 2 selected.

The narrow thesis was:

```text
A magnitude 6.2 earthquake shook part of northern Japan early Monday, but there
was no damage or casualties.
```

Location, depth, the USGS magnitude, tsunami status, and advisory context do not
directly strengthen or weaken that atomic sentence. Yet several are central
facts in a useful fact-check docket.

This is not merely a treatment-label problem. It exposes a genre mismatch:
straight news and descriptive reports can contain several central factual
payloads without having one argumentative thesis that subsumes them.

## 13. Root relevance failure: one atomic thesis is too narrow

The primary selector originally admitted only:

```text
effectIfTrue != no_effect
```

This assumes that every material assertion directly strengthens or weakens one
atomic thesis assertion.

That assumption fails:

- a research paper contains methods, population facts, primary results,
  subgroup results, limitations, and explanations;
- a news report contains event identity, location, magnitude, consequences,
  official measurements, and response status;
- an advocacy article contains pillars, evidence claims, opponent claims, and
  rebuttals.

One compound thesis paragraph is not a solution. Earlier experiments showed
that longer thesis descriptions make model comparison less stable. A sentence
that contains multiple tenets is no longer atomic.

Treatment fallback used `adopted` as an alternate relevance proxy. It concealed
the narrow-thesis defect only while treatment labels happened to be favorable.

The failure chain is:

```text
One atomic thesis is too narrow
        ->
Material assertions become no_effect
        ->
articleTreatment is used as a relevance proxy
        ->
articleTreatment varies between adopted and reported
        ->
the portfolio unpredictably collapses
```

## 14. Failure mode: article treatment collapses to a default category

The V6 treatment definitions were:

```text
adopted: the article uses the substantive assertion as part of its own case
challenged: the article introduces it to dispute, reject, or discredit it
reported: the article reports it without clearly adopting or challenging it
```

In the V7 F01/F03/F08 outputs, `reported` acted as a broad default:

- scholarly findings presented by their own paper became reported;
- ordinary earthquake facts became reported;
- JCPH opponent assertions became reported;
- almost no assertion became challenged.

Across 213 valid judgments, only one was labeled `challenged`.

This means `articleTreatment` is not currently reliable enough to:

- identify opponent propositions by itself;
- rescue thesis-relative `no_effect`;
- determine final portfolio inclusion.

## 15. Rejected V8 treatment prompt

V8 was a frozen-input Call B ablation. It replayed the exact V7 Call A outputs
for F01, F03, and F08. Therefore differences came from Call B, not discovery.

### Exact treatment change

Old:

```text
adopted: the article uses the substantive assertion as part of its own case
challenged: the article introduces it to dispute, reject, or discredit it
reported: the article reports it without clearly adopting or challenging it
```

V8:

```text
adopted: the article presents the substantive assertion as true or uses it as a
factual premise, result, or conclusion. This includes the article's own study
methods and results and ordinary news facts stated without distancing, even when
the fact is attributed to an external source.

challenged: the article introduces the substantive assertion to dispute, reject,
or discredit it.

reported: the article explicitly withholds commitment or presents the
substantive assertion merely as another party's unresolved account. Attribution
alone does not make an assertion reported.
```

The schema and all other Call B prose remained unchanged.

### Results

| Fixture | Before V8 | V8 |
|---|---|---|
| F01 | 2 adopted; 3 selected | 26 adopted; 12 selected |
| F03 | 0 adopted; 3 weakening opponents | 28 adopted; the 3 opponents also adopted |
| F08 | 2 adopted; 2 selected | 27 adopted; 12 selected |

F03 returned:

```text
ethylmercury is not harmful
    -> adopted + weakens

no credible studies link vaccination to chronic disease
    -> adopted + weakens

vaccines are tested more than other medicines
    -> adopted + weakens
```

No F03 assertion became `challenged`.

### Conclusion

V8 did not solve treatment. It moved the model's default from `reported` to
`adopted`. It also overfilled F08 with redundant and low-value assertions.

The V8 code and prompt were removed. Generated artifacts remain diagnostic:

`artifacts/claim-foundry/cf2/v8-treatment-replay-f01-f03-f08-r1-20260724`

The three Call B replays used 29,319 tokens.

## 16. Prompt ordering and semantic cross-contamination

Repeated controlled and uncontrolled experiments show that fields are not
independent merely because the schema lists them separately.

Observed interactions include:

- source-bearing wording changed thesis effect;
- adding source candidates changed stance decisions;
- article-author fallback changed treatment/stance distributions;
- removing attribution wording restored opponent effect;
- broadening treatment definitions altered nearly every treatment label;
- increasing the candidate ceiling changed not only count but content,
  duplication, and downstream behavior.

The model performs one joint generation. Schema order, enum prevalence, prompt
examples, input length, candidate order, and neighboring tasks can all affect
every returned field.

Therefore:

> A prompt change aimed at source, treatment, atomicity, or recall must be
> presumed capable of changing all other semantic outputs until a frozen-input
> ablation proves otherwise.

## 17. Candidate ceilings are interpreted as targets

The Call A prompt says:

```text
Return no more than 30 candidate assertions.
Do not fill a quota.
```

Nevertheless:

- most fixtures returned exactly 30;
- F08 returned 30 candidates from 7 source units and 131 words;
- larger ceilings previously changed output content rather than merely
  preventing truncation.

The model frequently treats a maximum as a requested count. A host-provided
ceiling is still necessary to prevent runaway output, but it must not be treated
as evidence that the candidate inventory is appropriately sized.

Potential future controls must separately address:

- hard emergency output ceiling;
- duplicate suppression;
- unsupported proposition rejection;
- article-length-aware portfolio expectations;
- discovery completeness.

## 18. What appears genuinely useful

The following components have demonstrated bounded value:

1. **Simple whole-article Call A prose** produces readable, often atomic
   substantive candidates with broad article coverage.
2. **A larger candidate pool than the final portfolio** avoids some zero-sum
   competition among argument clusters.
3. **Candidate-level quarantine** prevents all-or-nothing batch loss.
4. **Grounding overlap repair** can correct obvious unit-ID mistakes.
5. **Current-work frame repair** can safely remove a narrow class of invented
   `the study found P` wrappers.
6. **Structural-list ownership** can recover sources such as JCPH without
   contaminating assertion text.
7. **Bounded attribution recursion** works when source-bearing discourse has not
   already been discarded.
8. **Effect-based opponent detection** sometimes succeeds even when the
   treatment label does not.
9. **Frozen-input replays with prompt/schema fingerprints** distinguish a Call B
   change from fresh Call A variability.

None is sufficient alone.

## 19. What remains unsolved

### Substance

- Call A varies in which material assertions it emits.
- It may fill a ceiling with duplicates or invented extrapolations.
- It may omit difficult attributed or opponent propositions.
- It can preserve a reporting frame, omit it, or synthesize one.

### Attribution

- Sources disappear when reporting frames are removed.
- Article voice is overused when no explicit layer survives.
- Generic source labels may be synthesized.
- Evidence anchors can be mistaken for assertion suppliers.
- Safe deterministic repair exists only for narrow structural patterns.

### Stance and treatment

- `articleTreatment` oscillates among broad default categories.
- `effectIfTrue` can change when source wording changes.
- Opponent claims may be found but not marked challenged.
- A proposition can emerge as `adopted + weakens`, exposing inconsistent joint
  judgment.

### Portfolio relevance

- A single atomic thesis does not cover multiple factual tenets.
- `no_effect` is not equivalent to unimportant.
- `adopted` is too unstable to serve as the only fallback relevance signal.
- Short descriptive articles and primary studies fail differently under the
  same thesis-effect policy.

### Reproducibility

- A seed reduces one source of sampling variability but does not guarantee
  deterministic API behavior.
- Byte-identical prompts and schemas have produced materially different
  semantic inventories.
- Model and system fingerprints are provenance, not a correctness guarantee.

## 20. Requirements for an encompassing solution

Any new solution must represent and decide these dimensions separately.

### 20.1 Preserve lossless discourse structure

Capture both:

```text
surface source-bearing statement
substantive proposition P
```

Do not overwrite one with the other.

### 20.2 Keep attribution recursive and bounded

Represent:

```text
article voice reports that
person says that
study found that
P
```

The active fact-check assertion and its content supplier should be deterministic
projections from a validated chain.

### 20.3 Separate treatment, effect, and relevance

These are not synonyms:

```text
articleTreatment
    What the article does rhetorically with P

effectIfTrue
    What assuming P true does to a specific article position

portfolioRelevance
    Whether checking P materially helps evaluate or understand the article
```

No one field should silently substitute for another.

### 20.4 Replace one thesis target with an article-position map

A compound thesis paragraph is not acceptable. A candidate solution may use a
small set of atomic core positions:

```json
[
  {
    "coreId": "CORE01",
    "coreQuestion": "Evidence-resolvable question",
    "articlePosition": "The article's atomic answer or position"
  }
]
```

Candidate assertions may relate to zero, one, or several cores.

However, directional core positions must not be derived by majority vote from
an unlabeled candidate pool. That pool contains opponent assertions. Candidate
coverage may audit or refine a core map, but article posture must determine each
core's direction.

### 20.5 Support descriptive as well as argumentative genres

For straight news, the equivalent of a thesis map may be a set of central event
facts rather than argumentative tenets. The representation must accommodate:

- central event identity;
- measurements;
- location and timing;
- consequences;
- official response;
- material context.

### 20.6 Prevent source identity from deciding stance

The same proposition must receive the same content-effect judgment whether its
supplier is represented as:

```text
CDC
Jefferson County Public Health
article voice
unknown
```

unless source identity is itself the proposition being evaluated.

### 20.7 Limit deterministic code to enforceable structure

Good deterministic responsibilities:

- validate unit IDs;
- validate literal attribution operators;
- validate source-name occurrence;
- validate chain continuity;
- remove exact duplicates;
- enforce output ceilings;
- preserve lineage and fingerprints;
- apply known structural ownership;
- balance already-eligible assertions across the article.

Unsafe general deterministic responsibilities:

- infer who semantically supplies an arbitrary proposition;
- infer whether an assertion supports a complex thesis;
- infer whether an article endorses an arbitrary attributed statement;
- infer materiality from lexical overlap alone.

### 20.8 Make every recovery observable

Reports must distinguish:

```text
not discovered
discovered but quarantined
valid but judged no_effect
valid but judged reported
eligible but not selected
selected by primary effect
selected by fallback
source repaired structurally
source unresolved
```

Without this separation, recall failure, semantic failure, validation failure,
and selection failure appear as one missing row.

## 21. Required evaluation gates

A proposed architecture should not be promoted from one good F03 run.

Minimum gates:

1. Run F01–F09 end to end.
2. Repeat at least the high-variance fixtures F01, F03, and F08.
3. Freeze upstream output when testing a downstream prompt.
4. Record complete prompt and schema hashes for every call.
5. Record response ID, returned model, system fingerprint, latency, and token
   usage.
6. Compare every Call A candidate with every post-validation judgment.
7. Score separately:
   - material assertion recall;
   - atomicity;
   - grounding correctness;
   - attribution correctness;
   - opponent preservation;
   - article treatment;
   - effect relative to the correct article position;
   - portfolio coverage and redundancy.
8. Reject any improvement that merely shifts a default category:
   - reported to adopted;
   - unknown to article voice;
   - no_effect to strengthens;
   - missing source to contaminated assertion text.

## 22. Current code and artifact state

- V6 remains the locked comparison baseline.
- V7 exists as an isolated Call A attribution-language experiment.
- V8 source code and prompt changes were removed after the frozen-input
  over-adoption result.
- V8 result artifacts were preserved.
- V6/V7 regression tests pass.
- No production extraction code was changed by V7/V8.

Important artifacts:

- V7 F03:
  `artifacts/claim-foundry/cf2/cf1-f03-v7-explicit-attribution-only-e2e-r1-20260724`
- V7 F01–F08 Call A/B suite:
  `artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724`
- Rejected V8 frozen Call B replays:
  `artifacts/claim-foundry/cf2/v8-treatment-replay-f01-f03-f08-r1-20260724`

## 23. Bottom line

The task is not failing because one prompt lacks the right sentence.

It is failing because the current architecture asks one jointly generated row to
simultaneously settle:

```text
what P is
who supplies P
what the article does with P
what P does to one thesis sentence
whether P deserves a portfolio slot
```

Those judgments influence one another inside the model, while the host then
uses unstable semantic labels as hard selection gates.

The encompassing solution must:

1. preserve source-bearing discourse without contaminating P;
2. represent multiple atomic article positions or central factual payloads;
3. compare P with the correct local position rather than one universal thesis;
4. keep rhetorical treatment separate from evidential effect;
5. keep both separate from portfolio relevance;
6. use deterministic code for validation and projection, not open-ended semantic
   inference;
7. prove performance across genres and repeated runs before promotion.

Anything less is another local repair likely to recreate the same failure under
a different field name.
