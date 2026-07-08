# Pre-TM4 DB Prompts vs Current TM4 Hardcoded: Complete Diff

**Status:** This diff shows the migration from DB-driven claim extraction to hardcoded TM4 implementation  
**Timeline:** Old system (claim_local_extraction from llm_prompts table) → New system (surveyChunk hardcoded in claimsEngine.js)

---

## SYSTEM 1: LOCAL CLAIM EXTRACTION

### OLD: claim_local_extraction (DB Prompt)

**Source:** `backend/deploy/2026-07-04-01-seed-local-claim-extraction-prompts.sql`

```
SYSTEM:
Extract locally verifiable claims from one article chunk.

Return strict JSON only. Use only the supplied chunk; do not use outside knowledge.
Keep each claim tied to the nearby language that gives it meaning. Do not construct a
document-wide argument hierarchy here.

For each claim return:
- claimText: a complete factual assertion
- localSourceExcerpt: one to three short exact sentences from this chunk that contain the claim
  and preserve nearby actor, study/year, action, population, subgroup, or protocol clues
- localRoleSuggestion: thesis | pillar | evidence | background | opposing_claim | unclear
- articleStance: endorses | rejects | neutral | unclear
- namedActors: people or organizations acting in the claim
- namedStudiesOrDocuments: specifically named or clearly referenced works, datasets, laws, protocols, or reports
- allegedAction: the alleged act for misconduct/attribution claims, otherwise empty
- claimType: booleans for attribution, misconduct, causation, disputed_study, statistical,
  legal_or_regulatory, and background
- thesisCandidate: true only if this chunk expresses a likely article thesis
- pillarCandidate: true only if the claim appears to carry a major part of the article's argument

Separate what a speaker allegedly said from whether the embedded proposition is true in the
metadata, but keep claimText faithful to the article. Preserve named actors, studies, actions,
numbers, populations, and qualifications. Avoid generic topic summaries.

USER:
Extract {{minClaims}} to {{maxClaims}} locally grounded claims when the chunk contains
that many worthy claims. Return fewer when it does not.

Return:
{
  "localClaims": [
    {
      "claimText": "",
      "localSourceExcerpt": "",
      "localRoleSuggestion": "thesis|pillar|evidence|background|opposing_claim|unclear",
      "articleStance": "endorses|rejects|neutral|unclear",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "allegedAction": "",
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "disputed_study": false,
        "statistical": false,
        "legal_or_regulatory": false,
        "background": false
      },
      "thesisCandidate": false,
      "pillarCandidate": false,
      "confidence": 0
    }
  ]
}

ARTICLE CHUNK:
{{chunk}}
```

**Key Features:**
- ✅ Explicit localSourceExcerpt (1-3 exact sentences, preserve context)
- ✅ localRoleSuggestion (thesis, pillar, evidence, background, opposing_claim)
- ✅ articleStance (endorses, rejects, neutral) - independent from role
- ✅ thesisCandidate & pillarCandidate flags
- ✅ allegedAction (for misconduct/attribution)
- ✅ Detailed claimType breakdown (7 booleans)
- ✅ Confidence score
- ✅ Emphasis on NOT constructing document hierarchy (per-chunk only)

### NEW: surveyChunk (Current TM4 Hardcoded)

**Source:** `backend/src/core/claimsEngine.js` lines 849-872

