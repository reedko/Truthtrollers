# Evidence Engine Performance Analysis & Documentation

**Date**: March 18, 2026
**Issue**: Scraping takes 10 minutes to complete and experiencing performance/bug issues

---

## Executive Summary

The TruthTrollers evidence engine performs **sequential processing** of references with **12+ LLM calls per reference**, leading to slow performance (10 minutes for typical scrape jobs). The current architecture prioritizes thoroughness over speed, creating bottlenecks at multiple stages.

### Key Performance Issues Identified

1. **Sequential Reference Processing** - References processed one-by-one (not parallel)
2. **Multiple LLM Calls Per Reference** - 12+ OpenAI API calls per reference
3. **No Caching** - URLs may be re-fetched multiple times
4. **Failed Scrapes** - Many references fail with insufficient text but still consume API calls
5. **Comprehensive Extraction Mode** - Extracts all claims then filters (2 LLM passes)

---

## Complete Evidence Engine Flow

### Phase 1: Task Scraping (Initial Content)
**Entry Point**: `/api/scrape-task` → `scrapeTask()`
**Duration**: ~5-10 seconds

1. **Fetch HTML** - Retrieve page content (extension provides raw_html, skips fetch)
2. **Extract Metadata** - Parse title, authors, publisher, thumbnail
3. **Extract Text** - Use Readability to get clean article text (up to 60,000 chars)
4. **Extract References** - Find DOM links and inline references from text
5. **Persist Task** - Create `content` row (type='task') with all metadata
6. **Extract Task Claims** - LLM extracts factual claims from article

**LLM Calls**: 1-2 (claim extraction + optional filtering)

---

### Phase 2: Evidence Engine (Find Sources)
**Entry Point**: `runEvidenceEngine()` → `EvidenceEngine.run()`
**Duration**: ~60-120 seconds (depends on claim count)

#### Step 2.1: Query Generation (Per Claim)
**File**: `backend/src/core/evidenceEngine.js:36-72`

For EACH claim (typically 10 claims):
- **LLM Call #1**: Generate 6 diverse search queries per claim
  - Intents: support, refute, background, factbox
  - Temperature: 0.2 (consistent queries)
  - **Output**: Array of 6 queries

**Total LLM Calls**: 10 claims × 1 = **10 LLM calls**
**Duration**: ~1-2 seconds per claim = **10-20 seconds total**

```javascript
// Example queries for claim "Valerian helps with sleep"
{
  queries: [
    { query: "valerian sleep clinical trials", intent: "support" },
    { query: "valerian ineffective sleep studies", intent: "refute" },
    { query: "valerian mechanism of action", intent: "background" },
    { query: "valerian sleep meta analysis", intent: "factbox" }
  ]
}
```

#### Step 2.2: Candidate Retrieval (Per Claim)
**File**: `backend/src/core/evidenceEngine.js:74-164`

For EACH claim:
- **Search Engines**: Run 6 queries × 2 engines (Tavily + Bing) = 12 API calls
  - Hybrid mode runs both search engines in parallel
  - Each query returns top 12 candidates
- **Deduplication**: Merge by URL, keep highest score
- **Ranking**: Sort by search engine score (0-1)
- **Limit**: Keep top 12 candidates per claim

**Total Search API Calls**: 10 claims × 6 queries × 2 engines = **120 search calls**
**Duration**: ~3-5 seconds per claim = **30-50 seconds total**

**Config** (line 505-517):
```javascript
limits: {
  queriesPerClaim: 4,        // Queries per claim (currently 6)
  candidates: 12,             // URLs to try per claim
  evidencePerDoc: 2,          // Evidence items per URL
},
maxEvidenceCandidates: 4,    // Final references per claim
```

#### Step 2.3: Evidence Extraction (Per Candidate)
**File**: `backend/src/core/evidenceEngine.js:166-260`

For EACH candidate URL (12 per claim × 10 claims = 120 URLs):
1. **Fetch URL** - HTTP GET with 15s timeout
2. **Detect Content Type** - Check if PDF or HTML
3. **Extract Text**:
   - **HTML**: Use Readability to get clean text (up to 8,000 chars)
   - **PDF**: Use pdf-parse to extract full text
