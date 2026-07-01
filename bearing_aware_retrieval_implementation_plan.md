# Bearing-Aware Retrieval Implementation Plan

## 1. Executive Summary

VeriStrata will add a bearing-aware funnel between web search and page scraping. For each case claim, the system will describe what evidence would actually test that claim, score the titles and snippets returned by Tavily/Bing, and scrape only a small, diverse set of candidates that appear likely to affect the claim's truth value.

The implementation introduces two focused modules:

- `evidenceNeed.js` builds a lightweight `EvidenceNeed` from the claim fields already available in `runEvidenceEngine()`. Its first version is deterministic and backward-compatible; later it will incorporate preserved `searchAssertions`.
- `snippetBearing.js` provides `scoreSnippetBearingDeterministic()` and, in a later phase, `assessSnippetBearingBatch()`. The deterministic scorer is cheap and always available. The LLM scorer compares all snippets for one claim in a single compact call and falls back safely to deterministic scores.

Tavily/Bing candidates will retain provider, rank, score, originating query, stance goal, and evidence target. They will be canonical-URL deduplicated before selection. Each candidate receives component scores for subject, relation, object/outcome, scope, attribution/causal alignment, and evidence-target fit. Authority or domain reputation will not be part of bearing.

Once gating is enabled, candidates will be selected by bearing first, with protected but bounded slots for a likely primary/origin source and a useful steelman candidate. The selector will not force a support/refute balance when one side has no credible bearing candidate. A global unique-URL budget will prevent eight claims from independently consuming the full per-claim allowance.

After scraping, `extractQuotesAndScoreQuality()` will return quote-level `bearing_score`, `bearing_type`, addressed claim component, causal strength, and a reason separately from source quality, stance, and confidence. Early phases will keep these values in memory and structured logs. Nullable persistence fields come only after the scores have been calibrated.

This reduces scrape volume without making the system feel rigged because:

- bearing ignores publisher prestige and political position;
- support and refute candidates are judged by the same exact-claim test;
- low-quality but directly bearing sources can still be retained and quality-labeled;
- origin and steelman exceptions protect against snippet false negatives and one-sided filtering;
- every skipped candidate is auditable, and “deepen” mode can use a larger budget later;
- gating follows shadow-mode comparison against the sources the current pipeline would have scraped.

The first implementation will compute and log deterministic snippet-bearing scores without changing candidate order, scrape count, persistence, adjudication, or UI output. It will also add backward-compatible provider/rank/query metadata needed for useful logs.

The first implementation will **not** add LLM triage, gate candidates, rewrite query prompts, change claim extraction, alter verdict weighting, add database columns, or change the UI.

## 2. Target Runtime Flow

```text
case content
  → extract and argument-map case claims
  → choose eligible claims within case budget
  → build EvidenceNeed for each claim
  → build assertion/deterministic queries; optionally expand with LLM
  → search Tavily/Bing
  → normalized candidates with title + snippet + provider/query provenance
  → canonical-URL deduplication
  → deterministic snippet bearing pre-score
  → optional one-call batched LLM snippet bearing score
  → select candidates by bearing + evidence-target coverage
      + protected origin slot
      + bounded steelman/fairness slot
      + per-claim and global unique-URL limits
  → scrape selected candidates
  → extract high-bearing passages/quotes
  → assign final quote/document bearing_score separately from source quality
  → match extracted reference claims to task claims
  → build 3–5-item Toulmin-ready evidence packet where evidence exists
  → persist/display links, scores, inclusion reasons, and provenance
```

The current flow diverges after search. `EvidenceEngine.retrieveCandidates()` tags search intent, deduplicates exact URL strings, buckets by intent, and returns candidates ordered by provider score. `EvidenceEngine.run()` immediately slices that list by `maxEvidenceCandidates` and calls `extractEvidence()`. `runEvidenceEngine()`'s fetcher then downloads and persists the page before `extractQuotesAndScoreQuality()` asks whether its text bears on the claim. The new pre-scrape stage belongs between candidate normalization/deduplication and that fetch slice.

One implementation caveat matters: `generateQueries()` usually receives nonempty deterministic `searchTargets`, so it bypasses the LLM query prompts. Phase 1 must score the candidates actually returned by this existing path rather than depending on a query rewrite that has not happened yet.

## 3. Files and Functions To Change

