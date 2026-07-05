# Claim Extraction & Chunking Strategy

## Problem Statement

Current approach extracts ~56 claims per article, then tries to filter by bearing scores. This fails because:
- Bearing scores don't reliably predict claim importance
- All 56 claims go through expensive evidence retrieval
- Results are messy and unfocused

## Proposed Solution: Theme-Aware Chunked Extraction

### Core Insight
Instead of extracting generic claims and filtering later, **extract claims contextually aware of the article's main argument**. This reduces noise upfront and produces more coherent, topically-aligned results.

### High-Level Flow

```
1. THEME DETECTION (Title + First Chunk)
   └─ Identify main article claim/argument

2. PARALLEL CHUNKED PROCESSING (N chunks × 12 claims)
   ├─ Chunk 1: Extract claims + identify mini-theme
   ├─ Chunk 2: Extract claims aligned to main theme
   ├─ Chunk N: Extract claims aligned to main theme
   └─ Each chunk processes claims → evidence → scoring in parallel

3. FINAL SYNTHESIS
   ├─ Collect N×12 candidate claims with full evidence
   ├─ Filter by evidence quality (remove unsupported claims)
   ├─ Rank by: relevance to main theme + evidence strength
   └─ Return top 12 claims
```

---

## Detailed Design

### Phase 1: Article Theme Detection

**Input:** Title + First chunk (first 6000 chars)

**Output:** 
```json
{
  "mainTheme": "string describing central argument",
  "themeKeywords": ["keyword1", "keyword2", ...],
  "themeStance": "positive|negative|neutral|mixed",
  "claimStructure": {
    "thesis": "main claim being argued",
    "pillars": ["supporting argument 1", "supporting argument 2", ...]
  }
}
```

**Implementation:**
```javascript
async detectArticleTheme(title, firstChunk) {
  // LLM prompt: "What is the core argument/claim in this article?"
  // Extract: main theme, keywords, stance, pillar structure
  // Return structure for use in chunk-level extraction
}
```

**Rationale:** 
- Title + first 6000 chars contains ~80% of article intent
- Once we know the theme, we can extract claims that **support or refute** it
- Gives chunk extractors a semantic anchor instead of blind extraction

---

### Phase 2: Parallel Chunked Claim Extraction & Evidence

**Input:** 
- Text chunks (6000 chars each)
- Article theme + keywords (from Phase 1)
- Chunk index + position metadata

**For Chunk 1 (Title + Opening):**
```javascript
// Identify mini-theme for this chunk
miniTheme = extractChunkTheme(chunk, articleTheme)

// Extract claims aligned to main theme
claims = await extractClaimsForChunk({
  chunk,
  articleTheme,
  chunkTheme: miniTheme,
  maxClaims: 12,
  systemPrompt: `Extract 12 claims from this chunk. 
                  Prioritize claims that:
                  1. Support or refute the article's main argument
                  2. Are specific and verifiable (not generic)
                  3. Represent the chunk's key assertion`
})
```

**For Chunks 2-N (Body):**
```javascript
// Extract claims that support/challenge main theme
claims = await extractClaimsForChunk({
  chunk,
  articleTheme,     // Keep reference to main theme
  chunkTheme,       // This chunk's sub-argument
  maxClaims: 12,
  systemPrompt: `Extract 12 claims from this chunk.
                  Prioritize claims that:
                  1. Support or refute the main article argument: "${articleTheme.thesis}"
                  2. Explain the chunk's specific contribution to that argument
                  3. Are verifiable (have specific metrics, studies, quotes)`
})
```

**Parallel Execution:**
```javascript
// Process all chunks in parallel
const chunkPromises = chunks.map((chunk, idx) => 
  processChunk(chunk, idx, articleTheme)
);

