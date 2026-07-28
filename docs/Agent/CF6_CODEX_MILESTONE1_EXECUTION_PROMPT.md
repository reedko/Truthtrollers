# Codex Execution Prompt — CF6 Milestone 1

Work from the VeriStrata repository root.

## Governing context

Treat the following as the governing hierarchy for this task:

1. `ml/cf1-argument-model/data/annotation-prompts/stupidity/CF6_REAL_AGENT_BUILD_MCT_2026-07-27.docx`
2. `backend/agents/CF6_INTEGRATION_MAP.md`
3. `CF6_OUTPUT_CONTRACT_AND_ACCEPTANCE_DECISIONS.md` if present in the repository or supplied with this task
4. `CF6_ACCEPTANCE_RUBRIC.md` if present
5. `CF6_FAILURE_CORPUS_MANIFEST.md` if present
6. `TM5_ClaimFoundry_Brain_First_Spec.md` as retained conceptual design provenance
7. `CF1_CLAIM_PACKAGE_V1_COMPLETE_REFERENCE.md` as a legacy executable-contract reference only

When these conflict:

- the CF6 Real Agent Build MCT governs runtime architecture and milestone order;
- the repository-specific Integration Map governs actual paths, exports, package boundaries, and known risks;
- the user’s CF6 output-contract decisions govern the eventual semantic contract;
- the acceptance rubric governs promotion criteria;
- the failure corpus governs historical fixtures and what must not be reinvented;
- the TM5 Brain-First stages are capabilities and persisted artifact types, not a mandatory hard-coded sequence;
- `cf1.claimPackage.v1` is a legacy integration envelope, not automatically the final CF6 semantic model.

## Settled product decisions to preserve

These decisions are binding for future ClaimFoundry work, although Milestone 1 must not implement the domain schema yet:

- CF6 will create a new semantic core with a compatibility wrapper/projection rather than inherit the legacy package as its semantic design.
- Product purpose:

  > The smallest complete set of grounded, independently investigable substantive representations needed to evaluate the content and find evidence bearing directly on the content.

- Claims must be non-compound and evidence-searchable.
- Implicit or named studies must be identifiable.
- Article treatment must distinguish adopted/supported material from challenged or rebutted material.
- Persist normalized source, semantic inventory, theme map, candidates, canonicalization, critic findings, selection report, repair history, final package, and tool trace.
- The future selected-claim contract must preserve:
  - `surfaceStatement`
  - `substantiveAssertion`
  - `attributionLayers[]`
  - `contentSupplier`
  - `contentSupplierKind`
  - `reportingVoice`
  - `articleTreatment`
  - `polarity`
  - `scope`
  - `attributionUnitIds[]`
  - `substantiveGroundingUnitIds[]`
  - `verificationTarget`
  - `themeIds[]`
  - `materiality`
  - `selectionRationale`
  - `identityHints`
- Default verification target: the deepest independently verifiable substantive proposition.
- Preserve the surface reporting event separately.
- Create a separate attribution/provenance target only when the content materially concerns whether the source made the statement, the source’s statement history, credibility, authorship, disclosure, existence, or identity.
- Expose at most three attribution layers; abstain beyond the cap rather than flattening.
- Record unresolved suppliers as `unknown`; do not guess.
- Future evidence retrieval must never mutate ClaimFoundry canonical target text.
- Portfolio ceiling 15, no hard floor, flag below 5, never pad.
- Maximum one repair per defect and two repair rounds per run.
- Semantic-corruption risk requires human review.
- Blocking promotion gates: crux recovery, independent verdictability, challenged-class treatment, structural grounding integrity, and zero repair corruption.

Do not design or implement these future domain details in Milestone 1. Preserve them so the scaffold does not foreclose them.

## Current task

Implement **CF6 Milestone 1 only**:

> Prove that the OpenAI Agents SDK can execute one bounded, harmless, typed, SDK-managed model/tool loop through a repository-owned provider/runtime boundary, without changing CF5 or any production ClaimFoundry behavior.

This is not the ClaimFoundry agent yet.

## Mandatory preflight

Before changing files:

1. Run and capture:
   - `git status --short`
   - `git branch --show-current`
   - `git diff --stat`
   - `node --version`
   - `npm --version`
2. Inspect:
   - `backend/package.json`
   - `backend/package-lock.json`
   - `backend/agents/CF6_INTEGRATION_MAP.md`
   - the governing MCT
3. Confirm:
   - the existing dirty worktree;
   - CF5 is still isolated under `backend/experiments/cf5/`;
   - `backend/agents/` does not contain a conflicting runtime implementation;
   - the backend package is the correct npm boundary.
4. Do not clean, stash, reset, switch branches, overwrite artifacts, or commit.

If the audited facts materially differ from the Integration Map, stop and report the discrepancy before implementation.

## Allowed Milestone 1 changes

Modify only:

- `backend/package.json`
- `backend/package-lock.json`

Create only:

- `backend/agents/tsconfig.json`
- `backend/agents/shared/agentErrors.ts`
- `backend/agents/shared/environment.ts`
- `backend/agents/shared/modelProvider.ts`
- `backend/agents/shared/runBudget.ts`
- `backend/agents/shared/traceMetadata.ts`
- `backend/agents/shared/agentRuntime.ts`
- `backend/agents/smoke/smokeTool.ts`
- `backend/agents/smoke/smokeAgent.ts`
- `backend/agents/smoke/smokeAgent.test.ts`
- `backend/agents/README.md`

Do not create additional files without first explaining why the exact Milestone 1 list is insufficient.

## Dependency rules

