# CF1 Phase 4 — Agent Execution Design

> **Superseded:** The one-shot execution design in this document is retained only
> as baseline history. The governing runtime is
> `docs/claim_foundry_cf1_agent_runtime_milestone.md`. A one-shot structured call
> must never be labeled the CF1 agent path.

**Status:** Superseded baseline design
**Goal:** Obtain coherent article-level reasoning with the fewest useful model calls, then enforce safety deterministically.

## 1. Execution doctrine

CF1 is a bounded agent workflow, not an open-ended autonomous loop.

```text
LLM + focused instructions + structured article state
+ deterministic tools + validation + at most one repair + persistence
```

The model decides article meaning, argument structure, selected claims, target decomposition, and evidence-planning intent. Deterministic code owns source structure, IDs, limits, normalization, reference integrity, verification, hashing, and persistence.

No CF1 component may search the web, discover a URL, fetch evidence, classify evidence stance, or score truth.

## 2. Runner input and output

Core runner:

```js
runClaimFoundry({
  article,
  consumerContext,
  options,
  dependencies
}) -> Promise<{ run, claimPackage?, artifactRefs }>
```

`article` is `CF1ArticleInput`. `consumerContext` contains opaque consumer identity and optional binding references, never product semantics. `options` contains semantic budgets and persistence/artifact flags. Dependencies are injected model, clock, ID factory, token estimator, verifier, artifact writer, and stores.

The runner returns a verified package only when status is `ready_for_evidence`. Invalid drafts remain diagnostic artifacts and never become portable packages or projections.

## 3. Normal article path

Use this path when estimated primary input is within 60% of the configured model context and the article has at most 80 structural blocks.

```text
validate input
→ deterministically propose structural blocks and offsets
→ build one full-article CF1 prompt
→ one primary model call
→ deterministic normalization and ID assignment
→ deterministic identifier normalization
→ assemble draft package
→ verify
→ optional one targeted repair call
→ reverify
→ finalize immutable package
→ persist transactionally when requested
→ write artifacts
```

The primary call receives the full article once, labeled by block ID, plus metadata and the output contract. It returns semantic block annotations, raw assertions, article map, consistency findings, selected claims, targets, and Evidence Need Cards in one structured response.

Do not make routine per-block, per-claim, per-target, critique, selection, targetization, or card-building model calls.

## 4. Deterministic structural blocks

`proposeStructuralBlocks(article)` uses only supplied structure:

- headings and DOM section boundaries when supplied by an adapter
- paragraphs, lists, quotations, captions, and line breaks
- maximum block character size with paragraph-safe splits
- exact offsets into `article.text`

It does not label rhetorical function, stance, theme relevance, or claim importance.

Block invariants:

- ordered, non-overlapping source ranges
- no invented text
- every non-whitespace article span represented or explicitly classified as boilerplate by the input adapter
- stable IDs for the same normalized article and block algorithm version
- target 1,000–8,000 characters per block; hard maximum 30,000

## 5. Primary agent task

The primary instruction asks the model to:

1. Interpret semantic block functions and stance.
2. Build the final theme, thesis, pillars, clusters, opponents, and qualifications.
3. Extract a bounded working assertion inventory with provenance.
4. Reconcile semantic repetitions without deleting occurrences.
5. Review cross-block internal consistency.
6. Select compelling claims whose support/refutation materially affects the argument.
7. Explain counterfactual importance and pillar relationships.
8. Create evidence-facing Phase 3 targets from selected claims only.
9. Create one Evidence Need Card per searchable target.
10. Preserve article-contained identifiers and research anchors.

The model may not supply final package/run IDs, hashes, timestamps, verification results, persistence state, source offsets, or token diagnostics. Deterministic code supplies those.

## 6. Agent output boundary

The model returns `CF1AgentDraft`:

```js
{
  semanticBlockAnnotations: [],
  rawAssertions: [],
  articleMap: {},
  internalConsistencyFindings: [],
  selectedEvaluationClaims: [],
  phase3Targets: [],
  evidenceNeedCards: [],
  selectionCountException: null,
  agentWarnings: []
}
```

