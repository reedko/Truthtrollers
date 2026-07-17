# Claim Foundry CF1 — MCT

**MCT meaning:** Master Context Table / Master Control Thread.

**Status:** Implementation and comparison work in progress. Infrastructure exists, but the
current CF1 agent runtime has not passed its cost, completion, or quality gate and must not
be represented as complete.

**Purpose:** Canonical context and constraint document for Claim Foundry, the separate agentic claim-package module/API. This first version is **CF1**.

---

## 1. Project goal

Create Claim Foundry: a consumer-neutral agentic module/API that produces selected, evidence-ready claim packages from supplied or persisted article content. VeriStrata is one consumer, not the API boundary.

This replaces the old deterministic/LLM multi-step claim-extraction pipeline as the producer of selected claim packets. It does not replace scraping, publisher/author handling, content persistence, or evidence gathering.

---

## 2. Current scope

### In scope

- Agentic selection and construction of evidence-ready claim packets.
- A standalone module boundary and API/data contract.
- Reuse of existing scraped content and publisher/author metadata.
- Persistence in the same database.
- Reuse of `content`, `claims`, `content_claims`, and `claim_evaluation_targets` where practical.
- Isolated invocation for development and testing.
- A consumer-neutral contract that does not expose VeriStrata database rows as the public API shape.

### Out of scope for the first phase

- Changes to evidence gathering.
- Wiring into the live scrape path.
- Deleting or rewriting the existing claim-extraction pipeline.
- Broad database redesign.

---

## 3. Mandatory module-size constraint

Claim Foundry must be composed of small, understandable, single-purpose modules.

- **Hard limit: every Claim Foundry implementation and test file must be 500 lines or fewer.**
- **Preferred target: every file should be fewer than 250 lines.**
- Files approaching 250 lines must be reviewed for a natural split by responsibility.
- Files may not cross 500 lines temporarily with a promise to split later.
- Generated files and third-party vendored files are excluded; handwritten project files are not.
- A file between 251 and 500 lines must retain one clear responsibility and include a brief explanation in the relevant review or design record for why splitting would reduce clarity.

Natural module boundaries include:

- API transport and request handling
- use-case orchestration
- agent prompt construction
- model invocation
- response parsing
- contract validation
- normalization
- claim selection policy
- persistence mapping
- transaction handling
- read/query access
- tests and fixtures

Do not combine these responsibilities merely to reduce the number of files.

---

## 4. Understandability requirements

- Each module exposes a small, explicit public contract.
- Inputs and outputs use named data structures rather than loosely shaped objects where practical.
- Dependencies are passed explicitly; avoid hidden mutable state.
- Persistence logic is separate from agent reasoning and API transport.
- Validation occurs at the boundary before persistence.
- Tests should exercise modules independently without requiring the entire pipeline.
- Orchestration code should read as a short sequence of named operations.

---

## 5. Compatibility constraints

- Use the existing database.
- Preserve existing content, scrape, publisher, author, and content-persistence behavior.
- Prefer the existing `content`, `claims`, `content_claims`, and `claim_evaluation_targets` tables.
- Any schema change requires an explicit contract gap that cannot be represented safely in those tables.
- Do not change evidence-gathering behavior during this project phase.
- Do not connect the new producer to live scraping until its contract and isolated behavior are reviewed.

---

## 6. Draft-file warning

There may be a new uncommitted file `backend/src/core/claimPackageAgent.js`; treat it as draft only. Its name does not establish the CF1 module or API naming.

It is not an approved architecture baseline. Before implementation begins, evaluate it against this MCT and the approved API/data contract, then delete it or decompose useful parts into compliant modules.

---

## 7. Initial acceptance gates

Implementation may begin only after review of:

1. The current claim-extraction and scrape-task paths.
2. The proposed module boundaries.
3. The API request/response contract.
4. The persistence mapping and transaction semantics.
5. Idempotency, replacement, and failure behavior.
6. A line-count plan showing every proposed file at 500 lines or fewer, with most below 250.

The first implementation must remain isolated from live scraping and evidence gathering.

---

## 8. Governing doctrine

```text
Agentic brain, deterministic bones.
```

Claim Foundry decides what the article is arguing, which assertions matter, how they relate, and what should be tested. Deterministic code preserves source structure and provenance, validates the package, enforces limits and enums, persists approved results, and prevents unsupported or malformed output.

Existing deterministic code has no preservation right. Retain a component only when it demonstrably improves grounding, safety, compatibility, observability, or understandability. Preserve useful principles even when their current implementation should be replaced.

Claim Foundry ends with a verified claim package. It does not search for evidence, fetch evidence URLs, judge source stance, or score article truth.

---

## 9. Principles carried forward

CF1 retains these organizational principles from the current system:

1. Raw extracted assertions are not automatically evaluation claims.
2. Only selected evaluation claims proceed to evidence planning and later EvidenceRun.
3. A displayed claim may require multiple distinct test targets.
4. Attribution is separate from the truth of the attributed proposition.
5. Study, document, dataset, law, filing, transcript, or record identity may be a separate research target.
6. `scoreTransform`, `searchEligible`, and `verdictEligible` express different decisions and must remain separate.
7. Every selected claim and target must retain article-grounded provenance.
8. Bearing criteria must explain what would and would not address the exact target.
9. Concrete identifiers and research anchors must be preserved before query planning.
10. Uncertainty must remain explicit rather than being converted into a confident default.
11. The final package must pass deterministic verification before persistence.
12. Intermediate artifacts and diagnostics must make every important decision inspectable.

CF1 does not commit to preserving the existing deterministic reconciliation, weighted selector, regex targetizer, sibling-term expansion, query-lane multiplication, or fixture-specific rules.

---

## 10. Semantic block model

Claim Foundry must not treat an article as a flat bag of sentences or fixed-size chunks. It must preserve and reason over semantic blocks.

Deterministic preprocessing may propose structural blocks from headings, paragraphs, lists, quotations, captions, DOM hierarchy, and source offsets. The agent assigns or revises their semantic functions.

Milestone 9A sharpens this boundary: preprocessing creates exact atoms and addressable source units before grouping source blocks. The agent references unit IDs; package assembly derives exact excerpts and offsets.

A semantic block may function as:

- article thesis or framing
- background or chronology
- article-endorsed assertion
- opponent position
- rebuttal or counterargument
- supporting evidence or example
- study or document description
- methodological criticism
- causal explanation
- qualification or concession
- policy conclusion
- anecdote or testimonial
- call to action
- unclear or mixed function

Each block must retain:

```js
{
  blockId,
  heading,
  text,
  structuralType,
  semanticFunction,
  articleStance,
  speakerEntities,
  sourceAtomIds,
  sourceUnitIds,
  sourceOffsets,
  relatedBlockIds,
  confidence
}
```

Block labels are interpretations, not immutable preprocessing facts. Later blocks may revise the interpretation of earlier blocks.

---

## 11. Theme, thesis, and pillars

CF1 must determine what the article is trying to establish before selecting evaluation claims.

The article map contains:

