# Scrape and Evidence Search Workflow

## Overview
This document explains how TruthTrollers processes articles, extracts claims, and gathers evidence to verify them.

---

## Phase 1: Article Scraping & Claim Extraction

### 1.1 Scrape Article
**File:** `src/core/scrapeTask.js`

When you submit a URL for scraping:

1. **Fetch HTML** - Downloads the article HTML (or uses provided HTML from browser extension)
2. **Extract Text** - Intelligently extracts article content using site-specific selectors:
   - **Substack**: Uses `.available-content .body.markup` from raw HTML
   - **Journal Sites** (ScienceDirect, etc.): Uses `.Abstracts, .Body` from raw HTML
   - **Generic Sites**: Falls back to `article`, `.article-content`, `[role="main"]`, etc. from cleaned HTML
3. **Extract Metadata** - Pulls title, authors, publisher, thumbnail from HTML/JSON-LD
4. **Store Content** - Saves article to `content` table with unique content_id

**Key Settings:**
- Text is truncated at 60,000 characters if too long
- Selectors cascade from specific → generic to avoid conflicts

---

### 1.2 Extract Claims from Article
**File:** `src/core/claimsEngine.js`

After scraping, the article text is analyzed to extract factual claims.

#### Extraction Modes

**Two modes are available:**

##### RANKED MODE (Default for Scraping)
- **Purpose**: Extract only the highest-quality, most important claims
- **How it works**:
  - LLM extracts top factual claims from the article
  - Claims are automatically scored and ranked by importance
  - Only the best claims are kept (controlled by `max_claims` in database)
- **Best for**: Automated scraping where you want quality over quantity

##### COMPREHENSIVE MODE
- **Purpose**: Extract ALL potential claims for manual user ranking
- **How it works**:
  - LLM extracts every factual claim in the article
  - User manually ranks/selects which claims to verify
  - No automatic filtering
- **Best for**: Manual fact-checking workflows where user wants full control

#### Claim Limits

Controlled by `llm_prompts.max_claims` column (default: 12):
- Limits how many claims are extracted from each article
- Prevents overwhelming the system with too many claims
- Can be adjusted in database for different extraction modes

**Current Settings:**
- All extraction modes: `max_claims = 12` (configurable in database)
- Minimum claims scales with article length (5-8 claims)

---

## Phase 2: Evidence Search & Verification

### 2.1 Evidence Search Modes
**File:** `src/core/evidenceEngine.js`
**Config Table:** `evidence_search_config`

After claims are extracted, the evidence engine searches for sources to verify each claim.

#### Available Evidence Search Modes

##### Mode 1: High Quality Only
**Best for: Fast, reliable fact-checking**

- **Sources**: Tavily + Bing only (high-quality curated sources)
- **Queries per claim**: 4 search queries
- **Max sources per claim**: 3 evidence candidates
- **Fringe sources**: Disabled
- **Speed**: Fastest mode
- **Use case**: Quick verification from mainstream/authoritative sources

```json
{
  "queriesPerClaim": 4,
  "maxEvidenceCandidates": 3,
  "enableFringeSearch": false
}
```

##### Mode 2: Fringe on Support
**Best for: Finding counter-evidence to mainstream claims**

- **Sources**: Tavily + Bing for initial search
- **Queries per claim**: 4 search queries
- **Max sources per claim**: 3 high-quality candidates
- **Fringe sources**: Enabled when strong support is found
  - **Trigger**: When support confidence > 70%
  - **Fringe queries**: 2 additional queries to alternative sources
  - **Fringe candidates**: 2 additional evidence sources
- **Speed**: Medium
- **Use case**: Finding dissenting opinions when mainstream sources agree

```json
{
  "queriesPerClaim": 4,
  "maxEvidenceCandidates": 3,
  "enableFringeSearch": true,
  "fringeTrigger": "support",
  "fringeConfidenceThreshold": 0.7,
  "topKFringeQueries": 2,
  "maxFringeEvidenceCandidates": 2
}
```

##### Mode 3: Balanced All Claims
**Best for: Comprehensive fact-checking with diverse perspectives**

- **Sources**: Tavily + Bing + diverse query strategies
- **Queries per claim**: 6 search queries
  - 2 queries for SUPPORTING evidence
  - 2 queries for REFUTING evidence
  - 2 queries for NUANCE/context
- **Max sources per claim**: 6 evidence candidates (2 support + 2 refute + 2 nuance)
- **Fringe sources**: Optional
- **Speed**: Slowest, most thorough
- **Use case**: Deep investigation requiring multiple perspectives

