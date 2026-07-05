# VeriStrata Scrape/Evidence Pipeline MCT — v1

**MCT meaning:** Master Context Table / Master Control Thread for accumulating audits, logs, prompts, code findings, and fixes until the evidence pipeline is fully legible.

**Created from:** `scrape-pipeline-audit.md` uploaded July 3, 2026.

**Primary worked example:** William Thompson / MMR–CDC claim, `taskContentId 16833`, `claimId 54064`.

---

## 0. Purpose

This document is the canonical running map of what the scrape/evidence pipeline is doing, where it is failing, which fixes have been proposed, and which evidence must be preserved for regression testing.

The current immediate goal is **not** to add new features. The immediate goal is to make the pipeline observable and prevent high-bearing sources from disappearing silently.

---

## 1. Source Documents Registry

| Doc ID | Source | Status | Scope | Key Value |
|---|---|---|---|---|
| AUDIT-CLAUDE-001 | `scrape-pipeline-audit.md` | Ingested | Full trace from scrape button through evidence packet for claim `54064` | Identifies three independent ways the real DeStefano study failed to enter the evidence set. |
| AUDIT-CODEX-001 | Pending | Not yet ingested | Expected Codex audit | To be appended when available. |
| LOG-54064-001 | `backend/logs/evidence-2026-07-03.log` | Referenced by audit, not directly ingested | Evidence run log | Needed for direct source-death tracing. |

---

## 2. Canonical Pipeline Map

The scrape button triggers five top-level stages:

| Stage | Name | Entry Point | Current Understanding |
|---|---|---|---|
| 1 | HTTP entry | `POST /api/scrape-task`, `src/routes/content/content.scrape.routes.js` | Orchestrates the run and wraps OpenAI usage capture. |
| 2 | Content scrape | `scrapeTask()`, `src/core/scrapeTask.js` | Fetches and cleans article HTML; extracts authors and publisher. |
| 3 | Claim extraction | `processTaskClaims()` → `ClaimExtractor` | Extracts atomic claims from article text. |
| 4 | Argument mapping | `mapArgumentFunctions()` | Assigns claim role and builds evaluation targets. |
| 5 | Evidence engine | `runEvidenceEngine()` | Study identity discovery, query generation, provider search, snippet-bearing scoring, gating, scrape, post-scrape matching, packet. |

**Known high-risk area:** Stage 5.

---

## 3. Worked Example: Claim 54064

### 3.1 Surface Claim

> “William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.”

### 3.2 Better Decomposition

| Subclaim ID | Subclaim | Type | Retrieval Need |
|---|---|---|---|
| 54064-A | William Thompson alleged CDC authors omitted or mishandled subgroup data in a 2004 MMR/autism paper. | Allegation/event | Thompson statement, Posey record, CDC response, reporting. |
| 54064-B | The disputed study is the 2004 DeStefano et al. *Pediatrics* MMR/autism study. | Study identity | Exact title, authors, PMID, DOI, journal metadata. |
| 54064-C | MMR vaccination is associated with or causes increased autism risk. | Underlying biomedical causal claim | Population studies, cohort studies, systematic reviews, epidemiological reviews. |
| 54064-D | CDC intentionally manipulated data to hide a real MMR/autism association. | Institutional misconduct / cover-up | Primary allegation, official response, independent validation or refutation. |

### 3.3 Must-Keep Regression Sources

These sources must be visible somewhere in the candidate/audit trail for this claim family:

| Source | Expected Role | Must-Keep Reason |
|---|---|---|
| DeStefano et al. 2004, *Pediatrics*, PMID `14754936`, DOI `10.1542/peds.113.2.259` | Original disputed study / nuance | The actual study at the center of the Thompson allegation. |
| William Thompson statement, Aug. 27, 2014 | Supporting/narrow allegation | Primary source for Thompson’s allegation. |
| CDC 2004-study response page | Refuting/nuance | Official response specific to the 2004 study and Thompson-related claim. |
| Hooker reanalysis / retraction materials | Supporting narrative + refuting reliability | Shows the reanalysis route and later validity concerns. |
| Madsen et al. 2002 MMR/autism population-based study | Refuting underlying causal proposition | Independent large-scale test of MMR/autism association. |
| Hviid et al. 2019 MMR/autism nationwide cohort | Refuting underlying causal proposition | Independent high-powered test including susceptible subgroups. |
| DeStefano & Shimabukuro 2019 review | Refuting/nuance | Review of vaccine/autism evidence. |

---

## 4. Current Failure Findings

### 4.1 Root Causes from AUDIT-CLAUDE-001

| Root Cause ID | Failure | Evidence from Audit | Impact |
|---|---|---|---|
| RC-001 | Real study never retrieved | PubMed returned 0; PMID `14754936` absent from log. | The actual 2004 study cannot be evaluated. |
| RC-002 | Study identity resolver chose a press release | GlobeNewswire press release scored `0.55`, above CDC statement `0.50`. | A press release became the resolved work instead of the paper or official response. |
| RC-003 | OpenAlex candidates scored 0 and were gated out | OpenAlex snippets were metadata-only; deterministic scorer penalized topic-only overlap. | Potentially relevant DOI candidates died before scrape/bearing review. |
| RC-004 | Snippet LLM scorer timed out | LLM scorer aborted at 15 seconds; all candidates fell back to deterministic scoring. | Deterministic scoring became the sole gate. |
| RC-005 | Cross-claim query leakage | Generic “public health authorities” queries co-tagged to claim `54064`. | Wrong target attribution pollutes retrieval and scoring. |
| RC-006 | SerpAPI unavailable | HTTP 429 on every query. | Search redundancy reduced during the run. |

