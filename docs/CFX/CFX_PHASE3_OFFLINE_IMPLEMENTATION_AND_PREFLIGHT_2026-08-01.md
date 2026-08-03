# CFX Phase 3 offline implementation and preflight

Date: 2026-08-01
Status: `OFFLINE_PHASE_3_PASS` — stopped before live semantic extraction

## Outcome

The document-centric Phase 3 primitive is implemented and verified offline.
It accepts one selected evidence-text version plus the complete immutable target
inventory, extracts multiple explicit evidence assertions, permits each evidence
assertion to link independently to multiple targets, and preserves
`supports | challenges | qualifies | mixed` without using discovery intent as
stance.

Ordinary documents use one request. When the bounded request would be too large,
only the evidence document is split; the complete target inventory is repeated
byte-for-byte in every request part. Results merge by a document-scoped exact
excerpt/assertion fingerprint.

No model or retrieval call was made during implementation or preflight.

## Implemented surface

- governed byte-stable prompt `cfx-document-centric-bearing-v2`;
- strict schema `cfx_document_centric_bearing_v2`;
- immutable target-inventory and selected-text hashes;
- deterministic paragraph/sentence evidence blocking;
- exact excerpt recovery against only supplied evidence blocks;
- row-granular schema/excerpt validation and quarantine;
- document-scoped evidence-assertion fingerprints;
- deterministic multi-block and multi-target merge;
- immutable request/response/usage/validation forensic writer;
- one durable semantic execution identity across run, canonical document,
  selected text version, target inventory, prompt, and schema;
- processing-token race protection, accepted-result reuse, and bounded failed
  attempt replacement;
- explicit suppression of legacy reference extraction, claim matching, and
  per-case quote/bearing calls for CFX-bound documents;
- legacy-compatible evidence-claim persistence, multi-target links, numeric
  metrics, AI provenance, exact excerpt/location, and conditional dual-write;
- pure comparison path for the old one-target repair primitive;
- deterministic document eligibility, prioritization, diversity, and Tier 1 plan;
- offline local-MySQL preflight writer.

The stage does not perform source-quality weighting, final scoring, verdict
aggregation, broad Workspace publication, acquisition, or any semantic call.

## Mandatory regression matrix

All 14 authorized semantic extraction cases pass, plus the Phase 3 execution
boundary and persistence compatibility regressions:

1. independent support, challenge, qualification, and no-bearing targets;
2. one evidence assertion linked to multiple targets;
3. multiple evidence assertions from one document;
4. independent-evidence query discovery may still challenge;
5. counterevidence query discovery may still support;
6. topical-only overlap returns no bearing;
7. one bad excerpt does not erase a valid sibling;
8. unknown target IDs are rejected without erasing known siblings;
9. every fixed assertion appears exactly once in valid response envelopes;
10. long-document parts each retain the complete target inventory;
11. block merging does not duplicate evidence assertions;
12. snippet-only text remains provisional and excluded;
13. `queryIntent` is absent from model input and cannot become relation;
14. raw provider evidence, hashes, usage, and diagnostics survive rejection.

The additional boundary regressions prove:

- one active execution per complete governed identity;
- accepted execution reuse makes zero provider calls;
- a failed attempt is replaced on the same execution identity;
- a CFX-bound `/api/scrape-reference` returns before legacy semantics;
- the CFX production route defaults to the document-centric processor;
- the CFX pipeline imports none of the legacy semantic passes;
- unbound legacy route code and manual reassessment remain available;
- the migration's unique key contains all six governed identity fields;
- accepted evidence pairs populate `reference_claim_task_links` and the
  conditional evaluation-target dual-write without overwriting human review.

Full offline suite:

```text
node --import tsx --test --test-reporter=tap test/claimfoundry/cfx/*.test.ts
138 tests; 134 passed; 0 failed; 4 real-MySQL tests intentionally skipped

npm run typecheck:cfx
passed

npm run build:cfx
passed
```

## Ranked persisted inventory for CF1-F03 / task 18056

Only one selected, acquired text version currently exists in the development
database. The preflight does not promote snippets, metadata-only records, or
unacquired retrieval candidates to manufacture the requested 12–18 document
band.

