# VeriStrata TM Claim Extraction Plan
## Final-final-final v4: Parallel Survey + Theme Fusion + Two-Lane Claim Persistence

**Date:** 2026-07-05  
**Purpose:** Replace claim-bloat extraction with a cheaper, more explainable Theme-Mapped claim extraction system that selects the best evaluation claims before evidence retrieval, while preserving useful background/source claims for later evidence use.

---

## 0. One-sentence doctrine

```text
Survey chunks in parallel, fuse mini-themes into a final article theme map, cluster repeated/rephrased assertions, persist <=12 evaluation claims plus a bounded source/background lane, and only run evidence on the evaluation lane.
```

---

## 1. Why this version exists

The old flow treated each chunk as a claim factory:

```text
article → chunks → 5–12 claims per chunk → persist dozens of claims → evidence engine burns time
```

The new TM flow treats chunks as **cheap survey instruments**, not final claim generators:

```text
article
→ provisional article frame
→ parallel chunk survey
→ theme fusion
→ candidate clustering
→ two reducers
   → selectedEvaluationClaims <= 12
   → selectedSourceBackgroundClaims <= configurable cap
→ persist both lanes with different flags
→ evidence only for selectedEvaluationClaims
```

This plan keeps the strongest parts of Claude’s proposal:

- title/lead-based theme seed
- chunk mini-themes
- parallel chunk processing
- role labels
- final synthesis

But rejects the expensive part:

```text
Do not run full evidence on N × 12 chunk claims and weed the garden afterward.
```

Evidence is too expensive to be the first serious filter. The filter must happen before evidence.

---

## 2. Core vocabulary

### TM

**TM** here means **Theme-Mapped claim extraction**. It is the structure that lets VeriStrata identify what the article is actually arguing before spending tokens and search calls on evidence.

### Provisional article frame

The first weak guess at the article’s argument, built from title, first section, last section, and headings.

Important:

```text
The provisional frame is a compass, not a gate.
```

Later chunk mini-themes may expand, narrow, contradict, or replace it.

### Chunk mini-theme

A short description of what a chunk contributes to the article’s argument. Mini-themes are **metadata**, not claims.

### Candidate claim

A cheap, local, not-yet-persisted possible claim surfaced by a chunk survey.

### Canonical evaluation claim

A document-level claim selected after theme fusion, clustering, and reduction. These are the claims used to evaluate the content.

### Source/background claim

A useful claim found in the content that does not affect this article’s central evaluation, but may help later when this content is used as a source for another content item.

---

## 3. Two-lane persistence model

Persist two claim lanes, not one.

### Lane A: selectedEvaluationClaims

```text
Hard cap: <=12
Role: thesis | pillar | evidence | opposing_claim | fallibility_critical | source_anchor when central
Used for current content evaluation: yes
Shown in workspace eval list: yes
Evidence retrieval: yes
Verdict impact: yes
```

These are the claims that determine whether this content is supported, unsupported, refuted, or unresolved.

### Lane B: selectedSourceBackgroundClaims

```text
Suggested cap: <=12 initially, configurable
Role: background, or source_anchor with argumentFunction=background
Used for current content evaluation: no
Shown in workspace: yes, bottom/collapsed/background lane
Evidence retrieval during current evaluation: no
Verdict impact: no
Useful when this content is later used as a source: yes
```

These are retained because an article can be bad as an argument but still contain useful named anchors, citations, dates, laws, datasets, actors, or study references.

### Required flags/fields

Use existing fields where they already exist, but make the intent explicit.

```ts
{
  text: string,

  role: "thesis" | "pillar" | "evidence" | "opposing_claim" | "fallibility_critical" | "background" | "source_anchor" | "unclear",
  argumentFunction: "evaluation" | "background" | "source_anchor" | "debug_candidate",

  selectedForEvaluation: boolean,
  evaluationEligible: boolean,
  verdictEligible: boolean,
  searchEligible: boolean,

  // New or confirmed separate source-library meaning.
  // Do not overload searchEligible, because background claims must remain searchEligible=false
  // during the evaluation of this content.
  sourceEligible: boolean,
  sourceUsefulness: "high" | "medium" | "low",

  visibility: "workspace_eval" | "workspace_background" | "source_only" | "debug_only",

  canonicalClusterId: string | null,
  sourceChunkIndexes: number[],
  localSourceExcerpt: string,

  namedActors: string[],
  namedStudiesOrDocuments: string[],
  namedLawsOrPolicies: string[],
  namedDatasets: string[],

  claimType: {
    attribution?: boolean,
    causal?: boolean,
    statistical?: boolean,
    misconduct?: boolean,
    legal_or_regulatory?: boolean,
    study_identity?: boolean,
    medical_scientific?: boolean,
    background?: boolean
  }
}
```

