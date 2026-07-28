# CF6 Integration Map

Audit date: 2026-07-27

Governing specification: `ml/cf1-argument-model/data/annotation-prompts/stupidity/CF6_REAL_AGENT_BUILD_MCT_2026-07-27.docx`
Scope: repository audit and Milestone 1 integration plan only. No CF6 runtime, package, route, migration, or ClaimFoundry tool is implemented by this document.

## 1. Executive Finding

The repository can support a parallel CF6 Agents SDK vertical slice without rewriting or importing CF5. The safest first insertion point is a new, production-disconnected `backend/agents/` subtree in the existing backend npm package. The deployed ClaimFoundry HTTP path and the CF5 experimental path are already separate:

- the deployed HTTP path starts at `backend/src/routes/claim-foundry/index.js:9` and calls the older `runClaimFoundry()` package pipeline;
- CF5 starts only from experiment code at `backend/experiments/cf5/run-cf5.mjs:42` and writes filesystem artifacts;
- no file outside `backend/experiments/cf5/` imports CF5, and CF5's own integration test enforces isolation from the older CF1/CF4 semantic machinery.

Milestone 1 therefore needs no CF5 change and no production feature flag. It should prove only that the OpenAI Agents SDK can run one harmless typed tool through an SDK-managed model/tool loop behind a provider-neutral repository boundary.

There is one important contract limitation for later milestones: CF5 does **not** currently emit a persisted ClaimFoundry package. Its canonical output is an array of five-field claim rows (`claimId`, `claim`, `grounding`, `articleTreatment`, `provenance`). The deployed persistence path accepts the substantially richer `cf1.claimPackage.v1` shape. A strict projection between those shapes does not currently exist. The first CF6 ClaimFoundry slice can be compatible with the CF5 row schema, but it cannot be called compatible with the deployed persisted package until an explicit, tested projection is designed.

## 2. Repository Snapshot

### Branch, package manager, and runtime

- Current branch: `tm4-evidence-checkpoint-20260712-095152`.
- Runtime observed during the audit: Node `v18.20.4`.
- Package manager: npm. Lockfiles exist at the repository root and in `backend/`, `dashboard/`, `extension/`, and `shared/`. No Yarn, pnpm, or Bun lockfile was found within the audited package roots.
- The correct package boundary for CF6 is `backend/package.json`, not the repository-root package. `backend/package.json:5` is ESM (`"type": "module"`), owns the backend's `openai` dependency, and owns the server process.
- The backend has no `tsconfig.json`, no declared `typescript`/`tsx` dependency, and no TypeScript execution script. This matters because the governing MCT specifies a TypeScript runtime while Node 18 cannot execute `.ts` files directly.

### Relevant existing scripts

`backend/package.json:6-10` currently defines:

- `npm run start` — starts `backend/server.js`;
- `npm run dev` — starts the server through Nodemon;
- `npm run test:bearing` — runs `node --test test/bearing/*.test.js`;
- `npm test` — intentionally fails with “no test specified.”

CF5 tests are not registered in `package.json`. The repository command used successfully in this audit was:

```bash
node --test backend/experiments/cf5/*.test.js
```

Result: 26 tests passed, 0 failed.

### Working-tree snapshot

The target `backend/agents/CF6_INTEGRATION_MAP.md` did not exist before this audit. `backend/agents/` had no existing files, so there is no current CF6 path collision.

The worktree was already dirty before this document was created:

- tracked modification: `backend/experiments/cf2/v6/pipeline.js` (`3` changed lines; `2` insertions, `1` deletion);
- untracked CF2/CF4/CF5 experiment trees, including all of `backend/experiments/cf5/`;
- untracked CF4/CF5/CF6 planning documents under `ml/cf1-argument-model/data/annotation-prompts/stupidity/`;
- an untracked Word lock file, `~$6_REAL_AGENT_BUILD_MCT_2026-07-27.docx`.

The full pre-change `git status --short` snapshot was:

```text
 M backend/experiments/cf2/v6/pipeline.js
?? backend/experiments/cf2/RECENT_FAILURE_AND_REPAIR_SYNTHESIS_2026-07-24.md
?? backend/experiments/cf2/evaluation-v1/
?? backend/experiments/cf2/v7/
?? backend/experiments/cf4/
?? backend/experiments/cf5/
?? "ml/cf1-argument-model/data/annotation-prompts/stupidity/CF1_SYNTHESIS_ARCHITECTURE_PROPOSAL_2026-07-24 (1).md"
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF1_SYNTHESIS_ARCHITECTURE_PROPOSAL_2026-07-24.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_DETERMINISTIC_PIPELINE_BUILD_PLAN_2026-07-24.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_FINAL_SOLUTION_MCT_2026-07-24.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_PHASE2_SELECTION_LABELING_SPEC_2026-07-25.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF4_STATUS_AND_COWORK_PLAN_2026-07-26.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v2.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v3.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_PROTOTYPE_DIRECT_CLAIM_GENERATION_2026-07-26.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_REPORTING_STANDARD_2026-07-27.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/CF6_REAL_AGENT_BUILD_MCT_2026-07-27.docx
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/TICKET-S5-multi-thesis-anchor.md
?? ml/cf1-argument-model/data/annotation-prompts/stupidity/~$6_REAL_AGENT_BUILD_MCT_2026-07-27.docx
```

Generated `artifacts/` content is ignored by `.gitignore`. Existing CF5 artifacts must not be overwritten; use a new timestamped CF6 root later.

### Package-version finding

At audit time:

- backend direct dependency installed: `openai@6.34.0`;
- current npm registry result for `@openai/agents`: `0.13.5`;
- `@openai/agents@0.13.5` declares peer dependency `zod: ^4.0.0` and dependency `openai: ^6.46.0`;
- the backend has no direct Zod dependency. Its only locked Zod is nested `zod@3.25.76` under `chromium-bidi`, which does not satisfy the Agents SDK peer.

Installing the Agents SDK will therefore add Zod 4 and may update or duplicate the OpenAI SDK. That lockfile effect must be reviewed explicitly in Milestone 1.

## 3. Current CF5 Execution Path

### What is and is not live

CF5 is an experimental CLI/replay harness, not an HTTP or product service. A repository search found no import of `backend/experiments/cf5/` from outside that directory.

The deployed ClaimFoundry route is separate:

```text
backend/server.js:244
  -> createClaimFoundryRouter()                         backend/src/routes/claim-foundry/index.js:9
  -> POST /v1/claim-packages                           backend/src/routes/claim-foundry/public.routes.js:22
  -> submitCf1Package()                                backend/src/routes/claim-foundry/submitService.js:40
  -> runClaimFoundry()                                 backend/src/claim-foundry/runClaimFoundry.js:34
  -> assembleCf1Package() / verifyCf1Package()
  -> finalizeCf1Package()
  -> persistCompletedCf1Run()
```

That flow is CF1 package infrastructure, not CF5. CF6 Milestone 1 must not attach to it.

### Exact CF5 start function and call flow

The exact callable that starts one CF5 run is:

```text
runCf5Once()
backend/experiments/cf5/run-cf5.mjs:42
```

The CLI entry is `main()` at `run-cf5.mjs:125`, guarded by `import.meta.url` at line 170.

Actual CF5 call flow:

```text
CLI main()
  backend/experiments/cf5/run-cf5.mjs:125
    -> loadFixtureArticle()
       run-cf5.mjs:27
       -> articleDocumentFromText()
          backend/src/claim-foundry/article-document/fromText.js:51
       -> sourceUnits mapped to { unitId, text }
    -> buildCf5ClaimGenerationPrompt()
       backend/experiments/cf5/prompts.js:83
    -> createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() })
       backend/src/claim-foundry/modelRunner.js:112
       backend/src/claim-foundry/openAiResponsesTransport.js:16
    -> runCf5Once()
       run-cf5.mjs:42
       -> runner.invokeStructured()                    generation call
       -> runGenerationPipeline()
          backend/experiments/cf5/pipeline.js:9
          -> validateClaims()
             backend/experiments/cf5/validation.js:17
          -> optional one buildCf5RepairPrompt() call
          -> applyRepair()
             backend/experiments/cf5/validation.js:93
          -> validateClaims() again
       -> final-claims.json + validation-report.json + usage.json + run-manifest.json
```

The return value from `runCf5Once()` is `{ manifest, finalClaims, findings }` (`run-cf5.mjs:122`). There is no CF5 package class or final package serializer.

### Configuration and model settings

CF5 has no feature flag and no production route switch. CLI options are parsed directly from `process.argv`:

- `--fixture`, default `CF1-F03`;
- `--model`, default `gpt-4.1-mini`;
- `--repeats`, default `1`;
- `--timeout-ms`, default `180000`;
- `--out`, default `artifacts/claim-foundry/cf5/<fixture>-<timestamp>`.

The generation and repair calls use:

- OpenAI Responses API;
- `reasoningEffort: "none"`;
- one transport attempt;
- `maxOutputTokens: 6000` for generation and `3000` for repair;
- `store: false`.

Credentials are read from `OPENAI_API_KEY` or legacy `REACT_APP_OPENAI_API_KEY` (`run-cf5.mjs:134`; `openAiResponsesTransport.js:4`).

`prompts.js:6` identifies the canonical prompt as `PromptCF5-v0001`. Prompt versions v0002 through v0005 live in isolated experiment modules and are not selected by the canonical runner. In particular, `promptCF5v005.js` is an experimental no-count-ceiling/atomicity arm, not “current production CF5.”

### Artifacts

Canonical `run-cf5.mjs` writes under `artifacts/claim-foundry/cf5/`:

- article and source-unit inputs;
- generation prompt and JSON schema;
- raw model response and parsed rows;
- optional repair prompt and response;
- validation report;
- final claims;
- usage;
- run manifest.

Additional frozen/reviewable experiment roots exist at:

- `artifacts/claim-foundry/cf5-experiment1/`;
- `artifacts/claim-foundry/cf5-experiment2/`;
- `artifacts/claim-foundry/cf5-promptcf5-v002/`;
- `artifacts/claim-foundry/cf5-promptcf5-v003-v004/`;
- `artifacts/claim-foundry/cf5-promptcf5-v005/`.

These roots contain reused/frozen baseline responses and should be treated as read-only evaluation evidence.

## 4. Content and Source-Unit APIs

### Canonical content representation

The reusable content boundary is `ArticleDocument`, built by `buildArticleDocument()` in `backend/src/claim-foundry/article-document/buildArticleDocument.js:23`. It returns plain JSON containing:

- canonical text and content hash;
- ordered atoms and source units;
- links;
- citation markers;
- references;
- metadata and source descriptor;
- adapter and structure-profile identity;
- diagnostics.

`ARTICLE_DOCUMENT_SCHEMA` is currently `cf1.articleDocument.v3` (`article-document/contract.js:1`).

### Existing adapters

| Input | Existing API | Verified behavior | Current wiring |
|---|---|---|---|
| Plain article text / paste | `articleDocumentFromText()` (`fromText.js:51`) | Normalizes NFC/newlines; identifies headings, paragraphs, quotations, lists, table rows, separators, and visible URLs | Used by CF5 and deployed CF1 |
| HTML | `articleDocumentFromHtml()` (`fromHtml.js:179`) | Chooses a likely article root, removes junk, retains headings/paragraphs/lists/quotes/captions/preformatted/table rows, links, citation markers, and references | Available library API; not used by CF5 or the public ClaimFoundry submit path |
| PDF layout | `extractPdfLayout()` (`fromPdf.js:161`) then `articleDocumentFromPdf()` (`fromPdf.js:177`) | Preserves page/layout signals, headings, paragraph groupings, table-like rows, links, and repeated-edge removal | Available library API; not used by CF5 or the public ClaimFoundry submit path |
| Transcript | No dedicated transcript adapter found | The contracts support `speaker_turn`, transcript speaker/timestamp signals, and `sourceFamily: "transcript"` | **UNKNOWN:** no located adapter converts raw transcript text into speaker-turn atoms |
| Social post/thread | No dedicated adapter found in this audit | Contracts include social atom/unit types and structure signals | **UNKNOWN:** no located raw social-content adapter |

The public route accepts a normalized article object and `runClaimFoundry()` always calls `articleDocumentFromText()` (`runClaimFoundry.js:47`). Supporting native HTML/PDF/transcript inputs through CF6 later will require an explicit adapter selection boundary; Milestone 1 should not create it.

### Atoms, units, blocks, and identifiers

Identifiers are deterministic and ordinal:

- atom: `A0001` from `articleAtomId()` (`article-document/contract.js:34`);
- source unit: `U0001` from `articleUnitId()` (`contract.js:35`);
- link: `L0001`;
- citation marker: `CM001`;
- reference: `REF001`;
- source block: `B001` in `buildArticleSourceBlocks()` (`sourceBlocks.js:96`).

