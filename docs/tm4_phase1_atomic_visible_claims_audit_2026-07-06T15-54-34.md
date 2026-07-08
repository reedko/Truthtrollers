# TM4 Phase 1: Atomic Visible Claims Extraction Audit
**Timestamp:** 2026-07-06T15-54-34
**Status:** Atomic visible-claim extraction with sourceSentenceIds (no evidence, no synthesis, no reducer)

## Setup
- Fixture: vaccine_article.html
- LLM model: gpt-4o-mini
- Temperature: 0.1
- Max claims per section: 7 (hard cap; prompt prefers 3-5)
- Section concurrency: 3

## Semantic Sections
**Count:** 15

| Section | Heading | Claims | Sentences | Runtime |
|---------|---------|--------|-----------|---------|
| 0 | • “We are exposed to more aluminum by eating a tomato than from getting vaccines!” | 4 | 5 | 12.6s |
| 1 | • “The type of mercury in vaccines – ethylmercury – is NOT harmful to us.” | 3 | 22 | 9.5s |
| 2 | People Who Do the Research | 5 | 28 | 15.2s |
| 3 | CDC | 5 | 29 | 16.8s |
| 4 | CDC | 5 | 36 | 14.7s |
| 5 | The Next Round of Gatekeeping and Censorship | 4 | 34 | 14.1s |
| 6 | Examining Public Health’s “Truths” About Vaccines | 5 | 33 | 15.6s |
| 7 | Dangerous Chemicals in Vaccines? | 4 | 21 | 13.1s |
| 8 | THE FACTS / ALUMINUM: | 2 | 4 | 6.7s |
| 9 | DTaP – 330-625 mcg. Administered at 2 months, 4 months, 6 months, 18 months, and 4 years. | 5 | 22 | 17.3s |
| 10 | HiB – 225 mcg. Administered at 2 months, 4 months, 6 months, and 12 months. | 4 | 23 | 13.2s |
| 11 | CDC | 5 | 26 | 17.3s |
| 12 | CDC | 4 | 18 | 14.8s |
| 13 | CDC | 5 | 26 | 16.0s |
| 14 | CDC | 4 | 23 | 13.5s |

## Phase 1 Extraction Results

**Visible Claims:** 64

### Quality Metrics
- Canonical excerpt rebuild rate: **100.0%** (target ≥95%)
- SourceSentenceId validity: **100.0%** (target ≥95%)
- Complete sentence rate: **98.4%** (target ≥90%)
- Atomicity pass rate: **98.4%** (target ≥85%)
- Warrant hint coverage: **4.7%** (selective — high-importance claims only)

### Attribution & Substance Analysis
- Attribution-wrapped claims: **9**
- With embedded substantive claim: **9** (14.1%)

### Score Transform Distribution
```
normal:  56
invert:  5
none:    3 (4.7% — target <45%)
review:  0
```
normal + invert + review: 95.3% (target ≥55%)

### Evaluation Lane Distribution
```
candidate: 60 (target 35-60)
context:   4
ignore:    0
missing:   0
```

## Example Claims

### Score Transform Examples
**normal:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
  - articleUse: reported_neutrally, lane: candidate, why: This claim is central to understanding the demographics of vaccine hesitancy.
**invert:** "We are exposed to more aluminum by eating a tomato than from getting vaccines."
  - articleUse: used_as_opponent_claim, lane: candidate, why: This claim is presented to counter concerns about aluminum in vaccines.
**none:** "More than 8,000 names were signed on the bus’ exterior of adults and children injured or killed by vaccines."
  - articleUse: reported_neutrally, lane: context, why: neutral reporting of a fact
**review:** (no example in this run)

### Attribution → Embedded Substantive Splits ("X says Y")
- **Visible:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
  - **Speaker/Source:** CDC and public health authorities
  - **Embedded Y:** "parents who choose not to vaccinate their children are typically highly educated"
  - needsAttributionTarget: true, needsSubstantiveTarget: true, transform: normal
- **Visible:** "Senior CDC scientist turned whistleblower William Thompson revealed privately in 2014 that data linking the MMR vaccine to autism had been manipulated by the agency ten years earlier."
  - **Speaker/Source:** William Thompson
  - **Embedded Y:** "data linking the MMR vaccine to autism had been manipulated"
  - needsAttributionTarget: true, needsSubstantiveTarget: true, transform: normal
