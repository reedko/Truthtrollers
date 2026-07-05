# Evidence pipeline audit: failed run 16833

Date: 2026-07-03  
Case URL: `https://www.porttownsendfreepress.com/2026/04/12/public-healths-truth-about-vaccines-part-1/`  
Run window: `07:42:43.455Z` through `07:58:01.102Z`  
Primary log: `backend/logs/evidence-2026-07-03.log`, lines 53–3493  
Thompson claim: content claim `54064`; evaluation targets `172`, `173`, `174`

## Executive finding

This run failed in the pipeline, not at one isolated model judgment.

The search layer found the relevant CDC study page and related Thompson material. The pipeline then:

1. lost the intended case-claim decomposition when the argument-mapping LLM timed out twice;
2. incorrectly resolved a GlobeNewswire press release as the exact study;
3. injected that false study identity into later queries;
4. trimmed the raw search results by provider score and intent bucket before bearing analysis;
5. treated nearly every result from a `primary_source` or `original_study` query as a protected origin, whether or not the returned document was actually a primary source;
6. received no Thompson snippet-bearing LLM result because that call timed out;
7. processed the surviving sources in a six-source fair-share tranche instead of ensuring that the best claim-object documents survived;
8. fetched and analyzed the same URL separately for multiple evaluation targets, including concurrent duplicate persistence attempts;
9. accepted repeated allegation text as substantive evidence and accepted generic “no MMR/autism link” text as direct refutation of a data-manipulation allegation;
10. persisted ten Thompson links, six of which were repeated supportive assertions from two copies of the same press release.

The result was expensive and epistemically worse: `234,889` OpenAI tokens, `77` search queries, up to `333` provider calls, `73` source fetch attempts, and a final Thompson packet centered on advocacy/press-release repetition instead of the identified 2004 study and analysis of its methods/data.

## Run totals

| Measure | Observed |
|---|---:|
| Wall time | 15m 18s |
| Case claims persisted | 11 |
| Search-gateway queries | 77 |
| Tavily calls/results | 77 / 728 |
| Brave calls/results | 77 / 720 |
| SerpAPI calls/results | 77 / 0; every call returned HTTP 429 |
| PubMed search calls/results | 51 / 102; 9 HTTP 429 failures |
| OpenAlex calls/results | 51 / 444; 3 HTTP 400 failures |
| Source fetch attempts | 73 |
| Unique global source attempts | 60, the configured ceiling |
| Sources delivering bearing assertions | 20, below the requested 24 |
| Combined evidence/quality LLM starts | 35 |
| Adaptive source failures | 21 |
| AI reference rows returned | 33 |
| OpenAI calls with reported usage | 67 |
| OpenAI input/output/total tokens | 204,062 / 30,827 / 234,889 |
| Pre-evidence tokens | 14,194 |
| Evidence-engine tokens | 220,695 |
| Post-evidence tokens | 0 |

The `33 AI refs` completion count is not evidence quality. It is the number of reference records returned after retrieval/persistence. The Thompson claim got ten claim-level links, but link count was inflated by repeated assertions from the same underlying press-release copy.

## End-to-end pipeline trace

### 1. User clicks Add in the extension

`scrapeContent()` receives the page URL, sets `force: true` and `defer_evaluation: true`, captures `document.documentElement.outerHTML`, and sends a `scrapeTaskOnServer` runtime message. The extension background forwards the payload to `POST /api/scrape-task`.

Runtime payload in this run:

```json
{
  "url": "https://www.porttownsendfreepress.com/2026/04/12/public-healths-truth-about-vaccines-part-1/",
  "force": true,
  "defer_evaluation": true,
  "raw_html_chars": 554378,
  "raw_text": false,
  "provided_authors": 0
}
```

Relevant code:

- `extension/src/services/scrapeContent.ts`, lines 45–98
- `extension/src/background.js`, lines 1217–1219
- `backend/src/routes/content/content.scrape.routes.js`, beginning at line 384

### 2. Backend validates OpenAI and parses the case page

The backend tested OpenAI connectivity, used the extension-provided DOM, and did not make an ordinary HTTP fetch for the case page.

Every configured article selector returned zero characters. The scraper therefore fell back to full-page text: `54,748` characters. The beginning of that text included the page title and site furniture. This means claim extraction was not operating on a clean article-body extraction. It may have included navigation, comments, related material, and other page text.

Metadata extraction succeeded:

- title: `Public Health’s “Truth” About Vaccines PART 1 | Port Townsend FreePress`
- author: `Ana Wolpin`
- publisher: `Port Townsend FreePress`
- DOM reference metadata: 19
- inline references in extracted text: 0

The backend created content `16833`, persisted author/publisher identity, returned an early `evaluationPending: true` response to the extension, and continued in the background.

### 3. Publisher enrichment runs asynchronously

Publisher enrichment called Wikipedia, Wikidata, and SCImago for the case publisher. AllSides and Ad Fontes were disabled. Wikipedia returned no matching publisher, Wikidata was unavailable, and SCImago was skipped. The final case-publisher crest was `CØ`.

The same enrichment machinery also ran repeatedly for reference publishers during evidence processing. Some Wikipedia profiles triggered a separate OpenAI source-profile/reliability prompt. This work overlapped with evidence retrieval and contributed latency/calls, but it did not repair evidence selection.

### 4. Case-claim extraction

The case extractor used:

- `claim_extraction_stack_system`
- `claim_extraction_stack_with_topics`
- mode: `edge`
- role: `case`
- input: the 54,748-character full-page fallback text

The first model attempt timed out at 30 seconds. A retry succeeded and persisted 11 claims. The run did not preserve a separate “scientists were ordered to destroy evidence” claim or the Vaxxed/Tribeca claim that had appeared in previous extraction discussions. It did retain a reduced Thompson object claim:

> data linking the MMR vaccine to autism had been manipulated by the CDC.

The persisted claim list was:

| Claim ID | Role | Claim | Final bearing links |
|---:|---|---|---:|
| 54060 | thesis | Public-health vaccine claims are false narratives lacking credible evidence | 0 |
| 54061 | pillar | Public-health authorities make safety/necessity claims | 10 |
| 54062 | pillar_support | Non-vaccinating parents are typically highly educated | 3 |
| 54063 | pillar_support | Playing outside challenges immunity more than vaccines | 6 |
| 54064 | evidence | MMR/autism data had been manipulated by CDC | 10 |
| 54065 | evidence | 1986 Act removed all drug-company liability | 2 |
| 54066 | evidence | Schedule increased from 5 to 73 doses | 7 |
| 54067 | evidence | 2011 vaccine-count/infant-mortality study | 0 |
| 54068 | evidence | Thimerosal deposits in brain and causes neuroinflammation | 3 |
| 54069 | evidence | CDC held secret meeting to hide thimerosal/autism findings | 6 |
| 54070 | background | Ad appeared amid declining vaccination rates | not searched |

The central thesis itself received zero evidence. Claim `54067` also received zero evidence after six processed sources.

### 5. Argument mapping and evaluation-target construction

The mapper sent the first 16,000 article characters, the extracted thesis, and all 11 claims to:

- `argument_mapping_system`
- `argument_mapping_user`
- temperature `0`
- timeout `45,000 ms`
- maximum attempts `2`

Both attempts timed out. The second failure occurred at `07:45:17.907Z`. The code then silently used deterministic fallback normalization.

This is the first decisive failure. The updated plan depends on the mapping LLM to produce atomic attribution, substantive, inference, and study-identity targets. For Thompson, fallback produced:

| Target | Type | Text | Missing information |
|---:|---|---|---|
| 172 | attribution | William Thompson revealed that data linking MMR to autism had been manipulated by CDC | predicate blank; excerpt blank; confidence 0 |
| 173 | substantive | data linking the MMR vaccine to autism had been manipulated by the CDC | subject blank; predicate blank; allegedAction blank; study fields blank; confidence 0 |
| 174 | study_identity | Resolve the exact study… | all identity fields initially blank; confidence 0 |

There was no inference target. The alleged action was not normalized as `altered`, `omitted`, `excluded`, `destroyed`, or another explicit conduct predicate. No study title, authors, year, identifier, population, subgroup, or article excerpt survived mapping.

The resulting evidence need warned `no_object_terms_detected`. Its only mandatory terms were `mmr` and `cdc`. This under-specified representation was then used for study resolution, query generation, snippet bearing, and post-scrape extraction.

### 6. Pre-query study-identity discovery

Before the normal Thompson query pack, the resolver ran two deterministic discovery queries:

1. `William Thompson 2016 2014 2004 mmr cdc data linking vaccine autism study`
2. `William Thompson mmr cdc data linking paper analysis`

