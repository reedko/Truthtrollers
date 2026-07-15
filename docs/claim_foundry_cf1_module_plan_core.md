# CF1 Phase 5 — Core Module Manifest

**Status:** Planning decision for review
**Root:** `backend/src/claim-foundry/`
**Rule:** Every handwritten file ≤500 lines; target <250. No barrel file may hide circular dependencies.

## 1. Core contract and deterministic bones

| File | State | Responsibility and exports | Direct dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `contract.js` | new | CF1 enums, limits, schema version; `CF1_SCHEMA_VERSION`, frozen enum sets | none | `contract.test.js` | 120 |
| `errors.js` | new | Typed errors; `Cf1Error`, `isRetryableCf1Error` | none | runner/failure tests | 90 |
| `ids.js` | new | Prefixed UUIDv7 IDs; `createRunId`, `createPackageId`, `createLineageId`, `assignLocalIds` | existing direct `uuid` dependency | `ids.test.js` | 150 |
| `canonicalJson.js` | new | Stable serialization/hashes; `canonicalizeCf1`, `hashArticleInput`, `hashOptions`, `hashPackage` | `node:crypto` | `canonicalJson.test.js` | 180 |
| `validateArticleInput.js` | new | Portable input validation/normalization; `validateArticleInput` | `contract`, `errors`, canonical hash | `validateArticleInput.test.js` | 190 |
| `structuralBlocks.js` | new | Source-only block proposal and offset checks; `proposeStructuralBlocks`, `verifyBlockCoverage` | contract/errors | `structuralBlocks.test.js` | 230 |
| `tokenBudget.js` | new | Estimate and enforce path/call budgets; `estimateCf1Tokens`, `chooseExecutionPath`, `assertBudget` | contract/errors | `tokenBudget.test.js` | 170 |
| `identifierHints.js` | new | Article-grounded DOI/PMID/title/document normalization; `normalizeIdentifierHints`, `identifierOccursInSource` | contract | `identifierHints.test.js` | 210 |
| `normalizeAgentDraft.js` | new | Validate draft shape, assign IDs, resolve references; `normalizeAgentDraft` | contract, ids, errors | `normalizeAgentDraft.test.js` | 240 |
| `assemblePackage.js` | new | Combine deterministic and agent state; `assembleCf1Package` | contract, canonical JSON | `assemblePackage.test.js` | 160 |
| `verifyPackage.js` | new | Verification orchestration; `verifyCf1Package`, `classifyRepairability` | contract, canonical JSON, verifier helpers | `verifyPackage.test.js` | 210 |
| `verifyFieldShapes.js` | new | Required field/type/limit checks; `verifyFieldShapes` | none | `verifyPackage.test.js` | 120 |

Verifier checks are split into `verifyFieldShapes.js`, `verifyProvenance.js`, and
`verifyTargetCards.js`; each remains independently testable and under 180 lines.

## 2. Agent/model boundary

| File | State | Responsibility and exports | Direct dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `prompts/primaryPrompt.js` | new | Build one normal-path prompt; `buildPrimaryPrompt` | contract only | snapshot/contract test | 230 |
| `prompts/agentDraftSchema.js` | new | Strict structured-output schema; `CF1_AGENT_DRAFT_SCHEMA` | none | primary prompt/model tests | 140 |
| `prompts/blockObservationPrompt.js` | new | Long-path compact batch prompt; `buildBlockObservationPrompt` | contract | prompt test | 170 |
| `prompts/blockObservationSchema.js` | new | Strict compact-observation schema; `CF1_BLOCK_OBSERVATION_SCHEMA` | none | long prompt/execution tests | 100 |
| `prompts/synthesisPrompt.js` | new | Long-path final synthesis prompt; `buildSynthesisPrompt` | contract | prompt test | 190 |
| `prompts/repairPrompt.js` | new | Targeted repair prompt; `buildRepairPrompt` | repair contract | repair tests | 160 |
| `modelRunner.js` | new | Injectable structured model interface; `createCf1ModelRunner`, `invokeStructured` | existing OpenAI capability, telemetry | `modelRunner.test.js` with fake transport | 210 |
| `normalExecution.js` | new | One-call semantic path; `runNormalCf1Analysis` | primary prompt, model runner | `normalExecution.test.js` | 180 |
| `longExecution.js` | new | Batching + synthesis bounded path; `runLongCf1Analysis`, `buildBlockBatches` | block/synthesis prompts, model runner, token budget | `longExecution.test.js` | 230 |

Prompt text belongs only in prompt modules. Model transport cannot import persistence, routes, scrapers, or EvidenceRun.

## 3. Repair, artifacts, and orchestration

| File | State | Responsibility and exports | Direct dependencies | Tests | Lines |
|---|---|---|---|---|---:|
| `repairContract.js` | new | Request/response validation and allowlist; `buildRepairRequest`, `validateRepairResponse` | contract/errors | `repairContract.test.js` | 210 |
| `applyRepair.js` | new | Atomic allowlisted JSON Pointer repair; `applyCf1Repair` | repair contract | `applyRepair.test.js` | 220 |
| `repairExecution.js` | new | One-call repair, budget enforcement, and reverification; `runCf1Repair` | repair contract, prompt, verifier, model runner | `repairExecution.test.js` | 120 |
| `artifacts.js` | new | Standard JSON/Markdown outputs; `writeCf1Artifacts`, `buildRunSummary` | `node:fs/promises`, canonical JSON | `artifacts.test.js` using temp dir | 220 |
| `runClaimFoundry.js` | new | Top-level state machine; `runClaimFoundry` | all execution services via injected deps | `runClaimFoundry.test.js` | 240 |
| `index.js` | new | Explicit public core exports only | runner, contract, verifier | import smoke test | 40 |

`runClaimFoundry.js` contains sequencing, not implementations. Stage functions return new state rather than mutating hidden globals.

## 4. Runner dependency direction

```text
contract/errors
→ IDs, canonical JSON, validation, blocks, budgets
→ prompts + model runner
→ normal/long analysis
→ draft normalization + identifiers
→ assembly + verification
→ optional repair + reverification
→ package store/artifacts through injected ports
```

No lower layer imports the runner. No core module imports Express, the global DB pool, VeriStrata routes, evidence modules, or source-fetch modules.

## 5. Core test organization

Root: `backend/test/claim-foundry/`

Each implementation module receives a focused `node:test` file named above. Shared portable fixtures live in:

```text
backend/test/claim-foundry/fixtures/packages.js
backend/test/claim-foundry/fixtures/articles.js
backend/test/claim-foundry/fixtures/modelDrafts.js
```

Fixture files contain data only, export named fixtures, and remain below 250 lines each. Larger article texts are separate `.txt` files under `fixtures/articles/`.

Required runner tests:

- normal path uses one primary call
- valid package uses no repair
- repairable draft uses exactly one repair
- failed repair terminates
- long path respects batch/call cap
- budget exhaustion prevents further calls
- persistence receives only verified package
- forbidden search/fetch dependency is absent
