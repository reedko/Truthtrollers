# Claim Triage System - Implementation Complete

## Overview

This implementation provides a **two-stage claim handling system** that separates claim extraction from claim evaluation-worthiness assessment.

### The Problem

Without triage, every extracted claim goes to full evaluation, wasting cognitive energy on:
- Boring/uncontested background facts
- Claims with no relevant sources
- Low-salience details
- Poorly-phrased claims that failed retrieval

### The Solution

**Stage 1: Claim Extraction** (existing)
- Pull candidate claims from source documents
- Extract all potentially verifiable assertions

**Stage 2: Claim Triage** (new)
- Score source quality (0-100 quantitative)
- Calculate claim properties (centrality, specificity, consequence, etc.)
- Retrieve evidence and analyze coverage
- Classify claims into:
  - **active_evaluation** - Worth public evaluation
  - **novel_but_important** - Sparse evidence but high importance
  - **low_priority** - Some evidence but weak
  - **insufficient_relevant_sources** - No retrieval found
  - **background_claim** - Low salience, uncontested
  - **needs_rewrite_for_retrieval** - Poor phrasing for retrieval

## What Was Built

### 1. Database Schema (`add_claim_triage_system.sql`)

#### New columns on `claims` table:
```sql
triage_status              -- Evaluation-worthiness classification
claim_centrality           -- How central to source (0.0-1.0)
claim_specificity          -- Specific vs vague (0.0-1.0)
claim_consequence          -- Real-world stakes (0.0-1.0)
claim_contestability       -- Disputability (0.0-1.0)
claim_novelty              -- Novel/obscure assertion (0.0-1.0)
retrieval_count            -- Number of retrieved sources
distinct_source_count      -- Unique sources/domains
max_relevance              -- Best relevance score
avg_top3_relevance         -- Avg of top 3 relevance
triaged_at                 -- Timestamp
triaged_by                 -- ai|manual|rule
triage_reasoning           -- Explanation
```

#### New table: `source_quality_scores`
Quantitative 0-10 scoring across dimensions (same scale as GameSpace):

**Quality dimensions (higher = better, 0-10 scale):**
- author_transparency
- publisher_transparency
- evidence_density
- claim_specificity
- correction_behavior
- domain_reputation
- original_reporting

**Risk dimensions (higher = riskier, 0-10 scale):**
- sensationalism_score
- monetization_pressure

**Aggregate scores:**
- quality_score (0-10, matches GameSpace points scale)
- risk_score (0-10, matches GameSpace points scale)
- quality_tier (high|mid|low|unreliable)

#### New table: `claim_retrieval_evidence`
Tracks retrieval results per claim:
- relevance_score
- stance (support|refute|nuance|neutral|unclear)
- source_quality_score
- source_quality_tier
- retrieval_method

### 2. Core Modules

#### `sourceQualityScorer.js`
- AI-based and heuristic source quality scoring
- Quantitative 0-100 scores (defendable, not vibes)
- Separate quality and risk scoring
- Four-tier classification (high/mid/low/unreliable)

**Key methods:**
- `scoreSource()` - Score a single source
- `scoreSourcesBatch()` - Batch scoring
- `saveScores()` - Persist to database
- `getScores()` - Retrieve existing scores

#### `claimTriageEngine.js`
- Rule-based and AI-based triage classification
- Evidence-aware decision making
- Preserves important claims despite sparse retrieval
- Provides UI display strategies

**Key methods:**
- `triageClaim()` - Rule-based triage
- `triageClaimWithAI()` - AI-based triage
- `triageClaimsBatch()` - Batch triage
- `calculateEvidenceMass()` - Quality-weighted evidence
- `analyzeStanceDistribution()` - Stance analysis
- `getDisplayStrategy()` - UI recommendations

#### `claimEvaluationClassifier.js`
- Orchestrates full pipeline
- Integrates source quality + claim triage
- Calculates claim properties (centrality, specificity, etc.)
- End-to-end classification workflow

