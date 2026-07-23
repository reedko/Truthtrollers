# CF1 Assistant Adjudication Completion Report

Generated: 2026-07-23T00:32:08.185523+00:00

## Result

- Automatically resolved decisions: 304
- Assistant-resolved exceptions: 144
- Total focused decisions: 448
- Remaining unreviewed: **0**

## Assistant-resolved categories

- Split children: 27
- Relations: 43
- Consistency findings: 11
- Passage coverage: 1
- Attribution spot checks: 5
- Evaluation-key targets: 52
- Prohibited interpretations: 5

## Provenance classification

This package is **assistant-adjudicated model-assisted data**. It is not independently verified human gold.

The user explicitly directed the project to end the recursive manual-review loop. No further human review is required for this build. Codex may compile training and evaluation rows, provided every output retains:

```text
adjudicationSource = assistant_adjudicated
independentHumanGold = false
```

Evidence-target and warrant tasks remain excluded because those fields were model-generated templates rather than adjudicated labels.

## Key decisions

- All unresolved split children were adjudicated.
- All affected relations were remapped or fanned out explicitly.
- All consistency findings were resolved; one incoherent finding was removed.
- The orphaned F03 catalog passage was retained as context with `no_material_assertion`.
- Unnamed speakers were retained as `unknown`; no identities were invented.
- Every evaluation-key target was reconciled.
- All flagged prohibited interpretations were found not to be encoded as endorsed, unqualified claims.