```
SYSTEM:
You are a fact-checking assistant analyzing article chunks to extract claim candidates.

Your role is to identify and categorize potential claims, pillars, and background facts WITHOUT running evidence searches.

For each chunk, return:
1. chunkMiniTheme: A brief metadata label (not a claim)
2. relationshipToProvisionalFrame: How this chunk relates to the article's main argument
3. pillarHints: Potential major supporting claims (metadata only, not evaluation)
4. evaluationCandidateClaims: Factual claims worth verifying (0-6)
5. sourceBackgroundCandidates: Background facts useful as source context (0-2)
6. localRepetitionSignals: Repeated themes detected within the chunk

CRITICAL RULES:
- Return ONLY candidates. Do NOT persist these.
- Mark all records with candidateOnly=true.
- mini-theme and pillarHints are metadata, NOT claims.
- Do NOT call evidence engine or run searches.
- Separate evaluation candidates from background/source candidates into different arrays.
- evaluationCandidateClaims: 0-6 items, each a potential focal claim to verify
- sourceBackgroundCandidates: 0-2 items, useful only as reference background
- If a theme repeats, mark it in localRepetitionSignals, not as duplicates.
- Confidence is 0-1.0; importance is 0-1.0.

Return strict JSON only.

USER:
Article: "${articleTitle}"
Provisional Frame (document-level thesis candidate): "${provisionalFrame}"

Chunk #${chunkIndex + 1}/${chunkCount} | Position: ${chunkPosition}

Analyze this chunk for claim candidates:

${chunkText}

Return: [JSON schema with 6 top-level fields]
```

**Key Features:**
- ✅ chunkMiniTheme (new - per-chunk metadata label)
- ✅ relationshipToProvisionalFrame (new - explicit frame relationship)
- ✅ pillarHints (changed - metadata only, not claims)
- ✅ evaluationCandidateClaims (0-6 cap - hardcoded)
- ✅ sourceBackgroundCandidates (0-2 cap - hardcoded)
- ✅ localRepetitionSignals (new - track repetition)
- ❌ NO localSourceExcerpt requirement explicitly stated
- ❌ NO articleStance field
- ❌ NO thesisCandidate/pillarCandidate flags
- ❌ NO allegedAction field
- ❌ NO separate claimType breakdown
- ❌ Hardcoded caps (0-6 eval, 0-2 bg)

---

## SYSTEM 2: DOCUMENT SYNTHESIS (REPLACED)

### OLD: claim_document_synthesis (DB Prompt)

**Source:** `backend/deploy/2026-07-04-01-seed-local-claim-extraction-prompts.sql`

```
SYSTEM:
Organize structured local claim records into one article-level argument map.

Return strict JSON only. Do not fact-check and do not use outside knowledge. The article body is
intentionally absent. Use the claim texts, exact local excerpts, local role suggestions, stance,
and candidate markers already extracted from each chunk.

Do not rewrite claims or invent missing local context. Assign every localClaimId a final role and
article stance. Prefer a claim explicitly marked thesisCandidate for the global thesis. Pillars
must be load-bearing propositions, not generic topics.

USER:
STRUCTURED LOCAL CLAIMS:
{{claimsJson}}

Return:
{
  "globalThesis": "",
  "globalPillars": [
    { "text": "", "memberClaimIds": [] }
  ],
  "claimRelationships": [
    { "fromClaimId": "", "toClaimId": "", "relationship": "supports|opposes|evidence_for|background_to" }
  ],
  "claimAssignments": [
    {
      "localClaimId": "",
      "finalRole": "thesis|pillar|evidence|background|opposing_claim|unclear",
      "articleStance": "endorses|rejects|neutral|unclear",
      "parentClaimId": "",
      "thesisLoadScore": 0
    }
  ]
}

Include one claimAssignments item for every input localClaimId.
```

**Key Features:**
- ✅ Document-level synthesis (no longer exists in TM4)
- ✅ globalThesis assignment
- ✅ globalPillars with memberClaimIds
- ✅ claimRelationships (supports/opposes/evidence_for/background_to)
- ✅ claimAssignments with finalRole and articleStance per claim
- ✅ thesisLoadScore (importance weighting)

### NEW: [REMOVED - REPLACED BY THEME FUSION]

**Status:** Document synthesis replaced by:
- `fuseSurveyThemesIntoFrame()` (Prompt 6 - theme fusion, not document synthesis)
- `reduceEvaluationClaims()` (Prompt 8 - reduction/selection)

**Missing from TM4:**
- ❌ globalThesis/globalPillars assignment
- ❌ claimRelationships mapping
- ❌ finalRole assignment at document level
- ❌ thesisLoadScore

---

## SYSTEM 3: COMPLEX TARGET MAPPING (REPLACED)

