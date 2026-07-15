# CF1 Phase 4 — Repair and Failure Contract

**Status:** Planning decision for review
**Rule:** At most one semantic repair pass per CF1 run.

## 1. Repair eligibility

Repair occurs only when deterministic verification returns blocking errors explicitly classified as repairable. Invalid article input, budget exhaustion, missing source text, and oversized input are never repaired semantically.

## 2. Repair request

```js
{
  schemaVersion,
  repairAttempt: 1,
  blockingErrors: [{ code, path, message, relatedIds }],
  affectedPackageFragments: {},
  groundingBlocks: [],
  allowedPaths: []
}
```

Only affected fragments and necessary grounding blocks are sent. The full article is not resent unless the verifier explicitly marks full-context repair necessary and the remaining token budget permits it.

`allowedPaths` is computed deterministically from error codes. The model cannot expand it.

## 3. Repair response

```js
{
  repairs: [
    {
      operation: "add|replace|remove",
      path: "",
      value: null,
      rationale: "",
      sourceBlockIds: []
    }
  ],
  cannotRepair: [{ code, reason }]
}
```

Limits:

- maximum 30 repair operations
- JSON Pointer paths only
- rationale ≤1,000 characters
- source block IDs required for changed semantic assertions
- no unresolved temporary IDs after application

## 4. Mutation allowlist

Repair may change only agent-owned semantic fields implicated by verifier errors:

- semantic block annotations, not block text or offsets
- raw assertion semantic fields and grounded references
- article map and consistency findings
- selected claim semantic fields and grounded relationships
- Phase 3 target semantic fields
- Evidence Need Card roles, criteria, seeds, and article-grounded identifiers

Repair may never change:

- supplied article text or metadata
- structural block text, order, or offsets
- run, package, lineage, or deterministic local IDs
- schema/pipeline version
- hashes or timestamps
- verification or telemetry
- persistence/binding state
- model-call budgets

Every operation is validated before application. One forbidden or malformed operation rejects the entire repair response; partial repair application is not allowed.

## 5. Reverification

After atomic repair application, the entire package is normalized and verified once. Remaining blocking errors produce `verification_failed`. There is no second repair, critique, or rewrite call.

## 6. Failure taxonomy

| Failure | Retryable | Terminal behavior |
|---|---:|---|
| invalid/missing article input | no | `CF1_INVALID_INPUT` |
| unsupported/oversized article | no | `CF1_INPUT_TOO_LARGE` |
| transient model transport failure | once | `CF1_MODEL_UNAVAILABLE` if repeated |
| malformed model JSON | parser/transport retry only if no usable draft | then verification failure |
| token/time budget exceeded | no | `CF1_BUDGET_EXCEEDED` |
| unresolved agent references | repairable once | then `CF1_VERIFICATION_FAILED` |
| unsupported external fact/identifier | repairable once | then verification failure |
| forbidden repair mutation | no further repair | `CF1_REPAIR_REJECTED` |
| artifact failure after persistence | yes, no model call | package valid with warning |
| package persistence failure | deadlock/lock-timeout transaction retry only | no projection |
| VeriStrata projection failure | separate adapter retry | package remains ready |

Every terminal run writes safe diagnostics when artifact storage is available. Only verified packages are inserted into `claim_foundry_packages`.

## 7. Acceptance

- Repair is verifier-triggered, targeted, and allowlisted.
- No repair can alter source truth or deterministic identity.
- Repair applies atomically or not at all.
- The entire package is reverified.
- Only one semantic repair call is possible.
