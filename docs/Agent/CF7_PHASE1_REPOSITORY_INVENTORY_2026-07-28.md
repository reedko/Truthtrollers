# CF7 Phase 1 repository inventory

Date: 2026-07-28
Checkpoint: `6f242e804dfff06a260c9c1dedd69146d0f9cf73`
Tag: `pre-cf7-cleanup`

This inventory was taken before CF7 implementation. “Active runtime” means reachable
from the current production server or an explicitly configured experimental command.
No historical implementation is classified for deletion.

| Path | Current purpose | Used by active runtime? | Candidate for CF7 reuse? | Action now |
|---|---|---:|---:|---|
| `backend/src/claim-foundry/` | CF1 production pipeline, orchestration, schemas, verification, provider transports, artifacts | Yes; production routes call `runClaimFoundry` | Only narrow neutral utilities | Leave untouched |
| `backend/src/claim-foundry-basic/` | Early/basic ClaimFoundry implementation | No production import found | No | Leave untouched |
| `backend/experiments/cf2/` | CF2 experimental pipelines and evaluation variants | Experimental commands only | No orchestration reuse | Leave untouched |
| `backend/experiments/cf3/` | CF3 experiments, gold, and evaluation | Experimental commands only | No | Leave untouched |
| `backend/experiments/cf4/` | CF4 deterministic/NLP experiments and sealed gold | Experimental commands only | No; sealed gold is prohibited in Phase 1 | Leave untouched |
| `backend/experiments/cf5/` | CF5 prompt/pipeline experiments | Experimental commands only | No | Leave untouched |
| `backend/agents/claimFoundry/` | CF6 manager-agent and whole-article agent implementation | Explicit CF6 npm commands, not production routes | Normalizer provenance only, through its neutral source | Leave untouched; CF7 imports prohibited |
| `backend/agents/shared/` | CF6 SDK provider, runtime, usage, budget, and trace helpers | CF6 commands | Later provider/accounting behavior may inform a neutral adapter; no Phase 1 import | Leave untouched; CF7 imports prohibited |
| `backend/agents/tests/` | CF6 tool, agent, and MySQL tests | Test commands only | No | Leave untouched |
| `backend/src/claim-foundry/article-document/` | Deterministic normalization, source units, spans, structural blocks | Yes, shared by CF1 and CF6 | Yes | Reuse through `backend/src/claimfoundry/shared/` adapters |
| `backend/src/claim-foundry/canonicalJson.js` | Canonical JSON and SHA-256 helpers | Yes | Yes | Reuse through a neutral CF7 shared adapter |
| `backend/src/claim-foundry/openAiTransport.js`, `openAiResponsesTransport.js`, `modelRunner.js` | Provider calls, structured-output parsing, retries, usage normalization | Yes | Later phases only | Leave untouched; no Phase 1 model path |
| `backend/src/claim-foundry/tokenBudget.js` | CF1 token estimation and semantic-call budgets | Yes | Accounting concepts only; not its CF1 path policy | Leave untouched |
| `backend/src/claim-foundry/artifacts.js` | CF1 state/package artifact writer | Yes | No; coupled to CF1 run state | Leave untouched; add a small CF7 atomic JSON writer |
| `backend/src/claim-foundry/errors.js` | CF1 error hierarchy | Yes | Error shape only | Leave untouched; add isolated `Cf7Error` codes |
| `backend/src/evidence-run/` | EvidenceRun pipeline, artifacts, timing, schemas | Yes | Explicitly prohibited | Leave untouched; CF7 imports prohibited |
| `backend/src/storage/claimFoundry*.js` | Production CF1 persistence and identities | Yes | Later architecture review only | Leave untouched |
| `backend/test/claim-foundry/fixtures/` | Existing F01–F09 deterministic article fixtures | Tests/experiments | Yes, fixture input only | Reuse F03 without semantic keys |
| `backend/test/`, `backend/agents/tests/` | Existing JavaScript and TypeScript test locations | Yes, via scripts | Yes as layout precedent | Add isolated `backend/test/claimfoundry/cf7/` tests |
| `docs/Agent/` | Architecture specifications and execution records | Documentation | Governing CF7 spec only | Leave untouched except this inventory |

## Agent/agent case audit

The only relevant tracked directories are `backend/agents/` and `docs/Agent/`. They
do not occupy the same parent, do not differ only by case, and no tracked path pair
collides under lowercase comparison. No rename or casing cleanup is required.

## Minimal-cleanup decision

No move or rename is required to isolate CF7 safely. Moving the production normalizer,
provider, accounting, or persistence code would create unnecessary risk. CF7 will live
under the new case-stable boundary `backend/src/claimfoundry/`, import historical code
only through narrow shared adapters, and enforce that boundary structurally in tests.

The Phase 1 implementation will not import CF1–CF6 orchestration, agents, EvidenceRun,
working packages, region dispositions, semantic critics, repair loops, or production
routes.
