# Bearing Prompt Logic Reuse Plan

## Executive Summary

VeriStrata already has several fragments of genuine bearing logic, but they are distributed across claim extraction, argument mapping, post-scrape quote extraction, claim matching, and a manual claim-relevance utility. The strongest existing instructions are: the extraction stack's `search_assertions`; argument mapping's separation of an attribution wrapper from its object claim; `extractQuotesAndScoreQuality()`'s instruction to evaluate the exact factual assertion rather than the broad topic; and claim matching's rule that evidence supports a task claim only when it makes that claim more likely true. Those should be reused.

The live pipeline does not currently carry these fragments through as one coherent concept. In particular:

- `claim_extraction_stack_system` and `claim_extraction_stack_with_topics` ask for `searchAssertions`, `fallibilityCriticalClaims`, `claimKind`, `evidenceType`, `articleStance`, entities, and dates, but `claimsEngine.js` retains only a small flattened subset. `searchAssertions` are not persisted or passed to `runEvidenceEngine()`. `fallibility_critical` is not an allowed persisted role and is normalized to ordinary `evidence` if it survives at all.
- `runEvidenceEngine()` therefore constructs up to three deterministic targets with `buildSearchTargets()`. These targets contain useful attribution/object-claim logic, but are mostly text transformations and a narrow hardcoded CDC/MMR special case, not a general bearing model.
- Because a non-empty `searchTargets` array bypasses LLM query generation, the active evidence-query prompts often do not run. Search candidates are then intent-bucketed and scraped without snippet-level bearing triage.
- `extractQuotesAndScoreQuality()` performs the best current document-level bearing test, but only after scraping. It combines claim-specific evidence assessment, stance, and source-quality scoring in one call. Its output has no explicit bearing score.
- `claim_matching_system` and `claim_matching_user` provide a good claim-level bearing test after reference claims have been extracted. However, major live callers pass only the LLM and not `PromptManager`, so the hardcoded fallback plus appended contracts—not necessarily the active DB prompt rows—controls those calls.
- `claim_relevance_assessment_*` is conceptually close to bearing and is wired to manual assessment/reassessment routes, but not to automatic retrieval. Its `quality` value conflates evidence usefulness, bearing, and strength.
- `ClaimTriageEngine`, `ClaimEvaluationClassifier`, and `claim_retrieval_evidence` are not part of the automatic scrape/evidence path. The triage route is also not a ready-made pre-scrape solution: its run endpoint is effectively a pending stub, and the classifier's persistence requires an already-extracted `source_claim_id`.

Some prompts primarily reward topical proximity rather than truth-value impact. The source-edge extraction language around the “same subject” and “similar terminology,” the query prompts' demand for “perspectives,” and broad uses of “nuance” can all retain sources that are on-topic but do not test the claim. Other instructions conflate bearing with stance, confidence, veracity, or source quality. Those concepts should become separate outputs and separate ranking inputs.

The safest sequence is additive and observable: first preserve and instrument prompt outputs; then compare `search_assertions` with current search targets in shadow mode; then add post-scrape bearing without changing scrape selection; then add batched pre-scrape snippet bearing in shadow mode. Only after measured recall and cost data should low-bearing candidates be gated. Query rewrites and final packet selection should come later.

## Current Runtime Path and Prompt Selection

The principal automatic path is:

1. `/api/scrape-task` extracts and stores case claims through `processTaskClaims()` / `claimsEngine.js`.
2. Argument mapping enriches a reduced set of claim properties.
3. `runEvidenceEngine()` reloads claim text, builds deterministic search targets, and sorts all supplied claims by priority, verifiability, and centrality. It does not impose a hard maximum number of claims.
4. `EvidenceEngine.generateQueries()` uses deterministic targets when present; otherwise it loads the standard or balanced query prompts.
5. `retrieveCandidates()` searches, deduplicates by URL, buckets by declared query intent, and selects candidates by search-engine score.
6. Candidate pages are fetched and persisted before `extractEvidence()` invokes `extractQuotesAndScoreQuality()`.
7. Up to the configured candidate cap are quote-scored and adjudicated.
8. Reference documents are claim-extracted, and `matchClaimsToTaskClaims()` creates `reference_claim_task_links`.

“Active in the prompt table” must not be treated as synonymous with “selected at runtime.” Prompt loading has several bypasses:

- The stack extraction prompts are preferred; edge and ranked prompts are fallbacks.
- `claim_filtering` exists in the DB appendix, but `ClaimExtractor.filterAndRankClaims()` uses a hardcoded prompt.
- `source_quality_evaluation_user` is used only when `SourceQualityScorer` receives a prompt manager; at least one manual construction does not pass one.
- The principal `/api/scrape-task` claim-matching calls omit `promptManager`, so matching uses fallback prompt text plus runtime stance/misconduct contracts.
- The source-edge loader looks for `claim_extraction_edge_for_source_no_topics`, while the audit names `claim_extraction_edge_for_source_user`. That naming mismatch must be resolved before editing either row.

## Prompt-by-Prompt Bearing Audit

The score question below means “does the current output include a numeric value that might be mistaken for bearing?” None of the prompts currently emits a field explicitly named `bearing`, `bearing_score`, or `bearing_pre_score`.

### 1. `claim_extraction_stack_system`

