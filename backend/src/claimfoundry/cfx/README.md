# CFX: Meaning-First ClaimFoundry

CFX is an isolated experimental ClaimFoundry module.

Its governing sequence is:

> Discover meaning from the whole article. Ground it precisely. Normalize only
> after meaning has been preserved.

The canonical discovery prompt is:

- `prompts/burden-of-proof-v1.json`

## Boundary

CFX may reuse only neutral shared infrastructure under
`src/claimfoundry/shared`:

- provider transport;
- article normalization and source-unit projection;
- request, token, latency, and cost accounting;
- immutable artifact persistence;
- content hashing and shared errors.

CFX must not import CF1–CF7 orchestration, agents, working packages, chunk
factories, grouping experiments, selector experiments, atomicity pipelines,
repair loops, region dispositions, semantic critics, or historical run
artifacts.

Those implementations remain available for comparison but are not dependencies
of CFX.

## Implemented stages

- S0 freezes and hashes the complete article, normalized source units, and the
  exact unit-labelled projection.
- S1 performs one whole-article meaning-discovery request and publishes exactly
  12 immutable canonical propositions.
- S2 implements both governed exact-grounding arms, row-level mechanical
  validation, immutable forensic request artifacts, comparison metrics,
  Markdown reporting, and deterministic self-contained HTML reporting.

No CFX live model call is implicit in verification or preflight commands.

## Commands

From `backend/`:

```text
npm run verify:cfx
npm run preflight:cfx:s1
npm run run:cfx:s1
npm run preflight:cfx:s2 -- --s1-run-dir <frozen-cfx-s1-run>
npm run run:cfx:s2 -- --s1-run-dir <frozen-cfx-s1-run>
```

The two `run:` commands require separate, exact live-run authorization.