### Why `sourceEligible` must be separate from `searchEligible`

Current behavior correctly uses `searchEligible=false` and `verdictEligible=false` for background claims during the current content evaluation. Preserve that.

But source/background claims may still be useful later when this content becomes a source for another claim. That future usefulness should be represented by a separate flag:

```text
sourceEligible=true
```

Do not make background claims `searchEligible=true` during the current content evaluation just to preserve future usefulness.

---

## 4. Current background behavior to preserve

The existing system already has a background lane. Preserve it.

Current behavior to keep:

```text
background role exists
background claims are ranked last
background claims are filtered out before bearing/evidence
background claims are searchEligible=false
background claims are verdictEligible=false
background claims show at bottom of workspace with BACKGROUND label
```

Do not remove this. Formalize it and connect it to the new TM reducer.

### Current risk

The current background lane is good, but the old extraction flow can still bloat the workspace because too many local chunk claims leak through as final claims.

The fix is not to delete background claims. The fix is to prevent chunk candidates from becoming persisted claims unless a document-level reducer selects them.

---

## 5. Full TM architecture

```text
PASS 0: Article text audit
PASS 1: Provisional article frame
PASS 2: Paragraph-aware chunking
PASS 3: Parallel chunk survey
PASS 4: Theme fusion
PASS 5: Candidate clustering
PASS 6A: Evaluation claim reducer <=12
PASS 6B: Source/background reducer <= configurable cap
PASS 7: Optional targeted repair pass
PASS 8: Persistence contract
PASS 9: Evidence engine only for selectedEvaluationClaims
```

---

## 6. Pass 0: Article text audit

This plan assumes article text is reasonably clean. If extraction falls back to full-page text, block expensive claim extraction in development.

### Required log

```json
{
  "event": "ARTICLE_TEXT_AUDIT",
  "contentId": 16994,
  "rawHtmlChars": 554382,
  "articleTextChars": 51111,
  "extractionMethod": "selector_or_readability",
  "dirtyFallback": false,
  "confidence": 0.87
}
```

### Rule

```text
If dirtyFallback=true in development, stop before claim extraction.
```

---

## 7. Pass 1: Provisional article frame

One cheap LLM call before the chunk survey.

### Input

```text
title
byline/date if available
first 4,000 characters
last 2,000 characters
headings if cheaply available
```

### Output schema

```json
{
  "provisionalThesis": "string",
  "provisionalStance": "endorses|rejects|mixed|unclear",
  "likelyPillars": ["string"],
  "likelyOpposingClaims": ["string"],
  "namedAnchors": [
    {
      "type": "person|organization|study|law|dataset|document|event",
      "name": "string"
    }
  ],
  "openQuestions": ["string"],
  "seedConfidence": 0.0
}
```

### Critical prompt instruction

```text
This is provisional. Do not exclude later candidates because they do not fit this frame. Later chunks may correct the frame.
```

---

## 8. Pass 2: Paragraph-aware chunking

Replace blunt fixed-size slicing with paragraph-aware chunks.

```text
Target chunk size: 4,500–6,000 chars
Overlap: 300–500 chars at paragraph boundaries
Never split inside a sentence if avoidable
Preserve startChar, endChar, chunkIndex, chunkCount, chunkPosition
```

### Chunk positions

```text
lead
early_body
middle_body
late_body
conclusion
```

---

## 9. Pass 3: Parallel chunk survey

Run all chunks in parallel with bounded concurrency.

The chunk survey returns **survey packets**, not persisted claims.

### Per-chunk output

