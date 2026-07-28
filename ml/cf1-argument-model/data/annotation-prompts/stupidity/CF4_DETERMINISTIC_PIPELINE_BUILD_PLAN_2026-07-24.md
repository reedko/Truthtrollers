# CF4 Build Plan — Deterministic Assertion Pipeline

**Date:** 2026-07-24
**Premise:** Generative API calls are unavailable or unworkable for CF1's extraction and
labeling work. Everything mechanical moves to code; the only model components are small,
local, and task-specific (classification, not generation).
**Scope:** New track `backend/experiments/cf4/`. CF1 live, CF2, ER1, CF3 untouched.
CF3 artifacts are reused as evaluation material, not as design authority.

---

## 0. Why this exists (one paragraph, for whoever picks this up cold)

Four rounds of prompt engineering failed to make a generative model strip an attribution
frame from an assertion. The reason is that de-attribution is not a judgment task — it is
a dependency parse. `William Thompson revealed in 2014 that the CDC manipulated data` has
a reporting verb, a subject, and a complement clause; splitting subject from complement is
deterministic. The same is true of coreference ("the agency" → CDC), clause splitting
(atomicity), and lineage. Stance is genuinely semantic but is an NLI task, not a
generation task. Selection is a coverage optimization, not a preference. This plan moves
each operation to the mechanism that matches its actual shape.

**Governing principles carried forward:** no fixture-specific content anywhere in code or
config; sealed gold keys built blind from articles, never from run output; full-state
specs, never fragments; staged gates with stop conditions; minority-class metrics reported
separately, never aggregate-only.

---

## 1. Target contract (unchanged from CF1 product objective)

Per article, ~12 selected assertions, each with:

```json
{
  "assertionId": "A001",
  "testableAssertion": "string",
  "groundingUnitIds": ["U0001"],
  "assertionSource": { "name": "string", "kind": "article_voice|person|institution|study|document|unknown", "sourceUnitIds": ["U0001"] },
  "articleTreatment": "adopted|challenged|reported",
  "thesisEffect": "strengthens|weakens|no_effect",
  "scoreTransform": "normal|invert|none",
  "argumentBranchId": "B01",
  "citedWorks": [{ "name": "string", "type": "study|dataset|report|law|document|researcher", "sourceUnitIds": ["U0001"] }],
  "structuredForm": { "agent": "string", "predicate": "string", "object": "string", "time": "string|null", "quantity": "string|null" }
}
```

Plus `stanceAnchor` (one concise assertion) and `argumentBranches`.

`structuredForm` is new and is a deliberate bet: entity/predicate triples may serve
evidence retrieval better than fluent paraphrase. Measured, not assumed (§7, Q4).

---

## 2. Pipeline

```text
article
  │
  ├─ S0  ingest + unit segmentation                    [deterministic]
  ├─ S1  parse: dependency, NER, coreference           [local models, deterministic decode]
  ├─ S2  attribution split  → assertionSource          [rules over S1]
  ├─ S3  candidate generation: clause split + filter   [rules over S1/S2]
  ├─ S4  stanceAnchor derivation                       [graph + rules, see §3.4]
  ├─ S5  thesisEffect                                  [NLI classifier]
  ├─ S6  articleTreatment                              [classifier + discourse features]
  ├─ S7  selection: centrality + coverage optimization [graph algorithms]
  ├─ S8  citedWorks, structuredForm, scoreTransform    [rules]
  └─ S9  validation, findings, report, provenance      [deterministic]
```

Every stage writes its full output to disk. Any stage can be replayed from the previous
stage's artifact without re-running upstream work. This is the property CF3 lacked and the
reason its experiments were expensive.

---

## 3. Stage specifications

### S0 — Ingest and unit segmentation
Reuse CF1's existing unit segmentation. Output: `units.json` — `[{unitId, text, charStart, charEnd, quarter}]`. Quarter computed from character position for coverage metrics.

### S1 — Parse
Libraries: spaCy (`en_core_web_trf`) for dependency + NER; a coreference model
(fastcoref or maverick-coref) for referent resolution. Pin versions; record in provenance.
Output per sentence: token list, dependency arcs, POS, named entities with types, and a
coreference cluster map.
Coreference application rule: replace a mention with its cluster's most specific mention
(prefer proper noun over definite description over pronoun) **only** when the antecedent is
unambiguous within the cluster; otherwise leave the surface form and record a
`CF4_UNRESOLVED_REFERENT` finding.
**Gate S1:** on the F03 article, "the agency" in the Thompson passage resolves to CDC.