---

## 5. Mechanism of the Main Bug

The current prescreen appears to evaluate candidate snippets against the **surface accusation** instead of the **subclaim the source bears on**.

For claim `54064`, a paper titled:

> “A population-based study of measles, mumps, and rubella vaccination and autism”

has high bearing on subclaim `54064-C`, but low surface similarity to the full accusation because it does not contain terms like:

- William Thompson
- CDC manipulation
- cover-up
- whistleblower
- omitted data

Therefore, generic relevance scoring can assign it a low or zero score even though it is a high-bearing refuting source.

---

## 6. Required Conceptual Fix

### 6.1 Separate These Scores

| Score | Meaning | Should It Gate Alone? |
|---|---|---|
| Surface relevance | Does the source text resemble the surface claim wording? | No. |
| Subclaim bearing | Does the source bear on one decomposed subclaim? | Yes, but after target assignment. |
| Stance | Does it support/refute/nuance the targeted subclaim? | No, should inform packet selection. |
| Source quality | Is the source authoritative/reliable for this question? | No, unless very low quality and not origin/primary context. |
| Identity fit | Is this the original work/source being sought? | Yes for identity resolution, but not as a single top-1 collapse. |

### 6.2 Bearing Target Rule

Every candidate source must be scored against a `bearing_target_subclaim_id`, not only against `surface_claim`.

Example:

```json
{
  "candidate_title": "A population-based study of measles, mumps, and rubella vaccination and autism",
  "surface_relevance_score": 0.12,
  "bearing_target_subclaim_id": "54064-C",
  "bearing_score": 0.95,
  "stance": "refutes",
  "keep_reason": "Directly tests the underlying MMR/autism causal proposition."
}
```

---

## 7. Required Observability Fix: Flight Recorder

Every claim run should produce a structured flight recorder.

### 7.1 Claim-Level Flight Recorder

```json
{
  "claim_id": 54064,
  "surface_claim": "...",
  "subclaims": [],
  "queries_generated": [],
  "queries_rejected": [],
  "search_results_raw": [],
  "candidates_after_dedupe": [],
  "candidates_after_prescreen": [],
  "candidates_after_bearing": [],
  "candidates_after_stance": [],
  "final_sources": []
}
```

### 7.2 Candidate-Level Death Certificate

Every removed candidate must have:

```json
{
  "title": "...",
  "url": "...",
  "doi": "...",
  "pmid": "...",
  "source_provider": "openalex|pubmed|bing|tavily|brave|serpapi|crossref|semantic_scholar",
  "query_that_found_it": "...",
  "target_subclaim_id": "...",
  "surface_relevance_score": 0.0,
  "bearing_score": null,
  "stance": "unknown",
  "kept": false,
  "removed_at_stage": "openalex_prescreen",
  "reason_code": "LOW_SURFACE_RELEVANCE",
  "human_readable_reason": "Candidate did not mention Thompson/CDC/manipulation, even though it may bear on MMR/autism causality."
}
```

### 7.3 Required Reason Codes

| Code | Meaning |
|---|---|
| `QUERY_CORRUPT` | Query contains broken fragments or merged words. |
| `WRONG_CLAIM_ATTRIBUTION` | Query/source belongs to a sibling claim. |
| `DUPLICATE` | Removed due to duplicate URL/DOI/source identity. |
| `LOW_SURFACE_RELEVANCE` | Surface-wording score below threshold. |
| `LOW_BEARING` | Scored low against assigned subclaim. |
| `LOW_SOURCE_QUALITY` | Source unreliable for the evidence need. |
| `NO_ABSTRACT` | Metadata lacks sufficient text; should not necessarily be terminal. |
| `NO_FULLTEXT` | Full text unavailable. |
| `PAYWALLED` | Paywalled, but metadata may still be usable. |
| `WRONG_TOPIC` | Candidate is about different topic. |
| `WRONG_ENTITY` | Candidate involves different person/org/work. |
| `STANCE_UNCLEAR` | Could not determine support/refute/nuance. |
| `PROVIDER_ERROR` | Provider failed/rate limited/timed out. |

---

## 8. Query Hygiene and Attribution Guardrails

### 8.1 Corrupt Query Rejection

Queries containing fragments like the following should be rejected or regenerated:

- `Willtementtranscript`
- `statem`
- `manipu`
- `availa`
- `Inveoyedevidence`
- `Revigations`
- `WhatictsWilliam`
- `publsafetynecessity`
- `debupublichealth`
- `methlichealth`

### 8.2 Claim Attribution Guard

For claim `54064`, generic “public health authorities” queries should not attach unless they explicitly map to a Thompson/MMR/CDC subclaim.

Query target requirements:

| Query Type | Required Anchors |
|---|---|
| Allegation/event | At least two of: William Thompson, CDC, MMR, autism, 2004, Pediatrics. |
| Study identity | DeStefano or exact title terms plus MMR/autism. |
| Underlying causal | MMR or measles-mumps-rubella plus autism plus study/review/cohort terms. |
| Official response | CDC plus 2004/MMR/autism/Thompson. |

---

## 9. Provider-Specific Fixes

### 9.1 PubMed

Current issue: narrative queries are passed verbatim to PubMed and return 0.

Fix:

- Generate clean bibliographic queries.
- Use exact-title or author/year terms.
- Search by known PMID/DOI when discovered.
- Use ESearch plus ESummary/EFetch.
- Use PubMed related-article expansion once an anchor paper is found.

Required clean queries for `54064`:

```text
DeStefano Bhasin Thompson Yeargin-Allsopp Boyle 2004 Pediatrics MMR autism
Age at first measles-mumps-rubella vaccination children with autism school-matched control subjects
MMR vaccine autism population based study
MMR vaccination autism nationwide cohort study
MMR autism Madsen Hviid
MMR vaccine autism systematic review epidemiological studies
```

### 9.2 OpenAlex

Current issue: snippet is title + authors + venue + year only; no abstract reconstruction.

Fix:

- Reconstruct `abstract_inverted_index` into candidate snippet.
- Preserve biomedical study candidates with MMR/autism/study terms even if generic relevance is 0.
- Do not let OpenAlex surface score become terminal.

### 9.3 Identity Resolution

Current issue: single top-1 resolved work picked a press release.

Fix:

- Down-rank press releases for study identity.
- Up-rank DOI/journal/PubMed/official archive results.
- Return top N identity candidates, not a single resolved work.
- Allow direct candidate seeding from PMID/DOI.

### 9.4 Snippet LLM

Current issue: batch timed out at 15 seconds, silently degrading to deterministic-only.

Fix:

- Alert on LLM bearing scorer failure.
- Retry smaller batches.
- Do not silently proceed without marking run quality degraded.
- Consider a deterministic rescue path for domain-specific high-bearing terms.

---

## 10. Proposed Immediate Debug Protocol

1. Freeze feature work.
2. Run claim `54064` in debug mode.
3. Hardcode known-good queries.
4. Disable terminal OpenAlex 0-score filtering.
5. Enable full flight recorder.
6. Confirm whether must-keep sources are:
   - never retrieved,
   - retrieved then filtered,
   - misattributed,
   - deduped away,
   - or lost at final packet selection.
7. Fix only the stage where each source dies.
8. Re-run until all must-keep sources have a documented path.

---

## 11. Implementation Tasks

### P0 — Observability

| Task | Owner | Status |
|---|---|---|
| Add claim-level flight recorder. | Pending | Not started |
| Add candidate death certificates. | Pending | Not started |
| Add must-keep warnings for debug claims. | Pending | Not started |
| Log target subclaim for every query and candidate. | Pending | Not started |
| Add provider error/rate-limit summary to run output. | Pending | Not started |

### P1 — Retrieval Integrity

| Task | Owner | Status |
|---|---|---|
| Reject/regenerate corrupt queries. | Pending | Not started |
| Add claim attribution guard. | Pending | Not started |
| Prevent sibling-query leakage. | Pending | Not started |
| Add clean PubMed bibliographic query generator. | Pending | Not started |
| Reconstruct OpenAlex abstracts. | Pending | Not started |

### P2 — Bearing Scoring

| Task | Owner | Status |
|---|---|---|
| Score candidates against decomposed subclaims. | Pending | Not started |
| Preserve high-bearing domain candidates despite low surface similarity. | Pending | Not started |
| Add domain rescue rules for biomedical claims. | Pending | Not started |
| Separate surface relevance from bearing. | Pending | Not started |

### P3 — Identity Resolution

| Task | Owner | Status |
|---|---|---|
| Down-rank press releases in study identity. | Pending | Not started |
| Up-rank PubMed/DOI/journal/official sources. | Pending | Not started |
| Return top N identity candidates. | Pending | Not started |
| Restore or replace citation expansion. | Pending | Not started |

---

## 12. Regression Acceptance Criteria for Claim 54064

A run is not acceptable unless:

1. The DeStefano 2004 *Pediatrics* study appears in the candidate trail or has a documented provider failure.
2. The CDC 2004-study response appears in the candidate trail.
3. William Thompson’s statement or equivalent primary allegation source appears in the candidate trail.
4. At least one large independent MMR/autism study appears for the underlying causal subclaim.
5. At least one review/evidence-synthesis source appears for the underlying causal subclaim.
6. No generic “public health authorities” query is attached to claim `54064` unless explicitly justified.
7. No candidate disappears without a removal stage and reason code.
8. Final packet distinguishes:
   - allegation support,
   - original study nuance,
   - underlying causal refutation,
   - cover-up/misconduct evidence.

---

## 13. Open Questions