- **Theme:** the subject and central dispute addressed by the article.
- **Thesis:** the article's principal conclusion or position about that theme.
- **Pillars:** the major load-bearing propositions that jointly support the thesis.
- **Clusters:** groups of related assertions, events, sources, or reasoning moves.
- **Opponent positions:** assertions the article presents to criticize, reject, qualify, or rebut.
- **Qualifications:** limits or concessions that constrain the thesis or pillars.

The initial theme is provisional. It must guide orientation without filtering out raw assertions. Claims from every meaningful semantic block must remain available so later material can expand, narrow, contradict, or replace the provisional theme.

The final article map must cite the blocks and assertions from which it was derived:

```js
{
  theme,
  thesis: { text, sourceBlockIds },
  pillars: [
    { pillarId, text, sourceBlockIds, importance }
  ],
  clusters: [],
  opponentPositions: [],
  qualifications: []
}
```

---

## 12. Claim relevance and selection

A selected evaluation claim must be relevant to the article's argument, not merely related to its topic.

The central selection question is:

```text
If this assertion were supported, refuted, qualified, or left unresolved,
would that materially change how strong the article's thesis or a major pillar is?
```

Each candidate claim must state its relationship to the article map:

- supports thesis
- supports pillar
- challenges thesis
- challenges pillar
- opponent claim the article seeks to rebut
- qualification or scope condition
- evidence offered for a pillar
- internal-consistency hinge
- background/context only
- unrelated or non-material

Each selected claim must identify related pillar IDs, materiality, and counterfactual impact. Deterministic validation checks those references and portfolio coverage; it does not assign semantic relevance scores.

Selection should normally yield a compact portfolio, approximately 8–12 claims, but quality and article structure take priority over filling a quota. Explicit exceptions are allowed for short, sparse, or unusually complex articles.

Research convenience must not replace argumentative importance. A central but difficult claim should not lose merely because a peripheral claim contains an easier study name or statistic.

---

## 13. Compelling and bearing-legible claim wording

Selected claims are product-facing statements. They must be compelling in the sense that a reader immediately understands the point and why it matters to the article.

A selected claim must:

- express a clear, consequential assertion rather than a topic label
- identify the relevant actor, action, object, population, scope, date, or named work when the article supplies them
- preserve material qualifications and uncertainty
- avoid rhetorical padding and unnecessary attribution wrappers
- remain faithful to what the article asserts or relies upon
- be understandable without rereading the entire source block
- make the potential truth-value dispute visible
- make it clear how another assertion or source could support, refute, qualify, contextualize, or fail to bear upon it

Compelling does not mean sensational, overstated, or rewritten for drama. It means crisp, concrete, material, and legible as a testable proposition.

CF1 may separate display wording from a narrower evidence-facing target, but both must link to the same grounded proposition and provenance. Claim wording may not be changed later by EvidenceRun.

---

## 14. Internal consistency across blocks

CF1 must compare assertions across semantic blocks and identify potentially material internal-consistency problems, including:

- direct contradiction
- scope or population shift
- association-to-causation shift
- allegation-to-established-fact shift
- numerical inconsistency
- study, document, actor, or event identity inconsistency
- incompatible chronology
- qualification omitted in a later restatement
- inconsistent standards applied to supporting and opposing sources
- thesis or pillar conflict

An internal-consistency finding must cite all relevant block and claim IDs, describe the exact tension, state its materiality, and distinguish an unresolved conflict from an apparent conflict resolved by context.

The agent interprets whether two assertions genuinely conflict. Deterministic code validates references and may flag structured polarity, number, date, or scope mismatches for agent review.

Internal-consistency findings inform selection but do not automatically become evaluation claims.

---

## 15. Selected claims and Phase 3 targets

Raw claims remain private working material and provenance. Only selected evaluation claims may produce Phase 3 targets.

A selected claim may generate one or more targets:

- article-endorsed substantive proposition
- opponent substantive proposition
- attribution or provenance
- study/document/record identity
- inference or warrant
- contextual or scope condition

Targets must preserve:

```js
{
  targetId,
  selectedClaimId,
  targetText,
  targetType,
  scoreTransform,
  searchEligible,
  verdictEligible,
  sourceBlockIds,
  sourceRawAssertionIds,
  sourceUnitIds,
  sourceExcerpt,
  sourceOffsets,
  mappingStatus,
  mappingRationale
}
```

Final-package provenance after `sourceRawAssertionIds` is deterministically inherited, not requested from the model.

Allowed `scoreTransform` values are `normal`, `invert`, and `none`. Review or uncertainty is recorded in `mappingStatus`, not encoded as a transform.

---

## 16. Evidence Need Cards

Every searchable target must receive an Evidence Need Card describing the future research task without executing it.

Each card includes:

- target and selected-claim IDs
- evidence roles actually needed
- target-specific bearing criteria
- query-lane seeds
- identifier hints
- canonical source identifiers already present in the article/package
- explicit rejection rules for merely topical or repetitive material

Generic evidence roles include:

- target-primary
- study-identity
- attribution-provenance
- official-response
- methodology-reanalysis
- primary-record
- context-background
- advocacy-restatement
- identifier-search

CF1 chooses only the roles justified by the target. It does not automatically multiply every target into every possible research lane.

`bearingCriteria` must contain `mustMatch`, `shouldMatch`, `rejectIfOnly`, and `weak`. `rejectIfOnly` must make clear why same-topic discussion, allegation repetition, identity-only material, or broad context would not address the target.

Identifier hints must generically preserve DOI, PMID, exact title, author/year, named study, filing, law, report, transcript, dataset, or quoted document name. A canonical identifier is not the same as a fetchable URL. CF1 may preserve the former but must not discover the latter.

---

## 17. Agentic and deterministic responsibilities

The agentic layer decides:

- semantic block function and article stance
- theme, thesis, pillars, clusters, and opponent positions
- semantic reconciliation among repeated or paraphrased assertions
- internal-consistency findings
- claim relevance, materiality, and portfolio selection
- compelling, faithful selected-claim wording
- target decomposition
- evidence roles, bearing criteria, and query-lane intent
- whether an identifier from another block genuinely belongs to a selected claim

The deterministic layer handles:

- structural block proposals and source offsets
- schema and enum validation
- ID and cross-reference integrity
- provenance preservation
- exact identifier normalization
- exact duplicate detection
- count and size limits
- selected-claim-only target enforcement
- one Evidence Need Card per searchable target
- package hashing, persistence, artifacts, and audit diagnostics
- one repair-pass limit
- prohibition of evidence search inside CF1

Deterministic code may flag possible conflicts or malformed output. It must not silently decide article meaning when the agent's interpretation is absent or unresolved.

---

## 18. Planned CF1 flow

```text
load persisted article and metadata
→ propose structural blocks deterministically
→ agent labels semantic blocks
→ agent extracts block-grounded raw assertions
→ agent reconciles semantic duplicates while preserving occurrences
→ agent builds final theme, thesis, pillars, clusters, and opponent map
→ agent reviews cross-block internal consistency
→ agent selects a compact portfolio of compelling evaluation claims
→ agent creates selected-claim Phase 3 targets
→ agent creates Evidence Need Cards
→ deterministic package verification
→ at most one targeted agent repair pass
→ deterministic reverification
→ persist approved package and artifacts
```

