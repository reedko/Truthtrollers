# CF1 split — posture fix (contentStance/articleDeployment) + mint-consistency fix

Working log. Survives context reset. Started 2026-07-19.

## 0. Confirmed diagnosis (from split-20260718-eeda3e, live gpt-4o-mini, F02/F03 × 3)

That run **is** live split code (`backend/scripts/cf1SplitStage2.mjs` → `runCall1Split`
→ 1A / host census+packet / 1B / `finalizeSplitInventory`). Two independent failures:

**Failure 1 — posture collapse.** Across all 6 runs, every candidate came back
`articleUse: "reported"`, `articleRole: "pillar"/"pillar_support"`, effects `none/none`,
`scoreTransform: none`, `responseUnitIds: []`. On F03, JCPH/CDC opponent claims (the ones
the article's thesis disputes) were labeled supporting pillars. Root cause: 1B's `articleUse`
is inferred by looking for a rebuttal in the packet's LOCAL response window; F03's rebuttals
are distant, so the window shows only the opponent's own bullet points → model defaults to
neutral. CAND02's `localResponseWindow` contained the ad's claims, no article rebuttal.

**Failure 2 — mint/mintedClaims divergence.** F03-run1 `censusOutcomes`: 60/60 `mint`,
`mintedClaims`: **0**. Schema allows `outcome:"mint"` with no matching `mintedClaims` entry,
so the entire recall surface silently produced nothing.

## 1. Fix plan

- **P1 — content vs deployment split (1B).** Replace model `articleUse` with two model
  judgments: `contentStance` (supports_thesis | contradicts_thesis | neutral, judged from
  claimText vs thesis ALONE, zero dependence on finding an opposing passage) and
  `articleDeployment` (endorsed | rebutted | reported_neutral, how the article treats it).
  Host derives `articleUse` from the pair.
- **P2 — mint consistency.** Host validation: every `outcome:"mint"` must have a matching
  `mintedClaims` entry by `censusId`, else repairable verification error (not silent).
- **Separate — distant-response attachment (packet assembly).** Whole-document lexical scan
  for the claim's terms + negation/interrogative cues; attach best distant passage as
  `possibleResponse`. Feeds `articleDeployment` ONLY. Never used to infer contentStance /
  opposition-by-source (rejected heuristic: fails for whistleblower / institution-undermining
  content).

## 2. Decision (2026-07-19) — contentStance drives scoreTransform

Owner chose: **retire `ifSupportedEffect`/`ifRefutedEffect` from 1B.** `contentStance` is the
single model judgment for score direction. Host derives:
- `scoreTransform`: contradicts_thesis→invert, supports_thesis→normal, neutral→none
- `articleUse`: from (contentStance, articleDeployment) per the table below.

articleUse derivation (all 9 cells; live enum
["endorsed","opponent_to_rebut","rejected","reported","background","qualification","unclear"]):

| contentStance \ articleDeployment | endorsed | reported_neutral | rebutted |
|---|---|---|---|
| supports_thesis    | endorsed | reported | **INCONSISTENT** |
| contradicts_thesis | **INCONSISTENT** | opponent_to_rebut | rejected |
| neutral            | qualification | background | qualification |

INCONSISTENT cells (supports+rebutted, contradicts+endorsed) → articleUse="unclear" +
blocking diagnostic surfaced (never silently resolved), mirroring scoreTransform inconsistency.

## 3. Test order (per GO)

1. Re-run contentStance/articleDeployment on the SAME 8 candidates (F02/F03 from eeda3e),
   NO packet changes; confirm CAND02 → contentStance: contradicts_thesis from claimText vs
   thesis alone, no distant passage involved.
2. Verify mint/mintedClaims check rejects the exact 60-mint / 0-claim pattern.
3. THEN add distant-response attachment; confirm it improves articleDeployment without
   altering step-1 contentStance results.

## 4. Implementation (2026-07-19) — CODE DONE, offline tests green

All deterministic code + offline tests are in. No new live model call has been made yet.

**P1 — content/deployment split**
- `splitCall1bSourcePostureSchemaV1.js`: `posture` now emits `contentStance`
  (supports_thesis|contradicts_thesis|neutral) + `articleDeployment`
  (endorsed|rebutted|reported_neutral); removed `articleUse` and both effect fields.
  Enums export CONTENT_STANCE/ARTICLE_DEPLOYMENT/ARTICLE_ROLE.
- `splitCall1bSourcePosturePromptV1.js`: rewrote the posture section — contentStance is
  claimText-vs-thesis ALONE ("Decide this from claimText and the thesis ALONE… a claim can
  contradict the thesis on its own content with no rebuttal present"); articleDeployment is
  separate; the two MAY disagree; possibleResponse feeds articleDeployment only, never
  contentStance.
- `splitScoreTransform.js`: now derives from `contentStance` (supports→normal,
  contradicts→invert, neutral→none); unknown stance is blocking.
- NEW `splitArticleUse.js`: `deriveArticleUse({contentStance, articleDeployment})` per the
  §2 matrix; the two contradictory cells throw CF1_SPLIT_ARTICLE_USE_INCONSISTENT.
- `splitHostFinalize.js`: stores the posture pair on `_split`, host-derives both
  `articleUse` (top-level, live-schema field) and `scoreTransform`; an inconsistent pair →
  articleUse="unclear" + blocking diagnostic (surfaced, never silent).
- `runCall1Split.js`, `splitArmHtml.js`, and the affected tests migrated to the new fields.

**P2 — mint consistency**
- NEW `splitCensusValidation.js`: `assertCensusMintConsistency` — every "mint" outcome must
  have a matching mintedClaims entry (and vice-versa), else CF1_SPLIT_CENSUS_MINT_WITHOUT_CLAIM
  (retryable). Wired into `runCall1Split` between 1B and finalize.
- Test proves it rejects the exact 60-mint / 0-claim eeda3e pattern (offline, no model).

**Separate — distant-response attachment**
- `splitPacketAssembly.js`: `distantResponse()` whole-document lexical scan — claim terms +
  negation/interrogative cue at distance beyond the local neighbourhood, best overlap wins,
  attached as `packet.possibleResponse`. OFF by default (`options.attachDistantResponse`), so
  step-1 packets are byte-identical to before. Feeds articleDeployment only.

**Fixture-contamination decontamination (2026-07-19).** The guard
(`fixtureContamination.test.js`, MCT §13.3) denylists ALL fixture entities equally — glyphosate
sits beside cdc; there is NO "F01/F02 permitted, F03 held out" carve-out (an earlier claim to
that effect was wrong and retracted). The guard scans `src/claim-foundry/`, `src/evidence-run/`,
`promptSets/` (not `.test.js`). Neutralized every scanned-root hit with topic-neutral logic:
- `splitAssertionSourceClass.js`: removed the hardcoded `EPA|FDA|CDC|WHO|NIH|IARC|Monsanto` from
  INSTITUTION_CUE; added a generic all-caps ACRONYM_CUE (`[A-Z]{2,6}`) — more general, no names.
- `attributionSurfaceCensus.js`: comment `("Antoniou said")` → `("<Surname> said")`.
- `setECanonicalPropositionV1.js` (separate arm): prompt `"CDC statements"` → `"<agency>
  statements"`; matcher `/^CDC statements$/i` → generic `/^[A-Za-z]+ statements$/i`.
- Updated the classifier unit test to neutral inputs (NASA / Acme Corporation / Sorensen).

Guard now GREEN on clean code. Full claim-foundry suite **328/328**.

OUT-OF-SCOPE hits flagged, NOT edited (owner call): `src/core/duckDuckGoSearch.js:181` and
`src/core/evidenceEngine.js:663` both hardcode `glyphosate` in a topic classifier
(`/pesticide|herbicide|glyphosate/ → 'pesticides'`). Production logic, real fixture entity, but
`src/core/` is a different subsystem outside the guard's declared CF1/ER1 scope. Decision needed:
widen the guard to `src/core/` and neutralize these too, or leave them as core-engine routing.

## 5. Live validation — NOT YET RUN (billed, needs OPENAI_API_KEY)

Harness: `backend/scripts/cf1SplitRerun1b.mjs` re-runs ONLY 1B (+finalize) over the SAME 1A
candidates from a prior split-arm run, isolating the posture change from 1A variance.

- **Step 1** (packets unchanged): `node scripts/cf1SplitRerun1b.mjs --run
  ../artifacts/claim-foundry/split-arm/split-20260718-eeda3e --fixture CF1-F02 --fixture CF1-F03`
  → confirm the self-evidently-oppositional candidate now gets contentStance:contradicts_thesis
  from claimText vs thesis, with no distant passage involved (compare against the all-reported
  collapse in §0).
- **Step 2**: already verified offline (census-validation test).
- **Step 3** (adds distant-response): same command `--fixture CF1-F03 --distant` → confirm it
  moves articleDeployment (reported_neutral→rebutted where a real distant rebuttal exists)
  WITHOUT changing the step-1 contentStance results.

Owner triggers these (API cost, your key). Summaries land in
`<run>/rerun1b-*/summary.json`.

## 7. Step-1 LIVE re-run results (2026-07-19, gpt-4o-mini, packets UNCHANGED)

`rerun1b-20260719/` (report: `review.html`, split mode). attachDistantResponse=false.

**Posture collapse is FIXED (the step-1 goal).**
- F03: eeda3e was 8/8 reported/pillar_support/none. Now **4 opponent_to_rebut, 2 reported,
  2 endorsed**; contentStance = 4 contradicts_thesis / 4 supports_thesis. The 4 contradicts
  came out with NO distant passage in the packet → contentStance-from-claimText-vs-thesis
  alone breaks the flatline, exactly as designed. 0 blocking inconsistencies.
- F02 (thesis-aligned): all 12 supports_thesis/endorsed → articleUse endorsed; no false
  opponents. 0 blocking.
- (F03 label correctness per-claim not adjudicated here — sealed canary, structural only.)

**New, now-VISIBLE census regression (report honestly).** The model returned **0
censusOutcomes** for the census packets (F03: 60, F02: 45), so every census item is a visible
unresolved recall-miss. eeda3e returned 60 "mint"/0 claims (silent nothing); the mint guard
passed here (0 mint = 0 minted, consistent) but the census stream flipped from
"mint-everything" to "resolve-nothing" — still no useful recall, now visible not silent.
Likely prompt-adherence under the new two-judgment load (gpt-4o-mini dropped the census
section). Separate from the posture fix; needs its own iteration (not done).

## 8. Post-step-1 fixes (2026-07-19, NO rerun yet — awaiting owner go)

Step-1 review exposed two problems in the live output; both fixed at the prompt level,
kept general (no F03 tuning), tests 328/328.

**8a — claim count stuck at 8.** Not a cap: ceiling is 12 everywhere (1A schema maxItems 12,
finalize targetMax 12); minItems 8 is a FLOOR for long articles, and finalize keeps
`min(12, input)` — never cuts to 8. The 8 was the number 1A *emitted* (its count wording was
weak, memory-flagged). Strengthened `splitCall1aDiscoveryPromptV1.js`: "A long, dense article
normally yields 10 to 12… do NOT stop at the minimum of 8 when more genuinely distinct,
separately grounded propositions exist," keeping the anti-filler + anti-near-duplicate guards.
(Note: the eeda3e re-run REUSES frozen 8-candidate 1A output, so this only takes effect on a
run that re-executes 1A — not a bare rerun1b replay.)

**8b — contentStance INVERTED (the real defect).** On F03 the model got the substantive claims
backwards: the article's OWN pro-thesis evidence (thimerosal/aluminium toxic, SIDS) → labeled
contradicts_thesis/opponent; the health authority's reassuring claim (vaccines well tested) →
supports_thesis. Root cause: gpt-4o-mini read the thesis as the mainstream position and
pattern-matched "alarming/anti-establishment claim → opponent," ignoring that the thesis is
itself contrarian. Host derivation was correct GIVEN the input; the model's contentStance was
wrong. Rewrote the CONTENT STANCE block in `splitCall1bSourcePosturePromptV1.js`: state the
thesis DIRECTION first (often contrarian — argues a mainstream body/product is wrong/unsafe),
then the strict truth-counterfactual, and explicit anti-shortcut rules — do NOT infer stance
from alarming tone or source reputation; a claim that a mainstream body is wrong SUPPORTS a
thesis arguing that; a reassuring claim from the disputed authority CONTRADICTS it; the
article's own pillars are almost always supports_thesis. Generic examples only (product/body),
no fixture terms. Pinned by test assertions.

OPEN: this is a prompt fix for a model-reasoning failure; whether gpt-4o-mini now follows it,
or whether a stronger model is needed, is unknown until the next live run (owner-triggered).
Census-zero regression (§7) still open, untouched.

## 9. Live F03 re-run WITH fixes (2026-07-19, gpt-4o-mini, --fresh1a, --distant OFF)

`rerun1b-fresh1a-20260719/review.html`. Fresh 1A (tests count fix) + new 1B (tests inversion
fix), same model as eeda3e for apples-to-apples. Script gained a `--fresh1a` flag (re-executes
1A live; default still replays frozen 1A).

**Inversion fix VALIDATED in one direction.** The canonical claim "Vaccines are tested more
than any other medicine" flipped supports_thesis (wrong, prior run) → **contradicts_thesis →
opponent_to_rebut** (correct). All the health-authority ad's pro-vaccine reassurances (immune
system, aluminium/tomato, ethylmercury, no-credible-studies, vaccines-tested-more) → correctly
opponent_to_rebut. The "alarming = opponent" shortcut is gone; the disputed authority's
reassurances are now correctly contradicts_thesis. 0 blocking.

**Caveats (do not overclaim):**
- Other direction UNVERIFIED this run: fresh 1A surfaced a narrower claim set (mostly the ad's
  pro-vaccine bullets) and did NOT re-extract the author's own evidence (thimerosal/aluminium
  toxic, SIDS) that was inverted last time — so "author evidence → supports_thesis" isn't
  demonstrated here. 1A variance, not the posture fix.
