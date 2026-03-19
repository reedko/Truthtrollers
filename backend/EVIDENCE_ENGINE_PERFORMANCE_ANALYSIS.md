# Evidence Engine Performance Analysis

## Current Run Analysis (2026-03-19 log)

### What Was Processed
- **5 claims** (40790-40794)
- **6 queries per claim** = 30 total search queries
- **6 candidates per claim** = 30 total URLs fetched
- **13 LLM evidence extraction calls** (some URLs failed/skipped)
- **19 total evidence items** extracted (3+2+5+4+5)

### API Call Breakdown

#### 1. Query Generation (5 LLM calls)
- 1 LLM call per claim to generate search queries
- Each generates 6 queries (support, refute, nuance, background)
- **Total: 5 LLM calls**

#### 2. Search API Calls (30 searches)
- 6 queries × 5 claims = 30 queries
- Using "hybrid" mode = Tavily + Bing per query
- **Total: 60 search API calls** (30 Tavily + 30 Bing)

#### 3. URL Fetching (30 fetches)
- 6 candidates per claim × 5 claims = 30 URLs
- Many succeeded, some failed
- **Total: ~30 HTTP fetches**

#### 4. Evidence Extraction (13 LLM calls)
- Only successful fetches get LLM extraction
- Setting: maxEvidenceCandidates = 4 per claim
- But we saw only ~3 extractions per claim (some URLs failed)
- **Total: 13 LLM evidence extraction calls**

### Total API Costs Per Scrape
**For 5 claims:**
- Query generation: 5 LLM calls
- Evidence extraction: 13 LLM calls
- Search APIs: 60 calls (30 Tavily + 30 Bing)
- **Total LLM calls: 18**
- **Total Search calls: 60**

## Problems Identified

### 1. TOO MANY SEARCH QUERIES PER CLAIM
**Current:** 6 queries per claim
**Problem:** With hybrid search (Tavily + Bing), this is 12 API calls per claim!

**Cost per claim:**
- 6 queries × 2 search engines = 12 search API calls
- With 5 claims = 60 search API calls total

### 2. FETCHING TOO MANY CANDIDATES
**Current:** 6 candidates per claim = 30 URLs fetched
**Problem:** Most URLs fail or return poor quality

From the log, we saw:
- Candidate scores varied wildly (0.39 to 1.00)
- Low-scoring candidates (< 0.5) are usually poor quality
- We're wasting time fetching URLs that won't yield good evidence

### 3. LIMITED BY maxEvidenceCandidates
**Setting:** maxEvidenceCandidates = 4
**Problem:** This limits us to extracting from only 4 URLs per claim

But we're fetching 6 candidates and generating 6 queries!
- We fetch 6 but only extract from 4
- Wasting 2 fetches per claim

### 4. HYBRID SEARCH IS 2X THE COST
**Current:** searchEngine = "hybrid" (Tavily + Bing)
**Problem:** Doubles all search API calls

Each query hits BOTH search engines, which:
- Costs 2× as much
- Doesn't necessarily provide better results (lots of overlap)
- Takes longer (waiting for both APIs)

### 5. NO EARLY TERMINATION
**Problem:** We fetch all 6 candidates even if first 3 are excellent

If the first 2-3 candidates score 1.00, we don't need to fetch more!
But current code fetches all 6 before extracting evidence.

## Recommended Optimizations

### Option A: Aggressive Speedup (Recommended)
```javascript
{
  limits: {
    queriesPerClaim: 3,  // ← DOWN from 6 (still get support/refute/nuance)
    candidates: 4,        // ← DOWN from 6 (fetch fewer URLs)
    evidencePerDoc: 2,    // ← KEEP at 2 (good evidence per doc)
  },
  maxParallelClaims: Infinity,
  topKQueries: 3,         // ← DOWN from 6
  searchEngine: "tavily", // ← Use ONLY Tavily (not hybrid)
  topKCandidates: 4,      // ← DOWN from 6
  maxEvidenceCandidates: 4, // ← KEEP at 4
  maxParallelSearches: 3,   // ← DOWN from 4
}
```

**Impact:**
- Queries: 6 → 3 per claim (-50%)
- Search API calls: 60 → 15 (-75%) - single engine + fewer queries
- URL fetches: 30 → 20 (-33%)
- LLM calls: ~18 → ~13 (-28%)

**Expected speedup: 2-3x faster**

### Option B: Balanced (Quality + Speed)
```javascript
{
  limits: {
    queriesPerClaim: 4,  // ← DOWN from 6
    candidates: 5,        // ← DOWN from 6
    evidencePerDoc: 2,    // ← KEEP at 2
  },
  maxParallelClaims: Infinity,
  topKQueries: 4,         // ← DOWN from 6
  searchEngine: "tavily", // ← Single engine (can use hybrid for important tasks)
  topKCandidates: 5,      // ← DOWN from 6
  maxEvidenceCandidates: 4, // ← KEEP at 4
  maxParallelSearches: 4,   // ← KEEP at 4
}
```

**Impact:**
- Queries: 6 → 4 per claim (-33%)
- Search API calls: 60 → 20 (-67%)
- URL fetches: 30 → 25 (-17%)
- LLM calls: ~18 → ~15 (-17%)

**Expected speedup: 1.5-2x faster**

### Option C: Maximum Quality (Current Approach)
Keep current settings but switch to single search engine:
```javascript
searchEngine: "tavily", // ← Only change this
```

**Impact:**
- Search API calls: 60 → 30 (-50%)
- Everything else stays the same

**Expected speedup: 1.3x faster**

## Previous "Speed Upgrades" That Were Lost

Looking at the code comments, it seems previous optimizations existed:

1. **Comment says:** "Reduced from 12 to 6 for faster processing"
   - This WAS an optimization (12 → 6 candidates)
   - But 6 is still too many when only 4 get extracted

2. **Comment says:** "Increased from 1 to 2 to get more evidence per doc"
   - This INCREASED work (more LLM calls per doc)
   - But provides better quality

3. **maxParallelClaims: Infinity** - Good! Processes all claims in parallel

4. **Hybrid search was added** - This DOUBLED search costs

## Root Cause of Slowdown

**The hybrid search + high query count is the killer:**
- 6 queries per claim
- × 2 search engines (hybrid)
- × 5 claims
- = **60 search API calls**

Combined with:
- Fetching 6 candidates but only extracting from 4 (wasted fetches)
- No early termination when good candidates found

## Recommended Action

**Immediate fix (Option A):**
1. Reduce queries to 3 per claim (still covers support/refute/nuance)
2. Switch to Tavily only (not hybrid)
3. Reduce candidates to 4 (matches maxEvidenceCandidates)

This should give you 2-3x speedup while maintaining quality.

**Test with 5 claims:**
- Current: ~18 seconds total
- Optimized: ~6-9 seconds total

**For production (20+ claims):**
- Current: ~60-120 seconds
- Optimized: ~20-40 seconds