| File | Function | Current role | Proposed change | Phase | Risk |
|---|---|---|---|---:|---|
| `backend/src/core/evidenceNeed.js` (new) | `buildEvidenceNeedV1(claim)` | None | Build a deterministic, lightweight need from current mapped claim fields; later enrich it with search assertions and typed evidence targets. | 1, 5 | Medium: heuristic component extraction can be mistaken for semantic certainty; keep raw/effective text and diagnostics. |
| `backend/src/core/snippetBearing.js` (new) | `scoreSnippetBearingDeterministic(need, candidate)` | None | Return component scores, penalties, final 0–1 score, and shadow decision. | 1 | Medium: lexical false negatives; no gating in Phase 1. |
| `backend/src/core/snippetBearing.js` (new) | `assessSnippetBearingBatch({...})` | None | Load a versioned prompt, score all claim candidates in one LLM call, validate URL/index mapping, and fall back per item. | 3 | Medium/high: malformed output, overconfidence, token cost. |
| `backend/src/core/snippetBearing.js` (new) | `combineBearingPreScores()` | None | Combine LLM and deterministic scores and surface disagreement; never use source authority. | 3 | Medium: threshold calibration. |
| `backend/src/core/evidenceCandidateSelector.js` (new) | `selectCandidatesForScrape()` | None | Apply thresholds, protected slots, evidence-target diversity, canonical dedupe, and global/per-claim budgets. | 4 | High: directly affects retrieval recall. |
| `backend/src/core/evidencePacketBuilder.js` (new) | `buildEvidencePacket()` | None | Select a small post-scrape packet by final bearing, component/target coverage, stance, quality, diversity, and steelman slot. | 6 | High: affects adjudication inputs/UI explanation. |
| `backend/src/core/runEvidenceEngine.js` | `buildSearchTargets(claim)` | Builds up to three deterministic object/attribution/context targets, including narrow CDC/MMR branches. | Keep as fallback; attach `stanceGoal`, `evidenceTargetType`, and `bearingRequirement` in Phase 5. Eventually replace special cases with fixtures and general EvidenceNeed logic. | 5 | Medium: query changes alter recall. |
| `backend/src/core/runEvidenceEngine.js` | `runEvidenceEngine({...})` claim mapping | Reloads claim text, merges argument-mapping metadata, sorts claims, builds search targets, loads mode config. | Build and attach `evidenceNeed`; load normalized bearing config; later enforce eligible-claim/global budgets. | 1, 4, 5 | Medium/high once caps are active. |
| `backend/src/core/runEvidenceEngine.js` | `search.web` adapter wrapper | Chooses Tavily/Bing/hybrid and concatenates results. | Preserve provider metadata; do not alter result order in Phase 1. Later pass run/case budget context. | 1, 4 | Low in shadow mode. |
| `backend/src/core/runEvidenceEngine.js` | `fetcher.getText(cand, claim)` | Fetches, parses, creates/persists reference content, authors, publisher, and cache entries. | No Phase 1 behavior change. From Phase 4 it receives only selected candidates and records bearing provenance in memory. | 4 | High because a missing candidate is never persisted. |
| `backend/src/core/evidenceEngine.js` | `generateQueries()` | Uses direct search targets or DB prompts; outputs query and intent. | Preserve target metadata on query objects; Phase 5 route by evidence target and use LLM only for missing/expansion targets. | 1, 5 | Medium. |
| `backend/src/core/evidenceEngine.js` | `retrieveCandidates()` | Searches per query, tags intent, exact-URL dedupes, then intent-buckets by provider score. | Attach query/target/provider metadata; compute/log shadow scores after dedupe. Phase 4 delegate live selection instead of intent buckets alone. | 1, 3, 4 | Low in Phase 1; high when selection changes. |
| `backend/src/core/evidenceEngine.js` | `run()` | Immediately scrapes `candidates.slice(0, maxEvidenceCandidates)`. | Phase 1 leaves slice untouched. Phase 3 performs shadow LLM scoring. Phase 4 consumes `selectedCandidates` from selector and contributes to shared global budget. | 1, 3, 4 | High in Phase 4. |
| `backend/src/core/evidenceEngine.js` | `extractEvidence()` | Fetches candidate, extracts quotes/quality, maps output into evidence items. | Carry pre-bearing provenance; map final bearing fields from quote extraction; preserve old fields. | 2 | Low/medium if output remains additive. |
| `backend/src/core/evidenceEngine.js` | `adjudicate()` | Weights evidence by provider-derived quality and recency, then picks stance. | No change through Phase 5. Phase 6 exclude topic-only/insufficient items and use final bearing as eligibility/weight input. | 6 | High: verdict behavior. |
| `backend/src/core/tavilySearch.js` | `createTavilyAdapter().web()` | Maps Tavily results to common candidate fields. | Add `provider: "tavily"`, `providerRank: idx + 1`, `providerScore: r.score`; retain `source` and `score`. | 1 | Low, additive. |
| `backend/src/core/bingSearch.js` | `bingSearch()` | Maps Bing results; currently uses `item.rank || item._ranking || 0.8`, which may not be numeric rank. | Add stable index-based `providerRank`, preserve raw rank as metadata, add `provider: "bing"` and `providerScore`; retain current `score` behavior during Phase 1. | 1 | Low if ranking is unchanged. |
| `backend/src/utils/canonicalizeUrl.js` | `canonicalizeUrl()` | Existing shared URL canonicalizer. | Reuse for shadow duplicate grouping in Phase 1 and live dedupe in Phase 4; do not invent a second canonicalizer. | 1, 4 | Medium when live because distinct query variants may occasionally be meaningful. |
| `backend/src/utils/extractQuote.js` | `extractQuotesAndScoreQuality()` | One post-scrape LLM call extracts quotes/stance and scores source quality. | Add backward-compatible final bearing fields and stricter exact-claim/causal/attribution rules. Keep `qualityScores` separate. | 2 | Medium: prompt/schema change may alter quote selection. |
| `backend/src/core/matchClaims.js` | `matchClaimsToTaskClaims()` | Matches extracted reference claims to case claims and emits stance/veracity/confidence/support level. | Phase 6 add claim-level bearing/component coverage; reject topic-only and do not persist insufficient links. Ensure callers pass `PromptManager` before relying on DB prompt changes. | 6 | High: link graph changes. |
| `backend/src/core/claimsEngine.js` | `analyzeChunk()` / `flattenClaimEntries()` | Parses extraction output but drops search assertions and several properties. | Phase 5 preserve `searchAssertions`, `claimKind`, `evidenceType`, and fallibility-critical property for EvidenceNeed; do not rewrite all extraction prompts. | 5 | Medium: data-contract changes. |
| `backend/src/core/argumentMappingEngine.js` | `normalizeMappingItem()` / `mapArgumentFunctions()` | Produces and persists object claim, attribution, speaker, argument function, and score transform. | Feed these authoritative fields into EvidenceNeed. Later add no duplicate bearing logic here. | 1, 5 | Low if read-only use. |
| `backend/src/core/processTaskClaims.js` | `processTaskClaims()` return mapping | Returns persisted claim metadata but not the full extraction reasoning/search assertions. | Phase 5 return preserved assertion/property metadata alongside existing fields without breaking callers. | 5 | Medium. |
| `backend/src/routes/content/content.scrape.routes.js` | `/api/scrape-task` orchestration around `processTaskClaims()`, `mapArgumentFunctions()`, `runEvidenceEngine()` | Starts the principal case evidence run and later extracts/matches reference claims. | Pass run/case identifiers and optional deepen mode; later expose evidence packet/inclusion reasons. Do not change response in Phase 1. | 1, 4, 5, 6 | Medium. |
| `backend/src/storage/persistAIResults.js` | `persistAIResults()` | Creates document-level `reference_claim_links` from evidence references. | No Phase 1 change. V2 later persists final bearing fields after calibration. | 2/6 later | Medium: schema-dependent. |
| `backend/src/core/promptManager.js` | `getPrompt()` | Loads/caches active DB prompts but does not return name/version metadata. | Phase 3 load new snippet-bearing prompts. Add optional prompt metadata/telemetry without breaking current return shape. | 3 | Low/medium. |
| `backend/src/core/openAiLLM.js` | `generate()` | JSON-mode OpenAI caller with retry/timeout. | Reuse unchanged in Phase 3; set compact candidate payload, low temperature, explicit timeout, and one call per claim. | 3 | Low. |
| `backend/src/routes/evidence-config.routes.js` | config GET/PUT | Exposes search mode and mode config; PUT currently changes only selected mode. | Later expose validated bearing settings to admins if needed. No Phase 1 route change. | 4+ | Medium: config validation/security. |
| `backend/src/utils/logger.js` | `logger.log()` | Joins object arguments, which can produce `[object Object]` in file logs. | Do not broadly rewrite logger. Add `logBearingEvent()` that explicitly `JSON.stringify`s bounded structured records. | 1 | Low. |
| `backend/test/bearing/*.test.js` (new) | Node test suites | No established test runner exists; `npm test` currently intentionally fails. | Use built-in `node:test` and add a dedicated `test:bearing` script before considering a global test-script replacement. | 1–6 | Low. |

Dead-code note: `ClaimTriageEngine`, `ClaimEvaluationClassifier`, and `claim_retrieval_evidence` are not suitable insertion points for pre-scrape candidates because the automatic path does not call them and the table expects an extracted `source_claim_id`. They should not be pulled into Phases 1–4.

## 4. New Data Structures

These are JSDoc/JavaScript contracts in v1. Introducing TypeScript is outside this project change.

### 4.1 `EvidenceNeed`

```ts
type EvidenceNeed = {
  version: 1;
  claimId: number;
  claimText: string;
  effectiveClaimText: string;
  objectClaimText?: string;
  isAttribution?: boolean;
  speakerEntity?: string | null;
  argumentFunction?: string | null;
  scoreTransform?: "normal" | "invert" | "none" | "review" | null;
  claimRole?: string | null;
  priority?: number;
  verifiability?: number;
  centrality?: number;
  claimType:
    | "factual"
    | "causal"
    | "association"
    | "attribution"
    | "methodology"
    | "misconduct"
    | "statistical"
    | "interpretive"
    | "background"
    | "unknown";
  subjectTerms: string[];
  relationTerms: string[];
  objectTerms: string[];
  scopeTerms: string[];
  mustIncludeTerms: string[];
  evidenceTargets: EvidenceTarget[];
  derivation: {
    method: "deterministic_v1" | "search_assertion_v1";
    warnings: string[];
  };
};
```

