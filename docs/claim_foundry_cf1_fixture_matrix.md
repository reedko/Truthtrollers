# CF1 Acceptance Fixture Matrix

Status: Phase 6 planning contract
Scope: Claim Foundry only; EvidenceRun is excluded

## Frozen acceptance assignments

- `CF1-F01`: DeStefano et al. MMR vaccination case-control study.
- `CF1-F02`: Jill Erzen, “‘Deceptively Toxic’: How Regulators, Chemical Companies
  Get Away With Calling Glyphosate ‘Safe’.”
- `CF1-F03`: Ana Wolpin, “Public Health’s ‘Truth’ About Vaccines PART 1”;
  105 structural blocks; deterministically selects the long path.
- `CF1-F04`: Tom Nichols, “Russia and America Are Rediscovering the Limits of
  Nuclear Weapons”; normal path.
- `CF1-F05`: David Gorski, “The myth of the magically powerful placebo returns”;
  frozen as the multiple-named-studies fixture.

The Stanford supplements candidate was assessed but not assigned: its approximately
8,700-character article body is a normal-path five-pillar explainer, not the required
long-article fixture.

The Eric Forst “Federal Judges Rebuke Trump’s DOJ Lawfare” essay was assessed but
not assigned to F05. It names cases, historical episodes, and algorithmic examples,
but it is not a multiple-named-studies article and cannot prove study-identity
separation.

## Fixture policy

CF1 acceptance uses eight frozen, redistributable article inputs. Each fixture
contains the exact `article` request object, stable source text, and a human-authored
expectation manifest. A URL may document provenance but tests never fetch it.

Fixtures test semantic behavior, not exact model prose. Expectation manifests name
required themes, pillars, source spans, attribution hazards, and prohibited outcomes;
they do not prescribe a gold list of claims. Production prompts and code may not
contain fixture names, fixture-specific entities, or expected answers.

Planned location:

```text
backend/test/claim-foundry/fixtures/<fixture-id>/article.json
backend/test/claim-foundry/fixtures/<fixture-id>/expectations.json
```

`article.json` conforms to `cf1.claimPackage.v1` article input. The expectation
manifest is test-only and is never available to CF1 during execution.

## Required fixtures

### CF1-F01 — Straightforward argument

Shape: one explicit thesis, three distinguishable supporting pillars, limited
quotation, and a clear conclusion.

CF1 must prove that it can:

- state the article theme and thesis without replacing them with a topic label;
- recover every material pillar and select at least one useful claim per pillar;
- favor central, evidence-ready claims over incidental factual detail;
- make each selected claim compelling and legible as to what would bear on it.

### CF1-F02 — Rebuttal article

Shape: accurately presents an opposing position, then disputes its premises,
evidence, or conclusion.

CF1 must prove that it can:

- distinguish the author's thesis from the position being rebutted;
- preserve stance and attribution on quoted or paraphrased opposing assertions;
- include counterclaims only when their role is explicit;
- avoid reporting the opponent's position as the author's conclusion.

The existing vaccine regression article may seed this fixture only after its text
and rights status are reviewed. Its current partial capture is not itself the gate.

### CF1-F03 — Long article

Shape: above the configured primary-call context threshold, with material claims
distributed across the beginning, middle, and end.

CF1 must prove that it can:

- invoke the documented bounded long-article path;
- preserve a coherent global theme and non-duplicative pillar structure;
- retain late and cross-block claims rather than favoring the opening;
- remain within the batch, synthesis, repair, call, and token ceilings.

The synthetic Port Townsend integration article is a candidate seed because it
contains many stakeholders and distributed arguments. It must be frozen as a CF1
input rather than imported from the TM4 integration module.

### CF1-F04 — Heavy quotation and attribution

Shape: several speakers, nested quotation or paraphrase, and disagreement among
sources; the author reports more than personally asserts.

CF1 must prove that it can:

- attach each assertion to the correct speaker or authorial voice;
- preserve reported/endorsed/disputed stance distinctions;
- exclude colorful quotations that are not material to the theme;
- never turn attributed allegations into unqualified article assertions.

### CF1-F05 — Multiple named studies

Shape: at least four named studies or reports with different findings, populations,
dates, or methodological limits.

CF1 must prove that it can:

- keep study identity and finding together;
- avoid blending results across studies or converting association to causation;
- make study-dependent claims traceable to their exact supporting spans;
- express Evidence Need Cards and targets with enough specificity to locate the
  named study and test the claimed result.

### CF1-F06 — Internal contradiction

Assigned article: Rowan Jacobsen, “Obituary: Great Barrier Reef (25 Million
BC-...).”

Shape: two materially incompatible article assertions, plus nearby statements that
are merely nuanced or qualified.

CF1 must prove that it can:

- emit the planted material conflict as an internal-consistency finding;
- cite both sides with valid block/span provenance;
- explain the conflict without deciding external truth;
- avoid labeling the planted nuance as a contradiction.

### CF1-F07 — Weak or absent thesis

Assigned article: Adam Mann, “The 11 biggest unanswered questions about dark
matter.”

Shape: exploratory or descriptive writing with several topics but no defensible
central conclusion.

CF1 must prove that it can:

- represent thesis confidence as low or thesis as absent rather than invent one;
- use restrained descriptive pillars only where supported;
- select fewer claims, including zero when evidence-readiness is not justified;
- return a valid package without padding to a preferred claim count.

### CF1-F08 — Short factual report

Assigned article: Associated Press, “Magnitude 6.2 earthquake shakes part of
northern Japan.”

Shape: brief event report containing a small number of verifiable facts and no
developed argument.

CF1 must prove that it can:

- avoid fabricating semantic depth, pillars, or internal conflict;
- select only material facts and produce proportionate targets;
- preserve time, place, actor, quantity, and attribution qualifiers;
- complete through the normal path without repair under normal conditions.

## Expectation manifest contract

Each `expectations.json` records:

```json
{
  "fixtureId": "CF1-F01",
  "fixtureClass": "straightforward_argument",
  "requiredConcepts": [],
  "requiredPillars": [],
  "requiredSourceRegions": [],
  "prohibitedInterpretations": [],
  "expectedExecutionPath": "normal",
  "humanReviewNotes": []
}
```

Concept matching is semantic and reviewer-scored. Structural checks may use IDs and
source regions, but acceptance must not depend on exact claim wording or ordering.

## Fixture construction and approval

Before CF1 model implementation, each candidate is reviewed for licensing/privacy,
normalized once, assigned a SHA-256 digest, and committed with its expectation
manifest. Two reviewers approve expectations without seeing CF1 output. Changes to
article text or expectations require a new fixture revision and an explanation in
the comparison report.

All eight fixture articles and expectation manifests were independently approved and
frozen on 2026-07-14. Article or expectation changes require a new fixture revision,
new content hash when applicable, and renewed reviewer approval before refreezing.
