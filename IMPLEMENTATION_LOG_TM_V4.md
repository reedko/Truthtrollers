# VeriStrata TM v4 Claim Extraction Implementation Log

**Date:** 2026-07-05  
**Status:** Prompts 1-9 Complete ✅  
**Remaining:** Prompts 10-12 (Evidence gating, optional repair, tests)

---

## PHASE 1: INSPECTION & DESIGN (Prompts 1-3)

### Prompt 1: Current Flow Inspection ✅

**Purpose:** Map existing codebase architecture for TM v4 implementation

**Key Findings:**
- **Chunking:** `processTaskClaims.js:12-26` — fixed-size slicing (6000 chars)
- **Extraction:** `claimsEngine.js:82-121` — parallel chunk processing
- **Accumulation:** `analyzeContent()` line 767 — collects all chunk claims
- **Synthesis:** `synthesizeCaseClaims()` line 792 — dedupes + consolidates
- **Persistence:** `persistClaims.js` — stores to `claims` + `content_claims` tables
- **Background filtering:** `argumentMappingEngine.js:366-367` — `searchEligible: !isBackground`
- **UI sorting:** `TaskClaims.tsx:251-259` — background ranked last (priority 5)

**Schema Status:**
- ✅ Existing: `claim_role`, `argument_function`, `accountability_eligible`, `parent_claim_id`, `claim_depth`, `centrality_score`, `verifiability_score`
- ❌ Missing: `selectedForEvaluation`, `evaluationEligible`, `sourceEligible`, `visibility`, `sourceUsefulness`, `canonicalClusterId`

**Output:** Implementation map with exact file/line references for all claim pipeline stages

---

### Prompt 2: Schema Analysis & Migration ✅

**Purpose:** Define two-lane claim persistence schema and generate migration

**Key Findings:**

**Lane A (Evaluation Claims):**
- `selected_for_evaluation` (TINYINT(1)) — selector
- `evaluation_eligible` (TINYINT(1)) — eligibility flag
- `verdict_eligible` (TINYINT(1)) — verdict judgment eligible
- `search_eligible` (TINYINT(1)) — current evaluation search
- `source_eligible` (TINYINT(1)) — future source use
- `visibility` (VARCHAR(32)) — `"workspace_eval"`
- `argumentFunction = "evaluation"`

**Lane B (Background Claims):**
- `selected_for_background` (TINYINT(1)) — selector
- `source_usefulness` (ENUM: high/medium/low) — usefulness rating
- `claim_role = "background"`
- `argumentFunction = "background"`
- `searchEligible = 0` (current evaluation)
- `sourceEligible = 1` (future source use)

**Migration:** Idempotent SQL using `information_schema` checks
- 8 new columns added to `content_claims`
- 3 composite indexes: `idx_evaluation_lane`, `idx_background_lane`, `idx_visibility`
- Deployed to dev database ✅

**Output:** `backend/migrations/add_claim_selection_lanes.sql` (257 lines, fully idempotent)

---

### Prompt 3: Paragraph-Aware Chunking Design ✅

**Purpose:** Design improved chunking that respects paragraph boundaries

**Design Blueprint:**
- **Target size:** 4,500–6,000 chars (vs. fixed 6000)
- **Overlap:** 300–500 chars at paragraph boundaries only (respects `\n\n` breaks)
- **Boundary detection:** Split by `\n\n`, never mid-sentence
- **Metadata per chunk:**
  - `chunkIndex, chunkCount, startChar, endChar`
  - `chunkPosition: "lead" | "early_body" | "middle_body" | "late_body" | "conclusion"`
  - `overlapBefore/After: { startChar, length }`
  - `tokenLength` estimate

**Algorithm:**
1. Detect paragraph boundaries via regex `/\n\n+/`
2. Build chunks snapping to nearest boundary within targetSize
3. Add overlap at paragraph boundaries (300–500 chars, max within paragraph)
4. Assign chunkPosition based on percentile of total text
5. Calculate all metadata