**Key methods:**
- `classifyClaim()` - Full classification pipeline
- `classifyClaimsBatch()` - Batch classification
- `calculateClaimProperties()` - AI or heuristic
- `saveTriageResults()` - Persist to database
- `saveRetrievalEvidence()` - Store retrieval metadata

### 3. API Routes (`claims.triage.routes.js`)

#### GET `/api/claims/content/:contentId`
Get claims filtered by triage status
- Query params: `include_suppressed`, `triage_status`, `min_centrality`, `min_retrieval_count`
- Default: only show `active_evaluation` and `novel_but_important`
- Sorted by importance

#### GET `/api/claims/suppressed/:contentId`
Get suppressed claims grouped by reason
- Returns background claims, low priority, etc.
- Grouped by triage_status

#### POST `/api/claims/triage/:claimId`
Manually re-triage a claim
- Body: `triage_status`, `reasoning`
- Marks as `triaged_by: 'manual'`

#### GET `/api/claims/retrieval-evidence/:claimId`
Get retrieval evidence for a claim
- Shows retrieved sources with relevance scores
- Stance distribution
- Quality distribution

#### GET `/api/claims/quality-scores/:contentId`
Get source quality scores
- All dimensions (0-100)
- Aggregate scores
- Quality tier

#### POST `/api/claims/run-triage/:contentId`
Run full triage pipeline on all claims
- Scores source quality
- Calculates claim properties
- Retrieves evidence
- Classifies evaluation-worthiness

### 4. Migration Script (`run_add_claim_triage_system.js`)

Node script to run the migration safely:
```bash
node backend/migrations/run_add_claim_triage_system.js
```

Features:
- Idempotent (safe to run multiple times)
- Handles "already exists" errors gracefully
- Verifies tables and columns created
- Shows progress and errors clearly

### 5. Documentation

#### `CLAIM_TRIAGE_INTEGRATION_GUIDE.md`
- Complete integration guide
- Code examples for backend and frontend
- Triage decision rules explained
- Source quality scoring details
- UI recommendations
- Future enhancement ideas

## Triage Decision Logic

### Active Evaluation
```
retrieval_count >= 2
AND avg_top3_relevance >= 0.6
AND distinct_source_count >= 2
```

### Novel But Important
```
retrieval_count = 0
AND (claim_centrality >= 0.75 OR claim_consequence >= 0.75)
```

### Background Claim (suppress)
```
retrieval_count = 0
AND claim_centrality < 0.3
AND claim_consequence < 0.3
AND claim_contestability < 0.3
```

### Insufficient Relevant Sources
```
retrieval_count = 0
AND claim_centrality >= 0.3
(Possible retrieval failure)
```

### Low Priority
```
retrieval_count = 1
OR (retrieval_count >= 2 AND avg_top3_relevance < 0.5)
```

### Needs Rewrite for Retrieval
```
retrieval_count >= 2
AND avg_top3_relevance < 0.4
AND claim_specificity < 0.4
```

## Source Quality Classification

### High Quality
```
quality_score > 7.0
AND risk_score < 3.0
```

### Mid Quality
```
quality_score 4.0-7.0
```

### Low Quality
```
quality_score < 5.0
```

### Unreliable
```
quality_score < 4.0
OR risk_score > 7.0
```

## Integration Example

```javascript
import { ClaimExtractor } from './core/claimsEngine.js';
import { ClaimEvaluationClassifier } from './core/claimEvaluationClassifier.js';

// 1. Extract claims (existing)
const extractor = new ClaimExtractor(llm, query);
const extracted = await extractor.analyzeContent({
  chunks,
  extractionMode: 'ranked',
});

// 2. Triage claims (new)
const classifier = new ClaimEvaluationClassifier(llm, query);

for (const claim of extracted.claims) {
  // Retrieve sources for this claim
  const retrievedSources = await retrieveSourcesForClaim(claim);

  // Classify evaluation-worthiness
  const result = await classifier.classifyClaim({
    claim_id: claim.claim_id,
    claim_text: claim.claim_text,
    source_content_id: sourceContentId,
    source_content_text: sourceText,
    retrieved_sources: retrievedSources,
  });

  // Save to database
  await classifier.saveTriageResults(claim.claim_id, result);
  await classifier.saveRetrievalEvidence(claim.claim_id, result.retrieved_sources_with_quality);

  console.log(`Claim ${claim.claim_id}: ${result.triage_status}`);
  console.log(`Display: ${result.display_strategy.display}`);
}
```

