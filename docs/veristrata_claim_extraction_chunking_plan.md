# VeriStrata Claim Extraction and Chunking Plan

## Purpose

Build a cheaper, smarter claim extraction pipeline that can handle long articles without producing claim confetti.

The current failure mode is clear: long article text is split into chunks, each chunk produces too many claim-like objects, and too many of those objects survive into persistence and evidence mapping. The fresh run for the Port Townsend article used 10 extraction chunks and then persisted 56 claims. That means the system is applying the claim budget at the wrong layer.

This plan replaces “claims per chunk” with a staged pipeline:

```text
article text
→ article frame
→ thematic chunks
→ cheap chunk candidates
→ global candidate reducer
→ max 12 canonical claims
→ evidence engine only for selected claims
```

The major rule:

> Chunk outputs are never final claims. They are temporary candidates, notes, and signals. Only the document-level reducer is allowed to create persisted claims.

---

## Non-goals

Do not do these in this fix:

1. Do not run the full evidence engine for every chunk-local claim candidate.
2. Do not persist chunk-local claims.
3. Do not allow “12 claims per chunk.”
4. Do not tune bearing before the canonical claim set is fixed.
5. Do not add site-specific scraping rules as the main solution.
6. Do not refactor scoring, source allocation, packet selection, or evidence retrieval.

---

## Diagnosis of the current failure

The current pipeline appears to do this:

```text
long article
→ split into N chunks
→ extract up to many claims per chunk
→ synthesize weakly or too late
→ persist too many claims
→ map too many targets
→ evidence system explodes
```

Observed example:

```text
contentId: 16994
text length: ~54.7k chars
chunk count: 10
persisted claims: 56
```

This is better than 68, but still structurally wrong. It is not an evidence problem yet. It is a claim selection and canonicalization problem.

---

## Design principle

The system should separate four different things that are currently getting mixed together:

| Layer | Purpose | Persisted? | Expensive? |
|---|---|---:|---:|
| Article frame | Understand the article’s thesis and structure | Yes, optional metadata | Cheap |
| Chunk candidates | Capture possible claims from each chunk | No | Medium |
| Canonical claims | Final article-level claims to evaluate | Yes | Medium |
| Evidence packets | Sources for selected canonical claims | Yes | Expensive |

The expensive evidence engine should only see the final canonical claims, not every local candidate.

---

## Proposed pipeline

## Stage 0: Article text audit

Before claim extraction, log whether the text looks like clean article text or dirty full-page fallback.

This stage should not become a giant scraper project. It only needs to prevent feeding obvious junk into the LLM.

### Inputs

```ts
{
  url: string,
  title: string,
  author?: string,
  published?: string,
  extractedText: string,
  extractionMethod: string,
  rawHtmlChars?: number,
  extractedTextChars: number
}
```

### Output

```ts
{
  articleTextQuality: "clean" | "usable" | "dirty_full_page_fallback" | "bad",
  extractedTextChars: number,
  boilerplateWarnings: string[],
  proceedWithClaims: boolean
}
```

### Rules

```text
If extractionMethod is dirty_full_page_fallback in development:
  warn loudly or stop before expensive extraction.

If extractedTextChars is extremely high and paragraph density is low:
  warn.

If text contains obvious comments/sidebar/nav boilerplate:
  warn.
```

### Required log

```text
[ARTICLE_TEXT_AUDIT] {
  url,
  extractionMethod,
  extractedTextChars,
  articleTextQuality,
  proceedWithClaims,
  warnings
}
```

---

## Stage 1: Build article frame

This is the strategic compass. It should run once before chunk extraction.

Use:

```text
title
subtitle if available
byline/date
first 2,000–4,000 chars
headings
last 2,000–4,000 chars
```

Do not send the full article yet.

### Goal

Identify what the article is fundamentally trying to argue.

### Output schema

```ts
type ArticleFrame = {
  articleThesis: string;
  articleQuestion?: string;
  stance: "supportive" | "critical" | "mixed" | "unclear";
  mainActors: string[];
  mainEntities: string[];
  mainPillars: Array<{
    pillarId: string;
    label: string;
    description: string;
    expectedEvidenceKinds: string[];
  }>;
  likelyStudyOrDocumentAnchors: Array<{
    label: string;
    reason: string;
  }>;
  extractionWarnings: string[];
};
```

### Prompt behavior

The article frame prompt should say:

```text
You are not extracting claims yet.
You are building the article-level map used to decide which claims matter.
Prefer broad argumentative pillars over isolated statistics.
```

### Example for this article type

Possible frame pillars:

