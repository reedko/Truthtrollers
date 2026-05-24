# Evidence Gathering System Documentation

## Overview

The Evidence Gathering System is a two-stage process for extracting and verifying claims from content:

1. **Claim Extraction** - Extract factual claims from articles/content
2. **Evidence Search** - Find supporting/refuting evidence for those claims

## Current Issue

**CRITICAL BUG**: The claim extraction mode is hardcoded and ignores database settings.

- Location: `/backend/src/core/processTaskClaims.js:16`
- Problem: `const EXTRACTION_MODE = 'ranked'` is hardcoded
- Impact: Admin panel settings and database configuration are completely ignored
- Status: **NEEDS FIX**

---

## Part 1: Claim Extraction Modes

### What It Does
Extracts factual, verifiable claims from article text. Different modes use different LLM prompts and strategies.

### Available Modes

#### 1. **Edge Mode** (Default - Should Be)
- **Purpose**: Thematic extraction with case claim context
- **Use Case**: Best for extracting claims that are relevant to specific topics/themes
- **Prompt**: `claim_extraction_edge` (with/without topics variants)
- **System Prompt**: `claim_extraction_edge_system`
- **Description**: "Thematic extraction with case claim context"

#### 2. **Ranked Mode** (Currently Hardcoded)
- **Purpose**: Material-first extraction, quality over quantity
- **Use Case**: Extract 3-12 high-quality claims only (single LLM pass, efficient)
- **Prompt**: `claim_extraction_ranked` (with/without topics variants)
- **System Prompt**: `claim_extraction_ranked_system`
- **Description**: "Material-first extraction"
- **Single Pass**: Extraction and filtering happen in one LLM call

#### 3. **Comprehensive Mode**
- **Purpose**: Cast wide net, extract all claims then filter
- **Use Case**: For user ranking UI, when you want to give users choice of which claims to verify
- **Prompt**: `claim_extraction_comprehensive` (with/without topics variants)
- **System Prompt**: `claim_extraction_ranked_system` (shares with ranked)
- **Description**: "Cast wide net"
- **Two Pass**: First extracts all claims, then filters with `filterAndRankClaims()`

### How Extraction Mode Works (Currently Broken)

#### Database Storage
```sql
-- Stored in evidence_search_config table
SELECT config_value FROM evidence_search_config
WHERE config_key = 'extraction_mode';

-- Also stored per-content in content table
SELECT extraction_mode FROM content WHERE content_id = ?;
```

#### Admin Panel Configuration
- **UI**: Dashboard → Admin Panel → Evidence Operations → Claim Extraction Mode
- **File**: `/dashboard/src/components/admin/EvidenceOpsPanel.tsx`
- **Endpoint**: `PUT /api/extraction-mode/default` to set global default
- **Endpoint**: `PUT /api/content/:contentId/extraction-mode` to set per-content

#### Routes
**File**: `/backend/src/routes/extractionModeRoutes.js`

- `GET /api/extraction-modes` - Get available modes
- `GET /api/extraction-mode/default` - Get default mode
- `PUT /api/extraction-mode/default` - Set default mode
- `GET /api/content/:contentId/extraction-mode` - Get content-specific mode
- `PUT /api/content/:contentId/extraction-mode` - Set content-specific mode
- `POST /api/content/:contentId/re-extract` - Trigger re-extraction with specific mode

#### The Bug
**File**: `/backend/src/core/processTaskClaims.js`

```javascript
// LINE 16 - HARDCODED, IGNORES DATABASE
const EXTRACTION_MODE = 'ranked';

// LINE 67 - Uses hardcoded constant
extractionMode: EXTRACTION_MODE,
```

**What Should Happen:**
1. Read from database (per-content mode, or fall back to default mode)
2. Pass mode to `ClaimExtractor.analyzeContent()`
3. Load appropriate prompts from `llm_prompts` table

**What Actually Happens:**
1. Always uses 'ranked' mode
2. Admin panel changes are saved to database but never used
3. Users think they're changing modes but nothing changes

---

## Part 2: Evidence Search Modes