No evidence search, URL discovery, evidence fetch, source-stance decision, or article truth score occurs in this flow.

---

## 19. CF1 package acceptance principles

A valid CF1 package must demonstrate that:

1. The complete article was considered through source-grounded semantic blocks.
2. The final theme, thesis, and pillars cite their supporting blocks.
3. Raw assertions retain block and source provenance.
4. Reconciliation preserves every occurrence and does not erase contextual differences.
5. Every selected claim materially relates to the thesis, a pillar, an opponent position, a qualification, or an internal-consistency hinge.
6. Selected claims are compelling, faithful, concrete, and bearing-legible.
7. The selected portfolio represents the article's main reasoning rather than merely its easiest research anchors.
8. Every selected searchable claim has one or more grounded Phase 3 targets.
9. No raw or non-selected claim becomes a direct EvidenceRun target.
10. Every searchable target has a complete Evidence Need Card.
11. Attribution, substantive truth, identity, inference, stance, and score transformation remain distinct.
12. All uncertainty, exceptions, warnings, and repair actions are auditable.

---

## 20. Token and model-call budget

CF1 must obtain its semantic advantage from a bounded, inspectable reasoning loop,
not from either uncontrolled model calls or a one-shot extraction response.

For a typical article that fits comfortably in context:

- run orientation, initial extraction, semantic critique, revision/selection, and
  target/card construction as explicit traced stages
- allow at most one repair call, only after deterministic verification fails
- do not make per-block, per-claim, or per-target model calls
- require critique and revision before finalization
- do not resend the complete article during repair when affected blocks and package fragments are sufficient

For an unusually long article:

- use deterministic structural blocks
- allow bounded, compact block-analysis calls only when one-pass processing is not reliable
- send compact block observations into one final article-level synthesis call
- still allow at most one targeted repair call

All runs must:

- produce a bounded working assertion inventory rather than exhaustive sentence atomization
- keep rationales, excerpts, criteria, and query seeds concise
- generate no evidence-search, URL-fetch, per-source, or truth-scoring calls
- record model-call count, input tokens, output tokens, cached input tokens when available, repair count, duration, tokens per selected claim, and tokens per valid target

The primary efficiency metric is `tokensPerVerifiedClaimPackage`, supported by `tokensPerSelectedClaim` and `tokensPerValidTarget`. CF1 should be compared against the current pipeline on the same article fixtures before live integration.

---

## 21. API-first persistence and EvidenceRun handoff

CF1 must accept a consumer-neutral article input or a consumer-supplied content reference through adapters. VeriStrata-specific loading and table mapping remain outside the core agent contract.

A verified package should be stored durably before downstream evidence work. The handoff unit is an immutable `claimPackageId` plus `schemaVersion`, `packageHash`, and status—not a large in-process object or a direct CF1-to-EvidenceRun function call.

Recommended lifecycle:

```text
submitted → running → verification_failed | ready_for_evidence → evidence_running → evidence_complete | evidence_failed
```

CF1 owns states through `ready_for_evidence`. A later EvidenceRun worker or agent claims a ready package by ID, reads only selected claims, Phase 3 targets, and Evidence Need Cards, and writes evidence results separately. Raw working claims remain provenance and are never EvidenceRun inputs.

For CF1, use the existing database as the durable system of record and return the verified package or package ID from the API. Do not add a queue, broker, scheduler, or automatic EvidenceRun invocation in the first milestone. Add asynchronous dispatch later only when actual concurrency, retry, or deployment needs justify it.

---

## 22. Recorded comparison baselines

These numbers are frozen comparison facts, not estimates.

### 22.1 Current-pipeline/TM4-compatible F01 baseline

Artifact:
`artifacts/claim-foundry/comparisons/cf1cmp-release-2026-07-14/raw/CF1-F01-1-baseline.json`

| Measure | Recorded result |
|---|---:|
| Fixture | CF1-F01 |
| Prepared article characters | 37,451 |
| Model | `gpt-4o-mini-2024-07-18` |
| Model calls | 9 |
| Input tokens | 20,576 |
| Output tokens | 7,169 |
| Total tokens | 27,745 |
| Cached input tokens | 0 |
| Duration | 50.350 seconds |
| Final claims | 19 |
| Final populated evidence targets | 0 |

The nine calls were one article-frame call, seven same-contract chunk-survey calls,
and one theme-fusion call. The final adapter exposed only `id`, `text`, `role`,
`sourceExcerpt`, `namedEntities`, `namedStudiesOrDocuments`, and an always-empty
`targets` array. `id` was host-generated and `targets` was adapter-added. No retained
F01 claim populated `namedStudiesOrDocuments`; only three claims populated
`namedEntities`. The package also contained obvious duplicates. This is the cost and
quality baseline CF1 must beat, not a package design to copy.

### 22.2 Failed CF1 agent-runtime F01 attempt

Artifacts:
`artifacts/claim-foundry/agent-runs/f01-agent-runtime-gate/cf1run_019f6009-a58e-7200-8055-404117ca0384/`

| Measure | Recorded result |
|---|---:|
| Execution path | `agent` |
| Completed model stages | orientation, initial extraction, semantic critic |
| Failed stage | revision and selection |
| Recorded completed-stage tokens | 81,721 |
| Runtime budget accounting at failure | 118,890 tokens |
| Token ceiling | 100,000 tokens |
| Elapsed wall time | about 260.6 seconds |
| Final verified package | none |

The completed-stage token subtotal was 76,490 input plus 5,231 output. The runtime
rejected the revision call after cumulative accounting reached 118,890 tokens. It
therefore cost more than four times the TM4 baseline token total and more than five
times its duration without producing a package. This run is a failed experimental
baseline. It proves that explicit state and critique do not justify repeatedly sending
large article and work-product payloads.

### 22.3 Required comparison direction

CF1 must produce materially better selected claims and EvidenceRun instructions while
using fewer than 27,745 total tokens on F01. A normal F01 run should target one primary
article call plus, only if justified, one compact critic/revision call. Verification,
ID creation, excerpt resolution, query rendering, persistence, and diagnostics do not
justify additional model calls.

---

## 23. Historical model-field inventory: retain for review, do not request by default

This section is the field catalog for deciding what survives. It is deliberately broader
than the new contract. A representative mature TM4 preview contains 291 distinct
observed scalar leaf paths after array indexes are normalized; earlier discussion called
this roughly “255 fields.” The exact observed artifact is
`backend/logs/tm4_preview_runs/tm4prev-2026-07-12T02-22-33.json`.
Dynamic lane-name keys account for some count variation. Field presence in this catalog
does **not** authorize asking a model to regenerate it.

### 23.1 Nine-call baseline response fields

Article frame:

```text
provisionalThesis, provisionalStance, likelyPillars[], likelyOpposingClaims[],
namedAnchors[].{type,name}, openQuestions[], seedConfidence
```

Each chunk survey:

```text
chunkIndex, chunkPosition, chunkMiniTheme, relationshipToProvisionalFrame,
pillarHints[].{pillarText,confidence,supportingExcerpt},
evaluationCandidateClaims[].{
  claimText, roleHint, importanceInChunk, importanceToArticleGuess, noveltyHint,
  rhetoricalFunction, localSourceExcerpt, namedActors[],
  namedStudiesOrDocuments[], namedLawsOrPolicies[], namedDatasets[],
  claimType.{attribution,misconduct,causation,statistical,legal_or_regulatory},
  candidateOnly
},
sourceBackgroundCandidates[].{
  claimText, reasonUsefulAsSource, sourceUsefulness, localSourceExcerpt,
  namedActors[], namedStudiesOrDocuments[], namedLawsOrPolicies[], namedDatasets[],
  claimType.background, candidateOnly
},
localRepetitionSignals[].{phraseOrIdea,appearsToRepeatEarlierArticleTheme,notes}
```

Theme fusion:

```text
finalThesis, finalStance, themeShiftFromSeed,
finalPillars[].{pillarText,supportingChunkIndexes[],representativeCandidateIds[],coverageStrength},
dominantNamedAnchors[],
repeatedPersuasionPatterns[].{repeatedIdea,variantCandidateIds[],notes},
coverageGaps[]
```

These are 66 distinct schema positions across three response types. The 43-position
chunk-survey contract was repeated seven times. Most fields were discarded before the
comparison package, which is precisely why CF1 must not request them without a named
consumer or decision.

### 23.2 Mature TM4 raw/readiness claim fields

```text
claimId, visibleClaimText, canonicalExcerpt, sourceSentenceIds[], searchText,
claimForm, articleUse, speakerOrSource, embeddedSubstantiveClaim, warrantHint,
scoreTransformHint, evaluationLaneHint,
namedActors[], namedOrganizations[], namedStudiesOrDocuments[],
namedLawsOrPolicies[], namedSubstancesOrProducts[], numbersOrStatistics[],
clusterAnchors[], phase2ClusterId, phase2PillarId, phase2Role,
targetHints.{likelyScoreTransform,needsAttributionTarget,needsStudyIdentityTarget,
  needsSubstantiveTarget,why},
phase3Readiness.{hasAtomicVisibleClaim,hasCanonicalExcerpt,hasScoreTransformHint,
  hasTargetableText,needsAttributionSplit,needsStudyIdentityTarget,
  needsSubstantiveTarget},
reconciliation.{groupId,status,canonicalOccurrenceId,changed,reason,
  before.{articleUse,claimForm,hasEmbedded,hasSpeaker,likelyScoreTransform},
  after.{articleUse,claimForm,hasEmbedded,hasSpeaker,likelyScoreTransform}}
```

The important asserter field was `speakerOrSource`; persistence stored it as
`tm4_raw_claim_occurrences.speaker_source`. `namedStudiesOrDocuments` was intended to
carry exact names **and partial descriptive mentions** such as “the 2004 NIH study,”
not merely formally titled publications.

### 23.3 TM4 selection and reconciliation fields

```text
selectedEvaluationClaims[].{
  [all raw/readiness claim fields], selectionRank, selectionScore,
  selectionRationale, sourceRawClaimIds[],
  selectionBreakdown.{
    articleCentrality, articlePositionProminence, broadEvidenceLane, broadLane,
    claimBearingFamily, evidenceAffordance, hardPredicateFlag, intrinsicScore,
    laneDiversityPenalty, namedAnchorStrength, narrowEvidenceLane, narrowLane,
    opponentClaimFlag, pillarCoverageRole, predicateFamily,
    primaryDocumentAffordance, reasoningMoves[], selectionScoreBeforeLanePenalty,
    selectionScoreAfterLanePenalty, sourceExcerptQuality, specificity,
    studyOrDocumentHint, verificationWorthiness
  }
},
nonSelectedClaims[].{[all raw/readiness claim fields],selectionScore,suppressionReason},
reconciliation.{
  duplicateGroups[], stanceChanges[], stanceConflicts[], reconciledCount,
  flaggedForReviewCount, integrity.{lostExcerpts,lostIds,lostSentenceIds}
},
phase2.{articleTheme,deterministicClusters[],pillars[],synthesizedClusterSummaries[]},
selectionSummary.{
  articleThesis,rawClaimCount,selectedCount,selectorVersion,rebuttalFrame,
  clusterCoverage,pillarCoverage,duplicateSuppression,documentAffordanceCount,
  scoreTransformCounts,broadLaneCounts,narrowLaneCounts,maxBroadLaneCount,
  opponentClaimsSelected,invertClaimsSelected,rhetoricalQuestionsExcluded[],
  claimsPromotedForLaneDiversity[],claimsDemotedForLaneOverconcentration[],
  highAffordanceOmitted[],orderIndependence,evidenceBudget,evaluator
}
```

These selection scores and breakdowns are audit/debug candidates. They are not presumed
to be model outputs or necessary EvidenceRun inputs.

### 23.4 Mature TM4 target/query fields

```text
targetId, sourceClaimId, targetType, targetText, visibleClaimText,
canonicalExcerpt, sourceSentenceIds[], warrant, scoreTransform,
searchEligible, verdictEligible, mappingConfidence, mappingReason,
identityHint, needsDisambiguation, derivedFromTargetId, qualityStatus,
documentAffordanceClass, documentAffordanceHints[],
queryHints.{
  primaryQueryText,requiredEntities[],optionalEntities[],studiesOrDocuments[],
  lawsOrPolicies[],substancesOrProducts[],numbersOrStatistics[],clusterAnchors[],
  expansionTerms[],siblingEvidenceHints[],documentAffordanceHints[],
  queryExpansionSourceClaimIds[]
},
bearingCriteria.{mustMatch[],shouldMatch[],rejectIfOnly[],weak,bearingNotes},
queryExpansion.{
  queryBeforeExpansion,queryAfterExpansion,queryExpansionSourceClaimIds[],
  siblingEvidenceHints[],documentAffordanceClass,documentAffordanceHints[],
  bearingCriteriaBefore,bearingCriteriaAfter
}
```

Target diagnostics included counts by target type and score transform, searchable and
verdict-eligible counts, multi-target claims, suppressed study-identity targets, and
warnings. These are host diagnostics, not agent package content.

---

## 24. TM4 and target persistence inventory

CF1 must understand the existing persistence surface even when it chooses a smaller
portable contract.

### `tm4_claim_packages`

```text
tm4_claim_package_id, content_id, run_id, pipeline_version, source_package_path,
source_package_hash, fixture_name, article_thesis, raw_claim_count,
selected_claim_count, target_count, selection_summary_json, diagnostics_json,
created_at
```

### `tm4_raw_claim_occurrences`

```text
tm4_raw_claim_occurrence_id, tm4_claim_package_id, content_id, claim_id,
source_claim_id, occurrence_order, section_index, section_heading,
visible_claim_text, canonical_excerpt, source_sentence_ids_json, claim_form,
article_use, speaker_source, embedded_substantive_claim, warrant_context,
score_transform, evaluation_lane_hint, pillar_id, cluster_id, phase2_role,
is_selected, suppression_reason, selection_score, phase1_json, created_at
```

### `tm4_claim_reconciliations`