`buildSourceUnits()` (`sourceUnits.js:45`) sentence-segments paragraph atoms through `Intl.Segmenter`; headings, quotations, list items, table rows, captions, speaker turns, and social items remain whole-atom units. Every unit records `unitId`, `atomId`, order, type, text, and canonical source offsets.

`buildArticleSourceBlocks()` groups the complete `ArticleDocument` by heading, separator, visual gap, structural type, and bounded size. It returns block heading, text, structural type, atom IDs, source-unit IDs, link IDs, offsets, and boundary reason. `verifyArticleSourceBlocks()` (`sourceBlocks.js:128`) verifies ordered, non-overlapping, complete atom/unit/text coverage.

HTML citation handling is substantive:

- superscript/numeric/author-year markers are extracted in `fromHtml.js:89-117`;
- reference-section entries are recognized in `fromHtml.js:119-127`;
- links, markers, references, and their IDs are materialized by `buildArticleDocument()`.
- footnotes and endnotes are not distinct source-unit types; when present in retained article HTML, their visible text survives as ordinary structural atoms/units and their links/markers can be represented by the citation/reference structures above. **UNKNOWN:** no dedicated footnote/endnote semantic adapter was located.

CF5 deliberately narrows the richer `ArticleDocument.sourceUnits` records to `{ unitId, text }` before prompting (`backend/experiments/cf5/run-cf5.mjs:74-77`). Future CF6 content tools should retain the original `ArticleDocument` in run context rather than reconstructing structure from that narrowed model input. The CF5 `run-manifest.json` is an experiment manifest; it is not the canonical content manifest.

### Suitable future CF6 tool wrappers

These are future ClaimFoundry-domain tools and are **not** part of Milestone 1.

1. `get_content_map`
   - Wrap `buildArticleSourceBlocks(articleDocument, options)` and `verifyArticleSourceBlocks(articleDocument, blocks, options)`.
   - Return bounded metadata, atom/block headings, block types, source-unit ranges/IDs, reference counts, and content hash.
   - Do not expose a shell or filesystem path. Pass an already-ingested `ArticleDocument` through run context.

2. `read_source_units`
   - No dedicated exported function exists.
   - Implement as a bounded lookup over `articleDocument.sourceUnits`, preserving document order and returning the existing unit JSON shape.
   - Reject unknown IDs and oversized requests deterministically.

3. `find_source_units`
   - No dedicated exported function exists.
   - Implement as deterministic in-memory search over `articleDocument.sourceUnits[].text`, ideally with literal/normalized token matching and bounded results.
   - It must not perform web search or semantic model calls. Return unit IDs, text, type, order, and match offsets/scores that are genuinely computed.

## 5. Claim Schemas and Validators

### CF5 canonical row schema

`CF5_CLAIMS_SCHEMA_V1` is a strict JSON Schema in `backend/experiments/cf5/schemas.js:8`. There is no Zod schema or TypeScript interface for CF5.

Each model-created row requires exactly:

| Field | Meaning |
|---|---|
| `claimId` | Package-local stable row ID |
| `claim` | Self-contained externally gradable proposition |
| `grounding` | One or more source-unit ID strings |
| `articleTreatment` | `adopted`, `challenged`, or `reported` |
| `provenance` | Free-text external semantic origin, or `null` for article voice |

`CF5_REPAIR_SCHEMA_V1` (`schemas.js:46`) reuses the identical item shape under `repairedClaims`.

This is the suitable schema for the first **ClaimFoundry** CF6 working-package vertical slice because it is the only strict CF5 canonical contract and preserves the callable CF5 comparison. It is not needed in Milestone 1, which must contain no ClaimFoundry domain tool.

### Rich deployed CF1 package

The deployed package schema is a plain-JavaScript/JSON contract, not a Zod or TypeScript contract:

- `CF1_SCHEMA_VERSION = "cf1.claimPackage.v1"` (`backend/src/claim-foundry/contract.js:1`);
- `assembleCf1Package()` (`assemblePackage.js:10`);
- `verifyCf1Package()` (`verifyPackage.js:188`);
- `finalizeCf1Package()` (`assemblePackage.js:72`).

It includes source atoms/units/links/references, semantic blocks, raw assertions, article map, consistency findings, selected claims, evidentiary targets, evidence-need cards, identity bundles, diagnostics, verification, and a package hash.

Canonical concepts are represented as plain JSON and enums rather than classes:

- assertion form and article use: `CF1_ASSERTION_FORMS`, `CF1_ARTICLE_USES`;
- treatment/posture: CF5 `articleTreatment`; rich CF1 `articleUse` and `articleRole`;
- evidence target: `phase3Targets` and `CF1_TARGET_TYPES`;
- grounding: source atom/unit/block ID arrays, plus deterministic grounding verification;
- provenance/identity: source references, links, named works, and `sourceIdentityBundles`;
- attribution: assertion-source strings and identity bundles in the rich path; the simpler CF5 `provenance` string in CF5;
- score semantics: `CF1_SCORE_TRANSFORMS`;
- package projection into VeriStrata: `backend/src/claim-foundry/veristrata/projectPackage.js`.

CF5's tests explicitly forbid rich fields such as `phase3Targets`, `evidenceNeedCards`, `pillar`, `scoreTransform`, `identityBundle`, and `searchHints` (`backend/experiments/cf5/integration.test.js:138-155`). Therefore a strict compatible projection from CF5 to `cf1.claimPackage.v1` is currently impossible without a new, explicit enrichment/projection step. Reusing the rich verifier directly on five-field CF5 rows would be incorrect.

### Existing CF5 deterministic validation

`validateClaims()` (`backend/experiments/cf5/validation.js:17`) verifies:

- object and `claimId` presence;
- unique claim IDs;
- nonempty claim text;
- nonempty grounding and known source-unit IDs;
- valid treatment enum;
- `provenance` is `null` or a nonempty string;
- exact punctuation/case-normalized duplicate text, which is dropped;
- thin sets (`<8`) and oversized sets (`>15`) as informational findings only.

It explicitly does **not** validate truth, materiality, treatment correctness, provenance correctness, semantic atomicity, thesis bearing, causal validity, or semantic duplication (`validation.js:1-5`).

### Other validators and diagnostics

