# Evidence Retrieval and Bearing Audit

## Executive Summary

- The pipeline retrieves evidence via multi-query web search (Tavily + Bing hybrid, optional DuckDuckGo fringe pass), fetches and scrapes each candidate URL, and then uses a single combined LLM call (`extractQuotesAndScoreQuality`) to extract a verbatim quote, classify stance (support/refute/nuance/insufficient), and score source quality — all relative to the original case claim. No intermediate triage step exists before fetching.
- **Bearing does not exist** as a distinct concept anywhere in the current codebase. The only signal connecting a source to a case claim is the LLM-extracted `stance` field and a floating-point `quality` score (0–1.2) derived from the search engine rank plus a domain boost. These two values are insufficient to distinguish "this source directly challenges the truth-value of the claim" from "this source is topically adjacent but says nothing about whether the claim is true."
- Claims are sorted by `priority`, `verifiability`, and `centrality` before the evidence run, and all claims passing those scores are searched — there is no hard cap that restricts the evidence engine to only the most important claims; every claim in the `claimIds` array is processed.
- Source claim extraction (`processTaskClaims` over reference full-text) runs **after** the evidence packets are already persisted, and is capped at `MAX_REFERENCE_CLAIM_EXTRACTION` references (default 8, set via env var). The claim matching step (`matchClaimsToTaskClaims`) is a second LLM pass that stores links in `reference_claim_task_links`, separate from the earlier `reference_claim_links` rows created by `persistAIResults`.
- The `claim_retrieval_evidence` table, the `triage_status` columns on `claims`, and the `ClaimTriageEngine` / `ClaimEvaluationClassifier` classes exist in the codebase but are **not wired into the live scrape pipeline**; they are dead schema and unused classes.

---

## Current Pipeline Diagram

```
Extension sends URL + raw HTML
        │
        ▼
/api/scrape-task  (content.scrape.routes.js)
        │
        ├─ [1] scrapeTask()  → taskContentId, text, metadata persisted
        │
        ├─ [2] processTaskClaims()  → LLM claim extraction  →  claimIds[]
        │         • modes: 'edge' | 'ranked' | 'comprehensive' (from DB config)
        │         • returns thesis / pillar / evidence / background hierarchy
        │
        ├─ [3] mapArgumentFunctions()  → LLM maps each claim's role in the article
        │         • sets objectClaim, scoreTransform (normal/invert/none/review)
        │
        ├─ [4] runEvidenceEngine()  ─────────────────────────────────────────────────┐
        │         │                                                                   │
        │         ├─ sorts claims by priority/verifiability/centrality               │
        │         ├─ for each claim (all parallel):                                  │
        │         │     buildSearchTargets() → up to 3 deterministic query variants  │
        │         │     EvidenceEngine.generateQueries() (LLM) → up to 3 queries    │
        │         │     EvidenceEngine.retrieveCandidates()                          │
        │         │         Tavily (basic depth, max_results=topKCandidates≤9)       │
        │         │         Bing   (count=topKCandidates≤9)   — hybrid default       │
        │         │         dedupe by URL, bucket by intent, topKPerIntent=4         │
        │         │     for each candidate (up to maxEvidenceCandidates≤9):         │
        │         │         fetcher.getText() → fetch URL, Readability, 60k chars   │
        │         │         extractQuotesAndScoreQuality() (LLM, gpt-4o-mini)       │
        │         │             → quote, stance, quality scores                      │
        │         │     EvidenceEngine.adjudicate() → finalVerdict, confidence       │
        │         │     [optional Pass 2] fringe search via DuckDuckGo               │
        │         │                                                                   │
        │         └─ returns aiReferences[]  (url→stance→quote→quality→claimIndices) │
        │                                                                             │
        │   [inline during getText():]                                                │
        │   createContentInternal() → referenceContentId                             │
        │   ensureContentRelation() → content_relations row                          │
        │   processPublishingIdentity(), persistAuthors()                            │
        │   enrichReferencePublisherAsync() → Admiralty code (fire-and-forget)       │
        └─────────────────────────────────────────────────────────────────────────────┘
        │
        ├─ [5] persistAIResults()  → reference_claim_links rows
        │         • fields: claim_id, reference_content_id, stance, score, confidence,
        │                   support_level, rationale, evidence_text, scrape_status
        │
        ├─ [6] For each aiReference (capped at MAX_REFERENCE_CLAIM_EXTRACTION, default 8):
        │     a) persistClaims() with snippet quote → snippet claim
        │     b) processTaskClaims() over reference full text → reference claims
        │     c) matchClaimsToTaskClaims() (LLM) → reference_claim_task_links rows
        │
        └─ Response to extension
```

---

## Key Findings

1. **No pre-scrape triage exists.** Every URL returned by the search APIs (up to `maxEvidenceCandidates` ≤ 9 per claim) is fetched and sent to the LLM regardless of whether its snippet suggests it bears on the claim's truth value.
2. **Bearing is conflated with topical relevance.** The `extractQuotesAndScoreQuality` prompt instructs the LLM to classify stance — but stance classification happens on the full page text, not on a pre-screened passage, and there is no separate pre-scrape signal that distinguishes "this snippet is about the topic" from "this snippet directly addresses the truth of the specific assertion."
3. **Two separate claim-linking pipelines co-exist.** `persistAIResults` writes to `reference_claim_links` (task claim → reference document). `matchClaimsToTaskClaims` writes to `reference_claim_task_links` (reference claim → task claim). These are not always reconciled; only the second pass extracts structured claims from the reference.
4. **Claim sorting exists but there is no hard per-run claim budget.** Claims are sorted by `priority > verifiability > centrality` (all clamped 0–100) but the engine processes ALL claims passed to it (`maxParallelClaims: Infinity`).
5. **Source quality scores are computed post-scrape via the same LLM call** that extracts the quote (`extractQuotesAndScoreQuality`). Scores are stored in `source_quality_scores` but are NOT used to filter which results are scraped — they arrive too late to affect the scrape decision.
6. **The fringe search pass (DuckDuckGo)** only runs when the primary verdict is `'support'` with confidence > 0.7. It is disabled by default (`enableFringeSearch: false` in the `high_quality_only` and `balanced_all_claims` modes; only enabled in `fringe_on_support`).
7. **`ClaimTriageEngine`, `ClaimEvaluationClassifier`, and `claim_retrieval_evidence` table** are present in the codebase and migrations but are not called anywhere in the live pipeline.
8. **No embedding / semantic similarity step** exists anywhere in the pipeline. All relevance assessment is done by the LLM.
9. **Text truncation is hard-coded at 60,000 chars** for scraped references (Readability + fallback), and the LLM extraction call uses only the first `maxCharsPerDoc` (default 8,000) of that text. Very long documents have their tail silently ignored.
10. **Query generation has a hard-coded CDC/MMR/autism special-case** in `buildSearchTargets()` that injects specific refute-intent queries when those keywords appear, bypassing the normal LLM query generation.
11. **`reference_claim_links.scrape_status`** carries `"snippet_only"` for failed scrapes and `"full"` for successful scrapes. This is the only flag distinguishing a document-level link (unverified snippet) from a content-verified link.
12. **The `evidence_search_config` database table** controls `search_mode`, `queriesPerClaim`, `maxEvidenceCandidates`, and fringe settings at runtime — but the values loaded from DB are further clamped in `runEvidenceEngine.js` (e.g., `queriesPerClaim: Math.min(modeConfig.queriesPerClaim || 6, 3)` caps to 3).
13. **Stance normalization overrides exist** in both `matchClaims.js` and `assessClaimRelevance.js` for the specific case of "vaccine myocarditis risk greater than virus" — a hard-coded comparative-risk correction applied after LLM output.
14. **No fairness/steelman slot** exists in the evidence packet structure. The adjudication function returns `finalVerdict + confidence + picks + counters`, but counters are the top 3 non-verdict evidence items; there is no slot reserved for the strongest opposing view.
15. **Publisher enrichment (AllSides, AdFontes, Admiralty) runs fire-and-forget** during the reference scrape; it does not influence which sources are scraped or which evidence is surfaced to the user.

---

## 1. Case Claim Selection

**Where are case claims generated?**
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/claimsEngine.js`
- Function: `ClaimExtractor.analyzeChunk()` → `ClaimExtractor.analyzeContent()`
- Called from: `processTaskClaims()` in `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/processTaskClaims.js`
- The LLM prompt (loaded by name `claim_extraction_stack_system` / `claim_extraction_stack_with_topics` / `claim_extraction_stack_no_topics` from the `llm_prompts` DB table) instructs the model to produce a `reasoningStack` with `thesis`, `pillars`, `evidenceClaims`, and `backgroundClaims`.

**Where are case claims selected for evidence search?**
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/runEvidenceEngine.js`
- Function: `runEvidenceEngine()`
- All claim IDs from `processTaskClaims()` are passed in the `claimIds` array and all are processed.

**Are all case claims searched, or only selected ones?**
All claims are searched. There is no filtering step between claim extraction and the evidence engine. The claims are sorted by `priority > verifiability > centrality` (lines 403–408 of `runEvidenceEngine.js`) but all are passed to `engine.run()`.