```text
tm4_reconciliation_id, tm4_claim_package_id, group_id, raw_occurrence_id,
source_claim_id, canonical_source_claim_id, status, reconciliation_reason,
reconciliation_json, created_at
```

### `tm4_selected_evaluation_claims`

```text
tm4_selected_evaluation_claim_id, tm4_claim_package_id, content_id,
content_claim_id, claim_id, source_raw_occurrence_id, source_claim_id,
cluster_id, pillar_id, selection_rank, selection_score, thesis_relevance_score,
evidence_priority, representative_claim_text, evaluation_question,
selection_reason, selection_breakdown_json, source_raw_claim_ids_json,
is_workspace_visible, is_evidence_eligible, created_at
```

### `claim_evaluation_targets`

```text
evaluation_target_id, content_id, claim_id, parent_target_id, target_type,
target_text, subject_entity, predicate_text, object_text, alleged_action,
study_title, study_authors, study_year, study_identifier, population_scope,
source_excerpt, article_stance, score_transform, search_eligible,
verdict_eligible, resolution_status, target_order, mapping_confidence,
mapping_rationale, source_claim_id, target_key, primary_query_text,
query_hints_json, bearing_criteria_json, quality_status, quality_flags_json,
weak_bearing, needs_atomic_split, created_at, updated_at
```

CF1 projection migrations additionally propose `claim_foundry_package_id`,
`claim_foundry_target_id`, `claim_foundry_card_id`, `evidence_need_card_json`, and the
generated `projection_scope_key`. These are storage/projection fields, not fields the
agent should generate.

---

## 25. Proposed lean CF1 → EvidenceRun task contract

The next CF1 contract must optimize for one outcome: EvidenceRun can efficiently find
evidence that actually bears on a meaningful article claim, while a reader can see how
the claim could be supported, refuted, qualified, or left unresolved.

```js
{
  taskId,                    // host ID
  selectedClaimId,           // host ID
  claimText,                 // clear product-facing claim
  role,                      // thesis | pillar | evidence | opponent | qualification
  articleUse,                // endorses | reports | quotes | rebuts | unclear
  materiality,               // central | major | supporting
  counterfactualImpact,      // why changing this claim changes the article's case
  assertionSource: {         // who is making or supplying the assertion
    name,
    kind,                    // article | author | person | organization | named_work
    relationship             // asserts | reports | quotes | summarizes | attributes
  },
  claimMode,                 // factual | causal | statistical | attribution | study_result | policy/legal
  subclaims: [],             // only when a compound claim must be searched separately
  grounding: {
    sourceUnitIds: [],       // agent references host units
    sourceExcerpt            // host resolves exact text
  },
  target: {
    claimQuestion,           // readable question shown to a user
    falsifiableTarget,       // precise proposition EvidenceRun must test
    scope: {
      population,
      geography,
      timeframe,
      conditions
    }
  },
  falsifiability: {
    wouldSupportIf,
    wouldRefuteIf,
    wouldQualifyIf,
    notEnoughIfOnly
  },
  retrieval: {
    entityRoles: [{ name, role }],
    namedWorkHints: [{
      mentionText,
      workType,
      titleOrDescription,
      authorsOrSponsors: [],
      year,
      identifiers: [],
      relationshipToClaim,
      sourceUnitIds: []
    }],
    bestSourceTypes: [],
    requiredEvidenceRoles: [],
    mustMatch: [],
    rejectIfOnly: [],
    searchSeeds: [],
    identifierHints: [],
    providerRoutingHints: [],
    primarySourcePriority
  },
  scoreTransform,             // normal | invert | none
  warnings: []
}
```

This is 44 leaf field positions when nested named-work and entity fields are counted.
Thirty-six positions involve semantic extraction or judgment by the agent; eight are
host-created, host-resolved, normalized, derived, or verified. Empty optional arrays do
not justify additional model prose.

### 25.1 Required named-work behavior

`namedWorkHints` remains required as an array, even when empty. It accepts incomplete
identity clues. For an article sentence like “Diggidy Doo says the 2004 masturbation
study was manipulated by the NIH,” a useful hint is:

```js
{
  mentionText: "the 2004 masturbation study",
  workType: "study",
  titleOrDescription: "2004 study concerning masturbation",
  authorsOrSponsors: ["NIH"],
  year: 2004,
  identifiers: [],
  relationshipToClaim: "study allegedly manipulated, as asserted by Diggidy Doo",
  sourceUnitIds: ["U..."]
}
```

It must not invent a formal title, author, sponsor, or identifier. Partial clues are
valuable because they can deterministically yield a seed such as `2004 NIH study
masturbation Diggidy Doo`. EvidenceRun can then perform identity discovery explicitly.

### 25.2 Required assertion-source behavior

`assertionSource` replaces ambiguous actor lists for attribution. It records whether the
claim is made by the article/author, quoted person, organization, study, or document.
`entityRoles` separately records semantic roles such as claimant, accused actor,
researcher, sponsor, regulator, population, product, dataset custodian, or publisher.
This preserves the distinction between “Diggidy Doo alleged X,” “NIH did X,” and “the
article endorses X.”

### 25.3 Evidence-readiness completeness gate

Field presence is not readiness. A task may be handed to EvidenceRun only when:

1. `claimText` and `falsifiableTarget` express a specific proposition rather than a topic.
2. `assertionSource` is populated; use the article/author explicitly when no quoted or
   attributed speaker supplies the assertion.
3. `grounding.sourceUnitIds` resolves deterministically to a source excerpt that actually
   supports the claim wording and attribution.
4. `wouldSupportIf` and `wouldRefuteIf` describe materially different possible findings.
5. `notEnoughIfOnly` rejects at least the obvious merely topical, allegation-repeating,
   or identity-only false positive for the task.
6. `mustMatch` contains the predicates, relationships, scope, or work identity that makes
   evidence bear on this claim—not just shared keywords.
7. At least one usable retrieval anchor exists: a named or described work, identifier,
   distinctive entity-role combination, statistic, date, population, jurisdiction,
   event, or other specific phrase.
8. `bestSourceTypes` and `requiredEvidenceRoles` tell EvidenceRun what kind of result can
   resolve the target.
9. Named or partially described works present in the grounding units are represented in
   `namedWorkHints`; absence must be defensible, not an extraction omission.
10. Search seeds rendered by the host preserve the target, asserter, named-work, and scope
    clues without multiplying into an uncontrolled query fan-out.

A task failing these checks is `claim_ready_but_not_evidence_ready`. It remains in the
claim package with warnings but is not dispatched to EvidenceRun until repaired. No data
contract can guarantee that evidence exists; this gate guarantees that EvidenceRun is
not asked to search an underspecified task.

---

## 26. Agent-versus-host ownership for the lean contract

Ask the agent only for meaning it must infer from the article:

```text
claimText, role, articleUse, materiality, counterfactualImpact,
assertionSource, claimMode, subclaims, grounding.sourceUnitIds,
target.claimQuestion, target.falsifiableTarget, target.scope,
falsifiability.*, retrieval.entityRoles, retrieval.namedWorkHints,
retrieval.bestSourceTypes, retrieval.requiredEvidenceRoles,
retrieval.mustMatch, retrieval.rejectIfOnly, scoreTransform
```

