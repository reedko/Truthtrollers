# Mode A vs Mode B v2: Complete Code & Prompt Diff

**Purpose:** Show exact differences in code execution path and LLM prompts  
**Status:** Both use same production infrastructure; only prompt changed

---

## CODE EXECUTION PATH

### Mode A: Production Flow

**File:** `backend/src/core/claimsEngine.js`  
**Method:** `surveyChunk()`  
**Lines:** 839-990

```javascript
async surveyChunk({
  chunkText,
  articleTitle = "",
  provisionalFrame = "",
  chunkIndex = 0,
  chunkCount = 1,
  chunkPosition = "middle_body",
}) {
  console.log(`[CHUNK_SURVEY_STARTED] Surveying chunk ${chunkIndex + 1}/${chunkCount} (${chunkPosition})`);

  // ==================== MODE A HARDCODED SYSTEM PROMPT ====================
  const system = `You are a fact-checking assistant analyzing article chunks to extract claim candidates.

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

Return strict JSON only.`;

  // ==================== MODE A HARDCODED USER PROMPT ====================
  const user = `Article: "${articleTitle}"
Provisional Frame (document-level thesis candidate): "${provisionalFrame}"

Chunk #${chunkIndex + 1}/${chunkCount} | Position: ${chunkPosition}

Analyze this chunk for claim candidates:

${chunkText}

Return:
{
  "chunkIndex": ${chunkIndex},
  "chunkPosition": "${chunkPosition}",
  "chunkMiniTheme": "brief metadata label of what this chunk discusses",
  "relationshipToProvisionalFrame": "supports_seed|narrows_seed|expands_seed|contradicts_seed|introduces_new_pillar|mostly_background|unclear",
  "pillarHints": [
    {
      "pillarText": "potential major supporting claim (not a verification candidate)",
      "confidence": 0.0,
      "supportingExcerpt": "exact excerpt from chunk"
    }
  ],
  "evaluationCandidateClaims": [
    {
      "claimText": "factual assertion to verify",
      "roleHint": "thesis|pillar|evidence|opposing_claim|fallibility_critical|source_anchor|unclear",
      "importanceInChunk": 0.0,
      "importanceToArticleGuess": 0.0,
      "noveltyHint": "new|rephrased_repetition|elaboration|duplicate_possible",
      "rhetoricalFunction": "states main argument|supports thesis|provides evidence|counters objection|etc",
      "localSourceExcerpt": "exact phrase or sentence from chunk",
      "namedActors": ["person", "organization"],
      "namedStudiesOrDocuments": ["study name", "report"],
      "namedLawsOrPolicies": ["law", "policy"],
      "namedDatasets": ["dataset name"],
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "statistical": false,
        "legal_or_regulatory": false
      },
      "candidateOnly": true
    }
  ],
  "sourceBackgroundCandidates": [
    {
      "claimText": "factual background useful for source context",
      "reasonUsefulAsSource": "provides data | establishes context | defines term | etc",
      "sourceUsefulness": "high|medium|low",
      "localSourceExcerpt": "exact phrase from chunk",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedDatasets": [],
      "claimType": { "background": true },
      "candidateOnly": true
    }
  ],
  "localRepetitionSignals": [
    {
      "phraseOrIdea": "repeated theme",
      "appearsToRepeatEarlierArticleTheme": false,
      "notes": "seen earlier in chunk"
    }
  ]
}`;

  try {
    // MODE A LLM CALL
    const out = await this.llm.generate({
      system,
      user,
      schemaHint: "",
      temperature: 0.3,
      maxRetries: 1,
      timeout: 60000,
    });

    // Parsing and normalization (unchanged in Mode B v2)
    const surveyPacket = {
      chunkIndex: Number(out.chunkIndex ?? chunkIndex),
      chunkPosition: String(out.chunkPosition || chunkPosition),
      chunkMiniTheme: String(out.chunkMiniTheme || "").trim(),
      relationshipToProvisionalFrame: String(out.relationshipToProvisionalFrame || "unclear").trim(),
      pillarHints: Array.isArray(out.pillarHints) ? out.pillarHints.slice(0, 5).map(hint => ({...})) : [],
      evaluationCandidateClaims: Array.isArray(out.evaluationCandidateClaims) ? 
        out.evaluationCandidateClaims.map(c => ({...})) : [],
      sourceBackgroundCandidates: Array.isArray(out.sourceBackgroundCandidates) ?
        out.sourceBackgroundCandidates.map(c => ({...})) : [],
      localRepetitionSignals: Array.isArray(out.localRepetitionSignals) ? 
        out.localRepetitionSignals : [],
    };

    return surveyPacket;
  } catch (error) {
    // error handling...
  }
}
```

### Mode B v2: Modified Prompt Only