```json
{
  "queriesPerClaim": 6,
  "supportQueries": 2,
  "refuteQueries": 2,
  "nuanceQueries": 2,
  "maxEvidenceCandidates": 6,
  "targetSupport": 2,
  "targetRefute": 2,
  "targetNuance": 2,
  "enableBalancedSearch": true
}
```

---

### 2.2 Evidence Scraping
**File:** `src/core/scrapeTask.js` (reused)

For each evidence source found:

1. **Scrape source URL** - Extract text using same intelligent selectors
2. **Extract source claims** - Extract factual claims from the evidence source
3. **Link to task claims** - Create `reference_claim_task_links` connecting:
   - Source claims (from evidence) → Task claims (from original article)
   - Stores relevance score and reasoning

**Key Difference from Task Scraping:**
- Task scraping: Extract claims from USER-submitted article
- Evidence scraping: Extract claims from AI-found evidence sources

---

### 2.3 Manual Evidence Scanning
**Available in:** CaseFocus page, Workspace page

Users can manually scan additional sources:

- **Quick Scan**: Assess overall relevance to task (creates `reference_claim_links`)
- **Deep Scan**: Extract claims and link to task claims (creates `reference_claim_task_links`)

---

## Database Schema

### Content Storage
```
content (task articles)
  ├── content_id
  ├── content_text (article text)
  └── content_url

claims (extracted from content)
  ├── claim_id
  ├── claim_text
  ├── content_id (source article)
  └── claim_rank (importance score)
```

### Evidence Links
```
reference_claim_links (document-level)
  ├── reference_claim_id (evidence source)
  ├── task_content_id (original article)
  └── relevance_score

reference_claim_task_links (claim-level)
  ├── reference_claim_id (evidence source claim)
  ├── task_claim_id (original article claim)
  ├── relevance_score
  └── reasoning
```

---

## Configuration Reference

### Database Tables

#### `llm_prompts`
Controls claim extraction behavior:
- `max_claims` - Maximum claims to extract (default: 12)
- `min_sources` - Minimum evidence sources per claim (default: 2)
- `max_sources` - Maximum evidence sources per claim (default: 4)

#### `evidence_search_config`
Controls evidence search modes (JSON config):
- `config_key = 'current_mode'` - Active mode name
- `config_key = 'mode_config'` - Mode definitions (see above)

---

## Workflow Summary

### Automated Scraping Flow
```
1. User submits URL
2. Scrape article → Extract text
3. Extract claims (RANKED mode) → Top 12 claims
4. Evidence search (selected mode) → Find 2-4 sources per claim
5. Scrape each source → Extract source claims
6. Link source claims to task claims → Relevance scoring
```

### Manual Evidence Flow
```
1. User views task in CaseFocus/Workspace
2. User clicks "Evidence Scan" on a claim
3. User provides evidence URL
4. Quick Scan: Assess document relevance
   OR
   Deep Scan: Extract claims + link to task claims
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/core/scrapeTask.js` | Scrape URLs, extract text/metadata |
| `src/core/claimsEngine.js` | Extract claims from text |
| `src/core/evidenceEngine.js` | Search for evidence sources |
| `src/core/processTaskClaims.js` | Orchestrates scrape → claims → evidence |
| `src/core/promptManager.js` | Load LLM prompts from database |
| `migrations/add_max_claims_to_prompts.sql` | Add max_claims column |
| `migrations/add_source_limits_to_prompts.sql` | Add min/max sources columns |

---

## Admin Panel Configuration

### Evidence Search Config
**Location:** Admin Panel → Evidence Search Config

- **Current Mode**: Select active evidence search mode
- **Mode Configurations**: View/edit mode parameters

### LLM Prompts (Future)
**Location:** Database only (UI coming soon)

- Edit `max_claims` for different extraction modes
- Edit `min_sources` and `max_sources` for evidence gathering

---

## Performance Tuning

### Reduce Processing Time
- Use **High Quality Only** mode (fewer queries, faster)
- Reduce `max_claims` in database (fewer claims to verify)
- Reduce `maxEvidenceCandidates` in mode config (fewer sources to scrape)

### Improve Quality
- Use **Balanced All Claims** mode (diverse perspectives)
- Increase `max_claims` in database (capture more nuance)
- Increase `maxEvidenceCandidates` in mode config (more evidence)

### Balance Speed & Quality
- Use **Fringe on Support** mode (fast + counter-evidence when needed)
- Keep `max_claims = 12` (current default)
- Keep `maxEvidenceCandidates = 3-4` (current default)