Agent-local temporary IDs are allowed in the response. Normalization replaces them with canonical package-local IDs and rewrites references through an explicit ID map. Any unresolved reference is a blocking error, never guessed. `selectionCountException` is required when the agent selects outside the normal 8–12 range; deterministic assembly copies it into diagnostics.

The model may improve selected claim wording but must cite source assertions/blocks and preserve material scope, attribution, uncertainty, and qualification. EvidenceRun cannot later mutate that wording.

## 7. Deterministic tools

These are runner services, not independent reasoning agents:

```js
validateArticleInput(article)
estimateCf1Tokens(payload)
proposeStructuralBlocks(article, options)
buildPrimaryPrompt(state)
invokeCf1Model(request)
normalizeAgentDraft(draft, sourceState)
normalizeIdentifierHints(packageDraft)
assembleCf1Package(state)
verifyCf1Package(packageDraft)
buildRepairRequest(packageDraft, verification)
applyVerifiedRepair(packageDraft, repairResponse)
hashCf1Package(validPackage)
persistCf1Package(validPackage, context)
writeCf1Artifacts(runState)
```

All dependencies are injectable. Unit tests use fake model/store/clock/ID implementations. No tool imports EvidenceRun, search-provider, scraper, browser, or fetcher modules.

## 8. Long-article fallback

Use the fallback when the normal prompt exceeds 60% of model context or has more than 80 blocks.

1. Group complete structural blocks into batches targeting at most 25% of model context.
2. Run bounded batch-observation calls with identical compact schema.
3. Preserve block IDs and short exact excerpts; do not select final claims in batch calls.
4. Run one article-level synthesis call over all compact observations plus only the source excerpts needed for grounding.
5. Normalize, verify, and optionally repair exactly as in the normal path.

Batch observation shape:

```js
{
  blockAnnotations: [],
  candidateAssertions: [],
  namedWorksAndIdentifiers: [],
  possibleCrossBlockLinks: [],
  localWarnings: []
}
```

Limits:

- maximum 6 batch calls
- one synthesis call
- maximum one repair call
- no recursive summarization
- no overlapping text unless a structural block itself requires bounded continuation context
- fail `CF1_INPUT_TOO_LARGE` rather than silently omit blocks

## 9. Model and SDK boundary

Initial CF1 uses a small local model-runner interface over the repository's existing OpenAI capability. Do not install `@openai/agents` for CF1.

```js
invoke({ system, user, responseSchema, model, temperature, timeoutMs, usageContext })
```

The interface must support structured JSON, timeout, one transport retry, usage telemetry, and raw response capture. A future Agents SDK adapter may implement the same interface without changing CF1 contracts.

Transport retry is not a semantic repair. A retry may occur only when no usable model response was received.

## 10. Call and token budgets

Normal path:

- one primary semantic call
- zero or one repair call
- maximum two semantic calls total

Long path:

- maximum six compact batch calls
- one synthesis call
- zero or one repair call
- maximum eight semantic calls total

Configurable hard budgets:

- maximum primary input: 60% of model context
- maximum total model input/output tokens per run
- maximum output tokens per call
- maximum wall-clock duration
- maximum raw assertions, selected claims, targets, cards, and repair operations

Defaults are finalized during implementation against the chosen model's published limits and fixture measurements, not hardcoded from assumptions in this plan. Budget exhaustion is a terminal, typed failure.

Telemetry records model, calls, attempts, input/output/cached tokens, duration, path, repair use, tokens per selected claim, and tokens per valid target.

## 11. Repair and failure policy

The exact one-pass repair request/response contract, mutation allowlist, and terminal failure taxonomy are defined in `claim_foundry_cf1_repair_failure_contract.md`.

## 12. Phase 4 acceptance

- Typical articles use one primary call and at most one repair.
- Full-article context determines theme, pillars, selection, targets, and cards together.
- Long articles use bounded compact observations without dropping blocks.
- The model cannot write deterministic identity, offsets, hashes, verification, or persistence state.
- Repair is targeted, allowlisted, and limited to one pass.
- Budget and transport failures are typed and auditable.
- No execution path imports or invokes evidence search/fetch behavior.