- **Use:** Preferred system prompt in `backend/src/core/claimsEngine.js`, loaded by `loadClaimExtractionPrompts()`.
- **Stage/timing:** Case or reference claim extraction; after the input document itself has been scraped, but before evidence retrieval for a case.
- **Inputs/outputs:** Document text and extraction context; requests a reasoning stack containing thesis, pillars, evidence/background/fallibility-critical claims, and search assertions.
- **Bearing behavior:** Strong preparatory logic. `search_assertions` describe what needs to be checked and why; fallibility-critical claims identify propositions whose failure would damage the argument. This is more than topic matching, but it does not score a candidate source.
- **Exactness and claim forms:** Stronger than broad relevance. It explicitly treats causal, misconduct, and empirical assertions as verification targets. Attribution handling is not as precise as the downstream argument-mapping contract, and causal versus associative evidence is not fully specified.
- **Score/storage/decisions:** Centrality/verifiability/priority-like values can influence later ordering if retained. Search assertions and a distinct fallibility-critical role are discarded or flattened, so they do not influence query or scrape decisions.
- **Recommendation:** **Keep and narrow.** Reuse its verification decomposition, but make its output contract match the parser and explicitly distinguish causal, associative, attribution, and misconduct claim types. Do not call its properties bearing scores.

### 2. `claim_extraction_stack_with_topics`

- **Use:** Preferred user prompt for stack extraction when topic context is available.
- **Stage/timing:** Same as the system prompt; pre-evidence but post-document scrape.
- **Inputs/outputs:** Text plus topics; returns claims, `fallibilityCriticalClaims`, `searchAssertions`, `claimKind`, `evidenceType`, `articleStance`, centrality, verifiability, entities, and dates.
- **Bearing behavior:** Provides the best existing seed material for an `EvidenceNeed`: an assertion, compact query, must/optional terms, entity/date focus, intent, and reason.
- **Exactness and claim forms:** Better than topical relevance, although “search intent” is not yet a formal truth-value requirement. Attribution and misconduct are represented unevenly; causal/association mismatch is not an explicit output invariant.
- **Score/storage/decisions:** Centrality/verifiability/priority survive selectively. The other useful properties are dropped by `flattenClaimEntries()` and are unavailable to `runEvidenceEngine()`.
- **Recommendation:** **Keep, align, and extend later.** First preserve its existing fields without changing prompt wording. Then evaluate adding `claimType`, `bearingRequirement`, `evidenceTargetType`, subject/relation/object constraints, and scope terms.

### 3. `claim_extraction_edge_no_topics`

- **Use:** Legacy/fallback edge-mode extraction prompt in `claimsEngine.js`.
- **Stage/timing:** Claim extraction; post-input scrape and pre-evidence search.
- **Inputs/outputs:** Document text; a compact list of atomic claims ranked by specificity, controversy, and materiality.
- **Bearing behavior:** Selects claims worth checking, not sources that bear on them. Atomicity and falsifiability help later bearing assessment; controversy is not bearing.
- **Exactness and claim forms:** Mostly exact at claim selection. It lacks explicit attribution, misconduct, and causation/association contracts.
- **Score/storage/decisions:** Priority-like output affects claim ordering if used; it is not a source-bearing score.
- **Recommendation:** **Keep only as fallback, then converge.** Move useful atomicity/materiality rules into the preferred stack contract and avoid maintaining a parallel semantic path.

### 4. `claim_extraction_ranked_no_topics`

- **Use:** Legacy/fallback ranked extraction prompt in `claimsEngine.js`.
- **Stage/timing:** Claim extraction; post-input scrape and pre-evidence.
- **Inputs/outputs:** Document text; ranked “world claims” with article specificity and priority.
- **Bearing behavior:** No candidate bearing test. It improves what is searched, not which source should be scraped.
- **Exactness and claim forms:** Better than topic extraction, but no explicit attribution/misconduct/causal safeguards.
- **Score/storage/decisions:** Ranking influences processing order when this fallback is selected; not bearing.
- **Recommendation:** **Narrow/deprecate after parity.** Preserve ranking behavior in the unified extraction schema, then remove the separate prompt path.

### 5. `claim_extraction_edge_for_source_system`

- **Use:** Intended source/reference claim-extraction system prompt; loader naming should be verified against `claim_extraction_edge_for_source_no_topics`.
- **Stage/timing:** Post-scrape reference claim extraction.
- **Inputs/outputs:** A scraped source plus case-claim context; outputs reference claims expected to address the case claims.
- **Bearing behavior:** Yes, after scraping. “Directly address” is a bearing-like instruction.
- **Exactness and claim forms:** “Similar terminology and framing” can miss synonyms, technical restatements, inverse comparisons, or differently framed evidence. It does not fully distinguish attribution truth from object-claim truth or association from causation.
- **Score/storage/decisions:** Extracted reference claims are stored and later matched. No bearing score is produced. Over-extraction increases matching work and spurious links.
- **Recommendation:** **Rewrite after instrumentation.** Replace lexical similarity with subject/relation/object/scope alignment and evidentiary direction. Extract from high-bearing passages when available.

### 6. `claim_extraction_edge_for_source_user`

- **Use:** Intended user half of source/reference extraction; possible DB/code name mismatch.
- **Stage/timing:** Post-scrape reference extraction.
- **Inputs/outputs:** Source text and task claims; requests claims on the same subject, with mirrored terms, FOR/AGAINST/NUANCING evidence, data, context, interpretations, and history.
- **Bearing behavior:** Mixed. FOR/AGAINST can express truth-value impact, while same-subject/history/general-context clauses invite topical claims.
- **Exactness and claim forms:** Weak against topic-only false positives. No robust attribution, misconduct, compound-claim, or causal/association contract.
- **Score/storage/decisions:** Stored claims can cause downstream links; no direct score.
- **Recommendation:** **Split.** One part should identify high-bearing passages/claims; optional context should be labeled `background` and excluded from veracity aggregation unless it changes scope or warrant.

### 7. `evidence_query_generation_system`

