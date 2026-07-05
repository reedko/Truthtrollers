# Theme Fusion Quick Reference

## One-Liner

Theme fusion consolidates chunk mini-themes into a final article frame using a single LLM call.

## Import

```javascript
import { fuseSurveyThemesIntoFrame } from "./themeFusion.js";
```

## Basic Call

```javascript
const finalFrame = await fuseSurveyThemesIntoFrame({
  provisionalFrame: "Article claims X is Y",
  chunkMiniThemes: [mini0, mini1, mini2],
  relationshipToProvisionalFrame: [rel0, rel1, rel2],
  pillarHints: [hint0, hint1],
  evaluationCandidateSummaries: [cand0, cand1],
  sourceBackgroundCandidateSummaries: [bg0],
  namedAnchors: ["anchor1", "anchor2"],
  repeatedPersuasionSignals: [pattern0]
});
```

## Call with Database Prompts

```javascript
import PromptManager from "./promptManager.js";

const promptManager = new PromptManager(db);
const finalFrame = await fuseSurveyThemesIntoFrame({
  ...params,
  promptManager,
  timeout: 45000
});
```

## Call with Custom Timeout

```javascript
const finalFrame = await fuseSurveyThemesIntoFrame({
  ...params,
  timeout: 60000 // 60 seconds for large surveys
});
```

## Output Structure

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
      coverageStrength: number // 0-1
    }
  ],
  dominantNamedAnchors: string[],
  repeatedPersuasionPatterns: [
    {
      repeatedIdea: string,
      variantCandidateIds: string[],
      notes: string
    }
  ],
  coverageGaps: string[]
}
```

## Minimal Input (worst case)

```javascript
const finalFrame = await fuseSurveyThemesIntoFrame({
  provisionalFrame: "Some claim",
  chunkMiniThemes: [] // Can be empty but should not be
});
// Other fields will use sensible defaults
```

## Error Handling

```javascript
try {
  const finalFrame = await fuseSurveyThemesIntoFrame(params);
} catch (err) {
  logger.error("Theme fusion failed:", err.message);
  // err can be:
  // - LLM timeout
  // - LLM network error
  // - Schema validation failure
  // - Database prompt load failure (caught but continues with fallback)
}
```

## Input Field Details

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| provisionalFrame | string | Yes | Seed frame from Prompt 4 |
| chunkMiniThemes | array | Yes | Themes from Prompt 5 |
| relationshipToProvisionalFrame | array | No | How chunks relate to seed |
| pillarHints | array | No | Pillar guidance from chunks |
| evaluationCandidateSummaries | array | No | Evidence summaries |
| sourceBackgroundCandidateSummaries | array | No | Background evidence |
| namedAnchors | array | No | Key anchors across chunks |
| repeatedPersuasionSignals | array | No | Repeated patterns |
| promptManager | PromptManager | No | For DB prompts |
| timeout | number | No | LLM timeout in ms (default: 45000) |

## Logging

Watch for:
```
THEME_FUSION_COMPLETED | pillars=3 | themeShift=expanded | gaps=2 | anchors=5 | patterns=2
```

Format: `THEME_FUSION_COMPLETED | pillars=<n> | themeShift=<type> | gaps=<n> | anchors=<n> | patterns=<n>`

## Integration Points

### Before
- Chunk surveys (Prompt 5) must complete
- All survey results must be aggregated

### After
- Use finalPillars for canonical claims
- Use coverageGaps for evidence refinement
- Use themeShiftFromSeed to assess confidence
- Use repeatedPersuasionPatterns for narrative
- Use dominantNamedAnchors for citation

## Testing

```bash
node backend/test/bearing/themeFusion.test.js
```

Tests three scenarios:
1. Basic fusion (agreement)
2. Conflict resolution (disagreement)
3. Coverage analysis (gaps)

## Performance

| Scenario | Time | Timeout |
|----------|------|---------|
| 3 chunks | ~12s | 45s ✓ |
| 5 chunks | ~18s | 45s ✓ |
| 8 chunks | ~25s | 45s ✓ |
| 10 chunks | ~35s | 45s ✓ |
| 15 chunks | ~50s | 60s ✓ |

## Common Patterns

### Access final pillars
```javascript
finalFrame.finalPillars.forEach(pillar => {
  console.log(pillar.pillarText, pillar.coverageStrength);
});
```

### Check for gaps
```javascript
if (finalFrame.coverageGaps.length > 0) {
  logger.warn("Coverage gaps found:", finalFrame.coverageGaps);
}
```

### Detect disagreement
```javascript
if (finalFrame.finalStance === "mixed" || finalFrame.finalStance === "unclear") {
  logger.log("Chunks disagreed significantly");
}
```

### Track frame evolution
```javascript
if (finalFrame.themeShiftFromSeed !== "none") {
  logger.log("Frame changed from seed:", finalFrame.themeShiftFromSeed);
}
```

### Use anchors for citation
```javascript
finalFrame.dominantNamedAnchors.forEach(anchor => {
  // Prioritize citations mentioning this anchor
  const relevantCitations = citations.filter(c => c.mentions(anchor));
  // ...
});
```

## Database Prompt Template

Create or update in `llm_prompts` table:

```sql
{
  prompt_name: 'theme_fusion',
  prompt_type: 'combined',
  prompt_text: 'SYSTEM:\n<system>\n\nUSER:\n<user with {{variables}}>',
  parameters: {}
}
```

Available template variables:
- `{{provisionalFrame}}`
- `{{chunkCount}}`
- `{{chunkMiniThemesJson}}`
- `{{relationshipToProvisionalFrameJson}}`
- `{{pillarHintsJson}}`
- `{{evaluationCandidateSummariesJson}}`
- `{{sourceBackgroundCandidateSummariesJson}}`
- `{{namedAnchorsJson}}`
- `{{repeatedPersuasionSignalsJson}}`

## Troubleshooting

**Q: "LLM output failed schema validation"**
- A: LLM returned invalid JSON or wrong enum values. Check logs for details. Retry or use fallback frame.

**Q: Timeout after 45s**
- A: Too many chunks or complex reasoning. Increase timeout to 60000ms or reduce chunk count.

**Q: finalStance is always "unclear"**
- A: Chunks may disagree significantly. Review miniTheme stances and relationshipToProvisionalFrame.

**Q: coverageGaps is empty but evidence seems incomplete**
- A: LLM may not have identified gaps. Review miniTheme completeness and pillarHints.

**Q: dominantNamedAnchors is empty**
- A: No named anchors provided in input. Make sure namedAnchors array is populated.

## Next: Downstream Integration

After fusion, use finalFrame for:

1. **Claim clustering**: Use finalPillars as canonical claims
2. **Evidence gathering**: Use coverageGaps to refine searches
3. **Narrative generation**: Use finalThesis and repeatedPersuasionPatterns
4. **Citation ranking**: Use dominantNamedAnchors for priority
5. **Confidence scoring**: Use themeShiftFromSeed and pillar coverageStrength

See `THEME_FUSION_INTEGRATION_EXAMPLE.md` for detailed downstream code.

## Related Docs

- `THEME_FUSION_README.md` - Architecture and design decisions
- `THEME_FUSION_INTEGRATION_GUIDE.md` - Full pipeline and schema details
- `THEME_FUSION_INTEGRATION_EXAMPLE.md` - Realistic code examples
- `backend/test/bearing/themeFusion.test.js` - Working test cases