**Is there claim priority, centrality, importance, confidence, or token budget logic?**
Yes — claims carry:
- `priority` (0–100, clamped via `clampScore`)
- `verifiability` (0–100)
- `centrality` (0–100)
- `role`: thesis / pillar / pillar_support / evidence / background
- `isAttribution`, `speakerEntity`, `articleStance`, `argumentFunction`, `scoreTransform`

These are set during `processTaskClaims` and enriched by `mapArgumentFunctions`. Sorting is applied. However, there is no per-run token budget or "process only top N" logic.

**Are thesis-level, factual, causal, quote/source, and warrant claims distinguished anywhere?**
Partially. The reasoning stack distinguishes `thesis`, `pillar`, `pillar_support`, `evidence`, `background`. Attribution claims (`isAttribution: true`) are identified by `classifyAttributionClaim()`. The `argumentFunction` field distinguishes `thesis | supporting_premise | evidence | opposing_claim_to_refute | background | reported_neutral | unclear`. Causal vs. associative is **not** distinguished; quote/source claims are identified as attribution but not given separate evidence-finding logic beyond extracting the `objectClaim`.

---

## 2. Search Query Generation

**Where are search queries generated?**
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/evidenceEngine.js`
- Function: `EvidenceEngine.generateQueries()`
- Also: `buildSearchTargets()` in `runEvidenceEngine.js` (deterministic pre-LLM step)

**Which LLM prompt or function creates the queries?**
- `buildSearchTargets()` runs first (deterministic, no LLM): produces up to 3 query variants from the claim text using regex pattern matching (attribution detection, entity extraction, CDC/MMR special-case).
- If `claim.searchTargets` is non-empty, the LLM call in `generateQueries()` is **skipped entirely**.
- Otherwise, `generateQueries()` calls the LLM with prompt names `evidence_query_generation_system` + `evidence_query_generation_user` (or `evidence_query_generation_user_balanced` for balanced mode) from the `llm_prompts` DB table.

**What inputs are used?**
| Input | Used? |
|-------|-------|
| Claim text (claim.promptText or claim.text) | Yes |
| Context (ctx, passed as null in main pipeline) | Yes (but null) |
| Title | No |
| Article text | No |
| Topic | No |
| Publisher | No |
| Prior claims | No |
| User claim | No |
| Source identities | No |
| n (number of queries requested) | Yes |

**How many queries are generated per case claim?**
- Default: `topKQueries: Math.min(modeConfig.queriesPerClaim || 6, 3)` → **3 queries maximum** (hard-clamped in `runEvidenceEngine.js` line 1034).
- In balanced mode: up to 9 (3 support + 3 refute + 3 nuance), but still subject to the `Math.min(..., 3)` clamp.

**Are queries grouped by stance?**
Yes — each query carries an `intent` field: `support | refute | nuance | background | factbox`. When `buildSearchTargets()` fires, intents are `object_claim`, `attribution`, `study_or_event_identity`, `context`. The LLM prompt in standard mode asks for at least 2 support, 2 refute, 1 nuance.

**Are queries grouped by evidence type (primary source, study, expert critique, government, opposing)?**
No. The only grouping is by stance intent. Evidence type is not specified.

**Are Boolean operators, quoted phrases, exact entities, dates, or domain filters used?**
- The fringe query generator (`generateFringeQueries`) uses `site:` domain filters (e.g., `site:naturalnews.com`).
- Entity terms are extracted by regex in `buildSearchTargets()` but just concatenated, not quoted.
- No Boolean operators, date filters, or explicit quoted-phrase syntax in the standard LLM-generated queries.

**Are there min/max query limits?**
- Max: hard-clamped to 3 via `Math.min(modeConfig.queriesPerClaim || 6, 3)` in `runEvidenceEngine.js`.
- No minimum enforced.

**Are there retry or fallback queries?**
`maxRetriesPerClaim: 1` is set but there is no retry logic visible in `EvidenceEngine.run()` — this setting does not appear to be consumed by the engine currently.

---

## 3. Search Providers

### Tavily
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/tavilySearch.js`
- Function: `createTavilyAdapter()` → `web()`
- API parameters: `max_results: topK`, `search_depth: "basic"` (or `"advanced"` when `includeRawContent=true`, which is never passed from the main pipeline), `include_raw_content: false`
- Number of results requested: `topK = topKCandidates` (≤ 9, default effective value after clamp)
- Snippets/summaries returned: `r.content` → stored as `snippet`
- Domain filters: `include_domains` (from `preferDomains`), `exclude_domains` (from `avoidDomains`) — both empty by default
- Deduplication: handled in `retrieveCandidates()` by URL-keyed Map after results from all queries are merged

### Bing
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/bingSearch.js`
- Function: `bingSearch()`
- API endpoint: `https://api.bing.microsoft.com/v7.0/search`
- Parameters: `q=query&count=topK`
- Number of results: `topK` (up to 9)
- Snippets: `item.snippet`
- Domain filters: `avoid` domains filtered in JS; `prefer` domains get `+0.15` score boost
- No raw content returned

### DuckDuckGo (fringe pass)
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/duckDuckGoSearch.js`
- Function: `searchDuckDuckGo()`
- HTML scraping of `https://html.duckduckgo.com/html/?q=...` — no API key, no guaranteed structure
- Number of results: up to 20 parsed, `topK` returned (default 10, `topKFringeCandidates` ≤ 3)
- Score: position-decayed (1.0 - 0.05 × index)
- Fringe queries use `site:` filters and conspiracy-adjacent keyword appending
- Only activated when `enableFringeSearch: true` AND primary verdict is `'support'` with confidence > 0.7

### Result Merging/Ranking
- Hybrid mode runs Tavily + Bing in parallel and concatenates results (`[...tav, ...bing]`)
- `retrieveCandidates()` deduplicates by URL (keeps highest-scoring copy)
- Buckets by `searchIntent` (support/refute/nuance/background/factbox), takes `topKPerIntent = 4` per bucket
- Final candidate list is not globally sorted — order within each intent bucket by score

---

## 4. Returned Result/Snippet Triage

**Where do we evaluate returned search results before scraping?**
We do not. There is no pre-scrape evaluation step. `retrieveCandidates()` returns a deduplicated, intent-bucketed list and the engine immediately calls `extractEvidence()` (which calls `fetcher.getText()` → HTTP fetch) for every candidate up to `maxEvidenceCandidates`.

**Do we score result titles/snippets/summaries?**
No. The `snippet` field from search results is stored in `referenceCache` as a fallback if the scrape fails (`snippet_only` records), but is not scored or evaluated before the fetch decision.

**What exactly is being evaluated before scraping?**
Nothing at the snippet level. The `score` field from Tavily/Bing (search engine relevance rank) and a domain boost (`reuters|apnews|nature|nih|who|gov|\.edu` → +0.2) produce a `quality` value (0–1.2) that is stored but not used as a scrape gate — it is used only for adjudication weighting after all scrapes are complete.

**Is an LLM used to judge snippets before scraping?**
No.

**Is an embedding similarity score used?**
No.

**Is there a threshold for scraping or skipping?**
No threshold. The only skip logic is: (a) the URL matches the task URL (`excludeUrl`), or (b) the URL was already fetched (cache hit, avoids re-fetch but still processes).

**Are results bucketed by support/refute/nuance/context?**
Yes — `searchIntent` tag from the originating query is carried through to each candidate and is stored on each evidence item. The `INTENT_LIMITS` map enforces per-bucket caps (4 support, 4 refute, 2 nuance, 2 background, 2 factbox).

**Are low-quality but dissenting sources preserved for fairness?**
Not explicitly. The fringe pass (DuckDuckGo) is designed to find low-quality refuting sources, but it only runs under specific conditions (strong support verdict, mode = `fringe_on_support`). There is no general "preserve at least one dissenting view" rule.

**Are topically relevant but truth-value irrelevant sources filtered out?**
No. This is the core missing bearing filter.

---

## 5. Scrape Decision Logic

**What causes a URL to be scraped?**
A URL is fetched if it appears in the `finalCandidates` list (after dedup + intent bucketing) and its index is less than `maxEvidenceCandidates`. No quality/relevance gate prevents the fetch.

**Is every result scraped, or only top N?**
Top N = `maxEvidenceCandidates` (default `Math.min(modeConfig.maxEvidenceCandidates || 4, 9)` → **up to 9** per claim, effective runtime value is 4 or 9 depending on mode).

**What are min/max sources scraped per case claim?**
- Minimum: 0 (if search returns nothing or all candidates fail)
- Maximum: `maxEvidenceCandidates` (≤ 9)

**What are global min/max limits per content item?**
No global limit is enforced across all claims. If 10 claims each scrape 9 sources, 90 distinct source fetches could occur (cache deduplication reduces this in practice).

**Are retries performed when scraping fails?**
No retry logic for HTTP fetch failures. Failed fetches create a "stub" content row with `content_type = "reference"`, store the snippet, and mark `isFailed: true`.

**Is there special handling for PDFs, paywalls, already-stored sources?**
- **PDFs**: detected by `Content-Type: application/pdf` or `.pdf` URL suffix; extracted via `pdf-parse`, text stored.
- **Paywalls/bot-blocked**: the fetch returns short HTML or challenge page; if `cleanText.length < 100` a stub is created.
- **Already-stored sources**: `referenceCache` Map prevents re-fetch within a single evidence run; no cross-run deduplication against the DB before fetching.

---

## 6. Source Claim Extraction

