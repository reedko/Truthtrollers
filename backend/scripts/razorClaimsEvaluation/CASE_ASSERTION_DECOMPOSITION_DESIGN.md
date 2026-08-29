# Case assertion decomposition: governing design

The current implementation is a read-only diagnostic. It does not persist child
assertions and is not wired into production bearing, retrieval, or reporting.

## Eventual production contract

Persistence is the intended production design.

Before decomposed assertions are used by the production bearing line:

1. Every child assertion must be persisted with its own real database identity.
2. Every child must retain explicit lineage to its unchanged, authoritative
   parent case assertion.
3. The decomposition prompt/schema version must be recorded so children and
   their evidence links remain reproducible.
4. Evidence-bearing results and reference links must target the persisted child
   identity, not a temporary diagnostic ID and not an ambiguous shared parent ID.
5. Reports must group child-level evidence judgments beneath the authoritative
   parent while preserving the individual child judgments.
6. Parent evaluation must not be produced by blindly averaging child scores. A
   compound parent may have supported, refuted, qualified/neutral, and
   unaddressed children at the same time.
7. A decomposition failure must be explicit and quarantined or handled through
   a separately documented fallback. It must not silently rewrite or partially
   persist semantic output.

Diagnostic-only synthetic IDs may be used to test the future production-shaped
flow before persistence exists. They are not the production identity design and
must never be written as claim IDs or reference-link targets.

The original parent assertion remains unchanged and authoritative throughout.

## Sparse decomposition response

The decomposition model returns only parents that require decomposition.
Omission means the original parent remains the adjudication assertion unchanged.
When a parent is returned, the bearing inventory will eventually contain its
children instead of the compound parent. The complete bearing inventory is
therefore: all unchanged parents plus only the children of decomposed parents.

## Pass selection for bearing

When the decomposition diagnostic uses one pass, that sole pass supplies the
adjudication inventory for the bearing test. When it uses multiple passes, only
the final pass supplies that inventory. Earlier passes are stability diagnostics
and are not merged, voted, or averaged.

If the selected final pass is invalid or quarantined, bearing must stop. It must
not silently fall back to an earlier pass.

When multiple model types are evaluated, each model has its own independent
passes and final-pass selection. The configured bearing-selected model supplies
the adjudication inventory; other models are comparison cohorts only. The
current bearing-selected decomposition model is `gpt-5.4-mini-responses`.