**Position Assignment:**
- **lead:** 0–20% of text (title, lede)
- **early_body:** 20–40% (key claims)
- **middle_body:** 40–75% (supporting details)
- **late_body:** 75–90% (concluding evidence)
- **conclusion:** 90–100% (closing arguments)

**CHUNKS_BUILT Logging:**
```
📦 [CHUNKS_BUILT] Built 4 paragraph-aware chunks from 18,450 chars
   Chunk 0/4: 5,820 chars (lead, overlap: 0→450) [0–5820]
   Chunk 1/4: 5,950 chars (early_body, overlap: 450→480) [5370–11320]
   ...
```

**Output:** Complete design document with algorithm pseudocode, edge cases, logging spec, test updates

---

## PHASE 2: EXTRACTION PIPELINE (Prompts 4-6)

### Prompt 4: Provisional Article Frame Detection ✅

**Purpose:** Extract weak initial frame from title/first/last sections before chunk survey

**Implementation:** `/backend/src/core/articleFrameDetector.js`

**Function:** `detectArticleFrame(text, metadata)`

**Input:**
- Title, byline, date (optional metadata)
- First 4,000 chars + last 2,000 chars of cleaned article text
- Headings if available

**Output Schema:**
```javascript
{
  provisionalThesis: string,
  provisionalStance: "endorses" | "rejects" | "mixed" | "unclear",
  likelyPillars: string[],
  likelyOpposingClaims: string[],
  namedAnchors: [{ type: string, name: string }],
  openQuestions: string[],
  seedConfidence: number (0.0–1.0)
}
```

**Execution:** Single LLM call (temperature=0.3) before chunking

**Logging:** `ARTICLE_FRAME_SEEDED` with thesis, stance, pillar count, confidence

**Key Design Points:**
- Frame is **advisory only** — later chunks can expand/contradict/replace it
- **Zero database persistence** — used only for chunk surveys
- **Non-binding** — mini-themes vote on final frame
- Error handling with graceful degradation

**Tests:** 9 unit tests, all passing ✅  
**Documentation:** 3 integration guides + quick reference

---

### Prompt 5: Parallel Chunk Survey Packets ✅

**Purpose:** Transform chunks from claim extractors to cheap survey instruments

**Implementation:**
- Modified `claimsEngine.js` — added `surveyChunk()` and `surveyContent()` methods
- New `processTaskClaims.js` export — `surveyTaskContent()`

**Function:** `surveyChunk(text, chunkIndex, chunkCount, chunkPosition, provisionalFrame, articleTitle)`

**Returns Survey Packet:**
```javascript
{
  chunkIndex: number,
  chunkPosition: string,
  chunkMiniTheme: string,  // Metadata (not a claim)
  relationshipToProvisionalFrame: "supports_seed" | "narrows_seed" | "expands_seed" | "contradicts_seed" | "introduces_new_pillar" | "mostly_background" | "unclear",
  pillarHints: [{ pillarText, confidence, supportingExcerpt }],  // Metadata (not claims)
  evaluationCandidateClaims: [  // 0–6 candidates (bounded)
    {
      claimText: string,
      roleHint: "thesis" | "pillar" | "evidence" | "opposing_claim" | "fallibility_critical" | "source_anchor" | "unclear",
      importanceInChunk: number,
      importanceToArticleGuess: number,
      noveltyHint: "new" | "rephrased_repetition" | "elaboration" | "duplicate_possible",
      rhetoricalFunction: string,
      localSourceExcerpt: string,
      namedActors: string[],
      namedStudiesOrDocuments: string[],
      namedLawsOrPolicies: string[],
      namedDatasets: string[],
      claimType: object
    }
  ],
  sourceBackgroundCandidates: [  // 0–2 candidates (separate bounded lane)
    { claimText, reasonUsefulAsSource, sourceUsefulness, localSourceExcerpt, ... }
  ],
  localRepetitionSignals: [{ phraseOrIdea, appearsToRepeatEarlierArticleTheme, notes }]
}
```

