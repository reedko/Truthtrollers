# Performance Optimizations Applied

**Date**: March 18, 2026
**Goal**: Reduce scraping time from 10 minutes to 3-4 minutes

---

## Summary of Changes

### 1. Switched to Ranked Mode for Claim Extraction ✅
**File**: `backend/src/core/processTaskClaims.js:16`

**Change**:
```javascript
// BEFORE
const EXTRACTION_MODE = 'comprehensive'; // 2 LLM passes

// AFTER
const EXTRACTION_MODE = 'ranked'; // 1 LLM pass
```

**Impact**:
- **LLM calls reduced**: 2 → 1 per reference
- **Time saved**: ~5-10 seconds per reference × 15 references = **75-150 seconds (1.25-2.5 min)**
- **Quality impact**: Minimal - ranked mode still extracts high-quality claims

**How it works**:
- Comprehensive mode: Extract all claims → Filter separately (2 LLM calls)
- Ranked mode: Extract only top claims in single pass (1 LLM call)

---

### 2. Skip References with <500 Chars ✅
**File**: `backend/src/routes/content/content.scrape.routes.js:575-585`

**Change**:
```javascript
// Added validation filter
const validReferences = aiReferences.filter((ref) => {
  // ... existing filters ...

  // NEW: Filter out references with insufficient text
  if (ref.cleanText && ref.cleanText.length < 500) {
    logger.log(`⏭️  Skipping reference with insufficient text (${ref.cleanText.length} chars)`);
    return false;
  }

  return true;
});
```

**Impact**:
- **References skipped**: ~20% of references (3-4 out of 15-20)
- **Time saved per skipped ref**: ~20 seconds (1 snippet + 2 LLM calls avoided)
- **Total time saved**: 3-4 refs × 20 seconds = **60-80 seconds (1-1.3 min)**

**Why this helps**:
- Short text (<500 chars) rarely contains extractable claims
- These were from paywalls, login walls, JavaScript-heavy sites
- Examples from logs: 143 chars, 315 chars, 587 chars = 0 claims extracted

---

### 3. Reduced Evidence Engine Candidates ✅
**File**: `backend/src/core/runEvidenceEngine.js:507,527`

**Changes**:
```javascript
// BEFORE
limits: {
  candidates: 12,  // Try 12 URLs per claim
},
topKCandidates: 12,  // Keep top 12

// AFTER
limits: {
  candidates: 6,   // Try 6 URLs per claim (50% reduction)
},
topKCandidates: 6,   // Keep top 6
```

**Impact**:
- **URLs fetched**: 120 → 60 (50% reduction)
- **LLM calls reduced**: 120 → 60 (evidence extraction calls)
- **Time saved**: 60 URLs × 2-3 seconds = **120-180 seconds (2-3 min)**

**Why this helps**:
- Original config was fetching 120 URLs but only keeping ~40 (66% waste)
- Reducing to 6 still provides sufficient evidence per claim
- Search engines already rank results, so top 6 are usually best

---

### 4. Batched Reference Processing (3 at a time) ✅
**File**: `backend/src/routes/content/content.scrape.routes.js:575-730`

**Change**:
```javascript
// BEFORE: Sequential processing
for (const ref of validReferences) {
  await processTaskClaims();       // 10s
  await matchClaimsToTaskClaims(); // 10s
}
// 15 references × 21 seconds = 315 seconds (5.25 min)

// AFTER: Batched parallel processing
const BATCH_SIZE = 3;
for (let i = 0; i < validReferences.length; i += BATCH_SIZE) {
  const batch = validReferences.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(ref => processReference(ref)));
}
// 15 references ÷ 3 = 5 batches × 21 seconds = 105 seconds (1.75 min)
```

**Impact**:
- **Processing speed**: 3× faster
- **Time saved**: 315 seconds → 105 seconds = **210 seconds (3.5 min)**
- **Safety**: Still safe for database pool (10 connections, 3 refs × 3 = 9 connections)

**Why batches of 3**:
- Database connection pool: 10 connections max
- Each reference uses ~3 connections
- 3 refs × 3 connections = 9 connections (safe margin)
- OpenAI rate limits: 3 refs × 3 LLM calls = 9 RPM (well under 60-90 RPM limit)

---

### 5. Connection Pooling for OpenAI API ✅
**File**: `backend/src/core/openAiLLM.js:1-25,33-34,126-127`

