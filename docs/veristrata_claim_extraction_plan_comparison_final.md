# VeriStrata Claim Extraction + Chunking: Final Plan After Comparing Claude’s Plan and Existing Code

## Executive Decision

Do **not** implement the expensive Claude version exactly.

Claude’s plan has useful pieces: article theme detection, chunk themes, role labels, parallel chunk work, and better observability. But its central proposal still allows the system to generate `N × 12` claims and then run evidence retrieval on those claims before selecting the final 12. That is the expensive garden-weeding strategy. It may produce better-looking output sometimes, but it burns search/LLM tokens before the system even knows which claims matter.

The better plan is:

```text
clean article text
→ article frame
→ parallel chunk candidate extraction
→ deterministic clustering + cheap ranking
→ document-level synthesis
→ hard final reducer to <= 12 canonical claims
→ evidence engine only for those <= 12 claims
```

The critical invariant:

> **Chunks produce candidates, not persisted claims. Evidence runs only after the global article-level reducer chooses the final claims.**

---

## Inputs Compared

### Claude plan

File: `CLAIM_EXTRACTION_PLAN.md`

Claude proposes:

1. Theme detection from title + first chunk.
2. Parallel chunk processing.
3. Up to 12 claims per chunk.
4. Evidence retrieval/scoring per chunk claim.
5. Final synthesis and filtering to top 12.

This is documented in Claude’s high-level flow: theme detection, `N chunks × 12 claims`, then final synthesis after collecting candidates with full evidence. Reference: `CLAIM_EXTRACTION_PLAN.md`, lines 18–31.

Claude also correctly identifies the core problem: the current pipeline extracts around 56 claims, bearing does not reliably predict importance, and running evidence on every claim is expensive and messy. Reference: `CLAIM_EXTRACTION_PLAN.md`, lines 5–8.

### Existing code

File: `EXISTING_CLAIM_EXTRACTION_CODE.js`

The existing code already contains much of the skeleton:

- fixed 6000-character chunking,
- per-chunk LLM extraction,
- local claim metadata,
- document synthesis,
- role-based ordering,
- optional filtering.

But the current implementation has several structural traps that explain the 56-claim mess.

---

## Main Finding: The 56-Claim Result Is Not Mysterious

The code creates 6000-character chunks:

```js
chunkContentForClaimExtraction(text, maxCharsPerChunk = 6000)
```

Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 23–36.

Then every chunk asks for a minimum number of claims. The prompt says:

```text
Extract {{minClaims}} to {{maxClaims}} locally grounded claims.
```

and the default max is 12. Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 72–74.

The code then sets:

```js
const maxClaims = prompt.parameters.max_claims || 12;
const minClaims = tokenLength > 5000 ? 6 : 5;
```

Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 253–260.

But `tokenLength` is estimated as `chunkText.length / 4`, so a 6000-character chunk is about 1500 tokens. That means `tokenLength > 5000` will almost never be true for normal 6000-character chunks. So the system effectively tells each chunk:

```text
Extract 5 to 12 claims.
```

For 10 chunks, that means the system is implicitly asking for **at least 50 claims**.

The fresh run produced 56. That is exactly what this code incentivizes.

This is not just a synthesis failure. It is also a prompt-contract failure:

> The chunk extractor is forced to fill a local quota even when the chunk should return zero, one, or two article-relevant candidates.

---

## Second Finding: Document Synthesis Does Not Actually Drop Non-Canonical Claims

The synthesis prompt says duplicates should be omitted and only canonical claims should be returned. Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 77–94.

But `applyDocumentSynthesis()` maps over **all deduped records**:

```js
const finalClaims = deduped.map((record) => {
  ...
  const assignment = assignmentMap.get(key) || {};
  return {
    claimText: record.claimText,
    finalRole: assignment.finalRole || record.localRoleSuggestion || "unclear",
    ...
  };
});
```

Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 176–214.

So even if the LLM synthesis correctly returns only 12 canonical assignments, the code still loops over every deduped local claim and returns it. Omitted duplicates are not dropped. They just come back with fallback metadata.

This is the direct code-level cause of persistence bloat.

The synthesis prompt is trying to say “only keep canonical claims,” but the code says “return every deduped local record anyway.”

That is the busted hinge.

---

## Third Finding: There Is No Hard Final Cap Before Persistence

After synthesis, the code sorts the synthesized claims by role and thesis score, then returns all ordered claims:

```js
const orderedClaims = synthesis.claims.slice().sort(...);

return {
  claims: orderedClaims.map((claim) => claim.claimText),
  claimsDetailed: orderedClaims,
  ...
};
```

Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 528–541.

Then `processTaskClaims()` takes `extraction.claimsDetailed || extraction.claims`, logs the count, skips filtering in non-comprehensive mode, normalizes, and returns the whole set. Reference: `EXISTING_CLAIM_EXTRACTION_CODE.js`, lines 600–657.

There is no invariant like:

```js
claims = reduceToMaxCanonicalClaims(claims, 12)
```

before persistence.

So if synthesis returns 56, 56 persist.

---

## Why Claude’s Plan Is Useful But Too Expensive

### Good ideas to keep

Claude’s plan has several good ideas:

| Claude idea | Keep? | Notes |
|---|---:|---|
| Detect article theme early | Yes | Useful anchor for chunk extraction. |
| Extract chunk mini-themes | Yes | Useful for coverage and debugging. |
| Process chunks in parallel | Yes | Good for speed, if bounded. |
| Role assignment: thesis/pillar/evidence/background | Yes | Useful for final reducer. |
| Final synthesis to top 12 | Yes | But must happen before evidence. |
| Debuggable theme/chunk scoring | Yes | Good replacement for opaque bearing triage. |

### Bad idea to reject for now

Claude’s expensive step is:

```text
For each chunk:
  extract up to 12 claims
  run evidence
Then:
  select final 12
```

That is backwards for cost control.

Evidence retrieval is the expensive stage. It should not be used to decide whether a chunk-local candidate deserves to exist. It should be used only after the article-level reducer has selected the final canonical claims.

### Why evidence-first selection is risky

Evidence-first selection tends to over-reward claims that are easy to search, not necessarily claims that are central to the article.

It may push the system toward:

- generic high-SEO claims,
- claims with obvious keyword matches,
- claims with lots of duplicated sources,
- claims from topics with easy indexed pages,

while missing:

- article thesis claims,
- allegations that need careful target decomposition,
- “study identity” claims,
- misconduct allegations,
- claims with low surface overlap but high bearing.

That is the same failure family as the old bearing experiment, just wearing nicer shoes.

---

## Final Architecture

## Phase 0: Article Text Readiness Gate

This plan does not depend on perfect extraction, but it must prevent dirty full-page fallback from silently triggering expensive LLM work.

Add:

```js
ARTICLE_TEXT_AUDIT {
  url,
  rawHtmlChars,
  extractedTextChars,
  extractionMethod,
  selectedSelector,
  confidence,
  dirtyFallback: boolean
}
```

If `dirtyFallback === true` in development:

```js
throw new Error("Dirty article extraction. Fix article text before claim extraction.");
```

Do not spend claim-extraction tokens on dirty text unless explicitly forced.

---

## Phase 1: Article Frame

Run one cheap LLM pass over:

```text
title
byline/date
first 5000–7000 chars
headings, if available
last 3000–5000 chars, if available
```

Output:

```json
{
  "articleThesis": "central argument as the article frames it",
  "stance": "endorses|rejects|mixed|unclear",
  "pillars": [
    {
      "pillarId": "p1",
      "label": "CDC/MMR manipulation allegation",
      "description": "..."
    }
  ],
  "namedActors": [],
  "namedStudiesOrDocuments": [],
  "mustPreserveTopics": [],
  "nonGoals": []
}
```

This frame is not persisted as claims. It is a navigation chart for chunk extraction.

---

## Phase 2: Better Chunking

Replace blind character slicing with paragraph-aware chunks.

### Chunking rules

1. Split article into paragraphs.
2. Preserve headings with following paragraphs.
3. Build chunks around 4500–6500 characters.
4. Allow overlap only at paragraph boundaries, usually 1 short paragraph.
5. Record metadata:

```json
{
  "chunkIndex": 0,
  "startChar": 0,
  "endChar": 6120,
  "heading": "",
  "paragraphCount": 8,
  "position": "lead|body|conclusion"
}
```

Do not split inside a sentence if avoidable.

---

## Phase 3: Parallel Chunk Candidate Extraction

Chunks may run in parallel. But they return **candidates**, not final claims.

### New chunk contract

Per chunk:

```json
{
  "chunkIndex": 0,
  "chunkTheme": "what this chunk contributes to the article argument",
  "candidateClaims": [
    {
      "candidateId": "c0-1",
      "claimText": "complete factual assertion",
      "localSourceExcerpt": "short exact excerpt",
      "roleSuggestion": "thesis|pillar|evidence|background|opposing_claim",
      "articleStance": "endorses|rejects|neutral|unclear",
      "pillarIds": ["p1"],
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "statistical": false,
        "study_identity": false,
        "legal_or_regulatory": false
      },
      "centralityHint": 0.0,
      "specificityHint": 0.0,
      "searchabilityHint": 0.0
    }
  ],
  "supportingDetails": [
    {
      "text": "stat/detail that supports a candidate but should not become a standalone claim unless selected",
      "supportsCandidateId": "c0-1"
    }
  ]
}
```

### Candidate count

Do not use `minClaims`.

Use:

```js
const maxCandidatesPerChunk = Math.max(
  2,
  Math.min(4, Math.ceil(36 / chunkCount))
);
```

For 10 chunks:

```text
maxCandidatesPerChunk = 4
```

But the prompt must say:

```text
Return 0 to 4 candidates. Do not fill the quota. Return zero if the chunk does not add a central or verifiable article-level claim.
```

This creates a soft upper bound of roughly 40 candidates, often far fewer. That is enough for synthesis without creating a claim swamp.

---

## Phase 4: Deterministic Candidate Clustering Before Any Evidence

Before the document synthesis LLM, run cheap deterministic clustering.

Group by:

- normalized claim text,
- named actors,
- named studies/documents,
- alleged action,
- claim type,
- pillar ID,
- semantic similarity if embeddings are already available,
- otherwise token/Jaccard similarity as a cheap fallback.

Create clusters like:

```json
{
  "clusterId": "cluster-thompson-mmr-manipulation",
  "representativeText": "...",
  "candidateIds": ["c1-2", "c2-1"],
  "pillarIds": ["p1"],
  "roles": ["pillar", "evidence"],
  "bestExcerpt": "...",
  "scoreHints": {
    "frequency": 2,
    "hasNamedActor": true,
    "hasStudyOrDocument": true,
    "isThesisOrPillar": true,
    "positionBonus": 0.2
  }
}
```

This makes the synthesis input compact and coherent.

---

## Phase 5: Document-Level Claim Synthesis

The synthesis LLM receives:

```text
articleFrame
cluster summaries
top excerpts
coverage map
```

It must return:

```json
{
  "globalThesis": "...",
  "globalPillars": [],
  "canonicalClaims": [
    {
      "canonicalClaimText": "...",
      "finalRole": "thesis|pillar|evidence|opposing_claim|background",
      "articleStance": "endorses|rejects|neutral|unclear",
      "sourceCandidateIds": [],
      "sourceClusterIds": [],
      "localSourceExcerpt": "...",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "claimType": {},
      "importanceRationale": "...",
      "absorbedSupportingDetails": []
    }
  ],
  "droppedClusters": [
    {
      "clusterId": "...",
      "reason": "duplicate|too_minor|background|unsupported_by_article_text|merged_into"
    }
  ]
}
```

The prompt must say:

```text
Return at most 12 canonicalClaims.
Prefer 8–12.
Do not preserve every chunk claim.
Merge statistics and subordinate details into the nearest pillar unless the statistic is itself one of the article's central pillars.
```

---

## Phase 6: Hard Deterministic Reducer

Even after the synthesis LLM, enforce the contract in code:

```js
function reduceCanonicalClaims(canonicalClaims, maxClaims = 12) {
  const valid = canonicalClaims
    .filter(hasClaimText)
    .filter(hasLocalSourceExcerpt)
    .filter(notBoilerplate)
    .map(scoreCanonicalClaim);

  const deduped = semanticOrStructuralDedupe(valid);

  return enforceCoverage(deduped, {
    maxClaims,
    requireThesis: true,
    maxBackground: 1,
    maxStudyIdentityStandalone: 2,
    preferPillarCoverage: true
  });
}
```

No final guard, no deployment.

---

## Phase 7: Evidence Engine

Only now run evidence.

Input:

```text
<= 12 canonical document-level claims
```

Not:

```text
N chunks × 12 claims
```

Each canonical claim should carry:

- source candidate IDs,
- source excerpt,
- pillar IDs,
- named actors,
- named studies/documents,
- claim type,
- article stance.

