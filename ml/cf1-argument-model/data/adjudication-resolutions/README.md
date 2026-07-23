# CF1 Adjudication Resolution Overlays

The controlled adjudication compiler is fail-closed. It does not silently resolve contradictions in a reviewed decision export and does not mutate that export.

When a blocker requires an explicit human decision, create a small overlay with this shape:

```json
{
  "schemaVersion": "cf1.adjudicationResolutions.v1",
  "resolutions": {
    "CF1-F03:argument:AU013": {
      "decision": "accept",
      "notes": "Explicit adjudicator resolution and reason."
    }
  }
}
```

Then compile with:

```bash
node ml/cf1-argument-model/tools/compile-adjudicated-annotations.mjs \
  --resolutions ml/cf1-argument-model/data/adjudication-resolutions/YOUR-RESOLUTIONS.json
```

The overlay is recorded by path and SHA-256 in the compilation report. It is applied in memory and does not alter the original draft or review-decision files.

The compiler also supports:

```bash
node ml/cf1-argument-model/tools/compile-adjudicated-annotations.mjs --validate-only
node ml/cf1-argument-model/tools/compile-adjudicated-annotations.mjs --help
```

Safety rules:

- Existing output directories are never overwritten.
- Candidate annotations always retain `adjudication.status: draft`.
- Split-child lineage is preserved.
- Relations and consistency findings touched by a split or removal are queued for review rather than fanned out automatically.
- Unreviewed evidence targets and warrants are blanked and excluded from training eligibility.