- **Use:** `EvidenceEngine.generateQueries()` only when deterministic `claim.searchTargets` are absent.
- **Stage/timing:** Pre-search and pre-scrape.
- **Inputs/outputs:** Claim/context; queries with declared intent.
- **Bearing behavior:** Indirect. “High precision” helps, but the central organizing categories are SUPPORT/REFUTE/NUANCE perspectives, not evidence requirements.
- **Exactness and claim forms:** No structured subject/relation/object/scope matching; no attribution, misconduct, or causal/association query strategy.
- **Score/storage/decisions:** Query intent controls candidate bucketing and therefore scrape selection. No bearing score.
- **Recommendation:** **Rewrite later.** Generate evidence-target queries from an `EvidenceNeed`; retain stance goal as a secondary field.

### 8. `evidence_query_generation_user`

- **Use:** Standard DB/fallback user prompt in `generateQueries()` when deterministic targets do not bypass it.
- **Stage/timing:** Pre-search/pre-scrape.
- **Inputs/outputs:** Claim, context, query count; at least two support, two refute, one nuance, plus optional background/factbox queries.
- **Bearing behavior:** Weak-to-mixed. It encourages competing evidence, but “perspectives,” counterarguments, and general context can be low-bearing.
- **Exactness and claim forms:** Does not require that returned results address the exact predicate, scope, attribution, or causal strength.
- **Score/storage/decisions:** Intent affects candidate quotas and scrape count. No bearing score.
- **Recommendation:** **Rewrite after snippet triage exists.** Seek origin, primary evidence, limitations, systematic synthesis, direct contradiction, and strongest opposing evidence instead of fixed perspective counts.

### 9. `evidence_query_generation_user_balanced`

- **Use:** Balanced-mode variant in `generateQueries()`.
- **Stage/timing:** Pre-search/pre-scrape.
- **Inputs/outputs:** Claim/context plus exact support/refute/nuance query quotas.
- **Bearing behavior:** It enforces stance symmetry, not bearing. It can spend queries and scrape slots on low-bearing material solely to fill a side.
- **Exactness and claim forms:** Same weaknesses as the standard prompt. It can also create false balance when credible bearing evidence is asymmetric.
- **Score/storage/decisions:** Strongly controls search and intent-bucket selection; no bearing score.
- **Recommendation:** **Narrow and defer.** Do not increase balanced-mode breadth until pre-scrape bearing exists. Later make fairness a bounded slot, not an equal-evidence assumption.

### 10. `extractQuotesAndScoreQuality`

- **Use:** Hardcoded in `backend/src/utils/extractQuote.js`, invoked by `EvidenceEngine.extractEvidence()` for each scraped candidate.
- **Stage/timing:** Post-fetch/post-scrape, before evidence adjudication.
- **Inputs/outputs:** Exact claim, source text/title/URL/domain/metadata; quote, stance, summary, location, and document source-quality dimensions.
- **Bearing behavior:** This is the strongest current document-level bearing logic. It says to evaluate the exact factual assertion rather than the broad topic and contains useful attribution/misconduct constraints.
- **Exactness and claim forms:** Good on attribution wrappers and misconduct specificity. Causal versus associative evidence needs an explicit field/rule. Broad rules such as skepticism/criticism implying refutation, article-level fact-check outcomes, and differing location cases can overstate stance.
- **Score/storage/decisions:** Search-engine-derived `quality` weights adjudication; `qualityScores.claim_specificity` overlaps with bearing but is a document-quality dimension and should not substitute for it. Stance affects verdict. Quality scores are persisted, but no bearing score is stored.
- **Recommendation:** **Split and extend first.** Preserve exact-assertion contracts, add quote/document bearing fields, and keep source quality separate. Split `nuance` into truth-affecting nuance, contextual background, and topic-only/insufficient.

### 11. `argument_mapping_system`

- **Use:** Argument mapping called during case-claim processing.
- **Stage/timing:** After extraction and before evidence retrieval.
- **Inputs/outputs:** Claim and article context; object claim, attribution flag/speaker, article stance, argument function, and score transformation.
- **Bearing behavior:** Excellent prerequisite logic. It prevents “X said Y” from being silently treated as “Y is true” and distinguishes how a quoted claim functions in the article.
- **Exactness and claim forms:** Strong on attribution; misconduct and causal/association distinctions are not fully structured.
- **Score/storage/decisions:** `objectClaim` can feed `searchText`; `scoreTransform` affects later interpretation where carried. Neither is bearing.
- **Recommendation:** **Keep and make authoritative.** Produce or enrich `EvidenceNeed` only after this mapping so retrieval targets the correct proposition.

### 12. `argument_mapping_user`

- **Use:** User half of argument mapping.
- **Stage/timing:** Same stage as the system prompt.
- **Inputs/outputs:** Claims/article context to mapped fields including normal/invert/none/review score transformations.
- **Bearing behavior:** Indirect but important. It defines what proposition evidence must bear on and how article stance differs from object truth.
- **Exactness and claim forms:** Attribution handling is strong. Add explicit compound components, claim type, causal strength, and scope before using it to synthesize evidence needs.
- **Score/storage/decisions:** Outputs can influence search text and scoring semantics, but no bearing score.
- **Recommendation:** **Keep; extend conservatively.** Do not duplicate argument mapping inside every downstream prompt.

### 13. `claim_matching_system`

- **Use:** `matchClaimsToTaskClaims()` when a caller passes `PromptManager`; otherwise fallback text is used. Runtime always appends stance and misconduct contracts.
- **Stage/timing:** Post-scrape and post-reference-claim extraction.
- **Inputs/outputs:** Reference claims and task claims; match indices, stance, veracity, confidence, support level, and rationale.
- **Bearing behavior:** Yes. “Support makes the task claim more likely true” and “insufficient does not meaningfully bear” are direct claim-level bearing tests.
- **Exactness and claim forms:** Strong on attribution/misconduct through appended contracts and inverse comparisons through runtime correction. It lacks explicit topic-only rejection, compound-component coverage, and causal/association mismatch.
- **Score/storage/decisions:** Confidence, veracity, and signed support level are stored in `reference_claim_task_links`; each means something different from bearing. Current normalization can retain `insufficient` results if the LLM emits them.
- **Recommendation:** **Keep core contract, split outputs.** Add bearing separately, reject topic-only/zero-bearing links, and require component/causal alignment.