| Question | Why It Matters | Status |
|---|---|---|
| Where exactly is claim/query attribution stored? | Needed to stop sibling-claim leakage. | Pending Codex/code audit. |
| Why did protected origin candidates with score 0 not select? | Origin protection did not behave as expected. | Pending code inspection. |
| Is citation expansion retired intentionally? | Its absence removed a path to the real study. | Pending decision. |
| Can PubMed retrieval accept DOI/PMID seeds directly? | Needed for study identity. | Pending implementation check. |
| Is OpenAlex abstract reconstruction implemented anywhere else? | Needed to avoid metadata-only snippets. | Pending code inspection. |
| Is the 15-second snippet LLM timeout configurable? | Needed to prevent deterministic-only degradation. | Pending code inspection. |

---

## 14. Next Document Intake Protocol

When a new audit/doc/log arrives, add it using this format:

```markdown
## Intake: <DOC-ID>

**Source:** <filename or log path>
**Date:** <date>
**Scope:** <what it covers>
**Key findings:**
- ...

**New root causes:**
- RC-### ...

**Confirms existing root causes:**
- RC-### ...

**Contradicts or revises:**
- ...

**New action items:**
- ...
```

Then update:

- Source Documents Registry
- Root Cause table
- Implementation Tasks
- Open Questions
- Regression Acceptance Criteria if needed

---

## 15. Current Working Diagnosis

The evidence engine is likely not primarily failing because it cannot generate useful queries. It generated at least some useful study-targeted queries.

The failure is downstream:

1. the actual study was not retrieved through PubMed,
2. identity resolution collapsed to a press release,
3. OpenAlex candidates had metadata-only snippets,
4. deterministic snippet bearing treated real studies as topic-only overlap,
5. the LLM snippet scorer timed out,
6. gating dropped score-0 candidates,
7. query leakage polluted claim targeting.

Therefore, the next move is not another retrieval enhancement. The next move is full traceability: every query, candidate, filter, score, and final packet decision must be visible.

---

## 16. Short Codex Prompt: Audit Mode Only

```text
Do not add new retrieval features.

Add audit logging to the existing evidence retrieval pipeline so we can trace exactly where sources are filtered out.

For each claim, produce a JSON flight recorder containing:
1. original claim
2. generated subclaims/evaluation targets
3. generated queries
4. rejected/corrupt queries with reason
5. raw search results from each provider
6. candidates after each filtering stage
7. candidates removed at each stage with reason_code
8. final selected sources

Every removed source must have:
- removed_at_stage
- reason_code
- human_readable_reason
- previous scores
- query_that_found_it
- target_subclaim_id/evaluation_target_id

Add a debug mode for claimId 54064 with known-good queries and must-keep source warnings.

Do not change scoring logic except to add logging.
Do not add new stages.
Do not refactor unrelated files.
```

---

## Intake: AUDIT-CODEX-001 / CONTENT-16833-001

**Source:** `evidence-pipeline-audit-content-16833.md`  
**Date:** 2026-07-03  
**Scope:** Failed evidence run for content `16833`, with special attention to Thompson claim `54064` and evaluation targets `172`, `173`, `174`.  
**Primary log:** `backend/logs/evidence-2026-07-03.log`, lines `53–3493`.

### Key Finding

This audit confirms and deepens the prior diagnosis: the failed run was not caused by one bad model judgment. It was a cascading pipeline failure: dirty article extraction, claim/mapping timeouts, false study identity, contaminated queries, early provider-score trimming, over-broad origin protection, snippet-bearing timeout, fair-share source allocation, duplicate target-specific fetches, and post-scrape target mismatch.

### Run Totals

| Measure | Observed |
|---|---:|
| Wall time | 15m 18s |
| Case claims persisted | 11 |
| Search-gateway queries | 77 |
| Tavily calls/results | 77 / 728 |
| Brave calls/results | 77 / 720 |
| SerpAPI calls/results | 77 / 0, every call HTTP 429 |
| PubMed search calls/results | 51 / 102, 9 HTTP 429 failures |
| OpenAlex calls/results | 51 / 444, 3 HTTP 400 failures |
| Source fetch attempts | 73 |
| Unique global source attempts | 60, the configured ceiling |
| Sources delivering bearing assertions | 20, below requested 24 |
| OpenAI calls with reported usage | 67 |
| OpenAI tokens | 204,062 input / 30,827 output / 234,889 total |

### Expanded Root Causes

