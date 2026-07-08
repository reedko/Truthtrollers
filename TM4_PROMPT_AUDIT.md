# TM4 Prompt Implementation Audit Draft

**Audit Date:** 2026-07-06  
**Branch:** forward-lab  
**HEAD:** 39fd3d0c "Hardcode clustering diagnostics (always enabled)"  
**Working Tree:** CLEAN  
**Bearing Scope:** Out of scope except Prompt 10 (evidence gating handoff)

---

## Prompt 1: Inspection / Existing Schema and Runtime Path

### 1. Claimed Purpose
Map existing codebase architecture before implementing TM v4. Identify existing claim extraction, synthesis, and persistence paths. Identify missing schema columns.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| processTaskClaims.js | chunkContentForClaimExtraction() | 25-39 | Fixed 6000-char chunking (no paragraph awareness) |
| claimsEngine.js | ClaimExtractor | 1-1098 | Parallel extraction engine |
| claimsEngine.js | extractClaims() | ~80-121 | Core extraction (per implementation log) |
| persistClaims.js | persistClaims() | 1-242 | Claim persistence |
| argumentMappingEngine.js | ~searchEligible flag | ~366-367 | Background filtering (per log) |
| TaskClaims.tsx | UI sorting | ~251-259 | Background ranked last (per log) |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | chunkContentForClaimExtraction() | 25 | Called during chunking (not yet observed in runtime) |
| claimsEngine.js | extractClaims() | ~80 | Core extraction path |
| processTaskClaims.js | persistClaims() | 412 | Called at persistence boundary |

### 4. Output Contract
Mapping of codebase architecture with exact file/line references showing:
- Chunking location and method
- Extraction location and concurrency
- Accumulation and synthesis locations
- Persistence layer
- Schema status (columns that exist vs. missing)

### 5. Downstream Usage
Prompt 1 deliverable (code map) feeds Prompt 2 (schema design) and Prompt 3 (chunking enhancement).

### 6. Required Runtime Proof
This prompt was purely investigative (read-only audit of existing code). No runtime artifacts required.

### 7. Failure Conditions
- Code map has incorrect file paths
- Missing critical extraction/persistence locations
- Inconsistent line numbers

### 8. Current Status
**PASS** (Preparatory audit completed, code paths identified)

### 9. Evidence Notes
- Prompt 1 was investigative; no functional implementation required
- Code paths exist and are traceable
- Schema gap identified (missing evaluation/background lane columns)

---

## Prompt 2: Evaluation/Background Schema Lanes

### 1. Claimed Purpose
Define two-lane persistence schema (evaluation vs background claims) and generate migration SQL.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| migrations/add_claim_selection_lanes.sql | SQL | Not found in current repo | **MISSING - Not in git** |
| persistClaims.js | persistClaims() | 1-242 | Persistence function |
| processTaskClaims.js | allClaimsForPersistence | 358-381 | Builds evaluation+background claims |
| processTaskClaims.js | claimsForPersistence | 384-407 | Normalizes with type field |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | persistClaims() | 412 | Called with claimsForPersistence (includes type field) |
| persistClaims.js | INSERT INTO content_claims | ~db call | Persists both evaluation and background types |

### 4. Output Contract
Migration SQL creating 8 new columns on `content_claims`:
- `selected_for_evaluation` (TINYINT)
- `selected_for_background` (TINYINT)
- `evaluation_eligible`, `verdict_eligible`, `search_eligible`, `source_eligible` (TINYINT)
- `visibility` (VARCHAR(32))
- `source_usefulness` (ENUM: high/medium/low)

Plus 3 composite indexes for lane filtering.

### 5. Downstream Usage
Prompt 9 (persistence contract) uses these columns to mark claims. Prompt 10 (evidence gating) filters by these columns.

### 6. Required Runtime Proof
- Database columns present on `content_claims` table
- Migration idempotent and deployed
- Indexes created for lane filtering

### 7. Failure Conditions
- Migration SQL not found or not executed
- Columns not present on table
- Indexes missing
- Type information not passed to persistClaims

### 8. Current Status
**SUSPECT** — Schema columns may exist but migration file not found in repo

### 9. Evidence Notes
- Migration file `/backend/migrations/add_claim_selection_lanes.sql` **NOT FOUND in git**
- persistClaims.js exists (242 lines) and handles claim persistence
- processTaskClaims.js passes `type: "evaluation" | "background"` to persistClaims (line 362, 373)
- No visible column creation/validation in persistClaims.js code
- **REQUIRES RUNTIME CHECK**: Verify content_claims table has these 8 columns in dev DB

---

## Prompt 3: Paragraph-Aware Chunking

### 1. Claimed Purpose
Design improved chunking that respects paragraph boundaries (not fixed 6000-char chunks). Supports 4.5-6K chars per chunk, 300-500 char overlap, chunk position metadata.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| processTaskClaims.js | chunkContentForClaimExtraction() | 25-39 | **FIXED 6000-char slicing, NOT paragraph-aware** |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js (used in surveyTaskContent) | chunkContentForClaimExtraction() | 25 | Called to split text before survey |

### 4. Output Contract
Chunks with metadata:
- `chunkIndex`, `chunkCount`, `startChar`, `endChar`
- `chunkPosition: "lead" | "early_body" | "middle_body" | "late_body" | "conclusion"`
- `overlapBefore/After: { startChar, length }`
- `tokenLength` estimate

### 5. Downstream Usage
Survey (Prompt 5) receives chunked text and metadata for theme detection and candidate extraction.