```json
{
  "chunkIndex": 0,
  "chunkPosition": "lead",
  "chunkMiniTheme": "string",
  "relationshipToProvisionalFrame": "supports_seed|narrows_seed|expands_seed|contradicts_seed|introduces_new_pillar|mostly_background|unclear",
  "pillarHints": [
    {
      "pillarText": "string",
      "confidence": 0.0,
      "supportingExcerpt": "short exact excerpt"
    }
  ],
  "evaluationCandidateClaims": [
    {
      "claimText": "complete factual assertion",
      "roleHint": "thesis|pillar|evidence|opposing_claim|fallibility_critical|source_anchor|unclear",
      "importanceInChunk": 0.0,
      "importanceToArticleGuess": 0.0,
      "noveltyHint": "new|rephrased_repetition|elaboration|duplicate_possible",
      "rhetoricalFunction": "core_assertion|supporting_statistic|example|quote_attribution|study_reference|legal_reference|causal_bridge|attack_on_actor|context",
      "localSourceExcerpt": "1–3 short exact sentences",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedDatasets": [],
      "claimType": {}
    }
  ],
  "sourceBackgroundCandidates": [
    {
      "claimText": "complete factual assertion",
      "reasonUsefulAsSource": "named study|named law|named actor|date/statistic|contextual anchor|citation breadcrumb",
      "sourceUsefulness": "high|medium|low",
      "localSourceExcerpt": "1–3 short exact sentences",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedDatasets": [],
      "claimType": { "background": true }
    }
  ],
  "localRepetitionSignals": [
    {
      "phraseOrIdea": "string",
      "appearsToRepeatEarlierArticleTheme": true,
      "notes": "string"
    }
  ]
}
```

### Candidate caps

```text
evaluationCandidateClaims: 0–6 per chunk
sourceBackgroundCandidates: 0–2 per chunk by default
chunkMiniTheme: not counted as a candidate
pillarHints: not counted as candidates
named anchors: not counted as candidates
```

### Why background has its own small candidate bucket

If background candidates share the same 0–6 pool as evaluation candidates, they can crowd out the important article-level claims. If they are unlimited, they recreate bloat.

So use a separate bounded lane:

```text
0–6 evaluation candidates
0–2 source/background candidates
```

---

## 10. Pass 4: Theme fusion

Mini-themes vote on the final article frame.

### Input

```text
provisional frame
all chunkMiniThemes
all relationshipToProvisionalFrame values
all pillarHints
compact evaluation candidate summaries
compact background/source candidate summaries
named anchors across chunks
local repetition signals
```

### Output schema

```json
{
  "finalThesis": "string",
  "finalStance": "endorses|rejects|mixed|unclear",
  "themeShiftFromSeed": "none|narrowed|expanded|replaced|mixed|unclear",
  "finalPillars": [
    {
      "pillarText": "string",
      "supportingChunkIndexes": [0, 3, 4],
      "representativeCandidateIds": ["c3", "c12"],
      "coverageStrength": 0.0
    }
  ],
  "dominantNamedAnchors": [],
  "repeatedPersuasionPatterns": [
    {
      "repeatedIdea": "string",
      "variantCandidateIds": [],
      "notes": "string"
    }
  ],
  "coverageGaps": []
}
```

### Purpose

```text
The first theme is allowed to be wrong.
The final article frame comes from all chunks.
The final frame controls claim selection.
```

---

## 11. Pass 5: Candidate clustering

Cluster **evaluation candidates** and **source/background candidates** separately.

### Evaluation clustering keys

```text
normalized claim text
same subject/actor
same predicate/action
same object
same named study/document/law/dataset
same statistic/date/quantity
semantic similarity
local repetition markers
```

### Source/background clustering keys

```text
same named study/document/law/dataset
same actor/source attribution
same historical/contextual event
same statistic/date/quantity
same citation breadcrumb
```

### Repetition rule

Conspiracy/pseudoscience/repetitive persuasion articles often rephrase the same point to manufacture familiarity. Treat repetition as a signal of centrality, not as permission to preserve variants.

```text
Repeated variants → one boosted cluster → one canonical claim
```

---

## 12. Pass 6A: Evaluation reducer

Produces `selectedEvaluationClaims`.

### Hard cap

