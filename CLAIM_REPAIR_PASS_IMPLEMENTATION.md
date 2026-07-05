# Claim Repair Pass Implementation

## Overview

Implemented a feature-gated targeted repair pass for coverage gaps in article evidence processing. This runs after theme fusion and before claim clustering/reduction to generate one additional claim per article that addresses identified coverage gaps.

## Files Created/Modified

### New Files
1. **backend/src/core/claimRepairPass.js** - Core repair pass logic
   - `isClaimRepairPassEnabled(env)` - Check if feature flag enabled
   - `generateRepairClaim(params)` - Generate repair claim for a gap
   - `runTargetedRepairPass(params)` - Main repair pass orchestrator
   - Helper: `findRelevantExcerpts()` - Extract relevant evidence from chunks

2. **backend/test/claimRepairPass.test.js** - Comprehensive test suite (10 tests, all passing)
   - Feature flag checks
   - Disabled state handling
   - Coverage gap detection
   - Repair claim structure validation
   - Empty/missing data handling

### Modified Files
1. **backend/src/core/processTaskClaims.js**
   - Added import: `runTargetedRepairPass`
   - Added Step 3.5: Repair pass invocation after theme fusion (line 242-260)
   - Added repair claim to evaluation clusters before reduction (line 271-281)
   - Added repair pass outcome tracking (line 291-292)
   - Added REPAIR_PASS_COMPLETED logging (line 313-327)

2. **backend/src/core/claimReduction.js**
   - Added `repairPass` flag preservation in selected claims (line 176)
   - Ensures repair claims can be identified in final results

3. **backend/.env.example**
   - Added `CLAIM_REPAIR_PASS=false` configuration flag

## Feature Flow

```
Theme Fusion (Prompt 6)
        ↓
  Repair Pass Check
        ↓
  If CLAIM_REPAIR_PASS=true AND coverageGaps.length > 0:
    - Pick first gap
    - Find relevant excerpts from survey
    - Call LLM with repair prompt
    - Parse repair claim (or null)
        ↓
  Cluster Candidates
        ↓
  If repair claim generated:
    - Add to evaluationClusterGroups
        ↓
  Reduce to Selected Claims
        ↓
  Validate 12-claim cap
        ↓
  Log REPAIR_PASS_COMPLETED
        ↓
  Persist (ONLY reducer outputs)
```

## Key Rules Enforced

1. **Feature Gated**: Disabled by default (`CLAIM_REPAIR_PASS=false`)
   - Only runs if explicitly enabled and coverage gaps exist
   
2. **Single Repair Claim Per Article**: At most one repair claim per run
   - Targets first coverage gap only
   
3. **No Evidence Execution**: Repair pass doesn't run evidence searches
   - Uses existing survey excerpts only
   
4. **Clustering/Reduction Pipeline**: Repair claim goes through full pipeline
   - Subject to 12-claim cap for selectedEvaluationClaims
   - Can be rejected if insufficient importance
   - Goes through same deduplication as other candidates
   
5. **Flagged Claims**: Repair claims marked with `repairPass: true`
   - Can be tracked and analyzed in final results
   
6. **Input Context**: Uses existing data only
   - Final article frame (thesis, pillars, stance)
   - Coverage gaps identified by theme fusion
   - Survey chunk excerpts
   - Current selectedEvaluationClaims (for context)

## Repair Claim Properties

When generated, repair claims have:
```javascript
{
  claimText: "specific factual claim (100-200 chars)",
  roleHint: "evidence",
  importanceToArticleGuess: 0.7,
  importanceInChunk: 0.6,
  noveltyHint: "new",
  rhetoricalFunction: "addresses coverage gap",
  localSourceExcerpt: "relevant excerpt from survey",
  candidateOnly: false,
  claimType: { /* standard claim type flags */ },
  repairPass: true,  // Identifies as repair-generated
  sourceChunkIndex: 0,
  sourceChunkPosition: "middle_body"
}
```

## Logging

The implementation logs:
- `[ClaimRepairPass]` debug logs for each step
- `REPAIR_PASS_COMPLETED | status={status} | repairClaimIncluded={bool} | coverageGaps={count}`

Possible status values:
- `disabled` - Feature flag off
- `none_needed` - No coverage gaps detected
- `attempted` - Attempted but no claim generated
- `added` - Repair claim successfully added to final selection
- `rejected` - Repair claim generated but rejected during reduction
- `none_found` - No relevant excerpts found to support repair

## Testing

All 10 tests passing:
1. Feature flag check
2. Disabled state handling
3. No coverage gaps case
4. Minimal frame handling
5. Disabled repair pass returns null
6. Repair claim structure validation
7. Empty gap description handling
8. Multiple gaps - picks first
9. Repair claim marked with repairPass flag
10. No excerpts available handling

Tests cover:
- Feature flag behavior
- Edge cases (empty data, missing fields)
- Repair claim structure
- Integration with larger pipeline
- Error handling

## Integration Points

1. **After Theme Fusion**: Gets finalFrame with coverageGaps
2. **Before Clustering**: Can inject repair claim into evaluationClusterGroups
3. **Within Reducer**: Repair claims subject to 12-claim cap
4. **Before Persistence**: Only persists selected reducer outputs (standard behavior)

## Future Enhancements

1. **Multiple Repair Claims**: Could extend to generate one claim per gap
2. **Repair Evidence**: Optional: run targeted evidence searches for repair claims
3. **Gap Prioritization**: Score gaps by importance and repair only highest priority
4. **LLM Temperature**: Tune temperature for repair generation
5. **Custom Repair Prompts**: Allow database-driven repair prompts
6. **Repair Metrics**: Track success rate of repair claims vs standard claims

## Configuration

To enable the repair pass feature:
```bash
export CLAIM_REPAIR_PASS=true
```

The feature respects the standard `process.env` pattern used throughout the codebase.
