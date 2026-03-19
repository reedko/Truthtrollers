# Evidence Query Prompt Migration Summary

## What Was Done

### 1. Created Database Migration
**File:** `migrations/add_evidence_query_prompt.js`

Added two new prompts to the `llm_prompts` table:
- `evidence_query_generation_system` (prompt_id: 11)
- `evidence_query_generation_user` (prompt_id: 12)

These prompts include the NEW requirements for finding balanced sources:
- **At least 2 SUPPORT sources (prefer 3)**
- **At least 2 REFUTE sources (prefer 3)**
- **At least 1 NUANCE source (prefer 3)**

### 2. Updated Code to Use Database Prompts
**Files Modified:**
- `src/core/runEvidenceEngine.js` - Added promptManager initialization
- `src/core/evidenceEngine.js` - Updated `generateQueries()` method to load prompts from database

### 3. Migration Status
✅ Migration executed successfully
✅ Prompts added to database (confirmed via migration output)
✅ Code updated to use promptManager.getPrompt()
✅ Fallback prompts included in case database fails

## The Prompt Content

### System Prompt
```
You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.
```

### User Prompt Template
```
Claim: {{claimText}}
Context: {{context}}

Task: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.
```

## How It Works Now

1. When `runEvidenceEngine()` is called, it creates a PromptManager instance
2. PromptManager is passed to EvidenceEngine in the deps object
3. In `generateQueries()`:
   - First tries to load prompts from database via `promptManager.getPrompt()`
   - If database load succeeds, uses DB prompts with template variable replacement
   - If database load fails, falls back to hardcoded prompts
   - Template variables (`{{claimText}}`, `{{context}}`, `{{n}}`) are replaced with actual values

## Benefits

✅ **Version Control** - Prompts are now versioned in the database
✅ **Hot Updates** - Can update prompts without code changes (via promptManager cache TTL)
✅ **Centralized** - All prompts in one place (llm_prompts table)
✅ **Consistent** - Follows same pattern as claim extraction prompts
✅ **Resilient** - Falls back to hardcoded prompts if database fails

## Next Steps (Remaining Prompts to Migrate)

Still hardcoded (from audit):
1. ❌ Claim Filtering/Scoring (claimsEngine.js:164-198)
   - Note: `claim_filtering` already exists in DB but NOT being used!
2. ❌ Evidence Engine - Red Team Review (evidenceEngine.js:344-412)
3. ❌ Extract Quote from Text (extractQuote.js:29-42)
4. ❌ Assess Claim Relevance (assessClaimRelevance.js:24-48)
5. ❌ Match Claims to Task Claims (matchClaims.js:32-74)
6. ❌ Search Analysis - Canonical Mapping (search-analysis.routes.js:150-153)
7. ❌ Snippet Analysis (runEvidenceEngine.js:614-617)

## Verification

To verify the prompts are loaded correctly, you can:
1. Check the database: `SELECT * FROM llm_prompts WHERE prompt_name LIKE 'evidence_query%'`
2. Run a scrape task and check logs for: `📋 [PromptManager] Loaded prompt from DB: evidence_query_generation_system`
3. Clear cache and re-run to ensure fresh load: PromptManager has 5-minute cache TTL