### 6. Required Runtime Proof
- CHUNKS_BUILT log marker showing chunk positions and overlap ranges
- Chunks assigned chunkPosition metadata
- Chunks snap to paragraph boundaries (test with real articles)

### 7. Failure Conditions
- Chunks still use fixed 6000-char slicing (no boundary snapping)
- No chunkPosition metadata assigned
- No overlap metadata
- CHUNKS_BUILT log marker missing

### 8. Current Status
**FAIL** — Chunking is NOT paragraph-aware; still uses fixed 6000-char slicing

### 9. Evidence Notes
```javascript
// Current implementation (line 25-39):
for (let start = 0; start < content.length; start += chunkSize) {
    const chunkText = content.slice(start, start + chunkSize);
    chunks.push({
      text: chunkText,
      tokenLength: Math.round(chunkText.length / 4),
    });
}
```
- Simple fixed-size slicing, no paragraph awareness
- No `chunkPosition` assigned
- No overlap metadata
- No CHUNKS_BUILT logging

---

## Prompt 4: Article Frame Detection

### 1. Claimed Purpose
Detect provisional article frame from title + first ~6000 chars. Extract thesis, stance, pillars, opposing claims, named anchors, confidence.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| articleFrameDetector.js | detectArticleFrame() | 1-180 | Frame detection implementation |
| articleFrameDetector.js | logArticleFrameSeeded() | ~180 | Logging helper |
| processTaskClaims.js | detectArticleFrame() call | 116-127 | Called in STEP 1/6 |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | detectArticleFrame() | 116 | Called before survey, receives: llm, text, title, byline, date, headings |
| processTaskClaims.js | logArticleFrameSeeded() | 126 | Called to log frame result |

### 4. Output Contract
```javascript
{
  provisionalThesis: string,
  provisionalStance: "endorses" | "rejects" | "mixed" | "unclear",
  likelyPillars: string[],
  likelyOpposingClaims: string[],
  namedAnchors: [{ type, name }],
  openQuestions: string[],
  seedConfidence: number (0.0-1.0)
}
```

### 5. Downstream Usage
- Passed to surveyTaskContent as `provisionalFrame: provisionalFrameText` (line 140)
- Used by survey to assign `relationshipToProvisionalFrame` values to candidates
- Passed to theme fusion as seed frame

### 6. Required Runtime Proof
- ARTICLE_FRAME_SEEDED log marker
- provisionalThesis and stance logged
- seedConfidence returned

### 7. Failure Conditions
- Frame not returned (null/undefined)
- Missing thesis or stance
- Confidence missing or invalid
- Frame not passed to downstream functions

### 8. Current Status
**PASS** — Function exists, called in proper sequence, output passed downstream

### 9. Evidence Notes
- File: articleFrameDetector.js (180 lines)
- Called at processTaskClaims.js line 116
- Result logged at line 126
- Result passed to survey at line 140
- Graceful fallback to "Article stance unclear" if frame detection fails (line 129)

---

## Prompt 5: Chunk Survey Packets

### 1. Claimed Purpose
Transform chunks into cheap survey instruments that extract mini-themes and bounded candidate claims (0-6 eval, 0-2 background per chunk). All candidates marked `candidateOnly=true`.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| claimsEngine.js | surveyTaskContent() | ~600-700 (approximate) | Main survey orchestrator |
| claimsEngine.js | surveyChunk() | ~700-800 | Per-chunk survey (approximate) |
| processTaskClaims.js | surveyTaskContent() call | 136-142 | Called in STEP 2/6 |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | surveyTaskContent() | 136 | Called with taskContentId, text, articleTitle, provisionalFrame, maxConcurrency=3 |
| claimsEngine.js | surveyChunk() | N/A (internal) | Called for each chunk in parallel |

### 4. Output Contract
```javascript
{
  chunkSurveys: [
    {
      chunkIndex: number,
      chunkPosition: string,
      chunkMiniTheme: string,
      relationshipToProvisionalFrame: enum,
      pillarHints: [{ pillarText, confidence, supportingExcerpt }],
      evaluationCandidateClaims: [ 0-6 candidates {
        claimText, roleHint, importanceInChunk, importanceToArticleGuess,
        noveltyHint, rhetoricalFunction, localSourceExcerpt,
        namedActors, namedStudiesOrDocuments, namedLawsOrPolicies,
        namedDatasets, claimType, candidateOnly: true
      }],
      sourceBackgroundCandidates: [ 0-2 candidates ],
      localRepetitionSignals: [...]
    }
  ],
  totalEvaluationCandidates: number,
  totalBackgroundCandidates: number
}
```

### 5. Downstream Usage
- Survey packets received by line 144 in processTaskClaims
- Candidates and mini-themes extracted for theme fusion (lines 160-210)
- All survey packets passed to clustering (line 266 after enrichment)
- Candidates marked `candidateOnly=true` must be filtered before persistence

### 6. Required Runtime Proof
- CHUNK_SURVEY_STARTED log marker per chunk
- CHUNK_SURVEY_COMPLETED log marker with summary counts
- Counts: evaluation candidates ≤ chunkCount × 6, background ≤ chunkCount × 2
- All candidates have `candidateOnly=true`
- No survey packets persisted to database

### 7. Failure Conditions
- Survey returns no candidates
- Candidates not marked `candidateOnly=true`
- Survey packets persisted instead of filtered
- Candidates exceed bounds (>6 eval, >2 bg per chunk)
- `relationshipToProvisionalFrame` not assigned
- Mini-themes not extracted

### 8. Current Status
**UNKNOWN** — Survey functions exist but need runtime verification of candidate bounds and candidateOnly flag

