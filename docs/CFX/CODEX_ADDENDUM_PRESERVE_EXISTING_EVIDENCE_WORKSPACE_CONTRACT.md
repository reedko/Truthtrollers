# Codex Addendum: Preserve and Reuse the Existing Production Evidence Workspace Contract

This addendum modifies the locked CFX document-centric evidence plan.

## Governing correction

Before implementing any new persistence, linking, or Workspace rendering behavior, trace and preserve the exact production evidence contract that already works.

The existing production behavior is the target compatibility contract:

```text
case claims on the left
evidence documents on the right
evidence document opens to show extracted reference assertions
user can manually link reference assertions to case claims
clicking a case claim shows:
  - document-level evidence links
  - case-claim → evidence-assertion links
  - support/refute/nuance stance
  - numeric stance/support rating
  - confidence and other existing metrics
```

CFX must produce data that feeds this existing UI and existing database structures.

Do not replace these structures unless the audit proves one cannot support the required behavior.

## Required diligence pass before coding

Trace one known-good legacy Evidence Engine run end to end.

Use a production fixture or historical task whose Workspace page correctly shows:

- case claims;
- evidence documents;
- successful versus failed scrape states;
- extracted assertions inside evidence documents;
- manual linking controls;
- document-level links when a case claim is selected;
- assertion-level support/refute/nuance links;
- numeric support/stance ratings;
- confidence and other metrics currently rendered.

For that known-good task, document:

1. which backend route starts the evidence run;
2. which orchestration function generates each artifact;
3. which tables receive:
   - evidence documents;
   - extracted evidence assertions;
   - document-level case-claim links;
   - evidence-assertion-to-case-claim links;
   - stance;
   - numeric support/rating;
   - confidence;
   - scrape status;
   - verification status;
4. which API routes load those rows into Workspace;
5. which frontend components render each relationship;
6. how failed scrape, snippet-only, abstract-only, and full-text states are displayed;
7. how manual user-created links differ from AI-created links;
8. how reruns update or preserve existing links;
9. how user-verified links are protected;
10. how `content_relations`, `reference_claim_links`, `reference_claim_task_links`, `claim_sources`, `content_claims`, `claims`, and related tables interact.

Use concrete file paths, function names, SQL, and line references.

## Required compatibility matrix

Create a side-by-side matrix:

| Existing production behavior | Existing producer | Existing table/fields | Existing API consumer | Existing Workspace renderer | CFX producer after change |
|---|---|---|---|---|---|

Cover at minimum:

- evidence document creation;
- evidence document scrape status;
- reference assertion extraction;
- document-level claim link;
- assertion-level claim link;
- stance;
- numeric support/rating;
- confidence;
- rationale;
- quote/evidence text;
- offsets/source location;
- manual linking;
- AI linking;
- user verification;
- rerun/idempotency behavior.

## Implementation rule

Prefer:

```text
new CFX logic
→ existing production persistence functions
→ existing production tables
→ existing production API payloads
→ existing Workspace rendering
```

over:

```text
new CFX logic
→ new parallel tables
→ new parallel API
→ new parallel UI
```

The new document-centric bearing stage should generate the same durable product objects the legacy engine generated:

```text
evidence document
evidence assertion
document-level discovery link
assertion-level target-relative link
stance
numeric rating/support level
confidence
rationale
quote/excerpt
scrape/access status
```

Where CFX adds new provenance such as:

- acquired text version;
- prompt hash;
- schema hash;
- validation status;
- target inventory hash;
- exact block offsets;

store that in narrow companion provenance records without breaking the existing product contract.

## Do not reinterpret existing fields casually

Before writing to:

```text
stance
score
support_level
confidence
rationale
evidence_text
quote
scrape_status
```

determine their actual current meaning from the legacy producer and Workspace consumer.

Preserve existing semantics where users already see them.

If CFX's governed relation differs from the legacy enum, add a compatibility mapping while preserving the original CFX relation in provenance.

## Required stop point

Do not implement Phase 1 schema changes or Phase 3 persistence until this compatibility audit is complete and reviewed.

The next report must answer plainly:

```text
Can CFX produce the same Workspace-visible document links,
reference assertions,
assertion-level links,
stances,
ratings,
and metrics using the existing production structures?
```

The expected answer should identify exactly which existing functions and tables will be reused and which small adapter or provenance additions are needed.

## Required artifacts

```text
artifacts/claim-foundry/cfx/document-centric-bearing/
  legacy-production-evidence-flow.md
  legacy-production-evidence-flow.json
  workspace-compatibility-contract.md
  workspace-compatibility-matrix.md
  known-good-task-data-trace.md
  existing-producer-consumer-map.md
  cfx-to-production-persistence-map.md
  unresolved-compatibility-gaps.md
```

Do not add new guards, scoring systems, or UI concepts in this audit.
Do not redesign the Workspace.
Do not replace the existing link tables.
Do not reactivate the legacy orchestration.
Study how it worked, then make CFX write the same product objects through the existing production pathways.