### What It Does
Finds web sources that support, refute, or add nuance to extracted claims.

### Available Modes

#### 1. **High Quality Only**
- **ID**: `high_quality_only`
- **Description**: "Search only high-quality sources (Tavily + Bing)"
- **Speed**: Fastest (~30-60 seconds)
- **Config**:
  ```json
  {
    "queriesPerClaim": 6,
    "maxEvidenceCandidates": 4,
    "enableFringeSearch": false
  }
  ```
- **Best For**: Quick verification, established topics

#### 2. **Fringe on Support** (Default)
- **ID**: `fringe_on_support`
- **Description**: "High-quality sources + fringe sources when strong support found"
- **Speed**: Balanced (~1-2 minutes)
- **Config**:
  ```json
  {
    "queriesPerClaim": 6,
    "maxEvidenceCandidates": 4,
    "enableFringeSearch": true,
    "fringeTrigger": "support",
    "fringeConfidenceThreshold": 0.7,
    "topKFringeQueries": 3,
    "topKFringeCandidates": 3,
    "maxFringeEvidenceCandidates": 2
  }
  ```
- **Best For**: Balanced approach, detect echo chambers
- **Behavior**: When claim has strong support (>0.7 confidence), search fringe sources (DuckDuckGo) to find opposing views

#### 3. **Balanced All Claims**
- **ID**: `balanced_all_claims`
- **Description**: "For every claim: 2-3 support, 2-3 refute, 2-3 nuance sources"
- **Speed**: Most thorough (~2-5 minutes)
- **Config**:
  ```json
  {
    "queriesPerClaim": 9,
    "supportQueries": 3,
    "refuteQueries": 3,
    "nuanceQueries": 3,
    "maxEvidenceCandidates": 9,
    "targetSupport": 3,
    "targetRefute": 3,
    "targetNuance": 3,
    "enableBalancedSearch": true
  }
  ```
- **Best For**: Controversial topics, complete analysis

### Evidence Search Configuration (Working Correctly)

#### Database Storage
```sql
-- Current mode
SELECT config_value FROM evidence_search_config
WHERE config_key = 'search_mode';

-- Mode configurations (JSON)
SELECT config_value FROM evidence_search_config
WHERE config_key = 'mode_config';
```

#### Loading in Code
**File**: `/backend/src/core/runEvidenceEngine.js` (lines 614-638)

```javascript
// ✅ THIS WORKS CORRECTLY - Reads from database
let searchMode = 'fringe_on_support'; // Default
let modeConfig = {};

const configRows = await query(
  `SELECT config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
);
if (configRows && configRows.length > 0) {
  searchMode = configRows[0].config_value;
}