**After scraping, do we extract all claims or only high-relevance passages?**
All text up to `60,000` chars is passed to `processTaskClaims()` which calls `ClaimExtractor.analyzeChunk()`. The LLM is instructed to prioritize claims that respond to the task claims, but there is no passage pre-selection step.

**Where is source claim extraction performed?**
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/routes/content/content.scrape.routes.js`
- Location: inside the `processReference()` helper, step (b), approximately line 770
- Called via: `processTaskClaims({ claimType: "reference", taskClaimsContext: taskClaims.map(c => c.text) })`

**Which prompt extracts source claims?**
The same `claim_extraction_stack_system` + `claim_extraction_stack_no_topics` (or `_with_topics`) DB prompts used for task claim extraction. A `taskClaimsInstruction` block is prepended, loaded from `claim_extraction_source_context_instruction` prompt (fallback inline). The instruction says: extract ALL worthy factual claims, but PRIORITIZE claims that directly support/contradict/respond to the task claims.

**Max number of source claims per source?**
`dbMaxClaims` read from DB (`max_claims` parameter on the prompt record, default 12). The extraction call uses `maxClaims = 12` unless overridden by the prompt parameters.

**Max per case claim?**
No per-case-claim limit at the extraction stage. All extracted reference claims are matched against all task claims in one LLM call.

**Is extraction guided by the case claim, or generic document-level?**
Guided: `taskClaimsContext` (all task claim texts) is passed; the instruction prioritizes responsive statements.

**Are passages selected before extraction?**
No. The full reference text (up to 60,000 chars) is sent as a single chunk (the `analyzeContent` function supports multi-chunk concurrency but `maxConcurrency: 1` is passed for references).

**Are extracted claims linked to exact snippets/passages?**
The extracted claims carry a `text` field only; no character offset or passage pointer is stored. The separate `extractQuotesAndScoreQuality` call (which runs during the evidence extraction phase, not the reference claim extraction phase) does produce a `location: {section}` field but this is stored in `reference_claim_links.evidence_offsets` as JSON and is not cross-referenced against the claim text.

**Are duplicate claims removed?**
Yes — `analyzeChunk()` dedupes by normalized lowercase text within a single extraction run.

---

## 7. Case Claim to Source Claim Matching

**Where do we compare case claims to source claims?**
- File: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/matchClaims.js`
- Function: `matchClaimsToTaskClaims()`
- Called from: `content.scrape.routes.js` line ~795 after reference claim extraction

**What score fields exist now?**
In `reference_claim_task_links` (written by `matchClaimsToTaskClaims`):
- `stance` (ENUM: support / refute / nuance / insufficient, mapped from 'supports'/'refutes'/'related')
- `score` (0–100, from veracityScore × 100)
- `confidence` (0.15–0.98)
- `support_level` (−1.2 to +1.2, = stanceMultiplier × confidence × magnitude)
- `rationale` (text)
- `created_by_ai` (1)

In `reference_claim_links` (written by `persistAIResults`):
- `stance` (same ENUM)
- `score` (0–100, from quality × 100)
- `confidence` (from adjudication)
- `support_level` (stanceMultiplier × conf × quality)
- `rationale` / `evidence_text` / `evidence_offsets`
- `scrape_status` ('full' / 'snippet_only')

In `claim_links` (user-created and AI-created in GameSpace):
- `veracity_score` (DECIMAL 5,2, 0–1)
- `confidence` (DECIMAL 5,2)
- `support_level` (from schema, added by migration)
- `created_by_ai` (TINYINT)
- `points_earned`

**Is there already a concept equivalent to bearing?**
No explicit "bearing" field or function exists. The closest approximation is:
- `stance` field in all link tables — but this is set by the LLM after reading the full document, not as a pre-scrape bearing filter.
- The `quality` field on evidence items (0–1.2) — but this is a source quality/rank score, not a truth-value bearing score.
- `assessClaimRelevance()` in `assessClaimRelevance.js` returns `stance`, `confidence`, `quality`, and `support_level`. This function exists and is well-designed but is NOT called in the main evidence pipeline; it appears to be used only in optional/alternate paths.

**Are links created automatically, manually, or both?**
Both. `reference_claim_task_links` are created by AI. `claim_links` can be user-created or AI-created (`created_by_ai` flag).

**What threshold causes a claim link to be created?**
No threshold. Every match returned by the LLM in `matchClaimsToTaskClaims()` is stored, including those with `stance = 'insufficient'`.

**Are weak links discarded or stored?**
Stored. No minimum confidence or support_level filter is applied before the INSERT.

---

## 8. Existing LLM Prompts

### 1. Claim Extraction
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/claimsEngine.js`, `ClaimExtractor.analyzeChunk()`
- **Prompt names** (from DB): `claim_extraction_stack_system`, `claim_extraction_stack_no_topics` / `claim_extraction_stack_with_topics`
- **Model**: inherited from `openAiLLM` (configured at engine level, not hardcoded in prompt)
- **Inputs**: article text chunk, `minClaims`, `maxClaims`, optional task claim context
- **Output schema**: `{ reasoningStack: { thesis, pillars, evidenceClaims, backgroundClaims }, claims: [...], testimonials: [...] }`
- **Temperature**: 0.2
- **Where stored**: `content_claims` table via `persistClaims()`
- **Bearing candidate**: Yes — this prompt should distinguish claim types (thesis/factual/causal/quote-source/warrant) and set `verifiability` to guide evidence targeting

### 2. Argument Function Mapping
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/argumentMappingEngine.js`, `mapArgumentFunctions()`
- **Prompt names**: `argument_mapping_system` + `argument_mapping_user`
- **Inputs**: article excerpt (first 3000 chars), extracted thesis, claims JSON
- **Output schema**: `{ articleThesis, claims: [{ claimId, objectClaim, isAttribution, speakerEntity, articleStanceTowardObjectClaim, argumentFunction, scoreTransform, accountabilityEligible, confidence, rationale }] }`
- **Temperature**: Uncertain — needs runtime check
- **Where stored**: `content_claims` columns (via UPDATE per claim)
- **Bearing candidate**: Critical — `scoreTransform` (`normal/invert/none/review`) is the closest existing bearing-like signal; should be extended to include claim-type information that controls evidence strategy

### 3. Search Query Generation
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/evidenceEngine.js`, `generateQueries()`
- **Prompt names**: `evidence_query_generation_system` + `evidence_query_generation_user` (or `evidence_query_generation_user_balanced`)
- **Inputs**: claim text (`claim.promptText` or `claim.text`), context (null in practice), `n`
- **Output schema**: `{ queries: [{ query, intent }] }` where intent ∈ `support|refute|nuance|background|factbox`
- **Temperature**: 0.2
- **Max tokens**: Not specified
- **Where stored**: Not persisted — ephemeral, used only in-memory for this run
- **Bearing candidate**: Yes — queries should be tagged with evidence type (primary_source, study, expert_critique, government, opposing_argument) and claim-type (causal vs. associative vs. quote)

### 4. Quote Extraction + Source Quality Scoring (Combined)
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/utils/extractQuote.js`, `extractQuotesAndScoreQuality()`
- **Model**: `openAiLLM` (gpt-4o-mini, hardcoded in the INSERT at line 1103 of `runEvidenceEngine.js`)
- **Inputs**: `claimText`, `fullText` (first `maxChars` = 8000 chars), `sourceTitle`, `url`, `domain`, metadata (author, publisher, citationCount)
- **Output schema**: `{ quotes: [{ quote, stance, summary, location }], quality: { author_transparency, publisher_transparency, evidence_density, claim_specificity, correction_behavior, original_reporting, sensationalism_score, monetization_pressure, reasoning } }`
- **Temperature**: 0.1
- **Where stored**: quotes → evidence items in memory → `reference_claim_links`; quality → `source_quality_scores` table
- **Bearing candidate**: This is the most important prompt to redesign. It conflates "does this source say anything about this topic" with "does this source bear on the truth value of this specific assertion"

### 5. Claim-to-Claim Matching
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/matchClaims.js`, `matchClaimsToTaskClaims()`
- **Prompt names**: `claim_matching_system` + `claim_matching_user` (DB), with mandatory `STANCE_CONTRACT` + `MISCONDUCT_CONTRACT` appended
- **Inputs**: all task claim texts (as numbered list), all reference claim texts (as numbered list)
- **Output schema**: `[{ referenceClaimIndex, taskClaimIndex, stance, veracityScore, confidence, supportLevel, rationale }]`
- **Temperature**: 0.2
- **Where stored**: `reference_claim_task_links`
- **Bearing candidate**: Yes — could be augmented to output a `bearing_score` distinct from `veracityScore`, and to flag whether the reference claim addresses the truth-value of the task claim vs. merely the topic

### 6. Claim Relevance Assessment (standalone, not in main pipeline)
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/assessClaimRelevance.js`, `assessClaimRelevance()`
- **Prompt names**: `claim_relevance_assessment_system` + `claim_relevance_assessment_user`
- **Inputs**: `referenceClaimText`, `taskClaimText`
- **Output schema**: `{ stance, confidence, quality, rationale, quote }`
- **Temperature**: 0.3
- **Where stored**: Not stored in main pipeline (function is defined but not called in scrape routes)
- **Bearing candidate**: Could be repurposed as a cheap pre-scrape BearingPreScore if applied to snippets