### 14. `claim_matching_user`

- **Use:** User half of matching when DB prompts are actually supplied; otherwise fallback.
- **Stage/timing:** Post-scrape/post-extraction.
- **Inputs/outputs:** Enumerated task/reference claims and the match schema.
- **Bearing behavior:** Strong when it asks for a clear relationship and an explicit explanation of support/refute/nuance.
- **Exactness and claim forms:** Needs component coverage and causal-strength outputs; should not accept broad “related” material as nuance.
- **Score/storage/decisions:** Outputs create persisted claim links and feed evaluation/UI.
- **Recommendation:** **Align callers first, then extend.** Passing `PromptManager` consistently is a prerequisite to treating DB prompt edits as operative.

### 15. `claim_relevance_assessment_system`

- **Use:** `assessClaimRelevance()` for manual assessment/reassessment routes when a prompt manager is supplied.
- **Stage/timing:** Post-scrape/post-reference-claim extraction; not live automatic retrieval.
- **Inputs/outputs:** One reference/task claim pair; stance, confidence, `quality`, rationale, quote, and derived support level.
- **Bearing behavior:** Conceptually a claim-bearing assessment despite its name. “Provides meaningful evidence” is the correct direction.
- **Exactness and claim forms:** Handles inverse comparisons and stance relativity. Runtime lacks the full misconduct contract present in matching and lacks explicit causation/association and compound coverage.
- **Score/storage/decisions:** `quality` (0–1.2) is multiplied by confidence to form support level and is stored as a 0–100 score by routes. It ambiguously mixes bearing/usefulness/evidence strength.
- **Recommendation:** **Retain for compatibility, stop expanding it.** Create a distinct batched `assessSnippetBearingBatch()` for pre-scrape use and later a clearly named claim-bearing assessor.

### 16. `claim_relevance_assessment_user`

- **Use:** User half of the manual relevance utility.
- **Stage/timing:** Post-scrape/manual.
- **Inputs/outputs:** A task claim and reference claim; same assessment schema.
- **Bearing behavior:** Good direct comparison, but the label “relevance” and broad “nuance” category obscure the intended truth-value test.
- **Exactness and claim forms:** Does not fully express attribution-object separation, misconduct, causal mismatch, or partial compound coverage.
- **Score/storage/decisions:** Same ambiguous `quality` and persistence behavior as the system prompt.
- **Recommendation:** **Rename conceptually and split outputs in a new version.** Preserve the old utility/API until consumers migrate.

### 17. `claim_filtering`

- **Use:** An active DB prompt row exists, but live `ClaimExtractor.filterAndRankClaims()` uses hardcoded text; comprehensive mode calls that function while edge/ranked modes skip it.
- **Stage/timing:** Claim selection before evidence retrieval.
- **Inputs/outputs:** Candidate claims; ranking/filtering by specificity, controversy, and materiality.
- **Bearing behavior:** None at the source level. It determines which case claims merit investigation.
- **Exactness and claim forms:** Specificity helps; controversy can over-prioritize sensational claims. No attribution/misconduct/causal contract.
- **Score/storage/decisions:** Ranking can affect which claims are processed, but DB prompt edits may have no effect.
- **Recommendation:** **Align or retire.** First decide whether filtering belongs in the unified extraction contract. Do not add bearing terminology to a currently bypassed DB row.

### 18. `claim_properties_evaluation_user`

- **Use:** Separate claim-property evaluation path; not part of the principal automatic evidence path found in this audit.
- **Stage/timing:** Claim characterization, pre-evidence when invoked.
- **Inputs/outputs:** Centrality, specificity, consequence, contestability, and novelty.
- **Bearing behavior:** No. These are claim-priority properties, not source-to-claim bearing.
- **Exactness and claim forms:** Does not assess a candidate source or handle attribution/misconduct/causal alignment.
- **Score/storage/decisions:** Could guide claim budgets if wired in, but should never be renamed bearing.
- **Recommendation:** **Keep separate.** Potentially reuse for claim selection/budgeting only after its runtime wiring is explicit.

### 19. `source_quality_evaluation_user`

- **Use:** `SourceQualityScorer` when instantiated with a prompt manager; other constructions use hardcoded fallback text.
- **Stage/timing:** Post-scrape/manual or classifier-dependent source-quality assessment.
- **Inputs/outputs:** Source metadata/text; transparency, evidence density, reputation, sensationalism, monetization, originality, and aggregate quality/risk.
- **Bearing behavior:** No. `claim_specificity` can be confused with bearing, but it describes the source/document and does not compare a source assertion to a task claim.
- **Exactness and claim forms:** Not designed for attribution, misconduct, or causal matching.
- **Score/storage/decisions:** Quality scores are persisted and may weight evidence. They must remain separate from bearing so authoritative but non-addressing sources do not dominate.
- **Recommendation:** **Keep and isolate.** Rename `claim_specificity` if needed to `document_claim_specificity`; never use aggregate source quality as a bearing proxy.

## Bearing Logic Already Present

### `search_assertions`

`searchAssertions` are currently requested by the preferred extraction prompts but are not persisted as first-class records and are not available to `runEvidenceEngine()`. `claimsEngine.js` parses and flattens thesis, pillars, evidence, background, and generic claims; its flattened records omit the assertion/query/must-include/optional/entity/date/intent/reason structure. `processTaskClaims()` also does not pass the complete reasoning stack into evidence retrieval.