### OLD: claim_complex_target_mapping (DB Prompt)

**Source:** `backend/deploy/2026-07-04-01-seed-local-claim-extraction-prompts.sql`

```
SYSTEM:
Resolve one complex claim using only its article thesis, claim text, exact local
excerpt, and already-extracted local metadata. Return strict JSON only. Do not fact-check and do
not use outside knowledge.

Separate attribution (who made an allegation) from substantive truth (whether the alleged conduct
occurred). Preserve the named actor, alleged action, object acted upon, and study/document clues.
Do not broaden a specific misconduct or data-handling allegation into a generic topic. If the exact
study is not named, say underspecified and retain every available identity clue.

USER:
ARTICLE THESIS:
{{articleThesis}}

ONE CLAIM:
{{claimText}}

LOCAL SOURCE EXCERPT:
{{localSourceExcerpt}}

EXTRACTED LOCAL METADATA:
{{metadataJson}}

Return:
{
  "objectClaim": "",
  "speakerEntity": "",
  "subjectEntity": "",
  "allegedAction": "",
  "actionObject": "",
  "namedStudyOrDocument": "",
  "studyIdentityClues": [],
  "impliesInference": false,
  "inferenceText": "",
  "articleStance": "endorses|rejects|neutral|unclear",
  "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
  "mappingStatus": "resolved|underspecified",
  "confidence": 0,
  "rationale": ""
}
```

**Key Features:**
- ✅ Separate attribution from substantive truth
- ✅ objectClaim vs speakerEntity vs subjectEntity
- ✅ allegedAction & actionObject (misconduct-specific)
- ✅ namedStudyOrDocument with studyIdentityClues
- ✅ impliesInference flag
- ✅ argumentFunction (thesis, supporting_premise, evidence, opposing_claim_to_refute)
- ✅ mappingStatus (resolved vs underspecified)
- ✅ Detailed rationale requirement

### NEW: [REMOVED - PARTIALLY REPLACED BY ARGUMENT MAPPING]

**Status:** Complex target mapping replaced by:
- `argumentMappingEngine.js` (Prompt for argument/evidence mapping, different purpose)

**Missing from TM4:**
- ❌ Explicit attribution vs substantive truth separation
- ❌ objectClaim/speakerEntity/subjectEntity breakdown
- ❌ allegedAction/actionObject (for misconduct claims)
- ❌ studyIdentityClues (for underspecified studies)
- ❌ impliesInference flag
- ❌ argumentFunction mapping (thesis, supporting_premise, evidence, opposing_claim_to_refute)
- ❌ mappingStatus (resolved vs underspecified)

---

## ARCHITECTURAL COMPARISON

### OLD SYSTEM (3-Stage DB Prompts)

```
STAGE 1: claim_local_extraction
  INPUT: Article chunk
  OUTPUT: localClaims[] with:
    - claimText, localSourceExcerpt
    - localRoleSuggestion (unresolved)
    - articleStance, namedActors, namedStudiesOrDocuments
    - thesisCandidate, pillarCandidate flags
    - claimType breakdown, allegedAction, confidence
  
  ↓
  
STAGE 2: claim_document_synthesis
  INPUT: All localClaims from all chunks
  OUTPUT: globalThesis, globalPillars, claimRelationships
          claimAssignments with finalRole per claim
  
  ↓
  
STAGE 3: claim_complex_target_mapping
  INPUT: Claim + local excerpt + metadata + globalThesis
  OUTPUT: objectClaim, speakerEntity, subjectEntity
          allegedAction, namedStudyOrDocument, studyIdentityClues
          argumentFunction, mappingStatus, confidence, rationale
```

### NEW SYSTEM (TM4 - 6+ Stage Hardcoded + DB)

