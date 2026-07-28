# CF5 Reporting Standard

Date: 2026-07-27
Status: binding for all future CF5 human-readable reports.

## The problem this fixes

Every CF5 report so far used a different ad hoc HTML layout, hand-written per task
(Development Task 1's defect catalog, Prompt Experiment 1's report, Prompt Experiment
2's 18-static-table dump). Formats kept changing between runs with no reuse.

## The standard

Every future CF5 report that presents run output for human review must be built with:

```
/Users/reedko/VeriStrata/veristrata-platform/backend/experiments/cf5/reportBuilder.js
```

`buildReviewHtml({ title, legendHtml, rows, columns, filterKeys, detailRenderer,
rowClassifier, extraTabs })` — one function, no templating language, no per-report
custom CSS or layout invented from scratch.

This is modeled directly on the existing, already-proven format at:

```
/Users/reedko/VeriStrata/veristrata-platform/artifacts/claim-foundry/prompt-sets/cf1pb-20260717-01/blind/full-f03-screen/review.html
```

That file is the reference example — if in doubt about how something should look or
behave, that is the answer.

## What the standard format requires

- **One self-contained HTML file.** No build step, no server, opens directly in a
  browser. All row data embedded as a single JSON blob (`DATA`), not pre-rendered into
  hundreds of static `<table>` rows.
- **Client-side search, filter, and sort.** A free-text search box plus one dropdown
  filter per configured field (fixture, prompt arm, repeat, etc.), and click-to-sort
  column headers.
- **Click-to-expand detail rows.** The main table is scannable at a glance (one row per
  claim, only the most important columns); clicking a row reveals the full detail
  (grounding text, all canonical fields, provenance) rather than showing everything
  inline for every row all the time.
- **Field-provenance tags.** Every detail field is labeled with where it came from —
  `MODEL` (from the generation or repair call) vs `HOST` (deterministically computed:
  validation results, target-match outcomes, derived fields). Use the `.tag-model` /
  `.tag-host` / `.tag-repair` CSS classes already defined in `reportBuilder.js`.
- **A legend at the top** explaining what's being shown and what the tags mean, before
  any data.
- **Tabs for multiple views of the same underlying rows** when a report has more than
  one useful lens (e.g. a "Claims" view and a "Target Comparison" view) — implemented
  via `extraTabs`, not a second HTML file.

## What this replaces

- Hand-rolled `<style>` blocks per report — use `reportBuilder.js`'s built-in CSS
  (`BASE_CSS`), extend via `extraCss` only for report-specific additions (e.g. new
  badge colors), never redefine the base layout.
- Static per-run tables (one `<table>` per fixture/arm/repeat, as in Prompt Experiment
  2's report) — flatten every run's claims into `rows`, use `filterKeys` to let a
  reviewer narrow down to one run instead of scrolling through 18 separate tables.
- Bare `Gxx`/target-ID-only displays — target descriptions belong in the row data
  (`targetDescription` field) and in `columns`, never displayed as a bare ID alone.

## How to use it (pattern)

```js
import { buildReviewHtml } from "./reportBuilder.js";

const rows = allRuns.flatMap((run) =>
  run.finalClaims.map((claim) => ({
    fixture: run.fixture, arm: run.arm, repeat: run.repeat,
    ...claim, // claimId, claim, grounding, articleTreatment, provenance
  })));

const html = buildReviewHtml({
  title: "...",
  legendHtml: '...<span class="tag tag-model">MODEL</span>generation call ' +
    '<span class="tag tag-host">HOST</span>deterministic host...',
  rows,
  columns: [["claimId","ID"],["claim","Claim"],["articleTreatment","Treatment"]],
  filterKeys: ["fixture", "arm", "repeat"],
  detailRenderer: (r) => `<div class="detail">
    <span class="tag tag-model">MODEL</span>${esc(r.claim)}
    <span class="tag tag-host">HOST</span>grounding: ${list(r.grounding)}
  </div>`,
  extraTabs: [{ id: "targets", label: "Target Comparison", renderer: (rows, DATA) => "..." }],
});
writeFileSync(path.join(outDir, "report.html"), html);
```

`esc` and `list` are available inside `detailRenderer`/`extraTabs` renderer functions —
`reportBuilder.js` injects them into the generated page's scope automatically; do not
redefine them.

## Verification before calling a report done

Per the same discipline used for Prompt Experiment 2's report: after generating, check
programmatically (not just by eye) that the HTML parses cleanly, the embedded `DATA`
JSON is valid, and the row count / column count match what was expected. A short Python
`html.parser` check plus a `JSON.parse` of the extracted `DATA` blob is sufficient — see
this doc's own build history for the pattern.

# Regression Review Interface

CF5 regression experiments produce a standard review.html.

review.html is the canonical human adjudication artifact.

Its purpose is to expose semantic differences between prompt versions through direct inspection of canonical assertions while preserving deterministic reproducibility.

The interface should remain stable across experiments so historical results remain directly comparable.

Aggregate metrics are supporting evidence and never replace row-level semantic review.