```text
1. Public health authorities allegedly misled the public about vaccine safety.
2. CDC/MMR/William Thompson allegations are offered as a key case study.
3. The 1986 liability regime allegedly enabled industry capture and schedule expansion.
4. Childhood chronic illness / mortality statistics are used as causal evidence.
5. Critics, dissenting doctors, and vaccine-choice advocates were allegedly suppressed.
```

---

## Stage 2: Smarter chunking

Chunk by structure first, token count second.

### Preferred chunk boundaries

Use these in order:

```text
h2/h3 headings
long horizontal separators
paragraph clusters
section-like transitions
then max character budget
```

### Recommended chunk size

```text
4,000–7,000 characters per chunk
10–15% overlap only when splitting mid-section
```

For a ~51k article, expect roughly:

```text
8–12 chunks
```

That is fine. The problem is not having 10 chunks. The problem is treating each chunk as a claim source with its own quota.

### Chunk object

```ts
type ArticleChunk = {
  chunkId: string;
  index: number;
  charStart: number;
  charEnd: number;
  headingPath: string[];
  text: string;
  overlapWithPrevious: boolean;
};
```

### Required log

```text
[ARTICLE_CHUNKS_BUILT] {
  contentId,
  textChars,
  chunkCount,
  maxChunkChars,
  avgChunkChars,
  boundaryMethodCounts
}
```

---

## Stage 3: Parallel chunk candidate extraction

This stage can run in parallel. It is not the final claim extractor.

Each chunk should return candidates and notes, not persisted claims.

### Hard caps per chunk

Do not ask for 12 claims per chunk.

Use:

```text
max 2 central candidates per chunk
max 2 supporting candidates per chunk
max 1 study/document anchor per chunk
max 1 attribution/quote candidate per chunk
return zero if chunk adds nothing central
```

A 10-chunk article should produce maybe 20–40 candidates, not 120.

### Chunk prompt inputs

```ts
{
  articleFrame: ArticleFrame,
  chunk: ArticleChunk,
  previousChunkSummary?: string,
  globalCandidateHints?: string[]
}
```

### Chunk candidate output schema

```ts
type ClaimCandidate = {
  candidateId: string;
  chunkId: string;
  text: string;
  claimType:
    | "thesis"
    | "pillar"
    | "supporting_statistic"
    | "study_identity"
    | "attribution"
    | "context"
    | "rhetorical_or_interpretive";
  pillarIds: string[];
  centrality: 0 | 1 | 2 | 3;
  evidenceNeed:
    | "source_attribution"
    | "study_resolution"
    | "statistical_check"
    | "causal_check"
    | "historical_check"
    | "context_only";
  exactExcerpt: string;
  entities: string[];
  studiesOrDocuments: string[];
  shouldBecomeCanonical: boolean;
  reason: string;
};
```

### Critical prompt language

```text
Do not fill the quota.
Return zero candidates if this chunk only elaborates a prior point.
Prefer candidates that advance the article thesis or a main pillar.
Do not extract every statistic as a separate claim.
Do not split one allegation into fragments.
If a statistic supports a larger causal claim, mark it as supporting_statistic, not a pillar.
```

### Required log

```text
[CHUNK_CANDIDATES_EXTRACTED] {
  contentId,
  chunkId,
  candidateCount,
  centralCandidateCount,
  supportingCandidateCount,
  studyAnchorCount
}
```

---

## Stage 4: Candidate clustering and dedupe

Before any final LLM synthesis, run deterministic clustering.

### Cluster keys

Cluster by:

```text
same main actor
same action/predicate
same object
same study/document anchor
same pillar
high text similarity
```

### Examples

These should cluster:

```text
CDC manipulated data linking MMR to autism.
William Thompson said CDC manipulated MMR/autism data.
The 2004 MMR/autism study data were allegedly manipulated.
```

These are related but may remain separate:

```text
CDC manipulated data.
CDC officials ordered destruction of evidence.
Thompson saved documents.
```

### Output

```ts
type CandidateCluster = {
  clusterId: string;
  candidates: ClaimCandidate[];
  representativeText: string;
  pillarIds: string[];
  clusterType: ClaimCandidate["claimType"];
  maxCentrality: number;
  evidenceNeed: string;
  excerptCount: number;
  chunkSpan: number[];
};
```

### Required log

```text
[CANDIDATE_CLUSTERS_BUILT] {
  candidateCount,
  clusterCount,
  duplicateReduction,
  topClusters
}
```

---

## Stage 5: Global canonical claim synthesis

This is the only LLM step allowed to create final claims.