### 7. Claim Properties Evaluation (not in main pipeline)
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/claimEvaluationClassifier.js`, `calculateClaimPropertiesWithAI()`
- **Prompt names**: `claim_properties_evaluation_system` + `claim_properties_evaluation_user`
- **Inputs**: `claim_text`, `source_document_text` (first 1500 chars)
- **Output schema**: `{ claim_centrality, claim_specificity, claim_consequence, claim_contestability, claim_novelty, reasoning }`
- **Temperature**: 0.1
- **Where stored**: Not called in live pipeline

### 8. Red Team (disabled in production)
- **File**: `/Users/reedko/Desktop/Truthtrollers_root/backend/src/core/evidenceEngine.js`, `redTeam()`
- **Inputs**: claim text, initial adjudication, up to 12 evidence items
- **Output schema**: `{ finalVerdict, confidence, rationale }`
- **Temperature**: 0.3
- **Activation**: `opt.enableRedTeam === true` — `runOptions.enableRedTeam: false` in current code

---

## 9. Current Limits and Budgets

| Setting/Constant | Current Value | File/Function | What It Controls | Likely Effect on Cost/Quality |
|---|---|---|---|---|
| `maxParallelClaims` | `Infinity` | `EvidenceEngine` constructor in `runEvidenceEngine.js` | Parallel claim processing | All claims processed simultaneously; no throttle |
| `queriesPerClaim` (effective) | `Math.min(modeConfig || 6, 3)` = **3** | `runEvidenceEngine.js` line 1034 | LLM queries per claim | Hard cap; balanced mode's 9-query intent is overridden to 3 |
| `topKQueries` | same as queriesPerClaim = **3** | `runEvidenceEngine.js` line 1035 | Queries actually sent to search | Same effective cap |
| `topKCandidates` | `Math.min(modeConfig || 6, 9)` = up to **9** | `runEvidenceEngine.js` line 1036 | URLs fetched per query per search provider | More candidates → more HTTP fetches |
| `maxEvidencePerDoc` | **2** | `runEvidenceEngine.js` line 1037 | Max quotes extracted per source | Limits LLM output length |
| `maxEvidenceCandidates` | `Math.min(modeConfig || 4, 9)` = **4 or 9** | `runEvidenceEngine.js` line 1038 | Max sources scraped per claim | Primary cost driver |
| `maxSearchTargetsPerClaim` | **3** | `runEvidenceEngine.js` line 1039 | Deterministic search targets from `buildSearchTargets()` | Limits pre-LLM query injection |
| `maxSourcesComparedPerClaim` | **9** | `runEvidenceEngine.js` line 1040 | (Set but not consumed visibly in engine) | Uncertain — needs runtime check |
| `maxRetriesPerClaim` | **1** | `runEvidenceEngine.js` line 1041 | (Set but not consumed visibly in engine) | Uncertain |
| `topKPerIntent` | **4** (hardcoded in `retrieveCandidates`) | `evidenceEngine.js` line 325 | Max candidates per intent bucket | Prevents one-sided flooding |
| `maxCharsPerDoc` | **8000** | `runOptions` in `runEvidenceEngine.js` | Text sent to LLM per source | Affects what LLM can see; tail of long documents ignored |
| Text truncation (fetch) | **60,000** chars | `runEvidenceEngine.js` lines 641, 682 | Max chars of scraped text stored | Readability extraction, not LLM input limit |
| `MAX_REFERENCE_CLAIM_EXTRACTION` | **8** (env var, default) | `content.scrape.routes.js` line 679 | Max references to extract claims from | Controls secondary LLM pipeline cost |
| `REFERENCE_CLAIM_EXTRACTION_BATCH_SIZE` | **1** (env var, default) | `content.scrape.routes.js` line 724 | Concurrency for reference claim extraction | Sequential by default |
| `maxClaims` in claim extraction | **12** (from DB prompt parameters) | `ClaimExtractor.analyzeChunk()` | Max claims extracted per content chunk | Limits DB writes and downstream LLM calls |
| `minClaims` in claim extraction | **5, 6, or 8** (based on token length) | `ClaimExtractor.analyzeChunk()` | Minimum claims to extract | Adjusts to article length |
| `fringeConfidenceThreshold` | **0.7** | `evidence_search_config` DB table | Min confidence to trigger fringe pass | Only triggers when primary verdict is strong |
| `topKFringeCandidates` | **3** | `evidence_search_config` / `runOptions` | Max fringe sources fetched | Limited fringe exposure |
| 15s fetch timeout | **15,000 ms** | `runEvidenceEngine.js` line 545 | HTTP fetch timeout per reference | Slow sources get stub |
| 5s chain fetch timeout | **5,000 ms** | `scrapeReference.js` line 252 | Publisher chain resolution timeout | Publisher resolution may fail silently |

---

## 10. Database and Storage Support

### Tables storing evidence pipeline outputs

**`reference_claim_links`** (task claim → reference document)
- `claim_id` (FK → claims)
- `reference_content_id` (FK → content)
- `stance` ENUM('support','refute','nuance','insufficient')
- `score` INT (0–100, from quality × 100)
- `confidence` DECIMAL(5,2)
- `support_level` DECIMAL (−1.2 to +1.2)
- `rationale` TEXT
- `evidence_text` TEXT (verbatim quote)
- `evidence_offsets` JSON (section location)
- `created_by_ai` TINYINT
- `scrape_status` VARCHAR ('full' / 'snippet_only')

**`reference_claim_task_links`** (reference claim → task claim)
- `reference_claim_id`, `task_claim_id`, `stance`, `score`, `confidence`, `support_level`, `rationale`, `quote`, `created_by_ai`

**`claim_links`** (general claim-to-claim links, user + AI)
- `source_claim_id`, `target_claim_id`, relationship, `support_level`, `veracity_score`, `confidence`, `created_by_ai`, `points_earned`

**`source_quality_scores`**
- Stores 8 quality dimensions + `quality_score`, `risk_score`, `quality_tier` per `content_id`

**`claim_retrieval_evidence`** (designed but not populated)
- `case_claim_id`, `source_claim_id`, `relevance_score`, `stance`, `source_quality_score`, `source_quality_tier`, `retrieval_method`

**`content_claims`** (claim-to-content membership, with hierarchy)
- `claim_role`, `parent_claim_id`, `claim_depth`, `centrality_score`, `verifiability_score`, `claim_order`, `object_claim_text`, `is_attribution`, `speaker_entity`, `article_stance`, `argument_function`, `score_transform`, `accountability_eligible`

**`claims`** (with triage columns added by migration, but not populated by live pipeline)
- `triage_status`, `claim_centrality`, `claim_specificity`, `claim_consequence`, `claim_contestability`, `claim_novelty`, `retrieval_count`, `distinct_source_count`, `max_relevance`, `avg_top3_relevance`, `triaged_at`, `triaged_by`, `triage_reasoning`

**`admiralty_evaluations`**
- `target_type`, `target_id`, `source_reliability_letter` (A–E, Ø), `claim_credibility_number` (1–5, Ø), `admiralty_code`, `confidence` (high/medium/low), `evaluation_status`, source/claim signals JSON

### Does a place exist for bearing-specific fields?

| Field | Exists? | Where |
|-------|---------|-------|
| `bearing_pre_score` | **No** | Nowhere |
| `final_bearing_score` | **No** | Nowhere |
| `stance_goal` | **No** | Nowhere (closest: query `intent`) |
| `evidence_target_type` | **No** | Nowhere |
| `source_type` | **Yes** | `source_identity_cache.source_type`, `publisher_profiles.source_type` |
| `scrape_decision` | **No** | Nowhere |
| `triage_reason` | **Partial** — `triage_reasoning` TEXT on `claims` | Populated by dead code only |
| `snippet_evidence` | **Partial** — `reference_claim_links.evidence_text` | Stores the LLM-extracted quote, not the raw snippet |
| `support/refute/nuance bucket` | **Yes** — `stance` on all link tables | |
| `steelman/fairness slot` | **No** | Nowhere |

---

## 11. Where Relevance Exists Today

Every place where something like relevance, match quality, score, or confidence is computed between a case claim and a source or snippet:

1. **`cand.score`** (Tavily/Bing search rank, 0–1) → stored as `quality` on evidence items in `evidenceEngine.js` `extractEvidence()` → feeds adjudication weighting in `adjudicate()`
2. **`quality(cand)`** function in `evidenceEngine.js` line 460–469: `base + domainBoost` (0–1.2)
3. **`it.stance`** (support/refute/nuance/insufficient) from `extractQuotesAndScoreQuality()` LLM call → stored on evidence items → used to bucket into adjudication `buckets`
4. **`adjudication.confidence`** in `EvidenceEngine.adjudicate()`: `0.4 × dominance + 0.6 × min(1, total)` — measures how convincingly one stance bucket dominates
5. **`support_level`** on `reference_claim_links` and `reference_claim_task_links`: `stanceMultiplier × confidence × quality` — a directional 0–±1.2 signal
6. **`veracityScore`** in `matchClaimsToTaskClaims()` output (0–1): LLM's assessment of "how truthful/reliable is this reference claim"
7. **`confidence`** in `matchClaimsToTaskClaims()` output (0.15–0.98): LLM's confidence in the match
8. **`relevance_score`** field on `claim_retrieval_evidence` table: schema exists but is **never written** by live code
9. **`assessClaimRelevance()`** in `assessClaimRelevance.js`: returns `stance`, `confidence`, `quality`, `support_level` — function exists and is well-formed but **not called in the main evidence pipeline**
10. **`avg_top3_relevance`** and `max_relevance` on `claims` table: schema columns exist but **never written** by live code
11. **`quality_score` / `risk_score` / `quality_tier`** on `source_quality_scores`: written by the combined LLM call, represents source quality (not claim-specific bearing)

---

## 12. Whether Bearing Exists Today

**Explicit answer: No, bearing does not exist as a distinct concept in the current system.**

Evidence from the code:

1. The system classifies `stance` (support/refute/nuance/insufficient) after scraping a full document. Stance is the closest analog to bearing, but it is derived from the full page text, not from a pre-scrape assessment of whether the snippet addresses the specific truth-value of the claim. A source can be marked `nuance` simply because it mentions related context without bearing on the claim's factual core.

2. There is no function, field, or prompt in the codebase named "bearing", "bears_on", "truth_value_relevance", "causal_relevance", or equivalent.

3. The `assessClaimRelevance.js` function (which does ask "does this reference make the task claim more or less likely true?") is the closest functional analog to a bearing assessment, but it is **not wired into the main pipeline**.

4. The `quality` score (0–1.2) measures source rank and domain reputation, not relevance to the specific claim's truth value.

5. The `ClaimTriageEngine.triageClaim()` function makes triage decisions based on `avg_top3_relevance` — but that `relevance_score` is never computed by live code (the `claim_retrieval_evidence` table is never populated).

**Where bearing should be introduced:**
- Before the scrape decision: a lightweight "BearingPreScore" should be applied to search result snippets to ask "does this snippet address the truth value of this specific assertion (not just the topic)?" — implemented as either a cheap LLM call on the snippet or a deterministic SVO overlap check.
- On the `extractQuotesAndScoreQuality` prompt: add an explicit "bearing" dimension separate from "stance": "Does this passage directly affect whether this claim is true, or is it only topically related?"
- On all link tables: add a `bearing_score` column to `reference_claim_links`, `reference_claim_task_links`, and `claim_links`.

---

## 13. Failure Modes

**Too many sources scraped per content item**
- Location: `runEvidenceEngine.js` lines 1036–1038 — `maxEvidenceCandidates` is clamped to 9, and `maxParallelClaims: Infinity` means all claims run simultaneously. If a content item has 15 claims, up to 15 × 9 = 135 HTTP fetches could be initiated before any rate limiting. No global-per-content-item source cap exists.

**Too many claims extracted per source**
- Location: `claimsEngine.js` `analyzeChunk()` line 463: `finalClaims = deduped.slice(0, maxClaims)` where `maxClaims` defaults to 12. With 8 references × 12 claims = up to 96 reference claims, then 96 × N task claims fed to `matchClaimsToTaskClaims()` in a single LLM call — the prompt will exceed context limits silently or produce low-quality output.

**High-quality sources that do not bear on the case claim**
- Location: `evidenceEngine.js` `extractEvidence()` — every candidate in the bucket is fetched regardless of snippet quality. A high-scoring Bing result about the general topic but not addressing the specific factual assertion is scraped and sent to the LLM, which may label it `nuance` and add weight to the adjudication despite it contributing nothing to the truth value.

**Relevant snippets that do not affect truth value**
- Location: `extractQuotesAndScoreQuality()` in `extractQuote.js` — the prompt asks for stance classification on the full document text (first 8,000 chars). There is no requirement that the extracted quote directly affect truth value; the LLM may extract a contextual passage and assign `nuance` purely because it is topically related.

**Only one side of the dispute retrieved**
- Location: `evidenceEngine.js` `retrieveCandidates()` — `INTENT_LIMITS` attempts balance with 4 support + 4 refute per claim, but if search queries for one stance return fewer results, the bucket is smaller. There is no compensatory re-query to fill a near-empty refute bucket. The fringe search only activates for support-heavy results.

**Weak dissenting sources excluded**
- Location: Same. If the only dissenting sources are low-scoring in Bing/Tavily (e.g., a low-traffic fact-check site), they may not appear in the top 4 of the refute bucket. No minimum-quality floor exists for the refute bucket specifically, but also no "must include at least one refute source regardless of quality" rule.

**Pseudo-scientific thesis refuted too broadly**
- Location: `extractQuotesAndScoreQuality()` prompt rules — rule: "If the source is a fact-check that rates the claim false/misleading → 'refute'". A fact-check of the article as a whole (not the specific subclaim) will be classified as `refute` for every case claim simultaneously, inflating refute signal across all claims including scientifically valid subclaims within a flawed article.

**Real scientific subclaim incorrectly refuted because it appears in bad content**
- Location: `evidenceEngine.js` `adjudicate()` — the adjudication aggregates all evidence items across all sources and stances by their `quality` weight. The domain boost (0.2 for .gov/.edu/etc.) gives high-quality refuting sources more weight, potentially outweighing supporting evidence for a narrowly-true subclaim that happens to appear in a low-quality article.

**Quote/source claims conflated with truth claims**
- Location: `runEvidenceEngine.js` `buildSearchTargets()` — for attribution claims, `objectClaim` is extracted and used as the search text. However, if `mapArgumentFunctions()` classifies the claim as `scoreTransform: 'invert'`, the search still proceeds normally but the scoring downstream (in GameSpace, not in the evidence engine itself) should invert the result. The inversion is not applied in the evidence packet — only the adjudication verdict is stored; the inversion signal in `content_claims.score_transform` is not consumed by `persistAIResults`.

**Causal claims conflated with association claims**
- Location: `extractQuotesAndScoreQuality()` prompt — no causal-vs-associative distinction is made in the stance instructions or schema. A source saying "X is associated with Y" will be classified as `support` for a claim saying "X causes Y" if the LLM interprets the association as support.

**Claim matching confused by compound claims**
- Location: `matchClaimsToTaskClaims()` — all reference claims and all task claims are sent in a single LLM batch. Compound task claims (e.g., "A, B, and therefore C") may be partially matched to reference claims that address only one component. The LLM has no guidance to decompose compound claims before matching.

---

## 14. Proposed Bearing-Aware Retrieval Funnel

*(Proposal only — no implementation)*

### Where to introduce an EvidenceNeed object
After `mapArgumentFunctions()` returns, before `runEvidenceEngine()` is called, construct an `EvidenceNeed` per claim containing:
- `claimType`: `factual | causal | quote_attribution | consensus_claim | causal_counterfactual`
- `claimRole`: from `argumentFunction` (thesis / supporting_premise / etc.)
- `scoreTransform`: from `content_claims.score_transform`
- `targetSubject` + `targetPredicate` + `targetObject` (SVO decomposition)
- `stanceGoal`: what kind of evidence would satisfy this claim (e.g., `primary_source`, `systematic_review`, `expert_refutation`, `origin_study`)
- `bearingRequirement`: `direct_truth_value | supporting_context | steelman_opposing`

### Where to generate stance-aware query variants
In `EvidenceEngine.generateQueries()`, pass `EvidenceNeed` and use `claimType` + `stanceGoal` to select a claim-type-aware prompt variant (e.g., for `causal` claims, generate queries targeting mechanism studies; for `quote_attribution` claims, generate queries targeting the original source).

### Where to add BearingPreScore before scraping
In `EvidenceEngine.retrieveCandidates()`, after the intent-bucketed candidate list is assembled but before returning, apply a cheap `assessSnippetBearing(snippetText, claimText)` function to each candidate. This could be:
- Deterministic: check for SVO overlap between claim and snippet (fast, cheap)
- LLM-based: send all snippets for one claim in a single batch call asking for 0–1 bearing score per snippet
Candidates with `bearingPreScore < 0.2` are demoted to "low_bearing" bucket and only scraped if the high-bearing bucket has fewer than N results.

### Whether to add a cheap LLM snippet triage step
Yes — one batch LLM call per claim with all snippets (typically 10–20 tokens each, 5–10 snippets), returning `{ url, bearingScore: 0.0–1.0, expectedStance: support|refute|nuance }`. This replaces blind scraping with targeted scraping. Estimated cost: ~200 tokens per claim.

### Whether to add deterministic SVO/scope matching before the LLM call
Yes — before the LLM triage, run a deterministic SVO overlap check: extract subject/verb/object triples from both the claim and the snippet, compute Jaccard overlap on lemmatized key terms. Use as a fast pre-filter (< 0.05 overlap → skip this candidate). This would be near-zero cost and eliminates purely topical-but-unrelated sources.

### Suggested scrape quotas per case claim
- High-priority claims (thesis, pillar): scrape up to 6 URLs (4 high-bearing + 2 from opposing stance bucket)
- Supporting claims (evidence, supporting_premise): scrape up to 3 URLs
- Background claims: scrape 0–1 URL (origin/primary source only)
- Attribution claims (quote_attribution): scrape 1 URL (the origin source) + 1 fact-check

### Suggested source claim extraction quotas
- Extract claims from at most 5 references per content item (reduce from 8)
- Cap extracted claims per reference at 8 (reduce from 12)
- Only extract claims from references with `bearingPreScore > 0.4` for the claims that referenced them

### Suggested final evidence packet structure
For each case claim, the evidence packet should contain:
1. **Strongest support** (1 item): highest-quality source with stance=support and bearingScore > 0.6
2. **Strongest refute** (1 item): highest-quality source with stance=refute and bearingScore > 0.6
3. **Best nuance/context** (1 item): highest-quality source with stance=nuance
4. **Primary/origin source** (0–1 item): the source the claim is originally attributed to, if applicable
5. **Steelman slot** (optional): best source that supports the opposing view even if the overall verdict is refute — reserved to satisfy the fairness requirement
Total: 3–5 sources per claim, not unbounded.

### Suggested database fields or temporary in-memory structures
Add to `reference_claim_links`:
- `bearing_score DECIMAL(4,3)` — pre-scrape or post-scrape bearing assessment (0.000–1.000)
- `bearing_method ENUM('snippet_llm','snippet_svo','document_llm')` — how bearing was assessed
- `evidence_target_type VARCHAR(32)` — what type of evidence this source provides (primary_source, study, fact_check, expert_opinion, news_report, social_media)

Add to `claims` (already has triage columns):
- `claim_type ENUM('factual','causal','quote_attribution','consensus','counterfactual')` — populate from argument mapping output

### Which prompts should be rewritten next (priority order)
1. `extractQuotesAndScoreQuality` — add explicit bearing dimension; distinguish "topically related" from "truth-value bearing"
2. `evidence_query_generation_user` — add `claimType` and `stanceGoal` inputs; generate evidence-type-specific queries
3. `claim_matching_system` / `claim_matching_user` — add `bearing_score` output; require explicit reasoning about truth-value impact
4. `claim_extraction_stack_system` — require `claimType` field in output (factual/causal/quote/consensus)

### What should remain unchanged for now
- `buildSearchTargets()` deterministic pre-LLM step — works well for attribution claims
- `mapArgumentFunctions()` — `scoreTransform` field is already a proto-bearing signal
- Admiralty evaluation pipeline — orthogonal to bearing; correct as-is
- Intent bucketing in `retrieveCandidates()` — keep, extend with bearing
- `matchClaimsToTaskClaims()` veracity scoring — keep, add bearing dimension

---

## 15. Open Questions Before Implementation

1. **What is the actual runtime `queriesPerClaim` value in production?** The code clamps to `Math.min(modeConfig.queriesPerClaim || 6, 3)`. If `modeConfig.queriesPerClaim` is 3 or less in the DB, the balanced mode's 9-query design is silently broken. Need to read the live `evidence_search_config` rows.

2. **Is `maxRetriesPerClaim` actually consumed anywhere?** It appears in `runOptions` but is not referenced in `EvidenceEngine.run()` or `retrieveCandidates()`. Needs runtime log confirmation.

3. **Is `maxSourcesComparedPerClaim: 9` consumed anywhere?** Same uncertainty — it is set in `runOptions` but not visibly used in the engine.

4. **Are `reference_claim_task_links` and `reference_claim_links` reconciled in the UI?** The dashboard query in `references.routes.js` reads from `reference_claim_links` for the reference card view. It is unclear whether `reference_claim_task_links` is surfaced to users or only used by GameSpace.

5. **What model is `openAiLLM` configured to use?** The model name is set in `openAiLLM.js` which was not read. The INSERT in `runEvidenceEngine.js` line 1103 hardcodes `'gpt-4o-mini'` for quality scores, but query generation and claim extraction may use a different model.

6. **Does the `evidence_search_config` `balanced_all_claims` mode work at all?** With the `Math.min(..., 3)` clamp on `queriesPerClaim`, the 9-query balanced distribution (3+3+3) is overridden. The balanced mode may produce only 3 queries of unspecified distribution.

7. **How is `claim.priority` set?** The `priority` field is passed into `runEvidenceEngine` from `claimsForPersistence[i].priority` set by `processTaskClaims`. It comes from the LLM extraction output or from argument function mapping — but the exact source and scale need confirmation.

8. **Is DuckDuckGo HTML scraping reliable?** The fringe search uses a brittle regex parser on DuckDuckGo's HTML output. The regex pattern may silently return zero results without error if DuckDuckGo changes its HTML structure.

9. **Are there any existing claims in `claim_retrieval_evidence`?** The table was created by migration but no live code writes to it. Needs DB inspection to confirm it is empty.

10. **What is the `PromptManager` behavior when a prompt name is not found in the DB?** The fallback path uses the hardcoded `fallback*` strings. Need to confirm no silent prompt version mismatch is degrading query quality.

---

## 16. Recommended Implementation Sequence

Ordered by impact, safety, and reversibility:

1. **Instrument the live pipeline** — add logging to count: claims per run, candidates per claim, scrapes per claim, LLM calls per run, total cost. Establish a baseline before any changes.

2. **Add `claim_type` to claim extraction output** — extend the `claim_extraction_stack` prompts to output a `claimType` field (factual/causal/quote_attribution/consensus/counterfactual). Store in a new `claim_type` column on `claims`. No pipeline logic changes; purely additive.

3. **Add `bearing_score` column to `reference_claim_links`** — add nullable `DECIMAL(4,3)` column. No migration changes to existing rows; populate going forward.

4. **Implement deterministic SVO snippet pre-filter** — before `extractEvidence()` is called, compute a cheap keyword-overlap score between the candidate snippet and the claim text. Log the scores. Do NOT gate scraping on it yet — just log. Establish false-positive and false-negative rates.

5. **Rewrite `extractQuotesAndScoreQuality` prompt** — add explicit bearing question: "Does this passage directly affect whether the claim is true, or is it only topically related?" Add `bearing_score` (0.0–1.0) to the schema output. Store in `reference_claim_links.bearing_score`. Deploy and A/B compare quality of evidence packets.

6. **Wire `assessClaimRelevance()` as a pre-scrape snippet triage** — call it on each search result snippet before fetching, using a 500-token budget per snippet. Gate scraping: skip fetch if `bearing_score < 0.15`. Run in parallel for all snippets of one claim in one batch.

7. **Cap `maxEvidenceCandidates` at 4 globally** — reduce from 9. With bearing triage, 4 well-targeted sources > 9 random sources. Monitor evidence quality metrics.

8. **Implement EvidenceNeed per claim** — add `stanceGoal` + `evidenceTargetType` fields derived from `claimType` + `argumentFunction` + `scoreTransform`. Pass to `generateQueries()` to produce type-aware queries.

9. **Rewrite query generation prompt** — add `claimType` and `stanceGoal` as template variables. Generate evidence-type-specific queries (e.g., for `causal` claims: "mechanism study", "RCT", "systematic review" query variants).

10. **Add steelman/fairness slot to evidence packets** — in `adjudicate()`, add a `steelmanEvidence` slot that preserves the highest-quality dissenting item even when the verdict is strongly one-sided. Surface this slot in the dashboard evidence display.

11. **Wire `ClaimTriageEngine`** — populate `claim_retrieval_evidence` after the evidence run completes. Run `ClaimTriageEngine.triageClaim()` with real `retrieval_count`, `max_relevance`, and claim property data. Update `claims.triage_status`. Use triage status to control dashboard display and alert users to `insufficient_relevant_sources` claims.

12. **Implement per-claim source quotas by claim type** — thesis/pillar: 6 sources; evidence: 3 sources; background: 1; attribution: 2. Enforce in `runEvidenceEngine.js` before starting the evidence engine per claim.

13. **Reconcile `reference_claim_links` and `reference_claim_task_links`** — define a canonical display query that joins both tables and presents a unified, deduplicated evidence view per claim. Confirm which one the GameSpace and dashboard currently use.

14. **Remove the hardcoded `Math.min(..., 3)` clamp** — once bearing triage is controlling quality, allow the full 6–9 queries per claim in balanced mode but filter by bearing rather than by count.

---

## Appendix — Full Active Prompt Texts

The prompts below are the current active versions as of the `llm_prompts.latest.sql` snapshot and the `2026-06-24` deploy SQL files. All DB-stored prompts are loaded at runtime via `openAiLLM.generateWithPrompt()` / `generatePromptFromDB()`.

---

### A1. `claim_extraction_stack_system` (system)
*Used by: `claimsEngine.js` `ClaimExtractor.analyzeChunk()` in `stack` mode*

```
You extract a reasoning stack from content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Build a hierarchy:

thesis
pillar claims
pillar_support claims
evidence claims
background claims
fallibility_critical claims
search_assertions

Keep claims atomic, self-contained, and verifiable.
Do not collapse distinct assertions into one item.
Do not invent facts that are not in the text.
Extract what the content claims, alleges, implies, or quotes. Do not fact-check the content and do not correct it using outside knowledge.

For source/reference content, use the case claims only as relevance context. Do not force the source/reference content to agree with the case claims.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, quotations, and specific causal links.

Prefer specific claims over vague summaries.

If a passage contains a named person, named study, named organization, allegation of misconduct, causal harm claim, statistical claim, legal claim, correction, retraction, or methodological claim, extract the specific claim.

Do not bury argument-supporting claims as background.
Background claims are contextual only. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence, not background.

A pillar claim is a major branch of the argument.
A pillar_support claim is an intermediate claim that connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

A fallibility_critical claim is any claim that, if false, exaggerated, unsupported, conflated, or misleading, would significantly weaken the thesis, a major pillar, or an important evidence chain.

Always extract fallibility_critical claims for:

allegations of fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, or institutional misconduct
claims that a named study proves, disproves, hides, manipulates, or reveals an important result
claims involving named whistleblowers
claims that named officials, agencies, companies, journals, or scientists acted dishonestly
causal claims linking a product, policy, medicine, vaccine, intervention, law, institution, or event to harm
statistical or quantified claims used to imply risk, danger, deception, corruption, or causation
claims about retractions, corrections, changed study parameters, excluded data, hidden subgroups, or methodological flaws
claims used to discredit an opposing authority
hinge claims: claims whose failure would substantially weaken the surrounding argument