4. **Extract Evidence** - LLM analyzes text for relevant quotes
   - **LLM Call #2**: `extractQuotesFromText()` finds up to 2 quotes per document
   - Temperature: 0.2
   - **Output**: `[{ quote, summary, stance, location }]`

**Total LLM Calls**: 120 candidates × 1 = **120 LLM calls**
**Duration**: ~2-3 seconds per URL = **240-360 seconds (4-6 minutes)**

**Optimizations**:
- Cache already-fetched URLs to avoid re-processing
- Skip if URL already processed for different claim
- Create stub content_id for failed fetches (allows manual scrape later)

---

### Phase 3: Reference Processing (For Each Evidence Source)
**Entry Point**: `/api/scrape-task` lines 575-712 (sequential loop)
**Duration**: ~30-60 seconds per reference × 10-20 references = **5-20 minutes**

For EACH reference found by evidence engine (sequentially, NOT parallel):

#### Step 3.1: Create Snippet Claim
**Duration**: ~1 second
- Insert search engine snippet as a "snippet" claim
- Links this snippet to reference content_id

#### Step 3.2: Extract Reference Claims
**Duration**: ~5-10 seconds
**File**: `backend/src/core/processTaskClaims.js`

- **LLM Call #3**: Extract factual claims from reference text (context-aware)
  - Mode: 'comprehensive' (extracts all, then filters)
  - Provides task claims as context so LLM extracts relevant counter-claims
  - Temperature: 0.2
  - **Output**: Array of 5-10 claims

- **LLM Call #4**: Filter and rank claims (ONLY in comprehensive mode)
  - Scores each claim on: factuality, specificity, importance, relevance
  - Keeps top 10 claims with score ≥ 0.4
  - Temperature: 0.1
  - **Output**: Filtered array of high-value claims

**Total LLM Calls**: 2 per reference

**Code** (line 16):
```javascript
const EXTRACTION_MODE = 'comprehensive'; // 2 LLM passes
// Alternative: 'ranked' mode (1 LLM pass, but less thorough)
```

#### Step 3.3: Match Claims (Create Veracity Links)
**Duration**: ~10-15 seconds
**File**: `backend/src/core/matchClaims.js`

- **LLM Call #5**: Match reference claims to task claims
  - Input: 10 reference claims × 10 task claims = 100 comparisons
  - Determines: stance, veracity score (0-1), confidence (0.15-0.98), support level (-1.2 to +1.2)
  - Temperature: 0.2
  - **Output**: Array of 4-5 matches

**Total LLM Calls**: 1 per reference

**Batch Insert**: All matches inserted in single SQL query (optimized)

---

## Total LLM Calls Summary

### Per Scrape Job (10 task claims, 15 references found)

| Phase | Step | LLM Calls | Duration |
|-------|------|-----------|----------|
| **Task Scraping** | Extract task claims | 1-2 | 5-10s |
| **Evidence Engine** | Generate queries (10 claims) | 10 | 10-20s |
| **Evidence Engine** | Extract evidence (120 URLs) | 120 | 240-360s |
| **Reference Processing** | Extract ref claims (15 refs × 2) | 30 | 75-150s |
| **Reference Processing** | Match claims (15 refs × 1) | 15 | 150-225s |
| **TOTAL** | | **176-177** | **480-765s (8-13 min)** |

---

## Performance Bottlenecks

### 1. Sequential Reference Processing (CRITICAL)
**Location**: `backend/src/routes/content/content.scrape.routes.js:575-712`

```javascript
// CURRENT: Sequential processing
for (const ref of validReferences) {
  await persistClaims(...);           // 1s
  await processTaskClaims(...);       // 10s (2 LLM calls)
  await matchClaimsToTaskClaims(...); // 10s (1 LLM call)
}
```

**Impact**: 15 references × 21 seconds = **315 seconds (5.25 minutes)**

