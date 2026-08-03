# CFX S0/S1/S2 Offline Implementation Report

Date: 2026-07-31
Status: Offline implementation complete; live S1 not yet authorized

## Outcome

The isolated CFX module now implements:

- S0 deterministic article freeze and source-unit projection;
- S1 one-call whole-article meaning discovery;
- S2 exact grounding Arm A and Arm B;
- immutable request-level forensic artifacts;
- independent row validation and quarantine;
- arm comparison metrics;
- deterministic Markdown and self-contained HTML reports.

No CFX model call was made during implementation or verification.

## Governing hashes

- S1 prompt SHA-256:
  `288859047f85f65599bb20a69ad33eda0e754648a18b9c4a20b1f1cd3d7626d5`
- S2 prompt SHA-256:
  `0076074fbdf87fad916be353ea1ae1888574a13550ef8003a5377abf0f7cc67f`
- CF1-F03 fixture SHA-256:
  `9d667e63112f1895129d5f1c21b17fa3d5aa7733b9b0b8f9e4a0501a95381e13`
- CF1-F03 article-text SHA-256:
  `3b99bfeb3f39e28142f3e22e12bc47bce6b893d08bcc0a03bfcb2b6a2c8d9022`

## S0 result

The current shared normalizer deterministically projects CF1-F03 into 398
stable source units.

S1 receives the original complete article text. Source-unit IDs are not visible
during meaning discovery.

S2 receives the complete normalized, unit-ID-labelled article. No retrieval
prefilter, chunking, lexical shortlist, or semantic search is used.

## S1 behavior

S1:

- loads the byte-verified simple prompt;
- sends the complete article in one request;
- requires exactly 12 strict output rows;
- assigns `P01` through `P12` host-side;
- rejects normalized duplicate assertions;
- writes the raw provider response before validation;
- publishes the canonical inventory only after structural validation.

## S2 behavior

Arm A schedules exactly one request containing all 12 propositions and the
complete unit-labelled article.

Arm B schedules exactly 12 independent requests with concurrency bounded to
four. One failed or invalid proposition does not erase successful siblings.

The host checks:

- expected, missing, duplicate, and unknown proposition IDs;
- closed grounding status and type enums;
- status/type consistency;
- stable source-unit existence and order;
- contiguous units within each evidence segment;
- separate segments for distributed grounding;
- exact quotation substrings;
- partial-component requirements;
- attribution-aware status;
- ambiguity diagnostics;
- unsupported-result structure;
- unchanged canonical proposition hashes.

## Forensic persistence

Every request is persisted before invocation. Every provider response,
metadata record, and parsed output is persisted before validation.

Validation then publishes:

- `validation.json`;
- `accepted_rows.json`;
- `rejected_rows.json`;
- `diagnostics.json`.

Validation controls publication and never evidence retention.

## Reports

S2 produces:

- `grounding_inventory.json`;
- `grounding_comparison.json`;
- `results_report.md`;
- deterministic self-contained `report.html`;
- `run_manifest.json`;
- `artifact_hashes.json`.

The HTML:

- uses only embedded CSS;
- emits no remote assets or URLs;
- escapes canonical, article, and model text;
- renders evidence segments separately;
- displays quarantines and accounting;
- includes a printable human-review worksheet;
- declares no automatic semantic winner.

## Offline verification

Command:

```text
npm run verify:cfx
```

The suite covers the import boundary, deterministic S0 projection, prompt
hashes, one-call S1 behavior, duplicate discovery rejection, every S2 grounding
status, quotation and unit validation, coverage defects, response preservation,
the 1+12 request schedule, concurrency, canonical immutability, parser and
validator quarantines, provider failure isolation, and deterministic safe HTML.

## Next governed step

Run the frozen S1 preflight, review its hashes, and authorize exactly one live
S1 request. After the S1 canonical inventory is frozen, generate the S2
preflight from that exact artifact. S2 live execution remains separately
authorized and contains exactly 13 model requests.