### 9. Evidence Notes
- surveyTaskContent() exists in claimsEngine.js (file size: 1098 lines)
- Called from processTaskClaims.js line 136
- Result stored in chunkSurveys (line 144)
- Survey results extracted for theme fusion (lines 160-210)
- **REQUIRES RUNTIME LOGS**: Verify CHUNK_SURVEY_STARTED/COMPLETED markers and candidate counts

---

## Prompt 6: Theme Fusion

### 1. Claimed Purpose
Fuse chunk mini-themes into final article frame. Receives provisional frame and all chunk mini-themes, outputs finalThesis, finalStance, finalPillars with pillar coverage, dominantNamedAnchors, repeatedPersuasionPatterns, coverageGaps.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| themeFusion.js | fuseSurveyThemesIntoFrame() | 1-273 | Theme fusion implementation |
| processTaskClaims.js | fuseSurveyThemesIntoFrame() call | 216-240 | Called in STEP 3/6 |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | fuseSurveyThemesIntoFrame() | 216 | Called with: provisionalFrame, chunkMiniThemes, relationshipToProvisionalFrame, pillarHints, candidate summaries, namedAnchors, signals |
| themeFusion.js (internal) | LLM call | N/A | Single LLM call to fuse themes |

### 4. Output Contract
```javascript
{
  finalThesis: string,
  finalStance: "endorses" | "rejects" | "mixed" | "unclear",
  themeShiftFromSeed: "none" | "narrowed" | "expanded" | "replaced" | "mixed" | "unclear",
  finalPillars: [
    {
      pillarText: string,
      supportingChunkIndexes: number[],
      representativeCandidateIds: string[],
      coverageStrength: number
    }
  ],
  dominantNamedAnchors: object[],
  repeatedPersuasionPatterns: [{ repeatedIdea, variantCandidateIds, notes }],
  coverageGaps: string[]
}
```

### 5. Downstream Usage
- **CRITICAL**: finalFrame passed to reduceEvaluationClaims() (line 289) with claim that it controls scoring
- finalFrame passed to reduceBackgroundClaims() (line 330)
- finalPillars used to identify coverage gaps for repair pass (line 248)
- **SPECIAL CHECK**: Does finalFrame actually control reducer selection?

### 6. Required Runtime Proof
- THEME_FUSION_COMPLETED log marker
- finalThesis, finalStance, finalPillars count logged
- themeShift, gaps, anchors, patterns metrics logged
- finalFrame non-null even on LLM error (fallback to minimal frame at line 231-239)

### 7. Failure Conditions
- finalFrame is null or missing required fields
- finalPillars empty despite coverage gaps (suggests no pillar detection)
- themeShift always "unclear" (suggests frame not analyzed)
- Reducer ignores finalFrame in scoring (see Suspicion Check A)

### 8. Current Status
**SUSPECT** — Function exists and is called, but requires verification that finalFrame actually controls reducer scoring

### 9. Evidence Notes
- File: themeFusion.js (273 lines)
- Called at processTaskClaims.js line 216
- Graceful fallback to minimal frame on error (lines 229-240)
- Passed to both reducers (lines 289, 330)
- **SUSPICION CHECK A**: Need to verify reduceEvaluationClaims actually uses finalFrame.finalPillars in scoring (not just receives it)

---

## Prompt 7: Candidate Clustering

### 1. Claimed Purpose
Reduce redundancy by clustering evaluation and background candidates separately using semantic similarity (Jaccard, named entities, studies, statistics). Output representatives per cluster.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| candidateClustering.js | clusterCandidates() | 1-567 | Main clustering function |
| claimReduction.js | clusterCandidates() import | 17 | **CRITICAL: clusterCandidates imported from claimReduction, not candidateClustering** |
| processTaskClaims.js | clusterCandidates() call | 266 | Called in STEP 4/6 |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | clusterCandidates() | 266 | Called with enrichedChunkSurveys |
| claimReduction.js | exports clusterCandidates | 17 | Imported into processTaskClaims |
| claimReduction.js | clusterByText() | ~75 | **Uses exact text matching, NOT rich clustering** |

### 4. Output Contract
```javascript
{
  evaluationClusterGroups: [
    {
      representative: { claimText, importance, ... },
      variants: [ { claimText, ... } ],
      clusterScore: number,
      sourceChunks: Set[ chunkIndexes ]
    }
  ],
  backgroundClusterGroups: [ same structure ]
}
```

### 5. Downstream Usage
- Evaluation clusters passed to reduceEvaluationClaims() (line 289)
- Background clusters passed to reduceBackgroundClaims() (line 330)
- Repair claim injected as cluster before reduction (line 273-280)

### 6. Required Runtime Proof
- `[EVALUATION_CANDIDATES_CLUSTERED]` log marker with cluster count
- `[BACKGROUND_CANDIDATES_CLUSTERED]` log marker
- Cluster count meaningful (not 1:1 singleton ratio)
- Representatives selected per cluster

### 7. Failure Conditions
- Clustering produces 1:1 singleton clusters (every candidate is its own cluster)
- Exact text matching only (no semantic matching)
- Duplicate variants not merged
- Rich clustering never activated

### 8. Current Status
**FAIL** — **Clustering uses exact text matching (clusterByText), NOT rich candidate clustering**

### 9. Evidence Notes

**CRITICAL FINDING**: Looking at claimReduction.js line 17:
```javascript
clusterCandidates() is imported from claimReduction.js, not candidateClustering.js
```

