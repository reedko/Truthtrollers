# Theme Fusion Integration Example

This document shows where theme fusion fits in the actual processing pipeline and provides realistic code examples.

## Integration Point: After Chunk Surveys Complete

Theme fusion runs after all chunks have been surveyed (Prompt 5 complete). It's called from the orchestration layer that:
1. Dispatches survey work to chunks in parallel
2. Collects all chunk results
3. Calls theme fusion to consolidate
4. Passes final frame to downstream (clustering, reducers, etc.)

## High-Level Integration Pattern

```javascript
// In your chunk orchestration (e.g., runEvidenceEngine.js or similar)

import { fuseSurveyThemesIntoFrame } from "./themeFusion.js";
import PromptManager from "./promptManager.js";
import logger from "../utils/logger.js";

async function processChunksAndFuseThemes(content, query, db) {
  // Step 1: Get or create provisional frame (Prompt 4)
  const provisionalFrame = await generateProvisionalFrame(content);
  logger.log("[Orchestration] Provisional frame:", provisionalFrame);

  // Step 2: Survey each chunk in parallel (Prompt 5)
  const chunkSurveyPromises = content.chunks.map((chunk, idx) =>
    surveyChunk(chunk, provisionalFrame, idx, db)
  );
  
  const chunkSurveyResults = await Promise.all(chunkSurveyPromises);
  logger.log("[Orchestration] Chunk surveys complete:", chunkSurveyResults.length);

  // Step 3: Aggregate survey results into consolidated inputs
  const aggregatedInputs = aggregateChunkSurveys(
    provisionalFrame,
    chunkSurveyResults
  );

  // Step 4: Fuse themes into final frame (THIS MODULE)
  const promptManager = new PromptManager(db);
  const finalFrame = await fuseSurveyThemesIntoFrame({
    ...aggregatedInputs,
    promptManager,
    timeout: 45000
  });
  
  logger.log("[Orchestration] Theme fusion complete");
  logger.log("[Orchestration] Final thesis:", finalFrame.finalThesis);
  logger.log("[Orchestration] Final stance:", finalFrame.finalStance);

  // Step 5: Pass final frame to downstream (clustering, reducers, etc.)
  await processDownstream(finalFrame, content, db);
}

// Helper: aggregate survey results into theme fusion inputs
function aggregateChunkSurveys(provisionalFrame, surveyResults) {
  const chunkMiniThemes = surveyResults.map(r => r.miniTheme);
  const relationshipToProvisionalFrame = surveyResults.map(r => r.relationship);
  const pillarHints = surveyResults.flatMap(r => r.pillarHints || []);
  const evaluationCandidateSummaries = surveyResults.flatMap(r => r.evaluationCandidates || []);
  const sourceBackgroundCandidateSummaries = surveyResults.flatMap(r => r.backgroundCandidates || []);
  const namedAnchors = [...new Set(
    surveyResults.flatMap(r => r.namedAnchors || [])
  )];
  const repeatedPersuasionSignals = aggregateRepeatPatterns(surveyResults);

  return {
    provisionalFrame,
    chunkMiniThemes,
    relationshipToProvisionalFrame,
    pillarHints,
    evaluationCandidateSummaries,
    sourceBackgroundCandidateSummaries,
    namedAnchors,
    repeatedPersuasionSignals
  };
}

// Helper: aggregate repeated persuasion patterns
function aggregateRepeatPatterns(surveyResults) {
  const patternMap = new Map();

  for (const result of surveyResults) {
    for (const pattern of result.repeatedPatterns || []) {
      const key = pattern.idea;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          idea: pattern.idea,
          occurrences: 0,
          variantIds: []
        });
      }
      const entry = patternMap.get(key);
      entry.occurrences += 1;
      entry.variantIds.push(...(pattern.variantIds || []));
    }
  }

  // Return only patterns that appear multiple times
  return Array.from(patternMap.values())
    .filter(p => p.occurrences > 1)
    .map(p => ({
      ...p,
      variantIds: [...new Set(p.variantIds)] // Deduplicate
    }));
}
```

## Realistic chunk survey result structure

Each chunk survey returns something like:

```javascript
{
  chunkIndex: 0,
  miniTheme: {
    chunkIndex: 0,
    miniThesis: "CO2 levels are rising due to human activity",
    stance: "endorses",
    pillars: [
      {
        text: "Atmospheric CO2 increased from 280 to 420 ppm since industrialization",
        strength: 0.92,
        sources: ["NOAA", "IPCC"]
      },
      {
        text: "Anthropogenic emissions account for ~100% of recent increase",
        strength: 0.88,
        sources: ["IPCC AR6"]
      }
    ],
    namedAnchors: [
      "atmospheric_co2_ppm",
      "pre_industrial_baseline",
      "anthropogenic_emissions"
    ],
    coverageStrength: 0.90
  },
  relationship: {
    chunkIndex: 0,
    relationship: "directly_supports",
    alignment: "strong",
    explanation: "This chunk provides the core evidence for rising emissions"
  },
  pillarHints: [
    {
      text: "Historical CO2 measurements from ice cores and modern monitoring",
      source: "chunk_0",
      priority: 1
    }
  ],
  evaluationCandidates: [
    {
      candidateId: "c0_0",
      claimText: "CO2 increased 280→420 ppm",
      stance: "endorses",
      strength: 0.92,
      source: "NOAA atmospheric data"
    }
  ],
  backgroundCandidates: [
    {
      candidateId: "bg0_0",
      description: "Historical context on industrialization period",
      relevance: 0.75
    }
  ],
  repeatedPatterns: [
    {
      idea: "Correlation between emissions and atmosphere CO2",
      occurrences: 1,
      variantIds: ["c0_0"]
    }
  ]
}
```

## Final Frame Usage Downstream

After fusion completes, the final frame is used for:

### 1. Canonical Claim Selection

```javascript
// In clustering/reducer stage
async function selectCanonicalClaims(finalFrame, allCandidates) {
  // Use finalPillars as the canonical claims
  const canonicalClaims = finalFrame.finalPillars.map(pillar => {
    // Find candidate evidence that supports this pillar
    const supportingCandidates = pillar.representativeCandidateIds
      .map(id => findCandidateById(id, allCandidates))
      .filter(Boolean);
    
    return {
      pillarText: pillar.pillarText,
      supportingCandidates: supportingCandidates,
      strength: pillar.coverageStrength
    };
  });

  return canonicalClaims;
}
```

### 2. Coverage Gap Analysis

```javascript
// In evidence gathering refinement
async function refineCoverageGaps(finalFrame, existingEvidence) {
  // Use coverageGaps to identify what still needs evidence
  for (const gap of finalFrame.coverageGaps) {
    logger.log(`[Coverage] Gap identified: ${gap}`);
    
    // Option 1: Schedule more searches for this gap
    const newQueries = generateQueriesForGap(gap, finalFrame);
    await scheduleEvidenceGathering(newQueries);
    
    // Option 2: Flag for human review
    // Option 3: Adjust confidence scoring
  }
}
```

### 3. Persuasion Pattern Detection

```javascript
// In narrative generation or claim ranking
function rankClaimsByPersuasion(claims, finalFrame) {
  return claims.map(claim => {
    // Check if this claim instantiates a repeated pattern
    const matchingPatterns = finalFrame.repeatedPersuasionPatterns.filter(
      pattern => matchesPattern(claim, pattern)
    );
    
    const persuasionScore = matchingPatterns.length > 0 ? 0.9 : 0.5;
    
    return {
      ...claim,
      persuasionScore,
      repeatedPatterns: matchingPatterns
    };
  });
}
```

### 4. Named Anchor Prioritization

```javascript
// In citation/attribution handling
function prioritizeAnchors(referenceList, finalFrame) {
  return referenceList
    .map(ref => ({
      ...ref,
      isDominantAnchor: finalFrame.dominantNamedAnchors.includes(ref.anchorName),
      anchorPriority: finalFrame.dominantNamedAnchors.indexOf(ref.anchorName) + 1
    }))
    .sort((a, b) => {
      // Dominant anchors first
      if (a.isDominantAnchor && !b.isDominantAnchor) return -1;
      if (!a.isDominantAnchor && b.isDominantAnchor) return 1;
      // Within dominants/non-dominants, sort by priority
      return a.anchorPriority - b.anchorPriority;
    });
}
```

### 5. Thesis Generation

```javascript
// In final output generation
async function generateNarrativeOutput(finalFrame, finalPillars) {
  // Use finalThesis and finalStance as base narrative
  const output = {
    mainThesis: finalFrame.finalThesis,
    stance: finalFrame.finalStance,
    themeEvolution: finalFrame.themeShiftFromSeed,
    
    // Organize pillars by strength
    supportingArguments: finalFrame.finalPillars
      .sort((a, b) => b.coverageStrength - a.coverageStrength)
      .map(pillar => ({
        text: pillar.pillarText,
        strength: `${Math.round(pillar.coverageStrength * 100)}%`,
        evidence: pillar.representativeCandidateIds
      })),
    
    // Call out missing pieces
    gaps: finalFrame.coverageGaps,
    
    // Highlight key reasoning patterns
    keyArguments: finalFrame.repeatedPersuasionPatterns
      .map(pattern => ({
        idea: pattern.repeatedIdea,
        variations: pattern.variantCandidateIds.length,
        note: pattern.notes
      }))
  };

  return output;
}
```