`effectiveClaimText` is `objectClaimText || searchText || promptText || claimText`. For attribution claims it is the object proposition for truth-value evidence; a separate `source_attribution` target retains the speaker/origin question. `scoreTransform` affects later case-level interpretation, not snippet bearing.

### 4.2 `EvidenceTarget`

```ts
type EvidenceTarget = {
  id: string;
  stanceGoal:
    | "origin"
    | "support"
    | "refute"
    | "limitations"
    | "context"
    | "steelman"
    | "open";
  evidenceTargetType:
    | "primary_source"
    | "original_study"
    | "systematic_review"
    | "government_source"
    | "expert_critique"
    | "fact_check"
    | "dataset"
    | "opposing_argument"
    | "news_report"
    | "other";
  bearingRequirement:
    | "direct_truth_value"
    | "source_attribution"
    | "causal_mechanism"
    | "scope_context"
    | "warrant_test"
    | "steelman_path";
  queryHint?: string;
  mustIncludeTerms?: string[];
};
```

Each generated query should point to one target ID. A query's `stanceGoal` is a retrieval intention, never the candidate's observed stance.

### 4.3 `SearchCandidateWithBearing`

```ts
type SearchCandidateWithBearing = {
  id?: string;
  canonicalUrl?: string;
  url: string;
  title?: string;
  snippet?: string;
  domain?: string;
  publishedAt?: string | null;
  provider: "tavily" | "bing" | "duckduckgo" | "internal";
  providerRank?: number;
  providerScore?: number;
  score?: number; // legacy ranking field retained
  query: string;
  searchIntent?: string;
  matchedPart?: string;
  evidenceTargetId?: string;
  stanceGoal?: string;
  evidenceTargetType?: string;
  deterministicBearingScore?: number;
  deterministicBearingComponents?: {
    subject: number;
    relation: number;
    object: number;
    scope: number;
    mustInclude: number;
    attributionOrCausal: number;
    targetFit: number;
    topicOnlyPenalty: number;
    genericPagePenalty: number;
    noClaimPenalty: number;
  };
  llmBearingPreScore?: number;
  bearingPreScore?: number;
  scorerDisagreement?: number;
  expectedStance?: "support" | "refute" | "nuance" | "background" | "insufficient";
  bearingType?: "direct" | "indirect" | "context" | "origin" | "steelman" | "none";
  claimComponentAddressed?: "whole_claim" | "subject" | "relation" | "object" | "scope" | "attribution" | "warrant" | "none";
  triageDecision?: "scrape" | "maybe" | "skip";
  triageReason?: string;
  protectedSlot?: "origin" | "steelman" | null;
};
```

All additions are optional so current candidate consumers remain compatible. `score` remains unchanged until a later ranking migration.

### 4.4 Post-scrape evidence item

```ts
type EvidenceItemWithBearing = ExistingEvidenceItem & {
  bearingScore?: number;
  bearingType?: "direct" | "indirect" | "context" | "origin" | "steelman" | "none";
  bearingReason?: string;
  claimComponentAddressed?: "whole_claim" | "subject" | "relation" | "object" | "scope" | "attribution" | "warrant" | "none";
  causalStrength?: "causal" | "associative" | "correlational" | "mechanistic" | "not_applicable";
  bearingMethod?: "post_scrape_llm_v1";
};
```

## 5. Pre-Scrape Bearing Scoring

### 5.1 Deterministic scorer

Add:

```js
scoreSnippetBearingDeterministic(evidenceNeed, candidate)
```

Phase 1 term derivation must be explicitly heuristic. It should normalize Unicode/case, remove punctuation and a fixed stopword set, preserve numbers/dates/named phrases, and use modest stemming/variant expansion only where unambiguous. It should not call an LLM.

Initial component weights:

| Component | Weight | Notes |
|---|---:|---|
| Subject overlap | 0.20 | Entities/population/event the claim is about. |
| Relation/predicate overlap | 0.25 | Highest semantic gate; relation synonyms can be curated conservatively. |
| Object/outcome overlap | 0.25 | Highest semantic gate; outcome/measure/result. |
| Scope overlap | 0.08 | Population, date, location, dose, magnitude, comparison. Absence is neutral unless the snippet states conflicting scope. |
| Must-include terms | 0.08 | Exact or phrase matches from search assertion/target. |
| Attribution or causal alignment | 0.07 | Speaker/origin for attribution; causal/mechanistic language for causal claims. |
| Evidence-target fit | 0.07 | Study/dataset/review/transcript/fact-check indicators only when the target requests that form. |

Penalties:

- `topicOnlyPenalty`: up to 0.30 when subject overlaps but relation and object are both near zero.
- `genericPagePenalty`: up to 0.15 for category/home/tag/overview snippets with no aligned assertion.
- `noClaimPenalty`: up to 0.20 when title/snippet contains no substantive assertion, evidence artifact, quotation, or aligned outcome.
- explicit conflicting scope does not automatically mean low bearing; it can bear on generality. Mark it as scope-bearing rather than applying a blind mismatch penalty.

Evidence-artifact words are bonuses only after subject/object or must-include alignment. A title saying “New study” on the same broad topic does not earn high bearing by itself.

Pseudocode:

```js
function scoreSnippetBearingDeterministic(need, candidate) {
  const title = normalize(candidate.title);
  const snippet = normalize(candidate.snippet);
  const text = `${title} ${snippet}`.trim();

  if (!text) {
    return result(0, emptyComponents(), "skip", "No title or snippet");
  }

  const subject = overlap(need.subjectTerms, text, { phraseBonus: true });
  const relation = overlap(need.relationTerms, text, { semanticVariants: true });
  const object = overlap(need.objectTerms, text, { phraseBonus: true });
  const scope = scopeAlignment(need.scopeTerms, text);
  const mustInclude = overlap(need.mustIncludeTerms, text, { requireCoverage: true });
  const attributionOrCausal = typedAlignment(need, text);
  const targetFit = evidenceArtifactAlignment(need.evidenceTargets, text);

  const topicOnlyPenalty =
    subject >= 0.5 && relation < 0.2 && object < 0.2 ? 0.30 : 0;
  const genericPagePenalty = genericPageScore(candidate, text) * 0.15;
  const noClaimPenalty = substantiveAssertionScore(text) < 0.2 ? 0.20 : 0;

  const weighted =
    0.20 * subject +
    0.25 * relation +
    0.25 * object +
    0.08 * scope +
    0.08 * mustInclude +
    0.07 * attributionOrCausal +
    0.07 * targetFit;

  // Direct bearing normally needs the predicate or outcome, not topic alone.
  const directnessGate = Math.max(relation, object) < 0.20 ? 0.55 : 1;
  const score = clamp01(
    weighted * directnessGate
      - topicOnlyPenalty
      - genericPagePenalty
      - noClaimPenalty
  );

  return {
    score,
    components: { subject, relation, object, scope, mustInclude,
      attributionOrCausal, targetFit, topicOnlyPenalty,
      genericPagePenalty, noClaimPenalty },
    wouldScrape: score >= config.minBearingToScrape,
    reason: summarizeComponents(...)
  };
}
```