A search_assertion is a search-ready version of an important claim. It should help the next workflow step find supporting, refuting, qualifying, or contextual sources.

For each search_assertion:

preserve named people, agencies, studies, dates, laws, journals, and key phrases
include a natural-language assertion
include a compact search query
include must-include terms and optional terms
mark whether the search should seek support, refutation, both, or context
prioritize named, specific, verifiable, and fallibility-critical claims

Quality check before returning:

Did you extract the central thesis?
Did you extract major pillars?
Did you extract pillar_support claims instead of classifying them as background?
Did you extract named studies, named people, named organizations, and dates?
Did you extract allegations of fraud, cover-up, suppression, data manipulation, or evidence destruction?
Did you extract causal harm claims and statistical claims?
Did you identify the claims most likely to make or break the article?
Did you create search_assertions for those high-value claims?
Did you avoid fact-checking or correcting the article?

Return only valid JSON.
```

---

### A2. `claim_extraction_stack_with_topics` (user)
*Used by: `claimsEngine.js` in `stack` mode when topics are requested*

The user prompt drives extraction into the full structured JSON shape:
`{ generalTopic, specificTopics, thesis, pillars[{ id, label, summary, centrality, claims[{ text, role, parentId, centrality, verifiability, articleStance, namedEntities, dates, claimKind }] }], evidenceClaims[{ text, role, parentId, centrality, verifiability, articleStance, evidenceType, sourceCitedInArticle, namedEntities, dates }], backgroundClaims[...], fallibilityCriticalClaims[{ text, role, parentId, centrality, verifiability, importance, whyCritical, claimKind, articleStance, namedEntities, studiesOrDocuments, dates }], searchAssertions[{ assertion, query, derivedFromClaimText, searchIntent, priority, mustIncludeTerms, optionalTerms, entityFocus, dateFocus, reasonForSearch }], claims[...] }`

Key field enumerations:
- `role`: `thesis | pillar | pillar_support | evidence | background | fallibility_critical`
- `articleStance`: `asserted_as_fact | alleged | implied | quoted | speculative`
- `claimKind` (pillar_support): `contradiction | interpretation | causal_bridge | credibility_attack | mechanism | historical_link | institutional_failure | methodology_claim | other`
- `evidenceType`: `study | statistic | quote | document | event | expert_claim | legal_claim | example | dataset | official_statement | methodology_claim | retraction_or_correction | other`
- `searchIntent`: `support | refute | both | context`
- `centrality` / `verifiability`: 0–100

---

### A3. `claim_extraction_edge_system` (system, prompt_id 408)
```
You are a precise claim extraction assistant. You must return strictly valid JSON.
```

### A4. `claim_extraction_edge_no_topics` (user, prompt_id 410)
```
TASKS
1) Extract the {{minClaims}}-{{maxClaims}} SHARPEST, most impactful verifiable claims from the text.

   EDGE MODE - be ruthless. Only extract claims that meet ALL of:
   a) SPECIFICITY: concrete numbers, dates, named entities, or clearly falsifiable assertions
   b) CONTROVERSY: genuinely disputed, surprising, or counterintuitive
   c) MATERIALITY: central to the article main argument or thesis

   CRITICAL: Extract ATOMIC claims - break compound statements into separate claims.

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - Phrase each claim as a complete, specific sentence
   - Return only the top {{maxClaims}} highest-impact claims

