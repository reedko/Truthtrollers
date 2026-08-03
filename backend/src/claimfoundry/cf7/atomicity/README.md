# CF7 S3 atomicity

S3 reads the frozen S2 harvest and produces a lineage-preserving atomic
assertion inventory. A deterministic gate routes only likely compound claims
to the model. Simple claims bypass the provider and the host copies their text
and grounding verbatim.

The model emits only `keep_verbatim` or `split` decisions. Grounding
completion, canonical copying, lineage, diagnostics, validation, accounting,
and immutable forensic evidence are deterministic host responsibilities.

The governed live entry point is `runCf7Atomicity.ts`. Offline verification is
available through `npm run verify:cf7:s3`; that command does not call a model.
