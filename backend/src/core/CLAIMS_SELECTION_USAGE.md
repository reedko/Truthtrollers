# Claims Selection Reducers - Quick Usage Guide

## Import

```javascript
import {
  reduceToEvaluationClaims,
  reduceToSourceBackgroundClaims,
  reduceClaimsForDocumentEvaluation,
} from "./claimsSelectionReducers.js";
```

## Basic Usage

### Option 1: Use Combined Reducer (Simplest)

```javascript
const { selectedEvaluationClaims, selectedSourceBackgroundClaims, logs } =
  reduceClaimsForDocumentEvaluation(
    clusteredCandidates,  // From Prompt 7
    finalFrame,           // From Prompt 6
    {
      maxEvaluationClaims: 12,
      maxBackgroundClaims: 12,
    }
  );

// Log all operations
logs.forEach(log => console.log(log));

// Use selected claims
console.log(`Selected ${selectedEvaluationClaims.length} evaluation claims`);
console.log(`Selected ${selectedSourceBackgroundClaims.length} background claims`);
```

### Option 2: Use Individual Reducers

```javascript
// Step 1: Select evaluation claims
const evalResult = reduceToEvaluationClaims(
  clusteredCandidates,
  finalFrame,
  12  // max claims
);

// Step 2: Select background claims (excluding evaluation claims)
const bgResult = reduceToSourceBackgroundClaims(
  clusteredCandidates,
  evalResult.selectedEvaluationClaims,
  12  // max background claims
);

// Log results
console.log(evalResult.logs);
console.log(bgResult.logs);

// Use results
const evaluationClaims = evalResult.selectedEvaluationClaims;
const backgroundClaims = bgResult.selectedSourceBackgroundClaims;
```

## Integration with Claim Processing Pipeline

```javascript
// After Prompt 7 (assertion clustering)
const { clusterIdByIndex, clusters } = clusterAssertions(claimsWithAllMetadata);

// Prepare clustered candidates (with all claim metadata)
const clusteredCandidates = claimsWithAllMetadata.map((claim, index) => ({
  ...claim,
  clusterId: clusterIdByIndex[index],  // From clustering
}));

// After Prompt 6 (theme fusion)
const finalFrame = await fuseSurveyThemesIntoFrame({
  provisionalFrame,
  chunkMiniThemes,
  evaluationCandidateSummaries,
  sourceBackgroundCandidateSummaries,
  // ...other params
});

// NOW: Apply claim selection reducers
const result = reduceClaimsForDocumentEvaluation(
  clusteredCandidates,
  finalFrame,
  {
    maxEvaluationClaims: 12,
    maxBackgroundClaims: 12,
  }
);

// Ready for workspace display
return {
  selectedEvaluationClaims: result.selectedEvaluationClaims,
  selectedSourceBackgroundClaims: result.selectedSourceBackgroundClaims,
  logs: result.logs,
};
```

## Understanding Selection Scores

### Evaluation Claims Score (0-1)

High-scoring evaluation claims (0.7+):
- Referenced in final frame's pillars
- Central to article's argument
- Specific and verifiable
- Novel (not repetitive)
- Reference strong named entities

Low-scoring evaluation claims (0.4-0.6):
- Peripheral to main argument
- Generic or vague
- Similar to already-selected claims

### Background Claims Score (0-1)

High-scoring background claims (0.6+):
- Named studies/documents or entities
- Attribution claims
- With high-quality source excerpts

Low-scoring background claims (0.1-0.3):
- Generic filler (rejected if score ≤0)
- Limited specific references

## Interpreting Logs

### Evaluation Claims Selection Log

```
[EVALUATION_CLAIMS_REDUCER] Starting reduction with 23 candidates (max: 12)
    ↓ Indicates: Total candidates available
    
[EVALUATION_CLAIMS_REDUCER] Filtered to 18 eligible candidates
    ↓ Indicates: Claims passing eligibility checks (not ineligible, have required flags, etc.)
    
[EVALUATION_CLAIMS_SELECTED] Selected 12/18 eligible candidates
    ↓ Indicates: Top-ranked claims selected (rest filtered by score)
    
[EVALUATION_CLAIMS_SELECTED] Role distribution: {"thesis":1,"pillar":2,"evidence":6,"opposing":1,"critical":2,"other":0}
    ↓ Indicates: Diversity of claim types selected
    
[EVALUATION_CLAIMS_SELECTED] Pillar coverage: 3/3 pillars
    ↓ Indicates: How many final pillars have representative claims selected
    
[EVALUATION_CLAIMS_SELECTED] Score range: 0.610-0.890
    ↓ Indicates: Min and max selection scores (lower bound is cutoff score)
```