```text
selectedEvaluationClaims.length <= 12
```

### Target composition

```text
1 thesis claim
4–7 pillar claims
1–3 named study/document/law/dataset anchor claims if central
0–2 opposing/self-contradiction claims
0–2 critical context/fallibility claims
```

### Ranking dimensions

```text
article centrality
pillar coverage
verification worthiness
specificity
novelty vs repetition
named anchor strength
source excerpt quality
role diversity bonus
redundancy penalty
```

### Required output fields

For every selected evaluation claim:

```ts
selectedForEvaluation = true
evaluationEligible = true
verdictEligible = true
searchEligible = true
sourceEligible = true // usually yes, because eval claims can later be source claims too
visibility = "workspace_eval"
argumentFunction = "evaluation"
```

---

## 13. Pass 6B: Source/background reducer

Produces `selectedSourceBackgroundClaims`.

### Suggested cap

```text
selectedSourceBackgroundClaims.length <= 12 initially
```

Make this configurable:

```env
CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS=12
```

### Selection priority

Prefer background/source claims that are useful later as source material:

```text
named studies
named datasets
named laws/policies
named documents
named actors/organizations
clear attribution claims
specific dates/numbers
citation breadcrumbs
method/population/endpoints for scientific source articles
historical context that explains a source claim
```

Reject:

```text
generic filler
pure opinion
local color
biographical fluff unless source-relevant
repeated background variants
claims already selected in evaluation lane
```

### Required output fields

For every selected source/background claim:

```ts
role = "background" // or "source_anchor" plus argumentFunction="background"
argumentFunction = "background"
selectedForEvaluation = false
evaluationEligible = false
verdictEligible = false
searchEligible = false // for current content evaluation
sourceEligible = true // for future source use
sourceUsefulness = "high" | "medium" | "low"
visibility = "workspace_background" // or source_only if UI should hide it by default
```

### Critical rule

```text
Background/source claims are persisted, but they must not trigger evidence retrieval or affect this content’s verdict.
```

---

## 14. Pass 7: Optional targeted repair pass

Feature-gated.

```env
CLAIM_REPAIR_PASS=false
```

Trigger only if theme fusion returns coverage gaps.

```text
coverageGaps.length > 0
```

At most one repair call per article by default. Repair candidates go back through clustering/reducer. Repair cannot exceed the 12 evaluation-claim cap.

---

## 15. Pass 8: Persistence contract

Only two outputs may be persisted:

```text
selectedEvaluationClaims
selectedSourceBackgroundClaims
```

Never persist:

```text
chunk survey packets
raw evaluation candidates
raw background candidates
pillar hints
mini-themes
duplicate variants
omitted synthesis records
repair candidates before reduction
```

### Mandatory guards

```ts
if (selectedEvaluationClaims.length > 12) {
  throw new Error(`Evaluation reducer contract violated: ${selectedEvaluationClaims.length}`);
}

if (selectedSourceBackgroundClaims.length > backgroundMaxClaims) {
  throw new Error(`Background reducer contract violated: ${selectedSourceBackgroundClaims.length}`);
}

for (const claim of rawChunkCandidates) {
  if (claim.candidateOnly && claim.persisted) {
    throw new Error("candidateOnly record was persisted");
  }
}
```

### Synthesis omission means omission

Do not map over all deduped/local records after synthesis/reduction. That resurrects omitted duplicates.

Correct behavior:

```text
selected cluster IDs only → canonical claims only → persist only selected claims
```

---

## 16. Pass 9: Evidence engine

Only selected evaluation claims enter evidence.

```text
selectedEvaluationClaims
→ target mapping
→ evidence search
→ bearing/stance/scoring
→ content verdict
```

Background/source claims do not enter evidence for the current content.

```text
selectedSourceBackgroundClaims
→ persist only
→ no evidence now
→ available later as source/library claims
```

---

## 17. Logging requirements

```text
ARTICLE_TEXT_AUDIT
ARTICLE_FRAME_SEEDED
CHUNKS_BUILT
CHUNK_SURVEY_STARTED
CHUNK_SURVEY_COMPLETED
THEME_FUSION_COMPLETED
EVALUATION_CANDIDATES_CLUSTERED
BACKGROUND_CANDIDATES_CLUSTERED
EVALUATION_CLAIMS_SELECTED
BACKGROUND_CLAIMS_SELECTED
CLAIMS_PERSISTED
EVIDENCE_STARTED
```

