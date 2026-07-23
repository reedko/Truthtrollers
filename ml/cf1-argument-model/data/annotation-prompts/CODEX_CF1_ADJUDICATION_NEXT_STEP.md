# CF1 adjudication compiler: next step

Use the existing compiler exactly as designed. Do not alter the immutable argument drafts or the reviewed decision export.

## Inputs

- Reviewed decisions:
  `ml/cf1-argument-model/data/annotation-prompts/CF1-argument-drafts-v1-review-decisions-normalized.json`
- Resolution overlay:
  `ml/cf1-argument-model/data/adjudication-resolutions/CF1-adjudication-resolutions-v1.json`

The overlay explicitly resolves the sole blocker:

- `CF1-F03:argument:AU013` → `accept`

Reason: the previous `remove` decision contradicted its reviewer note. Retain AU013 as the article's thesis-level characterization of JCPH claims.

## Required actions

1. Copy the supplied resolution overlay into:
   `ml/cf1-argument-model/data/adjudication-resolutions/CF1-adjudication-resolutions-v1.json`

2. Run the existing tests:

   ```bash
   node --test ml/cf1-argument-model/tools/tests/adjudication-compiler.test.mjs
   ```

3. Validate without writing:

   ```bash
   node ml/cf1-argument-model/tools/compile-adjudicated-annotations.mjs \
     --resolutions ml/cf1-argument-model/data/adjudication-resolutions/CF1-adjudication-resolutions-v1.json \
     --validate-only
   ```

4. If validation reports zero blockers, compile to a new, non-existing output directory. Use a timestamped or versioned path so the compiler's no-overwrite rule remains intact:

   ```bash
   node ml/cf1-argument-model/tools/compile-adjudicated-annotations.mjs \
     --resolutions ml/cf1-argument-model/data/adjudication-resolutions/CF1-adjudication-resolutions-v1.json \
     --output ml/cf1-argument-model/data/adjudication-candidates/argument-drafts-v1-r1
   ```

5. Do not approve fixtures and do not generate training rows yet.

6. Preserve the compiler's current safety behavior:
   - evidence targets and warrants remain blank and excluded;
   - split children retain parent lineage;
   - affected relations and consistency findings go to the unresolved review queue;
   - unaffected graph records remain intact;
   - source files remain immutable.

## Return these artifacts for focused review

- `argument-drafts-v1-r1/review-queue.json`
- `argument-drafts-v1-r1/compilation-report.json`
- `argument-drafts-v1-r1/COMPILATION_REPORT.md`
- all nine `CF1-F0X.annotation.candidate.v1.json` files

## Final report

Report:
- test result;
- validation blocker and warning counts;
- compiled argument count;
- split-child review count;
- unresolved relation count;
- unresolved consistency-finding count;
- unresolved passage-coverage count;
- attribution spot-check count;
- exact output directory;
- tracked files changed and generated artifacts separately.

Do not modify or commit anything beyond the resolution overlay and any necessary focused fixes to the compiler itself.
