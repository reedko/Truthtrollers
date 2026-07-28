# `cf1.claimPackage.v1` — Complete Single-File Reference

This document consolidates the current CF1 claim-package contract into one
readable file. It describes the executable package assembled, verified, persisted,
and handed to EvidenceRun by the repository.

The contract is currently implemented across JavaScript modules rather than as one
standalone JSON Schema.

## 1. Canonical identity

```js
export const CF1_SCHEMA_VERSION = "cf1.claimPackage.v1";
export const CF1_PIPELINE_VERSION = "cf1.0.0";
```

Source: `backend/src/claim-foundry/contract.js`.

The public package is assembled by `assembleCf1Package()`, verified by
`verifyCf1Package()`, finalized by `finalizeCf1Package()`, and persisted only after
its canonical hash has been verified.

## 2. Complete top-level package shape

```json
{
  "schemaVersion": "cf1.claimPackage.v1",
  "pipelineVersion": "cf1.0.0",
  "packageId": "cf1pkg_...",
  "packageVersion": 1,
  "supersedesPackageId": null,
  "runId": "cf1run_...",
  "status": "ready_for_evidence",
  "createdAt": "2026-07-27T00:00:00.000Z",

  "article": {},
  "sourceDocument": {},
  "sourceAtoms": [],
  "sourceUnits": [],
  "sourceLinks": [],
  "sourceCitationMarkers": [],
  "sourceReferences": [],
  "sourceIdentityBundles": [],

  "semanticBlocks": [],
  "rawAssertions": [],
  "articleMap": {},
  "internalConsistencyFindings": [],
  "selectedEvaluationClaims": [],
  "phase3Targets": [],
  "evidenceNeedCards": [],

  "diagnostics": {},
  "verification": {},
  "packageHash": ""
}
```

Maximum serialized package size is 10 MiB. Diagnostic data is limited to 1 MiB.

## 3. Article and source representation

### `article`

```json
{
  "consumerContentRef": "optional consumer identifier",
  "title": "required title",
  "text": "required article text",
  "url": "optional absolute URL",
  "publisher": "optional publisher",
  "authors": ["author names"],
  "publishedAt": "optional ISO-8601 timestamp",
  "language": "optional BCP-47 language",
  "observedHeadline": "optional observed headline",
  "metadataWarnings": [],
  "contentHash": "lowercase SHA-256"
}
```

### `sourceDocument`

The package preserves the identity of the deterministic `ArticleDocument` used to
construct source atoms and units:

```json
{
  "schemaVersion": "cf1.articleDocument.v3",
  "sourceKind": "article",
  "sourceFamily": "article",
  "adapterIdentity": {},
  "structureProfile": {},
  "contentHash": "",
  "metadata": {
    "bibliographicMetadata": {}
  },
  "sourceDescriptor": {},
  "diagnostics": {}
}
```

### `sourceAtoms`

Atoms preserve structural spans such as headings, paragraphs, quotations, list
items, tables, captions, transcript turns, and social items.

```json
{
  "atomId": "A0001",
  "order": 0,
  "type": "paragraph",
  "text": "Exact source text",
  "sourceOffsets": {
    "start": 0,
    "end": 17
  },
  "layoutSignals": {},
  "linkIds": [],
  "diagnosticFlags": []
}
```

### `sourceUnits`

Units are the package's normal grounding targets.

```json
{
  "unitId": "U0001",
  "atomId": "A0001",
  "order": 0,
  "type": "sentence",
  "text": "Exact source text",
  "sourceOffsets": {
    "start": 0,
    "end": 17
  }
}
```

Links, citation markers, and reference entries are retained separately in
`sourceLinks`, `sourceCitationMarkers`, and `sourceReferences`.

### `sourceIdentityBundles`

This host-owned pool consolidates source identity and named-work information.
Bundles contain:

- `identityBundleId`;
- `identityKind`;
- nullable `namedWorkId`;
- `assertionSources`;
- `workAuthors`;
- `workLabel`;
- nullable `publicationVenue`;
- nullable `publicationYear`;
- `publishers`;
- `institutions`;
- `unresolvedContributors`;
- normalized `identifiers`;
- `sourceUnitIds`;
- `articleReferenceIds`;
- `articleLinkIds`;
- `resolutionStatus`.

Unknown metadata remains `null` or an empty array. Article citations and URLs are
retrieval leads, not verified evidence.

## 4. Semantic blocks

Each `semanticBlocks[]` entry preserves deterministic structure and model-produced
interpretation:

```json
{
  "blockId": "B001",
  "order": 0,
  "heading": "Optional heading",
  "text": "Exact article span",
  "structuralType": "paragraph_group",
  "semanticFunction": "endorsed_assertion",
  "articleStance": "endorses",
  "speakerEntities": [],
  "sourceAtomIds": ["A0001"],
  "sourceUnitIds": ["U0001"],
  "sourceOffsets": {
    "start": 0,
    "end": 17
  },
  "relatedBlockIds": [],
  "confidence": 0.9
}
```

Structural types:

```text
heading_section, paragraph_group, quotation, list, table, caption,
transcript, social_thread, mixed, other
```

Semantic functions:

```text
thesis_framing, background, chronology, endorsed_assertion,
opponent_position, rebuttal, evidence_example, study_document_description,
methodology_criticism, causal_explanation, qualification, policy_conclusion,
anecdote, call_to_action, mixed, unclear
```

Article stances:

```text
endorses, opposes, reports, mixed, unclear
```

## 5. Raw assertions

`rawAssertions[]` contains grounded working assertions. These are not directly
EvidenceRun-facing claims.

```json
{
  "rawAssertionId": "R001",
  "text": "One grounded proposition.",
  "sourceUnitIds": ["U0001"],
  "sourceBlockIds": ["B001"],
  "sourceSpans": [
    {
      "sourceUnitIds": ["U0001"],
      "text": "Exact contiguous source text",
      "start": 0,
      "end": 17
    }
  ],
  "sourceExcerpt": "Exact contiguous source text",
  "sourceOffsets": [
    {
      "start": 0,
      "end": 17
    }
  ],
  "speakerEntity": "optional grounded speaker",
  "assertionForm": "direct",
  "articleUse": "endorsed",
  "namedEntities": [],
  "namedWorks": [],
  "numbersAndDates": [],
  "reconciliation": {
    "canonicalRawAssertionId": "R001",
    "relationship": "unique",
    "relatedRawAssertionIds": [],
    "rationale": ""
  }
}
```

Assertion forms:

```text
direct, attributed, quoted, statistical, causal, comparison,
study_document, legal_policy, inference, background, other
```

Article uses:

```text
endorsed, opponent_to_rebut, rejected, reported, background,
qualification, unclear
```

Reconciliation relationships:

```text
unique, same_proposition, restatement, narrower, broader, qualifies,
contradicts, context_differs
```

## 6. Article map

```json
{
  "theme": "Whole-article subject and framing.",
  "thesis": {
    "text": "Mapped thesis proposition.",
    "sourceBlockIds": ["B001"],
    "rawAssertionIds": ["R001"]
  },
  "pillars": [
    {
      "pillarId": "P01",
      "label": "Concise label",
      "text": "Mapped pillar proposition.",
      "sourceBlockIds": ["B001"],
      "rawAssertionIds": ["R001"],
      "importance": "load_bearing"
    }
  ],
  "clusters": [
    {
      "clusterId": "C01",
      "label": "Cluster label",
      "rawAssertionIds": ["R001"],
      "relationship": "reasoning_chain"
    }
  ],
  "opponentPositions": [],
  "qualifications": [],
  "mapWarnings": []
}
```

Pillar importance:

```text
load_bearing, major, supporting
```

Cluster relationships:

```text
same_event, same_proposition_family, reasoning_chain, source_family, other
```

## 7. Internal-consistency findings

```json
{
  "findingId": "IC01",
  "type": "direct_contradiction",
  "blockIds": ["B001", "B002"],
  "rawAssertionIds": ["R001", "R002"],
  "description": "Description of the apparent inconsistency.",
  "materiality": "high",
  "resolution": "unresolved",
  "resolutionRationale": "",
  "selectionRelevance": "hinge"
}
```

Finding types:

```text
direct_contradiction, scope_shift, association_causation_shift,
attribution_fact_shift, numeric_conflict, identity_conflict,
chronology_conflict, qualification_loss, standard_inconsistency,
thesis_pillar_conflict, apparent_resolved
```

## 8. Selected evaluation claims

These are the portable claims selected for evaluation.