The output should include the components even if the score is zero. Phase 1 logs `wouldScrape` but does not use it.

### 5.2 Batched LLM snippet scorer

Add:

```js
assessSnippetBearingBatch({ claim, evidenceNeed, candidates, llm, promptManager })
```

Input is capped to the deduplicated candidate pool for one claim, normally no more than 12. Each candidate is assigned a stable `candidateKey` such as `c0`, `c1`; the model returns that key and URL. Mapping requires a valid known key, with URL used only as a consistency check. Unknown, missing, or duplicate keys fall back individually rather than failing the whole claim.

Payload fields per candidate: key, title, snippet capped to 600 characters, URL/domain, originating target/stance goal, provider rank, and deterministic component summary. Do not include domain authority scores or SourceCrest.

Output contract:

```json
{
  "results": [{
    "candidateKey": "c0",
    "url": "https://example.org/item",
    "bearingPreScore": 0.0,
    "expectedStance": "support|refute|nuance|background|insufficient",
    "bearingType": "direct|indirect|context|origin|steelman|none",
    "claimComponentAddressed": "whole_claim|subject|relation|object|scope|attribution|warrant|none",
    "triageDecision": "scrape|maybe|skip",
    "reason": "short exact-claim explanation"
  }]
}
```

Create versioned DB prompts `snippet_bearing_assessment_system` and `snippet_bearing_assessment_user` in Phase 3, with hardcoded fallbacks so deployment does not fail if prompt seeding lags. The prompt must state:

- same topic alone is not bearing;
- source authority/quality is not bearing, and a low-quality source can be high-bearing;
- high bearing requires likely evidence that supports, refutes, or materially qualifies the exact claim;
- association only partially bears on a causal claim unless explicit causal/mechanistic evidence appears;
- “X said Y” and “Y is true” are separate evidence needs;
- an article-level fact-check does not refute every embedded claim;
- vague snippets score conservatively; `maybe` is allowed for likely origin/primary/steelman candidates;
- expected stance is provisional and must not be inferred from query intent;
- output must be JSON and must include every candidate key exactly once.

Use temperature 0, one retry after schema repair if supported by current LLM utility, 15-second timeout, and deterministic fallback on any error. Shadow mode must never delay or cancel existing scraping after the timeout.

### 5.3 Scoring combination

Do not use a pure average as the selection rule. The deterministic scorer is explainable but lexically brittle; the LLM handles paraphrase but can be overconfident.

Recommended v1 combined score in Phase 3 shadow mode:

```js
const bearingPreScore = llmScore == null
  ? deterministicScore
  : clamp01(0.75 * llmScore + 0.25 * deterministicScore);

const scorerDisagreement = llmScore == null
  ? null
  : Math.abs(llmScore - deterministicScore);
```

Phase 4 decisions add guardrails:

- force-skip only when the combined score is below `0.15`, neither scorer is `>= 0.35`, and the candidate has no protected origin/steelman slot;
- disagreement `>= 0.40` produces `maybe`, not an automatic skip;
- scrape candidates at or above `0.35`, subject to budgets;
- protected candidates can enter at a lower score but consume their bounded slot;
- if the LLM fails, deterministic scoring can rank candidates, but the system uses more conservative skip behavior (`FORCE_SKIP_BELOW=0.10`) until calibration proves safe.

These values are starting calibration settings, not universal truth.

## 6. Candidate Selection and Scrape Quotas

### 6.1 Default normal-mode limits

```js
const MAX_CLAIMS_SEARCHED_PER_CONTENT = 8;
const GLOBAL_SCRAPE_LIMIT_PER_CONTENT = 16; // unique canonical URLs
const DEEPEN_GLOBAL_SCRAPE_LIMIT = 24;

const PER_CLAIM_LIMITS = {
  thesis: 4,
  pillar: 3,
  pillar_support: 3,
  evidence: 3,
  attribution: 2,
  background: 0,
  default: 3,
};

const MIN_BEARING_TO_SCRAPE = 0.35;
const FORCE_SKIP_BELOW_BEARING = 0.15;
const MAX_ORIGIN_SLOTS_PER_CLAIM = 1;
const MAX_STEELMAN_SLOTS_PER_CLAIM = 1;
```

The global limit is deliberately 16 rather than the example 24: eight active claims otherwise average three full scrapes apiece before deduplication, reproducing the current cost problem. `deepen` mode can raise it to 24 after the normal run. Background claims are retained in the data model but do not automatically trigger evidence runs; they can be searched when explicitly promoted or when the case is reused as a source.

### 6.2 Claim allocation

1. Exclude background and `scoreTransform: "none"` claims from automatic search unless explicitly selected.
2. Rank remaining claims by bounded composite priority: role, fallibility criticality when available, priority, verifiability, and centrality. No one property controls selection.
3. Select at most eight claims, preserving the thesis and distinct pillars where possible.
4. Give every selected claim one initial unique-URL scrape slot.
5. Allocate remaining global slots round-robin by best next candidate and claim priority, respecting per-claim maximums. This prevents the first/highest claim from exhausting the global pool.
6. If the same canonical URL bears on multiple claims, scrape it once and attach it to each claim without consuming another global unique-URL slot.

### 6.3 Per-claim candidate selection

For each claim:

1. Canonicalize and merge duplicate URLs. Preserve all query/provider provenance and keep the highest pre-score; do not discard alternative target hits.
2. Remove force-skips except protected candidates.
3. Reserve the best likely origin/primary candidate if the evidence need calls for one.
4. Select the highest-bearing direct candidate regardless of stance.
5. Add the highest-bearing candidate from a missing meaningful stance/target category if it meets the minimum.
6. Add a limitation/scope candidate only if it affects applicability, magnitude, population, date, causal warrant, or methodology—not generic context.
7. Add at most one steelman candidate when it is the strongest direct opposing path and does not displace the only higher-bearing direct item.
8. Fill any remaining per-claim capacity by bearing score, then target coverage, then provider score. Source quality is unavailable pre-scrape and is not a bearing tiebreaker.

No category is mandatory except one best available candidate. A support query returning low-bearing junk does not earn a slot.

### 6.4 Fallback behavior

- **All snippets low-bearing:** Scrape the single best `maybe` candidate only if it scores at least `0.15`, or a protected origin candidate. Mark the claim `unresolved_search_failed` if post-scrape bearing remains insufficient. Do not fill the quota with topic-only pages.
- **Only one side has bearing evidence:** Select that side. Do not manufacture balance. A steelman slot is used only for a candidate that directly tests the claim.
- **Likely primary/origin has a vague snippet:** Preserve one origin candidate if URL/title/query provenance supports primary status. It is visibly tagged as a protected exception.
- **Tavily/Bing duplicates:** Merge by `canonicalizeUrl()`, scrape once, keep all provider ranks/query targets in provenance, and use the maximum bearing score rather than summing duplicates.
- **Empty/vague snippet:** Deterministic score is low. It may be `maybe` only for protected origin/primary/steelman status; otherwise skip when gating is active.
- **Background/low-priority claim:** No automatic scrape for background. Low-priority eligible claims receive a single initial slot only if global budget remains.
- **Search or LLM failure:** Preserve current deterministic/provider-ranked behavior within the new hard caps; record fallback method.
- **Already cached URL:** Reuse the cached page for another claim and run claim-specific quote extraction; do not count another network scrape.

