# Scoring System Alignment with GameSpace

## Overview

All scoring systems in TruthTrollers now use **consistent scales** aligned with GameSpace:

- **0-10 scale** for source quality scores (matches GameSpace points)
- **0.0-1.0 scale** for claim properties and relevance
- **-10 to +10 scale** for GameSpace points earned

## GameSpace Points System (Reference)

From `dashboard/src/services/gameScoring.ts`:

```typescript
/**
 * Calculate points earned for linking a reference claim to a task claim
 * @param aiVeracityScore - AI's truth rating for the reference claim (-100 to +100)
 * @param userStance - User's assigned stance/support_level (-1.2 to +1.2)
 * @returns Points earned (max 10, can be negative)
 */
export function calculateLinkPoints(aiVeracityScore: number, userStance: number): number {
  const normalizedAIScore = (aiVeracityScore / 100) * 1.2;
  const difference = Math.abs(normalizedAIScore - userStance);
  const maxPoints = 10;
  const maxDifference = 2.4;
  const points = maxPoints - (difference / maxDifference) * (maxPoints * 2);
  return Math.round(points * 10) / 10; // Round to 1 decimal
}
```

**Key properties:**
- Max points: **10** (perfect match)
- Min points: **-10** (worst mismatch)
- Rounded to 1 decimal place (e.g., 7.3, -2.5)

## Source Quality Scoring (Updated to Match)

From `backend/src/core/sourceQualityScorer.js`:

### Individual Dimension Scores
All dimensions now use **0-10 scale** (not 0-100):

**Quality dimensions (0-10, higher = better):**
- author_transparency
- publisher_transparency
- evidence_density
- claim_specificity
- correction_behavior
- domain_reputation
- original_reporting

**Risk dimensions (0-10, higher = riskier):**
- sensationalism_score
- monetization_pressure

### Aggregate Scores
```javascript
// Weighted average calculation returns 0-10 scale
calculateQualityScore(scores) {
  // ... weighted averaging ...
  return Math.round((weightedSum / totalWeight) * 10) / 10; // 0-10, 1 decimal
}
```

**Example scores:**
- quality_score: **7.8** (good quality)
- risk_score: **2.3** (low risk)

### Quality Tier Classification
```javascript
// Updated thresholds for 0-10 scale
if (quality_score > 7.0 && risk_score < 3.0) return 'high';
if (quality_score < 4.0 || risk_score > 7.0) return 'unreliable';
if (quality_score < 5.0) return 'low';
return 'mid';
```

## Claim Property Scores

From `backend/src/core/claimEvaluationClassifier.js`:

These use **0.0-1.0 scale** (probabilities/fractions):
- claim_centrality (0.0-1.0)
- claim_specificity (0.0-1.0)
- claim_consequence (0.0-1.0)
- claim_contestability (0.0-1.0)
- claim_novelty (0.0-1.0)

**Rationale:** These are property measurements, not point scores, so 0-1 probability scale is appropriate.

## Evidence Weighting

From `backend/src/core/claimTriageEngine.js`:

```javascript
calculateEvidenceMass(retrievedSources) {
  for (const source of retrievedSources) {
    const relevance = source.relevance_score || 0; // 0-1 scale
    const quality = (source.source_quality_score || 5.0) / 10; // Normalize 0-10 to 0-1
    totalMass += relevance * quality;
  }
  return totalMass;
}
```

**Quality-weighted evidence mass** = Sum of (relevance × normalized_quality)

## Database Schema

From `backend/migrations/add_claim_triage_system.sql`:

### source_quality_scores table
```sql
-- All dimensions use DECIMAL(4,1) for 0.0-10.0 range
author_transparency DECIMAL(4,1)      -- e.g., 7.5
publisher_transparency DECIMAL(4,1)   -- e.g., 8.2
evidence_density DECIMAL(4,1)         -- e.g., 6.3
...
quality_score DECIMAL(4,1)            -- e.g., 7.8
risk_score DECIMAL(4,1)               -- e.g., 2.3
```

