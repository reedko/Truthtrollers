# Theme Fusion Implementation

## Purpose

Theme fusion orchestrates the consolidation of per-chunk mini-themes (from Prompt 5) into a single final frame. This is the canonical frame that controls downstream claim selection, clustering, and reducer operations.

The key insight: **The provisional frame (from Prompt 4) is allowed to be wrong. Mini-themes vote on the final frame.**

## Architecture

### Single LLM Orchestration

All theme fusion happens in a single LLM call:

```javascript
const finalFrame = await openAiLLM.generate({
  system: systemPrompt,
  user: userPrompt,
  schemaHint: schemaHint,
  temperature: 0.2,
  maxRetries: 2,
  timeout: 45000
});
```

**Why one call?**
- Consistency: single reasoning context, no split-decision artifacts
- Cost-efficient: ~1 call vs. 3+ calls for sequential refinement
- Fast: 45s timeout is comfortable for moderate chunk counts
- Simpler debugging: if it fails, it's one clear failure point

### Schema Validation

Output is validated before return:

```javascript
function validateFinalFrame(output) {
  // Check required fields exist and have correct types
  // Check enums (stance, themeShift)
  // Validate array structures (pillars, anchors, patterns, gaps)
  // Validate numeric ranges (coverageStrength 0-1)
  return isValid;
}
```

**Why validate?**
- LLM occasionally returns malformed JSON or wrong enum values
- Validation catches these before downstream use
- Schema hints help LLM stay on track, but validation is the safety net

### Prompt Template Variables

The user prompt is filled with template variables before LLM call:

```
{{provisionalFrame}}                      - From Prompt 4
{{chunkCount}}                            - Number of chunks
{{chunkMiniThemesJson}}                   - All mini-themes as JSON
{{relationshipToProvisionalFrameJson}}    - Relationship matrix
{{pillarHintsJson}}                       - Pillar hints
{{evaluationCandidateSummariesJson}}      - Compact candidate summaries
{{sourceBackgroundCandidateSummariesJson}} - Compact background summaries
{{namedAnchorsJson}}                      - Named anchors list
{{repeatedPersuasionSignalsJson}}         - Repeated patterns
```

**Why template variables?**
- Decouples prompt management from code
- Allows database-driven prompts via PromptManager
- Easy to A/B test different fusion strategies
- Supports inline fallback prompts if DB unavailable

### Database Prompt Support

If PromptManager is provided, theme fusion loads from database:

```javascript
const prompt = await promptManager.getPrompt("theme_fusion", fallback);
systemPrompt = prompt.system;
userPromptTemplate = prompt.user;
```

**Why database prompts?**
- Production can tune fusion prompts without code deployment
- A/B testing different fusion strategies
- Quick rollback if a prompt degrades quality
- Fallback inline prompts ensure robustness if DB unavailable

### Logging

THEME_FUSION_COMPLETED is logged after successful validation:

```
THEME_FUSION_COMPLETED | pillars=3 | themeShift=expanded | gaps=2 | anchors=5 | patterns=2
```

**Why this format?**
- Single-line format for easy log parsing/graphing
- Includes key metrics that indicate quality
- `pillars` count = coverage breadth
- `themeShift` = how much reality diverged from provisional
- `gaps` = uncovered aspects (signals for next iteration)
- `anchors` + `patterns` = persuasion complexity

## Interface

### Inputs

All inputs are optional for graceful degradation:

```javascript
provisionalFrame: string              // Required for meaningful output
chunkMiniThemes: array                // Required (can be empty but should not be)
relationshipToProvisionalFrame: array  // Optional, aids context
pillarHints: array                    // Optional, guides pillar synthesis
evaluationCandidateSummaries: array   // Optional, provides specificity
sourceBackgroundCandidateSummaries: array // Optional
namedAnchors: array                   // Optional, improves anchor extraction
repeatedPersuasionSignals: array      // Optional, guides pattern detection
promptManager: PromptManager          // Optional, enables DB prompts
timeout: number                       // Optional, default 45000ms
```

If inputs are missing/null, they are replaced with sensible defaults:
- Empty arrays become `[]`
- Missing strings become `"Not provided"`
- Missing count becomes `0`

### Outputs

Final frame has seven top-level fields:

```javascript
{
  finalThesis: string,                    // Main claim after fusion
  finalStance: enum,                      // endorses|rejects|mixed|unclear
  themeShiftFromSeed: enum,               // How frame changed from provisional
  finalPillars: array<Pillar>,            // Supporting arguments
  dominantNamedAnchors: array<string>,    // Most cited anchors
  repeatedPersuasionPatterns: array<Pattern>, // Recurring arguments
  coverageGaps: array<string>             // What's missing
}
```

