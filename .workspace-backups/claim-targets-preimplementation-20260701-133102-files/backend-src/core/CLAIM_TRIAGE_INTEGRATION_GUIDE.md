# Claim Triage System Integration Guide

## Overview

The claim triage system implements a two-stage claim handling approach:

1. **Claim Extraction** - Pull candidate claims from cases
2. **Claim Triage** - Evaluate which claims are worth full evaluation

This prevents wasting cognitive energy on low-value claims while preserving important claims that may have sparse evidence.

## Architecture

```
ClaimExtractor (existing)
    ↓
    Extracts claims from source
    ↓
ClaimEvaluationClassifier (new)
    ├── SourceQualityScorer → Scores source quality (0-100)
    ├── Calculate claim properties (centrality, specificity, etc.)
    ├── Retrieve evidence for each claim
    └── ClaimTriageEngine → Determines evaluation-worthiness
    ↓
Triage statuses assigned:
    - active_evaluation
    - novel_but_important
    - low_priority
    - insufficient_relevant_sources
    - background_claim
    - needs_rewrite_for_retrieval
```

## Database Schema

### New Columns on `claims` Table

```sql
triage_status ENUM(...) DEFAULT 'active_evaluation'
claim_centrality DECIMAL(3,2)        -- 0.0-1.0
claim_specificity DECIMAL(3,2)       -- 0.0-1.0
claim_consequence DECIMAL(3,2)       -- 0.0-1.0
claim_contestability DECIMAL(3,2)    -- 0.0-1.0
claim_novelty DECIMAL(3,2)           -- 0.0-1.0
retrieval_count INT
distinct_source_count INT
max_relevance DECIMAL(3,2)
avg_top3_relevance DECIMAL(3,2)
triaged_at TIMESTAMP
triaged_by ENUM('ai', 'manual', 'rule')
triage_reasoning TEXT
```

### New Table: `source_quality_scores`

Stores quantitative 0-10 scores for each source across dimensions (same scale as GameSpace):
- Transparency (author, publisher)
- Evidence quality (density, specificity)
- Reliability (corrections, reputation)
- Risk indicators (sensationalism, monetization)

### New Table: `claim_retrieval_evidence`

Tracks which source claims were retrieved for each case claim, with:
- relevance_score
- stance (support/refute/nuance)
- source_quality_score
- source_quality_tier

## Integration Steps

### Step 1: Run Migration

```bash
node backend/migrations/run_migration.js add_claim_triage_system.sql
```

### Step 2: Integration in Claim Extraction Workflow

```javascript
// Example integration in your claim processing pipeline

import { ClaimExtractor } from './core/claimsEngine.js';
import { ClaimEvaluationClassifier } from './core/claimEvaluationClassifier.js';

// Extract claims (existing)
const extractor = new ClaimExtractor(llm, query);
const extractedClaims = await extractor.analyzeContent({
  chunks,
  extractionMode: 'ranked',
});

// NEW: Triage claims
const classifier = new ClaimEvaluationClassifier(llm, query);

for (const claim of extractedClaims.claims) {
  // Simulate retrieval (replace with your actual retrieval logic)
  const retrievedSources = await retrieveSourcesForClaim(claim);

  // Classify evaluation-worthiness
  const triageResult = await classifier.classifyClaim({
    claim_id: claim.claim_id,
    claim_text: claim.claim_text,
    source_content_id: sourceContentId,
    source_content_text: sourceText,
    retrieved_sources: retrievedSources,
  });

  // Save triage results
  await classifier.saveTriageResults(claim.claim_id, triageResult);

  // Save retrieval evidence
  await classifier.saveRetrievalEvidence(
    claim.claim_id,
    triageResult.retrieved_sources_with_quality
  );

  console.log(`Claim ${claim.claim_id}: ${triageResult.triage_status}`);
  console.log(`Display strategy: ${triageResult.display_strategy.display}`);
}
```

### Step 3: Update API Routes to Filter by Triage Status

```javascript
// Example: Filter claims by triage status in your API

router.get('/claims', async (req, res) => {
  const { include_suppressed = 'false' } = req.query;

  let sql = `
    SELECT c.*
    FROM claims c
    WHERE c.content_id = ?
  `;

  // Default: only show active evaluation claims
  if (include_suppressed === 'false') {
    sql += `
      AND c.triage_status IN ('active_evaluation', 'novel_but_important')
    `;
  }

  sql += ` ORDER BY c.claim_centrality DESC, c.retrieval_count DESC`;

  const claims = await query(sql, [content_id]);

  res.json({ claims });
});

// Separate endpoint for suppressed claims
router.get('/claims/suppressed', async (req, res) => {
  const sql = `
    SELECT c.*,
           c.triage_status,
           c.triage_reasoning
    FROM claims c
    WHERE c.content_id = ?
      AND c.triage_status IN (
        'insufficient_relevant_sources',
        'background_claim',
        'low_priority',
        'needs_rewrite_for_retrieval'
      )
    ORDER BY c.triage_status, c.claim_centrality DESC
  `;

  const suppressedClaims = await query(sql, [content_id]);

  res.json({ suppressedClaims });
});
```