### Input

```ts
{
  articleFrame,
  clusters,
  maxCanonicalClaims: 12
}
```

### Output

```ts
type CanonicalClaim = {
  canonicalClaimId: string;
  text: string;
  claimType:
    | "article_thesis"
    | "main_pillar"
    | "study_identity"
    | "attribution"
    | "supporting_statistic"
    | "context";
  pillarIds: string[];
  sourceClusterIds: string[];
  sourceCandidateIds: string[];
  representativeExcerpts: string[];
  priority: number;
  evidenceNeed: string;
  rationale: string;
  absorbedCandidateIds: string[];
};
```

### Budget shape

For a normal long argumentative article:

```text
1 article thesis
4–7 main pillars
1–2 study/document identity claims
1–2 attribution claims
0–2 supporting statistics, only if central
```

### Hard prompt rules

```text
Return at most 12 canonical claims total.
Do not return 12 claims per section.
Do not preserve minor statistics as standalone claims unless they are central to the article argument.
Merge fragment claims into broader canonical claims.
Preserve Thompson/MMR/CDC manipulation as one canonical claim unless the article makes truly separate allegations.
Do not split attribution, substantive allegation, and study identity into separate top-level claims unless each is essential.
```

---

## Stage 6: Deterministic final reducer

Prompts are not seatbelts. Code must enforce the cap.

If synthesis returns more than 12 claims, reduce deterministically before persistence.

### Scoring

```ts
type CanonicalScore = {
  thesisBonus: number;
  pillarBonus: number;
  repeatedAcrossChunksBonus: number;
  headlineLedeConclusionBonus: number;
  studyAnchorBonus: number;
  attributionImportanceBonus: number;
  evidenceCheckabilityBonus: number;
  minorStatisticPenalty: number;
  duplicatePenalty: number;
  contextOnlyPenalty: number;
  total: number;
};
```

### Priority order

Always preserve:

```text
1. article thesis
2. central allegations that define the article
3. study/document identity needed to evaluate central allegations
4. repeated pillars
5. checkable facts central to the thesis
```

Usually drop or absorb:

```text
minor one-off statistics
background color
biographical details
rhetorical interpretations
quotes that only restate another claim
local anecdote unless central
```

### Required log

```text
[DOCUMENT_CLAIMS_REDUCED] {
  before,
  after,
  droppedClaims: [
    { text, reason, absorbedInto }
  ]
}
```

---

## Stage 7: Persistence guard

Only final canonical claims can be persisted.

### Guardrails

```ts
if (claims.length > 12) {
  throw new Error("Invariant violation: attempting to persist more than 12 canonical claims");
}

if (claims.some(c => c.source === "chunk_local")) {
  throw new Error("Invariant violation: chunk-local claims cannot be persisted");
}
```

### Required log

```text
[CLAIMS_PERSISTED] {
  contentId,
  count,
  source: "document_canonical_reducer",
  claimIds
}
```

---

## Stage 8: Evidence engine handoff

Only after max 12 canonical claims are persisted should the evidence engine run.

### Handoff object

```ts
type EvidenceReadyClaim = {
  claimId: number;
  canonicalText: string;
  claimType: string;
  pillarIds: string[];
  evidenceNeed: string;
  representativeExcerpts: string[];
  studyOrDocumentAnchors: string[];
  absorbedCandidateCount: number;
};
```

### Rule

Do not run evidence for:

```text
chunk candidates
absorbed candidates
minor statistics that were not selected
context-only claims
```

---

## Optional later experiment: evidence-assisted final ranking

There is a tempting but expensive idea:

```text
run evidence on many candidates
then keep the 12 best supported/refuted claims
```

Do not build this now.

If tested later, do it as a bounded experiment:

```text
max 20 preselected candidates
cheap source discovery only
no full packet generation
use evidence signals only as one ranking feature
```

Reason: running the full evidence engine on 50–120 candidates will burn money and make debugging almost impossible.

---

## Recommended implementation sequence

## Step 1: Rename concepts in code

Rename or wrap outputs so the code cannot confuse temporary and final objects.

```text
localClaims → chunkCandidates
synthesizedClaims → canonicalClaims
filteredClaims → reducedCanonicalClaims
```

If renaming is too invasive, add explicit fields:

```ts
sourceStage: "chunk_candidate" | "document_synthesis" | "document_reducer"
canPersist: boolean
```

## Step 2: Add persistence invariant

Before any other fix, prevent bad persistence.

```text
No more than 12 claims may be persisted.
Chunk-local candidates may not be persisted.
```

