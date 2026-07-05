# Bearing "Shadow" Audit — is the legacy method still running?

**Date:** 2026-07-04
**Question:** The bearing code is littered with `shadow`/`bearingShadow` names. Is the original method that the "shadow" was a shadow *of* still running in parallel with the modern bearing approach? Are the labels vestigial? Should the legacy path be removed and the labels renamed?

**Short answer:**
- **In a correctly configured deployment (`ENABLE_BEARING_GATING=true`, as `.env.example` sets) the legacy method does NOT run.** Only `runBearingGated` executes; the deterministic + LLM bearing *drive* selection. The `shadow` names in that path are **vestigial and misleading** — those functions are load-bearing.
- **But the code default is `enableBearingGating: false`.** If the env/DB config is missing or set false, the engine silently runs the **legacy selection path**, where modern bearing is computed but only *logged* (a true shadow) while the actual fetch order is legacy provider-score `slice()`. That is the real risk, and it is a configuration footgun, not an active parallel-run in production.

---

## 1. There are three independent "shadow" flags

| Flag | Default | Where | What it actually gates |
|---|---|---|---|
| `ENABLE_BEARING_SHADOW` | `.env.example: false`; code: `NODE_ENV!==production` | `snippetBearing.js:327` `isBearingShadowEnabled()` | Turns on the **deterministic bearing pre-scorer** + LLM snippet bearing. In the gated path this is forced on anyway (`… || opt.enableBearingGating`). |
| `ENABLE_BEARING_GATING` | code: **false**; `.env.example: true` | `bearingConfig.js:60` | Selects `runBearingGated` (modern) vs the legacy `run()` body. **This is the real switch.** |
| `ENABLE_POST_SCRAPE_BEARING_SHADOW` | code: `NODE_ENV!==production` | `extractQuote.js:15` `isPostScrapeBearingEnabled()` | A separate post-scrape bearing pass (not fully traced here — flag for the same treatment). |

Note the inversion: **`ENABLE_BEARING_GATING` defaults to `false` in code but `true` in `.env.example`.** "Modern-only" is guaranteed solely by the env/DB value, not by the code.

---

## 2. Classification of every `shadow`-named symbol

### A. Load-bearing, but misnamed "shadow" (they RUN and DRIVE decisions)

These are the deterministic bearing pre-scorer and its outputs. In `runBearingGated` they feed `candidateScore()` (`evidenceCandidateSelector.js:14–18`, which reads `bearingPreScore` → falls back to `deterministicBearingScore`) and my new `orderForLlmBearing`. They are **not** a shadow of anything.

- `scoreCandidatesInBearingShadow()` — `snippetBearing.js:357`; called at `evidenceEngine.js:593` (retrieveCandidates) and `:1071` (gated run). Sets `deterministicBearingScore`.
- `addDeterministicBearingShadow()` — `snippetBearing.js:337`.
- Candidate fields: `bearingShadowDecision`, `bearingShadowReason`, `bearingShadowMethod`, `bearingShadowConfigVersion`, `bearingShadowWouldScrape` — `snippetBearing.js:345–349`.
- Constants `BEARING_SHADOW_METHOD = "deterministic_v1"`, `BEARING_SHADOW_CONFIG_VERSION` — `snippetBearing.js:6–7`.
- `isBearingShadowEnabled()` — `snippetBearing.js:327` (used as an OR with gating to enable the *real* scorer).
- `[BEARING_LLM_SHADOW]` log — `snippetBearing.js:501`; emitted by the actual LLM bearing batch.
- Local `bearingShadowEnabled` in `tavilySearch.js:69` / `bingSearch.js:35` — only gates attaching provider metadata (`provider/providerRank/providerScore`); enabled when gating is on.

### B. Genuine shadow (comparison logging only) — but only in the legacy path

- `logBearingShadowEvent()` / `buildBearingShadowLogRecord()` / `[BEARING_SHADOW]` — `snippetBearing.js:689,734,736`. **Two callers, two different meanings:**
  - `evidenceEngine.js:1514` (**gated path**): `actualSelected` comes from the *real* bearing-gate selection (`allocation.selectedByClaimId`). This is an **audit log of the actual decision**, not a shadow. Misnamed.
  - `evidenceEngine.js:1772` (**legacy path**): `actualSelected = candidateIndex < shadowSelectedCount`, where `shadowSelectedCount` is the legacy provider-order top-N. This is the **one true shadow** — it compares modern bearing against the legacy selection without acting on it. **Runs only when `enableBearingGating` is false.**

### C. Legacy method (the thing "shadow" was shadowing)

- `EvidenceEngine.run()` legacy body — `evidenceEngine.js:1721–1788+`. When gating is off:
  1. `retrieveCandidates`
  2. LLM bearing only as a "same-length, same-order map. No gating or sorting" (`:1762`)
  3. `logBearingShadowEvent` shadow comparison (`:1772`)
  4. **Actual selection = `candidates.slice(0, opt.maxEvidenceCandidates)`** (`:1785`) — provider-score order. This is the legacy method.

