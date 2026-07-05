# Document-Level Claims Selection Reducers

## Overview

Two document-level reducer functions select high-value claims from clustered candidates for display and evaluation in the workspace.

**Reducer A: selectedEvaluationClaims**
- Selects thesis/pillars/evidence/opposing/critical claims central to evaluating the content
- Max 12 items
- Used to build the evaluation lane in the workspace

**Reducer B: selectedSourceBackgroundClaims**
- Selects useful source/background context claims
- Max configurable (default 12)
- Used to provide source reference context

## Input Data

Both reducers receive:
1. **clusteredCandidates** - Claims from Prompt 7 (assertion clustering), with structure:
   ```javascript
   {
     id: "claim-123",
     text: "The study found a significant correlation.",
     role: "evidence",  // thesis, pillar, pillar_support, evidence, opposing, background, etc.
     argumentFunction: "background",  // For background-marked claims
     centrality: 0.75,  // Estimated centrality to article's main argument (0-1)
     verifiability: 0.80,  // How verifiable is this claim (0-1)
     evaluationEligible: true,  // Can this be used in evaluation?
     verdictEligible: true,  // Is this relevant to final verdict?
     searchEligible: true,  // Should we search for evidence?
     isFallibilityCritical: false,  // Is this critical to the argument's fallibility?
     whyCritical: "",  // Why is it critical?
     
     // Named entities and references
     namedEntities: ["MIT", "Dr. Smith"],
     namedStudiesOrDocuments: ["IPCC Report 2023"],
     dates: ["2023", "1.1°C"],
     
     // Source information
     localSourceExcerpt: "The study found a significant correlation.",
     sourceCitedInArticle: "Smith et al. 2023",
     
     // Search/verification
     searchAssertions: [
       {
         assertion: "study found correlation",
         query: "study correlation findings"
       }
     ]
   }
   ```

2. **finalFrame** (for evaluation reducer only) - Final frame from Prompt 6 (theme fusion), with structure:
   ```javascript
   {
     finalThesis: "Climate change is accelerating.",
     finalStance: "endorses|rejects|mixed|unclear",
     finalPillars: [
       {
         pillarText: "Physical evidence: CO2 and temperature measurements",
         supportingChunkIndexes: [0, 1],
         representativeCandidateIds: ["c2", "c3"],
         coverageStrength: 0.9
       }
     ],
     dominantNamedAnchors: ["CO2", "temperature", "climate change"]
   }
   ```

## Reducer A: selectedEvaluationClaims

### Selection Criteria

Must have:
- `evaluationEligible !== false`
- Not pure background claims (unless marked as critical)

Prefers:
- Claims with clear evaluation roles: thesis, pillar, pillar_support, evidence, opposing, supporting_premise
- Claims referenced in final frame's pillar representative IDs
- Fallibility-critical claims that expose argument weaknesses

### Ranking Dimensions

Claims are scored 0-1 on each dimension, weighted:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Article Centrality | 20% | How central to article's main argument? Thesis=0.95, pillar=0.85-0.90, evidence=0.70, opposing=0.65 |
| Pillar Coverage | 18% | Does this support final pillars? Strong coverage=1.0, in pillar=0.8, weak=0.6 |
| Verification Worthiness | 15% | Is it worth verifying? Based on verifiability + fallibility-criticality bonus |
| Specificity | 14% | Specific and falsifiable vs vague? Bonus for named entities, dates, numbers, studies |
| Novelty | 12% | Novel claim vs repetition? Jaccard similarity check against already-selected |
| Named Anchor Strength | 10% | References strong named entities/documents? Bonus for matching dominant anchors |
| Source Excerpt Quality | 6% | Quality of source excerpt? 0-20 chars=0.2, 50-100=0.6, 200+=1.0 |
| Role Diversity Bonus | 4% | Bonus for diverse claim roles (avoid all evidence, all pillars, etc.) |

