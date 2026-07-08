# TM4 Semantic Section Phase 2 Claim-Map Synthesis Audit
**Timestamp:** 2026-07-06T10-40-47
**Status:** Phase 2 synthesis with input normalization verification

## Setup
- Phase 1 input: tm4_semantic_section_local_extraction_audit_2026-07-06T06-32-29.json
- Prompt source: hardcoded
- LLM: gpt-4o-mini @ temp 0.2

## Input Normalization
**Flattened semantic claims:** 76
**First 5 claims:**
- [0] According to the CDC and public health authorities, parents who choose not to vaccinate their childr
- [1] CDC data reflect that half of American school children are not fully vaccinated, and at least 1 in 8
- [2] Jefferson County Public Health (JCPH) asked 'What’s the Truth about Vaccines?' in a quarter-page ad 
- [3] The ad from Jefferson County Public Health presents a light-hearted attempt to ease parents’ concern
- [4] The ad states, 'Our kids face more challenges to their immune system while playing outside than they
**Last 5 claims:**
- [71] The EPA classifies thimerosal in vaccines as toxic hazardous waste, with mercury levels in multi-dos
- [72] Formaldehyde is classified by both the National Toxicology Program and the International Agency for 
- [73] The DTaP vaccine contains aluminum, formaldehyde, and polysorbate 80, with polysorbate 80 helping to
- [74] Injecting toxic metals and chemicals into children, especially pregnant women and developing babies,
- [75] The article will discuss claims about the lack of credible studies linking vaccination to chronic di

**Claims by section:**
- section_0: 6
- section_1: 5
- section_2: 11
- section_3: 5
- section_4: 9
- section_5: 5
- section_6: 4
- section_7: 4
- section_8: 1
- section_9: 4
- section_10: 5
- section_11: 4
- section_12: 4
- section_13: 5
- section_14: 4

**Anchor distribution:**
- With Thompson: 3
- With Verstraeten: 2
- With Simpsonwood: 2
- With aluminum: 11
- With 1986 Act: 2

## Article Theme
**Thesis:** The article discusses the controversies surrounding vaccination, focusing on safety concerns, regulatory actions, and public health messaging.

**Summary:** It highlights claims about vaccine safety, the role of public health authorities, and the impact of legislation on vaccination practices, while also addressing specific ingredients and their potential risks.

**Dominant Signals:**
- vaccine safety
- public health
- legislation
- adverse reactions

## Pillars
**Count:** 4 (target ≥4)

| ID | Pillar | Supporting Claims |
|----|--------|------------------|
| P1 | Vaccine Safety | 8 |
| P2 | Public Health Messaging | 6 |
| P3 | Legislative Actions | 3 |
| P4 | Adverse Reactions and Public Response | 4 |

## Claim Assignments
**Total assignments:** 76
**Unique assigned claims:** 76
**Duplicate assignments:** 0
**Unassigned claims:** 0
**Assignment rate:** 100.0% (target 80-100%)

## Synthesized Claims
**Total:** 8 (target ≥3)

| Type | Claim | Sources | Warnings |
|------|-------|---------|----------|
| cluster_based | The CDC has reported that half of American school  | 3 | 0 |
| cluster_based | Concerns about vaccine safety have been raised reg | 4 | 0 |
| cluster_based | The 1986 act removed liability from drug companies | 3 | 0 |
| cluster_based | The CDC has conducted studies on the MMR vaccine,  | 3 | 0 |
| cluster_based | Reports of adverse reactions to vaccines, includin | 3 | 0 |
| cluster_based | Investigations by formerly pro-vaccine doctors and | 2 | 0 |
| cluster_based | Thimerosal, a mercury-based preservative, has been | 3 | 0 |
| cluster_based | The CDC's vaccination schedule for infants include | 3 | 0 |

## Cluster Audit
### Thompson data-integrity
- Status: ✅ Found
- Best claim: The CDC has conducted studies on the MMR vaccine, with whistleblower William Thompson revealing that
- Source indexes: 12, 13, 14

### Verstraeten/Simpsonwood thimerosal
- Status: ✅ Found
- Best claim: Thimerosal, a mercury-based preservative, has been linked to serious health risks, including neurode
- Source indexes: 59, 67, 69

### Aluminum injected-dose
- Status: ✅ Found
- Best claim: Concerns about vaccine safety have been raised regarding the aluminum content in vaccines. Studies s
- Source indexes: 5, 49, 52, 56

### 1986 Act / liability / schedule
- Status: ✅ Found
- Best claim: The 1986 act removed liability from drug companies for childhood vaccines, leading to an increase in
- Source indexes: 22, 23, 24


## Provenance Diagnostics
**Status:** Provenance inherited from Phase 1 or marked as not revalidated in Phase 2 (missing unit text)

- Exact matches (inherited): 0
- Normalized matches (inherited): 0
- Entity matches (inherited): 0
- Failures (inherited): 0

**Note:** Phase 2 does not revalidate excerpts when source unit text is not provided. Provenance data from Phase 1 is preserved as-is.

## Acceptance Criteria
✅ Article theme thesis not blank
✅ At least 4 pillars: 4
✅ At least 3 synthesized claims: 8
✅ Claim assignment rate 80-100%: 100.0%
✅ All cluster audit: 4/4
✅ No evidence
✅ No persistence
✅ No reducer
✅ Production unchanged

**Runtime:** 38005ms
