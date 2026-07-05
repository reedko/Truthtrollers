# Scrape Pipeline Audit — Button Click → Completion

**Scope:** full trace of the evidence-scrape pipeline, the database prompts used at
each stage, the actual search provider calls, and how results are rated.
**Worked example:** the William Thompson / MMR–CDC claim from
`taskContentId 16833`, `claimId 54064` (log: `backend/logs/evidence-2026-07-03.log`).

> TL;DR of the worked example: the real 2004 DeStefano study never entered the
> evidence set for three independent reasons — (1) PubMed returned 0 results and
> the study's PMID was never retrieved, (2) study-identity resolution picked a
> press release over the study, and (3) the DOI candidates that *did* arrive
> (from OpenAlex) scored **0** in snippet bearing and were dropped at the gate.
> The snippet LLM scorer also **timed out** (`aborted` at 15 s), so every
> candidate fell back to deterministic-only scoring.

---

## 1. End-to-end stages

The extension "scrape" button POSTs to the backend, which runs five stages in order.

| # | Stage | Entry point | What it does |
|---|-------|-------------|--------------|
| 1 | HTTP entry | `POST /api/scrape-task` — `src/routes/content/content.scrape.routes.js:384` | Wraps the run in OpenAI usage capture; orchestrates stages 2–5. |
| 2 | Content scrape | `scrapeTask()` — `content.scrape.routes.js:619` (`src/core/scrapeTask.js`) | Fetches + cleans the article HTML, authors, publisher. |
| 3 | Claim extraction | `processTaskClaims()` — `content.scrape.routes.js:704` (`src/core/processTaskClaims.js` → `ClaimExtractor` in `src/core/claimsEngine.js`) | LLM extracts atomic claims from the article text. |
| 4 | Argument mapping | `mapArgumentFunctions()` — `content.scrape.routes.js:710` (`src/core/argumentMappingEngine.js`) | Assigns each claim a role (thesis/evidence/background) and builds **evaluation targets**. |
| 5 | Evidence engine | `runEvidenceEngine()` — `content.scrape.routes.js:746` (`src/core/runEvidenceEngine.js`) | Study-identity discovery → query generation → multi-provider search → snippet-bearing scoring → gating → scrape → post-scrape bearing → packet. |

Stage 5 is where the Thompson claim's studies were found and discarded, so most of
this document focuses there.

---

## 2. Database prompts (table `llm_prompts`, loaded via `src/core/promptManager.js`)

`promptManager.getPrompt(name)` reads `prompt_text` from `llm_prompts` (with an
in-code fallback). Every prompt the pipeline pulls from the DB:

| Stage | Prompt name(s) | Used in |
|-------|----------------|---------|
| Claim extraction | `claim_extraction_stack_system`, `claim_extraction_stack` (+`_with_topics` / `_no_topics` suffix), `claim_extraction_{edge\|ranked\|comprehensive}[_for_source][_with_topics\|_no_topics]`, `claim_extraction_edge_for_source_system`, `claim_extraction_edge_system`, `claim_extraction_ranked_system`, `claim_extraction_unresolved_targets_instruction`, `claim_extraction_source_context_instruction` | `src/core/claimsEngine.js:101,113–140,390,410` |
| Argument mapping | `argument_mapping_system`, `argument_mapping_user` | `src/core/argumentMappingEngine.js:232` |
| Claim triage | `claim_triage_system`, `claim_triage_user` | `src/core/claimTriageEngine.js:209,214` |
| Claim relevance | `claim_relevance_assessment_system`, `claim_relevance_assessment_user` | `src/core/assessClaimRelevance.js:108,113` |
| Snippet-bearing (LLM pre-score) | `snippet_bearing_assessment_system`, `snippet_bearing_assessment_user` | `src/core/snippetBearing.js` (see §5) |
| Post-scrape claim matching | `claim_matching_bearing_system` / `claim_matching_bearing_user` (bearing mode) or `claim_matching_system` / `claim_matching_user` (legacy) | `src/core/matchClaims.js:257–263` |
| Source quality scoring | `source_quality_evaluation_system`, `source_quality_evaluation_user` | `src/core/sourceQualityScorer.js:167,172` |

> Note: `analyzeContent.js` uses a **hard-coded** OpenAI chat prompt
> (`src/routes/analyzeContent.js:53,107`) — it is a separate single-chunk analyzer,
> not part of the DB-prompt claim-extraction path above.