Final score applies **redundancy penalty** (0-1): no penalty for <40% similarity with selected claims, full penalty for >100% duplicate.

### Output Format

```javascript
{
  selectedEvaluationClaims: [
    {
      // All original candidate fields + selection metadata
      ...candidate,
      selectedForEvaluation: true,
      evaluationEligible: true,
      verdictEligible: true,
      searchEligible: true,
      visibility: "workspace_eval",
      selectionScore: 0.856,  // Final score (0-1)
      selectionBreakdown: {
        articleCentrality: 0.90,
        pillarCoverage: 0.80,
        // ... other dimensions
      }
    }
  ],
  logs: [
    "[EVALUATION_CLAIMS_SELECTED] Selected 4/12 candidates",
    "[EVALUATION_CLAIMS_SELECTED] Role distribution: ...",
    // ...
  ]
}
```

### Logging

Each reduction logs:
- `[EVALUATION_CLAIMS_SELECTED]` with:
  - Count of selected claims
  - Role distribution (thesis, pillar, evidence, opposing, critical, other)
  - Pillar coverage (how many final pillars are covered)
  - Score range (min-max)

### Example

```javascript
const result = reduceToEvaluationClaims(
  clusteredCandidates,
  finalFrame,
  12  // max claims
);

result.selectedEvaluationClaims.forEach(claim => {
  console.log(`[${claim.role}] ${claim.text} (score: ${claim.selectionScore.toFixed(3)})`);
});
```

## Reducer B: selectedSourceBackgroundClaims

### Selection Criteria

Excludes:
- Already-selected evaluation claims
- Generic filler ("the article says", "this is important")

Prefers:
- Claims marked with `role="background"` or `argumentFunction="background"`
- Named studies, documents, laws, datasets (named studies/documents)
- Named actors/organizations (named entities)
- Dates, numbers, statistics
- Attribution claims (`relationshipType="provenance"` or `isAttribution=true`)
- Citation breadcrumbs linking to studies/documents

### Usefulness Scoring

Claims scored 0-1 by usefulness for source context:

| Category | Points | Examples |
|----------|--------|----------|
| Named studies/documents | +0.4 | IPCC Report, CDC guidelines, peer-reviewed studies |
| Named entities | +0.3 | Researchers, organizations, agencies |
| Attribution claims | +0.2 | "According to Smith et al.", speaker entities |
| Dates/numbers/statistics | +0.15 | "37.5 gigatons in 2023", percentages, measurements |
| Citation breadcrumbs | +0.15 | Links to studies, supplementary materials |
| Source excerpt quality | +0.1 | Good excerpts (>50 chars) |
| **Penalty:** Generic filler | -0.5 | Vague statements without specifics |

### Output Format

```javascript
{
  selectedSourceBackgroundClaims: [
    {
      // All original candidate fields + selection metadata
      ...candidate,
      role: "background",  // Normalized
      argumentFunction: "background",
      selectedForEvaluation: false,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      sourceEligible: true,
      visibility: "workspace_background",
      selectionScore: 0.650  // Usefulness score (0-1)
    }
  ],
  logs: [
    "[BACKGROUND_CLAIMS_SELECTED] Selected 3/12 candidates",
    "[BACKGROUND_CLAIMS_SELECTED] Usefulness distribution: ...",
    // ...
  ]
}
```

### Logging

Each reduction logs:
- `[BACKGROUND_CLAIMS_SELECTED]` with:
  - Count of selected claims
  - Usefulness distribution:
    - named_studies: Count of claims with named studies/documents
    - named_entities: Count with named actors/organizations
    - attribution: Count of attribution claims
    - dates_numbers: Count with dates/numbers/statistics
    - other: Generic or uncategorized background
  - Score range (min-max)

### Example

