# Theme Fusion Integration Guide

## Overview

Theme fusion consolidates chunk-level mini-themes into a final article frame. This is the orchestration point where evidence from multiple chunks "votes" on the final frame, potentially correcting or refining the provisional frame from Prompt 4.

## Pipeline Position

```
┌─────────────────────────────────────────────────────────────┐
│ CHUNK PROCESSING (Multiple chunks in parallel)              │
│                                                             │
│  Chunk 0 ──Prompt 5─→ MiniTheme 0                          │
│  Chunk 1 ──Prompt 5─→ MiniTheme 1                          │
│  Chunk 2 ──Prompt 5─→ MiniTheme 2                          │
│                                                             │
│  (+ relationshipToProvisionalFrame, pillarHints,            │
│   namedAnchors, repeatedPersuasionSignals)                 │
└─────────────────────────────────────────────────────────────┘
                         ↓
                ┌────────────────────┐
                │ THEME FUSION       │
                │ (Single LLM call)  │
                │ [THIS MODULE]      │
                └────────────────────┘
                         ↓
            ┌────────────────────────────┐
            │ FINAL FRAME                │
            │ (for clustering/reducers)  │
            └────────────────────────────┘
```

## Input Schema

Theme fusion receives the consolidation of all chunk survey results:

```javascript
{
  provisionalFrame: string,              // From Prompt 4
  chunkMiniThemes: array,                // From Prompt 5 (all chunks)
  relationshipToProvisionalFrame: array, // How each chunk relates
  pillarHints: array,                    // Pillar hints from chunks
  evaluationCandidateSummaries: array,   // Compact evaluation summaries
  sourceBackgroundCandidateSummaries: array, // Compact background summaries
  namedAnchors: array,                   // Named anchors across chunks
  repeatedPersuasionSignals: array,      // Repeated patterns in evidence
  promptManager: PromptManager,          // Optional, for loading DB prompts
  timeout: number                        // Optional, default 45000ms
}
```

### chunkMiniThemes Example

```javascript
[
  {
    chunkIndex: 0,
    miniThesis: "CO2 emissions are rising exponentially",
    stance: "endorses",
    pillars: [
      { text: "Atmospheric CO2 levels increased 50% since...", strength: 0.9 },
      { text: "Rise correlates with industrial activity", strength: 0.85 }
    ],
    namedAnchors: ["atmospheric_co2", "industrial_baseline"],
    coverageStrength: 0.85
  },
  {
    chunkIndex: 1,
    miniThesis: "Temperature rise is measurable and significant",
    stance: "endorses",
    pillars: [
      { text: "Global mean temperature rose 1.1°C in past 50 years", strength: 0.9 }
    ],
    namedAnchors: ["global_temperature", "recent_decades"],
    coverageStrength: 0.88
  }
]
```

### relationshipToProvisionalFrame Example

```javascript
[
  { chunkIndex: 0, relationship: "directly_supports", alignment: "strong" },
  { chunkIndex: 1, relationship: "directly_supports", alignment: "strong" },
  { chunkIndex: 2, relationship: "complicates_implementation", alignment: "moderate" },
  { chunkIndex: 3, relationship: "tangential", alignment: "weak" }
]
```

Possible relationships:
- `directly_supports` - chunk theme directly backs provisional frame
- `directly_contradicts` - chunk theme refutes provisional frame
- `partially_supports` - chunk theme partially backs provisional frame
- `complicates` - chunk theme adds nuance/complexity
- `tangential` - chunk theme is loosely related
- `orthogonal` - chunk theme is independent

## Output Schema

```javascript
{
  finalThesis: string,                   // Fused thesis from all chunks
  finalStance: "endorses|rejects|mixed|unclear",
  themeShiftFromSeed: "none|narrowed|expanded|replaced|mixed|unclear",
  finalPillars: [
    {
      pillarText: string,                // Pillar claim text
      supportingChunkIndexes: [0, 1, 3], // Which chunks support this
      representativeCandidateIds: ["c0", "c3"], // Key evidence items
      coverageStrength: number           // 0-1 confidence/support
    }
  ],
  dominantNamedAnchors: ["anchor1", "anchor2"], // Most important named anchors
  repeatedPersuasionPatterns: [
    {
      repeatedIdea: string,              // The idea that repeats
      variantCandidateIds: ["c1", "c5"], // Which evidence items instantiate it
      notes: string                      // How it varies across chunks
    }
  ],
  coverageGaps: ["gap1", "gap2"]         // Aspects lacking support
}
```

