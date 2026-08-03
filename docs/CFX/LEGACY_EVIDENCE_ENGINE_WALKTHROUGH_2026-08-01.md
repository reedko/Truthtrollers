# Legacy evidence engine walkthrough

Date: 2026-08-01
Status: read-only code trace; synthesized from live source files, backend
logs, and prior audit docs. No scrape, retrieval, or model call was made to
produce this document.
Scope: the production pipeline as it existed going into the TM4/CFX rewrite
(TM4 work starts ~2026-07-12; this describes the shape of the code the
rewrite has been layered on top of, which in large part is still the live
code path today).

This is the reference walkthrough the user asked for: scrape → case-claim
extraction → evidence retrieval → claim matching → SourceCrest rating, with
file:line pointers and the actual number/shape of model calls at each step.
It draws on two prior R1 audits that already traced the scrape/identity
layer in detail (`CFX_PRODUCTION_SCRAPE_PROTOCOL_TRACE_R0_2026-07-31.md`,
`CFX_CONTENT_AND_EVIDENCE_SCRAPE_IDENTITY_TRACE_R1_2026-07-31.md`) and the
`sourcecrest_publisher_rating_summary.md` reference doc; this document adds
the case-claim extraction and claim-matching steps, and the LLM call
inventory, which those docs don't cover.

## Important: there are THREE separate "claim matching" mechanisms

The phrase "match the case claims with the source claims" maps to three
genuinely different subsystems in this codebase, and the one that actually
runs automatically at the end of every scrape (the one the user is asking
about) is the one this document originally omitted. Don't conflate them:

1. **Evidence engine assertion extraction** (automatic, runs during
   `runEvidenceEngine`) — for each case claim, the engine searches the web,
   scrapes candidate sources, and asks the model to pull a *quote* out of
   each scraped document and classify its stance/bearing toward that one
   case claim. This produces **document-level** links: task claim →
   reference *document* (`reference_claim_links`). The source document's own
   claims are not separately extracted or matched here.
2. **Automatic claim-to-claim matching** (`matchClaimsToTaskClaims`,
   `backend/src/core/matchClaims.js`) — **this is the mechanism that
   produces case-claim-to-source-claim links automatically, as the final
   step of a scrape, with no user action.** After a reference document's own
   claims are extracted (via `processTaskClaims` / `ClaimExtractor`
   running over the *reference's* text), this function is called once per
   reference document, listing every extracted source claim against every
   task claim in a single prompt, and gets back all matches (stance,
   veracity, confidence, support level) in one response. Results persist to
   `reference_claim_task_links` with `created_by_ai = 1`. This is what
   populates the case-claim ↔ source-claim "dotted lines," automatically,
   at the end of the scrape. See Step 3 below — this was the piece missing
   from the first pass of this document.
3. **Claim-to-claim relevance re-assessment** (`assessClaimRelevance`,
   manual / on-demand, used by the "Claim Duel" UI to reassess or
   experiment with a single pair) — compares exactly **one** already-
   extracted source claim to **one** task claim, one LLM call per button
   press, and either creates or overwrites a single `reference_claim_task_links`
   row. This is a secondary, manual tool layered on top of mechanism 2, not
   the thing that runs automatically.

Mechanisms 1 and 2 both fire automatically and both write links a human
never explicitly requested; mechanism 3 only fires on a user click. All
three can populate the "dotted lines" the dashboard draws between a task
claim and a reference, which is why they're easy to conflate.

## Step 0 — Case content scrape (getting the article/task text)

Two acquisition workflows exist; both are still what CFX has to sit on top
of (traced in detail in `CFX_CONTENT_AND_EVIDENCE_SCRAPE_IDENTITY_TRACE_R1_2026-07-31.md`):

- **Workflow A — case-content scrape.** Extension reads the already-open
  tab's DOM (`useTaskScraper` → `scrapeContent` → `POST /api/scrape-task`,
  `backend/src/routes/content/content.scrape.routes.js:496`). No queue, no
  `scrape_jobs` row. Persists via `createContentInternal` → publishing
  identity tables.
- **Workflow B2 — manual evidence-reference retry.** User-assisted retry
  through the `scrape_jobs` queue (`pending → claimed → completed/failed`),
  ending in `POST /api/scrape-reference` → `scrapeReference()`
  (`backend/src/core/scrapeReference.js:382`). This is the path the
  extension uses when a reference source needs a human to clear a
  paywall/CAPTCHA.

No model calls happen in acquisition itself. The extension does DOM/PDF
extraction; the backend does Readability/cheerio text cleaning. The first
LLM calls appear in the next step.