- `runGenerationPipeline()` (`pipeline.js:9`) executes validation, at most one model repair, deterministic merge, and a second validation.
- `findNearDuplicates()` and `findPossiblyCompound()` in `backend/experiments/cf5/regressionAnalysis.js:27,45` are report-only heuristics, not hard validation.
- `matchTargetsForRun()` in `targetMatching.js:64` is a lexical, human-review proxy for selected sealed cruxes, not semantic truth.
- The older `runHostSemanticCritic()` and rich CF1 verifiers exist under `backend/src/claim-foundry/`, but they operate on older rich schemas. CF5 deliberately does not import them.
- `verifyCf1Package()` performs rich shape, reference, provenance, grounding, source-identity, target/card, count, size, and final-hash validation.
- `classifyRepairability()` (`verifyPackage.js:218`) separates terminal from repairable rich-package failures.

### Existing mutation and repair utilities

- CF5 `applyRepair()` (`validation.js:93`) can replace only rows whose claim IDs were flagged as hard failures. It is not a generic patch engine.
- Rich CF1 `backend/src/claim-foundry/applyRepair.js` and `repairContract.js` apply allow-listed JSON-pointer repairs to the rich package. They are not compatible with the CF5 row contract.
- Numerous split/merge/source utilities exist under `backend/src/claim-foundry/`, but importing them into CF5/CF6 would reintroduce the architecture the CF5 isolation test intentionally excludes.

### Future tool mapping

| Future tool | Reusable function | Limitation |
|---|---|---|
| `validate_working_package` | Wrap CF5 `validateClaims()` for the five-field working schema; optionally append report-only diagnostics from `regressionAnalysis.js` | Semantic treatment/provenance/atomicity correctness remains unverified |
| `apply_package_patch` | No compatible generic CF5 patch function exists | Create a narrow future patch schema; apply only by existing claim ID; then always call `validateClaims()` again. Do not reuse rich CF1 JSON pointers blindly |
| `finalize_claim_package` | For a CF5-compatible slice, validate, canonicalize, and freeze the five-field result; for deployed persistence, use `finalizeCf1Package()` only after a separately verified rich projection | The required CF5-to-CF1 projection is **UNKNOWN** and out of Milestone 1 |

## 6. Persistence, State, and Audit Infrastructure

### CF5 persistence

CF5 persistence is filesystem-only. `runCf5Once()` writes JSON artifacts directly through `writeFileSync()`. `replayRun()` in `backend/experiments/cf5/replay.mjs` reproduces validation from stored model output without network calls. No CF5 database repository, run table, queue, or durable event log exists.

### Existing deployed ClaimFoundry persistence

MySQL is the durable product store:

- pool/query: `backend/src/db/pool.js:12,33`;
- transactions: `withTransaction()` in `backend/src/storage/dbTransaction.js:20`;
- run identity and status: `backend/src/storage/claimFoundryRunStore.js`;
- immutable package persistence: `backend/src/storage/claimFoundryPackageStore.js`;
- transactional finalization: `persistCompletedCf1Run()` in `claimFoundryPersistence.js:18`;
- schema migration: `backend/migrations/2026-07-13-01-claim-foundry-core.sql`.

Existing tables:

- `claim_foundry_runs` — idempotency identity, input/options hashes, pipeline version, status, final package ID, error JSON, usage JSON, artifact root, timestamps;
- `claim_foundry_packages` — immutable rich package JSON plus hashes, lineage, counts, and verification timestamps;
- `claim_foundry_package_bindings` — consumer/content bindings and projection status.

Existing run statuses are `submitted`, `running`, `verification_failed`, `ready_for_evidence`, and `failed` (`backend/src/claim-foundry/contract.js:103`).

Idempotency is implemented by `(consumer_key, idempotency_key)` plus input/options/pipeline hash checks in `createOrLoadCf1Run()` (`claimFoundryRunStore.js:11`). There is no durable worker/job queue in the audited ClaimFoundry path.

Redis (`backend/src/db/redis.js`) is optional cache infrastructure that degrades to `null`; it is not a durable run-state or event store and must not become the sole CF6 audit record.

### Existing trace/audit behavior

The older scripted CF1 “agent” records an in-memory `stepTrace` through `createCf1AgentState()`, `beginAgentStep()`, and `completeAgentStep()` (`backend/src/claim-foundry/agentTypes.js`). `agentExecution.js` also records prompt hashes and a provider system fingerprint. These are serialized into diagnostics/artifacts when that older pipeline succeeds; they are not an append-only database event log.

Model usage is captured in run state and product persistence. Raw responses are available in experiment artifacts but are not stored as normalized consequential tool events.

### Smallest eventual persistence placement

Milestone 1 should persist nothing and remain a non-production smoke test.

For a later CF6 ClaimFoundry milestone:

- retain `claim_foundry_runs` as the run identity/idempotency/status/final-package anchor;
- persist a versioned `ClaimFoundryRunState` either in a new JSON column/table, not in Redis;
- add an append-only tool-event table keyed by run ID and monotonically increasing sequence for consequential calls;
- store validation reports and repair history as explicit versioned JSON event payloads or dedicated artifacts referenced from the run;
- reuse `package_id` and immutable `claim_foundry_packages` only after a rich package passes `verifyCf1Package()`;
- add explicit `trace_id`/provider trace metadata columns or event fields rather than overloading `artifact_root`.

Additive migrations will eventually be required for durable run state, tool events, repair history, and trace IDs. No existing column stores all of those concerns, and no migration should be created in Milestone 1.

## 7. Model and Provider Boundaries

### Current model paths

Two OpenAI paths coexist:

1. CF5 experiment path — Responses API:
   - `createOpenAiResponsesCf1Transport()` imports `OpenAI` directly and calls `openai.responses.create()` (`backend/src/claim-foundry/openAiResponsesTransport.js:1,16-31`).
   - It records provider usage, parses strict JSON-schema output, returns raw response/model/usage, and rejects incomplete responses.

2. Deployed CF1 path — Chat Completions:
   - `createOpenAiCf1Transport()` delegates to the repository `openAiLLM.generate()` port (`openAiTransport.js:3`).
   - `openAiLLM` calls `/v1/chat/completions`, supports JSON schema where the model allows it, timeout, seed, response metadata, usage, and limited network/server retry.

No Anthropic client or general multi-provider model implementation was located in the ClaimFoundry model path.

### Existing provider-neutral seam

`createCf1ModelRunner()` and `invokeStructured()` in `backend/src/claim-foundry/modelRunner.js` already establish a small transport contract:

```text
transport.invoke(request)
  -> { output, usage, model, rawResponse }
```

That runner normalizes usage, applies a timeout, parses/validates a structured object, caps attempts at two, and returns cumulative tokens. It is the best existing example of a repository-owned provider boundary.

It should not be reused as the SDK runner itself: doing so would place a scripted one-shot call abstraction around a managed agent loop. Instead, the new `backend/agents/shared/modelProvider.ts` should follow the same dependency-injection principle while returning/configuring the SDK model/provider needed by `backend/agents/shared/agentRuntime.ts`.

Only the shared runtime/provider layer should import provider/agent SDK packages. Future ClaimFoundry agents and tools should depend on the repository boundary, not import `@openai/agents` or `openai` directly.

### Model selection, telemetry, and retries

- Deployed CF1 model and budgets are environment-configured in `backend/src/routes/claim-foundry/runtime.js:11-32` through `CF1_MODEL`, timeout/context/token/duration variables, and API key.
- CF5 model/settings are CLI values in `run-cf5.mjs`.
- `modelRunner.js` records input, output, total, and cached input tokens. It does not compute dollar cost.
- `openAiUsageTelemetry.js` aggregates calls/tokens/models through `AsyncLocalStorage`; it does not compute price.
- Some CF5 experiment manifests record wall latency and provider response metadata; canonical `runCf5Once()` records timestamps but not a dedicated latency field.
- Raw provider responses are written in CF5 experiments and returned by both OpenAI transports.
- Existing retry behavior is not uniform: the generic structured runner allows one or two transport attempts, CF5 explicitly requests one, and `openAiLLM.generate()` has its own attempt loop.

The CF6 shared runtime should normalize model name, token usage, duration, SDK trace ID, tool-call count, termination reason, and provider error into repository-owned types. It must not expose OpenAI response objects as the domain contract.

## 8. Fixtures and Evaluation Infrastructure

### Fixtures and gold

Primary fixture articles:

- `backend/test/claim-foundry/fixtures/CF1-F02/article.json`;
- `backend/test/claim-foundry/fixtures/CF1-F03/article.json`;
- `backend/test/claim-foundry/fixtures/CF1-F06/article.json`.

All nine fixture directories, F01 through F09, exist under `backend/test/claim-foundry/fixtures/`.

Sealed CF4 gold overlays used by CF5 target matching:

- `backend/experiments/cf4/gold/CF1-F02.gold.json`;
- `backend/experiments/cf4/gold/CF1-F03.gold.json`;
- `backend/experiments/cf4/gold/CF1-F06.gold.json`;
- seal metadata: `backend/experiments/cf4/gold/SEALED.json`.

The CF4 gold and all CF5 experiment code are currently untracked, so they are present and callable but not reproducible from the current Git commit alone.

### Commands and scripts

Canonical one-fixture CF5 run:

```bash
node backend/experiments/cf5/run-cf5.mjs \
  --fixture CF1-F03 \
  --model gpt-4.1-mini \
  --repeats 1
```

Offline replay:

```bash
node backend/experiments/cf5/replay.mjs <repeat-directory>
```

Other experiment entry points:

- `run-cf5-experiment1.mjs`;
- `run-cf5-experiment2.mjs`;
- `run-cf5-experimental.mjs`;
- `run-promptcf5-v002.mjs`;
- `run-promptcf5-v003-v004.mjs`;
- `run-promptcf5-v005.mjs`.

### Reports and current metrics

`buildReviewHtml()` in `backend/experiments/cf5/reportBuilder.js:50` is the binding CF5 self-contained review format. It supports embedded JSON, filters, search, sorting, click-to-expand details, field-provenance tags, and extra tabs. `CF5_REPORTING_STANDARD_2026-07-27.md` requires future CF5 reports to use it.

Current metric coverage:

| Concern | Existing implementation | Status/limitation |
|---|---|---|
| Crux recall | `matchTargetsForRun()` + `targetBasedStability()` | Only 13 hard-coded lexical crux patterns across F02/F03/F06; requires human review |
| Material omissions | Gold crux absence/ambiguity in `targetMatching.js` | Partial proxy only; no general material-omission detector |
| Duplicate units | `validateClaims()` exact normalized duplicates; `findNearDuplicates()` | Exact duplicates are enforced; near duplicates are report-only |
| Compound units | `findPossiblyCompound()` | Crude word/conjunction review proxy only |
| Grounding defects | `validateClaims()` known/nonempty unit IDs | Structural grounding only; does not prove textual entailment |
| Attribution/provenance defects | `validateClaims()` nonempty string-or-null shape | No semantic correctness check |
| Treatment defects | Enum validation only | No semantic correctness check |
| Run stability | `exactTextStability()` and `targetBasedStability()` | Exact text understates paraphrase stability; target coverage is only the limited crux set |
| Tokens | CF5 `usage.json`, manifests, `modelRunner.js` | Available |
| Cost | No repository cost calculation located | **UNKNOWN / absent** |
| Latency | Some experiment manifests and provider metadata | Not consistently normalized by canonical CF5 |

### Smallest eventual CF5/CF6 side-by-side change

Do not change CF5. After Milestone 1, add a separate CF6 experiment runner that:

1. loads the same fixture article/source units;
2. calls either the frozen CF5 callable or the future CF6 callable behind explicit arm names;
3. normalizes both outputs into report rows without changing either source result;
4. writes to a new `artifacts/claim-foundry/cf6/...` directory;
5. reuses `buildReviewHtml()` and `regressionAnalysis.js`;
6. records prompt/tool/schema hashes, model, SDK/trace metadata, token usage, duration, and arm identity.

Because CF5 is untracked, a durable comparison first requires the owner to preserve the exact CF5 baseline code/artifact lineage. Milestone 1 must not solve that by moving or rewriting CF5.

## 9. Smallest CF6 Insertion Points