They should become the seed—not the final form—of `EvidenceNeed`. They can replace or improve most of `buildSearchTargets()` once argument mapping enriches them. The deterministic builder should remain as a fallback and can supply safe origin/object-claim targets when extraction output is missing.

Recommended `EvidenceNeed` shape:

```json
{
  "claimId": 0,
  "objectClaimText": "",
  "claimType": "factual|causal|association|attribution|methodology|misconduct|statistical|interpretive|background",
  "bearingRequirement": "direct_truth_value|source_attribution|causal_mechanism|scope_context|warrant_test|steelman_path",
  "evidenceTargetType": "primary_source|original_study|systematic_review|government_source|expert_critique|fact_check|dataset|opposing_argument|news_report",
  "mustMatchSubject": [],
  "mustMatchRelation": [],
  "mustMatchObject": [],
  "scopeTerms": [],
  "mustIncludeTerms": [],
  "optionalTerms": [],
  "entityFocus": [],
  "dateFocus": [],
  "stanceGoal": "origin|support|refute|limitations|steelman|open",
  "reason": ""
}
```

The additional fields should be synthesized after argument mapping. Asking initial extraction to perfectly infer all of them risks duplicating downstream logic and creating inconsistent object claims.

### `fallibility_critical`

Fallibility-critical claims are not currently preserved as a distinct persisted role. The allowed normalized roles omit `fallibility_critical`, so a surviving claim is demoted to ordinary `evidence`; the separate `fallibilityCriticalClaims` collection may be lost altogether. It therefore does not currently receive a guaranteed priority or scrape budget.

Fallibility criticality should be one claim-selection signal, not the sole source of searched claims. It is especially likely to over-trigger in conspiracy or pseudoscientific content because allegations of cover-up, causation, or institutional misconduct are often rhetorically central. Searching only those claims would let sensational structure monopolize the evidence budget.

Recommended policy:

- Preserve `fallibilityCritical` as a boolean/property independent of semantic claim role.
- Combine it with centrality, verifiability, materiality, and claim diversity.
- Give it a bounded priority/budget boost, not unlimited precedence.
- Require an atomic, externally testable object claim.
- Reserve at least one search slot for a high-centrality non-critical claim when available.
- Do not let it alone determine `MAX_CLAIMS_SEARCHED_PER_CONTENT`.

### Source extraction direct-address logic

This logic already attempts post-scrape bearing, but its lexical framing is brittle. “Similar terminology” can miss scientific synonyms, inverse comparisons, or evidence stated at a different level of abstraction. “Same subject” can admit material that shares entities while addressing a different relationship, outcome, population, time period, or allegation.

The rewrite should ask whether a passage addresses the task claim's subject, relationship/predicate, object/outcome, scope, attribution, or warrant—and whether it could change confidence in the claim. Once post-scrape bearing passages exist, reference claim extraction should operate preferentially on those passages plus limited surrounding context, not indiscriminately on the entire source.

### `extractQuotesAndScoreQuality()`

This is the best starting point for final document-level bearing, but it should not remain a combined semantic bucket. Add separate fields such as:

```json
{
  "quotes": [{
    "quote": "...",
    "stance": "support|refute|nuance|insufficient",
    "bearing_score": 0.0,
    "bearing_type": "direct|indirect|context|origin|steelman|none",
    "bearing_reason": "...",
    "claim_component_addressed": "whole_claim|subject|relation|object|scope|attribution|warrant|none",
    "causal_strength": "causal|associative|correlational|mechanistic|not_applicable",
    "location": {"page": null, "section": ""}
  }],
  "quality": {}
}
```

`stance` answers direction; `bearing_score` answers how much the passage affects the exact claim; `confidence` answers model certainty; `evidence_strength` can later describe inferential strength; source quality answers provenance/quality. A high-bearing quote can come from a low-quality source and should be retained but labeled accordingly.

Article-level fact-check conclusions must not automatically refute each embedded subclaim. Skepticism or criticism should not equal refutation unless it supplies a reason/evidence that weakens the exact assertion. “Nuance” should be reserved for information that changes truth conditions, scope, magnitude, or warrant; generic background should be `context` or `insufficient` and excluded from verdict weight.

### Claim matching

Claim matching already performs a genuine claim-level bearing test. Its output should add `bearing_score`, `bearing_type`, component coverage, and causal alignment while retaining separate veracity, confidence, and support level. `insufficient` and topic-only matches should not be persisted as evidentiary links by default; they may be logged for audit.

Compound task claims should either be decomposed before matching or require the matcher to report addressed components. Partial evidence must not be normalized into full support. Causal claims require causal/mechanistic evidence or an explicit downgrade when the reference offers only association.

### `claim_relevance_assessment`

Conceptually this is a bearing assessor with an ambiguous name and score. Keep the old function and routes for backward compatibility during migration. Do not repurpose it directly for search snippets because it assumes a clean reference claim and makes one pairwise LLM call.

Create `assessSnippetBearingBatch(claim, evidenceNeed, candidates[])` instead. It should accept title, snippet, URL/domain, query provenance, and rank for many candidates in one call. Replace ambiguous `quality` with `bearingPreScore`; if evidence strength is inferable from a snippet, keep it separately and treat it as provisional.

## Prompt Logic That Should Be Removed or Narrowed