- 2 borderline: CDC demographic stats marked opponent_to_rebut (debatable; not hard-adjudicated,
  sealed fixture).
- Count 8→9: Fix 1 nudged up, did not reach 10-12. Partial.
- articleDeployment all reported_neutral → opponents resolve to opponent_to_rebut not rejected.
  Expected with --distant OFF (rebuttals are distant, unseen). Step-3 --distant run is the test.
- Census still 0 outcomes → 60 unresolved. §7 regression persists, untouched.

## 10. CLEAN isolation re-run (2026-07-19, gpt-4o-mini, frozen 1A, --distant OFF) — inversion fix VALIDATED

`rerun1b-20260719/review.html` (this OVERWROTE the pre-fix bare-replay dir of the same name;
pre-fix numbers preserved in §7). Bare 1B replay over the SAME frozen 8 eeda3e F03 candidates —
isolates the contentStance fix from 1A variance (the fresh1a §9 run was the wrong test; owner
did not want 1A re-run). Same 8 claims, before → after the fix:

- Thimerosal toxic (MSDS): contradicts ❌ → **supports_thesis** ✅
- Aluminium toxic (Lyons-Weiler): contradicts ❌ → **supports_thesis** ✅
- SIDS after vaccination (Neil Miller): contradicts ❌ → **supports_thesis** ✅
- "Vaccines tested more" (JCPH): supports ❌ → **contradicts_thesis → opponent_to_rebut** ✅
- JCPH ad reassures: supports → contradicts/opponent (improved)
- CDC "half not fully vaccinated": contradicts → contradicts (unchanged, borderline)
- exemption rise / censorship: supports → supports (fine)

EVERY flagged inversion corrected. Author's own evidence → supports_thesis; disputed-authority
reassurances → contradicts_thesis/opponent. 3 contradicts / 5 supports, 0 blocking. The
contentStance fix (§8b) is validated in BOTH directions on the exact claims that were wrong.

Still open: articleDeployment all reported_neutral → supports claims resolve to articleUse
"reported" not "endorsed" (deployment under-called; stance/scoreTransform correct). Census 0/60
unresolved (§7). Count 8 (frozen 1A; count fix §8a not exercised here). Model still gpt-4o-mini.

## 6. Progress log

- 2026-07-19: diagnosis confirmed from run JSON; decision §2 taken (contentStance drives
  scoreTransform); all P1/P2/distant code + offline tests implemented and green (60/60 split,
  327/328 suite — sole red is pre-existing contamination guard); re-run harness written, not run.