### S2 — Attribution split
Two inputs: a reporting-verb lexicon and dependency patterns.

Lexicon: seed from PARC 3.0's attribution-annotated verb inventory plus a manual list
(say, tell, claim, reveal, report, find, show, argue, allege, state, testify, announce,
conclude, warn, admit, deny, insist, maintain, note, write). Store as config, not code.

Patterns (each yields `source` and `content`):
1. `SUBJ + REPORTING_VERB + ccomp` → source = SUBJ subtree, content = ccomp subtree.
2. `according to X, Y` (prep phrase) → source = X, content = Y.
3. `X's study/report/analysis found that Y` → source = the possessive + work noun, content = ccomp.
4. Direct quotation with attribution (`"Y," said X` / `X said, "Y"`) → source = X, content = quote span.
5. No attribution pattern present → source = article byline, kind = `article_voice`.

`kind` assignment from NER type of the source span: PERSON→person; ORG→institution;
WORK_OF_ART/document nouns (study, report, act, summary, analysis)→study/document; byline
fallback→article_voice; unresolvable→unknown. **A named entity never receives
`article_voice`** — enforced as a hard rule, which removes the CF3 name↔kind contradiction
class by construction.

Nested attribution (`X said that Y claimed Z`): recurse; the innermost content is the
assertion, the innermost attributor is the source, and the outer chain is recorded in
`attributionChain` for provenance.

**Gate S2 (the make-or-break gate):** on F03 unit U0037, output is
`source = {name: "William Thompson", kind: "person"}` and
`content = "the CDC manipulated data linking the MMR vaccine to autism ~2004"` (or the
coreference-resolved equivalent). If S2 cannot do this, stop and report — the plan's
central premise is wrong.

### S3 — Candidate generation
From de-attributed content:
1. Split on coordination (`conj` arcs joining independent predicates) and on
   subordinate clauses that carry their own testable predicate.
2. Keep a clause when it has (a) a finite verb, and (b) at least one of: named entity,
   number, date, or a predicate with a measurable object.
3. Drop questions, imperatives, and clauses whose head is a pure evaluative predicate
   (config list, e.g. "is outrageous", "is heartbreaking").
4. Attach `groundingUnitIds` from source char spans — lineage is exact, not model-asserted.
5. Normalize and dedupe (exact, then lemma-normalized).

Recall-oriented by design. Overgeneration is correct here; §S7 does the narrowing.
**Gate S3:** ≥90% of gold-key assertions present in the candidate pool on every fixture.

### S4 — Stance anchor
Not a generation task under this constraint. Derivation:
1. Build the entity/predicate graph (§S7 step 1) over all candidates.
2. Take the highest-centrality candidate whose predicate is evaluative-or-causal about the
   article's dominant entity cluster.
3. If the title parses as a declarative assertion, prefer it (titles are usually the
   thesis) and record which rule fired.
**Known limitation:** this yields an *existing* assertion, not a synthesized thesis. That
is a real quality loss vs. the generative version. Measure it (§7, Q2) and treat it as the
first candidate for reinstating a small local generative model if one is ever permitted.

### S5 — thesisEffect (NLI)
Model: DeBERTa-v3-large-MNLI (~400M) or similar, local, deterministic decode.
Premise = candidate assertion; hypothesis = stanceAnchor.
entailment → strengthens; contradiction → weakens; neutral → no_effect.
Calibrate the neutral band on the gold key; record thresholds in provenance.
This is the counterfactual rule in its native form: NLI is exactly "assume P, what happens
to Q." The receipt from the CF1 record transfers.
**Gate S5:** ≥70% correct on gold `weakens` rows (minority class reported separately).

### S6 — articleTreatment
Features available from S1–S3, no new model needed for v1:
- is the assertion inside attributed material (from S2)?
- is its source the article byline?
- does a contrastive discourse marker attach to or follow the span ("but", "in fact",
  "the truth is", "however", "yet")?
- is the source entity one the article elsewhere contrasts against (built from the set of
  sources that co-occur with contrastive markers)?
- is the assertion negated or rebutted in an adjacent unit (NLI contradiction between the
  assertion and a following unit)?