Prefer deterministic host production or normalization for:

```text
taskId, selectedClaimId, grounding.sourceExcerpt and offsets,
normalized identifierHints, rendered searchSeeds, providerRoutingHints,
primarySourcePriority defaults, duplicate removal, enum validation,
cross-reference validation, package/version IDs, hashes, persistence fields,
warnings and diagnostics
```

Mixed ownership is permitted where it reduces invention:

- The agent extracts an identifier exactly as written; the host validates and normalizes it.
- The agent identifies search concepts and named-work relationships; the host renders a
  small number of queries. EvidenceRun may later revise strategy based on results.
- The agent recommends source types and evidence roles; deterministic policy may add a
  mandatory primary-record lane for a DOI, law, filing, named report, or dataset.
- The agent assigns `scoreTransform`; the host rejects transformations inconsistent with
  `articleUse` and attribution structure.

No field may enter the model response schema unless it has a named downstream consumer,
semantic decision, acceptance check, or audit purpose. Audit-only state belongs in trace
artifacts and must be concise. The normal CF1 model call must not regenerate host IDs,
exact excerpts, offsets, hashes, query strings, routing rules, persistence columns,
selection-score breakdowns, or diagnostics.

### 26.1 Baseline-victory gate

On frozen F01, CF1 does not beat the baseline merely by returning fewer fields or claims.
It must satisfy all of the following on the same prepared article:

- fewer than 27,745 total model tokens and materially less than 50.350 seconds, unless a
  reviewed quality gain justifies a small runtime exception
- one bounded primary article call and no more than one compact semantic critique/revision
  call in the normal path; repair remains exceptional
- approximately 8–12 non-duplicate selected claims covering the thesis and major pillars
- every dispatched task passes the evidence-readiness completeness gate
- all supplied asserters, study/document descriptions, years, organizations, identifiers,
  populations, and qualifications needed for retrieval are preserved
- deterministic excerpts resolve from source unit IDs; the model does not reproduce or
  repair offsets
- a reviewer judges the claims more useful and the retrieval instructions more bearing-
  specific than the recorded TM4-compatible package

Later fixture-wide victory requires the same comparison across all frozen fixture classes;
F01 victory alone is necessary but not sufficient for live-path activation.

---

## 27. Implemented one-call CF1 agent contract (supersedes sections 25–26 for runtime)

Sections 23–26 retain the full historical field inventory and the earlier candidate
contract for later reassessment. The implemented normal CF1 path is deliberately smaller.
It sends the prepared article once and requires one structured response exposing the
agent's orientation, initial work product, semantic critique, revision decisions, and
selected evidence tasks.

### 27.1 Agent-produced fields

```text
orientation
  theme
  thesis
  pillars[]: label, text, importance

initialCandidates[]
  claimText
  sourceUnitIds

critic
  summary
  findings[]: type, severity, problem, recommendedAction

revisionTrace[]
  findingType
  beforeClaimText
  afterClaimText
  action                 // add | drop only
  explanation

selectedClaims[]
  claimText
  sourceUnitIds
  assertionSource
  articleUse
  namedWorkHints[]: mentionText, workType, year,
                    peopleOrOrganizations, identifiers
  articleRole
  materiality            // high | medium; never low
  claimMode
  scope
  wouldSupportIf
  wouldRefuteIf
  wouldQualifyIf
```

The implemented schema has 33 distinct semantic leaf positions across its five output
sections. A selected claim has 12 top-level fields; a populated named-work hint adds five
nested fields. Initial candidates carry only two fields. This replaces the earlier
44-position candidate task and the much larger historical package inventories.

Revision uses only `drop` and `add`. A rewrite is represented as drop-old plus add-new.
A merge drops redundant candidates and adds merged wording only when the wording is new.
The host reconciles harmless direction/formatting errors against the actual initial and
selected sets; it never invents a semantic claim.

### 27.2 Deterministic host-produced fields

The agent is not asked to produce any of the following:

```text
package, run, claim, target, card, block, or assertion IDs
exact excerpts, canonical offsets, content hashes, or package hashes
query routing or provider selection
query strings or query-lane objects
evidence-role arrays
mustMatch arrays
non-bearing/rejectIfOnly wording
scoreTransform or target posture
identifier normalization
artifact names, diagnostics, persistence fields, or projection fields
```

The host derives query seeds from selected claim text plus non-duplicated named-work and
actual asserter clues. It excludes generic sources such as “the study.” It adds primary-
record, study-identity, and attribution-provenance roles by deterministic policy. It
creates a standard claim-specific non-bearing rule rejecting material that only discusses
the scope or repeats the proposition without directly testing it. Query routing belongs
to EvidenceRun or deterministic provider policy, not CF1 model output.

### 27.3 One-call runtime and trace invariant

Normal CF1 execution makes exactly one provider request and disables the model runner's
legacy whole-request retry (`maximumAttempts: 1`). The single response exposes the
internal semantic sequence; the runtime materializes it into explicit state and ordered
trace steps:

```text
agent_reasoning_loop
orientation_materialized
initial_claims_materialized
semantic_critic_materialized
revision_and_selection_materialized
deterministic package verification
```

Repair remains a separate, exceptional maximum-one pass after package verification. It
is not used in the recorded F01 one-call runs. CF1 performs no evidence search.

### 27.4 Recorded F01 result and baseline comparison

TM4 baseline:

```text
model: gpt-4o-mini-2024-07-18
provider calls: 9
input tokens: 20,576
output tokens: 7,169
total tokens: 27,745
runtime: 50.350 seconds
result: 19 low-quality/duplicative claims; zero usable targets
```

Current-contract CF1 paid response (`f01-one-call-v1q`):

```text
model: gpt-4o-mini
provider calls: 1
transport attempts: 1
input tokens: 14,280
output tokens: 2,415
total tokens: 16,695
runtime: 37.579 seconds
selected claims: 8
repair calls: 0
```

Token reduction versus TM4 is 11,050 tokens (39.8%). Output-token reduction is 4,754
tokens (66.3%). Runtime is 12.771 seconds faster (25.4%). F01 therefore passes the
mechanical token, call-count, target-count, and runtime gates; human quality review is
still required.

The paid response is preserved at:

`artifacts/claim-foundry/agent-runs/f01-one-call-v1q/cf1run_019f607f-5b0f-765f-bc53-5e66af274364/one-call-agent-output.json`

After the deterministic trace-direction correction, that exact response completed the
current package path without another provider call. The proof package and trace are at:

`artifacts/claim-foundry/agent-runs/f01-one-call-v1q-final/cf1run_019f6082-5858-74e8-92d6-b436f3b77214/`

The trace shows the initial inventory criticized, redundant/non-central candidates
dropped, the IOM wording replaced by drop-plus-add, and the final selected set changed.
The package status is `ready_for_evidence` and deterministic verification passed.

### 27.5 Remaining gates

- Obtain reviewer scoring of F01 claim usefulness and Evidence Need Card quality against
  the frozen TM4 output; passing schema verification is not quality victory.