| Prompt/instruction | Risk | Replacement direction |
|---|---|---|
| Source extraction: same subject | Entity/topic overlap becomes evidence even when predicate or outcome differs. | Require alignment to subject + relation + object/outcome + scope, or a stated warrant connection. |
| Source extraction: similar terminology/framing | Misses synonyms, technical vocabulary, inverse comparisons, and cross-level evidence. | Use semantic component alignment; terminology is a clue, never a requirement. |
| Source extraction/query prompts: context/history as nuance | Background can acquire verdict weight despite no truth-value impact. | Label `context` separately; count as nuance only if it changes scope, magnitude, applicability, or warrant. |
| Quote extraction: skepticism/criticism implies refute | Reporting doubt is not itself counterevidence. | Require an explicit contradictory finding, failed premise, limitation, or evidentiary reason. |
| Quote extraction: broad fact-check result refutes claims | A fact-check of an article thesis may not test each embedded proposition. | Match the fact-check's tested proposition to the exact task-claim components. |
| Any prompt: association treated as causal support | Shared direction or correlation can falsely validate causation. | Emit claim/evidence causal strength and downgrade mismatches to partial/insufficient. |
| Any prompt: “X said Y” treated as “Y is true” | Attribution truth and object truth are distinct. | Reuse argument mapping; score source-attribution bearing separately from object-claim bearing. |
| Query/quality logic: prefer authorities regardless of assertion match | High-quality low-bearing sources can crowd out direct evidence. | Rank bearing first; quality modifies trust/weight only after a minimum bearing threshold. |
| Source extraction: extract all claim-worthy material | Produces excessive reference claims and noisy pairwise matching. | Extract high-bearing passages first, then claims from those passages; retain limited origin/context slots. |
| Balanced query prompts: exact support/refute/nuance quotas | Creates false balance and spends budget filling nonexistent sides. | Seek strongest available evidence by target type; reserve one bounded steelman/fairness slot. |
| Query prompts: seek perspectives/counterarguments | Opinion diversity is not evidence diversity. | Seek primary source, original study/dataset, review, limitation, critique, origin, and strongest contradictory evidence. |
| Source-quality `claim_specificity` used as bearing | A source can make specific claims unrelated to the task claim. | Rename/document as a source property; calculate task-relative bearing separately. |
| `buildSearchTargets()` hardcoded CDC/MMR behavior | Domain-specific corrections do not generalize and can encode expected stance. | Preserve as a regression fixture; replace production branching with claim-type/evidence-need generation. |

## Query Prompt Reassessment

Support/refute/nuance should remain as a **stance goal**, not the primary query taxonomy. Search should be organized by evidence target and bearing requirement:

- origin/primary-source query;
- strongest supporting evidence query;
- strongest contradicting evidence query;
- limitations, population, time, dose, or scope query;
- original study/dataset or systematic-review query;
- methodology/expert-critique query;
- one steelman opposing query where materially useful.

Each generated query should include both `evidenceTargetType` and `stanceGoal`. Retrieval should not assume that a query labeled “refute” produces refuting evidence; that remains a post-retrieval semantic judgment.

`search_assertions` should be used before another LLM query call. Deterministic assertion-derived queries can cover the primary/origin target; the LLM should be fallback/expansion for missing target types or poor search results. Query generation should receive `claimType`, `scoreTransform`, `argumentFunction`, `objectClaimText`, component constraints, scope, and attribution data.

Balanced mode should not be broadened until snippet bearing triage is measured and reliable. The existing hard clamp to three queries is a prudent temporary cost control. It should remain during shadow phases, then be replaced with a global budget allocator rather than simply raised per claim.

## Recommended Architecture

### Stage 1: Claim extraction

Preserve—not yet reinterpret—the existing outputs: `fallibility_critical`, `search_assertions`, `claimKind`, `evidenceType`, `articleStance`, `centrality`, and `verifiability`. Add parser/schema tests before changing prompts. Store fallibility criticality as a property, not a role that displaces thesis/evidence semantics.

Later add normalized `claimType` and candidate subject/relation/object/scope fields. Treat these as an initial parse subject to argument-mapping correction.

### Stage 2: Argument mapping

Make `objectClaim`, `isAttribution`, `speakerEntity`, `articleStanceTowardObjectClaim`, `argumentFunction`, and `scoreTransform` authoritative. Combine these with extraction assertions to synthesize one or more `EvidenceNeed` objects per atomic claim.

For an attribution claim, create distinct needs when appropriate:

- Did X actually say/report Y? (`source_attribution`)
- Is Y true? (`direct_truth_value`)

For compound or causal claims, emit component or causal-mechanism needs rather than one vague query.

### Stage 3: Query generation

Use this order:

1. Existing search assertion query, validated against the mapped object claim.
2. Deterministic origin/entity/date and exact-object targets.
3. LLM expansion only for missing evidence targets, weak results, or deepen mode.

Every candidate retains query, target type, stance goal, provider, rank, and search score. Query intent is provenance, not an evidence verdict.

### Stage 4: Pre-scrape snippet bearing

Add a batched assessor:

```js
assessSnippetBearingBatch(claim, evidenceNeed, candidates[])
```

Expected result:

```json
{
  "candidateUrl": "",
  "bearingPreScore": 0.0,
  "expectedStance": "support|refute|nuance|background|insufficient",
  "bearingType": "direct|indirect|context|origin|steelman|none",
  "triageDecision": "scrape|maybe|skip",
  "reason": ""
}
```

It must be batched per claim, robust to truncated/misleading snippets, and conservative. Origin/primary-source and steelman/fairness slots may bypass a low snippet score. Domain reputation must not be an input to bearing scoring, though it may be used later in packet selection.

### Stage 5: Post-scrape quote extraction

Extend `extractQuotesAndScoreQuality()` or split it into coordinated outputs so claim bearing and source quality are independent. Document bearing should aggregate quote-level bearing without allowing many weak quotes to swamp one strong quote. Preserve exact locations and addressed components.

### Stage 6: Claim matching