| CF6 concern | Existing file/function | Proposed wrapper or insertion point | Reuse level | Risk |
|---|---|---|---|---|
| SDK-managed loop | No Agents SDK runtime exists | New `backend/agents/shared/agentRuntime.ts` | New boundary; imitate dependency injection in `createCf1ModelRunner()` | Medium: SDK/version/Node compatibility |
| Provider neutrality | `modelRunner.js` transport port; OpenAI transports | New `backend/agents/shared/modelProvider.ts`; only this/shared runtime imports provider packages | Pattern reuse, not code wrapping | Medium: SDK model-provider types may be provider-shaped |
| Environment validation | `createCf1Runtime()` validates CF1 env | New `backend/agents/shared/environment.ts`, limited to smoke env | Pattern reuse | Low; must not read CF1 flags or start server |
| Budget guard | `tokenBudget.js`; CF1 runtime budget env | New `backend/agents/shared/runBudget.ts` with SDK-run counters only | Conceptual reuse | Medium; SDK usage event shape must be verified |
| Trace metadata | `agentTypes.js` step trace; `agentExecution.js` prompt fingerprints | New `backend/agents/shared/traceMetadata.ts` | Shape/pattern reuse | Medium; SDK trace-ID exposure is version-specific |
| Error normalization | `Cf1Error` | New `backend/agents/shared/agentErrors.ts`; no dependency on CF1 domain codes | Pattern reuse | Low |
| Smoke tool | No equivalent | New `backend/agents/smoke/smokeTool.ts`; deterministic typed echo/normalization only | New | Low |
| Smoke agent | No equivalent | New `backend/agents/smoke/smokeAgent.ts` | New, non-production | Low if unreachable from server |
| Content map (later) | `buildArticleSourceBlocks()`, `verifyArticleSourceBlocks()` | Future bounded CF6 domain-tool wrapper | High | Low structurally; not Milestone 1 |
| Read source units (later) | `ArticleDocument.sourceUnits` | Future bounded lookup tool | High | Low; no exported lookup currently |
| Find source units (later) | No dedicated search API | Future deterministic in-memory search | Partial | Medium: matching semantics need a contract |
| Working validation (later) | CF5 `validateClaims()` | Future `validate_working_package` tool | High for structural checks | Medium: semantic checks remain absent |
| Patch (later) | CF5 `applyRepair()` only replaces failed rows | Future narrow patch utility, always revalidating | Partial | High if generalized prematurely |
| Finalize (later) | `finalizeCf1Package()` for rich package only | Future explicit CF5-working-result or rich-package adapter | Low until projection exists | High; schemas are incompatible |
| Run persistence (later) | `claim_foundry_runs`, immutable packages | Extend through additive state/event persistence | Medium | High; migration required |
| Side-by-side reports (later) | `buildReviewHtml()` and regression metrics | New CF6 experiment/report adapter | High | Medium because current CF5/gold code is untracked |

## 10. Exact Milestone 1 File List

This is the complete proposed Milestone 1 file set. It contains no ClaimFoundry domain tool and no production route.

| Path | Create/modify | Responsibility | Existing dependency | CF5 impact |
|---|---|---|---|---|
| `backend/package.json` | Modify | Add one agent SDK (`@openai/agents`), direct Zod 4, TypeScript execution/typecheck development dependencies, and isolated smoke/typecheck scripts | Existing backend npm package and ESM mode | None at runtime unless another file imports the new subtree; review OpenAI dependency resolution |
| `backend/package-lock.json` | Modify | Lock the exact SDK/Zod/TypeScript toolchain and all transitive versions | npm | None logically; lockfile diff risk must be reviewed |
| `backend/agents/tsconfig.json` | Create | Scope strict TypeScript checking to `backend/agents/**`; target a Node-18-compatible ESM output contract | Backend ESM package; Node types if added as dev dependency | None |
| `backend/agents/shared/agentErrors.ts` | Create | Repository-owned normalized SDK/runtime error types and safe serialization | No CF1 domain import | None |
| `backend/agents/shared/environment.ts` | Create | Validate `OPENAI_API_KEY` and an explicit non-production `CF6_SMOKE_MODEL`; fail before a network call | `process.env` only | None |
| `backend/agents/shared/modelProvider.ts` | Create | Define the provider-neutral model/provider port and the initial OpenAI-backed adapter used by smoke runtime | `@openai/agents`; environment config | None |
| `backend/agents/shared/runBudget.ts` | Create | Define bounded maximum turns/tool calls/time for the smoke run and validate counters | Repository-owned plain types | None |
| `backend/agents/shared/traceMetadata.ts` | Create | Normalize SDK trace/run/model/tool/usage metadata into plain JSON | SDK result/trace types through the shared boundary | None |
| `backend/agents/shared/agentRuntime.ts` | Create | Own SDK `Agent`/runner execution, model-provider injection, budget enforcement, trace normalization, and error normalization | Shared files above; `@openai/agents` | None |
| `backend/agents/smoke/smokeTool.ts` | Create | One harmless Zod-typed deterministic tool (for example, normalize and echo supplied text); no shell, filesystem, SQL, HTTP, or product access | `zod`; SDK `tool()` helper through the runtime package | None |
| `backend/agents/smoke/smokeAgent.ts` | Create | Define a non-production agent that must call the harmless tool and return a small typed result | Shared runtime; smoke tool | None |
| `backend/agents/smoke/smokeAgent.test.ts` | Create | Live integration test proving the SDK, not hand-written orchestration, executes the model/tool loop; assert tool event, typed result, bounded turns, and trace metadata | Node test/assert; smoke agent; live API credentials | None |
| `backend/agents/README.md` | Create | State non-production status, environment variables, architecture boundary, and exact smoke/typecheck commands | None | None |

Recommended audited dependency pins at the time of implementation:

```text
@openai/agents 0.13.5
zod 4.4.2
```

Because the backend currently runs Node 18 and has no TypeScript toolchain, `typescript`, `tsx`, and compatible Node type definitions should be direct development dependencies rather than relying on unrelated root-package transitive tooling. Their exact versions must be selected and locked during implementation. Only `@openai/agents` is an agent framework.

The intended backend scripts are:

```json
{
  "typecheck:agents": "tsc -p agents/tsconfig.json --noEmit",
  "test:agents:smoke": "tsx --test agents/smoke/smokeAgent.test.ts"
}
```

The smoke test must not auto-register with `backend/server.js`, import CF5, or silently skip after credentials were intentionally supplied.

## 11. Risks and Unknowns

### Verified risks