v1: rule-based over these features. v2 (once the gold key has enough labeled rows): a
small supervised classifier (logistic regression or gradient boosting) over the same
features. `challenged` is the minority class and the one that matters — it must be
reported separately, never inside an aggregate.

**Design note:** this replaces the CF3 census. The CF3 census keyed on quotation marks and
produced 36/133 flags with ~31 false positives. Discourse-marker + source-contrast
features are the actual signal; quotation is not.
**Gate S6:** `challenged` precision ≥0.8 and recall ≥0.8 against the gold key on F03.

### S7 — Selection
1. **Graph.** Nodes = candidates. Edges weighted by shared named entities, shared
   predicates, shared units (proximity), and NLI relatedness above a threshold.
2. **Centrality.** PageRank over that graph → the crux axis, computed rather than
   self-scored. This is the answer to "materiality was non-discriminative": the earlier
   failure was pointwise self-scoring; centrality is comparative by construction.
3. **Branches.** Community detection (Louvain) → `argumentBranchId`; `branchQuestion` is
   templated from the community's dominant entity + predicate. Coarse but non-degenerate —
   note CF3 produced 12 branches for 12 assertions, i.e. no grouping at all.
4. **Optimization.** Fill 12 slots maximizing a submodular objective:
   `w1·centrality + w2·entity_coverage + w3·branch_coverage + w4·quarter_coverage`
   subject to hard constraints: every high-centrality `challenged` assertion retained; no
   two selections above a redundancy threshold; ≥1 slot per major branch that has a viable
   candidate. Greedy submodular maximization gives a (1−1/e) guarantee and, more usefully,
   an inspectable reason per pick.
5. Weights are config, tuned on the gold key, recorded in provenance.

**Gate S7:** the F03 crux (CDC/MMR manipulation) selected in 3/3 runs — trivially, since
the pipeline is deterministic, so this is really "selected at all"; plus branch coverage
and opponent retention no worse than the CF3 balanced arm.

### S8 — Derived fields
- `citedWorks`: NER (WORK_OF_ART, ORG) + document-noun patterns (study, act, report,
  analysis, summary) within the assertion's unit window, typed by pattern. This fixes the
  CF3 defect where the field existed but came back empty 12/12.
- `structuredForm`: agent/predicate/object/time/quantity read directly off the S1 parse of
  the de-attributed content.
- `scoreTransform`: adopted→normal; challenged→invert; reported→by thesisEffect
  (strengthens→normal, weakens→invert, no_effect→none). Unchanged host rule.

### S9 — Validation, findings, report
Structural violations throw: count ≠ portfolio size, non-unique IDs, unit IDs outside the
article range, enum violations, `structuredForm` missing an agent or predicate.

Findings (non-blocking, rendered):
`CF4_UNRESOLVED_REFERENT`, `CF4_ATTRIBUTION_UNPARSED` (no pattern matched a sentence with
a reporting verb), `CF4_NESTED_ATTRIBUTION`, `CF4_SOURCE_FUSED` (source name still in
assertion text — should be structurally impossible; firing means an S2 bug),
`CF4_LOW_CENTRALITY_SELECTION`, `CF4_BRANCH_CONCENTRATION`, `CF4_QUARTER_GAP`,
`CF4_POLARITY_SUSPECT` (negation-parity mismatch between candidate and its source span).

Report shows, per selected row: source span text, de-attributed assertion, structured
form, source, labels, centrality score, and **which rule or pattern produced each field**.
Full inspectability is the point of this architecture.

---

## 4. Prerequisite: sealed gold keys

Nothing in §7 is measurable without these. **Codex builds them, blind — from the articles
and fact-checking judgment only, never from any CF3 or CF4 run output.** A key derived
from run output validates the runs circularly.

Per fixture (F02, F03, F06):
- the ~12–15 assertions a competent fact-checker must cover, in testable form, with
  grounding units;
- a crux flag on the load-bearing one(s);
- the must-appear opponent set;
- per entry: correct `assertionSource` (name + kind), `articleTreatment`, `thesisEffect`;
- a justified-omission list — material a fact-checker legitimately would not select
  (this also settles the outstanding "empty quarter: miss or justified?" question).

Seal with a content hash. Any later edit to a key invalidates prior scores against it and
must be logged.

---

## 5. Work breakdown

**Claude (Fabicles) — implementation**