```json
{
  "selectedClaimId": "S01",
  "claimText": "Self-contained selected claim.",
  "sourceRawAssertionIds": ["R001"],
  "sourceUnitIds": ["U0001"],
  "sourceBlockIds": ["B001"],
  "sourceSpans": [],
  "sourceExcerpt": "",
  "sourceOffsets": [],
  "articleRole": "pillar",
  "relatedPillarIds": ["P01"],
  "materiality": "high",
  "counterfactualImpact": "What changes if this claim is false.",
  "selectionRationale": "Why this claim was selected.",
  "scoreTransform": "normal",
  "searchEligible": true,
  "verdictEligible": true,
  "confidence": 0.9
}
```

Article roles:

```text
thesis, pillar, pillar_support, opponent_claim, qualification,
consistency_hinge
```

Materiality:

```text
high, medium, low
```

Score transforms:

```text
normal, invert, none
```

The normal target is 8–12 selected claims. A different count requires
`diagnostics.selectionCountException`.

## 9. Phase 3 evidence targets

`phase3Targets[]` converts a selected claim into the exact proposition EvidenceRun
should investigate.

```json
{
  "targetId": "T001",
  "selectedClaimId": "S01",
  "targetText": "Evidence-facing proposition.",
  "targetType": "article_endorsed_substantive",
  "scoreTransform": "normal",
  "searchEligible": true,
  "verdictEligible": true,
  "sourceRawAssertionIds": ["R001"],
  "sourceUnitIds": ["U0001"],
  "sourceBlockIds": ["B001"],
  "sourceSpans": [],
  "sourceExcerpt": "",
  "sourceOffsets": [],
  "mappingStatus": "resolved",
  "mappingRationale": "Why this target maps to the selected claim."
}
```

Target types:

```text
article_endorsed_substantive, opponent_substantive,
attribution_provenance, source_identity, inference_warrant, context_scope
```

Mapping statuses:

```text
resolved, needs_review, unresolved
```

Expected posture rules include:

- article-endorsed substantive targets normally use `normal`;
- opponent substantive targets normally use `invert`;
- attribution and source-identity targets normally use `none`;
- unresolved targets cannot be verdict-eligible.

## 10. Evidence Need Cards

Every evidence target has an `evidenceNeedCards[]` entry describing what evidence
would bear on it.

```json
{
  "cardId": "ENC-T001",
  "targetId": "T001",
  "selectedClaimId": "S01",
  "targetText": "Evidence-facing proposition.",
  "targetType": "article_endorsed_substantive",
  "scoreTransform": "normal",
  "searchEligible": true,
  "verdictEligible": true,
  "evidenceRolesNeeded": ["target-primary"],
  "bearingCriteria": {
    "mustMatch": [],
    "shouldMatch": [],
    "rejectIfOnly": [],
    "weak": false
  },
  "queryLaneSeeds": [
    {
      "laneType": "target-primary",
      "query": "",
      "purpose": "",
      "sourceFieldsUsed": []
    }
  ],
  "identifierHints": {
    "doi": [],
    "pmid": [],
    "titleExact": [],
    "authorYear": [],
    "quotedDocumentNames": [],
    "canonicalSourceIds": []
  },
  "namedWorkIds": [],
  "identityBundleIds": [],
  "articleReferenceIds": [],
  "articleLinkIds": []
}
```

Evidence roles:

```text
target-primary, study-identity, attribution-provenance, official-response,
methodology-reanalysis, primary-record, context-background,
advocacy-restatement, identifier-search
```

Query-lane seeds are research instructions. They are not executed searches.

## 11. Diagnostics and verification

`diagnostics` may contain counts, selection exceptions, warnings, model-call
information, repair information, and other diagnostic-only data. It does not
change the portable claim semantics.

The final `verification` object is:

```json
{
  "valid": true,
  "blockingErrors": [],
  "warnings": [],
  "verifiedAt": "2026-07-27T00:00:01.000Z",
  "verifierVersion": "cf1-verifier-3",
  "repairAttempted": false
}
```

Issue objects have this shape:

```json
{
  "code": "CF1_ISSUE_CODE",
  "path": "/json/pointer",
  "message": "Human-readable explanation",
  "relatedIds": []
}
```

A package cannot be finalized or persisted while verification has blocking errors.

## 12. Package lifecycle

```text
Article input
  -> ArticleDocument atoms/units/references
  -> normalized semantic draft
  -> assembleCf1Package()
       status = verification_failed
       packageHash = ""
  -> verifyCf1Package()
  -> optional allow-listed repair and re-verification
  -> finalizeCf1Package()
       status = ready_for_evidence
       verification attached
       canonical packageHash computed
  -> insertCf1Package()
       verifier and hash checked again
  -> loadReadyCf1Package()
  -> EvidenceRun
```