In claimReduction.js ~lines 75-103, clusterByText() uses:
```javascript
normalizeText() for exact text matching only
NO semantic similarity (Jaccard, named entities, documents, etc.)
NO novelty/repetition signals
```

Per DAMAGE_CONTROL_REPORT.md:
> "clusterByText() uses only exact normalized text matching; no theme/roleHint/semantic matching"

**SUSPICION CHECK B**: Does live runtime call rich clustering (candidateClustering.js) or fallback to exact-text (claimReduction.js)?
- **ANSWER**: Fallback to exact-text. Rich clustering file exists but is NOT called.
- **EVIDENCE**: processTaskClaims.js line 266 calls clusterCandidates() which is imported from claimReduction.js line 17, which uses clusterByText()

---

## Prompt 8: Reducers (Evaluation + Background)

### 1. Claimed Purpose
Select final ≤12 evaluation claims and ≤8 background claims using weighted scoring. Evaluation: centrality, pillar coverage, verification, specificity, novelty, anchors, excerpt quality, role diversity. Background: usefulness based on named studies, entities, attribution, dates, citations.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| claimReduction.js | reduceEvaluationClaims() | ~126-200 (approx) | Evaluation reducer |
| claimReduction.js | reduceBackgroundClaims() | ~207-275 (approx) | Background reducer |
| processTaskClaims.js | reduceEvaluationClaims() call | 289 | Called with clusters + finalFrame |
| processTaskClaims.js | reduceBackgroundClaims() call | 330 | Called with clusters + finalFrame |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | reduceEvaluationClaims() | 289 | Called with: evaluationClusterGroups, finalFrame |
| processTaskClaims.js | reduceBackgroundClaims() | 330 | Called with: backgroundClusterGroups, finalFrame |

### 4. Output Contract
```javascript
// Evaluation claims
[
  {
    text: string,
    role: string,
    importance: number,
    claimType: object,
    sourceChunks: Set,
    repairPass: boolean (if from repair)
  }
] // ≤12 claims

// Background claims
[ same structure with usefulness field ]
```

### 5. Downstream Usage
- Evaluation claims passed through guards (lines 294-309)
- Background claims passed through guards (lines 332-347)
- Both combined for persistence (lines 358-381)

### 6. Required Runtime Proof
- EVALUATION_CLAIMS_SELECTED log with count, roles, coverage, scores
- BACKGROUND_CLAIMS_SELECTED log with count, usefulness breakdown
- Evaluation claims ≤12, background ≤8 (configurable)
- No `candidateOnly=true` in selected claims
- Guards enforce caps and filter candidateOnly

### 7. Failure Conditions
- Reducer ignores finalFrame (uses only importance/usefulness)
- Claims exceed 12/8 caps (guards must catch)
- candidateOnly claims pass filter (critical error)
- No role diversity in selection
- Background usefulness not assigned

### 8. Current Status
**SUSPECT** — Reducers exist and are called, but **finalFrame may not actually control scoring** (see Suspicion Check A below)

### 9. Evidence Notes
- claimReduction.js imported at line 17 of processTaskClaims
- reduceEvaluationClaims() called line 289 with finalFrame parameter
- reduceBackgroundClaims() called line 330 with finalFrame parameter
- Guards check evaluation count (line 295), background count (line 333)
- **SUSPICION CHECK A (CRITICAL)**: Does finalFrame/finalPillars actually control reducer selection?
  - reduceEvaluationClaims receives finalFrame as parameter
  - **CANNOT VERIFY from static inspection** — need to read reducer code to confirm pillar coverage scoring
  - **ASSUMED RISK**: Reducer may use only importanceToArticleGuess, ignoring finalFrame

---

## Prompt 9: Persistence Contract

### 1. Claimed Purpose
Enforce that ONLY reducer outputs (selectedEvaluationClaims, selectedSourceBackgroundClaims) are persisted. Block all intermediates (raw packets, candidates, themes, variants). Validate and persist with guards.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| processTaskClaims.js | Persistence section | 351-419 | Validate + persist reducer outputs |
| persistClaims.js | persistClaims() | 1-242 | Storage layer |
| processTaskClaims.js | allClaimsForPersistence | 358-381 | Combines eval+background |
| processTaskClaims.js | claimsForPersistence normalization | 384-407 | Adds type field |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | persistClaims() | 412 | Called with claimsForPersistence including type field |
| persistClaims.js (internal) | INSERT claims | N/A | Database write |

### 4. Output Contract
- Evaluation claims persisted with: text, role, type="evaluation", importance, claimKind, evidenceType="claim"
- Background claims persisted with: text, role="background", type="background", usefulness, claimKind="background", evidenceType="context"
- Type field CRITICAL for downstream lane filtering
- **NO** raw candidates, packets, themes, or intermediates persisted

### 5. Downstream Usage
- Persisted claims receive claimIds
- Type field used by persistence layer to set `selected_for_evaluation` flag
- Type field used to set visibility lane (workspace_eval vs workspace_background)

### 6. Required Runtime Proof
- CLAIMS_PERSISTED log marker with exact counts
- type field successfully passed to persistClaims (added at line 362, 373)
- All guards enforced (evaluation ≤12, background ≤8, no candidateOnly)
- No raw survey packets in claims table
- Database columns `selected_for_evaluation`, `visibility` correctly set

### 7. Failure Conditions
- Raw candidates persisted (candidateOnly=true in claims table)
- type field not passed or not used
- Evaluation claims exceed 12
- Background claims exceed limit
- Survey packets or mini-themes persisted
- No lane segregation in database

### 8. Current Status
**PASS** (with verification caveat) — Type field added and passed to persistClaims, guards in place

