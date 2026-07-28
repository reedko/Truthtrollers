# CODEX — CF6 RUN-IN-PLACE AUTHORIZATION

**Purpose:** Execute the already-verified CF6 whole-article F03 rerun from the current working tree without creating a commit, branch, stash, or detached worktree.

The prior pre-run failure was caused by a Git cleanliness/reproducibility requirement, not by a CF6 code defect. The verified CF6 implementation is currently untracked. For this one experiment, the accepted file-hash manifest is the reproducibility boundary.

Do not modify code. Do not stage or commit anything. Do not create a branch, stash, or worktree.

## 1. Accepted runtime boundary

Use the complete CF6 reproducibility closure you already enumerated as the authorized runtime closure, including:

- the whole-article CF6 runtime under `backend/agents/claimFoundry/`;
- required shared runtime under `backend/agents/shared/`;
- required agent tests and deterministic test support under `backend/agents/tests/`;
- `backend/agents/tsconfig.json`;
- the CF6 migration and MySQL test provisioning;
- CF6-related `backend/package.json` and `backend/package-lock.json` changes;
- immutable article/fixture inputs required by the governed F03 run;
- unchanged tracked repository dependencies reached by that closure.

Exclude:

- `artifacts/` outputs from prior runs;
- reports, logs, traces, and generated evaluation outputs;
- the sealed evaluator key;
- secrets and environment files;
- unrelated tracked or untracked changes;
- the two ignored historical artifacts unless they are immutable source/fixture inputs strictly required by the runtime.

## 2. Hash-manifest gate

Before any billable model request:

1. Produce a SHA-256 manifest of every file in the accepted runtime closure.
2. Compare all A/B/C files against the accepted verification report.
3. Verify:
   - instruction hash matches the accepted amended instruction hash;
   - tool-schema hash matches the accepted amended schema hash;
   - all four tool schemas are present in fixed order;
   - no runtime file changed after verification;
   - no dependency imported by the live entry point comes from an unrelated modified or untracked file outside the accepted closure.
4. Record the manifest and import-closure report in a new immutable pre-run artifact directory.

Unrelated working-tree files outside the import/runtime closure do not block this experiment.

If any file inside the runtime closure differs from the verified version, stop before model invocation and report the exact path and hash mismatch.

## 3. Offline verification

Run the already-governed checks from the current working tree:

- CF6 tool tests;
- CF6 agent tests;
- serialized tool-execution tests;
- one-agent/no-out-of-band-model-call tests;
- contamination scan;
- real MySQL durability tests;
- TypeScript agent typecheck;
- instruction/schema byte and hash audit.

Do not alter source to make a test pass.

If any check fails, stop before the live run and report only the failing check and evidence.

## 4. Live-run authorization

If the hash gate and all offline checks pass, execute exactly one live F03 whole-article rerun from the current working tree.

Retain all governed runtime settings:

- exactly one host-created `Runner.run`;
- complete article in initial context;
- no model calls outside the one ClaimFoundry agent run;
- `toolChoice = "required"`;
- `resetToolChoice = false`;
- parallel tool calls disabled;
- function-tool concurrency equals one;
- maximum six internal model turns;
- fixed four-tool surface;
- successful finalization and abstention/review tools terminate the run;
- budget exhaustion is recorded as `budget_exhausted / TURN_BUDGET_EXHAUSTED`;
- stable-prefix cache and request-accounting gates remain active;
- no evaluator expectations are model-visible.

Do not tune, patch, retry, or restart after the live run begins.

## 5. Freeze and report

When the run ends:

1. Freeze and hash the complete new run artifact directory.
2. Report:
   - terminal status;
   - run ID;
   - tool trajectory;
   - final package count or typed failure;
   - gross/cached/uncached/output tokens;
   - article cost multiplier;
   - cache-gate result;
   - proof of one runner invocation;
   - proof of no out-of-band model call;
   - runtime-closure manifest hash;
   - run-artifact manifest hash;
   - confirmation that the evaluator key remained sealed.
3. Stop.

Do not open the evaluator key and do not perform semantic scoring in this instruction.

## Governing clarification

A Git commit is not required to execute this one governed experiment. The accepted cryptographic runtime-closure manifest is the execution snapshot. Repository cleanup and committing the CF6 subsystem will occur after the run, separately.