- Confirm the runtime/token advantage across F02–F08 rather than inferring reliability
  from one F01 pass.
- Run the same current contract across F02–F08 and measure invalid-package rate.
- Do not activate the live scrape path until fixture-wide comparison and rollback gates
  pass. EvidenceRun remains out of scope for CF1 implementation.

### 27.6 Enforced theme-to-claim gate

CF1 selection now treats theme bearing as a verified contract rather than a lexical
post-processing guess:

- `theme` must state the article's argumentative point or research conclusion, not only
  a subject or research objective.
- Pillars must be grounded propositions, not section headings or general topics.
- Every selected claim must return exact `relatedPillarLabels` chosen from the agent's
  orientation.
- Every load-bearing or major pillar must have at least one selected EvidenceRun task.
- The host maps those explicit labels to package pillar IDs; it no longer guesses the
  relationship from shared words.
- Selected claim wording is capped at 240 characters and prompted toward one plain
  sentence under 30 words.
- The host deterministically rejects reversed support/refute tests for negative claims.

F01 gate trials on 2026-07-14:

| Trial | Calls | Tokens | Result | Material finding |
|---|---:|---:|---|---|
| `f01-theme-gate-v1` | 1 | 17,170 | rejected | Theme stated the study objective; support/refute polarity was reversed; major pillars were uncovered. |
| `f01-theme-gate-v2` | 1 | 17,131 | rejected | Theme improved, but overclaimed causality; selected duplicates remained; two method claims had no pillar; one claim was inadequately grounded. |
| `f01-theme-gate-v3` | 1 | 17,683 | rejected | Counterfactual bearing was returned, but negative claim tests were still reversed and the causal theme remained too broad. |
| `f01-theme-gate-v4` | 0 completed | unknown | transport timeout | The renamed `claimTrueIf`/`claimFalseIf` contract received no model response before the 90-second timeout; this is not a semantic result. |

These are useful failed trials, not successful packages. The gate correctly prevents a
schema-valid but thematically incoherent portfolio from becoming ready for EvidenceRun.
The full CF1 suite passed 185/185 tests after the gate was added.

The agent-facing falsifiability fields are now named `claimTrueIf`, `claimFalseIf`, and
`claimQualifiedIf` so the model evaluates the selected proposition rather than whether
the broader article wins. The host maps these to the stable portable package fields
`wouldSupportIf`, `wouldRefuteIf`, and `wouldQualifyIf`. Each selected claim must also
provide a concise `themeBearing` counterfactual. Near-duplicate selected propositions
and causal themes without causally grounded thesis evidence are deterministically
rejected. The suite passed 186/186 tests after these additions.

## 28. Two-call selected-enrichment direction (supersedes §27.3)

The one-call contract remains a recorded baseline, not CF1's current normal agent path.
Current CF1 uses two bounded semantic calls with a deterministic host state change between
them. The purpose is to preserve ER1-ready package quality while avoiding enrichment work
for candidates the host will discard.

```text
Call 1: full structured article once
  -> theme, thesis, concrete pillars
  -> 12-20 compact candidate claims with source units, role/use/source,
     materiality, pillar labels, scope, usefulness hint
  -> a separate text-derived named-work inventory

Host semantic critic and selector
  -> validate source units and grounding
  -> reject overbroad, low-materiality, routine-method, and duplicate candidates
  -> flag polarity risks and preserve named-work hints
  -> enforce thesis and major/load-bearing pillar coverage
  -> select 8-10 candidates and record critic_report.json

Call 2: selected portfolio and only relevant source context
  -> concise final wording and verification question
  -> true / false / qualified conditions and theme bearing
  -> full ER1 evidence need, source-role, bearing, warning, identifier,
     and compact query-lane enrichment for selected claims only

Host finalization
  -> IDs, excerpts, offsets, hashes, posture/score transform, deterministic
     query metadata, package assembly, verification, optional one repair,
     artifacts, and persistence/rejection
```

Call 1 does not produce Evidence Need Cards, full bearing criteria, query lanes, score
transforms, routing, excerpts, offsets, IDs, a critic, or a revision trace. Call 2 does
not choose the portfolio or alter host-owned source-unit, role, materiality, pillar, or
scope fields. CF1 does not execute EvidenceRun.

The final portable package is not reduced. Full Evidence Need Cards remain attached to
the selected Phase 3 targets. The cost reduction comes from producing those fields for
8-10 selected tasks rather than every raw candidate.

The frozen comparison baseline remains TM4 F01: about 50 seconds, 19 raw claims, 12 kept
claims, and 27,745 tokens. The current two-call path must be measured on F08 and F01,
then F06 and F03, for provider calls, tokens, runtime, selected portfolio, enrichment
quality, verifier errors, repair use, and final package validity before live activation.

### 28.1 First measured two-call fixture pass (2026-07-15)

All measurements use `gpt-4o-mini`. Where a deterministic host correction followed a
completed provider response, the paid response was replayed rather than purchased again;
reported tokens are the original Call 1 plus the final Call 2. Runtime combines the
original provider duration of those two calls and excludes deterministic replay time.

| Fixture | Raw candidates | Selected | Calls | Tokens | Provider time | Repair | Final package |
|---|---:|---:|---:|---:|---:|---:|---|
| F08 short factual report | 11 | 3 | 2 | 5,695 | 30.2s | 0 | valid |
| F01 research article | 12 | 8 | 2 | 22,276 | 51.0s | 0 | valid |
| F06 argumentative obituary | 12 | 8 | 2 | 10,967 | 47.8s | 0 | valid |
| F03 long rebuttal article | 12 + 1 host-promoted pillar | 8 | 2 | 24,406 | 48.0s | 0 | valid |

Against the TM4 F01 baseline of 27,745 tokens and 50.35 seconds, F01 uses 5,469 fewer
tokens (19.7% reduction). Its measured provider time is essentially tied and about 0.6
seconds slower, so CF1 has not yet demonstrated a runtime victory on F01. F03 remains
below both the TM4 token and runtime baselines despite receiving the full 51,132-character
article in Call 1.

Development failures were retained as artifacts and were not counted as successful
repair passes. They exposed host-contract defects: exact Call 2 cardinality was not in
the schema; a thesis candidate lacked a pillar link; a major pillar had no candidate;
same-block grounding expansion was unordered; and the model sometimes returned empty
bearing arrays or treated source-unit IDs as document identifiers. The host now:

- makes Call 2 cardinality equal the selected portfolio size;
- assigns a missing pillar link only from strongest grounded overlap;
- promotes a grounded major-pillar proposition when Call 1 omitted its candidate;
- rejects any still-uncovered major/load-bearing pillar;
- expands thin grounding only with linked-pillar or same-structural-block units and then
  sorts those units in document order;
- strips ungrounded model identifiers and spurious named-work hints;
- normalizes evidence-role aliases and deterministically supplies defensive non-bearing
  and must-match fallbacks;
- requires nonempty best-source, evidence-role, must-match, and reject-if-only arrays in
  the current Call 2 schema.

Inspectable final artifact roots:

