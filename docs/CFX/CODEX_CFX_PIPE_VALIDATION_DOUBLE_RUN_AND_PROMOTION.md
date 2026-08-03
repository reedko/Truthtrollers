# Codex Task: CFX Pipe Validation, Double-Run Reporting, and Conditional Promotion

Use the current CFX pipeline and latest retrieval implementation as governing context.

## Objective

Run the complete CFX-to-retrieval pipeline over several diverse fixtures, run each fixture twice, generate comparison reports, make evidence-based recommendations, and promote the pipeline into production only if the acceptance gates are satisfied.

Do not redesign the architecture.

## Governing pipeline

S0
→ S1 burden-bearing propositions + associated unit IDs
→ S2 substantive assertion + assertion source + article stance
→ deterministic evidence-search hints
→ five-lane query planning
→ PubMed query compilation where applicable
→ bounded provider retrieval
→ candidate normalization
→ deterministic deduplication with provenance preservation
→ human-review report

Do not add final bearing adjudication, evidence stance scoring, source-quality scoring, or portfolio selection in this task.

## Fixture selection

Select at least 3 existing repository fixtures:

1. One biomedical or health-heavy article.
2. One mixed-domain article containing scientific, institutional, historical, legal, or policy assertions.
3. One mostly non-biomedical article.

Prefer fixtures already used in prior ClaimFoundry or EvidenceRun acceptance work. The vaccine fixture may be included, but at least two additional fixtures must be run.

## Double-run requirement

Run every fixture twice with identical code, configuration, provider settings, and model settings:

- `<fixture>-run-a`
- `<fixture>-run-b`

Inspect semantic stability, query stability, retrieval overlap, provider behavior, and artifact reproducibility.

## Required outputs per run

Persist:

- `s0-source-units.json`
- `s1-propositions.json`
- `s2-substantive-review.json`
- `deterministic-evidence-handoff.json`
- `query-plan.json`
- `raw-provider-responses/`
- `normalized-candidates.json`
- `deduped-candidates.json`
- `retrieval-accounting.json`
- `report.html`
- `run-manifest.json`
- `artifact-hashes.json`

## Required fixture comparison reports

For each fixture generate:

- `comparison-report.html`
- `comparison-report.md`
- `comparison-report.json`

Compare run A and run B on:

- proposition count, identity, and semantic overlap;
- assertion-source stability;
- article-stance stability;
- grounding-unit overlap;
- deterministic hint stability;
- query text overlap by lane;
- PubMed applicability and routing agreement;
- PubMed compiler output;
- raw and deduplicated candidate counts;
- candidate overlap by DOI, PMID, canonical URL, and normalized title;
- provider failures;
- latency, tokens, estimated cost;
- artifact hash differences.

Show exact disagreements, not just aggregate scores.

## Query and retrieval review

For every proposition inspect:

- whether the five query lanes are meaningfully distinct;
- whether Q3 source identity is useful or generic noise;
- whether PubMed routing is appropriate;
- whether PubMed syntax uses indexed biomedical terms rather than argumentative prose;
- whether good evidence, counterevidence, and material qualifications are retrieved;
- whether retrieval is polluted by topic-only or identity-only results;
- whether candidate metadata is sufficiently normalized;
- whether deduplication preserves every discovery path.

Do not add final evidence-stance adjudication.

## PubMed compiler checks

Preserve productive PubMed regression targets.

For PubMed-applicable propositions:

- compile queries from literal biomedical components;
- use fielded syntax where appropriate;
- avoid wording such as `high-quality evidence`, `no credible studies`, `supports`, or `refutes`;
- use a fallback ladder:

  1. identity-rich query;
  2. remove date or exact-phrase constraint;
  3. relax one required outcome to OR;
  4. preserve the core exposure/intervention and outcome relationship.

Record each fallback and result count.

Route claims away from PubMed when they primarily concern institutional misconduct, legal interpretation, advertising provenance, political history, or document identity.

## Acceptance gates

Recommend promotion only if all are true across the fixture set:

1. S1 consistently returns coherent burden-bearing propositions.
2. S2 does not materially mutate proposition meaning.
3. Assertion source and article stance are broadly stable.
4. Grounding is inspectable and materially relevant.
5. Query lanes are distinct and useful.
6. Generic source labels do not dominate Q3.
7. PubMed routing is appropriate.
8. PubMed retrieves materially relevant records or fails transparently with sensible fallbacks.
9. Most investigable assertions retrieve at least one directly or materially bearing candidate.
10. Counterevidence or material qualification appears where reasonably available.
11. Provider failures do not erase successful sibling lanes.
12. Normalization and deduplication preserve provenance.
13. Reports diagnose failures without requiring raw-artifact inspection.
14. No hidden claim rewriting, bearing adjudication, semantic ranking, or scoring was introduced.

## Recommendation report

Generate:

- `PIPE_VALIDATION_RECOMMENDATION.md`
- `PIPE_VALIDATION_RECOMMENDATION.html`
- `PIPE_VALIDATION_RECOMMENDATION.json`

Include:

- fixtures selected and why;
- run-by-run metrics;
- stability findings;
- strongest successes;
- weakest failures;
- PubMed performance;
- query-lane performance;
- candidate-quality observations;
- exact defects found;
- exact repairs made;
- unresolved risks;
- one explicit verdict: `PROMOTE`, `PROMOTE WITH CONDITIONS`, or `DO NOT PROMOTE`.

Do not recommend promotion merely because the pipeline completed.

## Conditional production promotion

Only when the verdict is `PROMOTE` or `PROMOTE WITH CONDITIONS`, integrate the validated CFX-to-retrieval path into production.

Requirements:

- place it behind a feature flag;
- preserve the existing production path for rollback;
- do not delete legacy code;
- add production configuration validation;
- add structured logging and run IDs;
- persist the same artifacts and accounting;
- add regression tests for the selected fixtures;
- add smoke tests for one biomedical and one non-biomedical fixture;
- document rollback steps and immediate disablement.

If the verdict is `DO NOT PROMOTE`, stop after the recommendation report and list the minimum repairs required before another validation cycle.

## Final response

Report:

1. exact fixtures used;
2. exact commands run;
3. exact files changed;
4. test results;
5. comparison reports produced;
6. recommendation verdict;
7. whether promotion occurred;
8. feature flag name and rollback procedure if promoted;
9. paths to all artifacts.

Keep the implementation minimal. Reuse tested TM4, TM5, CF1-CF7, legacy production EvidenceRun, PubMed, provider, normalization, deduplication, accounting, and reporting utilities where safe. Do not import old orchestration, claim mutation, semantic filtering, or scoring machinery merely to reuse a helper.