## 7. Post-Scrape Bearing

Extend each quote returned by `extractQuotesAndScoreQuality()`:

```json
{
  "quote": "...",
  "stance": "support|refute|nuance|insufficient",
  "summary": "...",
  "bearing_score": 0.0,
  "bearing_type": "direct|indirect|context|origin|steelman|none",
  "claim_component_addressed": "whole_claim|subject|relation|object|scope|attribution|warrant|none",
  "causal_strength": "causal|associative|correlational|mechanistic|not_applicable",
  "bearing_reason": "...",
  "location": {"page": null, "section": "..."}
}
```

Definitions:

- **Bearing** measures how strongly the passage affects the exact task claim's truth conditions.
- **Stance** is the direction of that effect: support, refute, material qualification, or insufficient.
- **Confidence** is certainty that the classification is correct. It must not increase bearing automatically.
- **Source quality** describes provenance, transparency, evidence practices, and risk. A high-bearing passage from a weak source remains high-bearing but receives low quality/weight.
- **Causal strength** prevents association from becoming full causal proof.

Document final bearing should be derived from its best claim-specific passage plus component coverage, not from provider score or the number of weak quotes. Suggested v1 diagnostic aggregation:

```js
documentBearingScore = max(quote.bearing_score);
```

Phase 2 logs this value and carries it in memory only. It does not change `adjudicate()`. After calibration, Phase 6 can require a minimum final bearing for verdict weight and use `bearing × sourceQuality × recency × evidenceStrength` rather than the current provider-score proxy. The exact adjudication formula is intentionally not approved in Phase 2.

The prompt rewrite must narrow existing unsafe rules: skepticism alone is not refutation; an article-level fact-check applies only to the tested subclaim; different location/population is scope evidence, not automatically refute; and `nuance` must materially affect scope, magnitude, mechanism, or warrant.

Backward compatibility: parsers default every new field to `null`/`insufficient` when missing, and the existing `quotes` and `qualityScores` fields remain unchanged.

## 8. Evidence Packet Selection

The Phase 6 packet is a claim-specific collection of three to five items where sufficient evidence exists. It is not required to contain five and must not be padded with background.

Desired slots:

- strongest directly bearing support;
- strongest directly bearing refute;
- best genuine limitation/nuance;
- primary/origin evidence when it tests attribution or provenance;
- optional steelman item.

Selection algorithm:

1. Reject `bearingType: "none"`, `stance: "insufficient"`, and final bearing below the calibrated packet threshold. Retain them in debug telemetry only.
2. Enforce claim-component and evidence-target coverage. A component-only passage is labeled partial and cannot become full support for a compound claim.
3. Select the highest-bearing item for each meaningful available stance/target slot. Missing sides stay missing.
4. Within a comparable bearing band (for example within 0.10), prefer stronger source quality/evidence strength.
5. Enforce canonical-domain/document diversity unless the same primary document supplies distinct indispensable passages.
6. Add one steelman item only if it directly bears and is the strongest reasonable opposing path.
7. Cap each document at two quotes and each claim packet at five items.

Toulmin-ready packet metadata should identify whether an item functions as data/ground, warrant test, backing, rebuttal/limitation, origin/attribution, or steelman. Phase 6 can initially infer this from `bearingRequirement`, `claimComponentAddressed`, and stance without asking a new LLM question.

Guardrails:

- Topic-only context never enters verdict weight.
- Broad fact-check results require exact component alignment.
- Association/correlation cannot occupy a full causal-support slot; it is partial/nuance unless the task claim itself is associative.
- Attribution packets separate proof that X said Y from evidence that Y is true.
- Reference extraction runs primarily on selected high-bearing passages plus bounded surrounding context, and extracts at most the configured small number of claims per source/claim.
- Canonical URL and content ID deduplication prevent reposts or one prolific document from crowding the packet.
- `scoreTransform` is applied only when translating object-claim evidence to the case/article evaluation, not while judging bearing.

## 9. Storage Strategy

### V1: In memory and structured logs

Phases 1–3 require no schema changes. Emit bounded JSON records with:

- run/task content ID and claim ID;
- evidence-need version/effective claim hash or bounded text;
- candidate URL/canonical URL, title/snippet, provider/rank/score, query/target;
- deterministic components/score and shadow decision;
- later LLM pre-score, combined score, disagreement, and post-scrape score;
- actual current scrape selection versus bearing `wouldScrape`;
- prompt/model/method version and elapsed time.

Use existing evidence log files but a stable event prefix such as `[BEARING_SHADOW]` followed by `JSON.stringify(record)`. Bound title/snippet/reason lengths to prevent log explosion.

### V2: Nullable fields on durable links

After Phase 3 calibration and before Phase 6 persistence, add nullable claim/document-link fields where the relationship already exists:

- `bearing_score`
- `bearing_type`
- `bearing_method`
- `evidence_target_type`

If product requirements need to show the pre-score on retained sources, add `bearing_pre_score`, `triage_decision`, and a bounded `triage_reason` to the most specific retained relationship table, not to `content` itself. `reference_claim_task_links` is the correct place for claim-to-claim final bearing. Document-level `reference_claim_links` may hold claim-to-document pre/final bearing if that link remains a UI/API concept.

### V3: Retrieval candidate telemetry table

Only add a dedicated candidate table if operators need durable audit/calibration data for skipped URLs. It should key by run, claim, canonical URL, and query/target provenance, and record pre-score, decision, selected/scraped status, final score where available, provider, rank, and scorer versions.

Do not overload `claim_retrieval_evidence` for pre-scrape candidates; its `source_claim_id` assumes the source has already been scraped and claim-extracted.

Recommended path: V1 through shadow and initial gating; V2 for product-visible retained evidence; V3 only when retention/privacy policy and calibration needs justify storing skipped search results.

## 10. Feature Flags and Configuration

Normalized config shape:

```js
{
  enableBearingShadow: true,
  enableSnippetBearingLlm: false,
  enableBearingGating: false,
  enableBearingPacket: false,
  minBearingToScrape: 0.35,
  forceSkipBelowBearing: 0.15,
  maxClaimsSearchedPerContent: 8,
  globalScrapeLimitPerContent: 16,
  deepenGlobalScrapeLimit: 24,
  maxSnippetCandidatesPerClaim: 12,
  maxOriginSlotsPerClaim: 1,
  maxSteelmanSlotsPerClaim: 1,
  bearingPromptVersion: 1,
  bearingConfigVersion: 1
}
```

Location and precedence:

1. **Code defaults:** Safe constants in a new `bearingConfig.js`; shadow on, LLM/gating/packet off. This prevents missing DB keys from enabling behavioral changes.
2. **`evidence_search_config`:** Add one JSON `bearing_config` key or a `bearing` subsection in `mode_config` after Phase 1. This is the operational source for thresholds and budgets. Parse and validate types/ranges in one function; never spread raw DB JSON into runtime options.
3. **Environment emergency overrides:** `ENABLE_BEARING_SHADOW`, `ENABLE_SNIPPET_BEARING_LLM`, `ENABLE_BEARING_GATING`, and `ENABLE_BEARING_PACKET` only. Environment flags can force a feature off immediately but should not contain routine numeric tuning.
4. **Request/deepen override:** A validated request flag can choose normal versus deepen budget; it cannot silently bypass absolute safety caps.

Phase 1 can use code defaults plus environment kill switch and does not require a config migration. Before Phase 4, add validated DB config and optionally expose it via the existing authenticated admin config route.

## 11. Implementation Phases

### Phase 1: Shadow deterministic bearing

**Objective**

Compute explainable deterministic bearing scores for the exact candidates currently returned by Tavily/Bing. Log what the scorer would select. Do not change retrieval behavior.

**Exact files/functions**

- New `backend/src/core/evidenceNeed.js`: `buildEvidenceNeedV1()`, normalization/claim-type helpers.
- New `backend/src/core/snippetBearing.js`: `scoreSnippetBearingDeterministic()`, `logBearingEvent()`.
- `backend/src/core/tavilySearch.js`: additive provider/rank/providerScore fields.
- `backend/src/core/bingSearch.js`: additive provider/rank/providerScore fields.
- `backend/src/core/evidenceEngine.js`: preserve originating `query`, target metadata, and call deterministic scorer after deduplication; return candidates in exactly the existing order.
- `backend/src/core/runEvidenceEngine.js`: build/attach minimal `evidenceNeed`; pass task content/run context; default shadow config.
- `backend/src/utils/canonicalizeUrl.js`: reuse for shadow canonical grouping only.
- New `backend/test/bearing/snippetBearingDeterministic.test.js` and fixtures.
- `backend/package.json`: add `test:bearing` only.

**New modules/functions**

- `buildEvidenceNeedV1(claim)`
- `scoreSnippetBearingDeterministic(evidenceNeed, candidate)`
- `logBearingEvent(event)`

**Prompt changes:** None.

**Schema changes:** None.

**Behavior change:** Candidate objects gain optional metadata and logs gain structured records. Search queries, dedupe choice, bucket order, slice, scrape count, persistence, and API response are unchanged. Even shadow canonical grouping must not replace current exact-URL dedupe yet.

**Test plan**

- Pure unit fixtures for topic-only, direct-bearing, high-authority low-bearing, low-authority high-bearing, attribution, causal/association, scope, generic category page, empty snippet, and evidence-target artifact.
- Regression test that adding shadow scoring does not mutate/reorder candidate input.
- Adapter tests showing stable provider rank and retained legacy `score`/`source`.
- Logging snapshot contains claim ID, URL, bounded snippet, score, every component, and `wouldScrape`.
- Run with shadow disabled to prove zero scorer calls/logs.

**Rollback**

Set `ENABLE_BEARING_SHADOW=false` or remove the additive scorer call. Legacy candidate fields remain present, so no data rollback is required.

**Acceptance criteria**

- Existing retrieval output is byte-equivalent after ignoring new optional object fields and log lines.
- Logs contain candidate URL, claim ID, title/snippet, deterministic score, component scores, method/config version, actual selected status, and `wouldScrape`.
- No database writes or LLM calls are added.
- Tests cover the five required core cases plus non-mutation/order.
- Search/scrape counts are identical with shadow on and off.

### Phase 2: Post-scrape final bearing

**Objective**

Add final quote/document bearing after scraping without changing adjudication.

**Exact files/functions**

- `backend/src/utils/extractQuote.js`: extend prompt/schema/parser in `extractQuotesAndScoreQuality()`.
- `backend/src/core/evidenceEngine.js`: map additive quote bearing fields in `extractEvidence()`; log document maximum in `run()`.
- `backend/src/core/runEvidenceEngine.js`: carry pre/post telemetry into returned in-memory references only if harmless.
- New `backend/test/bearing/postScrapeBearing.test.js`.

**New functions/modules**

- Small normalizers such as `normalizeBearingScore()`, `normalizeBearingType()`, `normalizeCausalStrength()`; preferably colocated initially to avoid premature abstraction.

**Prompt changes**

- Extend the existing hardcoded combined prompt with bearing output.
- Narrow skepticism/fact-check/location rules.
- Explicitly separate exact-claim bearing, stance, quality, causal strength, and attribution.
- Do not rewrite unrelated source-quality dimensions.

**Schema changes:** None; V1 logs/in-memory only.

**Behavior change:** Additive quote/evidence fields and logs only. Current stance/quality/adjudication fields remain authoritative.

**Test plan**

- Mock LLM responses with/without new fields.
- Backward compatibility when fields are absent or invalid.
- Required exact-claim fixtures, especially fact-check subclaim, misconduct, attribution, causal mismatch, and scope.
- Assert `qualityScores` calculation is unchanged.
- Assert `adjudicate()` receives the same legacy inputs/verdict when bearing fields vary.

**Rollback**

Feature flag selects the old prompt/schema; parser accepts both versions. No persisted data to reverse.

**Acceptance criteria**

- `extractQuotesAndScoreQuality()` returns backward-compatible output.
- Every valid quote can carry bearing fields, and document bearing is logged.
- Bearing is demonstrably separate from quality and stance.
- Existing consumers and verdicts do not break/change.

### Phase 3: Batched LLM snippet bearing in shadow mode

**Objective**

Score all returned snippets for one claim in one LLM call and measure pre-score against Phase 2 final bearing. Do not gate.

**Exact files/functions**

- `backend/src/core/snippetBearing.js`: `assessSnippetBearingBatch()`, result validator, `combineBearingPreScores()`.
- `backend/src/core/evidenceEngine.js`: call after dedupe/deterministic score and before existing selection; do not alter returned order.
- `backend/src/core/promptManager.js`: optional additive prompt metadata for logs.
- `backend/src/core/runEvidenceEngine.js`: pass LLM/prompt manager/config.
- Idempotent prompt seed for `snippet_bearing_assessment_system/user` under migrations/config deployment files; no table change.
- New `backend/test/bearing/snippetBearingBatch.test.js`.

**New functions/modules**

- `assessSnippetBearingBatch()`
- `validateSnippetBearingBatchResult()`
- `combineBearingPreScores()`

**Prompt changes:** Add only the two new versioned snippet-bearing prompts described in Section 5.2.

**Schema changes:** None.

**Behavior change:** One optional LLM call per searched claim plus structured calibration logs. Current candidate selection/scraping remains unchanged. Timeouts/errors immediately fall back and cannot fail the evidence run.

**Test plan**

- Stable key/URL mapping under reordered results.
- Missing, duplicate, unknown, and malformed candidate keys.
- Partial batch response falls back only missing items.
- Timeout/API failure uses deterministic scores.
- Prompt tests for topic-only, authority bias, attribution, causation, broad fact-check, origin, and steelman.
- Calibration log joins pre-score to final bearing by claim/canonical URL.
- Token/latency test enforces candidate/snippet caps.