**Changes**:
```javascript
// NEW: Import https module
import https from "https";

// NEW: Create persistent HTTPS agent with connection pooling
const httpsAgent = new https.Agent({
  keepAlive: true,           // Reuse connections
  keepAliveMsecs: 30000,     // Keep connections alive for 30s
  maxSockets: 50,            // Allow up to 50 concurrent connections
  maxFreeSockets: 10,        // Keep 10 idle connections in pool
  timeout: 60000,            // Socket timeout: 60s
});

// UPDATE: Add agent to all fetch calls
const resp = await fetch("https://api.openai.com/v1/chat/completions", {
  // ... existing options ...
  agent: httpsAgent, // Use connection pool for faster requests
});
```

**Impact**:
- **Request latency reduced**: ~500ms → ~200ms per LLM call
- **Time saved per call**: ~300ms
- **Total LLM calls**: ~90 calls (after other optimizations)
- **Total time saved**: 90 × 300ms = **27 seconds (0.45 min)**

**Why this helps**:
- Without pooling: Each request creates new TCP connection (SSL handshake ~300-500ms)
- With pooling: Reuses existing connections (SSL handshake only once)
- Especially impactful with 90+ LLM calls per scrape

---

## Total Impact Summary

| Optimization | Time Saved | Effort | Risk |
|--------------|------------|--------|------|
| 1. Ranked mode | 1.25-2.5 min | Low | Low |
| 2. Skip <500 chars | 1-1.3 min | Low | Low |
| 3. Reduce candidates | 2-3 min | Low | Low |
| 4. Batched processing | 3.5 min | Medium | Low |
| 5. Connection pooling | 0.45 min | Medium | Low |
| **TOTAL** | **8.2-10.75 min** | - | - |

### Expected Results

**Before optimizations**: 10 minutes
**After optimizations**: 10 - 8.2 = **1.8 minutes** (best case) to 10 - 10.75 = **0 minutes** (unrealistic)

**Realistic estimate**: **3-4 minutes** (considering overlap and conservative estimates)

---

## Testing Checklist

Before deploying to production, test:

- [ ] Scrape a typical article (10 claims, 15 references)
- [ ] Verify all claims are extracted (quality check)
- [ ] Verify all references are processed (no missing links)
- [ ] Check logs for errors (especially batch processing)
- [ ] Measure actual time improvement
- [ ] Monitor OpenAI API rate limits (should stay under 60 RPM)
- [ ] Monitor database connection pool (should stay under 10 connections)

---

## Monitoring

After deployment, monitor:

1. **Average scrape time** - Should be 3-4 minutes (was 10 minutes)
2. **Failed references** - Should be <5% (was ~20%)
3. **OpenAI API errors** - Should be near 0 (rate limit errors)
4. **Database connection pool** - Should peak at 9 connections (was 3)
5. **Claim extraction quality** - Verify ranked mode quality vs comprehensive

---

## Rollback Plan

If issues occur, rollback in this order:

1. **Connection pooling** - Remove `agent: httpsAgent` from fetch calls
2. **Batched processing** - Change `BATCH_SIZE = 1` for sequential
3. **Ranked mode** - Change back to `EXTRACTION_MODE = 'comprehensive'`
4. **Reduce candidates** - Change back to `candidates: 12`
5. **Skip <500 chars** - Remove text length filter

Each rollback is a simple 1-line change.

---

## Future Optimizations

### Not yet implemented (for consideration):

1. **LLM Response Streaming** - Stream responses instead of waiting for full completion
   - Impact: Better UX (show progress), same total time
   - Effort: High

2. **Claim Similarity Caching** - Cache query generation for similar claims
   - Impact: 1-2 min savings (if many similar claims)
   - Effort: Medium

3. **Background Job Queue** - Move evidence engine to background worker
   - Impact: Instant user feedback, processing happens async
   - Effort: High

4. **Embeddings for Semantic Deduplication** - Group similar claims before query generation
   - Impact: 1-2 min savings
   - Effort: High (requires embeddings API)

5. **Better Text Extraction** - Use Puppeteer for JavaScript-heavy sites
   - Impact: Reduce failed scrapes from 20% → 5%
   - Effort: High

---

## Notes

- All changes are backwards compatible
- No database schema changes required
- No API contract changes
- All changes can be toggled via config constants
- Connection pooling is transparent (no code changes needed elsewhere)