## Step 1 — Case-claim extraction (`ClaimExtractor`)

File: `backend/src/core/claimsEngine.js`, driven from
`backend/src/core/processTaskClaims.js:507-511`.

1. `chunkContentForClaimExtraction(text, maxCharsPerChunk = 6000)`
   (`processTaskClaims.js:25`) splits the scraped article into ~6,000-char
   chunks (≈1,500 tokens each). A typical ~3,000-word article yields **3
   chunks**.
2. `ClaimExtractor.analyzeContent()` (`claimsEngine.js:709`) fans those
   chunks out to `analyzeChunk()` (`claimsEngine.js:367`) with
   `maxConcurrency = 3` — **one LLM call per chunk**, run in parallel. The
   first chunk's call also asks for `generalTopic`/`specificTopics`/
   testimonials.
3. Once every chunk's claims are back, `synthesizeCaseClaims()`
   (`claimsEngine.js:123`) makes **one more LLM call** that takes the
   deduped, chunk-level claim records and produces the final reasoning
   stack: a thesis, pillars, supporting/evidence claims, and background
   claims, each tagged with a role (`thesis|pillar|evidence|
   opposing_claim|background`) and a `thesisLoadScore`.
4. `filterAndRankClaims()` (`claimsEngine.js:275`) then trims to
   `max_claims` (DB-configured) — this step is deterministic, no model call.

**Call count for case-claim extraction ≈ N chunks + 1 synthesis call.** For
a typical article that's 3-6 calls total, all `gpt-4o-mini` (the
`openAiLLM.generate()` default — see Model inventory below; no call site in
this pipeline overrides `model`).

This same `ClaimExtractor` is reused to extract claims *from a reference
document* when a source is scraped (so a reference gets its own `claims`
rows too) — that's what feeds the claim-to-claim matching described in
Step 3.

## Step 2 — Evidence retrieval per case claim (`EvidenceEngine`, via `runEvidenceEngine`)

Entry points: `POST /api/run-evidence`
(`backend/src/routes/evidence/evidence.routes.js:176`) or automatically
inside `/api/scrape-task`
(`backend/src/routes/content/content.scrape.routes.js:853`). Both call
`runEvidenceEngine()` (`backend/src/core/runEvidenceEngine.js:463`), which
constructs one `EvidenceEngine` (`backend/src/core/evidenceEngine.js:146`)
per run and loops the following over every selected evaluation claim
(background/non-evaluation claims are filtered out at
`runEvidenceEngine.js:515-536` and never reach retrieval):

1. **Query generation** — `EvidenceEngine.generateQueries()`
   (`evidenceEngine.js:335`, LLM call at line 472). **1 LLM call per claim**
   asking for up to `queriesPerClaim` (default 6) purpose-lane search
   queries (`attribution_record`, `study_identity`, `official_response`,
   etc.) rather than support/refute/nuance quotas — stance is classified
   later from retrieved content, not requested up front.
2. **Retrieval** — `retrieveCandidates()` (`evidenceEngine.js:634`) fans
   those queries out to internal + web + academic search providers in
   parallel. **No LLM calls.** Academic candidates (PMID/PMC/DOI) get
   enriched via `enrichAcademicCandidates()` — an API lookup, not a model
   call. Results are deduped by canonical URL and bounded by
   `boundCandidateUnion()`.
3. **Pre-scrape bearing (optional, gated)** —
   `assessSnippetBearingBatch()` (`backend/src/core/snippetBearing.js:814`).
   This is **batched, not per-candidate**: candidates are split into
   per-evaluation-target sub-batches (bounded by
   `maxCandidatesPerTargetBatch`), and each sub-batch is **one LLM call**
   scoring every candidate in it at once (schema returns an array of
   `{candidateKey, bearingPreScore, expectedStance, triageDecision, ...}`).
   A timed-out sub-batch is halved and retried once. So this step costs
   roughly **1-3 LLM calls per claim**, not one per candidate — this is a
   real cost optimization over naive per-URL scoring.
4. **Scrape + combined assertion extraction** — for each candidate the
   allocator selects to scrape, `extractEvidence()`
   (`evidenceEngine.js:894`) fetches the document (via
   `_acquireCanonicalSource`, deduped/cached per canonical URL so the same
   source is never fetched twice in one run even if multiple claims want
   it) and calls `extractQuotesAndScoreQuality()`
   (`backend/src/utils/extractQuote.js:202`, wrapped in
   `evidenceEngine.js:979`). This is explicitly **one combined LLM call per
   scraped source per claim** — the code comment at
   `evidenceEngine.js:963` notes this was collapsed from two calls
   (quote-extraction + quality-scoring) into one to save a call per source.
   The model both pulls a supporting/refuting quote *and* scores source
   quality (citation density, recency, etc.) in the same response.