- **Visible:** "James Lyons-Weiler and Robert Ricketson claim that the levels of aluminum suggested by currently used limits place infants at risk of acute, repeated, and possibly chronic exposures of toxic levels of aluminum in modern vaccine schedules."
  - **Speaker/Source:** James Lyons-Weiler and Robert Ricketson
  - **Embedded Y:** "the levels of aluminum suggested by currently used limits place infants at risk of acute, repeated, and possibly chronic exposures of toxic levels of aluminum in modern vaccine schedules"
  - needsAttributionTarget: true, needsSubstantiveTarget: true, transform: normal

### Attribution-Wrapped Claim
**Visible:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
**Embedded Substantive:** "parents who choose not to vaccinate their children are typically highly educated"
**Article Use:** reported_neutrally
**Score Transform:** normal

### Substantive Target Claim
**Visible:** "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
**Embedded Claim:** "parents who choose not to vaccinate their children are typically highly educated"
**Needs Substantive Target:** Yes

### Warrant Hint Examples

Claim: "The article discusses a suppressed 1999 study linking thimer..."
Warrant: "study linking thimerosal to autism"

Claim: "Pharma-funded politicians were advancing legislation to remo..."
Warrant: "policy implications of vaccine narrative"

## All Extracted Claims

### Section 0: • “We are exposed to more aluminum by eating a tomato than from getting vaccines!”
1. "According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated."
   - form: attributed_assertion | use: reported_neutrally | transform: normal | lane: candidate
   - embedded: "parents who choose not to vaccinate their children are typically highly educated"
2. "CDC data reflect that half of American school children are not fully vaccinated."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "half of American school children are not fully vaccinated"
3. "At least 1 in 88 toddlers are completely unvaccinated."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "at least 1 in 88 toddlers are completely unvaccinated"
4. "We are exposed to more aluminum by eating a tomato than from getting vaccines."
   - form: comparison_claim | use: used_as_opponent_claim | transform: invert | lane: candidate
   - embedded: "more aluminum is consumed by eating a tomato than from vaccines"

### Section 1: • “The type of mercury in vaccines – ethylmercury – is NOT harmful to us.”
1. "The type of mercury in vaccines – ethylmercury – is NOT harmful to us."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "So far, there have been no credible studies that link vaccination to chronic disease."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "Vaccines are tested more than any other medicine you could give your kid."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate

### Section 2: People Who Do the Research
1. "In 2016, a documentary film disclosing a decade-long CDC cover-up created an uproar in the news."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Senior CDC scientist turned whistleblower William Thompson revealed privately in 2014 that data linking the MMR vaccine to autism had been manipulated by the agency ten years earlier."
   - form: attributed_assertion | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "data linking the MMR vaccine to autism had been manipulated"
3. "When top CDC officials learned that their 2004 study results showed a dramatic increase in autism after MMR vaccinations, they’d ordered Thompson and other scientists to destroy all evidence."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "The fraudulent, re-worked study was then released to declare that it had proven MMR vaccines did not cause autism."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
5. "The CDC had conducted the study in response to petitions from over 5,000 parents in vaccine court who had witnessed their children regress into autism from the MMR shot."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate

### Section 3: CDC
1. "In the 1980s, pharmaceutical companies were losing so much money settling lawsuits for vaccine injury that the industry threatened to stop making vaccines unless the government shielded them from damages."
   - form: causal_claim | use: endorsed_by_article | transform: normal | lane: candidate
2. "In 1986 Congress removed all liability from drug companies for childhood vaccines they produced."
   - form: legal_policy_claim | use: endorsed_by_article | transform: normal | lane: candidate
3. "The childhood chronic illness rate in U.S. children jumped to 12.8% in the 1980s, then to 54% by 2011."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
4. "After embarking on the world’s most aggressive vaccination program, the U.S. had twice as many first-day infant deaths as all 27 EU nations combined."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
5. "An analysis of two decades of U.S. data (1990-2010) showed that infants who received the most vaccines had the worst hospitalization and death rates."
   - form: study_claim | use: endorsed_by_article | transform: normal | lane: candidate

### Section 4: CDC
1. "More than 8,000 names were signed on the bus’ exterior of adults and children injured or killed by vaccines."
   - form: direct_assertion | use: reported_neutrally | transform: none | lane: context
2. "The HighWire was launched around the same period, hosted by Del Bigtree who had produced Vaxxed."
   - form: direct_assertion | use: reported_neutrally | transform: none | lane: context