### Example final selection log

```json
{
  "event": "CLAIMS_PERSISTED",
  "contentId": 16994,
  "source": "tm_v4_parallel_fusion",
  "chunkCount": 10,
  "rawEvaluationCandidateCount": 47,
  "rawBackgroundCandidateCount": 13,
  "evaluationClusterCount": 18,
  "backgroundClusterCount": 7,
  "selectedEvaluationCount": 12,
  "selectedBackgroundCount": 7,
  "evidenceEligibleCount": 12,
  "verdictEligibleCount": 12,
  "sourceEligibleCount": 19
}
```

---

## 18. Feature flags

```env
CLAIM_EXTRACTION_TM_V4=true
CLAIM_REPAIR_PASS=false
CLAIM_EXTRACTION_MAX_EVAL_CANDIDATES_PER_CHUNK=6
CLAIM_EXTRACTION_MAX_BACKGROUND_CANDIDATES_PER_CHUNK=2
CLAIM_EXTRACTION_FINAL_MAX_EVALUATION_CLAIMS=12
CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS=12
CLAIM_EXTRACTION_BLOCK_DIRTY_FALLBACK_DEV=true
CLAIM_EXTRACTION_LOG_RAW_CANDIDATES=false
```

---

## 19. Database/schema expectations

Before adding columns, inspect the existing schema.

Need to determine whether these already exist under different names:

```text
claim_role
claim_type
argumentFunction
searchEligible
verdictEligible
evaluationEligible
selectedForEvaluation
sourceEligible
visibility
sourceUsefulness
canonicalClusterId
localSourceExcerpt
sourceChunkIndexes
```

If some do not exist, either:

1. Add columns, or  
2. Store new metadata in an existing JSON metadata column, if that is already the pattern.

Do not invent a parallel persistence table unless the existing claim table cannot support the split.

---

## 20. UI expectations

Current workspace behavior can be preserved.

### Workspace evaluation claim list

Should show:

```text
selectedForEvaluation=true
```

or if the UI still shows background claims, then background claims must be visually separated and clearly marked:

```text
role=background
label=BACKGROUND
bottom/collapsed section
not evidence eligible
not verdict eligible
```

### Source/background lane

Background claims may be shown at the bottom as currently done, but should not be confused with claims driving the rating.

Recommended UI label:

```text
Background / source-useful claims
Not used in this content rating
```

---

## 21. Acceptance criteria

### Core extraction

```text
1. Long repetitive articles no longer persist dozens of evaluation claims.
2. Chunk candidates are visible in debug/logs but never persisted directly.
3. Mini-themes update the final article frame but are never claims.
4. Repetition creates clusters, not duplicate final claims.
5. Evidence engine only receives selectedEvaluationClaims <=12.
6. Background/source claims are preserved separately and capped.
7. Background/source claims never affect current verdict.
8. Background/source claims are available for future source use.
```

### Port Townsend-style article

Expected:

```text
~10 chunks for ~51k chars
<=60 raw evaluation candidates
<=20 raw background candidates by default
~15–25 evaluation clusters
<=12 selected evaluation claims
<=12 selected source/background claims
no evidence before selectedEvaluationClaims exist
```

Major evaluation pillars should include, when present:

```text
public health/vaccine authorities allegedly misled the public
CDC/William Thompson/MMR data manipulation allegation
alleged destruction/preservation of evidence
1986 vaccine liability/legal regime allegation
expanded vaccine schedule/chronic disease causal framing
SIDS/infant mortality causal framing
suppression/persecution/vaccine-choice legislation framing
```

Background/source lane should prefer:

```text
named people such as Aaron Siri or William Thompson when used as source anchors
named documents/books/laws/studies
specific datasets or regulatory records
contextual legal/history claims useful for future source matching
```

---

# 22. Claude/Codex prompt pack

Use these prompts stepwise. Do not ask Claude to rewrite the whole subsystem in one gulp.

---

## Prompt 1: Inspect current flow and background flags