5. **Adjudication** — `adjudicate()` (`evidenceEngine.js:1107`). Purely
   deterministic weighted-bucket arithmetic over the extracted evidence
   items (support/refute/nuance/insufficient). **No LLM call.**
6. **Red-team pass (optional)** — `redTeam()` (`evidenceEngine.js:1189`),
   only invoked when `opt.enableRedTeam` is set (`evidenceEngine.js:1987,
   2187`). **1 additional LLM call per claim** that re-examines the initial
   verdict adversarially and may revise it. Off by default in most runs
   traced in the logs.

### Rough call budget for a full run

For a claim set of size *C*, with an average of *S* sources actually
scraped per claim, and *R* distinct reference documents scraped in total
(R ≤ C×S, since the same document is fetched once and can serve multiple
claims — see `_acquireCanonicalSource` dedup in Step 2):

```
case extraction:        chunks(article) + 1
per claim:               1 (query gen) + 1-3 (bearing batch) + S (extract+quality)  [+ 1 if red-team enabled]
per reference document:  1 (source claim extraction, chunks(ref) + 1) + 1 (matchClaimsToTaskClaims)
run total:  chunks(article) + 1 + C * (2-4 + S) [+ C if red-team]
            + R * (chunks(ref) + 2)   <- Step 3 automatic claim-to-claim matching
```

A representative task (3-chunk article, 5 evaluation claims, 2 sources
scraped per claim → 10 reference documents, each ~2 chunks, no red-team)
lands around **4 (case extraction) + 5×(1 + 1 + 2) [=24, Steps 1-2] +
10×(2+1+1) [=40, Step 3 source extraction + matching] ≈ 64 LLM calls**.
Step 3 is not a minor add-on — extracting each reference's own claims and
then matching them is comparable in cost to the retrieval/adjudication
pipeline itself. This matches the shape visible in the backend logs (e.g.
`backend/logs/evidence-2026-06-16.log`, `evidence-2026-06-29.log` — pre-
TM4 dated runs) where each `[EV][queries]`, `[EV][fetch]`, and
`[EV][llm-evidence+quality]` block appears once per claim/candidate pair,
`assessSnippetBearingBatch` appears once or twice per claim, and
`[matchClaims] Matching N reference claims to M task claims` appears once
per reference document processed.

## Step 3 — Automatic claim-to-claim matching (the step that runs at the end of every scrape)

This is the mechanism that produces the automatic case-claim ↔ source-claim
links. It runs for **every** reference — both AI-discovered references from
the automatic evidence engine and manually re-scraped references — with no
user action required.

File: `backend/src/core/matchClaims.js`, function `matchClaimsToTaskClaims`.
Called from two places, both at the tail end of reference processing:

- **`POST /api/scrape-task`** (the automatic evidence-engine path) —
  inside `processReference()`, for each AI-discovered reference:
  1. `processTaskClaims()` (`content.scrape.routes.js:1001`) runs
     `ClaimExtractor` **over the reference document's own text**, exactly
     like Step 1 but with `claimType: "reference"`, extracting the source's
     own claims into `claims`/`content_claims`. This also passes the task
     claim texts as context so extraction is claim-aware.
  2. Immediately after, `matchClaimsToTaskClaims()` is called
     (`content.scrape.routes.js:1045`) with the *full* set of that
     reference's newly-extracted claims and the *full* set of the task's
     evaluation-eligible claims.
  3. Results are persisted via `upsertReferenceClaimTaskLinks()`
     (`content.scrape.routes.js:1055`) into `reference_claim_task_links`,
     `created_by_ai = 1`, then mirrored into the newer evaluation-target
     link tables via `dualWriteTargetEvidenceLinks()` (not another model
     call — a second write of the same result).
- **`POST /api/scrape-reference`** (the manual/retry path) — same shape:
  `processTaskClaims()` at `content.scrape.routes.js:1562` extracts the
  reference's own claims, then `matchClaimsToTaskClaims()` at
  `content.scrape.routes.js:1605` matches them against the task's claims
  and persists via `upsertReferenceClaimTaskLinks()` at line 1613. This
  runs whenever `taskContentId` and `claimIds` are present on the request —
  i.e. on every ordinary manual scrape from Workspace, not just
  paywall-clearing retries.