```text
artifacts/claim-foundry/agent-runs/two-call-f08-v1-verified/
artifacts/claim-foundry/agent-runs/two-call-f01-v3-resumed/
artifacts/claim-foundry/agent-runs/two-call-f06-v2-final/
artifacts/claim-foundry/agent-runs/two-call-f03-v2-resumed/
```

The CF1 regression suite passes 195/195 tests. These fixture results authorize continued
two-call comparison work only; they do not authorize live scrape activation or ER1
execution.

### 28.2 Host-owned named-work pool

Named works remain part of the final CF1 package and ER1 handoff, but Call 2 does not
author them. Call 1 and the deterministic visible-text detector may propose named works.
The host validates source-unit grounding, normalizes citation callouts, deduplicates
alternate mentions, assigns stable package-local IDs (`NW001`, `NW002`, ...), and builds
the `namedWorkPool`.

Call 2 receives a compact read-only pool and may return only `relevantNamedWorkIds`,
capped at six per selected claim. It does not author a named-work relevance note.

Every returned ID must be a unique member of the supplied pool. The Call 2 schema has no
free-text named-work title, author, organization, or document-name fields. It also omits
free-text identifier fields such as exact titles and author-year strings. The host
rehydrates full validated records into claim-level `namedWorkHints`, retains the complete
pool as `articleMap.contextWorks`, and creates named-work query seeds deterministically.
The current primary article is never inferred as an external named work.

Provider output that ends because of a token limit or contains more than 1,024 trailing
whitespace characters is rejected before JSON parsing. All Call 2 strings and arrays are
bounded by schema, with host validation supplying uniqueness and subset enforcement.

### 28.3 Fast Call 1 correction

An expanded Call 1 that required 16–20 candidates plus an exhaustive model-authored
named-work inventory reproducibly regressed F01 semantic-inventory time from 24.6 seconds
to 47–49 seconds. The expanded runs used 15,781–16,030 tokens and returned 16 candidates
plus six to eight named works. A following Call 2 also timed out at 120 seconds; source
identity bundle assembly was not the cause because it runs after enrichment.

Call 1 therefore returns at most 12 candidates and aims for 10–12 only when the article
supports them. The schema permits 8–12 for substantial articles so weak material is not
padded with filler. It no longer returns a separate named-work inventory. Deterministic
host preprocessing builds and deduplicates the named-work pool, assigns stable IDs, and
associates grounded works with candidates before host selection and Call 2.

The first isolated F01 measurement after this correction completed in 25.1 seconds with
13,206 input tokens, 1,317 output tokens, and 14,523 total tokens. It returned eight
candidates; the host independently retained five named works. This restores Call 1 to the
prior speed range while preserving host-owned identity information. Full two-call package
performance remains to be remeasured.

### 28.4 Compact semantic Call 2 and host query expansion

Call 2 no longer authors the complete ER1 package repeatedly for every selected claim.
Its v2 contract returns only semantic judgments the host cannot safely derive: optional
revised claim wording, concrete support/refute/qualification criteria, must-match and
reject-if-only boundaries, one source strategy, compact search concepts, bounded
named-work IDs, and cautions.

The host expands that kernel into the unchanged final package. It creates verification
questions and theme-bearing text, maps source strategies to source types and evidence
roles, carries grounded identifiers, constructs article-primary, semantic, and named-work
query lanes, attaches exact provenance, and emits deterministic empty/default fields.
Official-record routing is enforced when Call 2's own semantic guidance requires an
authoritative agency, government, legal, scientific-observation, or administrative
record. External named-work claims route to their validated works. The complete global
named-work pool remains available to ER1 even when no claim-level association is selected.

The earlier F01 package used 5,531 Call 2 input tokens and 2,293 output tokens in 55.9
seconds. Compact F01 Call 2 used 3,600 input and 1,120 output tokens in 25.6 seconds while
retaining eight selected claims and a valid full package. The complete comparable run is
approximately 19,374 tokens versus 22,392 before compaction. F08 compact Call 2 used
1,510 input and 418 output tokens in 12.7 seconds; its valid package routes earthquake,
tsunami, location, and depth guidance to authoritative records through host expansion.

These are directional measurements, not a provider-latency guarantee. Acceptance still
depends on useful claim wording, concrete falsifiability boundaries, discriminating query
concepts, correct source routing, complete deterministic verification, and no evidence
search inside CF1.

### 28.5 Compact eight-fixture measurement

The compact two-call path produced valid packages for F01-F08 with no repair calls and
no evidence searches. The accepted packages used 98,038 tokens across 16 model calls and
464.4 seconds of model time. At the GPT-4o mini rates checked 2026-07-15, their estimated
API cost was $0.0217. F01 used 19,342 tokens in 84.8 seconds; F08 used 3,920 tokens in
24.6 seconds. The complete claim packages and per-call measurements are recorded in:

```text
artifacts/claim-foundry/agent-runs/eight-fixture-compact-20260715/
  claim-packages-by-fixture.md
```

Rejected development attempts increased actual suite spend to 134,725 billed tokens,
23 physical model calls, 627.9 seconds of model-call time, and an estimated $0.0304.
Those attempts exposed three host-contract defects: source-unit lists were not always
normalized to ArticleDocument order; the target of eight claims was incorrectly treated
as a reason to reject a smaller distinct portfolio; and Call 2 once repeated protected
named-work text instead of using only its host ID. The host now normalizes every grounded
Call 1 and selected-claim unit list, treats 8-10 as a target rather than a padding rule,
and retains the protected named-work rejection. One sandbox DNS failure reached no model
and incurred no tokens.

The regression suite passes 213/213 tests. This comparison still does not authorize live
scrape activation or ER1 execution.

## 29. Citation-aware source identity (ArticleDocument v3)

CF1 preserves article-supplied citation structure as deterministic ArticleDocument
sidecars. HTML inline links, DOI/PMID links, superscript and numeric citation markers,
author-year markers, footnotes/endnotes, reference entries, and fragment targets retain
stable IDs without changing canonical text offsets. Broken or ambiguous references are
diagnosed and not semantically guessed. Citation meta tags and article JSON-LD provide
host-grounded bibliographic identity fields when present.

The host builds a package-level `sourceIdentityBundles` pool for the primary article,
validated named works, inherited article references, and inherited article links. A
bundle distinguishes assertion sources from work authors, publishers, and institutions;
keeps unknown values null/empty; normalizes grounded DOI/PMID/URL identifiers; and points
back to source units, references, and links. Selected claims, Phase 3 targets, and
Evidence Need Cards carry only compact `namedWorkIds`, `identityBundleIds`,
`articleReferenceIds`, and `articleLinkIds` arrays.

The verifier rejects invalid or duplicate IDs, missing package objects, ungrounded
bibliographic metadata, copied-lead mismatches, and claim references that cannot be
traced through inherited source units or an explicit validated named-work relationship.
Non-retrieval page chrome cannot become an ER1 lead. An article citation remains only a
retrieval lead; CF1 performs no retrieval and makes no evidentiary judgment about it.

This work is preprocessing/package infrastructure only. The live scrape path is not
switched by this amendment, and PDF annotation/reference proximity remains dependent on
the layout data supplied by the PDF adapter.