```text
We are implementing VeriStrata TM Claim Extraction v4. Do not change code yet.

Inspect the current claim extraction, persistence, evidence selection, argument mapping, and workspace display code.

Answer with exact files/functions and line references where possible:

1. Where is article text chunked?
2. Where are chunks asked for local claims?
3. Where are minClaims and maxClaims set?
4. Where are local chunk claims accumulated?
5. Where does document synthesis run?
6. Where can synthesis omissions be overridden or ignored?
7. Where are claims returned to processTaskClaims?
8. Where are claims persisted?
9. Where is role/background assigned or normalized?
10. Where are background claims skipped from bearing/evidence?
11. Where are searchEligible and verdictEligible set false for background?
12. Where does the workspace sort or label background claims?
13. Does the claim schema already support selectedForEvaluation, evaluationEligible, sourceEligible, visibility, sourceUsefulness, canonicalClusterId, or equivalent fields?

Important suspected issue:
The current synthesis prompt may omit duplicate claims, but applyDocumentSynthesis may map over all deduped records and bring omitted records back with fallback metadata.

Return an implementation map only. Do not refactor yet.
```

---

## Prompt 2: Add/confirm two-lane claim metadata

```text
Add or confirm two-lane claim metadata for the new TM extraction flow.

Do not modify evidence retrieval yet.

We need two persisted lanes:

1. selectedEvaluationClaims
- selectedForEvaluation=true
- evaluationEligible=true
- verdictEligible=true
- searchEligible=true
- sourceEligible=true
- visibility="workspace_eval"
- argumentFunction="evaluation"

2. selectedSourceBackgroundClaims
- role="background" or source_anchor with argumentFunction="background"
- selectedForEvaluation=false
- evaluationEligible=false
- verdictEligible=false
- searchEligible=false for current content evaluation
- sourceEligible=true for future source use
- visibility="workspace_background" or "source_only"
- sourceUsefulness="high"|"medium"|"low"

Before adding columns, inspect existing schema/metadata patterns. Reuse existing fields where possible. If a JSON metadata column is already used for claim metadata, store new fields there rather than adding unnecessary columns.

Acceptance:
- Existing background behavior remains intact.
- Background claims are still skipped by evidence and verdict scoring.
- Future source-usefulness is represented separately from searchEligible.
```

---

## Prompt 3: Replace fixed slicing with paragraph-aware chunk metadata

```text
Implement paragraph-aware chunking for claim extraction.

Do not modify evidence retrieval, target mapping, scoring, or persistence.

Requirements:
1. Replace blunt fixed-size slicing with paragraph-aware chunks.
2. Target chunk size: 4,500–6,000 characters.
3. Add 300–500 character overlap only at paragraph boundaries.
4. Preserve metadata:
   - chunkIndex
   - chunkCount
   - startChar
   - endChar
   - chunkPosition: lead | early_body | middle_body | late_body | conclusion
   - tokenLength estimate
5. Add CHUNKS_BUILT logging.

Acceptance:
- Long articles produce a reasonable number of chunks.
- Sentence cuts are avoided when practical.
- Existing behavior can be toggled behind CLAIM_EXTRACTION_TM_V4.
```

---

## Prompt 4: Add provisional article frame pass

```text
Add a provisional article frame pass before the chunk survey.

Do not persist anything from this pass.
Do not run evidence.

Input:
- title if available
- byline/date if available
- first 4,000 chars of cleaned article text
- last 2,000 chars of cleaned article text
- headings if cheaply available

Output schema:
{
  provisionalThesis: string,
  provisionalStance: "endorses" | "rejects" | "mixed" | "unclear",
  likelyPillars: string[],
  likelyOpposingClaims: string[],
  namedAnchors: [{ type: string, name: string }],
  openQuestions: string[],
  seedConfidence: number
}

Prompt instruction:
This frame is provisional only. Later chunk mini-themes may expand, narrow, contradict, or replace it. Do not use it as a hard filter.

Add ARTICLE_FRAME_SEEDED logging.
```

---

## Prompt 5: Replace local claim extraction with parallel chunk survey packets