**Why Sequential?**
Comment on line 581 explains:
> "Process references SEQUENTIALLY instead of parallel to prevent:
> 1. Database connection pool exhaustion (limit: 10 connections)
> 2. OpenAI API rate limiting
> 3. Race conditions and mixed responses"

**Fix**: Could process 2-3 references in parallel safely

---

### 2. Comprehensive Extraction Mode
**Location**: `backend/src/core/processTaskClaims.js:16`

```javascript
const EXTRACTION_MODE = 'comprehensive'; // 2 LLM passes
```

**Impact**: +5-10 seconds per reference (extra filtering pass)

**Alternative**: 'ranked' mode (1 LLM pass, slightly less thorough)

---

### 3. Evidence Engine Over-Fetching
**Config**: `backend/src/core/runEvidenceEngine.js:505-533`

```javascript
limits: {
  queriesPerClaim: 4,        // 6 queries × 10 claims = 60 queries
  candidates: 12,             // 12 URLs per claim = 120 URLs
  evidencePerDoc: 2,
},
maxEvidenceCandidates: 4,    // Final: 4 refs per claim
```

**Impact**: Fetches 120 URLs but only keeps ~40 (66% waste)

**Fix**: Reduce `candidates: 12` → `candidates: 6` (fewer failed fetches)

---

### 4. Failed Scrapes
**Log Evidence** (from `/backend/logs/evidence-2026-03-17.log`):

Many references fail with insufficient text:
- `https://www.sciencedirect.com/...` - **143 chars** - NO claims extracted
- `https://www.researchgate.net/...` - **587 chars** - NO claims extracted
- `https://www.verywellhealth.com/...` - **315 chars** - NO claims extracted

**Impact**: Still creates content_id, runs LLM calls, wastes ~20 seconds

**Cause**: Readability fails on paywalls, login walls, JavaScript-heavy sites

**Fix**: Better text extraction, or skip references with <500 chars

---

### 5. No Connection Pooling for LLM Calls
**Current**: Each LLM call creates new HTTP connection

**Fix**: Implement connection pool for OpenAI API client

---

## Log Analysis (March 17, 2026)

### Timing Breakdown from Logs

```
22:57:04 - Start reference 13637 claim extraction
22:57:11 - Claims extracted (7 seconds)
22:57:21 - Claims matched (10 seconds)
22:57:21 - Start reference 13642
22:57:37 - Done reference 13642 (16 seconds)
...
22:58:50 - Start reference 13630
22:58:50 - Claims matched (instant - 0 matches)
```

**Observations**:
- Claim extraction: 5-10 seconds (consistent)
- Claim matching: 8-10 seconds (consistent)
- Failed references: still take ~20 seconds (wasteful)
- Total time for 15 references: ~5 minutes

---

## Bugs Identified

### Bug 1: Failed References Still Process Fully
**Evidence**: Lines from log:
```
[22:57:05] WARNING: NO claims extracted from reference 13655
           URL: https://www.sciencedirect.com/...
           Text length: 143 chars
```

**Impact**: Wastes 20 seconds per failed reference

**Fix**: Skip claim extraction/matching if text < 500 chars

---

### Bug 2: Some References Get 0 Matches
**Evidence**:
```
[22:58:50] matchClaimsToTaskClaims returned 0 matches
           WARNING: No AI-suggested links created for reference 13630
```

**Impact**: Reference is stored but not linked to any claims (orphaned)

**Fix**: Ensure at least 1 link per reference (use snippet as fallback)

---

### Bug 3: Random Debug Log
**Location**: `backend/src/storage/persistPublishers.js:6`

```javascript
logger.log(contentId, publisher, ":pufsdfadf");
```

**Impact**: Confusing log messages
**Status**: FIXED (removed in this session)

---

## Recommendations

### Immediate Fixes (Quick Wins)

1. **Skip Failed References**
   ```javascript
   // In content.scrape.routes.js line 604
   if (ref.cleanText.length < 500) {
     logger.warn(`Skipping reference with insufficient text: ${ref.url}`);
     continue;
   }
   ```
   **Impact**: Save 5-10 seconds per failed reference