This turns silent garbage into a visible error.

## Step 3: Implement article frame

One cheap call before chunk extraction.

## Step 4: Change chunk prompt/schema

Chunk prompt returns candidates, not claims.

## Step 5: Add cluster/dedupe

Use deterministic clustering before synthesis.

## Step 6: Add document-level synthesis

Canonical claims only.

## Step 7: Add deterministic reducer

Always enforce cap.

## Step 8: Only then re-enable evidence

Evidence starts after canonical claim count is stable.

---

## Acceptance criteria

For the Port Townsend article:

```text
fresh scrape creates a new contentId
article text audit runs
article frame is built
8–12 chunks are created
chunk candidates are extracted in parallel
candidate count is probably 20–40, not 120
canonical claim count is <= 12
persisted claim count is <= 12
evidence mapping runs only for persisted canonical claims
```

The final claim set should include, at minimum:

```text
1. article thesis about public health/vaccine authorities allegedly misleading or suppressing information
2. CDC/William Thompson/MMR data manipulation allegation
3. alleged destruction of evidence connected to the 2004 study
4. 2004 study / DeStefano study identity as needed for evaluation
5. 1986 vaccine liability regime / industry capture pillar
6. childhood vaccine schedule expansion pillar
7. childhood chronic illness / mortality causal pillar
8. suppression of dissenting doctors/scientists or vaccine-choice advocates pillar
```

The final set should not include every statistic as a standalone claim.

---

## Codex implementation prompt

```text
Do not modify evidence retrieval, bearing, packet selection, source allocation, or scoring.

Rebuild the claim extraction/chunking contract so long articles do not produce chunk-local claim explosions.

Current failure:
- A fresh forced scrape created contentId 16994.
- Text length was about 54.7k chars.
- processTaskClaims sent 10 claim-extraction chunks.
- claim_local_extraction and claim_document_synthesis loaded from DB.
- The run still extracted/persisted 56 claims.

Diagnosis:
The pipeline applies the claim budget at the wrong layer. Chunk extraction is producing claim-like objects that survive into persistence. The cap must be global and document-level.

Implement this staged contract:

1. Article text audit
   - log extraction method, text chars, quality, and dirty fallback warnings.

2. Article frame
   - build one article-level frame from title, byline/date, first section, headings, and conclusion/tail.
   - output thesis, stance, pillars, actors, entities, and study/document anchors.

3. Structural chunking
   - chunk by headings/paragraph clusters before character count.
   - keep chunk metadata: index, charStart, charEnd, headingPath.

4. Parallel chunk candidate extraction
   - chunk output must be claim_candidates, not persisted claims.
   - max 2 central candidates, 2 supporting candidates, 1 study/document anchor, 1 attribution candidate per chunk.
   - allow zero candidates.

5. Candidate clustering/dedupe
   - cluster candidates by actor/action/object/study/pillar/text similarity.

6. Document-level synthesis
   - synthesize at most 12 canonical article-level claims from clusters and article frame.
   - merge fragment claims into pillars.
   - minor statistics become supporting notes unless central.

7. Deterministic final reducer
   - enforce <= 12 claims no matter what the LLM returns.
   - log dropped/absorbed claims and reasons.

8. Persistence guard
   - throw or block if trying to persist >12 claims.
   - throw or block if any claim sourceStage is chunk_candidate.

Add logs:
- ARTICLE_TEXT_AUDIT
- ARTICLE_FRAME_BUILT
- ARTICLE_CHUNKS_BUILT
- CHUNK_CANDIDATES_EXTRACTED
- CANDIDATE_CLUSTERS_BUILT
- DOCUMENT_CLAIMS_SYNTHESIZED
- DOCUMENT_CLAIMS_REDUCED
- CLAIMS_PERSISTED

Acceptance:
- Port Townsend article persists <=12 canonical claims.
- Chunk candidates are never persisted.
- Evidence engine runs only after canonical claims are selected.
- Thompson/MMR/CDC data manipulation is one canonical pillar, not several fragments.
- Alleged evidence destruction is one canonical pillar.
- The 2004 study identity is attached/linked as needed, not duplicated repeatedly.
- Individual statistics are absorbed unless they are central to the article thesis.

Return exact files/functions changed and minimal patch. Do not refactor unrelated evidence code.
```

---

## Key invariants

These should eventually become tests:

```text
A long article can have many chunks.
A chunk can have many candidate signals.
But a case article can persist at most 12 canonical claims.
No chunk-local candidate can be persisted.
No evidence packet can be created for an unselected candidate.
```

That is the fence around the garden.