| Root Cause ID | Failure | New Detail | Impact |
|---|---|---|---|
| RC-007 | Article body extraction failed cleanly | All configured selectors returned zero characters; scraper used 54,748-character full-page fallback text. | Claim extraction likely included page furniture, navigation, comments, related text, and non-article material. |
| RC-008 | Claim extraction lost important thesis-bearing claims | The run did not retain separate “scientists ordered to destroy evidence” or Vaxxed/Tribeca claims seen in prior manual discussion. | Central censorship/corruption supports were flattened or absent. |
| RC-009 | Argument mapping timed out twice | Mapper silently fell back to deterministic normalization for all evaluation targets. | Thompson target had blank predicate, blank excerpt, blank allegedAction, blank study fields, confidence 0. |
| RC-010 | Evidence need became under-specified | Mandatory terms reduced to `mmr` and `cdc`; object terms empty; `no_object_terms_detected`. | Query generation, identity discovery, snippet scoring, and post-scrape guard lacked the actor/action/study/data-handling structure needed for bearing. |
| RC-011 | False study identity poisoned later queries | Study resolver selected GlobeNewswire press release and wrote its title/year into target `174`. | Later searches pursued the press release as if it were the study. |
| RC-012 | Candidate collapse before bearing | Results were URL-deduped and cut by provider score / intent bucket before deterministic or LLM bearing could rank them. | Good results could be returned by search and vanish before bearing analysis. |
| RC-013 | Origin protection is query-intent protection | `isOriginCandidate()` treats a result as origin if it came from a `primary_source` or `original_study` query. | News or advocacy pages returned for those queries can become protected origins; document identity is not verified. |
| RC-014 | Snippet-bearing LLM timeout removed the central bearing layer | Thompson batch timed out at 15s and all candidates fell back to deterministic scoring. | The bearing design was not actually tested. |
| RC-015 | Fair-share allocation defeated relevance priority | Each active claim got exactly six unique source attempts under a global ceiling. | A claim with a central study did not get priority over broad or weaker claims. |
| RC-016 | Duplicate URL fetch/persistence was not coalesced | Same URL fetched/analyzed separately per target; concurrent duplicate stubs caused `ER_TOO_MANY_ROWS`. | Extra cost, duplicate rows, failed PDF source, and noisy evidence links. |
| RC-017 | Post-scrape target guard was too weak | Because mapper failed, substantive target 173 lacked subjectEntity, allegedAction, study identifier. | LLM treated repeated allegations as substantive support and broad MMR/autism no-link pages as direct refutation of data manipulation. |
| RC-018 | Persistence audit is internally contradictory | Handoffs logged `status: rejected`, then persisted via repair path; `countsReconcile: false`. | Success/failure accounting cannot be trusted. |
| RC-019 | Packet construction overcounted repeated allegations | Three of five Thompson packet slots repeated the same GlobeNewswire/Vaccine Impact press-release assertion. | Final evidence looked fuller than it was and amplified duplicate advocacy content. |

### Confirmed Existing Root Causes

- RC-001: Real DeStefano 2004 study did not enter the evidence set.
- RC-002 / RC-011: Study identity chose a GlobeNewswire press release.
- RC-003: OpenAlex / DOI candidates suffered metadata-only snippet scoring problems.
- RC-004 / RC-014: Snippet-bearing LLM timed out, forcing deterministic-only scoring.
- RC-005: Query / target attribution leakage remains a concern.
- RC-006: SerpAPI was effectively dead for the full run.

### Revised Pipeline Failure Narrative

The intended sequence was:

```text
atomic case target
→ targeted queries
→ broad candidate recall
→ bearing-aware ranking
→ scrape best documents
→ extract target-bearing assertions
→ persist balanced, non-duplicative links
```

The actual Thompson sequence was:

```text
full-page fallback scrape
→ claim extraction loses some thesis supports
→ argument mapping times out
→ confidence-0 fallback target
→ no explicit alleged action or study identity
→ press release mislabeled as study
→ contaminated queries
→ provider-score / intent truncation before bearing
→ query labels treated as document-origin proof
→ snippet LLM timeout
→ deterministic/protected ordering
→ six-source fair-share tranche
→ duplicate per-target scrapes
→ allegation repetition classified as evidence
→ broad no-link statements classified as direct refutation
→ packet dominated by duplicate press-release assertions
```

### Repairs Added from AUDIT-CODEX-001

#### P0 — Stop Producing Misleading Results

1. **Fail closed on mapping timeout for misconduct/study claims.**  
   If argument mapping times out, retry a smaller per-claim mapping prompt. If that fails, mark the claim unresolved. Do not silently run study resolution and evidence retrieval on confidence-0 fallback targets.

2. **Require verified document identity for origin protection.**  
   A query asking for an original study does not make the returned page an original study.

3. **Fix study identity resolution.**  
   Press releases, advocacy pages, and news coverage must not be allowed to resolve as the original study. If unresolved, keep multiple identity hypotheses rather than writing a false resolved identity.

4. **Coalesce source fetch/persistence by canonical URL before target expansion.**  
   Fetch once, persist once, reuse cached text for target-specific extraction.

5. **Add substantive-conduct guard.**  
   For data-manipulation/omission/destruction claims, evidence must mention the identified study plus the alleged conduct. Generic no-link studies may bear on the broader causal claim, but they cannot directly refute alleged misconduct unless they discuss the study/data handling.

#### P1 — Stop Discarding Wheat Before Bearing

6. **Move provider-score / intent cuts after bearing.**  
   Preserve a bounded union per query/provider, then score identity and bearing.

7. **Create a claim-local priority lane for verified study/direct-source objects.**  
   This lane is independent of the global 60-source fair-share cursor.

8. **If snippet LLM fails, fall back conservatively.**  
   Do not let query-type origin labels substitute for verified document identity.

9. **Preserve full query/target provenance through canonical merge.**  
   Choose target assignments by target fit, not the highest provider-score occurrence.

#### P2 — Improve Diversity and Cost

10. Deduplicate syndicated/copied assertions before packet construction.
11. Limit each document to one packet slot per stance/target unless distinct assertions differ materially.
12. Separate attribution, substantive conduct, inference, and study identity in UI and quota accounting.
13. Stop calling a provider for the rest of a run after deterministic quota failure such as SerpAPI 429.
14. Move duplicate publisher enrichment calls outside the evidence critical path/token accounting.
15. Repair repair-route accounting so `rejected → persisted` is represented as a route transition and reconciliation becomes meaningful.