```javascript
const result = reduceToSourceBackgroundClaims(
  clusteredCandidates,
  evaluationClaims,  // Already selected, to exclude
  12  // max background claims
);

result.selectedSourceBackgroundClaims.forEach(claim => {
  console.log(`Background: ${claim.text} (usefulness: ${claim.selectionScore.toFixed(3)})`);
});
```

## Combined Reduction

Both reducers can be applied together:

```javascript
const result = reduceClaimsForDocumentEvaluation(
  clusteredCandidates,
  finalFrame,
  {
    maxEvaluationClaims: 12,    // Max evaluation claims (default 12)
    maxBackgroundClaims: 12     // Max background claims (default 12)
  }
);

console.log(result.selectedEvaluationClaims.length);      // Evaluation claims selected
console.log(result.selectedSourceBackgroundClaims.length); // Background claims selected
console.log(result.logs);                                 // All logs from both reducers
```

## Logging Output

### Evaluation Claims Log Example

```
[EVALUATION_CLAIMS_REDUCER] Starting reduction with 23 candidates (max: 12)
[EVALUATION_CLAIMS_REDUCER] Filtered to 18 eligible candidates
[EVALUATION_CLAIMS_SELECTED] Selected 12/18 eligible candidates
[EVALUATION_CLAIMS_SELECTED] Role distribution: {"thesis":1,"pillar":2,"evidence":6,"opposing":1,"critical":2,"other":0}
[EVALUATION_CLAIMS_SELECTED] Pillar coverage: 3/3 pillars
[EVALUATION_CLAIMS_SELECTED] Score range: 0.610-0.890
```

### Background Claims Log Example

```
[BACKGROUND_CLAIMS_REDUCER] Starting reduction with 23 candidates (max: 12)
[BACKGROUND_CLAIMS_REDUCER] Filtered to 8 eligible candidates
[BACKGROUND_CLAIMS_SELECTED] Selected 8/8 candidates
[BACKGROUND_CLAIMS_SELECTED] Usefulness distribution: {"named_studies":3,"named_entities":2,"attribution":1,"dates_numbers":2,"other":0}
[BACKGROUND_CLAIMS_SELECTED] Score range: 0.100-0.750
```

## Integration Points

These reducers are designed to be called:
1. **After Prompt 7** (assertion clustering) outputs clustered candidates
2. **After Prompt 6** (theme fusion) outputs the final frame
3. **Before persistence** (do not modify database yet)

Typical flow:
```
Extract claims (Prompt 1-5)
  ↓
Theme fusion into final frame (Prompt 6)
  ↓
Assertion clustering (Prompt 7)
  ↓
Claim selection (THIS FUNCTION) ← You are here
  ↓
Display in workspace
```

## Implementation Details

### Text Similarity (Jaccard on words)

For novelty and redundancy checks, claims are compared using Jaccard similarity:
- Normalize: lowercase, remove punctuation, split on whitespace
- Compute: shared_words / (total_unique_words - shared_words)
- 0.0 = completely different
- 1.0 = identical

### Role Diversity

Tracks count by role type to balance selection:
- `thesis` (max desired: 1)
- `pillar` (max desired: 2)
- `evidence` (max desired: 6)
- `opposing` (max desired: 2)
- `critical` (max desired: 2)
- `other` (unconstrained)

Bonus decreases as more of a type are selected, encouraging diversity.

### Named Anchor Matching

Claims referencing entities that appear frequently across the article (dominant anchors from final frame) get a strength bonus. This helps select claims that use the article's own language and concepts.

## Files

- **Implementation:** `/backend/src/core/claimsSelectionReducers.js`
- **Tests:** `/backend/test/bearing/claimsSelectionReducers.test.js`
- **Documentation:** This file

## Test Coverage

Five test cases verify:
1. ✅ Evaluation claims reduction with diverse roles
2. ✅ Background claims reduction with usefulness ranking
3. ✅ Combined reduction (no overlap between lanes)
4. ✅ Empty candidates handling
5. ✅ Ineligible candidate filtering
