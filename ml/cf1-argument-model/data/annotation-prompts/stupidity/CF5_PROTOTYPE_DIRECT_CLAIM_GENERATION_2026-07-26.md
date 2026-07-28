# CF5 Prototype: Direct Evaluation Claim Generation

## Objective

We have reached an architectural conclusion after extensive experimentation.

The current CF4 pipeline attempts to discover the article's evaluation claims indirectly:

```
Article
→ preprocess
→ deterministic assertion extraction
→ normalize
→ hundreds of candidate assertions
→ thesis
→ pillars
→ semantic mapping
→ portfolio selection
→ evaluation claims
```

This architecture has become increasingly complex while still producing unstable semantic
results.

Recent experiments demonstrate that the LLM can instead directly generate the article's
principal evidence-bearing propositions with substantially higher semantic quality.

The new hypothesis is:

> Evaluation claims should be generated directly, not discovered by filtering hundreds of
> extracted assertions.

## Preserve

Do NOT remove infrastructure that remains valuable.

Keep:

- article preprocessing
- HTML/PDF normalization
- source-unit segmentation
- source-unit IDs
- citation preservation
- attribution metadata
- identity extraction
- provenance tracking
- grounding verification
- deterministic validation
- repair loop
- structured JSON outputs
- logging
- diagnostics
- replay harness
- fixture framework

These remain the deterministic backbone.

## Remove from the semantic pipeline

Temporarily remove the following concepts from the prototype.

- No deterministic candidate assertion generation.
- No exhaustive assertion inventory.
- No assertion normalization.
- No semantic clustering.
- No thesis-to-candidate mapping.
- No pillar assignment.
- No portfolio selection from hundreds of candidates.
- No "importance ranking" across atomic assertions.
- No semantic reduction stage.

The prototype should not attempt to recover evaluation claims by filtering atomic
assertions.

## Replace with

After preprocessing:

```
Article
  ↓
LLM
  Generate the article's independent evidence-bearing propositions.
  ↓
Host validation
  ↓
Repair if required
  ↓
Final Claim Package
```

## LLM Objective

The model should answer only one question:

> Which independent truth-bearing propositions would an investigator need to verify in
> order to determine whether this article's central case succeeds or fails?

Not: "What assertions exist?"

Not: "What sentences are important?"

Instead: "What propositions determine the truth of the article?"

## Output Target

Produce approximately 8–15 evaluation claims.

Each claim should be:

- atomic where practical
- independently falsifiable
- evidence searchable
- load-bearing
- grounded in explicit source units
- suitable for direct EvidenceRun evaluation

Do not include:

- background
- rhetoric
- examples
- transitions
- anecdotes
- narrative color
- duplicated propositions
- recommendations
- implications unless explicitly argued as claims

## Each Evaluation Claim Should Contain

- canonical proposition
- grounding source units
- assertion source
- attribution chain
- article treatment
- identity bundle
- cited works
- search hints
- evidence warrant
- bearing criteria
- confidence
- repair diagnostics

Generate these directly. Do not derive them from a separate candidate assertion
inventory.

## Deterministic Validation

Host code should verify:

- grounding exists
- source units exist
- proposition is atomic enough
- duplicates removed
- provenance complete
- required fields populated

If validation fails: perform one repair pass. No semantic re-selection.