Add explicit bearing and component coverage to reference-claim/task-claim matching. Reject topic-only pairs; do not persist `insufficient` as ordinary evidence. Enforce attribution, misconduct, comparative, compound, and causal/association contracts.

### Stage 7: Evidence packet

Select the packet in this order:

1. Minimum bearing threshold and directness.
2. Coverage of the claim's required components/evidence needs.
3. Stance coverage where credible bearing evidence exists.
4. Source quality and evidence strength.
5. Source/origin/method diversity and URL deduplication.
6. A bounded steelman/fairness slot.

Background may be retained for explanation/debugging but must not participate in veracity aggregation unless it has truth-value-bearing scope or warrant effects.

## Data Model Recommendation

### V1: In memory and structured logs

Make no schema change. Preserve extraction fields through runtime objects; log prompt/model version, claim ID, evidence need, candidate URL, provider/rank, pre-bearing score, decision, post-bearing score, and disagreement with current selection. This is the safest shadow-mode foundation.

Do not put pre-scrape candidates into `claim_retrieval_evidence`: its `source_claim_id` foreign key assumes a scraped and extracted source claim, so it cannot naturally represent an unscripted candidate URL.

### V2: Nullable post-scrape fields on existing links

After score calibration, add the smallest post-scrape fields to the link records that already represent relationships:

- `bearing_score`
- `bearing_type`
- `bearing_method`
- optionally `evidence_target_type`

The likely targets are `reference_claim_task_links` for claim-level bearing and, if retained as document-level links, `reference_claim_links`. Keep `score`, `confidence`, `support_level`, veracity, and source-quality data intact and semantically separate.

Reuse `claim_retrieval_evidence` only for post-extraction retrieval evidence if its actual consumers and constraints are validated. Its existing `relevance_score` should not silently be redefined; add/rename through a versioned migration later.

### V3: Dedicated retrieval-candidate telemetry

If pre-scrape triage must be queryable, create a candidate table rather than overloading claim links. Candidate fields can include:

- claim/evidence-need ID;
- candidate URL and canonical URL;
- `bearing_pre_score`, `bearing_type`, `triage_decision`, and reason;
- evidence target, search intent/stance goal, provider, query, and source rank;
- prompt/model/version and timestamps;
- whether it was scraped and final `bearing_score` for calibration.

Only V3 needs all proposed fields such as `search_provider`, `source_rank`, and `triage_reason`. Avoid placing transient search telemetry on durable evidence links.

## Recommended Implementation Sequence

### Phase 0: Prompt/code alignment audit only

- **Goal:** Establish which DB rows are actually selected and which outputs survive each boundary.
- **Files/prompts:** `claimsEngine.js`, `promptManager.js`, `processTaskClaims` callers, `runEvidenceEngine.js`, `evidenceEngine.js`, `matchClaims.js`, source-quality constructors, all 19 audited prompts.
- **Behavior/schema:** No change; no schema.
- **Tests:** Static/runtime trace fixtures showing selected prompt name/version and output-field flow.
- **Rollback:** Not applicable; planning/audit only.

### Phase 1: Instrument and preserve prompt outputs

- **Goal:** Carry `searchAssertions`, `fallibilityCritical`, `claimKind`, `evidenceType`, `articleStance`, `objectClaim`, and `scoreTransform` to evidence time without using them to alter selection.
- **Files/prompts:** `claimsEngine.js`, claim normalization/processing, argument mapping, `/api/scrape-task`, `runEvidenceEngine.js`. No prompt wording change unless schema mismatch prevents parsing.
- **Behavior/schema:** Logging/telemetry only; no gating. V1 in memory/logs.
- **Tests:** Parser fixtures for complete stack output; fallibility role preservation; attribution/object mapping; absent-field fallbacks; no difference in selected claims/URLs.
- **Rollback:** Feature flag disables added propagation/logging; old flattened objects remain accepted.

### Phase 2: Use `search_assertions` in shadow mode

- **Goal:** Build candidate `EvidenceNeed`/queries and compare them to `buildSearchTargets()` and current query results.
- **Files/prompts:** `claimsEngine.js`, a new evidence-need normalizer, `runEvidenceEngine.js`; stack prompts only if existing assertions prove structurally insufficient.
- **Behavior/schema:** Current queries remain authoritative; shadow assertions are logged with overlap, precision proxies, and candidate counts. No schema.
- **Tests:** Attribution, misconduct, causal, statistical, date/entity, and synonym fixtures; exact CDC/MMR regression without production hardcoding dependence.
- **Rollback:** Disable shadow flag; zero retrieval behavior change.

### Phase 3: Add post-scrape bearing

- **Goal:** Measure final quote/document bearing separately from stance and source quality.
- **Files/prompts:** `backend/src/utils/extractQuote.js`, `evidenceEngine.js`, result normalization/logging. Modify the hardcoded prompt/schema or move it under versioned prompt management.
- **Behavior/schema:** Initially log bearing and compare to current stance/adjudication; do not change verdict weighting. V1 only, then optional V2 nullable fields after calibration.
- **Tests:** Topic-only, article-level fact-check, authority-without-address, low-quality/direct, attribution, misconduct, association/causation, scope, and compound-partial fixtures.
- **Rollback:** Parser defaults missing bearing to null; feature flag returns to current schema and adjudication.

### Phase 4: Add `assessSnippetBearingBatch` in shadow mode

- **Goal:** Estimate which search candidates are worth scraping and measure false-negative risk/cost savings.
- **Files/prompts:** New bearing assessor/module and versioned prompt, `evidenceEngine.retrieveCandidates()`/run orchestration, structured logging.
- **Behavior/schema:** All currently selected candidates are still scraped. Scores/decisions are compared with final post-scrape bearing. No required schema.
- **Tests:** Batch ordering/URL mapping, malformed output, empty/truncated snippets, duplicate URLs, origin exceptions, steelman exceptions, latency/token caps, and pre/post-bearing calibration.
- **Rollback:** Disable assessor flag; retrieval is identical.