```
STAGE 1: surveyChunk (HARDCODED)
  INPUT: Article chunk + provisionalFrame
  OUTPUT: evaluationCandidateClaims[] + sourceBackgroundCandidates[]
          chunkMiniTheme, relationshipToProvisionalFrame
          pillarHints, localRepetitionSignals
          (0-6 eval cap, 0-2 bg cap)
  
  ↓
  
STAGE 2: detectArticleFrame (HARDCODED - Prompt 4)
  INPUT: Article text + title
  OUTPUT: provisionalThesis, pillars, stance
  
  ↓
  
STAGE 3: fuseSurveyThemesIntoFrame (HARDCODED - Prompt 6)
  INPUT: chunkMiniThemes + relationshipToProvisionalFrame + pillarHints
  OUTPUT: finalFrame with finalPillars, themeShift, gaps
  
  ↓
  
STAGE 4: clusterCandidates (NO PROMPT - uses clusterByText)
  INPUT: evaluationCandidateClaims from all chunks
  OUTPUT: evaluationClusterGroups (exact-text clustering only)
  
  ↓
  
STAGE 5: reduceEvaluationClaims (HARDCODED - Prompt 8)
  INPUT: evaluationClusterGroups + finalFrame
  OUTPUT: selectedEvaluationClaims[] (0-12 capped at reduction)
          (MISSING: finalRole, articleStance, allegedAction, mappingStatus)
  
  ↓
  
STAGE 6: argumentMappingEngine (DB Prompt)
  INPUT: selectedEvaluationClaims (optional)
  OUTPUT: Evidence targets + argument mapping (different purpose)
```

---

## KEY LOSSES IN MIGRATION

### Extracted Per-Claim Metadata

| Field | Old System | New TM4 | Impact |
|-------|-----------|---------|--------|
| localSourceExcerpt | ✅ 1-3 exact sentences | ⚠️ vague "localSourceExcerpt" | Audit trail weakened |
| localRoleSuggestion | ✅ Explicit (thesis, pillar, evidence, background) | ❌ Removed | Role determination deferred |
| articleStance | ✅ Explicit (endorses, rejects, neutral) | ❌ Removed | Stance determination deferred |
| allegedAction | ✅ Explicit (for misconduct) | ❌ Removed | Misconduct claims weakened |
| thesisCandidate | ✅ Boolean flag | ❌ Removed | No thesis hint at extraction |
| pillarCandidate | ✅ Boolean flag | ❌ Removed | No pillar hint at extraction |
| claimType | ✅ 7-boolean breakdown | ⚠️ Simplified claimType | Type granularity lost |
| confidence | ✅ 0-1.0 per claim | ❌ Removed | Confidence not tracked |

### Document-Level Integration

| Feature | Old System | New TM4 | Impact |
|---------|-----------|---------|--------|
| globalThesis | ✅ Assigned from claims | ⚠️ Inferred from frame only | Thesis tied to claims lost |
| globalPillars | ✅ With memberClaimIds | ⚠️ Inferred in fusion | Pillar membership lost |
| claimRelationships | ✅ supports/opposes/evidence | ❌ Removed | Argument structure lost |
| finalRole | ✅ Assigned at document stage | ⚠️ Assigned at reduction only | Claims lack roles mid-pipeline |
| thesisLoadScore | ✅ Importance weighting | ⚠️ importanceToArticleGuess | Weighting model changed |

### Misconduct-Specific Handling

| Field | Old System | New TM4 | Impact |
|-------|-----------|---------|--------|
| objectClaim | ✅ Explicit | ❌ Removed | Misconduct object unclear |
| speakerEntity | ✅ Explicit | ❌ Removed | Attribution unclear |
| subjectEntity | ✅ Explicit | ❌ Removed | Subject of misconduct unclear |
| allegedAction | ✅ Explicit | ❌ Removed | Action not tracked |
| actionObject | ✅ Explicit | ❌ Removed | Object of action not tracked |
| studyIdentityClues | ✅ Array of clues | ❌ Removed | Underspecified studies harder |
| mappingStatus | ✅ resolved vs underspecified | ❌ Removed | Can't flag incomplete info |
| rationale | ✅ Required explanation | ❌ Removed | Decisions not explained |

---

## SUMMARY: What Changed

### Removed (Lost Capability)