1. **CF5 is untracked.** All current CF5 code appears as untracked content. A Git commit cannot currently restore the baseline the MCT requires CF6 to preserve.
2. **Backend TypeScript execution is absent.** Node 18.20.4, no backend tsconfig, and no direct TypeScript runner mean `.ts` scaffold files require explicit development tooling.
3. **SDK dependency movement.** `@openai/agents@0.13.5` wants Zod 4 and `openai ^6.46.0`; the backend currently installs `openai@6.34.0` and no direct Zod. A careless install can create a large or behavior-relevant lockfile change.
4. **CF5 and deployed package schemas are different.** CF5 outputs five-field rows; product persistence verifies a rich immutable `cf1.claimPackage.v1`. No strict projection exists.
5. **Production and experiment model transports differ.** CF5 uses Responses directly; deployed CF1 uses repository Chat Completions. Telemetry/retry behavior is not uniform.
6. **No durable tool-event store exists.** Current run rows store summary status/usage/error/artifact root, not ordered tool calls, validation history, or SDK trace IDs.
7. **CF5 semantic validators are intentionally weak.** Grounding existence and enum shape are enforced; semantic attribution, treatment, materiality, atomicity, and omission correctness are not.
8. **Evaluation is partial.** The target matcher covers 13 lexical crux patterns only. Cost is not calculated, and canonical CF5 latency is not normalized.
9. **Native HTML/PDF adapters are not wired to public ClaimFoundry.** The public pipeline normalizes input through `articleDocumentFromText()` regardless of original source.
10. **Test command fragmentation.** Backend `npm test` fails intentionally, and CF5 tests are not registered in package scripts.
11. **Generated-artifact overwrite risk.** Existing CF5 evidence lives below multiple `artifacts/claim-foundry/cf5-*` roots. CF6 must use a new `artifacts/claim-foundry/cf6/` namespace and must never reuse a frozen CF5 run directory.
12. **Naming and circular-dependency risk.** The repository already has older files named `agentTypes.js` and `agentExecution.js` under `backend/src/claim-foundry/`. New shared files must remain under `backend/agents/shared/`, and that shared layer must not import CF5, routes, persistence repositories, or ClaimFoundry domain packages; domain code may depend inward on the shared runtime, never the reverse.
13. **Live-test fragility.** The required smoke test depends on network access, API credentials, model entitlement, tool-call behavior, and provider latency. It needs explicit bounds and a clearly separate command so ordinary offline tests do not become flaky or billable.

### UNKNOWN / decisions required

1. **Node support policy:** the package registry does not declare an `engines` field for `@openai/agents@0.13.5`. A real smoke run on Node 18 must prove compatibility, or the project must approve a backend Node upgrade. Do not infer compatibility from successful installation alone.
2. **TypeScript toolchain policy:** confirm whether adding `typescript`/`tsx` to the backend package is accepted. Depending on root-package copies would make the backend package non-self-contained.
3. **Smoke model access:** the exact `CF6_SMOKE_MODEL` must be chosen from a model enabled for the project's API key and capable of tool use.
4. **Tracing policy:** verify the SDK version's exact trace-ID/result API and whether remote tracing is allowed for the project's data policy before persisting provider trace identifiers.
5. **Baseline identity:** decide whether canonical CF5 means PromptCF5-v0001 or one of the later experimental prompt arms. The repository currently labels v0001 canonical and v0002-v0005 experimental.
6. **Future final contract:** decide whether the first domain milestone ends at a CF5-compatible five-field working result or must also create a rich persisted CF1 package. The latter requires an explicit projection not present in the repository.
7. **Transcript ingestion:** source types support transcript structures, but no dedicated raw transcript adapter was located.
8. **Run-state schema:** the exact event/state retention period, payload size, redaction policy, and migration shape are not specified.
9. **Cost calculation:** no audited model-price registry was found in this path, so token-to-dollar reporting needs a separate authoritative source.

Blocking for Milestone 1 implementation:

- resolve Node 18/TypeScript execution strategy;
- provide a permitted live smoke model/API project;
- preserve or explicitly accept the current untracked status of the CF5 baseline before any broader repository cleanup.

None of these requires changing CF5.

## 12. Milestone 1 Implementation Sequence

1. Re-run the repository preflight (`git status --short`, branch, diff stat, Node/npm versions) and confirm the existing dirty files are untouched.
2. Resolve the three blocking prerequisites in Section 11: Node/TypeScript execution, smoke model access, and CF5 baseline preservation.
3. From `backend/`, install exactly one agent framework plus the direct schema/runtime development dependencies, pinned and lockfile-reviewed. Do not install a second agent framework.
4. Add only the shared runtime files listed in Section 10. Keep SDK/provider types from leaking into domain code.
5. Add the harmless typed smoke tool. It must have no shell, filesystem, SQL, web, database, or product capability.
6. Add the non-production smoke agent and run it only through the shared runtime.
7. Add the live smoke test. Require it to demonstrate an SDK-managed tool call and typed final result within explicit turn/tool/time bounds.
8. Add `backend/agents/README.md` with the environment contract and commands.
9. Run static verification:

   ```bash
   cd backend && npm run typecheck:agents
   ```

10. With `OPENAI_API_KEY` and `CF6_SMOKE_MODEL` set, run the exact Milestone 1 acceptance command:

   ```bash
   cd backend && npm run test:agents:smoke
   ```

11. Re-run `node --test backend/experiments/cf5/*.test.js` to prove the untouched baseline remains green.
12. Inspect `git diff -- backend/package.json backend/package-lock.json backend/agents` and verify there is no server route, feature flag, CF5 import, ClaimFoundry tool, production agent, migration, or artifact overwrite.
13. Stop. Do not proceed to ClaimFoundry integration until Milestone 1 is reviewed.

## Appendix A: Referenced Files and Exports

### CF5

- `backend/experiments/cf5/run-cf5.mjs`
  - `loadFixtureArticle()`
  - `runCf5Once()`
  - internal CLI `main()`
- `backend/experiments/cf5/prompts.js`
  - `buildCf5ClaimGenerationPrompt()`
  - `buildCf5RepairPrompt()`
  - `buildCf5ExperimentalPrompt()`
  - `serializeUnits()`
  - `CF5_GENERATION_PROMPT_VERSION`
  - `CF5_REPAIR_PROMPT_VERSION`
- `backend/experiments/cf5/schemas.js`
  - `CF5_CLAIMS_SCHEMA_V1`
  - `CF5_REPAIR_SCHEMA_V1`
- `backend/experiments/cf5/pipeline.js`
  - `runGenerationPipeline()`
- `backend/experiments/cf5/validation.js`
  - `validateClaims()`
  - `applyRepair()`
- `backend/experiments/cf5/replay.mjs`
  - `replayRun()`
- `backend/experiments/cf5/regressionAnalysis.js`
  - `findNearDuplicates()`
  - `findPossiblyCompound()`
  - `cruxPrecisionProxy()`
  - `exactTextStability()`
  - `targetBasedStability()`
