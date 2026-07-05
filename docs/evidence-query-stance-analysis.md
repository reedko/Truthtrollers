# Evidence Query Generation vs. Result Stance — Analysis & Recommendations

**Date:** 2026-07-04
**Case study:** content claim `54064` (task content `16833`), evaluation targets `172` (attribution), `173` (substantive), `174` (study_identity)
**Claim text:** *"data linking the MMR vaccine to autism had been manipulated by the CDC."*
**Observed outcome:** ~6 support / 2 refute / 2 nuance retained (`evidence_handoff_audit`); top‑5 packet 3/1/1. Support-skewed.

---

## 1. The core correction: query "stance" ≠ result stance

The prompt block in `evidenceEngine.js` (~line 124, the `targetAware` / balanced / standard modes) is **only** the instruction we give the LLM to *author query strings it believes will surface a given stance*. It is a **query-authoring prompt**, not a classifier and not something the search engine ever sees.

The `intent` / `stanceGoal` label attached to each generated query is an **aspiration**, not a fact about what comes back. Confirmed by the pipeline:

- **The label never reaches the search provider.** In `evidenceRetrievalGateway.js:102`, the Tavily call body is `{ api_key, query, max_results, search_depth, include_raw_content }`. `stanceGoal`/`intent`/`evidenceTargetType` are stripped. Every one of claim 54064's 9 query-pack strings appears **verbatim** in `[SEARCH_GATEWAY]` log lines. There is no transformation between "query" and Tavily.

- **The real stance is re-derived later, from content vs. the claim/target — exactly as you suspected.** This happens in `snippetBearing.js` (`assessSnippetBearingBatch`, line 509+). The bearing prompt is *explicit* about ignoring the query label:
  - `snippetBearing.js:37` — `expectedStance: support|refute|nuance|background|insufficient (provisional; do not copy query intent)`
  - `snippetBearing.js:50` — `Do not infer expected stance from the search query's support/refute label.`

So the flow is:

```
LLM authors query  ──(intent label: aspiration)──►  string only  ──►  Tavily/Brave/OpenAlex
        │                                                                     │
        │                                                              raw results
        ▼                                                                     ▼
 [intent discarded]                                    snippetBearing re-classifies stance
                                                        from snippet content vs. claim/target
                                                        (query label explicitly ignored)
```

**Conclusion:** A query tagged `refute` that returns a claim-affirming page is counted as `support`. The label has zero binding force on the outcome. This is by design and is correct behavior — the problem is not that stance is mislabeled downstream, it's that **the query strings themselves don't retrieve a stance-diverse pool**, so the honest re-classification faithfully reports the skew.

---

## 2. Why the "refute" lanes don't refute (claim 54064)

The 9-query pack (`REPAIR_R0_QUERY_PACK`, claim 54064) with intent labels:

| # | intent | query | defect |
|---|--------|-------|--------|
| 0 | nuance | `data linking the MMR vaccine to autism had been manipulated by the CDC.` | verbatim claim restatement → returns source article + echoes |
| 1 | nuance | `CDC Whistleblower to Extend MMR Vaccine Fraud 2016 ` + full claim | **injects a partisan press-release title as an anchor** |
| 2 | support | `William Thompson claims that the CDC manipulated data…` | ok |
| 3 | nuance | `Investigate whether the CDC destroyed evidence…` | an *instruction*, not a query |
| 4 | **refute** | `Review the CDC's response to allegations of data manipulation…` | instruction; neutral; no refutation vocabulary |
| 5 | **refute** | `What evidence exists that contradicts William Thompson's claims…` | the only genuine refute query |
| 6 | support | `William Thompson mmr cdc data statement transcript` | template artifact |
| 7 | **refute** | `response William Thompson mmr cdc data statement` | **malformed template glue** (see §3) |
| 8 | support | `William Thompson CDC Whistleblower to Extend MMR Vaccine Fraud 2016 mmr cdc data` | **injects partisan title again** |

Of 3 refute lanes, only #5 is usable. Two lanes (#1, #8) actively steer toward the fraud narrative. The refute *intent* is disconnected from the query *text*.

---

## 3. Code-path traces

### 3a. How a partisan press release becomes a *required anchor*

