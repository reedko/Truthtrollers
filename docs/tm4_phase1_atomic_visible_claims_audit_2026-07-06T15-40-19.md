# TM4 Phase 1: Atomic Visible Claims Extraction Audit
**Timestamp:** 2026-07-06T15-40-19
**Status:** Atomic visible-claim extraction with sourceSentenceIds (no evidence, no synthesis, no reducer)

## Setup
- Fixture: vaccine_article.html
- LLM model: gpt-4o-mini
- Temperature: 0.1
- Max claims per section: 10 (hard cap; prompt prefers 6-10)
- Section concurrency: 3

## Semantic Sections
**Count:** 15

| Section | Heading | Claims | Sentences | Runtime |
|---------|---------|--------|-----------|---------|
| 0 | • “We are exposed to more aluminum by eating a tomato than from getting vaccines!” | 4 | 5 | 12.3s |
| 1 | • “The type of mercury in vaccines – ethylmercury – is NOT harmful to us.” | 6 | 22 | 16.6s |
| 2 | People Who Do the Research | 6 | 28 | 17.5s |
| 3 | CDC | 9 | 29 | 22.6s |
| 4 | CDC | 10 | 36 | 24.4s |
| 5 | The Next Round of Gatekeeping and Censorship | 8 | 34 | 22.9s |
| 6 | Examining Public Health’s “Truths” About Vaccines | 8 | 33 | 18.4s |
| 7 | Dangerous Chemicals in Vaccines? | 8 | 21 | 23.3s |
| 8 | THE FACTS / ALUMINUM: | 2 | 4 | 6.6s |
| 9 | DTaP – 330-625 mcg. Administered at 2 months, 4 months, 6 months, 18 months, and 4 years. | 9 | 22 | 27.1s |
| 10 | HiB – 225 mcg. Administered at 2 months, 4 months, 6 months, and 12 months. | 9 | 23 | 25.4s |
| 11 | CDC | 8 | 26 | 21.0s |
| 12 | CDC | 6 | 18 | 17.7s |
| 13 | CDC | 9 | 26 | 26.4s |
| 14 | CDC | 6 | 23 | 20.6s |

## Phase 1 Extraction Results

**Visible Claims:** 108

### Quality Metrics
- Canonical excerpt rebuild rate: **100.0%** (target ≥95%)
- SourceSentenceId validity: **100.0%** (target ≥95%)
- Complete sentence rate: **98.1%** (target ≥90%)
- Atomicity pass rate: **98.1%** (target ≥85%)
- Warrant hint coverage: **22.2%** (selective — high-importance claims only)

### Attribution & Substance Analysis
- Attribution-wrapped claims: **26**
- With embedded substantive claim: **33** (30.6%)

### Score Transform Distribution
```
normal:  12
invert:  4
none:    92
review:  0
```

## Example Claims

### Attribution-Wrapped Claim
**Visible:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
**Embedded Substantive:** "parents who choose not to vaccinate their children are typically highly educated"
**Article Use:** reported_neutrally
**Score Transform:** none

### Substantive Target Claim
**Visible:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
**Embedded Claim:** "parents who choose not to vaccinate their children are typically highly educated"
**Needs Substantive Target:** Yes

### Warrant Hint Examples

Claim: "In 1986, Congress removed all liability from drug companies ..."
Warrant: "This claim highlights a significant legal change affecting vaccine manufacturers."

Claim: "The 1986 act set the stage for industry capture and governme..."
Warrant: "This claim suggests a causal link between the act and subsequent issues."

## Validation
✅ Semantic sections ≈15: 15
✅ Visible claims 70-110: 108
✅ Canonical excerpt rebuild ≥95%: 100.0%
✅ SourceSentenceId validity ≥95%: 100.0%
✅ Complete sentence rate ≥90%: 98.1%
✅ Atomicity pass rate ≥85%: 98.1%
✅ Attribution-wrapped claims > 5: 26
✅ EmbeddedSubstantiveClaim > 20: 33 (30.6%)
✅ ScoreTransform diversity (normal + invert + none): N:12 I:4 O:92
✅ Warrant hints present (selective, high-importance claims only): 24 (22.2%)
✅ Runtime materially lower than 635.5s baseline: 105.6s
✅ No evidence calls: ✅
✅ No persistence: ✅
✅ No reducer calls: ✅
✅ Production unchanged: ✅

## Acceptance
✅ **AUDIT PASSES MINIMUM CRITERIA**

**Runtime:** 105.6s
**LLM calls:** 15
**No evidence:** ✅
**No persistence:** ✅
**No reducer:** ✅
**Production unchanged:** ✅