---

## 3. Search provider layer

### Endpoints — `src/core/evidenceRetrievalGateway.js:7–15`
```
tavily            https://api.tavily.com/search
brave             https://api.search.brave.com/res/v1/web/search
serpapi           https://serpapi.com/search
bing              https://api.bing.microsoft.com/v7.0/search
pubmed  (esearch) https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
crossref          https://api.crossref.org/works
openalex          https://api.openalex.org/works
semantic_scholar  https://api.semanticscholar.org/graph/v1/paper/search
```
Academic providers (`pubmed`, `crossref`, `openalex`, `semantic_scholar`) are
implemented in `src/core/academicProviders.js`.

### Config — `src/core/searchGatewayConfig.js`
- Default web providers: `["tavily", "brave", "serpapi"]` (line 5).
- `maxResultsPerQuery: 10` (line 9) → `topK`/`per-page`/`retmax` per provider.
- Academic providers are toggled by env (`ENABLE_PUBMED_SEARCH`, `ENABLE_OPENALEX_SEARCH`, …) and work without keys (keys only raise rate limits).
- Config is also loaded from the `search_gateway_config` app-config row (line 83+).

### PubMed esearch — `src/core/academicProviders.js:28`
```
GET /esearch.fcgi?db=pubmed&term=<query>&retmax=<topK>&retmode=json
→ then efetch/esummary for the returned idlist
```
Query text is passed **verbatim** as the `term`. A narrative term like
`"William Thompson 2016 2014 2004 mmr cdc data linking vaccine autism study"`
matches nothing in PubMed's index (see §4).