```diff
- Document-level synthesis (globalThesis, globalPillars, claimRelationships)
- Complex target mapping (objectClaim, speakerEntity, subjectEntity breakdown)
- Misconduct-specific fields (allegedAction, actionObject, studyIdentityClues)
- Metadata completeness (confidence, mappingStatus, articleStance at extraction)
- Attribution vs substantive truth separation
- Audit trail (explicit source excerpts, role suggestions, thesis/pillar flags)
```

### Added (New Capability)

```diff
+ Per-chunk mini-theme labeling (chunkMiniTheme)
+ Per-chunk relationship to frame (relationshipToProvisionalFrame)
+ Per-chunk repetition tracking (localRepetitionSignals)
+ Provisional frame detection before extraction (surveyChunk receives frame)
+ Theme fusion stage (themes + hints → finalFrame + pillars)
+ Clustering stage (merges related candidates, currently exact-text only)
+ Reduction stage (selects top N claims per lane)
```

### Hardcoded (No Longer DB-Driven)

```diff
- claim_local_extraction: DB → HARDCODED surveyChunk
- claim_document_synthesis: DB → REMOVED (replaced by fuseSurveyThemesIntoFrame)
- claim_complex_target_mapping: DB → REMOVED (partially replaced by argumentMappingEngine)
+ Caps hardcoded: 0-6 eval, 0-2 bg per chunk
+ Temperature: 0.1 → 0.3 (loosened in recent commit)
+ Schema: simplified and restructured
```

---

## IMPLICATIONS FOR TM4 REPAIR

### Why TM4 Extracts Fewer Candidates

The old system extracted **5-30 claims per chunk** (token-based).  
The new system extracts **0-6 evaluation, 0-2 background per chunk** (hardcoded).

**Root cause:** Hardcoded caps replaced the DB-driven flexible extraction.

### Why Thompson/MMR Context Is Lost

The old system extracted:
- `localRoleSuggestion` (guidance on role)
- `articleStance` (independent assessment)
- `allegedAction` (for misconduct)
- `thesisCandidate` & `pillarCandidate` (flags)

The new system provides:
- `roleHint` (assigned by LLM without prior guidance)
- NO articleStance (guessed by reducer)
- NO allegedAction
- NO explicit candidate flags

**Result:** Thompson story (misconduct + whistleblower + data omission) loses structure because `allegedAction` and `studyIdentityClues` are gone.

### Why Document Synthesis Is Missing

The old system had an explicit **Stage 2: document synthesis** that:
- Assigned globalThesis
- Identified globalPillars with memberClaimIds
- Mapped claimRelationships (supports/opposes/evidence_for)
- Assigned finalRole per claim at document scope

The new system spreads this across:
- **Frame detection** (detects thesis from article only, not from claims)
- **Theme fusion** (merges mini-themes, not claims)
- **Reduction** (selects claims, but no relationship mapping)

**Result:** No explicit document structure. Claims selected independently; relationships inferred only via frame.

---

## TO FIX TM4 (Based on This Diff)

### Option A: Restore DB-Driven Prompts

Revert to 3-stage system, restore to PromptManager:
- claim_local_extraction (with thesisCandidate, pillarCandidate, articleStance)
- claim_document_synthesis (with globalThesis, globalPillars, relationships)
- claim_complex_target_mapping (with objectClaim, allegedAction breakdown)

### Option B: Enhance Hardcoded TM4 (Current Path)

Keep TM4 architecture, add:
- Raise caps: 0-12 eval, 0-4 bg (Mode B v2)
- Restore missing fields: allegedAction, studyIdentityClues, mappingStatus
- Add document synthesis stage (themeRelationships, pillarMembership)
- Add attribution separation (objectClaim vs speakerEntity)

### Option C: Hybrid

Keep TM4's per-chunk frame-aware extraction, add:
- Document synthesis step (after clustering)
- Complex target mapping (for misconduct claims)
- Keep DB-driven prompts for synthesis + mapping

---

**Status: DIFF COMPLETE**

All three old prompts documented alongside current TM4 implementation.