| Rank | Canonical document | Access | Length | Exact identity | Discovery coverage | Proposed tier |
|---:|---|---|---:|---|---|---|
| 1 | `DOC-PMID-30986133` — *The MMR Vaccine and Autism* | full text | 33,487 chars | PMID 30986133; DOI 10.1146/annurev-virology-092818-015515 | P05, Q1/canonical, Tavily + PMC | Tier 1 |

Selected text SHA-256:
`1742aa00eabed52ce64b4b9b9a9ec263aaad16ccc6a79ae62b121072b0fa8888`

The Phase 2 canonical tables are not applied in the current development
database. This preflight therefore reads the already-persisted production-
compatible CFX binding and immutable selected text version, then resolves its
exact PMID/DOI identity from preserved acquisition metadata. It does not write
or alter database state.

The new Phase 3 semantic-execution migration is likewise not applied by this
offline step. Applying the Phase 2 and Phase 3 migrations and passing their
live-schema gates is required before a live Phase 3 authorization can execute.

## Frozen prospective live configuration

- maximum calls: **1** for the currently eligible Tier 1;
- transport: existing OpenAI Chat Completions structured provider;
- model: `gpt-4o-mini`;
- temperature: `0.1`;
- strict schema: `cfx_document_centric_bearing_v2`;
- maximum output: `8,000` tokens/request;
- timeout: `180,000 ms`;
- retries: `0`;
- concurrency: `4`;
- store: `false`;
- maximum evidence-document material: `60,000` characters/request;
- estimated input: `7,692` tokens;
- maximum output: `8,000` tokens;
- estimated maximum cost: **$0.005954**.

The cost estimate uses the documented GPT-4o mini rates of $0.15/M input and
$0.60/M output tokens. The model documentation confirms a 128,000-token context
window and 16,384-token model output capacity; this run's configured ceiling is
lower at 8,000.

## Frozen hashes

- prompt SHA-256: `1dc0ba6ad010e83d158e3de6d239198c2e8006d1012343703f8898f414fc6bc3`
- schema SHA-256: `586f8c4255b879d3ad3bc43d3a9c7935322e90cf2fe94cf1c2b14938448caa73`
- target inventory SHA-256: `c1cfdc665d1d29026198c56c76fa4f96fd8a0bb86fc9386e2c868fd0e64a5810`
- preflight artifact aggregate SHA-256: `df95583b8fa7acf7d0e6939b232421d70d2fa0468a85ea6ef6d32415b521839f`

## Files changed for Phase 3

- `backend/src/claimfoundry/cfx/evidenceBearing/document-bearing-v1.json`
- `backend/src/claimfoundry/cfx/evidenceBearing/documentSchema.ts`
- `backend/src/claimfoundry/cfx/evidenceBearing/documentExtraction.ts`
- `backend/src/claimfoundry/cfx/phase3/comparison.ts`
- `backend/src/claimfoundry/cfx/phase3/forensicArtifacts.ts`
- `backend/src/claimfoundry/cfx/phase3/prioritization.ts`
- `backend/src/claimfoundry/cfx/runtime/writePhase3Preflight.ts`
- `backend/migrations/2026-08-01-02-cfx-phase3-semantic-execution.sql`
- `backend/src/services/cfxDocumentSemanticExecutionStore.js`
- `backend/src/services/cfxDocumentSemanticExecutionStore.d.ts`
- `backend/src/services/cfxEvidenceCoordinator.js`
- `backend/src/services/cfxProductionEvidencePipeline.js`
- `backend/src/services/cfxProductionEvidenceStore.js`
- `backend/test/claimfoundry/cfx/phase3DocumentExtraction.test.ts`
- `backend/test/claimfoundry/cfx/phase3ExecutionBoundary.test.ts`
- `backend/test/claimfoundry/cfx/evidenceCoordinator.test.ts`
- `backend/test/claimfoundry/cfx/productionEvidenceStore.test.ts`
- `backend/package.json`
- `docs/CFX/CFX_PHASE3_LEGACY_SEMANTIC_COMPATIBILITY_NOTE_2026-08-01.md`

## Review artifacts

The immutable preflight is under:

`artifacts/claim-foundry/cfx/document-centric-bearing/cfx-phase3-preflight-20260801t023805z/`

It contains the ranked inventory, proposed Tier 1, exact target inventory,
preflight manifest, readable report, and aggregate file hashes.

Phase 3 stops here pending separate live authorization.