### Updated Regression Acceptance Criteria for Claim 54064

A repaired run must prove this trace:

1. Case extraction retains separate Thompson attribution, substantive data-handling, destroyed/ordered-destruction if present, inference, and Vaxxed/Tribeca claims.
2. Mapping produces nonblank actor, alleged action, study clues, and article excerpt.
3. Study identity resolves the actual 2004 *Pediatrics* study or remains explicitly unresolved — never a press release.
4. The archived CDC study page, original paper, or API-backed metadata survives into the candidate pool.
5. Thompson statement is retained as attribution evidence, not substantive proof.
6. Methodology/data analyses address the substantive target.
7. Generic vaccine/autism causal reviews are marked background/indirect unless they analyze the disputed study/data handling.
8. Copied press-release assertions are deduplicated.
9. At least one support, one refute, and one nuance link bear on the same substantive predicate when such evidence exists.
10. One canonical source is fetched/persisted once and reused across targets.

### Updated Working Diagnosis

The bearing system was not truly tested. Its prerequisites failed upstream: clean article extraction, argument mapping, target representation, study identity, candidate preservation, and snippet-bearing LLM all failed or degraded before the post-scrape bearing prompt had a fair chance.

The system did not simply fail to find good sources. It found some relevant objects, then misidentified, trimmed, misrouted, duplicated, or misclassified them.

---

## 17. Plain-English Diagnosis: Why It Sucks So Bad

The pipeline sucks right now because it is **too complex to fail safely**.

It has many individually plausible mechanisms, but they are wired so that an early weak representation poisons everything downstream:

1. **The article scrape was dirty.**  
   The extractor worked from full-page fallback text, not a clean article body.

2. **The claim layer flattened the argument.**  
   It kept a reduced Thompson claim but lost or failed to separate related claims like destruction, Vaxxed/Tribeca, censorship, and inference.

3. **The mapper timed out, then the system pretended the fallback was good enough.**  
   This is the deepest sin. Confidence-0 fallback targets should not drive expensive evidence retrieval for misconduct/study claims.

4. **The study resolver crowned a press release as the study.**  
   After that, every later step inherited a false object identity.

5. **Candidate selection happened before bearing.**  
   The system threw away search results by provider score and intent bucket before asking whether they actually bore on the claim.

6. **Origin protection protected query intent, not document identity.**  
   A result from an `original_study` query became protected even if it was a press release or advocacy mirror.

7. **The snippet-bearing LLM timed out and the system quietly degraded.**  
   It fell back to deterministic scoring without treating the run as degraded.

8. **Fair-share allocation treated every claim like it deserved equal source budget.**  
   The Thompson claim had a central study object; it should have received a claim-local priority lane.

9. **The same URL was fetched and persisted repeatedly for different targets.**  
   This created cost, duplicate assertions, and at least one concrete database error.

10. **The post-scrape LLM was asked to decide bearing without a good target.**  
    With no allegedAction, no study ID, and no clear predicate, it confused allegation repetition with proof and confused broad causal refutation with direct misconduct refutation.

11. **The final packet rewarded repetition.**  
    Multiple slots were consumed by the same press-release allegation and its mirror.

The short version:

> The pipeline is not dumb. It is worse: it is smart in too many places without enough invariants, so each smart stage can confidently amplify the previous stage's mistake.

The fix is not more AI. The fix is **fewer silent fallbacks, stronger object identity, later bearing-aware selection, and complete source-death accounting**.
---

## 18. Change Audit Since Failed Scrape Audit — 2026-07-04

**Purpose:** record what has reportedly changed since the failed Thompson/MMR scrape audit, distinguish confirmed audit findings from user/Claude/Codex implementation reports, and prevent later prompts from re-fixing the same symptom downstream.

**Baseline failed run:** Port Townsend FreePress / Thompson-MMR-CDC claim, `taskContentId 16833`, `claimId 54064`, targets `172` attribution, `173` substantive, `174` study_identity.

**Evidence basis for this section:**

| Source | What it contributes | Verification level |
|---|---|---|
| `scrape-pipeline-audit.md` | Initial Claude audit of scrape/evidence failure. | File audit ingested. |
| `evidence-pipeline-audit-content-16833.md` | Detailed Codex-style audit of failed scrape, steps 1-16, prompt ledger, recommendations. | File audit ingested. |
| `evidence-query-stance-analysis.md` | Separate analysis of query stance vs result stance, required-anchor contamination, and query-template defects. | File audit ingested. |
| `bearing-shadow-audit.md` | Separate audit of `shadow` naming, bearing-gating switch, and legacy path footgun. | File audit ingested. |
| Chat-pasted implementation summaries | User-reported Claude/Codex changes after the audit. | Not independently verified against local code unless explicitly marked by test summary. |

### 18.1 Important interpretation guard

Several failures in the old scrape were upstream, so downstream fixes must not claim to resurrect documents that never reached the downstream stage.

For the actual DeStefano 2004 / PubMed study:

- PubMed did not return the actual study in the failed run.
- The actual PMID/DOI was absent from the candidate log.
- The study resolver selected a GlobeNewswire-hosted press release instead.
- Therefore Step 19+ allocation/packet fixes could not have selected the actual PubMed study in that run because it was not in their input pool.