2) Do NOT invent topics or testimonials in this mode.
```
*Parameters: `{"maxClaims":7,"minClaims":3}`*

---

### A5. `claim_extraction_ranked_system` (system, prompt_id 1)
```
You are a precise claim extraction assistant. You must return strictly valid JSON.
```

### A6. `claim_extraction_ranked_no_topics` (user, prompt_id 406)
The ranked mode user prompt (abbreviated here — full text is ~180 lines). Key instructions:
- Extract world-claims, NOT article-claims (never "The article says X" — write "X" directly)
- Article-specificity requirement: preserve named people, institutions, locations, dates, quoted terms
- Claim type priority: (A) central real-world thesis, (B) central event/allegation, (C) official finding/document, (D) framing/interpretive, (E) atomic supporting
- Ranking criteria: centrality → identifiability → controversy → falsifiability → search usefulness → specificity
- *Parameters: `{"maxClaims":12,"minClaims":3}`*

---

### A7. `claim_extraction_edge_for_source_system` (system, prompt_id 203)
*Used by: source-level claim extraction in `processTaskClaims` edge mode*
```
You are extracting claims from an evidence source to evaluate a specific case claim.
Extract claims that DIRECTLY ADDRESS the case claim using SIMILAR TERMINOLOGY and FRAMING.
You must return strictly valid JSON.
```

### A8. `claim_extraction_edge_for_source_user` (user, prompt_id 204)
*Used by: source-level claim extraction*
```
CASE CLAIM BEING INVESTIGATED:
"{{caseClaimText}}"

CASE CLAIM THEME: {{caseClaimTheme}}

EVIDENCE SOURCE TEXT:
{{sourceText}}

TASK: Extract {{minClaims}}-{{maxClaims}} claims that DIRECTLY ADDRESS the case claim.

CRITICAL REQUIREMENTS:

1. TOPICAL ALIGNMENT: Only extract claims about the SAME SUBJECT as the case claim
2. LANGUAGE MIRRORING: Frame claims using SIMILAR TERMINOLOGY to the case claim
3. RELATIONSHIP CLARITY: Each claim should be obviously FOR, AGAINST, or NUANCING the case claim
4. ATOMIC & SPECIFIC: Each claim must be one falsifiable assertion, self-contained with full context

EXTRACTION PRIORITY:
a) Claims with DATA that directly confirms/refutes the case claim (same metrics, comparable populations)
b) Claims with CONTEXT that explains why the case claim might be true/false
c) Claims with ALTERNATIVE INTERPRETATIONS of the same evidence
d) Claims with HISTORICAL PRECEDENT relevant to evaluating the case claim

Return claims in order of relevance to the case claim.
```
*Parameters: `{"maxClaims":9,"minClaims":3}`*

---

### A9. `evidence_query_generation_system` (system, prompt_id 100)
```
You generate diverse, high-precision search queries for fact-checking.
CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE,
and provide NUANCED perspectives on the claim.
```

### A10. `evidence_query_generation_user` (user, prompt_id 101)
```
Claim: {{claimText}}
Context: {{context}}

Task: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives.
For refute queries, look for credible counterarguments, debunking sites, fact-checks, or
alternative evidence. For support queries, look for sources that would confirm or provide
evidence for the claim. For nuance queries, look for sources that provide context, caveats,
or partial support/refutation.
```
*Parameters: `{"n":6}`*

### A11. `evidence_query_generation_user_balanced` (user, prompt_id 404)
*This is the version used in `balanced` search mode*
```
CLAIM TO VERIFY:
"{{claimText}}"

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} diverse search queries to find evidence for this claim.

BALANCED DISTRIBUTION REQUIRED:
- {{supportQueries}} queries designed to find sources that SUPPORT the claim
- {{refuteQueries}} queries designed to find sources that REFUTE the claim
- {{nuanceQueries}} queries designed to find sources that provide NUANCED perspective

QUERY DESIGN GUIDELINES:

For SUPPORT queries:
- Search for confirmatory evidence, corroboration, similar findings
- Target academic studies, expert statements, authoritative sources

For REFUTE queries:
- Search for debunking, fact-checks, counterarguments, contradictory evidence
- Target fact-checkers, critical analyses, alternative interpretations

For NUANCE queries:
- Search for context, caveats, limitations, partial agreements, complexities
- Target analysis pieces, expert discussions, contextual information

CRITICAL: Ensure queries actively seek OPPOSING viewpoints, not just variations of one perspective.

OUTPUT FORMAT: Return EXACTLY {{n}} queries as a JSON array of strings.
```
*Parameters: `{"n":6}`*

---

### A12. `extractQuotesAndScoreQuality` (hardcoded in `extractQuote.js`)
*This is the most-called prompt in the pipeline — runs once per scraped source per claim*

**System:**
```
You extract verbatim quotes from sources AND evaluate source quality in a single analysis.
Return valid JSON only.
```

**User (abbreviated — full template in `extractQuote.js` lines 121–181):**
```
TASK 1: Extract verbatim quotes that directly bear on the claim and classify stance.
TASK 2: Score source quality across 8 dimensions (0-10 scale).

CLAIM: {{claimText}}

SOURCE METADATA:
- Title: {{sourceTitle}}
- URL: {{url}}
- Domain: {{domain}}
- Author: {{metadata.author}}
- Publisher: {{metadata.publisher}}
- Citations Extracted: {{metadata.citationCount}}

CONTENT (first {{maxChars}} chars): {{fullText}}

EXTRACT QUOTES (up to {{maxQuotes}}):
- quote: verbatim text from source
- stance: support|refute|nuance|insufficient
- summary: brief explanation
- location: {page: null, section: "..."}