Each query called Tavily, Brave, SerpAPI, PubMed, and OpenAlex.

The search layer found, among other results:

- the archived CDC page for the 2004 MMR/autism study;
- PubMed material;
- Thompson statement material;
- media analysis of the controversy.

The resolver nevertheless selected:

```text
CDC Whistleblower to Extend MMR Vaccine Fraud
GlobeNewswire
2016
score 0.55; anchor overlap 3
```

It rejected the archived CDC study page as runner-up even though that page had a larger anchor overlap of 5. It then wrote the GlobeNewswire title/year into target `174` as if it were the exact study.

This is the second decisive failure. A press release alleging fraud became the resolved research object. The real study page was found but was neither selected as the identity nor guaranteed a scrape slot.

### 7. Thompson query-generation LLM

The query-generation LLM received the reduced object claim, the fallback target structure, and the falsely resolved GlobeNewswire “study.” It produced candidates that were then completed/validated into this nine-query pack:

| # | Query | Lane | Intended stance |
|---:|---|---|---|
| 1 | `data linking the MMR vaccine to autism had been manipulated by the CDC.` | substantive 173 | context |
| 2 | `CDC Whistleblower to Extend MMR Vaccine Fraud 2016 data linking the MMR vaccine to autism had been manipulated by the CDC.` | study identity 174 | context |
| 3 | `William Thompson claims that the CDC manipulated data linking the MMR vaccine to autism.` | attribution 172 | support |
| 4 | `Investigate whether the CDC destroyed evidence related to the MMR vaccine and autism link as claimed by William Thompson.` | substantive 173 | context |
| 5 | `Review the CDC's response to allegations of data manipulation regarding the MMR vaccine and autism.` | substantive 173 | refute |
| 6 | `What evidence exists that contradicts William Thompson's claims about CDC data manipulation regarding the MMR vaccine and autism?` | substantive 173 | refute |
| 7 | `William Thompson mmr cdc data statement transcript` | attribution 172 | support |
| 8 | `response William Thompson mmr cdc data statement` | attribution 172 | refute |
| 9 | `William Thompson CDC Whistleblower to Extend MMR Vaccine Fraud 2016 mmr cdc data` | substantive 173 | support |

The bare `William Thompson` fallback query was rejected as too short and insufficiently disambiguated.

Queries 2 and 9 were directly contaminated by the false study identity. Query 4 introduced “destroyed evidence,” but that proposition was not preserved as its own case claim or evaluation target. It was merely retrieval language attached to the broader manipulation target.

### 8. APIs called for each Thompson query

The two discovery queries used a provider top-K of 5. The nine evidence queries used top-K 10. Provider outcomes:

| Query | Tavily | Brave | SerpAPI | PubMed | OpenAlex | Merged |
|---|---:|---:|---|---|---|---:|
| discovery 1 | 5 | 5 | 429 | 0 | 5 | 14 |
| discovery 2 | 5 | 5 | 429 | 0 | 5 | 14 |
| evidence 1 | 10 | 10 | 429 | 0 | 10 | 27 |
| evidence 2 | 10 | 10 | 429 | 429 | 2 | 21 |
| evidence 3 | 10 | 10 | 429 | 0 | 10 | 29 |
| evidence 4 | 10 | 10 | 429 | 0 | 10 | 25 |
| evidence 5 | 10 | 10 | 429 | 0 | 10 | 26 |
| evidence 6 | 10 | 10 | 429 | 0 | HTTP 400 | 15 |
| evidence 7 | 10 | 10 | 429 | 429 | 8 | 25 |
| evidence 8 | 10 | 10 | 429 | 0 | 10 | 28 |
| evidence 9 | 10 | 10 | 429 | 0 | 1 | 20 |

SerpAPI was called eleven times for Thompson and returned no result every time. Across the full run it was called 77 times and returned HTTP 429 every time.

Academic enrichment after web retrieval detected six Thompson academic works. Five came only from direct academic search and were irrelevant to this claim (parental vaccine refusal, rotavirus risk politics, DTP mortality, BRCA screening, and an unrelated polemic). The only web-identified PubMed item was PMID `14761240`, a general MMR/autism evidence update—not the exact Thompson/DeStefano study object. The academic path therefore added volume without resolving the study.

### 9. Candidate collapse happens before bearing

All query results were URL-deduplicated. When one URL appeared under multiple queries, the copy with the highest provider score became the main candidate. Its query intent/target metadata became primary; other occurrences were retained only as provenance.