- Install exactly one agent framework: `@openai/agents`.
- Add direct Zod 4 support.
- Add the minimum backend-local TypeScript execution/typecheck dependencies required for the isolated `backend/agents/**` subtree.
- Review and report any `openai` dependency movement caused by the Agents SDK.
- Do not install LangGraph, AutoGen, CrewAI, Claude Agent SDK, Google ADK, or any second agent framework.
- Do not silently upgrade Node or alter deployment/runtime policy.
- Verify the exact installed Agents SDK API from the installed package and type declarations. Do not rely on remembered property names from examples.

If Node 18 cannot run the selected SDK/toolchain, stop with:
- the exact failing command;
- the exact compatibility evidence;
- the smallest viable remediation options;
- no silent Node upgrade.

## Required implementation

### 1. Shared runtime boundary

Create a provider-neutral repository boundary under `backend/agents/shared/`.

Only this shared boundary may import provider/agent SDK packages.

The boundary must normalize at least:

- model identity;
- run/trace identity where exposed;
- tool-call count;
- model turn count;
- input/output/total token usage where exposed;
- duration;
- termination reason;
- provider/runtime errors.

Do not expose raw SDK response objects as the domain contract.

### 2. Environment validation

Require explicit non-production smoke configuration:

- `OPENAI_API_KEY`
- `CF6_SMOKE_MODEL`

Fail clearly before the network call when configuration is missing.

Do not reuse production `CF1_*` environment variables.

### 3. Bounded smoke budget

Define explicit limits for:

- model turns;
- tool calls;
- wall time.

The test must fail clearly if a limit is exceeded.

### 4. Harmless typed tool

Implement one deterministic, Zod-validated tool that has no product capability.

Acceptable example:

- normalize whitespace in supplied text and return:
  - original text;
  - normalized text;
  - character count;
  - word count.

The tool must not access:

- shell;
- filesystem;
- network/web;
- SQL/database;
- Redis;
- ClaimFoundry;
- CF5;
- source articles;
- production routes.

### 5. Non-production smoke agent

Create one smoke agent whose instructions require it to use the harmless tool and return a small structured result.

The SDK-managed runner must own the repeated model/tool loop.

Do not hand-code:

```text
call model
call tool
call model again
```

The acceptance point is that the Agents SDK receives a tool-capable agent and manages the tool invocation loop.

### 6. Live integration test

Add one explicitly live/billable smoke test proving:

- the SDK-managed loop ran;
- the harmless tool was invoked;
- validated tool arguments were used;
- a typed final result was returned;
- model/tool/turn/time budgets were respected;
- normalized trace/usage metadata exists where the SDK exposes it;
- failures are classified clearly.

Do not make ordinary backend tests automatically depend on credentials or network access.

The smoke test may be invoked only by the dedicated script.

### 7. Documentation

`backend/agents/README.md` must document:

- this subtree is non-production;
- required environment variables;
- exact typecheck command;
- exact live smoke command;
- expected success output;
- expected missing-credential behavior;
- current Node compatibility result;
- no production route or CF5 integration exists yet;
- how to inspect the SDK-managed tool event/trace result.

## Required scripts

Add backend-local scripts equivalent to:

```json
{
  "typecheck:agents": "tsc -p agents/tsconfig.json --noEmit",
  "test:agents:smoke": "tsx --test agents/smoke/smokeAgent.test.ts"
}
```

Adjust only if the installed toolchain requires a different exact command, and document why.

Do not replace or repurpose existing scripts.

## Verification

Run:

```bash
cd backend
npm run typecheck:agents
```

Then, only when `OPENAI_API_KEY` and `CF6_SMOKE_MODEL` are available:

```bash
cd backend
npm run test:agents:smoke
```

Also rerun the untouched CF5 baseline:

```bash
node --test backend/experiments/cf5/*.test.js
```

If credentials are unavailable, do not fake a passing live test. Prove all offline checks, show the exact live command, and report the live acceptance item as blocked.

## Hard prohibitions

Do not:

- change CF5;
- import CF5 into `backend/agents/`;
- alter deployed ClaimFoundry routes;
- add a production feature flag;
- add ClaimFoundry domain tools;
- add ArticleDocument tools;
- add persistence or migrations;
- add job queues;
- add subagents or handoffs;
- add memory/session layers beyond what the smoke proof minimally requires;
- add shell, filesystem, SQL, database, Redis, web, article, or repository tools;
- create a fake fixed two-call pipeline and label it agentic;
- tune claim-extraction prompts;
- normalize the failure corpus yet;
- implement the CF6 semantic schema yet;
- commit.

## Acceptance test

Milestone 1 passes only if:

1. the repository compiles/typechecks the isolated agent subtree;
2. one live SDK-managed model/tool loop invokes the harmless typed tool;
3. the result is structured and bounded;
4. the tool event or equivalent SDK evidence is inspectable;
5. CF5 remains unchanged and its tests remain green;
6. no production route imports the new subtree;
7. no additional agent framework was installed.

Installation alone is not proof. A one-shot completion without a tool call is not proof. A manually scripted model → tool → model sequence is not proof.

## Final report

At completion, report:

1. preflight results;
2. exact tracked and untracked files changed;
3. exact dependency versions installed;
4. lockfile effects, especially `openai` and Zod;
5. exact runtime architecture implemented;
6. exact typecheck result;
7. exact smoke-test result, including model, tool calls, turns, tokens, duration, and trace identifier where available;
8. exact CF5 regression-test result;
9. confirmation that no route, migration, domain tool, production feature flag, or CF5 file changed;
10. remaining blockers or unknowns;
11. recommendation: proceed to Milestone 2, repair Milestone 1, or stop.

Then stop. Do not begin ClaimFoundry domain integration.