### claims table (triage fields)
```sql
-- Claim properties use DECIMAL(3,2) for 0.00-1.00 range
claim_centrality DECIMAL(3,2)         -- e.g., 0.85
claim_specificity DECIMAL(3,2)        -- e.g., 0.72
claim_consequence DECIMAL(3,2)        -- e.g., 0.90
...
```

### claim_retrieval_evidence table
```sql
-- Relevance uses DECIMAL(4,3) for 0.000-1.000 range
relevance_score DECIMAL(4,3)          -- e.g., 0.872

-- Quality uses DECIMAL(4,1) for 0.0-10.0 range
source_quality_score DECIMAL(4,1)     -- e.g., 7.5
```

## Comparison with GameSpace

| System | Scale | Example | Use Case |
|--------|-------|---------|----------|
| **GameSpace points** | -10 to +10 | +7.3, -2.5 | Reward/penalty for user actions |
| **Source quality** | 0 to 10 | 7.8, 2.3 | Quality/risk assessment |
| **Claim properties** | 0.0 to 1.0 | 0.85, 0.72 | Property measurements |
| **Relevance** | 0.0 to 1.0 | 0.872 | Similarity/match scores |

## Why This Alignment Matters

### 1. **Cognitive Consistency**
Users see the same 0-10 scale everywhere:
- GameSpace: "You earned **7.3 points**"
- Source quality: "This source scores **7.8** for quality"
- Evidence weight: Combines relevance (0-1) with quality (0-10, normalized)

### 2. **Direct Comparability**
Source quality scores can be directly compared to GameSpace points:
- High quality source (8.5) = like earning high points
- Low quality source (2.3) = like losing points

### 3. **Unified Mental Model**
- **10 = excellent** (best possible)
- **5 = average** (neutral/medium)
- **0 = terrible** (worst possible)

### 4. **Database Efficiency**
- DECIMAL(4,1) stores 0.0-10.0 efficiently
- Same precision as GameSpace (1 decimal place)
- No need for conversion in queries

## Code Examples

### Frontend Display (consistent formatting)
```typescript
// GameSpace points
const points = calculateLinkPoints(aiScore, userStance); // -10 to +10
console.log(`Points: ${points >= 0 ? '+' : ''}${points.toFixed(1)}`);
// Output: "Points: +7.3"

// Source quality
const quality = sourceQualityScore; // 0-10
console.log(`Quality: ${quality.toFixed(1)}/10`);
// Output: "Quality: 7.8/10"

// Both use same .toFixed(1) formatting!
```

### Backend Calculations
```javascript
// GameSpace uses 10 as max
const maxPoints = 10;

// Source quality also uses 10 as max
const maxQuality = 10;

// Quality-weighted evidence normalizes to 0-1
const normalizedQuality = quality / 10; // 7.8 → 0.78
const evidenceMass = relevance * normalizedQuality;
```

## Migration Path

### Before (0-100 scale)
```javascript
quality_score: 78           // 0-100
risk_score: 23              // 0-100
if (quality_score > 70) ... // Threshold at 70
```

### After (0-10 scale)
```javascript
quality_score: 7.8          // 0-10
risk_score: 2.3             // 0-10
if (quality_score > 7.0) ... // Threshold at 7.0
```

### Conversion Formula
```javascript
// If you have old 0-100 scores
newScore = oldScore / 10;

// Example: 78 → 7.8, 23 → 2.3
```

## Summary

All scoring now uses **GameSpace-aligned scales**:

✅ **0-10 for quality/risk scores** (matches GameSpace points magnitude)
✅ **0.0-1.0 for properties/relevance** (probability/fraction scale)
✅ **1 decimal precision** (matches GameSpace rounding)
✅ **Consistent thresholds** (7.0 = good, 4.0 = poor, etc.)
✅ **Same mental model** (10 = best, 0 = worst)

This creates a **unified scoring experience** across the entire platform.
