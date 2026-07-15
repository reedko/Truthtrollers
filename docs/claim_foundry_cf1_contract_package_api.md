# CF1 Portable Contract — Package and API

**Schema:** `cf1.claimPackage.v1`
**Scope:** Selected claims, Phase 3 targets, Evidence Need Cards, verification, final package, and public API.

This document uses the notation defined in `claim_foundry_cf1_contract_foundations.md`.

## 1. Selected evaluation claim

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `selectedClaimId` | R | `S` + 2 digits | 3 | D; final selection order | P |
| `claimText` | R | string | 2,000 | A; compelling, faithful wording | P |
| `sourceRawAssertionIds` | R | raw ID[] | 20 | A, validated D | P |
| `sourceUnitIds` | R | unit ID[] | 40 | D; inherited ordered union | P |
| `sourceBlockIds` | R | block ID[] | 12 | D; inherited from assertions | P |
| `sourceSpans` | R | grounded span[] | 40 | D; exact contiguous unit groups | P |
| `sourceExcerpt` | R | string | 3,000 | D; first-span compatibility display | P |
| `sourceOffsets` | R | `{start,end}`[] | 40 | D; one range per source span | P |
| `articleRole` | R | `thesis`, `pillar`, `pillar_support`, `opponent_claim`, `qualification`, `consistency_hinge` | — | A | P |
| `relatedPillarIds` | R | pillar ID[] | 12 | A, validated D | P |
| `materiality` | R | `high`, `medium`, `low` | — | A | P |
| `counterfactualImpact` | R | string | 1,000 | A | P |
| `selectionRationale` | R | string | 1,000 | A | P |
| `scoreTransform` | R | `normal`, `invert`, `none` | — | A, checked D | P |
| `searchEligible` | R | boolean | — | A, checked D | P |
| `verdictEligible` | R | boolean | — | A, checked D | P |
| `confidence` | R | number 0–1 | — | A | X |

Selected count target is 8–12. A different count requires `diagnostics.selectionCountException`.

## 2. Phase 3 target

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `targetId` | R | `T` + 3 digits | 4 | D; stable package order | P |
| `selectedClaimId` | R | selected claim ID | — | A, validated D | P |
| `targetText` | R | string | 2,000 | A; evidence-facing proposition | P |
| `targetType` | R | `article_endorsed_substantive`, `opponent_substantive`, `attribution_provenance`, `source_identity`, `inference_warrant`, `context_scope` | — | A | P |
| `scoreTransform` | R | `normal`, `invert`, `none` | — | A, checked D | P |
| `searchEligible` | R | boolean | — | A, checked D | P |
| `verdictEligible` | R | boolean | — | A, checked D | P |
| `sourceRawAssertionIds` | R | raw ID[] | 20 | A, validated D | P |
| `sourceUnitIds` | R | unit ID[] | 40 | D; inherited ordered union | P |
| `sourceBlockIds` | R | block ID[] | 12 | D; inherited from assertions | P |
| `sourceSpans` | R | grounded span[] | 40 | D; exact contiguous unit groups | P |
| `sourceExcerpt` | R | string | 3,000 | D; first-span compatibility display | P |
| `sourceOffsets` | R | `{start,end}`[] | 40 | D; one range per source span | P |
| `mappingStatus` | R | `resolved`, `needs_review`, `unresolved` | — | A/D | P |
| `mappingRationale` | R | string | 1,000 | A | P |

Posture defaults enforced as verification rules:

- attribution/source identity: normally `none`, not verdict-eligible
- article-endorsed substantive: normally `normal`, verdict-eligible
- opponent substantive: normally `invert`, verdict-eligible
- unresolved targets cannot be verdict-eligible

The agent-output schema stops at `sourceRawAssertionIds` for selected claims and
targets. Package assembly supplies unit, block, excerpt, and offset fields. The
portable final package retains those deterministic fields for audit and consumers.

## 3. Evidence Need Card

| Field | Req | Type / enum | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `cardId` | R | `ENC-` + target ID | 8 | D | P |
| `targetId` | R | target ID | — | D | P |
| `selectedClaimId` | R | selected ID | — | D | P |
| `targetText` | R | string | 2,000 | copied from target | P |
| `targetType` | R | target enum | — | copied from target | P |
| `scoreTransform` | R | transform enum | — | copied from target | P |
| `searchEligible` | R | boolean | — | copied from target | P |
| `verdictEligible` | R | boolean | — | copied from target | P |
| `evidenceRolesNeeded` | R | role[] | 8 | A | P |
| `bearingCriteria` | R | criteria object | one | A, normalized D | P |
| `queryLaneSeeds` | R | seed[] | 12 | A | P |
| `identifierHints` | R | identifier object | one | A + D normalization | P |
| `namedWorkIds` | R | named-work ID[] | 6 | D from validated pool | P |
| `identityBundleIds` | R | identity-bundle ID[] | 12 | D from inherited provenance | P |
| `articleReferenceIds` | R | reference ID[] | 12 | D from inherited citation markers | P |
| `articleLinkIds` | R | link ID[] | 20 | D from inherited units/references | P |

Evidence role enum:

```text
target-primary, study-identity, attribution-provenance, official-response,
methodology-reanalysis, primary-record, context-background,
advocacy-restatement, identifier-search
```

Bearing criteria:

```json
{
  "mustMatch": [],
  "shouldMatch": [],
  "rejectIfOnly": [],
  "weak": false
}
```

Each list is limited to 12 strings of 500 characters. `rejectIfOnly` must exist. A non-weak searchable substantive target normally requires nonempty `mustMatch` and `rejectIfOnly`.

Query seed:

```json
{
  "laneType": "target-primary",
  "query": "",
  "purpose": "",
  "sourceFieldsUsed": []
}
```

`query` ≤1,000 chars; `purpose` ≤500; `sourceFieldsUsed` ≤12. Seeds are research instructions, not executed searches.

Identifier hints:

```json
{
  "doi": [],
  "pmid": [],
  "titleExact": [],
  "authorYear": [],
  "quotedDocumentNames": [],
  "canonicalSourceIds": []
}
```

Each list is limited to 12 strings. Hints must occur in supplied article/package text or be deterministically normalized from it. No discovered fetch URL is allowed.

## 4. Verification result

| Field | Req | Type | Limit | Owner / source of truth | Class |
|---|---:|---|---:|---|---:|
| `valid` | R | boolean | — | D verifier | P |
| `blockingErrors` | R | issue[] | 100 | D | P |
| `warnings` | R | issue[] | 100 | D | P |
| `verifiedAt` | R | ISO-8601 | 40 | D clock | P |
| `verifierVersion` | R | string | 100 | D build/version | P |
| `repairAttempted` | R | boolean | — | D runner | P |

Issue shape: `{code, path, message, relatedIds}`. Limits: code 100, JSON path 500, message 1,000, related IDs 20. Only `blockingErrors.length === 0` permits persistence as ready.

## 5. Final package

```json
{
  "schemaVersion": "cf1.claimPackage.v1",
  "pipelineVersion": "cf1.0.0",
  "packageId": "cf1pkg_...",
  "packageVersion": 1,
  "supersedesPackageId": null,
  "runId": "cf1run_...",
  "status": "ready_for_evidence",
  "createdAt": "",
  "article": {},
  "semanticBlocks": [],
  "rawAssertions": [],
  "articleMap": {},
  "sourceDocument": {},
  "sourceAtoms": [],
  "sourceUnits": [],
  "sourceLinks": [],
  "sourceCitationMarkers": [],
  "sourceReferences": [],
  "sourceIdentityBundles": [],
  "internalConsistencyFindings": [],
  "selectedEvaluationClaims": [],
  "phase3Targets": [],
  "evidenceNeedCards": [],
  "diagnostics": {},
  "verification": {},
  "packageHash": ""
}
```

`sourceIdentityBundles` is a package-level, host-owned pool. Its compact fields are:
`identityBundleId`, `identityKind`, nullable `namedWorkId`, `assertionSources`,
`workAuthors`, `workLabel`, nullable `publicationVenue`, nullable `publicationYear`,
`publishers`, `institutions`, `unresolvedContributors`, normalized `identifiers`,
`sourceUnitIds`, `articleReferenceIds`, `articleLinkIds`, and `resolutionStatus`.
Unknown metadata remains `null` or an empty array. Selected claims, their targets,
and Evidence Need Cards reference this pool by ID and carry the same compact lead
arrays. Article-supplied citations and URLs are retrieval leads, never validated
evidence.

Required enums/status: `submitted`, `running`, `verification_failed`, `ready_for_evidence`, `superseded`. `packageHash` is deterministic SHA-256 of the canonical package excluding `packageHash`, volatile diagnostics, and timestamps. Maximum serialized package size for v1 is 10 MiB. `diagnostics` is diagnostic-only and limited to 1 MiB.

Package identity/versioning semantics are finalized in Phase 2; this phase fixes their portable representation.

## 6. Public API

### Request

`POST /v1/claim-packages`

```json
{
  "article": {},
  "options": {
    "persist": true,
    "includePackageInResponse": false,
    "allowRepair": true,
    "idempotencyKey": "consumer-generated-key"
  }
}
```

`article` is required. Options are optional. `idempotencyKey` is limited to 200 characters. The transport must also accept an `Idempotency-Key` header; if both exist they must match. Consumer authentication is transport-specific and outside the portable package schema.

A VeriStrata-only adapter may accept `{contentId}` at `/api/claim-foundry/run`, load the article, then call the same core runner. That adapter request is not the public CF1 contract.

### Success response

```json
{
  "ok": true,
  "packageId": "cf1pkg_...",
  "runId": "cf1run_...",
  "schemaVersion": "cf1.claimPackage.v1",
  "status": "ready_for_evidence",
  "packageHash": "",
  "artifactPath": "",
  "summary": {
    "selectedClaimCount": 10,
    "targetCount": 16,
    "evidenceNeedCardCount": 16,
    "valid": true
  },
  "claimPackage": null
}
```

`claimPackage` is present only when explicitly requested. `artifactPath` is an opaque consumer-relative reference, not a portable filesystem requirement.

### Failure response

```json
{
  "ok": false,
  "runId": "cf1run_...",
  "status": "verification_failed",
  "error": {
    "code": "CF1_VERIFICATION_FAILED",
    "message": "",
    "retryable": false,
    "issues": []
  }
}
```

HTTP mapping: 400 invalid input, 401/403 transport auth, 409 idempotency conflict, 413 input/package size, 422 verification failure, 429 budget/rate limit, 500 internal failure, 503 transient model failure.