## UI Recommendations

### Main Flow (active_evaluation, novel_but_important)
```typescript
// Show prominently
<ClaimCard claim={claim} prominent={true} />
```

### Low Priority
```typescript
// Show collapsed by default
<CollapsibleClaimCard claim={claim} defaultExpanded={false} />
```

### Suppressed (background, insufficient_sources, needs_rewrite)
```typescript
// Hide by default, show in "Other claims" section
<Collapsible trigger="Other extracted claims (not currently worth evaluation)">
  {suppressedClaims.map(claim => (
    <SuppressedClaimCard claim={claim} reason={claim.triage_reasoning} />
  ))}
</Collapsible>
```

## Key Benefits

### 1. Saves Cognitive Energy
- Users see only claims worth evaluating
- Background/boring claims hidden by default
- Clear signal vs noise separation

### 2. Preserves Important Claims
- Novel claims kept even with sparse retrieval
- Central claims prioritized
- High-consequence claims flagged

### 3. Quantitative and Defendable
- All scores use consistent 0-10 scale (matches GameSpace)
- Claim properties use 0.0-1.0 scale
- Explicit decision rubric
- Transparent reasoning stored in DB

### 4. Visibility into Misinformation
- Low-quality sources scored but not filtered during retrieval
- Can analyze rhetoric landscape
- Separate evaluation/ranking layer

### 5. Adaptive and Learnable
- Manual override capability
- Can re-triage as new evidence appears
- User feedback integration possible

## Next Steps

### To Deploy:

1. **Run migration**
   ```bash
   cd backend
   node migrations/run_add_claim_triage_system.js
   ```

2. **Update your claim extraction workflow**
   - Add triage step after extraction
   - See `CLAIM_TRIAGE_INTEGRATION_GUIDE.md`

3. **Update API endpoints**
   - Mount new routes: `app.use('/api/claims', triageRoutes)`
   - Update existing endpoints to filter by triage status

4. **Update frontend**
   - Add triage status to claim display
   - Implement "Other claims" collapsible section
   - Add badge/indicator for novel claims

### To Enhance:

1. **User Feedback Loop**
   - Let users upvote suppressed claims to reactivate
   - Learn from manual overrides

2. **Auto-Rephrasing**
   - Detect retrieval failure
   - Auto-rephrase claims with poor retrieval
   - A/B test different phrasings

3. **Temporal Re-Triage**
   - Re-run triage when new evidence appears
   - Alert when suppressed claim gains evidence

4. **Batch Processing**
   - Optimize for bulk classification
   - Parallel source quality scoring

## Files Created

```
backend/
├── migrations/
│   ├── add_claim_triage_system.sql
│   └── run_add_claim_triage_system.js
├── src/
│   ├── core/
│   │   ├── sourceQualityScorer.js
│   │   ├── claimTriageEngine.js
│   │   ├── claimEvaluationClassifier.js
│   │   ├── CLAIM_TRIAGE_INTEGRATION_GUIDE.md
│   │   └── CLAIM_TRIAGE_README.md (this file)
│   └── routes/
│       └── claims/
│           └── claims.triage.routes.js
```

## Design Philosophy

This system implements the framework you described:

1. **Not deciding truth** - Only deciding evaluation-worthiness
2. **Quantitative, not vibes** - All scores are 0-100 or 0.0-1.0
3. **Preserves signal** - Novel/important claims kept despite sparse retrieval
4. **Transparent** - Reasoning stored, manual override possible
5. **Adaptive** - Can re-triage as evidence landscape changes
6. **Evidence-connected** - Tracks retrieval results, not just claim text
7. **Quality-aware** - Distinguishes high-quality vs low-quality sources
8. **Two-layer filtering** - Broad retrieval, selective evaluation

The result is a system that **saves brain** by suppressing noise while **preserving signal** by keeping important claims even when evidence is sparse.