This gives the evidence mapper enough context without forcing the evidence engine to interpret raw chunk fragments.

---

# Concrete Code Changes

## 1. Remove the local minimum claim quota

Current logic:

```js
const maxClaims = ... || 12;
const minClaims = tokenLength > 5000 ? 6 : 5;
```

Replace with:

```js
const maxCandidates = context.maxCandidatesPerChunk ?? 4;
const minCandidates = 0;
```

Prompt:

```text
Extract 0 to {{maxCandidates}} candidate claims.
Return fewer when appropriate.
Do not fill the quota.
Return zero if this chunk adds no central or verifiable article-level claim.
```

## 2. Rename local outputs

Current output names encourage accidental persistence:

```js
claims
claimsDetailed
```

Use:

```js
candidateClaims
candidateClaimsDetailed
```

Only the reducer returns:

```js
canonicalClaims
```

## 3. Fix `applyDocumentSynthesis`

Current behavior maps over all deduped local records. That defeats synthesis.

Replace with behavior that returns only explicit canonical claims:

```js
function applyDocumentSynthesis(clusters, synthesisOut = {}) {
  const canonical = Array.isArray(synthesisOut.canonicalClaims)
    ? synthesisOut.canonicalClaims
    : [];

  return {
    claims: canonical.map(normalizeCanonicalClaim).filter(Boolean),
    globalThesis: synthesisOut.globalThesis || "",
    globalPillars: Array.isArray(synthesisOut.globalPillars)
      ? synthesisOut.globalPillars
      : [],
    droppedClusters: synthesisOut.droppedClusters || []
  };
}
```

Do not map over every deduped local record.

## 4. Add hard cap before return

Inside `analyzeContent()`:

```js
const reducedClaims = reduceCanonicalClaims(synthesis.claims, 12);

return {
  claims: reducedClaims.map(c => c.claimText),
  claimsDetailed: reducedClaims,
  ...
};
```

## 5. Add persistence guard

Inside `processTaskClaims()`:

```js
if (contentRole === "case" && normalizedClaims.length > 12) {
  throw new Error(
    `[CLAIM_CONTRACT_VIOLATION] Case content produced ${normalizedClaims.length} claims. Max is 12.`
  );
}
```

Do this in development immediately. In production, log error and reduce hard to 12.

---

# Comparison Table

| Design Point | Current Code | Claude Plan | Final Plan |
|---|---|---|---|
| Chunking | Blind 6000-char chunks | 6000-char chunks | Paragraph-aware 4500–6500 char chunks |
| Local output | Claims | Claims | Candidates |
| Local minimum | 5 per chunk | Implied up to 12 per chunk | 0 minimum |
| Local max | 12 per chunk | 12 per chunk | 2–4 candidates per chunk |
| Article theme | Mostly absent | Title + first chunk | Title + first chunk + headings + conclusion |
| Chunk theme | No | Yes | Yes |
| Synthesis | Attempts consolidation | Final after evidence | Final before evidence |
| Evidence timing | After too many claims survive | Before final selection | After final <=12 |
| Deduping | Exact text only | Semantic-ish planned | Structural cluster + optional semantic |
| Final cap | Missing | Top 12 after evidence | Hard <=12 before evidence and persistence |
| Cost | High | Very high | Controlled |
| Debuggability | Poor | Better | Best, with audit logs |
| Main risk | Claim swamp | Evidence-token furnace | Reducer tuning |

---

# Logging Requirements

Add these logs:

```text
ARTICLE_TEXT_AUDIT
ARTICLE_FRAME_BUILT
CHUNKS_BUILT
CHUNK_CANDIDATES_EXTRACTED
CANDIDATE_CLUSTERING_DONE
DOCUMENT_SYNTHESIS_DONE
CANONICAL_CLAIMS_REDUCED
CLAIM_CONTRACT_CHECK
CLAIMS_PERSISTED
```

Example:

```json
{
  "event": "CANONICAL_CLAIMS_REDUCED",
  "contentId": 16994,
  "candidateCount": 34,
  "clusterCount": 18,
  "synthesizedCount": 14,
  "finalCount": 12,
  "dropped": {
    "duplicate": 5,
    "minor_detail": 3,
    "background": 2,
    "merged": 4
  }
}
```

---

# Feature Flags

Use staged flags:

```env
CLAIM_EXTRACTION_V2=true
CLAIM_CANDIDATES_ONLY=true
CLAIM_FINAL_MAX=12
CLAIM_MAX_CANDIDATES_TOTAL=40
CLAIM_MAX_CANDIDATES_PER_CHUNK=4
CLAIM_EXTRACTION_BLOCK_DIRTY_TEXT=true
CLAIM_EVIDENCE_AFTER_REDUCTION=true
```

Keep legacy extraction available while testing, but default dev testing should use V2.

---

# Acceptance Criteria

For the Port Townsend vaccine article:

1. Fresh forced scrape creates new content ID.
2. Article text extraction does not silently use dirty full-page fallback.
3. Chunk count can be around 10, but chunk candidates should be around 20–40, not 50–120.
4. Persisted case claims must be `<= 12`.
5. Claim set must include:
   - one global thesis,
   - CDC/William Thompson/MMR manipulation allegation,
   - evidence destruction allegation,
   - 2004 study identity tied to the Thompson pillar, not repeated as fragments,
   - 1986 liability/capture pillar,
   - childhood schedule/chronic illness pillar,
   - SIDS/infant mortality pillar if central,
   - suppression/exemption-choice pillar if central.
6. Evidence engine receives only canonical final claims.
7. Any attempt to persist more than 12 case claims triggers `CLAIM_CONTRACT_VIOLATION`.
8. Manual review: at least 80% of final claims are central and verifiable.

---

# Codex Implementation Prompt

```text
Do not modify evidence retrieval, bearing, packet selection, source allocation, or scoring.

Implement Claim Extraction V2.

Use the attached existing code as context. The current failure is structural:
- chunkContentForClaimExtraction creates 6000-char chunks.
- analyzeLocalCaseChunk asks each chunk for 5 to 12 claims.
- with 10 chunks, the system implicitly asks for at least 50 claims.
- document synthesis does not actually drop omitted duplicates because applyDocumentSynthesis maps over all deduped local records.
- analyzeContent returns all ordered synthesis claims without a hard <=12 cap.
- processTaskClaims skips filtering in edge mode and returns all normalized claims.

Implement these changes:

1. Rename chunk-local outputs from claims to candidateClaims where feasible.
2. Remove local minClaims. Use minCandidates=0.
3. Use maxCandidatesPerChunk = 2–4, dynamically based on chunk count, with a hard max total candidate budget around 40.
4. Update the local prompt to say:
   - return 0 to maxCandidates candidates
   - do not fill quota
   - return zero if the chunk adds no central/verifiable article-level claim
   - candidates are temporary and must not be persisted
5. Build an article frame from title/first chunk/headings/conclusion.
6. Pass article frame into chunk candidate extraction.
7. Cluster/dedupe candidates before document synthesis.
8. Change document synthesis output to canonicalClaims.
9. Rewrite applyDocumentSynthesis so it returns only canonicalClaims, not every deduped local record.
10. Add reduceCanonicalClaims(canonicalClaims, 12) before returning from analyzeContent.
11. Add a processTaskClaims development guard:
    if contentRole === "case" and normalizedClaims.length > 12, throw CLAIM_CONTRACT_VIOLATION.
12. Run evidence only after the final <=12 canonical claims exist.

Add logs:
- ARTICLE_FRAME_BUILT
- CHUNKS_BUILT
- CHUNK_CANDIDATES_EXTRACTED
- CANDIDATE_CLUSTERING_DONE
- DOCUMENT_SYNTHESIS_DONE
- CANONICAL_CLAIMS_REDUCED
- CLAIM_CONTRACT_CHECK
- CLAIMS_PERSISTED

Acceptance:
- Port Townsend article persists <=12 claims.
- No chunk-local candidate can be persisted directly.
- Evidence receives <=12 canonical claims.
- The final 12 include thesis/pillar coverage, not 56 fragments.
- Do not refactor unrelated files.
```

---

# Final Recommendation

Use Claude’s plan as inspiration for **theme awareness**, but reject its evidence-before-reduction cost model.

The immediate fix is not glamorous. It is plumbing:

1. remove per-chunk minimums,
2. stop calling chunk outputs claims,
3. fix synthesis so omitted records are actually omitted,
4. add a hard 12-claim guard before persistence,
5. run evidence only after that guard passes.

That is the pipe gasket. Everything else is tuning.