**Rollback**

Set `ENABLE_SNIPPET_BEARING_LLM=false`; deterministic shadow remains. Prompt rows can remain inactive/unused.

**Acceptance criteria**

- Results map safely to every candidate key.
- Errors never alter or abort current retrieval.
- Logs contain deterministic, LLM, combined, disagreement, and post-scrape scores.
- Exactly one LLM call per claim batch, within configured size/timeout.

### Phase 4: Conservative gating

**Objective**

Skip only demonstrably low-bearing candidates, preserve protected exceptions, and enforce per-claim/global unique-URL limits.

**Exact files/functions**

- New `backend/src/core/evidenceCandidateSelector.js`: candidate merge/selection/allocation helpers.
- New `backend/src/core/bearingConfig.js`: defaults, DB/env parsing, validation.
- `backend/src/core/evidenceEngine.js`: replace scrape slice with selected candidates when flag enabled.
- `backend/src/core/runEvidenceEngine.js`: shared global URL budget/cache and claim allocation.
- `backend/src/routes/evidence-config.routes.js`: optional validated read/update support before production enablement.
- `backend/src/routes/content/content.scrape.routes.js`: pass normal/deepen run mode if exposed.
- New selection/budget/end-to-end replay tests.

**New functions/modules**

- `selectCandidatesForScrape()`
- `mergeCanonicalCandidates()`
- `createGlobalScrapeBudget()` / `reserveCandidate()`
- `loadBearingConfig()`

**Prompt changes:** None beyond Phase 3.

**Schema changes:** None required.

**Behavior change:** When `ENABLE_BEARING_GATING=true`, low-bearing candidates are skipped and hard budgets apply. Default remains false until fixture/replay approval.

**Test plan**

- All Section 6 fallbacks and protected slots.
- Canonical duplicates across providers/claims count once.
- Round-robin global allocation and no claim starvation.
- One-sided evidence does not force junk.
- All-low candidates retain at most the one conservative fallback.
- LLM failure path remains conservative.
- Replay labeled real runs and compare high-final-bearing recall, unique scrapes, latency, and cost.

**Rollback**

Set `ENABLE_BEARING_GATING=false`; code returns to current candidate selection immediately. No persisted skipped-candidate state is required.

**Acceptance criteria**

- Unique scrape count decreases materially against replay baseline.
- Labeled fixtures lose no high-bearing item.
- Every skip has score, components, decision reason, and method/version.
- Origin/primary and steelman exceptions are bounded and observable.
- Global/per-claim caps are enforced without duplicate URL charges.

### Phase 5: EvidenceNeed and query target routing

**Objective**

Build richer EvidenceNeeds from preserved extraction/argument data and generate evidence-target queries rather than perspective-only queries.

**Exact files/functions**

- `backend/src/core/claimsEngine.js`: retain search assertions/properties in `flattenClaimEntries()` and returned reasoning stack.
- `backend/src/core/processTaskClaims.js`: carry preserved fields back to orchestrator.
- `backend/src/core/argumentMappingEngine.js`: no semantic rewrite; expose authoritative mapped fields to builder.
- `backend/src/core/evidenceNeed.js`: enrich and validate search assertions after argument mapping.
- `backend/src/core/runEvidenceEngine.js`: construct targets and keep `buildSearchTargets()` fallback.
- `backend/src/core/evidenceEngine.js`: target-aware `generateQueries()` and candidate provenance.
- `evidence_query_generation_*` DB prompts: versioned target-based variants, not wholesale prompt replacement.

**New functions/modules**

- `buildEvidenceNeedsFromSearchAssertions()`
- `validateEvidenceNeed()`
- `buildEvidenceTargetQueries()`

**Prompt changes**

- Version query prompt output to include `evidenceTargetType`, `stanceGoal`, `bearingRequirement`, and target ID.
- Remove exact support/refute/nuance quotas; retain one bounded steelman request.
- Do not rewrite claim extraction unless observed parser data proves fields are absent/inadequate.

**Schema changes:** None required for runtime; persistence of search assertions is a separate later decision.

**Behavior change:** Assertion/deterministic evidence-target queries run first; LLM fills missing targets or deepen expansion. Current `buildSearchTargets()` remains fallback. Balanced mode cannot expand scrape caps.

**Test plan**

- Claim types: factual, causal, association, attribution, methodology, misconduct, statistical.
- Search assertion availability/missing/malformed fallback.
- Query objects include target metadata.
- Query count and global scrape limits remain enforced.
- A/B candidate precision/recall against Phase 1 current queries.

**Rollback**

Config selects legacy `buildSearchTargets()`/query prompts. Preserved extra claim fields are additive.

**Acceptance criteria**

- Every query has evidence target and stance goal provenance.
- Existing builder is a tested fallback.
- Search assertions improve labeled precision without unacceptable high-bearing recall loss.
- Balanced/deepen modes cannot bypass bearing or global caps.

### Phase 6: Bearing-aware evidence packet

**Objective**

Build a compact explainable packet by final bearing first, then coverage, stance, quality, diversity, and steelman fairness.

**Exact files/functions**

- New `backend/src/core/evidencePacketBuilder.js`.
- `backend/src/core/evidenceEngine.js`: produce packet alongside legacy adjudication initially; later use it for adjudication under flag.
- `backend/src/core/matchClaims.js`: add final claim-level bearing/component/causal outputs and topic-only rejection.
- `backend/src/routes/content/content.scrape.routes.js`: pass `PromptManager` consistently and return inclusion explanations where API contract allows.
- `backend/src/storage/persistAIResults.js`: persist V2 fields after migration approval.
- Relevant reference/evidence response serializers and UI consumers, identified by tracing `reference_claim_links` and `reference_claim_task_links` reads before implementation.

**New functions/modules**

- `buildEvidencePacket()`
- `classifyPacketRole()`
- `explainPacketSelection()`

**Prompt changes**

- Version claim-matching prompts for bearing/component/causal outputs.
- Ensure principal callers pass `PromptManager` before DB prompt activation.
- Narrow reference claim extraction to high-bearing passages; do not rewrite unrelated prompts.

**Schema changes**

- V2 nullable fields on the appropriate link tables, in a separately reviewed migration.

**Behavior change:** Behind `ENABLE_BEARING_PACKET`. Initially return/log packet beside legacy verdict; after comparison, exclude topic-only evidence from verdict weight and expose inclusion reasons.

**Test plan**

- Deterministic packet tests for every desired slot and missing-side behavior.
- Max two quotes/document and three-to-five items/claim where available.
- Source/document/domain dedupe.
- Compound, causal, attribution, misconduct, broad fact-check, and steelman fixtures.
- API backward compatibility and UI reason rendering.
- Shadow comparison of legacy versus packet adjudication before activation.

**Rollback**

Disable packet flag to use legacy evidence/adjudication. Nullable columns and additive API fields remain harmless.

**Acceptance criteria**

- Packet contains three to five high-bearing items when available and is not padded.
- Topic-only material receives no verdict weight.
- Every inclusion has an exact-claim reason, packet role, stance, bearing, and quality label.
- Existing clients tolerate additive fields.
- Legacy adjudication remains selectable until product sign-off.

## 12. Tests and Fixtures

