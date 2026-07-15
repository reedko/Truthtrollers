# CF1 Phase 9A-5 Host-Owned Provenance Results

**Status:** Ready for review
**Live integration:** None

## Result

CF1 model output now cites stable `U####` source-unit IDs for raw assertions. The
host derives source atoms, blocks, exact excerpts, ordered spans, and canonical
offsets. Selected claims and Phase 3 targets cite raw assertions and inherit the
ordered union of their provenance.

The model no longer returns excerpts, offsets, atom IDs, or block IDs for raw
assertion provenance. It also no longer repeats provenance on selected claims or
targets. Repair may change a raw assertion's source-unit selection or an inherited
raw-assertion reference, but it cannot directly edit host-derived provenance.

Unknown, repeated, out-of-order, missing-block, or ambiguous units are blocking.
The final verifier independently re-derives all provenance and rejects any drift.

## F01 failure resolution

The prior live F01 run failed with three `CF1_INVALID_ASSERTION_PROVENANCE` and six
`CF1_INVALID_EXCERPT` errors. The 9A-5 live `gpt-4o-mini` response returned five
raw assertions grounded only with source-unit IDs. It produced no excerpt or offset
errors.

That live draft exposed a separate verifier defect: real host-created F01 blocks
may contain more than the generic 30-reference limit. The block-specific limit was
corrected to the ArticleDocument contract bounds. Replaying the exact captured
model draft, without another model call or a repair pass, produced:

- status `ready_for_evidence`;
- five selected claims and five targets;
- zero blocking errors;
- a valid final package hash;
- exact host-derived F01 excerpts and offsets.

The live call used `gpt-4o-mini-2024-07-18`, `maxOutputTokens: 8000`, and stopped
normally after 26,589 prompt tokens and 3,273 completion tokens. Its first transport
attempt timed out; the single allowed retry returned the captured draft. Claim
quality and token reduction remain 9A-6/9A-7 concerns; this phase establishes
provenance correctness only.

## Package and repair changes

Portable packages now include source-document identity, atoms, units, and links.
The identity records the adapter and exact StructureProfile ID, version, and hash.
Package verification checks source records, blocks, grounding derivation, and raw
assertion inheritance. The verifier version is now `cf1-verifier-2`.

The internal CF1 runner now creates its input through ArticleDocument and
structure-aware source blocks. This is not live scrape wiring. The comparison
runner loads the existing `backend/.env` using the repository's established dotenv
convention.

## Validation

- 178 CF1 tests pass.
- F01 regression derives the exact 36-month finding and its causal qualification
  from one source-unit citation.
- Normal, long, repair, CLI, package, projection, persistence, and route regressions
  pass.
- Every handwritten CF1 JavaScript file remains below 500 lines; the largest file
  touched in this phase is 221 lines.

## Artifacts

The captured live request, response, draft, usage, and first verifier result are in:

`artifacts/claim-foundry/comparisons/cf1cmp-9a5-f01-host-provenance-keyed/`

The original failed comparison remains available for direct error comparison at:

`artifacts/claim-foundry/comparisons/cf1cmp-diagnostic-f01-wire/`