STANCE CLASSIFICATION RULES:
• support: Source provides evidence FOR the claim
• refute: Source contradicts the claim, questions it, debunks it, or fact-checks it as false
• nuance: Source adds context, caveats, limitations, or partial agreement/disagreement
• insufficient: Source mentions the claim but takes no clear position

ATOMIC ASSERTION RULES:
• Evaluate the exact factual assertion in CLAIM, not a broader topic nearby.
• If CLAIM includes an attribution wrapper like "X revealed that Y", evaluate Y as the core assertion.
• If CLAIM alleges misconduct, support requires a quote directly addressing that misconduct.
• [... full misconduct/attribution contract inline ...]

SCORE SOURCE QUALITY (0-10 scale):
1. author_transparency    2. publisher_transparency
3. evidence_density       4. claim_specificity
5. correction_behavior    6. original_reporting
7. sensationalism_score   8. monetization_pressure
```

**Output schema:**
```json
{
  "quotes": [{ "quote": "...", "stance": "support|refute|nuance|insufficient", "summary": "...", "location": {"page": null, "section": "..."} }],
  "quality": {
    "author_transparency": 5.0, "publisher_transparency": 5.0,
    "evidence_density": 5.0,   "claim_specificity": 5.0,
    "correction_behavior": 5.0, "original_reporting": 5.0,
    "sensationalism_score": 5.0, "monetization_pressure": 5.0,
    "reasoning": "..."
  }
}
```
*Temperature: 0.1. Model: `gpt-4o-mini` (hardcoded at `runEvidenceEngine.js` line 1103)*

---

### A13. `argument_mapping_system` (system)
*Used by: `argumentMappingEngine.js` `mapArgumentFunctions()`*
```
You map extracted case claims to their function inside the article's argument.

Return strict JSON only. Do not include markdown or commentary.

Decide whether the article endorses each claim, rejects it, reports it neutrally,
or uses it as an opposing claim to refute.

This is not fact-checking. Do not use outside knowledge. Use only the article text
and extracted claims.

For attribution claims like "X says Y", distinguish the attribution wrapper from
the object claim Y.

scoreTransform controls how evidence about the object claim should affect the article:
- normal: evidence supporting the object claim supports the article
- invert: evidence supporting the object claim weakens the article; evidence refuting
  it supports the article
- none: the claim should not directly affect the article score
- review: unclear; human review needed before scoring

Use invert when the article presents a claim mainly as an opponent/ad/source claim
that the article is trying to discredit.
Use none for attribution-only, neutral reporting, or background that does not carry
the argument.
```

### A14. `argument_mapping_user` (user)
```
Analyze this article excerpt and extracted claims.

ARTICLE EXCERPT:
{{articleExcerpt}}

EXTRACTED THESIS:
{{articleThesis}}

CLAIMS:
{{claimsJson}}

Return JSON with exactly this structure:
{
  "articleThesis": "",
  "claims": [
    {
      "claimId": 0,
      "objectClaim": "",
      "isAttribution": false,
      "speakerEntity": "",
      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",
      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
      "scoreTransform": "normal|invert|none|review",
      "accountabilityEligible": false,
      "confidence": 0,
      "rationale": ""
    }
  ]
}

Rules:
- Include one output item for every input claim.
- objectClaim is the factual assertion evidence search should evaluate.
- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.
- If the article uses Y as an example of what is wrong or false, use
  argumentFunction opposing_claim_to_refute and scoreTransform invert.
- If the article uses Y to support its own thesis, use normal.
- If the article merely says who said something and the object claim does not
  carry the article argument, use none.
- Keep rationales short.
```

---

### A15. `claim_matching_system` (system, prompt_id 109)
*With `STANCE_CONTRACT` + `MISCONDUCT_CONTRACT` appended at runtime*
```
You are a fact-checking assistant that analyzes how reference claims relate to
task claims.

For each reference claim, determine:
1. Which task claim(s) it addresses (if any)
2. The stance: support, refute, nuance, or insufficient
3. Veracity score (0-1): How truthful/reliable is this reference claim?
4. Confidence (0.15-0.98): How confident are you in this match?
5. Support level (-1.2 to +1.2): Directional strength

Return ONLY matches where the reference claim meaningfully addresses a task claim.

--- STANCE CONTRACT (appended at runtime) ---
- Judge stance only relative to the TASK CLAIM.
- "support" means the reference makes the task claim more likely true.
- "refute" means the reference contradicts or weakens the task claim.
- If the task claim says A > B and the reference says B > A, stance must be "refute".
- Never use "support" merely because the reference source appears credible.

--- MISCONDUCT / ATTRIBUTION CONTRACT (appended at runtime) ---
- If the task claim contains an attribution wrapper such as "X revealed that Y",
  evaluate the core assertion Y while using X only as context.
- For claims alleging fraud, cover-up, suppression, destruction of evidence, data
  manipulation, or institutional misconduct, support requires the reference claim
  to address that specific misconduct.
- A reference claim saying data was "omitted" or "excluded" does not support a
  task claim saying evidence was destroyed.
- Do not infer stronger misconduct than the reference actually states.
```

### A16. `claim_matching_user` (user, prompt_id 110)
```
TASK CLAIMS (what we're fact-checking):
{{taskClaims}}

REFERENCE CLAIMS (from evidence source):
{{referenceClaims}}

For each reference claim that addresses a task claim, return a match object.
ONLY include matches where there's a clear relationship.

Return JSON array of matches:
[
  {
    "task_claim_index": 0-based index,
    "reference_claim_index": 0-based index,
    "stance": "support|refute|nuance|insufficient",
    "veracity": 0.0-1.0,
    "confidence": 0.15-0.98,
    "support_level": -1.2 to +1.2,
    "reasoning": "brief explanation"
  }
]
```

---

### A17. `claim_relevance_assessment_system` (system, prompt_id 111)
*Not in main pipeline — standalone utility in `assessClaimRelevance.js`*
```
You are assessing whether a reference claim is relevant to a task claim.

Guidelines:
- "support": Reference claim provides evidence FOR the task claim
- "refute": Reference claim provides evidence AGAINST the task claim
- "nuance": Reference claim adds context or partial support/refutation
- "insufficient": Reference claim is not relevant or doesn't provide meaningful evidence

- confidence: 0-1 (how certain you are of the stance)
- quality: 0-1.2 (how strong/useful the reference claim is as evidence)
- rationale: 1-2 sentences explaining WHY this stance applies
```

### A18. `claim_relevance_assessment_user` (user, prompt_id 112)
```
TASK CLAIM:
"{{taskClaimText}}"

REFERENCE CLAIM:
"{{referenceClaimText}}"

Analyze whether the reference claim supports, refutes, nuances, or is insufficient
for evaluating the task claim.{{customInstructions}}

Return JSON:
{
  "stance": "support|refute|nuance|insufficient",
  "confidence": 0.0-1.0,
  "quality": 0.0-1.2,
  "rationale": "brief explanation"
}
```

---

### A19. `claim_filtering` (user, prompt_id 6)
*Used for claim quality gating — uncertain if wired into main pipeline*
```
Evaluate this claim for verification worthiness:

CLAIM: "{{claim}}"

Rate 0.0-1.0 on each dimension:

1. SPECIFICITY: Is this specific and falsifiable?
   1.0 = Concrete, verifiable assertion with specifics
   0.5 = Somewhat specific but missing key details
   0.0 = Vague, generic, or subjective opinion

2. CONTROVERSY: Would reasonable people dispute this?
   1.0 = Genuinely controversial or surprising claim
   0.5 = Somewhat debatable
   0.0 = Obviously true/false or trivial

3. MATERIALITY: Is this central to the article's main argument?
   1.0 = Core thesis or key supporting claim
   0.5 = Supporting detail
   0.0 = Background context or filler

Return JSON: {"specificity": X, "controversy": Y, "materiality": Z, "reasoning": "..."}
```
*Parameters: `{"threshold":0.6}`*

---

### A20. `claim_properties_evaluation_user` (user, prompt_id 108)
*Not in main pipeline — `claimEvaluationClassifier.js`*
```
CLAIM: "{{claim_text}}"
SOURCE DOCUMENT PREVIEW (first 1500 chars): {{source_document_preview}}

SCORE EACH DIMENSION (0.00-1.00):
1. claim_centrality   2. claim_specificity   3. claim_consequence
4. claim_contestability   5. claim_novelty

Return JSON: { claim_centrality, claim_specificity, claim_consequence,
               claim_contestability, claim_novelty, reasoning }
```

---

### A21. `source_quality_evaluation_user` (user, prompt_id 113)
*Standalone source quality evaluation — may be called separately from `extractQuotesAndScoreQuality`*
Full 8-dimension quality scoring prompt (author_transparency, publisher_transparency,
evidence_density, claim_specificity, correction_behavior, original_reporting,
sensationalism_score, monetization_pressure) evaluated from URL + domain + author +
publisher + date + content preview. Same dimensions as A12 but as a standalone call.

---

**Note on prompt delivery:** All DB-stored prompts are loaded at runtime by name via
`openAiLLM.generateWithPrompt(promptName, vars)` or equivalent. The `{{variable}}`
placeholders are replaced before the call. Temperature and model are set per-call in the
calling function, not in the DB row (except `parameters` JSON which may carry `maxClaims`
etc. for claim extraction prompts).