---

## 3. Is the old method running in parallel? — precise answer

**No true parallel execution.** It is an either/or fork at `evidenceEngine.js:1717`:

```
run(claims, contexts, opt):
  if (opt.enableBearingGating) return runBearingGated(...)   // modern; bearing DRIVES selection
  ... legacy body ...                                        // legacy; bearing only SHADOW-LOGGED
```

- With `ENABLE_BEARING_GATING=true`: legacy body (1721–1788) is **dead code**; `logBearingShadowEvent@1772` never fires; the modern deterministic+LLM bearing is the sole selector. The remaining `[BEARING_SHADOW]`/`[BEARING_LLM_SHADOW]` logs are **audit/calibration logs of the real pipeline**, misnamed.
- With `ENABLE_BEARING_GATING=false` (code default): the **legacy method selects candidates**, and modern bearing is reduced to passive shadow logging. This is exactly the failure mode you were worried about — it just requires the flag to be off.

There is **one** production caller: `runEvidenceEngine.js:1593 engine.run(..., runOptions)` with `enableBearingGating: bearingConfig.enableBearingGating`. So the entire question reduces to that one config value.

---

## 4. Recommendations

### 4.1 Close the config footgun (highest priority, lowest risk)
Make the code default match the intended production behavior: `enableBearingGating: true` in `DEFAULT_BEARING_GATING_CONFIG` (`bearingConfig.js:5`), or make `runEvidenceEngine` refuse to silently run legacy (log a loud warning when gating resolves false). Right now "modern only" depends on an env var that defaults the wrong way.

### 4.2 Remove the redundant legacy path (once 4.1 is committed)
If gating is always-on, delete:
- the legacy `run()` body (`evidenceEngine.js:1721–1788+`), keeping `run()` as a thin delegate to `runBearingGated`;
- the legacy-only shadow comparison (`logBearingShadowEvent@1772`, and `buildBearingShadowLogRecord`'s `actualSelected`-vs-legacy semantics);
- `ENABLE_BEARING_SHADOW` as an independent enable (fold into gating).

Guard: several tests exercise the legacy path (e.g. `snippetBearingBatch.test.js` "shadow path does not alter fetched candidate order" sets `ENABLE_BEARING_SHADOW=true` with **no** gating). Those must be migrated to the gated path or retired first.

### 4.3 Rename the vestigial labels (mechanical, do after 4.2)
The `shadow` label on load-bearing code is actively misleading — it implies a passive parallel run. Suggested renames:

| Current | Rename to |
|---|---|
| `scoreCandidatesInBearingShadow` | `scoreCandidatesDeterministicBearing` |
| `addDeterministicBearingShadow` | `addDeterministicBearing` |
| `bearingShadowDecision/Reason/Method/ConfigVersion/WouldScrape` | `deterministicBearingDecision/Reason/Method/ConfigVersion/WouldScrape` |
| `BEARING_SHADOW_METHOD` / `BEARING_SHADOW_CONFIG_VERSION` | `DETERMINISTIC_BEARING_METHOD` / `…_CONFIG_VERSION` |
| `isBearingShadowEnabled` | fold into gating, or `isDeterministicBearingEnabled` |
| `[BEARING_SHADOW]` (audit@1514) | `[BEARING_SELECTION_AUDIT]` |
| `[BEARING_LLM_SHADOW]` | `[BEARING_LLM_ASSESSMENT]` |
| `logBearingShadowEvent` (gated audit) | `logBearingSelectionAudit` |
| local `bearingShadowEnabled` in tavily/bing | `captureProviderMetadata` |

Keep the word "shadow" **only** on the genuine comparison logger, if the legacy path survives 4.2. If the legacy path is removed, retire the term entirely.

### 4.4 Trace the third flag
`ENABLE_POST_SCRAPE_BEARING_SHADOW` / `isPostScrapeBearingEnabled` (`extractQuote.js`) is a separate post-scrape bearing pass not covered here. Confirm whether it drives extraction or only logs, and apply the same rename/removal logic.

---

## 5. Bottom line

- The word "shadow" is **mostly vestigial**: ~90% of `shadow`-named symbols are the load-bearing deterministic-bearing scorer and audit logs of the *real* gated pipeline.
- A **genuine** legacy method + true shadow comparison still exist, but they execute **only when `ENABLE_BEARING_GATING` is false** — which is the code default and the documented-true `.env.example` value disagree on.
- Action order: (1) fix the default so modern-only is guaranteed, (2) delete the legacy path + migrate its tests, (3) rename the misleading `shadow` symbols to `deterministicBearing` / `…SelectionAudit`.
