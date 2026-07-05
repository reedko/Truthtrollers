# Chunk Survey Implementation Summary

## Overview
Modified local chunk extraction to return **survey packets** instead of final claims. Chunks now contain metadata-rich candidate information marked for external processing (not persistence).

## Key Changes

### 1. ClaimExtractor.surveyChunk() — Single Chunk Survey
**File:** `backend/src/core/claimsEngine.js` (lines 844-1010)

**Input:**
```javascript
{
  chunkText,           // The chunk text to analyze
  articleTitle,        // Article title for context
  provisionalFrame,    // Document-level thesis from Prompt 4
  chunkIndex,          // 0-based chunk number
  chunkCount,          // Total chunks in document
  chunkPosition        // lead | early_body | middle_body | late_body | conclusion
}
```

**Output:** Survey packet structure
```javascript
{
  chunkIndex,                 // Number
  chunkPosition,              // String
  chunkMiniTheme,             // Metadata label, NOT a claim
  relationshipToProvisionalFrame, // "supports_seed" | "narrows_seed" | etc.
  pillarHints: [              // Metadata pillars, NOT evaluation candidates
    { pillarText, confidence, supportingExcerpt }
  ],
  evaluationCandidateClaims: [   // 0-6 claims to verify
    {
      claimText,
      roleHint,              // "thesis" | "pillar" | "evidence" | etc.
      importanceInChunk,     // 0-1.0
      importanceToArticleGuess, // 0-1.0
      noveltyHint,           // "new" | "rephrased_repetition" | etc.
      rhetoricalFunction,    // Human-readable role
      localSourceExcerpt,    // Exact phrase from chunk
      namedActors,           // []
      namedStudiesOrDocuments, // []
      namedLawsOrPolicies,   // []
      namedDatasets,         // []
      claimType,             // { attribution, misconduct, causation, ... }
      candidateOnly: true    // ← Mark for non-persistence
    }
  ],
  sourceBackgroundCandidates: [  // 0-2 background facts
    {
      claimText,
      reasonUsefulAsSource,  // Why useful for reference context
      sourceUsefulness,      // "high" | "medium" | "low"
      localSourceExcerpt,
      namedActors,
      namedStudiesOrDocuments,
      namedLawsOrPolicies,
      namedDatasets,
      claimType: { background: true },
      candidateOnly: true    // ← Mark for non-persistence
    }
  ],
  localRepetitionSignals: [      // Repeated themes within chunk
    {
      phraseOrIdea,
      appearsToRepeatEarlierArticleTheme,
      notes
    }
  ]
}
```

**Logging:**
- `[CHUNK_SURVEY_STARTED]` when chunk survey begins
- `[CHUNK_SURVEY_COMPLETED]` with candidate counts when done

### 2. ClaimExtractor.surveyContent() — Parallel Multi-Chunk Survey
**File:** `backend/src/core/claimsEngine.js` (lines 1012-1098)

**Input:**
```javascript
{
  chunks,              // Array of { text, tokenLength }
  articleTitle,        // Article title
  provisionalFrame,    // Document frame
  maxConcurrency = 3   // Max parallel workers
}
```

**Features:**
- Bounded concurrency worker pool (same pattern as `analyzeContent()`)
- Automatic chunk position determination based on article structure
- Error handling: returns minimal error packets on failure
- Returns array indexed by chunkIndex

### 3. surveyTaskContent() — Public API
**File:** `backend/src/core/processTaskClaims.js` (lines 299-385)

**Input:**
```javascript
{
  taskContentId,           // Content identifier
  text,                    // Article text
  articleTitle = "",       // For context
  provisionalFrame = "",   // Thesis candidate
  maxConcurrency = 3       // Parallel limit
}
```

**Output:**
```javascript
{
  chunkSurveys,                  // Array of survey packets
  totalChunks,                   // Count of chunks surveyed
  totalEvaluationCandidates,     // Sum across all chunks
  totalBackgroundCandidates      // Sum across all chunks
}
```

**Behavior:**
- No persistence to database
- No evidence engine calls
- All candidates marked `candidateOnly: true`
- Logs with `[surveyTaskContent]` prefix

## Key Constraints Enforced

✅ **No Persistence:** surveyTaskContent never calls `persistClaims()`
✅ **No Evidence:** No calls to evidence engine or search functions
✅ **Candidate Marking:** Every record has `candidateOnly: true`
✅ **Limits:** evaluationCandidateClaims capped at 6; sourceBackgroundCandidates capped at 2
✅ **Concurrency:** Worker pool with configurable `maxConcurrency`
✅ **Metadata Boundaries:** Mini-themes and pillar hints are NOT claims
✅ **Logging:** All chunk surveys logged with START/COMPLETED markers

## Integration Points

### Ready to Call From:
- Routes needing preliminary claim metadata (without persistence)
- Document analysis pipelines before main extraction
- Claim validation workflows
- Relevance assessment pre-processing

### Expected Usage:
```javascript
import { surveyTaskContent } from "./core/processTaskClaims.js";

const surveys = await surveyTaskContent({
  taskContentId: contentId,
  text: articleBody,
  articleTitle: "Article Title",
  provisionalFrame: "Main argument from Prompt 4",
  maxConcurrency: 3
});

// surveys.chunkSurveys[0].evaluationCandidateClaims → proposals to verify
// surveys.chunkSurveys[0].sourceBackgroundCandidates → reference context
// surveyPackets[i].candidateOnly === true → never persist directly
```

## Testing
Unit test file created: `backend/test/survey/chunkSurvey.test.js`
- Tests survey packet structure validity
- Verifies candidateOnly marking
- Validates concurrency behavior
- Tests position determination

## Files Modified
- `backend/src/core/claimsEngine.js` — Added surveyChunk() and surveyContent()
- `backend/src/core/processTaskClaims.js` — Added surveyTaskContent()

## Files Created
- `backend/test/survey/chunkSurvey.test.js` — Unit tests