If pillar coverage < total pillars:
- Some pillars lack representative evidence in the selected set
- Consider checking final frame's pillar definitions
- May indicate weak supporting evidence in the source

### Background Claims Selection Log

```
[BACKGROUND_CLAIMS_SELECTED] Selected 8/8 candidates
    ↓ Indicates: All eligible background candidates met the scoring threshold

[BACKGROUND_CLAIMS_SELECTED] Usefulness distribution: {"named_studies":3,"named_entities":2,"attribution":1,"dates_numbers":2,"other":0}
    ↓ Indicates: Breakdown of how many claims are useful for different reasons
    
    - named_studies: Research papers, datasets, official documents
    - named_entities: Researchers, organizations, agencies
    - attribution: "According to...", speaker entities
    - dates_numbers: Specific dates, statistics, measurements
    - other: Generic background without clear usefulness category
```

Low usefulness distribution warning:
- If all background claims are "other" category, less useful for source context
- Check if original candidates have named entities/studies

## Common Configurations

### Strict Evaluation (Fewer, Higher-Quality Claims)

```javascript
const result = reduceClaimsForDocumentEvaluation(
  clusteredCandidates,
  finalFrame,
  {
    maxEvaluationClaims: 6,    // Reduce from 12
    maxBackgroundClaims: 4,    // Reduce from 12
  }
);
```

Pros: Focused, high-quality selection
Cons: May miss important points

### Comprehensive Evaluation (More Claims for Better Coverage)

```javascript
const result = reduceClaimsForDocumentEvaluation(
  clusteredCandidates,
  finalFrame,
  {
    maxEvaluationClaims: 16,   // Increase from 12
    maxBackgroundClaims: 16,   // Increase from 12
  }
);
```

Pros: Better coverage of complex articles
Cons: More claims to display/process

### Background-Heavy (Strong Source Context)

```javascript
const result = reduceClaimsForDocumentEvaluation(
  clusteredCandidates,
  finalFrame,
  {
    maxEvaluationClaims: 8,
    maxBackgroundClaims: 20,   // Heavy background
  }
);
```

Pros: Rich source context for complex topics
Cons: Less direct evaluation focus

## Debugging Tips

### Few evaluation claims selected?

Check:
1. Are candidates filtered for `evaluationEligible=true`?
2. Do they have clear roles (thesis, pillar, evidence, etc.)?
3. Is the final frame well-formed with finalPillars?
4. Are too many similar claims being penalized for redundancy?

### Few background claims selected?

Check:
1. Do candidates have named entities, studies, or dates?
2. Are they marked `role="background"`?
3. Are they being excluded as already-selected evaluation claims?
4. Are they too generic (triggering generic filler rejection)?

### Unexpected role distribution?

Check:
1. Are input candidates properly tagged with `role` field?
2. Are fallibility-critical claims marked correctly?
3. Is role diversity bonus preventing desired roles?

## Performance Considerations

- Reduction is O(n²) for novelty/redundancy checks on selected claims
- Suitable for articles with up to 100+ clustered candidates
- Typical reduction time: <100ms for 20-50 candidates

For very large candidate sets (100+ items):
- Consider pre-filtering by score threshold
- Use maxEvaluationClaims/maxBackgroundClaims as primary limit
- Redundancy checking only runs on selected claims (small set)

## Testing

Run all tests:
```bash
cd backend
npm run test:bearing -- test/bearing/claimsSelectionReducers.test.js
```

Check test coverage:
- ✅ Diverse role selection for evaluation claims
- ✅ Usefulness-based selection for background claims
- ✅ No overlap between evaluation and background lanes
- ✅ Empty candidate handling
- ✅ Ineligible candidate filtering

## Examples in Tests

See `/backend/test/bearing/claimsSelectionReducers.test.js` for:
1. Real evaluation claims selection with scoring breakdown
2. Background claims selection with usefulness metrics
3. Combined reduction with role distribution
4. Edge cases (empty inputs, filtering)