2. **Switch to Ranked Mode**
   ```javascript
   // In processTaskClaims.js line 16
   const EXTRACTION_MODE = 'ranked'; // Single LLM pass
   ```
   **Impact**: Save 5-10 seconds per reference (but less thorough)

3. **Reduce Candidate Count**
   ```javascript
   // In runEvidenceEngine.js line 507
   candidates: 6, // Reduced from 12
   ```
   **Impact**: Save 2-4 minutes in evidence engine phase

### Medium-Term Improvements

4. **Parallel Reference Processing (Limited)**
   ```javascript
   // Process 3 references at a time
   const PARALLEL_REFS = 3;
   for (let i = 0; i < validReferences.length; i += PARALLEL_REFS) {
     const batch = validReferences.slice(i, i + PARALLEL_REFS);
     await Promise.all(batch.map(ref => processReference(ref)));
   }
   ```
   **Impact**: 3x speedup on reference processing (5 min → 1.7 min)

5. **Connection Pooling for OpenAI**
   - Reuse HTTP connections across LLM calls
   **Impact**: Save 1-2 seconds per LLM call (×177 calls = 3-6 min savings)

6. **Better Text Extraction**
   - Try multiple extraction methods (Puppeteer for JS-heavy sites)
   - Detect paywalls/login walls early
   **Impact**: Reduce failed scrapes from 20% → 5%

### Long-Term Architecture

7. **Background Job Queue**
   - Move evidence engine to async background worker
   - Return initial task immediately, process references later
   **Impact**: User sees instant feedback, processing happens in background

8. **LLM Caching**
   - Cache LLM responses for identical inputs
   - Especially useful for query generation (many similar claims)
   **Impact**: 10-20% reduction in LLM calls

9. **Streaming Responses**
   - Stream reference results back to frontend as they complete
   - Show progress bar with live updates
   **Impact**: Better UX, no performance change

---

## Configuration Reference

### Current Settings

**Evidence Engine** (`runEvidenceEngine.js:505-533`):
```javascript
limits: {
  queriesPerClaim: 4,        // Actually set to 6 in practice
  candidates: 12,             // URLs to try
  evidencePerDoc: 2,          // Quotes per URL
},
maxParallelClaims: Infinity,  // Process all claims in parallel
maxEvidenceCandidates: 4,     // Final refs per claim
topKQueries: 6,               // Use 6 best queries
searchEngine: "hybrid",       // Tavily + Bing
```

**Claim Extraction** (`processTaskClaims.js:16,77`):
```javascript
EXTRACTION_MODE: 'comprehensive'  // 2 LLM passes
maxClaims: 10                     // Keep top 10 claims
threshold: 0.4                    // Min quality score
```

**Reference Processing** (`content.scrape.routes.js:575`):
```javascript
Sequential processing (no parallelism)
Database pool: 10 connections
```

---

## Estimated Impact of Fixes

| Fix | Time Saved | Effort | Risk |
|-----|------------|--------|------|
| Skip failed refs | 1-2 min | Low | Low |
| Ranked mode | 1-2 min | Low | Medium (less thorough) |
| Reduce candidates | 2-4 min | Low | Low |
| Parallel refs (3×) | 3-4 min | Medium | Medium (pool exhaustion) |
| Connection pooling | 3-6 min | High | Low |

**Total potential savings**: 10-18 minutes → **2-4 minutes**

---

## Conclusion

The evidence engine is **architecturally sound** but **over-engineered for thoroughness**. The 10-minute processing time is primarily due to:

1. **Sequential reference processing** (5 min)
2. **Evidence engine over-fetching** (2-4 min)
3. **Failed scrapes** (1-2 min)
4. **Comprehensive extraction mode** (1-2 min)

**Quick wins** (skip failed refs, ranked mode, reduce candidates) can cut time to **5-7 minutes**.

**Medium-term fixes** (parallel processing, connection pooling) can cut time to **2-4 minutes**.

**Architectural changes** (background jobs, streaming) can make the process feel instant while processing in the background.
