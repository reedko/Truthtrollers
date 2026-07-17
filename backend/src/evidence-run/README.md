# EvidenceRun ER1 module boundary

This directory is the authoritative home of the provider-neutral EvidenceRun ER1 runtime.
It is a peer of `backend/src/claim-foundry/`, not an extension of the legacy evidence
engine under `backend/src/core/`.

ER1 may consume existing retrieval, acquisition, publisher, author, content, cache,
bearing, and evidence-persistence infrastructure through narrow adapters. New ER1 state,
contracts, orchestration, prompts, verification, result assembly, and artifacts belong
here.

Rules:

- normal handwritten module limit: 250 lines;
- absolute handwritten module maximum: 500 lines;
- files over 250 lines require an explicit reviewed reason and a split assessment;
- a file-size test must enforce the 500-line maximum;
- `runEvidenceRun.js` must remain under 250 lines;
- no UI, live scrape route, CF1 implementation, or legacy evidence orchestration belongs
  in this directory;
- ER1 must not make `runEvidenceEngine.js` its runtime coordinator;
- after controlled cutover, one authoritative ER1 path must replace superseded evidence
  orchestration rather than becoming a permanent parallel path.

ER1-0/1 provide contracts plus offline verification/planning. ER1-2A adds bounded provider
candidate discovery and deterministic pre-fetch retrieval-promise triage. It does not fetch
source bodies or perform bearing, stance, model, database, projection, or migration work.
Source acquisition and ER1-2B remain blocked pending review.