1. **Study identity discovery** resolves the claim's referenced "work" to whatever the web returns. In this case `[STUDY_IDENTITY_DISCOVERY]` resolved target 174 to:
   `https://www.globenewswire.com/.../CDC-Whistleblower-to-Extend-MMR-Vaccine-Fraud.html` (a 2016 anti-vax PR wire, `provider: brave`, score 0.55).

2. That resolved work is inherited onto every retrieval context for the claim and folded into `requiredAnchors`:

   **`retrievalContext.js:150-185`**
   ```js
   const resolvedWork = resolvedWorkForTarget(target);
   const inheritedResolvedWorks = (Array.isArray(claim.resolvedWorks) ? claim.resolvedWorks : [])...
   const resolvedWorks = [ ...(resolvedWork ? [resolvedWork] : []), ...inheritedResolvedWorks ]...
   ...
   const requiredAnchors = unique([
     ...speakerEntities,
     ...organizations,
     ...list(claim.evidenceNeed?.mustIncludeTerms),
     ...list(claim.evidenceNeed?.subjectTerms)...,
     ...dates,
     ...studyClues...,
     ...resolvedWorks.flatMap((work) => [work.title, work.identifier, work.authors]).filter(Boolean),  // ◄── line 184
   ], 20);
   ```
   Line **184** promotes `work.title` ("CDC Whistleblower to Extend MMR Vaccine Fraud") into the required-anchor set with **no credibility gate**.

3. `[RETRIEVAL_CONTEXT]` for claim 54064 confirms:
   ```
   requiredAnchors: [... "2016","2014","2004","CDC Whistleblower to Extend MMR Vaccine Fraud"]
   ```

4. The anchored-query builder then stuffs that anchor into query text:

   **`anchoredQueryPack.js:76-100`**
   ```js
   const work = (context.resolvedWorks || [])[0] || {};
   const workAnchor = work.identifier || work.title || ...;   // ◄── the press-release title
   ...
   queryObject(`${core}`, "support", context, target),                                   // core includes workAnchor
   queryObject(`${organization} response ${person} ${workAnchor} ${date} ${action} ${topic}`, "refute", ...), // line 99
   ```
   Result: queries #1 and #8 in the pack carry the partisan title → Tavily is steered back to fraud-narrative pages, on **both** support and refute lanes.

### 3b. Where the malformed `"response …"` refute query comes from

`buildDeterministicAnchoredQueries` (`anchoredQueryPack.js:73-102`) is a **deterministic fallback** that fills lanes with template strings whenever the LLM's queries are rejected or missing. The refute template is literally:

```js
// attribution targets — line 90
queryObject(`${organization} response ${person} ${topic} statement`, "refute", context, target),

// substantive targets — line 99
queryObject(`${organization} response ${person} ${workAnchor} ${date} ${action} ${topic}`, "refute", context, target),
```

For claim 54064's attribution target, `organization` was empty, `person = "William Thompson"`, `topic = "mmr cdc data"`, producing:

```
"response William Thompson mmr cdc data statement"   ← query #7, intent "refute"
```

It is anchor tokens with the word "response" glued on. The label `"refute"` is assigned by the template position (line 90/99), **not** by anything about the text. `intentOf()` (`anchoredQueryPack.js:104-109`) then trusts that label, and the 3-per-intent quota (`line 124`) accepts it as a legitimate refute lane. Same origin for the `"methodology subgroup protocol …"` nuance artifact (line 100).

### 3c. Where stance is (correctly) resolved from results

- `evidenceEngine.js` imports `assessSnippetBearingBatch` from `snippetBearing.js`.
- `snippetBearing.js:509 assessSnippetBearingBatch(...)` builds the bearing prompt (schema at `:561`) and asks the LLM for `expectedStance` from **snippet content vs. claim**, with `:37` and `:50` explicitly instructing it to ignore the query's intent label.
- Output stance flows into the `[BEARING_PACKET]` items and `evidence_handoff_audit` stanceCounts — the numbers you see on the dashboard.

This layer is working as intended. It is the honest mirror that reveals the retrieval skew created upstream in §3a/§3b.

---

## 4. Root cause summary