const modeConfigRows = await query(
  `SELECT config_value FROM evidence_search_config WHERE config_key = 'mode_config'`
);
if (modeConfigRows && modeConfigRows.length > 0) {
  const allConfigs = JSON.parse(modeConfigRows[0].config_value);
  modeConfig = allConfigs[searchMode] || {};
}
```

#### Admin Panel (Working)
- **File**: `/dashboard/src/components/admin/EvidenceOpsPanel.tsx`
- **Endpoint**: `PUT /api/evidence-config/mode` to change mode

---

## Part 3: Prompts System

### Storage
All prompts are stored in the `llm_prompts` table:

```sql
CREATE TABLE llm_prompts (
  prompt_id INT PRIMARY KEY,
  prompt_name VARCHAR(100),
  prompt_type ENUM('system', 'user', 'combined'),
  prompt_text TEXT,
  parameters JSON,
  version INT,
  is_active BOOLEAN,
  max_claims INT,
  min_sources INT,
  max_sources INT
);
```

### Prompt Manager
**File**: `/backend/src/core/promptManager.js`

- Loads prompts from database with 5-minute cache
- Supports versioning (multiple versions per prompt, uses latest active)
- Falls back to hardcoded prompts if database fails (DEPRECATED)
- Parses template variables like `{{minClaims}}`, `{{maxClaims}}`

### Claim Extraction Prompts

#### Prompt Naming Convention
```
claim_extraction_{mode}_{variant}
```

**Modes**: `edge`, `ranked`, `comprehensive`
**Variants**: `with_topics`, `no_topics`

**Examples**:
- `claim_extraction_edge_with_topics`
- `claim_extraction_edge_no_topics`
- `claim_extraction_ranked_with_topics`
- `claim_extraction_ranked_no_topics`
- `claim_extraction_comprehensive_with_topics`
- `claim_extraction_comprehensive_no_topics`

#### System Prompts
- `claim_extraction_edge_system`
- `claim_extraction_ranked_system` (also used by comprehensive)

### Evidence Search Prompts
Evidence search has many prompts for different purposes:
- Query generation
- Evidence extraction
- Quality scoring
- Adjudication
- Balanced search queries

**Note**: Evidence search prompts are loaded via PromptManager in `runEvidenceEngine.js`

### How to Edit Prompts

#### Via Admin Panel (Recommended)
1. Go to Dashboard → Admin Panel
2. Navigate to "Evidence Operations" → "Prompt Editor" tab
3. Select prompt from dropdown
4. Edit and save
5. Creates new version, deactivates old version
6. Cache expires in 5 minutes

#### Via Database
```sql
-- Update existing prompt (creates new version)
INSERT INTO llm_prompts
  (prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES
  ('claim_extraction_ranked_no_topics', 'user', 'New prompt text...', '{}', 2, TRUE);

-- Deactivate old version
UPDATE llm_prompts
SET is_active = FALSE
WHERE prompt_name = 'claim_extraction_ranked_no_topics' AND version < 2;
```

---

## Part 4: Complete Flow

### Task Scraping Flow
**Entry Point**: `POST /api/scrape-task`
**File**: `/backend/src/routes/content/content.scrape.routes.js`

```
1. Scrape article → extract text
   ↓
2. processTaskClaims() → extract claims from text
   ├─ Read extraction mode from database (BROKEN - uses hardcoded 'ranked')
   ├─ Load prompts via PromptManager
   ├─ Call LLM with extraction prompt
   └─ Return claim IDs
   ↓
3. runEvidenceEngine() → find evidence for claims
   ├─ Read search mode from database (✅ WORKING)
   ├─ Load evidence prompts via PromptManager
   ├─ Generate search queries
   ├─ Search Tavily + Bing (+ DuckDuckGo if fringe mode)
   ├─ Scrape candidate URLs
   ├─ Extract evidence from each source
   ├─ Score source quality
   └─ Return evidence references
   ↓
4. persistAIResults() → link claims to evidence
   ↓
5. Extract claims FROM references (reference internal claims)
```

### Evidence Rerun Flow
**Entry Point**: `POST /api/content/:contentId/claims/:claimId/evidence/rerun`
**Modal**: `/dashboard/src/components/modals/EvidenceRerunModal.tsx`

**Modes**:
- `standard` - Normal evidence search (~30-60 seconds)
- `deep` - Expanded search queries (~2-5 minutes)
- `balanced` - 3 support, 3 refute, 3 nuance (~1-2 minutes)
- `incremental` - Only new evidence (~10-20 seconds)

**Note**: These are different from the global evidence search modes. They're temporary overrides for re-running evidence on specific claims.

---

## Part 5: Fix Implementation

### Required Changes

#### 1. Modify `processTaskClaims.js`
```javascript
// BEFORE (Line 16):
const EXTRACTION_MODE = 'ranked';

// AFTER: Remove constant, add function parameter
export async function processTaskClaims({
  query,
  taskContentId,
  text,
  claimType = 'task',
  taskClaimsContext = null,
  clearOldLinks = false,
  extractionMode = null  // ← NEW PARAMETER
}) {
  // Load extraction mode from database if not provided
  let mode = extractionMode;

  if (!mode) {
    try {
      // First try content-specific mode
      const contentModeResult = await query(
        `SELECT extraction_mode FROM content WHERE content_id = ?`,
        [taskContentId]
      );

      if (contentModeResult && contentModeResult.length > 0 && contentModeResult[0].extraction_mode) {
        mode = contentModeResult[0].extraction_mode;
      } else {
        // Fall back to default mode
        const defaultModeResult = await query(
          `SELECT config_value FROM evidence_search_config WHERE config_key = 'extraction_mode'`
        );
        mode = (defaultModeResult && defaultModeResult.length > 0)
          ? defaultModeResult[0].config_value
          : 'edge'; // Ultimate fallback
      }
    } catch (err) {
      logger.warn(`⚠️ [processTaskClaims] Failed to load extraction mode from DB, using 'edge':`, err.message);
      mode = 'edge';
    }
  }

  logger.log(`🟩 [processTaskClaims] Using extraction mode: ${mode}`);

  // Use the loaded mode
  const extraction = await extractor.analyzeContent({
    chunks: [{ text, tokenLength: Math.round(text.length / 4) }],
    existingTestimonials: [],
    maxConcurrency: 1,
    extractionMode: mode,  // ← Use loaded mode instead of hardcoded constant
    taskClaimsContext,
  });

  // ... rest of function

  // Update conditional logic to use variable
  if (mode === 'comprehensive') {
    // Filter claims
  } else {
    // Skip filtering
  }
}
```

#### 2. Add Database Migration
```sql
-- Ensure extraction_mode column exists in content table
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

#### 3. Update Call Sites (Optional)
Most call sites don't need changes since the parameter is optional:

```javascript
// In content.scrape.routes.js - Can optionally pass mode
const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text,
  // extractionMode: 'edge'  // Optional - will read from DB if not provided
});
```

---

## Part 6: Testing the Fix

### 1. Verify Database Config
```sql
-- Check default mode
SELECT * FROM evidence_search_config WHERE config_key = 'extraction_mode';

-- Set default mode
UPDATE evidence_search_config
SET config_value = 'edge'
WHERE config_key = 'extraction_mode';

-- Set per-content mode
UPDATE content
SET extraction_mode = 'comprehensive'
WHERE content_id = 123;
```

### 2. Test via Admin Panel
1. Navigate to Admin Panel → Evidence Operations
2. Change "Claim Extraction Mode" dropdown
3. Verify toast confirms change
4. Scrape a new task
5. Check logs for: `🟩 [processTaskClaims] Using extraction mode: edge`

### 3. Test API Directly
```bash
# Get default mode
curl http://localhost:5001/api/extraction-mode/default

# Set default mode
curl -X PUT http://localhost:5001/api/extraction-mode/default \
  -H "Content-Type: application/json" \
  -d '{"extractionMode": "comprehensive"}'

# Get content-specific mode
curl http://localhost:5001/api/content/123/extraction-mode

# Set content-specific mode
curl -X PUT http://localhost:5001/api/content/123/extraction-mode \
  -H "Content-Type: application/json" \
  -d '{"extractionMode": "edge"}'
```

### 4. Verify Prompt Loading
Check logs during scrape:
```
✅ [ClaimExtractor] Loaded edge mode prompts: claim_extraction_edge_no_topics
📋 [PromptManager] Using cached prompt: claim_extraction_edge_system
```

---

## Summary

### What Works ✅
- Evidence search modes (database-driven)
- Prompt management system (PromptManager)
- Admin panel UI for configuration
- Evidence rerun with custom modes
- Database storage for both systems

### What's Broken ❌
- **Claim extraction mode is hardcoded to 'ranked'**
- Admin panel changes to extraction mode are ignored
- Per-content extraction mode settings are ignored

### The Fix 🔧
1. Remove hardcoded constant from `processTaskClaims.js`
2. Add function parameter for extraction mode
3. Load mode from database (content-specific, then default, then fallback)
4. Add database migration to ensure columns exist
5. Test via admin panel and API

### Impact
Once fixed, users will be able to:
- Change extraction strategy globally via admin panel
- Set different extraction modes per content item
- Re-extract claims with different modes
- Actually use the "edge" and "comprehensive" modes that are currently inaccessible