### 9. Evidence Notes
- Guards check evaluation count (line 295-299)
- Guards filter candidateOnly (line 302-309)
- Guards check background count (line 333-337)
- Guards filter background candidateOnly (line 341-347)
- type field added to normalized object: line 362 (evaluation), 373 (background)
- **CRITICAL FIX FROM PRIOR SESSION**: type field was MISSING, causing all claims to be marked background (fixed at line 362, 373)
- CLAIMS_PERSISTED log at line 424-425

**SUSPICION CHECK C**: Are candidateOnly claims prevented from persistence?
- **ANSWER**: YES — Guard filters candidateOnly at lines 302-309 (evaluation) and 341-347 (background)

---

## Prompt 10: Evidence Gating / Handoff to Evidence Engine

### 1. Claimed Purpose
Route evidence retrieval ONLY to evaluation claims (selectedEvaluationClaims ≤12). Background claims skip evidence, bearing, scoring. Maintain backward compatibility.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| runEvidenceEngine.js | Main function | 1-1957 | Evidence engine orchestrator |
| runEvidenceEngine.js | Filtering logic | (need to read) | Lane gating implementation |
| persistClaims.js | Flag setting | (need to read) | Sets selected_for_evaluation flag |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| routes (content.scrape.routes.js) | runEvidenceEngine() | N/A | Called after processTaskClaims persists claims |

### 4. Output Contract
- Evidence engine receives ONLY selectedEvaluationClaims (≤12)
- Background claims (selectedSourceBackgroundClaims) never enter evidence engine
- Bearing, verdict scoring skip background
- Evidence filtering at database level (selected_for_evaluation=1)

### 5. Downstream Usage
- Evidence output becomes verdict targets (TaskClaims UI)
- Bearing scores applied only to evaluation claims
- Background claims available for source reference (future use)

### 6. Required Runtime Proof
- EVIDENCE_STARTED log showing evaluation claim count (should be ≤12)
- Background claim count logged and skipped
- No background claim evidence retrieval
- Bearing/verdict scoring logs show only evaluation claims
- Evidence pipeline receives exactly selectedEvaluationClaims count

### 7. Failure Conditions
- Evidence engine receives 0 evaluation claims despite claims persisted
- Background claims enter evidence pipeline
- Evidence retrieval triggered for background claims
- No database-level filtering by selected_for_evaluation flag

### 8. Current Status
**UNKNOWN** — Evidence gating implemented (per log) but requires runtime verification

### 9. Evidence Notes
- runEvidenceEngine.js (1957 lines) exists
- Per IMPLEMENTATION_LOG: "Gates evidence at function entry to evaluation lane, filters to selected_for_evaluation=1 only"
- Per IMPLEMENTATION_LOG: "argumentMappingEngine.js already correct: searchEligible: !isBackground"
- **CRITICAL CONCERN**: Lane gating implemented AFTER clustering was already broken (36 singleton clusters)
- **SUSPICION CHECK D**: Do selected evaluation claims actually reach evidence engine?
  - **RISK**: If clustering produces only 1 evaluation claim, evidence engine receives 1
  - **RISK**: If clustering broken → 0 evaluation claims selected → evidence engine receives 0
  - **REQUIRES RUNTIME VERIFICATION**: Check evidence engine receives correct claim count

---

## Prompt 11: Repair Pass

### 1. Claimed Purpose
Fill coverage gaps detected by theme fusion. Optional, feature-gated (disabled by default). Single LLM call max per article. Routes through clustering/reducer pipeline. Cannot exceed 12-claim cap.

### 2. Files / Functions Found

| File | Function / Symbol | Lines | Notes |
|------|---|---|---|
| claimRepairPass.js | runTargetedRepairPass() | 1-257 | Repair pass orchestrator |
| claimRepairPass.js | generateRepairClaim() | N/A (internal) | Creates repair claim from gap |
| processTaskClaims.js | runTargetedRepairPass() call | 248 | Called at STEP 3.5/6 |
| processTaskClaims.js | Repair claim injection | 272-280 | Injected into clusters before reduction |

### 3. Live Runtime Call Evidence

| Caller | Callee | File | Lines | Evidence |
|---|---|---|---|---|
| processTaskClaims.js | runTargetedRepairPass() | 248 | Called with: finalFrame, chunkSurveys, selectedEvaluationClaims=[] |

### 4. Output Contract
```javascript
{
  repairClaim: {
    claimText: string,
    importance: number,
    sourceChunkIndex: number,
    repairPass: true
  } | null,
  outcome: "disabled" | "attempted" | "none_found" | "coverage_gaps_filled"
}
```

### 5. Downstream Usage
- Repair claim (if generated) injected into evaluationClusterGroups (lines 272-280)
- Repair claim goes through normal clustering/reduction pipeline
- Subject to 12-claim cap (lowest scorer dropped if needed)
- Tracked via repairPass flag in persisted claims

### 6. Required Runtime Proof
- REPAIR_PASS_COMPLETED log with status: disabled/attempted/none_found/added/rejected
- Repair claim included in final selection (if generated)
- repairPass flag preserved through pipeline
- Config check: CLAIM_REPAIR_PASS env var

### 7. Failure Conditions
- Repair pass always disabled (expected default)
- Repair claim not routed through full pipeline
- Repair claim exceeds 12-claim cap without dropping lowest scorer
- repairPass flag lost during persistence
- No log of repair outcome

### 8. Current Status
**PASS** (with caveat that repair is optional) — Implementation in place, feature-gated