**The key cost property: this is one LLM call per reference document, not
one call per claim pair.** The prompt
(`matchClaims.js:200-225`) lists every extracted reference claim as
`[R1] ... [R2] ...` and every task claim as `[T1] ... [T2] ...` in a single
message, and asks the model to return a JSON array of
`{referenceClaimIndex, taskClaimIndex, stance, veracityScore, confidence,
supportLevel, rationale}` for every pair that meaningfully relates — the
model does the all-pairs comparison internally in one pass rather than the
caller looping N×M calls. So for a reference with 6 extracted claims and a
task with 5 evaluation claims, this is still **1 LLM call**, not 30.

The prompt (`matchClaims.js:14-19, 21-26`) carries the same stance
discipline as the manual tool below — stance is always relative to the task
claim, comparative direction must be preserved (A>B vs B>A flips
support/refute), and there's an explicit misconduct/attribution contract so
"data was omitted" doesn't get miscoded as supporting "evidence was
destroyed." When bearing-packet mode is enabled it also asks for a
predicate-level `evaluationTargetId`/`bearingScore`/`bearingType` per match,
gating out topic-only overlap.

## Step 3b — Manual claim-to-claim reassessment (`assessClaimRelevance`, on-demand only)

File: `backend/src/core/assessClaimRelevance.js`, wired into
`backend/src/routes/claims/referenceClaimTask.routes.js`.

This is a separate, simpler, **secondary** mechanism layered on top of Step
3 — it does not run automatically. It takes exactly two already-extracted
claim texts (one case claim, one reference-document claim — both already
exist because Step 3 already ran the extraction) and asks the model to
judge their relationship directly, one pair at a time.

- `POST /api/assess-claim-relevance`
  (`referenceClaimTask.routes.js:244`) — **1 LLM call per (referenceClaim,
  taskClaim) pair.** Checks for an existing `reference_claim_task_links` row
  first and skips the call if one exists. Filters out and discards
  low-confidence `insufficient` results rather than storing them.
- `POST /api/reassess-claim-relevance`
  (`referenceClaimTask.routes.js:425`) — deletes the prior row and reruns
  the same single-pair call, optionally with a custom system prompt (used
  for prompt experimentation from the dashboard).

This exists for cases where Step 3's batched all-pairs call missed a
relationship, or for prompt experimentation on one specific pair from the
"Claim Duel" UI — not for populating the graph in the first place. There is
no bulk/automatic invocation of this endpoint found in the traced routes.

## Step 4 — SourceCrest (Admiralty) publisher/content rating

Full behavioral reference: `docs/sourcecrest_publisher_rating_summary.md`
(2026-07-30). Summary of the model-call surface specifically:

- **`backend/services/admiraltyEvaluator.js`** — `evaluateAdmiraltyCode()`
  derives the letter/number/warnings/confidence. **Zero LLM calls.** It's a
  deterministic rules engine over already-collected signals:
  `publisher_ratings`, SCImago quartile, MBFC/Ad Fontes reliability,
  OpenSources flags, source-type base letters, and content-context
  adjustments (excerpt/repost/pointer/lineage-hop penalties).
- **`backend/src/services/publisherEnrichmentService.js`** — this is where
  the actual model calls live, and there are exactly **3 LLM extraction
  call sites**, one per provider whose data isn't available as a clean API:
  - AllSides bias rating extraction (line ~597) — searches for the
    publisher's AllSides profile page, feeds the snippets to the model, asks
    it to extract `rating_label`/`bias_score` *only if explicitly stated*.
  - Ad Fontes rating extraction (line ~701) — same pattern for Ad Fontes'
    numeric bias/reliability scores.
  - Wikipedia profile/credibility extraction (line ~809) — fetches the
    Wikipedia page text and asks the model to extract ownership/funding/
    affiliation facts plus a `reliability_score` (0-100) using an explicit
    rubric baked into the prompt (90+ = authoritative primary source, 70-89
    = generally reliable, ... 0-29 = unreliable).
  Each of these is **one call per publisher, only on first enrichment** —
  results persist to `publisher_ratings`/`publisher_profiles` and are
  reused afterward (`getCachedPublisherCrest()` in
  `runEvidenceEngine.js:128` explicitly skips re-enrichment when a cached,
  legitimate crest already exists). So SourceCrest costs **0-3 LLM calls
  per newly-seen publisher**, and 0 for any publisher already rated.