// Wait for all to complete + get full evidence for each claim
const allResults = await Promise.all(chunkPromises);
```

**Output per chunk:**
```json
{
  "chunkIndex": 0,
  "chunkTheme": "string",
  "claims": [
    {
      "id": "chunk-0-claim-1",
      "text": "Claim text",
      "role": "thesis|pillar|evidence|background",
      "confidence": 0.85,
      "supportedBy": ["quote1", "quote2"],
      "evidence": [
        {
          "url": "...",
          "stance": "support|refute|neutral",
          "quality": 0.75,
          "snippet": "..."
        }
      ]
    }
  ]
}
```

---

### Phase 3: Final Synthesis & Filtering

**Input:** N chunks × 12 claims + evidence for each

**Process:**

```javascript
async synthesizeAndFilter(allChunkResults) {
  // 1. DEDUP: Remove duplicates across chunks
  const deduped = deduplicateClaims(
    allChunkResults.flatMap(r => r.claims),
    threshold: 0.85  // High similarity threshold
  );
  
  // 2. FILTER: Remove claims without decent evidence
  const supportedClaims = deduped.filter(claim => {
    const evidenceQuality = claim.evidence
      .filter(e => e.quality > 0.4)  // Minimum quality threshold
      .reduce((sum, e) => sum + e.quality, 0) / claim.evidence.length;
    
    return (
      evidenceQuality > 0.5 &&         // At least mediocre evidence
      claim.evidence.length >= 2       // At least 2 sources
    );
  });
  
  // 3. RANK: Score by relevance + evidence strength
  const scored = supportedClaims.map(claim => ({
    ...claim,
    themeRelevance: scoreThemeAlignment(claim, mainTheme),
    evidenceStrength: scoreEvidenceQuality(claim),
    finalScore: (themeRelevance * 0.6) + (evidenceStrength * 0.4)
  }));
  
  // 4. SELECT: Top 12
  return scored
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 12);
}
```

**Scoring Functions:**

```javascript
function scoreThemeAlignment(claim, mainTheme) {
  // High if claim directly supports/refutes main thesis
  // Medium if claim supports pillar
  // Low if claim is tangential
  
  const thesisMatch = semanticSimilarity(claim.text, mainTheme.thesis);
  const pillarMatches = mainTheme.pillars
    .map(p => semanticSimilarity(claim.text, p))
    .sort((a, b) => b - a);
  
  if (thesisMatch > 0.75) return 1.0;
  if (pillarMatches[0] > 0.70) return 0.8;
  if (pillarMatches[0] > 0.60) return 0.6;
  return 0.3;
}

function scoreEvidenceQuality(claim) {
  // Weighted average of evidence quality + count
  const qualityScore = claim.evidence
    .reduce((sum, e) => sum + e.quality, 0) / claim.evidence.length;
  
  const countBonus = Math.min(claim.evidence.length / 5, 0.2);  // +0.2 for 5+ sources
  
  return Math.min(qualityScore + countBonus, 1.0);
}
```

---

## Implementation Architecture

### New Files/Functions

```
processTaskClaims.js (modified)
├── Phase 1: detectArticleTheme()
├── Phase 2: processChunksInParallel()
│   ├── For each chunk:
│   │   ├── extractChunkTheme()
│   │   ├── extractClaimsForChunk()  [LLM]
│   │   ├── retrieveEvidence()       [Search gateway]
│   │   └── scoreClaims()
│   └── Promise.all() for parallelism
└── Phase 3: synthesizeAndFilter()
    ├── deduplicateClaims()
    ├── filterByEvidenceQuality()
    ├── rankBySemantic()
    └── return top 12

