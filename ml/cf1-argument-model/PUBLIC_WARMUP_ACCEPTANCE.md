# Public argument-mining warm-up acceptance record

Date: 2026-07-23

Decision: **accepted only as a quarantined research warm-up corpus**. It is not
production-cleared, is not CF1 gold, and must not be blended directly with CF1
specialization rows.

## Compiled result

- Documents: 514
- Accepted rows: 11,972
- Train: 8,769 rows
- Validation: 890 rows
- Held-out test: 2,313 rows
- Generic component detection: 1,897 rows
- Annotated component-span extraction: 6,082 rows
- Explicit relation classification: 3,993 rows
- Generic AAEC attacks held for review: 219
- Ambiguous AAEC negative windows held for review: 32
- Inferred deployment rows excluded: 6,665
- Inferred orientation rows excluded: 491
- Exact public/public or public/CF document duplicates found: 0

Accepted relation labels preserve source semantics:

- `supports`: 3,876
- `rebuts`: 108 (Microtexts explicit rebuttal only)
- `provides_evidence_for`: 9

## Source identity

| Source | Supplied archive SHA-256 | Mapped JSONL SHA-256 |
|---|---|---|
| Arg Microtexts | `cbae2dacc7ed91cac70621dfb10871d84e8e6cc3dcf3fd4b739604ce06148522` | `d2a6138ad1726436024def278d43fa6fdd193ee2320d1e153372da96373ff903` |
| Argument Annotated Essays v2 | `76f1c93231e5770e0133b11efb4701fc4e0089ac629690984b92cb974e745235` | `1b6e4802a893ce329dd04032d0bf17cf4634a38de936bd6b2be2472a38ecad5a` |

The supplied Microtexts JSONL occurs in both ZIPs and is byte-identical; it is
compiled once.

## Official-source reproduction

Both supplied mappings were independently replayed with the converters included in
the archives:

- Arg Microtexts: all 1,157 mapped rows and all 84 queued records reproduced
  exactly from official Git commit
  `6707c133de713130cabe647f2f218681d65fdc15`.
- AAEC 2.0: all 12,078 mapped rows reproduced exactly from the official TU
  Darmstadt release with ZIP SHA-256
  `7d592ccdebfcce580b2d3d9bb53c93da691cbb3ac2741e8d403a7d1599e60de7`.

This closes the source-provenance gate. It does **not** change the licensing gate.

## Deliberate semantic boundaries

- Public tasks are named `detect_argument_component`, `extract_argument_span`, and
  `classify_argument_relation`.
- Public argument components are not relabeled as atomic CF1 factual assertions.
- AAEC's generic `attacks` relation is not equated with CF1 `rebuts` or thesis
  contradiction.
- AAEC negative windows that repeat text annotated as an argument component elsewhere
  in the same essay are excluded rather than teaching a position-dependent
  contradiction without offsets.
- Inferred public orientation, stance, deployment, role, materiality, and selection
  labels are excluded.
- Whole essays are converted to local source windows for span extraction.
- Document identity, original source split, mapping rule, source row IDs, and corpus
  identity remain attached as non-prompt provenance.
- The public and CF1 stages use separate balancing policies and separate adapter
  stages; the renderer rejects a mixed balancing request.

## Validation result

The reusable validator passed over the compiled and rendered data:

- duplicate compiled row IDs: 0
- train/validation/test document overlap: 0
- specialized CF field leakage in compiled public inputs/outputs: 0
- prompt metadata leakage: 0
- specialized CF field leakage in rendered prompts: 0
- ambiguous AAEC attacks missing from review queue: 0

Commands and generated artifact locations are documented in
[`TRAINING.md`](TRAINING.md). Generated corpora and adapters live under ignored
`work/` paths.

## Unresolved release gates

1. Resolve the applicable AAEC usage terms and the noncommercial/share-alike
   implications of Arg Microtexts for the intended adapter and deployment.
2. Train a CF1-only control and compare it with public-warm-started CF1
   specialization using identical held-out folds.
3. Do not publish, upload publicly, or deploy the public-trained adapter until the
   licensing gate is closed.
