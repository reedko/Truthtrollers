# TICKET — CF4 S5: stance anchor drops a major thesis (root cause of Thompson-crux failure)

Date: 2026-07-26
Scope: `backend/experiments/cf4/` S5 stance-anchor generation ONLY. Do NOT change S5b
decomposition, S6 selection, extraction, or coref — the raw data shows all of those work
correctly. This fixes the ONE broken link.

## Diagnosis (read directly from raw F03 selection files, no scoring involved)

The F03 stance anchor is:
"The article argues that vaccines, containing toxic substances like aluminum and mercury,
are unsafe and that public health authorities perpetuate a misleading narrative about
vaccine safety, suppressing contrary evidence and censoring dissenting views."

Its S5b sub-theses are all about (a) toxic ingredients and (b) suppression/censorship.
**There is no fraud / data-manipulation thesis.** But the article's SECOND major
load-bearing pillar is exactly that: the CDC manipulated the MMR-autism study data,
ordered evidence destroyed, and released a fraudulent study (the Thompson story,
extracted cleanly as C0101, C0107, C0641, C0646).

Chain of failure, every stage working correctly on a bad input:
1. S5 produced an anchor covering the toxins+suppression thesis but OMITTING the
   fraud/cover-up thesis. The anchor is a SUBSET of the article's actual argument.
2. S5b faithfully decomposed the incomplete anchor -> six sub-theses that inherit the
   omission. Sub-thesis 5 ("suppress evidence") is the closest survivor, but the Thompson
   crux (specific scientific fraud) maps onto it only WEAKLY — general suppression is not
   specific data-fabrication.
3. S6 faithfully selected content matching the sub-theses it was given: aluminum, mercury,
   thimerosal — correct for those sub-theses. Thompson never won because it had no sharp
   sub-thesis to be central to; claims like "hide the results from the public" (C0605)
   and "conspired to deceive the public" (C0573) mapped to sub-thesis 5 more directly and
   crowded it out.

This DISPROVES the earlier scale hypothesis (772 items overwhelming the model). Selection
tracked its target coherently. The target was missing a pillar.

## The fix — S5 must carry the article's distinct major theses, not compress to one

A sprawling advocacy article can have MORE THAN ONE central thesis. F03 has two:
(1) vaccines contain toxic ingredients that make them unsafe; (2) health authorities
committed and concealed scientific fraud to hide vaccine harm. A single concise sentence
structurally cannot hold both, and S5 dropped the second.

Change S5 to emit the article's distinct central claims (1–3), not one summary sentence.

**SYSTEM**
```text
You state the central position an article's argument defends.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.
```

**USER (task section)**
```text
TASK

State the article's central position. If the article's argument rests on more than one
distinct major claim, state each as its own concise assertion. Include every claim the
article's case centrally depends on; do not merge distinct major claims into a single
summary, and do not drop one to keep the statement short.
```

**SCHEMA — `cf4_stance_anchor_v2` (strict)**
```json
{
  "name": "cf4_stance_anchor_v2",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["centralClaims"],
    "properties": {
      "centralClaims": {
        "type": "array",
        "minItems": 1,
        "maxItems": 3,
        "items": { "type": "string" }
      }
    }
  }
}
```

Downstream wiring:
- S5b decomposes EACH central claim into sub-theses (concatenate, then run the existing
  redundancy guard across the full combined set so duplicate sub-theses across claims are
  caught).
- S6 receives all central claims + all sub-theses as the reference. Objective unchanged.

## GUARDS

1. Do NOT over-split. A focused article (F02, F06) has ONE central claim and must still
   produce one. maxItems:3 is a ceiling, not a target. If S5 returns 3 near-duplicate
   claims for a single-thesis article, that is the failure mode — the redundancy NLI check
   (reuse S5b's) must flag centralClaims that are mutual entailments.
2. This is NOT the CF1 theme/thesis machinery. No importance scores, no thesis typing.
   Just the distinct central claims, each concise.

## VALIDATION / RE-GATE (in order)

R1  F02/F06 no-regression FIRST: each must return ONE central claim (they are single-
    thesis), and their existing selection behavior must be unchanged. If F02/F06 now
    return multiple claims or their crux coverage regresses, STOP — over-splitting.
R2  F03 is the test: S5 must return TWO central claims — the toxins thesis AND the
    fraud/cover-up thesis. Confirm the fraud claim is present by reading it. Then S5b must
    produce a fraud/manipulation sub-thesis, and S6 (5 repeats) must float the Thompson
    crux (C0101 or C0107, or C0641/C0646) in >=4/5.
R3  If S5 STILL omits the fraud thesis, the fix is insufficient and the S5 prompt needs
    the article's multi-pillar structure surfaced more directly — but check R2 first.

## SEQUENCING
Independent of the eval-overlay-consistency ticket (that fixes the grader; this fixes the
anchor). Both can proceed. But read S5's F03 output BY EYE — the fraud thesis is either in
centralClaims or it isn't, no scoring needed to tell.

## OUTPUT
S5 centralClaims for F02/F03/F06, the F03 sub-theses after decomposing both claims, and
the F03 Thompson-crux float rate over 5 repeats under the multi-claim anchor.