Next, candidates were grouped by the generated query's declared intent and cut to fixed per-intent limits using search-provider score. This selection happens before the deterministic or LLM bearing score governs the pool. The Thompson pool was reduced to 20 candidates.

Therefore a document can be returned by search and still disappear before bearing if its provider score does not place it inside the intent bucket. The archived CDC study page was found during study discovery but did not appear in the final Thompson pool.

This is exactly the “good results are being thrown out” behavior observed in the UI.

### 10. Origin protection is over-broad

`isOriginCandidate()` returns true when a candidate merely inherited `evidenceTargetType === "primary_source"` or `"original_study"` from the query that produced it.

That field describes what the query wanted. It does not prove what the returned URL is.

Consequences:

- an ordinary news story returned for a primary-source query becomes a protected origin;
- an advocacy article returned for an original-study query can become a protected origin;
- origin status lets the candidate pass even below the bearing threshold;
- a bad query classification can override weak or zero bearing.

This is how the false GlobeNewswire identity and other secondary sources survived. The code's “origin” protection is currently query-intent protection, not document-identity protection.

### 11. Thompson snippet-bearing prompt fails

The snippet-bearing LLM received 12 of the 20 candidate records (the configured batch cap). Its single batch call timed out after 15 seconds with `This operation was aborted`.

All 20 candidates then fell back to deterministic scoring. Examples:

| Candidate | Deterministic score | Decision before protection |
|---|---:|---|
| GlobeNewswire fraud press release | 0.4488 | scrape |
| ABC News controversy story | 0.3031 | maybe |
| Vaccine Impact copy | 0.2924 | maybe |
| Thompson statement PDF | 0.2764 | maybe/below threshold |
| FactCheck 2025 vaccine-autism page | 0.2559 | maybe |
| PubMed 14761240 review | 0.1500 | maybe |
| archived/ordinary CDC autism page | 0 | skip |

The relevant Thompson statement PDF lost to the advocacy press release. The PubMed review did not get scraped. The actual CDC study page was not in the 20-candidate pool.

The log's `BEARING_GATING selectedCount: 0` is misleading in adaptive mode. The global allocator intentionally receives an empty first tranche for adaptive claims, but the separate adaptive loop still consumes `rankedCandidates`. Thus the log says zero selected while six sources are subsequently processed.

### 12. Adaptive scrape loop

The adaptive loop used:

- minimum bearing links per claim: 3
- desired unique delivered sources globally: 24
- maximum unique attempts globally: 60
- source ceiling per claim: 20
- 10 searchable claims in round-robin

The run exhausted all 60 global unique attempts and delivered only 20 bearing sources. Each active claim received exactly six unique source attempts. This is fair allocation, but it is not relevance-first allocation. A claim with a clearly identified central study did not receive priority over claims with weaker or broader needs.

For Thompson, the six attempted URLs were:

1. GlobeNewswire press release — fetched twice, targets 173 and 174
2. Vaccine Impact copy — fetched twice, targets 173 and 174
3. ABC News story — fetched three times, targets 172, 173, and 174
4. Vaccinate Your Family PDF — attempted three times, targets 172, 173, and 174; failed
5. Pharmacy Times page — target 173
6. FactCheck.org 2025 page — target 173

Only five unique documents reached the extraction LLM. Those five triggered nine combined extraction/quality LLM calls because the same cleaned document was analyzed again for each target assignment.

The Vaccinate Your Family PDF demonstrates a concrete concurrency bug. Three target-specific fetches/stub writes ran in parallel against the same URL/content row. The log records the same stub `16870` three times, followed by:

```text
ER_TOO_MANY_ROWS: Result consisted of more than one row
```

The source then failed as a whole. The current cache does not coalesce an in-flight canonical URL inside the adaptive `Promise.all(expandCandidateTargetAssignments(...))` path.

### 13. Post-scrape LLM extraction and bearing

Every successful candidate used one combined prompt that:

- extracts up to six quotes in adaptive mode;
- classifies support/refute/nuance/insufficient;
- scores post-scrape bearing;
- scores eight publisher/source-quality dimensions.

Although top-level run options specify two quotes per document, adaptive extraction overrides this to at least six. That increases output and permits one document to generate many links.

The target guard was weakened by the failed mapper:

- substantive target 173 had no `subjectEntity`;
- `allegedAction` was blank;
- there was no resolved study identifier;
- the deterministic guard could not require evidence about the correct actor, study, data handling, subgroup, or protocol.