Downstream fixes should be framed as: **given a repaired upstream candidate pool, do not discard, duplicate, misclassify, or over-select the wrong material.**

### 18.2 Change-status matrix

| Audit failure / risk | Old failure mode | Reported change since audit | Status | What still needs proof |
|---|---|---|---|---|
| Mapping timeout / confidence-0 fallback targets | Giant argument-mapping prompt timed out twice; deterministic fallback produced blank subject/action/study fields and no inference target. | Replaced required giant mapper with local chunk extraction metadata, lightweight synthesis, deterministic target construction, small LLM repair only for complex claims, and fail-closed behavior for unresolved misconduct/study targets. | **Reported integrated.** | Fixture for claim `54064` must show attribution, study_identity, substantive conduct, and inference targets with nonblank actor/action/object/study clues and local excerpt. |
| Study identity resolver | Discovery found relevant objects, but resolver selected a GlobeNewswire press release as target `174` resolved study. | Resolver reportedly credibility-gated resolved work, prevented press/news/advocacy pages from becoming original study, corrected date/identifier scoring, preserved plausible runners-up with role labels. | **Reported integrated.** | Fixture must show DeStefano/CDC object resolves or remains unresolved; GlobeNewswire is never `original_study_candidate`. |
| Resolved-work anchor poisoning | False resolved work title became a required anchor and contaminated later query text. | Retrieval-context guard reportedly demotes unverified resolvedWork titles out of `requiredAnchors`; role-based candidates become optional/provenance rather than mandatory anchors. | **Reported integrated / verify.** | Query plan for `54064` must not contain `CDC Whistleblower to Extend MMR Vaccine Fraud` as a required anchor unless evaluating that press release itself. |
| Query generation stance quotas | Query generation used support/refute/nuance lanes, but labels are aspirational and search providers receive only strings. Refute lanes were malformed or claim-framed. | Query generation reportedly changed to purpose lanes rather than stance quotas; downstream stance classification remains content-vs-target based. | **Reported integrated.** | Query log should show purpose lanes, not support/refute/nuance quotas; no malformed `response William Thompson...` query. |
| Candidate survival before bearing | Results were URL-deduped, grouped by declared query intent, and cut by provider score before bearing. | Candidate survival patch reportedly uses deterministic-bearing pre-gate, richer canonical bearing text, verified-document reserved slots, explicit cap hierarchy, full provenance, fixed `droppedAtStage` enum, and captured fixture tests. | **Reported integrated / verify.** | `[CANDIDATE_DROP_AUDIT]` must show no verified/role-critical source dropped pre-bearing without reason. |
| Bearing-gating footgun / `shadow` confusion | `ENABLE_BEARING_GATING` false default could silently run legacy provider-score selection while modern bearing only logged. | User changed `.env` so gating is enabled. Shadow audit clarified that most `shadow` names are vestigial when gating is true. | **Operational env fixed; code-level footgun still pending.** | Code default should be hardened or fail loudly if gating false outside test/dev. Rename/removal can wait. |
| Snippet-bearing timeout / deterministic-only fallback | One LLM batch of 12 timed out; all 20 candidates fell back to deterministic scoring; quiet verified docs scored poorly, loud allegation pages scored higher. | Claude spec reportedly introduced per-target batches, bounded concurrency, split-and-retry on timeout, partial-result preservation, role-aware deterministic fallback, allegation-repetition cap, and verified-document floor. | **In progress / not confirmed by pasted completion report.** | Test must force LLM timeout and prove only failed sub-batch falls back; verified docs are not scored as none solely for quiet snippets. |
| Step 19 adaptive allocation | Adaptive loop allocated fairly by active claim; each got six attempts even though Thompson had central study/methodology needs. | Prompt issued for coverage-first allocation: prioritize uncovered evidence roles instead of flat round-robin. | **Prompted / implementation status not confirmed in this MCT.** | `[ADAPTIVE_ALLOCATION_AUDIT]` must show allocation by uncovered target coverage, not equal tranche. |
| Step 20 duplicate fetch/extraction | Same canonical URLs were fetched/persisted repeatedly across targets; PDF hit `ER_TOO_MANY_ROWS`. | Implemented `_acquireCanonicalSource(cand, claim, opt)` single-flight cache around `fetcher.getText`; `extractEvidence` now acquires canonical source once; target-specific evaluation still runs per assignment. Tests reportedly prove three concurrent same-URL assignments call `getText` once and reuse one cached object. | **Reported implemented with unit tests; no live DB rerun yet.** | Live run should show `[CANONICAL_SOURCE_ACQUISITION]` entries and no duplicate stub rows / no `ER_TOO_MANY_ROWS`. |
| Step 21 post-scrape target evaluation | Combined extraction/bearing/quality prompt treated repeated allegations as proof and broad no-MMR/autism material as direct refutation of specific manipulation allegation. | Prompt requested deterministic target-fit guard after existing LLM extraction and before persistence, with no new LLM calls. | **Implementation status unclear.** | Need Claude delta report: exact files/functions, compatibility labels, persistence guard, and tests. |
| Step 22 quote/assertion extraction boundary | Audit does not isolate standalone quote-extraction failure; it implicates combined extraction/evaluation path. | No separate code fix should be applied unless new audit isolates quote extraction itself. | **Skip as independent patch for now.** | If bad quote spans are found later, audit quote extraction separately. |
| Step 23 final packet construction/dedupe | Final packet selected repeated allegation material: multiple GlobeNewswire/Vaccine Impact items filled packet slots while study/methodology material absent. | Prompt requested deterministic packet assertion dedupe/coverage. Claude pushed back that this may already overlap with its own prior “Step 22” implementation. | **Needs reconciliation, not new implementation yet.** | Ask Claude for delta map: what previous implementation already covers vs what packet-selection logic remains. |
| Completion/accounting semantics | Audit showed rejected→persisted accounting contradiction and `countsReconcile: false`; “complete” meant loop ended/rows persisted, not valid evidence coverage. | Not fixed in current conversation. | **Open.** | Repair state names and completion criteria after evidence-link fixes. |
| SerpAPI 429 spam | SerpAPI returned 429 every time but was called repeatedly. | Not fixed in current conversation. | **Open, small operational fix.** | Provider should be disabled for remainder of run after deterministic quota/credential failure. |
| Duplicate publisher enrichment | Publisher enrichment ran asynchronously and sometimes twice, contributing to token count but not claim bearing. | Not fixed in current conversation. | **Open, cost hygiene.** | De-dupe and keep outside evidence-critical token accounting. |
| Article-level / thesis scoring | Bad packet would poison scoring, but audit did not isolate scoring algorithm failure. | No fix applied. | **Not audit-proven as independent failure.** | Do not patch until evidence packet is sane or a scoring-specific audit exists. |
| Review completeness logic | Audit shows completion semantics misleading; separate review-completeness scorer not isolated. | No fix applied. | **Partially implicated, not isolated.** | Treat as accounting/completion fix unless separate completeness module audit proves more. |

