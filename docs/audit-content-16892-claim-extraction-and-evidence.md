# Audit — content 16892 (claim extraction + evidence gathering)

**Date:** 2026-07-04
**Source:** `backend/logs/evidence-2026-07-04.log` (content_id 16892, MMR/CDC/Thompson article — 301 Thompson/MMR/CDC mentions, so the source text is correct).
**Companion docs:** `docs/evidence-pipeline-audit-content-16833.md`, `docs/veristrata_scrape_pipeline_mct_v3.md`.

## TL;DR — where the failure actually is

The catastrophic part (60 fragmented claims, no thesis, "missed" Thompson) is **not** in the evidence-gathering code we changed in the last several steps. It is upstream, in **claim extraction / document synthesis**, and it is being caused primarily by **missing DB prompts** and a synthesis step that is not consolidating fragments. The evidence side has real problems too, but they are mostly a *consequence* of the claim side plus a hard 12‑claim processing cap.

The measured numbers for this run:

| Metric | Value | Meaning |
|---|---|---|
| Claims mapped | **68** | far too many; should be ~10–12 |
| `role:thesis` claims | **2** | almost no thesis-level structure |
| Duplicate copies of the "MMR data manipulated" claim text | **85** | extraction is emitting the same sentence dozens of times |
| Claims eligible for evidence gathering | **12** | `eligibleClaims:12, skippedClaims:56, totalClaims:68` |
| Final packets with `itemCount:0` | **60 / 68** | most claims end with an empty packet |
| Snippet-bearing scores ≥0.35 | **91** | bearing IS computing real scores |
| Assertions persisted | **54** (5 deduped) | ~6 per source on several sources |
| Missing DB prompts (fell back) | see below | root cause |

## 1. Claim extraction is the primary failure — and it is NOT the code we just changed

I did not touch `claimsEngine.js` or `localClaimExtraction.js` in any of the recent steps (query gen, candidate survival, snippet bearing, adaptive allocation, canonical coalescing, target-fit, packet). Claim extraction is broken for two reasons visible in the log:

### 1a. Missing DB prompts → fallback
```
No active prompt found: claim_local_extraction
No active prompt found: claim_document_synthesis
No active prompt found: claim_complex_target_mapping
```
Per `veristrata_scrape_pipeline_mct_v3.md` (line ~713), the giant argument-mapper was deliberately **replaced** with *local chunk extraction + lightweight synthesis + deterministic target construction*. Those three prompts ARE that new design. They are not in your DB on this environment (the seeds under `backend/migrations/` — e.g. `seed_claim_extraction_prompts.js`, `add_local_claim_mapping_prompts.js` — were not applied). So the pipeline runs on code fallbacks for the exact stage that is supposed to turn raw chunks into a coherent thesis + pillar structure.

### 1b. Synthesis is not consolidating — it emits fragments and duplicates
The 68 "claims" are largely **sentence fragments**, not claims:
- `"additional research was needed"`, `"basic information being suppressed"`, `"a decade-long CDC cover-up"`, `"children were receiving 25 doses/12 shots"`.
- The claim `"data linking the MMR vaccine to autism had been manipulated"` appears **85 times** in the log.

That is the signature of chunk-level extraction with **no working document-synthesis/dedup pass**. With `claim_document_synthesis` missing, nothing collapses the per-chunk fragments into ~11 canonical claims, and nothing lifts the article's **thesis** ("the CDC covered up / manipulated MMR–autism data and ordered evidence destroyed") to a first-class claim. Result: 68 fragments, 2 nominal thesis rows, thematic structure flattened — exactly RC‑008 in the 16833 audit ("claim extraction lost important thesis-bearing claims").

**So: the "60 case claims / no thematic claims / missed thesis" is caused by missing claim-extraction prompts + a non-functioning synthesis step, not by the recent evidence-pipeline changes.**

## 2. Did we actually "miss" the Thompson claim? No — we drowned it

The Thompson material WAS extracted, repeatedly:
- `"Senior CDC scientist turned whistleblower William Thompson revealed privately in 2014 that…"`
- `"Believing the order to destroy data was illegal, Thompson secretly saved over 10,000 pages…"`
- `"data linking the MMR vaccine to autism had been manipulated"` (×85)

And the Thompson claims DID make the eligible 12 (`bearing_gating` includes `"data linking … manipulated"` and `"destruction of evidence related to autism and MMR"`). So this is not a retrieval miss — it is that the thesis is **fragmented into many near-duplicate low-context shards** instead of one well-formed claim with attribution + study_identity + substantive-conduct targets. The fragments are individually hard to gather evidence for, and duplicates waste the 12-claim budget.

## 3. Why only 12 claims get evidence (and 56 get empty packets)

`selectClaimsForBearingGating` marks **12 eligible / 56 skipped**. The 56 skipped claims never get evidence gathering, so their `bearing_packet_live` is `itemCount:0`. That accounts for the "empty / ZERO links" feeling across most claims. This cap is pre-existing (not something we changed), but fragmentation makes it far worse: with 68 fragments instead of ~11 claims, the budget is spent on shards and duplicates, and legitimately distinct claims get skipped.