```text
Modify local chunk extraction so chunks return survey packets, not final claims.

Do not persist chunk candidates.
Do not run evidence.

Each chunk receives:
- articleTitle
- provisionalFrame
- chunkIndex
- chunkCount
- chunkPosition
- chunkText

Each chunk returns:
{
  chunkIndex,
  chunkPosition,
  chunkMiniTheme,
  relationshipToProvisionalFrame,
  pillarHints,
  evaluationCandidateClaims,
  sourceBackgroundCandidates,
  localRepetitionSignals
}

Rules:
- evaluationCandidateClaims: return 0–6.
- sourceBackgroundCandidates: return 0–2.
- Do not fill either quota.
- Mini-theme is metadata, not a claim.
- Pillar hints are metadata, not claims.
- If a claim appears locally repetitive, set noveltyHint to rephrased_repetition or duplicate_possible.
- Global redundancy is resolved later, not inside the parallel chunk call.
- Background/source candidates are for later source usefulness and should not be evidence-evaluated for this content.

If compatibility requires claimsDetailed temporarily, mark every local record candidateOnly=true and ensure processTaskClaims cannot persist it directly.

Add CHUNK_SURVEY_STARTED and CHUNK_SURVEY_COMPLETED logs.
```

---

## Prompt 6: Add theme fusion pass

```text
Add theme fusion after all chunk surveys complete.

Input:
- provisional article frame
- all chunkMiniThemes
- all relationshipToProvisionalFrame values
- all pillarHints
- compact evaluation candidate summaries
- compact source/background candidate summaries
- named anchors across chunks
- local repetition signals

Output:
{
  finalThesis,
  finalStance,
  themeShiftFromSeed,
  finalPillars,
  dominantNamedAnchors,
  repeatedPersuasionPatterns,
  coverageGaps
}

Purpose:
The provisional frame is allowed to be wrong. Mini-themes vote on the final article frame. The final frame controls canonical claim selection.

Do not persist claims here.
Do not run evidence.

Add THEME_FUSION_COMPLETED logging.
```

---

## Prompt 7: Cluster evaluation and background candidates separately

```text
Implement candidate clustering before final selection.

Cluster evaluation candidates separately from source/background candidates.

Evaluation cluster keys:
- normalized claim text
- same subject/actor
- same predicate/action
- same object
- same named study/document/law/dataset
- same statistic/date/quantity
- semantic similarity if available
- noveltyHint and localRepetitionSignals

Background/source cluster keys:
- same named study/document/law/dataset
- same actor/source attribution
- same historical/contextual event
- same statistic/date/quantity
- same citation breadcrumb

Important:
Repetition across chunks should boost one canonical representative, not preserve many variants.

Add logs:
- EVALUATION_CANDIDATES_CLUSTERED
- BACKGROUND_CANDIDATES_CLUSTERED
```

---

## Prompt 8: Implement two reducers

```text
Implement two document-level reducers.

Reducer A: selectedEvaluationClaims
- max length: 12
- selects thesis/pillars/evidence/opposing/critical claims used to evaluate this content
- output records must have selectedForEvaluation=true, evaluationEligible=true, verdictEligible=true, searchEligible=true, visibility="workspace_eval"

Reducer B: selectedSourceBackgroundClaims
- max length: configurable, default 12
- selects useful source/background claims, not central evaluation claims
- output records must have role="background" or argumentFunction="background", selectedForEvaluation=false, evaluationEligible=false, verdictEligible=false, searchEligible=false, sourceEligible=true

Source/background selection should prefer named studies, documents, laws, datasets, actors, dates, numbers, attribution claims, citation breadcrumbs, and other facts likely useful when this content is later used as a source.

Reject generic filler and background claims already represented in the evaluation lane.

Add logs:
- EVALUATION_CLAIMS_SELECTED
- BACKGROUND_CLAIMS_SELECTED
```

---

## Prompt 9: Fix persistence contract

```text
Fix processTaskClaims so only reducer outputs can be returned for persistence.

Allowed persisted outputs:
- selectedEvaluationClaims
- selectedSourceBackgroundClaims

Forbidden persisted outputs:
- raw chunk survey packets
- raw evaluation candidates
- raw background candidates
- mini-themes
- pillar hints
- duplicate variants
- omitted synthesis records
- repair candidates before reduction

Important bug to avoid:
If a candidate or cluster is omitted by synthesis/reduction, do not map over all local/deduped records and bring it back with fallback metadata.

Guards:
- selectedEvaluationClaims.length <= 12
- selectedSourceBackgroundClaims.length <= CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS
- no candidateOnly=true record is persisted

Add CLAIMS_PERSISTED logging with lane counts.
```