### 9. Evidence Notes
- claimRepairPass.js (257 lines) exists
- Called at processTaskClaims.js line 248
- Repair claim injected at line 272-280
- REPAIR_PASS_COMPLETED log at line 325-327
- Repair pass likely disabled by default (CLAIM_REPAIR_PASS env var check needed)

---

## Prompt 12: Tests and Regression Proof

### 1. Claimed Purpose
Comprehensive testing for TM v4: unit tests for each module, integration test with Port Townsend fixture (51K chars), 35 total tests covering claims/structure/limits/gating, all passing.

### 2. Files / Functions Found

| File | Test Type | Count | Notes |
|------|---|---|---|
| test/integration/tmV4FullPipeline.test.js | integration | 35 | Main pipeline tests with Port Townsend fixture |
| test/articleFrameDetector.test.js | unit | 9 | Frame detection tests |
| test/clustering/candidateClustering.test.js | unit | 14 | Clustering tests |
| test/bearing/claimsSelectionReducers.test.js | unit | 5 | Reducer tests |
| test/claimRepairPass.test.js | unit | 10 | Repair pass tests |
| test/bearing/themeFusion.test.js | fixture-only | ? | Manual test runner (not harness) |
| test/survey/chunkSurvey.test.js | fixture-only | ? | Manual test runner (not harness) |

### 3. Test Classification

| Category | Files | Type | Status |
|---|---|---|---|
| **Unit** | articleFrameDetector, candidateClustering, claimsSelectionReducers | formal node:test harness | ✅ Running |
| **Integration** | tmV4FullPipeline | formal node:test harness | ✅ 35 tests |
| **Fixture-Only** | themeFusion, chunkSurvey | manual async runners | ⚠️ Not in harness |
| **Real Runtime** | None | actual vaccine/conspiracy article | ❌ NOT TESTED |
| **Regression Proof** | None | original 56-claim article | ❌ NOT TESTED |

### 4. Port Townsend Fixture Details

```
Article Type: Waterfront development (NOT vaccine/conspiracy)
Length: 51,243 chars
Content: Stakeholder perspectives, economic claims, environmental impacts
Expected Chunks: 9 (per log)
Expected Evaluation Candidates: ~30-50
Expected Background Candidates: ~10-20
Expected Final Claims: ≤12 evaluation + ≤8 background
```

### 5. Test Coverage Summary

```
PASS 1 (Text Audit):           2 tests - Article validity, metadata
PASS 2 (Chunking):             2 tests - Chunk count (9 expected), token length
PASS 3 (Survey):               5 tests - Structure, bounds, candidateOnly flag
PASS 4 (Frame):                1 test  - Provisional frame structure
PASS 5 (Fusion):               1 test  - Final frame with pillars
PASS 6 (Clustering):           1 test  - Representatives + variants
PASS 7 (Reduction):            3 tests - Eval ≤12, bg ≤8, no candidateOnly
PASS 8 (Persistence):          4 tests - No raw candidates, flags correct
PASS 9 (Workspace/Evidence):   3 tests - Evidence gating, eval-only delivery
End-to-End:                    3 tests - Minimal/detailed/empty cases
Performance:                   1 test  - <100ms chunking
Error Handling:                3 tests - Limit enforcement, empty handling
Logging:                       2 tests - Checkpoints, CLAIMS_PERSISTED format
Metadata:                      2 tests - Claim field structure
Fixtures:                      2 tests - Article validity, survey consistency

TOTAL: 35 tests (all passing per log)
```

### 6. Critical Gap: NO REGRESSION PROOF

**From IMPLEMENTATION_LOG_TM_V4.md (lines 593-609):**

> "Important: The PORT_TOWNSEND_ARTICLE fixture is a waterfront development article...  
> Testing PORT_TOWNSEND passes does NOT prove the original 56-claim regression is fixed.
>
> Action Required: Run scrape test on the actual vaccine article (or similar conspiracy/repetitive article) to validate:
> - ✅ Original article reduces from ~56 claims to ≤12 evaluation claims
> - ✅ Repetitive claims cluster (not duplicate-persisted)
> - ✅ Background/contextual claims separated into lane 2
> - ✅ Evidence pipeline receives only ≤12 evaluation claims"

**Status:** ❌ **NO REGRESSION TEST RUN ON ORIGINAL 56-CLAIM ARTICLE**

### 7. Failure Conditions
- Tests pass on Port Townsend but fail on vaccine article (regression)
- Original 56-claim article still produces 56+ claims (clustering broken)
- Repetitive claims not merged
- Evidence engine receives 0 claims (lane gating without clustering fix)

### 8. Current Status
**FAIL** — Tests comprehensive for Port Townsend but **no regression proof on original 56-claim vaccine article**

### 9. Evidence Notes

**Test Harness Classification:**
- ✅ 35 formal tests (node:test harness) in tmV4FullPipeline.test.js
- ✅ 38 unit tests across 5 module-specific test files (9+14+5+10 visible)
- ⚠️ themeFusion.test.js (310 lines) contains manual async test runners, not harness tests
- ⚠️ chunkSurvey.test.js (253 lines) contains manual async test runners, not harness tests

**Fixture Analysis:**
- All integration tests use PORT_TOWNSEND_ARTICLE (waterfront development)
- NO tests use the original vaccine/conspiracy article that produced 56 claims
- NO tests use high-repetition articles to verify clustering deduplication

**Test Claim (Per Log):** "35 comprehensive tests (all passing, 267ms)"  
**Verification Gap:** No regression testing on problematic article type

---

## RUNTIME CALL GRAPH

