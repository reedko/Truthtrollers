# CFX → EvidenceRun initial retrieval implementation audit

Date: 2026-07-31
Governing specification:
`CFX_EVIDENCERUN_INITIAL_QUERY_RETRIEVAL_SPEC_2026-07-31.md`
Status: offline implementation and preflight complete; live calls not executed

## Outcome

The new CFX retrieval module implements:

- a frozen 12-proposition evidence-input contract;
- deterministic Q1 canonical queries;
- deterministic Q3 source-identity queries or a typed missing reason;
- one governed model request for Q2, Q4, and Q5 across all propositions;
- a deterministic, explained PubMed applicability gate;
- a maximum of two PubMed queries per proposition;
- one provider per query and five returned candidates per query;
- per-query provider-failure isolation;
- candidate normalization without bearing, stance, score, or full-text fetch;
- deterministic deduplication that retains every discovery path;
- immutable requests, raw provider responses, accounting, JSON artifacts, and a
  self-contained review report.

The canonical `substantiveAssertion` remains unchanged.

## Reuse audit

| Existing file | Export / behavior | Test coverage found | Decision |
|---|---|---|---|
| `backend/src/claimfoundry/shared/provider/index.ts` | `createOpenAiCf7StructuredProvider` | CFX, CF7 harvest, atomicity, grouping, selector, and whole-article experiment tests | Reuse unchanged for the single strict Chat Completions planning request. |
| `backend/src/core/academicProviders.js` | `pubmedSearch`, `crossrefSearch`, `openAlexSearch`, `semanticScholarSearch`, `isAcademicQuery` | `backend/test/bearing/searchGateway.test.js` and EvidenceRun candidate-discovery coverage | Reuse through the existing gateway. The CFX plan currently routes only to PubMed or one web provider. |
| `backend/src/core/evidenceRetrievalGateway.js` | `createEvidenceRetrievalGateway` | `backend/test/bearing/searchGateway.test.js`; `backend/test/evidence-run/candidateDiscovery.test.js` | Reuse through a small CFX adapter configured for one provider per query, five results, and returned diagnostics. Do not reuse its multi-provider bearing-pool mode. |
| `backend/src/core/searchGatewayConfig.js` | provider configuration and key status | `backend/test/bearing/searchGateway.test.js` | Reuse indirectly through the gateway. |
| `backend/src/claimfoundry/shared/evidenceSearch/identityNormalization.js` | DOI, PMID, URL, and literal normalization | CFX handoff tests and `backend/test/evidence-run/identityRegistry.test.js` | Reuse unchanged for candidate normalization and canonical URLs. |
| `backend/src/claimfoundry/cfx/artifacts/immutableArtifacts.ts` | immutable writes, tree hashes, aggregate hashes, read-only freeze | all governed CFX runtime tests | Reuse unchanged. |
| `backend/src/claimfoundry/shared/accounting/index.ts` | request/token/latency accounting shape | CF7 and CFX runtime tests | Shape reused; retrieval adds provider-call and candidate counts. |
| `backend/src/evidence-run/retrievalCoordinator.js` | bounded concurrent query execution and failure isolation | `backend/test/evidence-run/candidateDiscovery.test.js` | Behavior adapted locally because the old request and target contracts are CF1-specific. |
| `backend/src/evidence-run/candidateTriage.js` and `sourceIdentity.js` | normalization and identity-key dedupe | `backend/test/evidence-run/candidateDiscovery.test.js`; identity tests | Literal normalization and ordered identity-key ideas adapted locally. Scoring, target-fit inference, budgets, and bearing-related fields are not reused. |
| `backend/src/evidence-run/providerTiming.js` | provider/request timing aggregation | `backend/test/evidence-run/candidateDiscovery.test.js` | Accounting shape adapted locally; the CFX provider contract is smaller. |

## Explicitly prohibited reuse

The new module does not import or execute:

- old EvidenceRun orchestration;
- ClaimFoundry CF1–CF7 manager or agent loops;
- semantic selection or claim repair;
- target portfolio construction;
- query semantic scoring or ranking;
- candidate promise scoring;
- source-quality scoring;
- bearing or evidence-stance classification;
- candidate allocation;
- scraping, PDF extraction, or full-text fetching;
- database persistence or production routes.

## New implementation

| File | Purpose |
|---|---|
| `backend/src/claimfoundry/cfx/retrieval/types.ts` | Frozen input, five-lane plan, retrieval, candidate, provenance, and dedupe contracts. |
| `backend/src/claimfoundry/cfx/retrieval/query-planning-v1.json` | Byte-stable governed Q2/Q4/Q5 planning prompt. |
| `backend/src/claimfoundry/cfx/retrieval/schema.ts` | Strict 12-proposition, three-query-per-proposition structured output schema. |
| `backend/src/claimfoundry/cfx/retrieval/loadEvidenceInputs.ts` | Hash-verifies and loads the immutable CFX S2 handoff. |
| `backend/src/claimfoundry/cfx/retrieval/queryPlanning.ts` | Q1/Q3 construction, generic-source suppression, PubMed applicability, request construction, validation, PubMed cap, and plan merge. |
| `backend/src/claimfoundry/cfx/retrieval/executeRetrieval.ts` | One-provider routing, concurrency four, five-result cap, failure isolation, and forensic callbacks. |
| `backend/src/claimfoundry/cfx/retrieval/candidates.ts` | Literal candidate normalization and ordered deterministic dedupe. |
| `backend/src/claimfoundry/cfx/retrieval/queryPlanReport.ts` | Human-readable query-plan report. |
| `backend/src/claimfoundry/cfx/retrieval/report.ts` | Self-contained candidate review report with manual-review labels. |
| `backend/src/claimfoundry/cfx/runtime/writeInitialRetrievalPreflight.ts` | Zero-call immutable preflight and authorization package. |
| `backend/src/claimfoundry/cfx/runtime/runInitialRetrieval.ts` | Governed live runner. |
| `backend/test/claimfoundry/cfx/initialRetrieval.test.ts` | Focused prompt, routing, cap, failure, dedupe, immutability, and report tests. |

## F03 preflight

Source evidence handoff:

`artifacts/claim-foundry/cfx/CF1-F03/cfx-s2-evidence-search-cfx-substantive-review-cf1-f03-20260730234738-20260731051936`

Preflight:

`artifacts/claim-foundry/cfx/preflight/cfx-initial-retrieval-preflight-20260731061032`

Measured bounds:

- propositions: 12;
- deterministic Q1 lanes: 12;
- deterministic Q3 lanes: 8;
- Q3 typed missing reasons: 4;
- model-planned Q2/Q4/Q5 lanes: 36;
- maximum retrieval requests after a valid plan: 56;
- maximum PubMed query executions: 24;
- maximum retrieval-provider HTTP requests: 80, because a PubMed query uses
  eSearch and conditionally eSummary;
- maximum raw candidate slots: 280;
- planning model calls made during preflight: 0;
- retrieval calls made during preflight: 0;
- planning prompt SHA-256:
  `4af9000479199600980ecf422c1003bfb5affaf5d301bce09b816452d4cc3400`;
- planning schema SHA-256:
  `e22cde93aa8f8ac31c57b14e4440c5dbcfb25ce377c627372a72ebdc9fc73f9b`;
- planning request SHA-256:
  `ea73850bbae2f6778fb35ecfe10c8121983758bec38b171540c97421c9ace89f`;
- preflight aggregate SHA-256:
  `863fff0d88de111278763367599a7e81d5fd43defd1334c81a4005479e579580`.

## Verification

Command:

```text
cd backend
npm run verify:cfx
```

Result:

- TypeScript typecheck: pass;
- CFX tests: 34/34 pass;
- focused gateway, candidate-discovery, and identity regressions: 14/14 pass;
- external model calls: 0;
- external retrieval calls: 0.