The LLM consequently made two opposite errors:

1. It treated repeated allegations as proof of the substantive allegation. GlobeNewswire and Vaccine Impact say Thompson/others alleged manipulation; they are not independent analysis of whether manipulation occurred.
2. It treated “studies found no MMR/autism link” as direct refutation of whether CDC researchers manipulated a particular study's analysis. That proposition may bear on a broader vaccine/autism causal claim, but it does not by itself resolve the alleged data handling.

### 14. Thompson links actually persisted

Ten assertions were persisted for target 173:

| Source | Links | Stance | Audit assessment |
|---|---:|---|---|
| GlobeNewswire press release | 2 | support | repeats allegation; not independent substantive proof |
| Vaccine Impact copy of press release | 4 | support | syndication/repetition; substantially duplicates GlobeNewswire |
| ABC News | 1 | nuance | relevant: Thompson acknowledges omitted information; needs study-specific analysis |
| Pharmacy Times 2025 page | 1 | nuance | about a later CDC web-page change; weakly related to 2004 study handling |
| FactCheck.org 2025 page | 2 | refute | refutes broad MMR/autism link, not the specific manipulation allegation |

The bearing packet selected five items:

- two GlobeNewswire support items;
- one Vaccine Impact support item;
- one ABC nuance item;
- one FactCheck refute item.

Three of five packet positions therefore repeated the same supportive press-release allegation. The packet never included the archived CDC study page, the original 2004 paper, an API-backed abstract for that paper, or a methodology-focused analysis of the disputed subgroup/protocol.

### 15. Persistence and audit contradiction

Every Thompson handoff was logged as:

```text
status: rejected
reason: R8_source_target_completed
```

Each was then immediately persisted in `REPAIR_R1_ASSERTION_PERSISTENCE`. Final accounting says:

- bearing assertions extracted: 10
- assertions rejected at handoff: 10
- assertions persisted: 10
- claim-level links persisted: 10
- `countsReconcile: false`

This does not necessarily mean persistence lost the records; the records are present. It means the repair audit's state names and reconciliation arithmetic are internally contradictory and cannot currently be trusted as a success metric.

### 16. Completion and extension update

Legacy broad reference-claim extraction was disabled, so no second source-wide claim extraction/matcher ran. The target-linked assertions above were the final claim-level evidence path.

The backend marked evaluation complete, returned 19 DOM references and 33 AI references, and the extension's three-second status monitor subsequently refreshed the content state. “Complete” meant the loop ended and rows were persisted; it did not mean the source minimum was met or that each claim had valid evidence.

## LLM prompt ledger

This section records every logical prompt family used by this run and every Thompson-specific prompt instance. The log does not print complete assembled prompts or full source text, so exact dynamic article/source bodies cannot be recovered solely from the log. Static prompt bodies are identified at their source of truth; runtime substitutions are recorded below.

### Prompt A: case-claim extraction — one successful metered call, one timed-out attempt

Prompt records:

- `claim_extraction_stack_system`
- `claim_extraction_stack_with_topics`

Expected deployed template source: `backend/deploy/2026-06-24-03-update-case-stack-prompts-v2.sql`.
The runtime log records the DB prompt name but, because `PromptManager` does not
select/log the version column, it prints `(v?)` and does not prove the active DB
body byte-for-byte.

Runtime assembly:

```text
SYSTEM: active claim_extraction_stack_system text

USER:
You are a fact-checking assistant.

[no source-claim context because this is case extraction]
[active claim_extraction_stack_with_topics task text]
[testimonial instructions, if active]

TEXT:
[54,748 characters of full-page fallback text]
```

Temperature: `0.2`. The first attempt timed out; retry succeeded. This global call created the Thompson claim.

### Prompt B: argument mapping — two timed-out attempts

Prompt records:

- `argument_mapping_system`
- `argument_mapping_user`

Expected deployed versioned template source:
`backend/deploy/2026-07-01-02-version-argument-mapping-prompt-targets.sql`.
The same `(v?)` logging limitation applies.

Runtime substitutions:

```text
articleExcerpt = first 16,000 characters of the 54,748-character fallback text
articleThesis = "The claims made by public health authorities regarding vaccines are based on false narratives and lack credible evidence."
claimsJson = all 11 extracted claims, including claim 54064
temperature = 0
timeout = 45 seconds
max attempts = 2
```