---

## Prompt 10: Gate evidence to evaluation lane only

```text
Ensure evidence retrieval, bearing gating, target mapping for verdict, and scoring run only on selectedEvaluationClaims.

Background/source claims must remain:
- searchEligible=false for current content evaluation
- verdictEligible=false
- skipped from bearing/evidence with reason background_claim or equivalent
- persisted for future source use via sourceEligible=true

Do not change the existing background skip behavior except to preserve/strengthen it.

Acceptance:
- Evidence engine receives <=12 claims.
- No background claim triggers evidence retrieval for the current content.
- Workspace can still show background claims at the bottom or in a collapsed background section.
```

---

## Prompt 11: Add optional repair pass, feature gated

```text
Add a feature-gated targeted repair pass.

Flag:
CLAIM_REPAIR_PASS=false by default

Trigger only if theme fusion returns coverageGaps.length > 0.

Input:
- final article frame
- one missing pillar
- top excerpts from chunks related to that pillar
- current selectedEvaluationClaims

Output either:
{ repairClaim: null, reason: string }

or:
{ repairClaim: {...}, reason: string }

Rules:
- At most one repair call per article by default.
- Repair claim goes back through clustering/reducer.
- Repair cannot increase selectedEvaluationClaims above 12.
- Do not run evidence inside repair.

Add REPAIR_PASS_COMPLETED logging.
```

---

## Prompt 12: Add tests and fixtures

```text
Add tests for TM Claim Extraction v4.

Use the Port Townsend article fixture if available, but do not hardcode its URL into production logic.

Test expectations:
- article text extraction is not dirty full-page fallback when a valid article body exists
- chunk count is reasonable for ~51k chars
- raw evaluation candidates <= chunkCount * 6
- raw background candidates <= chunkCount * 2 by default
- selectedEvaluationClaims <=12
- selectedSourceBackgroundClaims <= configured cap
- no chunk candidates are persisted
- no candidateOnly=true records are persisted
- evidence retrieval is not called before selectedEvaluationClaims exist
- evidence receives only selectedEvaluationClaims
- background claims are persisted with searchEligible=false, verdictEligible=false, sourceEligible=true
- workspace displays background claims separately or at bottom with BACKGROUND label
```

---

## 23. Migration path

### Phase A: Inspection and flags

```text
Add metadata/flags if needed.
Add feature flag CLAIM_EXTRACTION_TM_V4=false.
No behavior change yet.
```

### Phase B: New extraction path behind feature flag

```text
Implement TM pipeline side-by-side with legacy extraction.
Log outputs but do not persist until reducer contract is verified.
```

### Phase C: Persistence test mode

```text
Persist selectedEvaluationClaims and selectedSourceBackgroundClaims only.
Disable evidence temporarily if needed to verify claim counts.
```

### Phase D: Evidence enablement

```text
Enable evidence only for selectedEvaluationClaims.
Confirm background claims are skipped.
```

### Phase E: UI polish

```text
Ensure background claims are visually separated and not confused with rating claims.
```

---

## 24. Non-goals

Do not do these in this patch:

```text
Do not run evidence on N × candidate claims.
Do not redesign the evidence engine.
Do not redesign scoring.
Do not remove background claims.
Do not make background claims verdict eligible.
Do not make the provisional frame a hard filter.
Do not persist raw chunk candidates.
Do not use article-specific scraping hacks as part of claim extraction.
```

---

## 25. Final summary

```text
VeriStrata TM v4 turns claim extraction from a claim-confetti cannon into a two-lane article map:

Lane A: <=12 canonical evaluation claims that drive the content verdict.
Lane B: bounded source/background claims that preserve useful source intelligence without affecting the verdict.

Chunks run in parallel, but only as surveyors. The article-level reducer is the gatekeeper. Evidence starts after the gate, not before it.
```