### Phase 5: Conservative pre-scrape gating

- **Goal:** Skip only candidates with demonstrably negligible expected bearing while preserving recall.
- **Files/prompts:** Evidence engine selection/budget code, snippet assessor thresholds, configuration/telemetry.
- **Behavior/schema:** Gate only extremely low scores; always retain origin/primary and bounded steelman/fairness candidates; use per-claim and global scrape floors/caps. V3 is optional if durable audits are required.
- **Tests:** Recall against labeled corpus, provider failures, all-low candidate sets, fairness exceptions, global budget behavior, and deepen-mode recovery.
- **Rollback:** Threshold/config feature flag set to shadow/off; candidates return to current selection.

### Phase 6: Query generation rewrite

- **Goal:** Replace perspective-first queries with evidence-target queries based on `EvidenceNeed`.
- **Files/prompts:** `evidence_query_generation_*`, `EvidenceEngine.generateQueries()`, `buildSearchTargets()`, evidence-need builder, search-mode config.
- **Behavior/schema:** Assertion/deterministic queries first; LLM expansion by evidence target; stance remains metadata. Keep existing three-query cap initially and tune only from measured global budgets.
- **Tests:** Target-type coverage, no forced false balance, search precision, query-count bounds, claim-type strategies, and old-mode A/B replay.
- **Rollback:** Config selects legacy query builder/prompts.

### Phase 7: Bearing-aware evidence packet selection

- **Goal:** Build the final evaluation packet by bearing, coverage, stance, quality, diversity, and fairness.
- **Files/prompts:** Adjudication/packet builder, persistence adapters, claim matching prompts and callers, evaluation inputs.
- **Behavior/schema:** Topic-only/background evidence is excluded from verdict aggregation; persisted V2 bearing fields become authoritative; `insufficient` matches are not ordinary links.
- **Tests:** Deterministic packet fixtures, score monotonicity, stance coverage without false balance, duplicate-source control, causal/compound handling, and end-to-end evaluation stability.
- **Rollback:** Versioned packet-builder flag restores current quality/stance adjudication and link behavior.

## Tests Needed

The test corpus should contain labeled claim/candidate/document pairs, not only prompt snapshots. Every pair should label topic relevance, bearing, stance, component coverage, causal strength, source quality, and expected retain/skip behavior.

Required cases:

1. A topic-only source scores high relevance but low bearing and is excluded from verdict weight.
2. A high-authority but low-bearing source does not dominate a lower-authority directly bearing source.
3. A low-authority directly bearing source is retained with a clear quality warning.
4. A fact-check of an article thesis does not refute unrelated or untested embedded subclaims.
5. Association/correlation evidence does not fully support a causal claim.
6. “X said Y” is tested separately for whether X said it and whether Y is true.
7. Specific misconduct requires evidence of that misconduct; omission/reanalysis is not silently upgraded to destruction/cover-up.
8. Partial evidence for one component of a compound claim cannot become full support.
9. Inverse comparative claims normalize to refute correctly.
10. Scope mismatches in population, location, time, exposure, dose, or outcome are partial/insufficient unless the mismatch itself bears on generality.
11. A pseudoscientific article's one valid scientific subclaim remains available for evidence search and is not erased by article-level classification.
12. Similar meaning with different terminology is retained; similar terminology with a different predicate is rejected.
13. Balanced mode cannot exceed configured per-claim/global scrape budgets and does not manufacture weak evidence to fill a side.
14. Search assertions improve labeled candidate precision over `buildSearchTargets()` without unacceptable recall loss.
15. Empty, misleading, or truncated snippets default conservatively and do not cause irreversible false negatives.
16. Origin/primary-source and steelman slots survive low pre-scores within strict quotas.
17. Prompt-manager presence/absence produces an observable selected prompt version; principal callers use the intended path.
18. Missing new fields remain backward-compatible throughout shadow phases.

Metrics should include candidate precision/recall, high-bearing recall, pages scraped per claim, unique URLs per case, LLM calls/tokens, latency, pre-score versus post-score calibration, stance distribution, and rate of background evidence entering adjudication.

## Final Recommendation

1. **Reuse immediately:** Preserve `search_assertions`; reuse exact-assertion, attribution, and misconduct contracts from `extractQuotesAndScoreQuality()` and claim matching; reuse argument mapping's `objectClaim` and `scoreTransform` semantics. “Immediately” means propagation/instrumentation first, not live gating.
2. **Rewrite first:** After alignment, split post-scrape bearing from source quality in `extractQuotesAndScoreQuality()`. This gives a measurable ground truth for evaluating pre-scrape triage.
3. **Remove or narrow:** Narrow same-subject/similar-terminology rules, background-as-nuance, broad fact-check refutation, skepticism-as-refutation, authority-as-proxy, and forced support/refute/nuance quotas. Retire domain-specific production query special cases after equivalent regressions exist.
4. **`search_assertions` as `EvidenceNeed`:** Yes—as the seed. Enrich them after argument mapping with object claim, claim type, bearing requirement, evidence target, component constraints, scope, and causal requirements.
5. **`assessClaimRelevance` versus snippet bearing:** Keep the existing utility/routes for compatibility, but do not stretch them into retrieval. Add a new batched `assessSnippetBearingBatch()` and later version claim-to-claim assessment under an explicit bearing name.
6. **Smallest safe first implementation step:** Phase 1 only: carry and log the fields the prompts already generate through to `runEvidenceEngine()`, record the actual prompt name/version used, and prove that retrieval output is unchanged. This resolves the current observability and contract gap without risking recall, changing scrape volume, or requiring a migration.