No model response survived. Deterministic fallback created all evaluation targets.

### Prompt C: Thompson evidence-query generation — one call

Prompt records:

- `evidence_target_query_generation_system`
- `evidence_target_query_generation_user`

Expected deployed template source:
`backend/deploy/2026-06-30-02-update-evidence-target-query-prompts-v2.sql`.
The runtime log confirms the prompt names, not the DB version/body.

System instruction:

```text
You generate compact, evidence-targeted search queries for one atomic fact-checking claim. Return strict JSON only. Preserve named entities, dates, predicates, populations, scope, and causal strength. Every query must contain enough claim anchors to be intelligible by itself. Never output a one-word query, a generic topic query, or an authority-only query. Do not manufacture support/refute quotas.
```

Runtime user fields:

```text
CLAIM:
data linking the MMR vaccine to autism had been manipulated by the CDC.

BOUNDED CASE CONTEXT:
[retrieval context for targets 172/173/174]

EVIDENCE NEED:
claim type: attribution
speaker: William Thompson
subject terms: mmr, cdc, data, linking, vaccine, autism
relation terms: destroy/omit/exclude/manipulate/conceal variants
object terms: []
must include: mmr, cdc
warning: no_object_terms_detected
target 174 study title: CDC Whistleblower to Extend MMR Vaccine Fraud
target 174 study year: 2016

maximum generated/combined queries: 9
```

The final validated query output is the nine-query table in section 7.

### Prompt D: Thompson snippet-bearing batch — one failed call

Prompt records:

- `snippet_bearing_assessment_system`
- `snippet_bearing_assessment_user`

Expected deployed template source:
`backend/deploy/2026-06-29-01-seed-snippet-bearing-prompts.sql`. The runtime log
confirms the prompt names, not the DB version/body.

Runtime fields:

```text
CASE CLAIM:
{"claimId":54064,"claimText":"data linking the MMR vaccine to autism had been manipulated by the CDC.",...}

EVIDENCE NEED:
[the evidence-need object summarized in Prompt C]

SEARCH CANDIDATES:
12 bounded candidate records from the 20-candidate pool, each containing candidateKey, URL, title, snippet/bearing text, provider/rank, query, intent, and deterministic components
```

Temperature: `0`; timeout: 15 seconds; retries: 1. Result: aborted/timeout. No LLM bearing scores were produced.

### Prompt E: combined quote extraction, post-scrape bearing, and quality — nine Thompson calls

Static prompt source: `backend/src/utils/extractQuote.js`, `extractQuotesAndScoreQuality()`.

System prompt for all nine calls:

```text
You extract verbatim quotes from sources AND evaluate source quality in a single analysis. Return valid JSON only.
```

The user prompt always included:

- visible claim `data linking the MMR vaccine to autism had been manipulated by the CDC.`;
- one exact evaluation-target block;
- source title, URL, domain, unknown author/publisher placeholders, and citation count;
- first 8,000 cleaned source characters;
- stance rules;
- atomic-assertion/misconduct rules;
- post-scrape bearing fields and rules;
- eight source-quality dimensions;
- maximum six quotes in adaptive mode.

The nine instances were:

| # | URL | Target | Target-specific instruction |
|---:|---|---:|---|
| 1 | GlobeNewswire | 173 substantive | test whether the data manipulation occurred |
| 2 | GlobeNewswire | 174 study_identity | identify/characterize the exact study |
| 3 | Vaccine Impact | 174 study_identity | identify/characterize the exact study |
| 4 | Vaccine Impact | 173 substantive | test whether the data manipulation occurred |
| 5 | ABC News | 174 study_identity | identify/characterize the exact study |
| 6 | ABC News | 173 substantive | test whether the data manipulation occurred |
| 7 | ABC News | 172 attribution | test whether Thompson made the allegation |
| 8 | Pharmacy Times | 173 substantive | test whether the data manipulation occurred |
| 9 | FactCheck.org | 173 substantive | test whether the data manipulation occurred |

The Vaccinate Your Family PDF generated no extraction prompt because it failed during concurrent reference persistence/fetch handling.

### Prompt F: publisher Wikipedia profile/reliability extraction — asynchronous calls

Static prompt source: `backend/src/services/publisherEnrichmentService.js`, around lines 806–841.