Use `node:test` with pure JSON fixtures wherever possible. LLM tests should mock `llm.generate()`; provider adapter tests should mock `fetch`. Maintain labeled expected ranges rather than brittle exact floating-point scores except for normalization helpers.

1. **Topic-only candidate**
   - Claim: a particular exposure increases a specified outcome in adolescents.
   - Candidate: broad page about the exposure, with a different predicate/outcome.
   - Expected: subject high; relation/object low; bearing `< 0.15`; topic-only penalty present.

2. **Direct-bearing candidate**
   - Same subject, relation/comparison, outcome, and population.
   - Expected: bearing `>= 0.65`, direct, whole/relation/object addressed.

3. **High-authority low-bearing**
   - `.gov`, `.edu`, or journal page about the field but not the assertion.
   - Expected: low bearing regardless of domain; later high quality can coexist.

4. **Low-authority high-bearing**
   - Skeptical/opposing page directly quotes aligned primary data.
   - Expected: high bearing; later low source quality; retained but labeled.

5. **Association versus causation**
   - Claim says causes; snippet/source says associated.
   - Expected: partial/nuance, causal strength associative/correlational, not full support.

6. **Attribution**
   - Claim says “X said Y.” One source verifies the speech/transcript; another studies Y.
   - Expected: first fills source-attribution need, second bears on object truth; neither silently substitutes for the other.

7. **Article-level fact-check**
   - Fact-check refutes a broad article thesis but snippet does not address embedded subclaim.
   - Expected: low bearing for that subclaim.

8. **Pseudoscience with valid subclaim**
   - Low-quality article contains one independently valid atomic scientific assertion.
   - Expected: assertion remains eligible; directly bearing scientific evidence can support it independent of article quality.

9. **Empty/vague snippet**
   - Empty title/snippet: zero/skip unless protected. Vague title from likely primary DOI/transcript: low score but protected `maybe` origin.

10. **Steelman**
    - Low-quality source offers the strongest direct opposing warrant.
    - Expected: retained only in one steelman slot, bearing and quality kept separate.

Additional engineering fixtures:

- canonical duplicate with UTM/tracking variants across Tavily/Bing;
- same URL returned by multiple queries/targets;
- inverse comparison;
- misconduct omission versus destruction/cover-up;
- population/date/dose scope mismatch;
- compound claim with evidence for only one component;
- malformed LLM batch and duplicate keys;
- global allocation across eight claims;
- cached URL reused across claims;
- feature flags off produce current ordering/scrape counts;
- reference extraction cap prevents one document from flooding the packet.

Required evaluation metrics on replay data:

- high-final-bearing recall among candidates current pipeline scraped;
- pre-score precision/recall by threshold;
- unique network scrapes per case and per claim;
- final packet items and reference claims per case;
- provider/query/stance/target distribution;
- pre/post scorer calibration and disagreement;
- added LLM calls, tokens, latency, and failure rate;
- percent of topic-only/context items entering verdict weight;
- percentage of protected slots that later prove low-bearing.

## 13. Risks and Guardrails

| Risk | Guardrail |
|---|---|
| False negatives from lexical snippets | Shadow before gating; batched semantic scorer; disagreement becomes `maybe`; protected origin; one best-candidate fallback; deepen mode. |
| Misleading search snippets | Treat pre-score as provisional; final bearing comes from full text; calibrate pre/post; do not persist pre-score as truth. |
| Provider truncation or empty snippets | Cap but do not over-trim; low confidence/`maybe`; preserve likely primary/origin candidate; provider-specific fixtures. |
| LLM overconfidence | Deterministic corroboration, disagreement telemetry, low temperature, strict schema, no authority fields, final post-scrape correction. |
| False balance | No mandatory support/refute quotas; missing sides stay missing; only one bounded, directly bearing steelman slot. |
| Authority bias | Domain reputation and SourceCrest excluded from bearing inputs; source quality applied only after bearing eligibility. |
| Conspiracy-user trust problem (“system hid our evidence”) | Symmetric exact-claim rubric, auditable skip reasons, low-quality/high-bearing retention, steelman slot, feature flag, deepen/review path, no publisher blacklist in bearing. |
| Cost creep from LLM triage | One compact batch per claim, max 12 candidates, timeout/fallback, max eight claims, feature flag, token/latency telemetry. |
| Duplicate-source pollution | Shared canonicalizer, URL merge across providers/queries/claims, global unique-URL accounting, document/domain caps in packet. |
| Schema churn | V1 logs/in-memory, V2 only after calibration, dedicated V3 table only if durable skipped-candidate audits are justified. |
| Query intent mistaken for stance | Store `stanceGoal` as provenance; LLM/post-scrape classifier independently determines `expectedStance`/stance. |
| Background claims spawning runs | Default background quota zero; only explicit promotion/reuse/deepen can search them. |
| A high-bearing low-quality source drives verdict | Bearing admits it to the packet; source quality/evidence strength reduces its adjudication weight and remains visible. |
| Global cap starves later claims | One-slot initial allocation and round-robin remaining budget; selected claim priority is bounded. |
| Logger exposes/explodes snippet data | Bounded title/snippet/reason, stable structured event, retention review before V3 persistence. |

## 14. Final “Go Ahead” Checklist

### Before approving Phase 1

- [ ] Phase 1 changes retrieval behavior: **No.**
- [ ] Phase 1 changes query text/order, candidate order, scrape count, persistence, adjudication, or API output: **No.**
- [ ] Phase 1 adds any LLM call: **No.**
- [ ] Phase 1 requires a migration: **No.**
- [ ] New provider/rank/query fields are additive and legacy `score`/`source` remain unchanged.
- [ ] Deterministic score components are explicit and source authority is excluded.
- [ ] Every shadow record includes claim, candidate, component scores, final score, method/config version, actual selection, and `wouldScrape`.
- [ ] Empty/vague snippets fail conservatively.
- [ ] Feature flag can disable all shadow work.
- [ ] Tests prove the scorer does not mutate/reorder candidates.
- [ ] Topic-only, direct-bearing, attribution, causal/association, and empty-snippet tests exist.
- [ ] `node:test`/`test:bearing` does not pretend the repository's nonexistent general suite already passes.

### Before approving later behavioral phases

- [ ] Bearing, source quality, stance, confidence, evidence strength, and query intent remain separate fields.
- [ ] Phase 2 output is backward-compatible and does not alter adjudication.
- [ ] Phase 3 has safe batch mapping and deterministic fallback.
- [ ] Phase 4 thresholds are supported by replay calibration, not intuition alone.
- [ ] Gating can be disabled instantly.
- [ ] Origin and steelman exceptions are bounded and auditable.
- [ ] Global budget counts canonical unique URLs and uses round-robin allocation.
- [ ] Background claims do not automatically spawn evidence runs.
- [ ] One-sided high-bearing evidence is not padded into false balance.
- [ ] Phase 6 packet is explainable and is shadow-compared before changing verdicts.
- [ ] Any V2 migration is reviewed separately.
- [ ] Phase 1 can be approved now without approving Phases 2–6.

**Recommended next instruction:** `Implement Phase 1 from bearing_aware_retrieval_implementation_plan.md. Do not implement later phases.`
