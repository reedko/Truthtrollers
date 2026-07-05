# Candidate Clustering Guide

## Overview

Candidate clustering is performed after survey completion (Prompt 5) and before final selection by reducer steps (Prompt 8). The clustering phase reduces repetition across chunks by grouping similar candidates and selecting canonical representatives.

## Architecture

### Two-Phase Clustering

1. **Evaluation Candidates** - Claim candidates that need fact-checking verification
2. **Background Candidates** - Contextual/source facts useful for understanding

Each candidate type uses distinct clustering keys optimized for its purpose.

### Cluster Keys

#### Evaluation Candidates (clusterEvaluationCandidates)
- Normalized claim text (Jaccard token-set similarity ≥0.65)
- Same subject/actor (namedActors intersection)
- Same named study/document/law/dataset (namedStudiesOrDocuments, namedLawsOrPolicies, namedDatasets intersection)
- Same statistic/date/quantity (numeric pattern extraction and exact match)
- noveltyHint and localRepetitionSignals (both marked as repeated/derivative)

**Representative Selection Score:**
```
score = 
  importanceInChunk * 10 +
  importanceToArticleGuess * 5 +
  (noveltyHint === "novel" || "original" ? +5 : 0) +
  (noveltyHint === "repeated" || "derivative" ? -10 : 0) +
  (localRepetitionSignals ? -3 : 0)
```

Highest score becomes the cluster representative.

#### Background Candidates (clusterBackgroundCandidates)
- Same named study/document/law/dataset
- Same actor/source attribution
- Same statistic/date/quantity
- Same citation breadcrumb (localSourceExcerpt exact match)

**Representative Selection Score:** Same as evaluation, prioritizing evidence usefulness.

## Usage

### Direct Function Calls

```javascript
import { 
  clusterEvaluationCandidates, 
  clusterBackgroundCandidates,
  clusterCandidatesFromSurvey,
  getClusteredRepresentatives 
} from "./candidateClustering.js";

// Option 1: Cluster individual candidate types
const evalResults = clusterEvaluationCandidates(evaluationCandidates);
const bgResults = clusterBackgroundCandidates(backgroundCandidates);

// Option 2: Process entire survey output
const clusteringOutput = clusterCandidatesFromSurvey(surveyResults);
const representatives = getClusteredRepresentatives(clusteringOutput);
```

### Integration in processTaskClaims.js

```javascript
import { surveyAndClusterTaskContent } from "./processTaskClaims.js";

const result = await surveyAndClusterTaskContent({
  taskContentId: "content-123",
  text: articleText,
  articleTitle: "Article Title",
  provisionalFrame: "...",
  maxConcurrency: 3,
});

// Result structure:
// {
//   surveyResults: { chunkSurveys, totalChunks, ... },
//   clusteringResults: { 
//     evaluationClusterResults: { clusters, representatives, ... },
//     backgroundClusterResults: { clusters, representatives, ... },
//     clusteringMetrics: { ... }
//   },
//   representatives: { evaluationRepresentatives, backgroundRepresentatives, allRepresentatives }
// }
```

## Return Structure

### clusterEvaluationCandidates / clusterBackgroundCandidates

```javascript
{
  clusterIdByIndex: string[],      // Cluster ID for each input candidate
  clusters: Map<string, {
    id: string,                    // Cluster ID (e.g., "eval:5")
    type: "evaluation" | "background",
    memberIndexes: number[],       // Indices of candidates in cluster
    candidates: Array,             // Full candidate objects
    representativeIndex: number,   // Index of canonical representative
    representative: object,        // Full representative candidate
    size: number                   // Cluster size
  }>,
  totalClusters: number
}
```

### clusterCandidatesFromSurvey

```javascript
{
  evaluationClusterResults: {
    clusters: Map,
    representatives: Array,        // Canonical evaluation representatives
    totalCandidates: number,
    totalClusters: number
  },
  backgroundClusterResults: {
    clusters: Map,
    representatives: Array,        // Canonical background representatives
    totalCandidates: number,
    totalClusters: number
  },
  clusteringMetrics: {
    evaluationCandidatesProcessed: number,
    evaluationClusters: number,
    evaluationRepresentatives: number,
    backgroundCandidatesProcessed: number,
    backgroundClusters: number,
    backgroundRepresentatives: number,
    evaluationReductionRatio: string,  // "0.5" means 50% reduction
    backgroundReductionRatio: string
  }
}
```

### getClusteredRepresentatives

```javascript
{
  evaluationRepresentatives: Array,  // Sorted by importance
  backgroundRepresentatives: Array,
  allRepresentatives: Array         // Combined and sorted by importance
}
```

## Logging

The clustering phase emits structured logs for observability:

```
[EVALUATION_CANDIDATES_CLUSTERED] count=42, clusters=15, representatives=15
[EVALUATION_CLUSTERS_SAMPLE] [{"id":"eval:5","size":3,"representative":"..."}]
[BACKGROUND_CANDIDATES_CLUSTERED] count=8, clusters=4, representatives=4
[BACKGROUND_CLUSTERS_SAMPLE] [{"id":"bg:2","size":2,"representative":"..."}]
```

These logs enable:
- Monitoring repetition reduction efficiency
- Debugging clustering behavior
- Auditing candidate selection decisions

## Clustering Algorithm: Union-Find (Single-Linkage)

Both evaluation and background clustering use **single-linkage clustering** with union-find:

1. Initialize each candidate as its own cluster parent
2. For each pair of candidates (i, j):
   - Check if they match on ANY cluster key
   - If yes: union their clusters
3. For each cluster:
   - Select candidate with highest representative score
4. Return cluster map and representatives

**Time Complexity:** O(n²) for n candidates (acceptable for typical <100 candidates per content)

## Key Design Decisions

### Multi-Key Matching (Union-Find)

Candidates cluster together if they match on **any** key (OR logic), not all keys (AND logic). This:
- Catches variations of the same claim (slight wording changes still cluster)
- Reduces redundancy across chunks effectively
- Prevents legitimate distinct claims from merging

### Novelty Scoring

Novel claims score higher than repeated claims (+5 vs -10 differential). This ensures:
- Original insights are preserved as representatives
- Redundant restatements are demoted
- The most informative version of repeated content surfaces

### Chunk Metadata Preservation

Representatives retain source chunk information:
```javascript
{
  ...candidateData,
  sourceChunkIndex: 1,           // Where this came from
  sourceChunkPosition: "middle_body",
  chunkMiniTheme: "Main argument"
}
```

This enables downstream tracking and debugging.

## Testing

Comprehensive test suite in `test/clustering/candidateClustering.test.js`:

```bash
node --test backend/test/clustering/candidateClustering.test.js
```

Tests cover:
- Text similarity clustering
- Named entity clustering
- Study/document clustering
- Representative selection logic
- Novelty preference
- Empty candidate handling
- Reduction ratio calculation
- Metadata preservation