### Assembly

`assembleCf1Package()` copies the deterministic article/source representation and
normalized semantic draft into the portable package.

Source: `backend/src/claim-foundry/assemblePackage.js`.

### Verification

`verifyCf1Package()` verifies:

- schema and pipeline versions;
- package, run, lineage, and local IDs;
- article and source-document hashes;
- array limits and field shapes;
- enum values;
- references among atoms, units, blocks, assertions, selected claims, targets,
  cards, findings, named works, and identity bundles;
- grounding and provenance;
- source identity;
- target/card consistency;
- package size;
- the final package hash when required.

Sources:

- `backend/src/claim-foundry/verifyPackage.js`;
- `backend/src/claim-foundry/verifyFieldShapes.js`;
- `backend/src/claim-foundry/verifyProvenance.js`;
- `backend/src/claim-foundry/verifySourceIdentity.js`;
- `backend/src/claim-foundry/verifyTargetCards.js`.

### Finalization

`finalizeCf1Package()` accepts only a valid, blocking-error-free verification
result, changes the status to `ready_for_evidence`, attaches verification, and
computes the canonical package hash.

Source: `backend/src/claim-foundry/assemblePackage.js`.

### Persistence

`insertCf1Package()` runs the verifier again with `requireFinalHash: true`, checks
the canonical hash, verifies lineage metadata, and inserts the immutable JSON into
`claim_foundry_packages`.

`loadReadyCf1Package()` rejects missing packages, non-ready packages, schema
mismatches, and hash mismatches.

Source: `backend/src/storage/claimFoundryPackageStore.js`.

### EvidenceRun handoff

EvidenceRun explicitly requires:

```json
{
  "expectedPackageSchemaVersion": "cf1.claimPackage.v1"
}
```

Sources:

- `backend/src/evidence-run/schemas/requestSchema.js`;
- `backend/src/evidence-run/schemas/stateSchema.js`;
- `backend/src/evidence-run/schemas/resultSchema.js`.

## 13. Status and identity enums

Run statuses:

```text
submitted, running, verification_failed, ready_for_evidence, failed
```

Package statuses:

```text
submitted, running, verification_failed, ready_for_evidence, superseded
```

Identifier prefixes:

```text
run:     cf1run_
package: cf1pkg_
lineage: cf1lin_
```

## 14. Important compatibility warning

This rich package is not the same contract as the later CF5 experimental row
format.

CF5 emits only:

```json
{
  "claimId": "string",
  "claim": "string",
  "grounding": ["U0001"],
  "articleTreatment": "adopted | challenged | reported",
  "provenance": "string or null"
}
```

CF5 does not generate the article map, rich provenance/identity bundle, selected
claim, evidence target, Evidence Need Card, verification, lineage, or final package
hash required by `cf1.claimPackage.v1`. There is no strict automatic projection
between the two contracts in the current repository.

## 15. Executable source index

- `backend/src/claim-foundry/contract.js`
  - `CF1_SCHEMA_VERSION`
  - `CF1_PIPELINE_VERSION`
  - enums, limits, statuses, and ID prefixes
- `backend/src/claim-foundry/assemblePackage.js`
  - `assembleCf1Package()`
  - `finalizeCf1Package()`
- `backend/src/claim-foundry/verifyPackage.js`
  - `verifyCf1Package()`
  - `classifyRepairability()`
- `backend/src/claim-foundry/verifyFieldShapes.js`
- `backend/src/claim-foundry/verifyProvenance.js`
- `backend/src/claim-foundry/verifySourceIdentity.js`
- `backend/src/claim-foundry/verifyTargetCards.js`
- `backend/src/claim-foundry/canonicalJson.js`
  - canonicalization and package hashing
- `backend/src/claim-foundry/repairContract.js`
- `backend/src/claim-foundry/applyRepair.js`
- `backend/src/storage/claimFoundryPackageStore.js`
  - `insertCf1Package()`
  - `loadCf1Package()`
  - `loadReadyCf1Package()`
- `backend/src/evidence-run/schemas/requestSchema.js`
- `backend/src/evidence-run/schemas/stateSchema.js`
- `backend/src/evidence-run/schemas/resultSchema.js`

## 16. Existing detailed references

- `docs/claim_foundry_cf1_contract_foundations.md`
- `docs/claim_foundry_cf1_contract_package_api.md`
- `docs/claim_foundry_cf1_contract_example.json`
- `docs/claim_foundry_cf1_persistence_handoff.md`