**This is the interaction that makes it feel worse than before:** broken synthesis (many fragments) × fixed small processing cap (12) = most real content never processed.

## 4. Bearing is NOT the thing that's broken

You said you don't see real bearing. The log disagrees with that specific worry: snippet bearing produced **91 scores ≥0.35, 21 mid, 32 low** — it is discriminating. `POST_SCRAPE_TARGET_FIT` shows 64 assertions all labeled `direct_substantive` and persisted (my Step 21 misconduct gate did **not** fire here — it only gates when the target carries misconduct predicates, and the fragmented targets mostly don't, so it passed everything through — i.e. it is currently inert, not over-rejecting).

The reason packets look empty is **§3 (claims skipped)**, not bearing. For the 12 that are processed, packets do form (item counts of 1, 1, 1, 1, 2, 3, 5, 5). So "bearing will never work" is aimed at the wrong stage — bearing is running; it is being starved of well-formed claims and of the other 56 claims entirely.

## 5. "One link per source" and per-source counts

At persistence, several sources carry **6 assertions each** (`referenceContentId` 16944/16938/16930/16922/16910/16898 all = 6). So it is not literally one-per-source at the DB assertion level. What you see as "one link per source" is downstream of two collapses:
- **Final packet caps:** Step 22/23 cluster cap (one representative per assertion cluster) + `maxQuotesPerDocument` (2) + `maxItems` (5). For thin claims this yields ~1 packet item per source.
- **Link table pairing:** `reference_claim_task_links` is keyed on `(reference_claim_id, task_claim_id)`; multiple assertions from one source addressing the same task claim upsert into **one** link row. That is by design, but combined with fragmented claims it reads as "one link per source."

This is worth a dedicated look, but it is a *presentation/dedup* effect on top of the real problem (few well-formed claims, most claims unprocessed), not an independent bug we introduced.

## 6. What the recent (my) changes did — honest attribution

| Recent change | Effect on this run | Verdict |
|---|---|---|
| **Query-prompt rename** `evidence_query_generation_*` → `evidence_purpose_query_generation_*` | 12× `No active prompt found: evidence_purpose_query_generation_*` → query gen ran on my **code fallback**, and your DB-tuned evidence-query prompts are now **bypassed** (orphaned under the old names). | **Regression risk I introduced.** Query quality for the 12 processed claims is whatever my fallback produces, not your tuned prompt. Needs a seed under the new names, or revert to old names. |
| Candidate survival, snippet-bearing robustness, adaptive allocation, canonical coalescing, target-fit, packet | Operate only on the 12 processed claims. Logs show them running (drop audit 1232, bearing 1226, allocation 12, packet 68). Target-fit inert; packet caps active. | **Not the cause of the empty-packet mass** (that's the 56 skipped claims). May be trimming the 12 packets tighter than you want (cluster cap + doc limit). |

**Bottom line on attribution:** the collapse you're seeing (60 fragments, no thesis, unusable packets) is dominated by (a) missing claim-extraction prompts and (b) a synthesis step that isn't consolidating — **neither of which is the evidence code we spent the last several steps on**. My query-prompt rename is a genuine, separate regression (bypassed your tuned prompts) but it only affects the 12 processed claims, not the 68→2-thesis collapse.

## 7. Fix order (highest leverage first)

1. **Seed the missing claim-extraction prompts** into `llm_prompts` (`claim_local_extraction`, `claim_document_synthesis`, `claim_complex_target_mapping`) — run the migrations under `backend/migrations/` that define them, or insert from the code fallbacks. Nothing else matters until synthesis works.
2. **Verify document synthesis actually consolidates** — after seeding, re-run and confirm the "MMR data manipulated" fragment collapses from 85→1 and a real **thesis** claim appears with attribution + study_identity + substantive-conduct + inference targets (the 54064 fixture in the veristrata doc is the acceptance bar).
3. **Fix the claim budget interaction** — either raise the 12-claim cap or make `selectClaimsForBearingGating` prefer thesis/pillar claims over fragments, so the Thompson thesis is guaranteed a slot. (This is a real limiter but pointless to tune before #1–#2.)
4. **Re-home the evidence-query prompts** — seed `evidence_purpose_query_generation_system/user` from the current code fallback (and deactivate the old rows), OR point the code back at the old names and update their text. This restores your ability to tune query generation.
5. **Only then** revisit packet sparsity ("one link per source") — with well-formed claims and full-budget processing, re-check whether the Step 22/23 cluster cap / doc limit is too aggressive.

## 8. What is genuinely working (so we don't throw it away)

- Snippet bearing is scoring and discriminating (§4).
- Candidate survival, canonical coalescing (91 acquisitions, no duplicate-row errors in this log), adaptive allocation, and the target-fit/packet guards are all running without crashing.
- The Thompson content is present and reached the eligible set — retrieval is not the miss.

The problem is that all of that sits **downstream of a claim-extraction stage that is currently emitting fragments on code fallbacks**. Fix extraction/synthesis first; the evidence stack has a real chance once it's fed coherent claims.