- `backend/experiments/cf5/targetMatching.js`
  - `loadGoldTargets()`
  - `matchTargetsForRun()`
- `backend/experiments/cf5/reportBuilder.js`
  - `buildReviewHtml()`
- `backend/experiments/cf5/promptCF5v002.js`
  - `buildPromptCF5v002()`
- `backend/experiments/cf5/promptCF5v003.js`
  - `buildPromptCF5v003()`
- `backend/experiments/cf5/promptCF5v004.js`
  - `buildPromptCF5v004()`
- `backend/experiments/cf5/promptCF5v005.js`
  - `buildPromptCF5v005()`
- `backend/experiments/cf5/integration.test.js`
- `backend/experiments/cf5/pipeline.test.js`
- `backend/experiments/cf5/validation.test.js`

### Content and source representation

- `backend/src/claim-foundry/article-document/index.js` — public article-document exports
- `backend/src/claim-foundry/article-document/contract.js`
  - `ARTICLE_DOCUMENT_SCHEMA`
  - `ARTICLE_DOCUMENT_LIMITS`
  - atom/unit/source-kind constants
  - ID helpers
- `backend/src/claim-foundry/article-document/buildArticleDocument.js`
  - `buildArticleDocument()`
- `backend/src/claim-foundry/article-document/fromText.js`
  - `articleDocumentFromText()`
- `backend/src/claim-foundry/article-document/fromHtml.js`
  - `articleDocumentFromHtml()`
- `backend/src/claim-foundry/article-document/fromPdf.js`
  - `extractPdfLayout()`
  - `articleDocumentFromPdf()`
- `backend/src/claim-foundry/article-document/sourceUnits.js`
  - `buildSourceUnits()`
- `backend/src/claim-foundry/article-document/sourceBlocks.js`
  - `buildArticleSourceBlocks()`
  - `verifyArticleSourceBlocks()`
- `backend/src/claim-foundry/article-document/verifyArticleDocument.js`
  - `verifyArticleDocument()`
- `backend/src/claim-foundry/article-document/structureProfile.js`
  - `createStructureProfile()`
  - `assertStructureProfile()`
  - `structureProfileHash()`
  - `validateSourceFamily()`

### Product package, validation, and execution

- `backend/src/claim-foundry/contract.js` — `CF1_SCHEMA_VERSION`, `CF1_PIPELINE_VERSION`, enums, limits, statuses
- `backend/src/claim-foundry/assemblePackage.js`
  - `assembleCf1Package()`
  - `finalizeCf1Package()`
- `backend/src/claim-foundry/verifyPackage.js`
  - `verifyCf1Package()`
  - `classifyRepairability()`
- `backend/src/claim-foundry/runClaimFoundry.js`
  - `runClaimFoundry()`
- `backend/src/claim-foundry/applyRepair.js` — rich-package repair application
- `backend/src/claim-foundry/repairContract.js` — rich-package allow-listed repair paths
- `backend/src/claim-foundry/hostSemanticCritic.js`
  - `runHostSemanticCritic()`
- `backend/src/claim-foundry/agentTypes.js`
  - `createCf1AgentState()`
  - `beginAgentStep()`
  - `recordAgentStep()`
  - `completeAgentStep()`
  - `failAgentStep()`
- `backend/src/claim-foundry/agentExecution.js`
  - `runCf1Agent()`
  - `LIVE_PROMPT_IDENTITY`
- `backend/src/claim-foundry/veristrata/projectPackage.js`
  - product projection functions for verified rich packages

### Model/provider code

- `backend/src/claim-foundry/modelRunner.js`
  - `invokeStructured()`
  - `createCf1ModelRunner()`
- `backend/src/claim-foundry/openAiResponsesTransport.js`
  - `createOpenAiResponsesCf1Transport()`
- `backend/src/claim-foundry/openAiTransport.js`
  - `createOpenAiCf1Transport()`
- `backend/src/core/openAiLLM.js`
  - `openAiLLM.generate()`
  - `openAiLLM.testConnection()`
- `backend/src/core/openAiUsageTelemetry.js`
  - `withOpenAiUsageCapture()`
  - `recordOpenAiUsage()`
  - `getOpenAiUsageCapture()`
  - `finishOpenAiUsageCapture()`
- `backend/src/routes/claim-foundry/runtime.js`
  - `createCf1Runtime()`

### Routes and persistence

- `backend/server.js` — mounts ClaimFoundry router at line 244
- `backend/src/routes/claim-foundry/index.js`
  - `createClaimFoundryRouter()`
- `backend/src/routes/claim-foundry/public.routes.js`
  - `createCf1PublicRoutes()`
- `backend/src/routes/claim-foundry/submitService.js`
  - `submitCf1Package()`
- `backend/src/storage/claimFoundryRunStore.js`
  - `createOrLoadCf1Run()`
  - `lockCf1Run()`
  - `loadCf1RunForConsumer()`
  - status update/finalization functions
- `backend/src/storage/claimFoundryPackageStore.js`
  - `insertCf1Package()`
  - `loadCf1Package()`
  - `loadReadyCf1Package()`
  - `loadCf1PackageForConsumer()`
  - `lockLineageHead()`
- `backend/src/storage/claimFoundryPersistence.js`
  - `persistCompletedCf1Run()`
- `backend/src/storage/dbTransaction.js`
  - `connectionQuery()`
  - `acquireConnection()`
  - `withTransaction()`
- `backend/src/db/pool.js`
  - `pool`
  - `query()`
- `backend/src/db/redis.js`
  - `initRedis()`
  - `getRedisClient()`
  - `closeRedis()`
- `backend/migrations/2026-07-13-01-claim-foundry-core.sql`

### Fixtures, gold, and reporting specification

- `backend/test/claim-foundry/fixtures/CF1-F02/article.json`
- `backend/test/claim-foundry/fixtures/CF1-F03/article.json`
- `backend/test/claim-foundry/fixtures/CF1-F06/article.json`
- `backend/experiments/cf4/gold/CF1-F02.gold.json`
- `backend/experiments/cf4/gold/CF1-F03.gold.json`
- `backend/experiments/cf4/gold/CF1-F06.gold.json`
- `backend/experiments/cf4/gold/SEALED.json`
- `ml/cf1-argument-model/data/annotation-prompts/stupidity/CF5_REPORTING_STANDARD_2026-07-27.md`