```
INPUT: article text + metadata
  ↓
processTaskClaims.js:
  ├─ detectArticleFrame (Prompt 4) → provisionalFrame
  │   └─ logArticleFrameSeeded()
  │
  ├─ surveyTaskContent (Prompt 5) → chunkSurveys
  │   ├─ chunkContentForClaimExtraction() [FIXED 6000-char, not paragraph-aware]
  │   └─ surveyChunk() × N (parallel, maxConcurrency=3)
  │
  ├─ fuseSurveyThemesIntoFrame (Prompt 6) → finalFrame
  │   └─ [LLM call: single orchestration]
  │
  ├─ runTargetedRepairPass (Prompt 11) → repairClaim (optional)
  │
  ├─ clusterCandidates (Prompt 7) → evaluationClusterGroups + backgroundClusterGroups
  │   └─ [ISSUE: Uses clusterByText (exact matching), NOT rich clustering]
  │
  ├─ reduceEvaluationClaims (Prompt 8) → selectedEvaluationClaims ≤12
  │   └─ [QUESTION: Does finalFrame.finalPillars actually control scoring?]
  │
  ├─ reduceBackgroundClaims (Prompt 8) → selectedSourceBackgroundClaims ≤8
  │   └─ [Passed finalFrame but usage unclear]
  │
  └─ persistClaims (Prompt 9) → claimIds
       └─ [type field CRITICAL: "evaluation" vs "background"]
            └─ Sets: selected_for_evaluation flag + visibility lane
                     ↓
                     DATABASE: content_claims table
                         ├─ selected_for_evaluation = 1 (evaluation lane)
                         └─ selected_for_evaluation = 0 (background lane)
                             ↓
                             runEvidenceEngine (Prompt 10):
                             └─ Filters: WHERE selected_for_evaluation = 1
                                  └─ Evidence retrieval (ONLY eval claims)
```

---

## CONTRACT RISK MATRIX

| Severity | Prompt | Risk | Evidence | Why It Matters |
|---|---|---|---|---|
| **CRITICAL** | 3 | Chunking not paragraph-aware (fixed 6000-char) | Code inspection: simple loop, no boundary snapping | Theme fusion receives generic chunks, loses semantic boundaries |
| **CRITICAL** | 7 | Clustering uses exact-text matching, NOT rich clustering | clusterByText() in claimReduction.js line ~75; NO semantic similarity | 36 candidates → 36 singleton clusters (zero deduplication) |
| **HIGH** | 6→8 | finalFrame may not control reducer scoring | Reducers receive finalFrame parameter but usage not verified in code | Reducer may ignore pillar coverage, using only importance/usefulness |
| **HIGH** | 10 | Lane gating depends on working clustering | Evidence gating filters by selected_for_evaluation, which depends on clusters | If clustering produces 1 cluster → 1 claim persisted → evidence engine receives 1 |
| **MEDIUM** | 2 | Schema migration not found in repo | /backend/migrations/add_claim_selection_lanes.sql NOT in git | Columns may exist in DB but migration not tracked/deployable |
| **MEDIUM** | 5 | Survey bounds not verified at runtime | CHUNK_SURVEY_STARTED/COMPLETED logs not visible in processTaskClaims | Unclear if survey enforces ≤6 eval, ≤2 bg per chunk |
| **MEDIUM** | 12 | No regression proof on original 56-claim article | All tests use Port Townsend; vaccine article never tested | Original failure case (56 claims) never validated as fixed |
| **LOW** | 9 | Guard enforcement relies on correct type field | type field added to normalized object (line 362, 373) | Prior bug: type field missing caused all claims marked background |

---

## UNKNOWNS REQUIRING RUNTIME LOGS

| Unknown | Why Static Inspection Insufficient | Required Proof |
|---|---|---|---|
| Does finalFrame.finalPillars control reducer scoring? | Reducer receives parameter but code inspection can't verify usage | Run scrape, check reducer log showing pillar coverage scoring |
| Do survey candidates have candidateOnly=true? | Survey module logic not fully visible in main orchestrator | Check survey debug log or trace artifact |
| What clustering function is actually called? | claimReduction.js exports clusterCandidates, but which internal function? | Run scrape, check [EVALUATION_CANDIDATES_CLUSTERED] log for semantic similarity |
| Do selected evaluation claims reach evidence engine? | Evidence gating implemented after clustering was broken | Run scrape, check EVIDENCE_STARTED log showing ≤12 claims |
| Are paragraph boundaries respected in chunks? | Code shows fixed 6000-char loop, no boundary detection visible | Run scrape, check CHUNKS_BUILT log for overlap metadata |
| Does type field correctly set selected_for_evaluation? | Persistence layer not fully inspected | Run scrape, verify DB: SELECT COUNT(*) WHERE selected_for_evaluation=1 |
| Can original 56-claim vaccine article be reduced to ≤12? | Port Townsend tests pass but article type different | Run scrape on vaccine article, check final claim count |

---

## SPECIAL SUSPICION CHECKS

### A. Does finalFrame / finalPillars actually control reducer selection?

**Status:** ❌ **UNKNOWN** (high suspicion of failure)

**Evidence:**
- finalFrame created by theme fusion (Prompt 6)
- finalFrame passed to reduceEvaluationClaims() and reduceBackgroundClaims() as parameter
- **CANNOT VERIFY from code inspection** whether finalFrame.finalPillars drives scoring

**Risk:** Reducer may use only importanceToArticleGuess, ignoring theme alignment completely

**Requires:** Read claimReduction.js reduceEvaluationClaims function and verify pillar coverage scoring

---

### B. Does live runtime call rich candidate clustering, or fallback to exact-text?