## Error Handling in Integration

```javascript
async function processChunksAndFuseThemesWithErrorHandling(content, query, db) {
  try {
    const provisionalFrame = await generateProvisionalFrame(content);
    const surveyResults = await surveyAllChunks(content, provisionalFrame, db);
    const aggregatedInputs = aggregateChunkSurveys(provisionalFrame, surveyResults);
    
    const promptManager = new PromptManager(db);
    
    let finalFrame;
    let retryCount = 0;
    
    while (retryCount < 3) {
      try {
        finalFrame = await fuseSurveyThemesIntoFrame({
          ...aggregatedInputs,
          promptManager,
          timeout: 45000
        });
        break; // Success!
      } catch (err) {
        retryCount++;
        logger.warn(`[Orchestration] Theme fusion attempt ${retryCount}/3 failed:`, err.message);
        
        if (retryCount >= 3) {
          // Option 1: Use provisional frame as fallback
          logger.error("[Orchestration] Theme fusion failed 3 times, using provisional frame");
          finalFrame = buildFallbackFrame(provisionalFrame, surveyResults);
          break;
          
          // Option 2: Flag content for manual review
          // flagForManualReview(content, "Theme fusion failure");
          // throw err;
        }
        
        // Exponential backoff
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retryCount - 1)));
      }
    }
    
    await processDownstream(finalFrame, content, db);
    return finalFrame;
    
  } catch (err) {
    logger.error("[Orchestration] Fatal error:", err.message);
    throw err;
  }
}

// Fallback frame builder
function buildFallbackFrame(provisionalFrame, surveyResults) {
  // Simple fallback: aggregate mini-themes without full LLM fusion
  const stances = surveyResults.map(r => r.miniTheme.stance);
  const majorityStance = getMajority(stances) || "unclear";
  
  return {
    finalThesis: provisionalFrame || "Unable to determine thesis",
    finalStance: majorityStance,
    themeShiftFromSeed: "unclear",
    finalPillars: surveyResults
      .flatMap(r => r.miniTheme.pillars)
      .slice(0, 5) // Top 5 pillars
      .map((p, idx) => ({
        pillarText: p.text,
        supportingChunkIndexes: [0], // Approximate
        representativeCandidateIds: [],
        coverageStrength: p.strength || 0.5
      })),
    dominantNamedAnchors: [...new Set(
      surveyResults.flatMap(r => r.miniTheme.namedAnchors || [])
    )].slice(0, 5),
    repeatedPersuasionPatterns: [],
    coverageGaps: ["Theme fusion failed; frame is approximate"]
  };
}
```

## Configuration and Tuning

For production, consider:

1. **Database prompt tuning**: Update `llm_prompts` table with custom `theme_fusion` prompt
2. **Timeout adjustment**: Increase to 60000ms if chunks > 10
3. **Temperature tuning**: Try 0.1-0.3 depending on chunk consistency
4. **Retry strategy**: Adjust based on observed LLM failure rates

Example prompt update:

```sql
UPDATE llm_prompts
SET prompt_text = 'SYSTEM:\n<your custom system prompt>\n\nUSER:\n<your custom user prompt>'
WHERE prompt_name = 'theme_fusion' AND is_active = TRUE;
```

## Monitoring

Track these metrics for health:

```javascript
// After fusion succeeds
recordMetric("theme_fusion.success", 1);
recordMetric("theme_fusion.pillar_count", finalFrame.finalPillars.length);
recordMetric("theme_fusion.gap_count", finalFrame.coverageGaps.length);
recordMetric("theme_fusion.anchor_count", finalFrame.dominantNamedAnchors.length);
recordMetric("theme_fusion.pattern_count", finalFrame.repeatedPersuasionPatterns.length);

// Track theme shifts (interesting for quality analysis)
recordMetric(`theme_fusion.shift.${finalFrame.themeShiftFromSeed}`, 1);

// After fusion fails
recordMetric("theme_fusion.failure", 1);
recordMetric("theme_fusion.failure_reason", error.code || "unknown");
```

This allows dashboards to monitor:
- Success rate of theme fusion
- Distribution of theme shifts (are we narrowing or expanding much?)
- Gap frequency (are there persistent uncovered areas?)
- Pattern complexity (are claims repetitive?)