### Step 4: Update Frontend UI

```typescript
// Example: Display claims with triage-aware UI

interface ClaimWithTriage {
  claim_id: number;
  claim_text: string;
  triage_status: string;
  claim_centrality: number;
  retrieval_count: number;
  triage_reasoning: string;
}

function ClaimList({ claims }: { claims: ClaimWithTriage[] }) {
  // Separate active from suppressed
  const activeClaims = claims.filter(c =>
    ['active_evaluation', 'novel_but_important'].includes(c.triage_status)
  );

  const suppressedClaims = claims.filter(c =>
    !['active_evaluation', 'novel_but_important'].includes(c.triage_status)
  );

  return (
    <div>
      {/* Main flow - show active claims prominently */}
      <h2>Primary Claims</h2>
      {activeClaims.map(claim => (
        <ClaimCard key={claim.claim_id} claim={claim} />
      ))}

      {/* Collapsible section for suppressed claims */}
      {suppressedClaims.length > 0 && (
        <Collapsible
          trigger={`Other extracted claims (${suppressedClaims.length}) - not currently worth evaluation`}
        >
          {suppressedClaims.map(claim => (
            <SuppressedClaimCard
              key={claim.claim_id}
              claim={claim}
              reason={claim.triage_reasoning}
            />
          ))}
        </Collapsible>
      )}
    </div>
  );
}
```

## Triage Decision Rules

### Route to `active_evaluation`
- retrieval_count ≥ 2
- avg_top3_relevance ≥ 0.6
- distinct_source_count ≥ 2

### Route to `novel_but_important`
- retrieval_count = 0
- BUT claim_centrality ≥ 0.75 OR claim_consequence ≥ 0.75

### Route to `background_claim`
- retrieval_count = 0
- claim_centrality < 0.3
- claim_consequence < 0.3
- claim_contestability < 0.3

### Route to `insufficient_relevant_sources`
- retrieval_count = 0
- claim_centrality ≥ 0.3 (not background noise)

### Route to `low_priority`
- retrieval_count = 1
- OR (retrieval_count ≥ 2 AND avg_top3_relevance < 0.5)

### Route to `needs_rewrite_for_retrieval`
- retrieval_count ≥ 2
- avg_top3_relevance < 0.4
- claim_specificity < 0.4

## Source Quality Scoring

### Quality Dimensions (0-10 scale, same as GameSpace, higher = better)
1. **author_transparency** - Named author with credentials
2. **publisher_transparency** - Clear editorial standards
3. **evidence_density** - Citations, data, primary sources
4. **claim_specificity** - Concrete vs vague
5. **correction_behavior** - Corrections policy
6. **domain_reputation** - Historical reliability
7. **original_reporting** - Firsthand vs recycled

### Risk Dimensions (0-10 scale, same as GameSpace, higher = riskier)
1. **sensationalism_score** - Emotional framing, outrage bait
2. **monetization_pressure** - Clickbait, aggressive ads

### Quality Tier Classification
- **High**: quality_score > 7.0 AND risk_score < 3.0
- **Mid**: quality 4.0-7.0
- **Low**: quality < 5.0
- **Unreliable**: quality < 4.0 OR risk > 7.0

## Benefits

### Saves Cognitive Energy
- Users see only claims worth evaluating
- Background/boring claims hidden by default
- Clear signal vs noise separation

### Preserves Important Claims
- Novel claims kept even with sparse retrieval
- Central claims prioritized
- High-consequence claims flagged

### Quantitative and Defendable
- Source quality scores use 0-10 scale (matches GameSpace points)
- Claim properties use 0.0-1.0 scale
- Explicit decision rubric
- Transparent reasoning stored in DB

### Visibility into Misinformation Ecosystems
- Low-quality sources scored but not filtered out during retrieval
- Separate evaluation/ranking layer
- Can analyze rhetoric landscape without letting it dominate truth assessment

## Future Enhancements

1. **User Feedback Loop**
   - Let users upvote suppressed claims to reactivate
   - Learn from user corrections to triage decisions

2. **Retrieval Failure Detection**
   - Auto-rephrase claims with poor retrieval
   - A/B test different phrasings

3. **Cross-Reference Analysis**
   - Detect when multiple sources cite same origin
   - Identify echo chambers vs independent verification

4. **Temporal Dynamics**
   - Re-triage claims as new evidence appears
   - Alert when suppressed claim gains evidence

5. **Batch Processing**
   - Optimize for bulk claim classification
   - Parallel source quality scoring