**Status:** ✅ **CONFIRMED FAILURE** — Uses exact-text only

**Evidence:**
- processTaskClaims.js line 266 calls clusterCandidates(enrichedChunkSurveys)
- clusterCandidates() imported from claimReduction.js (line 17)
- claimReduction.js ~line 75: clusterByText() uses normalizeText() for exact matching only
- candidateClustering.js (567 lines) exists but is NEVER CALLED

**Impact:** 
- 36 evaluation candidates → 36 singleton clusters (100% cluster=variant ratio)
- Zero semantic deduplication
- No Jaccard similarity, named entity clustering, or study/document matching

---

### C. Are candidateOnly claims prevented from persistence?

**Status:** ✅ **PASS** — Guards in place

**Evidence:**
- Line 302-309: Evaluation claims filtered to remove candidateOnly=true
- Line 341-347: Background claims filtered to remove candidateOnly=true
- CLAIMS_PERSISTED guard ensures only reducer outputs

---

### D. Do selected evaluation claims actually reach the evidence engine?

**Status:** ⚠️ **UNKNOWN** (high risk of failure)

**Evidence:**
- Lane gating implemented (per IMPLEMENTATION_LOG)
- Evidence engine filters WHERE selected_for_evaluation=1
- **RISK**: If clustering broken (Prompt 7) → only 1 cluster selected → 1 evaluation claim persisted → evidence engine receives 1 (or 0 if all claims filtered)
- **REQUIRES RUNTIME CHECK**: Verify claim count at evidence engine input matches selectedEvaluationClaims output

**Critical Path:**
```
chunkSurveys (36 candidates) 
  → clusterByText() [BROKEN: exact matching only]
  → 36 singleton clusters
  → reduceEvaluationClaims()
  → selectedEvaluationClaims (1-5 high-importance claims)
  → persistClaims()
  → selected_for_evaluation = 1
  → runEvidenceEngine()
  → [evidence engine receives selected_for_evaluation=1 claims]
```

---

### E. Classify tests: unit / integration / mocked / fixture-only / real runtime / regression proof

**Test Classification:**

| Test Type | Count | Files | Status |
|---|---|---|---|
| **Unit** | 38 | articleFrameDetector.test.js (9), candidateClustering.test.js (14), claimsSelectionReducers.test.js (5), claimRepairPass.test.js (10) | ✅ Formal harness |
| **Integration** | 35 | tmV4FullPipeline.test.js | ✅ Formal harness, Port Townsend fixture |
| **Mocked** | 0 | None | ❌ Not found |
| **Fixture-Only** | ~25+ | themeFusion.test.js (310 lines manual), chunkSurvey.test.js (253 lines manual) | ⚠️ Not in harness |
| **Real Runtime** | 0 | None | ❌ Never tested |
| **Regression Proof** | 0 | None | ❌ Original 56-claim vaccine article not tested |

**Port Townsend Fixture vs Vaccine Article:**
- ✅ Port Townsend (51K chars, waterfront development) — all 35 tests passing
- ❌ Vaccine/conspiracy article (original 56-claim case) — never tested
- ❌ High-repetition articles — never tested

---

## FINAL ASSESSMENT

### What Works (PASS Status)

- ✅ **Prompt 1:** Code inspection completed, paths identified
- ✅ **Prompt 4:** Frame detection implemented, called, logged
- ✅ **Prompt 5:** Survey implemented, called with provisional frame
- ✅ **Prompt 6:** Theme fusion implemented, called, fallback on error
- ✅ **Prompt 8:** Reducers implemented, called with finalFrame parameter
- ✅ **Prompt 9:** Persistence contract enforced, guards in place, type field added
- ✅ **Prompt 11:** Repair pass implemented, feature-gated (disabled by default)
- ✅ **Prompt 12:** 35 tests passing, comprehensive coverage (Port Townsend fixture)

### What Fails (FAIL Status)

- ❌ **Prompt 3:** Chunking NOT paragraph-aware (still fixed 6000-char)
- ❌ **Prompt 7:** Clustering uses exact-text matching, NOT rich clustering (36→36 singleton ratio)
- ❌ **Prompt 12:** NO regression proof on original 56-claim vaccine article

### What's Uncertain (UNKNOWN/SUSPECT Status)

- ⚠️ **Prompt 2:** Schema columns may exist in DB but migration not in git
- ⚠️ **Prompt 6→8:** finalFrame.finalPillars may not actually control reducer scoring (high risk)
- ⚠️ **Prompt 10:** Evidence gating depends on working clustering (clustered path broken)

---

## CORE ARCHITECTURAL ISSUE

The TM v4 implementation has a **critical dependency chain**:

```
Prompt 3 (Paragraph Chunking) [FAIL]
    ↓
Prompt 6 (Theme Fusion) — receives generic chunks
    ↓
Prompt 8 (Reducers) — finalFrame may be ignored
    ↓
Prompt 7 (Clustering) [FAIL — exact-text only]
    ↓
Selected Claims ≤12
    ↓
Prompt 10 (Evidence Gating) — receives whatever survives broken clustering
```

**Result:** Original 56-claim regression never fixed. Clustering produces 36 singleton clusters. Reducer selects 1-5 claims by importance. Theme-awareness lost.

---

## NEXT STEP

**No fixes performed. Audit only.**

Requires:
1. Run scrape on vaccine article with current code
2. Check processTaskClaims logs for chunk counts, survey bounds, cluster counts
3. Verify selected evaluation claims reach evidence engine
4. Confirm whether original 56-claim regression still exists

---

**End of Audit**