**Key Guarantees:**
- ✅ No database persistence
- ✅ No evidence retrieval
- ✅ All candidates marked `candidateOnly=true`
- ✅ Parallel processing with bounded concurrency
- ✅ Mini-themes and pillar hints are metadata (not persisted)

**Logging:**
- `CHUNK_SURVEY_STARTED` — chunk index
- `CHUNK_SURVEY_COMPLETED` — survey packet counts

**Tests:** Unit test suite with realistic survey outputs  
**Output:** `IMPLEMENTATION_SUMMARY.md` with API docs

---

### Prompt 6: Theme Fusion Pass ✅

**Purpose:** Fuse chunk mini-themes into a final article frame

**Implementation:** `/backend/src/core/themeFusion.js` (231 lines)

**Function:** `fuseSurveyThemesIntoFrame(provisionalFrame, surveyResults, promptManager)`

**Input:**
- Provisional frame (from Prompt 4)
- All survey packets (from Prompt 5)
- All chunk mini-themes
- All relationshipToProvisionalFrame values
- Pillar hints, candidate summaries, named anchors, repetition signals

**Output Schema:**
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
  coverageGaps: string[]  // Used by optional repair pass (Prompt 11)
}
```

**Execution:**
- Single LLM call per article (no multi-step fragmentation)
- Receives ALL chunk mini-themes and relationships
- Final frame "votes" on article's actual argument

**Logging:** `THEME_FUSION_COMPLETED` with metrics:
```
THEME_FUSION_COMPLETED | pillars=3 | themeShift=expanded | gaps=2 | anchors=5 | patterns=2
```

**Key Design Points:**
- Provisional frame is **allowed to be wrong** — mini-themes override it
- Final frame **controls canonical claim selection** in Prompt 8
- Coverage gaps feed optional repair pass (Prompt 11)
- Single orchestrated LLM call (not fragmented)

**Tests:** 3 comprehensive test scenarios covering normal, minimal, and edge cases  
**Documentation:** 9 guides (INDEX, EXECUTIVE_SUMMARY, README, ARCHITECTURE, INTEGRATION, EXAMPLES, QUICK_REF, SUMMARY, TESTS)

---

## PHASE 3: CLAIM SELECTION (Prompts 7-9)

### Prompt 7: Candidate Clustering ✅

**Purpose:** Reduce redundancy before reducer selection

**Implementation:** `/backend/src/core/candidateClustering.js` (509 lines)

**Functions:**

**`clusterEvaluationCandidates(candidates)`**
- Clusters factual claims using:
  - Text similarity (Jaccard ≥0.65)
  - Same subject/actor (named entities)
  - Same study/document/law/dataset
  - Same statistic/date/quantity
  - Novelty and repetition signals
- Single-linkage union-find algorithm (O(n²))

**`clusterBackgroundCandidates(candidates)`**
- Separate lane for contextual facts:
  - Same study/document/law/dataset
  - Same actor/source attribution
  - Same statistics/dates
  - Same citation breadcrumbs

**`clusterCandidatesFromSurvey(surveyResults)`**
- Processes all survey packets
- Returns clustered evaluation + background separately

**Representative Selection Scoring:**
```
score = importanceInChunk*10 + importanceToArticleGuess*5
      + (novelty=="novel" ? +5 : -10 if repeated)
      - (hasRepetitionSignals ? 3 : 0)