### 18.3 Current patch boundary discipline

Going forward, each fix should name exactly one audit-proven failure and one module contract.

**Allowed pattern:**

1. Identify old audit failure.
2. State whether upstream fixes may already remove the original cause.
3. Patch only this stage’s contract.
4. Add or update a fixture/log assertion.
5. Do not duplicate upstream fixes downstream.

**Disallowed pattern:**

- “Fix retrieval quality” as a broad prompt.
- Recompute source identity from query labels downstream.
- Globally demote press releases/news/advocacy sources.
- Add new LLM calls when deterministic guards can check target compatibility.
- Let implementation plans expand into 10+ phase refactors.

### 18.4 Current working sequence after change audit

The old scrape-audit failure sequence is now best understood as three bands:

#### Band A — Upstream object/target construction

Mostly addressed by reported fixes:

- local extraction + synthesis + deterministic target construction;
- study identity credibility gate and runner-up preservation;
- required-anchor hygiene;
- purpose-lane query generation.

#### Band B — Candidate/bearing/source acquisition

Partially addressed:

- candidate survival patch reportedly integrated;
- bearing-gating env fixed, code default still needs hardening;
- snippet-bearing robustness in progress/not confirmed;
- Step 19 allocation prompted/not confirmed;
- Step 20 single-flight canonical acquisition reported implemented.

#### Band C — Post-scrape assertion and packet semantics

Still needs reconciliation:

- Step 21 target-fit guard implementation status unclear;
- Step 23 packet dedupe/coverage may already be partially implemented under Claude’s own Step 22, but must be mapped;
- completion/accounting semantics open.

### 18.5 Immediate next action

Do **not** ask for a new broad implementation.

Ask Claude for a **change reconciliation report** against this matrix:

```text
Claude, do not implement anything yet.

Map all code changes made since the failed scrape audit against MCT section 18.2.

For each row, report:
- implemented / partially implemented / not implemented
- exact files and functions changed
- tests added or updated
- log tags added
- whether the change adds LLM calls
- whether it touches any out-of-scope pipeline stage
- remaining deltas, if any

Special focus:
1. Did your previous Step 21/22 work include final packet dedupe, or only post-scrape persistence gating?
2. Does any downstream fix duplicate an upstream fix instead of enforcing only its stage contract?
3. Which changes are proven by tests vs only by code inspection?

Do not refactor.
Do not add code.
This is a reconciliation report only.
```

### 18.6 Next scrape expectation

The next scrape should be judged by trace quality before headline score quality.

Minimum success criteria:

1. Target decomposition for `54064` is nonblank and typed.
2. Study identity resolves DeStefano/CDC or remains explicitly unresolved, never a press-release study.
3. Query plan has purpose lanes and no poisoned required anchors.
4. Candidate drop audit explains every pre-bearing drop.
5. Snippet-bearing either succeeds per target or degrades in isolated sub-batches.
6. Source acquisition fetches each canonical URL once.
7. Post-scrape assertions cannot satisfy incompatible targets.
8. Packet selection does not reward duplicate allegation clusters.
9. Completion status distinguishes “loop ended” from “valid evidence coverage met.”

**Realistic expectation:** the next scrape should be significantly more diagnosable and should avoid the exact Thompson failure cascade. It should not yet be treated as proof that article-level scoring is fixed.