| ID | Task | Depends on |
|---|---|---|
| T1 | Scaffold `cf4/`, stage-artifact I/O, provenance, config loading | — |
| T2 | S0 unit segmentation (port from CF1) | T1 |
| T3 | S1 parse + coreference, pinned versions | T2 |
| T4 | **S2 attribution splitter** + verb lexicon config | T3 |
| T5 | S3 candidate generation + dedupe + lineage | T4 |
| T6 | S8 citedWorks + structuredForm extractors | T5 |
| T7 | S5 NLI stance | T5 |
| T8 | S6 treatment rules v1 | T5, T7 |
| T9 | S4 stance anchor derivation | T5 |
| T10 | S7 graph, centrality, communities, submodular selection | T5 |
| T11 | S9 validation, findings, report | T6–T10 |
| T12 | Scoring harness: run output vs sealed gold key, per-metric, minority classes separate | T11, K1 |

**Codex — verification and keys**

| ID | Task |
|---|---|
| K1 | Build and seal gold keys for F02, F03, F06 (blind, before T12 scoring) |
| K2 | Independent audit of S2 output on F03: every attribution split checked by hand |
| K3 | Audit that no fixture-specific content appears in cf4 code or config |
| K4 | Verify stage artifacts are replayable: re-run S5–S9 from a frozen S3 artifact and confirm byte-identical output |

**Reed — decisions**

- Approve or reject after the Gate S2 spike (§6, Phase 0).
- Adjudicate S4's known quality loss (derived vs synthesized stance anchor).
- Set selection weights policy after the first gold-key scoring.

---

## 6. Phasing and stop conditions

**Phase 0 — the spike (do this first, alone, before anything else is built).**
Implement S1 + S2 only. Run over the F03 sentences that contain the Thompson cluster and
over the CF3 inventory items that carry attribution frames. Hand-check every split.
- **Proceed** if attribution splits are ≥90% correct by hand-audit, including U0037.
- **Stop and report** otherwise. If a dependency parser cannot split
  `X revealed that Y` reliably on this article, the plan's premise is wrong and no further
  work is justified.
This is a few hours of work and it either vindicates or kills the direction cheaply.

**Phase 1 — inventory.** T1–T6 plus K1, K3. Gate: S3 candidate recall ≥90% against the
sealed keys on all three fixtures; lineage exact; citedWorks populated where the gold key
says a work exists.

**Phase 2 — labels.** T7–T9, K2. Gates S5 and S6 as specified. Minority classes reported
separately; an aggregate number alone is not evidence.

**Phase 3 — selection.** T10–T12, K4. Gate S7 plus: opponent retention, branch coverage,
and quarter distribution no worse than the CF3 balanced arm on F03, and crux selected.

**Phase 4 — comparison.** Score CF4 against the CF3 balanced arm and against the sealed
keys on all three fixtures. Report per-dimension, not aggregate. Decide what, if anything,
justifies reintroducing a generative component — the two standing candidates are S4
(stance anchor synthesis) and assertion fluency.

Do not begin a phase before the prior phase's gate passes. Do not tune weights against
F03 alone; F03 is the debugging canary, and promotion evidence requires F02 and F06.

---

## 7. Open questions to answer with data, not argument

1. **Does S2 handle F03's attribution density?** Phase 0 answers this. Everything else is
   contingent on it.
2. **How much worse is a derived stance anchor than a generated one?** Score S4's output
   against the gold key's thesis statement; the gap is the price of the constraint.
3. **Can rule-based S6 reach 0.8/0.8 on `challenged`?** If not, the supervised v2 needs
   labeled data beyond three fixtures — scope that before committing.
4. **Does `structuredForm` improve evidence retrieval over prose assertions?** Test in
   Call 2 with both forms; this is the one place the constraint may produce a better
   product, and it should be measured rather than assumed.
5. **Does PageRank centrality actually identify the crux?** Check whether the F03 crux
   ranks top-3 by centrality before relying on it for selection.

---

## 8. What this plan explicitly does not do

No generative API calls in the pipeline. No fine-tuned adapter (the existing one is a
row-level extractor and remains parked). No prompt engineering — there are no prompts. No
semantic judgment in host code beyond the classifiers named in S5/S6, which are trained or
calibrated against sealed keys rather than hand-tuned against a fixture. No fixture-specific
rules, lexicons, or thresholds anywhere in code or config.