```
- Prioritizes novel insights
- Penalizes repetitive claims

**Logging:**
- `[EVALUATION_CANDIDATES_CLUSTERED]` — count, clusters, representatives
- `[BACKGROUND_CANDIDATES_CLUSTERED]` — same metrics
- `[EVALUATION_CLUSTERS_SAMPLE]` / `[BACKGROUND_CLUSTERS_SAMPLE]` — details

**Tests:** 14 comprehensive tests covering:
- Text similarity clustering
- Named entity clustering
- Study/document clustering
- Representative selection
- Empty candidate handling
- Chunk metadata preservation
- Reduction ratio calculation
- **All 14 tests passing** ✅

**Documentation:** Complete guide with architecture, cluster keys, usage patterns, algorithm explanation

---

### Prompt 8: Two Document-Level Reducers ✅

**Purpose:** Select final ≤12 evaluation and ≤12 background claims

**Implementation:** `/backend/src/core/claimsSelectionReducers.js` (24 KB)

**Reducer A: `reduceEvaluationClaims(clusteredCandidates, finalFrame, config)`**

**Max:** 12 claims  
**Scoring:** 9 weighted dimensions:
- Article centrality: 20%
- Pillar coverage: 18%
- Verification worthiness: 15%
- Specificity: 14%
- Novelty vs repetition: 12%
- Named anchor strength: 10%
- Source excerpt quality: 6%
- Role diversity bonus: 4%
- Redundancy penalty: (penalty applied)

**Output Flags:**
```
selectedForEvaluation = true
evaluationEligible = true
verdictEligible = true
searchEligible = true
sourceEligible = true
visibility = "workspace_eval"
argumentFunction = "evaluation"
```

**Reducer B: `reduceBackgroundClaims(clusteredCandidates, config)`**

**Max:** 12 (configurable via `CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS`)  
**Scoring:** Usefulness-based:
- Named studies: +0.4
- Named entities: +0.3
- Attribution claims: +0.2
- Dates/numbers: +0.15
- Citation breadcrumbs: +0.15
- Source excerpt quality: +0.1
- Generic filler penalty: -0.5

**Rejection Criteria:**
- Generic filler
- Already in evaluation lane
- Pure opinion

**Output Flags:**
```
selectedForEvaluation = false
evaluationEligible = false
verdictEligible = false
searchEligible = false
sourceEligible = true
visibility = "workspace_background"
sourceUsefulness = "high" | "medium" | "low"
argumentFunction = "background"
```

**Logging:**
- `EVALUATION_CLAIMS_SELECTED` — count, role distribution, pillar coverage, score range
- `BACKGROUND_CLAIMS_SELECTED` — count, usefulness breakdown, score range

**Tests:** 5 comprehensive tests (597ms, all passing) covering:
- Diverse role selection
- Usefulness ranking
- Combined reduction
- Empty candidate handling
- Ineligible filtering

**Documentation:**
- Technical deep-dive (11 KB) — ranking dimensions, I/O formats, implementation details
- Quick-start guide (7.9 KB) — integration examples, score interpretation, debugging

---

### Prompt 9: Persistence Contract Enforcement ✅

**Purpose:** Ensure ONLY reducer outputs are persisted, block all intermediates

**Implementation:**

**New:** `/backend/src/core/claimReduction.js` (272 lines)
- Constants: `CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS = 12`, `CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS = 8`
- `clusterCandidates()` — groups by semantic similarity
- `reduceEvaluationClaims()` — top 12, skips candidateOnly=true
- `reduceBackgroundClaims()` — top 8, skips candidateOnly=true

**Modified:** `/backend/src/core/processTaskClaims.js` (488 lines, rewritten)

**New 6-Step TM Flow:**
1. **Survey** → `surveyTaskContent()` (Prompt 5)
2. **Frame** → `detectArticleFrame()` (Prompt 4)
3. **Fuse** → `fuseSurveyThemesIntoFrame()` (Prompt 6)
4. **Cluster** → `clusterCandidatesFromSurvey()` (Prompt 7)
5. **Reduce** → `reduceEvaluationClaims()` + `reduceBackgroundClaims()` (Prompt 8)
6. **Persist** → Only selectedEvaluationClaims + selectedSourceBackgroundClaims

**Forbidden Outputs (Blocked):**
- Raw chunk survey packets
- Raw evaluation candidates
- Raw background candidates
- Mini-themes
- Pillar hints
- Duplicate variants
- Omitted synthesis records
- Repair candidates before reduction

**Guards:**
```javascript
if (selectedEvaluationClaims.length > 12) {
  throw new Error(`Evaluation reducer contract violated: ${selectedEvaluationClaims.length}`);
}
if (selectedSourceBackgroundClaims.length > backgroundMaxClaims) {
  throw new Error(`Background reducer contract violated: ${selectedSourceBackgroundClaims.length}`);
}
// No candidateOnly=true records persisted
for (const claim of selectedEvaluationClaims) {
  if (claim.candidateOnly) throw new Error("candidateOnly record was persisted");
}
```

**Logging:** `CLAIMS_PERSISTED`
```
CLAIMS_PERSISTED | evaluationLaneCount=12 | backgroundLaneCount=8 | totalPersisted=20
```

**Backward Compatibility:** ✅
- Function signature unchanged
- Return type unchanged
- Behavior is isolated behind new logic

---

## PHASE 4: REMAINING WORK (Prompts 10-12)

### Prompt 10: Evidence Gating (Pending)

**Purpose:** Route evidence retrieval ONLY to evaluation lane

**Expected Changes:**
- Modify `runEvidenceEngine()` to filter on `selectedForEvaluation=true`
- Keep background claims `searchEligible=false`
- Ensure bearing/scoring skips background
- Workspace still displays background (marked, at bottom)

### Prompt 11: Optional Repair Pass (Pending)

**Purpose:** Fill coverage gaps if theme fusion reports them

**Expected Changes:**
- Feature-gated: `CLAIM_REPAIR_PASS=false` (default off)
- Trigger if `coverageGaps.length > 0`
- Single LLM call per article (at most)
- Repair candidates go back through clustering/reducer
- Cannot exceed 12 evaluation claim cap

### Prompt 12: Tests & Fixtures (Pending)

**Purpose:** End-to-end test coverage for TM v4

**Expected Changes:**
- Port Townsend article fixture tests
- Verify ≤12 evaluation claims
- Verify ≤12 background claims
- Verify chunk count reasonable
- Verify no candidateOnly persisted
- Verify background marked correctly

---

## ARCHITECTURE SUMMARY

```
┌──────────────────────────────────────┐
│  INPUT: Article + Cleaned Text       │
└──────────────────┬───────────────────┘
                   │
      ┌────────────┴────────────┐
      │ PASS 0: Text Audit      │
      │ PASS 1: Frame Detection │ ← Prompt 4
      │ PASS 2: Chunking        │ ← Prompt 3 (design)
      └────────────┬────────────┘
                   │
      ┌────────────┴────────────────────┐
      │ PASS 3: Parallel Survey (4-6)   │ ← Prompt 5
      │ - Per-chunk mini-themes         │
      │ - 0-6 eval candidates           │
      │ - 0-2 background candidates     │
      └────────────┬────────────────────┘
                   │
      ┌────────────┴────────────┐
      │ PASS 4: Theme Fusion    │ ← Prompt 6
      │ Final frame from votes  │
      └────────────┬────────────┘
                   │
      ┌────────────┴────────────┐
      │ PASS 5: Clustering      │ ← Prompt 7
      │ Dedup eval & background │
      │ (separate lanes)        │
      └────────────┬────────────┘
                   │
      ┌────────────┴────────────┐
      │ PASS 6A: Eval Reducer   │ ← Prompt 8
      │ Select ≤12 claims       │
      │ Full roles + pillars    │
      │ verdictEligible=true    │
      └────────────┬────────────┘
      ┌────────────┴────────────┐
      │ PASS 6B: Background Red │ ← Prompt 8
      │ Select ≤12 claims       │
      │ Source-useful facts     │
      │ verdictEligible=false   │
      └────────────┬────────────┘
                   │
      ┌────────────┴────────────┐
      │ PASS 7: Optional Repair │ ← Prompt 11 (pending)
      │ Fill coverage gaps      │ (feature-gated)
      │ 1 call max per article  │
      └────────────┬────────────┘
                   │
      ┌────────────┴────────────────────┐
      │ PASS 8: Persistence Contract    │ ← Prompt 9
      │ Validate + Persist              │
      │ Only 2 lanes, no intermediates  │
      └────────────┬────────────────────┘
                   │
      ┌────────────┴────────────────────┐
      │ PASS 9: Evidence (Eval Lane)    │ ← Prompt 10 (pending)
      │ searchEligible=true only        │
      │ Background skipped              │
      └────────────┬────────────────────┘
                   │
      ┌────────────┴────────────────────┐
      │ OUTPUT:                         │
      │ - selectedEvaluationClaims (≤12)│
      │ - selectedBackgroundClaims (≤12)│
      │ Both persisted, logged          │
      └────────────────────────────────┘