3. "The article discusses a suppressed 1999 study linking thimerosal in vaccines to neurodevelopmental disorders and to the exponentially-increasing autism rates."
   - form: study_claim | use: endorsed_by_article | transform: normal | lane: candidate
   - warrant: study linking thimerosal to autism
4. "Pharma-funded politicians were advancing legislation to remove people’s religious and personal medical vaccine exemptions."
   - form: legal_policy_claim | use: endorsed_by_article | transform: normal | lane: candidate
   - warrant: policy implications of vaccine narrative
5. "Doctors and scientists who raised concerns about vaccine dangers were persecuted by the industry-controlled medical establishment."
   - form: causal_claim | use: endorsed_by_article | transform: normal | lane: candidate
   - warrant: impact on medical discourse

### Section 5: The Next Round of Gatekeeping and Censorship
1. "Over one hundred legislative bills were pending to eradicate vaccination choice in forty states."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "The Uptown Theater was closed during this time period, so there was no possibility of Vaxxed showing there."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "Publisher Lloyd Mullen rejected the flyer for the vaccine study guide, stating, 'Unfortunately, we will not be able to print or insert your flyer in our newspaper.'"
   - form: quoted_claim | use: used_as_opponent_claim | transform: invert | lane: candidate
4. "The Leader refused to print letters to the editor that challenged public health’s Covid messaging."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate

### Section 6: Examining Public Health’s “Truths” About Vaccines
1. "A child’s immune system can handle a lot."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Following the introduction of national vaccination programs in the U.S., SIDS became the leading cause of infant mortality."
   - form: causal_claim | use: used_as_opponent_claim | transform: invert | lane: candidate
3. "17% of deaths reported to the Vaccine Adverse Events Reporting System (VAERS) occurred on the day of vaccination."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
4. "48 percent of deaths reported to VAERS occurred within two days of vaccination."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
5. "78.3 percent of deaths reported to VAERS occurred within seven days post-vaccination."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate

### Section 7: Dangerous Chemicals in Vaccines?
1. "An intramuscular injection bypasses all these intricate protective mechanisms, sending the needle’s contents directly into the bloodstream."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Toxic adjuvants (such as aluminum) can cross the blood-brain barrier."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "If a single vaccine can cause SIDS in a small percentage of babies, how many children might have damage on a lesser scale from the dozens of shots received in just the first year of life?"
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "Typically a 'Well Baby Visit' consists of numerous vaccines all administered on the same day."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate

### Section 8: THE FACTS / ALUMINUM:
1. "Aluminum occurs naturally in the air, water and soil."
   - form: direct_assertion | use: reported_neutrally | transform: none | lane: context
2. "We are exposed to more aluminum by eating a tomato than from getting vaccines!"
   - form: comparison_claim | use: endorsed_by_article | transform: normal | lane: candidate

### Section 9: DTaP – 330-625 mcg. Administered at 2 months, 4 months, 6 months, 18 months, and 4 years.
1. "James Lyons-Weiler and Robert Ricketson claim that the levels of aluminum suggested by currently used limits place infants at risk of acute, repeated, and possibly chronic exposures of toxic levels of aluminum in modern vaccine schedules."
   - form: attributed_assertion | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "the levels of aluminum suggested by currently used limits place infants at risk of acute, repeated, and possibly chronic exposures of toxic levels of aluminum in modern vaccine schedules"
2. "Aluminum has no physiological role in the body, and whether ingested, inhaled, or injected, isolated aluminum is toxic."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "Injecting aluminum through a vaccination bypasses the digestive protections, placing it directly into the bloodstream."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "The FDA established a maximum limit of 850 mcg of aluminum per vaccine dose in the mid-1900s."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: context
5. "Safety limits for neonates were set at 4-5 mcg per kilogram of body weight, limited to 25 mcg aluminum per day."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate

### Section 10: HiB – 225 mcg. Administered at 2 months, 4 months, 6 months, and 12 months.
1. "Current vaccination schedules in which multiple shots are administered in a single visit exceed even the 850 mcg limit."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "For parents following the CDC schedule, aluminum injected at the 2-, 4-, and 6-month 'Well Baby Visits' can exceed 1000 mcg."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "The CDC has NEVER safety tested this cumulative load received in multiple shots."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "The dosing of aluminum in vaccines is based on the production of antibody titers, not safety science."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate

### Section 11: CDC
1. "Thimerosal is toxic and mutagenic in mammalian cells."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Injected ethylmercury has been shown to deposit in the brain and other organs far more readily than methylmercury."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "A 2005 University of Washington study demonstrated that injected thimerosal crosses the placenta and blood-brain barriers at high levels."
   - form: study_claim | use: endorsed_by_article | transform: normal | lane: candidate
4. "Infants exposed to high levels of thimerosal during their first month of life had 7.6 times higher risk of autism diagnosis than their unexposed peers."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate
5. "The June 2000 emergency meeting was held to discuss how to hide the results of the thimerosal study from the public."
   - form: legal_policy_claim | use: endorsed_by_article | transform: invert | lane: candidate

### Section 12: CDC
1. "Dr. John Clements from the WHO’s Expanded Program on Immunization stated that any information leaking to the public that could lead to vaccine hesitancy was not permissible."
   - form: attributed_assertion | use: used_as_opponent_claim | transform: invert | lane: candidate
   - embedded: "any information leaking to the public that could lead to vaccine hesitancy was not permissible"
2. "The CDC released a reworked version of the Verstraeten Study in 2003, claiming that thimerosal did not cause autism and other neurodevelopmental problems."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "The CDC's cover-up of thimerosal’s toxicity included statements claiming that thimerosal is less likely to cause harm than methylmercury."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "The US Public Health Service and American Academy of Pediatrics called for the immediate removal of thimerosal from infant vaccines."
   - form: attributed_assertion | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "immediate removal of thimerosal from infant vaccines"

### Section 13: CDC
1. "Thimerosal has NOT vanished from the childhood schedule."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Children following the CDC’s vaccination schedule receive flu shots annually until they are 18."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
3. "RFK Jr’s 2015 compilation of studies claims that thimerosal is a potent neurotoxin that causes neurological damage."
   - form: attributed_assertion | use: endorsed_by_article | transform: normal | lane: candidate
   - embedded: "thimerosal is a potent neurotoxin that causes neurological damage"
4. "The EPA classifies the thimerosal in vaccines as toxic hazardous waste."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
5. "The mercury in multi-dose flu shots is 250 times higher than the limit for mercury in drinking water."
   - form: statistical_claim | use: endorsed_by_article | transform: normal | lane: candidate

### Section 14: CDC
1. "Formaldehyde is classified by both the National Toxicology Program and the International Agency for Research on Cancer as a known human carcinogen."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
2. "Formaldehyde oxidizes into formic acid, a neurotoxin which can damage both the liver and the kidneys."
   - form: causal_claim | use: endorsed_by_article | transform: normal | lane: candidate
3. "The DTaP vaccine formulations contain aluminum, formaldehyde, and polysorbate 80."
   - form: direct_assertion | use: endorsed_by_article | transform: normal | lane: candidate
4. "The polysorbate 80 helps deliver the aluminum into the brain and other organs."
   - form: causal_claim | use: endorsed_by_article | transform: normal | lane: candidate

## Validation
✅ Semantic sections ≈15: 15
✅ Visible claims 55-75: 64
✅ Canonical excerpt rebuild ≥95%: 100.0%
✅ SourceSentenceId validity ≥95%: 100.0%
✅ Complete sentence rate ≥90%: 98.4%
✅ Atomicity pass rate ≥85%: 98.4%
❌ Attribution-wrapped claims > 10: 9
❌ EmbeddedSubstantiveClaim > 20: 9 (14.1%)
✅ ScoreTransform diversity (normal + invert present): N:56 I:5 X:3 R:0
✅ ScoreTransform none < 45%: 4.7%
✅ ScoreTransform normal+invert+review ≥ 55%: 95.3%
✅ EvaluationLane candidate 35-60: 60
✅ EvaluationLane context+ignore does not dominate: candidate:60 context:4 ignore:0 missing:0
✅ Warrant hints present (selective, high-importance claims only): 3 (4.7%)
✅ Runtime near or below 105s: 73.1s
✅ No evidence calls: ✅
✅ No persistence: ✅
✅ No reducer calls: ✅
✅ Production unchanged: ✅

## Acceptance
⚠️ **AUDIT HAS UNMET CRITERIA**

**Runtime:** 73.1s
**LLM calls:** 15
**No evidence:** ✅
**No persistence:** ✅
**No reducer:** ✅
**Production unchanged:** ✅