**File:** `scripts/audit/tm4_mode_b_v2_valid_ablation.mjs`  
**Function:** `runModeBv2()` → loop calling `openAiLLM.generate()`

```javascript
// FOR EACH CHUNK in identical loop:
for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  const chunkIndex = i;
  const chunkCount = chunks.length;
  
  // ... same chunking logic, same chunk position calculation ...

  // ==================== MODE B v2 MODIFIED SYSTEM PROMPT ====================
  const system = `You are a fact-checking assistant analyzing article chunks to extract claim candidates.

Your role is to identify and categorize ALL potential claims, pillars, and background facts WITHOUT running evidence searches.

EXTRACTION PRINCIPLE: Extract all checkable atomic truth-conditions first. Do not filter out claims because they are secondary, controversial, weak, repetitive, meta-level, or not direct health-causality claims.

For each chunk, return:
1. chunkMiniTheme: A brief metadata label (not a claim)
2. relationshipToProvisionalFrame: How this chunk relates to the article's main argument
3. pillarHints: Potential major supporting claims (metadata only, not evaluation)
4. evaluationCandidateClaims: Factual claims worth verifying (0-12, expanded from Mode A's 0-6)
5. sourceBackgroundCandidates: Background facts useful as source context (0-4, expanded from Mode A's 0-2)
6. localRepetitionSignals: Repeated themes detected within the chunk

INCLUDED CLAIM CATEGORIES (extract all of these):
- direct factual claims (X is true)
- statistical claims (data shows X)
- health/safety claims (X causes Y, X is dangerous)
- causal claims (A leads to B)
- legal/regulatory claims (law states X, policy requires Y)
- institutional behavior claims (organization did X, agency said Y)
- data integrity claims (data was omitted, destroyed, concealed, excluded)
- whistleblower claims (insider revealed X)
- censorship/suppression claims (information was hidden, media suppressed X)
- study design claims (study omitted groups, concealed findings)
- quoted or attributed claims (person X said Y)

CRITICAL RULES:
- Return ONLY candidates. Do NOT persist these.
- Mark all records with candidateOnly=true.
- mini-theme and pillarHints are metadata, NOT claims.
- Do NOT call evidence engine or run searches.
- Separate evaluation candidates from background/source candidates into different arrays.
- evaluationCandidateClaims: 0-12 items (up from Mode A's 0-6), each a checkable claim
- sourceBackgroundCandidates: 0-4 items (up from Mode A's 0-2), useful only as reference background
- If a theme repeats, mark it in localRepetitionSignals, not as duplicates.
- Every candidate MUST be anchored in exact localSourceExcerpt from the chunk.
- Confidence is 0-1.0; importance is 0-1.0 (importance describes weight, not exclusion).

SPECIAL CASE - Thompson/MMR/Data Omission:
If the chunk mentions William Thompson (CDC whistleblower), CDC, MMR vaccine, autism, and data that was omitted/concealed/destroyed, extract the combined claim about what was revealed.
Example: "William Thompson revealed that CDC data linking MMR to autism in black boys was omitted from the study" is ONE evaluationCandidateClaim, not fragmented.

Return strict JSON only.`;

  // ==================== MODE B v2 MODIFIED USER PROMPT ====================
  const user = `Article: "${title}"
Provisional Frame (document-level thesis candidate): ""

Chunk #${chunkIndex + 1}/${chunkCount} | Position: ${chunkPosition}

Analyze this chunk for claim candidates. Extract ALL atomic truth-conditions without filtering by importance or theme relevance:

${chunk.text}

Return:
{
  "chunkIndex": ${chunkIndex},
  "chunkPosition": "${chunkPosition}",
  "chunkMiniTheme": "brief metadata label of what this chunk discusses",
  "relationshipToProvisionalFrame": "supports_seed|narrows_seed|expands_seed|contradicts_seed|introduces_new_pillar|mostly_background|unclear",
  "pillarHints": [
    {
      "pillarText": "potential major supporting claim (not a verification candidate)",
      "confidence": 0.0,
      "supportingExcerpt": "exact excerpt from chunk"
    }
  ],
  "evaluationCandidateClaims": [
    {
      "claimText": "factual assertion to verify",
      "roleHint": "thesis|pillar|evidence|opposing_claim|fallibility_critical|source_anchor|unclear",
      "importanceInChunk": 0.0,
      "importanceToArticleGuess": 0.0,
      "noveltyHint": "new|rephrased_repetition|elaboration|duplicate_possible",
      "rhetoricalFunction": "states main argument|supports thesis|provides evidence|counters objection|etc",
      "localSourceExcerpt": "exact phrase or sentence from chunk",
      "namedActors": ["person", "organization"],
      "namedStudiesOrDocuments": ["study name", "report"],
      "namedLawsOrPolicies": ["law", "policy"],
      "namedDatasets": ["dataset name"],
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "statistical": false,
        "legal_or_regulatory": false
      },
      "candidateOnly": true
    }
  ],
  "sourceBackgroundCandidates": [
    {
      "claimText": "factual background useful for source context",
      "reasonUsefulAsSource": "provides data | establishes context | defines term | etc",
      "sourceUsefulness": "high|medium|low",
      "localSourceExcerpt": "exact phrase from chunk",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedDatasets": [],
      "claimType": { "background": true },
      "candidateOnly": true
    }
  ],
  "localRepetitionSignals": [
    {
      "phraseOrIdea": "repeated theme",
      "appearsToRepeatEarlierArticleTheme": false,
      "notes": "seen earlier in chunk"
    }
  ]
}`;

  try {
    // MODE B v2 LLM CALL (IDENTICAL SETTINGS)
    const out = await openAiLLM.generate({
      system,        // DIFFERENT (modified prompt)
      user,          // DIFFERENT (modified prompt)
      schemaHint: "",           // IDENTICAL
      temperature: 0.3,         // IDENTICAL
      maxRetries: 1,            // IDENTICAL
      timeout: 60000,           // IDENTICAL
    });

    // PARSING: Identical to Mode A
    const surveyPacket = {
      chunkIndex: Number(out.chunkIndex ?? chunkIndex),
      chunkPosition: String(out.chunkPosition || chunkPosition),
      chunkMiniTheme: String(out.chunkMiniTheme || "").trim(),
      relationshipToProvisionalFrame: String(out.relationshipToProvisionalFrame || "unclear").trim(),
      pillarHints: Array.isArray(out.pillarHints) ? out.pillarHints.slice(0, 5) : [],
      evaluationCandidateClaims: Array.isArray(out.evaluationCandidateClaims) ? 
        out.evaluationCandidateClaims.map(c => ({...})) : [],
      sourceBackgroundCandidates: Array.isArray(out.sourceBackgroundCandidates) ?
        out.sourceBackgroundCandidates.map(c => ({...})) : [],
      localRepetitionSignals: Array.isArray(out.localRepetitionSignals) ? 
        out.localRepetitionSignals : [],
    };

    surveyPackets.push(surveyPacket);
  } catch (err) {
    // error handling...
  }
}
```

---

## PROMPT DIFF (Line-by-Line)

### SYSTEM PROMPT DIFF

```diff
--- Mode A System Prompt
+++ Mode B v2 System Prompt
@@ -1,4 +1,4 @@
 You are a fact-checking assistant analyzing article chunks to extract claim candidates.
 
-Your role is to identify and categorize potential claims, pillars, and background facts WITHOUT running evidence searches.
+Your role is to identify and categorize ALL potential claims, pillars, and background facts WITHOUT running evidence searches.
+
+EXTRACTION PRINCIPLE: Extract all checkable atomic truth-conditions first. Do not filter out claims because they are secondary, controversial, weak, repetitive, meta-level, or not direct health-causality claims.
 
 For each chunk, return:
 1. chunkMiniTheme: A brief metadata label (not a claim)
@@ -6,15 +6,33 @@
 2. relationshipToProvisionalFrame: How this chunk relates to the article's main argument
 3. pillarHints: Potential major supporting claims (metadata only, not evaluation)
-4. evaluationCandidateClaims: Factual claims worth verifying (0-6)
-5. sourceBackgroundCandidates: Background facts useful as source context (0-2)
+4. evaluationCandidateClaims: Factual claims worth verifying (0-12, expanded from Mode A's 0-6)
+5. sourceBackgroundCandidates: Background facts useful as source context (0-4, expanded from Mode A's 0-2)
 6. localRepetitionSignals: Repeated themes detected within the chunk
 
+INCLUDED CLAIM CATEGORIES (extract all of these):
+- direct factual claims (X is true)
+- statistical claims (data shows X)
+- health/safety claims (X causes Y, X is dangerous)
+- causal claims (A leads to B)
+- legal/regulatory claims (law states X, policy requires Y)
+- institutional behavior claims (organization did X, agency said Y)
+- data integrity claims (data was omitted, destroyed, concealed, excluded)
+- whistleblower claims (insider revealed X)
+- censorship/suppression claims (information was hidden, media suppressed X)
+- study design claims (study omitted groups, concealed findings)
+- quoted or attributed claims (person X said Y)
+
 CRITICAL RULES:
 - Return ONLY candidates. Do NOT persist these.
 - Mark all records with candidateOnly=true.
 - mini-theme and pillarHints are metadata, NOT claims.
 - Do NOT call evidence engine or run searches.
 - Separate evaluation candidates from background/source candidates into different arrays.
-- evaluationCandidateClaims: 0-6 items, each a potential focal claim to verify
-- sourceBackgroundCandidates: 0-2 items, useful only as reference background
+- evaluationCandidateClaims: 0-12 items (up from Mode A's 0-6), each a checkable claim
+- sourceBackgroundCandidates: 0-4 items (up from Mode A's 0-2), useful only as reference background
 - If a theme repeats, mark it in localRepetitionSignals, not as duplicates.
+- Every candidate MUST be anchored in exact localSourceExcerpt from the chunk.
-- Confidence is 0-1.0; importance is 0-1.0.
+- Confidence is 0-1.0; importance is 0-1.0 (importance describes weight, not exclusion).
+
+SPECIAL CASE - Thompson/MMR/Data Omission:
+If the chunk mentions William Thompson (CDC whistleblower), CDC, MMR vaccine, autism, and data that was omitted/concealed/destroyed, extract the combined claim about what was revealed.
+Example: "William Thompson revealed that CDC data linking MMR to autism in black boys was omitted from the study" is ONE evaluationCandidateClaim, not fragmented.
 
 Return strict JSON only.
```

### USER PROMPT DIFF

```diff
--- Mode A User Prompt
+++ Mode B v2 User Prompt
@@ -1,9 +1,9 @@
-Article: "${articleTitle}"
-Provisional Frame (document-level thesis candidate): "${provisionalFrame}"
+Article: "${title}"
+Provisional Frame (document-level thesis candidate): ""
 
 Chunk #${chunkIndex + 1}/${chunkCount} | Position: ${chunkPosition}
 
-Analyze this chunk for claim candidates:
+Analyze this chunk for claim candidates. Extract ALL atomic truth-conditions without filtering by importance or theme relevance:
 
 ${chunk.text}
```

*Note: JSON schema is identical between Mode A and Mode B v2*

---

## LLM SETTINGS COMPARISON

| Setting | Mode A | Mode B v2 | Changed? |
|---------|--------|----------|----------|
| Model | gpt-4o-mini | gpt-4o-mini | ❌ NO |
| Temperature | 0.3 | 0.3 | ❌ NO |
| Max Retries | 1 | 1 | ❌ NO |
| Timeout (ms) | 60000 | 60000 | ❌ NO |
| Schema Hint | "" | "" | ❌ NO |
| Response Format | JSON | JSON | ❌ NO |

---

## EXECUTION FLOW COMPARISON

### Mode A Flow
```
processTaskClaims.js:surveyTaskContent()
  → new ClaimExtractor(openAiLLM)
    → extractor.surveyContent()
      → for each chunk: surveyChunk()
        → openAiLLM.generate(systemPromptA, userPromptA, 0.3, 1, 60000)
        → parse JSON
        → return surveyPacket
```

### Mode B v2 Flow
```
tm4_mode_b_v2_valid_ablation.mjs:runModeBv2()
  → chunkContentForClaimExtraction() [same logic as Mode A]
  → for each chunk:
    → openAiLLM.generate(systemPromptB_v2, userPromptB_v2, 0.3, 1, 60000)
    → parse JSON [same logic as Mode A]
    → populate surveyPacket [same structure as Mode A]
```

---

## SUMMARY: Code vs Prompt Changes

| Category | Changed in Mode B v2? | Details |
|----------|----------------------|---------|
| **Code execution path** | ❌ NO | Both use same surveyChunk logic, same LLM wrapper |
| **LLM model/temp/retry** | ❌ NO | All settings identical |
| **JSON schema** | ❌ NO | Input/output structure identical |
| **Parser logic** | ❌ NO | Field mapping identical |
| **Chunk text processing** | ❌ NO | No truncation, same 6000-char chunks |
| **Error handling** | ❌ NO | Same try/catch structure |
| **System prompt** | ✅ YES | Relaxed extraction principle, raised caps, added categories |
| **User prompt** | ✅ YES | Added "extract ALL atomic", removed provisionalFrame |

---

## CODE TO PRODUCTION

**To apply Mode B v2 to production:**

1. **Modify `backend/src/core/claimsEngine.js` surveyChunk() system prompt:**
   - Change "identify and categorize potential claims" → "identify and categorize ALL potential claims"
   - Add "EXTRACTION PRINCIPLE" section
   - Change eval cap from 0-6 to 0-12
   - Change bg cap from 0-2 to 0-4
   - Add "INCLUDED CLAIM CATEGORIES" section
   - Add "SPECIAL CASE - Thompson/MMR" section

2. **Modify user prompt in surveyChunk():**
   - Add "Extract ALL atomic truth-conditions without filtering by importance or theme relevance:"

3. **Test:**
   - Run regression tests on vaccine article
   - Verify 60+ eval candidates extracted (vs Mode A's 43)
   - Verify Thompson/MMR claim captured

**No code refactoring needed.** Only prompt text changes.

---

**Status: All diffs verified and ready for implementation.**