```

---

## DATABASE SCHEMA CHANGES

**Migration:** `backend/migrations/add_claim_selection_lanes.sql`

**New Columns on `content_claims`:**

| Column | Type | Default | Lane | Purpose |
|--------|------|---------|------|---------|
| `selected_for_evaluation` | TINYINT(1) | 0 | A | Evaluation lane selector |
| `evaluation_eligible` | TINYINT(1) | 1 | A | Post-triage eligibility |
| `verdict_eligible` | TINYINT(1) | 1 | A | Can receive verdict |
| `search_eligible` | TINYINT(1) | 1 | A | Current eval search |
| `source_eligible` | TINYINT(1) | 1 | Both | Future source use |
| `visibility` | VARCHAR(32) | "workspace" | Both | "workspace_eval" \| "workspace_background" |
| `selected_for_background` | TINYINT(1) | 0 | B | Background lane selector |
| `source_usefulness` | ENUM | NULL | B | "high" \| "medium" \| "low" |

**Indexes:**
- `idx_evaluation_lane` (selected_for_evaluation, evaluation_eligible, verdict_eligible)
- `idx_background_lane` (selected_for_background, source_usefulness)
- `idx_visibility` (visibility)

---

## FILES CREATED/MODIFIED

### New Core Implementation Files
- ✅ `backend/src/core/articleFrameDetector.js` (Prompt 4)
- ✅ `backend/src/core/themeFusion.js` (Prompt 6)
- ✅ `backend/src/core/candidateClustering.js` (Prompt 7)
- ✅ `backend/src/core/claimsSelectionReducers.js` (Prompt 8)
- ✅ `backend/src/core/claimReduction.js` (Prompt 9)

### Modified Core Files
- ✅ `backend/src/core/claimsEngine.js` (added surveyChunk, surveyContent methods - Prompt 5)
- ✅ `backend/src/core/processTaskClaims.js` (rewritten 6-step flow - Prompt 9)

### New Test Files
- ✅ `backend/test/survey/chunkSurvey.test.js` (Prompt 5)
- ✅ `backend/test/bearing/themeFusion.test.js` (Prompt 6)
- ✅ `backend/test/clustering/candidateClustering.test.js` (Prompt 7)
- ✅ `backend/test/bearing/claimsSelectionReducers.test.js` (Prompt 8)

### Documentation Files
- ✅ `backend/migrations/add_claim_selection_lanes.sql` (Prompt 2)
- ✅ `backend/src/core/ARTICLE_FRAME_INTEGRATION.md` (Prompt 4)
- ✅ `backend/src/core/THEME_FUSION_*.md` (7 docs - Prompt 6)
- ✅ `backend/src/core/CANDIDATE_CLUSTERING_GUIDE.md` (Prompt 7)
- ✅ `backend/src/core/CLAIMS_SELECTION_REDUCERS.md` (Prompt 8)
- ✅ `backend/src/core/CLAIMS_SELECTION_USAGE.md` (Prompt 8)

---

## TESTING STATUS

| Prompt | Module | Tests | Status |
|--------|--------|-------|--------|
| 4 | articleFrameDetector | 9 | ✅ All passing |
| 5 | chunkSurvey | 6+ | ✅ All passing |
| 6 | themeFusion | 3 | ✅ All passing |
| 7 | candidateClustering | 14 | ✅ All passing |
| 8 | claimsSelectionReducers | 5 | ✅ All passing (597ms) |
| 10 | evidenceGating | Pending | ⏳ |
| 11 | optionalRepair | Pending | ⏳ |
| 12 | endToEnd | Pending | ⏳ |

---

## LOGGING MARKERS

All TM v4 operations log with consistent markers:

| Pass | Marker | Example |
|------|--------|---------|
| 0 | ARTICLE_TEXT_AUDIT | Event audit with dirtyFallback flag |
| 1 | ARTICLE_FRAME_SEEDED | Frame with thesis, stance, confidence |
| 2 | CHUNKS_BUILT | Chunk count, positions, overlap ranges |
| 3 | CHUNK_SURVEY_STARTED/COMPLETED | Per-chunk and summary logs |
| 4 | THEME_FUSION_COMPLETED | Pillars, shift, gaps, anchors, patterns |
| 5 | EVALUATION_CANDIDATES_CLUSTERED | Cluster count, reduction ratio |
| 5 | BACKGROUND_CANDIDATES_CLUSTERED | Same metrics, separate lane |
| 6A | EVALUATION_CLAIMS_SELECTED | Count, roles, coverage, scores |
| 6B | BACKGROUND_CLAIMS_SELECTED | Count, usefulness distribution |
| 8 | CLAIMS_PERSISTED | Lane counts, total persisted |
| 9 | EVIDENCE_STARTED | Claims entering evidence (eval lane only) |

---

## NEXT STEPS

**Prompts 10-12 (Remaining):**
1. **Prompt 10:** Gate evidence to selectedEvaluationClaims (≤12) only
   - Background claims stay `searchEligible=false`
   - Bearing/scoring skips background
   - Workspace displays background separately

2. **Prompt 11:** Optional repair pass (feature-gated, default off)
   - Trigger if `coverageGaps.length > 0`
   - Single LLM call, routes through clustering/reducer
   - Cannot exceed 12 claim cap

3. **Prompt 12:** End-to-end tests
   - Port Townsend fixture validation
   - Claim counts, metadata, logging verification
   - Coverage and integration tests

**After Prompts Complete:**
- Code review of all implementations
- Manual testing on real articles
- Staging deployment validation
- Production rollout planning (with bearing approach consolidation)

---

## ACCEPTANCE CRITERIA MET SO FAR

✅ Long repetitive articles produce ≤12 evaluation claims (not dozens)  
✅ Chunk candidates are in debug logs only (never persisted directly)  
✅ Mini-themes update final frame but are never claims  
✅ Repetition creates clusters, not duplicate final claims  
✅ Clause survey packets marked candidateOnly=true  
✅ Persistence contract enforced (guards + logging)  
✅ Background/source claims persisted separately (capped)  
✅ Background claims never affect current verdict (verdict_eligible=false)  
✅ All new columns indexed for efficient lane filtering  
⏳ Evidence engine receives only selectedEvaluationClaims (Prompt 10 pending)  
⏳ Optional repair pass available (Prompt 11 pending)  
⏳ Full test coverage (Prompt 12 pending)  

---

**Status:** 9/12 prompts complete. Feature implementation ~75% done.  
**Target Completion:** After Prompts 10-12 (evidence gating, repair, tests).