- All other providers feeding the evaluator — SCImago, MBFC, OpenSources,
  Crossref, OpenAlex, Wayback, RDAP, OpenCorporates, IRS TEOS, SEC EDGAR,
  GDELT — are deterministic API/HTTP lookups, not model calls.
- Enrichment is triggered from the evidence path at
  `runEvidenceEngine.js:222` (`enrichReferencePublisherAsync`), fired
  async/non-blocking after a reference is persisted, and skipped entirely
  if a legitimate cached crest already exists for that publisher.

## LLM call inventory (all steps, `gpt-4o-mini` unless noted)

| # | Step | File:function | Cardinality |
|---|---|---|---|
| 1 | Case-claim chunk extraction | `claimsEngine.js:367 analyzeChunk` | 1 per ~6,000-char chunk of the **task/case** document |
| 2 | Case-claim synthesis | `claimsEngine.js:123 synthesizeCaseClaims` | 1 per case document |
| 3 | Evidence query generation | `evidenceEngine.js:472` (`generateQueries`) | 1 per claim |
| 4 | Pre-scrape snippet bearing | `snippetBearing.js:796` (`callSnippetBearingSubBatch`) | 1 per sub-batch (~1-3 per claim), batched across candidates |
| 5 | Source quote extraction + quality | `extractQuote.js:202` (`extractQuotesAndScoreQuality`) | 1 per scraped source per claim |
| 6 | Red-team revision (optional) | `evidenceEngine.js:1189 redTeam` | 1 per claim, only if `enableRedTeam` |
| 7 | **Reference-claim chunk extraction** | `claimsEngine.js:367 analyzeChunk`, called via `processTaskClaims()` | 1 per ~6,000-char chunk of **each reference document**, automatic |
| 8 | **Reference-claim synthesis** | `claimsEngine.js:123 synthesizeCaseClaims` | 1 per reference document, automatic |
| 9 | **Automatic claim-to-claim matching** | `matchClaims.js:276` (`matchClaimsToTaskClaims`) | 1 per reference document — all extracted source claims × all task claims in one call, automatic, no user action |
| 10 | Manual claim-to-claim reassessment | `assessClaimRelevance.js:118` | 1 per (reference claim, task claim) pair, on demand only (Claim Duel) |
| 11 | AllSides rating extraction | `publisherEnrichmentService.js:~597` | 1 per publisher, first enrichment only |
| 12 | Ad Fontes rating extraction | `publisherEnrichmentService.js:~701` | 1 per publisher, first enrichment only |
| 13 | Wikipedia profile/credibility extraction | `publisherEnrichmentService.js:~809` | 1 per publisher, first enrichment only |

Rows 1-2 and 7-8 are literally the same `ClaimExtractor` methods — the only
difference is which document's text goes in and whether `claimType` is
`"case"` or `"reference"`. Row 9 is the automatic mechanism the earlier
version of this document missed; row 10 is the separate manual tool.

Everything else in the pipeline — retrieval, dedup, candidate survival
bounds, adjudication arithmetic, SourceCrest letter derivation, publishing
identity persistence — is deterministic code, not model calls.

## What TM4/CFX changed vs. what's still this pipeline

The current in-repo `evidenceEngine.js`/`runEvidenceEngine.js` are **not**
frozen pre-TM4 snapshots — they've been continuously modified in place
(purpose lanes, evaluation targets, bearing gating, candidate survival
bounds are all TM4-era additions layered into the same file). What this
document describes is the *behavioral shape* that is still substantially
live: chunk-based case extraction → per-claim query generation → batched
pre-scrape bearing → per-source combined extraction+quality call →
deterministic adjudication, plus the two independently-invokable systems
(claim-to-claim relevance, SourceCrest). The CFX docs already on file
(`CFX_PRODUCTION_SCRAPE_PROTOCOL_TRACE_R0_2026-07-31.md`,
`CFX_CONTENT_AND_EVIDENCE_SCRAPE_IDENTITY_TRACE_R1_2026-07-31.md`) confirm
the scrape/acquisition layer specifically is still this same production
code — EvidenceRun (CFX) is explicitly designed to be a *client* of it, not
a replacement, per those docs' stated conclusion.

For call-count ground truth beyond this trace, the backend log files under
`backend/logs/evidence-2026-06-*.log` and `evidence-2026-07-0*.log` (pre-
TM4-checkpoint, which starts ~2026-07-12) contain the actual `[EV][queries]`,
`[EV][fetch]`, `[EV][llm-evidence+quality]`, and `assessSnippetBearingBatch`
timing/log lines for real runs, one block per call, if you want to verify
the counts above against a specific task's real trace rather than the
formula.