This prompt extracts publisher identity/ownership/funding/credibility fields and assigns a `reliability_score` from Wikipedia page text. It ran for multiple reference publishers during this evidence run, sometimes twice for the same inferred publisher. It does not assess claim bearing. These calls overlap the request's OpenAI usage capture and help explain why the reported 67 calls exceed the visible claim/query/snippet/evidence-call count.

## Why the pipeline moved farther from the desired result

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
mapping timeout
→ under-specified target
→ press release mislabeled as study
→ contaminated queries
→ provider-score/intent truncation
→ query labels misused as document-origin proof
→ snippet LLM timeout
→ deterministic/protected ordering
→ six-source fair-share tranche
→ duplicate per-target scrapes
→ allegation repetition classified as evidence
→ generic no-link statements classified as direct refutation
→ ten links, mostly duplicates or predicate-mismatched
```

The bearing idea was not truly tested in this run. Its prerequisite representation failed, its LLM pre-scorer failed, its candidate pool was truncated before bearing, and its origin override was based on query labels rather than verified document identity.

## Recommended repair order

### P0 — stop producing misleading results

1. Fail the claim closed when argument mapping times out. Do not silently run study resolution and evidence retrieval on confidence-0 fallback targets for misconduct/study claims. Retry a smaller per-claim mapping prompt or mark the claim unresolved.
2. Require verified document identity before `protectedDocumentIdentity` or origin protection. A query's requested `evidenceTargetType` must never prove that the returned document has that type.
3. Make study resolution reject press releases, advocacy pages, and news coverage as the resolved `original_study`. Use title/authors/year/identifier/document-type constraints. If unresolved, keep multiple identity hypotheses rather than writing a false resolved identity.
4. Coalesce source fetch/persistence by canonical URL before expanding target assignments. Fetch and persist once; run target-specific extraction over the cached text. This removes duplicate writes, `ER_TOO_MANY_ROWS`, and repeated scraping.
5. Add a deterministic substantive-conduct guard: evidence must mention the identified study plus the alleged action/data handling. General “no causal link” text cannot directly refute manipulation/omission/destruction.

### P1 — stop discarding the wheat before bearing

6. Do not apply fixed provider-score intent cuts before the bearing rank. Preserve a bounded union per query/provider, then calculate identity and bearing, then select.
7. Put verified study objects and direct source documents into a claim-local priority lane that is independent of the global 60-source fair-share cursor. This is not a quota override for arbitrary citations; it is object-identity preservation.
8. When snippet-bearing LLM fails, do not treat query-type “origin” labels as a substitute. Use conservative deterministic rank plus verified identity only.
9. Preserve each URL's full target/query provenance during canonical merge and choose target assignments by target fit—not merely the occurrence with highest provider score.

### P2 — improve result diversity and cost

10. Deduplicate assertions across syndicated/copied text before packet construction. GlobeNewswire and Vaccine Impact should not occupy multiple packet slots with identical assertions.
11. Limit each document to one packet slot per stance/target unless distinct assertions materially differ.
12. Separate attribution, substantive conduct, inference, and study identity in the UI and quota accounting. Attribution links must not satisfy the substantive target.
13. Stop calling a provider for the remainder of a run after a deterministic credential/quota failure such as SerpAPI HTTP 429. This run made 77 known-failing SerpAPI calls.
14. Reduce duplicate publisher enrichment calls and keep them outside the evidence critical path and evidence token accounting.
15. Repair `REPAIR_R0` accounting so “rejected” followed by “persisted” is represented as a route transition, and `countsReconcile` becomes meaningful.

## Acceptance test for the Thompson claim

A repaired run should not be judged by total source or link count. It should prove this trace:

1. case extraction retains separate Thompson attribution, substantive data-handling, destroyed/ordered-destruction (if present in article), inference, and Vaxxed/Tribeca claims;
2. mapping produces nonblank actor, alleged action, study clues, and article excerpt;
3. study identity resolves the actual 2004 Pediatrics study or remains explicitly unresolved—never a press release;
4. the archived CDC study page/original paper/API metadata survives into the candidate pool;
5. the Thompson statement is retained as attribution evidence, not substantive proof;
6. methodology/data analyses address the substantive target;
7. generic vaccine/autism causal reviews are marked background/indirect unless they analyze the disputed study/data handling;
8. copied press-release assertions are deduplicated;
9. at least one support, one refute, and one nuance link bear on the same substantive predicate when such evidence exists;
10. one canonical source is fetched/persisted once and reused across targets.