## Logging

Theme fusion logs THEME_FUSION_COMPLETED with key metrics:

```
THEME_FUSION_COMPLETED | pillars=3 | themeShift=expanded | gaps=2 | anchors=5 | patterns=2
```

Format: `THEME_FUSION_COMPLETED | pillars=<count> | themeShift=<type> | gaps=<count> | anchors=<count> | patterns=<count>`

## Usage Example

```javascript
import { fuseSurveyThemesIntoFrame } from "./themeFusion.js";
import PromptManager from "./promptManager.js";

// After all chunks have been surveyed (Prompt 5 complete)
const finalFrame = await fuseSurveyThemesIntoFrame({
  provisionalFrame: "The article claims X is Y",
  chunkMiniThemes: [miniTheme0, miniTheme1, miniTheme2],
  relationshipToProvisionalFrame: [rel0, rel1, rel2],
  pillarHints: [pillar0, pillar1],
  evaluationCandidateSummaries: [cand0, cand1],
  sourceBackgroundCandidateSummaries: [bg0],
  namedAnchors: ["anchor1", "anchor2"],
  repeatedPersuasionSignals: [pattern0],
  promptManager: promptManager, // Optional
  timeout: 45000
});

// finalFrame now feeds into downstream clustering/reducers
```

## Database Prompt

To customize the fusion prompt via database, create a prompt named `theme_fusion`:

```sql
INSERT INTO llm_prompts (prompt_name, prompt_type, prompt_text, parameters, is_active)
VALUES (
  'theme_fusion',
  'combined',
  'SYSTEM:\n<your system prompt>\n\nUSER:\n<your user prompt with {{variable}} placeholders>',
  '{}',
  TRUE
);
```

Supported template variables:
- `{{provisionalFrame}}`
- `{{chunkCount}}`
- `{{chunkMiniThemesJson}}`
- `{{relationshipToProvisionalFrameJson}}`
- `{{pillarHintsJson}}`
- `{{evaluationCandidateSummariesJson}}`
- `{{sourceBackgroundCandidateSummariesJson}}`
- `{{namedAnchorsJson}}`
- `{{repeatedPersuasionSignalsJson}}`

## Theme Shift Categories

The LLM determines how the final frame differs from the provisional:

- `none` - Final frame matches provisional frame
- `narrowed` - Final frame is more specific than provisional
- `expanded` - Final frame includes more aspects than provisional
- `replaced` - Final frame contradicts provisional frame
- `mixed` - Different chunks support different refinements
- `unclear` - Cannot determine relationship clearly

## Important Notes

1. **No claim persistence**: Theme fusion does not persist claims to any database
2. **No evidence execution**: Theme fusion does not run evidence gathering
3. **Single LLM call**: All fusion happens in one orchestrated LLM request
4. **Mini-themes vote**: The provisional frame is optional guidance; mini-themes determine the final frame
5. **No downstream modification**: Do not modify clustering or reducer steps
6. **Schema validation**: Output is validated against strict schema before return

## Error Handling

If LLM output fails schema validation:
1. An error is logged with validation details
2. The function throws an Error
3. Caller should handle recovery (retry, fallback, etc.)

Example retry pattern:
```javascript
let finalFrame;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    finalFrame = await fuseSurveyThemesIntoFrame(params);
    break;
  } catch (err) {
    if (attempt === 3) throw err;
    logger.warn(`Theme fusion attempt ${attempt} failed, retrying...`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
}
```

## Performance Considerations

- **Chunk count impact**: Input size grows with number of chunks
- **LLM timeout**: Default 45000ms should handle ~5-10 chunks comfortably
- **Concurrency**: Theme fusion must run AFTER all chunk surveys complete
- **Prompt manager**: If provided, loads from database cache (5min TTL)

## Testing

See `backend/test/bearing/themeFusion.test.js` for:
- Basic theme fusion test
- Conflict resolution test
- Coverage analysis test
- Mock prompt manager integration

Run with:
```bash
node backend/test/bearing/themeFusion.test.js
```

## Next Steps

After theme fusion completes:
1. Use `finalFrame` in downstream clustering (if implemented)
2. Use `finalPillars` for canonical claim selection
3. Use `coverageGaps` to identify what evidence is still needed
4. Use `repeatedPersuasionPatterns` to identify key arguments
5. Use `dominantNamedAnchors` for citation/attribution guidance