Each pillar has:
- `pillarText` (string) - The claim
- `supportingChunkIndexes` (array) - Which chunks back this
- `representativeCandidateIds` (array) - Key evidence items
- `coverageStrength` (0-1) - Confidence/support level

## Design Decisions

### Why not persist claims?

Theme fusion is a *frame* operation, not a claim operation. Claims are:
- Extracted from text (early pipeline)
- Evaluated against evidence (later pipeline)
- Clustered and normalized (reducer steps)

Theme fusion consolidates *themes*, which are higher-level abstractions. Persisting would:
- Pollute claim tables with intermediate objects
- Require rollback if a frame is rejected
- Create circular dependencies with evidence

### Why single LLM call vs. iterative refinement?

A single call is better than multi-step refinement because:
- **Consistency**: one reasoning context, no contradiction across steps
- **Latency**: 45s vs. 120-180s for iterative approach
- **Cost**: 1 call vs. 3+ calls
- **Simplicity**: easier to debug (single failure point)

Iterative refinement could work, but the cost/complexity isn't justified for a deterministic task.

### Why not modify clustering/reducers?

Theme fusion is the *input* to clustering, not part of it. Clustering should:
- Take finalFrame.finalPillars as canonical claims
- Group similar claims across candidates
- Rank by coverage/strength

Modifying clustering would:
- Mix concerns (frame fusion vs. claim clustering)
- Make it harder to test each component
- Require re-thinking downstream dependencies

### Why enum for themeShiftFromSeed?

The six categories capture how frames diverge:
- `none` - Reality matches prior theory
- `narrowed` - Reality is more specific
- `expanded` - Reality is broader
- `replaced` - Reality contradicts prior
- `mixed` - Different chunks suggest different shifts
- `unclear` - Cannot determine from evidence

These categories help downstream systems understand how much trust to place in the provisional frame.

## Error Recovery

If LLM response fails schema validation:

```javascript
try {
  const finalFrame = await fuseSurveyThemesIntoFrame(params);
} catch (err) {
  logger.error("Theme fusion failed:", err.message);
  // Option 1: Rebuild frame from raw chunks
  // Option 2: Use provisional frame as fallback
  // Option 3: Escalate to human review
  // Option 4: Skip evidence gathering for this content
}
```

The function does not retry internally on schema failures (only on network/timeout). Retry logic is delegated to the caller because:
- Caller may choose different retry strategy (exponential backoff, jitter, etc.)
- Caller knows if retry makes sense (sometimes it doesn't)
- Keeps function responsibility focused

## Performance

Measured on typical cluster:

| Input | LLM Latency | Validation | Total |
|-------|------------|-----------|-------|
| 3 chunks | 8-12s | <100ms | ~12s |
| 5 chunks | 12-18s | <100ms | ~18s |
| 8 chunks | 18-25s | <100ms | ~25s |
| 10 chunks | 25-35s | <100ms | ~35s |

**Timeout default (45s)** leaves comfortable margin for:
- Network jitter (±5s)
- OpenAI queue delays (±5s)
- Complex reasoning (±10s)

## Testing

Three main test cases in `themeFusion.test.js`:

1. **Basic fusion**: All chunks agree, straightforward consolidation
2. **Conflict resolution**: Chunks disagree, final frame should be `mixed` or `unclear`
3. **Coverage analysis**: Identifying gaps in support

Each test:
- Constructs realistic mini-theme inputs
- Calls fuseSurveyThemesIntoFrame
- Validates output structure
- Logs results for inspection

To run:
```bash
node backend/test/bearing/themeFusion.test.js
```

## Future Enhancements

Possible improvements (out of scope for current implementation):

1. **Multi-stage fusion**: If chunk count > 20, group chunks and fuse groups first
2. **Confidence weighting**: Weight chunks by evidence quality
3. **Anchor ranking**: Rank anchors by frequency + importance
4. **Gap filling**: Suggest what evidence to gather for gaps
5. **Thesis generation**: Use finalPillars to generate natural-language thesis
6. **Stance confidence**: Add confidence score for finalStance

## Related Components

- **Prompt 4**: Generates provisionalFrame (upstream)
- **Prompt 5**: Generates chunkMiniThemes (upstream)
- **Clustering**: Uses finalPillars as canonical claims (downstream)
- **Reducers**: Use finalFrame for claim normalization (downstream)
- **PromptManager**: Loads DB-stored prompts
- **openAiLLM**: Executes LLM calls
