# Evidence System Fixes - May 8, 2026

## Issues Fixed

### Bug #1: Claim Extraction Mode Hardcoded ❌ → ✅
**File**: `backend/src/core/processTaskClaims.js`

**Problem**:
- Extraction mode was hardcoded to `'ranked'` on line 16
- Admin panel settings and database config were completely ignored
- Users couldn't switch between 'edge', 'ranked', and 'comprehensive' modes

**Fix Applied**:
1. Removed hardcoded `const EXTRACTION_MODE = 'ranked'`
2. Added `extractionMode` parameter to function signature (optional)
3. Load extraction mode from database in this priority:
   - Use provided `extractionMode` parameter (if given)
   - Check `content.extraction_mode` for content-specific setting
   - Fall back to `evidence_search_config.extraction_mode` for default
   - Ultimate fallback: `'edge'`
4. Use loaded mode throughout function instead of hardcoded constant

**Database Queries Added**:
```sql
-- Content-specific mode
SELECT extraction_mode FROM content WHERE content_id = ?

-- Default mode
SELECT config_value FROM evidence_search_config WHERE config_key = 'extraction_mode'
```

**Impact**:
- Admin panel extraction mode selector NOW WORKS
- Per-content extraction modes NOW WORK
- All three modes ('edge', 'ranked', 'comprehensive') are now accessible

---

### Bug #2: Evidence Engine Constructor Had Hardcoded Limits ⚠️ → ✅
**File**: `backend/src/core/runEvidenceEngine.js`

**Problem**:
- Constructor created engine with hardcoded limits (queriesPerClaim: 4, maxEvidenceCandidates: 2)
- Database config was loaded AFTER engine creation
- Confusing code - looked like it ignored database but actually worked because `runOptions` overrode constructor

**Fix Applied**:
1. Moved database config loading BEFORE engine creation
2. Removed hardcoded limits from constructor
3. Cleaner flow: Load DB config → Create engine → Use config in runOptions

**Impact**:
- Cleaner, more maintainable code
- No functional change (was already working via override)
- Easier to understand config flow

---

## Prompt Loading Optimization Needed (Not Yet Fixed)

### Issue: Double-Loading of Claim Extraction Prompts
**File**: `backend/src/core/claimsEngine.js:163-212`

**Problem**:
In `analyzeChunk()`, prompts are loaded TWICE:
1. **First load** (line 172): Load with dummy values (5, 12) to get `max_claims` from database
2. **Second load** (line 207): Load again with calculated `minClaims` and `max_claims`

**Why It Happens**:
- Need to know `max_claims` from database to determine `minClaims`
- But `minClaims` depends on article length
- Template variables `{{minClaims}}` and `{{maxClaims}}` require both values

**Potential Fix** (NOT YET IMPLEMENTED):
```javascript
// Option 1: Separate max_claims query
const maxClaimsResult = await query(
  `SELECT max_claims FROM llm_prompts WHERE prompt_name LIKE 'claim_extraction_%' LIMIT 1`
);
const dbMaxClaims = maxClaimsResult?.[0]?.max_claims || 12;

// Then load prompt once with calculated values
const prompts = await this.loadClaimExtractionPrompts(...);

// Option 2: Add getPromptParameters() method to PromptManager
const params = await promptManager.getPromptParameters('claim_extraction_edge_no_topics');
const dbMaxClaims = params.max_claims || 12;
```

**Impact**: Minor performance improvement, cleaner code

---

## Evidence Prompts (Already Working Correctly ✅)

Evidence prompts are loaded via `PromptManager` in `evidenceEngine.js`:

```javascript
// Query generation prompts
const systemPrompt = await this.deps.promptManager.getPrompt(
  'evidence_query_generation_system',
  fallback
);

const userPrompt = await this.deps.promptManager.getPrompt(
  searchMode?.enableBalancedSearch
    ? 'evidence_query_generation_user_balanced'
    : 'evidence_query_generation_user',
  fallback
);
```

These are loaded from `llm_prompts` table with 5-minute cache. Works correctly.

---

## How to Test

### Test Claim Extraction Mode

1. **Via Admin Panel**:
   ```
   Dashboard → /admin → Evidence Operations → Claim Extraction Mode
   Change dropdown to "Edge" → Save
   Scrape a new article
   Check logs: Should see "Using extraction mode: edge"
   ```

2. **Via API**:
   ```bash
   # Set default mode
   curl -X PUT http://localhost:5001/api/extraction-mode/default \
     -H "Content-Type: application/json" \
     -d '{"extractionMode": "comprehensive"}'

   # Set per-content mode
   curl -X PUT http://localhost:5001/api/content/123/extraction-mode \
     -H "Content-Type: application/json" \
     -d '{"extractionMode": "edge"}'
   ```

3. **Check Logs**:
   ```
   📋 [processTaskClaims] Using default extraction mode: edge
   🟩 [processTaskClaims] Using extraction mode: edge
   ✅ [ClaimExtractor] Loaded edge mode prompts: claim_extraction_edge_no_topics
   ```

### Test Evidence Search Mode

1. **Via Admin Panel**:
   ```
   Dashboard → /admin → Evidence Operations → Evidence Search Modes
   Change dropdown to "Balanced All Claims"
   Scrape article → Run evidence
   ```

2. **Check Logs**:
   ```
   🔧 [Evidence] Search mode: balanced_all_claims
   🔧 [Evidence] Mode config: { enableBalancedSearch: true, ... }
   🎯 [EV][queries] BALANCED SEARCH MODE ACTIVE - Targeting 3 support, 3 refute, 3 nuance
   ```

---

## Database Migration Needed

Ensure this column exists (run if needed):

```sql
-- Add extraction_mode column to content table
ALTER TABLE content
ADD COLUMN extraction_mode VARCHAR(50) DEFAULT NULL
COMMENT 'Claim extraction mode: edge, ranked, comprehensive';

-- Ensure default extraction mode config exists
INSERT INTO evidence_search_config (config_key, config_value, description)
VALUES (
  'extraction_mode',
  'edge',
  'Default claim extraction mode: edge, ranked, comprehensive'
)
ON DUPLICATE KEY UPDATE config_key = config_key;
```

---

## Files Modified

1. `backend/src/core/processTaskClaims.js` - Fixed hardcoded extraction mode
2. `backend/src/core/runEvidenceEngine.js` - Cleaned up constructor, moved DB load earlier
3. `EVIDENCE_GATHERING_SYSTEM.md` - Comprehensive documentation created
4. `EVIDENCE_SYSTEM_FIXES.md` - This file

---

## Summary

**Before**:
- Claim extraction: Always 'ranked', database ignored ❌
- Evidence search: Worked but confusing code ⚠️
- Users: Frustrated that admin panel had no effect

**After**:
- Claim extraction: Reads from database, respects admin settings ✅
- Evidence search: Clean code, database-driven ✅
- Users: Can actually control extraction strategy via admin panel ✅

**Remaining**:
- Optimize double-loading of claim extraction prompts (minor performance issue)
- Add database migration if extraction_mode column doesn't exist
