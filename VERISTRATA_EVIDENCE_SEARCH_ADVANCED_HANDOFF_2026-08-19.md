# VeriStrata Evidence Search Reset --- Chat Handoff

**Date:** 2026-08-19\
**Status:** Current implementation handoff\
**Immediate state:** Query-generation seam changed; next action is to
verify it live before switching Tavily retrieval to Advanced.

## 1. Goal

Simplify the current evidence-search path around what has worked well in
live testing:

``` text
case/article claim
→ model generates 2 high-precision queries
   - 1 support
   - 1 refute
→ Tavily Advanced only
→ use Tavily-returned text for bearing/source-claim extraction when sufficient
→ detect/resolve scholarly study information from Tavily results
→ PubMed search when warranted
→ scrape only as fallback when returned text is insufficient
→ generate/persist claim links
```

The broader direction is to remove unnecessary quotas and mandatory
acquisition work. Tavily Advanced has been substantially better than the
old Basic search in recent tests.

## 2. What testing established before implementation

### Tavily Advanced

Manual Advanced searches were strong, including on the William Thompson
/ CDC / MMR-autism allegation.

Advanced search surfaced:

-   the relevant 2004 DeStefano/Thompson study context;
-   useful supporting material;
-   refuting material;
-   a retracted study;
-   enough study-identifying detail to improve a subsequent PubMed
    query.

Important correction: with:

``` js
includeRawContent: false
```

the useful returned text is currently in Tavily's `snippet` / `content`
mapping, **not `rawContent`**. `rawContent` remains null unless
requested.

### Identity anchors

We discussed allowing the query-generation model to retain a named
person when the name materially identifies the dispute/evidence, while
avoiding names used merely to verify attribution.

Adversarial tests suggested irrelevant identity contamination may not be
as dangerous as feared. The intended prompt rule is therefore:

> A named person or source may be retained when that identity materially
> disambiguates the specific event, study, dispute, or evidence at
> issue. Do not include a person's identity merely to verify that the
> person made the claim.

The model is trusted to make that semantic decision rather than building
deterministic identity-anchor machinery.

### PubMed

A manual PubMed test showed:

``` text
William Thompson MMR autism
```

returned:

-   PMID 14761240 --- *MMR vaccine and autism: an update of the
    scientific evidence*
-   PMID 14754936 --- *Age at first measles-mumps-rubella vaccination in
    children with autism and school-matched control subjects: a
    population-based study in metropolitan Atlanta*
-   PMID 12904145 --- *MMR vaccination and autism: is there a link?*

A more allegation-heavy query:

``` text
William Thompson CDC MMR autism data manipulation
```

returned no PubMed results.

Conclusion: PubMed queries should ideally be derived **after Tavily has
exposed study identity/details**, rather than directly from allegation
language.

## 3. Planned architecture

The agreed sequence is:

``` text
claim
  ↓
model generates exactly 2 queries
  SUPPORT + REFUTE
  ↓
Tavily ADVANCED only
  ↓
deduplicated candidate results
  ├─ returned Tavily text sufficient
  │    ↓
  │  bearing/source-assertion extraction
  │    ↓
  │  reference_claim_links
  │  reference_task_claim_links
  │
  ├─ scholarly artifact/study identifiable
  │    ↓
  │  derive PubMed query from Tavily study details
  │    ↓
  │  PubMed primary-study candidate(s)
  │
  └─ returned text insufficient
       ↓
     existing/old-style scrape fallback
       ↓
     bearing/source-assertion extraction
```

Do **not** implement all of this at once. Existing project rule remains:
one seam at a time, stop and inspect.

## 4. Current evidence search configuration

Table:

``` text
evidence_search_config
```

Active search mode:

``` text
balanced_all_claims
```

The `mode_config` JSON was changed to:

``` json
{
  "balanced_all_claims": {
    "description": "For every claim: 1 support and 1 refute query",
    "targetNuance": 0,
    "targetRefute": 2,
    "nuanceQueries": 0,
    "refuteQueries": 1,
    "targetSupport": 2,
    "supportQueries": 1,
    "queriesPerClaim": 2,
    "enableBalancedSearch": true,
    "maxEvidenceCandidates": 6
  }
}
```

Important: `maxEvidenceCandidates`, `targetSupport`, and `targetRefute`
were intentionally left alone for now. They are downstream selection
settings, not query-generation counts.

### Config cleanup also performed

The existing JSON contained malformed keys with embedded spaces,
apparently old machine-generated corruption:

``` text
enableFring  eSearch
fringeConfidenceThreshol  d
maxFringeE  videnceCandidates
t  argetRefute
```

These existed **before** the current changes.

They were repaired to:

``` text
enableFringeSearch
fringeConfidenceThreshold
maxFringeEvidenceCandidates
targetRefute
```

Current full cleaned config includes:

``` json
{
  "fringe_on_support": {
    "description": "High-quality   sources + fringe sources when strong support   found",
    "fringeTrigger": "support",
    "queriesPerClaim": 4,
    "topKFringeQueries": 2,
    "enableFringeSearch": true,
    "topKFringeCandidates": 2,
    "maxEvidenceCandidates": 3,
    "fringeConfidenceThreshold": 0.7,
    "maxFringeEvidenceCandidates": 2
  },
  "high_quality_only": {
    "description": "Search   only high-quality sources (Tavily +   Bing)",
    "queriesPerClaim": 4,
    "enableFringeSearch": false,
    "maxEvidenceCandidates": 3
  },
  "balanced_all_claims": {
    "description": "For every claim: 1 support and 1 refute query",
    "targetNuance": 0,
    "targetRefute": 2,
    "nuanceQueries": 0,
    "refuteQueries": 1,
    "targetSupport": 2,
    "supportQueries": 1,
    "queriesPerClaim": 2,
    "enableBalancedSearch": true,
    "maxEvidenceCandidates": 6
  }
}
```

## 5. Query prompt changed

Prompt table:

``` text
llm_prompts
```

Active balanced user prompt:

``` text
prompt_id: 435
prompt_name: evidence_query_generation_user_balanced
prompt_type: user
is_active: 1
```

The prompt was updated to use `{{n}}`, rather than hardcoding 2, so
config remains the source of truth.

Current intended prompt:

``` text
CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} high-precision search queries for this exact claim:

1. SUPPORT — a query designed to retrieve evidence that would support or corroborate the substantive claim.
2. REFUTE — a query designed to retrieve evidence that would contradict, rebut, or provide an alternative explanation for the substantive claim.

QUERY DESIGN RULES:
- Preserve the exact proposition being tested. Do not broaden it into the surrounding topic.
- Keep the query tightly anchored to the specific event, study, dispute, institution, action, population, date, or other identifying details supplied in the claim or context.
- A named person or source may be retained when that identity materially disambiguates the specific event, study, dispute, or evidence at issue.
- Do not include a person's identity merely to verify that the person made the claim.
- For attribution wrappers, target the underlying substantive assertion unless attribution itself is independently material.
- For misconduct allegations, preserve the exact alleged action and object.
- Do not invent names, studies, dates, identifiers, or facts not present in the supplied claim or context.
- Do not generate a separate nuance query. Nuance will be determined from the retrieved evidence.

Return JSON only:
{"queries":[
  {"query":"...","intent":"support"},
  {"query":"...","intent":"refute"}
]}
```

The row's parameters were set to:

``` json
{"n":2}
```

However, runtime replacement is the important behavior: `n` is derived
from the active runtime/config and then replaces `{{n}}`.

## 6. `evidenceEngine.js` changes

File:

``` text
backend/src/core/evidenceEngine.js
```

### Prompt rendering

Current relevant code now resembles:

``` js
if (this.deps.promptManager) {
  try {
    const systemPrompt = await this.deps.promptManager.getPrompt(
      "evidence_query_generation_system",
      { system: fallbackSystem, user: "", parameters: {} },
    );

    const userPromptName = searchMode?.enableBalancedSearch
      ? "evidence_query_generation_user_balanced"
      : "evidence_query_generation_user";

    logger.log(
      `🎯 [EV][queries][${claim.id}] Loading prompt: ${userPromptName}`,
    );

    const userPrompt = await this.deps.promptManager.getPrompt(
      userPromptName,
      { system: "", user: fallbackUser, parameters: { n: n } },
    );

    system = systemPrompt.system;
    user = userPrompt.user
      .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
      .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
      .replace(/\{\{n\}\}/g, n);

    if (searchMode?.enableBalancedSearch) {
      user = user
        .replace(/\{\{supportQueries\}\}/g, searchMode.supportQueries ?? 3)
        .replace(/\{\{refuteQueries\}\}/g, searchMode.refuteQueries ?? 3)
        .replace(/\{\{nuanceQueries\}\}/g, searchMode.nuanceQueries ?? 3);
    }

    logger.log(
      `🧪 [EV][queries][${claim.id}] Rendered query prompt:\n${user}`,
    );
  } catch (err) {
    ...
  }
}
```

Important fix made:

``` js
searchMode.nuanceQueries ?? 3
```

instead of:

``` js
searchMode.nuanceQueries || 3
```

The same `??` treatment was applied to support/refute replacements.

Reason: configured `nuanceQueries = 0` must remain zero. `0 || 3`
incorrectly becomes 3.

### Schema hint

Immediately before the LLM generation call, the old schema hint was:

``` js
const schema =
  '{"queries":[{"query":"...","intent":"support|refute|nuance|background|factbox"}]}';
```

It was changed to:

``` js
const schema =
  '{"queries":[{"query":"...","intent":"support|refute"}]}';
```

This is a schema hint, not a hard semantic validator.

Existing output handling still does approximately:

``` js
const queriesArray = out && Array.isArray(out.queries) ? out.queries : [];

const qs = queriesArray.slice(0, n).map((q) => ({
  claimId: claim.id,
  query: q.query,
  intent: q.intent,
}));
```

No new semantic guard was added yet. First verify model behavior.

### Fallback prompt

The balanced fallback prompt in `generateQueries()` was also changed to
align with the DB prompt: exactly `{{n}}` high-precision queries, one
support and one refute, no separate nuance query, same identity-anchor
guidance.

This matters because if DB prompt loading fails, fallback must not
resurrect the old six-query support/refute/nuance architecture.

## 7. Current seam status

**Production code changed:** yes, prompt rendering/fallback/schema
hint/config behavior.\
**DB/config changed:** yes.\
**Tests changed:** no.

The next action is **NOT** to edit Tavily yet.

First run one normal evidence scrape and verify the query-generation
seam.

For each claim, logs should show:

``` text
BALANCED SEARCH MODE ACTIVE - Targeting 1 support, 1 refute, 0 nuance
```

The temporary rendered-prompt log should show:

``` text
TASK: Generate EXACTLY 2 high-precision search queries
```

The returned queries should be exactly:

``` text
1 support
1 refute
```

Inspect query quality too:

-   tightly anchored to the actual assertion;
-   no broad topic drift;
-   identity retained where it materially identifies the
    dispute/evidence;
-   identity omitted when it merely identifies the speaker;
-   no nuance query.

Do not judge search-result quality in this run because Tavily is still
on the existing retrieval mode.

## 8. Next seam after verification: Tavily Advanced

Once the two-query generation is confirmed live, change the existing web
retrieval call in `retrieveCandidates()`.

Current:

``` js
const web = await this.deps.search.web({
  query: q.query,
  topK,
  prefer: opt.preferDomains,
  avoid: opt.avoidDomains,
});
```

Next intended change:

``` js
const web = await this.deps.search.web({
  query: q.query,
  topK,
  prefer: opt.preferDomains,
  avoid: opt.avoidDomains,
  searchDepth: "advanced",
  includeRawContent: false,
});
```

The Tavily adapter already accepts:

``` js
searchDepth = null
```

and builds:

``` js
search_depth: searchDepth || (includeRawContent ? "advanced" : "basic")
```

So passing `searchDepth: "advanced"` should switch these two evidence
searches to Advanced without requesting full raw content.

**Stop and test after this seam.**

## 9. Subsequent planned seams, not yet implemented

After Advanced search is proven:

### A. Use Tavily returned text before scraping

Feed the Tavily Advanced result `snippet` into the existing
bearing/source-assertion extraction path first.

If sufficient, generate/persist:

``` text
reference_claim_links
reference_task_claim_links
```

without mandatory old-style scraping.

If returned text is insufficient, invoke the existing scraper as
fallback.

Do not call this `rawContent` unless `includeRawContent` is actually
enabled. With the planned Advanced call above, the relevant field
remains the mapped Tavily `snippet`.

### B. PubMed after Tavily

Rather than building PubMed queries directly from allegation-heavy claim
text, inspect Tavily results for study identity/details.

Useful fields may be inferred/extracted from result text:

``` text
title
authors
year
journal
topic
PMID / PubMed URL if directly returned
```

If Tavily directly returns a PubMed URL/PMID, use it rather than
redundantly searching PubMed.

Otherwise derive a concise scholarly query, e.g.:

``` text
DeStefano Thompson 2004 Pediatrics MMR autism
```

Then search PubMed.

### C. Avoid new quota machinery

Do not replace the old 6-query quota with a new pile of candidate
quotas.

The intended philosophy is:

``` text
2 strong Advanced searches
→ deduplicate
→ evidence determines what survives
→ PubMed conditional on scholarly signal
→ scrape conditional on insufficient returned text
```

Nuance should emerge from evidence adjudication, not from reserving a
dedicated nuance query.

## 10. Important project rules

For this implementation:

-   no interface changes without first reporting the existing contract;
-   no cleanup/refactor inside the integration seam;
-   tests should target semantics rather than incidental query
    counts/call positions;
-   state whether each change affects production code, test code, or
    both;
-   stop after each seam for review;
-   existing platform patterns govern unless concrete evidence shows
    they are broken.

The broader CFX architecture reset remains: simplify the existing
production route in place and avoid adding new durable orchestration
machinery.