claimExtraction.js (new)
├── THEME_DETECTION_PROMPT
├── CHUNK_THEME_PROMPT
├── CHUNK_CLAIM_EXTRACTION_PROMPT (theme-aware variant)
└── Helper functions for scoring
```

### Configuration

```javascript
const CLAIM_EXTRACTION_CONFIG = {
  // Phase 1
  themeDetectionChunkSize: 6000,
  
  // Phase 2
  chunkSize: 6000,
  claimsPerChunk: 12,
  maxParallelChunks: 4,           // Limit parallelism to avoid rate limits
  evidenceSearchTimeout: 30000,
  
  // Phase 3
  deduplicationThreshold: 0.85,
  minEvidenceSources: 2,
  minEvidenceQuality: 0.4,
  themeAlignmentWeight: 0.6,
  evidenceStrengthWeight: 0.4,
  finalClaimCount: 12,
};
```

---

## Benefits vs. Current Approach

| Aspect | Current (Bearing) | New (Theme-Aware) |
|--------|-------------------|-------------------|
| **Claims Generated** | 56 (bloated) | 12×N → 12 final (focused) |
| **Filtering Method** | Bearing scores (unreliable) | Semantic relevance + evidence quality |
| **Processing Cost** | High (all 56 get full evidence) | High but justified (get quality evidence for all, then pick best) |
| **Parallelism** | Sequential chunks | Parallel chunk processing |
| **Claim Quality** | Mixed; many tangential | High; all relevant to main theme |
| **Debugging** | Hard (opaque bearing scores) | Easy (see theme, chunk themes, scoring) |
| **Adaptability** | Static thresholds | Dynamic scoring based on content |

---

## Time Estimates

### Current Approach
- Extract 56 claims: ~20s
- Evidence for 56 claims: ~3 min
- Bearing filtering: ~30s
- **Total: ~3.5 min, mostly wasted on irrelevant claims**

### New Approach (Parallel)
- Detect theme: ~5s
- Extract 12 claims × N chunks in parallel: ~30s
- Evidence for 12×N claims in parallel: ~2 min
- Synthesize + filter: ~10s
- **Total: ~2.5-3 min, but much higher quality results**

(Slightly faster, WAY better results)

---

## Migration Path

### Phase 1: Implement & Test
```javascript
// 1. Add theme detection function
// 2. Modify claim extraction prompt to be theme-aware
// 3. Add parallel chunk processing
// 4. Implement synthesis + filtering logic
// 5. Test on 5-10 articles, measure:
//    - Claim quality (manual review)
//    - Evidence relevance
//    - Final claim alignment to article theme
```

### Phase 2: Feature Gate
```javascript
// Keep old code, add feature flag:
const USE_THEME_AWARE_EXTRACTION = process.env.THEME_AWARE_EXTRACTION === 'true';

if (USE_THEME_AWARE_EXTRACTION) {
  results = await extractWithThemeAwareness(...);
} else {
  results = await extractLegacy(...);
}
```

### Phase 3: Deprecate Old
- Once verified working, remove bearing-based filtering entirely
- Old approach was experiment; this is the better v2

---

## Open Questions / Refinements

1. **Chunk theme evolution**: Should mini-theme from chunk N influence extraction of chunk N+1? (Yes, probably - use sliding context)

2. **Evidence retrieval bottleneck**: Search gateway gets hammered if we do full evidence for 12×N claims. Options:
   - Limit to top 6 chunks + title
   - Use cheaper "snippet-only" search for some claims
   - Implement search caching across chunks

3. **Deduplication aggressiveness**: Is 0.85 threshold right? Test with 0.80, 0.85, 0.90

4. **Role assignment**: Should claims get `role` (thesis/pillar/evidence/background)? Yes—use in final ranking

5. **Contradictory claims**: If chunk A claims X and chunk B claims ¬X, both could be top-12. Keep both? (Yes, if both well-supported—shows article is self-contradictory)

---

## Success Criteria

✅ Final 12 claims all directly support or challenge the article's main argument  
✅ Each claim has ≥2 sources with quality ≥0.4  
✅ Claims span different pillars/arguments (not all on same sub-topic)  
✅ Processing time < 3 min (same or faster than current)  
✅ Manual review shows 80%+ of final claims are "relevant & important"  
✅ Zero reliance on bearing scores

