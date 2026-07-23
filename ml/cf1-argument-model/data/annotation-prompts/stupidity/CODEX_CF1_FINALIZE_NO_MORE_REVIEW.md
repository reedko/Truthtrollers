# Codex: finalize CF1 adjudicated dataset without another human-review loop

The user has explicitly ended the recursive manual-adjudication process.

Use these inputs:

1. `CF1-focused-adjudication-ALL-448-decisions.json`
2. The existing candidate directory:
   `data/adjudication-candidates/argument-drafts-v1-r2`
3. The existing automatic and exception-resolution tooling.

## Binding interpretation

All 448 focused decisions are resolved:

- 304 deterministic automatic resolutions
- 144 assistant-adjudicated exception resolutions
- 0 remaining unreviewed

Do not generate another HTML review packet.
Do not request another human pass.
Do not reopen accepted split children, remapped relations, consistency findings, rubric mappings, attribution decisions, passage coverage, or prohibition checks.

## Provenance

This is model-assisted data, not independently verified human gold.

Every generated fixture, row, manifest, and report must record:

```json
{
  "adjudicationSource": "assistant_adjudicated",
  "independentHumanGold": false,
  "humanReviewRequired": false
}
```

Do not call the dataset `human_gold`.

## Required work

1. Validate the complete 448-decision file against the candidate hashes and manifest.
2. Apply all decisions deterministically.
3. Materialize the remapped and fanned-out relations.
4. Materialize the resolved consistency findings.
5. Apply split-child edits, including source/deployment corrections and portfolio overrides.
6. Apply passage-coverage and attribution resolutions.
7. Persist evaluation-key reconciliation and prohibited-interpretation outcomes.
8. Keep evidence targets and warrants blank and excluded.
9. Produce final adjudicated fixture JSON files.
10. Produce training and evaluation rows for all approved task families except evidence-target and warrant generation.
11. Run schema, reference-integrity, duplicate-ID, lineage, and dangling-reference validation.
12. Write a final manifest and compilation report.

## Approval semantics

The compiler's old `draft` safeguard was appropriate before the residual queue was resolved. The queue is now fully adjudicated.

Use a status such as:

```text
assistant_adjudicated
```

rather than `approved_human_gold`.

This status is sufficient for model training, prompt evaluation, regression testing, and benchmark development.

## Failure policy

Fail only on objective structural problems:

- schema violation
- hash mismatch
- dangling reference
- duplicate ID
- invalid enum
- missing lineage
- unresolved decision key

Do not fail because an independent human did not click every record.

## Deliverables

Return:

- nine final adjudicated fixture files
- training rows
- evaluation rows
- final manifest
- final compilation report
- validation report
- exact counts by fixture and task
- files changed and generated artifacts separately

Do not commit unless explicitly asked.