### OpenAlex — `src/core/academicProviders.js:100`
```
GET /works?search=<query>&per-page=<topK>
```
**Key detail (root cause #3):** the snippet handed downstream is built from
metadata only —
`snippet = [title, "Authors: …", venue, year]` (`academicProviders.js:124`).
**No abstract is fetched or reconstructed.** So the only text a study offers the
scorer is its title + author list + journal + year.

---

## 4. The Thompson claim — actual queries and provider results

`claimId 54064` — *"data linking the MMR vaccine to autism had been manipulated by the CDC."*
Evaluation targets seen in the log: `173` (substantive) and `174` (attribution /
study-identity). Queries are generated deterministically from claim anchors
(person / org / work / date / topic) in
`src/core/anchoredQueryPack.js:73` (`buildDeterministicAnchoredQueries`), plus
study-identity discovery queries in `src/core/studyIdentityDiscovery.js`.

### 4a. Queries generated for this claim (tagged to `claimId 54064`)
**Study-targeted (aimed at the real paper):**
- `CDC MMR autism DeStefano 2004 data manipulation omitted data`
- `DeStefano 2004 MMR autism study data available Thompson Hooker`
- `William Thompson 2016 2014 2004 mmr cdc data linking vaccine autism study` (identity discovery)
- `William Thompson mmr cdc data linking paper analysis` (identity discovery)

**Claim-text / framing:**
- `data linking the MMR vaccine to autism had been manipulated by the CDC.`
- `William Thompson claims that the CDC manipulated data linking the MMR vaccine to autism.`
- `Investigate whether the CDC destroyed evidence related to the MMR vaccine and autism link as claimed by William Thompson.`
- `Review the CDC's response to allegations of data manipulation regarding the MMR vaccine and autism.`
- `What evidence exists that contradicts William Thompson's claims about CDC data manipulation…?`
- `William Thompson mmr cdc data statement transcript`, `response William Thompson mmr cdc data statement`, `William Thompson`

> A cluster of `"public health authorities …"` queries is also co-tagged to 54064
> in the log — these belong to a sibling claim and indicate **query/target
> attribution leaking across claims** (separate issue worth a look).

### 4b. Provider outcomes (from `[SEARCH_GATEWAY]` records)
For the two identity-discovery queries (representative of the whole run):

| Provider | Result | Notes |
|----------|--------|-------|
| tavily | 5 + 5 results | Returned news/advocacy pages. |
| brave | 5 + 5 results | Returned news/advocacy pages. |
| serpapi | **HTTP 429 on every query** | Rate-limited — effectively dead this entire run. |
| pubmed | **0 results on every query** (one `HTTP 429`) | Narrative query terms match nothing; the real study PMID never came back. |
| openalex | 5 + 5 results | Returned DOIs, metadata-only snippets. |

### 4c. Where the studies were found — and what happened to each
| Candidate | Found by | Fate |
|-----------|----------|------|
| **DeStefano 2004, *Pediatrics*** (PMID 14754936 / DOI 10.1542/peds.113.2.259) — the actual study | **Never retrieved by any provider** | Absent from the entire log. |
| `archive.cdc.gov/…/cdc2004pediatrics.html` (CDC statement on the 2004 study) | tavily | Identity-discovery candidate (score 0.5); **not** chosen as resolved work; never entered the scrape pool. |
| CNN "Journal questions validity of autism and vaccine study" (2014) | brave | Identity candidate (0.45); dropped. |
| Hooker reanalysis `doi.org/10.1371/journal.pone.0089177` | openalex | Reached gating pool, snippet score **0**, tagged `protected_origin` but `selected:false`; dropped at gate. |
| OSF preprint `doi.org/10.31237/osf.io/trz5s` (likely the refused-publication reanalysis) | openalex | Reached gating pool, snippet score **0**, `selected:false`; dropped at gate. |
| Kostoff `doi.org/10.20309/jdis.201623` | openalex | Identity candidate (0.35); dropped. |

### 4d. Study-identity resolution picked a press release (`[STUDY_IDENTITY_DISCOVERY]`, log line 207)
Top-scored candidate becomes the single "resolved work":

| score | candidate | outcome |
|-------|-----------|---------|
| **0.55** | globenewswire "CDC Whistleblower to Extend MMR Vaccine Fraud" (**press release**) | **chosen as resolvedWork** |
| 0.50 | archive.cdc.gov CDC 2004-study statement | dropped |
| 0.45 | CNN retraction story (2014) | dropped |
| 0.35 | Kostoff DOI | dropped |
| 0.35 | mercury/vaccines commentary DOI | dropped |

Because citation-expansion is now retired (`extractCitationDerivedCandidates`
returns `[]`), the **only** remaining path for the real study to enter is
`resolvedWorkCandidatesForClaim()` — and identity resolution resolved to the
press release, so the study had no path in.

### 4e. What actually made the verdict packet (`[BEARING_PACKET]`, log line 3243)
All non-studies: globenewswire press release (×2, quality **"unreliable"**), its
`vaccineimpact.com` mirror ("unreliable"), `factcheck.org` (refute), and
`abcnews.com` (Thompson's "omitted statistically significant information"
statement, nuance).

---

## 5. How results are rated (scoring)

Ratings happen at two points: **pre-scrape** (cheap, decides what to fetch) and
**post-scrape** (LLM, decides evidence stance/quality).

### 5a. Pre-scrape snippet bearing — `src/core/snippetBearing.js`
Two scorers combine:

1. **LLM scorer** (`snippet_bearing_assessment_system/user`, method `snippet_bearing_llm_v1`).
   In this run it **failed**: `[BEARING_LLM_SHADOW] … "failed":true,"errors":["This operation was aborted"],"elapsedMs":15005` — a 15-second timeout aborted the batch, so `llmScore = null` for **all 20 candidates**. Everything fell back to deterministic-only.

2. **Deterministic scorer** — `scoreSnippetBearingDeterministic()` (line 203). Scores `title + snippet` against the claim's `evidenceNeed` terms:
   ```
   weighted = 0.20·subject + 0.25·relation + 0.25·object + 0.08·scope
            + 0.08·mustInclude + 0.07·attributionOrCausal + 0.07·targetFit
   rawScore = weighted · directnessGate − topicOnlyPenalty − genericPagePenalty − noClaimPenalty
   ```
   Anti-topic-drift penalties (lines 266–268) are the killers for studies:
   - `topicOnlyPenalty = 0.3` when `subject ≥ 0.5` but `relation < 0.2` **and** `object < 0.2` and no bearing signal.
   - `directnessGate` drops to `0.55` when neither relation nor object appears.
   - Design intent (prompt line 44): *"Do not reward same-topic overlap alone."*

**Why the OpenAlex studies scored 0:** their only text is title + authors + venue
+ year. A study titled e.g. *"Measles-mumps-rubella vaccination timing and autism…"*
contains the **subject/topic** ("MMR", "autism") but **not** the claim's
predicate/attribution terms ("manipulated", "CDC", "data"). So `relation ≈ 0`,
`object ≈ 0`, `topicOnlyPenalty` fires, `directnessGate` halves it → **0**. The
scorer is doing exactly what it was built to do; it just has nothing but a title
to work with, and the title of a real study never asserts the misconduct claim.

### 5b. Gating / selection — `src/core/evidenceCandidateSelector.js:124` (`selectCandidatesForClaim`)
- A candidate `passes` if `score ≥ minBearingToScrape` **or** it is an origin/steelman/high-disagreement candidate (line 157).
- Origin candidates are `protected_origin` and get origin slots first (line 178).
- In the log's `[BEARING_GATING]` for 54064: `candidateCount: 20, selectedCount: 0`. The study DOIs were tagged `protected_origin` yet `selected:false` — origin protection did **not** pull the score-0 DOIs into the tranche in this pass. (This is a second, gating-level issue on top of the score-0 root cause.)

### 5c. Post-scrape scoring
- **Claim matching / bearing** (`claim_matching_bearing_system/user`, `src/core/matchClaims.js`) produces per-quote `bearingScore`, `stance`, `bearingType`, `claimComponentAddressed` — visible in `[BEARING_POST_SCRAPE]`.
- **Source quality** (`source_quality_evaluation_system/user`, `src/core/sourceQualityScorer.js`) produces the `qualityScore`/`qualityLabel` (e.g. the press release's "unreliable").
- Final selection into the verdict is the `[BEARING_PACKET]` build in `runEvidenceEngine.js`.

---

## 6. Root-cause summary (why the studies didn't appear)

| # | Failure | Evidence | Fix lever |
|---|---------|----------|-----------|
| 1 | Real study never retrieved | PubMed returned 0 for every query; PMID 14754936 absent from log; serpapi 429 all run | Send **clean bibliographic** queries to PubMed (title/author/year, not narrative), and/or seed identity discovery with the resolved PMID/DOI so the paper is a direct candidate. |
| 2 | Identity resolution picked a press release | `[STUDY_IDENTITY_DISCOVERY]` line 207: globenewswire 0.55 > CDC 2004 statement 0.50 | Down-rank press releases / up-rank primary-source domains (doi.org, journal, ncbi) in the identity scorer; don't collapse to a single top-1 resolved work. |
| 3 | OpenAlex study DOIs scored 0 and were gated out | `[BEARING_LLM_SHADOW]` aborted → deterministic-only; DOI snippets are metadata-only; `topicOnlyPenalty` → 0; `[BEARING_GATING]` selectedCount 0 | (a) Reconstruct OpenAlex `abstract_inverted_index` into the snippet so the scorer has real text; (b) fix the snippet-LLM 15 s timeout/abort; (c) let `protected_origin` candidates take an origin slot even at score 0. |

### Secondary observations
- **Snippet-LLM timeout** (`elapsedMs: 15005`, `This operation was aborted`) silently degraded the *entire* run to deterministic scoring — worth alerting on, not just logging `failed:true`.
- **Cross-claim query leakage**: "public health authorities" queries co-tagged to the Thompson claim (54064).
- **serpapi** was 429 for the whole run; if it's the primary web provider, retries/backoff or deprioritization matters.

---

## 7. Key files index

| Concern | File |
|---------|------|
| HTTP route / orchestration | `src/routes/content/content.scrape.routes.js` |
| Content scrape | `src/core/scrapeTask.js` |
| Claim extraction | `src/core/claimsEngine.js`, `src/core/processTaskClaims.js` |
| Argument mapping / targets | `src/core/argumentMappingEngine.js` |
| Evidence engine (stage 5) | `src/core/runEvidenceEngine.js`, `src/core/evidenceEngine.js` |
| Study identity | `src/core/studyIdentityDiscovery.js`, `src/core/citationExpansion.js` |
| Query generation | `src/core/anchoredQueryPack.js`, `src/core/evidenceNeed.js` |
| Provider gateway | `src/core/evidenceRetrievalGateway.js`, `src/core/searchGatewayConfig.js`, `src/core/academicProviders.js` |
| Pre-scrape scoring | `src/core/snippetBearing.js` |
| Gating / selection | `src/core/evidenceCandidateSelector.js`, `src/core/bearingConfig.js` |
| Post-scrape scoring | `src/core/matchClaims.js`, `src/core/sourceQualityScorer.js` |
| Prompt loader | `src/core/promptManager.js` (table `llm_prompts`) |