1. **Intent labels are aspirational and discarded at the gateway** — they cannot bias retrieval on their own; only the query *string* can.
2. **Required anchors pin every lane (including refute) to the claim's own framing**, and a partisan source title was allowed to become a required anchor with no credibility gate.
3. **Genuine refutations use different vocabulary** (`meta-analysis`, `no association`, `reanalysis`, `Cochrane`, `DeStefano 2004 reanalysis`) that the anchor-preservation guard (`validateEvidenceTargetQuery` / `validateAnchoredQuery`) would *reject* for dropping claim anchors. Anti-broadening and find-opposing-views are in direct conflict; anti-broadening wins.
4. **Deterministic fallback templates emit malformed refute/nuance strings** that occupy lanes but retrieve nothing useful.

Net effect: the retrieved pool is dominated by claim-framed sources, so honest stance re-classification returns mostly `support`.

---

## 5. Recommendations: better ways to generate stance-diverse queries

Specifying a desired stance in the prompt is **not** working, because stance is a property of *what you search for*, not a label you attach. Better levers, in priority order:

### 5.1 Decouple refute lanes from claim (narrative) anchors — highest leverage
Split anchors into two tiers:
- **Topic anchors** (kept on all lanes): `mmr`, `autism`, `cdc`, `vaccine`.
- **Narrative anchors** (kept only on support/attribution lanes): `manipulated`, `William Thompson`, the resolved-work title.

Refute lanes keep topic anchors, **drop** narrative anchors, and **add refutation lexicon**. For 54064 a good refute query is:
`MMR vaccine autism no association meta-analysis 1.2 million children` or `CDC 2004 DeStefano study reanalysis Thompson allegations debunked`.
Implement as a per-intent anchor policy in `retrievalContext.js` (produce `requiredAnchorsByIntent`) consumed by `anchoredQueryPack.js` and the validators.

### 5.2 Credibility-gate resolved works before they become anchors
In `retrievalContext.js:184`, do not promote `work.title` to `requiredAnchors` unless the resolved work passes a source-credibility check (domain reputation / not a PR wire / not on avoid-list). A `globenewswire` press release should never be a *mandatory* search token. Keep it as an optional hint, not a required anchor.

### 5.3 Generate refute queries from the *negation/antithesis*, not the claim
Add a dedicated refute-authoring step: first compute the claim's antithesis proposition ("the CDC did **not** manipulate MMR–autism data / the 2004 study was validly reanalyzed"), then author queries for *that* proposition. Searching for the counter-proposition naturally surfaces opposing sources. This is far more reliable than telling one prompt to produce support+refute+nuance simultaneously.

### 5.4 Stance-conditioned source steering (prefer/avoid + site scoping)
The gateway already accepts `prefer`/`avoid` domains. Use intent to steer *domains* rather than just wording:
- refute lanes → prefer `cochrane.org`, `.gov` health, established science desks, `sciencebasedmedicine.org`; add `-site:` exclusions for known amplifiers.
- support lanes → allow the claimant ecosystem.
This makes the intent label actually *do something* at retrieval time instead of being discarded.

### 5.5 Validate query *shape* against its intent, and regenerate on mismatch
Before accepting a lane, check consistency: a `refute` query that (a) contains no refutation lexicon and (b) shares ≥90% tokens with the claim, or (c) is a malformed template artifact (`"response …"`, `"methodology subgroup protocol …"`), should be rejected and regenerated — the same discipline already applied to anchor-losing queries in `validateEvidenceTargetQuery`.

### 5.6 Retire / repair the deterministic fallback templates
`buildDeterministicAnchoredQueries` (`anchoredQueryPack.js:73-102`) should either produce grammatical queries or be replaced by a small targeted LLM re-ask for the *specific missing intent*. As written it burns 2–3 of 9 lanes on strings that retrieve nothing.

### 5.7 Measure it: log per-intent retrieval efficacy
Add an audit that joins query `intent` → resulting candidate re-classified `stance`, per lane. This gives a direct "refute-lane yield" metric so we can see whether §5.1–5.6 actually raise the share of genuine refutations retrieved, rather than eyeballing dashboard totals.

---

## 6. TL;DR

- The pasted prompt only *asks the LLM to author stance-targeted query strings*. It does not set result stance.
- Result stance is re-classified downstream from content vs. claim (`snippetBearing.js`), which **explicitly ignores** the query's intent label — this is correct.
- The skew comes from **retrieval**, not classification: required anchors (including a partisan press-release title) and malformed fallback templates pin even "refute" lanes to the claim's framing.
- Fix retrieval, not the label: per-intent anchor policies, credibility-gated anchors, antithesis-based refute authoring, domain steering, and shape-vs-intent validation.
