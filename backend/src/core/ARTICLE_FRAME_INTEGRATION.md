# Article Frame Integration (TM v4)

## Overview

The provisional article frame pass is a lightweight pre-chunking analysis that extracts high-level context from an article **before** claim extraction. This frame is NOT persisted and serves only as a seeding context for later chunk-level analysis.

## Pipeline Flow

```
Text Input
  ↓
[Text Audit & Validation]
  ↓
[→ ARTICLE FRAME DETECTION (new)] ← This is the new pass
  │  - Extract: title, byline, first 4k chars, last 2k chars
  │  - Call LLM for frame
  │  - Log ARTICLE_FRAME_SEEDED
  │  - Return frame (not persisted)
  ↓
[Claim Extraction via Chunking]
  │  - Chunk text (6k chars each)
  │  - Run ClaimExtractor.analyzeContent()
  │  - Extract claims from chunks
  ↓
[Filter & Rank Claims]
  │  - Apply quality filters (if comprehensive mode)
  ↓
[Persist Claims]
  └─→ Claims stored in database
```

## Output Schema

The frame detection returns:

```typescript
{
  provisionalThesis: string,           // One-sentence core argument
  provisionalStance: "endorses" | "rejects" | "mixed" | "unclear",
  likelyPillars: string[],             // 3-5 supporting claims/arguments
  likelyOpposingClaims: string[],      // 1-3 counter-arguments acknowledged
  namedAnchors: Array<{
    type: string,                      // person|organization|concept|location|event
    name: string
  }>,
  openQuestions: string[],             // 2-4 unresolved questions
  seedConfidence: number               // 0.0-1.0
}
```

## Usage

### In `processTaskClaims()`

Pass article metadata to enable frame detection:

```javascript
import { processTaskClaims } from "./core/processTaskClaims.js";

const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text: articleBody,
  title: "Article Title",           // Optional
  byline: "By Author Name",         // Optional
  date: "2025-07-05",               // Optional
  headings: ["Section 1", "Section 2"],  // Optional
});
```

If metadata is not available, the frame detection gracefully skips:
```javascript
const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text: articleBody,
  // No title/byline/date → frame uses only article text
});
```

## Logging

Frame detection logs are prefixed with **ARTICLE_FRAME_SEEDED**:

```
✅ [articleFrameDetector] Frame detected (confidence: 0.85)
   Thesis: "The climate crisis is accelerating..."
   Stance: endorses
   Pillars: 3
   Opposing claims: 1
   Named anchors: 3
   Open questions: 2

🎬 ARTICLE_FRAME_SEEDED: {
  "provisionalThesis": "The climate crisis...",
  "provisionalStance": "endorses",
  "likelyPillars": [...],
  "likelyOpposingClaims": [...],
  "namedAnchors": [...],
  "openQuestions": [...],
  "seedConfidence": 0.85
}
```

## Key Design Notes

1. **No Persistence**: The frame is logged for diagnostics but not stored in the database. It's purely a context pass.

2. **Non-Binding**: The frame is provisional. Later chunk-level analysis can and should expand, narrow, contradict, or replace it. It does NOT filter claims.

3. **Graceful Degradation**: If:
   - No LLM is provided → frame detection skipped
   - Text is empty → frame detection skipped
   - LLM fails or returns invalid JSON → logged as warning, pipeline continues

4. **Text Sampling**: The frame detection uses:
   - First 4,000 characters (opening/lede)
   - Last 2,000 characters (conclusion/summary)
   - Article title, byline, date, headings if available

5. **Low Temperature**: Frame detection uses `temperature: 0.3` for stable, deterministic results.

## Example Frame Output

```json
{
  "provisionalThesis": "A new study shows vitamin D deficiency is linked to increased COVID-19 severity",
  "provisionalStance": "endorses",
  "likelyPillars": [
    "Vitamin D receptors regulate immune response",
    "Low vitamin D correlates with worse COVID outcomes",
    "Vitamin D supplementation may reduce risk"
  ],
  "likelyOpposingClaims": [
    "Some studies show weak correlation or causal links unclear"
  ],
  "namedAnchors": [
    { "type": "organization", "name": "NIH" },
    { "type": "person", "name": "Dr. Sarah Chen" },
    { "type": "concept", "name": "SARS-CoV-2" }
  ],
  "openQuestions": [
    "What is the optimal vitamin D level for COVID protection?",
    "How does this apply to vaccinated populations?"
  ],
  "seedConfidence": 0.82
}
```

## Testing

Run tests with:
```bash
node --test backend/test/articleFrameDetector.test.js
```

Tests cover:
- Frame detection with valid LLM
- Handling of missing metadata
- Stance value normalization
- Array field validation
- Confidence bound enforcement
- Error handling (null LLM, invalid response)
- Logging function safety
